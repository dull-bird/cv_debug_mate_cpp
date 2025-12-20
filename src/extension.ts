import * as vscode from "vscode";
import { getEvaluateContext } from "./utils/debugger";
import { isPoint3Vector, isMat } from "./utils/opencv";
import { drawPointCloud } from "./pointCloud/pointCloudProvider";
import { drawMatImage } from "./matImage/matProvider";

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
