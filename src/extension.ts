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
  return (
    variableInfo.type &&
    (variableInfo.type.includes("std::vector<cv::Point3f>") ||
      variableInfo.type.includes("std::vector<cv::Point3_<float>") ||
      variableInfo.type.includes("std::vector<cv::Point3d>") ||
      variableInfo.type.includes("std::vector<cv::Point3_<double>"))
  );
}

// Function to check if the variable is a cv::Mat
function isMat(variableInfo: any): boolean {
  return variableInfo.type && variableInfo.type.includes("cv::Mat");
}

// Function to draw point cloud
async function drawPointCloud(
  debugSession: vscode.DebugSession,
  variableInfo: any
) {
  // Retrieve the elements of the vector
  const elementsResponse = await debugSession.customRequest("variables", {
    variablesReference: variableInfo.variablesReference,
  });
  console.log("Elements of the vector:", elementsResponse);

  let points: { x: number; y: number; z: number }[] = [];

  // Extract points assuming it's a vector<cv::Point3f>
  elementsResponse.variables.forEach((element: any) => {
    if (
      element.value &&
      element.value.includes("x=") &&
      element.value.includes("y=") &&
      element.value.includes("z=")
    ) {
      const matches = element.value.match(
        /x=([-+]?[0-9]*\.?[0-9]+) y=([-+]?[0-9]*\.?[0-9]+) z=([-+]?[0-9]*\.?[0-9]+)/
      );
      if (matches) {
        points.push({
          x: parseFloat(matches[1]),
          y: parseFloat(matches[2]),
          z: parseFloat(matches[3]),
        });
      }
    }
  });

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
}

// Function to draw the cv::Mat image
async function drawMatImage(
  debugSession: vscode.DebugSession,
  variableInfo: any,
  frameId: number,
  variableName: string
) {
  try {
    // Check if evaluateName is available
    // const variableName = variableInfo.evaluateName || variableInfo.name;
    // if (!variableName) {
    //     console.error("The variable does not have a valid evaluateName or name.");
    //     return;
    // }

    // Get the type of the variable and print it
    // const depthResponse = await debugSession.customRequest("evaluate", {
    //     expression: `${variableName}.depth()`,
    //     frameId: frameId, // Use the provided frame ID
    //     context: "repl" // Use "repl" context since it worked in the console
    // });

    // const depthResponse = await evaluateWithTimeout(debugSession, `${variableName}.depth()`, frameId, 5000);

    // try {
    //     // Evaluate the `.type()` method with a 5-second timeout
    //     const depthResponse = await evaluateWithTimeout(debugSession, `${variableName}.type()`, frameId, 5000);
    //     console.log("cv::Mat type (int):", variableTypeResponse.result);
    // } catch (error) {
    //     console.error("Error evaluating variable type():", error);
    //     return; // Early return if there was an error during evaluation
    // }

    // const depth = parseInt(depthResponse.result);

    // const channelsResponse = await debugSession.customRequest("evaluate", {
    //     expression: `${variableName}.channels()`,
    //     frameId: frameId, // Use the provided frame ID
    //     context: "repl" // Use "repl" context since it worked in the console
    // });
    // const channelsResponse = await evaluateWithTimeout(debugSession, `${variableName}.channels()`, frameId, 5000);
    // const channels = parseInt(channelsResponse.result);

    // Retrieve the `flags` property of the cv::Mat
    const flagsResponse = await debugSession.customRequest("evaluate", {
      expression: `${variableName}.flags`,
      frameId: frameId,
      context: "repl",
    });
    const flags = parseInt(flagsResponse.result);

    // Define macros in JavaScript
    const CV_CN_SHIFT = 3;
    const CV_CN_MAX = 512;
    const CV_MAT_CN_MASK = (CV_CN_MAX - 1) << CV_CN_SHIFT;
    const CV_DEPTH_MAX = 1 << CV_CN_SHIFT;
    const CV_MAT_DEPTH_MASK = CV_DEPTH_MAX - 1;

    // Extract the number of channels using the macro
    const channels = ((flags & CV_MAT_CN_MASK) >> CV_CN_SHIFT) + 1;

    // Extract the depth using the macro
    const depth = flags & CV_MAT_DEPTH_MASK;

    console.log(`Number of channels: ${channels}, Depth: ${depth}`);

    // Retrieve the cv::Mat properties
    const matPropertiesResponse = await debugSession.customRequest(
      "variables",
      {
        variablesReference: variableInfo.variablesReference,
      }
    );

    let rows = 0,
      cols = 0,
      dataAddress = "";

    // Extract rows, cols, and data address from matPropertiesResponse
    for (const property of matPropertiesResponse.variables) {
      if (property.name === "rows") {
        rows = parseInt(property.value);
      } else if (property.name === "cols") {
        cols = parseInt(property.value);
      } else if (property.name === "data") {
        dataAddress = property.memoryReference;
      }
    }

    if (rows === 0 || cols === 0 || !dataAddress) {
      vscode.window.showErrorMessage("Failed to retrieve matrix data.");
      return;
    }

    // Read matrix data (assuming it's an 8-bit single-channel image)
    const dataResponse = await debugSession.customRequest("readMemory", {
      memoryReference: dataAddress,
      offset: 0,
      count: rows * cols * channels,
    });
    if (!dataResponse || !dataResponse.data) {
      vscode.window.showErrorMessage("Failed to read matrix memory.");
      return;
    }

    // Decode the matrix data (Base64 to binary)
    const buffer = Buffer.from(dataResponse.data, "base64");
    const data = Array.from(buffer);

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
    console.error("Error evaluating variable type():", error);
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
              #controls { position: absolute; top: 10px; left: 10px; }
              #pixelInfo { position: absolute; bottom: 10px; left: 10px; background: rgba(255,255,255,0.7); color: black; padding: 5px; }
              button { margin-right: 5px; padding: 5px 10px; }
          </style>
      </head>
      <body>
          <canvas id="canvas"></canvas>
          <div id="controls">
              <button id="zoomIn">Zoom In</button>
              <button id="zoomOut">Zoom Out</button>
              <button id="reset">Reset</button>
          </div>
          <div id="pixelInfo"></div>
          <script nonce="${nonce}">
              // Your JavaScript code here (unchanged)
              (function() {
                  const vscode = acquireVsCodeApi();
                  const rows = ${rows};
                  const cols = ${cols};
                  const channels = ${channels};
                  const depth = ${depth};
                  const data = ${imageData};
  
                  const canvas = document.getElementById('canvas');
                  const ctx = canvas.getContext('2d');
                  const pixelInfo = document.getElementById('pixelInfo');
  
                  let state = vscode.getState() || { scale: 1, offsetX: 0, offsetY: 0 };
                  let { scale, offsetX, offsetY } = state;
  
                  canvas.width = window.innerWidth;
                  canvas.height = window.innerHeight;
  
                  const imageData = new ImageData(cols, rows);
  
                  function updateImageData() {
                      for (let i = 0; i < rows; i++) {
                          for (let j = 0; j < cols; j++) {
                              const idx = (i * cols + j) * channels;
                              const pixelIdx = (i * cols + j) * 4;
  
                              if (channels === 1) {
                                  // Grayscale
                                  const value = data[idx];
                                  imageData.data[pixelIdx] = value;
                                  imageData.data[pixelIdx + 1] = value;
                                  imageData.data[pixelIdx + 2] = value;
                                  imageData.data[pixelIdx + 3] = 255;
                              } else if (channels === 3) {
                                  // RGB
                                  imageData.data[pixelIdx] = data[idx];
                                  imageData.data[pixelIdx + 1] = data[idx + 1];
                                  imageData.data[pixelIdx + 2] = data[idx + 2];
                                  imageData.data[pixelIdx + 3] = 255;
                              }
                          }
                      }
                  }
  
                  function drawImage() {
                      ctx.clearRect(0, 0, canvas.width, canvas.height);
                      ctx.save();
                      ctx.translate(offsetX, offsetY);
                      ctx.scale(scale, scale);
                      ctx.imageSmoothingEnabled = false;
                      ctx.putImageData(imageData, 0, 0);
                      ctx.restore();
                  }
  
                  function zoom(factor) {
                      const zoomPoint = {
                          x: canvas.width / 2 - offsetX,
                          y: canvas.height / 2 - offsetY
                      };
  
                      scale *= factor;
                      offsetX = zoomPoint.x - (zoomPoint.x - offsetX) * factor;
                      offsetY = zoomPoint.y - (zoomPoint.y - offsetY) * factor;
  
                      state = { scale, offsetX, offsetY };
                      vscode.setState(state);
  
                      drawImage();
                  }
  
                  document.getElementById('zoomIn').addEventListener('click', () => zoom(1.2));
                  document.getElementById('zoomOut').addEventListener('click', () => zoom(0.8));
                  document.getElementById('reset').addEventListener('click', () => {
                      scale = 1;
                      offsetX = 0;
                      offsetY = 0;
                      state = { scale, offsetX, offsetY };
                      vscode.setState(state);
                      drawImage();
                  });
  
                  canvas.addEventListener('mousemove', (e) => {
                      const rect = canvas.getBoundingClientRect();
                      const x = Math.floor((e.clientX - rect.left - offsetX) / scale);
                      const y = Math.floor((e.clientY - rect.top - offsetY) / scale);
  
                      if (x >= 0 && x < cols && y >= 0 && y < rows) {
                          const idx = (y * cols + x) * channels;
                          let pixelInfoText = \`Position: (\${x}, \${y}) | \`;
  
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
  
                  canvas.addEventListener('wheel', (e) => {
                      e.preventDefault();
                      const rect = canvas.getBoundingClientRect();
                      const mouseX = e.clientX - rect.left;
                      const mouseY = e.clientY - rect.top;
  
                      const factor = e.deltaY > 0 ? 0.9 : 1.1;
  
                      const zoomPoint = {
                          x: mouseX - offsetX,
                          y: mouseY - offsetY
                      };
  
                      scale *= factor;
                      offsetX = mouseX - zoomPoint.x * factor;
                      offsetY = mouseY - zoomPoint.y * factor;
  
                      state = { scale, offsetX, offsetY };
                      vscode.setState(state);
  
                      drawImage();
                  });
  
                  let isDragging = false;
                  let lastX, lastY;
  
                  canvas.addEventListener('mousedown', (e) => {
                      isDragging = true;
                      lastX = e.clientX;
                      lastY = e.clientY;
                  });
  
                  canvas.addEventListener('mousemove', (e) => {
                      if (isDragging) {
                          offsetX += e.clientX - lastX;
                          offsetY += e.clientY - lastY;
                          lastX = e.clientX;
                          lastY = e.clientY;
  
                          state = { scale, offsetX, offsetY };
                          vscode.setState(state);
  
                          drawImage();
                      }
                  });
  
                  canvas.addEventListener('mouseup', () => {
                      isDragging = false;
                  });
  
                  window.addEventListener('resize', () => {
                      canvas.width = window.innerWidth;
                      canvas.height = window.innerHeight;
                      drawImage();
                  });
  
                  updateImageData();
                  drawImage();
  
                  // Handle messages from the extension
                  window.addEventListener('message', event => {
                      const message = event.data;
                      switch (message.command) {
                          case 'update':
                              // Handle update message
                              break;
                      }
                  });
              })();
          </script>
      </body>
      </html>
    `;
  }


export function deactivate() {}
