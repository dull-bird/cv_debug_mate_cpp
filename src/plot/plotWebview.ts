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
                width: 100%;
                height: 100%;
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
        </style>
    </head>
    <body>
        <div id="header">
            <div id="title">View: ${variableName}</div>
            <div id="toolbar">
                <button id="btnHome" class="btn" title="Reset View (Home)">🏠 Home</button>
                <button id="btnZoomRect" class="btn" title="Zoom to Rectangle">🔍 Zoom</button>
                <button id="btnPan" class="btn active" title="Pan Mode">✋ Pan</button>
                
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
                
                <span id="info">Size: ${data.length}</span>
            </div>
        </div>
        <div id="container">
            <canvas id="plotCanvas"></canvas>
            <div id="tooltip"></div>
            <div id="zoomRect" style="display:none; position:absolute; border:1px solid #4a9eff; background:rgba(74,158,255,0.2); pointer-events:none;"></div>
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
                    
                    const triggerX = document.getElementById('triggerX');
                    const menuX = document.getElementById('menuX');
                    const currentXText = document.getElementById('currentXText');
                    
                    const btnExport = document.getElementById('btnExport');
                    const exportMenu = document.getElementById('exportMenu');
                    const exportPNG = document.getElementById('exportPNG');
                    const exportCSV = document.getElementById('exportCSV');

                    let width = 0, height = 0;
                    let padding = { top: 40, right: 40, bottom: 40, left: 60 };
                    
                    let interactionMode = 'pan';
                    let scaleX = 1, scaleY = 1, offsetX = 0, offsetY = 0;
                    let isDragging = false, dragStartX = 0, dragStartY = 0, lastMouseX = 0, lastMouseY = 0;

                    function updateSize() {
                        const rect = container.getBoundingClientRect();
                        const dpr = window.devicePixelRatio || 1;
                        width = rect.width;
                        height = rect.height;
                        if (width <= 0 || height <= 0) return false;
                        
                        canvas.width = Math.floor(width * dpr);
                        canvas.height = Math.floor(height * dpr);
                        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
                        return true;
                    }

                    let minY = 0, maxY = 0, rangeY = 1, minX = 0, maxX = 0, rangeX = 1;

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
                        minY = bY.min; maxY = bY.max;
                        rangeY = (maxY - minY) || 1;

                        const bX = getBounds(dataX);
                        minX = bX.min; maxX = bX.max;
                        rangeX = (maxX - minX) || 1;
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

                        const innerWidth = width - padding.left - padding.right;
                        const innerHeight = height - padding.top - padding.bottom;
                        if (innerWidth <= 0 || innerHeight <= 0) return;

                        // Draw axes
                        ctx.strokeStyle = '#555';
                        ctx.lineWidth = 1;
                        ctx.beginPath();
                        ctx.moveTo(padding.left, padding.top);
                        ctx.lineTo(padding.left, height - padding.bottom);
                        ctx.lineTo(width - padding.right, height - padding.bottom);
                        ctx.stroke();

                        // Labels
                        ctx.fillStyle = '#888';
                        ctx.font = '10px Arial';
                        ctx.textAlign = 'right';
                        ctx.textBaseline = 'middle';
                        for (let i = 0; i <= 5; i++) {
                            const val = minY + (rangeY * i / 5);
                            const y = toScreenY(val);
                            if (y >= padding.top && y <= height - padding.bottom) {
                                ctx.fillText(val.toFixed(2), padding.left - 10, y);
                                ctx.beginPath(); ctx.moveTo(padding.left - 5, y); ctx.lineTo(padding.left, y); ctx.stroke();
                            }
                        }

                        ctx.textAlign = 'center';
                        ctx.textBaseline = 'top';
                        for (let i = 0; i <= 5; i++) {
                            const val = minX + (rangeX * i / 5);
                            const x = toScreenX(val);
                            if (x >= padding.left && x <= width - padding.right) {
                                ctx.fillText(val.toFixed(2), x, height - padding.bottom + 10);
                                ctx.beginPath(); ctx.moveTo(x, height - padding.bottom); ctx.lineTo(x, height - padding.bottom + 5); ctx.stroke();
                            }
                        }

                        // Names
                        ctx.fillStyle = '#4a9eff';
                        ctx.textAlign = 'center';
                        ctx.fillText(currentVariableNameX, padding.left + innerWidth / 2, height - 10);
                        ctx.save();
                        ctx.translate(15, padding.top + innerHeight / 2);
                        ctx.rotate(-Math.PI / 2);
                        ctx.fillText(currentVariableNameY, 0, 0);
                        ctx.restore();

                        // Curve
                        ctx.save();
                        ctx.beginPath();
                        ctx.rect(padding.left, padding.top, innerWidth, innerHeight);
                        ctx.clip();
                        ctx.strokeStyle = '#4a9eff';
                        ctx.lineWidth = 2;
                        ctx.beginPath();
                        for (let i = 0; i < dataY.length; i++) {
                            const x = toScreenX(dataX[i]);
                            const y = toScreenY(dataY[i]);
                            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
                        }
                        ctx.stroke();
                        ctx.restore();
                    }

                    function resetView() {
                        scaleX = scaleY = 1;
                        offsetX = offsetY = 0;
                        draw();
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
                        if (isDragging && interactionMode === 'zoomRect') {
                            const r = container.getBoundingClientRect();
                            const x1 = fromScreenX(Math.min(dragStartX - r.left, e.clientX - r.left));
                            const x2 = fromScreenX(Math.max(dragStartX - r.left, e.clientX - r.left));
                            const y1 = fromScreenY(Math.max(dragStartY - r.top, e.clientY - r.top));
                            const y2 = fromScreenY(Math.min(dragStartY - r.top, e.clientY - r.top));
                            if (Math.abs(e.clientX - dragStartX) > 5) {
                                const iW = width - padding.left - padding.right, iH = height - padding.top - padding.bottom;
                                scaleX = iW / ((x2 - x1) / rangeX * iW); scaleY = iH / ((y2 - y1) / rangeY * iH);
                                offsetX = -((x1 - minX) / rangeX * iW); offsetY = -((y1 - minY) / rangeY * iH);
                                draw();
                            }
                            zoomRectEl.style.display = 'none';
                        }
                        isDragging = false;
                    });

                    container.addEventListener('wheel', function(e) {
                        e.preventDefault();
                        const f = e.deltaY > 0 ? 0.9 : 1.1;
                        const r = container.getBoundingClientRect();
                        const mx = e.clientX - r.left, my = e.clientY - r.top;
                        const rx = (mx - padding.left) / scaleX - offsetX, ry = (height - padding.bottom - my) / scaleY - offsetY;
                        scaleX *= f; scaleY *= f;
                        offsetX = (mx - padding.left) / scaleX - rx; offsetY = (height - padding.bottom - my) / scaleY - ry;
                        draw();
                    }, { passive: false });

                    window.onresize = function() { draw(); };
                    btnHome.onclick = resetView;
                    btnPan.onclick = function() { interactionMode = 'pan'; btnPan.classList.add('active'); btnZoomRect.classList.remove('active'); };
                    btnZoomRect.onclick = function() { interactionMode = 'zoomRect'; btnZoomRect.classList.add('active'); btnPan.classList.remove('active'); };

                    // Initial draw with a small delay to ensure layout is ready
                    updateDataBounds();
                    setTimeout(draw, 100);
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
