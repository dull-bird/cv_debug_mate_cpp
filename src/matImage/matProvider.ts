import * as vscode from "vscode";
import { 
  evaluateWithTimeout, 
  isUsingLLDB, 
  readMemoryChunked 
} from "../utils/debugger";
import { getBytesPerElement } from "../utils/opencv";
import { getWebviewContentForMat } from "./matWebview";
import { PanelManager } from "../utils/panelManager";

// Function to draw the cv::Mat image
export async function drawMatImage(
  debugSession: vscode.DebugSession,
  variableInfo: any,
  frameId: number,
  variableName: string
) {
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

    // Show the webview to visualize the matrix as an image
    const panelTitle = `View: cv::Mat ${variableName}`;
    const panel = PanelManager.getOrCreatePanel(
      "MatImageViewer",
      panelTitle,
      debugSession.id,
      variableName
    );
    
    panel.webview.html = getWebviewContentForMat(
      panel.webview,
      rows,
      cols,
      channels,
      depth,
      { base64: "" } // Don't embed data directly, send via message
    );

    // Send complete data at once to webview (webview has its own memory space)
    const buffer = dataResult.buffer;
    if (!buffer) {
        throw new Error("Failed to read Mat data");
    }
    const totalLength = buffer.length;

    console.log(`Sending ${totalLength} bytes to webview at once`);

    await panel.webview.postMessage({
      command: 'completeData',
      data: new Uint8Array(buffer)
    });

    console.log('Complete data sent to webview');
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

