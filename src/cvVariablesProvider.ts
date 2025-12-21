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
                'charts.blue',
                'charts.red',
                'charts.green',
                'charts.yellow',
                'charts.orange',
                'charts.purple'
            ];
            const colorId = colors[groupIndex % colors.length];
            this.iconPath = new vscode.ThemeIcon(typeIcon, new vscode.ThemeColor(colorId));
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

