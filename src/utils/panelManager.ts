import * as vscode from 'vscode';

export class PanelManager {
    private static panels: Map<string, { 
        panel: vscode.WebviewPanel, 
        lastStateToken?: string,
        lastRefreshedVersion?: number 
    }> = new Map();

    private static currentDebugStateVersion = 0;

    /**
     * Increment the debug state version to track steps.
     */
    static incrementDebugStateVersion() {
        this.currentDebugStateVersion++;
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
        if (!entry) return false;
        return (entry.lastRefreshedVersion ?? -1) < this.currentDebugStateVersion;
    }

    /**
     * Get an existing panel or create a new one for a specific variable in a debug session.
     * @param viewType Unique identifier for the type of webview
     * @param title Title of the panel
     * @param sessionId Debug session ID
     * @param variableName Name of the variable
     * @param reveal Whether to reveal the panel if it exists
     */
    static getOrCreatePanel(
        viewType: string,
        title: string,
        sessionId: string,
        variableName: string,
        reveal: boolean = false
    ): vscode.WebviewPanel {
        const key = `${viewType}:::${sessionId}:::${variableName}`;
        
        if (this.panels.has(key)) {
            const entry = this.panels.get(key)!;
            entry.panel.title = title; // Update title in case it changed
            if (reveal) {
                entry.panel.reveal(entry.panel.viewColumn, false); // Manual trigger: bring to front and focus
            }
            return entry.panel;
        }

        const panel = vscode.window.createWebviewPanel(
            viewType,
            title,
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
            }
        );

        this.panels.set(key, { panel });

        panel.onDidDispose(() => {
            this.panels.delete(key);
        });

        panel.onDidChangeViewState(e => {
            if (e.webviewPanel.visible) {
                const parts = key.split(':::');
                if (parts.length === 3) {
                    const [vType, sid, vName] = parts;
                    if (PanelManager.needsVersionRefresh(vType, sid, vName)) {
                        // Only trigger refresh if a debug step has occurred since last update
                        vscode.commands.executeCommand('cv-debugmate.refreshVisiblePanels', true);
                    }
                }
            }
        });

        return panel;
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
        for (const [key, entry] of this.panels.entries()) {
            const parts = key.split(':::');
            if (parts.length >= 2 && parts[1] === sessionId) {
                entry.panel.dispose();
            }
        }
    }
}
