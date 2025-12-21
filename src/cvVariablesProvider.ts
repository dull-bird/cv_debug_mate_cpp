import * as vscode from 'vscode';
import { isMat, isPoint3Vector } from './utils/opencv';

export class CVVariable extends vscode.TreeItem {
    constructor(
        public readonly name: string,
        public readonly type: string,
        public readonly evaluateName: string,
        public readonly variablesReference: number,
        public readonly value: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState
    ) {
        super(name, collapsibleState);
        this.tooltip = `${this.name}: ${this.type}`;
        this.description = this.type;
        this.contextValue = 'cvVariable';
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

    refresh(): void {
        this._onDidChangeTreeData.fire();
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
            return [];
        }

        try {
            const threadsResponse = await debugSession.customRequest('threads');
            if (!threadsResponse || !threadsResponse.threads || threadsResponse.threads.length === 0) {
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
                    if (isMat(v) || isPoint3Vector(v).isPoint3) {
                        visualizableVariables.push(new CVVariable(
                            v.name,
                            v.type,
                            v.evaluateName || v.name,
                            v.variablesReference,
                            v.value,
                            vscode.TreeItemCollapsibleState.None
                        ));
                    }
                }
            }
            
            this.variables = visualizableVariables;
            return visualizableVariables;
        } catch (error) {
            console.error('Error fetching variables:', error);
            return [];
        }
    }
}

