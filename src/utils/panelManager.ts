import * as vscode from 'vscode';

export class PanelManager {
    private static panels: Map<string, { panel: vscode.WebviewPanel, lastStateToken?: string }> = new Map();

    /**
     * Get an existing panel or create a new one for a specific variable in a debug session.
     * @param viewType Unique identifier for the type of webview
     * @param title Title of the panel
     * @param sessionId Debug session ID
     * @param variableName Name of the variable
     */
    static getOrCreatePanel(
        viewType: string,
        title: string,
        sessionId: string,
        variableName: string
    ): vscode.WebviewPanel {
        const key = `${viewType}:::${sessionId}:::${variableName}`;
        
        if (this.panels.has(key)) {
            const entry = this.panels.get(key)!;
            entry.panel.title = title; // Update title in case it changed
            entry.panel.reveal(vscode.ViewColumn.One);
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
