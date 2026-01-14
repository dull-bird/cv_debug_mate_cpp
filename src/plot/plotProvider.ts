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
  getStdArrayDataPointer,
  getCStyle1DArrayDataPointer
} from "../utils/debugger";
import { getWebviewContentForPlot } from "./plotWebview";
import { PanelManager } from "../utils/panelManager";
import { SyncManager } from "../utils/syncManager";
import * as fs from 'fs';
import { getMatInfoFromVariables } from "../matImage/matProvider";
import { getBytesPerElement, is1DStdArray } from "../utils/opencv";

/**
 * Helper to detect 1D std::array from type string and extract info
 */
function parse1DStdArrayFromType(type: string): { is1DArray: boolean; elementType: string; size: number } {
  // Match patterns like std::array<int, 10>, std::__1::array<float, 100>
  // But NOT 2D arrays (std::array<std::array<...>>)
  if (/std::(?:__1::)?array\s*<\s*(?:class\s+)?std::(?:__1::)?array/.test(type)) {
    return { is1DArray: false, elementType: "", size: 0 };
  }
  
  // Match 1D array pattern
  const pattern1D = /std::(?:__1::)?array\s*<\s*([^,>]+?)\s*,\s*(\d+)\s*>/;
  const match = type.match(pattern1D);
  
  if (match) {
    const elementType = match[1].trim();
    const size = parseInt(match[2]);
    return { is1DArray: true, elementType, size };
  }
  
  return { is1DArray: false, elementType: "", size: 0 };
}

export async function drawPlot(
  debugSession: vscode.DebugSession,
  variableName: string,
  elementTypeOrMat: string | { rows: number, cols: number, channels: number, depth: number, dataPtr: string },
  reveal: boolean = true,
  force: boolean = false,
  variableInfo?: any,
  isSet: boolean = false,
  panelVariableName?: string
) {
  // Use panelVariableName for panel management, variableName for data access
  const panelName = panelVariableName || variableName;
  
  // Check if there's an existing panel that's being disposed - if so, abort immediately
  const existingPanel = PanelManager.getPanel("CurvePlotViewer", debugSession.id, panelName);
  if (existingPanel && (existingPanel as any)._isDisposing) {
    console.log(`[drawPlot] Aborting - panel for ${panelName} is being disposed`);
    return;
  }
  
  try {
    const panelTitle = `View: ${panelName}`;

    // Wrap entire operation in progress indicator for immediate feedback
    const result = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "Loading Plot Data",
        cancellable: false
      },
      async (progress) => {
        // Step 1: Get metadata only (size + dataPtr) without reading full data
        progress.report({ message: "Getting metadata..." });
        let metadata: { size: number; dataPtr: string | null; bytesPerElement: number } = { size: 0, dataPtr: null, bytesPerElement: 4 };
        
        if (typeof elementTypeOrMat === 'string') {
            if (isSet) {
                // For sets, we can only get size (no contiguous memory)
                const frameId = variableInfo?.frameId || await getCurrentFrameId(debugSession);
                const size = await getVectorSize(debugSession, variableName, frameId, variableInfo);
                metadata = { size, dataPtr: null, bytesPerElement: 4 };
            } else {
                // For vectors, get size and dataPtr
                const result = await getVectorMetadata(debugSession, variableName, elementTypeOrMat, variableInfo);
                metadata = result;
            }
        } else {
            // For 1D Mat, we already have the info
            metadata = {
                size: elementTypeOrMat.rows * elementTypeOrMat.cols,
                dataPtr: elementTypeOrMat.dataPtr,
                bytesPerElement: getBytesPerElement(elementTypeOrMat.depth)
            };
        }

        // Step 2: Get or create panel (will reveal if needed)
        const panel = PanelManager.getOrCreatePanel(
          "CurvePlotViewer",
          panelTitle,
          debugSession.id,
          panelName,
          reveal,
          metadata.dataPtr || undefined  // Enable sharing panels by data pointer
        );

        // Step 3: Check if panel is fresh (only when not force)
        if (!force && metadata.size > 0) {
            progress.report({ message: "Checking if data changed..." });
            const totalBytes = metadata.size * metadata.bytesPerElement;
            const sample = metadata.dataPtr ? await getMemorySample(debugSession, metadata.dataPtr, totalBytes) : "";
            // For sets without dataPtr, use size-only token (less accurate but still useful)
            const stateToken = metadata.dataPtr 
                ? `${metadata.size}|${metadata.dataPtr}|${sample}`
                : `set:${metadata.size}`;
            
            if (PanelManager.isPanelFresh("CurvePlotViewer", debugSession.id, panelName, stateToken)) {
                console.log(`Plot panel is already up-to-date with token: ${stateToken}`);
                return { panel, initialData: null, dataPtrForToken: "", skipped: true };
            }
        }

        // Step 4: Now read full data since we need to update
        let initialData: number[] | null = null;
        let dataPtrForToken = "";
        
        if (typeof elementTypeOrMat === 'string') {
            if (isSet) {
                console.log(`Drawing plot for set: ${variableName}, element type: ${elementTypeOrMat}`);
                progress.report({ message: "Reading set data..." });
                const result = await readSetDataInternal(debugSession, variableName, elementTypeOrMat, variableInfo, progress);
                if (result) {
                    initialData = result.data;
                    dataPtrForToken = `set:${result.data.length}`;
                }
            } else {
                console.log(`Drawing plot for vector: ${variableName}, element type: ${elementTypeOrMat}`);
                progress.report({ message: "Reading vector data..." });
                const result = await readVectorDataInternal(debugSession, variableName, elementTypeOrMat, undefined, variableInfo, progress);
                if (result) {
                    initialData = result.data;
                    dataPtrForToken = result.dataPtr || "";
                }
            }
        } else {
            console.log(`Drawing plot for 1D Mat: ${variableName}, info:`, elementTypeOrMat);
            progress.report({ message: "Reading Mat data..." });
            const data = await readMatDataInternal(debugSession, variableName, elementTypeOrMat, progress);
            if (data) {
                initialData = data;
                dataPtrForToken = elementTypeOrMat.dataPtr || "";
            }
        }

        return { panel, initialData, dataPtrForToken, skipped: false };
      }
    );

    // If skipped (panel was fresh), we're done
    if (result.skipped) {
      return;
    }

    const { panel, initialData, dataPtrForToken } = result;

    if (!initialData) return;

    // Update state token with actual data
    let totalBytes = initialData.length * 4;
    if (typeof elementTypeOrMat !== 'string') {
        totalBytes = initialData.length * getBytesPerElement(elementTypeOrMat.depth);
    }
    const sample = dataPtrForToken && !dataPtrForToken.startsWith('set:') 
        ? await getMemorySample(debugSession, dataPtrForToken, totalBytes) 
        : "";
    const stateToken = dataPtrForToken.startsWith('set:')
        ? dataPtrForToken
        : `${initialData.length}|${dataPtrForToken}|${sample}`;
    PanelManager.updateStateToken("CurvePlotViewer", debugSession.id, panelName, stateToken);

    // If panel already has content, only send data to preserve view state
    if (panel.webview.html && panel.webview.html.length > 0) {
      console.log("Plot panel already has HTML, sending only data");
      
      // Check if panel is being disposed before sending data
      if ((panel as any)._isDisposing) {
        console.log("[drawPlot] Aborting data send - panel is being disposed");
        return;
      }
      
      // CRITICAL: Don't await postMessage - it can block and cause debug freeze
      try {
        // Fire and forget - don't await
        panel.webview.postMessage({
          command: 'updateInitialData',
          data: initialData
        });
      } catch (e) {
        console.log("[drawPlot] postMessage failed - panel likely disposed");
        return;
      }
      
      // Restore saved view state if available
      const savedState = SyncManager.getSavedState(panelName);
      if (savedState && !(panel as any)._isDisposing) {
        console.log("Restoring saved plot view state:", savedState);
        setTimeout(() => {
          if (!(panel as any)._isDisposing) {
            try {
              panel.webview.postMessage({
                command: 'setView',
                state: savedState
              });
            } catch (e) {}
          }
        }, 100);
      }
      return;
    }

    // Set HTML without embedding data (data will be sent via postMessage)
    panel.webview.html = getWebviewContentForPlot(panelName);
    
    // Send ready signal immediately so webview knows this is not a moved panel
    panel.webview.postMessage({ command: 'ready' });
    
    // Register panel with SyncManager for view state persistence
    SyncManager.registerPanel(panelName, panel);

    // Dispose old listener to avoid duplicates
    if ((panel as any)._messageListener) {
        (panel as any)._messageListener.dispose();
    }

    (panel as any)._messageListener = panel.webview.onDidReceiveMessage(async (message) => {
        if (message.command === 'requestOptions') {
            const variables = await vscode.commands.executeCommand<any[]>('cv-debugmate.getVariables');
            if (variables) {
                const currentSize = initialData.length;
                const frameId = await getCurrentFrameId(debugSession);
                const context = getEvaluateContext(debugSession);
                
                const validOptions: string[] = [];
                
                // Use Promise.all to speed up size evaluations
                const sizePromises = variables
                    .filter(v => v.kind === 'plot')
                    .map(async (v) => {
                        try {
                            // If size is already known and non-zero, use it
                            if (v.size && v.size > 0) {
                                if (v.size === currentSize) return v.name;
                                return null;
                            }

                            // Otherwise evaluate once
                            let evalSize = 0;
                            const arrayInfo = parse1DStdArrayFromType(v.type);
                            
                            if (v.type.includes("cv::Mat")) {
                                const matSizeResp = await debugSession.customRequest("evaluate", {
                                    expression: `(int)${v.evaluateName}.rows * (int)${v.evaluateName}.cols`,
                                    frameId: frameId,
                                    context: context
                                });
                                evalSize = parseInt(matSizeResp.result);
                            } else if (arrayInfo.is1DArray) {
                                // std::array size is known from type
                                evalSize = arrayInfo.size;
                            } else {
                                const sizeResp = await debugSession.customRequest("evaluate", {
                                    expression: `(int)${v.evaluateName}.size()`,
                                    frameId: frameId,
                                    context: context
                                });
                                evalSize = parseInt(sizeResp.result);
                            }
                            
                            if (evalSize === currentSize) {
                                return v.name;
                            }
                        } catch (e) {
                            return null;
                        }
                        return null;
                    });
                
                const results = await Promise.all(sizePromises);
                results.forEach(name => {
                    if (name && name !== variableName) {
                        validOptions.push(name);
                    }
                });

                panel.webview.postMessage({ command: 'updateOptions', options: validOptions });
            }
        } else if (message.command === 'requestData') {
            const variables = await vscode.commands.executeCommand<any[]>('cv-debugmate.getVariables');
            const targetVar = variables?.find(v => v.name === message.name);
            if (targetVar) {
                let newData: number[] | null = null;
                const arrayInfo = parse1DStdArrayFromType(targetVar.type);
                
                if (targetVar.type.includes("cv::Mat")) {
                    const frameId = await getCurrentFrameId(debugSession);
                    const matInfo = await getMatInfoFromVariables(debugSession, targetVar.variablesReference);
                    newData = await readMatDataInternal(debugSession, targetVar.evaluateName, matInfo);
                } else if (arrayInfo.is1DArray) {
                    // Handle std::array types
                    const result = await read1DStdArrayData(debugSession, targetVar.evaluateName, arrayInfo.elementType, arrayInfo.size, targetVar);
                    newData = result ? result.data : null;
                } else {
                    // Pass targetVar as variableInfo to support LLDB size detection
                    const result = await readVectorDataInternal(debugSession, targetVar.evaluateName, targetVar.type, initialData!.length, targetVar);
                    newData = result ? result.data : null;
                }
                
                if (newData) {
                    if ((panel as any)._isDisposing) return;
                    try {
                        panel.webview.postMessage({ 
                            command: 'updateData', 
                            target: message.target, 
                            data: newData, 
                            name: message.name 
                        });
                    } catch (e) {
                        console.log("[drawPlot] updateData postMessage failed - panel likely disposed");
                    }
                }
            }
        } else if (message.command === 'reload') {
            // Check if debug session is still active before reloading
            const currentSession = vscode.debug.activeDebugSession;
            if (currentSession && currentSession.id === debugSession.id && !(panel as any)._isDisposing) {
                // CRITICAL: Fire-and-forget - don't await to avoid blocking
                Promise.resolve(vscode.commands.executeCommand('cv-debugmate.viewVariable', { name: variableName, evaluateName: variableName, skipToken: true }))
                    .then(() => console.log(`[DEBUG-TRACE] Plot reload completed`))
                    .catch((e: Error) => console.log(`[DEBUG-TRACE] Plot reload failed:`, e));
            } else {
                console.log('Skipping reload - debug session is no longer active or has changed');
            }
        } else if (message.command === 'viewChanged') {
            // Save view state for persistence across tab switches
            SyncManager.syncView(panelName, message.state);
        } else if (message.command === 'saveFile') {
            const options: vscode.SaveDialogOptions = {
                defaultUri: vscode.Uri.file(message.defaultName),
                filters: message.type === 'png' ? { 'Images': ['png'] } : { 'Data': ['csv'] }
            };

            const fileUri = await vscode.window.showSaveDialog(options);
            if (fileUri) {
                if (message.type === 'png') {
                    const base64Data = message.data.replace(/^data:image\/png;base64,/, "");
                    fs.writeFileSync(fileUri.fsPath, base64Data, 'base64');
                } else {
                    fs.writeFileSync(fileUri.fsPath, message.data);
                }
                vscode.window.showInformationMessage(`File saved to ${fileUri.fsPath}`);
            }
        }
    });

    // Send plot data via postMessage (better memory efficiency than embedding in HTML)
    console.log(`Sending ${initialData.length} data points to webview via postMessage`);
    
    // CRITICAL: Don't await postMessage - it can block and cause debug freeze
    if ((panel as any)._isDisposing) {
      console.log("[drawPlot] Aborting final data send - panel is being disposed");
      return;
    }
    
    try {
      // Fire and forget - don't await
      panel.webview.postMessage({
        command: 'completeData',
        data: initialData
      });
    } catch (e) {
      console.log("[drawPlot] Final postMessage failed - panel likely disposed");
      return;
    }

  } catch (error: any) {
    vscode.window.showErrorMessage(`Failed to draw plot: ${error.message}`);
    console.error(error);
  }
}

// Get vector metadata only (size + dataPtr) without reading full data
async function getVectorMetadata(
    debugSession: vscode.DebugSession,
    variableName: string,
    type: string,
    variableInfo?: any
): Promise<{ size: number; dataPtr: string | null; bytesPerElement: number }> {
    const frameId = variableInfo?.frameId || await getCurrentFrameId(debugSession);
    const context = getEvaluateContext(debugSession);

    console.log(`getVectorMetadata: variableName="${variableName}", type="${type}"`);

    // Check if it's actually a Mat
    if (type.includes("cv::Mat")) {
        return { size: 0, dataPtr: null, bytesPerElement: 4 };
    }

    // Get vector size
    const size = await getVectorSize(debugSession, variableName, frameId, variableInfo);
    if (isNaN(size) || size <= 0) {
        return { size: 0, dataPtr: null, bytesPerElement: 4 };
    }

    // Determine bytes per element from type
    let bytesPerElement = 4;
    const typeLower = type.toLowerCase();
    if (typeLower.includes("double")) {
        bytesPerElement = 8;
    } else if (typeLower.includes("float")) {
        bytesPerElement = 4;
    } else if (typeLower.includes("unsigned char") || typeLower.includes("uchar") || typeLower.includes("uint8_t")) {
        bytesPerElement = 1;
    } else if (typeLower.includes("char") || typeLower.includes("int8_t")) {
        bytesPerElement = 1;
    } else if (typeLower.includes("unsigned short") || typeLower.includes("ushort") || typeLower.includes("uint16_t")) {
        bytesPerElement = 2;
    } else if (typeLower.includes("short") || typeLower.includes("int16_t")) {
        bytesPerElement = 2;
    } else if (typeLower.includes("unsigned long long") || typeLower.includes("uint64_t") || 
               typeLower.includes("long long") || typeLower.includes("int64_t")) {
        bytesPerElement = 8;
    }

    // Get data pointer
    let dataPtr: string | null = null;
    
    if (isUsingLLDB(debugSession)) {
        // OPTIMIZATION: Skip "variables" request - it's extremely slow for large vectors
        // Use evaluate expressions directly instead
        const lldbExpressions = [
            `${variableName}.__begin_`,
            `reinterpret_cast<long long>(${variableName}.__begin_)`,
            `${variableName}.data()`,
            `reinterpret_cast<long long>(${variableName}.data())`,
            `&${variableName}[0]`,
            `reinterpret_cast<long long>(&${variableName}[0])`
        ];
        dataPtr = await tryGetDataPointer(debugSession, variableName, lldbExpressions, frameId, context);
        
    } else if (isUsingMSVC(debugSession)) {
        const msvcExpressions = [
            `(long long)&${variableName}[0]`,
            `reinterpret_cast<long long>(&${variableName}[0])`,
            `(long long)${variableName}.data()`,
            `reinterpret_cast<long long>(${variableName}.data())`
        ];
        dataPtr = await tryGetDataPointer(debugSession, variableName, msvcExpressions, frameId, context);
        
    } else if (isUsingCppdbg(debugSession)) {
        const gdbExpressions = [
            `(long long)${variableName}._M_impl._M_start`,
            `reinterpret_cast<long long>(${variableName}._M_impl._M_start)`,
            `(long long)${variableName}.data()`,
            `reinterpret_cast<long long>(${variableName}.data())`,
            `(long long)&${variableName}[0]`
        ];
        dataPtr = await tryGetDataPointer(debugSession, variableName, gdbExpressions, frameId, context);
        
    } else {
        const ptrExprs = [
            `${variableName}.data()`, 
            `&${variableName}[0]`, 
            `(void*)${variableName}.data()`,
            `(void*)&${variableName}[0]`
        ];
        dataPtr = await tryGetDataPointer(debugSession, variableName, ptrExprs, frameId, context);
    }

    console.log(`getVectorMetadata result: size=${size}, dataPtr=${dataPtr}, bytesPerElement=${bytesPerElement}`);
    return { size, dataPtr, bytesPerElement };
}

async function readMatDataInternal(
    debugSession: vscode.DebugSession,
    variableName: string,
    matInfo: { rows: number, cols: number, channels: number, depth: number, dataPtr: string },
    progress?: vscode.Progress<{ message?: string; increment?: number }>
): Promise<number[] | null> {
    const size = matInfo.rows * matInfo.cols;
    const bytesPerElement = getBytesPerElement(matInfo.depth);
    const totalBytes = size * bytesPerElement;
    
    if (progress) {
        progress.report({ message: `Reading ${size} elements (${Math.round(totalBytes / 1024)}KB)...` });
    }
    
    const buffer = await readMemoryChunked(debugSession, matInfo.dataPtr, totalBytes, progress);
    if (!buffer) return null;

    if (progress) {
        progress.report({ message: "Processing data..." });
    }
    
    const data: number[] = [];
    const depth = matInfo.depth;
    
    for (let i = 0; i < size; i++) {
        const offset = i * bytesPerElement;
        let val: number = 0;
        switch (depth) {
            case 0: val = buffer.readUInt8(offset); break;
            case 1: val = buffer.readInt8(offset); break;
            case 2: val = buffer.readUInt16LE(offset); break;
            case 3: val = buffer.readInt16LE(offset); break;
            case 4: val = buffer.readInt32LE(offset); break;
            case 5: val = buffer.readFloatLE(offset); break;
            case 6: val = buffer.readDoubleLE(offset); break;
        }
        data.push(val);
    }
    return data;
}

async function readVectorDataInternal(
    debugSession: vscode.DebugSession,
    variableName: string,
    type: string,
    expectedSize?: number,
    variableInfo?: any,
    progress?: vscode.Progress<{ message?: string; increment?: number }>
): Promise<{ data: number[], dataPtr: string | null } | null> {
    const frameId = variableInfo?.frameId || await getCurrentFrameId(debugSession);
    const context = getEvaluateContext(debugSession);

    console.log(`readVectorDataInternal: variableName="${variableName}", type="${type}", debugger=${debugSession.type}`);

    // Check if it's actually a Mat (for X axis selection or similar)
    if (type.includes("cv::Mat")) {
        // This is a bit tricky, we'd need matInfo here. 
        // For now let's focus on the initial plot.
        return null;
    }

    if (progress) {
        progress.report({ message: "Getting vector info..." });
    }

    // 1. Get vector size using the common utility function
    const size = await getVectorSize(debugSession, variableName, frameId, variableInfo);

    if (isNaN(size) || size <= 0) {
      vscode.window.showWarningMessage(`Vector ${variableName} is empty or size could not be determined.`);
      return null;
    }

    if (expectedSize !== undefined && size !== expectedSize) {
        vscode.window.showErrorMessage(`Vector size mismatch: ${size} vs ${expectedSize}`);
        return null;
    }

    // 2. Determine element size and read function
    let bytesPerElement = 4;
    let readMethod: (buffer: Buffer, offset: number) => number = (b, o) => b.readFloatLE(o);

    const typeLower = type.toLowerCase();
    if (typeLower.includes("double")) {
        bytesPerElement = 8;
        readMethod = (b, o) => b.readDoubleLE(o);
    } else if (typeLower.includes("float")) {
        bytesPerElement = 4;
        readMethod = (b, o) => b.readFloatLE(o);
    } else if (typeLower.includes("unsigned char") || typeLower.includes("uchar") || typeLower.includes("uint8_t")) {
        bytesPerElement = 1;
        readMethod = (b, o) => b.readUInt8(o);
    } else if (typeLower.includes("char") || typeLower.includes("int8_t")) {
        bytesPerElement = 1;
        readMethod = (b, o) => b.readInt8(o);
    } else if (typeLower.includes("unsigned short") || typeLower.includes("ushort") || typeLower.includes("uint16_t")) {
        bytesPerElement = 2;
        readMethod = (b, o) => b.readUInt16LE(o);
    } else if (typeLower.includes("short") || typeLower.includes("int16_t")) {
        bytesPerElement = 2;
        readMethod = (b, o) => b.readInt16LE(o);
    } else if (typeLower.includes("unsigned int") || typeLower.includes("uint32_t")) {
        bytesPerElement = 4;
        readMethod = (b, o) => b.readUInt32LE(o);
    } else if (typeLower.includes("int") || typeLower.includes("int32_t")) {
        bytesPerElement = 4;
        readMethod = (b, o) => b.readInt32LE(o);
    } else if (typeLower.includes("unsigned long long") || typeLower.includes("uint64_t")) {
        bytesPerElement = 8;
        readMethod = (b, o) => Number(b.readBigUInt64LE(o));
    } else if (typeLower.includes("long long") || typeLower.includes("int64_t")) {
        bytesPerElement = 8;
        readMethod = (b, o) => Number(b.readBigInt64LE(o));
    } else if (typeLower.includes("unsigned long")) {
        bytesPerElement = 4;
        readMethod = (b, o) => b.readUInt32LE(o);
    } else if (typeLower.includes("long")) {
        bytesPerElement = 4;
        readMethod = (b, o) => b.readInt32LE(o);
    }

    // 3. Get data pointer - with special handling for different debuggers
    let dataPtr: string | null = null;
    
    if (isUsingLLDB(debugSession)) {
        // OPTIMIZATION: Skip "variables" request - it's extremely slow for large vectors
        // (e.g., 100,000 elements returns many variables, taking several seconds)
        // Use evaluate expressions directly instead
        console.log("Using LLDB-specific approaches for 1D vector (evaluate expressions only)");
        
        const lldbExpressions = [
            `${variableName}.__begin_`,
            `reinterpret_cast<long long>(${variableName}.__begin_)`,
            `${variableName}.data()`,
            `reinterpret_cast<long long>(${variableName}.data())`,
            `&${variableName}[0]`,
            `reinterpret_cast<long long>(&${variableName}[0])`
        ];
        dataPtr = await tryGetDataPointer(debugSession, variableName, lldbExpressions, frameId, context);
        
    } else if (isUsingMSVC(debugSession)) {
        console.log("Using MSVC-specific approaches for 1D vector");
        const msvcExpressions = [
            `(long long)&${variableName}[0]`,
            `reinterpret_cast<long long>(&${variableName}[0])`,
            `(long long)${variableName}.data()`,
            `reinterpret_cast<long long>(${variableName}.data())`
        ];
        dataPtr = await tryGetDataPointer(debugSession, variableName, msvcExpressions, frameId, context);
        
    } else if (isUsingCppdbg(debugSession)) {
        console.log("Using GDB-specific approaches for 1D vector");
        const gdbExpressions = [
            `(long long)${variableName}._M_impl._M_start`,
            `reinterpret_cast<long long>(${variableName}._M_impl._M_start)`,
            `(long long)${variableName}.data()`,
            `reinterpret_cast<long long>(${variableName}.data())`,
            `(long long)&${variableName}[0]`
        ];
        dataPtr = await tryGetDataPointer(debugSession, variableName, gdbExpressions, frameId, context);
        
    } else {
        // Fallback: try all approaches
        console.log("Unknown debugger type, trying generic approaches");
        const ptrExprs = [
            `${variableName}.data()`, 
            `&${variableName}[0]`, 
            `(void*)${variableName}.data()`,
            `(void*)&${variableName}[0]`
        ];
        dataPtr = await tryGetDataPointer(debugSession, variableName, ptrExprs, frameId, context);
    }

    if (!dataPtr) {
        vscode.window.showErrorMessage(`Could not get data pointer for vector ${variableName}.`);
        return null;
    }

    // 4. Read memory
    const totalBytes = size * bytesPerElement;
    
    if (progress) {
        progress.report({ message: `Reading ${size} elements (${Math.round(totalBytes / 1024)}KB)...` });
    }
    
    console.log(`Reading ${size} elements (${totalBytes} bytes) from ${dataPtr}`);
    const buffer = await readMemoryChunked(debugSession, dataPtr, totalBytes, progress);

    if (!buffer) {
        vscode.window.showErrorMessage(`Failed to read memory for vector ${variableName}.`);
        return null;
    }

    if (progress) {
        progress.report({ message: "Processing data..." });
    }

    // 5. Convert to numbers
    const data: number[] = [];
    for (let i = 0; i < size; i++) {
        data.push(readMethod(buffer, i * bytesPerElement));
    }
    console.log(`Successfully read ${data.length} elements`);
    return { data, dataPtr };
}

// Read data from std::set by iterating through elements via variablesReference
// Set is a red-black tree, so we cannot use contiguous memory reading
async function readSetDataInternal(
    debugSession: vscode.DebugSession,
    variableName: string,
    type: string,
    variableInfo?: any,
    progress?: vscode.Progress<{ message?: string; increment?: number }>
): Promise<{ data: number[] } | null> {
    const frameId = variableInfo?.frameId || await getCurrentFrameId(debugSession);
    const context = getEvaluateContext(debugSession);

    console.log(`readSetDataInternal: variableName="${variableName}", type="${type}", debugger=${debugSession.type}`);

    if (progress) {
        progress.report({ message: "Getting set info..." });
    }

    // 1. Get set size
    const size = await getVectorSize(debugSession, variableName, frameId, variableInfo);

    if (isNaN(size) || size <= 0) {
        vscode.window.showWarningMessage(`Set ${variableName} is empty or size could not be determined.`);
        return null;
    }

    console.log(`Set size: ${size}`);

    // 2. Determine parse function based on element type
    const typeLower = type.toLowerCase();
    let parseValue: (val: string) => number;
    
    if (typeLower.includes("double")) {
        parseValue = (val) => parseFloat(val);
    } else if (typeLower.includes("float")) {
        parseValue = (val) => parseFloat(val);
    } else {
        parseValue = (val) => parseInt(val);
    }

    if (progress) {
        progress.report({ message: `Reading ${size} set elements...` });
    }

    // 3. Read elements via variablesReference
    const data: number[] = [];
    
    if (variableInfo && variableInfo.variablesReference > 0) {
        try {
            const varsResponse = await debugSession.customRequest("variables", {
                variablesReference: variableInfo.variablesReference
            });
            
            if (varsResponse.variables && varsResponse.variables.length > 0) {
                console.log(`Found ${varsResponse.variables.length} variables in set`);
                
                for (const v of varsResponse.variables) {
                    // Skip internal implementation details
                    if (v.name.startsWith('_') || v.name.startsWith('__')) continue;
                    
                    // Check if it's an indexed element [0], [1], etc.
                    if (v.name.match(/^\[\d+\]$/)) {
                        const val = parseValue(v.value);
                        if (!isNaN(val)) {
                            data.push(val);
                        }
                    }
                }
                
                // If no indexed elements found, try to parse all numeric values
                if (data.length === 0) {
                    for (const v of varsResponse.variables) {
                        if (v.name.startsWith('_') || v.name.startsWith('__')) continue;
                        const val = parseValue(v.value);
                        if (!isNaN(val)) {
                            data.push(val);
                        }
                    }
                }
            }
        } catch (e) {
            console.log("Failed to read set elements via variablesReference:", e);
        }
    }

    // 4. If variablesReference approach didn't work or returned fewer elements,
    // try to evaluate elements one by one (slower but more reliable)
    if (data.length < size && data.length < 1000) {
        console.log(`Only got ${data.length} elements from variablesReference, trying evaluate approach`);
        
        // For std::set, we need to iterate. Try using *std::next or evaluate each index
        // This is a fallback and may not work on all debuggers
        try {
            // Try to get begin iterator and iterate
            const beginExpr = `*${variableName}.begin()`;
            const beginResp = await debugSession.customRequest("evaluate", {
                expression: beginExpr,
                frameId: frameId,
                context: context
            });
            
            if (beginResp && beginResp.result) {
                const firstVal = parseValue(beginResp.result);
                if (!isNaN(firstVal) && data.length === 0) {
                    data.push(firstVal);
                }
            }
        } catch (e) {
            console.log("Evaluate approach for set also failed:", e);
        }
    }

    if (data.length === 0) {
        vscode.window.showErrorMessage(`Failed to read elements from set ${variableName}.`);
        return null;
    }

    // Sort the data since set is ordered
    data.sort((a, b) => a - b);

    console.log(`Successfully read ${data.length} elements from set`);
    return { data };
}

// ============== std::array Support ==============

/**
 * Read data from 1D std::array
 */
export async function read1DStdArrayData(
    debugSession: vscode.DebugSession,
    variableName: string,
    elementType: string,
    size: number,
    variableInfo?: any
): Promise<{ data: number[], dataPtr: string | null } | null> {
    const frameId = variableInfo?.frameId || await getCurrentFrameId(debugSession);

    console.log(`read1DStdArrayData: variableName="${variableName}", elementType="${elementType}", size=${size}`);

    if (size <= 0) {
        console.log("std::array size is 0 or invalid");
        return null;
    }

    // Determine element size and read function
    let bytesPerElement = 4;
    let readMethod: (buffer: Buffer, offset: number) => number = (b, o) => b.readFloatLE(o);

    const typeLower = elementType.toLowerCase();
    if (typeLower.includes("double")) {
        bytesPerElement = 8;
        readMethod = (b, o) => b.readDoubleLE(o);
    } else if (typeLower.includes("float")) {
        bytesPerElement = 4;
        readMethod = (b, o) => b.readFloatLE(o);
    } else if (typeLower.includes("unsigned char") || typeLower.includes("uchar") || typeLower.includes("uint8_t")) {
        bytesPerElement = 1;
        readMethod = (b, o) => b.readUInt8(o);
    } else if (typeLower.includes("char") || typeLower.includes("int8_t")) {
        bytesPerElement = 1;
        readMethod = (b, o) => b.readInt8(o);
    } else if (typeLower.includes("unsigned short") || typeLower.includes("ushort") || typeLower.includes("uint16_t")) {
        bytesPerElement = 2;
        readMethod = (b, o) => b.readUInt16LE(o);
    } else if (typeLower.includes("short") || typeLower.includes("int16_t")) {
        bytesPerElement = 2;
        readMethod = (b, o) => b.readInt16LE(o);
    } else if (typeLower.includes("unsigned int") || typeLower.includes("uint32_t")) {
        bytesPerElement = 4;
        readMethod = (b, o) => b.readUInt32LE(o);
    } else if (typeLower.includes("int") || typeLower.includes("int32_t")) {
        bytesPerElement = 4;
        readMethod = (b, o) => b.readInt32LE(o);
    } else if (typeLower.includes("unsigned long long") || typeLower.includes("uint64_t")) {
        bytesPerElement = 8;
        readMethod = (b, o) => Number(b.readBigUInt64LE(o));
    } else if (typeLower.includes("long long") || typeLower.includes("int64_t")) {
        bytesPerElement = 8;
        readMethod = (b, o) => Number(b.readBigInt64LE(o));
    } else if (typeLower.includes("unsigned long")) {
        bytesPerElement = 4;
        readMethod = (b, o) => b.readUInt32LE(o);
    } else if (typeLower.includes("long")) {
        bytesPerElement = 4;
        readMethod = (b, o) => b.readInt32LE(o);
    }

    // Get data pointer using std::array specific function
    const dataPtr = await getStdArrayDataPointer(debugSession, variableName, frameId, variableInfo);

    if (!dataPtr) {
        vscode.window.showErrorMessage(`Could not get data pointer for std::array ${variableName}.`);
        return null;
    }

    // Read memory
    const totalBytes = size * bytesPerElement;
    console.log(`Reading ${size} elements (${totalBytes} bytes) from ${dataPtr}`);
    const buffer = await readMemoryChunked(debugSession, dataPtr, totalBytes);

    if (!buffer) {
        vscode.window.showErrorMessage(`Failed to read memory for std::array ${variableName}.`);
        return null;
    }

    // Convert to numbers
    const data: number[] = [];
    for (let i = 0; i < size; i++) {
        data.push(readMethod(buffer, i * bytesPerElement));
    }
    console.log(`Successfully read ${data.length} elements from std::array`);
    return { data, dataPtr };
}

/**
 * Draw plot for 1D std::array
 */
export async function drawStdArrayPlot(
    debugSession: vscode.DebugSession,
    variableName: string,
    elementType: string,
    size: number,
    reveal: boolean = true,
    force: boolean = false,
    variableInfo?: any,
    panelVariableName?: string
) {
    // Use panelVariableName for panel management, variableName for data access
    const panelName = panelVariableName || variableName;
    
    try {
        console.log(`Drawing plot for std::array: ${variableName}, elementType=${elementType}, size=${size}`);
        
        const panelTitle = `View: ${panelName}`;

        // Get data pointer first
        const frameId = variableInfo?.frameId || await getCurrentFrameId(debugSession);
        const dataPtr = await getStdArrayDataPointer(debugSession, variableName, frameId, variableInfo);

        // Determine bytes per element
        let bytesPerElement = 4;
        const typeLower = elementType.toLowerCase();
        if (typeLower.includes("double") || typeLower.includes("long long") || typeLower.includes("int64_t") || typeLower.includes("uint64_t")) {
            bytesPerElement = 8;
        } else if (typeLower.includes("short") || typeLower.includes("int16_t") || typeLower.includes("uint16_t")) {
            bytesPerElement = 2;
        } else if (typeLower.includes("char") || typeLower.includes("int8_t") || typeLower.includes("uint8_t")) {
            bytesPerElement = 1;
        }

        // Get or create panel
        const panel = PanelManager.getOrCreatePanel(
            "CurvePlotViewer",
            panelTitle,
            debugSession.id,
            panelName,
            reveal,
            dataPtr || undefined  // Enable sharing panels by data pointer
        );

        // Check if panel is fresh
        if (!force && size > 0 && dataPtr) {
            const totalBytes = size * bytesPerElement;
            const sample = await getMemorySample(debugSession, dataPtr, totalBytes);
            const stateToken = `${size}|${dataPtr}|${sample}`;
            
            if (PanelManager.isPanelFresh("CurvePlotViewer", debugSession.id, panelName, stateToken)) {
                console.log(`std::array plot panel is already up-to-date`);
                return;
            }
        }

        // Read data
        const result = await read1DStdArrayData(debugSession, variableName, elementType, size, variableInfo);
        if (!result) return;

        const { data: initialData, dataPtr: dataPtrForToken } = result;

        // Update state token
        const totalBytes = initialData.length * bytesPerElement;
        const sample = dataPtrForToken ? await getMemorySample(debugSession, dataPtrForToken, totalBytes) : "";
        const stateToken = `${initialData.length}|${dataPtrForToken}|${sample}`;
        PanelManager.updateStateToken("CurvePlotViewer", debugSession.id, panelName, stateToken);

        // If panel already has content, only send data
        if (panel.webview.html && panel.webview.html.length > 0) {
            console.log("std::array plot panel already has HTML, sending only data");
            
            // Check if panel is being disposed before sending data
            if ((panel as any)._isDisposing) {
                console.log("[drawStdArrayPlot] Aborting data send - panel is being disposed");
                return;
            }
            
            // CRITICAL: Don't await postMessage - it can block and cause debug freeze
            try {
                // Fire and forget - don't await
                panel.webview.postMessage({
                    command: 'updateInitialData',
                    data: initialData
                });
            } catch (e) {
                console.log("[drawStdArrayPlot] postMessage failed - panel likely disposed");
                return;
            }
            return;
        }

        panel.webview.html = getWebviewContentForPlot(panelName, initialData);

        // Dispose old listener
        if ((panel as any)._messageListener) {
            (panel as any)._messageListener.dispose();
        }

        (panel as any)._messageListener = panel.webview.onDidReceiveMessage(async (message) => {
            if (message.command === 'requestOptions') {
                // Get other plot variables of the same size for X axis selection
                const variables = await vscode.commands.executeCommand<any[]>('cv-debugmate.getVariables');
                if (variables) {
                    const currentSize = initialData.length;
                    const frameId = await getCurrentFrameId(debugSession);
                    const context = getEvaluateContext(debugSession);
                    
                    const validOptions: string[] = [];
                    
                    const sizePromises = variables
                        .filter(v => v.kind === 'plot')
                        .map(async (v) => {
                            try {
                                // If size is already known and non-zero, use it
                                if (v.size && v.size > 0) {
                                    if (v.size === currentSize) return v.name;
                                    return null;
                                }

                                // Otherwise evaluate once
                                let evalSize = 0;
                                const arrayInfo = parse1DStdArrayFromType(v.type);
                                
                                if (v.type.includes("cv::Mat")) {
                                    const matSizeResp = await debugSession.customRequest("evaluate", {
                                        expression: `(int)${v.evaluateName}.rows * (int)${v.evaluateName}.cols`,
                                        frameId: frameId,
                                        context: context
                                    });
                                    evalSize = parseInt(matSizeResp.result);
                                } else if (arrayInfo.is1DArray) {
                                    // std::array size is known from type
                                    evalSize = arrayInfo.size;
                                } else {
                                    const sizeResp = await debugSession.customRequest("evaluate", {
                                        expression: `(int)${v.evaluateName}.size()`,
                                        frameId: frameId,
                                        context: context
                                    });
                                    evalSize = parseInt(sizeResp.result);
                                }
                                
                                if (evalSize === currentSize) {
                                    return v.name;
                                }
                            } catch (e) {
                                return null;
                            }
                            return null;
                        });
                    
                    const results = await Promise.all(sizePromises);
                    results.forEach(name => {
                        if (name && name !== variableName) {
                            validOptions.push(name);
                        }
                    });

                    panel.webview.postMessage({ command: 'updateOptions', options: validOptions });
                }
            } else if (message.command === 'requestData') {
                // Load data for selected X axis variable
                const variables = await vscode.commands.executeCommand<any[]>('cv-debugmate.getVariables');
                const targetVar = variables?.find(v => v.name === message.name);
                if (targetVar) {
                    let newData: number[] | null = null;
                    const arrayInfo = parse1DStdArrayFromType(targetVar.type);
                    
                    if (targetVar.type.includes("cv::Mat")) {
                        const frameId = await getCurrentFrameId(debugSession);
                        const matInfo = await getMatInfoFromVariables(debugSession, targetVar.variablesReference);
                        newData = await readMatDataInternal(debugSession, targetVar.evaluateName, matInfo);
                    } else if (arrayInfo.is1DArray) {
                        // Handle std::array types
                        const result = await read1DStdArrayData(debugSession, targetVar.evaluateName, arrayInfo.elementType, arrayInfo.size, targetVar);
                        newData = result ? result.data : null;
                    } else {
                        // Handle std::vector types
                        const result = await readVectorDataInternal(debugSession, targetVar.evaluateName, targetVar.type, initialData.length, targetVar);
                        newData = result ? result.data : null;
                    }
                    
                    if (newData) {
                        if ((panel as any)._isDisposing) return;
                        try {
                            panel.webview.postMessage({ 
                                command: 'updateData', 
                                target: message.target, 
                                data: newData, 
                                name: message.name 
                            });
                        } catch (e) {
                            console.log("[drawPlot/std::array] updateData postMessage failed - panel likely disposed");
                        }
                    }
                }
            } else if (message.command === 'reload') {
                // Check if debug session is still active before reloading
                const currentSession = vscode.debug.activeDebugSession;
                if (currentSession && currentSession.id === debugSession.id && !(panel as any)._isDisposing) {
                    // CRITICAL: Fire-and-forget - don't await to avoid blocking
                    Promise.resolve(vscode.commands.executeCommand('cv-debugmate.viewVariable', { name: variableName, evaluateName: variableName, skipToken: true }))
                        .then(() => console.log(`[DEBUG-TRACE] Vector plot reload completed`))
                        .catch((e: Error) => console.log(`[DEBUG-TRACE] Vector plot reload failed:`, e));
                } else {
                    console.log('Skipping reload - debug session is no longer active or has changed');
                }
            } else if (message.command === 'saveFile') {
                const options: vscode.SaveDialogOptions = {
                    defaultUri: vscode.Uri.file(message.defaultName),
                    filters: message.type === 'png' ? { 'Images': ['png'] } : { 'Data': ['csv'] }
                };

                const fileUri = await vscode.window.showSaveDialog(options);
                if (fileUri) {
                    if (message.type === 'png') {
                        const base64Data = message.data.replace(/^data:image\/png;base64,/, "");
                        fs.writeFileSync(fileUri.fsPath, base64Data, 'base64');
                    } else {
                        fs.writeFileSync(fileUri.fsPath, message.data);
                    }
                    vscode.window.showInformationMessage(`File saved to ${fileUri.fsPath}`);
                }
            }
        });

    } catch (error: any) {
        vscode.window.showErrorMessage(`Failed to draw std::array plot: ${error.message}`);
        console.error(error);
    }
}


// ============== C-style Array Support ==============

/**
 * Read data from 1D C-style array
 * Reuses the same logic as read1DStdArrayData but with different data pointer acquisition
 */
export async function read1DCStyleArrayData(
    debugSession: vscode.DebugSession,
    variableName: string,
    elementType: string,
    size: number,
    variableInfo?: any
): Promise<{ data: number[], dataPtr: string | null } | null> {
    const frameId = variableInfo?.frameId || await getCurrentFrameId(debugSession);

    console.log(`read1DCStyleArrayData: variableName="${variableName}", elementType="${elementType}", size=${size}`);

    if (size <= 0) {
        console.log("C-style array size is 0 or invalid");
        return null;
    }

    // Determine element size and read function (same as read1DStdArrayData)
    let bytesPerElement = 4;
    let readMethod: (buffer: Buffer, offset: number) => number = (b, o) => b.readFloatLE(o);

    const typeLower = elementType.toLowerCase();
    if (typeLower.includes("double")) {
        bytesPerElement = 8;
        readMethod = (b, o) => b.readDoubleLE(o);
    } else if (typeLower.includes("float")) {
        bytesPerElement = 4;
        readMethod = (b, o) => b.readFloatLE(o);
    } else if (typeLower.includes("unsigned char") || typeLower.includes("uchar") || typeLower.includes("uint8_t")) {
        bytesPerElement = 1;
        readMethod = (b, o) => b.readUInt8(o);
    } else if (typeLower.includes("char") || typeLower.includes("int8_t")) {
        bytesPerElement = 1;
        readMethod = (b, o) => b.readInt8(o);
    } else if (typeLower.includes("unsigned short") || typeLower.includes("ushort") || typeLower.includes("uint16_t")) {
        bytesPerElement = 2;
        readMethod = (b, o) => b.readUInt16LE(o);
    } else if (typeLower.includes("short") || typeLower.includes("int16_t")) {
        bytesPerElement = 2;
        readMethod = (b, o) => b.readInt16LE(o);
    } else if (typeLower.includes("unsigned int") || typeLower.includes("uint32_t")) {
        bytesPerElement = 4;
        readMethod = (b, o) => b.readUInt32LE(o);
    } else if (typeLower.includes("int") || typeLower.includes("int32_t")) {
        bytesPerElement = 4;
        readMethod = (b, o) => b.readInt32LE(o);
    } else if (typeLower.includes("unsigned long long") || typeLower.includes("uint64_t")) {
        bytesPerElement = 8;
        readMethod = (b, o) => Number(b.readBigUInt64LE(o));
    } else if (typeLower.includes("long long") || typeLower.includes("int64_t")) {
        bytesPerElement = 8;
        readMethod = (b, o) => Number(b.readBigInt64LE(o));
    } else if (typeLower.includes("unsigned long")) {
        bytesPerElement = 4;
        readMethod = (b, o) => b.readUInt32LE(o);
    } else if (typeLower.includes("long")) {
        bytesPerElement = 4;
        readMethod = (b, o) => b.readInt32LE(o);
    }

    // Get data pointer using C-style array specific function
    const dataPtr = await getCStyle1DArrayDataPointer(debugSession, variableName, frameId, variableInfo);

    if (!dataPtr) {
        vscode.window.showErrorMessage(`Could not get data pointer for C-style array ${variableName}.`);
        return null;
    }

    // Read memory
    const totalBytes = size * bytesPerElement;
    console.log(`Reading ${size} elements (${totalBytes} bytes) from ${dataPtr}`);
    const buffer = await readMemoryChunked(debugSession, dataPtr, totalBytes);

    if (!buffer) {
        vscode.window.showErrorMessage(`Failed to read memory for C-style array ${variableName}.`);
        return null;
    }

    // Convert to numbers
    const data: number[] = [];
    for (let i = 0; i < size; i++) {
        data.push(readMethod(buffer, i * bytesPerElement));
    }
    console.log(`Successfully read ${data.length} elements from C-style array`);
    return { data, dataPtr };
}

/**
 * Helper to detect 1D C-style array from type string and extract info
 */
function parse1DCStyleArrayFromType(type: string): { is1DArray: boolean; elementType: string; size: number } {
    // First check it's NOT a 2D array (type[rows][cols])
    if (/\[\s*\d+\s*\]\s*\[\s*\d+\s*\]/.test(type)) {
        return { is1DArray: false, elementType: "", size: 0 };
    }
    
    // Match C-style 1D array pattern: type[size]
    const cStyle1DPattern = /([a-zA-Z_][a-zA-Z0-9_*\s]*)\s*\[\s*(\d+)\s*\]/;
    const match = type.match(cStyle1DPattern);
    
    if (match) {
        const elementType = match[1].trim();
        const size = parseInt(match[2]);
        return { is1DArray: true, elementType, size };
    }
    
    return { is1DArray: false, elementType: "", size: 0 };
}

/**
 * Draw plot for 1D C-style array
 * Reuses the same panel and message handling logic as drawStdArrayPlot
 */
export async function drawCStyleArrayPlot(
    debugSession: vscode.DebugSession,
    variableName: string,
    elementType: string,
    size: number,
    reveal: boolean = true,
    force: boolean = false,
    variableInfo?: any,
    panelVariableName?: string
) {
    // Use panelVariableName for panel management, variableName for data access
    const panelName = panelVariableName || variableName;
    
    try {
        console.log(`Drawing plot for C-style array: ${variableName}, elementType=${elementType}, size=${size}`);
        
        const panelTitle = `View: ${panelName}`;

        // Get data pointer first
        const frameId = variableInfo?.frameId || await getCurrentFrameId(debugSession);
        const dataPtr = await getCStyle1DArrayDataPointer(debugSession, variableName, frameId, variableInfo);

        // Determine bytes per element
        let bytesPerElement = 4;
        const typeLower = elementType.toLowerCase();
        if (typeLower.includes("double") || typeLower.includes("long long") || typeLower.includes("int64_t") || typeLower.includes("uint64_t")) {
            bytesPerElement = 8;
        } else if (typeLower.includes("short") || typeLower.includes("int16_t") || typeLower.includes("uint16_t")) {
            bytesPerElement = 2;
        } else if (typeLower.includes("char") || typeLower.includes("int8_t") || typeLower.includes("uint8_t")) {
            bytesPerElement = 1;
        }

        // Get or create panel
        const panel = PanelManager.getOrCreatePanel(
            "CurvePlotViewer",
            panelTitle,
            debugSession.id,
            panelName,
            reveal,
            dataPtr || undefined  // Enable sharing panels by data pointer
        );

        // Check if panel is fresh
        if (!force && size > 0 && dataPtr) {
            const totalBytes = size * bytesPerElement;
            const sample = await getMemorySample(debugSession, dataPtr, totalBytes);
            const stateToken = `${size}|${dataPtr}|${sample}`;
            
            if (PanelManager.isPanelFresh("CurvePlotViewer", debugSession.id, panelName, stateToken)) {
                console.log(`C-style array plot panel is already up-to-date`);
                return;
            }
        }

        // Read data
        const result = await read1DCStyleArrayData(debugSession, variableName, elementType, size, variableInfo);
        if (!result) return;

        const { data: initialData, dataPtr: dataPtrForToken } = result;

        // Update state token
        const totalBytes = initialData.length * bytesPerElement;
        const sample = dataPtrForToken ? await getMemorySample(debugSession, dataPtrForToken, totalBytes) : "";
        const stateToken = `${initialData.length}|${dataPtrForToken}|${sample}`;
        PanelManager.updateStateToken("CurvePlotViewer", debugSession.id, panelName, stateToken);

        // If panel already has content, only send data
        if (panel.webview.html && panel.webview.html.length > 0) {
            console.log("C-style array plot panel already has HTML, sending only data");
            
            // Check if panel is being disposed before sending data
            if ((panel as any)._isDisposing) {
                console.log("[drawCStyleArrayPlot] Aborting data send - panel is being disposed");
                return;
            }
            
            // CRITICAL: Don't await postMessage - it can block and cause debug freeze
            try {
                // Fire and forget - don't await
                panel.webview.postMessage({
                    command: 'updateInitialData',
                    data: initialData
                });
            } catch (e) {
                console.log("[drawCStyleArrayPlot] postMessage failed - panel likely disposed");
                return;
            }
            return;
        }

        panel.webview.html = getWebviewContentForPlot(panelName, initialData);

        // Dispose old listener
        if ((panel as any)._messageListener) {
            (panel as any)._messageListener.dispose();
        }

        (panel as any)._messageListener = panel.webview.onDidReceiveMessage(async (message) => {
            if (message.command === 'requestOptions') {
                // Get other plot variables of the same size for X axis selection
                const variables = await vscode.commands.executeCommand<any[]>('cv-debugmate.getVariables');
                if (variables) {
                    const currentSize = initialData.length;
                    const frameId = await getCurrentFrameId(debugSession);
                    const context = getEvaluateContext(debugSession);
                    
                    const validOptions: string[] = [];
                    
                    const sizePromises = variables
                        .filter(v => v.kind === 'plot')
                        .map(async (v) => {
                            try {
                                // If size is already known and non-zero, use it
                                if (v.size && v.size > 0) {
                                    if (v.size === currentSize) return v.name;
                                    return null;
                                }

                                // Otherwise evaluate once
                                let evalSize = 0;
                                const stdArrayInfo = parse1DStdArrayFromType(v.type);
                                const cStyleArrayInfo = parse1DCStyleArrayFromType(v.type);
                                
                                if (v.type.includes("cv::Mat")) {
                                    const matSizeResp = await debugSession.customRequest("evaluate", {
                                        expression: `(int)${v.evaluateName}.rows * (int)${v.evaluateName}.cols`,
                                        frameId: frameId,
                                        context: context
                                    });
                                    evalSize = parseInt(matSizeResp.result);
                                } else if (stdArrayInfo.is1DArray) {
                                    evalSize = stdArrayInfo.size;
                                } else if (cStyleArrayInfo.is1DArray) {
                                    evalSize = cStyleArrayInfo.size;
                                } else {
                                    const sizeResp = await debugSession.customRequest("evaluate", {
                                        expression: `(int)${v.evaluateName}.size()`,
                                        frameId: frameId,
                                        context: context
                                    });
                                    evalSize = parseInt(sizeResp.result);
                                }
                                
                                if (evalSize === currentSize) {
                                    return v.name;
                                }
                            } catch (e) {
                                return null;
                            }
                            return null;
                        });
                    
                    const results = await Promise.all(sizePromises);
                    results.forEach(name => {
                        if (name && name !== variableName) {
                            validOptions.push(name);
                        }
                    });

                    panel.webview.postMessage({ command: 'updateOptions', options: validOptions });
                }
            } else if (message.command === 'requestData') {
                // Load data for selected X axis variable
                const variables = await vscode.commands.executeCommand<any[]>('cv-debugmate.getVariables');
                const targetVar = variables?.find(v => v.name === message.name);
                if (targetVar) {
                    let newData: number[] | null = null;
                    const stdArrayInfo = parse1DStdArrayFromType(targetVar.type);
                    const cStyleArrayInfo = parse1DCStyleArrayFromType(targetVar.type);
                    
                    if (targetVar.type.includes("cv::Mat")) {
                        const frameId = await getCurrentFrameId(debugSession);
                        const matInfo = await getMatInfoFromVariables(debugSession, targetVar.variablesReference);
                        newData = await readMatDataInternal(debugSession, targetVar.evaluateName, matInfo);
                    } else if (stdArrayInfo.is1DArray) {
                        const result = await read1DStdArrayData(debugSession, targetVar.evaluateName, stdArrayInfo.elementType, stdArrayInfo.size, targetVar);
                        newData = result ? result.data : null;
                    } else if (cStyleArrayInfo.is1DArray) {
                        const result = await read1DCStyleArrayData(debugSession, targetVar.evaluateName, cStyleArrayInfo.elementType, cStyleArrayInfo.size, targetVar);
                        newData = result ? result.data : null;
                    } else {
                        const result = await readVectorDataInternal(debugSession, targetVar.evaluateName, targetVar.type, initialData.length, targetVar);
                        newData = result ? result.data : null;
                    }
                    
                    if (newData) {
                        panel.webview.postMessage({ 
                            command: 'updateData', 
                            target: message.target, 
                            data: newData, 
                            name: message.name 
                        });
                    }
                }
            } else if (message.command === 'reload') {
                // Check if debug session is still active before reloading
                const currentSession = vscode.debug.activeDebugSession;
                if (currentSession && currentSession.id === debugSession.id && !(panel as any)._isDisposing) {
                    // CRITICAL: Fire-and-forget - don't await to avoid blocking
                    Promise.resolve(vscode.commands.executeCommand('cv-debugmate.viewVariable', { name: variableName, evaluateName: variableName, skipToken: true }))
                        .then(() => console.log(`[DEBUG-TRACE] Array plot reload completed`))
                        .catch((e: Error) => console.log(`[DEBUG-TRACE] Array plot reload failed:`, e));
                } else {
                    console.log('Skipping reload - debug session is no longer active or has changed');
                }
            } else if (message.command === 'saveFile') {
                const options: vscode.SaveDialogOptions = {
                    defaultUri: vscode.Uri.file(message.defaultName),
                    filters: message.type === 'png' ? { 'Images': ['png'] } : { 'Data': ['csv'] }
                };

                const fileUri = await vscode.window.showSaveDialog(options);
                if (fileUri) {
                    if (message.type === 'png') {
                        const base64Data = message.data.replace(/^data:image\/png;base64,/, "");
                        fs.writeFileSync(fileUri.fsPath, base64Data, 'base64');
                    } else {
                        fs.writeFileSync(fileUri.fsPath, message.data);
                    }
                    vscode.window.showInformationMessage(`File saved to ${fileUri.fsPath}`);
                }
            }
        });

    } catch (error: any) {
        vscode.window.showErrorMessage(`Failed to draw C-style array plot: ${error.message}`);
        console.error(error);
    }
}
