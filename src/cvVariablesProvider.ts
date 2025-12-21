import * as vscode from 'vscode';
import { isMat, isPoint3Vector } from './utils/opencv';
import { SyncManager } from './utils/syncManager';

export class CVVariable extends vscode.TreeItem {
    constructor(
        public readonly name: string,
        public readonly type: string,
        public readonly evaluateName: string,
        public readonly variablesReference: number,
        public readonly value: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly kind: 'mat' | 'pointcloud',
        public isPaired: boolean = false,
        public pairedWith?: string,
        public groupIndex?: number
    ) {
        super(name, collapsibleState);
        this.tooltip = `${this.name}: ${this.type}${this.pairedWith ? ` (Paired with ${this.pairedWith})` : ''}`;
        
        const typeIcon = kind === 'mat' ? 'file-media' : 'layers';
        
        if (isPaired && groupIndex !== undefined) {
            const colors = [
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
            const color = colors[groupIndex % colors.length];
            
            // Use custom SVG to prevent VS Code from turning the icon white on selection
            const svgPath = kind === 'mat' 
                ? "M0 1.75C0 .784.784 0 1.75 0h12.5C15.216 0 16 .784 16 1.75v12.5A1.75 1.75 0 0 1 14.25 16H1.75A1.75 1.75 0 0 1 0 14.25Zm1.75-.25a.25.25 0 0 0-.25.25v12.5c0 .138.112.25.25.25h12.5a.25.25 0 0 0 .25-.25V1.75a.25.25 0 0 0-.25-.25Zm10.5 4.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0ZM2.5 14.5h11V9.38l-3.344-3.345a.25.25 0 0 0-.353 0l-3.05 3.05-1.147-1.147a.25.25 0 0 0-.353 0L2.5 11.188Z"
                : "m8.31 1.066 6.5 3.5a.75.25 0 0 1 0 .434l-6.5 3.5a.75.75 0 0 1-.62 0l-6.5-3.5a.75.25 0 0 1 0-.434l6.5-3.5a.75.75 0 0 1 .62 0ZM2.51 4.75 8 7.708l5.49-2.958L8 1.792Zm-1.2 4.016a.75.75 0 0 1 1.024-.274L8 11.208l5.666-3.05a.75.75 0 0 1 .668 1.342l-6 3.23a.75.75 0 0 1-.668 0l-6-3.23a.75.75 0 0 1-.274-1.024Zm0 3a.75.75 0 0 1 1.024-.274L8 14.208l5.666-3.05a.75.75 0 0 1 .668 1.342l-6 3.23a.75.75 0 0 1-.668 0l-6-3.23a.75.75 0 0 1-.274-1.024Z";
            
            const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16"><path fill="${color}" d="${svgPath}"></path></svg>`;
            const base64 = Buffer.from(svg).toString('base64');
            const iconUri = vscode.Uri.parse(`data:image/svg+xml;base64,${base64}`);
            
            this.iconPath = { light: iconUri, dark: iconUri };
            this.description = `(Group ${groupIndex + 1}) ${this.type}`;
            this.contextValue = 'cvVariablePaired';
        } else {
            this.iconPath = new vscode.ThemeIcon(typeIcon);
            this.description = this.type;
            this.contextValue = 'cvVariable';
        }

        this.command = {
            command: 'cv-debugmate.viewVariable',
            title: 'View Variable',
            arguments: [this]
        };
    }
}

export class CVVariablesProvider implements vscode.TreeDataProvider<CVVariable> {
    private _onDidChangeTreeData: vscode.EventEmitter<CVVariable | undefined | void> = new vscode.EventEmitter<CVVariable | undefined | void>();
    readonly onDidChangeTreeData: vscode.Event<CVVariable | undefined | void> = this._onDidChangeTreeData.event;

    private variables: CVVariable[] = [];
    // We'll use SyncManager as the source of truth for pairings to keep it consistent
    
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

    getTreeItem(element: CVVariable): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: CVVariable): Promise<CVVariable[]> {
        if (element) {
            return []; // We don't support nested variables in the tree for now
        }

        const debugSession = vscode.debug.activeDebugSession;
        if (!debugSession) {
            this.variables = [];
            return [];
        }

        try {
            const threadsResponse = await debugSession.customRequest('threads');
            if (!threadsResponse || !threadsResponse.threads || threadsResponse.threads.length === 0) {
                this.variables = [];
                return [];
            }
            
            // Use the first thread that is stopped
            const threadId = threadsResponse.threads[0].id;
            
            const stackTraceResponse = await debugSession.customRequest('stackTrace', {
                threadId: threadId,
                startFrame: 0,
                levels: 1
            });
            
            if (!stackTraceResponse || !stackTraceResponse.stackFrames || stackTraceResponse.stackFrames.length === 0) {
                this.variables = [];
                return [];
            }
            
            const frameId = stackTraceResponse.stackFrames[0].id;
            const scopesResponse = await debugSession.customRequest('scopes', { frameId });
            
            const visualizableVariables: CVVariable[] = [];
            
            for (const scope of scopesResponse.scopes) {
                const variablesResponse = await debugSession.customRequest('variables', {
                    variablesReference: scope.variablesReference
                });
                
                for (const v of variablesResponse.variables) {
                    const isM = isMat(v);
                    const point3 = isPoint3Vector(v);
                    if (isM || point3.isPoint3) {
                        const kind = isM ? 'mat' : 'pointcloud';
                        const pairedVars = SyncManager.getPairedVariables(v.name);
                        const groupIndex = SyncManager.getGroupIndex(v.name);
                        visualizableVariables.push(new CVVariable(
                            v.name,
                            v.type,
                            v.evaluateName || v.name,
                            v.variablesReference,
                            v.value,
                            vscode.TreeItemCollapsibleState.None,
                            kind,
                            pairedVars.length > 0,
                            pairedVars.length > 0 ? pairedVars.join(', ') : undefined,
                            groupIndex
                        ));
                    }
                }
            }
            
            this.variables = visualizableVariables;
            return visualizableVariables;
        } catch (error) {
            console.error('Error fetching variables:', error);
            this.variables = [];
            return [];
        }
    }
}

