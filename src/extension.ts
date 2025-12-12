import * as vscode from "vscode";
import * as path from "path";

// Get the appropriate evaluate context for the debugger type
function getEvaluateContext(debugSession: vscode.DebugSession): string {
  // CodeLLDB treats "repl" as command mode, use "watch" for expression evaluation
  if (debugSession.type === "lldb") {
    return "watch";
  }
  // For cppdbg and cppvsdbg, "repl" works fine
  return "repl";
}

async function evaluateWithTimeout(
  debugSession: vscode.DebugSession,
  expression: string,
  frameId: number,
  timeout: number
): Promise<any> {
  const context = getEvaluateContext(debugSession);
  
  return Promise.race([
    debugSession.customRequest("evaluate", {
      expression: expression,
      frameId: frameId,
      context: context,
    }),
    new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error("Evaluation request timed out")),
        timeout
      )
    ),
  ]);
}

export function activate(context: vscode.ExtensionContext) {
  console.log('Extension "vectorPoint3fViewer" is now active.');

  // Register the command to visualize the vector of cv::Point3f or cv::Mat
  let disposable = vscode.commands.registerCommand(
    "extension.viewVariable",
    async (selectedVariable: any) => {
      console.log("========== OpenCV Visualizer Start ==========");
      console.log("Raw selectedVariable:", JSON.stringify(selectedVariable, null, 2));
      
      const debugSession = vscode.debug.activeDebugSession;

      if (!debugSession) {
        vscode.window.showErrorMessage("No active debug session.");
        return;
      }

      try {
        // Access the nested 'variable' property
        const variable = selectedVariable.variable;
        
        console.log("--- Variable Info ---");
        console.log("variable.name:", variable?.name);
        console.log("variable.value:", variable?.value);
        console.log("variable.type:", variable?.type);
        console.log("variable.evaluateName:", variable?.evaluateName);
        console.log("variable.variablesReference:", variable?.variablesReference);
        console.log("variable.memoryReference:", variable?.memoryReference);

        if (!variable || (!variable.name && !variable.evaluateName)) {
          vscode.window.showErrorMessage("No variable selected.");
          console.log("ERROR: No variable selected");
          return;
        }

        // Get the current thread and stack frame
        console.log("--- Getting Thread and Frame ---");
        const threadsResponse = await debugSession.customRequest("threads");
        console.log("Threads:", threadsResponse.threads.map((t: any) => ({ id: t.id, name: t.name })));
        const threadId = threadsResponse.threads[0].id;
        
        const stackTraceResponse = await debugSession.customRequest(
          "stackTrace",
          {
            threadId: threadId,
            startFrame: 0,
            levels: 5,
          }
        );
        console.log("Stack frames:", stackTraceResponse.stackFrames.map((f: any) => ({ id: f.id, name: f.name })));
        const frameId = stackTraceResponse.stackFrames[0].id;
        console.log("Using frameId:", frameId);

        // For LLDB, the variable object from context menu already contains type info
        // We can use it directly instead of re-evaluating
        const isLLDB = debugSession.type === "lldb";
        let variableInfo: any;
        let variableName = variable.evaluateName || variable.name;
        
        console.log("--- Debug Session Info ---");
        console.log("debugSession.type:", debugSession.type);
        console.log("debugSession.name:", debugSession.name);
        console.log("isLLDB:", isLLDB);
        console.log("variableName:", variableName);
        
        if (isLLDB) {
          // For LLDB, NEVER use evaluate - it doesn't work properly
          // Use the variable info directly from the context menu
          console.log("--- LLDB Mode: Using direct variable info ---");
          variableInfo = {
            result: variable.value,
            type: variable.type,
            variablesReference: variable.variablesReference,
            evaluateName: variableName
          };
          console.log("Constructed variableInfo:", JSON.stringify(variableInfo, null, 2));
        } else {
          // For other debuggers (cppdbg, cppvsdbg), evaluate the variable
          console.log("--- Non-LLDB Mode: Using evaluate ---");
          const evalContext = getEvaluateContext(debugSession);
          console.log("evalContext:", evalContext);
          variableInfo = await debugSession.customRequest("evaluate", {
            expression: variableName,
            frameId: frameId,
            context: evalContext,
          });
          console.log("Evaluate result:", JSON.stringify(variableInfo, null, 2));
        }

        // Check the type of the variable
        console.log("--- Type Checking ---");
        const isPoint3f = isPoint3fVector(variableInfo);
        const isMatType = isMat(variableInfo);
        console.log("isPoint3fVector:", isPoint3f);
        console.log("isMat:", isMatType);
        
        if (isPoint3f) {
          // If it's a vector of cv::Point3f, draw the point cloud
          console.log("==> Drawing Point Cloud");
          await drawPointCloud(debugSession, variableInfo);
        } else if (isMatType) {
          // If it's a cv::Mat, draw the image
          console.log("==> Drawing Mat Image");
          await drawMatImage(debugSession, variableInfo, frameId, variableName);
        } else {
          vscode.window.showErrorMessage(
            "Variable is neither a vector of cv::Point3f nor a cv::Mat."
          );
          console.log("ERROR: Variable type not recognized. Type:", variableInfo.type);
        }
        
        console.log("========== OpenCV Visualizer End ==========");
      } catch (error: any) {
        vscode.window.showErrorMessage(`Error: ${error.message || error}`);
        console.log("ERROR during execution:", error);
        console.log("Error stack:", error.stack);
      }
    }
  );

  context.subscriptions.push(disposable);
}

// Function to check if the variable is a vector of cv::Point3f
function isPoint3fVector(variableInfo: any): boolean {
  console.log("Checking if variable is Point3f vector");
  const type = variableInfo.type || "";
  console.log("Variable type string:", type);
  
  const result = 
    type.includes("std::vector<cv::Point3f>") ||
    type.includes("std::vector<cv::Point3_<float>") ||
    type.includes("std::vector<cv::Point3d>") ||
    type.includes("std::vector<cv::Point3_<double>") ||
    // LLDB format
    type.includes("std::__1::vector<cv::Point3_<float>") ||
    type.includes("std::__1::vector<cv::Point3_<double>") ||
    // cppdbg format
    type.includes("class std::vector<class cv::Point3_<float>") ||
    type.includes("class std::vector<class cv::Point3_<double>") ||
    // Generic format for both LLDB and VS
    /std::.*vector\s*<\s*cv::Point3[fd]?\s*>/.test(type);
  
  console.log("isPoint3fVector result:", result);
  return result;
}

// Function to check if the variable is a cv::Mat
function isMat(variableInfo: any): boolean {
  console.log("Checking if variable is Mat");
  const type = variableInfo.type || "";
  console.log("Variable type string:", type);
  
  const result = 
    type.includes("cv::Mat") ||
    // LLDB format sometimes includes namespace
    type.includes("class cv::Mat") ||
    // cppdbg format
    type.includes("class cv::Mat") ||
    // Generic format
    /cv::Mat\b/.test(type);
  
  console.log("isMat result:", result);
  return result;
}

// Helper function to check if we're using LLDB
function isUsingLLDB(debugSession: vscode.DebugSession): boolean {
  return debugSession.type === "lldb";
}

// Helper function to check if we're using cppdbg
function isUsingCppdbg(debugSession: vscode.DebugSession): boolean {
  return debugSession.type === "cppdbg";
}

// Function to draw point cloud
async function drawPointCloud(debugSession: vscode.DebugSession, variableInfo: any) {
  try {
    const usingLLDB = isUsingLLDB(debugSession);
    const usingCppdbg = isUsingCppdbg(debugSession);
    console.log("Drawing point cloud with debugger type:", debugSession.type);
    console.log("Using LLDB mode:", usingLLDB);
    console.log("Using cppdbg mode:", usingCppdbg);

    // Get the number of elements in the vector
    const sizeResponse = await evaluateWithTimeout(
      debugSession,
      `${variableInfo.evaluateName}.size()`,
      variableInfo.frameId || 0,
      5000
    );
    const size = parseInt(sizeResponse.result);

    let points: { x: number; y: number; z: number }[] = [];

    for (let i = 0; i < size; i++) {
      // Adjust expression based on debugger type
      const pointExpression = usingCppdbg
        ? `${variableInfo.evaluateName}[${i}]`
        : `${variableInfo.evaluateName}.at(${i})`;

      const pointResponse = await evaluateWithTimeout(
        debugSession,
        pointExpression,
        variableInfo.frameId || 0,
        5000
      );

      // Extract x, y, z values using regular expressions
      const matches = pointResponse.result.match(
        /[{(]?\s*x\s*[=:]\s*([-+]?[0-9]*\.?[0-9]+)\s*,?\s*y\s*[=:]\s*([-+]?[0-9]*\.?[0-9]+)\s*,?\s*z\s*[=:]\s*([-+]?[0-9]*\.?[0-9]+)\s*[})]?/
      );

      if (matches) {
        points.push({
          x: parseFloat(matches[1]),
          y: parseFloat(matches[2]),
          z: parseFloat(matches[3]),
        });
      }
    }

    // Show the webview to visualize the points
    const panel = vscode.window.createWebviewPanel(
      "3DPointViewer",
      "3D Point Viewer",
      vscode.ViewColumn.One,
      {
        enableScripts: true,
      }
    );
    panel.webview.html = getWebviewContentForPointCloud(points);
  } catch (error) {
    console.error("Error in drawPointCloud:", error);
    throw error;
  }
}

// Get bytes per element based on depth
function getBytesPerElement(depth: number): number {
  switch (depth) {
    case 0: // CV_8U
    case 1: // CV_8S
      return 1;
    case 2: // CV_16U
    case 3: // CV_16S
      return 2;
    case 4: // CV_32S
    case 5: // CV_32F
      return 4;
    case 6: // CV_64F
      return 8;
    default:
      return 1;
  }
}

// Read Mat data using single readMemory call (fastest)
async function readMatDataFast(
  debugSession: vscode.DebugSession,
  dataExp: string,
  frameId: number,
  dataSize: number,
  depth: number,
  progress: vscode.Progress<{ message?: string; increment?: number }>
): Promise<number[]> {
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
    return new Array(dataSize).fill(0);
  }
  
  console.log(`Data pointer: ${dataPtr}, reading ${totalBytes} bytes in ONE request`);
  progress.report({ message: `Reading ${totalBytes} bytes...` });
  
  // Single readMemory call for ALL data
  try {
    const memoryResponse = await debugSession.customRequest("readMemory", {
      memoryReference: dataPtr,
      count: totalBytes
    });
    
    if (memoryResponse && memoryResponse.data) {
      console.log(`Read complete: ${memoryResponse.data.length} base64 chars`);
      progress.report({ message: "Decoding data..." });
      
      const buffer = Buffer.from(memoryResponse.data, 'base64');
      console.log(`Decoded ${buffer.length} bytes`);
      
      // Convert buffer to array
      const allData: number[] = new Array(buffer.length);
      for (let i = 0; i < buffer.length; i++) {
        allData[i] = buffer[i];
      }
      
      // Convert bytes to values based on depth
      if (depth !== 0) {
        return convertBytesToValues(allData, depth, dataSize);
      }
      
      return allData.slice(0, dataSize);
    } else {
      vscode.window.showErrorMessage("readMemory returned no data");
      return new Array(dataSize).fill(0);
    }
  } catch (e: any) {
    console.log("readMemory error:", e.message || e);
    vscode.window.showErrorMessage(
      `readMemory failed: ${e.message || e}. Please use cppvsdbg or lldb.`
    );
    return new Array(dataSize).fill(0);
  }
}

// Convert raw byte array to typed values
function convertBytesToValues(bytes: number[], depth: number, count: number): number[] {
  const values: number[] = [];
  const bytesPerElement = getBytesPerElement(depth);
  
  for (let i = 0; i < count && i * bytesPerElement < bytes.length; i++) {
    const offset = i * bytesPerElement;
    let value: number;
    
    switch (depth) {
      case 0: // CV_8U
        value = bytes[offset];
        break;
      case 1: // CV_8S
        value = bytes[offset] > 127 ? bytes[offset] - 256 : bytes[offset];
        break;
      case 2: // CV_16U
        value = bytes[offset] | (bytes[offset + 1] << 8);
        break;
      case 3: // CV_16S
        value = bytes[offset] | (bytes[offset + 1] << 8);
        if (value > 32767) value -= 65536;
        break;
      case 4: // CV_32S
        value = bytes[offset] | (bytes[offset + 1] << 8) | 
                (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24);
        break;
      case 5: // CV_32F
        const floatArr = new Float32Array(new Uint8Array(bytes.slice(offset, offset + 4)).buffer);
        value = Math.round(floatArr[0] * 255);
        break;
      case 6: // CV_64F
        const doubleArr = new Float64Array(new Uint8Array(bytes.slice(offset, offset + 8)).buffer);
        value = Math.round(doubleArr[0] * 255);
        break;
      default:
        value = bytes[offset];
    }
    values.push(value);
  }
  
  return values;
}

// Parse numeric result from evaluate response
function parseNumericResult(result: string, depth: number): number {
  let value: number;
  if (depth === 5 || depth === 6) {
    value = parseFloat(result);
    if (!isNaN(value)) {
      value = Math.round(value * 255);
    } else {
      value = 0;
    }
  } else {
    value = parseInt(result);
    if (isNaN(value)) {
      value = 0;
    }
  }
  return value;
}

// Function to draw the cv::Mat image
async function drawMatImage(
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
          if (foundVariable) break;
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
      // For other debuggers (cppdbg, cppvsdbg), use evaluate expressions
      const rowsExp = `${variableName}.rows`;
      const colsExp = `${variableName}.cols`;
      const channelsExp = `${variableName}.channels()`;
      const depthExp = `${variableName}.depth()`;
      const dataExp = `${variableName}.data`;

      // Get matrix dimensions in parallel
      const [rowsResponse, colsResponse, channelsResponse, depthResponse, dataResponse] = await Promise.all([
        evaluateWithTimeout(debugSession, rowsExp, frameId, 10000),
        evaluateWithTimeout(debugSession, colsExp, frameId, 10000),
        evaluateWithTimeout(debugSession, channelsExp, frameId, 10000),
        evaluateWithTimeout(debugSession, depthExp, frameId, 10000),
        evaluateWithTimeout(debugSession, dataExp, frameId, 10000)
      ]);

      rows = parseInt(rowsResponse.result);
      cols = parseInt(colsResponse.result);
      channels = parseInt(channelsResponse.result);
      depth = parseInt(depthResponse.result);
      dataPtr = dataResponse.result;
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
    const data = await vscode.window.withProgress(
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
    const panel = vscode.window.createWebviewPanel(
      "MatImageViewer",
      "Matrix Image Viewer",
      vscode.ViewColumn.One,
      {
        enableScripts: true,
      }
    );
    panel.webview.html = getWebviewContentForMat(
      panel.webview,
      rows,
      cols,
      channels,
      depth,
      data
    );
  } catch (error) {
    console.error("Error drawing Mat image:", error);
    throw error;
  }
}

// Get Mat info from LLDB variables request
async function getMatInfoFromVariables(
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
      // CV_MAT_DEPTH(flags) = flags & 7
      // CV_MAT_CN(flags) = ((flags >> 3) & 63) + 1  -- This is wrong!
      // Correct: CV_MAT_CN(flags) = ((flags >> CV_CN_SHIFT) & ((1 << 14) - 1)) + 1
      // But for simplicity, we use the step array or compute from data size
      depth = flags & 7;
      // For channels, we need a different approach - compute from step or assume 3 for color
      const rawChannels = ((flags >> 3) & ((1 << 14) - 1)) + 1;
      channels = rawChannels > 0 && rawChannels <= 4 ? rawChannels : 1;
      console.log(`Extracted from flags ${flags} (0x${flags.toString(16)}): depth=${depth}, channels=${channels}`);
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

// Read Mat data for LLDB using single readMemory call
async function readMatDataForLLDB(
  debugSession: vscode.DebugSession,
  dataPtr: string,
  frameId: number,
  dataSize: number,
  depth: number,
  progress: vscode.Progress<{ message?: string; increment?: number }>
): Promise<number[]> {
  const bytesPerElement = getBytesPerElement(depth);
  const totalBytes = dataSize * bytesPerElement;
  
  console.log(`LLDB readMatDataForLLDB: dataPtr=${dataPtr}, dataSize=${dataSize}, depth=${depth}, totalBytes=${totalBytes}`);
  
  if (!dataPtr || dataPtr === "") {
    console.log("LLDB: No data pointer available");
    vscode.window.showErrorMessage("Cannot read Mat data: data pointer is null");
    return new Array(dataSize).fill(0);
  }
  
  console.log(`LLDB: Reading ${totalBytes} bytes in ONE request`);
  progress.report({ message: `Reading ${totalBytes} bytes...` });
  
  // Single readMemory call for ALL data
  try {
    const memoryResponse = await debugSession.customRequest("readMemory", {
      memoryReference: dataPtr,
      count: totalBytes
    });
    
    if (memoryResponse && memoryResponse.data) {
      console.log(`LLDB: Read complete: ${memoryResponse.data.length} base64 chars`);
      progress.report({ message: "Decoding data..." });
      
      const buffer = Buffer.from(memoryResponse.data, 'base64');
      console.log(`LLDB: Decoded ${buffer.length} bytes`);
      
      // Convert buffer to array
      const allData: number[] = new Array(buffer.length);
      for (let i = 0; i < buffer.length; i++) {
        allData[i] = buffer[i];
      }
      
      // Convert bytes to values based on depth
      if (depth !== 0) {
        return convertBytesToValues(allData, depth, dataSize);
      }
      
      return allData.slice(0, dataSize);
    } else {
      vscode.window.showErrorMessage("LLDB readMemory returned no data");
      return new Array(dataSize).fill(0);
    }
  } catch (e: any) {
    console.log("LLDB readMemory error:", e.message || e);
    vscode.window.showWarningMessage(
      `LLDB readMemory failed: ${e.message || e}. Creating placeholder image.`
    );
    
    // Create a gradient placeholder
    const allData: number[] = new Array(dataSize);
    for (let i = 0; i < dataSize; i++) {
      allData[i] = i % 256;
    }
    return allData;
  }
}

// Function to generate the webview content for the point cloud
function getWebviewContentForPointCloud(
  points: { x: number; y: number; z: number }[]
): string {
  const pointsArray = JSON.stringify(points);
  return `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>3D Point Viewer</title>
            <style> body { margin: 0; } canvas { display: block; } </style>
            <script type="importmap">
            {
                "imports": {
                    "three": "https://cdn.jsdelivr.net/npm/three@0.149.0/build/three.module.js",
                    "three/addons/": "https://cdn.jsdelivr.net/npm/three@0.149.0/examples/jsm/"
                }
            }
            </script>
        </head>
        <body>
            <script type="module">
                import * as THREE from 'three';
                import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
                const points = ${pointsArray};
                const scene = new THREE.Scene();
                const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
                const renderer = new THREE.WebGLRenderer();
                renderer.setSize(window.innerWidth, window.innerHeight);
                document.body.appendChild(renderer.domElement);

                const geometry = new THREE.BufferGeometry();
                const vertices = [];
                points.forEach(point => {
                    vertices.push(point.x, point.y, point.z);
                });
                geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
                const material = new THREE.PointsMaterial({ color: 0x00ff00, size: 0.2 });
                const pointsObject = new THREE.Points(geometry, material);
                scene.add(pointsObject);

                camera.position.set(5, 5, 5);
                camera.lookAt(scene.position);

                const controls = new OrbitControls(camera, renderer.domElement);
                controls.enableDamping = true;
                controls.dampingFactor = 0.25;
                controls.enableZoom = true;

                window.addEventListener('resize', () => {
                    camera.aspect = window.innerWidth / window.innerHeight;
                    camera.updateProjectionMatrix();
                    renderer.setSize(window.innerWidth, window.innerHeight);
                });

                function animate() {
                    requestAnimationFrame(animate);
                    controls.update();
                    renderer.render(scene, camera);
                }
                animate();
            </script>
        </body>
        </html>
    `;
}


  // You need to implement this function to generate a nonce
  function getNonce() {
      let text = '';
      const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
      for (let i = 0; i < 32; i++) {
          text += possible.charAt(Math.floor(Math.random() * possible.length));
      }
      return text;
  }


  function getWebviewContentForMat(
    webview: vscode.Webview,
    rows: number,
    cols: number,
    channels: number,
    depth: number,
    data: number[]
  ): string {
    const imageData = JSON.stringify(data);
    const nonce = getNonce();
  
    return `
      <!DOCTYPE html>
      <html lang="en">
      <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
          <title>Matrix Image Viewer</title>
          <style nonce="${nonce}">
              body { margin: 0; overflow: hidden; font-family: Arial, sans-serif; background-color: #333; }
              #controls { 
                  position: absolute; 
                  top: 10px; 
                  left: 10px; 
                  background: rgba(255,255,255,0.9); 
                  padding: 10px; 
                  border-radius: 5px;
                  box-shadow: 0 2px 5px rgba(0,0,0,0.2);
                  cursor: move;
                  user-select: none;
                  z-index: 1000;
              }
              #controls:hover { background: rgba(255,255,255,1); }
              #pixelInfo { 
                  position: absolute; 
                  bottom: 10px; 
                  left: 10px; 
                  background: rgba(255,255,255,0.9); 
                  color: black; 
                  padding: 10px; 
                  border-radius: 5px;
                  box-shadow: 0 2px 5px rgba(0,0,0,0.2);
              }
              button { 
                  margin-right: 5px; 
                  padding: 5px 10px; 
                  cursor: pointer;
                  border: 1px solid #ccc;
                  border-radius: 3px;
                  background: white;
              }
              button:hover { background: #f0f0f0; }
              #container { position: relative; width: 100vw; height: 100vh; overflow: hidden; }
              canvas { position: absolute; top: 0; left: 0; }
              #grid-canvas { 
                  position: absolute; 
                  top: 0; 
                  left: 0; 
                  pointer-events: none;
                  z-index: 1;
              }
          </style>
      </head>
      <body>
          <div id="container">
              <canvas id="canvas"></canvas>
              <canvas id="grid-canvas"></canvas>
          </div>
          <div id="controls">
              <button id="zoomIn">Zoom In</button>
              <button id="zoomOut">Zoom Out</button>
              <button id="reset">Reset</button>
              <span id="zoomLevel">Zoom: 100%</span>
          </div>
          <div id="pixelInfo"></div>
          <script nonce="${nonce}">
              (function() {
                  const container = document.getElementById('container');
                  const canvas = document.getElementById('canvas');
                  const gridCanvas = document.getElementById('grid-canvas');
                  const ctx = canvas.getContext('2d');
                  const gridCtx = gridCanvas.getContext('2d');
                  const pixelInfo = document.getElementById('pixelInfo');
                  const zoomLevelDisplay = document.getElementById('zoomLevel');
                  const controls = document.getElementById('controls');
                  
                  const rows = ${rows};
                  const cols = ${cols};
                  const channels = ${channels};
                  const data = ${imageData};
                  
                  let scale = 1;
                  let isDragging = false;
                  let startX = 0;
                  let startY = 0;
                  let offsetX = 0;
                  let offsetY = 0;

                  // Make controls draggable
                  let controlsDragging = false;
                  let controlsStartX = 0;
                  let controlsStartY = 0;

                  controls.addEventListener('mousedown', (e) => {
                      if (e.target === controls) {
                          controlsDragging = true;
                          controlsStartX = e.clientX - controls.offsetLeft;
                          controlsStartY = e.clientY - controls.offsetTop;
                          e.preventDefault();
                      }
                  });

                  document.addEventListener('mousemove', (e) => {
                      if (controlsDragging) {
                          controls.style.left = (e.clientX - controlsStartX) + 'px';
                          controls.style.top = (e.clientY - controlsStartY) + 'px';
                      }
                  });

                  document.addEventListener('mouseup', () => {
                      controlsDragging = false;
                  });

                  // Create off-screen canvas for the original image
                  const offscreenCanvas = document.createElement('canvas');
                  offscreenCanvas.width = cols;
                  offscreenCanvas.height = rows;
                  const offscreenCtx = offscreenCanvas.getContext('2d');
                  const imgData = offscreenCtx.createImageData(cols, rows);

                  // Fill image data
                  for (let i = 0; i < rows; i++) {
                      for (let j = 0; j < cols; j++) {
                          const idx = (i * cols + j) * channels;
                          const pixelIdx = (i * cols + j) * 4;

                          if (channels === 1) {
                              // Grayscale
                              const value = data[idx];
                              imgData.data[pixelIdx] = value;
                              imgData.data[pixelIdx + 1] = value;
                              imgData.data[pixelIdx + 2] = value;
                              imgData.data[pixelIdx + 3] = 255;
                          } else if (channels === 3) {
                              // RGB
                              imgData.data[pixelIdx] = data[idx];
                              imgData.data[pixelIdx + 1] = data[idx + 1];
                              imgData.data[pixelIdx + 2] = data[idx + 2];
                              imgData.data[pixelIdx + 3] = 255;
                          }
                      }
                  }
                  
                  // Put the image data on the offscreen canvas
                  offscreenCtx.putImageData(imgData, 0, 0);

                  function updateCanvasSize() {
                      const containerRect = container.getBoundingClientRect();
                      canvas.width = containerRect.width;
                      canvas.height = containerRect.height;
                      gridCanvas.width = containerRect.width;
                      gridCanvas.height = containerRect.height;
                  }

                  function drawGrid() {
                      if (scale >= 10) {
                          gridCtx.clearRect(0, 0, gridCanvas.width, gridCanvas.height);
                          gridCtx.strokeStyle = 'rgba(128, 128, 128, 0.5)';
                          gridCtx.lineWidth = 0.5;
                          
                          // Draw vertical lines
                          for (let x = 0; x <= cols; x++) {
                              const pixelX = x * scale + offsetX;
                              gridCtx.beginPath();
                              gridCtx.moveTo(pixelX, offsetY);
                              gridCtx.lineTo(pixelX, rows * scale + offsetY);
                              gridCtx.stroke();
                          }
                          
                          // Draw horizontal lines
                          for (let y = 0; y <= rows; y++) {
                              const pixelY = y * scale + offsetY;
                              gridCtx.beginPath();
                              gridCtx.moveTo(offsetX, pixelY);
                              gridCtx.lineTo(cols * scale + offsetX, pixelY);
                              gridCtx.stroke();
                          }
                      } else {
                          gridCtx.clearRect(0, 0, gridCanvas.width, gridCanvas.height);
                      }
                  }

                  function draw() {
                      ctx.clearRect(0, 0, canvas.width, canvas.height);
                      
                      // Calculate scaled dimensions
                      const scaledWidth = cols * scale;
                      const scaledHeight = rows * scale;
                      
                      // Draw from top-left corner with offset
                      const x = offsetX;
                      const y = offsetY;
                      
                      ctx.imageSmoothingEnabled = scale < 4; // Disable smoothing when zoomed in
                      ctx.drawImage(offscreenCanvas, x, y, scaledWidth, scaledHeight);
                      
                      // Draw grid when zoomed in
                      drawGrid();
                      
                      // Update zoom level display
                      zoomLevelDisplay.textContent = \`Zoom: \${Math.round(scale * 100)}%\`;
                  }

                  function setZoom(newScale) {
                      scale = Math.max(0.1, Math.min(50, newScale)); // Increased max zoom to 50x
                      draw();
                  }

                  // Event Listeners
                  document.getElementById('zoomIn').addEventListener('click', () => {
                      setZoom(scale * 1.5); // Increased zoom factor
                  });

                  document.getElementById('zoomOut').addEventListener('click', () => {
                      setZoom(scale / 1.5);
                  });

                  document.getElementById('reset').addEventListener('click', () => {
                      scale = 1;
                      offsetX = 0;
                      offsetY = 0;
                      draw();
                  });

                  canvas.addEventListener('wheel', (e) => {
                      e.preventDefault();
                      const zoomFactor = e.deltaY > 0 ? 0.8 : 1.25; // Adjusted zoom speed
                      setZoom(scale * zoomFactor);
                  });

                  canvas.addEventListener('mousedown', (e) => {
                      if (e.target === canvas) {
                          isDragging = true;
                          startX = e.clientX - offsetX;
                          startY = e.clientY - offsetY;
                      }
                  });

                  canvas.addEventListener('mousemove', (e) => {
                      if (isDragging) {
                          offsetX = e.clientX - startX;
                          offsetY = e.clientY - startY;
                          draw();
                      }

                      // Update pixel info
                      const rect = canvas.getBoundingClientRect();
                      const mouseX = e.clientX - rect.left;
                      const mouseY = e.clientY - rect.top;
                      
                      // Convert mouse coordinates to image coordinates
                      const imageX = Math.floor((mouseX - offsetX) / scale);
                      const imageY = Math.floor((mouseY - offsetY) / scale);

                      if (imageX >= 0 && imageX < cols && imageY >= 0 && imageY < rows) {
                          const idx = (imageY * cols + imageX) * channels;
                          let pixelInfoText = \`Position: (\${imageX}, \${imageY}) | \`;

                          if (channels === 1) {
                              const value = data[idx];
                              pixelInfoText += \`Grayscale: \${value}\`;
                          } else if (channels === 3) {
                              const r = data[idx];
                              const g = data[idx + 1];
                              const b = data[idx + 2];
                              pixelInfoText += \`RGB: (\${r}, \${g}, \${b})\`;
                          }

                          pixelInfo.textContent = pixelInfoText;
                      } else {
                          pixelInfo.textContent = '';
                      }
                  });

                  canvas.addEventListener('mouseup', () => {
                      isDragging = false;
                  });

                  canvas.addEventListener('mouseleave', () => {
                      isDragging = false;
                  });

                  window.addEventListener('resize', () => {
                      updateCanvasSize();
                      draw();
                  });

                  // Initialize
                  updateCanvasSize();
                  draw();
              })();
          </script>
      </body>
      </html>
    `;
  }

export function deactivate() {}
