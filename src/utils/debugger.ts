import * as vscode from "vscode";
import * as os from "os";
import { getDepthFromCppType, is2DStdArray, is2DCStyleArray, is1DCStyleArray, is3DCStyleArray, is3DStdArray } from "./opencv";

// ============== Debugger Type Detection ==============

/**
 * Supported debugger types:
 * - "lldb": CodeLLDB extension (Clang on macOS/Linux, uses libc++)
 * - "cppdbg": C/C++ extension with GDB (GCC on Linux/MinGW, uses libstdc++)
 * - "cppvsdbg": C/C++ extension with MSVC debugger (Windows, uses MSVC STL)
 */
export type DebuggerType = "lldb" | "cppdbg" | "cppvsdbg" | string;

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
 * Helper function to check if a memory reference is a valid pointer.
 * Returns false for null pointers, undefined, or very small addresses that are likely invalid.
 */
function isValidMemoryReference(memRef: string | undefined): boolean {
  if (!memRef) return false;
  
  // Check for null pointer patterns
  if (memRef === '0x0' || memRef === '0x0000000000000000' || memRef === '0x00000000') {
    return false;
  }
  
  // Parse the hex address and check if it's too small (likely invalid)
  const addr = parseInt(memRef, 16);
  if (isNaN(addr) || addr < 0x1000) {
    // Addresses below 0x1000 are typically reserved/invalid on most systems
    return false;
  }
  
  return true;
}

/**
 * Get the appropriate evaluate context for the debugger type.
 * 
 * CodeLLDB treats "repl" as command mode, so we need "watch" for expression evaluation.
 * For cppdbg and cppvsdbg, "repl" works fine for expression evaluation.
 */
export function getEvaluateContext(debugSession: vscode.DebugSession): string {
  if (isUsingLLDB(debugSession)) {
    return "watch";
  }
  return "repl";
}

// ============== STL Internal Member Names ==============

/**
 * Standard library implementations use different internal member names:
 * - libc++ (Clang): __elems_, __begin_, etc.
 * - libstdc++ (GCC): _M_elems, _M_start, etc.
 * - MSVC STL: _Elems, _Myfirst, etc.
 */
export const STL_ARRAY_MEMBERS = ["__elems_", "_M_elems", "_Elems"];
export const STL_VECTOR_DATA_MEMBERS = ["__begin_", "_M_start", "_Myfirst"];

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

// ============== Debugger-Specific Expression Builders ==============

/**
 * Build expressions to get data pointer, adapted for each debugger type.
 * Different debuggers require different cast syntax and expression formats.
 */
export function buildDataPointerExpressions(
  debugSession: vscode.DebugSession,
  variableName: string,
  accessPath: string = ".data()"
): string[] {
  if (isUsingMSVC(debugSession)) {
    return [
      `(long long)${variableName}${accessPath}`,
      `(long long)&${variableName}[0]`,
      `reinterpret_cast<long long>(${variableName}${accessPath})`,
    ];
  } else if (isUsingLLDB(debugSession)) {
    // LLDB doesn't always support C-style casts well
    return [
      `${variableName}${accessPath}`,
      `&${variableName}[0]`,
      `reinterpret_cast<long long>(${variableName}${accessPath})`,
    ];
  } else {
    // GDB (cppdbg)
    return [
      `(long long)${variableName}${accessPath}`,
      `(long long)&${variableName}[0]`,
      `reinterpret_cast<long long>(${variableName}${accessPath})`,
    ];
  }
}

/**
 * Build expressions to get container size, adapted for each debugger type.
 */
export function buildSizeExpressions(
  debugSession: vscode.DebugSession,
  variableName: string
): string[] {
  if (isUsingLLDB(debugSession)) {
    // LLDB doesn't support C-style casts like (int)
    return [
      `${variableName}.size()`,
      `(long long)${variableName}.size()`,
      `(size_t)${variableName}.size()`
    ];
  } else if (isUsingMSVC(debugSession)) {
    return [
      `(int)${variableName}.size()`,
      `${variableName}.size()`,
      `(long long)${variableName}.size()`
    ];
  } else {
    // GDB (cppdbg)
    return [
      `(int)${variableName}.size()`,
      `${variableName}.size()`,
      `(long long)${variableName}.size()`
    ];
  }
}

// ============== Basic Debugger Operations ==============

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
        if (ptrMatch && isValidMemoryReference(ptrMatch[0])) {
          console.log(`Successfully extracted pointer: ${ptrMatch[0]}`);
          return ptrMatch[0];
        }
      }
      
      // Also check memoryReference field directly
      if (dataResponse && isValidMemoryReference(dataResponse.memoryReference)) {
        console.log(`Found memoryReference: ${dataResponse.memoryReference}`);
        return dataResponse.memoryReference;
      }
    } catch (e) {
      console.log(`Expression "${expr}" failed:`, e);
    }
  }
  
  return null;
}

// ============== Container Size Utilities ==============

/**
 * Get vector/container size using multiple strategies.
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
  const sizeExpressions = buildSizeExpressions(debugSession, variableName);
  
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
            if (isValidMemoryReference(v.memoryReference)) {
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
                if (isValidMemoryReference(firstElem.memoryReference)) {
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
            
            if (isValidMemoryReference(firstElement.memoryReference)) {
              dataPtr = firstElement.memoryReference;
              console.log(`Got data pointer from [0].memoryReference: ${dataPtr}`);
            } else if (firstElement.value) {
              const ptrMatch = firstElement.value.match(/0x[0-9a-fA-F]+/);
              if (ptrMatch && isValidMemoryReference(ptrMatch[0])) {
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
                      if (isValidMemoryReference(ev.memoryReference)) {
                        dataPtr = ev.memoryReference;
                        console.log(`Got 2D data pointer from first element: ${dataPtr}`);
                        break;
                      }
                      // If it's the internal array, expand further
                      if (ev.variablesReference > 0 && (ev.name === "__elems_" || ev.name === "_M_elems" || ev.name === "_Elems")) {
                        const innerVars = await debugSession.customRequest("variables", {
                          variablesReference: ev.variablesReference
                        });
                        if (innerVars.variables && innerVars.variables.length > 0 && isValidMemoryReference(innerVars.variables[0].memoryReference)) {
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
                if (!dataPtr && isValidMemoryReference(firstRow.memoryReference)) {
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
                if (isValidMemoryReference(firstElem.memoryReference)) {
                  dataPtr = firstElem.memoryReference;
                  console.log(`Got 2D data pointer from [0][0].memoryReference: ${dataPtr}`);
                  break;
                }
              }
              
              // Look for internal array member
              for (const ev of elemVars.variables || []) {
                if (ev.name === "__elems_" || ev.name === "_M_elems" || ev.name === "_Elems") {
                  if (isValidMemoryReference(ev.memoryReference)) {
                    dataPtr = ev.memoryReference;
                    console.log(`Got 2D data pointer from [0].${ev.name}: ${dataPtr}`);
                    break;
                  }
                  if (ev.variablesReference > 0) {
                    const innerVars = await debugSession.customRequest("variables", {
                      variablesReference: ev.variablesReference
                    });
                    if (innerVars.variables && innerVars.variables.length > 0 && isValidMemoryReference(innerVars.variables[0].memoryReference)) {
                      dataPtr = innerVars.variables[0].memoryReference;
                      console.log(`Got 2D data pointer from [0].${ev.name}[0]: ${dataPtr}`);
                      break;
                    }
                  }
                }
              }
            }
            
            // Fallback: use [0]'s memoryReference
            if (!dataPtr && isValidMemoryReference(v.memoryReference)) {
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

/**
 * Get type information for 2D arrays using debugger-specific commands.
 * This uses different commands based on the debugger:
 * - LLDB: frame variable --show-types --depth 0
 * - GDB: ptype
 * - MSVC: use variable,t format
 */
export async function getArrayTypeInfo(
  debugSession: vscode.DebugSession,
  variableName: string,
  frameId: number
): Promise<{ rows: number; cols: number; elementType: string } | null> {
  console.log(`Getting type info for variable: ${variableName}, debugger: ${debugSession.type}`);
  
  try {
    let result;
    let output = '';
    
    if (isUsingLLDB(debugSession)) {
      // Try different approaches to execute the LLDB frame variable command
      
      // Approach 1: Using -exec prefix which is commonly used for LLDB commands
      const command = `-exec frame variable --show-types --depth 0 ${variableName}`;
      
      try {
        result = await debugSession.customRequest('evaluate', {
          expression: command,
          frameId: frameId,
          context: 'repl'  // Use repl context for command execution
        });
      } catch (e) {
        console.log('First approach failed, trying without -exec prefix:', e);
        
        // Approach 2: Try without -exec prefix
        try {
          result = await debugSession.customRequest('evaluate', {
            expression: `frame variable --show-types --depth 0 ${variableName}`,
            frameId: frameId,
            context: 'repl'
          });
        } catch (e2) {
          console.log('Second approach also failed:', e2);
          
          // Approach 3: Try with "expr" command
          try {
            result = await debugSession.customRequest('evaluate', {
              expression: `-exec expr -T ${variableName}`,
              frameId: frameId,
              context: 'repl'
            });
          } catch (e3) {
            console.log('All LLDB approaches failed:', e3);
            return null;
          }
        }
      }
      
      output = result.result || result.stdout || result.output || '';
      
    } else if (isUsingCppdbg(debugSession)) {
      // For GDB, use ptype command
      try {
        result = await debugSession.customRequest('evaluate', {
          expression: `-exec ptype ${variableName}`,
          frameId: frameId,
          context: 'repl'
        });
        output = result.result || result.stdout || result.output || '';
      } catch (e) {
        console.log('GDB ptype command failed, trying alternative:', e);
        try {
          // Alternative: use set print elements 0 and then print
          result = await debugSession.customRequest('evaluate', {
            expression: `-exec whatis ${variableName}`,
            frameId: frameId,
            context: 'repl'
          });
          output = result.result || result.stdout || result.output || '';
        } catch (e2) {
          console.log('GDB whatis command also failed:', e2);
          return null;
        }
      }
      
    } else if (isUsingMSVC(debugSession)) {
      // For MSVC, try using format specifier
      try {
        result = await debugSession.customRequest('evaluate', {
          expression: `${variableName},t`,  // ,t for type
          frameId: frameId,
          context: getEvaluateContext(debugSession)
        });
        output = result.result || result.stdout || result.output || '';
      } catch (e) {
        console.log('MSVC type command failed:', e);
        return null;
      }
      
    } else {
      // For other debuggers, try generic approach
      try {
        result = await debugSession.customRequest('evaluate', {
          expression: variableName,
          frameId: frameId,
          context: getEvaluateContext(debugSession)
        });
        output = result.result || result.stdout || result.output || '';
      } catch (e) {
        console.log('Generic evaluation failed:', e);
        return null;
      }
    }
    
    console.log(`Debugger command result:`, output);
    
    // Parse the result to extract type information
    // Different debuggers return different formats:
    // LLDB: (int[2][3]) rawArr ={...}
    // GDB: type = int [2][3]
    // MSVC: may return type information in different format
    
    // Match LLDB format: (int[2][3]) rawArr ={...}
    let typeMatch = output.match(/\(([^)]+)\)\s+\w+\s+=/);
    if (typeMatch) {
      const typeInfo = typeMatch[1];
      console.log(`LLDB format extracted type info: ${typeInfo}`);
      
      // Parse array dimensions: e.g., int[2][3] -> rows=2, cols=3
      const dimMatch = typeInfo.match(/([^\[\]]+)\[(\d+)\]\[(\d+)\]/);
      if (dimMatch) {
        const elementType = dimMatch[1];
        const rows = parseInt(dimMatch[2]);
        const cols = parseInt(dimMatch[3]);
        
        console.log(`Parsed LLDB dimensions: ${elementType}[${rows}][${cols}]`);
        return { rows, cols, elementType };
      }
    }
    
    // Match GDB format: type = int [2][3] or int[2][3]
    typeMatch = output.match(/(?:type\s*=\s*)?([a-zA-Z_][a-zA-Z0-9_*\s]*)\s*\[\s*(\d+)\s*\]\s*\[\s*(\d+)\s*\]/);
    if (typeMatch) {
      const elementType = typeMatch[1].trim();
      const rows = parseInt(typeMatch[2]);
      const cols = parseInt(typeMatch[3]);
      
      console.log(`Parsed GDB dimensions: ${elementType}[${rows}][${cols}]`);
      return { rows, cols, elementType };
    }
    
    // If the above doesn't work, try alternative patterns
    const altMatch = output.match(/([a-zA-Z_][a-zA-Z0-9_*\s]*)\s*\[\s*(\d+)\s*\]\s*\[\s*(\d+)\s*\]/);
    if (altMatch) {
      const elementType = altMatch[1].trim();
      const rows = parseInt(altMatch[2]);
      const cols = parseInt(altMatch[3]);
      
      console.log(`Parsed dimensions (alt): ${elementType}[${rows}][${cols}]`);
      return { rows, cols, elementType };
    }
    
    // Try to parse from a different format like: int [2][3] variableName = { ... }
    const altMatch2 = output.match(/([a-zA-Z_][a-zA-Z0-9_*\s]*)\s*\[(\d+)\]\[(\d+)\]\s+\w+\s*=/);
    if (altMatch2) {
      const elementType = altMatch2[1].trim();
      const rows = parseInt(altMatch2[2]);
      const cols = parseInt(altMatch2[3]);
      
      console.log(`Parsed dimensions (alt2): ${elementType}[${rows}][${cols}]`);
      return { rows, cols, elementType };
    }
    
    console.log('Could not parse type info from debugger command output');
    return null;
  } catch (e) {
    console.log('Error executing debugger command:', e);
    return null;
  }
}

/**
 * Enhanced detection for C-style 2D arrays using debugger commands.
 * 
 * This function first tries to get accurate type information using debugger-specific
 * commands (frame variable for LLDB, ptype for GDB, etc.), then falls back to
 * basic string matching if the debugger command fails.
 * 
 * @param debugSession - The active debug session
 * @param variableName - Name of the variable to check
 * @param frameId - Current stack frame ID
 * @param variableInfo - Optional variable info from debugger
 * @returns Object with is2DArray flag and dimension/type information
 */
export async function is2DCStyleArrayEnhanced(
  debugSession: vscode.DebugSession,
  variableName: string,
  frameId: number,
  variableInfo?: any
): Promise<{ 
  is2DArray: boolean; 
  rows: number; 
  cols: number; 
  elementType: string; 
  depth: number 
}> {
  console.log(`Checking C-style 2D array using debugger command for: ${variableName}`);
  
  // First, try to get type info using the debugger-specific command
  const typeInfo = await getArrayTypeInfo(debugSession, variableName, frameId);
  
  if (typeInfo) {
    // Successfully got type info from debugger command
    const { rows, cols, elementType } = typeInfo;
    const depth = getDepthFromCppType(elementType);
    
    console.log(`Debugger detected C-style 2D array: ${elementType}[${rows}][${cols}], depth=${depth}`);
    return { is2DArray: true, rows, cols, elementType, depth };
  }
  
  // Fallback to basic string matching from opencv.ts
  console.log('Debugger command failed, falling back to basic string matching');
  return is2DCStyleArray(variableInfo);
}

/**
 * Enhanced detection for 2D std::array using debugger commands.
 * 
 * This function first tries to get accurate type information using debugger-specific
 * commands, then falls back to basic string matching if the debugger command fails.
 * 
 * Note: The function name includes "LLDB" for historical reasons, but it actually
 * works with all debuggers (LLDB, GDB, MSVC).
 * 
 * @param debugSession - The active debug session
 * @param variableName - Name of the variable to check
 * @param frameId - Current stack frame ID
 * @param variableInfo - Optional variable info from debugger
 * @returns Object with is2DArray flag and dimension/type information
 */
export async function is2DStdArrayEnhanced(
  debugSession: vscode.DebugSession,
  variableName: string,
  frameId: number,
  variableInfo?: any
): Promise<{ 
  is2DArray: boolean; 
  rows: number; 
  cols: number; 
  elementType: string; 
  depth: number 
}> {
  console.log(`Checking 2D std::array using debugger command for: ${variableName}`);
  
  // First, try to get type info using the debugger-specific command
  const typeInfo = await getArrayTypeInfo(debugSession, variableName, frameId);
  
  if (typeInfo) {
    // Successfully got type info from debugger command
    const { rows, cols, elementType } = typeInfo;
    const depth = getDepthFromCppType(elementType);
    
    console.log(`Debugger detected 2D std::array: ${elementType}[${rows}][${cols}], depth=${depth}`);
    return { is2DArray: true, rows, cols, elementType, depth };
  }
  
  // Fallback to basic string matching from opencv.ts
  console.log('Debugger command failed, falling back to basic string matching');
  return is2DStdArray(variableInfo);
}

/**
 * @deprecated Use is2DStdArrayEnhanced instead. This alias is kept for backward compatibility.
 */
export const is2DStdArrayLLDB = is2DStdArrayEnhanced;

/**
 * Get data pointer for C-style 2D array.
 * C-style arrays are stored contiguously in row-major order.
 * We need to get the address of the first element [0][0].
 */
export async function getCStyle2DArrayDataPointer(
  debugSession: vscode.DebugSession,
  variableName: string,
  frameId: number,
  variableInfo?: any
): Promise<string | null> {
  const context = getEvaluateContext(debugSession);
  console.log(`getCStyle2DArrayDataPointer: variableName="${variableName}", debugger=${debugSession.type}`);
  
  let dataPtr: string | null = null;

  // Try variables approach first
  if (variableInfo && variableInfo.variablesReference > 0) {
    try {
      const varsResponse = await debugSession.customRequest("variables", {
        variablesReference: variableInfo.variablesReference
      });
      
      if (varsResponse.variables && varsResponse.variables.length > 0) {
        console.log(`Found ${varsResponse.variables.length} variables in C-style 2D array`);
        
        // Look for [0] element (first row)
        for (const v of varsResponse.variables) {
          const varName = v.name;
          
          if (varName === "[0]") {
            console.log(`Found [0] (first row): value="${v.value}", memRef="${v.memoryReference}"`);
            
            if (v.variablesReference > 0) {
              // Expand first row to get first element [0][0]
              const elemVars = await debugSession.customRequest("variables", {
                variablesReference: v.variablesReference
              });
              
              // Look for [0] in the first row (i.e., [0][0])
              const firstElem = elemVars.variables?.find((ev: any) => ev.name === "[0]");
              if (firstElem) {
                if (isValidMemoryReference(firstElem.memoryReference)) {
                  dataPtr = firstElem.memoryReference;
                  console.log(`Got C-style 2D array data pointer from [0][0].memoryReference: ${dataPtr}`);
                  break;
                } else if (firstElem.value) {
                  const ptrMatch = firstElem.value.match(/0x[0-9a-fA-F]+/);
                  if (ptrMatch && isValidMemoryReference(ptrMatch[0])) {
                    dataPtr = ptrMatch[0];
                    console.log(`Extracted pointer from [0][0] value: ${dataPtr}`);
                    break;
                  }
                }
              }
            }
            
            // Fallback: use [0]'s memoryReference
            if (!dataPtr && isValidMemoryReference(v.memoryReference)) {
              dataPtr = v.memoryReference;
              console.log(`Got C-style 2D array data pointer from [0] memRef: ${dataPtr}`);
              break;
            }
          }
          
          if (dataPtr) break;
        }
      }
    } catch (e) {
      console.log("Failed to get C-style 2D array data pointer through variables:", e);
    }
  }

  // Try evaluate expressions if variables approach didn't work
  if (!dataPtr) {
    let expressions: string[];
    
    if (isUsingMSVC(debugSession)) {
      expressions = [
        `(long long)&${variableName}[0][0]`,
        `(long long)${variableName}[0].data()`,
        `reinterpret_cast<long long>(&${variableName}[0][0])`
      ];
    } else if (isUsingLLDB(debugSession)) {
      expressions = [
        `&${variableName}[0][0]`,
        `${variableName}[0].data()`,
        `reinterpret_cast<long long>(&${variableName}[0][0])`
      ];
    } else if (isUsingCppdbg(debugSession)) {
      // GDB
      expressions = [
        `(long long)&${variableName}[0][0]`,
        `(long long)${variableName}[0].data()`,
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
  
  console.log(`getCStyle2DArrayDataPointer result: ${dataPtr}`);
  return dataPtr;
}


/**
 * Enhanced detection for C-style 1D arrays using debugger commands.
 * 
 * This function first tries to get accurate type information using debugger-specific
 * commands, then falls back to basic string matching if the debugger command fails.
 * 
 * @param debugSession - The active debug session
 * @param variableName - Name of the variable to check
 * @param frameId - Current stack frame ID
 * @param variableInfo - Optional variable info from debugger
 * @returns Object with is1DArray flag and element type/size information
 */
export async function is1DCStyleArrayEnhanced(
  debugSession: vscode.DebugSession,
  variableName: string,
  frameId: number,
  variableInfo?: any
): Promise<{ 
  is1DArray: boolean; 
  elementType: string; 
  size: number 
}> {
  console.log(`Checking C-style 1D array using debugger command for: ${variableName}`);
  
  // First, try to get type info using the debugger-specific command
  const typeInfo = await getArrayTypeInfo(debugSession, variableName, frameId);
  
  if (typeInfo) {
    // getArrayTypeInfo returns 2D info, but we can detect 1D from it
    // If rows or cols is 1, it might be a 1D array representation
    // But for true 1D arrays, we need different parsing
    console.log(`Debugger returned type info, but checking for 1D pattern`);
  }
  
  // Try to get 1D array info from debugger command output
  try {
    let result;
    let output = '';
    
    if (isUsingLLDB(debugSession)) {
      const command = `-exec frame variable --show-types --depth 0 ${variableName}`;
      try {
        result = await debugSession.customRequest('evaluate', {
          expression: command,
          frameId: frameId,
          context: 'repl'
        });
        output = result.result || result.stdout || result.output || '';
      } catch (e) {
        // Try without -exec prefix
        try {
          result = await debugSession.customRequest('evaluate', {
            expression: `frame variable --show-types --depth 0 ${variableName}`,
            frameId: frameId,
            context: 'repl'
          });
          output = result.result || result.stdout || result.output || '';
        } catch (e2) {
          console.log('LLDB command failed:', e2);
        }
      }
    } else if (isUsingCppdbg(debugSession)) {
      try {
        result = await debugSession.customRequest('evaluate', {
          expression: `-exec ptype ${variableName}`,
          frameId: frameId,
          context: 'repl'
        });
        output = result.result || result.stdout || result.output || '';
      } catch (e) {
        try {
          result = await debugSession.customRequest('evaluate', {
            expression: `-exec whatis ${variableName}`,
            frameId: frameId,
            context: 'repl'
          });
          output = result.result || result.stdout || result.output || '';
        } catch (e2) {
          console.log('GDB command failed:', e2);
        }
      }
    }
    
    console.log(`Debugger command output for 1D check:`, output);
    
    // Parse 1D array pattern: type[size] but NOT type[rows][cols]
    // First exclude 2D arrays
    if (/\[\s*\d+\s*\]\s*\[\s*\d+\s*\]/.test(output)) {
      console.log('Detected 2D array pattern, not 1D');
      return { is1DArray: false, elementType: "", size: 0 };
    }
    
    // Match LLDB format: (int[10]) arr = {...}
    let typeMatch = output.match(/\(([^)]+)\)\s+\w+\s+=/);
    if (typeMatch) {
      const typeInfo = typeMatch[1];
      // Parse 1D array: type[size]
      const dimMatch = typeInfo.match(/([^\[\]]+)\[(\d+)\]$/);
      if (dimMatch) {
        const elementType = dimMatch[1].trim();
        const size = parseInt(dimMatch[2]);
        console.log(`LLDB detected 1D array: ${elementType}[${size}]`);
        return { is1DArray: true, elementType, size };
      }
    }
    
    // Match GDB format: type = int [10]
    typeMatch = output.match(/(?:type\s*=\s*)?([a-zA-Z_][a-zA-Z0-9_*\s]*)\s*\[\s*(\d+)\s*\](?!\s*\[)/);
    if (typeMatch) {
      const elementType = typeMatch[1].trim();
      const size = parseInt(typeMatch[2]);
      console.log(`GDB detected 1D array: ${elementType}[${size}]`);
      return { is1DArray: true, elementType, size };
    }
    
  } catch (e) {
    console.log('Error in is1DCStyleArrayEnhanced:', e);
  }
  
  // Fallback to basic string matching from opencv.ts
  console.log('Debugger command failed, falling back to basic string matching');
  return is1DCStyleArray(variableInfo);
}

/**
 * Get data pointer for C-style 1D array.
 * C-style arrays are stored contiguously.
 * We need to get the address of the first element [0].
 */
export async function getCStyle1DArrayDataPointer(
  debugSession: vscode.DebugSession,
  variableName: string,
  frameId: number,
  variableInfo?: any
): Promise<string | null> {
  const context = getEvaluateContext(debugSession);
  console.log(`getCStyle1DArrayDataPointer: variableName="${variableName}", debugger=${debugSession.type}`);
  
  let dataPtr: string | null = null;

  // Try variables approach first
  if (variableInfo && variableInfo.variablesReference > 0) {
    try {
      const varsResponse = await debugSession.customRequest("variables", {
        variablesReference: variableInfo.variablesReference
      });
      
      if (varsResponse.variables && varsResponse.variables.length > 0) {
        console.log(`Found ${varsResponse.variables.length} variables in C-style 1D array`);
        
        // Look for [0] element
        const firstElem = varsResponse.variables.find((v: any) => v.name === "[0]");
        if (firstElem) {
          console.log(`Found [0] element: value="${firstElem.value}", memRef="${firstElem.memoryReference}"`);
          
          if (isValidMemoryReference(firstElem.memoryReference)) {
            dataPtr = firstElem.memoryReference;
            console.log(`Got C-style 1D array data pointer from [0].memoryReference: ${dataPtr}`);
          } else if (firstElem.value) {
            const ptrMatch = firstElem.value.match(/0x[0-9a-fA-F]+/);
            if (ptrMatch && isValidMemoryReference(ptrMatch[0])) {
              dataPtr = ptrMatch[0];
              console.log(`Extracted pointer from [0] value: ${dataPtr}`);
            }
          }
        }
      }
    } catch (e) {
      console.log("Failed to get C-style 1D array data pointer through variables:", e);
    }
  }

  // Try evaluate expressions if variables approach didn't work
  if (!dataPtr) {
    let expressions: string[];
    
    if (isUsingMSVC(debugSession)) {
      expressions = [
        `(long long)&${variableName}[0]`,
        `(long long)${variableName}`,
        `reinterpret_cast<long long>(&${variableName}[0])`
      ];
    } else if (isUsingLLDB(debugSession)) {
      expressions = [
        `&${variableName}[0]`,
        `${variableName}`,
        `reinterpret_cast<long long>(&${variableName}[0])`
      ];
    } else if (isUsingCppdbg(debugSession)) {
      // GDB
      expressions = [
        `(long long)&${variableName}[0]`,
        `(long long)${variableName}`,
        `reinterpret_cast<long long>(&${variableName}[0])`
      ];
    } else {
      // Fallback
      expressions = [
        `&${variableName}[0]`,
        `${variableName}`,
        `(void*)&${variableName}[0]`
      ];
    }
    
    dataPtr = await tryGetDataPointer(debugSession, variableName, expressions, frameId, context);
  }
  
  console.log(`getCStyle1DArrayDataPointer result: ${dataPtr}`);
  return dataPtr;
}


// ============== 3D Array Support ==============

/**
 * Get type information for 3D arrays using debugger-specific commands.
 * This uses different commands based on the debugger:
 * - LLDB: frame variable --show-types --depth 0
 * - GDB: ptype
 * - MSVC: use variable,t format
 */
export async function get3DArrayTypeInfo(
  debugSession: vscode.DebugSession,
  variableName: string,
  frameId: number
): Promise<{ height: number; width: number; channels: number; elementType: string } | null> {
  console.log(`Getting 3D array type info for variable: ${variableName}, debugger: ${debugSession.type}`);
  
  try {
    let result;
    let output = '';
    
    if (isUsingLLDB(debugSession)) {
      const command = `-exec frame variable --show-types --depth 0 ${variableName}`;
      
      try {
        result = await debugSession.customRequest('evaluate', {
          expression: command,
          frameId: frameId,
          context: 'repl'
        });
      } catch (e) {
        console.log('First approach failed, trying without -exec prefix:', e);
        
        try {
          result = await debugSession.customRequest('evaluate', {
            expression: `frame variable --show-types --depth 0 ${variableName}`,
            frameId: frameId,
            context: 'repl'
          });
        } catch (e2) {
          console.log('Second approach also failed:', e2);
          
          try {
            result = await debugSession.customRequest('evaluate', {
              expression: `-exec expr -T ${variableName}`,
              frameId: frameId,
              context: 'repl'
            });
          } catch (e3) {
            console.log('All LLDB approaches failed:', e3);
            return null;
          }
        }
      }
      
      output = result.result || result.stdout || result.output || '';
      
    } else if (isUsingCppdbg(debugSession)) {
      try {
        result = await debugSession.customRequest('evaluate', {
          expression: `-exec ptype ${variableName}`,
          frameId: frameId,
          context: 'repl'
        });
        output = result.result || result.stdout || result.output || '';
      } catch (e) {
        console.log('GDB ptype command failed, trying alternative:', e);
        try {
          result = await debugSession.customRequest('evaluate', {
            expression: `-exec whatis ${variableName}`,
            frameId: frameId,
            context: 'repl'
          });
          output = result.result || result.stdout || result.output || '';
        } catch (e2) {
          console.log('GDB whatis command also failed:', e2);
          return null;
        }
      }
      
    } else if (isUsingMSVC(debugSession)) {
      try {
        result = await debugSession.customRequest('evaluate', {
          expression: `${variableName},t`,
          frameId: frameId,
          context: getEvaluateContext(debugSession)
        });
        output = result.result || result.stdout || result.output || '';
      } catch (e) {
        console.log('MSVC type command failed:', e);
        return null;
      }
      
    } else {
      try {
        result = await debugSession.customRequest('evaluate', {
          expression: variableName,
          frameId: frameId,
          context: getEvaluateContext(debugSession)
        });
        output = result.result || result.stdout || result.output || '';
      } catch (e) {
        console.log('Generic evaluation failed:', e);
        return null;
      }
    }
    
    console.log(`Debugger command result for 3D array:`, output);
    
    // Parse the result to extract 3D array type information
    // Match LLDB format: (int[2][3][4]) arr ={...}
    let typeMatch = output.match(/\(([^)]+)\)\s+\w+\s+=/);
    if (typeMatch) {
      const typeInfo = typeMatch[1];
      console.log(`LLDB format extracted type info: ${typeInfo}`);
      
      // Parse 3D array dimensions: e.g., int[2][3][4] -> height=2, width=3, channels=4
      const dimMatch = typeInfo.match(/([^\[\]]+)\[(\d+)\]\[(\d+)\]\[(\d+)\]/);
      if (dimMatch) {
        const elementType = dimMatch[1].trim();
        const height = parseInt(dimMatch[2]);
        const width = parseInt(dimMatch[3]);
        const channels = parseInt(dimMatch[4]);
        
        console.log(`Parsed LLDB 3D dimensions: ${elementType}[${height}][${width}][${channels}]`);
        return { height, width, channels, elementType };
      }
    }
    
    // Match GDB format: type = int [2][3][4] or int[2][3][4]
    typeMatch = output.match(/(?:type\s*=\s*)?([a-zA-Z_][a-zA-Z0-9_*\s]*)\s*\[\s*(\d+)\s*\]\s*\[\s*(\d+)\s*\]\s*\[\s*(\d+)\s*\]/);
    if (typeMatch) {
      const elementType = typeMatch[1].trim();
      const height = parseInt(typeMatch[2]);
      const width = parseInt(typeMatch[3]);
      const channels = parseInt(typeMatch[4]);
      
      console.log(`Parsed GDB 3D dimensions: ${elementType}[${height}][${width}][${channels}]`);
      return { height, width, channels, elementType };
    }
    
    // Alternative pattern
    const altMatch = output.match(/([a-zA-Z_][a-zA-Z0-9_*\s]*)\s*\[\s*(\d+)\s*\]\s*\[\s*(\d+)\s*\]\s*\[\s*(\d+)\s*\]/);
    if (altMatch) {
      const elementType = altMatch[1].trim();
      const height = parseInt(altMatch[2]);
      const width = parseInt(altMatch[3]);
      const channels = parseInt(altMatch[4]);
      
      console.log(`Parsed 3D dimensions (alt): ${elementType}[${height}][${width}][${channels}]`);
      return { height, width, channels, elementType };
    }
    
    console.log('Could not parse 3D array type info from debugger command output');
    return null;
  } catch (e) {
    console.log('Error executing debugger command for 3D array:', e);
    return null;
  }
}

/**
 * Enhanced detection for C-style 3D arrays using debugger commands.
 * 
 * This function first tries to get accurate type information using debugger-specific
 * commands (frame variable for LLDB, ptype for GDB, etc.), then falls back to
 * basic string matching if the debugger command fails.
 * 
 * @param debugSession - The active debug session
 * @param variableName - Name of the variable to check
 * @param frameId - Current stack frame ID
 * @param variableInfo - Optional variable info from debugger
 * @returns Object with is3DArray flag and dimension/type information
 */
export async function is3DCStyleArrayEnhanced(
  debugSession: vscode.DebugSession,
  variableName: string,
  frameId: number,
  variableInfo?: any
): Promise<{ 
  is3DArray: boolean; 
  height: number; 
  width: number; 
  channels: number; 
  elementType: string; 
  depth: number 
}> {
  console.log(`Checking C-style 3D array using debugger command for: ${variableName}`);
  
  // First, try to get type info using the debugger-specific command
  const typeInfo = await get3DArrayTypeInfo(debugSession, variableName, frameId);
  
  if (typeInfo) {
    const { height, width, channels, elementType } = typeInfo;
    
    // Only consider it an image-suitable 3D array if channels is 1, 3, or 4
    if (channels !== 1 && channels !== 3 && channels !== 4) {
      console.log(`Debugger detected 3D array but channels=${channels} is not 1, 3, or 4`);
      return { is3DArray: false, height: 0, width: 0, channels: 0, elementType: "", depth: 0 };
    }
    
    const depth = getDepthFromCppType(elementType);
    
    console.log(`Debugger detected C-style 3D array: ${elementType}[${height}][${width}][${channels}], depth=${depth}`);
    return { is3DArray: true, height, width, channels, elementType, depth };
  }
  
  // Fallback to basic string matching from opencv.ts
  console.log('Debugger command failed, falling back to basic string matching');
  return is3DCStyleArray(variableInfo);
}

/**
 * Enhanced detection for 3D std::array using debugger commands.
 * 
 * This function first tries to get accurate type information using debugger-specific
 * commands, then falls back to basic string matching if the debugger command fails.
 * 
 * @param debugSession - The active debug session
 * @param variableName - Name of the variable to check
 * @param frameId - Current stack frame ID
 * @param variableInfo - Optional variable info from debugger
 * @returns Object with is3DArray flag and dimension/type information
 */
export async function is3DStdArrayEnhanced(
  debugSession: vscode.DebugSession,
  variableName: string,
  frameId: number,
  variableInfo?: any
): Promise<{ 
  is3DArray: boolean; 
  height: number; 
  width: number; 
  channels: number; 
  elementType: string; 
  depth: number 
}> {
  console.log(`Checking 3D std::array using debugger command for: ${variableName}`);
  
  // First, try to get type info using the debugger-specific command
  const typeInfo = await get3DArrayTypeInfo(debugSession, variableName, frameId);
  
  if (typeInfo) {
    const { height, width, channels, elementType } = typeInfo;
    
    // Only consider it an image-suitable 3D array if channels is 1, 3, or 4
    if (channels !== 1 && channels !== 3 && channels !== 4) {
      console.log(`Debugger detected 3D array but channels=${channels} is not 1, 3, or 4`);
      return { is3DArray: false, height: 0, width: 0, channels: 0, elementType: "", depth: 0 };
    }
    
    const depth = getDepthFromCppType(elementType);
    
    console.log(`Debugger detected 3D std::array: ${elementType}[${height}][${width}][${channels}], depth=${depth}`);
    return { is3DArray: true, height, width, channels, elementType, depth };
  }
  
  // Fallback to basic string matching from opencv.ts
  console.log('Debugger command failed, falling back to basic string matching');
  return is3DStdArray(variableInfo);
}

/**
 * Get data pointer for 3D array (both C-style and std::array).
 * 3D arrays are stored contiguously in row-major order.
 * We need to get the address of the first element [0][0][0].
 * 
 * @param debugSession - The active debug session
 * @param variableName - Name of the variable
 * @param frameId - Current stack frame ID
 * @param variableInfo - Optional variable info from debugger
 * @param isStdArray - Whether this is a std::array (vs C-style array)
 * @returns The memory address as a hex string, or null if failed
 */
export async function get3DArrayDataPointer(
  debugSession: vscode.DebugSession,
  variableName: string,
  frameId: number,
  variableInfo?: any,
  isStdArray: boolean = false
): Promise<string | null> {
  const context = getEvaluateContext(debugSession);
  console.log(`get3DArrayDataPointer: variableName="${variableName}", debugger=${debugSession.type}, isStdArray=${isStdArray}`);
  
  let dataPtr: string | null = null;

  // Try variables approach first (most reliable)
  if (variableInfo && variableInfo.variablesReference > 0) {
    try {
      const varsResponse = await debugSession.customRequest("variables", {
        variablesReference: variableInfo.variablesReference
      });
      
      if (varsResponse.variables && varsResponse.variables.length > 0) {
        console.log(`Found ${varsResponse.variables.length} variables in 3D array`);
        
        // For std::array, look for internal data member first
        if (isStdArray) {
          for (const v of varsResponse.variables) {
            const varName = v.name;
            
            // Check for internal array member: __elems_ (libc++), _M_elems (libstdc++), _Elems (MSVC)
            if (varName === "__elems_" || varName === "_M_elems" || varName === "_Elems") {
              console.log(`Found internal array member: ${varName}`);
              
              // Expand to get first row [0]
              if (v.variablesReference > 0) {
                const rowVars = await debugSession.customRequest("variables", {
                  variablesReference: v.variablesReference
                });
                
                if (rowVars.variables && rowVars.variables.length > 0) {
                  const firstRow = rowVars.variables[0];
                  console.log(`First row [0]: value="${firstRow.value}", memRef="${firstRow.memoryReference}"`);
                  
                  // Expand first row to get first column [0][0]
                  if (firstRow.variablesReference > 0) {
                    const colVars = await debugSession.customRequest("variables", {
                      variablesReference: firstRow.variablesReference
                    });
                    
                    if (colVars.variables && colVars.variables.length > 0) {
                      // Look for [0] or internal array member
                      for (const cv of colVars.variables) {
                        if (cv.name === "[0]" || cv.name === "__elems_" || cv.name === "_M_elems" || cv.name === "_Elems") {
                          // Expand to get first channel [0][0][0]
                          if (cv.variablesReference > 0) {
                            const chanVars = await debugSession.customRequest("variables", {
                              variablesReference: cv.variablesReference
                            });
                            
                            if (chanVars.variables && chanVars.variables.length > 0) {
                              const firstChan = chanVars.variables[0];
                              if (isValidMemoryReference(firstChan.memoryReference)) {
                                dataPtr = firstChan.memoryReference;
                                console.log(`Got 3D std::array data pointer from [0][0][0].memoryReference: ${dataPtr}`);
                                break;
                              }
                            }
                          }
                          
                          if (isValidMemoryReference(cv.memoryReference)) {
                            dataPtr = cv.memoryReference;
                            console.log(`Got 3D std::array data pointer from [0][0].memoryReference: ${dataPtr}`);
                            break;
                          }
                        }
                      }
                    }
                  }
                  
                  if (!dataPtr && isValidMemoryReference(firstRow.memoryReference)) {
                    dataPtr = firstRow.memoryReference;
                    console.log(`Got 3D std::array data pointer from [0].memoryReference: ${dataPtr}`);
                  }
                }
              }
              
              if (dataPtr) break;
            }
          }
        }
        
        // Look for [0] element (first row) - works for both C-style and std::array
        if (!dataPtr) {
          for (const v of varsResponse.variables) {
            if (v.name === "[0]") {
              console.log(`Found [0] (first row): value="${v.value}", memRef="${v.memoryReference}"`);
              
              if (v.variablesReference > 0) {
                // Expand first row to get [0][0]
                const colVars = await debugSession.customRequest("variables", {
                  variablesReference: v.variablesReference
                });
                
                const firstCol = colVars.variables?.find((cv: any) => cv.name === "[0]");
                if (firstCol) {
                  console.log(`Found [0][0]: value="${firstCol.value}", memRef="${firstCol.memoryReference}"`);
                  
                  if (firstCol.variablesReference > 0) {
                    // Expand to get [0][0][0]
                    const chanVars = await debugSession.customRequest("variables", {
                      variablesReference: firstCol.variablesReference
                    });
                    
                    const firstChan = chanVars.variables?.find((chv: any) => chv.name === "[0]");
                    if (firstChan) {
                      // Check memoryReference is valid (not null/undefined and not null pointer)
                      if (isValidMemoryReference(firstChan.memoryReference)) {
                        dataPtr = firstChan.memoryReference;
                        console.log(`Got 3D array data pointer from [0][0][0].memoryReference: ${dataPtr}`);
                        break;
                      } else if (firstChan.value) {
                        const ptrMatch = firstChan.value.match(/0x[0-9a-fA-F]+/);
                        if (ptrMatch && isValidMemoryReference(ptrMatch[0])) {
                          dataPtr = ptrMatch[0];
                          console.log(`Extracted pointer from [0][0][0] value: ${dataPtr}`);
                          break;
                        }
                      }
                    }
                  }
                  
                  // Fallback to [0][0]'s memoryReference
                  if (!dataPtr && isValidMemoryReference(firstCol.memoryReference)) {
                    dataPtr = firstCol.memoryReference;
                    console.log(`Got 3D array data pointer from [0][0].memoryReference: ${dataPtr}`);
                    break;
                  }
                }
              }
              
              // Fallback to [0]'s memoryReference
              if (!dataPtr && isValidMemoryReference(v.memoryReference)) {
                dataPtr = v.memoryReference;
                console.log(`Got 3D array data pointer from [0].memoryReference: ${dataPtr}`);
              }
              
              break;
            }
          }
        }
      }
    } catch (e) {
      console.log("Failed to get 3D array data pointer through variables:", e);
    }
  }

  // Try evaluate expressions if variables approach didn't work
  if (!dataPtr) {
    let expressions: string[];
    
    if (isUsingMSVC(debugSession)) {
      if (isStdArray) {
        expressions = [
          `(long long)&${variableName}[0][0][0]`,
          `(long long)&${variableName}._Elems[0]._Elems[0]._Elems[0]`,
          `reinterpret_cast<long long>(&${variableName}[0][0][0])`
        ];
      } else {
        expressions = [
          `(long long)&${variableName}[0][0][0]`,
          `reinterpret_cast<long long>(&${variableName}[0][0][0])`
        ];
      }
    } else if (isUsingLLDB(debugSession)) {
      if (isStdArray) {
        expressions = [
          `&${variableName}[0][0][0]`,
          `&${variableName}.__elems_[0].__elems_[0].__elems_[0]`,
          `reinterpret_cast<long long>(&${variableName}[0][0][0])`
        ];
      } else {
        expressions = [
          `&${variableName}[0][0][0]`,
          `reinterpret_cast<long long>(&${variableName}[0][0][0])`
        ];
      }
    } else if (isUsingCppdbg(debugSession)) {
      // GDB
      if (isStdArray) {
        expressions = [
          `(long long)&${variableName}[0][0][0]`,
          `(long long)&${variableName}._M_elems[0]._M_elems[0]._M_elems[0]`,
          `reinterpret_cast<long long>(&${variableName}[0][0][0])`
        ];
      } else {
        expressions = [
          `(long long)&${variableName}[0][0][0]`,
          `reinterpret_cast<long long>(&${variableName}[0][0][0])`
        ];
      }
    } else {
      // Fallback
      expressions = [
        `&${variableName}[0][0][0]`,
        `(void*)&${variableName}[0][0][0]`
      ];
    }
    
    dataPtr = await tryGetDataPointer(debugSession, variableName, expressions, frameId, context);
  }
  
  console.log(`get3DArrayDataPointer result: ${dataPtr}`);
  return dataPtr;
}
