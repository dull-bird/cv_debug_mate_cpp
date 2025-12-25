import * as vscode from "vscode";
import { 
  getCurrentFrameId, 
  getEvaluateContext, 
  isUsingMSVC, 
  isUsingLLDB, 
  tryGetDataPointer, 
  readMemoryChunked 
} from "../utils/debugger";
import { getWebviewContentForPlot } from "./plotWebview";
import { PanelManager } from "../utils/panelManager";
import * as fs from 'fs';
import { getMatInfoFromVariables } from "../matImage/matProvider";
import { getBytesPerElement } from "../utils/opencv";

export async function drawPlot(
  debugSession: vscode.DebugSession,
  variableName: string,
  elementTypeOrMat: string | { rows: number, cols: number, channels: number, depth: number, dataPtr: string }
) {
  try {
    let initialData: number[] | null = null;
    
    if (typeof elementTypeOrMat === 'string') {
        console.log(`Drawing plot for vector: ${variableName}, element type: ${elementTypeOrMat}`);
        initialData = await readVectorDataInternal(debugSession, variableName, elementTypeOrMat);
    } else {
        console.log(`Drawing plot for 1D Mat: ${variableName}, info:`, elementTypeOrMat);
        initialData = await readMatDataInternal(debugSession, variableName, elementTypeOrMat);
    }

    if (!initialData) return;

    // 6. Show webview
    const panelTitle = `View: ${variableName}`;
    const panel = PanelManager.getOrCreatePanel(
      "CurvePlotViewer",
      panelTitle,
      debugSession.id,
      variableName
    );

    panel.webview.html = getWebviewContentForPlot(variableName, initialData);

    // Dispose old listener to avoid duplicates
    if ((panel as any)._messageListener) {
        (panel as any)._messageListener.dispose();
    }

    (panel as any)._messageListener = panel.webview.onDidReceiveMessage(async (message) => {
        if (message.command === 'requestOptions') {
            const variables = await vscode.commands.executeCommand<any[]>('cv-debugmate.getVariables');
            if (variables) {
                const currentSize = initialData.length;
                const frameId = await getCurrentFrameId(debugSession);
                const context = getEvaluateContext(debugSession);
                
                const validOptions: string[] = [];
                
                // Use Promise.all to speed up size evaluations
                const sizePromises = variables
                    .filter(v => v.kind === 'plot')
                    .map(async (v) => {
                        try {
                            // If size is already known and non-zero, use it
                            if (v.size && v.size > 0) {
                                if (v.size === currentSize) return v.name;
                                return null;
                            }

                            // Otherwise evaluate once
                            let size = 0;
                            if (v.type.includes("cv::Mat")) {
                                const matSizeResp = await debugSession.customRequest("evaluate", {
                                    expression: `(int)${v.evaluateName}.rows * (int)${v.evaluateName}.cols`,
                                    frameId: frameId,
                                    context: context
                                });
                                size = parseInt(matSizeResp.result);
                            } else {
                                const sizeResp = await debugSession.customRequest("evaluate", {
                                    expression: `(int)${v.evaluateName}.size()`,
                                    frameId: frameId,
                                    context: context
                                });
                                size = parseInt(sizeResp.result);
                            }
                            
                            if (size === currentSize) {
                                return v.name;
                            }
                        } catch (e) {
                            return null;
                        }
                        return null;
                    });
                
                const results = await Promise.all(sizePromises);
                results.forEach(name => {
                    if (name && name !== variableName) {
                        validOptions.push(name);
                    }
                });

                panel.webview.postMessage({ command: 'updateOptions', options: validOptions });
            }
        } else if (message.command === 'requestData') {
            const variables = await vscode.commands.executeCommand<any[]>('cv-debugmate.getVariables');
            const targetVar = variables?.find(v => v.name === message.name);
            if (targetVar) {
                let newData: number[] | null = null;
                if (targetVar.type.includes("cv::Mat")) {
                    const frameId = await getCurrentFrameId(debugSession);
                    const matInfo = await getMatInfoFromVariables(debugSession, targetVar.variablesReference);
                    newData = await readMatDataInternal(debugSession, targetVar.evaluateName, matInfo);
                } else {
                    newData = await readVectorDataInternal(debugSession, targetVar.evaluateName, targetVar.type, initialData!.length);
                }
                
                if (newData) {
                    panel.webview.postMessage({ 
                        command: 'updateData', 
                        target: message.target, 
                        data: newData, 
                        name: message.name 
                    });
                }
            }
        } else if (message.command === 'saveFile') {
            const options: vscode.SaveDialogOptions = {
                defaultUri: vscode.Uri.file(message.defaultName),
                filters: message.type === 'png' ? { 'Images': ['png'] } : { 'Data': ['csv'] }
            };

            const fileUri = await vscode.window.showSaveDialog(options);
            if (fileUri) {
                if (message.type === 'png') {
                    const base64Data = message.data.replace(/^data:image\/png;base64,/, "");
                    fs.writeFileSync(fileUri.fsPath, base64Data, 'base64');
                } else {
                    fs.writeFileSync(fileUri.fsPath, message.data);
                }
                vscode.window.showInformationMessage(`File saved to ${fileUri.fsPath}`);
            }
        }
    });

  } catch (error: any) {
    vscode.window.showErrorMessage(`Failed to draw plot: ${error.message}`);
    console.error(error);
  }
}

async function readMatDataInternal(
    debugSession: vscode.DebugSession,
    variableName: string,
    matInfo: { rows: number, cols: number, channels: number, depth: number, dataPtr: string }
): Promise<number[] | null> {
    const size = matInfo.rows * matInfo.cols;
    const bytesPerElement = getBytesPerElement(matInfo.depth);
    const totalBytes = size * bytesPerElement;
    
    const buffer = await readMemoryChunked(debugSession, matInfo.dataPtr, totalBytes);
    if (!buffer) return null;

    const data: number[] = [];
    const depth = matInfo.depth;
    
    for (let i = 0; i < size; i++) {
        const offset = i * bytesPerElement;
        let val: number = 0;
        switch (depth) {
            case 0: val = buffer.readUInt8(offset); break;
            case 1: val = buffer.readInt8(offset); break;
            case 2: val = buffer.readUInt16LE(offset); break;
            case 3: val = buffer.readInt16LE(offset); break;
            case 4: val = buffer.readInt32LE(offset); break;
            case 5: val = buffer.readFloatLE(offset); break;
            case 6: val = buffer.readDoubleLE(offset); break;
        }
        data.push(val);
    }
    return data;
}

async function readVectorDataInternal(
    debugSession: vscode.DebugSession,
    variableName: string,
    type: string,
    expectedSize?: number
): Promise<number[] | null> {
    const frameId = await getCurrentFrameId(debugSession);
    const context = getEvaluateContext(debugSession);

    // Check if it's actually a Mat (for X axis selection or similar)
    if (type.includes("cv::Mat")) {
        // This is a bit tricky, we'd need matInfo here. 
        // For now let's focus on the initial plot.
        return null;
    }

    // 1. Get vector size
    const sizeResponse = await debugSession.customRequest("evaluate", {
      expression: `(int)${variableName}.size()`,
      frameId: frameId,
      context: context
    });
    const size = parseInt(sizeResponse.result);

    if (isNaN(size) || size <= 0) {
      vscode.window.showWarningMessage(`Vector ${variableName} is empty or size could not be determined.`);
      return null;
    }

    if (expectedSize !== undefined && size !== expectedSize) {
        vscode.window.showErrorMessage(`Vector size mismatch: ${size} vs ${expectedSize}`);
        return null;
    }

    // 2. Determine element size and read function
    let bytesPerElement = 4;
    let readMethod: (buffer: Buffer, offset: number) => number = (b, o) => b.readFloatLE(o);

    const typeLower = type.toLowerCase();
    if (typeLower.includes("double")) {
        bytesPerElement = 8;
        readMethod = (b, o) => b.readDoubleLE(o);
    } else if (typeLower.includes("float")) {
        bytesPerElement = 4;
        readMethod = (b, o) => b.readFloatLE(o);
    } else if (typeLower.includes("unsigned char") || typeLower.includes("uchar") || typeLower.includes("uint8_t")) {
        bytesPerElement = 1;
        readMethod = (b, o) => b.readUInt8(o);
    } else if (typeLower.includes("char") || typeLower.includes("int8_t")) {
        bytesPerElement = 1;
        readMethod = (b, o) => b.readInt8(o);
    } else if (typeLower.includes("unsigned short") || typeLower.includes("ushort") || typeLower.includes("uint16_t")) {
        bytesPerElement = 2;
        readMethod = (b, o) => b.readUInt16LE(o);
    } else if (typeLower.includes("short") || typeLower.includes("int16_t")) {
        bytesPerElement = 2;
        readMethod = (b, o) => b.readInt16LE(o);
    } else if (typeLower.includes("unsigned int") || typeLower.includes("uint32_t")) {
        bytesPerElement = 4;
        readMethod = (b, o) => b.readUInt32LE(o);
    } else if (typeLower.includes("int") || typeLower.includes("int32_t")) {
        bytesPerElement = 4;
        readMethod = (b, o) => b.readInt32LE(o);
    } else if (typeLower.includes("unsigned long long") || typeLower.includes("uint64_t")) {
        bytesPerElement = 8;
        readMethod = (b, o) => Number(b.readBigUInt64LE(o));
    } else if (typeLower.includes("long long") || typeLower.includes("int64_t")) {
        bytesPerElement = 8;
        readMethod = (b, o) => Number(b.readBigInt64LE(o));
    } else if (typeLower.includes("unsigned long")) {
        bytesPerElement = 4;
        readMethod = (b, o) => b.readUInt32LE(o);
    } else if (typeLower.includes("long")) {
        bytesPerElement = 4;
        readMethod = (b, o) => b.readInt32LE(o);
    }

    // 3. Get data pointer
    let dataPtr: string | null = null;
    const ptrExprs = [
        `${variableName}.data()`, 
        `&${variableName}[0]`, 
        `(void*)${variableName}.data()`,
        `(void*)&${variableName}[0]`
    ];
    
    dataPtr = await tryGetDataPointer(debugSession, variableName, ptrExprs, frameId, context);

    if (!dataPtr) {
        vscode.window.showErrorMessage(`Could not get data pointer for vector ${variableName}.`);
        return null;
    }

    // 4. Read memory
    const totalBytes = size * bytesPerElement;
    const buffer = await readMemoryChunked(debugSession, dataPtr, totalBytes);

    if (!buffer) {
        vscode.window.showErrorMessage(`Failed to read memory for vector ${variableName}.`);
        return null;
    }

    // 5. Convert to numbers
    const data: number[] = [];
    for (let i = 0; i < size; i++) {
        data.push(readMethod(buffer, i * bytesPerElement));
    }
    return data;
}
