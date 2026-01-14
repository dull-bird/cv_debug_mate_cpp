import * as vscode from 'vscode';

// Stored state for webview serialization (used when moving to new window)
export interface WebviewPersistedState {
    viewType: string;
    variableName: string;
    sessionId: string;
    // For Mat viewer
    rows?: number;
    cols?: number;
    channels?: number;
    depth?: number;
    // For Plot viewer
    plotData?: number[];
    // Common
    scale?: number;
    offsetX?: number;
    offsetY?: number;
}

export class PanelManager {
    private static panels: Map<string, { 
        panel: vscode.WebviewPanel, 
        lastStateToken?: string,
        lastRefreshedVersion?: number,
        dataPtr?: string,  // Store the data pointer for this panel
        persistedState?: WebviewPersistedState  // Store state for serialization
    }> = new Map();

    // Map from data pointer to panel key for quick lookup
    private static dataPtrToKey: Map<string, string> = new Map();

    private static currentDebugStateVersion = 0;

    /**
     * Initialize the panel manager with extension context.
     * This registers the webview serializers for move/copy to new window support.
     */
    static initialize(context: vscode.ExtensionContext) {
        
        // Register serializers for each view type
        const viewTypes = ['MatImageViewer', 'CurvePlotViewer', '3DPointViewer'];
        
        for (const viewType of viewTypes) {
            context.subscriptions.push(
                vscode.window.registerWebviewPanelSerializer(viewType, {
                    deserializeWebviewPanel: async (panel: vscode.WebviewPanel, state: any) => {
                        // Mark panel as deserializing to prevent any operations
                        (panel as any)._isDeserializing = true;
                        (panel as any)._isDisposing = true;  // Also mark as disposing to be extra safe
                        (panel as any)._isNewWindowPanel = true;  // Mark as new window panel
                        
                        console.log(`[PanelManager] Deserializing webview panel: ${viewType}, title: ${panel.title}`);
                        
                        // For moved/copied panels, we always show reload required
                        // because the debug data cannot be serialized
                        const title = panel.title || '';
                        const variableName = title.replace('View: ', '').replace(' (shared)', '');
                        
                        // Show reload required page - this is a static HTML with no JS that could cause issues
                        panel.webview.html = PanelManager.getReloadRequiredHtml(variableName || 'variable');
                        
                        // CRITICAL: Do NOT register any message listeners on deserialized panels
                        // This prevents any debug operations from being triggered when the panel is closed
                        
                        // Register a minimal dispose handler that does nothing
                        panel.onDidDispose(() => {
                            console.log(`[PanelManager] Deserialized panel disposed (new window): ${variableName}`);
                            // Do nothing else - no cleanup needed for deserialized panels
                            // This is intentionally empty to prevent any blocking operations
                        });
                        
                        console.log(`[PanelManager] Deserialized panel setup complete: ${variableName}`);
                    }
                })
            );
        }
        
        console.log(`[PanelManager] Registered serializers for: ${viewTypes.join(', ')}`);
    }
    
    /**
     * Update the persisted state for a panel.
     */
    static updatePersistedState(viewType: string, sessionId: string, variableName: string, state: Partial<WebviewPersistedState>) {
        const key = `${viewType}:::${sessionId}:::${variableName}`;
        const entry = this.panels.get(key);
        if (entry) {
            entry.persistedState = {
                ...entry.persistedState,
                viewType,
                sessionId,
                variableName,
                ...state
            } as WebviewPersistedState;
        }
    }
    
    /**
     * Get HTML content for when webview needs to be reloaded.
     */
    private static getReloadRequiredHtml(variableName: string): string {
        return `
            <!DOCTYPE html>
            <html>
            <head>
                <style>
                    body {
                        display: flex;
                        flex-direction: column;
                        align-items: center;
                        justify-content: center;
                        height: 100vh;
                        margin: 0;
                        background: #1e1e1e;
                        color: #ccc;
                        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                    }
                    .message {
                        text-align: center;
                        padding: 20px;
                    }
                    .icon {
                        font-size: 48px;
                        margin-bottom: 16px;
                    }
                    h2 {
                        margin: 0 0 8px 0;
                        color: #fff;
                    }
                    p {
                        margin: 0;
                        color: #888;
                    }
                    .hint {
                        margin-top: 16px;
                        font-size: 12px;
                        color: #666;
                    }
                </style>
            </head>
            <body>
                <div class="message">
                    <div class="icon">🔄</div>
                    <h2>Reload Required</h2>
                    <p>Variable "${variableName}" needs to be reloaded.</p>
                    <p class="hint">Click on the variable in the CV DebugMate panel to reload.</p>
                </div>
            </body>
            </html>
        `;
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
            // Mark panel as disposing IMMEDIATELY to prevent any operations
            (panel as any)._isDisposing = true;
            
            // CRITICAL: Do NOTHING else synchronously in onDidDispose!
            // Any operation here can potentially block when the panel is in an auxiliary window.
            // The message listeners will be garbage collected automatically.
            // The panel entries in our maps will become stale but that's fine - 
            // they'll be cleaned up on next access or when the debug session ends.
            
            // Schedule cleanup for later (non-blocking) using setTimeout with 0ms
            setTimeout(() => {
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
            }, 0);
        });

        // DISABLED: onDidChangeViewState refresh causes debug to hang when closing new windows
        // Users can manually refresh using the reload button in the webview
        /*
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
        */

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
