import * as vscode from "vscode";

export function getWebviewContentForPlot(
  variableName: string,
  data: number[]
): string {
  const nonce = getNonce();
  const jsonData = JSON.stringify(data);

  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Curve Plot: ${variableName}</title>
        <style nonce="${nonce}">
            body { 
                margin: 0; 
                padding: 10px;
                background-color: #1e1e1e; 
                color: #cccccc;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
                overflow: hidden;
                height: 100vh;
                display: flex;
                flex-direction: column;
                box-sizing: border-box;
            }
            #header {
                margin-bottom: 12px;
                display: flex;
                flex-direction: column;
                gap: 10px;
            }
            #title {
                font-size: 15px;
                font-weight: bold;
                color: #4a9eff;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
                padding-left: 2px;
            }
            #toolbar {
                display: flex;
                gap: 6px;
                align-items: center;
                flex-wrap: nowrap;
                height: 30px;
            }
            #toolbar.collapsed > *:not(.toggle-btn) {
                display: none;
            }
            .toggle-btn {
                background: transparent;
                border: none;
                color: #888;
                font-size: 14px;
                cursor: pointer;
                padding: 2px 6px;
                height: 28px;
                display: flex;
                align-items: center;
            }
            .toggle-btn:hover {
                color: #fff;
            }
            .btn-group {
                display: flex;
                gap: 2px;
                background: #333;
                border: 1px solid #444;
                border-radius: 3px;
                padding: 1px;
            }
            .btn-group .btn {
                border: none;
                height: 24px;
                padding: 0 8px;
            }
            /* 统一按钮和下拉触发器样式 */
            .btn, .dropdown-trigger {
                background: #333;
                color: #ccc;
                border: 1px solid #444;
                padding: 0 10px;
                height: 28px;
                border-radius: 3px;
                cursor: pointer;
                font-size: 12px;
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 6px;
                box-sizing: border-box;
                white-space: nowrap;
                transition: all 0.2s;
            }
            .btn:hover, .dropdown-trigger:hover {
                background: #444;
                border-color: #666;
            }
            .btn:disabled {
                opacity: 0.3;
                cursor: not-allowed;
                filter: grayscale(1);
            }
            .btn.active {
                background: #007acc;
                color: white;
                border-color: #007acc;
            }
            
            /* 下拉容器和菜单样式 */
            .dropdown-container {
                position: relative;
                display: inline-block;
            }
            .dropdown-menu {
                display: none;
                position: absolute;
                top: calc(100% + 4px);
                left: 0;
                background: #252526;
                border: 1px solid #454545;
                border-radius: 3px;
                z-index: 2000;
                box-shadow: 0 4px 12px rgba(0,0,0,0.5);
                min-width: 140px;
                padding: 4px 0;
            }
            .menu-item {
                display: block;
                width: 100%;
                padding: 6px 12px;
                background: transparent;
                border: none;
                color: #ccc;
                text-align: left;
                cursor: pointer;
                font-size: 12px;
                white-space: nowrap;
                box-sizing: border-box;
            }
            .menu-item:hover {
                background: #094771;
                color: white;
            }
            .menu-item.selected {
                color: #4a9eff;
                font-weight: bold;
            }
            
            #info {
                font-size: 12px;
                color: #888;
                margin-left: 10px;
                white-space: nowrap;
            }
            #container {
                flex-grow: 1;
                position: relative;
                background: #252526;
                border: 1px solid #444;
                border-radius: 4px;
            }
            canvas {
                position: absolute;
                top: 0;
                left: 0;
            }
            #tooltip {
                position: fixed;
                background: rgba(0, 0, 0, 0.8);
                color: white;
                padding: 5px 10px;
                border-radius: 4px;
                font-size: 12px;
                pointer-events: none;
                display: none;
                z-index: 1000;
                border: 1px solid #555;
                white-space: pre-line;
            }
            
            /* Settings Panel */
            #settingsPanel {
                display: none;
                position: absolute;
                top: 40px;
                right: 10px;
                background: #252526;
                border: 1px solid #454545;
                border-radius: 6px;
                z-index: 3000;
                box-shadow: 0 4px 16px rgba(0,0,0,0.6);
                padding: 12px;
                min-width: 280px;
                max-height: 70vh;
                overflow-y: auto;
            }
            .settings-section {
                margin-bottom: 12px;
                padding-bottom: 10px;
                border-bottom: 1px solid #444;
            }
            .settings-section:last-child {
                margin-bottom: 0;
                padding-bottom: 0;
                border-bottom: none;
            }
            .settings-title {
                font-size: 11px;
                font-weight: bold;
                color: #4a9eff;
                margin-bottom: 8px;
                text-transform: uppercase;
                letter-spacing: 0.5px;
            }
            .settings-row {
                display: flex;
                align-items: center;
                justify-content: space-between;
                margin-bottom: 6px;
                gap: 10px;
            }
            .settings-row label {
                font-size: 12px;
                color: #ccc;
                flex-shrink: 0;
            }
            .settings-row input[type="number"],
            .settings-row input[type="text"],
            .settings-row select {
                width: 70px;
                padding: 4px 6px;
                background: #333;
                border: 1px solid #555;
                border-radius: 3px;
                color: #ccc;
                font-size: 11px;
            }
            .settings-row select {
                width: auto;
                min-width: 100px;
                cursor: pointer;
            }
            .settings-row input[type="text"].wide {
                width: 140px;
            }
            .settings-row input:focus {
                outline: none;
                border-color: #4a9eff;
            }
            .settings-row .range-inputs {
                display: flex;
                gap: 4px;
                align-items: center;
            }
            .settings-row .range-inputs span {
                color: #888;
                font-size: 11px;
            }
            .settings-reset {
                width: 100%;
                margin-top: 10px;
                padding: 6px;
                border: none;
                border-radius: 3px;
                font-size: 12px;
                cursor: pointer;
                background: #444;
                color: #ccc;
            }
            .settings-reset:hover {
                background: #555;
            }
        </style>
    </head>
    <body>
        <div id="header">
            <div id="title">View: ${variableName}</div>
            <div id="toolbar">
                <button class="toggle-btn" id="toggleToolbar" title="Hide/Show Toolbar">▼</button>
                <div class="btn-group">
                    <button id="btnBack" class="btn" title="Previous View" disabled>⬅️</button>
                    <button id="btnForward" class="btn" title="Next View" disabled>➡️</button>
                </div>
                <button id="btnHome" class="btn" title="Reset View (Home)">🏠 Home</button>
                <button id="btnReload" class="btn" title="强制从内存重新读取数据 (保持缩放)">🔄 Reload</button>
                <button id="btnZoomRect" class="btn" title="Zoom to Rectangle">🔍 Zoom</button>
                <button id="btnPan" class="btn active" title="Pan Mode">✋ Pan</button>
                
                <!-- 绘图模式选择 -->
                <div class="btn-group">
                    <button id="btnPlot" class="btn active" title="Line Plot">📈 Plot</button>
                    <button id="btnScatter" class="btn" title="Scatter Plot">⚪ Scatter</button>
                    <button id="btnHist" class="btn" title="Histogram">📊 Hist</button>
                </div>
                
                <!-- 自定义 X 轴下拉菜单 -->
                <div class="dropdown-container">
                    <button id="triggerX" class="dropdown-trigger">X Axis: <span id="currentXText">Index</span> ▾</button>
                    <div id="menuX" class="dropdown-menu">
                        <div class="menu-item selected" data-value="index">Index</div>
                    </div>
                </div>

                <!-- 导出下拉菜单 -->
                <div class="dropdown-container">
                    <button id="btnExport" class="btn" title="Export Plot or Data">📥 Export ▾</button>
                    <div id="exportMenu" class="dropdown-menu">
                        <button class="menu-item" id="exportPNG">Save as PNG</button>
                        <button class="menu-item" id="exportCSV">Save as CSV</button>
                    </div>
                </div>
                
                <!-- 设置按钮 -->
                <button id="btnSettings" class="btn" title="Plot Settings">⚙️ Settings</button>
                
                <span id="info">Size: ${data.length}</span>
            </div>
        </div>
        <div id="container">
            <canvas id="plotCanvas"></canvas>
            <div id="tooltip"></div>
            <div id="zoomRect" style="display:none; position:absolute; border:1px solid #4a9eff; background:rgba(74,158,255,0.2); pointer-events:none;"></div>
        </div>
        
        <!-- 设置面板 -->
        <div id="settingsPanel">
            <div class="settings-section" id="plotSettings">
                <div class="settings-title">📈 Plot Settings</div>
                <div class="settings-row">
                    <label>Line Width:</label>
                    <input type="number" id="lineWidth" value="1.5" min="0.5" max="10" step="0.5">
                </div>
            </div>
            <div class="settings-section" id="scatterSettings" style="display:none;">
                <div class="settings-title">⚪ Scatter Settings</div>
                <div class="settings-row">
                    <label>Point Size:</label>
                    <input type="number" id="pointSize" value="3" min="1" max="20" step="0.5">
                </div>
            </div>
            <div class="settings-section" id="histSettings" style="display:none;">
                <div class="settings-title">📊 Histogram Settings</div>
                <div class="settings-row">
                    <label>Bin Count:</label>
                    <input type="number" id="binCount" value="50" min="5" max="500" step="5">
                </div>
                <div class="settings-row">
                    <label>Y Axis:</label>
                    <select id="histYMode">
                        <option value="freq" selected>Frequency (Count)</option>
                        <option value="density">Density (Normalized)</option>
                    </select>
                </div>
            </div>
            <div class="settings-section">
                <div class="settings-title">📐 Axis Settings</div>
                <div class="settings-row">
                    <label>X Label:</label>
                    <input type="text" id="xLabel" class="wide" placeholder="auto">
                </div>
                <div class="settings-row">
                    <label>Y Label:</label>
                    <input type="text" id="yLabel" class="wide" placeholder="auto">
                </div>
                <div class="settings-row">
                    <label>X Range:</label>
                    <div class="range-inputs">
                        <input type="number" id="xMin" placeholder="auto" step="any">
                        <span>to</span>
                        <input type="number" id="xMax" placeholder="auto" step="any">
                    </div>
                </div>
                <div class="settings-row">
                    <label>Y Range:</label>
                    <div class="range-inputs">
                        <input type="number" id="yMin" placeholder="auto" step="any">
                        <span>to</span>
                        <input type="number" id="yMax" placeholder="auto" step="any">
                    </div>
                </div>
            </div>
            <div class="settings-section">
                <div class="settings-title">🏷️ Title & Size</div>
                <div class="settings-row">
                    <label>Title:</label>
                    <input type="text" id="customTitle" class="wide" placeholder="">
                </div>
                <div class="settings-row">
                    <label>Canvas Size:</label>
                    <div class="range-inputs">
                        <input type="number" id="canvasWidth" placeholder="auto" min="200" step="10">
                        <span>×</span>
                        <input type="number" id="canvasHeight" placeholder="auto" min="200" step="10">
                    </div>
                </div>
                <div class="settings-row">
                    <label>Font Size:</label>
                    <input type="number" id="fontSize" value="15" min="8" max="24" step="1">
                </div>
            </div>
            <button class="settings-reset" id="resetSettings">🔄 Reset All</button>
        </div>

        <script nonce="${nonce}">
            (function() {
                try {
                    const vscode = acquireVsCodeApi();
                    let dataY = ${jsonData};
                    let dataX = dataY.map(function(_, i) { return i; });
                    let currentVariableNameY = "${variableName}";
                    let currentVariableNameX = "Index";

                    const canvas = document.getElementById('plotCanvas');
                    const ctx = canvas.getContext('2d');
                    const container = document.getElementById('container');
                    const tooltip = document.getElementById('tooltip');
                    const zoomRectEl = document.getElementById('zoomRect');
                    
                    const btnHome = document.getElementById('btnHome');
                    const btnZoomRect = document.getElementById('btnZoomRect');
                    const btnPan = document.getElementById('btnPan');
                    const btnBack = document.getElementById('btnBack');
                    const btnForward = document.getElementById('btnForward');
                    
                    const triggerX = document.getElementById('triggerX');
                    const menuX = document.getElementById('menuX');
                    const currentXText = document.getElementById('currentXText');
                    
                    const btnExport = document.getElementById('btnExport');
                    const exportMenu = document.getElementById('exportMenu');
                    const exportPNG = document.getElementById('exportPNG');
                    const exportCSV = document.getElementById('exportCSV');

                    let width = 0, height = 0;
                    let padding = { top: 40, right: 40, bottom: 55, left: 70 };
                    
                    let interactionMode = 'pan';
                    let plotMode = 'plot'; // 'plot', 'scatter', 'hist'
                    let scaleX = 1, scaleY = 1, offsetX = 0, offsetY = 0;
                    let isDragging = false, dragStartX = 0, dragStartY = 0, lastMouseX = 0, lastMouseY = 0;
                    
                    // Maximum zoom level to prevent excessive decimal places in tick labels
                    // This allows zooming in to view 0.1% of the original data range
                    const MAX_ZOOM = 1000;
                    
                    const btnPlot = document.getElementById('btnPlot');
                    const btnScatter = document.getElementById('btnScatter');
                    const btnHist = document.getElementById('btnHist');
                    
                    // Toggle toolbar visibility
                    const toolbar = document.getElementById('toolbar');
                    const toggleToolbarBtn = document.getElementById('toggleToolbar');
                    toggleToolbarBtn.addEventListener('click', function(e) {
                        e.stopPropagation();
                        const isCollapsed = toolbar.classList.toggle('collapsed');
                        toggleToolbarBtn.textContent = isCollapsed ? '▶' : '▼';
                    });
                    
                    // Settings panel elements
                    const btnSettings = document.getElementById('btnSettings');
                    const settingsPanel = document.getElementById('settingsPanel');
                    const plotSettingsSection = document.getElementById('plotSettings');
                    const scatterSettingsSection = document.getElementById('scatterSettings');
                    const histSettingsSection = document.getElementById('histSettings');
                    
                    // Settings values
                    let settings = {
                        lineWidth: 1.5,
                        pointSize: 3,
                        binCount: 50,
                        histYMode: 'freq', // 'freq' or 'density'
                        fontSize: 15,
                        customTitle: '',
                        // Core label concepts:
                        // - variableLabel: the data variable (Y in plot/scatter, X in hist)
                        // - indexLabel: the index/x-axis variable (X in plot/scatter)
                        // - histYLabel: the histogram Y-axis label (Frequency/Density)
                        variableLabel: '',
                        indexLabel: '',
                        histYLabel: '',
                        xMin: null,
                        xMax: null,
                        yMin: null,
                        yMax: null,
                        canvasWidth: null,
                        canvasHeight: null
                    };

                    // 视图历史记录
                    let viewHistory = [];
                    let historyIndex = -1;

                    function pushHistory() {
                        const state = { scaleX: scaleX, scaleY: scaleY, offsetX: offsetX, offsetY: offsetY };
                        // 如果当前状态与上一个记录一致，则不记录
                        if (historyIndex >= 0) {
                            const last = viewHistory[historyIndex];
                            if (last.scaleX === state.scaleX && last.scaleY === state.scaleY && 
                                last.offsetX === state.offsetX && last.offsetY === state.offsetY) {
                                return;
                            }
                        }
                        
                        // 移除当前索引之后的历史记录
                        if (historyIndex < viewHistory.length - 1) {
                            viewHistory = viewHistory.slice(0, historyIndex + 1);
                        }
                        
                        viewHistory.push(state);
                        historyIndex++;
                        
                        // 限制历史记录数量
                        if (viewHistory.length > 50) {
                            viewHistory.shift();
                            historyIndex--;
                        }
                        updateHistoryButtons();
                    }

                    function updateHistoryButtons() {
                        btnBack.disabled = historyIndex <= 0;
                        btnForward.disabled = historyIndex >= viewHistory.length - 1;
                    }

                    function applyHistoryState(index) {
                        if (index >= 0 && index < viewHistory.length) {
                            const state = viewHistory[index];
                            scaleX = state.scaleX; scaleY = state.scaleY;
                            offsetX = state.offsetX; offsetY = state.offsetY;
                            historyIndex = index;
                            // Invalidate tick cache when history state changes
                            tickCache.x.result = null;
                            tickCache.y.result = null;
                            draw();
                            updateHistoryButtons();
                        }
                    }

                    btnBack.onclick = function() { applyHistoryState(historyIndex - 1); };
                    btnForward.onclick = function() { applyHistoryState(historyIndex + 1); };

                    function updateSize() {
                        const rect = container.getBoundingClientRect();
                        const dpr = window.devicePixelRatio || 1;
                        
                        // Use custom size if set, otherwise use container size
                        width = (settings.canvasWidth && settings.canvasWidth > 0) ? settings.canvasWidth : rect.width;
                        height = (settings.canvasHeight && settings.canvasHeight > 0) ? settings.canvasHeight : rect.height;
                        
                        if (width <= 0 || height <= 0) return false;
                        
                        // If custom size is set, update container style
                        if (settings.canvasWidth && settings.canvasWidth > 0) {
                            container.style.width = settings.canvasWidth + 'px';
                        } else {
                            container.style.width = '';
                        }
                        if (settings.canvasHeight && settings.canvasHeight > 0) {
                            container.style.height = settings.canvasHeight + 'px';
                            container.style.flexGrow = '0';
                        } else {
                            container.style.height = '';
                            container.style.flexGrow = '1';
                        }
                        
                        // Set canvas buffer size (for HiDPI rendering)
                        canvas.width = Math.floor(width * dpr);
                        canvas.height = Math.floor(height * dpr);
                        
                        // Set explicit CSS dimensions to prevent stretching
                        canvas.style.width = width + 'px';
                        canvas.style.height = height + 'px';
                        
                        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
                        return true;
                    }

                    let minY = 0, maxY = 0, rangeY = 1, minX = 0, maxX = 0, rangeX = 1;

                    // Cache for tick generation to improve performance
                    // Stores the last computed ticks for each axis to avoid recalculation
                    let tickCache = {
                        x: { min: null, max: null, targetCount: null, pixelLength: null, result: null },
                        y: { min: null, max: null, targetCount: null, pixelLength: null, result: null }
                    };

                    /**
                     * Convert a rough number to a "nice" number for axis ticks.
                     * Based on Wilkinson's algorithm for nice numbers.
                     * Nice numbers are 1, 2, 5, or 10 times a power of 10.
                     * 
                     * @param {number} value - The rough number to convert
                     * @param {boolean} round - If true, round to nearest nice number; if false, use ceiling
                     * @returns {number} A nice number close to the input value
                     */
                    function niceNumber(value, round) {
                        // Handle edge cases
                        if (value === 0) return 0;
                        if (!isFinite(value)) return value;
                        
                        // Calculate the exponent (power of 10)
                        const exponent = Math.floor(Math.log10(Math.abs(value)));
                        const fraction = Math.abs(value) / Math.pow(10, exponent);
                        let niceFraction;
                        
                        if (round) {
                            // Round to nearest nice number
                            if (fraction < 1.5) niceFraction = 1;
                            else if (fraction < 3) niceFraction = 2;
                            else if (fraction < 7) niceFraction = 5;
                            else niceFraction = 10;
                        } else {
                            // Use ceiling (for range calculation)
                            if (fraction <= 1) niceFraction = 1;
                            else if (fraction <= 2) niceFraction = 2;
                            else if (fraction <= 5) niceFraction = 5;
                            else niceFraction = 10;
                        }
                        
                        // Preserve the sign of the original value
                        const result = niceFraction * Math.pow(10, exponent);
                        return value < 0 ? -result : result;
                    }

                    /**
                     * Generate adaptive tick marks for an axis.
                     * Based on Wilkinson's algorithm for nice numbers.
                     * Uses caching to avoid recalculation when parameters haven't changed.
                     * 
                     * @param {number} min - Minimum value of the visible range
                     * @param {number} max - Maximum value of the visible range
                     * @param {number} targetCount - Target number of ticks (default 6)
                     * @param {number} pixelLength - Length of the axis in pixels (for overlap prevention)
                     * @param {string} axis - Axis identifier ('x' or 'y') for caching
                     * @returns {Object} Object containing values (tick positions), labels (formatted strings), and step (tick interval)
                     */
                    function generateTicks(min, max, targetCount, pixelLength, axis) {
                        // Default parameters
                        targetCount = targetCount || 6;
                        pixelLength = pixelLength || 400;
                        axis = axis || 'x'; // Default to 'x' if not specified
                        const minSpacing = 40; // Minimum pixel spacing between ticks to prevent overlap
                        
                        // Check cache - only recalculate if parameters have changed
                        const cache = tickCache[axis];
                        if (cache && cache.result !== null &&
                            cache.min === min && 
                            cache.max === max && 
                            cache.targetCount === targetCount && 
                            cache.pixelLength === pixelLength) {
                            // Return cached result
                            return cache.result;
                        }
                        
                        // === INPUT VALIDATION AND ERROR HANDLING ===
                        
                        // Handle NaN values - replace with default range
                        if (isNaN(min) || isNaN(max)) {
                            const result = { values: [0, 1], labels: ['0', '1'], step: 1 };
                            // Update cache
                            cache.min = min;
                            cache.max = max;
                            cache.targetCount = targetCount;
                            cache.pixelLength = pixelLength;
                            cache.result = result;
                            return result;
                        }
                        
                        // Handle Infinity values - replace with large finite values
                        if (!isFinite(min)) {
                            min = min === Infinity ? 1e10 : -1e10;
                        }
                        if (!isFinite(max)) {
                            max = max === Infinity ? 1e10 : -1e10;
                        }
                        
                        // Handle zero range (min === max)
                        if (min === max) {
                            const val = min;
                            // Create artificial range based on magnitude
                            if (val === 0) {
                                // For zero, use [-1, 1]
                                min = -1;
                                max = 1;
                            } else {
                                // For non-zero, use ±10% of the value
                                const offset = Math.abs(val) * 0.1;
                                min = val - offset;
                                max = val + offset;
                            }
                        }
                        
                        // Ensure min < max (swap if necessary)
                        if (min > max) {
                            const temp = min;
                            min = max;
                            max = temp;
                        }
                        
                        // Handle extreme ranges
                        let range = max - min;
                        
                        // For very small ranges (< 1e-10), expand to a reasonable range
                        if (range > 0 && range < 1e-10) {
                            const center = (min + max) / 2;
                            const halfRange = 5e-11; // Half of 1e-10
                            min = center - halfRange;
                            max = center + halfRange;
                            range = max - min; // Recalculate range after adjustment
                        }
                        
                        // For very large ranges (> 1e10), we'll let the algorithm handle it
                        // but ensure we don't have numerical issues
                        if (range > 1e15) {
                            // Cap the range to prevent numerical instability
                            const center = (min + max) / 2;
                            const halfRange = 5e14; // Half of 1e15
                            min = center - halfRange;
                            max = center + halfRange;
                            range = max - min; // Recalculate range after adjustment
                        }
                        
                        // Calculate rough step
                        const roughStep = range / (targetCount - 1);
                        
                        // Convert to nice step
                        const niceStep = niceNumber(roughStep, true);
                        
                        // Calculate tick start (round down to nearest nice step)
                        const tickMin = Math.floor(min / niceStep) * niceStep;
                        
                        // Generate tick values
                        const values = [];
                        let currentTick = tickMin;
                        
                        // Generate ticks until we exceed max
                        // Add a small epsilon to handle floating point precision
                        const epsilon = niceStep * 1e-10;
                        while (currentTick <= max + epsilon) {
                            values.push(currentTick);
                            currentTick += niceStep;
                            
                            // Safety check to prevent infinite loops
                            if (values.length > 100) break;
                        }
                        
                        // Ensure we have at least 2 ticks
                        if (values.length < 2) {
                            values.push(tickMin);
                            values.push(tickMin + niceStep);
                        }
                        
                        // Check for minimum spacing to prevent label overlap
                        // Calculate pixel spacing between ticks
                        if (values.length > 2) {
                            const pixelSpacing = pixelLength / (values.length - 1);
                            
                            // If spacing is too small, reduce tick count by taking every nth tick
                            if (pixelSpacing < minSpacing) {
                                // Calculate how many ticks we should skip to meet minimum spacing
                                const skipFactor = Math.ceil(minSpacing / pixelSpacing);
                                const reducedValues = [];
                                
                                // Always include first tick
                                reducedValues.push(values[0]);
                                
                                // Add intermediate ticks with proper spacing
                                for (let i = skipFactor; i < values.length - 1; i += skipFactor) {
                                    reducedValues.push(values[i]);
                                }
                                
                                // Always include last tick (if not already included)
                                if (reducedValues[reducedValues.length - 1] !== values[values.length - 1]) {
                                    reducedValues.push(values[values.length - 1]);
                                }
                                
                                // Ensure we have at least 2 ticks
                                if (reducedValues.length < 2) {
                                    reducedValues.length = 0;
                                    reducedValues.push(values[0]);
                                    reducedValues.push(values[values.length - 1]);
                                }
                                
                                // Update values array
                                values.length = 0;
                                for (let i = 0; i < reducedValues.length; i++) {
                                    values.push(reducedValues[i]);
                                }
                            }
                        }
                        
                        // Format labels (recalculate step based on potentially reduced tick count)
                        const finalStep = values.length > 1 ? values[1] - values[0] : niceStep;
                        const labels = values.map(function(val) {
                            return formatTickLabel(val, finalStep);
                        });
                        
                        const result = {
                            values: values,
                            labels: labels,
                            step: finalStep
                        };
                        
                        // Update cache with new result
                        cache.min = min;
                        cache.max = max;
                        cache.targetCount = targetCount;
                        cache.pixelLength = pixelLength;
                        cache.result = result;
                        
                        return result;
                    }

                    /**
                     * Format a tick label based on the step size.
                     * Uses appropriate decimal places or scientific notation.
                     * 
                     * @param {number} value - The tick value to format
                     * @param {number} step - The step size between ticks
                     * @returns {string} Formatted label string
                     */
                    function formatTickLabel(value, step) {
                        // Handle very large or very small numbers with scientific notation
                        if (Math.abs(value) >= 1e6 || (Math.abs(value) < 1e-3 && value !== 0)) {
                            return value.toExponential(2);
                        }
                        
                        // Determine decimal places based on step magnitude
                        const stepMagnitude = Math.floor(Math.log10(Math.abs(step)));
                        let decimalPlaces = Math.max(0, -stepMagnitude + 1);
                        
                        // Limit maximum decimal places to 6 to prevent excessive precision
                        // If we need more than 6 decimals, use scientific notation instead
                        if (decimalPlaces > 6) {
                            return value.toExponential(2);
                        }
                        
                        return value.toFixed(decimalPlaces);
                    }

                    function getBounds(arr) {
                        if (!arr || arr.length === 0) return { min: 0, max: 1 };
                        let min = arr[0], max = arr[0];
                        for (let i = 1; i < arr.length; i++) {
                            if (arr[i] < min) min = arr[i];
                            if (arr[i] > max) max = arr[i];
                        }
                        return { min: min, max: max };
                    }

                    function updateDataBounds() {
                        const bY = getBounds(dataY);
                        const bX = getBounds(dataX);
                        
                        // Add 5% padding for auto limits so edge points are fully visible
                        const MARGIN_RATIO = 0.05;
                        const yPadding = (bY.max - bY.min) * MARGIN_RATIO || 0.1;
                        const xPadding = (bX.max - bX.min) * MARGIN_RATIO || 0.1;
                        
                        // Apply custom limits if set, otherwise use auto with padding
                        minY = (settings.yMin !== null && !isNaN(settings.yMin)) ? settings.yMin : (bY.min - yPadding);
                        maxY = (settings.yMax !== null && !isNaN(settings.yMax)) ? settings.yMax : (bY.max + yPadding);
                        rangeY = (maxY - minY) || 1;

                        minX = (settings.xMin !== null && !isNaN(settings.xMin)) ? settings.xMin : (bX.min - xPadding);
                        maxX = (settings.xMax !== null && !isNaN(settings.xMax)) ? settings.xMax : (bX.max + xPadding);
                        rangeX = (maxX - minX) || 1;
                        
                        // Invalidate tick cache when data bounds change
                        tickCache.x.result = null;
                        tickCache.y.result = null;
                    }

                    function toScreenX(val) {
                        const innerWidth = width - padding.left - padding.right;
                        if (rangeX === 0 || innerWidth <= 0) return padding.left;
                        return padding.left + (((val - minX) / rangeX) * innerWidth + offsetX) * scaleX;
                    }

                    function toScreenY(val) {
                        const innerHeight = height - padding.top - padding.bottom;
                        if (rangeY === 0 || innerHeight <= 0) return height - padding.bottom;
                        return height - padding.bottom - (((val - minY) / rangeY) * innerHeight + offsetY) * scaleY;
                    }

                    function fromScreenX(screenX) {
                        const innerWidth = width - padding.left - padding.right;
                        if (innerWidth <= 0 || scaleX === 0) return minX;
                        return (((screenX - padding.left) / scaleX - offsetX) / innerWidth) * rangeX + minX;
                    }

                    function fromScreenY(screenY) {
                        const innerHeight = height - padding.top - padding.bottom;
                        if (innerHeight <= 0 || scaleY === 0) return minY;
                        return (((height - padding.bottom - screenY) / scaleY - offsetY) / innerHeight) * rangeY + minY;
                    }

                    function draw() {
                        if (!updateSize()) return;
                        ctx.clearRect(0, 0, width, height);

                        const axisFontSize = settings.fontSize || 15;
                        const titleFontSize = axisFontSize + 4; // Title is slightly larger
                        const chartTitle = settings.customTitle || '';
                        
                        // Initial padding estimates
                        const xTickLabelHeight = axisFontSize + 4;
                        const xAxisLabelHeight = axisFontSize + 6;
                        padding.bottom = Math.max(55, xTickLabelHeight + xAxisLabelHeight + 15);
                        padding.top = chartTitle ? Math.max(45, titleFontSize + 25) : 30;
                        padding.right = 40;
                        
                        // Initial left padding estimate (will be refined after measuring Y-axis labels)
                        padding.left = 70;
                        
                        // Pre-calculate dimensions for tick generation
                        let innerWidth = width - padding.left - padding.right;
                        let innerHeight = height - padding.top - padding.bottom;
                        
                        // For histogram mode, calculate bins first (needed for Y-axis range)
                        let histDataMin = 0, histDataMax = 1, histDataRange = 1;
                        let histMaxY = 1;
                        if (plotMode === 'hist') {
                            histDataMin = Math.min(...dataY);
                            histDataMax = Math.max(...dataY);
                            histDataRange = (histDataMax - histDataMin) || 1;
                            
                            const numBins = settings.binCount || 50;
                            const binWidth = histDataRange / numBins;
                            const bins = new Array(numBins).fill(0);
                            for (let i = 0; i < dataY.length; i++) {
                                let binIdx = Math.floor((dataY[i] - histDataMin) / binWidth);
                                if (binIdx >= numBins) binIdx = numBins - 1;
                                if (binIdx < 0) binIdx = 0;
                                bins[binIdx]++;
                            }
                            if (settings.histYMode === 'density') {
                                const totalArea = dataY.length * binWidth;
                                histMaxY = Math.max(...bins.map(b => b / totalArea));
                            } else {
                                histMaxY = Math.max(...bins);
                            }
                        }
                        
                        // Set font for measurement
                        ctx.font = axisFontSize + 'px Arial';
                        
                        // Calculate visible data range for Y-axis tick generation
                        let visibleMinY = fromScreenY(height - padding.bottom);
                        let visibleMaxY = fromScreenY(padding.top);
                        
                        // Generate Y-axis ticks (preliminary, for width measurement)
                        let yTicks;
                        if (plotMode === 'hist') {
                            yTicks = generateTicks(0, histMaxY, 6, innerHeight, 'y');
                        } else {
                            yTicks = generateTicks(visibleMinY, visibleMaxY, 6, innerHeight, 'y');
                        }
                        
                        // Measure maximum Y-axis label width
                        let maxYLabelWidth = 0;
                        for (let i = 0; i < yTicks.labels.length; i++) {
                            const labelWidth = ctx.measureText(yTicks.labels[i]).width;
                            if (labelWidth > maxYLabelWidth) {
                                maxYLabelWidth = labelWidth;
                            }
                        }
                        
                        // Calculate required left padding
                        const yTickOffset = 8; // Space between tick and label
                        const yAxisLabelSpace = axisFontSize + 10; // Space for rotated Y axis label
                        const tickMarkLength = 4; // Length of tick mark
                        const requiredLeftPadding = maxYLabelWidth + yTickOffset + tickMarkLength + yAxisLabelSpace;
                        
                        // Update left padding with minimum of 60px
                        padding.left = Math.max(60, Math.ceil(requiredLeftPadding));
                        
                        // Recalculate inner dimensions with updated padding
                        innerWidth = width - padding.left - padding.right;
                        innerHeight = height - padding.top - padding.bottom;
                        if (innerWidth <= 0 || innerHeight <= 0) return;

                        // Draw axes
                        ctx.strokeStyle = '#555';
                        ctx.lineWidth = 1;
                        ctx.beginPath();
                        ctx.moveTo(padding.left, padding.top);
                        ctx.lineTo(padding.left, height - padding.bottom);
                        ctx.lineTo(width - padding.right, height - padding.bottom);
                        ctx.stroke();

                        // Tick label offsets
                        const xTickOffset = 8;
                        const xLabelHeight = axisFontSize + 4;
                        
                        // Y-axis tick labels with custom font size
                        ctx.fillStyle = '#888';
                        ctx.font = axisFontSize + 'px Arial';
                        ctx.textAlign = 'right';
                        ctx.textBaseline = 'middle';
                        
                        // Recalculate visible data range with updated padding
                        const visibleMinX = fromScreenX(padding.left);
                        const visibleMaxX = fromScreenX(width - padding.right);
                        visibleMinY = fromScreenY(height - padding.bottom);
                        visibleMaxY = fromScreenY(padding.top);
                        
                        // Regenerate Y-axis ticks with updated dimensions
                        if (plotMode === 'hist') {
                            // In histogram: Y-axis shows frequency/density from 0 to max
                            yTicks = generateTicks(0, histMaxY, 6, innerHeight, 'y');
                        } else {
                            // In plot/scatter: Y-axis shows visible data range
                            yTicks = generateTicks(visibleMinY, visibleMaxY, 6, innerHeight, 'y');
                        }
                        
                        // Draw Y-axis ticks
                        for (let i = 0; i < yTicks.values.length; i++) {
                            const val = yTicks.values[i];
                            const label = yTicks.labels[i];
                            let yPos;
                            
                            if (plotMode === 'hist') {
                                // In histogram mode, map tick value to screen position
                                yPos = height - padding.bottom - (val / histMaxY) * innerHeight;
                            } else {
                                // In plot/scatter mode, use standard coordinate transform
                                yPos = toScreenY(val);
                            }
                            
                            if (yPos >= padding.top && yPos <= height - padding.bottom) {
                                ctx.fillText(label, padding.left - yTickOffset, yPos);
                                ctx.beginPath(); 
                                ctx.moveTo(padding.left - 4, yPos); 
                                ctx.lineTo(padding.left, yPos); 
                                ctx.stroke();
                            }
                        }

                        // X-axis tick labels
                        ctx.textAlign = 'center';
                        ctx.textBaseline = 'top';
                        
                        // Generate X-axis ticks using adaptive algorithm
                        let xTicks;
                        if (plotMode === 'hist') {
                            // In histogram: X-axis shows data value range
                            xTicks = generateTicks(histDataMin, histDataMax, 6, innerWidth, 'x');
                        } else {
                            // In plot/scatter: X-axis shows visible index/custom X range
                            xTicks = generateTicks(visibleMinX, visibleMaxX, 6, innerWidth, 'x');
                        }
                        
                        // Draw X-axis ticks
                        for (let i = 0; i < xTicks.values.length; i++) {
                            const val = xTicks.values[i];
                            const label = xTicks.labels[i];
                            let xPos;
                            
                            if (plotMode === 'hist') {
                                // In histogram mode, map tick value to screen position
                                xPos = padding.left + ((val - histDataMin) / histDataRange) * innerWidth;
                            } else {
                                // In plot/scatter mode, use standard coordinate transform
                                xPos = toScreenX(val);
                            }
                            
                            if (xPos >= padding.left && xPos <= width - padding.right) {
                                ctx.fillText(label, xPos, height - padding.bottom + xTickOffset);
                                ctx.beginPath();
                                ctx.moveTo(xPos, height - padding.bottom);
                                ctx.lineTo(xPos, height - padding.bottom + 4);
                                ctx.stroke();
                            }
                        }

                        // Chart title - centered at top
                        if (chartTitle) {
                            ctx.fillStyle = '#4a9eff';
                            ctx.font = 'bold ' + titleFontSize + 'px Arial';
                            ctx.textAlign = 'center';
                            ctx.textBaseline = 'top';
                            ctx.fillText(chartTitle, padding.left + innerWidth / 2, 8);
                        }
                        
                        // Axis names with custom font
                        ctx.fillStyle = '#4a9eff';
                        ctx.font = (axisFontSize + 2) + 'px Arial';
                        ctx.textAlign = 'center';
                        // X-axis label - position below tick labels with extra margin
                        const xAxisLabelY = height - padding.bottom + xTickOffset + xLabelHeight + 8;
                        
                        // Determine axis labels based on mode using core label concepts:
                        // - variableLabel: data variable (plot/scatter Y, hist X)
                        // - indexLabel: index variable (plot/scatter X)
                        // - histYLabel: histogram Y (Frequency/Density)
                        let xLabelText, yLabelText;
                        if (plotMode === 'hist') {
                            // Hist: X = variableLabel, Y = histYLabel or default
                            xLabelText = settings.variableLabel || currentVariableNameY;
                            const defaultHistY = (settings.histYMode === 'density') ? 'Density' : 'Frequency';
                            yLabelText = settings.histYLabel || defaultHistY;
                        } else {
                            // Plot/Scatter: X = indexLabel, Y = variableLabel
                            xLabelText = settings.indexLabel || currentVariableNameX;
                            yLabelText = settings.variableLabel || currentVariableNameY;
                        }
                        
                        ctx.fillText(xLabelText, padding.left + innerWidth / 2, xAxisLabelY);
                        // Y-axis label - rotated on left side
                        ctx.save();
                        ctx.translate(12, padding.top + innerHeight / 2);
                        ctx.rotate(-Math.PI / 2);
                        ctx.fillText(yLabelText, 0, 0);
                        ctx.restore();

                        // Clip to plot area
                        ctx.save();
                        ctx.beginPath();
                        ctx.rect(padding.left, padding.top, innerWidth, innerHeight);
                        ctx.clip();
                        
                        if (plotMode === 'plot') {
                            // Line plot with custom line width
                            ctx.strokeStyle = '#4a9eff';
                            ctx.lineWidth = settings.lineWidth || 1.5;
                            ctx.beginPath();
                            for (let i = 0; i < dataY.length; i++) {
                                const x = toScreenX(dataX[i]);
                                const y = toScreenY(dataY[i]);
                                if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
                            }
                            ctx.stroke();
                        } else if (plotMode === 'scatter') {
                            // Scatter plot with custom point size
                            ctx.fillStyle = '#4a9eff';
                            const pSize = settings.pointSize || 3;
                            for (let i = 0; i < dataY.length; i++) {
                                const x = toScreenX(dataX[i]);
                                const y = toScreenY(dataY[i]);
                                ctx.beginPath();
                                ctx.arc(x, y, pSize, 0, Math.PI * 2);
                                ctx.fill();
                            }
                        } else if (plotMode === 'hist') {
                            // Histogram with custom bin count
                            // Get data range from dataY (the original Y values become X axis in histogram)
                            const histDataMin = Math.min(...dataY);
                            const histDataMax = Math.max(...dataY);
                            const histDataRange = (histDataMax - histDataMin) || 1;
                            
                            const numBins = settings.binCount || 50;
                            const binWidth = histDataRange / numBins;
                            const bins = new Array(numBins).fill(0);
                            
                            for (let i = 0; i < dataY.length; i++) {
                                let binIdx = Math.floor((dataY[i] - histDataMin) / binWidth);
                                if (binIdx >= numBins) binIdx = numBins - 1;
                                if (binIdx < 0) binIdx = 0;
                                bins[binIdx]++;
                            }
                            
                            // Calculate Y values based on mode (frequency or density)
                            let yValues;
                            if (settings.histYMode === 'density') {
                                // Density: normalize so that the integral equals 1
                                const totalArea = dataY.length * binWidth;
                                yValues = bins.map(b => b / totalArea);
                            } else {
                                // Frequency: raw counts
                                yValues = bins;
                            }
                            const maxY = Math.max(...yValues);
                            
                            ctx.fillStyle = 'rgba(74, 158, 255, 0.7)';
                            ctx.strokeStyle = '#4a9eff';
                            ctx.lineWidth = 1;
                            
                            const barWidthPx = innerWidth / numBins;
                            for (let i = 0; i < numBins; i++) {
                                const barHeight = maxY > 0 ? (yValues[i] / maxY) * innerHeight : 0;
                                const x = padding.left + i * barWidthPx;
                                const y = height - padding.bottom - barHeight;
                                ctx.fillRect(x, y, barWidthPx - 1, barHeight);
                                ctx.strokeRect(x, y, barWidthPx - 1, barHeight);
                            }
                        }
                        ctx.restore();
                    }

                    function resetView() {
                        scaleX = scaleY = 1;
                        offsetX = offsetY = 0;
                        // Invalidate tick cache when view resets
                        tickCache.x.result = null;
                        tickCache.y.result = null;
                        draw();
                        pushHistory();
                    }

                    // 下拉菜单切换逻辑
                    function toggleMenu(menu) {
                        const isVisible = menu.style.display === 'block';
                        document.querySelectorAll('.dropdown-menu').forEach(m => m.style.display = 'none');
                        if (!isVisible) menu.style.display = 'block';
                    }

                    triggerX.onclick = function(e) {
                        e.stopPropagation();
                        toggleMenu(menuX);
                    };

                    btnExport.onclick = function(e) {
                        e.stopPropagation();
                        toggleMenu(exportMenu);
                    };

                    window.addEventListener('click', function() {
                        document.querySelectorAll('.dropdown-menu').forEach(m => m.style.display = 'none');
                    });

                    function handleXSelect(value, name) {
                        if (value === 'index') {
                            dataX = dataY.map(function(_, i) { return i; });
                            currentVariableNameX = "Index";
                            currentXText.textContent = "Index";
                            updateDataBounds(); resetView();
                        } else {
                            vscode.postMessage({ command: 'requestData', name: value, target: 'x' });
                        }
                        
                        menuX.querySelectorAll('.menu-item').forEach(item => {
                            item.classList.toggle('selected', item.getAttribute('data-value') === value);
                        });
                        menuX.style.display = 'none';
                    }

                    window.addEventListener('message', function(event) {
                        const message = event.data;
                        if (message.command === 'updateOptions') {
                            let html = '<div class="menu-item' + (currentVariableNameX === 'Index' ? ' selected' : '') + '" data-value="index">Index</div>';
                            for (let i = 0; i < message.options.length; i++) {
                                const optName = message.options[i];
                                html += '<div class="menu-item' + (currentVariableNameX === optName ? ' selected' : '') + '" data-value="' + optName + '">' + optName + '</div>';
                            }
                            menuX.innerHTML = html;
                            
                            menuX.querySelectorAll('.menu-item').forEach(item => {
                                item.onclick = function() {
                                    handleXSelect(this.getAttribute('data-value'), this.textContent);
                                };
                            });
                        } else if (message.command === 'updateData') {
                            if (message.target === 'x') {
                                dataX = message.data;
                                currentVariableNameX = message.name;
                                currentXText.textContent = message.name;
                                updateDataBounds(); resetView();
                            }
                        } else if (message.command === 'updateInitialData') {
                            dataY = message.data;
                            if (currentVariableNameX === "Index") {
                                dataX = dataY.map(function(_, i) { return i; });
                            }
                            updateDataBounds();
                            draw();
                        }
                    });

                    btnExport.onclick = function(e) {
                        e.stopPropagation();
                        exportMenu.style.display = exportMenu.style.display === 'none' ? 'block' : 'none';
                    };
                    window.addEventListener('click', function() { exportMenu.style.display = 'none'; });

                    exportPNG.onclick = function() {
                        const url = canvas.toDataURL('image/png');
                        vscode.postMessage({ command: 'saveFile', type: 'png', data: url, defaultName: currentVariableNameY + '_plot.png' });
                    };

                    exportCSV.onclick = function() {
                        let csvRows = [];
                        csvRows.push(currentVariableNameX + ',' + currentVariableNameY);
                        for (let i = 0; i < dataY.length; i++) {
                            csvRows.push(dataX[i] + ',' + dataY[i]);
                        }
                        vscode.postMessage({ 
                            command: 'saveFile', 
                            type: 'csv', 
                            data: csvRows.join('\\r\\n'), 
                            defaultName: currentVariableNameY + '_data.csv' 
                        });
                    };

                    container.addEventListener('mousedown', function(e) {
                        isDragging = true; dragStartX = e.clientX; dragStartY = e.clientY; lastMouseX = e.clientX; lastMouseY = e.clientY;
                        if (interactionMode === 'zoomRect') {
                            const r = container.getBoundingClientRect();
                            zoomRectEl.style.display = 'block'; zoomRectEl.style.left = (e.clientX - r.left) + 'px'; zoomRectEl.style.top = (e.clientY - r.top) + 'px';
                            zoomRectEl.style.width = '0px'; zoomRectEl.style.height = '0px';
                        }
                    });

                    window.addEventListener('mousemove', function(e) {
                        const r = container.getBoundingClientRect();
                        const mx = e.clientX - r.left, my = e.clientY - r.top;
                        if (isDragging) {
                            if (interactionMode === 'pan') {
                                offsetX += (e.clientX - lastMouseX) / scaleX;
                                offsetY -= (e.clientY - lastMouseY) / scaleY;
                                lastMouseX = e.clientX; lastMouseY = e.clientY; draw();
                            } else if (interactionMode === 'zoomRect') {
                                const startX = dragStartX - r.left, startY = dragStartY - r.top;
                                zoomRectEl.style.left = Math.min(startX, mx) + 'px'; zoomRectEl.style.top = Math.min(startY, my) + 'px';
                                zoomRectEl.style.width = Math.abs(mx - startX) + 'px'; zoomRectEl.style.height = Math.abs(my - startY) + 'px';
                            }
                        } else {
                            if (mx >= padding.left && mx <= width - padding.right && my >= padding.top && my <= height - padding.bottom) {
                                const xVal = fromScreenX(mx);
                                let minDist = Infinity, idx = -1;
                                for(let i=0; i<dataX.length; i++) {
                                    const d = Math.abs(dataX[i] - xVal);
                                    if(d < minDist) { minDist = d; idx = i; }
                                }
                                if (idx !== -1) {
                                    tooltip.style.display = 'block'; tooltip.style.left = (e.clientX + 15) + 'px'; tooltip.style.top = (e.clientY + 15) + 'px';
                                    tooltip.textContent = 'X (' + currentVariableNameX + '): ' + dataX[idx].toFixed(4) + '\\nY (' + currentVariableNameY + '): ' + dataY[idx].toFixed(4);
                                }
                            } else tooltip.style.display = 'none';
                        }
                    });

                    window.addEventListener('mouseup', function(e) {
                        if (isDragging) {
                            if (interactionMode === 'zoomRect') {
                                const r = container.getBoundingClientRect();
                                const x1 = fromScreenX(Math.min(dragStartX - r.left, e.clientX - r.left));
                                const x2 = fromScreenX(Math.max(dragStartX - r.left, e.clientX - r.left));
                                const y1 = fromScreenY(Math.max(dragStartY - r.top, e.clientY - r.top));
                                const y2 = fromScreenY(Math.min(dragStartY - r.top, e.clientY - r.top));
                                if (Math.abs(e.clientX - dragStartX) > 5) {
                                    const iW = width - padding.left - padding.right, iH = height - padding.top - padding.bottom;
                                    const newScaleX = iW / ((x2 - x1) / rangeX * iW);
                                    const newScaleY = iH / ((y2 - y1) / rangeY * iH);
                                    
                                    // Limit maximum zoom to prevent excessive decimal places
                                    scaleX = Math.min(newScaleX, MAX_ZOOM);
                                    scaleY = Math.min(newScaleY, MAX_ZOOM);
                                    
                                    offsetX = -((x1 - minX) / rangeX * iW); offsetY = -((y1 - minY) / rangeY * iH);
                                    // Invalidate tick cache when zoom changes
                                    tickCache.x.result = null;
                                    tickCache.y.result = null;
                                    draw();
                                }
                                zoomRectEl.style.display = 'none';
                            }
                            pushHistory();
                        }
                        isDragging = false;
                    });

                    // Wheel zoom disabled to prevent accidental zooming - use Zoom button instead

                    window.onresize = function() { draw(); };
                    btnHome.onclick = resetView;
                    document.getElementById('btnReload').onclick = function() {
                        vscode.postMessage({ command: 'reload' });
                    };
                    btnPan.onclick = function() { interactionMode = 'pan'; btnPan.classList.add('active'); btnZoomRect.classList.remove('active'); };
                    btnZoomRect.onclick = function() { interactionMode = 'zoomRect'; btnZoomRect.classList.add('active'); btnPan.classList.remove('active'); };
                    
                    function setPlotMode(mode) {
                        plotMode = mode;
                        btnPlot.classList.toggle('active', mode === 'plot');
                        btnScatter.classList.toggle('active', mode === 'scatter');
                        btnHist.classList.toggle('active', mode === 'hist');
                        updateSettingsSections();
                        // Invalidate tick cache when plot mode changes
                        tickCache.x.result = null;
                        tickCache.y.result = null;
                        draw();
                    }
                    btnPlot.onclick = function() { setPlotMode('plot'); };
                    btnScatter.onclick = function() { setPlotMode('scatter'); };
                    btnHist.onclick = function() { setPlotMode('hist'); };
                    
                    // Settings panel logic
                    function updateSettingsSections() {
                        plotSettingsSection.style.display = plotMode === 'plot' ? 'block' : 'none';
                        scatterSettingsSection.style.display = plotMode === 'scatter' ? 'block' : 'none';
                        histSettingsSection.style.display = plotMode === 'hist' ? 'block' : 'none';
                        
                        // Update axis label inputs based on mode
                        // Core mapping:
                        // - variableLabel: data variable (plot/scatter Y, hist X)
                        // - indexLabel: index variable (plot/scatter X)
                        // - histYLabel: histogram Y (Frequency/Density)
                        const xLabelInput = document.getElementById('xLabel');
                        const yLabelInput = document.getElementById('yLabel');
                        
                        if (plotMode === 'hist') {
                            // In hist mode: X = variableLabel, Y = histYLabel
                            xLabelInput.value = settings.variableLabel;
                            xLabelInput.placeholder = currentVariableNameY;
                            yLabelInput.value = settings.histYLabel;
                            yLabelInput.placeholder = (settings.histYMode === 'density') ? 'Density' : 'Frequency';
                        } else {
                            // In plot/scatter mode: X = indexLabel, Y = variableLabel
                            xLabelInput.value = settings.indexLabel;
                            xLabelInput.placeholder = currentVariableNameX;
                            yLabelInput.value = settings.variableLabel;
                            yLabelInput.placeholder = currentVariableNameY;
                        }
                    }
                    
                    btnSettings.onclick = function(e) {
                        e.stopPropagation();
                        const isVisible = settingsPanel.style.display === 'block';
                        settingsPanel.style.display = isVisible ? 'none' : 'block';
                        if (!isVisible) {
                            updateSettingsSections();
                            // Populate current values
                            document.getElementById('lineWidth').value = settings.lineWidth;
                            document.getElementById('pointSize').value = settings.pointSize;
                            document.getElementById('binCount').value = settings.binCount;
                            document.getElementById('fontSize').value = settings.fontSize;
                            document.getElementById('customTitle').value = settings.customTitle || '';
                            document.getElementById('xMin').value = settings.xMin !== null ? settings.xMin : '';
                            document.getElementById('xMax').value = settings.xMax !== null ? settings.xMax : '';
                            document.getElementById('yMin').value = settings.yMin !== null ? settings.yMin : '';
                            document.getElementById('yMax').value = settings.yMax !== null ? settings.yMax : '';
                            document.getElementById('canvasWidth').value = settings.canvasWidth || '';
                            document.getElementById('canvasHeight').value = settings.canvasHeight || '';
                        }
                    };
                    
                    settingsPanel.onclick = function(e) {
                        e.stopPropagation();
                    };
                    
                    const resetSettingsBtn = document.getElementById('resetSettings');
                    
                    // Default settings values
                    const defaultSettings = {
                        lineWidth: 1.5,
                        pointSize: 3,
                        binCount: 50,
                        histYMode: 'freq',
                        fontSize: 15,
                        customTitle: '',
                        variableLabel: '',
                        indexLabel: '',
                        histYLabel: '',
                        xMin: null,
                        xMax: null,
                        yMin: null,
                        yMax: null,
                        canvasWidth: null,
                        canvasHeight: null
                    };
                    
                    // Real-time settings update function
                    function updateSettingsFromInputs() {
                        settings.lineWidth = parseFloat(document.getElementById('lineWidth').value) || 1.5;
                        settings.pointSize = parseFloat(document.getElementById('pointSize').value) || 3;
                        settings.binCount = parseInt(document.getElementById('binCount').value) || 50;
                        settings.histYMode = document.getElementById('histYMode').value || 'freq';
                        settings.fontSize = parseInt(document.getElementById('fontSize').value) || 15;
                        settings.customTitle = document.getElementById('customTitle').value || '';
                        
                        // Map UI labels to core labels based on current mode
                        const xLabelValue = document.getElementById('xLabel').value || '';
                        const yLabelValue = document.getElementById('yLabel').value || '';
                        if (plotMode === 'hist') {
                            // In hist mode: X = variableLabel, Y = histYLabel
                            settings.variableLabel = xLabelValue;
                            settings.histYLabel = yLabelValue;
                            // Update placeholder when histYMode changes
                            document.getElementById('yLabel').placeholder = (settings.histYMode === 'density') ? 'Density' : 'Frequency';
                        } else {
                            // In plot/scatter mode: X = indexLabel, Y = variableLabel
                            settings.indexLabel = xLabelValue;
                            settings.variableLabel = yLabelValue;
                        }
                        
                        const xMinVal = document.getElementById('xMin').value;
                        const xMaxVal = document.getElementById('xMax').value;
                        const yMinVal = document.getElementById('yMin').value;
                        const yMaxVal = document.getElementById('yMax').value;
                        settings.xMin = xMinVal !== '' ? parseFloat(xMinVal) : null;
                        settings.xMax = xMaxVal !== '' ? parseFloat(xMaxVal) : null;
                        settings.yMin = yMinVal !== '' ? parseFloat(yMinVal) : null;
                        settings.yMax = yMaxVal !== '' ? parseFloat(yMaxVal) : null;
                        
                        const cw = document.getElementById('canvasWidth').value;
                        const ch = document.getElementById('canvasHeight').value;
                        settings.canvasWidth = cw !== '' ? parseInt(cw) : null;
                        settings.canvasHeight = ch !== '' ? parseInt(ch) : null;
                        
                        updateDataBounds();
                        draw();
                    }
                    
                    // Add real-time listeners to all setting inputs (including select elements)
                    const settingInputs = settingsPanel.querySelectorAll('input, select');
                    settingInputs.forEach(function(input) {
                        input.addEventListener('input', updateSettingsFromInputs);
                        input.addEventListener('change', updateSettingsFromInputs);
                    });
                    
                    resetSettingsBtn.onclick = function() {
                        // Reset all settings to defaults
                        Object.assign(settings, defaultSettings);
                        
                        // Update input fields
                        document.getElementById('lineWidth').value = defaultSettings.lineWidth;
                        document.getElementById('pointSize').value = defaultSettings.pointSize;
                        document.getElementById('binCount').value = defaultSettings.binCount;
                        document.getElementById('histYMode').value = defaultSettings.histYMode;
                        document.getElementById('fontSize').value = defaultSettings.fontSize;
                        document.getElementById('customTitle').value = '';
                        // Reset core labels
                        settings.variableLabel = '';
                        settings.indexLabel = '';
                        settings.histYLabel = '';
                        document.getElementById('xLabel').value = '';
                        document.getElementById('yLabel').value = '';
                        document.getElementById('xMin').value = '';
                        document.getElementById('xMax').value = '';
                        document.getElementById('yMin').value = '';
                        document.getElementById('yMax').value = '';
                        document.getElementById('canvasWidth').value = '';
                        document.getElementById('canvasHeight').value = '';
                        
                        // Reset container size
                        container.style.width = '';
                        container.style.height = '';
                        container.style.flexGrow = '1';
                        
                        updateDataBounds();
                        draw();
                    };
                    
                    // Close settings panel when clicking outside
                    document.addEventListener('click', function(e) {
                        if (!settingsPanel.contains(e.target) && e.target !== btnSettings) {
                            settingsPanel.style.display = 'none';
                        }
                    });

                    // Initial draw with a small delay to ensure layout is ready
                    updateDataBounds();
                    setTimeout(function() {
                        draw();
                        pushHistory(); // 记录初始状态
                    }, 100);
                    vscode.postMessage({ command: 'requestOptions' });

                } catch (err) {
                    console.error('Plot script error:', err);
                }
            })();

            function getNonce() {
                let text = "";
                const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
                for (let i = 0; i < 32; i++) {
                    text += possible.charAt(Math.floor(Math.random() * possible.length));
                }
                return text;
            }
        </script>
    </body>
    </html>
  `;
}

function getNonce() {
  let text = "";
  const possible =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
