import * as vscode from "vscode";

export function getWebviewContentForMat(
  webview: vscode.Webview,
  rows: number,
  cols: number,
  channels: number,
  depth: number,
  data: { base64: string }
): string {
  const imageBase64 = JSON.stringify(data?.base64 || "");
  const nonce = getNonce();

  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
        <title>Matrix Image Viewer</title>
        <style nonce="${nonce}">
            body { margin: 0; overflow: hidden; font-family: Arial, sans-serif; background-color: #333; }
            #controls { 
                position: absolute; 
                top: 10px; 
                left: 10px; 
                background: rgba(255,255,255,0.9); 
                color: #111;
                padding: 10px; 
                border-radius: 5px;
                box-shadow: 0 2px 5px rgba(0,0,0,0.2);
                cursor: move;
                user-select: none;
                z-index: 1000;
            }
            #controls:hover { background: rgba(255,255,255,1); }
            #pixelInfo { 
                position: absolute; 
                bottom: 10px; 
                left: 10px; 
                background: rgba(255,255,255,0.9); 
                color: black; 
                padding: 10px; 
                border-radius: 5px;
                box-shadow: 0 2px 5px rgba(0,0,0,0.2);
                z-index: 1000;
            }
            button { 
                margin-right: 5px; 
                padding: 5px 10px; 
                cursor: pointer;
                border: 1px solid #ccc;
                border-radius: 3px;
                background: white;
                color: #111;
            }
            button:hover { background: #f0f0f0; }
            button.active { background: #e7f1ff; border-color: #7db5ff; }
            #controls {
                display: flex;
                gap: 8px;
                align-items: center;
                flex-wrap: wrap;
            }
            #controls.collapsed .ctrl-group,
            #controls.collapsed .dd {
                display: none;
            }
            #controls.collapsed {
                padding: 6px 10px;
            }
            .toggle-btn {
                background: transparent;
                border: none;
                color: #555;
                font-size: 14px;
                cursor: pointer;
                padding: 2px 6px;
                margin-right: 4px;
            }
            .toggle-btn:hover {
                color: #111;
            }
            #controls label { color: #111; font-weight: 400; font-size: 12px; }
            .ctrl-group {
                display: inline-flex;
                align-items: center;
                gap: 6px;
            }
            /* Custom dropdown (avoid native <select> rendering glitches in WebView) */
            .dd {
                position: relative;
                display: inline-flex;
                align-items: center;
                gap: 6px;
            }
            .dd-btn {
                height: 24px;
                padding: 1px 8px;
                border: 1px solid #777;
                border-radius: 3px;
                background: #fff;
                color: #111;
                cursor: pointer;
                font-size: 12px;
                line-height: 20px;
                white-space: nowrap;
                box-sizing: border-box;
            }
            .dd-btn:focus {
                outline: 2px solid rgba(74, 158, 255, 0.6);
                outline-offset: 1px;
            }
            .dd-menu {
                position: absolute;
                top: calc(100% + 4px);
                left: 0;
                max-width: 320px;
                background: #fff;
                border: 1px solid #777;
                border-radius: 6px;
                box-shadow: 0 8px 24px rgba(0,0,0,0.18);
                padding: 4px;
                z-index: 2000;
                display: none;
                box-sizing: border-box;
            }
            .dd.open .dd-menu { display: block; }
            .dd-item {
                width: 100%;
                text-align: left;
                border: 0;
                background: transparent;
                color: #111;
                padding: 6px 8px;
                border-radius: 4px;
                cursor: pointer;
                font-size: 12px;
                line-height: 16px;
            }
            .dd-item:hover { background: rgba(74, 158, 255, 0.12); }
            .dd-item[aria-checked="true"] { background: rgba(74, 158, 255, 0.18); }
            #zoomGroup {
                margin-left: auto; /* keep zoom on the far right */
            }
            #zoomLevel {
                display: inline-block;
                min-width: 10ch; /* 5 digits + '%' + 4 spaces (monospace, stable width) */
                text-align: right;
                white-space: pre; /* preserve padding spaces */
                font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
            }
            #container { position: relative; width: 100vw; height: 100vh; overflow: hidden; }
            canvas { position: absolute; top: 0; left: 0; }
            #grid-canvas { 
                position: absolute; 
                top: 0; 
                left: 0; 
                pointer-events: none;
                z-index: 1;
            }
            #text-canvas {
                position: absolute;
                top: 0;
                left: 0;
                pointer-events: none;
                z-index: 2;
            }
            #loading {
                position: absolute;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                background: rgba(0,0,0,0.7);
                color: white;
                padding: 20px;
                border-radius: 10px;
                z-index: 2000;
            }
            .spinner {
                border: 4px solid rgba(255, 255, 255, 0.3);
                border-radius: 50%;
                border-top: 4px solid #4a9eff;
                width: 40px;
                height: 40px;
                animation: spin 1s linear infinite;
                margin-bottom: 10px;
            }
            .hidden {
                display: none !important;
            }
            @keyframes spin {
                0% { transform: rotate(0deg); }
                100% { transform: rotate(360deg); }
            }
            /* Jet Colorbar Panel */
            #jetColorbar {
                position: absolute;
                bottom: 60px;
                right: 10px;
                background: rgba(0, 0, 0, 0.85);
                color: white;
                padding: 12px;
                border-radius: 6px;
                box-shadow: 0 2px 10px rgba(0,0,0,0.4);
                z-index: 1000;
                display: none;
                width: 80px;
                user-select: none;
            }
            #jetColorbar.visible { display: block; }
            .colorbar-title {
                font-size: 11px;
                color: #aaa;
                text-align: center;
                margin-bottom: 8px;
            }
            .colorbar-container {
                display: flex;
                gap: 8px;
            }
            .colorbar-gradient {
                width: 20px;
                height: 150px;
                background: linear-gradient(to top, 
                    rgb(0, 0, 128) 0%,
                    rgb(0, 0, 255) 12.5%,
                    rgb(0, 255, 255) 37.5%,
                    rgb(0, 255, 0) 50%,
                    rgb(255, 255, 0) 62.5%,
                    rgb(255, 0, 0) 87.5%,
                    rgb(128, 0, 0) 100%
                );
                border: 1px solid #555;
                border-radius: 2px;
                position: relative;
            }
            .colorbar-slider-track {
                position: relative;
                width: 100%;
                height: 150px;
            }
            .colorbar-slider {
                position: absolute;
                left: -4px;
                width: 28px;
                height: 6px;
                background: #fff;
                border: 1px solid #333;
                border-radius: 2px;
                cursor: ns-resize;
                z-index: 10;
                box-shadow: 0 1px 3px rgba(0,0,0,0.4);
            }
            .colorbar-slider:hover {
                background: #4a9eff;
            }
            .colorbar-slider.dragging {
                background: #4a9eff;
            }
            .colorbar-labels {
                display: flex;
                flex-direction: column;
                justify-content: space-between;
                height: 150px;
                font-size: 10px;
                min-width: 40px;
            }
            .colorbar-label {
                text-align: right;
            }
            .colorbar-label input {
                width: 50px;
                background: #333;
                border: 1px solid #555;
                color: white;
                font-size: 10px;
                padding: 2px 4px;
                border-radius: 2px;
                text-align: right;
            }
            .colorbar-label input:focus {
                outline: none;
                border-color: #4a9eff;
            }
            .colorbar-reset {
                margin-top: 8px;
                width: 100%;
                padding: 4px;
                font-size: 10px;
                background: #444;
                border: 1px solid #555;
                color: #ccc;
                border-radius: 3px;
                cursor: pointer;
            }
            .colorbar-reset:hover {
                background: #555;
            }
        </style>
    </head>
    <body>
        <div id="loading">
            <div class="spinner"></div>
            <div id="loading-text">Loading Data...</div>
        </div>
        <div id="container">
            <canvas id="canvas"></canvas>
            <canvas id="grid-canvas"></canvas>
            <canvas id="text-canvas"></canvas>
        </div>
        <div id="controls">
            <button class="toggle-btn" id="toggleControls" title="Hide/Show Controls">▼</button>
            <span class="ctrl-group" id="zoomGroup">
                <button id="reload" title="强制从内存重新读取数据 (保持缩放)">🔄 Reload</button>
                <button id="zoomIn">Zoom In</button>
                <button id="zoomOut">Zoom Out</button>
                <button id="reset">Reset</button>
                <span id="zoomLevel">100%    </span>
            </span>

            <span class="ctrl-group" id="saveGroup">
                <span class="dd" id="ddSaveFormat">
                    <label>Save:</label>
                    <button class="dd-btn" id="btnSaveFormat" type="button">PNG</button>
                    <div class="dd-menu" role="menu" aria-label="Save format menu"></div>
                </span>
                <button id="saveImage">Save</button>
            </span>

            <span class="ctrl-group" id="pixelGroup">
                <button id="togglePixelText" title="放大到一定程度后，在视野内显示每个像素的灰度/RGB数值">Pixel Values</button>
            </span>

            <span class="ctrl-group" id="renderGroup">
                <span class="dd" id="ddRenderMode">
                    <label>Render:</label>
                    <button class="dd-btn" id="btnRenderMode" type="button">Byte [0, 255]</button>
                    <div class="dd-menu" role="menu" aria-label="Render mode menu"></div>
                </span>
                <span class="dd" id="ddValueFormat">
                    <label>Format:</label>
                    <button class="dd-btn" id="btnValueFormat" type="button">Fixed(3)</button>
                    <div class="dd-menu" role="menu" aria-label="Value format menu"></div>
                </span>
            </span>
        </div>
        <div id="pixelInfo"></div>
        <div id="jetColorbar">
            <div class="colorbar-title">Jet Range</div>
            <div class="colorbar-container">
                <div class="colorbar-gradient">
                    <div class="colorbar-slider-track">
                        <div class="colorbar-slider" id="sliderMax" style="top: 0px;"></div>
                        <div class="colorbar-slider" id="sliderMin" style="bottom: 0px; top: auto;"></div>
                    </div>
                </div>
                <div class="colorbar-labels">
                    <div class="colorbar-label"><input type="text" id="jetMaxInput" value="1.0"></div>
                    <div class="colorbar-label"><input type="text" id="jetMinInput" value="0.0"></div>
                </div>
            </div>
            <button class="colorbar-reset" id="jetResetBtn">Reset Range</button>
        </div>
        <script nonce="${nonce}">
            (function() {
                const container = document.getElementById('container');
                const canvas = document.getElementById('canvas');
                const gridCanvas = document.getElementById('grid-canvas');
                const textCanvas = document.getElementById('text-canvas');
                const ctx = canvas.getContext('2d');
                const gridCtx = gridCanvas.getContext('2d');
                const textCtx = textCanvas.getContext('2d');
                const pixelInfo = document.getElementById('pixelInfo');
                const zoomLevelDisplay = document.getElementById('zoomLevel');
                const controls = document.getElementById('controls');
                const togglePixelTextBtn = document.getElementById('togglePixelText');
                const saveImageBtn = document.getElementById('saveImage');
                const btnSaveFormat = document.getElementById('btnSaveFormat');
                const btnRenderMode = document.getElementById('btnRenderMode');
                const btnValueFormat = document.getElementById('btnValueFormat');
                const ddSaveFormat = document.getElementById('ddSaveFormat');
                const ddRenderMode = document.getElementById('ddRenderMode');
                const ddValueFormat = document.getElementById('ddValueFormat');
                const loadingOverlay = document.getElementById('loading');
                const loadingText = document.getElementById('loading-text');
                
                // Listen for complete data from extension
                const vscode = acquireVsCodeApi();
                let rows = ${rows};
                let cols = ${cols};
                let channels = ${channels};
                let depth = ${depth};

                window.addEventListener('message', event => {
                    const message = event.data;
                    if (message.command === 'completeData') {
                        if (message.rows !== undefined) rows = message.rows;
                        if (message.cols !== undefined) cols = message.cols;
                        if (message.channels !== undefined) channels = message.channels;
                        if (message.depth !== undefined) depth = message.depth;

                        const rawBytes = message.data; // This is a Uint8Array
                        console.log('Received binary data: ' + rawBytes.length + ' bytes');
                        
                        loadingText.innerText = 'Initializing viewer...';
                        
                        // Use setTimeout to allow UI to update
                        setTimeout(() => {
                            try {
                                initializeImageViewer(rawBytes);
                                loadingOverlay.classList.add('hidden');
                            } catch (e) {
                                console.error('Initialization failed:', e);
                                loadingText.innerText = 'Initialization failed: ' + e.message;
                            }
                        }, 10);
                    } else if (message.command === 'setView') {
                        const state = message.state;
                        if (!isInitialized) {
                            pendingSyncState = state;
                            return;
                        }
                        applyViewState(state);
                    }
                });

                function applyViewState(state) {
                    if (state.scale !== undefined) scale = state.scale;
                    if (state.offsetX !== undefined) offsetX = state.offsetX;
                    if (state.offsetY !== undefined) offsetY = state.offsetY;
                    requestRender();
                }

                function emitViewChange() {
                    if (!isInitialized) return;
                    vscode.postMessage({
                        command: 'viewChanged',
                        state: { scale, offsetX, offsetY }
                    });
                }

                function bytesToTypedArray(bytes, depth) {
                    const buf = bytes.buffer;
                    const offset = bytes.byteOffset;
                    const length = bytes.byteLength;
                    switch (depth) {
                        case 0: return new Uint8Array(buf, offset, length);    // CV_8U
                        case 1: return new Int8Array(buf, offset, length);     // CV_8S
                        case 2: return new Uint16Array(buf, offset, length / 2);   // CV_16U
                        case 3: return new Int16Array(buf, offset, length / 2);    // CV_16S
                        case 4: return new Int32Array(buf, offset, length / 4);    // CV_32S
                        case 5: return new Float32Array(buf, offset, length / 4);  // CV_32F
                        case 6: return new Float64Array(buf, offset, length / 8);  // CV_64F
                        default: return new Uint8Array(buf, offset, length);
                    }
                }

                let rawData = null;
                let isInitialized = false;
                let pendingSyncState = null;
                let saveFormat = 'png';
                let renderMode = 'byte';
                let valueFormat = 'fixed3';
                let uiScaleMode = 'auto';
                let uiScale = 1;
                let cachedMinMax = null; // {min:number, max:number}
                
                // Jet colorbar custom limits
                let jetCustomMin = null; // null = use auto
                let jetCustomMax = null; // null = use auto
                let jetDebounceTimer = null;
                const JET_DEBOUNCE_MS = 300;
                
                let scale = 1;
                let isDragging = false;
                let startX = 0;
                let startY = 0;
                let offsetX = 0;
                let offsetY = 0;
                let viewW = 0;
                let viewH = 0;
                let lastMouseX = 0;
                let lastMouseY = 0;
                let hasLastMouse = false;

                // Pixel-value overlay (performance-sensitive)
                const PIXEL_TEXT_MIN_SCALE = 16; // 像素块 >= 16px 时开始考虑显示像素值
                const MAX_PIXEL_TEXT_LABELS = 15000; // 视野内超过这个像素数就不画文字（防止卡顿）
                let pixelTextEnabled = true; // 可手动关掉
                let renderQueued = false;

                // Make controls draggable
                let controlsDragging = false;
                let controlsStartX = 0;
                let controlsStartY = 0;

                controls.addEventListener('mousedown', (e) => {
                    if (e.target === controls) {
                        controlsDragging = true;
                        controlsStartX = e.clientX - controls.offsetLeft;
                        controlsStartY = e.clientY - controls.offsetTop;
                        e.preventDefault();
                    }
                });

                document.addEventListener('mousemove', (e) => {
                    if (controlsDragging) {
                        controls.style.left = (e.clientX - controlsStartX) + 'px';
                        controls.style.top = (e.clientY - controlsStartY) + 'px';
                    }
                });

                document.addEventListener('mouseup', () => {
                    controlsDragging = false;
                });

                // Toggle controls visibility
                const toggleControlsBtn = document.getElementById('toggleControls');
                toggleControlsBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const isCollapsed = controls.classList.toggle('collapsed');
                    toggleControlsBtn.textContent = isCollapsed ? '▶' : '▼';
                });

                // Create off-screen canvas for the original image
                const offscreenCanvas = document.createElement('canvas');
                offscreenCanvas.width = cols;
                offscreenCanvas.height = rows;
                const offscreenCtx = offscreenCanvas.getContext('2d');
                const imgData = offscreenCtx.createImageData(cols, rows);

                function initializeImageViewer(rawBytes) {
                    rawData = bytesToTypedArray(rawBytes, depth);
                    updateOffscreenFromRaw();
                    
                    if (pendingSyncState) {
                        applyViewState(pendingSyncState);
                        pendingSyncState = null;
                    } else if (!isInitialized) {
                        resetView();
                    }
                    
                    isInitialized = true;
                    requestRender();
                    updateJetColorbarVisibility();
                }

                function clampByte(v) {
                    if (v < 0) return 0;
                    if (v > 255) return 255;
                    return v | 0;
                }

                function getMinMax() {
                    if (cachedMinMax) return cachedMinMax;
                    let min = Infinity;
                    let max = -Infinity;
                    const len = rawData.length;
                    for (let i = 0; i < len; i++) {
                        const v = rawData[i];
                        if (v < min) min = v;
                        if (v > max) max = v;
                    }
                    if (min === Infinity || max === -Infinity) {
                        min = 0; max = 1;
                    }
                    cachedMinMax = { min, max };
                    return cachedMinMax;
                }

                function mapToByte(v) {
                    if (renderMode === 'norm01') {
                        return clampByte(v * 255);
                    }
                    if (renderMode === 'minmax' || renderMode === 'jet') {
                        const mm = getMinMax();
                        const denom = (mm.max - mm.min) || 1;
                        return clampByte(((v - mm.min) / denom) * 255);
                    }
                    if (renderMode === 'clamp255') {
                        return clampByte(v);
                    }
                    // 'byte' default
                    return clampByte(v);
                }

                // Jet colormap: maps a normalized value (0-1) to RGB
                // Blue -> Cyan -> Green -> Yellow -> Red
                function jetColormap(t) {
                    // t is in [0, 1]
                    let r, g, b;
                    if (t < 0.125) {
                        r = 0;
                        g = 0;
                        b = 0.5 + t * 4; // 0.5 -> 1.0
                    } else if (t < 0.375) {
                        r = 0;
                        g = (t - 0.125) * 4; // 0 -> 1
                        b = 1;
                    } else if (t < 0.625) {
                        r = (t - 0.375) * 4; // 0 -> 1
                        g = 1;
                        b = 1 - (t - 0.375) * 4; // 1 -> 0
                    } else if (t < 0.875) {
                        r = 1;
                        g = 1 - (t - 0.625) * 4; // 1 -> 0
                        b = 0;
                    } else {
                        r = 1 - (t - 0.875) * 4; // 1 -> 0.5
                        g = 0;
                        b = 0;
                    }
                    return {
                        r: clampByte(r * 255),
                        g: clampByte(g * 255),
                        b: clampByte(b * 255)
                    };
                }

                function updateOffscreenFromRaw() {
                    if (!rawData) return;
                    // Fill image data based on selected render mode
                    cachedMinMax = null;
                    if (renderMode === 'minmax' || renderMode === 'jet') getMinMax();

                    const data = imgData.data;
                    const len = rows * cols;
                    
                    if (renderMode === 'jet') {
                        // Jet colormap mode: convert to grayscale first, then apply colormap
                        const mm = getMinMax();
                        // Use custom limits if set, otherwise use auto
                        const effectiveMin = (jetCustomMin !== null) ? jetCustomMin : mm.min;
                        const effectiveMax = (jetCustomMax !== null) ? jetCustomMax : mm.max;
                        const denom = (effectiveMax - effectiveMin) || 1;
                        
                        for (let i = 0; i < len; i++) {
                            const outIdx = i << 2;
                            let grayValue;
                            
                            if (channels === 1) {
                                grayValue = rawData[i];
                            } else {
                                // For multi-channel, compute average (grayscale)
                                const inIdx = i * channels;
                                let sum = 0;
                                for (let c = 0; c < channels; c++) {
                                    sum += rawData[inIdx + c];
                                }
                                grayValue = sum / channels;
                            }
                            
                            // Normalize to [0, 1]
                            const t = (grayValue - effectiveMin) / denom;
                            const color = jetColormap(Math.max(0, Math.min(1, t)));
                            
                            data[outIdx] = color.r;
                            data[outIdx + 1] = color.g;
                            data[outIdx + 2] = color.b;
                            data[outIdx + 3] = 255;
                        }
                    } else if (depth === 0 && renderMode === 'byte') {
                        // Fast path for CV_8U + byte mode
                        if (channels === 1) {
                            for (let i = 0; i < len; i++) {
                                const val = rawData[i];
                                const outIdx = i << 2;
                                data[outIdx] = data[outIdx + 1] = data[outIdx + 2] = val;
                                data[outIdx + 3] = 255;
                            }
                        } else if (channels === 3) {
                            for (let i = 0; i < len; i++) {
                                const inIdx = i * 3;
                                const outIdx = i << 2;
                                data[outIdx] = rawData[inIdx];
                                data[outIdx + 1] = rawData[inIdx + 1];
                                data[outIdx + 2] = rawData[inIdx + 2];
                                data[outIdx + 3] = 255;
                            }
                        } else if (channels === 4) {
                            // RGBA: use alpha channel from source data
                            for (let i = 0; i < len; i++) {
                                const inIdx = i * 4;
                                const outIdx = i << 2;
                                data[outIdx] = rawData[inIdx];
                                data[outIdx + 1] = rawData[inIdx + 1];
                                data[outIdx + 2] = rawData[inIdx + 2];
                                data[outIdx + 3] = rawData[inIdx + 3];
                            }
                        }
                    } else {
                        // General path
                        for (let i = 0; i < len; i++) {
                            const outIdx = i << 2;
                            if (channels === 1) {
                                const value = mapToByte(rawData[i]);
                                data[outIdx] = data[outIdx + 1] = data[outIdx + 2] = value;
                                data[outIdx + 3] = 255;
                            } else if (channels === 4) {
                                // RGBA: map RGB channels, preserve alpha
                                const inIdx = i * 4;
                                data[outIdx] = mapToByte(rawData[inIdx]);
                                data[outIdx + 1] = mapToByte(rawData[inIdx + 1]);
                                data[outIdx + 2] = mapToByte(rawData[inIdx + 2]);
                                data[outIdx + 3] = clampByte(rawData[inIdx + 3]); // preserve alpha
                            } else {
                                // 3 channels or other
                                const inIdx = i * channels;
                                data[outIdx] = mapToByte(rawData[inIdx]);
                                data[outIdx + 1] = mapToByte(rawData[inIdx + 1]);
                                data[outIdx + 2] = mapToByte(rawData[inIdx + 2]);
                                data[outIdx + 3] = 255;
                            }
                        }
                    }
                    offscreenCtx.putImageData(imgData, 0, 0);
                }
                
                // Put the image data on the offscreen canvas
                function closeAllDropdowns() {
                    ddSaveFormat.classList.remove('open');
                    ddRenderMode.classList.remove('open');
                    ddValueFormat.classList.remove('open');
                }

                // Measure text width once (used to make dropdown buttons/menus stable-width)
                const __measureSpan = document.createElement('span');
                __measureSpan.style.position = 'fixed';
                __measureSpan.style.left = '-99999px';
                __measureSpan.style.top = '-99999px';
                __measureSpan.style.visibility = 'hidden';
                __measureSpan.style.whiteSpace = 'nowrap';
                __measureSpan.style.fontSize = '12px';
                __measureSpan.style.fontFamily = 'Arial, sans-serif';
                document.body.appendChild(__measureSpan);

                function measureTextPx(text, fontCss) {
                    __measureSpan.style.font = fontCss;
                    __measureSpan.textContent = text;
                    return __measureSpan.getBoundingClientRect().width;
                }

                document.addEventListener('click', (e) => {
                    // Close dropdowns when clicking anywhere outside the currently open dropdown(s)
                    // (including other toolbar areas, canvas, empty space, etc.)
                    const openDd = document.querySelector('.dd.open');
                    if (!openDd) return;
                    const inOpenDd = e.target.closest && e.target.closest('.dd.open');
                    if (!inOpenDd) closeAllDropdowns();
                });

                document.addEventListener('keydown', (e) => {
                    if (e.key === 'Escape') closeAllDropdowns();
                });

                function initDropdown(ddEl, btnEl, options, getValue, setValue) {
                    const menu = ddEl.querySelector('.dd-menu');
                    const fontCss = '12px Arial, sans-serif';

                    function updateStableWidth() {
                        // Button width = longest option label + padding + small caret space
                        let maxW = 0;
                        for (const opt of options) {
                            const w = measureTextPx(opt.label, fontCss);
                            if (w > maxW) maxW = w;
                        }
                        // 8px left + 8px right padding + ~18px extra
                        const target = Math.ceil(maxW + 34);
                        btnEl.style.width = target + 'px';
                        // Menu width follows the *actual* rendered button width (including borders)
                        const btnW = Math.ceil(btnEl.getBoundingClientRect().width);
                        menu.style.width = btnW + 'px';
                        menu.style.minWidth = btnW + 'px';
                        // Align menu under the button (dd contains a label + button)
                        menu.style.left = btnEl.offsetLeft + 'px';
                    }

                    function renderMenu() {
                        const cur = getValue();
                        menu.innerHTML = '';
                        for (const opt of options) {
                            const item = document.createElement('button');
                            item.type = 'button';
                            item.className = 'dd-item';
                            item.textContent = opt.label;
                            item.setAttribute('role', 'menuitemradio');
                            item.setAttribute('aria-checked', String(opt.value === cur));
                            item.addEventListener('click', () => {
                                setValue(opt.value);
                                btnEl.textContent = opt.label;
                                ddEl.classList.remove('open');
                            });
                            menu.appendChild(item);
                        }
                    }

                    btnEl.addEventListener('click', () => {
                        const isOpen = ddEl.classList.contains('open');
                        closeAllDropdowns();
                        if (!isOpen) {
                            renderMenu();
                            updateStableWidth();
                            ddEl.classList.add('open');
                        }
                    });

                    // Initialize width once up-front
                    updateStableWidth();
                }

                // Init dropdowns
                initDropdown(
                    ddSaveFormat,
                    btnSaveFormat,
                    [
                        { value: 'png', label: 'PNG' },
                        { value: 'tiff', label: 'TIFF' },
                    ],
                    () => saveFormat,
                    (v) => { saveFormat = v; }
                );
                initDropdown(
                    ddRenderMode,
                    btnRenderMode,
                    [
                        { value: 'byte', label: 'Byte [0, 255]' },
                        { value: 'norm01', label: 'Float * 255 → Byte' },
                        { value: 'minmax', label: '[min, max] → [0, 255]' },
                        { value: 'clamp255', label: 'Clamp → [0, 255]' },
                        { value: 'jet', label: 'Jet Colormap' },
                    ],
                    () => renderMode,
                    (v) => { renderMode = v; updateOffscreenFromRaw(); requestRender(); updateJetColorbarVisibility(); }
                );
                initDropdown(
                    ddValueFormat,
                    btnValueFormat,
                    [
                        { value: 'fixed3', label: 'Fixed(3)' },
                        { value: 'fixed6', label: 'Fixed(6)' },
                        { value: 'sci2', label: 'Sci(2)' },
                        { value: 'sci4', label: 'Sci(4)' },
                    ],
                    () => valueFormat,
                    (v) => { valueFormat = v; requestRender(); }
                );

                // Jet Colorbar logic
                const jetColorbar = document.getElementById('jetColorbar');
                const sliderMax = document.getElementById('sliderMax');
                const sliderMin = document.getElementById('sliderMin');
                const jetMaxInput = document.getElementById('jetMaxInput');
                const jetMinInput = document.getElementById('jetMinInput');
                const jetResetBtn = document.getElementById('jetResetBtn');
                const SLIDER_TRACK_HEIGHT = 150;
                
                function updateJetColorbarVisibility() {
                    if (renderMode === 'jet' && isInitialized) {
                        jetColorbar.classList.add('visible');
                        updateJetColorbarValues();
                    } else {
                        jetColorbar.classList.remove('visible');
                    }
                }
                
                function updateJetColorbarValues() {
                    const mm = getMinMax();
                    const minVal = (jetCustomMin !== null) ? jetCustomMin : mm.min;
                    const maxVal = (jetCustomMax !== null) ? jetCustomMax : mm.max;
                    
                    jetMinInput.value = minVal.toPrecision(4);
                    jetMaxInput.value = maxVal.toPrecision(4);
                    
                    // Update slider positions based on values relative to auto range
                    const range = mm.max - mm.min || 1;
                    const maxPos = Math.max(0, Math.min(1, (mm.max - maxVal) / range));
                    const minPos = Math.max(0, Math.min(1, (minVal - mm.min) / range));
                    
                    sliderMax.style.top = (maxPos * (SLIDER_TRACK_HEIGHT - 6)) + 'px';
                    sliderMin.style.top = 'auto';
                    sliderMin.style.bottom = (minPos * (SLIDER_TRACK_HEIGHT - 6)) + 'px';
                }
                
                function applyJetLimitsDebounced() {
                    if (jetDebounceTimer) clearTimeout(jetDebounceTimer);
                    jetDebounceTimer = setTimeout(() => {
                        updateOffscreenFromRaw();
                        requestRender();
                    }, JET_DEBOUNCE_MS);
                }
                
                // Slider dragging
                let draggingSlider = null;
                let sliderStartY = 0;
                let sliderStartTop = 0;
                
                function onSliderMouseDown(e, slider, isMax) {
                    e.preventDefault();
                    draggingSlider = { slider, isMax };
                    slider.classList.add('dragging');
                    sliderStartY = e.clientY;
                    const rect = slider.getBoundingClientRect();
                    const trackRect = slider.parentElement.getBoundingClientRect();
                    sliderStartTop = rect.top - trackRect.top;
                }
                
                sliderMax.addEventListener('mousedown', (e) => onSliderMouseDown(e, sliderMax, true));
                sliderMin.addEventListener('mousedown', (e) => onSliderMouseDown(e, sliderMin, false));
                
                document.addEventListener('mousemove', (e) => {
                    if (!draggingSlider) return;
                    
                    const { slider, isMax } = draggingSlider;
                    const deltaY = e.clientY - sliderStartY;
                    let newTop = sliderStartTop + deltaY;
                    
                    // Clamp to track bounds
                    newTop = Math.max(0, Math.min(SLIDER_TRACK_HEIGHT - 6, newTop));
                    
                    if (isMax) {
                        slider.style.top = newTop + 'px';
                    } else {
                        slider.style.top = 'auto';
                        slider.style.bottom = (SLIDER_TRACK_HEIGHT - 6 - newTop) + 'px';
                    }
                    
                    // Calculate value from position
                    const mm = getMinMax();
                    const range = mm.max - mm.min || 1;
                    const normalizedPos = newTop / (SLIDER_TRACK_HEIGHT - 6);
                    
                    if (isMax) {
                        // Max slider: top=0 means max value, top=full means min value
                        jetCustomMax = mm.max - normalizedPos * range;
                        jetMaxInput.value = jetCustomMax.toPrecision(4);
                    } else {
                        // Min slider: top=0 means max value, top=full means min value
                        jetCustomMin = mm.max - normalizedPos * range;
                        jetMinInput.value = jetCustomMin.toPrecision(4);
                    }
                    
                    applyJetLimitsDebounced();
                });
                
                document.addEventListener('mouseup', () => {
                    if (draggingSlider) {
                        draggingSlider.slider.classList.remove('dragging');
                        draggingSlider = null;
                    }
                });
                
                // Input field change handlers
                jetMaxInput.addEventListener('change', () => {
                    const val = parseFloat(jetMaxInput.value);
                    if (!isNaN(val)) {
                        jetCustomMax = val;
                        updateJetColorbarValues();
                        applyJetLimitsDebounced();
                    }
                });
                
                jetMinInput.addEventListener('change', () => {
                    const val = parseFloat(jetMinInput.value);
                    if (!isNaN(val)) {
                        jetCustomMin = val;
                        updateJetColorbarValues();
                        applyJetLimitsDebounced();
                    }
                });
                
                // Reset button
                jetResetBtn.addEventListener('click', () => {
                    jetCustomMin = null;
                    jetCustomMax = null;
                    updateJetColorbarValues();
                    updateOffscreenFromRaw();
                    requestRender();
                });

                // Defaults
                btnSaveFormat.textContent = 'PNG';
                btnValueFormat.textContent = 'Fixed(3)';

                // Auto pick a better default for float/double
                if (depth === 5 || depth === 6) {
                    renderMode = 'norm01';
                    btnRenderMode.textContent = 'Float * 255 → Byte';
                    valueFormat = 'sci2'; // Scientific notation by default for floats
                    btnValueFormat.textContent = 'Sci(2)';
                    ddValueFormat.style.display = 'inline-flex';
                } else {
                    btnRenderMode.textContent = 'Byte [0, 255]';
                    ddValueFormat.style.display = 'none';
                }

                function clamp(v, lo, hi) {
                    return Math.max(lo, Math.min(hi, v));
                }

                function computeAutoUiScale() {
                    const dpr = window.devicePixelRatio || 1;
                    // In auto mode, we use 100% scale (1.0) as the base for 1x DPI.
                    const baseScale = dpr;
                    // For scientific notation or high precision, we need even more space.
                    const formatFactor = (valueFormat === 'sci2' || valueFormat === 'sci4' || valueFormat === 'fixed6') ? 1.2 : 1.0;
                    return clamp(baseScale * formatFactor, 1, 4);
                }

                function updateUiScale() {
                    uiScale = computeAutoUiScale();
                }

                updateUiScale();

                function formatFloat(v) {
                    if (!isFinite(v)) return ' NaN ';
                    let s = '';
                    if (valueFormat === 'fixed3') s = v.toFixed(3);
                    else if (valueFormat === 'fixed6') s = v.toFixed(6);
                    else if (valueFormat === 'sci2') s = v.toExponential(2);
                    else if (valueFormat === 'sci4') s = v.toExponential(4);
                    else s = v.toFixed(3);
                    // Reserve a space for the sign if positive, to align with negative numbers
                    return (v >= 0 ? ' ' : '') + s;
                }

                function formatValue(v) {
                    // Float/double: show raw values nicely; ints remain integer
                    if (depth === 5 || depth === 6) return formatFloat(v);
                    // For integer-like, keep 3-char alignment with spaces as requested
                    return String(v | 0).padStart(3, ' ');
                }

                function updateCanvasSize() {
                    const containerRect = container.getBoundingClientRect();
                    const dpr = window.devicePixelRatio || 1;
                    viewW = containerRect.width;
                    viewH = containerRect.height;

                    // Ensure crisp rendering on HiDPI screens by decoupling CSS size and backing store size
                    canvas.style.width = viewW + 'px';
                    canvas.style.height = viewH + 'px';
                    gridCanvas.style.width = viewW + 'px';
                    gridCanvas.style.height = viewH + 'px';
                    textCanvas.style.width = viewW + 'px';
                    textCanvas.style.height = viewH + 'px';

                    canvas.width = Math.max(1, Math.floor(viewW * dpr));
                    canvas.height = Math.max(1, Math.floor(viewH * dpr));
                    gridCanvas.width = Math.max(1, Math.floor(viewW * dpr));
                    gridCanvas.height = Math.max(1, Math.floor(viewH * dpr));
                    textCanvas.width = Math.max(1, Math.floor(viewW * dpr));
                    textCanvas.height = Math.max(1, Math.floor(viewH * dpr));

                    // Draw in CSS pixels; transform maps to device pixels
                    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
                    gridCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
                    textCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

                    // Keep overlays sharp
                    gridCtx.imageSmoothingEnabled = false;
                    textCtx.imageSmoothingEnabled = false;
                }

                function drawGrid() {
                    if (scale >= 10) {
                        gridCtx.clearRect(0, 0, viewW, viewH);
                        gridCtx.strokeStyle = 'rgba(128, 128, 128, 0.5)';
                        gridCtx.lineWidth = 1;
                        
                        // Draw vertical lines
                        for (let x = 0; x <= cols; x++) {
                            const pixelX = x * scale + offsetX;
                            gridCtx.beginPath();
                            gridCtx.moveTo(pixelX, offsetY);
                            gridCtx.lineTo(pixelX, rows * scale + offsetY);
                            gridCtx.stroke();
                        }
                        
                        // Draw horizontal lines
                        for (let y = 0; y <= rows; y++) {
                            const pixelY = y * scale + offsetY;
                            gridCtx.beginPath();
                            gridCtx.moveTo(offsetX, pixelY);
                            gridCtx.lineTo(cols * scale + offsetX, pixelY);
                            gridCtx.stroke();
                        }
                    } else {
                        gridCtx.clearRect(0, 0, viewW, viewH);
                    }
                }

                function drawPixelTextOverlay() {
                    textCtx.clearRect(0, 0, viewW, viewH);
                    if (!pixelTextEnabled) return;

                    // 1. Compute visible image rect
                    const left = Math.max(0, Math.floor((-offsetX) / scale));
                    const top = Math.max(0, Math.floor((-offsetY) / scale));
                    const right = Math.min(cols - 1, Math.ceil((viewW - offsetX) / scale) - 1);
                    const bottom = Math.min(rows - 1, Math.ceil((viewH - offsetY) / scale) - 1);
                    if (right < left || bottom < top) return;

                    // 2. Sampling: Find the ACTUAL maximum character length in the current view
                    let actualMaxChars = 1;
                    const step = Math.max(1, Math.floor((right - left) / 10)); // Sample ~10x10 grid
                    const channelsToSample = (channels >= 3) ? channels : 1;
                    for (let y = top; y <= bottom; y += step) {
                        for (let x = left; x <= right; x += step) {
                            const idx = (y * cols + x) * channels;
                            for (let c = 0; c < channelsToSample; c++) {
                                const val = rawData[idx + c];
                                let len = formatValue(val).length;
                                if (channels >= 3) len += 2; // "R:", "G:", "B:", "A:" prefix
                                if (len > actualMaxChars) actualMaxChars = len;
                            }
                        }
                    }

                    const numLines = (channels === 4) ? 4 : (channels === 3) ? 3 : 1;
                    const fillFactor = 0.90; // Use 90% of the cell
                    const usableCellW = scale * fillFactor;
                    const usableCellH = scale * fillFactor;

                    // Measure actual character width ratio for the monospace font
                    textCtx.font = "100px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";
                    const charWidthRatio = textCtx.measureText("0").width / 100;

                    // Calculate max font size that fits both width and height
                    const fontSizeW = usableCellW / (charWidthRatio * actualMaxChars);
                    const fontSizeH = usableCellH / (1.05 * numLines); // 1.05 for line spacing
                    
                    let fontSize = Math.floor(Math.min(fontSizeW, fontSizeH));
                    
                    // 3. Minimum 8px requirement
                    if (fontSize < 8) return;
                    
                     fontSize = Math.min(16, fontSize);

                    const fontFamily = 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';
                    const lineHeight = Math.floor(fontSize * 1.05);
                    
                    textCtx.font = fontSize + 'px ' + fontFamily;
                    textCtx.textAlign = 'center';
                    textCtx.textBaseline = 'middle';
                    textCtx.lineWidth = Math.max(1, Math.floor(fontSize / 6));
                    textCtx.strokeStyle = 'rgba(0, 0, 0, 0.8)';
                    textCtx.fillStyle = 'rgba(255, 255, 255, 0.95)';

                    // Since fontSize is derived from actualMaxChars, it is guaranteed to fit.
                    // We remove the secondary fit check that was causing rendering to be skipped.
                    const padGray = 1;
                    const padRgb = 1;

                    const visibleW = right - left + 1;
                    const visibleH = bottom - top + 1;
                    const visibleCount = visibleW * visibleH;
                    if (visibleCount > MAX_PIXEL_TEXT_LABELS) return;

                    for (let y = top; y <= bottom; y++) {
                        const screenY = y * scale + offsetY + scale / 2;
                        if (screenY < -scale || screenY > viewH + scale) continue;

                        for (let x = left; x <= right; x++) {
                            const screenX = x * scale + offsetX + scale / 2;
                            if (screenX < -scale || screenX > viewW + scale) continue;

                            const idx = (y * cols + x) * channels;
                            if (channels === 3) {
                                const r = rawData[idx];
                                const g = rawData[idx + 1];
                                const b = rawData[idx + 2];

                                const cellX = x * scale + offsetX;
                                const cellY = y * scale + offsetY;
                                const cellInnerW = scale - padRgb * 2;
                                const cellInnerH = scale - padRgb * 2;
                                const l1 = 'R:' + formatValue(r);
                                const l2 = 'G:' + formatValue(g);
                                const l3 = 'B:' + formatValue(b);
                                const lines = [l1, l2, l3];

                                textCtx.save();
                                textCtx.beginPath();
                                textCtx.rect(cellX + padRgb, cellY + padRgb, cellInnerW, cellInnerH);
                                textCtx.clip();

                                const totalH = lines.length * lineHeight;
                                const topY = (cellY + padRgb) + (cellInnerH - totalH) / 2 + lineHeight / 2;
                                textCtx.strokeText(l1, screenX, topY);
                                textCtx.fillText(l1, screenX, topY);
                                textCtx.strokeText(l2, screenX, topY + lineHeight);
                                textCtx.fillText(l2, screenX, topY + lineHeight);
                                textCtx.strokeText(l3, screenX, topY + lineHeight * 2);
                                textCtx.fillText(l3, screenX, topY + lineHeight * 2);
                                textCtx.restore();
                            } else if (channels === 4) {
                                const r = rawData[idx];
                                const g = rawData[idx + 1];
                                const b = rawData[idx + 2];
                                const a = rawData[idx + 3];

                                const cellX = x * scale + offsetX;
                                const cellY = y * scale + offsetY;
                                const cellInnerW = scale - padRgb * 2;
                                const cellInnerH = scale - padRgb * 2;
                                const l1 = 'R:' + formatValue(r);
                                const l2 = 'G:' + formatValue(g);
                                const l3 = 'B:' + formatValue(b);
                                const l4 = 'A:' + formatValue(a);

                                textCtx.save();
                                textCtx.beginPath();
                                textCtx.rect(cellX + padRgb, cellY + padRgb, cellInnerW, cellInnerH);
                                textCtx.clip();

                                const totalH = 4 * lineHeight;
                                const topY = (cellY + padRgb) + (cellInnerH - totalH) / 2 + lineHeight / 2;
                                textCtx.strokeText(l1, screenX, topY);
                                textCtx.fillText(l1, screenX, topY);
                                textCtx.strokeText(l2, screenX, topY + lineHeight);
                                textCtx.fillText(l2, screenX, topY + lineHeight);
                                textCtx.strokeText(l3, screenX, topY + lineHeight * 2);
                                textCtx.fillText(l3, screenX, topY + lineHeight * 2);
                                textCtx.strokeText(l4, screenX, topY + lineHeight * 3);
                                textCtx.fillText(l4, screenX, topY + lineHeight * 3);
                                textCtx.restore();
                            } else if (channels === 1) {
                                const label = formatValue(rawData[idx]);
                                const cellX = x * scale + offsetX;
                                const cellY = y * scale + offsetY;
                                const cellInnerW = scale - padGray * 2;
                                const cellInnerH = scale - padGray * 2;

                                textCtx.save();
                                textCtx.beginPath();
                                textCtx.rect(cellX + padGray, cellY + padGray, cellInnerW, cellInnerH);
                                textCtx.clip();
                                textCtx.strokeText(label, screenX, screenY);
                                textCtx.fillText(label, screenX, screenY);
                                textCtx.restore();
                            }
                        }
                    }
                }

                function draw() {
                    ctx.clearRect(0, 0, viewW, viewH);
                    
                    // Calculate scaled dimensions
                    const scaledWidth = cols * scale;
                    const scaledHeight = rows * scale;
                    
                    // Draw from top-left corner with offset
                    const x = offsetX;
                    const y = offsetY;
                    
                    ctx.imageSmoothingEnabled = false; // Disable smoothing
                    ctx.drawImage(offscreenCanvas, x, y, scaledWidth, scaledHeight);
                    
                    // Draw grid when zoomed in
                    drawGrid();
                    drawPixelTextOverlay();
                    
                    // Update zoom level display
                    // Fixed-width zoom display: min 1 digit, max 5 digits, padded to 5 with spaces + 4 trailing spaces
                    const pct = Math.max(0, Math.round(scale * 100));
                    const pctStr = String(pct).slice(0, 5).padStart(5, ' ');
                    zoomLevelDisplay.textContent = pctStr + '%    ';
                }

                function requestRender() {
                    if (renderQueued) return;
                    renderQueued = true;
                    requestAnimationFrame(() => {
                        renderQueued = false;
                        draw();
                    });
                }

                function requestRenderWithSync() {
                    requestRender();
                    emitViewChange();
                }

                function setZoom(newScale) {
                    scale = Math.max(0.05, Math.min(100, newScale)); // Increased max zoom to 100x
                    requestRenderWithSync();
                }

                // Zoom around a screen point (mouse cursor), keeping the image coord under cursor stable
                function setZoomAt(screenX, screenY, newScale) {
                    const prevScale = scale;
                    const nextScale = Math.max(0.05, Math.min(100, newScale));
                    if (nextScale === prevScale) return;

                    // Image coordinates under cursor before zoom
                    const imgX = (screenX - offsetX) / prevScale;
                    const imgY = (screenY - offsetY) / prevScale;

                    scale = nextScale;

                    // Adjust offsets so the same image coord stays under cursor
                    offsetX = screenX - imgX * nextScale;
                    offsetY = screenY - imgY * nextScale;

                    requestRenderWithSync();
                }

                function resetView() {
                    const MIN_DISPLAY_SIZE = 400; // 最小显示尺寸
                    const MAX_AUTO_SCALE = 100;    // 与 setZoom 的上限保持一致（100x = 10000%）
                    
                    // 确保 viewW/viewH 已初始化
                    if (viewW === 0 || viewH === 0) {
                        const containerRect = container.getBoundingClientRect();
                        viewW = containerRect.width;
                        viewH = containerRect.height;
                    }
                    
                    // 计算使图像至少达到 MIN_DISPLAY_SIZE 的缩放比例
                    const minDimension = Math.min(cols, rows);
                    const minScale = MIN_DISPLAY_SIZE / minDimension;
                    
                    // 如果图像本身就很大，使用 1.0；否则使用 minScale，并限制不超过最大缩放
                    scale = Math.max(1, Math.min(MAX_AUTO_SCALE, minScale));
                    
                    // 居中显示
                    offsetX = (viewW - cols * scale) / 2;
                    offsetY = (viewH - rows * scale) / 2;
                    
                    requestRenderWithSync();
                }

                // Event Listeners
                document.getElementById('zoomIn').addEventListener('click', () => {
                    const cx = hasLastMouse ? lastMouseX : viewW / 2;
                    const cy = hasLastMouse ? lastMouseY : viewH / 2;
                    setZoomAt(cx, cy, scale * 1.5); // Increased zoom factor
                });

                document.getElementById('zoomOut').addEventListener('click', () => {
                    const cx = hasLastMouse ? lastMouseX : viewW / 2;
                    const cy = hasLastMouse ? lastMouseY : viewH / 2;
                    setZoomAt(cx, cy, scale / 1.5);
                });

                document.getElementById('reset').addEventListener('click', () => {
                    resetView();
                });

                document.getElementById('reload').addEventListener('click', () => {
                    vscode.postMessage({ command: 'reload' });
                });

                // Toggle pixel text overlay
                togglePixelTextBtn.addEventListener('click', () => {
                    pixelTextEnabled = !pixelTextEnabled;
                    togglePixelTextBtn.classList.toggle('active', pixelTextEnabled);
                    requestRender();
                });
                togglePixelTextBtn.classList.toggle('active', pixelTextEnabled);

                // Save (PNG/TIFF)
                saveImageBtn.addEventListener('click', () => {
                    const fmt = saveFormat;
                    if (fmt === 'png') {
                        const link = document.createElement('a');
                        link.download = 'image.png';
                        link.href = offscreenCanvas.toDataURL('image/png');
                        link.click();
                        return;
                    }

                    // TIFF (with raw data for float support)
                    const tiffData = createTiff(cols, rows, channels, rawData, depth);
                    const blob = new Blob([tiffData], { type: 'image/tiff' });
                    const link = document.createElement('a');
                    link.download = 'image.tiff';
                    link.href = URL.createObjectURL(blob);
                    link.click();
                    URL.revokeObjectURL(link.href);
                });

                // Simple TIFF encoder
                function createTiff(width, height, channels, data, depth) {
                    // Determine bits per sample and sample format based on depth
                    let bitsPerSample, sampleFormat, bytesPerSample;
                    if (depth === 5) { // CV_32F
                        bitsPerSample = 32;
                        sampleFormat = 3; // IEEE float
                        bytesPerSample = 4;
                    } else if (depth === 6) { // CV_64F
                        bitsPerSample = 64;
                        sampleFormat = 3; // IEEE float
                        bytesPerSample = 8;
                    } else {
                        bitsPerSample = 8;
                        sampleFormat = 1; // unsigned int
                        bytesPerSample = 1;
                    }

                    const samplesPerPixel = channels === 1 ? 1 : 3;
                    const photometric = channels === 1 ? 1 : 2; // 1=grayscale, 2=RGB
                    const rowsPerStrip = height;
                    const stripByteCount = width * height * samplesPerPixel * bytesPerSample;

                    // IFD entries
                    const numEntries = 12;
                    const headerSize = 8;
                    const ifdOffset = headerSize;
                    const ifdSize = 2 + numEntries * 12 + 4;
                    const dataOffset = ifdOffset + ifdSize + 20; // extra space for arrays
                    const stripOffset = dataOffset;

                    const totalSize = stripOffset + stripByteCount;
                    const buffer = new ArrayBuffer(totalSize);
                    const view = new DataView(buffer);
                    const bytes = new Uint8Array(buffer);

                    let offset = 0;

                    // TIFF header (little endian)
                    view.setUint16(offset, 0x4949, true); offset += 2; // II = little endian
                    view.setUint16(offset, 42, true); offset += 2; // TIFF magic
                    view.setUint32(offset, ifdOffset, true); offset += 4; // IFD offset

                    // IFD
                    view.setUint16(offset, numEntries, true); offset += 2;

                    // Helper to write IFD entry
                    function writeEntry(tag, type, count, value) {
                        view.setUint16(offset, tag, true); offset += 2;
                        view.setUint16(offset, type, true); offset += 2;
                        view.setUint32(offset, count, true); offset += 4;
                        if (type === 3 && count === 1) { // SHORT
                            view.setUint16(offset, value, true); offset += 2;
                            view.setUint16(offset, 0, true); offset += 2;
                        } else if (type === 4 && count === 1) { // LONG
                            view.setUint32(offset, value, true); offset += 4;
                        } else {
                            view.setUint32(offset, value, true); offset += 4;
                        }
                    }

                    // IFD entries
                    writeEntry(256, 3, 1, width);  // ImageWidth
                    writeEntry(257, 3, 1, height); // ImageLength
                    writeEntry(258, 3, samplesPerPixel, samplesPerPixel === 1 ? bitsPerSample : ifdOffset + ifdSize); // BitsPerSample
                    writeEntry(259, 3, 1, 1); // Compression = none
                    writeEntry(262, 3, 1, photometric); // PhotometricInterpretation
                    writeEntry(273, 4, 1, stripOffset); // StripOffsets
                    writeEntry(277, 3, 1, samplesPerPixel); // SamplesPerPixel
                    writeEntry(278, 4, 1, rowsPerStrip); // RowsPerStrip
                    writeEntry(279, 4, 1, stripByteCount); // StripByteCounts
                    writeEntry(282, 5, 1, ifdOffset + ifdSize + 8); // XResolution
                    writeEntry(283, 5, 1, ifdOffset + ifdSize + 16); // YResolution
                    writeEntry(339, 3, 1, sampleFormat); // SampleFormat

                    view.setUint32(offset, 0, true); offset += 4; // Next IFD offset

                    // Extra data for BitsPerSample (if RGB)
                    if (samplesPerPixel === 3) {
                        view.setUint16(ifdOffset + ifdSize, bitsPerSample, true);
                        view.setUint16(ifdOffset + ifdSize + 2, bitsPerSample, true);
                        view.setUint16(ifdOffset + ifdSize + 4, bitsPerSample, true);
                    }

                    // Extra data for Resolution
                    view.setUint32(ifdOffset + ifdSize + 8, 72, true);
                    view.setUint32(ifdOffset + ifdSize + 12, 1, true);
                    view.setUint32(ifdOffset + ifdSize + 16, 72, true);
                    view.setUint32(ifdOffset + ifdSize + 20, 1, true);

                    // Image data
                    const pixelData = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
                    bytes.set(pixelData, stripOffset);

                    return bytes;
                }

                // Interaction
                container.addEventListener('mousedown', (e) => {
                    isDragging = true;
                    startX = e.clientX - offsetX;
                    startY = e.clientY - offsetY;
                });

                document.addEventListener('mousemove', (e) => {
                    lastMouseX = e.clientX;
                    lastMouseY = e.clientY;
                    hasLastMouse = true;

                    if (isDragging) {
                        offsetX = e.clientX - startX;
                        offsetY = e.clientY - startY;
                        requestRenderWithSync();
                    }

                    // Update pixel info
                    const imgX = Math.floor((e.clientX - offsetX) / scale);
                    const imgY = Math.floor((e.clientY - offsetY) / scale);

                    if (imgX >= 0 && imgX < cols && imgY >= 0 && imgY < rows) {
                        const idx = (imgY * cols + imgX) * channels;
                        let valStr = '';
                        if (channels === 1) {
                            valStr = formatValue(rawData[idx]);
                        } else if (channels === 4) {
                            valStr = \`R:\${formatValue(rawData[idx])} G:\${formatValue(rawData[idx+1])} B:\${formatValue(rawData[idx+2])} A:\${formatValue(rawData[idx+3])}\`;
                        } else {
                            valStr = \`R:\${formatValue(rawData[idx])} G:\${formatValue(rawData[idx+1])} B:\${formatValue(rawData[idx+2])}\`;
                        }
                        pixelInfo.textContent = \`(\${imgX}, \${imgY}) : \${valStr}\`;
                    } else {
                        pixelInfo.textContent = '';
                    }
                });

                document.addEventListener('mouseup', () => {
                    isDragging = false;
                });

                container.addEventListener('wheel', (e) => {
                    e.preventDefault();
                    const delta = -e.deltaY;
                    const factor = delta > 0 ? 1.1 : 1 / 1.1;
                    setZoomAt(e.clientX, e.clientY, scale * factor);
                }, { passive: false });

                window.addEventListener('resize', () => {
                    updateCanvasSize();
                    updateUiScale();
                    requestRender();
                });

                // Initial setup
                updateCanvasSize();
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
