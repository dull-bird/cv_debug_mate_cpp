// Function to generate the webview content for the point cloud
// If points is empty, the webview will wait for data via postMessage
export function getWebviewContentForPointCloud(
  points?: { x: number; y: number; z: number }[]
): string {
  // If points provided, embed them (legacy mode for compatibility)
  // If not provided, webview will wait for postMessage
  const pointsArray = points && points.length > 0 ? JSON.stringify(points) : '[]';
  const waitForData = !points || points.length === 0;
  return `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>3D Point Viewer</title>
            <style>
                body { margin: 0; overflow: hidden; font-family: Arial, sans-serif; }
                canvas { display: block; }
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
                .hidden { display: none !important; }
                @keyframes spin {
                    0% { transform: rotate(0deg); }
                    100% { transform: rotate(360deg); }
                }
                #info {
                    position: absolute;
                    top: 10px;
                    left: 10px;
                    background: rgba(0, 0, 0, 0.7);
                    color: white;
                    padding: 10px 15px;
                    border-radius: 5px;
                    font-size: 14px;
                    z-index: 100;
                }
                #info h3 { margin: 0 0 8px 0; font-size: 16px; }
                #info p { margin: 4px 0; }
                #controls {
                    position: absolute;
                    top: 10px;
                    right: 10px;
                    background: rgba(0, 0, 0, 0.7);
                    color: white;
                    padding: 10px 15px;
                    border-radius: 5px;
                    z-index: 100;
                }
                #controls button {
                    background: #4a9eff;
                    color: white;
                    border: none;
                    padding: 6px 10px;
                    margin: 2px;
                    border-radius: 4px;
                    cursor: pointer;
                    font-size: 11px;
                }
                #controls button:hover { background: #3a8eef; }
                #controls button.active { background: #1a5faf; }
                #controls button.color-btn.active { background: #1a5faf; }
                #controls button.view-btn {
                    padding: 4px 6px;
                    font-size: 10px;
                }
                #controls.collapsed .ctrl-row,
                #controls.collapsed button:not(.toggle-btn) {
                    display: none;
                }
                #controls.collapsed {
                    padding: 6px 10px;
                }
                .toggle-btn {
                    background: transparent;
                    border: none;
                    color: #aaa;
                    font-size: 14px;
                    cursor: pointer;
                    padding: 2px 6px;
                    margin: 0;
                }
                .toggle-btn:hover {
                    color: #fff;
                }
                #controls label { font-size: 11px; margin-right: 3px; color: #aaa; }
                #controls input[type="number"] {
                    width: 50px;
                    padding: 3px;
                    border: 1px solid #555;
                    border-radius: 3px;
                    background: #333;
                    color: white;
                    font-size: 11px;
                }
                .ctrl-row {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    margin-bottom: 6px;
                    flex-wrap: wrap;
                }
                .ctrl-row select {
                    padding: 3px;
                    font-size: 11px;
                }
                .ctrl-row .save-btn {
                    padding: 4px 8px;
                    font-size: 11px;
                    margin: 0;
                }
                #axisView {
                    position: absolute;
                    bottom: 10px;
                    right: 10px;
                    width: 120px;
                    height: 120px;
                    background: rgba(20, 20, 30, 0.9);
                    border-radius: 5px;
                    border: 1px solid rgba(255, 255, 255, 0.3);
                    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.5);
                }
                #axisView svg {
                    width: 100%;
                    height: 100%;
                    display: block;
                }
                #colorbar {
                    position: absolute;
                    bottom: 140px;
                    right: 10px;
                    background: rgba(0, 0, 0, 0.85);
                    color: white;
                    padding: 12px;
                    border-radius: 6px;
                    display: none;
                    user-select: none;
                }
                .colorbar-title {
                    font-size: 11px;
                    color: #aaa;
                    text-align: center;
                    margin-bottom: 8px;
                }
                #colorbar-container { display: flex; gap: 8px; }
                #colorbar-gradient {
                    width: 20px;
                    height: 150px;
                    background: linear-gradient(to top, #0000ff, #00ffff, #00ff00, #ffff00, #ff0000);
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
                #colorbar-labels {
                    display: flex;
                    flex-direction: column;
                    justify-content: space-between;
                    height: 150px;
                    font-size: 10px;
                    min-width: 50px;
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
            <script type="importmap">
            {
                "imports": {
                    "three": "https://cdn.jsdelivr.net/npm/three@0.149.0/build/three.module.js",
                    "three/addons/": "https://cdn.jsdelivr.net/npm/three@0.149.0/examples/jsm/"
                }
            }
            </script>
        </head>
        <body>
            <div id="loading" class="${waitForData ? '' : 'hidden'}">
                <div class="spinner"></div>
                <div id="loading-text">Loading Point Cloud...</div>
            </div>
            <div id="info">
                <h3>Point Cloud Viewer</h3>
                <p>Points: <span id="pointCount">0</span></p>
                <p>X (Right): <span id="boundsX">-</span></p>
                <p>Y (Forward): <span id="boundsY">-</span></p>
                <p>Z (Up): <span id="boundsZ">-</span></p>
            </div>
            <div id="controls">
                <button class="toggle-btn" id="toggleControls" title="Hide/Show Controls">▼</button>
                <div class="ctrl-row">
                    <button id="btnReload" title="Reload data from memory">Reload</button>
                    <button id="btnResetView">Reset</button>
                    <label>Size:</label>
                    <input type="number" id="pointSizeInput" value="0.1" step="0.05" min="0.01" max="20">
                    <label>PLY:</label>
                    <select id="plyFormatSelect" style="background: #333; color: white; border: 1px solid #555; border-radius: 3px;">
                        <option value="binary" selected>Binary</option>
                        <option value="ascii">ASCII</option>
                    </select>
                    <button id="btnSavePLY" class="save-btn" style="background: #28a745;">Save</button>
                </div>
                <div class="ctrl-row">
                    <span style="font-size: 10px; color: #888;">Colored by:</span>
                    <button id="btnSolid" class="color-btn active">Solid</button>
                    <button id="btnHeightZ" class="color-btn">Z</button>
                    <button id="btnHeightY" class="color-btn">Y</button>
                    <button id="btnHeightX" class="color-btn">X</button>
                </div>
                <div class="ctrl-row">
                    <span style="font-size: 10px; color: #888;">View from:</span>
                    <button id="btnViewTop" class="view-btn" title="View from Top (Z+)">Top</button>
                    <button id="btnViewBottom" class="view-btn" title="View from Bottom (Z-)">Bottom</button>
                    <button id="btnViewFront" class="view-btn" title="View from Front (Y+)">Front</button>
                    <button id="btnViewBack" class="view-btn" title="View from Back (Y-)">Back</button>
                    <button id="btnViewLeft" class="view-btn" title="View from Left (X-)">Left</button>
                    <button id="btnViewRight" class="view-btn" title="View from Right (X+)">Right</button>
                </div>
            </div>
            <div id="axisView"></div>
            <div id="colorbar">
                <div class="colorbar-title" id="colorbar-title">Color Range</div>
                <div id="colorbar-container">
                    <div id="colorbar-gradient">
                        <div class="colorbar-slider-track">
                            <div class="colorbar-slider" id="sliderMax" style="top: 0px;"></div>
                            <div class="colorbar-slider" id="sliderMin" style="bottom: 0px; top: auto;"></div>
                        </div>
                    </div>
                    <div id="colorbar-labels">
                        <div class="colorbar-label"><input type="text" id="colorbar-max-input" value="1.0"></div>
                        <div class="colorbar-label" style="text-align: center;"><span id="colorbar-mid">0.5</span></div>
                        <div class="colorbar-label"><input type="text" id="colorbar-min-input" value="0.0"></div>
                    </div>
                </div>
                <button class="colorbar-reset" id="colorbar-reset">Reset Range</button>
            </div>
            <script type="module">
                import * as THREE from 'three';
                import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
                
                const vscode = acquireVsCodeApi();
                const loadingOverlay = document.getElementById('loading');
                const loadingText = document.getElementById('loading-text');
                
                let points = ${pointsArray};
                let isInitialized = false;
                let pendingSyncState = null;
                let extensionReady = false;
                let isShuttingDownEarly = false;  // For use before full init
                
                // Detect if this is a moved panel (same logic as Mat viewer)
                const waitForData = ${waitForData};
                if (waitForData) {
                    setTimeout(() => {
                        if (!extensionReady && !isShuttingDownEarly) {
                            loadingText.innerHTML = 'Reloading...';
                            vscode.postMessage({ command: 'reload' });
                        }
                    }, 100);
                }
                
                // Mark shutting down early (before full initialization)
                window.addEventListener('beforeunload', () => {
                    isShuttingDownEarly = true;
                });
                
                // Colorbar custom limits
                let colorCustomMin = null;
                let colorCustomMax = null;
                let currentColorMode = 'solid';
                let colorDebounceTimer = null;
                const COLOR_DEBOUNCE_MS = 300;
                const SLIDER_TRACK_HEIGHT = 150;
                
                // Main scene
                const scene = new THREE.Scene();
                scene.background = new THREE.Color(0x1a1a2e);
                
                const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 100000);
                const renderer = new THREE.WebGLRenderer({ antialias: true });
                renderer.setSize(window.innerWidth, window.innerHeight);
                renderer.autoClear = false;
                document.body.appendChild(renderer.domElement);
                
                // Point cloud objects (will be created when data is available)
                let geometry = null;
                let pointsMaterial = null;
                let pointsObj = null;
                let minX = 0, maxX = 1, minY = 0, maxY = 1, minZ = 0, maxZ = 1;
                const controls = new OrbitControls(camera, renderer.domElement);
                
                // Axis view using SVG for crisp vector rendering
                const axisContainer = document.getElementById('axisView');
                const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
                svg.setAttribute('viewBox', '0 0 120 120');
                svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
                axisContainer.appendChild(svg);
                
                // Function to update axis arrows based on camera direction
                function updateAxisView() {
                    // Clear previous content
                    svg.innerHTML = '';
                    
                    // Get camera basis vectors
                    const cameraDir = new THREE.Vector3();
                    camera.getWorldDirection(cameraDir);
                    const cameraUp = camera.up.clone();
                    const cameraRight = new THREE.Vector3();
                    cameraRight.crossVectors(cameraDir, cameraUp).normalize();
                    const cameraUpCorrected = new THREE.Vector3();
                    cameraUpCorrected.crossVectors(cameraRight, cameraDir).normalize();
                    
                    // Define axis directions in world space
                    const worldX = new THREE.Vector3(1, 0, 0);
                    const worldY = new THREE.Vector3(0, 0, -1); // Y is forward (negative Z in Three.js)
                    const worldZ = new THREE.Vector3(0, 1, 0);
                    
                    // Project to 2D using camera basis
                    // Project onto the plane perpendicular to camera direction
                    function project3DTo2D(worldVec) {
                        // Project onto camera right and up vectors
                        const projRight = worldVec.dot(cameraRight);
                        const projUp = worldVec.dot(cameraUpCorrected);
                        return { x: projRight, y: projUp };
                    }
                    
                    const centerX = 60, centerY = 60;
                    const axisLength = 30;
                    const arrowSize = 8;
                    
                    // Project axes
                    const xProj = project3DTo2D(worldX);
                    const yProj = project3DTo2D(worldY);
                    const zProj = project3DTo2D(worldZ);
                    
                    // Normalize and scale
                    const scale = axisLength;
                    const xEnd = {
                        x: centerX + xProj.x * scale,
                        y: centerY - xProj.y * scale // Flip Y for SVG
                    };
                    const yEnd = {
                        x: centerX + yProj.x * scale,
                        y: centerY - yProj.y * scale
                    };
                    const zEnd = {
                        x: centerX + zProj.x * scale,
                        y: centerY - zProj.y * scale
                    };
                    
                    // Draw arrows
                    drawArrow(svg, centerX, centerY, xEnd.x, xEnd.y, '#ff3333', 'X');
                    drawArrow(svg, centerX, centerY, yEnd.x, yEnd.y, '#33ff33', 'Y');
                    drawArrow(svg, centerX, centerY, zEnd.x, zEnd.y, '#3333ff', 'Z');
                }
                
                // Function to draw an arrow with label
                function drawArrow(svg, x1, y1, x2, y2, color, label) {
                    // Draw line
                    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
                    line.setAttribute('x1', x1);
                    line.setAttribute('y1', y1);
                    line.setAttribute('x2', x2);
                    line.setAttribute('y2', y2);
                    line.setAttribute('stroke', color);
                    line.setAttribute('stroke-width', '2.5');
                    line.setAttribute('stroke-linecap', 'round');
                    svg.appendChild(line);
                    
                    // Draw arrowhead
                    const angle = Math.atan2(y2 - y1, x2 - x1);
                    const arrowLength = 6;
                    const arrowWidth = 4;
                    
                    const arrowX1 = x2 - arrowLength * Math.cos(angle - Math.PI / 6);
                    const arrowY1 = y2 - arrowLength * Math.sin(angle - Math.PI / 6);
                    const arrowX2 = x2 - arrowLength * Math.cos(angle + Math.PI / 6);
                    const arrowY2 = y2 - arrowLength * Math.sin(angle + Math.PI / 6);
                    
                    const arrow = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
                    arrow.setAttribute('points', x2 + ',' + y2 + ' ' + arrowX1 + ',' + arrowY1 + ' ' + arrowX2 + ',' + arrowY2);
                    arrow.setAttribute('fill', color);
                    svg.appendChild(arrow);
                    
                    // Draw label
                    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                    text.setAttribute('x', x2 + (x2 - x1) * 0.15);
                    text.setAttribute('y', y2 + (y2 - y1) * 0.15);
                    text.setAttribute('fill', color);
                    text.setAttribute('font-size', '14');
                    text.setAttribute('font-weight', 'bold');
                    text.setAttribute('font-family', 'Arial, sans-serif');
                    text.setAttribute('text-anchor', 'middle');
                    text.setAttribute('dominant-baseline', 'middle');
                    text.textContent = label;
                    svg.appendChild(text);
                }
                
                // Initial render
                updateAxisView();

                // Function to initialize point cloud with data
                function initializePointCloud(pointsData) {
                    points = pointsData;
                    
                    // Calculate bounds
                    minX = Infinity; maxX = -Infinity;
                    minY = Infinity; maxY = -Infinity;
                    minZ = Infinity; maxZ = -Infinity;
                    
                    points.forEach(p => {
                        minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
                        minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
                        minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
                    });
                    
                    // Handle edge case of single point or identical points
                    if (minX === maxX) { minX -= 0.5; maxX += 0.5; }
                    if (minY === maxY) { minY -= 0.5; maxY += 0.5; }
                    if (minZ === maxZ) { minZ -= 0.5; maxZ += 0.5; }
                    
                    document.getElementById('pointCount').textContent = points.length;
                    document.getElementById('boundsX').textContent = \`[\${minX.toFixed(2)}, \${maxX.toFixed(2)}]\`;
                    document.getElementById('boundsY').textContent = \`[\${minY.toFixed(2)}, \${maxY.toFixed(2)}]\`;
                    document.getElementById('boundsZ').textContent = \`[\${minZ.toFixed(2)}, \${maxZ.toFixed(2)}]\`;

                    // Remove old point cloud if exists
                    if (pointsObj) {
                        scene.remove(pointsObj);
                        geometry.dispose();
                        pointsMaterial.dispose();
                    }

                    geometry = new THREE.BufferGeometry();
                    const positions = new Float32Array(points.length * 3);
                    const colors = new Float32Array(points.length * 3);
                    
                    points.forEach((p, i) => {
                        positions[i * 3] = p.x;
                        positions[i * 3 + 1] = p.z; // Swap Y and Z for Three.js
                        positions[i * 3 + 2] = -p.y; // Invert Y
                        
                        colors[i * 3] = 0.5;
                        colors[i * 3 + 1] = 0.7;
                        colors[i * 3 + 2] = 1.0;
                    });
                    
                    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
                    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
                    
                    pointsMaterial = new THREE.PointsMaterial({
                        size: 0.1,
                        vertexColors: true,
                        sizeAttenuation: true
                    });
                    
                    pointsObj = new THREE.Points(geometry, pointsMaterial);
                    scene.add(pointsObj);
                    
                    // Hide loading overlay
                    loadingOverlay.classList.add('hidden');
                    
                    if (pendingSyncState) {
                        applyViewState(pendingSyncState);
                        pendingSyncState = null;
                    } else if (!isInitialized) {
                        resetView();
                    }
                    
                    isInitialized = true;
                    renderer.render(scene, camera);
                }
                
                function resetView() {
                    const centerX = (minX + maxX) / 2;
                    const centerY = (minZ + maxZ) / 2;  // Three.js Y = World Z
                    const centerZ = -(minY + maxY) / 2; // Three.js Z = -World Y
                    
                    const dist = Math.max(maxX - minX, maxY - minY, maxZ - minZ) * 1.5;
                    
                    // Fixed isometric-like view: from front-right-top corner
                    camera.position.set(centerX + dist * 0.7, centerY + dist * 0.7, centerZ + dist * 0.7);
                    camera.up.set(0, 1, 0); // Y is up
                    camera.lookAt(centerX, centerY, centerZ);
                    controls.target.set(centerX, centerY, centerZ);
                    controls.update();
                    
                    // Emit view change for sync
                    emitViewChange(true);
                }
                
                // Initialize with embedded data if available
                if (points.length > 0) {
                    initializePointCloud(points);
                }

                function getAxisBounds(mode) {
                    if (mode === 'x') return { min: minX, max: maxX };
                    if (mode === 'y') return { min: minY, max: maxY };
                    if (mode === 'z') return { min: minZ, max: maxZ };
                    return { min: 0, max: 1 };
                }
                
                function updateColorbarUI() {
                    if (currentColorMode === 'solid') return;
                    
                    const bounds = getAxisBounds(currentColorMode);
                    const effectiveMin = (colorCustomMin !== null) ? colorCustomMin : bounds.min;
                    const effectiveMax = (colorCustomMax !== null) ? colorCustomMax : bounds.max;
                    
                    const colorbarMaxInput = document.getElementById('colorbar-max-input');
                    const colorbarMinInput = document.getElementById('colorbar-min-input');
                    const colorbarMid = document.getElementById('colorbar-mid');
                    const sliderMax = document.getElementById('sliderMax');
                    const sliderMin = document.getElementById('sliderMin');
                    
                    colorbarMaxInput.value = effectiveMax.toPrecision(4);
                    colorbarMinInput.value = effectiveMin.toPrecision(4);
                    colorbarMid.textContent = ((effectiveMin + effectiveMax) / 2).toPrecision(4);
                    
                    // Update slider positions
                    const range = bounds.max - bounds.min || 1;
                    const maxPos = Math.max(0, Math.min(1, (bounds.max - effectiveMax) / range));
                    const minPos = Math.max(0, Math.min(1, (effectiveMin - bounds.min) / range));
                    
                    sliderMax.style.top = (maxPos * (SLIDER_TRACK_HEIGHT - 6)) + 'px';
                    sliderMin.style.top = 'auto';
                    sliderMin.style.bottom = (minPos * (SLIDER_TRACK_HEIGHT - 6)) + 'px';
                }
                
                function applyColorsWithLimits() {
                    if (currentColorMode === 'solid') return;
                    
                    const colorAttr = geometry.attributes.color;
                    const bounds = getAxisBounds(currentColorMode);
                    const effectiveMin = (colorCustomMin !== null) ? colorCustomMin : bounds.min;
                    const effectiveMax = (colorCustomMax !== null) ? colorCustomMax : bounds.max;
                    const range = effectiveMax - effectiveMin || 1;
                    
                    for (let i = 0; i < points.length; i++) {
                        const p = points[i];
                        let val;
                        if (currentColorMode === 'x') val = p.x;
                        else if (currentColorMode === 'y') val = p.y;
                        else if (currentColorMode === 'z') val = p.z;
                        
                        const t = Math.max(0, Math.min(1, (val - effectiveMin) / range));
                        
                        // Jet-like colormap
                        let jetR = 0, jetG = 0, jetB = 0;
                        if (t < 0.25) { jetR = 0; jetG = 4 * t; jetB = 1; }
                        else if (t < 0.5) { jetR = 0; jetG = 1; jetB = 1 - 4 * (t - 0.25); }
                        else if (t < 0.75) { jetR = 4 * (t - 0.5); jetG = 1; jetB = 0; }
                        else { jetR = 1; jetG = 1 - 4 * (t - 0.75); jetB = 0; }
                        
                        colorAttr.setXYZ(i, jetR, jetG, jetB);
                    }
                    colorAttr.needsUpdate = true;
                }
                
                function applyColorsDebounced() {
                    if (colorDebounceTimer) clearTimeout(colorDebounceTimer);
                    colorDebounceTimer = setTimeout(() => {
                        applyColorsWithLimits();
                    }, COLOR_DEBOUNCE_MS);
                }
                
                function updateColors(mode, resetLimits = true) {
                    const colorAttr = geometry.attributes.color;
                    const colorbar = document.getElementById('colorbar');
                    const colorbarTitle = document.getElementById('colorbar-title');
                    
                    currentColorMode = mode;
                    
                    if (resetLimits) {
                        colorCustomMin = null;
                        colorCustomMax = null;
                    }
                    
                    if (mode === 'solid') {
                        colorbar.style.display = 'none';
                        for (let i = 0; i < points.length; i++) {
                            colorAttr.setXYZ(i, 0.5, 0.7, 1.0);
                        }
                        colorAttr.needsUpdate = true;
                    } else {
                        colorbar.style.display = 'block';
                        colorbarTitle.textContent = 'Color by ' + mode.toUpperCase();
                        updateColorbarUI();
                        applyColorsWithLimits();
                    }
                }

                document.getElementById('btnSolid').onclick = () => { updateColors('solid'); updateColorButtons('solid'); };
                document.getElementById('btnHeightX').onclick = () => { updateColors('x'); updateColorButtons('x'); };
                document.getElementById('btnHeightY').onclick = () => { updateColors('y'); updateColorButtons('y'); };
                document.getElementById('btnHeightZ').onclick = () => { updateColors('z'); updateColorButtons('z'); };
                document.getElementById('btnResetView').onclick = resetView;
                document.getElementById('btnReload').onclick = () => {
                    vscode.postMessage({ command: 'reload' });
                };
                
                // Update color button active state
                function updateColorButtons(mode) {
                    document.querySelectorAll('.color-btn').forEach(btn => btn.classList.remove('active'));
                    if (mode === 'solid') document.getElementById('btnSolid').classList.add('active');
                    else if (mode === 'x') document.getElementById('btnHeightX').classList.add('active');
                    else if (mode === 'y') document.getElementById('btnHeightY').classList.add('active');
                    else if (mode === 'z') document.getElementById('btnHeightZ').classList.add('active');
                }
                
                // View angle buttons (like CloudCompare)
                // Note: In Three.js, Y is up. Our coordinate mapping:
                // - World X (Right) -> Three.js X
                // - World Y (Forward) -> Three.js -Z
                // - World Z (Up) -> Three.js Y
                function setViewAngle(direction) {
                    if (!isInitialized) return;
                    
                    const centerX = (minX + maxX) / 2;
                    const centerY = (minZ + maxZ) / 2;  // Three.js Y = World Z
                    const centerZ = -(minY + maxY) / 2; // Three.js Z = -World Y
                    
                    const dist = Math.max(maxX - minX, maxY - minY, maxZ - minZ) * 1.5;
                    
                    let camPos;
                    let upVec = new THREE.Vector3(0, 1, 0); // Default up is Y (World Z)
                    
                    switch (direction) {
                        case 'top':    // Looking down from Z+ (World Z+)
                            camPos = new THREE.Vector3(centerX, centerY + dist, centerZ);
                            upVec = new THREE.Vector3(0, 0, -1); // Forward is -Z (World Y+)
                            break;
                        case 'bottom': // Looking up from Z- (World Z-)
                            camPos = new THREE.Vector3(centerX, centerY - dist, centerZ);
                            upVec = new THREE.Vector3(0, 0, 1); // Forward is +Z (World Y-)
                            break;
                        case 'front':  // Looking from Y- (World Y-), seeing front face
                            camPos = new THREE.Vector3(centerX, centerY, centerZ + dist);
                            break;
                        case 'back':   // Looking from Y+ (World Y+), seeing back face
                            camPos = new THREE.Vector3(centerX, centerY, centerZ - dist);
                            break;
                        case 'left':   // Looking from X- (World X-)
                            camPos = new THREE.Vector3(centerX - dist, centerY, centerZ);
                            break;
                        case 'right':  // Looking from X+ (World X+)
                            camPos = new THREE.Vector3(centerX + dist, centerY, centerZ);
                            break;
                        default:
                            return;
                    }
                    
                    camera.position.copy(camPos);
                    camera.up.copy(upVec);
                    camera.lookAt(centerX, centerY, centerZ);
                    controls.target.set(centerX, centerY, centerZ);
                    controls.update();
                    
                    // Emit view change for sync
                    emitViewChange(true);
                }
                
                document.getElementById('btnViewTop').onclick = () => setViewAngle('top');
                document.getElementById('btnViewBottom').onclick = () => setViewAngle('bottom');
                document.getElementById('btnViewFront').onclick = () => setViewAngle('front');
                document.getElementById('btnViewBack').onclick = () => setViewAngle('back');
                document.getElementById('btnViewLeft').onclick = () => setViewAngle('left');
                document.getElementById('btnViewRight').onclick = () => setViewAngle('right');
                document.getElementById('pointSizeInput').oninput = (e) => {
                    if (pointsMaterial) {
                        pointsMaterial.size = parseFloat(e.target.value);
                    }
                };
                
                // Toggle controls visibility
                const controlsEl = document.getElementById('controls');
                const toggleControlsBtn = document.getElementById('toggleControls');
                toggleControlsBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const isCollapsed = controlsEl.classList.toggle('collapsed');
                    toggleControlsBtn.textContent = isCollapsed ? '▶' : '▼';
                });
                
                // Colorbar slider dragging
                let draggingSlider = null;
                let sliderStartY = 0;
                let sliderStartTop = 0;
                
                function onSliderMouseDown(e, slider, isMax) {
                    e.preventDefault();
                    e.stopPropagation();
                    draggingSlider = { slider, isMax };
                    slider.classList.add('dragging');
                    sliderStartY = e.clientY;
                    const rect = slider.getBoundingClientRect();
                    const trackRect = slider.parentElement.getBoundingClientRect();
                    sliderStartTop = rect.top - trackRect.top;
                }
                
                const sliderMaxEl = document.getElementById('sliderMax');
                const sliderMinEl = document.getElementById('sliderMin');
                
                sliderMaxEl.addEventListener('mousedown', (e) => onSliderMouseDown(e, sliderMaxEl, true));
                sliderMinEl.addEventListener('mousedown', (e) => onSliderMouseDown(e, sliderMinEl, false));
                
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
                    const bounds = getAxisBounds(currentColorMode);
                    const range = bounds.max - bounds.min || 1;
                    const normalizedPos = newTop / (SLIDER_TRACK_HEIGHT - 6);
                    
                    const colorbarMaxInput = document.getElementById('colorbar-max-input');
                    const colorbarMinInput = document.getElementById('colorbar-min-input');
                    const colorbarMid = document.getElementById('colorbar-mid');
                    
                    if (isMax) {
                        colorCustomMax = bounds.max - normalizedPos * range;
                        colorbarMaxInput.value = colorCustomMax.toPrecision(4);
                    } else {
                        colorCustomMin = bounds.max - normalizedPos * range;
                        colorbarMinInput.value = colorCustomMin.toPrecision(4);
                    }
                    
                    // Update mid value
                    const effectiveMin = (colorCustomMin !== null) ? colorCustomMin : bounds.min;
                    const effectiveMax = (colorCustomMax !== null) ? colorCustomMax : bounds.max;
                    colorbarMid.textContent = ((effectiveMin + effectiveMax) / 2).toPrecision(4);
                    
                    applyColorsDebounced();
                });
                
                document.addEventListener('mouseup', () => {
                    if (draggingSlider) {
                        draggingSlider.slider.classList.remove('dragging');
                        draggingSlider = null;
                        // Apply final colors immediately
                        applyColorsWithLimits();
                    }
                });
                
                // Input field change handlers
                document.getElementById('colorbar-max-input').addEventListener('change', (e) => {
                    const val = parseFloat(e.target.value);
                    if (!isNaN(val)) {
                        colorCustomMax = val;
                        updateColorbarUI();
                        applyColorsWithLimits();
                    }
                });
                
                document.getElementById('colorbar-min-input').addEventListener('change', (e) => {
                    const val = parseFloat(e.target.value);
                    if (!isNaN(val)) {
                        colorCustomMin = val;
                        updateColorbarUI();
                        applyColorsWithLimits();
                    }
                });
                
                // Reset button
                document.getElementById('colorbar-reset').addEventListener('click', () => {
                    colorCustomMin = null;
                    colorCustomMax = null;
                    updateColorbarUI();
                    applyColorsWithLimits();
                });
                
                document.getElementById('btnSavePLY').onclick = () => {
                    const format = document.getElementById('plyFormatSelect').value;
                    vscode.postMessage({ command: 'savePLY', format: format });
                };

                let isSyncing = false;
                let isShuttingDown = false;
                
                window.addEventListener('message', event => {
                    const message = event.data;
                    if (message.command === 'ready') {
                        // Extension is ready, this is not a moved panel
                        extensionReady = true;
                    } else if (message.command === 'completeData') {
                        // Received point cloud data via postMessage
                        extensionReady = true;
                        loadingOverlay.classList.remove('hidden');
                        loadingText.textContent = 'Initializing point cloud...';
                        
                        setTimeout(() => {
                            try {
                                initializePointCloud(message.points);
                            } catch (e) {
                                console.error('Failed to initialize point cloud:', e);
                                loadingText.textContent = 'Failed to load: ' + e.message;
                            }
                        }, 10);
                    } else if (message.command === 'setView') {
                        const state = message.state;
                        if (!isInitialized) {
                            pendingSyncState = state;
                            return;
                        }
                        applyViewState(state);
                    } else if (message.command === 'updateData') {
                        updatePointCloudData(message.points);
                    }
                });

                function updatePointCloudData(newPoints) {
                    // If geometry doesn't exist yet, use initializePointCloud instead
                    if (!geometry) {
                        initializePointCloud(newPoints);
                        return;
                    }
                    
                    points = newPoints;
                    const positions = geometry.attributes.position.array;
                    const colors = geometry.attributes.color.array;
                    
                    // If point count changed, we need to recreate geometry
                    if (newPoints.length !== positions.length / 3) {
                        console.log('Point count changed, recreating geometry');
                        geometry.dispose();
                        const newPositions = new Float32Array(newPoints.length * 3);
                        const newColors = new Float32Array(newPoints.length * 3);
                        
                        newPoints.forEach((p, i) => {
                            newPositions[i * 3] = p.x;
                            newPositions[i * 3 + 1] = p.z;
                            newPositions[i * 3 + 2] = -p.y;
                            newColors[i * 3] = 0.5;
                            newColors[i * 3 + 1] = 0.7;
                            newColors[i * 3 + 2] = 1.0;
                        });
                        
                        geometry.setAttribute('position', new THREE.BufferAttribute(newPositions, 3));
                        geometry.setAttribute('color', new THREE.BufferAttribute(newColors, 3));
                    } else {
                        // Update existing attributes
                        newPoints.forEach((p, i) => {
                            positions[i * 3] = p.x;
                            positions[i * 3 + 1] = p.z;
                            positions[i * 3 + 2] = -p.y;
                        });
                        geometry.attributes.position.needsUpdate = true;
                    }
                    
                    // Update bounds for color mapping
                    minX = Infinity; maxX = -Infinity;
                    minY = Infinity; maxY = -Infinity;
                    minZ = Infinity; maxZ = -Infinity;
                    
                    newPoints.forEach(p => {
                        minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
                        minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
                        minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
                    });
                    
                    // Handle edge case of single point or identical points
                    if (minX === maxX) { minX -= 0.5; maxX += 0.5; }
                    if (minY === maxY) { minY -= 0.5; maxY += 0.5; }
                    if (minZ === maxZ) { minZ -= 0.5; maxZ += 0.5; }
                    
                    // Update info display
                    document.getElementById('pointCount').textContent = newPoints.length;
                    document.getElementById('boundsX').textContent = \`[\${minX.toFixed(2)}, \${maxX.toFixed(2)}]\`;
                    document.getElementById('boundsY').textContent = \`[\${minY.toFixed(2)}, \${maxY.toFixed(2)}]\`;
                    document.getElementById('boundsZ').textContent = \`[\${minZ.toFixed(2)}, \${maxZ.toFixed(2)}]\`;
                    
                    // Re-apply current color mode with new bounds
                    if (currentColorMode !== 'solid') {
                        updateColorbarUI();
                        applyColorsWithLimits();
                    }
                    
                    renderer.render(scene, camera);
                }

                function applyViewState(state) {
                    isSyncing = true;
                    if (state.cameraPosition) {
                        camera.position.set(state.cameraPosition.x, state.cameraPosition.y, state.cameraPosition.z);
                    }
                    if (state.cameraQuaternion) {
                        camera.quaternion.set(state.cameraQuaternion.x, state.cameraQuaternion.y, state.cameraQuaternion.z, state.cameraQuaternion.w);
                    }
                    if (state.cameraUp) {
                        camera.up.set(state.cameraUp.x, state.cameraUp.y, state.cameraUp.z);
                    }
                    if (state.controlsTarget) {
                        controls.target.set(state.controlsTarget.x, state.controlsTarget.y, state.controlsTarget.z);
                    }
                    controls.update();
                    
                    // Force a render immediately after sync
                    renderer.render(scene, camera);
                    updateAxisView();
                    
                    isSyncing = false;
                }

                let lastSyncTime = 0;
                function emitViewChange(force = false) {
                    if (isSyncing || !isInitialized || isShuttingDown) return;
                    const now = Date.now();
                    if (!force && (now - lastSyncTime < 30)) return; // Throttle to ~30fps
                    lastSyncTime = now;
                    
                    vscode.postMessage({
                        command: 'viewChanged',
                        state: {
                            cameraPosition: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
                            cameraQuaternion: { x: camera.quaternion.x, y: camera.quaternion.y, z: camera.quaternion.z, w: camera.quaternion.w },
                            cameraUp: { x: camera.up.x, y: camera.up.y, z: camera.up.z },
                            controlsTarget: { x: controls.target.x, y: controls.target.y, z: controls.target.z }
                        }
                    });
                }

                controls.addEventListener('change', () => {
                    emitViewChange();
                });

                controls.addEventListener('end', () => {
                    emitViewChange(true); // Force a final sync on interaction end
                });

                function animate() {
                    requestAnimationFrame(animate);
                    controls.update();
                    updateAxisView();
                    renderer.render(scene, camera);
                }
                animate();
                
                window.addEventListener('resize', () => {
                    camera.aspect = window.innerWidth / window.innerHeight;
                    camera.updateProjectionMatrix();
                    renderer.setSize(window.innerWidth, window.innerHeight);
                });
                
                // Mark shutting down to block further interactions/sync
                window.addEventListener('beforeunload', () => {
                    isShuttingDown = true;
                });
                document.addEventListener('visibilitychange', () => {
                    if (document.visibilityState === 'hidden') {
                        isShuttingDown = true;
                    }
                });
            </script>
        </body>
        </html>
    `;
}

// Function to generate PLY file content
export function generatePLYContent(points: { x: number; y: number; z: number }[], format: 'binary' | 'ascii' = 'binary'): Uint8Array {
  if (format === 'ascii') {
    let header = `ply
format ascii 1.0
element vertex ${points.length}
property float x
property float y
property float z
end_header\n`;
    let body = points.map(p => `${p.x} ${p.y} ${p.z}`).join("\n");
    return new TextEncoder().encode(header + body);
  } else {
    const header = `ply
format binary_little_endian 1.0
element vertex ${points.length}
property float x
property float y
property float z
end_header\n`;

    const headerBytes = new TextEncoder().encode(header);
    const bodyBytes = new Uint8Array(points.length * 12); // 3 floats * 4 bytes
    const view = new DataView(bodyBytes.buffer);

    for (let i = 0; i < points.length; i++) {
      const offset = i * 12;
      view.setFloat32(offset, points[i].x, true);     // x
      view.setFloat32(offset + 4, points[i].y, true); // y
      view.setFloat32(offset + 8, points[i].z, true); // z
    }

    const combined = new Uint8Array(headerBytes.length + bodyBytes.length);
    combined.set(headerBytes);
    combined.set(bodyBytes, headerBytes.length);
    
    return combined;
  }
}
