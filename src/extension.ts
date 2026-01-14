import * as vscode from "vscode";
import { getEvaluateContext, is2DStdArrayEnhanced, is2DCStyleArrayEnhanced, is1DCStyleArrayEnhanced, is3DCStyleArrayEnhanced, is3DStdArrayEnhanced } from "./utils/debugger";
import { drawPointCloud, drawStdArrayPointCloud } from "./pointCloud/pointCloudProvider";
import { drawMatImage, drawMatxImage, draw2DStdArrayImage, draw3DArrayImage } from "./matImage/matProvider";
import { drawPlot, drawStdArrayPlot, drawCStyleArrayPlot } from "./plot/plotProvider";
import { CVVariablesProvider, CVVariable } from "./cvVariablesProvider";
import { PanelManager } from "./utils/panelManager";
import { SyncManager } from "./utils/syncManager";
import { isPoint3Vector, isMat, is1DVector, isLikely1DMat, is1DSet, isMatx, is2DStdArray, is1DStdArray, isPoint3StdArray, is2DCStyleArray, is1DCStyleArray, is3DCStyleArray, is3DStdArray, isUninitializedOrInvalid, isUninitializedMat, isUninitializedMatFromChildren, isUninitializedVector, isPointerType, getPointerEvaluateExpression } from "./utils/opencv";
import { getMatInfoFromVariables } from "./matImage/matProvider";
import { logDebug, logInfo, logError } from "./utils/logger";

// Request deduplication: prevent multiple simultaneous requests for the same variable
const pendingRequests = new Map<string, Promise<void>>();

export function activate(context: vscode.ExtensionContext) {
  // Global safety nets to surface unexpected errors that may desync UI
  process.on('unhandledRejection', (reason: any) => {
    console.error('[cv-debugmate] UnhandledPromiseRejection:', reason);
  });
  process.on('uncaughtException', (error: any) => {
    console.error('[cv-debugmate] UncaughtException:', error);
  });

  logInfo('Extension "cv-debugmate-cpp" is now active.');

  // Initialize PanelManager with extension context for webview serialization support
  // This enables "Move into New Window" and "Copy into New Window" functionality
  PanelManager.initialize(context);

  const cvVariablesProvider = new CVVariablesProvider();
  vscode.window.registerTreeDataProvider("cv-debugmate-variables", cvVariablesProvider);

  // Auto refresh when debug session stops or stack frame changes
  let isRefreshing = false;
  context.subscriptions.push(
    vscode.debug.onDidChangeActiveStackItem(() => {
      cvVariablesProvider.refresh();
      // Debug position moved, increment global version
      PanelManager.incrementDebugStateVersion();
      // DISABLED: Auto-refresh causes issues when panels are in new windows
      // Users can manually refresh using the Reload button in each webview
      // if (!isRefreshing) {
      //   refreshVisiblePanels(false);
      // }
    })
  );

  async function refreshVisiblePanels(force: boolean = false) {
    const debugSession = vscode.debug.activeDebugSession;
    if (!debugSession) {
      isRefreshing = false;
      return;
    }
    
    // Prevent concurrent refresh operations
    if (isRefreshing) {
      logDebug("Skipping refresh - already in progress");
      return;
    }
    isRefreshing = true;

    try {
      const panels = PanelManager.getAllPanels();
      const visiblePanels: { viewType: string; sessionId: string; variableName: string }[] = [];
      
      for (const [key, entry] of panels.entries()) {
        // Skip panels that are being disposed
        if ((entry.panel as any)._isDisposing) continue;
        
        if (entry.panel.visible) {
          const parts = key.split(':::');
          const [viewType, sessionId, variableName] = parts;
          if (sessionId === debugSession.id) {
            visiblePanels.push({ viewType, sessionId, variableName });
          }
        }
      }
      
      // Double-check debug session is still active before refreshing
      if (!vscode.debug.activeDebugSession || vscode.debug.activeDebugSession.id !== debugSession.id) {
        logDebug("Debug session changed during refresh preparation, aborting");
        return;
      }
      
      // Limit concurrent refreshes to avoid overwhelming the debugger
      const MAX_CONCURRENT = 2;
      for (let i = 0; i < visiblePanels.length; i += MAX_CONCURRENT) {
        // Check again before each batch
        if (!vscode.debug.activeDebugSession || vscode.debug.activeDebugSession.id !== debugSession.id) {
          logDebug("Debug session changed during refresh, aborting");
          break;
        }
        
        const batch = visiblePanels.slice(i, i + MAX_CONCURRENT);
        await Promise.all(batch.map(async ({ variableName }) => {
          try {
            await visualizeVariable({ name: variableName, evaluateName: variableName }, true, false);
          } catch (e) {
            logDebug(`Failed to refresh panel for ${variableName}:`, e);
          }
        }));
      }
    } catch (e) {
      logError("Error in refreshVisiblePanels:", e);
    } finally {
      isRefreshing = false;
    }
  }

  // Clear when debug session terminates
  context.subscriptions.push(
    vscode.debug.onDidTerminateDebugSession((session) => {
      cvVariablesProvider.refresh();
      PanelManager.closeSessionPanels(session.id);
      SyncManager.clearAllStates(); // Clear all saved view states
    })
  );

  // Manual refresh command
  context.subscriptions.push(
    vscode.commands.registerCommand("cv-debugmate.refreshVariables", () => {
      cvVariablesProvider.refresh();
    })
  );

  // Refresh visible panels command
  context.subscriptions.push(
    vscode.commands.registerCommand("cv-debugmate.refreshVisiblePanels", () => {
      refreshVisiblePanels();
    })
  );

  // Helper command for providers
  context.subscriptions.push(
    vscode.commands.registerCommand("cv-debugmate.getVariables", () => {
      return cvVariablesProvider.getVariables();
    })
  );

  // Pair variables command
  context.subscriptions.push(
    vscode.commands.registerCommand("cv-debugmate.pairVariable", async (cvVar: CVVariable) => {
      const variables = cvVariablesProvider.getVariables();
      const options = variables
        .filter(v => v.name !== cvVar.name && v.kind === cvVar.kind)
        .map(v => ({ label: v.name, description: v.type }));

      if (options.length === 0) {
        vscode.window.showInformationMessage(`No other ${cvVar.kind === 'mat' ? 'image' : 'point cloud'} variables found to pair with.`);
        return;
      }

      const selected = await vscode.window.showQuickPick(options, {
        placeHolder: `Select a variable to pair with ${cvVar.name}`
      });

      if (selected) {
        cvVariablesProvider.setPairing(cvVar.name, selected.label);
        vscode.window.showInformationMessage(`Paired ${cvVar.name} with ${selected.label}`);
      }
    })
  );

  // Unpair variable command
  context.subscriptions.push(
    vscode.commands.registerCommand("cv-debugmate.unpairVariable", (cvVar: CVVariable) => {
      const pairedVars = cvVariablesProvider.getPairedVariables(cvVar.name);
      cvVariablesProvider.unpair(cvVar.name);
      if (pairedVars.length > 0) {
        vscode.window.showInformationMessage(`Unpaired ${cvVar.name} from group (${pairedVars.join(', ')})`);
      }
    })
  );

  async function visualizeVariable(variable: any, force: boolean = false, reveal: boolean = true) {
    const debugSession = vscode.debug.activeDebugSession;

    if (!debugSession) {
      if (reveal) vscode.window.showErrorMessage("No active debug session.");
      return;
    }

    try {
      let variableName = variable.evaluateName || variable.name;
      // If variable contains skipToken, we treat it as a force refresh
      const shouldForce = force || variable.skipToken;
      
      // Check if this is a pointer type from CVVariable
      const isPointer = variable.isPointer || false;
      const baseType = variable.baseType || "";
      
      // For panel management, use the original variable name (without dereference)
      // This ensures pointer and its pointee share the same panel
      const panelVariableName = variable.name || variableName.replace(/^\(\*/, '').replace(/\)$/, '');
      
      // Request deduplication: if already processing this variable, wait for it
      const requestKey = `${debugSession.id}:${panelVariableName}`;
      if (pendingRequests.has(requestKey)) {
        logDebug(`Request for ${panelVariableName} already in progress, waiting...`);
        await pendingRequests.get(requestKey);
        return;
      }
      
      // Create promise for this request
      const requestPromise = (async () => {
        try {
          await visualizeVariableInternal(variable, variableName, panelVariableName, isPointer, baseType, shouldForce, reveal, debugSession);
        } finally {
          pendingRequests.delete(requestKey);
        }
      })();
      
      pendingRequests.set(requestKey, requestPromise);
      await requestPromise;
      
    } catch (error: any) {
      if (reveal) vscode.window.showErrorMessage(`Error: ${error.message || error}`);
      logError("ERROR during execution:", error);
    }
  }
  
  async function visualizeVariableInternal(
    variable: any,
    variableName: string,
    panelVariableName: string,
    isPointer: boolean,
    baseType: string,
    shouldForce: boolean,
    reveal: boolean,
    debugSession: vscode.DebugSession
  ) {
    // Check if there's an existing panel for this variable that's being disposed
    // If so, skip this request to avoid triggering debug operations during cleanup
    const existingPanels = PanelManager.getAllPanels();
    for (const [key, entry] of existingPanels.entries()) {
      if (key.includes(panelVariableName) && (entry.panel as any)._isDisposing) {
        logDebug(`Skipping visualization - panel for ${panelVariableName} is being disposed`);
        return;
      }
    }
      // Get the current thread and stack frame
      // First, try to use the user's currently selected stack frame (important for multi-threaded debugging)
      let frameId: number;
      let threadId: number;
      
      const activeStackItem = vscode.debug.activeStackItem;
      if (activeStackItem && 'frameId' in activeStackItem) {
        // User has selected a specific stack frame
        const stackFrame = activeStackItem as vscode.DebugStackFrame;
        frameId = stackFrame.frameId;
        threadId = stackFrame.threadId;
        console.log(`Using user-selected stack frame: frameId=${frameId}, threadId=${threadId}`);
      } else {
        // Fallback: use first thread's top frame
        const threadsResponse = await debugSession.customRequest("threads");
        if (!threadsResponse || !threadsResponse.threads || threadsResponse.threads.length === 0) {
          return;
        }
        threadId = threadsResponse.threads[0].id;
        
        const stackTraceResponse = await debugSession.customRequest(
          "stackTrace",
          {
            threadId: threadId,
            startFrame: 0,
            levels: 1,
          }
        );
        if (!stackTraceResponse || !stackTraceResponse.stackFrames || stackTraceResponse.stackFrames.length === 0) {
          return;
        }
        frameId = stackTraceResponse.stackFrames[0].id;
        console.log(`Using fallback (first thread top frame): frameId=${frameId}, threadId=${threadId}`);
      }

      // Pre-check if panel is fresh to avoid expensive evaluation and memory reading
      const isLLDB = debugSession.type === "lldb";
      let variableInfo: any;
      
      try {
        if (isLLDB) {
          const evalResult = await debugSession.customRequest("evaluate", {
            expression: variableName,
            frameId: frameId,
            context: "watch",
          });
          
          variableInfo = {
            result: evalResult.result || variable.value,
            type: evalResult.type || variable.type,
            variablesReference: evalResult.variablesReference || variable.variablesReference,
            evaluateName: variableName
          };
          
          // For pointers, update the type to the base type for type checking
          if (isPointer && baseType) {
            variableInfo.type = baseType;
          }
        } else {
          const evalContext = getEvaluateContext(debugSession);
          variableInfo = await debugSession.customRequest("evaluate", {
            expression: variableName,
            frameId: frameId,
            context: evalContext,
          });
          variableInfo.evaluateName = variableName;
          
          // For pointers, update the type to the base type for type checking
          if (isPointer && baseType) {
            variableInfo.type = baseType;
          }
        }
      } catch (e) {
        // If evaluation fails, the variable might be out of scope
        console.log(`Variable ${variableName} evaluation failed, might be out of scope.`);
        return;
      }

      // Check for uninitialized or invalid variables first
      const valueStr = variableInfo.result || variableInfo.value || "";
      if (isUninitializedOrInvalid(valueStr)) {
        vscode.window.showWarningMessage(
          `Variable "${variableName}" appears to be uninitialized or invalid.\n` +
          `Value: ${valueStr}\n\n` +
          `Please initialize the variable before visualizing it.`
        );
        console.warn(`Variable "${variableName}" appears to be uninitialized or invalid: ${valueStr}`);
        return;
      }

      const point3Info = isPoint3Vector(variableInfo);
      const isMatType = isMat(variableInfo);
      
      // Check for uninitialized Point3 vector
      if (point3Info.isPoint3 && isUninitializedVector(point3Info.size)) {
        vscode.window.showWarningMessage(
          `std::vector<Point3> "${variableName}" appears to be uninitialized.\n` +
          `Detected suspicious size: ${point3Info.size}\n\n` +
          `Please initialize the vector before visualizing it.`
        );
        console.warn(`std::vector<Point3> "${variableName}" appears to be uninitialized (size=${point3Info.size})`);
        return;
      }
      
      // Special check for cv::Mat - check if it has suspicious member values
      if (isMatType && isUninitializedMat(variableInfo)) {
        vscode.window.showWarningMessage(
          `cv::Mat "${variableName}" appears to be uninitialized.\n` +
          `Detected suspicious values:\n` +
          `- datastart/dataend: <not available>\n` +
          `- Unreasonable dimensions or channel count\n\n` +
          `Please initialize the Mat before visualizing it.`
        );
        console.warn(`cv::Mat "${variableName}" appears to be uninitialized (suspicious member values)`);
        return;
      }
      
      const matxInfo = isMatx(variableInfo);
      const is1DMatType = isLikely1DMat(variableInfo);
      const vector1D = is1DVector(variableInfo);
      const set1D = is1DSet(variableInfo);
      const confirmed1DSize = SyncManager.getConfirmed1DSize(variableName);
      
      // Check for uninitialized 1D vector
      if (vector1D.is1D && isUninitializedVector(vector1D.size)) {
        vscode.window.showWarningMessage(
          `std::vector<${vector1D.elementType}> "${variableName}" appears to be uninitialized.\n` +
          `Detected suspicious size: ${vector1D.size}\n\n` +
          `Please initialize the vector before visualizing it.`
        );
        console.warn(`std::vector<${vector1D.elementType}> "${variableName}" appears to be uninitialized (size=${vector1D.size})`);
        return;
      }
      
      // Check for uninitialized 1D set
      if (set1D.isSet && isUninitializedVector(set1D.size)) {
        vscode.window.showWarningMessage(
          `std::set<${set1D.elementType}> "${variableName}" appears to be uninitialized.\n` +
          `Detected suspicious size: ${set1D.size}\n\n` +
          `Please initialize the set before visualizing it.`
        );
        console.warn(`std::set<${set1D.elementType}> "${variableName}" appears to be uninitialized (size=${set1D.size})`);
        return;
      }
      
      // std::array detection
      // OPTIMIZATION: Skip slow array detection if we already know the type
      // isPoint3Vector and isMat are fast (string matching), while is*Enhanced are slow (debugger commands)
      let stdArray2D = { is2DArray: false, rows: 0, cols: 0, elementType: "", depth: 0 };
      let stdArray1D = { is1DArray: false, elementType: "", size: 0 };
      let stdArrayPoint3 = { isPoint3Array: false, isDouble: false, size: 0 };
      let cStyleArray2D = { is2DArray: false, rows: 0, cols: 0, elementType: "", depth: 0 };
      let cStyleArray1D = { is1DArray: false, elementType: "", size: 0 };
      let cStyleArray3D = { is3DArray: false, height: 0, width: 0, channels: 0, elementType: "", depth: 0 };
      let stdArray3D = { is3DArray: false, height: 0, width: 0, channels: 0, elementType: "", depth: 0 };
      
      // Only run slow array detection if we don't already know the type
      const knownType = point3Info.isPoint3 || isMatType || matxInfo.isMatx || vector1D.is1D || set1D.isSet || is1DMatType.is1D || confirmed1DSize !== undefined;
      console.log(`knownType=${knownType} (point3=${point3Info.isPoint3}, mat=${isMatType}, matx=${matxInfo.isMatx}, vec1D=${vector1D.is1D}, set1D=${set1D.isSet}, mat1D=${is1DMatType.is1D}, confirmed=${confirmed1DSize !== undefined})`);
      
      if (!knownType) {
        // For LLDB, use the enhanced function that uses frame variable command to get more accurate type info
        if (isLLDB) {
          stdArray2D = await is2DStdArrayEnhanced(debugSession, variableName, frameId, variableInfo);
        } else {
          stdArray2D = is2DStdArray(variableInfo);
        }
        stdArray1D = is1DStdArray(variableInfo);
        stdArrayPoint3 = isPoint3StdArray(variableInfo);
        
        // C-style array detection
        if (isLLDB) {
          cStyleArray2D = await is2DCStyleArrayEnhanced(debugSession, variableName, frameId, variableInfo);
          cStyleArray1D = await is1DCStyleArrayEnhanced(debugSession, variableName, frameId, variableInfo);
          cStyleArray3D = await is3DCStyleArrayEnhanced(debugSession, variableName, frameId, variableInfo);
          stdArray3D = await is3DStdArrayEnhanced(debugSession, variableName, frameId, variableInfo);
        } else {
          cStyleArray2D = is2DCStyleArray(variableInfo);
          cStyleArray1D = is1DCStyleArray(variableInfo);
          cStyleArray3D = is3DCStyleArray(variableInfo);
          stdArray3D = is3DStdArray(variableInfo);
        }
      }
      
      console.log(`is1DVector result: is1D=${vector1D.is1D}, elementType=${vector1D.elementType}, size=${vector1D.size}`);
      console.log(`is1DSet result: isSet=${set1D.isSet}, elementType=${set1D.elementType}, size=${set1D.size}`);
      console.log(`isMatx result: isMatx=${matxInfo.isMatx}, rows=${matxInfo.rows}, cols=${matxInfo.cols}, depth=${matxInfo.depth}`);
      console.log(`is2DStdArray result: is2DArray=${stdArray2D.is2DArray}, rows=${stdArray2D.rows}, cols=${stdArray2D.cols}`);
      console.log(`is1DStdArray result: is1DArray=${stdArray1D.is1DArray}, elementType=${stdArray1D.elementType}, size=${stdArray1D.size}`);
      console.log(`isPoint3StdArray result: isPoint3Array=${stdArrayPoint3.isPoint3Array}, isDouble=${stdArrayPoint3.isDouble}, size=${stdArrayPoint3.size}`);
      console.log(`is1DCStyleArray result: is1DArray=${cStyleArray1D.is1DArray}, elementType=${cStyleArray1D.elementType}, size=${cStyleArray1D.size}`);
      console.log(`is3DCStyleArray result: is3DArray=${cStyleArray3D.is3DArray}, height=${cStyleArray3D.height}, width=${cStyleArray3D.width}, channels=${cStyleArray3D.channels}`);
      console.log(`is3DStdArray result: is3DArray=${stdArray3D.is3DArray}, height=${stdArray3D.height}, width=${stdArray3D.width}, channels=${stdArray3D.channels}`);
      console.log(`variableInfo.value: ${variableInfo.value || variableInfo.result}`);

      // Check for empty variables before proceeding
      let isEmpty = false;
      let reason = "";

      // std::array<Point3f/d> empty check
      if (stdArrayPoint3.isPoint3Array) {
        if (stdArrayPoint3.size === 0) {
          isEmpty = true;
          reason = "std::array Point cloud is empty";
        }
      }
      // std::array 1D empty check
      else if (stdArray1D.is1DArray) {
        if (stdArray1D.size === 0) {
          isEmpty = true;
          reason = "std::array plot data is empty";
        }
      }
      // C-style 1D array empty check
      else if (cStyleArray1D.is1DArray) {
        if (cStyleArray1D.size === 0) {
          isEmpty = true;
          reason = "1D C-style array is empty";
        }
      }
      // 3D C-style array empty check
      else if (cStyleArray3D.is3DArray) {
        if (cStyleArray3D.height === 0 || cStyleArray3D.width === 0 || cStyleArray3D.channels === 0) {
          isEmpty = true;
          reason = "3D array is empty";
        }
      }
      // 3D std::array empty check
      else if (stdArray3D.is3DArray) {
        if (stdArray3D.height === 0 || stdArray3D.width === 0 || stdArray3D.channels === 0) {
          isEmpty = true;
          reason = "3D array is empty";
        }
      }
      // std::array 2D empty check
      else if (stdArray2D.is2DArray) {
        if (stdArray2D.rows === 0 || stdArray2D.cols === 0) {
          isEmpty = true;
          reason = "2D std::array is empty";
        }
      }
      // C-style 2D array empty check
      else if (cStyleArray2D.is2DArray) {
        if (cStyleArray2D.rows === 0 || cStyleArray2D.cols === 0) {
          isEmpty = true;
          reason = "2D C-style array is empty";
        }
      }
      // std::vector<Point3f/d> empty check
      else if (point3Info.isPoint3) {
        let point3Size = point3Info.size;
        if (point3Size === 0) {
          // Try to extract from value string if size is 0
          const sizeMatch = variableInfo.result?.match(/size=(\d+)/) || 
                            variableInfo.result?.match(/of length (\d+)/) ||
                            variableInfo.result?.match(/\[(\d+)\]/);
          if (sizeMatch) {
            point3Size = parseInt(sizeMatch[1]);
          }
        }
        // GDB fallback: try evaluate (same logic as cvVariablesProvider.ts)
        if (point3Size === 0) {
          const sizeExpressions = debugSession.type === "lldb"
            ? [`${variableName}.size()`, `(long long)${variableName}.size()`]
            : [`(long long)${variableName}.size()`, `(int)${variableName}.size()`];
          
          for (const expr of sizeExpressions) {
            try {
              const sizeResp = await debugSession.customRequest("evaluate", {
                expression: expr,
                frameId: frameId,
                context: getEvaluateContext(debugSession)
              });
              const parsed = parseInt(sizeResp.result);
              if (!isNaN(parsed) && parsed > 0) {
                point3Size = parsed;
                console.log(`Got Point3 vector size via evaluate (${expr}): ${point3Size}`);
                break;
              }
            } catch (e) {
              console.log(`Failed to get Point3 vector size via ${expr}:`, e);
            }
          }
        }
        if (point3Size === 0) {
          isEmpty = true;
          reason = "Point cloud is empty";
        }
      } else if (vector1D.is1D || set1D.isSet || is1DMatType.is1D || confirmed1DSize !== undefined) {
        let size = confirmed1DSize || (vector1D.is1D ? vector1D.size : (set1D.isSet ? set1D.size : is1DMatType.size));
        
        // If size is 0, try to get it via evaluate (especially for LLDB where value string may not contain size)
        if (size === 0 && (vector1D.is1D || set1D.isSet)) {
          // Try different expressions for different debuggers
          const sizeExpressions = debugSession.type === "lldb" 
            ? [`${variableName}.size()`, `(long long)${variableName}.size()`]
            : [`(int)${variableName}.size()`, `${variableName}.size()`];
          
          for (const expr of sizeExpressions) {
            try {
              const sizeResp = await debugSession.customRequest("evaluate", {
                expression: expr,
                frameId: frameId,
                context: getEvaluateContext(debugSession)
              });
              const parsed = parseInt(sizeResp.result);
              if (!isNaN(parsed) && parsed > 0) {
                size = parsed;
                console.log(`Got container size via evaluate (${expr}): ${size}`);
                break;
              }
            } catch (e) {
              console.log(`Failed to get container size via ${expr}:`, e);
            }
          }
        }
        
        if (size === 0) {
          isEmpty = true;
          reason = "Plot data is empty";
        }
      } else if (isMatType) {
        // Mat empty check will be done after getMatInfoFromVariables or from value summary
        const dimMatch = variableInfo.result?.match(/\[\s*(\d+)\s*x\s*(\d+)\s*\]/) || variableInfo.result?.match(/(\d+)\s*x\s*(\d+)/);
        if (dimMatch) {
          const r = parseInt(dimMatch[1]);
          const c = parseInt(dimMatch[2]);
          if (r === 0 || c === 0) {
            isEmpty = true;
            reason = "Mat is empty";
          }
        }
      } else if (matxInfo.isMatx) {
        // Matx is never really empty if detected, but check dimensions
        if (matxInfo.rows === 0 || matxInfo.cols === 0) {
          isEmpty = true;
          reason = "Matx has no dimensions";
        }
      }

      if (isEmpty) {
        if (reveal) vscode.window.showInformationMessage(reason);
        return;
      }

      let viewType: "MatImageViewer" | "3DPointViewer" | "CurvePlotViewer" = "MatImageViewer";
      if (stdArrayPoint3.isPoint3Array || point3Info.isPoint3) {
        viewType = "3DPointViewer";
      } else if (stdArray1D.is1DArray || cStyleArray1D.is1DArray || vector1D.is1D || set1D.isSet || is1DMatType.is1D || confirmed1DSize !== undefined) {
        viewType = "CurvePlotViewer";
      }

      // std::array<Point3f/d> - point cloud
      if (stdArrayPoint3.isPoint3Array) {
        await drawStdArrayPointCloud(debugSession, variableInfo, variableName, stdArrayPoint3.size, stdArrayPoint3.isDouble, reveal, shouldForce, panelVariableName);
      }
      // std::array 1D - plot
      else if (stdArray1D.is1DArray) {
        await drawStdArrayPlot(debugSession, variableName, stdArray1D.elementType, stdArray1D.size, reveal, shouldForce, variableInfo, panelVariableName);
      }
      // C-style 1D array - plot
      else if (cStyleArray1D.is1DArray) {
        await drawCStyleArrayPlot(debugSession, variableName, cStyleArray1D.elementType, cStyleArray1D.size, reveal, shouldForce, variableInfo, panelVariableName);
      }
      // 3D C-style array - multi-channel image
      else if (cStyleArray3D.is3DArray) {
        await draw3DArrayImage(debugSession, variableInfo, frameId, variableName, cStyleArray3D, reveal, shouldForce, panelVariableName);
      }
      // 3D std::array - multi-channel image
      else if (stdArray3D.is3DArray) {
        await draw3DArrayImage(debugSession, variableInfo, frameId, variableName, stdArray3D, reveal, shouldForce, panelVariableName);
      }
      // std::array 2D - image
      else if (stdArray2D.is2DArray) {
        await draw2DStdArrayImage(debugSession, variableInfo, frameId, variableName, stdArray2D, reveal, shouldForce, panelVariableName);
      }
      // C-style 2D array - image
      else if (cStyleArray2D.is2DArray) {
        await draw2DStdArrayImage(debugSession, variableInfo, frameId, variableName, cStyleArray2D, reveal, shouldForce, panelVariableName);
      }
      // std::vector<Point3f/d> - point cloud
      else if (point3Info.isPoint3) {
        await drawPointCloud(debugSession, variableInfo, variableName, point3Info.isDouble, reveal, shouldForce, panelVariableName);
      } else if (matxInfo.isMatx) {
        // Handle cv::Matx types
        await drawMatxImage(debugSession, variableInfo, frameId, variableName, matxInfo, reveal, shouldForce, panelVariableName);
      } else if (isMatType) {
        // First, check if Mat is uninitialized by examining its children
        if (variableInfo.variablesReference > 0) {
          try {
            const childrenResp = await debugSession.customRequest("variables", {
              variablesReference: variableInfo.variablesReference
            });
            if (isUninitializedMatFromChildren(childrenResp.variables)) {
              vscode.window.showWarningMessage(
                `cv::Mat "${variableName}" appears to be uninitialized.\n` +
                `Detected: datastart/dataend unavailable, unreasonable dimensions, or suspicious channel count.\n\n` +
                `Please initialize the Mat before visualizing it.`
              );
              console.warn(`cv::Mat "${variableName}" appears to be uninitialized (from children analysis)`);
              return;
            }
          } catch (e) {
            console.log("Failed to check Mat children for uninitialized state:", e);
          }
        }
        
        // Confirm if it's really 1D Mat
        let matInfo = await getMatInfoFromVariables(debugSession, variableInfo.variablesReference);
        
        // Fallback for rows/cols if they are 0 (likely failed to read from variablesReference)
        if (matInfo.rows === 0 || matInfo.cols === 0) {
          try {
            const rowsResp = await debugSession.customRequest("evaluate", { expression: `(int)${variableName}.rows`, frameId, context: "watch" });
            const colsResp = await debugSession.customRequest("evaluate", { expression: `(int)${variableName}.cols`, frameId, context: "watch" });
            matInfo.rows = parseInt(rowsResp.result) || 0;
            matInfo.cols = parseInt(colsResp.result) || 0;
            
            if (matInfo.channels === 1) { // Only check channels if rows/cols were missing
               const chanResp = await debugSession.customRequest("evaluate", { expression: `(int)${variableName}.channels()`, frameId, context: "watch" });
               matInfo.channels = parseInt(chanResp.result) || 1;
            }
          } catch (e) {}
        }

        if (matInfo.channels === 1 && (matInfo.rows === 1 || matInfo.cols === 1)) {
          // Mark as 1D and refresh UI
          SyncManager.markAs1D(variableName, matInfo.rows * matInfo.cols);
          cvVariablesProvider.refresh();
          
          await drawPlot(debugSession, variableName, matInfo, reveal, shouldForce, undefined, false, panelVariableName);
        } else {
          await drawMatImage(debugSession, variableInfo, frameId, variableName, reveal, shouldForce, panelVariableName);
        }
      } else if (vector1D.is1D) {
        await drawPlot(debugSession, variableName, vector1D.elementType, reveal, shouldForce, variableInfo, false, panelVariableName);
      } else if (set1D.isSet) {
        await drawPlot(debugSession, variableName, set1D.elementType, reveal, shouldForce, variableInfo, true, panelVariableName);
      } else {
        if (reveal) {
          vscode.window.showErrorMessage(
            "Variable is not visualizable (supported: cv::Mat, cv::Matx, Point3 vector, 1D/2D std::array, 1D numeric vector, or 1D numeric set)."
          );
        }
      }
      
      // Successfully visualized, mark this panel as up-to-date for the current debug version
      PanelManager.markAsRefreshed(viewType, debugSession.id, panelVariableName);
  }

  // Register the command to visualize from context menu
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "extension.viewVariable",
      async (selectedVariable: any) => {
        const variable = selectedVariable.variable;
        await visualizeVariable(variable, false); // Changed to false
      }
    )
  );

  // Register the command to visualize from the tree view
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "cv-debugmate.viewVariable",
      async (cvVariable: CVVariable) => {
        await visualizeVariable(cvVariable, false); // Changed to false
      }
    )
  );
}
