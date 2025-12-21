import * as vscode from "vscode";
import { getEvaluateContext } from "./utils/debugger";
import { isPoint3Vector, isMat } from "./utils/opencv";
import { drawPointCloud } from "./pointCloud/pointCloudProvider";
import { drawMatImage } from "./matImage/matProvider";
import { CVVariablesProvider, CVVariable } from "./cvVariablesProvider";
import { PanelManager } from "./utils/panelManager";

export function activate(context: vscode.ExtensionContext) {
  console.log('Extension "cv-debugmate-cpp" is now active.');

  const cvVariablesProvider = new CVVariablesProvider();
  vscode.window.registerTreeDataProvider("cv-debugmate-variables", cvVariablesProvider);

  // Auto refresh when debug session stops or stack frame changes
  context.subscriptions.push(
    vscode.debug.onDidChangeActiveStackItem(() => {
      cvVariablesProvider.refresh();
    })
  );

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

  async function visualizeVariable(variable: any) {
    console.log("========== OpenCV Visualizer Start ==========");
    const debugSession = vscode.debug.activeDebugSession;

    if (!debugSession) {
      vscode.window.showErrorMessage("No active debug session.");
      return;
    }

    try {
      const variableName = variable.evaluateName || variable.name;

      // Get the current thread and stack frame
      console.log("--- Getting Thread and Frame ---");
      const threadsResponse = await debugSession.customRequest("threads");
      const threadId = threadsResponse.threads[0].id;
      
      const stackTraceResponse = await debugSession.customRequest(
        "stackTrace",
        {
          threadId: threadId,
          startFrame: 0,
          levels: 1,
        }
      );
      const frameId = stackTraceResponse.stackFrames[0].id;
      console.log("Using frameId:", frameId);

      // Generate a state token to avoid redundant refreshes
      const stateToken = `${debugSession.id}-${threadId}-${frameId}`;

      // Pre-check if panel is fresh to avoid expensive evaluation and memory reading
      if (PanelManager.isPanelFresh("MatImageViewer", debugSession.id, variableName, stateToken) ||
          PanelManager.isPanelFresh("3DPointViewer", debugSession.id, variableName, stateToken)) {
        console.log("Panel is fresh, just revealing it.");
        const viewType = isMat(variable) ? "MatImageViewer" : "3DPointViewer";
        PanelManager.getOrCreatePanel(viewType, `View: ${variableName}`, debugSession.id, variableName);
        return;
      }

      console.log("--- Variable Info ---");
      console.log("variable.name:", variable?.name);
      console.log("variable.value:", variable?.value);
      console.log("variable.type:", variable?.type);
      console.log("variable.evaluateName:", variable?.evaluateName);
      console.log("variable.variablesReference:", variable?.variablesReference);

      if (!variable || (!variable.name && !variable.evaluateName)) {
        vscode.window.showErrorMessage("No variable selected.");
        console.log("ERROR: No variable selected");
        return;
      }

      const isLLDB = debugSession.type === "lldb";
      let variableInfo: any;
      
      if (isLLDB) {
        try {
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
        } catch (error) {
          variableInfo = {
            result: variable.value,
            type: variable.type,
            variablesReference: variable.variablesReference,
            evaluateName: variableName
          };
        }
      } else {
        const evalContext = getEvaluateContext(debugSession);
        variableInfo = await debugSession.customRequest("evaluate", {
          expression: variableName,
          frameId: frameId,
          context: evalContext,
        });
        variableInfo.evaluateName = variableName;
      }

      const point3Info = isPoint3Vector(variableInfo);
      const isMatType = isMat(variableInfo);
      
      if (point3Info.isPoint3) {
        await drawPointCloud(debugSession, variableInfo, variableName, point3Info.isDouble);
        PanelManager.updateStateToken("3DPointViewer", debugSession.id, variableName, stateToken);
      } else if (isMatType) {
        await drawMatImage(debugSession, variableInfo, frameId, variableName);
        PanelManager.updateStateToken("MatImageViewer", debugSession.id, variableName, stateToken);
      } else {
        vscode.window.showErrorMessage(
          "Variable is neither a vector of cv::Point3f/cv::Point3d nor a cv::Mat."
        );
      }
      
      console.log("========== OpenCV Visualizer End ==========");
    } catch (error: any) {
      vscode.window.showErrorMessage(`Error: ${error.message || error}`);
      console.log("ERROR during execution:", error);
    }
  }

  // Register the command to visualize from context menu
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "extension.viewVariable",
      async (selectedVariable: any) => {
        const variable = selectedVariable.variable;
        await visualizeVariable(variable);
      }
    )
  );

  // Register the command to visualize from the tree view
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "cv-debugmate.viewVariable",
      async (cvVariable: CVVariable) => {
        await visualizeVariable(cvVariable);
      }
    )
  );
}
