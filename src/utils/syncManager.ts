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
    // variableName -> last known state (even if not in a group)
    private static variableStates: Map<string, ViewState> = new Map();
    // variableName -> groupId
    private static variableToGroup: Map<string, string> = new Map();
    // groupId -> Set of variableNames
    private static groupToVariables: Map<string, Set<string>> = new Map();
    // groupId -> last known state
    private static groupStates: Map<string, ViewState> = new Map();
    // groupId -> numeric index for UI display
    private static groupToIndex: Map<string, number> = new Map();
    private static nextGroupIndex = 0;

    // variableName -> size (confirmed by evaluation)
    private static confirmed1DVariables: Map<string, number> = new Map();

    static markAs1D(variableName: string, size: number) {
        this.confirmed1DVariables.set(variableName, size);
    }

    static getConfirmed1DSize(variableName: string): number | undefined {
        return this.confirmed1DVariables.get(variableName);
    }

    // Track if a variable has received the group state at least once
    private static variableHasSynced: Set<string> = new Set();

    static registerPanel(variableName: string, panel: vscode.WebviewPanel) {
        this.panels.set(variableName, panel);
        this.variableHasSynced.delete(variableName); // Reset sync flag for new/reused panel
        
        // Check if this variable has a saved state (from previous panel)
        const savedState = this.variableStates.get(variableName);
        
        // If this variable is in a group and that group has a state, sync it immediately
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
                        this.variableHasSynced.add(variableName);
                    }
                }, 500);
            }
        } else if (savedState) {
            // Not in a group, but has a saved state from previous panel - restore it
            setTimeout(() => {
                if (this.panels.get(variableName) === panel) {
                    panel.webview.postMessage({
                        command: 'setView',
                        state: savedState
                    });
                }
            }, 500);
        }

        panel.onDidDispose(() => {
            this.panels.delete(variableName);
            // DON'T delete variableStates - keep it for when panel is reopened
            // this.variableStates.delete(variableName);
            this.variableHasSynced.delete(variableName);
        });
    }

    static setPairing(var1: string, var2: string) {
        let groupId1 = this.variableToGroup.get(var1);
        let groupId2 = this.variableToGroup.get(var2);

        if (!groupId1 && !groupId2) {
            // Neither is in a group. Determine who should be the base.
            const state1 = this.variableStates.get(var1);
            const state2 = this.variableStates.get(var2);
            
            // Heuristic: if one has a non-default view (zoomed or panned), it's the base.
            const isChanged = (s?: ViewState) => s && (
                (s.scale !== undefined && Math.abs(s.scale - 1.0) > 0.001) ||
                (s.offsetX !== 0 || s.offsetY !== 0) ||
                (s.cameraPosition !== undefined)
            );

            const hasChanged1 = isChanged(state1);
            const hasChanged2 = isChanged(state2);

            const newGroupId = `group-${Date.now()}`;
            if (!hasChanged1 && hasChanged2) {
                // var2 wins
                this.addToGroup(var2, newGroupId);
                this.addToGroup(var1, newGroupId);
            } else {
                // var1 wins (default)
                this.addToGroup(var1, newGroupId);
                this.addToGroup(var2, newGroupId);
            }
        } else if (groupId1 && !groupId2) {
            // var1 is already in a group, add var2 to it (keeps group 1's state)
            this.addToGroup(var2, groupId1);
        } else if (!groupId1 && groupId2) {
            // var2 is already in a group, add var1 to it (keeps group 2's state)
            this.addToGroup(var1, groupId2);
        } else if (groupId1 && groupId2 && groupId1 !== groupId2) {
            // Both are in groups. Merge the newer group into the older group to preserve established state.
            const index1 = this.groupToIndex.get(groupId1) ?? Infinity;
            const index2 = this.groupToIndex.get(groupId2) ?? Infinity;
            
            if (index1 <= index2) {
                this.mergeGroups(groupId2, groupId1);
            } else {
                this.mergeGroups(groupId1, groupId2);
            }
        }

        // Broadcast the master state to everyone in the final group
        const finalGroupId = this.variableToGroup.get(var1);
        if (finalGroupId) {
            const state = this.groupStates.get(finalGroupId);
            if (state) {
                this.broadcastToGroup(finalGroupId, state);
            }
        }
    }

    private static mergeGroups(sourceGroupId: string, targetGroupId: string) {
        const vars = this.groupToVariables.get(sourceGroupId);
        if (vars) {
            for (const v of vars) {
                this.addToGroup(v, targetGroupId);
            }
        }
        this.groupToVariables.delete(sourceGroupId);
        this.groupStates.delete(sourceGroupId);
        this.groupToIndex.delete(sourceGroupId);
    }

    private static addToGroup(varName: string, groupId: string) {
        this.variableToGroup.set(varName, groupId);
        if (!this.groupToVariables.has(groupId)) {
            this.groupToVariables.set(groupId, new Set());
            this.groupToIndex.set(groupId, this.nextGroupIndex++);
        }
        this.groupToVariables.get(groupId)!.add(varName);

        // If the variable has a state and the group doesn't, let this variable define the group state
        if (!this.groupStates.has(groupId)) {
            const state = this.variableStates.get(varName);
            if (state) {
                this.groupStates.set(groupId, state);
                this.variableHasSynced.add(varName); // This variable defines the state, so it's "synced"
            }
        }
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
                        this.variableHasSynced.add(targetVar);
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
        // Store as last known state for this variable
        this.variableStates.set(sourceVar, state);

        const groupId = this.variableToGroup.get(sourceVar);
        if (groupId) {
            // CRITICAL FIX: If the group already has a state, ignore the first report
            // from a variable that hasn't received the group state yet.
            // This prevents a newly opened panel from overwriting the group state with its default (100%) zoom.
            const hasGroupState = this.groupStates.has(groupId);
            const hasSynced = this.variableHasSynced.has(sourceVar);

            if (hasGroupState && !hasSynced) {
                this.variableHasSynced.add(sourceVar);
                return;
            }

            this.variableHasSynced.add(sourceVar);
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

    // Clear all states when debug session ends
    static clearAllStates() {
        this.variableStates.clear();
        this.variableToGroup.clear();
        this.groupToVariables.clear();
        this.groupStates.clear();
        this.groupToIndex.clear();
        this.variableHasSynced.clear();
        this.confirmed1DVariables.clear();
        this.nextGroupIndex = 0;
    }
    
    // Get saved view state for a variable
    static getSavedState(variableName: string): ViewState | undefined {
        return this.variableStates.get(variableName);
    }
    
    /**
     * Sync pixel highlight across all panels in the same group.
     * @param sourceVar The variable that triggered the highlight
     * @param pixelX The X coordinate of the pixel (in image space)
     * @param pixelY The Y coordinate of the pixel (in image space)
     */
    static syncPixelHighlight(sourceVar: string, pixelX: number | null, pixelY: number | null) {
        const groupId = this.variableToGroup.get(sourceVar);
        if (!groupId) {
            console.log(`[SyncManager] syncPixelHighlight: ${sourceVar} is not in a group`);
            return;
        }
        
        const varsInGroup = this.groupToVariables.get(groupId);
        if (!varsInGroup) {
            console.log(`[SyncManager] syncPixelHighlight: group ${groupId} has no variables`);
            return;
        }
        
        console.log(`[SyncManager] syncPixelHighlight: ${sourceVar} -> group ${groupId}, syncing to ${varsInGroup.size - 1} other panels`);
        
        for (const targetVar of varsInGroup) {
            if (targetVar !== sourceVar) {
                const targetPanel = this.panels.get(targetVar);
                if (targetPanel) {
                    console.log(`[SyncManager] syncPixelHighlight: sending to ${targetVar}, pixel=(${pixelX}, ${pixelY})`);
                    targetPanel.webview.postMessage({
                        command: 'setPixelHighlight',
                        pixelX,
                        pixelY
                    });
                } else {
                    console.log(`[SyncManager] syncPixelHighlight: panel for ${targetVar} not found`);
                }
            }
        }
    }
}
