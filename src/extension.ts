import * as vscode from "vscode";
import { getEvaluateContext } from "./utils/debugger";
import { drawPointCloud } from "./pointCloud/pointCloudProvider";
import { drawMatImage } from "./matImage/matProvider";
import { drawPlot } from "./plot/plotProvider";
import { CVVariablesProvider, CVVariable } from "./cvVariablesProvider";
import { PanelManager } from "./utils/panelManager";
import { SyncManager } from "./utils/syncManager";
import { isPoint3Vector, isMat, is1DVector, isLikely1DMat, is1DSet } from "./utils/opencv";
import { getMatInfoFromVariables } from "./matImage/matProvider";

export function activate(context: vscode.ExtensionContext) {
  console.log('Extension "cv-debugmate-cpp" is now active.');

  const cvVariablesProvider = new CVVariablesProvider();
  vscode.window.registerTreeDataProvider("cv-debugmate-variables", cvVariablesProvider);

  // Auto refresh when debug session stops or stack frame changes
  context.subscriptions.push(
    vscode.debug.onDidChangeActiveStackItem(() => {
      cvVariablesProvider.refresh();
      // Debug position moved, increment global version
      PanelManager.incrementDebugStateVersion();
      // Step triggered: Refresh visible ones immediately
      refreshVisiblePanels(false);
    })
  );

  async function refreshVisiblePanels(force: boolean = false) {
    const debugSession = vscode.debug.activeDebugSession;
    if (!debugSession) return;

    const panels = PanelManager.getAllPanels();
    for (const [key, entry] of panels.entries()) {
      if (entry.panel.visible) {
        const parts = key.split(':::');
        const [viewType, sessionId, variableName] = parts;
        if (sessionId === debugSession.id) {
          try {
            // Use force=true for steps or version refreshes to ensure memory is reread
            await visualizeVariable({ name: variableName, evaluateName: variableName }, true, false);
          } catch (e) {}
        }
      }
    }
  }

  // Clear when debug session terminates
  context.subscriptions.push(
    vscode.debug.onDidTerminateDebugSession((session) => {
      cvVariablesProvider.refresh();
      PanelManager.closeSessionPanels(session.id);
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
    console.log("========== OpenCV Visualizer Start ==========");
    const debugSession = vscode.debug.activeDebugSession;

    if (!debugSession) {
      if (reveal) vscode.window.showErrorMessage("No active debug session.");
      return;
    }

    try {
      const variableName = variable.evaluateName || variable.name;
      // If variable contains skipToken, we treat it as a force refresh
      const shouldForce = force || variable.skipToken;
      
      console.log(`Visualizing variable: ${variableName}, force=${shouldForce}, reveal=${reveal}`);

      // Get the current thread and stack frame
      const threadsResponse = await debugSession.customRequest("threads");
      if (!threadsResponse || !threadsResponse.threads || threadsResponse.threads.length === 0) {
        return;
      }
      const threadId = threadsResponse.threads[0].id;
      
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
      const frameId = stackTraceResponse.stackFrames[0].id;

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
        } else {
          const evalContext = getEvaluateContext(debugSession);
          variableInfo = await debugSession.customRequest("evaluate", {
            expression: variableName,
            frameId: frameId,
            context: evalContext,
          });
          variableInfo.evaluateName = variableName;
        }
      } catch (e) {
        // If evaluation fails, the variable might be out of scope
        console.log(`Variable ${variableName} evaluation failed, might be out of scope.`);
        return;
      }

      const point3Info = isPoint3Vector(variableInfo);
      const isMatType = isMat(variableInfo);
      const is1DMatType = isLikely1DMat(variableInfo);
      const vector1D = is1DVector(variableInfo);
      const set1D = is1DSet(variableInfo);
      const confirmed1DSize = SyncManager.getConfirmed1DSize(variableName);
      
      console.log(`is1DVector result: is1D=${vector1D.is1D}, elementType=${vector1D.elementType}, size=${vector1D.size}`);
      console.log(`is1DSet result: isSet=${set1D.isSet}, elementType=${set1D.elementType}, size=${set1D.size}`);
      console.log(`variableInfo.value: ${variableInfo.value || variableInfo.result}`);

      // Check for empty variables before proceeding
      let isEmpty = false;
      let reason = "";

      if (point3Info.isPoint3) {
        if (point3Info.size === 0) {
          // Try to extract from value string if size is 0
          const sizeMatch = variableInfo.result?.match(/size=(\d+)/) || variableInfo.result?.match(/\[(\d+)\]/);
          if (!sizeMatch || parseInt(sizeMatch[1]) === 0) {
            isEmpty = true;
            reason = "Point cloud is empty";
          }
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
      }

      if (isEmpty) {
        if (reveal) vscode.window.showInformationMessage(reason);
        return;
      }

      let viewType: "MatImageViewer" | "3DPointViewer" | "CurvePlotViewer" = "MatImageViewer";
      if (point3Info.isPoint3) {
        viewType = "3DPointViewer";
      } else if (vector1D.is1D || set1D.isSet || is1DMatType.is1D || confirmed1DSize !== undefined) {
        viewType = "CurvePlotViewer";
      }

      if (point3Info.isPoint3) {
        await drawPointCloud(debugSession, variableInfo, variableName, point3Info.isDouble, reveal, shouldForce);
      } else if (isMatType) {
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
          
          await drawPlot(debugSession, variableName, matInfo, reveal, shouldForce);
        } else {
          await drawMatImage(debugSession, variableInfo, frameId, variableName, reveal, shouldForce);
        }
      } else if (vector1D.is1D) {
        await drawPlot(debugSession, variableName, vector1D.elementType, reveal, shouldForce, variableInfo, false);
      } else if (set1D.isSet) {
        await drawPlot(debugSession, variableName, set1D.elementType, reveal, shouldForce, variableInfo, true);
      } else {
        if (reveal) {
          vscode.window.showErrorMessage(
            "Variable is not visualizable (supported: cv::Mat, Point3 vector, 1D numeric vector, or 1D numeric set)."
          );
        }
      }
      
      // Successfully visualized, mark this panel as up-to-date for the current debug version
      PanelManager.markAsRefreshed(viewType, debugSession.id, variableName);
      
      console.log("========== OpenCV Visualizer End ==========");
    } catch (error: any) {
      if (reveal) vscode.window.showErrorMessage(`Error: ${error.message || error}`);
      console.log("ERROR during execution:", error);
    }
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
