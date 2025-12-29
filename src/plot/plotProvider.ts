import * as vscode from "vscode";
import { 
  getCurrentFrameId, 
  getEvaluateContext, 
  isUsingMSVC, 
  isUsingLLDB, 
  isUsingCppdbg,
  tryGetDataPointer, 
  readMemoryChunked,
  getMemorySample,
  getVectorSize
} from "../utils/debugger";
import { getWebviewContentForPlot } from "./plotWebview";
import { PanelManager } from "../utils/panelManager";
import * as fs from 'fs';
import { getMatInfoFromVariables } from "../matImage/matProvider";
import { getBytesPerElement } from "../utils/opencv";

export async function drawPlot(
  debugSession: vscode.DebugSession,
  variableName: string,
  elementTypeOrMat: string | { rows: number, cols: number, channels: number, depth: number, dataPtr: string },
  reveal: boolean = true,
  force: boolean = false,
  variableInfo?: any,
  isSet: boolean = false
) {
  try {
    let initialData: number[] | null = null;
    let dataPtrForToken = "";
    
    if (typeof elementTypeOrMat === 'string') {
        if (isSet) {
            console.log(`Drawing plot for set: ${variableName}, element type: ${elementTypeOrMat}`);
            const result = await readSetDataInternal(debugSession, variableName, elementTypeOrMat, variableInfo);
            if (result) {
                initialData = result.data;
                dataPtrForToken = `set:${result.data.length}`;
            }
        } else {
            console.log(`Drawing plot for vector: ${variableName}, element type: ${elementTypeOrMat}`);
            const result = await readVectorDataInternal(debugSession, variableName, elementTypeOrMat, undefined, variableInfo);
            if (result) {
                initialData = result.data;
                dataPtrForToken = result.dataPtr || "";
            }
        }
    } else {
        console.log(`Drawing plot for 1D Mat: ${variableName}, info:`, elementTypeOrMat);
        initialData = await readMatDataInternal(debugSession, variableName, elementTypeOrMat);
        dataPtrForToken = elementTypeOrMat.dataPtr || "";
    }

    if (!initialData) return;

    const panelTitle = `View: ${variableName}`;
    // Check if panel is already fresh with this hard state token
    // For plots, we can determine the sample bytes based on the element type
    let totalBytes = initialData.length * 4; // Default to 4 bytes per element
    if (typeof elementTypeOrMat !== 'string') {
        totalBytes = initialData.length * getBytesPerElement(elementTypeOrMat.depth);
    }
    
    const sample = dataPtrForToken ? await getMemorySample(debugSession, dataPtrForToken, totalBytes) : "";
    const stateToken = `${initialData.length}|${dataPtrForToken}|${sample}`;
    
    const panel = PanelManager.getOrCreatePanel(
      "CurvePlotViewer",
      panelTitle,
      debugSession.id,
      variableName,
      reveal
    );

    if (!force && PanelManager.isPanelFresh("CurvePlotViewer", debugSession.id, variableName, stateToken)) {
      console.log(`Plot panel is already up-to-date with token: ${stateToken}`);
      return;
    }

    // Update state token
    PanelManager.updateStateToken("CurvePlotViewer", debugSession.id, variableName, stateToken);

    // If panel already has content, only send data to preserve view state
    if (panel.webview.html && panel.webview.html.length > 0) {
      console.log("Plot panel already has HTML, sending only data");
      await panel.webview.postMessage({
        command: 'updateInitialData',
        data: initialData
      });
      return;
    }

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
                    // Pass targetVar as variableInfo to support LLDB size detection
                    const result = await readVectorDataInternal(debugSession, targetVar.evaluateName, targetVar.type, initialData!.length, targetVar);
                    newData = result ? result.data : null;
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
        } else if (message.command === 'reload') {
            await vscode.commands.executeCommand('cv-debugmate.viewVariable', { name: variableName, evaluateName: variableName, skipToken: true });
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
    expectedSize?: number,
    variableInfo?: any
): Promise<{ data: number[], dataPtr: string | null } | null> {
    const frameId = variableInfo?.frameId || await getCurrentFrameId(debugSession);
    const context = getEvaluateContext(debugSession);

    console.log(`readVectorDataInternal: variableName="${variableName}", type="${type}", debugger=${debugSession.type}`);

    // Check if it's actually a Mat (for X axis selection or similar)
    if (type.includes("cv::Mat")) {
        // This is a bit tricky, we'd need matInfo here. 
        // For now let's focus on the initial plot.
        return null;
    }

    // 1. Get vector size using the common utility function
    const size = await getVectorSize(debugSession, variableName, frameId, variableInfo);

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

    // 3. Get data pointer - with special handling for different debuggers
    let dataPtr: string | null = null;
    
    if (isUsingLLDB(debugSession)) {
        console.log("Using LLDB-specific approaches for 1D vector");
        
        // First, try to get data pointer through variables if we have variablesReference
        if (variableInfo && variableInfo.variablesReference > 0) {
            try {
                console.log(`Trying to get data pointer through variables, variablesReference=${variableInfo.variablesReference}`);
                const varsResponse = await debugSession.customRequest("variables", {
                    variablesReference: variableInfo.variablesReference
                });
                
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
                    if (!dataPtr) {
                        const firstElement = varsResponse.variables.find((v: any) => v.name === "[0]");
                        if (firstElement) {
                            console.log(`Found [0] element: value="${firstElement.value}", memoryReference="${firstElement.memoryReference}"`);
                            
                            if (firstElement.memoryReference) {
                                dataPtr = firstElement.memoryReference;
                                console.log(`Using memoryReference from [0] element as data pointer: ${dataPtr}`);
                            } else if (firstElement.value) {
                                const ptrMatch = firstElement.value.match(/0x[0-9a-fA-F]+/);
                                if (ptrMatch) {
                                    dataPtr = ptrMatch[0];
                                    console.log(`Extracted pointer from [0] element value: ${dataPtr}`);
                                }
                            }
                        }
                    }
                }
            } catch (e) {
                console.log("Failed to get data pointer through variables:", e);
            }
        }
        
        // If variables approach didn't work, try evaluate expressions
        if (!dataPtr) {
            const lldbExpressions = [
                `${variableName}.__begin_`,
                `reinterpret_cast<long long>(${variableName}.__begin_)`,
                `${variableName}.data()`,
                `reinterpret_cast<long long>(${variableName}.data())`,
                `&${variableName}[0]`,
                `reinterpret_cast<long long>(&${variableName}[0])`
            ];
            dataPtr = await tryGetDataPointer(debugSession, variableName, lldbExpressions, frameId, context);
        }
        
    } else if (isUsingMSVC(debugSession)) {
        console.log("Using MSVC-specific approaches for 1D vector");
        const msvcExpressions = [
            `(long long)&${variableName}[0]`,
            `reinterpret_cast<long long>(&${variableName}[0])`,
            `(long long)${variableName}.data()`,
            `reinterpret_cast<long long>(${variableName}.data())`
        ];
        dataPtr = await tryGetDataPointer(debugSession, variableName, msvcExpressions, frameId, context);
        
    } else if (isUsingCppdbg(debugSession)) {
        console.log("Using GDB-specific approaches for 1D vector");
        const gdbExpressions = [
            `(long long)${variableName}._M_impl._M_start`,
            `reinterpret_cast<long long>(${variableName}._M_impl._M_start)`,
            `(long long)${variableName}.data()`,
            `reinterpret_cast<long long>(${variableName}.data())`,
            `(long long)&${variableName}[0]`
        ];
        dataPtr = await tryGetDataPointer(debugSession, variableName, gdbExpressions, frameId, context);
        
    } else {
        // Fallback: try all approaches
        console.log("Unknown debugger type, trying generic approaches");
        const ptrExprs = [
            `${variableName}.data()`, 
            `&${variableName}[0]`, 
            `(void*)${variableName}.data()`,
            `(void*)&${variableName}[0]`
        ];
        dataPtr = await tryGetDataPointer(debugSession, variableName, ptrExprs, frameId, context);
    }

    if (!dataPtr) {
        vscode.window.showErrorMessage(`Could not get data pointer for vector ${variableName}.`);
        return null;
    }

    // 4. Read memory
    const totalBytes = size * bytesPerElement;
    console.log(`Reading ${size} elements (${totalBytes} bytes) from ${dataPtr}`);
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
    console.log(`Successfully read ${data.length} elements`);
    return { data, dataPtr };
}

// Read data from std::set by iterating through elements via variablesReference
// Set is a red-black tree, so we cannot use contiguous memory reading
async function readSetDataInternal(
    debugSession: vscode.DebugSession,
    variableName: string,
    type: string,
    variableInfo?: any
): Promise<{ data: number[] } | null> {
    const frameId = variableInfo?.frameId || await getCurrentFrameId(debugSession);
    const context = getEvaluateContext(debugSession);

    console.log(`readSetDataInternal: variableName="${variableName}", type="${type}", debugger=${debugSession.type}`);

    // 1. Get set size
    const size = await getVectorSize(debugSession, variableName, frameId, variableInfo);

    if (isNaN(size) || size <= 0) {
        vscode.window.showWarningMessage(`Set ${variableName} is empty or size could not be determined.`);
        return null;
    }

    console.log(`Set size: ${size}`);

    // 2. Determine parse function based on element type
    const typeLower = type.toLowerCase();
    let parseValue: (val: string) => number;
    
    if (typeLower.includes("double")) {
        parseValue = (val) => parseFloat(val);
    } else if (typeLower.includes("float")) {
        parseValue = (val) => parseFloat(val);
    } else {
        parseValue = (val) => parseInt(val);
    }

    // 3. Read elements via variablesReference
    const data: number[] = [];
    
    if (variableInfo && variableInfo.variablesReference > 0) {
        try {
            const varsResponse = await debugSession.customRequest("variables", {
                variablesReference: variableInfo.variablesReference
            });
            
            if (varsResponse.variables && varsResponse.variables.length > 0) {
                console.log(`Found ${varsResponse.variables.length} variables in set`);
                
                for (const v of varsResponse.variables) {
                    // Skip internal implementation details
                    if (v.name.startsWith('_') || v.name.startsWith('__')) continue;
                    
                    // Check if it's an indexed element [0], [1], etc.
                    if (v.name.match(/^\[\d+\]$/)) {
                        const val = parseValue(v.value);
                        if (!isNaN(val)) {
                            data.push(val);
                        }
                    }
                }
                
                // If no indexed elements found, try to parse all numeric values
                if (data.length === 0) {
                    for (const v of varsResponse.variables) {
                        if (v.name.startsWith('_') || v.name.startsWith('__')) continue;
                        const val = parseValue(v.value);
                        if (!isNaN(val)) {
                            data.push(val);
                        }
                    }
                }
            }
        } catch (e) {
            console.log("Failed to read set elements via variablesReference:", e);
        }
    }

    // 4. If variablesReference approach didn't work or returned fewer elements,
    // try to evaluate elements one by one (slower but more reliable)
    if (data.length < size && data.length < 1000) {
        console.log(`Only got ${data.length} elements from variablesReference, trying evaluate approach`);
        
        // For std::set, we need to iterate. Try using *std::next or evaluate each index
        // This is a fallback and may not work on all debuggers
        try {
            // Try to get begin iterator and iterate
            const beginExpr = `*${variableName}.begin()`;
            const beginResp = await debugSession.customRequest("evaluate", {
                expression: beginExpr,
                frameId: frameId,
                context: context
            });
            
            if (beginResp && beginResp.result) {
                const firstVal = parseValue(beginResp.result);
                if (!isNaN(firstVal) && data.length === 0) {
                    data.push(firstVal);
                }
            }
        } catch (e) {
            console.log("Evaluate approach for set also failed:", e);
        }
    }

    if (data.length === 0) {
        vscode.window.showErrorMessage(`Failed to read elements from set ${variableName}.`);
        return null;
    }

    // Sort the data since set is ordered
    data.sort((a, b) => a - b);

    console.log(`Successfully read ${data.length} elements from set`);
    return { data };
}
