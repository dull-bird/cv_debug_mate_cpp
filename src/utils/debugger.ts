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

