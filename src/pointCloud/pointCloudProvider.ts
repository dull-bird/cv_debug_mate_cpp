import * as vscode from "vscode";
import { 
  getCurrentFrameId, 
  getEvaluateContext, 
  isUsingMSVC, 
  isUsingLLDB, 
  isUsingCppdbg, 
  tryGetDataPointer, 
  readMemoryChunked 
} from "../utils/debugger";
import { getWebviewContentForPointCloud, generatePLYContent } from "./pointCloudWebview";
import { PanelManager } from "../utils/panelManager";

// Function to draw point cloud
export async function drawPointCloud(
  debugSession: vscode.DebugSession, 
  variableInfo: any, 
  variableName: string, 
  isDouble: boolean = false
) {
  try {
    console.log("Drawing point cloud with debugger type:", debugSession.type);
    console.log("variableInfo:", JSON.stringify(variableInfo, null, 2));

    let points: { x: number; y: number; z: number }[] = [];

    // Use readMemory approach (supports MSVC, LLDB, and GDB with multiple fallback strategies)
    if (variableInfo.evaluateName) {
      console.log("Trying readMemory approach");
      try {
        points = await getPointCloudViaReadMemory(debugSession, variableInfo.evaluateName, variableInfo, isDouble);
        if (points.length > 0) {
          console.log(`Loaded ${points.length} points via readMemory`);
        }
      } catch (e) {
        console.log("readMemory approach failed:", e);
      }
    }

    console.log(`Loaded ${points.length} points`);

    if (points.length === 0) {
      vscode.window.showWarningMessage("No points found in the vector. Make sure the vector is not empty.");
      return;
    }

    // Show the webview to visualize the points
    const panelTitle = `View: point cloud ${variableName}`;
    const panel = PanelManager.getOrCreatePanel(
      "3DPointViewer",
      panelTitle,
      debugSession.id,
      variableName
    );
    
    panel.webview.html = getWebviewContentForPointCloud(points);
    
    // Dispose previous listener if it exists to avoid multiple listeners on reused panel
    if ((panel as any)._messageListener) {
      (panel as any)._messageListener.dispose();
    }

    // Handle messages from webview (e.g., save PLY request)
    (panel as any)._messageListener = panel.webview.onDidReceiveMessage(
      async (message) => {
        if (message.command === "savePLY") {
          try {
            const plyContent = generatePLYContent(points);
            const uri = await vscode.window.showSaveDialog({
              defaultUri: vscode.Uri.file(`${variableName}.ply`),
              filters: {
                "PLY Files": ["ply"],
                "All Files": ["*"]
              }
            });
            
            if (uri) {
              const encoder = new TextEncoder();
              const data = encoder.encode(plyContent);
              await vscode.workspace.fs.writeFile(uri, data);
              vscode.window.showInformationMessage(`Point cloud saved to ${uri.fsPath}`);
            }
          } catch (error) {
            vscode.window.showErrorMessage(`Failed to save PLY file: ${error}`);
            console.error("Error saving PLY:", error);
          }
        }
      },
      undefined,
      undefined
    );
  } catch (error) {
    console.error("Error in drawPointCloud:", error);
    throw error;
  }
}

// Get point cloud data via readMemory (fast path for cppdbg/cppvsdbg)
export async function getPointCloudViaReadMemory(
  debugSession: vscode.DebugSession,
  evaluateName: string,
  variableInfo?: any,
  isDouble: boolean = false
): Promise<{ x: number; y: number; z: number }[]> {
  const points: { x: number; y: number; z: number }[] = [];
  // Use frameId from variableInfo if available, otherwise get current frame
  const frameId = variableInfo?.frameId || await getCurrentFrameId(debugSession);
  const context = getEvaluateContext(debugSession);
  
  console.log(`getPointCloudViaReadMemory: evaluateName="${evaluateName}", frameId=${frameId}, context="${context}"`);
  
  // Try to get vector size from variableInfo.result first (e.g., "size=8000")
  let size = 0;
  if (variableInfo && variableInfo.result) {
    const sizeMatch = variableInfo.result.match(/size\s*=\s*(\d+)/);
    if (sizeMatch) {
      size = parseInt(sizeMatch[1]);
      console.log(`Parsed vector size from variableInfo.result: ${size}`);
    }
  }
  
  // If not found in variableInfo, try to evaluate size() expression
  if (size <= 0) {
    try {
      const sizeResponse = await debugSession.customRequest("evaluate", {
        expression: `(int)${evaluateName}.size()`,
        frameId: frameId,
        context: context
      });
      
      size = parseInt(sizeResponse.result);
      if (!isNaN(size) && size > 0) {
        console.log(`Got vector size from evaluate: ${size}`);
      }
    } catch (e) {
      console.log("Failed to evaluate size() expression:", e);
    }
  }
  
  if (isNaN(size) || size <= 0) {
    console.log("Could not get vector size or size is 0");
    return points;
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
    // Note: In LLDB, evaluate may not work for member access in some contexts
    // Try to get __begin_ through variables first, then fallback to evaluate
    console.log("Using LLDB-specific approaches");
    
    // First, try to get data pointer through variables if we have variablesReference
    if (variableInfo && variableInfo.variablesReference > 0) {
      try {
        console.log(`Trying to get data pointer through variables, variablesReference=${variableInfo.variablesReference}`);
        const varsResponse = await debugSession.customRequest("variables", {
          variablesReference: variableInfo.variablesReference
        });
        
        // Log variable names only (not full objects to avoid truncation)
        if (varsResponse.variables && varsResponse.variables.length > 0) {
          const varNames = varsResponse.variables.slice(0, 10).map((v: any) => v.name).join(", ");
          console.log(`Found ${varsResponse.variables.length} variables (first 10: ${varNames}...)`);
          
          // Strategy 1: Look for __begin_ in the variables
          for (const v of varsResponse.variables) {
            const varName = v.name;
            if (varName === "__begin_" || varName.includes("__begin")) {
              console.log(`Found __begin_ variable: name="${varName}", value="${v.value}", memoryReference="${v.memoryReference}"`);
              
              // Extract pointer from value
              if (v.value) {
                const ptrMatch = v.value.match(/0x[0-9a-fA-F]+/);
                if (ptrMatch) {
                  dataPtr = ptrMatch[0];
                  console.log(`Extracted pointer from __begin_ variable: ${dataPtr}`);
                  break;
                }
              }
              
              // Also check memoryReference
              if (!dataPtr && v.memoryReference) {
                dataPtr = v.memoryReference;
                console.log(`Using memoryReference from __begin_ variable: ${dataPtr}`);
                break;
              }
            }
          }
          
          // Strategy 2: If __begin_ not found, try to get [0] element's memoryReference
          // This works because [0] is the first element, and its address is the data pointer
          if (!dataPtr) {
            const firstElement = varsResponse.variables.find((v: any) => v.name === "[0]");
            if (firstElement) {
              console.log(`Found [0] element: value="${firstElement.value}", memoryReference="${firstElement.memoryReference}"`);
              
              // Use memoryReference of [0] as data pointer
              if (firstElement.memoryReference) {
                dataPtr = firstElement.memoryReference;
                console.log(`Using memoryReference from [0] element as data pointer: ${dataPtr}`);
              } else if (firstElement.value) {
                // Try to extract address from value (e.g., "{x=1.0, y=2.0, z=3.0}" might contain address)
                const ptrMatch = firstElement.value.match(/0x[0-9a-fA-F]+/);
                if (ptrMatch) {
                  dataPtr = ptrMatch[0];
                  console.log(`Extracted pointer from [0] element value: ${dataPtr}`);
                }
              }
              
              // If [0] has variablesReference, try to get its sub-variables to find address
              if (!dataPtr && firstElement.variablesReference > 0) {
                try {
                  const elemVars = await debugSession.customRequest("variables", {
                    variablesReference: firstElement.variablesReference
                  });
                  console.log(`[0] has sub-variables, checking for address...`);
                  // The address might be in a sub-variable or we can calculate it
                  // For now, if we have the vector's memoryReference, we can try to calculate
                  // But let's first check if any sub-variable has an address
                  if (elemVars.variables) {
                    for (const ev of elemVars.variables) {
                      if (ev.memoryReference) {
                        // This is the address of the first element
                        dataPtr = ev.memoryReference;
                        console.log(`Found memoryReference in [0] sub-variable: ${dataPtr}`);
                        break;
                      }
                    }
                  }
                } catch (e) {
                  console.log("Failed to get [0] sub-variables:", e);
                }
              }
            }
          }
        }
        
        if (!dataPtr) {
          console.log("Could not get data pointer through variables");
        }
      } catch (e) {
        console.log("Failed to get data pointer through variables:", e);
      }
    }
    
    // If variables approach didn't work, try evaluate expressions
    if (!dataPtr) {
      const lldbExpressions = [
        `${evaluateName}.__begin_`,                              // Get __begin_ value directly (returns pointer type)
        `reinterpret_cast<long long>(${evaluateName}.__begin_)`, // Try C++ style cast
        `${evaluateName}.data()`,                                // Try data() method
        `reinterpret_cast<long long>(${evaluateName}.data())`,   // Try data() with C++ cast
        `&${evaluateName}[0]`,                                    // Try address of first element
        `reinterpret_cast<long long>(&${evaluateName}[0])`       // Try address with C++ cast
      ];
      dataPtr = await tryGetDataPointer(debugSession, evaluateName, lldbExpressions, frameId, context);
    }
    
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
    return points;
  }
  
  // Read all points at once
  // Point3f = 3 floats = 12 bytes per point
  // Point3d = 3 doubles = 24 bytes per point
  const bytesPerPoint = isDouble ? 24 : 12;
  const totalBytes = size * bytesPerPoint;
  
  console.log(`Reading ${size} points (${totalBytes} bytes, ${isDouble ? "Point3d" : "Point3f"}) from ${dataPtr}`);
  
  const buffer = await readMemoryChunked(debugSession, dataPtr, totalBytes);
  
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
  
  return points;
}

