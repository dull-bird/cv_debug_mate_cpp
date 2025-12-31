import * as vscode from "vscode";
import * as os from "os";

// Get the appropriate evaluate context for the debugger type
export function getEvaluateContext(debugSession: vscode.DebugSession): string {
  // CodeLLDB treats "repl" as command mode, use "watch" for expression evaluation
  if (debugSession.type === "lldb") {
    return "watch";
  }
  // For cppdbg and cppvsdbg, "repl" works fine
  return "repl";
}

export async function evaluateWithTimeout(
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

// Helper function to get current frame ID
export async function getCurrentFrameId(debugSession: vscode.DebugSession): Promise<number> {
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

/**
 * Get a small sample of memory to detect content changes without reading everything.
 * Reads 1KB from start, middle and end.
 */
export async function getMemorySample(
  debugSession: vscode.DebugSession,
  memoryReference: string,
  totalBytes: number
): Promise<string> {
  if (totalBytes <= 0 || !memoryReference) return "";
  
  const SIZES = [512, 512, 512]; // Start, middle, end samples
  const offsets = [
    0,
    Math.floor(totalBytes / 2),
    Math.max(0, totalBytes - 512)
  ];

  let sampleData = "";
  for (let i = 0; i < offsets.length; i++) {
    try {
      const count = Math.min(SIZES[i], totalBytes - offsets[i]);
      if (count <= 0) continue;
      
      const response = await debugSession.customRequest("readMemory", {
        memoryReference: memoryReference,
        offset: offsets[i],
        count: count
      });
      
      if (response && response.data) {
        // Just take a small slice of the base64 to keep the token compact
        sampleData += response.data.substring(0, 32);
      }
    } catch (e) {
      // Ignore sample errors
    }
  }
  return sampleData;
}

/**
 * Helper function to read memory in chunks to avoid debugger limitations.
 * Each chunk is 16MB by default.
 */
export async function readMemoryChunked(
  debugSession: vscode.DebugSession,
  memoryReference: string,
  totalBytes: number,
  progress?: vscode.Progress<{ message?: string; increment?: number }>
): Promise<Buffer | null> {
  const CHUNK_SIZE = 8 * 1024 * 1024; // 8MB per chunk
  
  // Adaptive concurrency based on CPU cores, but keep it within 2-8 range 
  // to avoid overwhelming the debugger IPC channel.
  const cpuCount = os.cpus().length || 4;
  const CONCURRENCY = Math.min(8, Math.max(2, cpuCount));
  
  const numChunks = Math.ceil(totalBytes / CHUNK_SIZE);
  const chunks = new Array<Buffer | null>(numChunks).fill(null);
  
  console.log(`Starting parallel chunked read: totalBytes=${totalBytes}, chunks=${numChunks}, concurrency=${CONCURRENCY}`);

  let nextChunkIndex = 0;
  let totalReadBytes = 0;
  let failed = false;

  const worker = async () => {
    while (nextChunkIndex < numChunks && !failed) {
      const myIndex = nextChunkIndex++;
      const offset = myIndex * CHUNK_SIZE;
      const count = Math.min(CHUNK_SIZE, totalBytes - offset);

      try {
        const memoryResponse = await debugSession.customRequest("readMemory", {
          memoryReference: memoryReference,
          offset: offset,
          count: count
        });

        if (memoryResponse && memoryResponse.data && !failed) {
          const buffer = Buffer.from(memoryResponse.data, "base64");
          chunks[myIndex] = buffer;
          totalReadBytes += buffer.length;

          if (progress) {
            const percent = Math.round((totalReadBytes / totalBytes) * 100);
            progress.report({
              message: `Reading memory: ${percent}% (${Math.round(totalReadBytes / 1024 / 1024)}MB / ${Math.round(totalBytes / 1024 / 1024)}MB)`,
              increment: (buffer.length / totalBytes) * 100
            });
          }
        } else if (!failed) {
          console.error(`readMemory returned no data for chunk ${myIndex}`);
          failed = true;
        }
      } catch (e: any) {
        console.error(`Error reading memory chunk ${myIndex}:`, e.message || e);
        failed = true;
      }
    }
  };

  // Start workers
  const workers = Array(CONCURRENCY).fill(null).map(() => worker());
  await Promise.all(workers);

  if (failed || chunks.some(c => c === null)) {
    // If some chunks failed but we have some data, try to return what we have
    const validChunks = chunks.filter((c): c is Buffer => c !== null);
    if (validChunks.length === 0) {
      return null;
    }
    return Buffer.concat(validChunks as any[]);
  }

  return Buffer.concat(chunks as any[]);
}

// Helper function to try getting data pointer using a list of expressions
export async function tryGetDataPointer(
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

// Helper function to check if we're using LLDB
export function isUsingLLDB(debugSession: vscode.DebugSession): boolean {
  return debugSession.type === "lldb";
}

// Helper function to check if we're using cppdbg (GDB/MI)
export function isUsingCppdbg(debugSession: vscode.DebugSession): boolean {
  return debugSession.type === "cppdbg";
}

// Helper function to check if we're using MSVC (cppvsdbg)
export function isUsingMSVC(debugSession: vscode.DebugSession): boolean {
  return debugSession.type === "cppvsdbg";
}

/**
 * Get vector size using multiple strategies.
 * 1. First try to parse from variableInfo.value or variableInfo.result
 * 2. Then try to evaluate size() expression with debugger-specific syntax
 */
export async function getVectorSize(
  debugSession: vscode.DebugSession,
  variableName: string,
  frameId: number,
  variableInfo?: any
): Promise<number> {
  let size = 0;
  
  // Strategy 1: Parse from variableInfo.value or variableInfo.result
  if (variableInfo) {
    const val = variableInfo.value || variableInfo.result || "";
    const sizeMatch = val.match(/size\s*=\s*(\d+)/) || val.match(/length\s*=\s*(\d+)/) || val.match(/\[(\d+)\]/);
    if (sizeMatch) {
      size = parseInt(sizeMatch[1]);
      if (!isNaN(size) && size > 0) {
        console.log(`Parsed vector size from variableInfo: ${size}`);
        return size;
      }
    }
  }
  
  // Strategy 2: Evaluate size() expression with debugger-specific syntax
  const context = getEvaluateContext(debugSession);
  
  // Different expressions for different debuggers
  let sizeExpressions: string[];
  if (isUsingLLDB(debugSession)) {
    // LLDB doesn't support C-style casts like (int)
    sizeExpressions = [
      `${variableName}.size()`,
      `(long long)${variableName}.size()`,
      `(size_t)${variableName}.size()`
    ];
  } else if (isUsingMSVC(debugSession)) {
    sizeExpressions = [
      `(int)${variableName}.size()`,
      `${variableName}.size()`,
      `(long long)${variableName}.size()`
    ];
  } else {
    // GDB (cppdbg) and fallback
    sizeExpressions = [
      `(int)${variableName}.size()`,
      `${variableName}.size()`,
      `(long long)${variableName}.size()`
    ];
  }
  
  for (const expr of sizeExpressions) {
    try {
      console.log(`Trying size expression: ${expr}`);
      const sizeResponse = await debugSession.customRequest("evaluate", {
        expression: expr,
        frameId: frameId,
        context: context
      });
      
      const parsed = parseInt(sizeResponse.result);
      if (!isNaN(parsed) && parsed > 0) {
        console.log(`Got vector size from evaluate (${expr}): ${parsed}`);
        return parsed;
      }
    } catch (e) {
      console.log(`Expression "${expr}" failed:`, e);
    }
  }
  
  console.log("Could not get vector size from any method");
  return 0;
}

// ============== std::array Support ==============

/**
 * Get data pointer for std::array.
 * For std::array, the data is stored inline, so we need to get the address of the first element.
 * 
 * Internal structure varies by implementation:
 * - GCC libstdc++: _M_elems array member
 * - Clang libc++: __elems_ array member  
 * - MSVC: _Elems array member
 * 
 * Note: std::array.data() returns the pointer to the first element.
 */
export async function getStdArrayDataPointer(
  debugSession: vscode.DebugSession,
  variableName: string,
  frameId: number,
  variableInfo?: any
): Promise<string | null> {
  const context = getEvaluateContext(debugSession);
  console.log(`getStdArrayDataPointer: variableName="${variableName}", debugger=${debugSession.type}`);
  
  let dataPtr: string | null = null;
  
  // Try variables approach first (most reliable for LLDB)
  if (variableInfo && variableInfo.variablesReference > 0) {
    try {
      const varsResponse = await debugSession.customRequest("variables", {
        variablesReference: variableInfo.variablesReference
      });
      
      if (varsResponse.variables && varsResponse.variables.length > 0) {
        console.log(`Found ${varsResponse.variables.length} variables in std::array`);
        
        // Look for internal data member
        // libc++: __elems_, libstdc++: _M_elems, MSVC: _Elems
        for (const v of varsResponse.variables) {
          const varName = v.name;
          if (varName === "__elems_" || varName === "_M_elems" || varName === "_Elems") {
            console.log(`Found internal array member: ${varName}`);
            
            // Get memoryReference from this member
            if (v.memoryReference) {
              dataPtr = v.memoryReference;
              console.log(`Got data pointer from ${varName}.memoryReference: ${dataPtr}`);
              break;
            }
            
            // Try to expand and get first element
            if (v.variablesReference > 0) {
              const elemVars = await debugSession.customRequest("variables", {
                variablesReference: v.variablesReference
              });
              if (elemVars.variables && elemVars.variables.length > 0) {
                const firstElem = elemVars.variables[0];
                if (firstElem.memoryReference) {
                  dataPtr = firstElem.memoryReference;
                  console.log(`Got data pointer from ${varName}[0].memoryReference: ${dataPtr}`);
                  break;
                }
              }
            }
          }
        }
        
        // Fallback: look for [0] element directly
        if (!dataPtr) {
          const firstElement = varsResponse.variables.find((v: any) => v.name === "[0]");
          if (firstElement) {
            console.log(`Found [0] element: value="${firstElement.value}", memoryReference="${firstElement.memoryReference}"`);
            
            if (firstElement.memoryReference) {
              dataPtr = firstElement.memoryReference;
              console.log(`Got data pointer from [0].memoryReference: ${dataPtr}`);
            } else if (firstElement.value) {
              const ptrMatch = firstElement.value.match(/0x[0-9a-fA-F]+/);
              if (ptrMatch) {
                dataPtr = ptrMatch[0];
                console.log(`Extracted pointer from [0] value: ${dataPtr}`);
              }
            }
          }
        }
      }
    } catch (e) {
      console.log("Failed to get std::array data pointer through variables:", e);
    }
  }
  
  // Try evaluate expressions if variables approach didn't work
  if (!dataPtr) {
    let expressions: string[];
    
    if (isUsingMSVC(debugSession)) {
      expressions = [
        `(long long)${variableName}.data()`,
        `(long long)&${variableName}[0]`,
        `(long long)&${variableName}._Elems[0]`,
        `reinterpret_cast<long long>(${variableName}.data())`,
        `reinterpret_cast<long long>(&${variableName}[0])`
      ];
    } else if (isUsingLLDB(debugSession)) {
      expressions = [
        `${variableName}.data()`,
        `&${variableName}[0]`,
        `${variableName}.__elems_`,
        `&${variableName}.__elems_[0]`,
        `reinterpret_cast<long long>(${variableName}.data())`,
        `reinterpret_cast<long long>(&${variableName}[0])`
      ];
    } else if (isUsingCppdbg(debugSession)) {
      // GDB
      expressions = [
        `(long long)${variableName}.data()`,
        `(long long)&${variableName}[0]`,
        `(long long)&${variableName}._M_elems[0]`,
        `(long long)${variableName}._M_elems`,
        `reinterpret_cast<long long>(${variableName}.data())`,
        `reinterpret_cast<long long>(&${variableName}[0])`
      ];
    } else {
      // Fallback
      expressions = [
        `${variableName}.data()`,
        `&${variableName}[0]`,
        `(void*)${variableName}.data()`,
        `(void*)&${variableName}[0]`
      ];
    }
    
    dataPtr = await tryGetDataPointer(debugSession, variableName, expressions, frameId, context);
  }
  
  console.log(`getStdArrayDataPointer result: ${dataPtr}`);
  return dataPtr;
}

/**
 * Get data pointer for 2D std::array (array of arrays).
 * The data is stored contiguously in row-major order.
 * We need to get the address of the first element of the first inner array.
 */
export async function get2DStdArrayDataPointer(
  debugSession: vscode.DebugSession,
  variableName: string,
  frameId: number,
  variableInfo?: any
): Promise<string | null> {
  const context = getEvaluateContext(debugSession);
  console.log(`get2DStdArrayDataPointer: variableName="${variableName}", debugger=${debugSession.type}`);
  
  let dataPtr: string | null = null;
  
  // Try variables approach first
  if (variableInfo && variableInfo.variablesReference > 0) {
    try {
      const varsResponse = await debugSession.customRequest("variables", {
        variablesReference: variableInfo.variablesReference
      });
      
      if (varsResponse.variables && varsResponse.variables.length > 0) {
        console.log(`Found ${varsResponse.variables.length} variables in 2D std::array`);
        
        // Look for internal data member or [0] element
        for (const v of varsResponse.variables) {
          const varName = v.name;
          
          // Check for internal array member
          if (varName === "__elems_" || varName === "_M_elems" || varName === "_Elems") {
            console.log(`Found internal array member: ${varName}`);
            
            // Expand to get first row
            if (v.variablesReference > 0) {
              const rowVars = await debugSession.customRequest("variables", {
                variablesReference: v.variablesReference
              });
              if (rowVars.variables && rowVars.variables.length > 0) {
                const firstRow = rowVars.variables[0];
                console.log(`First row [0]: value="${firstRow.value}", memRef="${firstRow.memoryReference}"`);
                
                // Get memory reference of first row
                if (firstRow.variablesReference > 0) {
                  // Expand first row to get first element
                  const elemVars = await debugSession.customRequest("variables", {
                    variablesReference: firstRow.variablesReference
                  });
                  
                  // Look for [0][0] or internal array
                  for (const ev of elemVars.variables) {
                    if (ev.name === "[0]" || ev.name === "__elems_" || ev.name === "_M_elems" || ev.name === "_Elems") {
                      if (ev.memoryReference) {
                        dataPtr = ev.memoryReference;
                        console.log(`Got 2D data pointer from first element: ${dataPtr}`);
                        break;
                      }
                      // If it's the internal array, expand further
                      if (ev.variablesReference > 0 && (ev.name === "__elems_" || ev.name === "_M_elems" || ev.name === "_Elems")) {
                        const innerVars = await debugSession.customRequest("variables", {
                          variablesReference: ev.variablesReference
                        });
                        if (innerVars.variables && innerVars.variables.length > 0 && innerVars.variables[0].memoryReference) {
                          dataPtr = innerVars.variables[0].memoryReference;
                          console.log(`Got 2D data pointer from inner first element: ${dataPtr}`);
                          break;
                        }
                      }
                    }
                  }
                  if (dataPtr) break;
                }
                
                // Try first row's memoryReference
                if (!dataPtr && firstRow.memoryReference) {
                  dataPtr = firstRow.memoryReference;
                  console.log(`Got 2D data pointer from first row memRef: ${dataPtr}`);
                  break;
                }
              }
            }
          }
          
          // Check for [0] element (first row)
          if (!dataPtr && varName === "[0]") {
            console.log(`Found [0] (first row): value="${v.value}", memRef="${v.memoryReference}"`);
            
            if (v.variablesReference > 0) {
              // Expand first row to get first element [0][0]
              const elemVars = await debugSession.customRequest("variables", {
                variablesReference: v.variablesReference
              });
              
              // Look for [0] in the first row
              const firstElem = elemVars.variables?.find((ev: any) => ev.name === "[0]");
              if (firstElem) {
                if (firstElem.memoryReference) {
                  dataPtr = firstElem.memoryReference;
                  console.log(`Got 2D data pointer from [0][0].memoryReference: ${dataPtr}`);
                  break;
                }
              }
              
              // Look for internal array member
              for (const ev of elemVars.variables || []) {
                if (ev.name === "__elems_" || ev.name === "_M_elems" || ev.name === "_Elems") {
                  if (ev.memoryReference) {
                    dataPtr = ev.memoryReference;
                    console.log(`Got 2D data pointer from [0].${ev.name}: ${dataPtr}`);
                    break;
                  }
                  if (ev.variablesReference > 0) {
                    const innerVars = await debugSession.customRequest("variables", {
                      variablesReference: ev.variablesReference
                    });
                    if (innerVars.variables && innerVars.variables.length > 0 && innerVars.variables[0].memoryReference) {
                      dataPtr = innerVars.variables[0].memoryReference;
                      console.log(`Got 2D data pointer from [0].${ev.name}[0]: ${dataPtr}`);
                      break;
                    }
                  }
                }
              }
            }
            
            // Fallback: use [0]'s memoryReference
            if (!dataPtr && v.memoryReference) {
              dataPtr = v.memoryReference;
              console.log(`Got 2D data pointer from [0] memRef: ${dataPtr}`);
            }
          }
          
          if (dataPtr) break;
        }
      }
    } catch (e) {
      console.log("Failed to get 2D std::array data pointer through variables:", e);
    }
  }
  
  // Try evaluate expressions if variables approach didn't work
  if (!dataPtr) {
    let expressions: string[];
    
    if (isUsingMSVC(debugSession)) {
      expressions = [
        `(long long)&${variableName}[0][0]`,
        `(long long)${variableName}[0].data()`,
        `(long long)&${variableName}._Elems[0]._Elems[0]`,
        `reinterpret_cast<long long>(&${variableName}[0][0])`
      ];
    } else if (isUsingLLDB(debugSession)) {
      expressions = [
        `&${variableName}[0][0]`,
        `${variableName}[0].data()`,
        `&${variableName}.__elems_[0].__elems_[0]`,
        `reinterpret_cast<long long>(&${variableName}[0][0])`
      ];
    } else if (isUsingCppdbg(debugSession)) {
      // GDB
      expressions = [
        `(long long)&${variableName}[0][0]`,
        `(long long)${variableName}[0].data()`,
        `(long long)&${variableName}._M_elems[0]._M_elems[0]`,
        `reinterpret_cast<long long>(&${variableName}[0][0])`
      ];
    } else {
      // Fallback
      expressions = [
        `&${variableName}[0][0]`,
        `${variableName}[0].data()`,
        `(void*)&${variableName}[0][0]`
      ];
    }
    
    dataPtr = await tryGetDataPointer(debugSession, variableName, expressions, frameId, context);
  }
  
  console.log(`get2DStdArrayDataPointer result: ${dataPtr}`);
  return dataPtr;
}

