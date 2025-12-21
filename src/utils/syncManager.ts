import * as vscode from 'vscode';

export interface ViewState {
    // For Mat (Image)
    scale?: number;
    offsetX?: number;
    offsetY?: number;
    
    // For PointCloud
    cameraPosition?: { x: number, y: number, z: number };
    cameraQuaternion?: { x: number, y: number, z: number, w: number };
    cameraUp?: { x: number, y: number, z: number };
    controlsTarget?: { x: number, y: number, z: number };
}

export class SyncManager {
    private static panels: Map<string, vscode.WebviewPanel> = new Map();
    // variableName -> groupId
    private static variableToGroup: Map<string, string> = new Map();
    // groupId -> Set of variableNames
    private static groupToVariables: Map<string, Set<string>> = new Map();
    // groupId -> last known state
    private static groupStates: Map<string, ViewState> = new Map();
    // groupId -> numeric index for UI display
    private static groupToIndex: Map<string, number> = new Map();
    private static nextGroupIndex = 0;

    static registerPanel(variableName: string, panel: vscode.WebviewPanel) {
        this.panels.set(variableName, panel);
        
        // If this variable is in a group and that group has a state, sync it immediately
        // We use a small delay to ensure the webview is ready to receive messages
        const groupId = this.variableToGroup.get(variableName);
        if (groupId) {
            const state = this.groupStates.get(groupId);
            if (state) {
                setTimeout(() => {
                    if (this.panels.get(variableName) === panel) {
                        panel.webview.postMessage({
                            command: 'setView',
                            state: state
                        });
                    }
                }, 500); // 50ms should be enough for the webview to initialize its listeners
            }
        }

        panel.onDidDispose(() => {
            this.panels.delete(variableName);
        });
    }

    static setPairing(var1: string, var2: string) {
        let groupId1 = this.variableToGroup.get(var1);
        let groupId2 = this.variableToGroup.get(var2);

        if (!groupId1 && !groupId2) {
            // Create new group
            const newGroupId = `group-${Date.now()}`;
            this.addToGroup(var1, newGroupId);
            this.addToGroup(var2, newGroupId);
        } else if (groupId1 && !groupId2) {
            this.addToGroup(var2, groupId1);
        } else if (!groupId1 && groupId2) {
            this.addToGroup(var1, groupId2);
        } else if (groupId1 && groupId2 && groupId1 !== groupId2) {
            // Merge group 2 into group 1
            const vars2 = this.groupToVariables.get(groupId2);
            if (vars2) {
                for (const v of vars2) {
                    this.addToGroup(v, groupId1);
                }
            }
            this.groupToVariables.delete(groupId2);
            this.groupStates.delete(groupId2);
        }

        // IMPORTANT: After pairing, ensure both variables are synced to the group's state
        // If one of them has a state, it will be in groupStates[groupId] now.
        const finalGroupId = this.variableToGroup.get(var1)!;
        const state = this.groupStates.get(finalGroupId);
        if (state) {
            this.broadcastToGroup(finalGroupId, state);
        }
    }

    private static addToGroup(varName: string, groupId: string) {
        this.variableToGroup.set(varName, groupId);
        if (!this.groupToVariables.has(groupId)) {
            this.groupToVariables.set(groupId, new Set());
            this.groupToIndex.set(groupId, this.nextGroupIndex++);
        }
        this.groupToVariables.get(groupId)!.add(varName);

        // If the variable has a state and the group doesn't, let this variable define the group state
        // (This happens during initial grouping)
    }

    private static broadcastToGroup(groupId: string, state: ViewState, excludeVar?: string) {
        const varsInGroup = this.groupToVariables.get(groupId);
        if (varsInGroup) {
            for (const targetVar of varsInGroup) {
                if (targetVar !== excludeVar) {
                    const targetPanel = this.panels.get(targetVar);
                    if (targetPanel) {
                        targetPanel.webview.postMessage({
                            command: 'setView',
                            state: state
                        });
                    }
                }
            }
        }
    }

    static unpair(name: string) {
        const groupId = this.variableToGroup.get(name);
        if (groupId) {
            const vars = this.groupToVariables.get(groupId);
            if (vars) {
                vars.delete(name);
                if (vars.size <= 1) {
                    // If group is now 1 or 0, dissolve it
                    for (const v of vars) {
                        this.variableToGroup.delete(v);
                    }
                    this.groupToVariables.delete(groupId);
                    this.groupStates.delete(groupId);
                    this.groupToIndex.delete(groupId);
                }
            }
            this.variableToGroup.delete(name);
        }
    }

    static getGroupIndex(varName: string): number | undefined {
        const groupId = this.variableToGroup.get(varName);
        return groupId ? this.groupToIndex.get(groupId) : undefined;
    }

    static syncView(sourceVar: string, state: ViewState) {
        const groupId = this.variableToGroup.get(sourceVar);
        if (groupId) {
            // Store as last known state for this group
            this.groupStates.set(groupId, state);
            this.broadcastToGroup(groupId, state, sourceVar);
        }
    }

    static getPairedVariables(name: string): string[] {
        const groupId = this.variableToGroup.get(name);
        if (groupId) {
            const vars = this.groupToVariables.get(groupId);
            if (vars) {
                return Array.from(vars).filter(v => v !== name);
            }
        }
        return [];
    }
}
