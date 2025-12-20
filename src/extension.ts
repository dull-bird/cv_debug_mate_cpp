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
          // For LLDB, use evaluate to get type info
          console.log("--- LLDB Mode: Using evaluate to get type ---");
          console.log("[DEBUG] variable.type from context menu:", variable.type);
          console.log("[DEBUG] variable.value from context menu:", variable.value);
          
          try {
            // Use evaluate with "watch" context to get full variable info including type
            console.log("[DEBUG] Calling evaluate for:", variableName);
            const evalResult = await debugSession.customRequest("evaluate", {
              expression: variableName,
              frameId: frameId,
              context: "watch",
            });
            console.log("[DEBUG] Evaluate result:", JSON.stringify(evalResult, null, 2));
            
            variableInfo = {
              result: evalResult.result || variable.value,
              type: evalResult.type || variable.type,
              variablesReference: evalResult.variablesReference || variable.variablesReference,
              evaluateName: variableName
            };
            console.log("[DEBUG] Final type used:", variableInfo.type);
          } catch (error) {
            console.log("[DEBUG] Evaluate failed:", error);
            // Fallback: use variable info directly
            variableInfo = {
              result: variable.value,
              type: variable.type,
              variablesReference: variable.variablesReference,
              evaluateName: variableName
            };
            console.log("[DEBUG] Final type used (fallback):", variableInfo.type);
          }
          console.log("Final variableInfo:", JSON.stringify(variableInfo, null, 2));
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
          // Add evaluateName since evaluate response doesn't include it
          variableInfo.evaluateName = variableName;
          console.log("Evaluate result:", JSON.stringify(variableInfo, null, 2));
        }

        // Check the type of the variable
        console.log("--- Type Checking ---");
        const point3Info = isPoint3Vector(variableInfo);
        const isMatType = isMat(variableInfo);
        console.log("isPoint3Vector:", point3Info.isPoint3);
        console.log("isDouble (Point3d):", point3Info.isDouble);
        console.log("isMat:", isMatType);
        
        if (point3Info.isPoint3) {
          // If it's a vector of cv::Point3f or cv::Point3d, draw the point cloud
          console.log("==> Drawing Point Cloud");
          await drawPointCloud(debugSession, variableInfo, variableName, point3Info.isDouble);
        } else if (isMatType) {
          // If it's a cv::Mat, draw the image
          console.log("==> Drawing Mat Image");
          await drawMatImage(debugSession, variableInfo, frameId, variableName);
        } else {
          vscode.window.showErrorMessage(
            "Variable is neither a vector of cv::Point3f/cv::Point3d nor a cv::Mat."
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

// Function to check if the variable is a vector of cv::Point3f or cv::Point3d
// Returns: { isPoint3: boolean, isDouble: boolean }
// isDouble: true for Point3d (double), false for Point3f (float)
function isPoint3Vector(variableInfo: any): { isPoint3: boolean; isDouble: boolean } {
  console.log("Checking if variable is Point3 vector");
  const type = variableInfo.type || "";
  console.log("Variable type string:", type);
  
  // Check for Point3d (double) first
  const isDouble = 
    type.includes("std::vector<cv::Point3d>") ||
    type.includes("std::vector<cv::Point3_<double>") ||
    type.includes("std::__1::vector<cv::Point3_<double>") ||
    type.includes("class std::vector<class cv::Point3_<double>") ||
    /std::.*vector\s*<\s*cv::Point3d\s*>/.test(type) ||
    /std::.*vector\s*<\s*cv::Point3_<double>/.test(type);
  
  // Check for Point3f (float) or generic Point3
  const isFloat = 
    type.includes("std::vector<cv::Point3f>") ||
    type.includes("std::vector<cv::Point3_<float>") ||
    type.includes("std::__1::vector<cv::Point3_<float>") ||
    type.includes("class std::vector<class cv::Point3_<float>") ||
    /std::.*vector\s*<\s*cv::Point3f\s*>/.test(type) ||
    /std::.*vector\s*<\s*cv::Point3_<float>/.test(type);
  
  // Generic Point3 check (without type parameter)
  const isGeneric = /std::.*vector\s*<\s*cv::Point3[fd]?\s*>/.test(type);
  
  const isPoint3 = isDouble || isFloat || isGeneric;
  
  console.log(`isPoint3Vector result: isPoint3=${isPoint3}, isDouble=${isDouble}`);
  return { isPoint3, isDouble };
}

// Function to check if the variable is a cv::Mat or cv::Mat_<T>
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
    // Template Mat types: cv::Mat_<T> (e.g., cv::Mat_<uchar>, cv::Mat_<cv::Vec3d>)
    /cv::Mat_</.test(type) ||
    // Generic format (matches cv::Mat but not cv::Mat_)
    /cv::Mat\b/.test(type);
  
  console.log("isMat result:", result);
  return result;
}

// Helper function to check if we're using LLDB
function isUsingLLDB(debugSession: vscode.DebugSession): boolean {
  return debugSession.type === "lldb";
}

// Helper function to check if we're using cppdbg (GDB/MI)
function isUsingCppdbg(debugSession: vscode.DebugSession): boolean {
  return debugSession.type === "cppdbg";
}

// Helper function to check if we're using MSVC (cppvsdbg)
function isUsingMSVC(debugSession: vscode.DebugSession): boolean {
  return debugSession.type === "cppvsdbg";
}

// Function to draw point cloud
async function drawPointCloud(debugSession: vscode.DebugSession, variableInfo: any, variableName: string, isDouble: boolean = false) {
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
    const panel = vscode.window.createWebviewPanel(
      "3DPointViewer",
      panelTitle,
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      }
    );
    panel.webview.html = getWebviewContentForPointCloud(points);
    
    // Handle messages from webview (e.g., save PLY request)
    panel.webview.onDidReceiveMessage(
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

// Helper function to try getting data pointer using a list of expressions
async function tryGetDataPointer(
  debugSession: vscode.DebugSession,
  evaluateName: string,
  expressions: string[],
  frameId: number,
  context: string
): Promise<string | null> {
  console.log(`tryGetDataPointer: evaluateName="${evaluateName}", context="${context}", frameId=${frameId}`);
  
  for (const expr of expressions) {
    try {
      console.log(`Trying expression: ${expr}`);
      const dataResponse = await debugSession.customRequest("evaluate", {
        expression: expr,
        frameId: frameId,
        context: context
      });
      
      console.log(`Response for "${expr}":`, dataResponse);
      
      // Try to extract pointer from result string
      if (dataResponse && dataResponse.result) {
        const ptrMatch = dataResponse.result.match(/0x[0-9a-fA-F]+/);
        if (ptrMatch) {
          console.log(`Successfully extracted pointer: ${ptrMatch[0]}`);
          return ptrMatch[0];
        }
      }
      
      // Also check memoryReference field directly
      if (dataResponse && dataResponse.memoryReference) {
        console.log(`Found memoryReference: ${dataResponse.memoryReference}`);
        return dataResponse.memoryReference;
      }
    } catch (e) {
      console.log(`Expression "${expr}" failed:`, e);
    }
  }
  
  return null;
}

// Get point cloud data via readMemory (fast path for cppdbg/cppvsdbg)
async function getPointCloudViaReadMemory(
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

// Helper function to get current frame ID
async function getCurrentFrameId(debugSession: vscode.DebugSession): Promise<number> {
  try {
    const threadsResponse = await debugSession.customRequest("threads", {});
    if (threadsResponse.threads && threadsResponse.threads.length > 0) {
      const threadId = threadsResponse.threads[0].id;
      const stackResponse = await debugSession.customRequest("stackTrace", {
        threadId: threadId,
        startFrame: 0,
        levels: 1
      });
      if (stackResponse.stackFrames && stackResponse.stackFrames.length > 0) {
        return stackResponse.stackFrames[0].id;
      }
    }
  } catch (e) {
    console.log("Error getting frame ID:", e);
  }
  return 0;
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

/**
 * Helper function to read memory in chunks to avoid debugger limitations.
 * Each chunk is 16MB by default.
 */
async function readMemoryChunked(
  debugSession: vscode.DebugSession,
  memoryReference: string,
  totalBytes: number,
  progress?: vscode.Progress<{ message?: string; increment?: number }>
): Promise<Buffer | null> {
  const CHUNK_SIZE = 32 * 1024 * 1024; // 64MB
  const chunks: any[] = [];
  let bytesRead = 0;

  console.log(`Starting chunked read: totalBytes=${totalBytes}, memoryReference=${memoryReference}`);

  while (bytesRead < totalBytes) {
    const count = Math.min(CHUNK_SIZE, totalBytes - bytesRead);
    try {
      const memoryResponse = await debugSession.customRequest("readMemory", {
        memoryReference: memoryReference,
        offset: bytesRead,
        count: count
      });

      if (memoryResponse && memoryResponse.data) {
        const chunkBuffer = Buffer.from(memoryResponse.data, "base64");
        chunks.push(chunkBuffer);
        
        const actualRead = chunkBuffer.length;
        bytesRead += actualRead;
        
        if (progress) {
          const percent = Math.round((bytesRead / totalBytes) * 100);
          progress.report({ 
            message: `Reading memory: ${percent}% (${Math.round(bytesRead / 1024 / 1024)}MB / ${Math.round(totalBytes / 1024 / 1024)}MB)`,
            increment: (actualRead / totalBytes) * 100
          });
        }

        if (actualRead < count && bytesRead < totalBytes) {
          console.log(`Read fewer bytes than requested: ${actualRead} < ${count}. Might be end of memory.`);
          break;
        }
      } else {
        console.error(`readMemory returned no data for chunk at offset ${bytesRead}`);
        break;
      }
    } catch (e: any) {
      console.error(`Error reading memory chunk at offset ${bytesRead}:`, e.message || e);
      if (chunks.length > 0) break;
      throw e;
    }
  }

  if (chunks.length === 0) return null;
  return Buffer.concat(chunks);
}

// Read Mat data using single readMemory call (fastest)
async function readMatDataFast(
  debugSession: vscode.DebugSession,
  dataExp: string,
  frameId: number,
  dataSize: number,
  depth: number,
  progress: vscode.Progress<{ message?: string; increment?: number }>
): Promise<{ base64: string }> {
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
    return { base64: "" };
  }
  
  console.log(`Data pointer: ${dataPtr}, reading ${totalBytes} bytes in chunked requests`);
  progress.report({ message: `Reading ${totalBytes} bytes...` });
  
  // Chunked readMemory calls for ALL data
  try {
    const buffer = await readMemoryChunked(debugSession, dataPtr, totalBytes, progress);
    
    if (buffer) {
      console.log(`Read complete: ${buffer.length} bytes`);
      // NOTE: For very large images, expanding to number[] and JSON-stringifying is expensive.
      // Pass the raw base64 buffer to the webview and decode there with TypedArrays.
      return { base64: buffer.toString("base64") };
    } else {
      vscode.window.showErrorMessage("readMemory returned no data");
      return { base64: "" };
    }
  } catch (e: any) {
    console.log("readMemory error:", e.message || e);
    vscode.window.showErrorMessage(
      `readMemory failed: ${e.message || e}. Please use cppvsdbg or lldb.`
    );
    return { base64: "" };
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
        // Keep raw float value; scaling/normalization is handled in the webview UI.
        const floatArr = new Float32Array(new Uint8Array(bytes.slice(offset, offset + 4)).buffer);
        value = floatArr[0];
        break;
      case 6: // CV_64F
        // Keep raw double value; scaling/normalization is handled in the webview UI.
        const doubleArr = new Float64Array(new Uint8Array(bytes.slice(offset, offset + 8)).buffer);
        value = doubleArr[0];
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
    if (isNaN(value)) value = 0;
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
    const panel = vscode.window.createWebviewPanel(
      "MatImageViewer",
      panelTitle,
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      }
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
    const totalData = dataResult.base64;
    const totalLength = totalData.length;

    console.log(`Sending ${totalLength} base64 chars to webview at once`);

    await panel.webview.postMessage({
      command: 'completeData',
      data: totalData
    });

    console.log('Complete data sent to webview');
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

// Read Mat data for LLDB using single readMemory call
async function readMatDataForLLDB(
  debugSession: vscode.DebugSession,
  dataPtr: string,
  frameId: number,
  dataSize: number,
  depth: number,
  progress: vscode.Progress<{ message?: string; increment?: number }>
): Promise<{ base64: string }> {
  const bytesPerElement = getBytesPerElement(depth);
  const totalBytes = dataSize * bytesPerElement;
  
  console.log(`LLDB readMatDataForLLDB: dataPtr=${dataPtr}, dataSize=${dataSize}, depth=${depth}, totalBytes=${totalBytes}`);
  
  if (!dataPtr || dataPtr === "") {
    console.log("LLDB: No data pointer available");
    vscode.window.showErrorMessage("Cannot read Mat data: data pointer is null");
    return { base64: "" };
  }
  
  console.log(`LLDB: Reading ${totalBytes} bytes in chunked requests`);
  progress.report({ message: `Reading ${totalBytes} bytes...` });
  
  // Chunked readMemory calls for ALL data
  try {
    const buffer = await readMemoryChunked(debugSession, dataPtr, totalBytes, progress);
    
    if (buffer) {
      console.log(`LLDB: Read complete: ${buffer.length} bytes`);
      return { base64: buffer.toString("base64") };
    } else {
      vscode.window.showErrorMessage("LLDB readMemory returned no data");
      return { base64: "" };
    }
  } catch (e: any) {
    console.log("LLDB readMemory error:", e.message || e);
    vscode.window.showWarningMessage(
      `LLDB readMemory failed: ${e.message || e}. Creating placeholder image.`
    );
    return { base64: "" };
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
            <style>
                body { margin: 0; overflow: hidden; font-family: Arial, sans-serif; }
                canvas { display: block; }
                #info {
                    position: absolute;
                    top: 10px;
                    left: 10px;
                    background: rgba(0, 0, 0, 0.7);
                    color: white;
                    padding: 10px 15px;
                    border-radius: 5px;
                    font-size: 14px;
                    z-index: 100;
                }
                #info h3 { margin: 0 0 8px 0; font-size: 16px; }
                #info p { margin: 4px 0; }
                #controls {
                    position: absolute;
                    top: 10px;
                    right: 10px;
                    background: rgba(0, 0, 0, 0.7);
                    color: white;
                    padding: 10px 15px;
                    border-radius: 5px;
                    z-index: 100;
                }
                #controls button {
                    background: #4a9eff;
                    color: white;
                    border: none;
                    padding: 8px 12px;
                    margin: 3px;
                    border-radius: 4px;
                    cursor: pointer;
                    font-size: 12px;
                }
                #controls button:hover { background: #3a8eef; }
                #controls button.active { background: #2a7edf; }
                #controls label { font-size: 12px; margin-right: 5px; }
                #controls input[type="number"] {
                    width: 60px;
                    padding: 4px;
                    border: 1px solid #555;
                    border-radius: 3px;
                    background: #333;
                    color: white;
                    font-size: 12px;
                }
                #axisView {
                    position: absolute;
                    bottom: 10px;
                    right: 10px;
                    width: 120px;
                    height: 120px;
                    background: rgba(20, 20, 30, 0.9);
                    border-radius: 5px;
                    border: 1px solid rgba(255, 255, 255, 0.3);
                    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.5);
                }
                #axisView svg {
                    width: 100%;
                    height: 100%;
                    display: block;
                }
                #colorbar {
                    position: absolute;
                    bottom: 140px;
                    right: 10px;
                    background: rgba(0, 0, 0, 0.7);
                    color: white;
                    padding: 10px;
                    border-radius: 5px;
                    display: none;
                }
                #colorbar-gradient {
                    width: 20px;
                    height: 120px;
                    background: linear-gradient(to top, #0000ff, #00ffff, #00ff00, #ffff00, #ff0000);
                    margin-right: 10px;
                }
                #colorbar-labels {
                    display: flex;
                    flex-direction: column;
                    justify-content: space-between;
                    height: 120px;
                    font-size: 11px;
                }
                #colorbar-container { display: flex; }
            </style>
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
            <div id="info">
                <h3>Point Cloud Viewer</h3>
                <p>Points: <span id="pointCount">0</span></p>
                <p>X (Right): <span id="boundsX">-</span></p>
                <p>Y (Forward): <span id="boundsY">-</span></p>
                <p>Z (Up): <span id="boundsZ">-</span></p>
            </div>
            <div id="controls">
                <div style="margin-bottom: 8px;">
                    <label>Point Size:</label>
                    <input type="number" id="pointSizeInput" value="0.1" step="0.05" min="0.01" max="20">
                </div>
                <button id="btnSolid">Solid Color</button>
                <button id="btnHeightZ">Color by Z</button>
                <button id="btnHeightY">Color by Y</button>
                <button id="btnHeightX">Color by X</button>
                <button id="btnResetView">Reset View</button>
                <button id="btnSavePLY" style="margin-top: 8px; background: #28a745;">Save PLY</button>
            </div>
            <div id="axisView"></div>
            <div id="colorbar">
                <div id="colorbar-container">
                    <div id="colorbar-gradient"></div>
                    <div id="colorbar-labels">
                        <span id="colorbar-max">1.0</span>
                        <span id="colorbar-mid">0.5</span>
                        <span id="colorbar-min">0.0</span>
                    </div>
                </div>
            </div>
            <script type="module">
                import * as THREE from 'three';
                import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
                
                const points = ${pointsArray};
                
                // Main scene
                const scene = new THREE.Scene();
                scene.background = new THREE.Color(0x1a1a2e);
                
                const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 100000);
                const renderer = new THREE.WebGLRenderer({ antialias: true });
                renderer.setSize(window.innerWidth, window.innerHeight);
                renderer.autoClear = false;
                document.body.appendChild(renderer.domElement);
                
                // Axis view using SVG for crisp vector rendering
                const axisContainer = document.getElementById('axisView');
                const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
                svg.setAttribute('viewBox', '0 0 120 120');
                svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
                axisContainer.appendChild(svg);
                
                // Function to update axis arrows based on camera direction
                function updateAxisView() {
                    // Clear previous content
                    svg.innerHTML = '';
                    
                    // Get camera basis vectors
                    const cameraDir = new THREE.Vector3();
                    camera.getWorldDirection(cameraDir);
                    const cameraUp = camera.up.clone();
                    const cameraRight = new THREE.Vector3();
                    cameraRight.crossVectors(cameraDir, cameraUp).normalize();
                    const cameraUpCorrected = new THREE.Vector3();
                    cameraUpCorrected.crossVectors(cameraRight, cameraDir).normalize();
                    
                    // Define axis directions in world space
                    const worldX = new THREE.Vector3(1, 0, 0);
                    const worldY = new THREE.Vector3(0, 0, -1); // Y is forward (negative Z in Three.js)
                    const worldZ = new THREE.Vector3(0, 1, 0);
                    
                    // Project to 2D using camera basis
                    // Project onto the plane perpendicular to camera direction
                    function project3DTo2D(worldVec) {
                        // Project onto camera right and up vectors
                        const projRight = worldVec.dot(cameraRight);
                        const projUp = worldVec.dot(cameraUpCorrected);
                        return { x: projRight, y: projUp };
                    }
                    
                    const centerX = 60, centerY = 60;
                    const axisLength = 30;
                    const arrowSize = 8;
                    
                    // Project axes
                    const xProj = project3DTo2D(worldX);
                    const yProj = project3DTo2D(worldY);
                    const zProj = project3DTo2D(worldZ);
                    
                    // Normalize and scale
                    const scale = axisLength;
                    const xEnd = {
                        x: centerX + xProj.x * scale,
                        y: centerY - xProj.y * scale // Flip Y for SVG
                    };
                    const yEnd = {
                        x: centerX + yProj.x * scale,
                        y: centerY - yProj.y * scale
                    };
                    const zEnd = {
                        x: centerX + zProj.x * scale,
                        y: centerY - zProj.y * scale
                    };
                    
                    // Draw arrows
                    drawArrow(svg, centerX, centerY, xEnd.x, xEnd.y, '#ff3333', 'X');
                    drawArrow(svg, centerX, centerY, yEnd.x, yEnd.y, '#33ff33', 'Y');
                    drawArrow(svg, centerX, centerY, zEnd.x, zEnd.y, '#3333ff', 'Z');
                }
                
                // Function to draw an arrow with label
                function drawArrow(svg, x1, y1, x2, y2, color, label) {
                    // Draw line
                    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
                    line.setAttribute('x1', x1);
                    line.setAttribute('y1', y1);
                    line.setAttribute('x2', x2);
                    line.setAttribute('y2', y2);
                    line.setAttribute('stroke', color);
                    line.setAttribute('stroke-width', '2.5');
                    line.setAttribute('stroke-linecap', 'round');
                    svg.appendChild(line);
                    
                    // Draw arrowhead
                    const angle = Math.atan2(y2 - y1, x2 - x1);
                    const arrowLength = 6;
                    const arrowWidth = 4;
                    
                    const arrowX1 = x2 - arrowLength * Math.cos(angle - Math.PI / 6);
                    const arrowY1 = y2 - arrowLength * Math.sin(angle - Math.PI / 6);
                    const arrowX2 = x2 - arrowLength * Math.cos(angle + Math.PI / 6);
                    const arrowY2 = y2 - arrowLength * Math.sin(angle + Math.PI / 6);
                    
                    const arrow = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
                    arrow.setAttribute('points', x2 + ',' + y2 + ' ' + arrowX1 + ',' + arrowY1 + ' ' + arrowX2 + ',' + arrowY2);
                    arrow.setAttribute('fill', color);
                    svg.appendChild(arrow);
                    
                    // Draw label
                    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                    text.setAttribute('x', x2 + (x2 - x1) * 0.15);
                    text.setAttribute('y', y2 + (y2 - y1) * 0.15);
                    text.setAttribute('fill', color);
                    text.setAttribute('font-size', '14');
                    text.setAttribute('font-weight', 'bold');
                    text.setAttribute('font-family', 'Arial, sans-serif');
                    text.setAttribute('text-anchor', 'middle');
                    text.setAttribute('dominant-baseline', 'middle');
                    text.textContent = label;
                    svg.appendChild(text);
                }
                
                // Initial render
                updateAxisView();

                // Calculate bounds
                let minX = Infinity, maxX = -Infinity;
                let minY = Infinity, maxY = -Infinity;
                let minZ = Infinity, maxZ = -Infinity;
                
                const geometry = new THREE.BufferGeometry();
                const vertices = [];
                
                points.forEach(point => {
                    vertices.push(point.x, point.z, -point.y);
                    minX = Math.min(minX, point.x); maxX = Math.max(maxX, point.x);
                    minY = Math.min(minY, point.y); maxY = Math.max(maxY, point.y);
                    minZ = Math.min(minZ, point.z); maxZ = Math.max(maxZ, point.z);
                });
                
                document.getElementById('pointCount').textContent = points.length.toLocaleString();
                
                // Check if we have valid points
                if (vertices.length === 0) {
                    document.getElementById('boundsX').textContent = 'N/A';
                    document.getElementById('boundsY').textContent = 'N/A';
                    document.getElementById('boundsZ').textContent = 'N/A';
                } else {
                    document.getElementById('boundsX').textContent = minX.toFixed(2) + ' ~ ' + maxX.toFixed(2);
                    document.getElementById('boundsY').textContent = minY.toFixed(2) + ' ~ ' + maxY.toFixed(2);
                    document.getElementById('boundsZ').textContent = minZ.toFixed(2) + ' ~ ' + maxZ.toFixed(2);
                }
                
                geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
                
                const range = Math.max(maxX - minX, maxY - minY, maxZ - minZ) || 1;
                let currentPointSize = Math.max(0.1, range / 1000);
                
                document.getElementById('pointSizeInput').value = currentPointSize.toFixed(1);
                
                let material = new THREE.PointsMaterial({ 
                    color: 0x00ffff, 
                    size: currentPointSize,
                    sizeAttenuation: true,
                    vertexColors: false
                });
                
                const pointsObject = new THREE.Points(geometry, material);
                scene.add(pointsObject);
                
                const centerX = (minX + maxX) / 2;
                const centerY = (minY + maxY) / 2;
                const centerZ = (minZ + maxZ) / 2;
                
                const threeCenterX = centerX;
                const threeCenterY = centerZ;
                const threeCenterZ = -centerY;
                
                const distance = range * 2;
                
                function resetView() {
                    const angle = Math.PI / 4;
                    const elevation = Math.PI / 6;
                    camera.position.set(
                        threeCenterX + distance * Math.cos(angle) * Math.cos(elevation),
                        threeCenterY + distance * Math.sin(elevation),
                        threeCenterZ + distance * Math.sin(angle) * Math.cos(elevation)
                    );
                    camera.up.set(0, 1, 0);
                    camera.lookAt(threeCenterX, threeCenterY, threeCenterZ);
                    controls.target.set(threeCenterX, threeCenterY, threeCenterZ);
                    controls.update();
                }

                const controls = new OrbitControls(camera, renderer.domElement);
                controls.enableDamping = true;
                controls.dampingFactor = 0.1;
                controls.enableZoom = true;
                controls.rotateSpeed = 0.5;
                controls.screenSpacePanning = true;
                
                resetView();
                
                // Point size handler
                document.getElementById('pointSizeInput').onchange = (e) => {
                    const newSize = parseFloat(e.target.value);
                    if (newSize > 0) {
                        material.size = newSize;
                        material.needsUpdate = true;
                    }
                };
                
                // Color by height functions
                function getColorForValue(value, min, max) {
                    const t = (value - min) / (max - min || 1);
                    const r = Math.min(1, Math.max(0, 1.5 - Math.abs(t - 1) * 2));
                    const g = Math.min(1, Math.max(0, 1.5 - Math.abs(t - 0.5) * 2));
                    const b = Math.min(1, Math.max(0, 1.5 - Math.abs(t - 0) * 2));
                    return { r, g, b };
                }
                
                // Track current color mode
                let currentColorMode = 'solid';
                
                // Function to update button active states
                function updateButtonStates(activeMode) {
                    const buttons = {
                        'solid': document.getElementById('btnSolid'),
                        'z': document.getElementById('btnHeightZ'),
                        'y': document.getElementById('btnHeightY'),
                        'x': document.getElementById('btnHeightX')
                    };
                    
                    // Remove active class from all buttons
                    Object.values(buttons).forEach(btn => {
                        if (btn) btn.classList.remove('active');
                    });
                    
                    // Add active class to the selected button
                    if (buttons[activeMode]) {
                        buttons[activeMode].classList.add('active');
                    }
                    
                    currentColorMode = activeMode;
                }
                
                function colorByAxis(axis) {
                    const colors = [];
                    let min, max;
                    
                    if (axis === 'z') { min = minZ; max = maxZ; }
                    else if (axis === 'y') { min = minY; max = maxY; }
                    else { min = minX; max = maxX; }
                    
                    points.forEach(point => {
                        const value = axis === 'z' ? point.z : (axis === 'y' ? point.y : point.x);
                        const color = getColorForValue(value, min, max);
                        colors.push(color.r, color.g, color.b);
                    });
                    
                    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
                    material.vertexColors = true;
                    material.color.setHex(0xffffff);
                    material.needsUpdate = true;
                    
                    document.getElementById('colorbar').style.display = 'block';
                    document.getElementById('colorbar-max').textContent = max.toFixed(2);
                    document.getElementById('colorbar-mid').textContent = ((min + max) / 2).toFixed(2);
                    document.getElementById('colorbar-min').textContent = min.toFixed(2);
                    
                    // Update button state
                    updateButtonStates(axis);
                }
                
                function solidColor() {
                    material.vertexColors = false;
                    material.color.setHex(0x00ffff);
                    material.needsUpdate = true;
                    document.getElementById('colorbar').style.display = 'none';
                    
                    // Update button state
                    updateButtonStates('solid');
                }
                
                // Initialize: set solid button as active
                updateButtonStates('solid');
                
                document.getElementById('btnSolid').onclick = () => solidColor();
                document.getElementById('btnHeightZ').onclick = () => colorByAxis('z');
                document.getElementById('btnHeightY').onclick = () => colorByAxis('y');
                document.getElementById('btnHeightX').onclick = () => colorByAxis('x');
                document.getElementById('btnResetView').onclick = () => resetView();
                document.getElementById('btnSavePLY').onclick = () => {
                    const vscode = acquireVsCodeApi();
                    vscode.postMessage({ command: 'savePLY' });
                };
                
                const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
                scene.add(ambientLight);

                window.addEventListener('resize', () => {
                    camera.aspect = window.innerWidth / window.innerHeight;
                    camera.updateProjectionMatrix();
                    renderer.setSize(window.innerWidth, window.innerHeight);
                });

                function animate() {
                    requestAnimationFrame(animate);
                    controls.update();
                    
                    // Update SVG axis view
                    updateAxisView();
                    
                    renderer.clear();
                    renderer.render(scene, camera);
                }
                animate();
            </script>
        </body>
        </html>
    `;
}

// Generate PLY file content from point cloud data
function generatePLYContent(points: { x: number; y: number; z: number }[]): string {
  let plyContent = `ply
format ascii 1.0
comment Generated by CV DebugMate C++
element vertex ${points.length}
property float x
property float y
property float z
end_header
`;

  // Add vertex data
  for (const point of points) {
    plyContent += `${point.x} ${point.y} ${point.z}\n`;
  }

  return plyContent;
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
    data: { base64: string }
  ): string {
    const imageBase64 = JSON.stringify(data?.base64 || "");
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
                  color: #111;
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
                  z-index: 1000;
              }
              button { 
                  margin-right: 5px; 
                  padding: 5px 10px; 
                  cursor: pointer;
                  border: 1px solid #ccc;
                  border-radius: 3px;
                  background: white;
                  color: #111;
              }
              button:hover { background: #f0f0f0; }
              button.active { background: #e7f1ff; border-color: #7db5ff; }
              #controls {
                  display: flex;
                  gap: 8px;
                  align-items: center;
                  flex-wrap: wrap;
              }
              #controls label { color: #111; font-weight: 400; }
              .ctrl-group {
                  display: inline-flex;
                  align-items: center;
                  gap: 6px;
              }
              /* Custom dropdown (avoid native <select> rendering glitches in WebView) */
              .dd {
                  position: relative;
                  display: inline-flex;
                  align-items: center;
                  gap: 6px;
              }
              .dd-btn {
                  height: 24px;
                  padding: 1px 8px;
                  border: 1px solid #777;
                  border-radius: 3px;
                  background: #fff;
                  color: #111;
                  cursor: pointer;
                  font-size: 12px;
                  line-height: 20px;
                  white-space: nowrap;
                  box-sizing: border-box;
              }
              .dd-btn:focus {
                  outline: 2px solid rgba(74, 158, 255, 0.6);
                  outline-offset: 1px;
              }
              .dd-menu {
                  position: absolute;
                  top: calc(100% + 4px);
                  left: 0;
                  max-width: 320px;
                  background: #fff;
                  border: 1px solid #777;
                  border-radius: 6px;
                  box-shadow: 0 8px 24px rgba(0,0,0,0.18);
                  padding: 4px;
                  z-index: 2000;
                  display: none;
                  box-sizing: border-box;
              }
              .dd.open .dd-menu { display: block; }
              .dd-item {
                  width: 100%;
                  text-align: left;
                  border: 0;
                  background: transparent;
                  color: #111;
                  padding: 6px 8px;
                  border-radius: 4px;
                  cursor: pointer;
                  font-size: 12px;
                  line-height: 16px;
              }
              .dd-item:hover { background: rgba(74, 158, 255, 0.12); }
              .dd-item[aria-checked="true"] { background: rgba(74, 158, 255, 0.18); }
              #zoomGroup {
                  margin-left: auto; /* keep zoom on the far right */
              }
              #zoomLevel {
                  display: inline-block;
                  min-width: 10ch; /* 5 digits + '%' + 4 spaces (monospace, stable width) */
                  text-align: right;
                  white-space: pre; /* preserve padding spaces */
                  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
              }
              #container { position: relative; width: 100vw; height: 100vh; overflow: hidden; }
              canvas { position: absolute; top: 0; left: 0; }
              #grid-canvas { 
                  position: absolute; 
                  top: 0; 
                  left: 0; 
                  pointer-events: none;
                  z-index: 1;
              }
              #text-canvas {
                  position: absolute;
                  top: 0;
                  left: 0;
                  pointer-events: none;
                  z-index: 2;
              }
          </style>
      </head>
      <body>
          <div id="container">
              <canvas id="canvas"></canvas>
              <canvas id="grid-canvas"></canvas>
              <canvas id="text-canvas"></canvas>
          </div>
          <div id="controls">
              <span class="ctrl-group" id="zoomGroup">
                  <button id="zoomIn">Zoom In</button>
                  <button id="zoomOut">Zoom Out</button>
                  <button id="reset">Reset</button>
                  <span id="zoomLevel">100%    </span>
              </span>

              <span class="ctrl-group" id="saveGroup">
                  <span class="dd" id="ddSaveFormat">
                      <label style="font-size: 12px;">Save:</label>
                      <button class="dd-btn" id="btnSaveFormat" type="button">PNG</button>
                      <div class="dd-menu" role="menu" aria-label="Save format menu"></div>
                  </span>
                  <button id="saveImage">Save</button>
              </span>

              <span class="ctrl-group" id="pixelGroup">
                  <button id="togglePixelText" title="放大到一定程度后，在视野内显示每个像素的灰度/RGB数值">Pixel Values</button>
              </span>

              <span class="ctrl-group" id="renderGroup">
                  <span class="dd" id="ddRenderMode">
                      <label style="font-size: 12px;">Render:</label>
                      <button class="dd-btn" id="btnRenderMode" type="button">Byte [0, 255]</button>
                      <div class="dd-menu" role="menu" aria-label="Render mode menu"></div>
                  </span>
                  <span class="dd" id="ddValueFormat">
                      <label style="font-size: 12px;">Value:</label>
                      <button class="dd-btn" id="btnValueFormat" type="button">Fixed(3)</button>
                      <div class="dd-menu" role="menu" aria-label="Value format menu"></div>
                  </span>
                  <span class="dd" id="ddUiScale">
                      <label style="font-size: 12px;">Scale:</label>
                      <button class="dd-btn" id="btnUiScale" type="button">Auto</button>
                      <div class="dd-menu" role="menu" aria-label="UI scale menu"></div>
                  </span>
              </span>
          </div>
          <div id="pixelInfo"></div>
          <script nonce="${nonce}">
              (function() {
                  const container = document.getElementById('container');
                  const canvas = document.getElementById('canvas');
                  const gridCanvas = document.getElementById('grid-canvas');
                  const textCanvas = document.getElementById('text-canvas');
                  const ctx = canvas.getContext('2d');
                  const gridCtx = gridCanvas.getContext('2d');
                  const textCtx = textCanvas.getContext('2d');
                  const pixelInfo = document.getElementById('pixelInfo');
                  const zoomLevelDisplay = document.getElementById('zoomLevel');
                  const controls = document.getElementById('controls');
                  const togglePixelTextBtn = document.getElementById('togglePixelText');
                  const saveImageBtn = document.getElementById('saveImage');
                  const btnSaveFormat = document.getElementById('btnSaveFormat');
                  const btnRenderMode = document.getElementById('btnRenderMode');
                  const btnValueFormat = document.getElementById('btnValueFormat');
                  const btnUiScale = document.getElementById('btnUiScale');
                  const ddSaveFormat = document.getElementById('ddSaveFormat');
                  const ddRenderMode = document.getElementById('ddRenderMode');
                  const ddValueFormat = document.getElementById('ddValueFormat');
                  const ddUiScale = document.getElementById('ddUiScale');
                  
                  const rows = ${rows};
                  const cols = ${cols};
                  const channels = ${channels};
                  const depth = ${depth};

                  // Data will be received as complete data
                  let base64Data = '';

                  // Listen for complete data from extension
                  const vscode = acquireVsCodeApi();
                  window.addEventListener('message', event => {
                      const message = event.data;
                      if (message.command === 'completeData') {
                          base64Data = message.data;

                          console.log('Received complete data: ' + base64Data.length + ' chars');

                          // Now initialize the image viewer
                          initializeImageViewer();
                      }
                  });

                  function base64ToUint8Array(b64) {
                      if (!b64) return new Uint8Array(0);
                      const binary = atob(b64);
                      const len = binary.length;
                      const bytes = new Uint8Array(len);
                      for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
                      return bytes;
                  }

                  function initializeImageViewer() {
                      const rawBytes = base64ToUint8Array(base64Data);

                  function bytesToTypedArray(bytes, depth) {
                      const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
                      switch (depth) {
                          case 0: return new Uint8Array(buf);    // CV_8U
                          case 1: return new Int8Array(buf);     // CV_8S
                          case 2: return new Uint16Array(buf);   // CV_16U
                          case 3: return new Int16Array(buf);    // CV_16S
                          case 4: return new Int32Array(buf);    // CV_32S
                          case 5: return new Float32Array(buf);  // CV_32F
                          case 6: return new Float64Array(buf);  // CV_64F
                          default: return new Uint8Array(buf);
                      }
                  }

                  const rawData = bytesToTypedArray(rawBytes, depth);
                  let saveFormat = 'png';
                  let renderMode = 'byte';
                  let valueFormat = 'fixed3';
                  let uiScaleMode = 'auto';
                  let uiScale = 1;
                  let cachedMinMax = null; // {min:number, max:number}
                  
                  let scale = 1;
                  let isDragging = false;
                  let startX = 0;
                  let startY = 0;
                  let offsetX = 0;
                  let offsetY = 0;
                  let viewW = 0;
                  let viewH = 0;
                  let lastMouseX = 0;
                  let lastMouseY = 0;
                  let hasLastMouse = false;

                  // Pixel-value overlay (performance-sensitive)
                  const PIXEL_TEXT_MIN_SCALE = 16; // 像素块 >= 16px 时开始考虑显示像素值
                  const MAX_PIXEL_TEXT_LABELS = 15000; // 视野内超过这个像素数就不画文字（防止卡顿）
                  let pixelTextEnabled = true; // 可手动关掉
                  let renderQueued = false;

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

                  function clampByte(v) {
                      if (!isFinite(v)) return 0;
                      if (v < 0) return 0;
                      if (v > 255) return 255;
                      return v | 0;
                  }

                  function getMinMax() {
                      if (cachedMinMax) return cachedMinMax;
                      let min = Infinity;
                      let max = -Infinity;
                      for (let i = 0; i < rawData.length; i++) {
                          const v = rawData[i];
                          if (!isFinite(v)) continue;
                          if (v < min) min = v;
                          if (v > max) max = v;
                      }
                      if (min === Infinity || max === -Infinity) {
                          min = 0; max = 1;
                      }
                      cachedMinMax = { min, max };
                      return cachedMinMax;
                  }

                  function mapToByte(v) {
                      if (renderMode === 'norm01') {
                          return clampByte(v * 255);
                      }
                      if (renderMode === 'minmax') {
                          const mm = getMinMax();
                          const denom = (mm.max - mm.min) || 1;
                          return clampByte(((v - mm.min) / denom) * 255);
                      }
                      if (renderMode === 'clamp255') {
                          return clampByte(v);
                      }
                      // 'byte' default: assume already 0..255-ish (but still clamp)
                      return clampByte(v);
                  }

                  function updateOffscreenFromRaw() {
                      // Fill image data based on selected render mode
                      cachedMinMax = null;
                      if (renderMode === 'minmax') getMinMax();

                      for (let i = 0; i < rows; i++) {
                          for (let j = 0; j < cols; j++) {
                              const idx = (i * cols + j) * channels;
                              const pixelIdx = (i * cols + j) * 4;

                              if (channels === 1) {
                                  const value = mapToByte(rawData[idx]);
                                  imgData.data[pixelIdx] = value;
                                  imgData.data[pixelIdx + 1] = value;
                                  imgData.data[pixelIdx + 2] = value;
                                  imgData.data[pixelIdx + 3] = 255;
                              } else if (channels === 3) {
                                  imgData.data[pixelIdx] = mapToByte(rawData[idx]);
                                  imgData.data[pixelIdx + 1] = mapToByte(rawData[idx + 1]);
                                  imgData.data[pixelIdx + 2] = mapToByte(rawData[idx + 2]);
                                  imgData.data[pixelIdx + 3] = 255;
                              }
                          }
                      }
                      offscreenCtx.putImageData(imgData, 0, 0);
                  }
                  
                  // Put the image data on the offscreen canvas
                  function closeAllDropdowns() {
                      ddSaveFormat.classList.remove('open');
                      ddRenderMode.classList.remove('open');
                      ddValueFormat.classList.remove('open');
                      ddUiScale.classList.remove('open');
                  }

                  // Measure text width once (used to make dropdown buttons/menus stable-width)
                  const __measureSpan = document.createElement('span');
                  __measureSpan.style.position = 'fixed';
                  __measureSpan.style.left = '-99999px';
                  __measureSpan.style.top = '-99999px';
                  __measureSpan.style.visibility = 'hidden';
                  __measureSpan.style.whiteSpace = 'nowrap';
                  __measureSpan.style.fontSize = '12px';
                  __measureSpan.style.fontFamily = 'Arial, sans-serif';
                  document.body.appendChild(__measureSpan);

                  function measureTextPx(text, fontCss) {
                      __measureSpan.style.font = fontCss;
                      __measureSpan.textContent = text;
                      return __measureSpan.getBoundingClientRect().width;
                  }

                  document.addEventListener('click', (e) => {
                      // Close dropdowns when clicking anywhere outside the currently open dropdown(s)
                      // (including other toolbar areas, canvas, empty space, etc.)
                      const openDd = document.querySelector('.dd.open');
                      if (!openDd) return;
                      const inOpenDd = e.target.closest && e.target.closest('.dd.open');
                      if (!inOpenDd) closeAllDropdowns();
                  });

                  document.addEventListener('keydown', (e) => {
                      if (e.key === 'Escape') closeAllDropdowns();
                  });

                  function initDropdown(ddEl, btnEl, options, getValue, setValue) {
                      const menu = ddEl.querySelector('.dd-menu');
                      const fontCss = '12px Arial, sans-serif';

                      function updateStableWidth() {
                          // Button width = longest option label + padding + small caret space
                          let maxW = 0;
                          for (const opt of options) {
                              const w = measureTextPx(opt.label, fontCss);
                              if (w > maxW) maxW = w;
                          }
                          // 8px left + 8px right padding + ~18px extra
                          const target = Math.ceil(maxW + 34);
                          btnEl.style.width = target + 'px';
                          // Menu width follows the *actual* rendered button width (including borders)
                          const btnW = Math.ceil(btnEl.getBoundingClientRect().width);
                          menu.style.width = btnW + 'px';
                          menu.style.minWidth = btnW + 'px';
                          // Align menu under the button (dd contains a label + button)
                          menu.style.left = btnEl.offsetLeft + 'px';
                      }

                      function renderMenu() {
                          const cur = getValue();
                          menu.innerHTML = '';
                          for (const opt of options) {
                              const item = document.createElement('button');
                              item.type = 'button';
                              item.className = 'dd-item';
                              item.textContent = opt.label;
                              item.setAttribute('role', 'menuitemradio');
                              item.setAttribute('aria-checked', String(opt.value === cur));
                              item.addEventListener('click', () => {
                                  setValue(opt.value);
                                  btnEl.textContent = opt.label;
                                  ddEl.classList.remove('open');
                              });
                              menu.appendChild(item);
                          }
                      }

                      btnEl.addEventListener('click', () => {
                          const isOpen = ddEl.classList.contains('open');
                          closeAllDropdowns();
                          if (!isOpen) {
                              renderMenu();
                              updateStableWidth();
                              ddEl.classList.add('open');
                          }
                      });

                      // Initialize width once up-front
                      updateStableWidth();
                  }

                  // Init dropdowns
                  initDropdown(
                      ddSaveFormat,
                      btnSaveFormat,
                      [
                          { value: 'png', label: 'PNG' },
                          { value: 'tiff', label: 'TIFF' },
                      ],
                      () => saveFormat,
                      (v) => { saveFormat = v; }
                  );
                  initDropdown(
                      ddRenderMode,
                      btnRenderMode,
                      [
                          { value: 'byte', label: 'Byte [0, 255]' },
                          { value: 'norm01', label: 'Float * 255 → Byte' },
                          { value: 'minmax', label: '[min, max] → [0, 255]' },
                          { value: 'clamp255', label: 'Clamp → [0, 255]' },
                      ],
                      () => renderMode,
                      (v) => { renderMode = v; updateOffscreenFromRaw(); requestRender(); }
                  );
                  initDropdown(
                      ddValueFormat,
                      btnValueFormat,
                      [
                          { value: 'fixed3', label: 'Fixed(3)' },
                          { value: 'fixed6', label: 'Fixed(6)' },
                          { value: 'sci2', label: 'Sci(2)' },
                      ],
                      () => valueFormat,
                      (v) => { valueFormat = v; requestRender(); }
                  );
                  initDropdown(
                      ddUiScale,
                      btnUiScale,
                      [
                          { value: 'auto', label: 'Auto' },
                          { value: '1', label: '1' },
                          { value: '1.25', label: '1.25' },
                          { value: '1.5', label: '1.5' },
                          { value: '2', label: '2' },
                      ],
                      () => uiScaleMode,
                      (v) => { uiScaleMode = v; updateUiScale(); requestRender(); }
                  );

                  // Defaults
                  btnSaveFormat.textContent = 'PNG';
                  btnValueFormat.textContent = 'Fixed(3)';
                  btnUiScale.textContent = 'Auto';

                  // Auto pick a better default for float/double
                  if (depth === 5 || depth === 6) {
                      renderMode = 'norm01';
                      btnRenderMode.textContent = 'Float * 255 → Byte';
                  } else {
                      btnRenderMode.textContent = 'Byte [0, 255]';
                  }
                  updateOffscreenFromRaw();

                  function clamp(v, lo, hi) {
                      return Math.max(lo, Math.min(hi, v));
                  }

                  function computeAutoUiScale() {
                      const dpr = window.devicePixelRatio || 1;
                      // Gentle scaling: consistent feel across monitors without exploding on 4K
                      return clamp(Math.sqrt(dpr), 1, 2);
                  }

                  function updateUiScale() {
                      if (uiScaleMode === 'auto') {
                          uiScale = computeAutoUiScale();
                          return;
                      }
                      const v = parseFloat(uiScaleMode);
                      // Allowed values: 1 / 1.25 / 1.5 / 2
                      uiScale = (isFinite(v) ? v : 1);
                  }

                  updateUiScale();

                  function formatFloat(v) {
                      if (!isFinite(v)) return 'NaN';
                      if (valueFormat === 'fixed3') return v.toFixed(3);
                      if (valueFormat === 'fixed6') return v.toFixed(6);
                      if (valueFormat === 'sci2') return v.toExponential(2);
                      return v.toFixed(3);
                  }

                  function formatValue(v) {
                      // Float/double: show raw values nicely; ints remain integer
                      if (depth === 5 || depth === 6) return formatFloat(v);
                      // For integer-like, keep 3-char alignment with spaces as requested
                      return String(v | 0).padStart(3, ' ');
                  }

                  function updateCanvasSize() {
                      const containerRect = container.getBoundingClientRect();
                      const dpr = window.devicePixelRatio || 1;
                      viewW = containerRect.width;
                      viewH = containerRect.height;

                      // Ensure crisp rendering on HiDPI screens by decoupling CSS size and backing store size
                      canvas.style.width = viewW + 'px';
                      canvas.style.height = viewH + 'px';
                      gridCanvas.style.width = viewW + 'px';
                      gridCanvas.style.height = viewH + 'px';
                      textCanvas.style.width = viewW + 'px';
                      textCanvas.style.height = viewH + 'px';

                      canvas.width = Math.max(1, Math.floor(viewW * dpr));
                      canvas.height = Math.max(1, Math.floor(viewH * dpr));
                      gridCanvas.width = Math.max(1, Math.floor(viewW * dpr));
                      gridCanvas.height = Math.max(1, Math.floor(viewH * dpr));
                      textCanvas.width = Math.max(1, Math.floor(viewW * dpr));
                      textCanvas.height = Math.max(1, Math.floor(viewH * dpr));

                      // Draw in CSS pixels; transform maps to device pixels
                      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
                      gridCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
                      textCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

                      // Keep overlays sharp
                      gridCtx.imageSmoothingEnabled = false;
                      textCtx.imageSmoothingEnabled = false;
                  }

                  function drawGrid() {
                      if (scale >= 10) {
                          gridCtx.clearRect(0, 0, viewW, viewH);
                          gridCtx.strokeStyle = 'rgba(128, 128, 128, 0.5)';
                          gridCtx.lineWidth = 1;
                          
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
                          gridCtx.clearRect(0, 0, viewW, viewH);
                      }
                  }

                  function drawPixelTextOverlay() {
                      textCtx.clearRect(0, 0, viewW, viewH);

                       if (!pixelTextEnabled) return;
                       // RGB shows 3 lines, needs a higher minimum scale than grayscale
                       const minScaleForText = (channels === 3) ? 26 : PIXEL_TEXT_MIN_SCALE;
                       if (scale < minScaleForText) return;

                      // Compute visible image rect in pixel coordinates
                      const left = Math.max(0, Math.floor((-offsetX) / scale));
                      const top = Math.max(0, Math.floor((-offsetY) / scale));
                      const right = Math.min(cols - 1, Math.ceil((viewW - offsetX) / scale) - 1);
                      const bottom = Math.min(rows - 1, Math.ceil((viewH - offsetY) / scale) - 1);

                      if (right < left || bottom < top) return;

                      const visibleW = right - left + 1;
                      const visibleH = bottom - top + 1;
                      const visibleCount = visibleW * visibleH;
                      if (visibleCount > MAX_PIXEL_TEXT_LABELS) return;

                       // Font size controlled by user-selected Scale; still guarded by overflow checks + clip
                       const fontSize = Math.max(8, Math.min(16, Math.round(8 * uiScale))); // px
                      const fontFamily = 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';
                       const lineHeight = fontSize; // keep tight for RGB 3-line fit
                      const padGray = 2; // px padding inside each cell (grayscale)
                      const padRgb = 1;  // px padding inside each cell (RGB uses a bit more space)
                      textCtx.font = fontSize + 'px ' + fontFamily;
                      textCtx.textAlign = 'center';
                      textCtx.textBaseline = 'middle';
                      // Stroke width in CSS pixels (keep it crisp)
                      textCtx.lineWidth = 2;
                      textCtx.strokeStyle = 'rgba(0, 0, 0, 0.65)';
                      textCtx.fillStyle = 'rgba(255, 255, 255, 0.95)';

                      function canFitTextInCell(lines, cellInnerW, cellInnerH) {
                          if (cellInnerW <= 0 || cellInnerH <= 0) return false;
                          if (lines.length * lineHeight > cellInnerH) return false;
                          // Check max line width
                          let maxW = 0;
                          for (const s of lines) {
                              const w = textCtx.measureText(s).width;
                              if (w > maxW) maxW = w;
                          }
                          return maxW <= cellInnerW;
                      }

                      for (let y = top; y <= bottom; y++) {
                          const screenY = y * scale + offsetY + scale / 2;
                          if (screenY < -scale || screenY > viewH + scale) continue;

                          for (let x = left; x <= right; x++) {
                              const screenX = x * scale + offsetX + scale / 2;
                              if (screenX < -scale || screenX > viewW + scale) continue;

                              const idx = (y * cols + x) * channels;
                              let label = '';
                              if (channels === 1) {
                                  label = formatValue(rawData[idx]);
                              } else if (channels === 3) {
                                  const r = rawData[idx];
                                  const g = rawData[idx + 1];
                                  const b = rawData[idx + 2];

                                  const cellX = x * scale + offsetX;
                                  const cellY = y * scale + offsetY;
                                  const cellInnerW = Math.max(0, scale - padRgb * 2);
                                  const cellInnerH = Math.max(0, scale - padRgb * 2);
                                  const l1 = 'R:' + formatValue(r);
                                  const l2 = 'G:' + formatValue(g);
                                  const l3 = 'B:' + formatValue(b);
                                  const lines = [l1, l2, l3];
                                  if (!canFitTextInCell(lines, cellInnerW, cellInnerH)) continue;

                                  textCtx.save();
                                  textCtx.beginPath();
                                  textCtx.rect(cellX + padRgb, cellY + padRgb, cellInnerW, cellInnerH);
                                  textCtx.clip();

                                  // Center the 3 lines vertically within the cell
                                  const totalH = lines.length * lineHeight;
                                  const topY = (cellY + padRgb) + (cellInnerH - totalH) / 2 + lineHeight / 2;
                                  const baseY = topY;
                                  textCtx.strokeText(l1, screenX, baseY);
                                  textCtx.fillText(l1, screenX, baseY);
                                  textCtx.strokeText(l2, screenX, baseY + lineHeight);
                                  textCtx.fillText(l2, screenX, baseY + lineHeight);
                                  textCtx.strokeText(l3, screenX, baseY + lineHeight * 2);
                                  textCtx.fillText(l3, screenX, baseY + lineHeight * 2);
                                  textCtx.restore();
                                  continue;
                              } else {
                                  continue;
                              }

                              // Grayscale: overflow check + per-cell clip
                              if (channels === 1) {
                                  const cellX = x * scale + offsetX;
                                  const cellY = y * scale + offsetY;
                                  const cellInnerW = Math.max(0, scale - padGray * 2);
                                  const cellInnerH = Math.max(0, scale - padGray * 2);
                                  const lines = [label];
                                  if (!canFitTextInCell(lines, cellInnerW, cellInnerH)) continue;

                                  textCtx.save();
                                  textCtx.beginPath();
                                  textCtx.rect(cellX + padGray, cellY + padGray, cellInnerW, cellInnerH);
                                  textCtx.clip();
                                  textCtx.strokeText(label, screenX, screenY);
                                  textCtx.fillText(label, screenX, screenY);
                                  textCtx.restore();
                              }
                          }
                      }
                  }

                  function draw() {
                      ctx.clearRect(0, 0, viewW, viewH);
                      
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
                      drawPixelTextOverlay();
                      
                      // Update zoom level display
                      // Fixed-width zoom display: min 1 digit, max 5 digits, padded to 5 with spaces + 4 trailing spaces
                      const pct = Math.max(0, Math.round(scale * 100));
                      const pctStr = String(pct).slice(0, 5).padStart(5, ' ');
                      zoomLevelDisplay.textContent = pctStr + '%    ';
                  }

                  function requestRender() {
                      if (renderQueued) return;
                      renderQueued = true;
                      requestAnimationFrame(() => {
                          renderQueued = false;
                          draw();
                      });
                  }

                  function setZoom(newScale) {
                      scale = Math.max(0.05, Math.min(100, newScale)); // Increased max zoom to 100x
                      requestRender();
                  }

                  // Zoom around a screen point (mouse cursor), keeping the image coord under cursor stable
                  function setZoomAt(screenX, screenY, newScale) {
                      const prevScale = scale;
                      const nextScale = Math.max(0.05, Math.min(100, newScale));
                      if (nextScale === prevScale) return;

                      // Image coordinates under cursor before zoom
                      const imgX = (screenX - offsetX) / prevScale;
                      const imgY = (screenY - offsetY) / prevScale;

                      scale = nextScale;

                      // Adjust offsets so the same image coord stays under cursor
                      offsetX = screenX - imgX * nextScale;
                      offsetY = screenY - imgY * nextScale;

                      requestRender();
                  }

                  // Event Listeners
                  document.getElementById('zoomIn').addEventListener('click', () => {
                      const cx = hasLastMouse ? lastMouseX : viewW / 2;
                      const cy = hasLastMouse ? lastMouseY : viewH / 2;
                      setZoomAt(cx, cy, scale * 1.5); // Increased zoom factor
                  });

                  document.getElementById('zoomOut').addEventListener('click', () => {
                      const cx = hasLastMouse ? lastMouseX : viewW / 2;
                      const cy = hasLastMouse ? lastMouseY : viewH / 2;
                      setZoomAt(cx, cy, scale / 1.5);
                  });

                  document.getElementById('reset').addEventListener('click', () => {
                      scale = 1;
                      offsetX = 0;
                      offsetY = 0;
                      requestRender();
                  });

                  // Toggle pixel text overlay
                  togglePixelTextBtn.addEventListener('click', () => {
                      pixelTextEnabled = !pixelTextEnabled;
                      togglePixelTextBtn.classList.toggle('active', pixelTextEnabled);
                      requestRender();
                  });
                  togglePixelTextBtn.classList.toggle('active', pixelTextEnabled);

                  // Save (PNG/TIFF)
                  saveImageBtn.addEventListener('click', () => {
                      const fmt = saveFormat;
                      if (fmt === 'png') {
                          const link = document.createElement('a');
                          link.download = 'image.png';
                          link.href = offscreenCanvas.toDataURL('image/png');
                          link.click();
                          return;
                      }

                      // TIFF (with raw data for float support)
                      const tiffData = createTiff(cols, rows, channels, rawData, depth);
                      const blob = new Blob([tiffData], { type: 'image/tiff' });
                      const link = document.createElement('a');
                      link.download = 'image.tiff';
                      link.href = URL.createObjectURL(blob);
                      link.click();
                      URL.revokeObjectURL(link.href);
                  });

                  // Simple TIFF encoder
                  function createTiff(width, height, channels, data, depth) {
                      // Determine bits per sample and sample format based on depth
                      let bitsPerSample, sampleFormat, bytesPerSample;
                      if (depth === 5) { // CV_32F
                          bitsPerSample = 32;
                          sampleFormat = 3; // IEEE float
                          bytesPerSample = 4;
                      } else if (depth === 6) { // CV_64F
                          bitsPerSample = 64;
                          sampleFormat = 3; // IEEE float
                          bytesPerSample = 8;
                      } else {
                          bitsPerSample = 8;
                          sampleFormat = 1; // unsigned int
                          bytesPerSample = 1;
                      }

                      const samplesPerPixel = channels === 1 ? 1 : 3;
                      const photometric = channels === 1 ? 1 : 2; // 1=grayscale, 2=RGB
                      const rowsPerStrip = height;
                      const stripByteCount = width * height * samplesPerPixel * bytesPerSample;

                      // IFD entries
                      const numEntries = 12;
                      const headerSize = 8;
                      const ifdOffset = headerSize;
                      const ifdSize = 2 + numEntries * 12 + 4;
                      const dataOffset = ifdOffset + ifdSize + 20; // extra space for arrays
                      const stripOffset = dataOffset;

                      const totalSize = stripOffset + stripByteCount;
                      const buffer = new ArrayBuffer(totalSize);
                      const view = new DataView(buffer);
                      const bytes = new Uint8Array(buffer);

                      let offset = 0;

                      // TIFF header (little endian)
                      view.setUint16(offset, 0x4949, true); offset += 2; // II = little endian
                      view.setUint16(offset, 42, true); offset += 2; // TIFF magic
                      view.setUint32(offset, ifdOffset, true); offset += 4; // IFD offset

                      // IFD
                      view.setUint16(offset, numEntries, true); offset += 2;

                      // Helper to write IFD entry
                      function writeEntry(tag, type, count, value) {
                          view.setUint16(offset, tag, true); offset += 2;
                          view.setUint16(offset, type, true); offset += 2;
                          view.setUint32(offset, count, true); offset += 4;
                          if (type === 3 && count === 1) { // SHORT
                              view.setUint16(offset, value, true); offset += 2;
                              view.setUint16(offset, 0, true); offset += 2;
                          } else if (type === 4 && count === 1) { // LONG
                              view.setUint32(offset, value, true); offset += 4;
                          } else {
                              view.setUint32(offset, value, true); offset += 4;
                          }
                      }

                      // IFD entries
                      writeEntry(256, 3, 1, width);  // ImageWidth
                      writeEntry(257, 3, 1, height); // ImageLength
                      writeEntry(258, 3, samplesPerPixel, samplesPerPixel === 1 ? bitsPerSample : ifdOffset + ifdSize); // BitsPerSample
                      writeEntry(259, 3, 1, 1); // Compression = none
                      writeEntry(262, 3, 1, photometric); // PhotometricInterpretation
                      writeEntry(273, 4, 1, stripOffset); // StripOffsets
                      writeEntry(277, 3, 1, samplesPerPixel); // SamplesPerPixel
                      writeEntry(278, 3, 1, rowsPerStrip); // RowsPerStrip
                      writeEntry(279, 4, 1, stripByteCount); // StripByteCounts
                      writeEntry(282, 5, 1, ifdOffset + ifdSize + 8); // XResolution
                      writeEntry(283, 5, 1, ifdOffset + ifdSize + 16); // YResolution
                      writeEntry(339, 3, samplesPerPixel, samplesPerPixel === 1 ? sampleFormat : ifdOffset + ifdSize + 6); // SampleFormat

                      // Next IFD = 0
                      view.setUint32(offset, 0, true); offset += 4;

                      // BitsPerSample array (if RGB)
                      if (samplesPerPixel > 1) {
                          const bpsOffset = ifdOffset + ifdSize;
                          view.setUint16(bpsOffset, bitsPerSample, true);
                          view.setUint16(bpsOffset + 2, bitsPerSample, true);
                          view.setUint16(bpsOffset + 4, bitsPerSample, true);
                          // SampleFormat array
                          view.setUint16(bpsOffset + 6, sampleFormat, true);
                          view.setUint16(bpsOffset + 8, sampleFormat, true);
                          view.setUint16(bpsOffset + 10, sampleFormat, true);
                      }

                      // Resolution (72 dpi as rational 72/1)
                      const resOffset = ifdOffset + ifdSize + 8;
                      view.setUint32(resOffset, 72, true);
                      view.setUint32(resOffset + 4, 1, true);
                      view.setUint32(resOffset + 8, 72, true);
                      view.setUint32(resOffset + 12, 1, true);

                      // Write pixel data
                      let pixelOffset = stripOffset;
                      for (let i = 0; i < height; i++) {
                          for (let j = 0; j < width; j++) {
                              const srcIdx = (i * width + j) * channels;
                              if (depth === 5) { // CV_32F
                                  for (let c = 0; c < samplesPerPixel; c++) {
                                      const val = channels === 1 ? data[srcIdx] : data[srcIdx + c];
                                      view.setFloat32(pixelOffset, val / 255.0, true);
                                      pixelOffset += 4;
                                  }
                              } else if (depth === 6) { // CV_64F
                                  for (let c = 0; c < samplesPerPixel; c++) {
                                      const val = channels === 1 ? data[srcIdx] : data[srcIdx + c];
                                      view.setFloat64(pixelOffset, val / 255.0, true);
                                      pixelOffset += 8;
                                  }
                              } else { // 8-bit
                                  for (let c = 0; c < samplesPerPixel; c++) {
                                      const val = channels === 1 ? data[srcIdx] : data[srcIdx + c];
                                      bytes[pixelOffset++] = val;
                                  }
                              }
                          }
                      }

                      return buffer;
                  }

                  canvas.addEventListener('wheel', (e) => {
                      e.preventDefault();
                      const zoomFactor = e.deltaY > 0 ? 0.8 : 1.25; // Adjusted zoom speed
                      const rect = canvas.getBoundingClientRect();
                      const mouseX = e.clientX - rect.left;
                      const mouseY = e.clientY - rect.top;
                      setZoomAt(mouseX, mouseY, scale * zoomFactor);
                  });

                  canvas.addEventListener('mousedown', (e) => {
                      if (e.target === canvas) {
                          isDragging = true;
                          startX = e.clientX - offsetX;
                          startY = e.clientY - offsetY;
                      }
                  });

                  canvas.addEventListener('mousemove', (e) => {
                      const rect = canvas.getBoundingClientRect();
                      const mouseX = e.clientX - rect.left;
                      const mouseY = e.clientY - rect.top;
                      lastMouseX = mouseX;
                      lastMouseY = mouseY;
                      hasLastMouse = true;

                      if (isDragging) {
                          offsetX = e.clientX - startX;
                          offsetY = e.clientY - startY;
                          requestRender();
                      }

                      // Update pixel info
                      
                      // Convert mouse coordinates to image coordinates
                      const imageX = Math.floor((mouseX - offsetX) / scale);
                      const imageY = Math.floor((mouseY - offsetY) / scale);

                      if (imageX >= 0 && imageX < cols && imageY >= 0 && imageY < rows) {
                          const idx = (imageY * cols + imageX) * channels;
                          let pixelInfoText = \`Position: (\${imageX}, \${imageY}) | \`;

                          if (channels === 1) {
                               const value = rawData[idx];
                               pixelInfoText += \`Grayscale: \${formatValue(value)}\`;
                          } else if (channels === 3) {
                               const r = rawData[idx];
                               const g = rawData[idx + 1];
                               const b = rawData[idx + 2];
                               pixelInfoText += \`RGB: (\${formatValue(r)}, \${formatValue(g)}, \${formatValue(b)})\`;
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
                      if (uiScaleMode === 'auto') updateUiScale();
                      requestRender();
                  });

                  // Initialize
                  updateCanvasSize();
                  requestRender();
                  }
              })();
          </script>
      </body>
      </html>
    `;
  }

export function deactivate() {}
