import * as vscode from "vscode";
import { 
  getCurrentFrameId, 
  getEvaluateContext, 
  isUsingMSVC, 
  isUsingLLDB, 
  isUsingCppdbg, 
  tryGetDataPointer, 
  readMemoryChunked,
  getMemorySample,
  getVectorSize,
  getStdArrayDataPointer
} from "../utils/debugger";
import { getWebviewContentForPointCloud, generatePLYContent } from "./pointCloudWebview";
import { PanelManager } from "../utils/panelManager";
import { SyncManager } from "../utils/syncManager";

// Function to draw point cloud
export async function drawPointCloud(
  debugSession: vscode.DebugSession, 
  variableInfo: any, 
  variableName: string, 
  isDouble: boolean = false,
  reveal: boolean = true,
  force: boolean = false,
  panelVariableName?: string
) {
  // Use panelVariableName for panel management, variableName for data access
  const panelName = panelVariableName || variableName;
  
  try {
    console.log("Drawing point cloud with debugger type:", debugSession.type);
    console.log("variableInfo:", JSON.stringify(variableInfo, null, 2));

    const panelTitle = `View: ${panelName}`;
    const bytesPerPoint = isDouble ? 24 : 12;

    // Wrap entire operation in progress indicator for immediate feedback
    const result = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "Loading Point Cloud",
        cancellable: false
      },
      async (progress) => {
        // Step 1: Get metadata only (size + dataPtr) without reading full data
        progress.report({ message: "Getting metadata..." });
        let metadata: { size: number; dataPtr: string | null } = { size: 0, dataPtr: null };
        if (variableInfo.evaluateName) {
          try {
            metadata = await getPointCloudMetadata(debugSession, variableInfo.evaluateName, variableInfo);
          } catch (e) {
            console.log("Failed to get point cloud metadata:", e);
          }
        }

        // Step 2: Get or create panel (will reveal if needed)
        const panel = PanelManager.getOrCreatePanel(
          "3DPointViewer",
          panelTitle,
          debugSession.id,
          panelName,
          reveal,
          metadata.dataPtr || undefined  // Enable sharing panels by data pointer
        );

        // Step 3: Check if panel is fresh (only when not force)
        if (!force && metadata.dataPtr) {
          progress.report({ message: "Checking if data changed..." });
          const totalBytes = metadata.size * bytesPerPoint;
          const sample = await getMemorySample(debugSession, metadata.dataPtr, totalBytes);
          const stateToken = `${metadata.size}|${metadata.dataPtr}|${sample}`;
          
          if (PanelManager.isPanelFresh("3DPointViewer", debugSession.id, panelName, stateToken)) {
            console.log(`PointCloud panel is already up-to-date with token: ${stateToken}`);
            return { panel, points: [], dataPtrForToken: "", skipped: true };
          }
        }

        // Step 4: Now read full data since we need to update
        let points: { x: number; y: number; z: number }[] = [];
        let dataPtrForToken = "";
        
        if (variableInfo.evaluateName) {
          console.log("Reading full point cloud data");
          
          try {
            const readResult = await getPointCloudViaReadMemory(debugSession, variableInfo.evaluateName, variableInfo, isDouble, progress);
            points = readResult.points;
            dataPtrForToken = readResult.dataPtr || "";
            if (points.length > 0) {
              console.log(`Loaded ${points.length} points via readMemory`);
            }
          } catch (e) {
            console.log("readMemory approach failed:", e);
          }
        }

        return { panel, points, dataPtrForToken, skipped: false };
      }
    );

    // If skipped (panel was fresh), we're done
    if (result.skipped) {
      return;
    }

    const { panel, points, dataPtrForToken } = result;

    console.log(`Loaded ${points.length} points`);

    if (points.length === 0) {
      vscode.window.showWarningMessage("No points found in the vector. Make sure the vector is not empty.");
      return;
    }

    // Update state token with actual data
    const totalBytes = points.length * bytesPerPoint;
    const sample = dataPtrForToken ? await getMemorySample(debugSession, dataPtrForToken, totalBytes) : "";
    const stateToken = `${points.length}|${dataPtrForToken}|${sample}`;
    PanelManager.updateStateToken("3DPointViewer", debugSession.id, panelName, stateToken);

    // If panel already has content, only send data to preserve view state
    if (panel.webview.html && panel.webview.html.length > 0) {
      console.log("PointCloud panel already has HTML, sending only data");
      await panel.webview.postMessage({
        command: 'updateData',
        points: points
      });
      return;
    }

    // Set HTML without embedding data (data will be sent via postMessage)
    panel.webview.html = getWebviewContentForPointCloud();
    
    // Send ready signal immediately so webview knows this is not a moved panel
    panel.webview.postMessage({ command: 'ready' });
    
    SyncManager.registerPanel(panelName, panel);

    // Dispose previous listener if it exists to avoid multiple listeners on reused panel
    if ((panel as any)._messageListener) {
      (panel as any)._messageListener.dispose();
    }

    // Handle messages from webview (e.g., save PLY request, view sync)
    (panel as any)._messageListener = panel.webview.onDidReceiveMessage(
      async (message) => {
        if (message.command === "savePLY") {
          try {
            const plyData = generatePLYContent(points, message.format);
            const uri = await vscode.window.showSaveDialog({
              defaultUri: vscode.Uri.file(`${panelName}.ply`),
              filters: {
                "PLY Files": ["ply"],
                "All Files": ["*"]
              }
            });
            
            if (uri) {
              await vscode.workspace.fs.writeFile(uri, plyData);
              const formatLabel = message.format === 'ascii' ? 'ASCII' : 'Binary';
              vscode.window.showInformationMessage(`Point cloud saved to ${uri.fsPath} (${formatLabel} format)`);
            }
          } catch (error) {
            vscode.window.showErrorMessage(`Failed to save PLY file: ${error}`);
            console.error("Error saving PLY:", error);
          }
        } else if (message.command === 'viewChanged') {
          SyncManager.syncView(panelName, message.state);
        } else if (message.command === 'reload') {
          // Check if debug session is still active before reloading
          const currentSession = vscode.debug.activeDebugSession;
          if (currentSession && currentSession.id === debugSession.id) {
            await vscode.commands.executeCommand('cv-debugmate.viewVariable', { name: panelName, evaluateName: variableName, skipToken: true });
          } else {
            console.log('Skipping reload - debug session is no longer active or has changed');
          }
        }
      },
      undefined,
      undefined
    );

    // Send point cloud data via postMessage (better memory efficiency than embedding in HTML)
    console.log(`Sending ${points.length} points to webview via postMessage`);
    await panel.webview.postMessage({
      command: 'completeData',
      points: points
    });
  } catch (error) {
    console.error("Error in drawPointCloud:", error);
    throw error;
  }
}

// Get point cloud metadata only (size + dataPtr) without reading full data
// OPTIMIZED: Avoid calling "variables" request for large vectors (very slow for LLDB)
// Instead, use evaluate expressions directly to get data pointer
async function getPointCloudMetadata(
  debugSession: vscode.DebugSession,
  evaluateName: string,
  variableInfo?: any
): Promise<{ size: number; dataPtr: string | null }> {
  const frameId = variableInfo?.frameId || await getCurrentFrameId(debugSession);
  const context = getEvaluateContext(debugSession);
  
  console.log(`getPointCloudMetadata: evaluateName="${evaluateName}", frameId=${frameId}`);
  
  // Get vector size
  const size = await getVectorSize(debugSession, evaluateName, frameId, variableInfo);
  
  if (isNaN(size) || size <= 0) {
    console.log("Could not get vector size or size is 0");
    return { size: 0, dataPtr: null };
  }
  console.log(`Vector size: ${size}`);
  
  // Get data pointer using evaluate expressions only (avoid slow "variables" request)
  let dataPtr: string | null = null;
  
  if (isUsingMSVC(debugSession)) {
    const msvcExpressions = [
      `(long long)&${evaluateName}[0]`,
      `reinterpret_cast<long long>(&${evaluateName}[0])`,
      `(long long)${evaluateName}.data()`,
      `reinterpret_cast<long long>(${evaluateName}.data())`,
      `&(${evaluateName}.operator[](0))`
    ];
    dataPtr = await tryGetDataPointer(debugSession, evaluateName, msvcExpressions, frameId, context);
    
  } else if (isUsingLLDB(debugSession)) {
    // OPTIMIZATION: Skip "variables" request - it's extremely slow for large vectors
    // (e.g., 600,000 elements returns 186,650 variables, taking several seconds)
    // Use evaluate expressions directly instead
    const lldbExpressions = [
      `${evaluateName}.__begin_`,
      `reinterpret_cast<long long>(${evaluateName}.__begin_)`,
      `${evaluateName}.data()`,
      `reinterpret_cast<long long>(${evaluateName}.data())`,
      `&${evaluateName}[0]`,
      `reinterpret_cast<long long>(&${evaluateName}[0])`
    ];
    dataPtr = await tryGetDataPointer(debugSession, evaluateName, lldbExpressions, frameId, context);
    
  } else if (isUsingCppdbg(debugSession)) {
    const gdbExpressions = [
      `(long long)${evaluateName}._M_impl._M_start`,
      `reinterpret_cast<long long>(${evaluateName}._M_impl._M_start)`,
      `(long long)${evaluateName}.data()`,
      `reinterpret_cast<long long>(${evaluateName}.data())`,
      `(long long)&${evaluateName}[0]`
    ];
    dataPtr = await tryGetDataPointer(debugSession, evaluateName, gdbExpressions, frameId, context);
    
  } else {
    const fallbackExpressions = [
      `(long long)&${evaluateName}[0]`,
      `(long long)${evaluateName}._M_impl._M_start`,
      `(long long)${evaluateName}.__begin_`,
      `(long long)${evaluateName}.data()`,
      `reinterpret_cast<long long>(${evaluateName}.data())`
    ];
    dataPtr = await tryGetDataPointer(debugSession, evaluateName, fallbackExpressions, frameId, context);
  }
  
  console.log(`getPointCloudMetadata result: size=${size}, dataPtr=${dataPtr}`);
  return { size, dataPtr };
}

// Get point cloud data via readMemory (fast path for cppdbg/cppvsdbg)
export async function getPointCloudViaReadMemory(
  debugSession: vscode.DebugSession,
  evaluateName: string,
  variableInfo?: any,
  isDouble: boolean = false,
  progress?: vscode.Progress<{ message?: string; increment?: number }>
): Promise<{ points: { x: number; y: number; z: number }[], dataPtr: string | null }> {
  const points: { x: number; y: number; z: number }[] = [];
  // Use frameId from variableInfo if available, otherwise get current frame
  const frameId = variableInfo?.frameId || await getCurrentFrameId(debugSession);
  const context = getEvaluateContext(debugSession);
  
  if (progress) {
    progress.report({ message: "Getting vector info..." });
  }
  
  console.log(`getPointCloudViaReadMemory: evaluateName="${evaluateName}", frameId=${frameId}, context="${context}"`);
  
  // Get vector size using the common utility function
  const size = await getVectorSize(debugSession, evaluateName, frameId, variableInfo);
  
  if (isNaN(size) || size <= 0) {
    console.log("Could not get vector size or size is 0");
    return { points, dataPtr: null };
  }
  console.log(`Vector size: ${size}`);
  
  // Log debug info
  console.log(`Debug: Getting pointer for ${evaluateName}, debugger type: ${debugSession.type}`);
  
  // Get data pointer based on compiler/debugger type
  let dataPtr: string | null = null;
  
  if (isUsingMSVC(debugSession)) {
    // MSVC (cppvsdbg) approaches
    console.log("Using MSVC-specific approaches");
    const msvcExpressions = [
      `(long long)&${evaluateName}[0]`,
      `reinterpret_cast<long long>(&${evaluateName}[0])`,
      `(long long)${evaluateName}.data()`,
      `reinterpret_cast<long long>(${evaluateName}.data())`,
      `&(${evaluateName}.operator[](0))`
    ];
    dataPtr = await tryGetDataPointer(debugSession, evaluateName, msvcExpressions, frameId, context);
    
  } else if (isUsingLLDB(debugSession)) {
    // LLDB approaches
    // OPTIMIZATION: Skip "variables" request - it's extremely slow for large vectors
    // (e.g., 600,000 elements returns 186,650 variables, taking several seconds)
    // Use evaluate expressions directly instead
    console.log("Using LLDB-specific approaches (evaluate expressions only)");
    
    const lldbExpressions = [
      `${evaluateName}.__begin_`,                              // Get __begin_ value directly (returns pointer type)
      `reinterpret_cast<long long>(${evaluateName}.__begin_)`, // Try C++ style cast
      `${evaluateName}.data()`,                                // Try data() method
      `reinterpret_cast<long long>(${evaluateName}.data())`,   // Try data() with C++ cast
      `&${evaluateName}[0]`,                                    // Try address of first element
      `reinterpret_cast<long long>(&${evaluateName}[0])`       // Try address with C++ cast
    ];
    dataPtr = await tryGetDataPointer(debugSession, evaluateName, lldbExpressions, frameId, context);
    
  } else if (isUsingCppdbg(debugSession)) {
    // GDB (cppdbg) approaches
    console.log("Using GDB-specific approaches");
    const gdbExpressions = [
      `(long long)${evaluateName}._M_impl._M_start`,
      `reinterpret_cast<long long>(${evaluateName}._M_impl._M_start)`,
      `(long long)${evaluateName}.data()`,
      `reinterpret_cast<long long>(${evaluateName}.data())`,
      `(long long)&${evaluateName}[0]`
    ];
    dataPtr = await tryGetDataPointer(debugSession, evaluateName, gdbExpressions, frameId, context);
    
  } else {
    // Fallback: try all approaches
    console.log("Unknown debugger type, trying all approaches");
    const fallbackExpressions = [
      `(long long)&${evaluateName}[0]`,
      `(long long)${evaluateName}._M_impl._M_start`,
      `(long long)${evaluateName}.__begin_`,
      `(long long)${evaluateName}.data()`,
      `reinterpret_cast<long long>(${evaluateName}.data())`
    ];
    dataPtr = await tryGetDataPointer(debugSession, evaluateName, fallbackExpressions, frameId, context);
  }
  
  if (!dataPtr) {
    console.log("Could not extract data pointer with any approach");
    return { points, dataPtr: null };
  }
  
  // Read all points at once
  // Point3f = 3 floats = 12 bytes per point
  // Point3d = 3 doubles = 24 bytes per point
  const bytesPerPoint = isDouble ? 24 : 12;
  const totalBytes = size * bytesPerPoint;
  
  if (progress) {
    progress.report({ message: `Reading ${size} points (${Math.round(totalBytes / 1024 / 1024)}MB)...` });
  }
  
  console.log(`Reading ${size} points (${totalBytes} bytes, ${isDouble ? "Point3d" : "Point3f"}) from ${dataPtr}`);
  
  const buffer = await readMemoryChunked(debugSession, dataPtr, totalBytes, progress);
  
  if (progress) {
    progress.report({ message: "Processing point data..." });
  }
  
  if (buffer) {
    if (isDouble) {
      // Point3d: 3 doubles = 24 bytes per point
      for (let i = 0; i < size && i * 24 + 23 < buffer.length; i++) {
        const offset = i * 24;
        const x = buffer.readDoubleLE(offset);
        const y = buffer.readDoubleLE(offset + 8);
        const z = buffer.readDoubleLE(offset + 16);
        points.push({ x, y, z });
      }
    } else {
      // Point3f: 3 floats = 12 bytes per point
      for (let i = 0; i < size && i * 12 + 11 < buffer.length; i++) {
        const offset = i * 12;
        const x = buffer.readFloatLE(offset);
        const y = buffer.readFloatLE(offset + 4);
        const z = buffer.readFloatLE(offset + 8);
        points.push({ x, y, z });
      }
    }
    
    console.log(`Loaded ${points.length} points via readMemory`);
  }
  
  return { points, dataPtr };
}

// ============== std::array<Point3f/d> Support ==============

/**
 * Draw point cloud from std::array<cv::Point3f> or std::array<cv::Point3d>
 */
export async function drawStdArrayPointCloud(
  debugSession: vscode.DebugSession,
  variableInfo: any,
  variableName: string,
  size: number,
  isDouble: boolean = false,
  reveal: boolean = true,
  force: boolean = false,
  panelVariableName?: string
) {
  // Use panelVariableName for panel management, variableName for data access
  const panelName = panelVariableName || variableName;
  
  try {
    console.log(`Drawing std::array point cloud: ${variableName}, size=${size}, isDouble=${isDouble}`);

    const panelTitle = `View: ${panelName}`;
    const bytesPerPoint = isDouble ? 24 : 12; // Point3d: 3*8=24, Point3f: 3*4=12

    // Wrap entire operation in progress indicator for immediate feedback
    const result = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "Loading std::array Point Cloud",
        cancellable: false
      },
      async (progress) => {
        // Get frame ID
        progress.report({ message: "Getting metadata..." });
        const frameId = variableInfo?.frameId || await getCurrentFrameId(debugSession);

        // Get data pointer
        const dataPtr = await getStdArrayDataPointer(debugSession, variableName, frameId, variableInfo);

        // Get or create panel
        const panel = PanelManager.getOrCreatePanel(
          "3DPointViewer",
          panelTitle,
          debugSession.id,
          panelName,
          reveal,
          dataPtr || undefined  // Enable sharing panels by data pointer
        );

        // Check if panel is fresh
        if (!force && dataPtr && size > 0) {
          progress.report({ message: "Checking if data changed..." });
          const totalBytes = size * bytesPerPoint;
          const sample = await getMemorySample(debugSession, dataPtr, totalBytes);
          const stateToken = `${size}|${dataPtr}|${sample}`;
          
          if (PanelManager.isPanelFresh("3DPointViewer", debugSession.id, panelName, stateToken)) {
            console.log(`std::array PointCloud panel is already up-to-date`);
            return { panel, points: [], dataPtrForToken: dataPtr || "", skipped: true };
          }
        }

        // Read point cloud data
        let points: { x: number; y: number; z: number }[] = [];

        if (dataPtr && size > 0) {
          const totalBytes = size * bytesPerPoint;
          console.log(`Reading ${size} points (${totalBytes} bytes) from ${dataPtr}`);
          
          progress.report({ message: `Reading ${size} points...` });
          
          const buffer = await readMemoryChunked(debugSession, dataPtr!, totalBytes, progress);
          
          if (buffer) {
            progress.report({ message: "Processing point data..." });
            
            if (isDouble) {
              // Point3d: 3 doubles = 24 bytes per point
              for (let i = 0; i < size && i * 24 + 23 < buffer.length; i++) {
                const offset = i * 24;
                const x = buffer.readDoubleLE(offset);
                const y = buffer.readDoubleLE(offset + 8);
                const z = buffer.readDoubleLE(offset + 16);
                points.push({ x, y, z });
              }
            } else {
              // Point3f: 3 floats = 12 bytes per point
              for (let i = 0; i < size && i * 12 + 11 < buffer.length; i++) {
                const offset = i * 12;
                const x = buffer.readFloatLE(offset);
                const y = buffer.readFloatLE(offset + 4);
                const z = buffer.readFloatLE(offset + 8);
                points.push({ x, y, z });
              }
            }
            console.log(`Loaded ${points.length} points from std::array via readMemory`);
          }
        }

        return { panel, points, dataPtrForToken: dataPtr || "", skipped: false };
      }
    );

    // If skipped (panel was fresh), we're done
    if (result.skipped) {
      return;
    }

    const { panel, points, dataPtrForToken } = result;

    if (points.length === 0) {
      vscode.window.showWarningMessage("No points found in the std::array. Make sure it's not empty.");
      return;
    }

    // Update state token
    const totalBytes = points.length * bytesPerPoint;
    const sample = dataPtrForToken ? await getMemorySample(debugSession, dataPtrForToken, totalBytes) : "";
    const stateToken = `${points.length}|${dataPtrForToken}|${sample}`;
    PanelManager.updateStateToken("3DPointViewer", debugSession.id, panelName, stateToken);

    // If panel already has content, only send data
    if (panel.webview.html && panel.webview.html.length > 0) {
      console.log("std::array PointCloud panel already has HTML, sending only data");
      await panel.webview.postMessage({
        command: 'updateData',
        points: points
      });
      return;
    }

    // Set HTML without embedding data (data will be sent via postMessage)
    panel.webview.html = getWebviewContentForPointCloud();
    
    // Send ready signal immediately so webview knows this is not a moved panel
    panel.webview.postMessage({ command: 'ready' });
    
    SyncManager.registerPanel(panelName, panel);

    // Dispose previous listener
    if ((panel as any)._messageListener) {
      (panel as any)._messageListener.dispose();
    }

    // Handle messages from webview
    (panel as any)._messageListener = panel.webview.onDidReceiveMessage(
      async (message) => {
        if (message.command === "savePLY") {
          try {
            const plyData = generatePLYContent(points, message.format);
            const uri = await vscode.window.showSaveDialog({
              defaultUri: vscode.Uri.file(`${panelName}.ply`),
              filters: {
                "PLY Files": ["ply"],
                "All Files": ["*"]
              }
            });
            
            if (uri) {
              await vscode.workspace.fs.writeFile(uri, plyData);
              const formatLabel = message.format === 'ascii' ? 'ASCII' : 'Binary';
              vscode.window.showInformationMessage(`Point cloud saved to ${uri.fsPath} (${formatLabel} format)`);
            }
          } catch (error) {
            vscode.window.showErrorMessage(`Failed to save PLY file: ${error}`);
            console.error("Error saving PLY:", error);
          }
        } else if (message.command === 'viewChanged') {
          SyncManager.syncView(panelName, message.state);
        } else if (message.command === 'reload') {
          // Check if debug session is still active before reloading
          const currentSession = vscode.debug.activeDebugSession;
          if (currentSession && currentSession.id === debugSession.id) {
            await vscode.commands.executeCommand('cv-debugmate.viewVariable', { name: panelName, evaluateName: variableName, skipToken: true });
          } else {
            console.log('Skipping reload - debug session is no longer active or has changed');
          }
        }
      },
      undefined,
      undefined
    );

    // Send point cloud data via postMessage (better memory efficiency than embedding in HTML)
    console.log(`Sending ${points.length} points to webview via postMessage`);
    await panel.webview.postMessage({
      command: 'completeData',
      points: points
    });
  } catch (error) {
    console.error("Error in drawStdArrayPointCloud:", error);
    throw error;
  }
}

