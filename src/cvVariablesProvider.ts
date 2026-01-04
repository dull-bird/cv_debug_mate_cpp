import * as vscode from 'vscode';
import { isMat, isPoint3Vector, is1DVector, isLikely1DMat, is1DSet, isMatx, is2DStdArray, is1DStdArray, isPoint3StdArray, is2DCStyleArray, is1DCStyleArray, is3DCStyleArray, is3DStdArray } from './utils/opencv';
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
        public groupIndex?: number
    ) {
        super(name, collapsibleState);
        this.tooltip = `${this.name}: ${this.type}${this.pairedWith ? ` (Paired with ${this.pairedWith})` : ''}`;
        
        let typeIcon = 'file-media';
        if (kind === 'pointcloud') typeIcon = 'layers';
        else if (kind === 'plot') typeIcon = 'graph';
        
        this.isEmpty = (sizeInfo === '0' || sizeInfo === '0x0' || sizeInfo === '' || size === 0);
        const displaySize = this.isEmpty ? 'empty' : sizeInfo;
        
        // Only show size in description, no type
        this.description = `[${displaySize}]`;

        if (isPaired && groupIndex !== undefined && kind !== 'plot') {
            const color = COLORS[groupIndex % COLORS.length];
            this.iconPath = getColoredIcon(kind, color);
            this.contextValue = `cvVariablePaired:${kind}${this.isEmpty ? ':empty' : ''}`;
        } else {
            this.iconPath = new vscode.ThemeIcon(typeIcon);
            this.contextValue = `cvVariable:${kind}${this.isEmpty ? ':empty' : ''}`;
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
            this.iconPath = getColoredIcon('group', color);
        } else {
            this.iconPath = new vscode.ThemeIcon('symbol-group');
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
            const threadsResponse = await debugSession.customRequest('threads');
            if (!threadsResponse || !threadsResponse.threads || threadsResponse.threads.length === 0) {
                this.variables = [];
                this.groups = [];
                return [];
            }
            
            const threadId = threadsResponse.threads[0].id;
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
            
            const frameId = stackTraceResponse.stackFrames[0].id;
            const scopesResponse = await debugSession.customRequest('scopes', { frameId });
            
            const visualizableVariables: CVVariable[] = [];
            const variablePromises: Promise<CVVariable | null>[] = [];
            
            for (const scope of scopesResponse.scopes) {
                const variablesResponse = await debugSession.customRequest('variables', {
                    variablesReference: scope.variablesReference
                });
                
                for (const v of variablesResponse.variables) {
                    const variableName = v.evaluateName || v.name;
                    const isM = isMat(v);
                    const matxInfo = isMatx(v);
                    const point3 = isPoint3Vector(v);
                    const vector1D = is1DVector(v);
                    const set1D = is1DSet(v);
                    // std::array detection
                    const stdArray2D = is2DStdArray(v);
                    const stdArray1D = is1DStdArray(v);
                    const stdArrayPoint3 = isPoint3StdArray(v);
                    const stdArray3D = is3DStdArray(v);
                    // C-style array detection
                    const cStyleArray2D = is2DCStyleArray(v);
                    const cStyleArray1D = is1DCStyleArray(v);
                    const cStyleArray3D = is3DCStyleArray(v);

                    const checkVariable = async (): Promise<CVVariable | null> => {
                        let is1DM = isLikely1DMat(v);
                        const confirmed1DSize = SyncManager.getConfirmed1DSize(variableName);
                        let r = 0, c = 0;
                        
                        if (isM) {
                            const dimMatch = v.value.match(/\[\s*(\d+)\s*x\s*(\d+)\s*\]/) || v.value.match(/(\d+)\s*x\s*(\d+)/);
                            if (dimMatch) {
                                r = parseInt(dimMatch[1]);
                                c = parseInt(dimMatch[2]);
                            }
                        }

                        if (isM && v.variablesReference > 0 && (r === 0 || c === 0 || (!is1DM.is1D && confirmed1DSize === undefined))) {
                            try {
                                const children = await debugSession.customRequest('variables', {
                                    variablesReference: v.variablesReference
                                });
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
                                variableName,
                                v.variablesReference,
                                v.value,
                                vscode.TreeItemCollapsibleState.None,
                                kind,
                                size,
                                sizeInfo,
                                pairedVars.length > 0,
                                pairedVars.length > 0 ? pairedVars.join(', ') : undefined,
                                groupIndex
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
