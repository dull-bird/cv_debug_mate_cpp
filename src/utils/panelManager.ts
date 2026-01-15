import * as vscode from 'vscode';

export class PanelManager {
    private static panels: Map<string, { 
        panel: vscode.WebviewPanel, 
        lastStateToken?: string,
        lastRefreshedVersion?: number,
        dataPtr?: string  // Store the data pointer for this panel
    }> = new Map();

    // Map from data pointer to panel key for quick lookup
    private static dataPtrToKey: Map<string, string> = new Map();

    private static currentDebugStateVersion = 0;

    /**
     * Initialize the panel manager with extension context.
     */
    static initialize(context: vscode.ExtensionContext) {
        console.log(`[PanelManager] Initialized`);
    }

    /**
     * Increment the debug state version to track steps.
     * Also clears the data pointer mappings since memory addresses may change between steps.
     */
    static incrementDebugStateVersion() {
        this.currentDebugStateVersion++;
        // Clear data pointer mappings on each debug step
        // This prevents stale pointer addresses from incorrectly matching new variables
        // that happen to get the same memory address after the original was freed
        this.dataPtrToKey.clear();
        
        // Also clear the dataPtr from all panel entries
        for (const entry of this.panels.values()) {
            entry.dataPtr = undefined;
        }
    }

    /**
     * Mark a panel as having been refreshed for the current debug version.
     */
    static markAsRefreshed(viewType: string, sessionId: string, variableName: string) {
        const key = `${viewType}:::${sessionId}:::${variableName}`;
        const entry = this.panels.get(key);
        if (entry) {
            entry.lastRefreshedVersion = this.currentDebugStateVersion;
        }
    }

    /**
     * Check if a panel needs refreshing because the debug state has moved forward.
     */
    static needsVersionRefresh(viewType: string, sessionId: string, variableName: string): boolean {
        const key = `${viewType}:::${sessionId}:::${variableName}`;
        const entry = this.panels.get(key);
        if (!entry) {
            return false;
        }
        return (entry.lastRefreshedVersion ?? -1) < this.currentDebugStateVersion;
    }

    /**
     * Get a panel by its identifiers (for checking if it exists and its state)
     */
    static getPanel(viewType: string, sessionId: string, variableName: string): vscode.WebviewPanel | undefined {
        const key = `${viewType}:::${sessionId}:::${variableName}`;
        return this.panels.get(key)?.panel;
    }

    /**
     * Find an existing panel by data pointer address.
     * This allows different variables pointing to the same data to share a panel.
     */
    static findPanelByDataPtr(viewType: string, sessionId: string, dataPtr: string): { key: string; panel: vscode.WebviewPanel } | null {
        if (!dataPtr) {
            return null;
        }
        
        const ptrKey = `${viewType}:::${sessionId}:::ptr:${dataPtr}`;
        const existingKey = this.dataPtrToKey.get(ptrKey);
        
        if (existingKey && this.panels.has(existingKey)) {
            return { key: existingKey, panel: this.panels.get(existingKey)!.panel };
        }
        
        return null;
    }

    /**
     * Register a data pointer for a panel, enabling pointer-based lookup.
     */
    static registerDataPtr(viewType: string, sessionId: string, variableName: string, dataPtr: string) {
        if (!dataPtr) {
            return;
        }
        
        const key = `${viewType}:::${sessionId}:::${variableName}`;
        const ptrKey = `${viewType}:::${sessionId}:::ptr:${dataPtr}`;
        
        const entry = this.panels.get(key);
        if (entry) {
            entry.dataPtr = dataPtr;
            this.dataPtrToKey.set(ptrKey, key);
        }
    }

    /**
     * Get an existing panel or create a new one for a specific variable in a debug session.
     * If dataPtr is provided, will first check if another variable with the same data pointer
     * already has a panel open, and reuse that panel.
     * 
     * @param viewType Unique identifier for the type of webview
     * @param title Title of the panel
     * @param sessionId Debug session ID
     * @param variableName Name of the variable
     * @param reveal Whether to reveal the panel if it exists
     * @param dataPtr Optional data pointer address for sharing panels between variables
     */
    static getOrCreatePanel(
        viewType: string,
        title: string,
        sessionId: string,
        variableName: string,
        reveal: boolean = false,
        dataPtr?: string
    ): vscode.WebviewPanel {
        const key = `${viewType}:::${sessionId}:::${variableName}`;
        
        // First, check if this exact variable already has a panel
        if (this.panels.has(key)) {
            const entry = this.panels.get(key)!;
            entry.panel.title = title;
            if (reveal) {
                entry.panel.reveal(entry.panel.viewColumn, false);
            }
            return entry.panel;
        }

        // If dataPtr is provided, check if another variable with the same data pointer has a panel
        if (dataPtr) {
            const existing = this.findPanelByDataPtr(viewType, sessionId, dataPtr);
            if (existing) {
                console.log(`Found existing panel for data pointer ${dataPtr}, reusing for ${variableName}`);
                // Update title to show both variables share this panel
                const currentTitle = existing.panel.title;
                if (!currentTitle.includes(variableName)) {
                    existing.panel.title = `${title} (shared)`;
                }
                if (reveal) {
                    existing.panel.reveal(existing.panel.viewColumn, false);
                }
                // Also register this variable name as pointing to the same panel
                this.panels.set(key, this.panels.get(existing.key)!);
                return existing.panel;
            }
        }

        // Create a new panel
        const panel = vscode.window.createWebviewPanel(
            viewType,
            title,
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
            }
        );

        this.panels.set(key, { panel, dataPtr });

        // Register the data pointer mapping
        if (dataPtr) {
            const ptrKey = `${viewType}:::${sessionId}:::ptr:${dataPtr}`;
            this.dataPtrToKey.set(ptrKey, key);
        }

        panel.onDidDispose(() => {
            // Mark as disposing to prevent any other code from using this panel
            (panel as any)._isDisposing = true;
            
            // Show shortcut tip when closing panel (helps with auxiliary window freeze issue)
            if (vscode.debug.activeDebugSession) {
                vscode.window.showInformationMessage(
                    '⚠️ Closing auxiliary window may cause debug buttons to freeze. Use shortcuts: ▶️ Continue (F5) | ⏭️ Step Over (F10) | ⬇️ Step Into (F11) | ⬆️ Step Out (Shift+F11) | ⏹️ Stop (Shift+F5)'
                );
            }
            
            // Clean up all references to this panel
            const entry = this.panels.get(key);
            if (entry?.dataPtr) {
                const ptrKey = `${viewType}:::${sessionId}:::ptr:${entry.dataPtr}`;
                this.dataPtrToKey.delete(ptrKey);
            }
            
            // Remove all keys that point to this panel
            for (const [k, v] of this.panels.entries()) {
                if (v.panel === panel) {
                    this.panels.delete(k);
                }
            }
        });

        panel.onDidChangeViewState(e => {
            // Only trigger refresh if panel is visible AND not being disposed
            if (e.webviewPanel.visible && !(e.webviewPanel as any)._isDisposing) {
                const parts = key.split(':::');
                if (parts.length === 3) {
                    const [vType, sid, vName] = parts;
                    if (PanelManager.needsVersionRefresh(vType, sid, vName)) {
                        // Add a small delay to avoid triggering during dispose
                        setTimeout(() => {
                            if (e.webviewPanel.visible && !(e.webviewPanel as any)._isDisposing) {
                                vscode.commands.executeCommand('cv-debugmate.refreshVisiblePanels', true);
                            }
                        }, 100);
                    }
                }
            }
        });

        return panel;
    }

    /**
     * Wrap a message handler to ignore messages when panel is disposing
     */
    static wrapMessageHandler(panel: vscode.WebviewPanel, handler: (message: any) => Promise<void>) {
        return async (message: any) => {
            // Ignore messages if panel is being disposed
            if ((panel as any)._isDisposing) {
                return;
            }
            try {
                await handler(message);
            } catch (e) {
                // Silently ignore errors during message handling to prevent crashes
                console.error('Error in message handler:', e);
            }
        };
    }

    /**
     * Update the state token for a panel to avoid redundant refreshes.
     */
    static updateStateToken(viewType: string, sessionId: string, variableName: string, token: string) {
        const key = `${viewType}:::${sessionId}:::${variableName}`;
        const entry = this.panels.get(key);
        if (entry) {
            entry.lastStateToken = token;
        }
    }

    /**
     * Check if the panel for a variable is already up-to-date for the given state.
     */
    static isPanelFresh(viewType: string, sessionId: string, variableName: string, token: string): boolean {
        const key = `${viewType}:::${sessionId}:::${variableName}`;
        const entry = this.panels.get(key);
        return entry?.lastStateToken === token;
    }

    /**
     * Get all currently open panels.
     */
    static getAllPanels(): Map<string, { panel: vscode.WebviewPanel, lastStateToken?: string }> {
        return new Map(this.panels);
    }

    /**
     * Close all panels associated with a specific debug session.
     * @param sessionId Debug session ID
     */
    static closeSessionPanels(sessionId: string): void {
        // First collect all keys to delete
        const keysToDelete: string[] = [];
        const ptrKeysToDelete: string[] = [];
        
        for (const [key, entry] of this.panels.entries()) {
            const parts = key.split(':::');
            if (parts.length >= 2 && parts[1] === sessionId) {
                keysToDelete.push(key);
                entry.panel.dispose();
            }
        }
        
        // Clean up data pointer mappings
        for (const [ptrKey, panelKey] of this.dataPtrToKey.entries()) {
            if (ptrKey.includes(`:::${sessionId}:::`)) {
                ptrKeysToDelete.push(ptrKey);
            }
        }
        
        keysToDelete.forEach(k => this.panels.delete(k));
        ptrKeysToDelete.forEach(k => this.dataPtrToKey.delete(k));
    }
}
