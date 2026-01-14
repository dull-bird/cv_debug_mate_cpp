import * as vscode from "vscode";
import { 
  evaluateWithTimeout, 
  isUsingLLDB, 
  readMemoryChunked,
  getMemorySample,
  get2DStdArrayDataPointer,
  getCStyle2DArrayDataPointer,
  get3DArrayDataPointer
} from "../utils/debugger";
import { getBytesPerElement } from "../utils/opencv";
import { getWebviewContentForMat } from "./matWebview";
import { PanelManager } from "../utils/panelManager";
import { SyncManager } from "../utils/syncManager";

// Function to draw the cv::Mat image
export async function drawMatImage(
  debugSession: vscode.DebugSession,
  variableInfo: any,
  frameId: number,
  variableName: string,
  reveal: boolean = true,
  force: boolean = false,
  panelVariableName?: string
) {
  // Use panelVariableName for panel management, variableName for data access
  const panelName = panelVariableName || variableName;
  
  // Check if there's an existing panel that's being disposed - if so, abort immediately
  const existingPanel = PanelManager.getPanel("MatImageViewer", debugSession.id, panelName);
  if (existingPanel && (existingPanel as any)._isDisposing) {
    console.log(`[drawMatImage] Aborting - panel for ${panelName} is being disposed`);
    return;
  }
  
  try {
    const usingLLDB = isUsingLLDB(debugSession);
    console.log("Drawing Mat image with debugger type:", debugSession.type);
    console.log("variableInfo:", JSON.stringify(variableInfo, null, 2));
    
    let rows: number, cols: number, channels: number, depth: number, dataPtr: string = "";
    
    if (usingLLDB) {
      // For LLDB, we must use variables request - evaluate won't work
      if (variableInfo.variablesReference && variableInfo.variablesReference > 0) {
        console.log("Using LLDB variables request to get Mat info");
        const matInfo = await getMatInfoFromVariables(debugSession, variableInfo.variablesReference);
        rows = matInfo.rows;
        cols = matInfo.cols;
        channels = matInfo.channels;
        depth = matInfo.depth;
        dataPtr = matInfo.dataPtr;
      } else {
        // Try to get variablesReference from scopes
        console.log("No variablesReference, trying to get from scopes...");
        const scopesResponse = await debugSession.customRequest("scopes", { frameId: frameId });
        let foundVariable = null;
        
        for (const scope of scopesResponse.scopes) {
          const varsResponse = await debugSession.customRequest("variables", {
            variablesReference: scope.variablesReference
          });
          
          for (const v of varsResponse.variables) {
            if (v.name === variableName || v.evaluateName === variableName) {
              foundVariable = v;
              break;
            }
          }
          if (foundVariable) {
            break;
          }
        }
        
        if (foundVariable && foundVariable.variablesReference > 0) {
          console.log("Found variable in scopes:", foundVariable.name);
          const matInfo = await getMatInfoFromVariables(debugSession, foundVariable.variablesReference);
          rows = matInfo.rows;
          cols = matInfo.cols;
          channels = matInfo.channels;
          depth = matInfo.depth;
          dataPtr = matInfo.dataPtr;
        } else {
          throw new Error("Cannot access Mat variable in LLDB. Make sure it's a valid cv::Mat.");
        }
      }
      
      console.log(`LLDB Mat info: ${rows!}x${cols!}, ${channels!} channels, depth=${depth!}, data=${dataPtr}`);
    } else {
      // For other debuggers (cppdbg, cppvsdbg), prefer variablesReference to get Mat info
      // because .depth() and .channels() method calls may not work via evaluate
      if (variableInfo.variablesReference && variableInfo.variablesReference > 0) {
        console.log("Using variablesReference to get Mat info for cppvsdbg/cppdbg");
        const matInfo = await getMatInfoFromVariables(debugSession, variableInfo.variablesReference);
        rows = matInfo.rows;
        cols = matInfo.cols;
        channels = matInfo.channels;
        depth = matInfo.depth;
        dataPtr = matInfo.dataPtr;
        console.log(`Mat info from variablesReference: ${rows}x${cols}, ${channels} channels, depth=${depth}, dataPtr=${dataPtr}`);
      } else {
        // Fallback: use evaluate expressions
        console.log("Fallback: Using evaluate expressions for Mat info");
        const rowsExp = `${variableName}.rows`;
        const colsExp = `${variableName}.cols`;
        const flagsExp = `${variableName}.flags`;
        const dataExp = `${variableName}.data`;

        // Get matrix dimensions in parallel
        const [rowsResponse, colsResponse, flagsResponse, dataResponse] = await Promise.all([
          evaluateWithTimeout(debugSession, rowsExp, frameId, 10000),
          evaluateWithTimeout(debugSession, colsExp, frameId, 10000),
          evaluateWithTimeout(debugSession, flagsExp, frameId, 10000),
          evaluateWithTimeout(debugSession, dataExp, frameId, 10000)
        ]);

        rows = parseInt(rowsResponse.result);
        cols = parseInt(colsResponse.result);
        dataPtr = dataResponse.result;
        
        // Parse depth and channels from flags (same logic as LLDB)
        const flags = parseInt(flagsResponse.result);
        if (!isNaN(flags)) {
          const type = flags & 0xFFF;
          depth = type & 7;  // CV_MAT_DEPTH_MASK = 7
          channels = ((type >> 3) & 63) + 1;  // ((type >> 3) & 63) gives (channels - 1)
          console.log(`Extracted from flags ${flags}: depth=${depth}, channels=${channels}`);
        } else {
          // Last resort: try .depth() and .channels()
          const channelsExp = `${variableName}.channels()`;
          const depthExp = `${variableName}.depth()`;
          const [channelsResponse, depthResponse] = await Promise.all([
            evaluateWithTimeout(debugSession, channelsExp, frameId, 10000),
            evaluateWithTimeout(debugSession, depthExp, frameId, 10000)
          ]);
          channels = parseInt(channelsResponse.result);
          depth = parseInt(depthResponse.result);
        }
      }
    }

    console.log(`Matrix info: ${rows}x${cols}, ${channels} channels, depth=${depth}`);

    const bytesPerElement = getBytesPerElement(depth);
    const totalBytes = rows * cols * channels * bytesPerElement;

    const panelTitle = `View: ${panelName}`;
    // Check if panel is already fresh with this hard state token
    // Now including memory sampling to detect internal pixel changes
    // BUT only skip if it's NOT a focus-triggered refresh
    const sample = await getMemorySample(debugSession, dataPtr, totalBytes);
    const stateToken = `${rows}|${cols}|${channels}|${depth}|${dataPtr}|${sample}`;
    
    // Pass dataPtr to enable panel sharing between variables pointing to the same data
    const panel = PanelManager.getOrCreatePanel(
      "MatImageViewer",
      panelTitle,
      debugSession.id,
      panelName,
      reveal,
      dataPtr  // Enable sharing panels by data pointer
    );

    if (!force && PanelManager.isPanelFresh("MatImageViewer", debugSession.id, panelName, stateToken)) {
      console.log(`Mat panel is already up-to-date with token: ${stateToken}`);
      return;
    }

    if (isNaN(rows) || isNaN(cols) || isNaN(channels) || isNaN(depth)) {
      throw new Error("Invalid matrix dimensions or type");
    }

    if (rows <= 0 || cols <= 0) {
      throw new Error("Matrix is empty");
    }

    const dataSize = rows * cols * channels;
    console.log(`Total data size: ${dataSize} elements`);

    // Read data with progress indicator
    const dataResult = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "Loading OpenCV Mat",
        cancellable: false
      },
      async (progress) => {
        progress.report({ message: "Starting to read pixel data..." });
        
        if (usingLLDB && dataPtr) {
          // For LLDB, use direct memory read with the pointer
          return await readMatDataForLLDB(
            debugSession,
            dataPtr,
            frameId,
            dataSize,
            depth,
            progress
          );
        } else {
          return await readMatDataFast(
            debugSession,
            `${variableName}.data`,
            frameId,
            dataSize,
            depth,
            progress
          );
        }
      }
    );

    // CRITICAL: Check if panel was disposed during data read
    // This can happen if user closes the window while data is being read
    if ((panel as any)._isDisposing) {
      console.log("[drawMatImage] Panel was disposed during data read, aborting");
      return;
    }

    // Update state token AFTER data is read
    PanelManager.updateStateToken("MatImageViewer", debugSession.id, panelName, stateToken);

    // If panel already has content, only send data to preserve view state (zoom/pan)
    if (panel.webview.html && panel.webview.html.length > 0) {
      console.log("Panel already has HTML, sending only data to preserve view state");
      
      // Check if panel is being disposed before sending data
      if ((panel as any)._isDisposing) {
        console.log("[drawMatImage] Aborting data send - panel is being disposed");
        return;
      }
      
      const buffer = dataResult.buffer;
      if (buffer) {
        // Double-check before sending large data
        if ((panel as any)._isDisposing) {
          console.log("[drawMatImage] Aborting data send - panel is being disposed (2)");
          return;
        }
        
        // CRITICAL: Use setTimeout to defer postMessage, allowing VS Code to process
        // any pending events (like panel disposal) before we try to send data.
        setTimeout(() => {
          if ((panel as any)._isDisposing) {
            return;
          }
          try {
            panel.webview.postMessage({
              command: 'completeData',
              data: new Uint8Array(buffer),
              rows, cols, channels, depth 
            });
          } catch (e) {
            // Panel was disposed, ignore
          }
        }, 0);
        
        // Restore saved view state if available
        const savedState = SyncManager.getSavedState(variableName);
        if (savedState && !(panel as any)._isDisposing) {
          setTimeout(() => {
            if (!(panel as any)._isDisposing) {
              try {
                panel.webview.postMessage({
                  command: 'setView',
                  state: savedState
                });
              } catch (e) {
                // Panel was disposed
              }
            }
          }, 100);
        }
        return;
      }
    }

    panel.webview.html = getWebviewContentForMat(
      panel.webview,
      rows,
      cols,
      channels,
      depth,
      { base64: "" } // Don't embed data directly, send via message
    );

    // Send ready signal immediately so webview knows this is not a moved panel
    panel.webview.postMessage({ command: 'ready' });

    SyncManager.registerPanel(variableName, panel);
    
    // Dispose previous listener if it exists to avoid multiple listeners on reused panel
    if ((panel as any)._syncListener) {
      (panel as any)._syncListener.dispose();
    }

    (panel as any)._syncListener = panel.webview.onDidReceiveMessage(
      async (message) => {
        // Ignore all messages if panel is being disposed
        if ((panel as any)._isDisposing) {
          return;
        }
        if (message.command === 'viewChanged') {
          SyncManager.syncView(variableName, message.state);
        } else if (message.command === 'reload') {
          const reloadStartTime = Date.now();
          console.log(`[DEBUG-TRACE] reload message received for ${variableName} at ${reloadStartTime}`);
          
          // Check if debug session is still active before reloading
          const currentSession = vscode.debug.activeDebugSession;
          if (currentSession && currentSession.id === debugSession.id && !(panel as any)._isDisposing) {
            console.log(`[DEBUG-TRACE] reload: starting executeCommand (fire-and-forget) at ${Date.now()}`);
            // CRITICAL: Fire-and-forget - don't await to avoid blocking
            Promise.resolve(vscode.commands.executeCommand('cv-debugmate.viewVariable', { name: variableName, evaluateName: variableName, skipToken: true }))
              .then(() => console.log(`[DEBUG-TRACE] reload: executeCommand completed at ${Date.now()}`))
              .catch((e: Error) => console.log(`[DEBUG-TRACE] reload: executeCommand failed:`, e));
          } else {
            console.log('Skipping reload - debug session is no longer active or panel is disposing');
          }
          
          console.log(`[DEBUG-TRACE] reload handler finished for ${variableName} at ${Date.now()}`);
        }
      }
    );

    // Send complete data at once to webview (webview has its own memory space)
    const buffer = dataResult.buffer;
    if (!buffer) {
        throw new Error("Failed to read Mat data");
    }

    // CRITICAL: Use setTimeout to defer postMessage
    if ((panel as any)._isDisposing) {
      console.log(`[DEBUG-TRACE] postMessage skipped - panel disposing (before setTimeout)`);
      return;
    }
    
    console.log(`[DEBUG-TRACE] postMessage: scheduling setTimeout at ${Date.now()}`);
    setTimeout(() => {
      console.log(`[DEBUG-TRACE] postMessage: setTimeout callback at ${Date.now()}, isDisposing=${(panel as any)._isDisposing}`);
      if ((panel as any)._isDisposing) {
        console.log(`[DEBUG-TRACE] postMessage skipped - panel disposing (in setTimeout)`);
        return;
      }
      try {
        console.log(`[DEBUG-TRACE] postMessage: sending completeData (${buffer.length} bytes) at ${Date.now()}`);
        panel.webview.postMessage({
          command: 'completeData',
          data: new Uint8Array(buffer)
        });
        console.log(`[DEBUG-TRACE] postMessage: sent successfully at ${Date.now()}`);
      } catch (e) {
        console.log(`[DEBUG-TRACE] postMessage: FAILED with error:`, e);
      }
    }, 0);
  } catch (error) {
    console.error("Error drawing Mat image:", error);
    throw error;
  }
}

// Get Mat info from LLDB variables request
export async function getMatInfoFromVariables(
  debugSession: vscode.DebugSession,
  variablesReference: number
): Promise<{ rows: number; cols: number; channels: number; depth: number; dataPtr: string }> {
  // Get the children of the Mat variable
  console.log("Getting Mat variables from reference:", variablesReference);
  const varsResponse = await debugSession.customRequest("variables", {
    variablesReference: variablesReference
  });
  
  console.log("Mat variables count:", varsResponse.variables.length);
  for (const v of varsResponse.variables) {
    console.log(`  ${v.name} = ${v.value} (memRef: ${v.memoryReference}, varRef: ${v.variablesReference})`);
  }
  
  let rows = 0, cols = 0, channels = 1, depth = 0, dataPtr = "";
  let flags = 0;
  
  // Check if this is a cv::Mat_<T> with an internal cv::Mat member
  // For cv::Mat_<T>, the actual Mat data is stored in an internal cv::Mat member
  for (const v of varsResponse.variables) {
    const name = v.name;
    const value = v.value;
    
    // If we find a cv::Mat member (for cv::Mat_<T>), recursively get its info
    if (name === "cv::Mat" || name.includes("cv::Mat") || (name === "Mat" && value.includes("rows"))) {
      console.log(`Found internal Mat member: ${name}, recursively getting info...`);
      if (v.variablesReference > 0) {
        const innerMatInfo = await getMatInfoFromVariables(debugSession, v.variablesReference);
        rows = innerMatInfo.rows;
        cols = innerMatInfo.cols;
        channels = innerMatInfo.channels;
        depth = innerMatInfo.depth;
        dataPtr = innerMatInfo.dataPtr;
        console.log(`Got Mat info from internal Mat member: ${rows}x${cols}, ${channels} channels, depth=${depth}, dataPtr=${dataPtr}`);
        // Return immediately if we got info from internal Mat
        if (rows > 0 && cols > 0 && dataPtr) {
          return { rows, cols, channels, depth, dataPtr };
        }
      }
    }
  }
  
  // If not a cv::Mat_<T> or recursive lookup failed, try direct members
  for (const v of varsResponse.variables) {
    const name = v.name;
    const value = v.value;
    
    if (name === "rows") {
      rows = parseInt(value);
    } else if (name === "cols") {
      cols = parseInt(value);
    } else if (name === "data") {
      // Try multiple ways to get the data pointer
      // 1. First check if memoryReference is available (most reliable)
      if (v.memoryReference) {
        dataPtr = v.memoryReference;
        console.log("Got data pointer from memoryReference:", dataPtr);
      } 
      // 2. Try to extract from value string
      else {
        const ptrMatch = value.match(/0x[0-9a-fA-F]+/);
        if (ptrMatch) {
          dataPtr = ptrMatch[0];
          console.log("Got data pointer from value:", dataPtr);
        }
      }
      // 3. If still no pointer and has variablesReference, try to expand
      if (!dataPtr && v.variablesReference > 0) {
        try {
          const dataVars = await debugSession.customRequest("variables", {
            variablesReference: v.variablesReference
          });
          console.log("Expanded data variable:", dataVars.variables.map((x: any) => x.name + "=" + x.value));
          // Look for __ptr or raw pointer value
          for (const dv of dataVars.variables) {
            if (dv.memoryReference) {
              dataPtr = dv.memoryReference;
              console.log("Got data pointer from expanded memoryReference:", dataPtr);
              break;
            }
            const ptrMatch2 = dv.value?.match(/0x[0-9a-fA-F]+/);
            if (ptrMatch2) {
              dataPtr = ptrMatch2[0];
              console.log("Got data pointer from expanded value:", dataPtr);
              break;
            }
          }
        } catch (e) {
          console.log("Failed to expand data variable:", e);
        }
      }
      console.log("Final extracted data pointer:", dataPtr, "from value:", value);
    } else if (name === "flags") {
      flags = parseInt(value);
      // Extract depth and channels from flags
      // OpenCV flags format: lower 12 bits contain the type
      // type = depth | ((channels - 1) << 3)
      // CV_MAT_TYPE_MASK = 0xFFF
      const type = flags & 0xFFF;
      depth = type & 7;  // CV_MAT_DEPTH_MASK = 7
      channels = ((type >> 3) & 63) + 1;  // ((type >> 3) & 63) gives (channels - 1)
      console.log(`Extracted from flags ${flags} (0x${flags.toString(16)}): type=0x${type.toString(16)}, depth=${depth}, channels=${channels}`);
    }
  }
  
  // If channels wasn't found properly, try to infer from type string
  if (channels === 1 && flags > 0) {
    // Check if it's likely a color image based on common formats
    // CV_8UC3 has flags where channel info might be encoded differently
    console.log("Warning: channels might be incorrect, defaulting to inferred value");
  }
  
  console.log(`Final Mat info: rows=${rows}, cols=${cols}, channels=${channels}, depth=${depth}, dataPtr=${dataPtr}`);
  return { rows, cols, channels, depth, dataPtr };
}

// Read Mat data using single readMemory call (fastest)
export async function readMatDataFast(
  debugSession: vscode.DebugSession,
  dataExp: string,
  frameId: number,
  dataSize: number,
  depth: number,
  progress: vscode.Progress<{ message?: string; increment?: number }>
): Promise<{ buffer: Buffer | null }> {
  const bytesPerElement = getBytesPerElement(depth);
  const totalBytes = dataSize * bytesPerElement;
  
  console.log(`readMatDataFast: dataSize=${dataSize}, depth=${depth}, totalBytes=${totalBytes}`);
  progress.report({ message: "Getting data pointer..." });
  
  // Get the data pointer address
  let dataPtr: string | null = null;
  try {
    const dataPointerResponse = await evaluateWithTimeout(
      debugSession,
      dataExp,
      frameId,
      5000
    );
    
    const ptrMatch = dataPointerResponse.result.match(/0x[0-9a-fA-F]+/);
    if (ptrMatch) {
      dataPtr = ptrMatch[0];
    }
  } catch (e) {
    console.log("Failed to get data pointer:", e);
  }
  
  if (!dataPtr) {
    vscode.window.showErrorMessage("Cannot get data pointer from Mat");
    return { buffer: null };
  }
  
  console.log(`Data pointer: ${dataPtr}, reading ${totalBytes} bytes in chunked requests`);
  progress.report({ message: `Reading ${totalBytes} bytes...` });
  
  // Chunked readMemory calls for ALL data
  try {
    const buffer = await readMemoryChunked(debugSession, dataPtr, totalBytes, progress);
    
    if (buffer) {
      console.log(`Read complete: ${buffer.length} bytes`);
      return { buffer };
    } else {
      vscode.window.showErrorMessage("readMemory returned no data");
      return { buffer: null };
    }
  } catch (e: any) {
    console.log("readMemory error:", e.message || e);
    vscode.window.showErrorMessage(
      `readMemory failed: ${e.message || e}. Please use cppvsdbg or lldb.`
    );
    return { buffer: null };
  }
}

// Read Mat data for LLDB using single readMemory call
export async function readMatDataForLLDB(
  debugSession: vscode.DebugSession,
  dataPtr: string,
  frameId: number,
  dataSize: number,
  depth: number,
  progress: vscode.Progress<{ message?: string; increment?: number }>
): Promise<{ buffer: Buffer | null }> {
  const bytesPerElement = getBytesPerElement(depth);
  const totalBytes = dataSize * bytesPerElement;
  
  console.log(`LLDB readMatDataForLLDB: dataPtr=${dataPtr}, dataSize=${dataSize}, depth=${depth}, totalBytes=${totalBytes}`);
  
  if (!dataPtr || dataPtr === "") {
    console.log("LLDB: No data pointer available");
    vscode.window.showErrorMessage("Cannot read Mat data: data pointer is null");
    return { buffer: null };
  }
  
  console.log(`LLDB: Reading ${totalBytes} bytes in chunked requests`);
  progress.report({ message: `Reading ${totalBytes} bytes...` });
  
  // Chunked readMemory calls for ALL data
  try {
    const buffer = await readMemoryChunked(debugSession, dataPtr, totalBytes, progress);
    
    if (buffer) {
      console.log(`LLDB: Read complete: ${buffer.length} bytes`);
      return { buffer };
    } else {
      vscode.window.showErrorMessage("LLDB readMemory returned no data");
      return { buffer: null };
    }
  } catch (e: any) {
    console.log("LLDB readMemory error:", e.message || e);
    vscode.window.showWarningMessage(
      `LLDB readMemory failed: ${e.message || e}. Creating placeholder image.`
    );
    return { buffer: null };
  }
}

// Function to draw cv::Matx (fixed-size matrix)
export async function drawMatxImage(
  debugSession: vscode.DebugSession,
  variableInfo: any,
  frameId: number,
  variableName: string,
  matxInfo: { isMatx: boolean; rows: number; cols: number; depth: number },
  reveal: boolean = true,
  force: boolean = false,
  panelVariableName?: string
) {
  // Use panelVariableName for panel management, variableName for data access
  const panelName = panelVariableName || variableName;
  
  try {
    const { rows, cols, depth } = matxInfo;
    const channels = 1; // Matx is always single-channel (the element type determines this)
    const dataSize = rows * cols;
    const bytesPerElement = getBytesPerElement(depth);
    const totalBytes = dataSize * bytesPerElement;
    
    console.log(`Drawing Matx image: ${rows}x${cols}, depth=${depth}, totalBytes=${totalBytes}`);
    
    const panelTitle = `View: ${panelName}`;
    
    // Get data pointer from the 'val' member of Matx
    let dataPtr: string | null = null;
    
    // Try to get the val member's address
    // Matx stores data in: T val[m*n]
    const valExpressions = [
      `&${variableName}.val[0]`,
      `(void*)&${variableName}.val[0]`,
      `${variableName}.val`
    ];
    
    for (const expr of valExpressions) {
      try {
        const valResp = await debugSession.customRequest("evaluate", {
          expression: expr,
          frameId,
          context: "watch"
        });
        const ptrMatch = valResp.result?.match(/0x[0-9a-fA-F]+/);
        if (ptrMatch) {
          dataPtr = ptrMatch[0];
          console.log(`Got Matx data pointer via ${expr}: ${dataPtr}`);
          break;
        }
      } catch (e) {
        console.log(`Failed to get Matx data pointer via ${expr}`);
      }
    }
    
    // Fallback: try to get from variablesReference
    if (!dataPtr && variableInfo.variablesReference > 0) {
      try {
        const varsResp = await debugSession.customRequest("variables", {
          variablesReference: variableInfo.variablesReference
        });
        for (const v of varsResp.variables) {
          if (v.name === "val") {
            if (v.memoryReference) {
              dataPtr = v.memoryReference;
              console.log("Got Matx data pointer from val.memoryReference:", dataPtr);
              break;
            }
            const ptrMatch = v.value?.match(/0x[0-9a-fA-F]+/);
            if (ptrMatch) {
              dataPtr = ptrMatch[0];
              console.log("Got Matx data pointer from val.value:", dataPtr);
              break;
            }
            // Try to expand val array
            if (v.variablesReference > 0) {
              const valVars = await debugSession.customRequest("variables", {
                variablesReference: v.variablesReference
              });
              if (valVars.variables.length > 0) {
                const firstElem = valVars.variables[0];
                if (firstElem.memoryReference) {
                  dataPtr = firstElem.memoryReference;
                  console.log("Got Matx data pointer from val[0].memoryReference:", dataPtr);
                  break;
                }
              }
            }
          }
        }
      } catch (e) {
        console.log("Failed to get Matx data pointer from variablesReference:", e);
      }
    }
    
    if (!dataPtr) {
      throw new Error("Cannot get data pointer from Matx. Make sure it's a valid cv::Matx.");
    }
    
    // Check if panel is fresh
    const sample = await getMemorySample(debugSession, dataPtr, totalBytes);
    const stateToken = `${rows}|${cols}|${channels}|${depth}|${dataPtr}|${sample}`;
    
    const panel = PanelManager.getOrCreatePanel(
      "MatImageViewer",
      panelTitle,
      debugSession.id,
      panelName,
      reveal,
      dataPtr  // Enable sharing panels by data pointer
    );

    if (!force && PanelManager.isPanelFresh("MatImageViewer", debugSession.id, panelName, stateToken)) {
      console.log(`Matx panel is already up-to-date with token: ${stateToken}`);
      return;
    }
    
    // Read data with progress indicator
    const dataResult = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Loading cv::Matx (${rows}x${cols})`,
        cancellable: false
      },
      async (progress) => {
        progress.report({ message: `Reading ${totalBytes} bytes...` });
        const buffer = await readMemoryChunked(debugSession, dataPtr!, totalBytes, progress);
        return { buffer };
      }
    );
    
    // Update state token
    PanelManager.updateStateToken("MatImageViewer", debugSession.id, panelName, stateToken);
    
    // If panel already has content, only send data
    if (panel.webview.html && panel.webview.html.length > 0) {
      console.log("Matx panel already has HTML, sending only data");
      
      // Check if panel is being disposed before sending data
      if ((panel as any)._isDisposing) {
        console.log("[drawMatxImage] Aborting data send - panel is being disposed");
        return;
      }
      
      const buffer = dataResult.buffer;
      if (buffer) {
        // CRITICAL: Don't await postMessage - it can block and cause debug freeze
        try {
          // Fire and forget - don't await
          panel.webview.postMessage({
            command: 'completeData',
            data: new Uint8Array(buffer),
            rows, cols, channels, depth
          });
        } catch (e) {
          console.log("[drawMatxImage] postMessage failed - panel likely disposed");
          return;
        }
        return;
      }
    }
    
    panel.webview.html = getWebviewContentForMat(
      panel.webview,
      rows,
      cols,
      channels,
      depth,
      { base64: "" }
    );
    
    // Send ready signal immediately so webview knows this is not a moved panel
    panel.webview.postMessage({ command: 'ready' });
    
    SyncManager.registerPanel(panelName, panel);
    
    if ((panel as any)._syncListener) {
      (panel as any)._syncListener.dispose();
    }
    
    (panel as any)._syncListener = panel.webview.onDidReceiveMessage(
      async (message) => {
        if (message.command === 'viewChanged') {
          SyncManager.syncView(variableName, message.state);
        } else if (message.command === 'reload') {
          // Check if debug session is still active before reloading
          const currentSession = vscode.debug.activeDebugSession;
          if (currentSession && currentSession.id === debugSession.id && !(panel as any)._isDisposing) {
            // CRITICAL: Fire-and-forget - don't await to avoid blocking
            Promise.resolve(vscode.commands.executeCommand('cv-debugmate.viewVariable', { name: variableName, evaluateName: variableName, skipToken: true }))
              .then(() => console.log(`[DEBUG-TRACE] Matx reload completed`))
              .catch((e: Error) => console.log(`[DEBUG-TRACE] Matx reload failed:`, e));
          } else {
            console.log('Skipping reload - debug session is no longer active or has changed');
          }
        }
      }
    );
    
    const buffer = dataResult.buffer;
    if (!buffer) {
      throw new Error("Failed to read Matx data");
    }
    
    console.log(`Sending ${buffer.length} bytes to Matx webview`);
    
    // CRITICAL: Don't await postMessage - it can block and cause debug freeze
    if ((panel as any)._isDisposing) {
      console.log("[drawMatxImage] Aborting final data send - panel is being disposed");
      return;
    }
    
    try {
      // Fire and forget - don't await
      panel.webview.postMessage({
        command: 'completeData',
        data: new Uint8Array(buffer)
      });
    } catch (e) {
      console.log("[drawMatxImage] Final postMessage failed - panel likely disposed");
      return;
    }
    
    console.log('Matx data sent to webview');
  } catch (error) {
    console.error("Error drawing Matx image:", error);
    throw error;
  }
}

// Function to draw 2D std::array as an image
export async function draw2DStdArrayImage(
  debugSession: vscode.DebugSession,
  variableInfo: any,
  frameId: number,
  variableName: string,
  arrayInfo: { is2DArray: boolean; rows: number; cols: number; elementType: string; depth: number },
  reveal: boolean = true,
  force: boolean = false,
  panelVariableName?: string
) {
  // Use panelVariableName for panel management, variableName for data access
  const panelName = panelVariableName || variableName;
  
  try {
    const { rows, cols, depth } = arrayInfo;
    const channels = 1; // 2D array is treated as single-channel
    const dataSize = rows * cols;
    const bytesPerElement = getBytesPerElement(depth);
    const totalBytes = dataSize * bytesPerElement;
    
    console.log(`[DEBUG-TRACE] draw2DStdArrayImage START at ${Date.now()}: ${rows}x${cols}, depth=${depth}, totalBytes=${totalBytes}`);
    
    const panelTitle = `View: ${panelName}`;
    
    // Get data pointer
    // Determine if this is a C-style array or std::array based on type information
    const isCStyleArray = variableInfo.type && /\s*\[\s*\d+\s*\]\s*\[\s*\d+\s*\]/.test(variableInfo.type);
    let dataPtr: string | null;
    console.log(`[DEBUG-TRACE] draw2DStdArrayImage: getting data pointer at ${Date.now()}`);
    if (isCStyleArray) {
      dataPtr = await getCStyle2DArrayDataPointer(debugSession, variableName, frameId, variableInfo);
    } else {
      dataPtr = await get2DStdArrayDataPointer(debugSession, variableName, frameId, variableInfo);
    }
    console.log(`[DEBUG-TRACE] draw2DStdArrayImage: got data pointer at ${Date.now()}, dataPtr=${dataPtr}`);
    
    if (!dataPtr) {
      throw new Error("Cannot get data pointer from 2D std::array. Make sure it's a valid std::array.");
    }
    
    // Check if panel is fresh
    console.log(`[DEBUG-TRACE] draw2DStdArrayImage: getting memory sample at ${Date.now()}`);
    const sample = await getMemorySample(debugSession, dataPtr, totalBytes);
    console.log(`[DEBUG-TRACE] draw2DStdArrayImage: got memory sample at ${Date.now()}`);
    const stateToken = `${rows}|${cols}|${channels}|${depth}|${dataPtr}|${sample}`;
    
    console.log(`[DEBUG-TRACE] draw2DStdArrayImage: getting/creating panel at ${Date.now()}`);
    const panel = PanelManager.getOrCreatePanel(
      "MatImageViewer",
      panelTitle,
      debugSession.id,
      panelName,
      reveal,
      dataPtr  // Enable sharing panels by data pointer
    );
    console.log(`[DEBUG-TRACE] draw2DStdArrayImage: got panel at ${Date.now()}, isDisposing=${(panel as any)._isDisposing}`);

    // CRITICAL: Check if panel was disposed during async operations
    if ((panel as any)._isDisposing) {
      console.log(`[DEBUG-TRACE] draw2DStdArrayImage: ABORTING - panel was disposed during data pointer fetch`);
      return;
    }

    if (!force && PanelManager.isPanelFresh("MatImageViewer", debugSession.id, panelName, stateToken)) {
      console.log(`2D std::array panel is already up-to-date with token: ${stateToken}`);
      return;
    }
    
    // Read data with progress indicator
    console.log(`[DEBUG-TRACE] draw2DStdArrayImage: starting readMemoryChunked at ${Date.now()}`);
    const dataResult = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Loading 2D std::array (${rows}x${cols})`,
        cancellable: false
      },
      async (progress) => {
        progress.report({ message: `Reading ${totalBytes} bytes...` });
        const buffer = await readMemoryChunked(debugSession, dataPtr!, totalBytes, progress);
        return { buffer };
      }
    );
    console.log(`[DEBUG-TRACE] draw2DStdArrayImage: readMemoryChunked completed at ${Date.now()}, isDisposing=${(panel as any)._isDisposing}`);
    
    // CRITICAL: Check if panel was disposed during memory read
    if ((panel as any)._isDisposing) {
      console.log(`[DEBUG-TRACE] draw2DStdArrayImage: ABORTING - panel was disposed during memory read`);
      return;
    }
    
    // Update state token
    PanelManager.updateStateToken("MatImageViewer", debugSession.id, panelName, stateToken);
    
    // If panel already has content, only send data
    if (panel.webview.html && panel.webview.html.length > 0) {
      console.log(`[DEBUG-TRACE] draw2DStdArrayImage: panel already has HTML, sending only data at ${Date.now()}`);
      
      // Check if panel is being disposed before sending data
      if ((panel as any)._isDisposing) {
        console.log("[draw2DStdArrayImage] Aborting data send - panel is being disposed");
        return;
      }
      
      const buffer = dataResult.buffer;
      if (buffer) {
        // CRITICAL: Use setTimeout to defer postMessage, giving VS Code time to process events
        const panelRef = panel;
        setTimeout(() => {
          if ((panelRef as any)._isDisposing) {
            console.log("[draw2DStdArrayImage] Aborting deferred data send - panel is being disposed");
            return;
          }
          try {
            console.log(`[DEBUG-TRACE] draw2DStdArrayImage: sending deferred postMessage at ${Date.now()}`);
            panelRef.webview.postMessage({
              command: 'completeData',
              data: new Uint8Array(buffer),
              rows, cols, channels, depth
            });
          } catch (e) {
            console.log("[draw2DStdArrayImage] Deferred postMessage failed - panel likely disposed");
          }
        }, 0);
        return;
      }
    }
    
    panel.webview.html = getWebviewContentForMat(
      panel.webview,
      rows,
      cols,
      channels,
      depth,
      { base64: "" }
    );
    
    // Send ready signal immediately so webview knows this is not a moved panel
    panel.webview.postMessage({ command: 'ready' });
    
    SyncManager.registerPanel(panelName, panel);
    
    if ((panel as any)._syncListener) {
      (panel as any)._syncListener.dispose();
    }
    
    (panel as any)._syncListener = panel.webview.onDidReceiveMessage(
      async (message) => {
        if (message.command === 'viewChanged') {
          SyncManager.syncView(variableName, message.state);
        } else if (message.command === 'reload') {
          // Check if debug session is still active before reloading
          const currentSession = vscode.debug.activeDebugSession;
          if (currentSession && currentSession.id === debugSession.id && !(panel as any)._isDisposing) {
            // CRITICAL: Fire-and-forget - don't await to avoid blocking
            Promise.resolve(vscode.commands.executeCommand('cv-debugmate.viewVariable', { name: variableName, evaluateName: variableName, skipToken: true }))
              .then(() => console.log(`[DEBUG-TRACE] 2D array reload completed`))
              .catch((e: Error) => console.log(`[DEBUG-TRACE] 2D array reload failed:`, e));
          } else {
            console.log('Skipping reload - debug session is no longer active or has changed');
          }
        }
      }
    );
    
    const buffer = dataResult.buffer;
    if (!buffer) {
      throw new Error("Failed to read 2D std::array data");
    }
    
    console.log(`Sending ${buffer.length} bytes to 2D std::array webview`);
    
    // CRITICAL: Don't await postMessage - it can block and cause debug freeze
    if ((panel as any)._isDisposing) {
      console.log("[draw2DStdArrayImage] Aborting final data send - panel is being disposed");
      return;
    }
    
    try {
      // Fire and forget - don't await
      panel.webview.postMessage({
        command: 'completeData',
        data: new Uint8Array(buffer)
      });
    } catch (e) {
      console.log("[draw2DStdArrayImage] Final postMessage failed - panel likely disposed");
      return;
    }
    
    console.log('2D std::array data sent to webview');
  } catch (error) {
    console.error("Error drawing 2D std::array image:", error);
    throw error;
  }
}



// Function to draw 3D array as a multi-channel image
export async function draw3DArrayImage(
  debugSession: vscode.DebugSession,
  variableInfo: any,
  frameId: number,
  variableName: string,
  arrayInfo: { 
    is3DArray: boolean; 
    height: number; 
    width: number; 
    channels: number; 
    elementType: string; 
    depth: number 
  },
  reveal: boolean = true,
  force: boolean = false,
  panelVariableName?: string
) {
  // Use panelVariableName for panel management, variableName for data access
  const panelName = panelVariableName || variableName;
  
  try {
    const { height, width, channels, depth } = arrayInfo;
    const rows = height;
    const cols = width;
    const dataSize = height * width * channels;
    const bytesPerElement = getBytesPerElement(depth);
    const totalBytes = dataSize * bytesPerElement;
    
    console.log(`Drawing 3D array image: ${height}x${width}x${channels}, depth=${depth}, elementType=${arrayInfo.elementType}, bytesPerElement=${bytesPerElement}, totalBytes=${totalBytes}`);
    
    // Check for empty array
    if (height === 0 || width === 0 || channels === 0) {
      vscode.window.showInformationMessage("3D array is empty");
      return;
    }
    
    const panelTitle = `View: ${panelName}`;
    
    // Determine if this is a C-style array or std::array based on type information
    const isCStyleArray = variableInfo.type && /\[\s*\d+\s*\]\s*\[\s*\d+\s*\]\s*\[\s*\d+\s*\]/.test(variableInfo.type);
    const isStdArray = !isCStyleArray;
    
    // Get data pointer using the 3D array specific function
    const dataPtr = await get3DArrayDataPointer(debugSession, variableName, frameId, variableInfo, isStdArray);
    
    if (!dataPtr) {
      throw new Error("Cannot get data pointer from 3D array. Make sure it's a valid 3D array.");
    }
    
    // Check if panel is fresh
    const sample = await getMemorySample(debugSession, dataPtr, totalBytes);
    const stateToken = `${rows}|${cols}|${channels}|${depth}|${dataPtr}|${sample}`;
    
    const panel = PanelManager.getOrCreatePanel(
      "MatImageViewer",
      panelTitle,
      debugSession.id,
      panelName,
      reveal,
      dataPtr  // Enable sharing panels by data pointer
    );

    if (!force && PanelManager.isPanelFresh("MatImageViewer", debugSession.id, panelName, stateToken)) {
      console.log(`3D array panel is already up-to-date with token: ${stateToken}`);
      return;
    }
    
    // Read data with progress indicator
    const dataResult = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Loading 3D array (${height}x${width}x${channels})`,
        cancellable: false
      },
      async (progress) => {
        progress.report({ message: `Reading ${totalBytes} bytes...` });
        const buffer = await readMemoryChunked(debugSession, dataPtr!, totalBytes, progress);
        return { buffer };
      }
    );
    
    // Update state token
    PanelManager.updateStateToken("MatImageViewer", debugSession.id, panelName, stateToken);
    
    // If panel already has content, only send data to preserve view state (zoom/pan)
    if (panel.webview.html && panel.webview.html.length > 0) {
      console.log("3D array panel already has HTML, sending only data to preserve view state");
      
      // Check if panel is being disposed before sending data
      if ((panel as any)._isDisposing) {
        console.log("[draw3DArrayImage] Aborting data send - panel is being disposed");
        return;
      }
      
      const buffer = dataResult.buffer;
      if (buffer) {
        // CRITICAL: Don't await postMessage - it can block and cause debug freeze
        try {
          // Fire and forget - don't await
          panel.webview.postMessage({
            command: 'completeData',
            data: new Uint8Array(buffer),
            rows, cols, channels, depth
          });
        } catch (e) {
          console.log("[draw3DArrayImage] postMessage failed - panel likely disposed");
          return;
        }
        return;
      }
    }
    
    panel.webview.html = getWebviewContentForMat(
      panel.webview,
      rows,
      cols,
      channels,
      depth,
      { base64: "" }
    );
    
    // Send ready signal immediately so webview knows this is not a moved panel
    panel.webview.postMessage({ command: 'ready' });
    
    SyncManager.registerPanel(panelName, panel);
    
    // Dispose previous listener if it exists to avoid multiple listeners on reused panel
    if ((panel as any)._syncListener) {
      (panel as any)._syncListener.dispose();
    }
    
    (panel as any)._syncListener = panel.webview.onDidReceiveMessage(
      async (message) => {
        if (message.command === 'viewChanged') {
          SyncManager.syncView(panelName, message.state);
        } else if (message.command === 'reload') {
          const reloadStartTime = Date.now();
          console.log(`[DEBUG-TRACE] 3D array reload message received for ${panelName} at ${reloadStartTime}`);
          
          // Check if debug session is still active before reloading
          const currentSession = vscode.debug.activeDebugSession;
          if (currentSession && currentSession.id === debugSession.id && !(panel as any)._isDisposing) {
            console.log(`[DEBUG-TRACE] 3D array reload: starting executeCommand (fire-and-forget) at ${Date.now()}`);
            // CRITICAL: Fire-and-forget - don't await to avoid blocking
            Promise.resolve(vscode.commands.executeCommand('cv-debugmate.viewVariable', { name: panelName, evaluateName: variableName, skipToken: true }))
              .then(() => console.log(`[DEBUG-TRACE] 3D array reload: executeCommand completed at ${Date.now()} (took ${Date.now() - reloadStartTime}ms)`))
              .catch((e: Error) => console.log(`[DEBUG-TRACE] 3D array reload: executeCommand failed:`, e));
          } else {
            console.log('Skipping reload - debug session is no longer active or has changed');
          }
          
          console.log(`[DEBUG-TRACE] 3D array reload handler finished for ${panelName} at ${Date.now()}`);
        }
      }
    );
    
    const buffer = dataResult.buffer;
    if (!buffer) {
      throw new Error("Failed to read 3D array data");
    }
    
    console.log(`[DEBUG-TRACE] 3D array: Sending ${buffer.length} bytes to webview at ${Date.now()}`);
    
    // CRITICAL: Don't await postMessage - it can block and cause debug freeze
    if ((panel as any)._isDisposing) {
      console.log("[DEBUG-TRACE] 3D array: Aborting final data send - panel is being disposed");
      return;
    }
    
    try {
      // Fire and forget - don't await
      console.log(`[DEBUG-TRACE] 3D array: postMessage starting at ${Date.now()}`);
      panel.webview.postMessage({
        command: 'completeData',
        data: new Uint8Array(buffer),
        rows, cols, channels, depth
      });
      console.log(`[DEBUG-TRACE] 3D array: postMessage completed at ${Date.now()}`);
    } catch (e) {
      console.log("[DEBUG-TRACE] 3D array: postMessage FAILED:", e);
      return;
    }
    
    console.log(`[DEBUG-TRACE] 3D array data sent to webview at ${Date.now()}`);
  } catch (error) {
    console.error("Error drawing 3D array image:", error);
    throw error;
  }
}
