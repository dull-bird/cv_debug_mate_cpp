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
        // DISABLED: WebviewPanelSerializer may cause issues when closing auxiliary windows
        // Without serializers, "Move to New Window" will show empty panel that needs manual reload
        // This is a test to see if serializers are causing the debug freeze
        
        console.log(`[PanelManager] Serializers DISABLED for testing`);
        
        /*
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
        */
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
        // NOTE: retainContextWhenHidden removed to test if it causes auxiliary window bugs
        const panel = vscode.window.createWebviewPanel(
            viewType,
            title,
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                // retainContextWhenHidden: true,  // DISABLED - may cause bugs when closing auxiliary windows
            }
        );

        this.panels.set(key, { panel, dataPtr });

        // Register the data pointer mapping
        if (dataPtr) {
            const ptrKey = `${viewType}:::${sessionId}:::ptr:${dataPtr}`;
            this.dataPtrToKey.set(ptrKey, key);
        }

        panel.onDidDispose(() => {
            const disposeTime = Date.now();
            console.log(`[DISPOSE-WATCHDOG] onDidDispose START at ${disposeTime}`);
            
            // Mark as disposing to prevent any other code from using this panel
            (panel as any)._isDisposing = true;
            
            // CRITICAL FIX: If debugger is running (not paused), pause it to prevent freeze
            const debugSession = vscode.debug.activeDebugSession;
            if (debugSession) {
                console.log(`[DISPOSE-WATCHDOG] Sending pause command at ${Date.now()}`);
                // Send pause command (fire-and-forget, don't wait)
                Promise.resolve(debugSession.customRequest('pause', { threadId: 0 }))
                    .then(() => console.log(`[DISPOSE-WATCHDOG] Pause command succeeded at ${Date.now()}`))
                    .catch((e) => console.log(`[DISPOSE-WATCHDOG] Pause command failed: ${e}`));
                
                // Clear any context keys that might block debug UI
                vscode.commands.executeCommand('setContext', 'cvDebugMate.webviewOpen', false);
            }
            
            console.log(`[DISPOSE-WATCHDOG] onDidDispose SYNC END at ${Date.now()} (took ${Date.now() - disposeTime}ms)`);
            
            // FIX: Aggressive UI refresh sequence (buttons/console假卡)
            const refreshUI = async (label: string) => {
                try {
                    // 聚焦编辑器 -> 调试视图 -> 调试控制台
                    await vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');
                    await vscode.commands.executeCommand('workbench.view.debug');
                    await vscode.commands.executeCommand('workbench.debug.action.focusRepl');
                    await vscode.commands.executeCommand('workbench.debug.action.focusCallStackView');
                    await vscode.commands.executeCommand('workbench.debug.action.focusVariablesView');
                    // Toggle到资源管理器再回调试视图，强制刷新
                    await vscode.commands.executeCommand('workbench.view.explorer');
                    await vscode.commands.executeCommand('workbench.view.debug');

                    // 触发一次 threads 请求，强制调试状态同步
                    const session = vscode.debug.activeDebugSession;
                    if (session) {
                        Promise.resolve(session.customRequest('threads', {}))
                            .catch(() => {});
                    }
                    console.log(`[DISPOSE-WATCHDOG] UI refresh step (${label}) done`);
                } catch (e) {
                    console.log(`[DISPOSE-WATCHDOG] UI refresh step (${label}) failed: ${e}`);
                }
            };

            // 多次尝试，避免一次失败
            setTimeout(() => refreshUI('t1-200ms'), 200);
            setTimeout(() => refreshUI('t2-400ms'), 400);
            setTimeout(() => refreshUI('t3-800ms'), 800);

            // Heartbeat: 再做几次 threads 请求，确认调试状态恢复
            const session = vscode.debug.activeDebugSession;
            if (session) {
                let hbCount = 0;
                const hbTimer = setInterval(() => {
                    hbCount++;
                    Promise.resolve(session.customRequest('threads', {}))
                        .then(() => console.log(`[DISPOSE-WATCHDOG] Heartbeat threads #${hbCount} ok`))
                        .catch((e) => console.log(`[DISPOSE-WATCHDOG] Heartbeat threads #${hbCount} failed: ${e}`));
                    if (hbCount >= 3) {
                        clearInterval(hbTimer);
                    }
                }, 500);
            }

            // 温和提示用户可用的手动恢复手势（减少骚扰：仅在我们发送过 pause 时提示）
            if (debugSession) {
                setTimeout(() => {
                    vscode.window.showInformationMessage(
                        '调试器已暂停以避免辅助窗口关闭时卡住。如果按钮或Console看起来卡住，请按 F5 或切换到调试面板/Console。'
                    );
                }, 300);
            }
            
            // Clean up panel references (deferred to avoid blocking)
            setTimeout(() => {
                const entry = this.panels.get(key);
                if (entry?.dataPtr) {
                    const ptrKey = `${viewType}:::${sessionId}:::ptr:${entry.dataPtr}`;
                    this.dataPtrToKey.delete(ptrKey);
                }
                for (const [k, v] of this.panels.entries()) {
                    if (v.panel === panel) {
                        this.panels.delete(k);
                    }
                }
                console.log(`[DISPOSE-WATCHDOG] Cleanup complete at ${Date.now()}`);
            }, 100);
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
