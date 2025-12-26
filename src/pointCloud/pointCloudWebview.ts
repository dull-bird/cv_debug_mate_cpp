// Function to generate the webview content for the point cloud
export function getWebviewContentForPointCloud(
  points: { x: number; y: number; z: number }[]
): string {
  const pointsArray = JSON.stringify(points);
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
                    padding: 8px 12px;
                    margin: 3px;
                    border-radius: 4px;
                    cursor: pointer;
                    font-size: 12px;
                }
                #controls button:hover { background: #3a8eef; }
                #controls button.active { background: #2a7edf; }
                #controls label { font-size: 12px; margin-right: 5px; }
                #controls input[type="number"] {
                    width: 60px;
                    padding: 4px;
                    border: 1px solid #555;
                    border-radius: 3px;
                    background: #333;
                    color: white;
                    font-size: 12px;
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
                    background: rgba(0, 0, 0, 0.7);
                    color: white;
                    padding: 10px;
                    border-radius: 5px;
                    display: none;
                }
                #colorbar-gradient {
                    width: 20px;
                    height: 120px;
                    background: linear-gradient(to top, #0000ff, #00ffff, #00ff00, #ffff00, #ff0000);
                    margin-right: 10px;
                }
                #colorbar-labels {
                    display: flex;
                    flex-direction: column;
                    justify-content: space-between;
                    height: 120px;
                    font-size: 11px;
                }
                #colorbar-container { display: flex; }
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
            <div id="info">
                <h3>Point Cloud Viewer</h3>
                <p>Points: <span id="pointCount">0</span></p>
                <p>X (Right): <span id="boundsX">-</span></p>
                <p>Y (Forward): <span id="boundsY">-</span></p>
                <p>Z (Up): <span id="boundsZ">-</span></p>
            </div>
            <div id="controls">
                <div style="margin-bottom: 8px;">
                    <label>Point Size:</label>
                    <input type="number" id="pointSizeInput" value="0.1" step="0.05" min="0.01" max="20">
                </div>
                <div style="margin-bottom: 8px;">
                    <label>PLY Format:</label>
                    <select id="plyFormatSelect" style="background: #333; color: white; border: 1px solid #555; border-radius: 3px; font-size: 12px; padding: 2px;">
                        <option value="binary" selected>Binary</option>
                        <option value="ascii">ASCII</option>
                    </select>
                </div>
                <button id="btnSolid">Solid Color</button>
                <button id="btnHeightZ">Color by Z</button>
                <button id="btnHeightY">Color by Y</button>
                <button id="btnHeightX">Color by X</button>
                <button id="btnResetView">Reset View</button>
                <button id="btnSavePLY" style="margin-top: 8px; background: #28a745;">Save PLY</button>
            </div>
            <div id="axisView"></div>
            <div id="colorbar">
                <div id="colorbar-container">
                    <div id="colorbar-gradient"></div>
                    <div id="colorbar-labels">
                        <span id="colorbar-max">1.0</span>
                        <span id="colorbar-mid">0.5</span>
                        <span id="colorbar-min">0.0</span>
                    </div>
                </div>
            </div>
            <script type="module">
                import * as THREE from 'three';
                import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
                
                let points = ${pointsArray};
                let isInitialized = false;
                let pendingSyncState = null;
                
                // Main scene
                const scene = new THREE.Scene();
                scene.background = new THREE.Color(0x1a1a2e);
                
                const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 100000);
                const renderer = new THREE.WebGLRenderer({ antialias: true });
                renderer.setSize(window.innerWidth, window.innerHeight);
                renderer.autoClear = false;
                document.body.appendChild(renderer.domElement);
                
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

                // Calculate bounds
                let minX = Infinity, maxX = -Infinity;
                let minY = Infinity, maxY = -Infinity;
                let minZ = Infinity, maxZ = -Infinity;
                
                points.forEach(p => {
                    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
                    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
                    minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
                });
                
                document.getElementById('pointCount').textContent = points.length;
                document.getElementById('boundsX').textContent = \`[\${minX.toFixed(2)}, \${maxX.toFixed(2)}]\`;
                document.getElementById('boundsY').textContent = \`[\${minY.toFixed(2)}, \${maxY.toFixed(2)}]\`;
                document.getElementById('boundsZ').textContent = \`[\${minZ.toFixed(2)}, \${maxZ.toFixed(2)}]\`;

                const geometry = new THREE.BufferGeometry();
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
                
                const material = new THREE.PointsMaterial({
                    size: 0.1,
                    vertexColors: true,
                    sizeAttenuation: true
                });
                
                const pointsObj = new THREE.Points(geometry, material);
                scene.add(pointsObj);
                
                // Add helper grid
                const grid = new THREE.GridHelper(100, 100, 0x444444, 0x222222);
                grid.rotation.x = Math.PI / 2;
                // scene.add(grid);

                const controls = new OrbitControls(camera, renderer.domElement);
                
                function resetView() {
                    const centerX = (minX + maxX) / 2;
                    const centerY = (minZ + maxZ) / 2;
                    const centerZ = -(minY + maxY) / 2;
                    
                    const dist = Math.max(maxX - minX, maxY - minY, maxZ - minZ) * 1.5;
                    camera.position.set(centerX + dist, centerY + dist, centerZ + dist);
                    camera.lookAt(centerX, centerY, centerZ);
                    controls.target.set(centerX, centerY, centerZ);
                    controls.update();
                }
                
                isInitialized = true;
                
                if (pendingSyncState) {
                    applyViewState(pendingSyncState);
                    pendingSyncState = null;
                } else {
                    resetView();
                }

                function updateColors(mode) {
                    const colorAttr = geometry.attributes.color;
                    const colorbar = document.getElementById('colorbar');
                    const colorbarMax = document.getElementById('colorbar-max');
                    const colorbarMid = document.getElementById('colorbar-mid');
                    const colorbarMin = document.getElementById('colorbar-min');
                    
                    if (mode === 'solid') {
                        colorbar.style.display = 'none';
                        for (let i = 0; i < points.length; i++) {
                            colorAttr.setXYZ(i, 0.5, 0.7, 1.0);
                        }
                    } else {
                        colorbar.style.display = 'block';
                        let min, max;
                        if (mode === 'x') { min = minX; max = maxX; }
                        else if (mode === 'y') { min = minY; max = maxY; }
                        else if (mode === 'z') { min = minZ; max = maxZ; }
                        
                        colorbarMax.textContent = max.toFixed(2);
                        colorbarMid.textContent = ((min + max) / 2).toFixed(2);
                        colorbarMin.textContent = min.toFixed(2);
                        
                        const range = max - min || 1;
                        for (let i = 0; i < points.length; i++) {
                            const p = points[i];
                            let val;
                            if (mode === 'x') val = p.x;
                            else if (mode === 'y') val = p.y;
                            else if (mode === 'z') val = p.z;
                            
                            const t = (val - min) / range;
                            // Rainbow color map
                            const r = Math.max(0, Math.min(1, 4 * t - 3, 4 * (1 - t)));
                            const g = Math.max(0, Math.min(1, 4 * t - 1, 4 * (2 - t)));
                            const b = Math.max(0, Math.min(1, 4 * t + 1, 4 * (3 - t)));
                            
                            // Using a more standard jet-like colormap
                            let jetR = 0, jetG = 0, jetB = 0;
                            if (t < 0.25) { jetR = 0; jetG = 4 * t; jetB = 1; }
                            else if (t < 0.5) { jetR = 0; jetG = 1; jetB = 1 - 4 * (t - 0.25); }
                            else if (t < 0.75) { jetR = 4 * (t - 0.5); jetG = 1; jetB = 0; }
                            else { jetR = 1; jetG = 1 - 4 * (t - 0.75); jetB = 0; }
                            
                            colorAttr.setXYZ(i, jetR, jetG, jetB);
                        }
                    }
                    colorAttr.needsUpdate = true;
                }

                document.getElementById('btnSolid').onclick = () => updateColors('solid');
                document.getElementById('btnHeightX').onclick = () => updateColors('x');
                document.getElementById('btnHeightY').onclick = () => updateColors('y');
                document.getElementById('btnHeightZ').onclick = () => updateColors('z');
                document.getElementById('btnResetView').onclick = resetView;
                document.getElementById('pointSizeInput').oninput = (e) => {
                    material.size = parseFloat(e.target.value);
                };
                
                const vscode = acquireVsCodeApi();

                document.getElementById('btnSavePLY').onclick = () => {
                    const format = document.getElementById('plyFormatSelect').value;
                    vscode.postMessage({ command: 'savePLY', format: format });
                };

                let isSyncing = false;
                window.addEventListener('message', event => {
                    const message = event.data;
                    if (message.command === 'setView') {
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
                    
                    // Update info display
                    document.getElementById('pointCount').textContent = newPoints.length;
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
                    if (isSyncing || !isInitialized) return;
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
