import * as vscode from "vscode";
import * as path from "path";

async function evaluateWithTimeout(
  debugSession: vscode.DebugSession,
  expression: string,
  frameId: number,
  timeout: number
): Promise<any> {
  return Promise.race([
    debugSession.customRequest("evaluate", {
      expression: expression,
      frameId: frameId,
      context: "repl",
    }),
    new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error("Evaluation request timed out")),
        timeout
      )
    ),
  ]);
}

export function activate(context: vscode.ExtensionContext) {
  console.log('Extension "vectorPoint3fViewer" is now active.');

  // Register the command to visualize the vector of cv::Point3f or cv::Mat
  let disposable = vscode.commands.registerCommand(
    "extension.viewVariable",
    async (selectedVariable: any) => {
      const debugSession = vscode.debug.activeDebugSession;

      if (!debugSession) {
        vscode.window.showErrorMessage("No active debug session.");
        return;
      }

      try {
        // Access the nested 'variable' property
        const variable = selectedVariable.variable;

        if (!variable || (!variable.name && !variable.evaluateName)) {
          vscode.window.showErrorMessage("No variable selected.");
          console.log(
            "No variable selected. Nested variable object:",
            variable
          );
          return;
        }

        const variableName = variable.evaluateName || variable.name;
        console.log("Selected variable name:", variableName);

        // Get the current thread and stack frame
        const threadsResponse = await debugSession.customRequest("threads");
        const threadId = threadsResponse.threads[0].id;
        const stackTraceResponse = await debugSession.customRequest(
          "stackTrace",
          {
            threadId: threadId,
            startFrame: 0,
            levels: 20,
          }
        );
        const frameId = stackTraceResponse.stackFrames[0].id;

        // Evaluate the selected variable
        const variableInfo = await debugSession.customRequest("evaluate", {
          expression: variableName,
          frameId: frameId,
          context: "repl",
        });
        console.log("Evaluated variable info:", variableInfo);

        // Check the type of the variable
        if (isPoint3fVector(variableInfo)) {
          // If it's a vector of cv::Point3f, draw the point cloud
          await drawPointCloud(debugSession, variableInfo);
        } else if (isMat(variableInfo)) {
          // If it's a cv::Mat, draw the image
          await drawMatImage(debugSession, variableInfo, frameId, variableName);
        } else {
          vscode.window.showErrorMessage(
            "Variable is neither a vector of cv::Point3f nor a cv::Mat."
          );
          console.log("Variable type check failed. Type:", variableInfo.type);
        }
      } catch (error) {
        vscode.window.showErrorMessage(`Error: ${error}`);
        console.log("Error during execution:", error);
      }
    }
  );

  context.subscriptions.push(disposable);
}

// Function to check if the variable is a vector of cv::Point3f
function isPoint3fVector(variableInfo: any): boolean {
  console.log("Checking if variable is Point3f vector");
  const type = variableInfo.type || "";
  console.log("Variable type string:", type);
  
  const result = 
    type.includes("std::vector<cv::Point3f>") ||
    type.includes("std::vector<cv::Point3_<float>") ||
    type.includes("std::vector<cv::Point3d>") ||
    type.includes("std::vector<cv::Point3_<double>") ||
    // LLDB format
    type.includes("std::__1::vector<cv::Point3_<float>") ||
    type.includes("std::__1::vector<cv::Point3_<double>") ||
    // cppdbg format
    type.includes("class std::vector<class cv::Point3_<float>") ||
    type.includes("class std::vector<class cv::Point3_<double>") ||
    // Generic format for both LLDB and VS
    /std::.*vector\s*<\s*cv::Point3[fd]?\s*>/.test(type);
  
  console.log("isPoint3fVector result:", result);
  return result;
}

// Function to check if the variable is a cv::Mat
function isMat(variableInfo: any): boolean {
  console.log("Checking if variable is Mat");
  const type = variableInfo.type || "";
  console.log("Variable type string:", type);
  
  const result = 
    type.includes("cv::Mat") ||
    // LLDB format sometimes includes namespace
    type.includes("class cv::Mat") ||
    // cppdbg format
    type.includes("class cv::Mat") ||
    // Generic format
    /cv::Mat\b/.test(type);
  
  console.log("isMat result:", result);
  return result;
}

// Helper function to check if we're using LLDB
function isUsingLLDB(debugSession: vscode.DebugSession): boolean {
  return debugSession.type === "lldb";
}

// Helper function to check if we're using cppdbg
function isUsingCppdbg(debugSession: vscode.DebugSession): boolean {
  return debugSession.type === "cppdbg";
}

// Function to draw point cloud
async function drawPointCloud(debugSession: vscode.DebugSession, variableInfo: any) {
  try {
    const usingLLDB = isUsingLLDB(debugSession);
    const usingCppdbg = isUsingCppdbg(debugSession);
    console.log("Drawing point cloud with debugger type:", debugSession.type);
    console.log("Using LLDB mode:", usingLLDB);
    console.log("Using cppdbg mode:", usingCppdbg);

    // Get the number of elements in the vector
    const sizeResponse = await evaluateWithTimeout(
      debugSession,
      `${variableInfo.evaluateName}.size()`,
      variableInfo.frameId || 0,
      5000
    );
    const size = parseInt(sizeResponse.result);

    let points: { x: number; y: number; z: number }[] = [];

    for (let i = 0; i < size; i++) {
      // Adjust expression based on debugger type
      const pointExpression = usingCppdbg
        ? `${variableInfo.evaluateName}[${i}]`
        : `${variableInfo.evaluateName}.at(${i})`;

      const pointResponse = await evaluateWithTimeout(
        debugSession,
        pointExpression,
        variableInfo.frameId || 0,
        5000
      );

      // Extract x, y, z values using regular expressions
      const matches = pointResponse.result.match(
        /[{(]?\s*x\s*[=:]\s*([-+]?[0-9]*\.?[0-9]+)\s*,?\s*y\s*[=:]\s*([-+]?[0-9]*\.?[0-9]+)\s*,?\s*z\s*[=:]\s*([-+]?[0-9]*\.?[0-9]+)\s*[})]?/
      );

      if (matches) {
        points.push({
          x: parseFloat(matches[1]),
          y: parseFloat(matches[2]),
          z: parseFloat(matches[3]),
        });
      }
    }

    // Show the webview to visualize the points
    const panel = vscode.window.createWebviewPanel(
      "3DPointViewer",
      "3D Point Viewer",
      vscode.ViewColumn.One,
      {
        enableScripts: true,
      }
    );
    panel.webview.html = getWebviewContentForPointCloud(points);
  } catch (error) {
    console.error("Error in drawPointCloud:", error);
    throw error;
  }
}

// Get bytes per element based on depth
function getBytesPerElement(depth: number): number {
  switch (depth) {
    case 0: // CV_8U
    case 1: // CV_8S
      return 1;
    case 2: // CV_16U
    case 3: // CV_16S
      return 2;
    case 4: // CV_32S
    case 5: // CV_32F
      return 4;
    case 6: // CV_64F
      return 8;
    default:
      return 1;
  }
}

// Fast batch read using memory read with progress
async function readMatDataFast(
  debugSession: vscode.DebugSession,
  dataExp: string,
  frameId: number,
  dataSize: number,
  depth: number,
  progress: vscode.Progress<{ message?: string; increment?: number }>
): Promise<number[]> {
  const data: number[] = [];
  const bytesPerElement = getBytesPerElement(depth);
  
  // Batch size: read multiple elements at once to reduce requests
  // For 8-bit images, read 1024 elements per batch
  // For larger types, reduce batch size accordingly
  const batchSize = Math.min(1024, Math.floor(4096 / bytesPerElement));
  const totalBatches = Math.ceil(dataSize / batchSize);
  
  let dataType: string;
  switch (depth) {
    case 0: dataType = "unsigned char"; break;
    case 1: dataType = "char"; break;
    case 2: dataType = "unsigned short"; break;
    case 3: dataType = "short"; break;
    case 4: dataType = "int"; break;
    case 5: dataType = "float"; break;
    case 6: dataType = "double"; break;
    default: dataType = "unsigned char";
  }

  console.log(`Reading ${dataSize} elements in ${totalBatches} batches (batch size: ${batchSize})`);

  for (let batch = 0; batch < totalBatches; batch++) {
    const startIdx = batch * batchSize;
    const endIdx = Math.min(startIdx + batchSize, dataSize);
    const currentBatchSize = endIdx - startIdx;

    // Update progress
    const percentComplete = Math.round((batch / totalBatches) * 100);
    progress.report({ 
      message: `Reading pixels: ${percentComplete}% (${startIdx}/${dataSize})`,
      increment: (1 / totalBatches) * 100
    });

    // Try to read batch using array format expression
    // This creates a single expression that returns multiple values
    try {
      // Use a format that returns comma-separated values
      // Different debuggers support different batch read methods
      const batchValues = await readBatchValues(
        debugSession,
        dataExp,
        dataType,
        startIdx,
        currentBatchSize,
        frameId,
        depth
      );
      data.push(...batchValues);
    } catch (error) {
      console.warn(`Batch read failed at ${startIdx}, falling back to individual reads:`, error);
      // Fallback: read elements individually for this batch
      for (let i = startIdx; i < endIdx; i++) {
        try {
          const response = await evaluateWithTimeout(
            debugSession,
            `((${dataType}*)${dataExp})[${i}]`,
            frameId,
            2000
          );
          let value = parseNumericResult(response.result, depth);
          data.push(value);
        } catch {
          data.push(0);
        }
      }
    }
  }

  return data;
}

// Read a batch of values - optimized for speed
async function readBatchValues(
  debugSession: vscode.DebugSession,
  dataExp: string,
  dataType: string,
  startIdx: number,
  count: number,
  frameId: number,
  depth: number
): Promise<number[]> {
  const values: number[] = [];
  
  // Strategy 1: Try using readMemory if available (fastest)
  try {
    const bytesPerElement = getBytesPerElement(depth);
    const dataPointerResponse = await evaluateWithTimeout(
      debugSession,
      dataExp,
      frameId,
      2000
    );
    
    // Parse pointer address
    const ptrMatch = dataPointerResponse.result.match(/0x([0-9a-fA-F]+)/);
    if (ptrMatch) {
      const baseAddress = ptrMatch[0];
      const offsetBytes = startIdx * bytesPerElement;
      const readBytes = count * bytesPerElement;
      
      // Calculate address with offset
      const addressNum = BigInt(baseAddress) + BigInt(offsetBytes);
      const targetAddress = "0x" + addressNum.toString(16);
      
      try {
        const memoryResponse = await debugSession.customRequest("readMemory", {
          memoryReference: targetAddress,
          count: readBytes
        });
        
        if (memoryResponse && memoryResponse.data) {
          // Decode base64 data
          const buffer = Buffer.from(memoryResponse.data, 'base64');
          return parseMemoryBuffer(buffer, depth, count);
        }
      } catch (memError) {
        // readMemory not supported, fall through to strategy 2
        console.log("readMemory not available, using evaluate fallback");
      }
    }
  } catch (e) {
    // Fall through to strategy 2
  }
  
  // Strategy 2: Parallel evaluate requests (faster than sequential)
  const PARALLEL_BATCH = 50; // Number of parallel requests
  for (let i = 0; i < count; i += PARALLEL_BATCH) {
    const parallelCount = Math.min(PARALLEL_BATCH, count - i);
    const promises: Promise<any>[] = [];
    
    for (let j = 0; j < parallelCount; j++) {
      const idx = startIdx + i + j;
      promises.push(
        evaluateWithTimeout(
          debugSession,
          `((${dataType}*)${dataExp})[${idx}]`,
          frameId,
          2000
        ).catch(() => ({ result: "0" }))
      );
    }
    
    const results = await Promise.all(promises);
    for (const response of results) {
      values.push(parseNumericResult(response.result, depth));
    }
  }
  
  return values;
}

// Parse memory buffer based on depth type
function parseMemoryBuffer(buffer: Buffer, depth: number, count: number): number[] {
  const values: number[] = [];
  
  for (let i = 0; i < count; i++) {
    let value: number;
    switch (depth) {
      case 0: // CV_8U
        value = buffer.readUInt8(i);
        break;
      case 1: // CV_8S
        value = buffer.readInt8(i);
        break;
      case 2: // CV_16U
        value = buffer.readUInt16LE(i * 2);
        break;
      case 3: // CV_16S
        value = buffer.readInt16LE(i * 2);
        break;
      case 4: // CV_32S
        value = buffer.readInt32LE(i * 4);
        break;
      case 5: // CV_32F
        value = buffer.readFloatLE(i * 4);
        value = Math.round(value * 255); // Normalize to 0-255
        break;
      case 6: // CV_64F
        value = buffer.readDoubleLE(i * 8);
        value = Math.round(value * 255); // Normalize to 0-255
        break;
      default:
        value = buffer.readUInt8(i);
    }
    values.push(value);
  }
  
  return values;
}

// Parse numeric result from evaluate response
function parseNumericResult(result: string, depth: number): number {
  let value: number;
  if (depth === 5 || depth === 6) {
    value = parseFloat(result);
    if (!isNaN(value)) {
      value = Math.round(value * 255);
    } else {
      value = 0;
    }
  } else {
    value = parseInt(result);
    if (isNaN(value)) {
      value = 0;
    }
  }
  return value;
}

// Function to draw the cv::Mat image
async function drawMatImage(
  debugSession: vscode.DebugSession,
  variableInfo: any,
  frameId: number,
  variableName: string
) {
  try {
    const usingLLDB = isUsingLLDB(debugSession);
    const usingCppdbg = isUsingCppdbg(debugSession);
    console.log("Drawing Mat image with debugger type:", debugSession.type);
    
    const rowsExp = `${variableName}.rows`;
    const colsExp = `${variableName}.cols`;
    const channelsExp = `${variableName}.channels()`;
    const depthExp = `${variableName}.depth()`;
    const dataExp = `${variableName}.data`;

    // Get matrix dimensions in parallel
    const [rowsResponse, colsResponse, channelsResponse, depthResponse] = await Promise.all([
      evaluateWithTimeout(debugSession, rowsExp, frameId, 5000),
      evaluateWithTimeout(debugSession, colsExp, frameId, 5000),
      evaluateWithTimeout(debugSession, channelsExp, frameId, 5000),
      evaluateWithTimeout(debugSession, depthExp, frameId, 5000)
    ]);

    const rows = parseInt(rowsResponse.result);
    const cols = parseInt(colsResponse.result);
    const channels = parseInt(channelsResponse.result);
    const depth = parseInt(depthResponse.result);

    console.log(`Matrix info: ${rows}x${cols}, ${channels} channels, depth=${depth}`);

    if (isNaN(rows) || isNaN(cols) || isNaN(channels) || isNaN(depth)) {
      throw new Error("Invalid matrix dimensions or type");
    }

    if (rows <= 0 || cols <= 0) {
      throw new Error("Matrix is empty");
    }

    const dataSize = rows * cols * channels;
    console.log(`Total data size: ${dataSize} elements`);

    // Read data with progress indicator
    const data = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "Loading OpenCV Mat",
        cancellable: false
      },
      async (progress) => {
        progress.report({ message: "Starting to read pixel data..." });
        return await readMatDataFast(
          debugSession,
          dataExp,
          frameId,
          dataSize,
          depth,
          progress
        );
      }
    );

    // Show the webview to visualize the matrix as an image
    const panel = vscode.window.createWebviewPanel(
      "MatImageViewer",
      "Matrix Image Viewer",
      vscode.ViewColumn.One,
      {
        enableScripts: true,
      }
    );
    panel.webview.html = getWebviewContentForMat(
      panel.webview,
      rows,
      cols,
      channels,
      depth,
      data
    );
  } catch (error) {
    console.error("Error drawing Mat image:", error);
    throw error;
  }
}

// Function to generate the webview content for the point cloud
function getWebviewContentForPointCloud(
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
            <style> body { margin: 0; } canvas { display: block; } </style>
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
            <script type="module">
                import * as THREE from 'three';
                import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
                const points = ${pointsArray};
                const scene = new THREE.Scene();
                const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
                const renderer = new THREE.WebGLRenderer();
                renderer.setSize(window.innerWidth, window.innerHeight);
                document.body.appendChild(renderer.domElement);

                const geometry = new THREE.BufferGeometry();
                const vertices = [];
                points.forEach(point => {
                    vertices.push(point.x, point.y, point.z);
                });
                geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
                const material = new THREE.PointsMaterial({ color: 0x00ff00, size: 0.2 });
                const pointsObject = new THREE.Points(geometry, material);
                scene.add(pointsObject);

                camera.position.set(5, 5, 5);
                camera.lookAt(scene.position);

                const controls = new OrbitControls(camera, renderer.domElement);
                controls.enableDamping = true;
                controls.dampingFactor = 0.25;
                controls.enableZoom = true;

                window.addEventListener('resize', () => {
                    camera.aspect = window.innerWidth / window.innerHeight;
                    camera.updateProjectionMatrix();
                    renderer.setSize(window.innerWidth, window.innerHeight);
                });

                function animate() {
                    requestAnimationFrame(animate);
                    controls.update();
                    renderer.render(scene, camera);
                }
                animate();
            </script>
        </body>
        </html>
    `;
}


  // You need to implement this function to generate a nonce
  function getNonce() {
      let text = '';
      const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
      for (let i = 0; i < 32; i++) {
          text += possible.charAt(Math.floor(Math.random() * possible.length));
      }
      return text;
  }


  function getWebviewContentForMat(
    webview: vscode.Webview,
    rows: number,
    cols: number,
    channels: number,
    depth: number,
    data: number[]
  ): string {
    const imageData = JSON.stringify(data);
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
              }
              button { 
                  margin-right: 5px; 
                  padding: 5px 10px; 
                  cursor: pointer;
                  border: 1px solid #ccc;
                  border-radius: 3px;
                  background: white;
              }
              button:hover { background: #f0f0f0; }
              #container { position: relative; width: 100vw; height: 100vh; overflow: hidden; }
              canvas { position: absolute; top: 0; left: 0; }
              #grid-canvas { 
                  position: absolute; 
                  top: 0; 
                  left: 0; 
                  pointer-events: none;
                  z-index: 1;
              }
          </style>
      </head>
      <body>
          <div id="container">
              <canvas id="canvas"></canvas>
              <canvas id="grid-canvas"></canvas>
          </div>
          <div id="controls">
              <button id="zoomIn">Zoom In</button>
              <button id="zoomOut">Zoom Out</button>
              <button id="reset">Reset</button>
              <span id="zoomLevel">Zoom: 100%</span>
          </div>
          <div id="pixelInfo"></div>
          <script nonce="${nonce}">
              (function() {
                  const container = document.getElementById('container');
                  const canvas = document.getElementById('canvas');
                  const gridCanvas = document.getElementById('grid-canvas');
                  const ctx = canvas.getContext('2d');
                  const gridCtx = gridCanvas.getContext('2d');
                  const pixelInfo = document.getElementById('pixelInfo');
                  const zoomLevelDisplay = document.getElementById('zoomLevel');
                  const controls = document.getElementById('controls');
                  
                  const rows = ${rows};
                  const cols = ${cols};
                  const channels = ${channels};
                  const data = ${imageData};
                  
                  let scale = 1;
                  let isDragging = false;
                  let startX = 0;
                  let startY = 0;
                  let offsetX = 0;
                  let offsetY = 0;

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

                  // Create off-screen canvas for the original image
                  const offscreenCanvas = document.createElement('canvas');
                  offscreenCanvas.width = cols;
                  offscreenCanvas.height = rows;
                  const offscreenCtx = offscreenCanvas.getContext('2d');
                  const imgData = offscreenCtx.createImageData(cols, rows);

                  // Fill image data
                  for (let i = 0; i < rows; i++) {
                      for (let j = 0; j < cols; j++) {
                          const idx = (i * cols + j) * channels;
                          const pixelIdx = (i * cols + j) * 4;

                          if (channels === 1) {
                              // Grayscale
                              const value = data[idx];
                              imgData.data[pixelIdx] = value;
                              imgData.data[pixelIdx + 1] = value;
                              imgData.data[pixelIdx + 2] = value;
                              imgData.data[pixelIdx + 3] = 255;
                          } else if (channels === 3) {
                              // RGB
                              imgData.data[pixelIdx] = data[idx];
                              imgData.data[pixelIdx + 1] = data[idx + 1];
                              imgData.data[pixelIdx + 2] = data[idx + 2];
                              imgData.data[pixelIdx + 3] = 255;
                          }
                      }
                  }
                  
                  // Put the image data on the offscreen canvas
                  offscreenCtx.putImageData(imgData, 0, 0);

                  function updateCanvasSize() {
                      const containerRect = container.getBoundingClientRect();
                      canvas.width = containerRect.width;
                      canvas.height = containerRect.height;
                      gridCanvas.width = containerRect.width;
                      gridCanvas.height = containerRect.height;
                  }

                  function drawGrid() {
                      if (scale >= 10) {
                          gridCtx.clearRect(0, 0, gridCanvas.width, gridCanvas.height);
                          gridCtx.strokeStyle = 'rgba(128, 128, 128, 0.5)';
                          gridCtx.lineWidth = 0.5;
                          
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
                          gridCtx.clearRect(0, 0, gridCanvas.width, gridCanvas.height);
                      }
                  }

                  function draw() {
                      ctx.clearRect(0, 0, canvas.width, canvas.height);
                      
                      // Calculate scaled dimensions
                      const scaledWidth = cols * scale;
                      const scaledHeight = rows * scale;
                      
                      // Draw from top-left corner with offset
                      const x = offsetX;
                      const y = offsetY;
                      
                      ctx.imageSmoothingEnabled = scale < 4; // Disable smoothing when zoomed in
                      ctx.drawImage(offscreenCanvas, x, y, scaledWidth, scaledHeight);
                      
                      // Draw grid when zoomed in
                      drawGrid();
                      
                      // Update zoom level display
                      zoomLevelDisplay.textContent = \`Zoom: \${Math.round(scale * 100)}%\`;
                  }

                  function setZoom(newScale) {
                      scale = Math.max(0.1, Math.min(50, newScale)); // Increased max zoom to 50x
                      draw();
                  }

                  // Event Listeners
                  document.getElementById('zoomIn').addEventListener('click', () => {
                      setZoom(scale * 1.5); // Increased zoom factor
                  });

                  document.getElementById('zoomOut').addEventListener('click', () => {
                      setZoom(scale / 1.5);
                  });

                  document.getElementById('reset').addEventListener('click', () => {
                      scale = 1;
                      offsetX = 0;
                      offsetY = 0;
                      draw();
                  });

                  canvas.addEventListener('wheel', (e) => {
                      e.preventDefault();
                      const zoomFactor = e.deltaY > 0 ? 0.8 : 1.25; // Adjusted zoom speed
                      setZoom(scale * zoomFactor);
                  });

                  canvas.addEventListener('mousedown', (e) => {
                      if (e.target === canvas) {
                          isDragging = true;
                          startX = e.clientX - offsetX;
                          startY = e.clientY - offsetY;
                      }
                  });

                  canvas.addEventListener('mousemove', (e) => {
                      if (isDragging) {
                          offsetX = e.clientX - startX;
                          offsetY = e.clientY - startY;
                          draw();
                      }

                      // Update pixel info
                      const rect = canvas.getBoundingClientRect();
                      const mouseX = e.clientX - rect.left;
                      const mouseY = e.clientY - rect.top;
                      
                      // Convert mouse coordinates to image coordinates
                      const imageX = Math.floor((mouseX - offsetX) / scale);
                      const imageY = Math.floor((mouseY - offsetY) / scale);

                      if (imageX >= 0 && imageX < cols && imageY >= 0 && imageY < rows) {
                          const idx = (imageY * cols + imageX) * channels;
                          let pixelInfoText = \`Position: (\${imageX}, \${imageY}) | \`;

                          if (channels === 1) {
                              const value = data[idx];
                              pixelInfoText += \`Grayscale: \${value}\`;
                          } else if (channels === 3) {
                              const r = data[idx];
                              const g = data[idx + 1];
                              const b = data[idx + 2];
                              pixelInfoText += \`RGB: (\${r}, \${g}, \${b})\`;
                          }

                          pixelInfo.textContent = pixelInfoText;
                      } else {
                          pixelInfo.textContent = '';
                      }
                  });

                  canvas.addEventListener('mouseup', () => {
                      isDragging = false;
                  });

                  canvas.addEventListener('mouseleave', () => {
                      isDragging = false;
                  });

                  window.addEventListener('resize', () => {
                      updateCanvasSize();
                      draw();
                  });

                  // Initialize
                  updateCanvasSize();
                  draw();
              })();
          </script>
      </body>
      </html>
    `;
  }

export function deactivate() {}
