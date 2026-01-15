import * as vscode from 'vscode';
import { isMat, isPoint3Vector, is1DVector, isLikely1DMat, is1DSet, isMatx, is2DStdArray, is1DStdArray, isPoint3StdArray, is2DCStyleArray, is1DCStyleArray, is3DCStyleArray, is3DStdArray, isUninitializedOrInvalid, isUninitializedMat, isUninitializedMatFromChildren, isUninitializedVector, isPointerType, getPointerEvaluateExpression } from './utils/opencv';
import { SyncManager } from './utils/syncManager';

const COLORS = [
    '#3794ef', // Blue
    '#f14c4c', // Red
    '#89d185', // Green
    '#cca700', // Yellow
    '#d18616', // Orange
    '#b180d7', // Purple
    '#117da0', // Cyan
    '#e12672', // Magenta
    '#008080', // Teal
    '#73c991', // Lime
    '#f06292', // Pink
    '#ffd700'  // Gold
];

const SVG_PATHS = {
    mat: "M0 1.75C0 .784.784 0 1.75 0h12.5C15.216 0 16 .784 16 1.75v12.5A1.75 1.75 0 0 1 14.25 16H1.75A1.75 1.75 0 0 1 0 14.25Zm1.75-.25a.25.25 0 0 0-.25.25v12.5c0 .138.112.25.25.25h12.5a.25.25 0 0 0 .25-.25V1.75a.25.25 0 0 0-.25-.25Zm10.5 4.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0ZM2.5 14.5h11V9.38l-3.344-3.345a.25.25 0 0 0-.353 0l-3.05 3.05-1.147-1.147a.25.25 0 0 0-.353 0L2.5 11.188Z",
    pointcloud: "m8.31 1.066 6.5 3.5a.75.25 0 0 1 0 .434l-6.5 3.5a.75.75 0 0 1-.62 0l-6.5-3.5a.75.25 0 0 1 0-.434l6.5-3.5a.75.75 0 0 1 .62 0ZM2.51 4.75 8 7.708l5.49-2.958L8 1.792Zm-1.2 4.016a.75.75 0 0 1 1.024-.274L8 11.208l5.666-3.05a.75.75 0 0 1 .668 1.342l-6 3.23a.75.75 0 0 1-.668 0l-6-3.23a.75.75 0 0 1-.274-1.024Zm0 3a.75.75 0 0 1 1.024-.274L8 14.208l5.666-3.05a.75.75 0 0 1 .668 1.342l-6 3.23a.75.75 0 0 1-.668 0l-6-3.23a.75.75 0 0 1-.274-1.024Z",
    group: "M3 2a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H3Zm0 1h10a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z"
};

function getColoredIcon(kind: 'mat' | 'pointcloud' | 'plot' | 'group', color: string): { light: vscode.Uri, dark: vscode.Uri } {
    let path = SVG_PATHS.group;
    if (kind === 'mat') path = SVG_PATHS.mat;
    else if (kind === 'pointcloud') path = SVG_PATHS.pointcloud;
    
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16"><path fill="${color}" d="${path}"></path></svg>`;
    const base64 = Buffer.from(svg).toString('base64');
    const iconUri = vscode.Uri.parse(`data:image/svg+xml;base64,${base64}`);
    return { light: iconUri, dark: iconUri };
}

function getColoredCircleIcon(color: string): { light: vscode.Uri, dark: vscode.Uri } {
    // Create a simple filled circle SVG
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16"><circle cx="8" cy="8" r="6" fill="${color}"/></svg>`;
    const base64 = Buffer.from(svg).toString('base64');
    const iconUri = vscode.Uri.parse(`data:image/svg+xml;base64,${base64}`);
    return { light: iconUri, dark: iconUri };
}

export class CVVariable extends vscode.TreeItem {
    public readonly isEmpty: boolean;

    constructor(
        public readonly name: string,
        public readonly type: string,
        public readonly evaluateName: string,
        public readonly variablesReference: number,
        public readonly value: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly kind: 'mat' | 'pointcloud' | 'plot',
        public readonly size: number = 0,
        public readonly sizeInfo: string = '',
        public isPaired: boolean = false,
        public pairedWith?: string,
        public groupIndex?: number,
        public readonly isPointer: boolean = false,
        public readonly baseType: string = ''
    ) {
        super(name, collapsibleState);
        this.tooltip = `${this.name}: ${this.type}${this.pairedWith ? ` (Paired with ${this.pairedWith})` : ''}${this.isPointer ? ' (pointer)' : ''}`;
        
        let typeIcon = 'file-media';
        if (kind === 'pointcloud') typeIcon = 'layers';
        else if (kind === 'plot') typeIcon = 'graph';
        
        this.isEmpty = (sizeInfo === '0' || sizeInfo === '0x0' || sizeInfo === '' || size === 0);
        const displaySize = this.isEmpty ? 'empty' : sizeInfo;
        
        // Show pointer indicator in description
        const pointerIndicator = this.isPointer ? '→ ' : '';
        this.description = `${pointerIndicator}[${displaySize}]`;

        // For mat (image) variables, always use file-media icon regardless of pairing
        if (kind === 'mat') {
            this.iconPath = new vscode.ThemeIcon('file-media');
            this.contextValue = isPaired 
                ? `cvVariablePaired:${kind}${this.isEmpty ? ':empty' : ''}${this.isPointer ? ':pointer' : ''}`
                : `cvVariable:${kind}${this.isEmpty ? ':empty' : ''}${this.isPointer ? ':pointer' : ''}`;
        } else if (isPaired && groupIndex !== undefined && kind !== 'plot') {
            // For pointcloud, use colored icon when paired
            const color = COLORS[groupIndex % COLORS.length];
            this.iconPath = getColoredIcon(kind, color);
            this.contextValue = `cvVariablePaired:${kind}${this.isEmpty ? ':empty' : ''}${this.isPointer ? ':pointer' : ''}`;
        } else {
            this.iconPath = new vscode.ThemeIcon(typeIcon);
            this.contextValue = `cvVariable:${kind}${this.isEmpty ? ':empty' : ''}${this.isPointer ? ':pointer' : ''}`;
        }

        if (!this.isEmpty) {
            this.command = {
                command: 'cv-debugmate.viewVariable',
                title: 'View Variable',
                arguments: [this]
            };
        }
    }
}

export class CVGroup extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly variables: CVVariable[],
        public readonly groupIndex?: number
    ) {
        super(label, collapsibleState);
        this.contextValue = 'cvGroup';
        
        if (groupIndex !== undefined) {
            const color = COLORS[groupIndex % COLORS.length];
            this.iconPath = getColoredCircleIcon(color);
        } else {
            this.iconPath = new vscode.ThemeIcon('circle-filled');
        }
    }
}

export class CVVariablesProvider implements vscode.TreeDataProvider<CVVariable | CVGroup> {
    private _onDidChangeTreeData: vscode.EventEmitter<CVVariable | CVGroup | undefined | void> = new vscode.EventEmitter<CVVariable | CVGroup | undefined | void>();
    readonly onDidChangeTreeData: vscode.Event<CVVariable | CVGroup | undefined | void> = this._onDidChangeTreeData.event;

    private variables: CVVariable[] = [];
    private groups: CVGroup[] = [];
    
    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    setPairing(var1: string, var2: string) {
        SyncManager.setPairing(var1, var2);
        this.refresh();
    }

    unpair(name: string) {
        SyncManager.unpair(name);
        this.refresh();
    }

    getPairedVariables(name: string): string[] {
        return SyncManager.getPairedVariables(name);
    }

    getVariables() {
        return this.variables;
    }

    getTreeItem(element: CVVariable | CVGroup): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: CVVariable | CVGroup): Promise<(CVVariable | CVGroup)[]> {
        if (element instanceof CVGroup) {
            return element.variables;
        }
        
        if (element instanceof CVVariable) {
            return [];
        }

        const debugSession = vscode.debug.activeDebugSession;
        if (!debugSession) {
            this.variables = [];
            this.groups = [];
            return [];
        }

        try {
            // First, try to get the user's currently selected stack frame
            // This is important for multi-threaded debugging
            let frameId: number;
            let threadId: number;
            
            const activeStackItem = vscode.debug.activeStackItem;
            if (activeStackItem && 'frameId' in activeStackItem) {
                // User has selected a specific stack frame
                const stackFrame = activeStackItem as vscode.DebugStackFrame;
                frameId = stackFrame.frameId;
                threadId = stackFrame.threadId;
                console.log(`CVVariablesProvider: Using user-selected stack frame: frameId=${frameId}, threadId=${threadId}`);
            } else {
                // Fallback: use first thread's top frame
                const threadsResponse = await debugSession.customRequest('threads');
                if (!threadsResponse || !threadsResponse.threads || threadsResponse.threads.length === 0) {
                    this.variables = [];
                    this.groups = [];
                    return [];
                }
                
                threadId = threadsResponse.threads[0].id;
                const stackTraceResponse = await debugSession.customRequest('stackTrace', {
                    threadId: threadId,
                    startFrame: 0,
                    levels: 1
                });
                
                if (!stackTraceResponse || !stackTraceResponse.stackFrames || stackTraceResponse.stackFrames.length === 0) {
                    this.variables = [];
                    this.groups = [];
                    return [];
                }
                
                frameId = stackTraceResponse.stackFrames[0].id;
                console.log(`CVVariablesProvider: Using fallback (first thread top frame): frameId=${frameId}, threadId=${threadId}`);
            }
            
            const scopesResponse = await debugSession.customRequest('scopes', { frameId });
            
            const visualizableVariables: CVVariable[] = [];
            const variablePromises: Promise<CVVariable | null>[] = [];
            
            for (const scope of scopesResponse.scopes) {
                const variablesResponse = await debugSession.customRequest('variables', {
                    variablesReference: scope.variablesReference
                });
                
                for (const v of variablesResponse.variables) {
                    const variableName = v.evaluateName || v.name;
                    
                    // Check if this is a pointer type
                    const pointerInfo = isPointerType(v.type || "");
                    
                    // Check if variable is uninitialized or invalid
                    const valueStr = v.value || v.result || "";
                    if (isUninitializedOrInvalid(valueStr)) {
                        console.warn(`Variable "${variableName}" appears to be uninitialized or invalid: ${valueStr}`);
                        // Add a warning variable to the list
                        const warningVar = new CVVariable(
                            variableName,
                            'uninitialized',
                            variableName,
                            0,
                            valueStr,
                            vscode.TreeItemCollapsibleState.None,
                            'mat', // Use 'mat' as default kind
                            0,
                            '⚠️ uninitialized',
                            false,
                            undefined,
                            undefined,
                            pointerInfo.isPointer,
                            pointerInfo.baseType
                        );
                        // Override the icon and tooltip for uninitialized variables
                        warningVar.iconPath = new vscode.ThemeIcon('warning', new vscode.ThemeColor('problemsWarningIcon.foreground'));
                        warningVar.tooltip = `Variable appears to be uninitialized or contains invalid data.\nValue: ${valueStr}`;
                        warningVar.contextValue = 'cvVariable:uninitialized';
                        visualizableVariables.push(warningVar);
                        continue; // Skip further processing for this variable
                    }
                    
                    // For pointer types, we need to check the dereferenced type
                    // Create a virtual variableInfo with the base type for type checking
                    let typeCheckInfo = v;
                    let actualEvaluateName = variableName;
                    
                    if (pointerInfo.isPointer) {
                        // Check if pointer is null
                        const ptrValue = v.value || "";
                        if (ptrValue === "0x0" || ptrValue === "0x0000000000000000" || ptrValue === "nullptr" || ptrValue === "NULL" || ptrValue === "0") {
                            console.log(`Pointer "${variableName}" is null, skipping`);
                            continue;
                        }
                        
                        // Create a virtual type info with the base type for type checking
                        typeCheckInfo = {
                            ...v,
                            type: pointerInfo.baseType
                        };
                        actualEvaluateName = `(*${variableName})`;
                        console.log(`Detected pointer type: ${v.type} -> base type: ${pointerInfo.baseType}`);
                    }
                    
                    // Special check for cv::Mat - check if it has suspicious member values
                    if (isUninitializedMat(typeCheckInfo)) {
                        console.warn(`cv::Mat "${variableName}" appears to be uninitialized (suspicious member values)`);
                        const warningVar = new CVVariable(
                            variableName,
                            v.type || 'cv::Mat',
                            variableName,
                            0,
                            valueStr,
                            vscode.TreeItemCollapsibleState.None,
                            'mat',
                            0,
                            '⚠️ uninitialized Mat',
                            false,
                            undefined,
                            undefined,
                            pointerInfo.isPointer,
                            pointerInfo.baseType
                        );
                        warningVar.iconPath = new vscode.ThemeIcon('warning', new vscode.ThemeColor('problemsWarningIcon.foreground'));
                        warningVar.tooltip = `cv::Mat appears to be uninitialized.\nSuspicious values detected (e.g., datastart=<not available>, unreasonable dimensions).\nValue: ${valueStr}`;
                        warningVar.contextValue = 'cvVariable:uninitialized';
                        visualizableVariables.push(warningVar);
                        continue;
                    }
                    
                    const isM = isMat(typeCheckInfo);
                    const matxInfo = isMatx(typeCheckInfo);
                    const point3 = isPoint3Vector(typeCheckInfo);
                    const vector1D = is1DVector(typeCheckInfo);
                    const set1D = is1DSet(typeCheckInfo);
                    // std::array detection
                    const stdArray2D = is2DStdArray(typeCheckInfo);
                    const stdArray1D = is1DStdArray(typeCheckInfo);
                    const stdArrayPoint3 = isPoint3StdArray(typeCheckInfo);
                    const stdArray3D = is3DStdArray(typeCheckInfo);
                    // C-style array detection
                    const cStyleArray2D = is2DCStyleArray(typeCheckInfo);
                    const cStyleArray1D = is1DCStyleArray(typeCheckInfo);
                    const cStyleArray3D = is3DCStyleArray(typeCheckInfo);

                    const checkVariable = async (): Promise<CVVariable | null> => {
                        let is1DM = isLikely1DMat(typeCheckInfo);
                        const confirmed1DSize = SyncManager.getConfirmed1DSize(variableName);
                        let r = 0, c = 0;
                        
                        // For pointers, we need to get the dereferenced variable info
                        let varRefToUse = v.variablesReference;
                        if (pointerInfo.isPointer && v.variablesReference > 0) {
                            try {
                                // Get the dereferenced variable's children
                                const derefChildren = await debugSession.customRequest('variables', {
                                    variablesReference: v.variablesReference
                                });
                                // For pointers, the first child is usually the dereferenced value
                                if (derefChildren.variables && derefChildren.variables.length > 0) {
                                    const derefVar = derefChildren.variables[0];
                                    if (derefVar.variablesReference > 0) {
                                        varRefToUse = derefVar.variablesReference;
                                    }
                                }
                            } catch (e) {
                                console.log(`Failed to get dereferenced variable info for ${variableName}:`, e);
                            }
                        }
                        
                        if (isM) {
                            const dimMatch = v.value.match(/\[\s*(\d+)\s*x\s*(\d+)\s*\]/) || v.value.match(/(\d+)\s*x\s*(\d+)/);
                            if (dimMatch) {
                                r = parseInt(dimMatch[1]);
                                c = parseInt(dimMatch[2]);
                            }
                        }

                        if (isM && varRefToUse > 0 && (r === 0 || c === 0 || (!is1DM.is1D && confirmed1DSize === undefined))) {
                            try {
                                const children = await debugSession.customRequest('variables', {
                                    variablesReference: varRefToUse
                                });
                                
                                // Check if Mat is uninitialized by examining children
                                if (isUninitializedMatFromChildren(children.variables)) {
                                    console.warn(`cv::Mat "${variableName}" appears to be uninitialized (from children analysis)`);
                                    const warningVar = new CVVariable(
                                        variableName,
                                        v.type || 'cv::Mat',
                                        variableName,
                                        0,
                                        v.value || '',
                                        vscode.TreeItemCollapsibleState.None,
                                        'mat',
                                        0,
                                        '⚠️ uninitialized',
                                        false,
                                        undefined,
                                        undefined
                                    );
                                    warningVar.iconPath = new vscode.ThemeIcon('warning', new vscode.ThemeColor('problemsWarningIcon.foreground'));
                                    warningVar.tooltip = `cv::Mat appears to be uninitialized.\nDetected: datastart/dataend unavailable, unreasonable dimensions, or suspicious channel count.`;
                                    warningVar.contextValue = 'cvVariable:uninitialized';
                                    return warningVar;
                                }
                                
                                let ch = 1;
                                let matVarRef = 0;
                                
                                for (const child of children.variables) {
                                    const val = parseInt(child.value);
                                    if (child.name === 'rows') r = val;
                                    else if (child.name === 'cols') c = val;
                                    else if (child.name === 'flags') {
                                        if (!isNaN(val)) ch = (((val & 0xFFF) >> 3) & 63) + 1;
                                    }
                                    // For cv::Mat_<T>, find the base cv::Mat member
                                    else if ((child.name === 'cv::Mat' || child.name.includes('cv::Mat') || 
                                              (child.name === 'Mat' && child.value?.includes('rows'))) && 
                                             child.variablesReference > 0) {
                                        matVarRef = child.variablesReference;
                                    }
                                }
                                
                                // If rows/cols not found directly, try from base cv::Mat member (for cv::Mat_<T>)
                                if ((r === 0 || c === 0) && matVarRef > 0) {
                                    const matChildren = await debugSession.customRequest('variables', {
                                        variablesReference: matVarRef
                                    });
                                    for (const mc of matChildren.variables) {
                                        const val = parseInt(mc.value);
                                        if (mc.name === 'rows') r = val;
                                        else if (mc.name === 'cols') c = val;
                                        else if (mc.name === 'flags') {
                                            if (!isNaN(val)) ch = (((val & 0xFFF) >> 3) & 63) + 1;
                                        }
                                    }
                                }
                                
                                if (ch === 1 && (r === 1 || c === 1) && r * c > 0) {
                                    is1DM = { is1D: true, size: r * c };
                                    SyncManager.markAs1D(variableName, r * c);
                                }
                            } catch (e) {}
                        }

                        if (isM || matxInfo.isMatx || point3.isPoint3 || vector1D.is1D || set1D.isSet || is1DM.is1D || confirmed1DSize !== undefined ||
                            stdArray2D.is2DArray || stdArray1D.is1DArray || stdArrayPoint3.isPoint3Array || cStyleArray2D.is2DArray || cStyleArray1D.is1DArray ||
                            stdArray3D.is3DArray || cStyleArray3D.is3DArray) {
                            let kind: 'mat' | 'pointcloud' | 'plot' = 'mat';
                            let size = 0;
                            let sizeInfo = '';

                            // std::array<Point3f/d> - point cloud
                            if (stdArrayPoint3.isPoint3Array) {
                                // Check for uninitialized
                                if (isUninitializedVector(stdArrayPoint3.size)) {
                                    const warningVar = new CVVariable(
                                        variableName, v.type || 'std::array<Point3>', variableName, 0, v.value || '',
                                        vscode.TreeItemCollapsibleState.None, 'pointcloud', 0, '⚠️ uninitialized',
                                        false, undefined, undefined
                                    );
                                    warningVar.iconPath = new vscode.ThemeIcon('warning', new vscode.ThemeColor('problemsWarningIcon.foreground'));
                                    warningVar.tooltip = `Array appears to be uninitialized.\nSuspicious size: ${stdArrayPoint3.size}`;
                                    warningVar.contextValue = 'cvVariable:uninitialized';
                                    return warningVar;
                                }
                                kind = 'pointcloud';
                                size = stdArrayPoint3.size;
                                sizeInfo = size > 0 ? `${size} points` : '';
                            }
                            // std::vector<Point3f/d> - point cloud
                            else if (point3.isPoint3) {
                                kind = 'pointcloud';
                                size = point3.size || 0;
                                // Try to extract size from value if available
                                if (size === 0) {
                                    const sizeMatch = v.value.match(/size=(\d+)/) || 
                                                      v.value.match(/of length (\d+)/) ||
                                                      v.value.match(/\[(\d+)\]/);
                                    if (sizeMatch) size = parseInt(sizeMatch[1]);
                                }
                                // GDB fallback: try evaluate
                                if (size === 0) {
                                    try {
                                        const sizeResp = await debugSession.customRequest("evaluate", {
                                            expression: `(long long)${variableName}.size()`,
                                            frameId,
                                            context: "watch"
                                        });
                                        const parsed = parseInt(sizeResp.result);
                                        if (!isNaN(parsed) && parsed > 0) size = parsed;
                                    } catch (e) {}
                                }
                                // Check for uninitialized after getting size
                                if (isUninitializedVector(size)) {
                                    const warningVar = new CVVariable(
                                        variableName, v.type || 'std::vector<Point3>', variableName, 0, v.value || '',
                                        vscode.TreeItemCollapsibleState.None, 'pointcloud', 0, '⚠️ uninitialized',
                                        false, undefined, undefined
                                    );
                                    warningVar.iconPath = new vscode.ThemeIcon('warning', new vscode.ThemeColor('problemsWarningIcon.foreground'));
                                    warningVar.tooltip = `Vector appears to be uninitialized.\nSuspicious size: ${size}`;
                                    warningVar.contextValue = 'cvVariable:uninitialized';
                                    return warningVar;
                                }
                                sizeInfo = size > 0 ? `${size} points` : '';
                            }
                            // 1D std::array - plot
                            else if (stdArray1D.is1DArray) {
                                kind = 'plot';
                                size = stdArray1D.size;
                                sizeInfo = size > 0 ? `${size} elements` : '';
                            }
                            // 1D C-style array - plot
                            else if (cStyleArray1D.is1DArray) {
                                kind = 'plot';
                                size = cStyleArray1D.size;
                                sizeInfo = size > 0 ? `${size} elements` : '';
                            }
                            // 1D vector/set/Mat - plot
                            else if (vector1D.is1D || set1D.isSet || is1DM.is1D || confirmed1DSize !== undefined) {
                                kind = 'plot';
                                size = confirmed1DSize || (vector1D.is1D ? vector1D.size : (set1D.isSet ? set1D.size : is1DM.size));
                                // GDB fallback: try evaluate for vectors/sets
                                if (size === 0 && (vector1D.is1D || set1D.isSet)) {
                                    try {
                                        const sizeResp = await debugSession.customRequest("evaluate", {
                                            expression: `(long long)${variableName}.size()`,
                                            frameId,
                                            context: "watch"
                                        });
                                        const parsed = parseInt(sizeResp.result);
                                        if (!isNaN(parsed) && parsed > 0) size = parsed;
                                    } catch (e) {}
                                }
                                // Check for uninitialized vector/set
                                if ((vector1D.is1D || set1D.isSet) && isUninitializedVector(size)) {
                                    const typeName = vector1D.is1D ? `std::vector<${vector1D.elementType}>` : `std::set<${set1D.elementType}>`;
                                    const warningVar = new CVVariable(
                                        variableName, v.type || typeName, variableName, 0, v.value || '',
                                        vscode.TreeItemCollapsibleState.None, 'plot', 0, '⚠️ uninitialized',
                                        false, undefined, undefined
                                    );
                                    warningVar.iconPath = new vscode.ThemeIcon('warning', new vscode.ThemeColor('problemsWarningIcon.foreground'));
                                    warningVar.tooltip = `Container appears to be uninitialized.\nSuspicious size: ${size}`;
                                    warningVar.contextValue = 'cvVariable:uninitialized';
                                    return warningVar;
                                }
                                sizeInfo = size > 0 ? `${size} elements` : '';
                            }
                            // 3D std::array - multi-channel image
                            else if (stdArray3D.is3DArray) {
                                kind = 'mat';
                                size = stdArray3D.height * stdArray3D.width * stdArray3D.channels;
                                sizeInfo = `${stdArray3D.height}x${stdArray3D.width}x${stdArray3D.channels}`;
                            }
                            // 3D C-style array - multi-channel image
                            else if (cStyleArray3D.is3DArray) {
                                kind = 'mat';
                                size = cStyleArray3D.height * cStyleArray3D.width * cStyleArray3D.channels;
                                sizeInfo = `${cStyleArray3D.height}x${cStyleArray3D.width}x${cStyleArray3D.channels}`;
                            }
                            // 2D std::array - image
                            else if (stdArray2D.is2DArray) {
                                kind = 'mat';
                                size = stdArray2D.rows * stdArray2D.cols;
                                sizeInfo = `${stdArray2D.rows}x${stdArray2D.cols}`;
                            }
                            // cv::Matx - image
                            else if (matxInfo.isMatx) {
                                kind = 'mat';
                                size = matxInfo.rows * matxInfo.cols;
                                sizeInfo = `${matxInfo.rows}x${matxInfo.cols}`;
                            }
                            // 2D C-style array - image
                            else if (cStyleArray2D.is2DArray) {
                                kind = 'mat';
                                size = cStyleArray2D.rows * cStyleArray2D.cols;
                                sizeInfo = `${cStyleArray2D.rows}x${cStyleArray2D.cols}`;
                            }
                            // cv::Mat - image
                            else if (isM) {
                                kind = 'mat';
                                size = r * c;
                                sizeInfo = (r > 0 && c > 0) ? `${r}x${c}` : '';
                            }
                            
                            const pairedVars = SyncManager.getPairedVariables(variableName);
                            const groupIndex = SyncManager.getGroupIndex(variableName);
                            return new CVVariable(
                                v.name,
                                v.type,
                                pointerInfo.isPointer ? actualEvaluateName : variableName,
                                v.variablesReference,
                                v.value,
                                vscode.TreeItemCollapsibleState.None,
                                kind,
                                size,
                                sizeInfo,
                                pairedVars.length > 0,
                                pairedVars.length > 0 ? pairedVars.join(', ') : undefined,
                                groupIndex,
                                pointerInfo.isPointer,
                                pointerInfo.baseType
                            );
                        }
                        return null;
                    };

                    variablePromises.push(checkVariable());
                }
            }
            
            const results = await Promise.all(variablePromises);
            for (const res of results) {
                if (res) visualizableVariables.push(res);
            }
            
            this.variables = visualizableVariables;
            
            const groupMap = new Map<number | undefined, CVVariable[]>();
            for (const v of visualizableVariables) {
                const idx = v.groupIndex;
                if (!groupMap.has(idx)) {
                    groupMap.set(idx, []);
                }
                groupMap.get(idx)!.push(v);
            }

            const resultGroups: CVGroup[] = [];
            const sortedIndices = Array.from(groupMap.keys())
                .filter((idx): idx is number => idx !== undefined)
                .sort((a, b) => a - b);
            
            for (const idx of sortedIndices) {
                resultGroups.push(new CVGroup(
                    `Group ${idx + 1}`,
                    vscode.TreeItemCollapsibleState.Expanded,
                    groupMap.get(idx)!,
                    idx
                ));
            }

            const ungrouped = groupMap.get(undefined);
            if (ungrouped && ungrouped.length > 0) {
                resultGroups.push(new CVGroup(
                    '(ungrouped)',
                    vscode.TreeItemCollapsibleState.Expanded,
                    ungrouped
                ));
            }

            return resultGroups;
        } catch (error) {
            console.error('Error fetching variables:', error);
            this.variables = [];
            this.groups = [];
            return [];
        }
    }
}
