import * as vscode from "vscode";
import * as path from "path";

export function activate(context: vscode.ExtensionContext) {
    console.log('Extension "vectorPoint3fViewer" is now active.');

    // Register the command to visualize the vector of cv::Point3f or cv::Mat
    let disposable = vscode.commands.registerCommand("extension.viewVariable", async (selectedVariable: any) => {
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
                console.log("No variable selected. Nested variable object:", variable);
                return;
            }

            const variableName = variable.evaluateName || variable.name;
            console.log("Selected variable name:", variableName);

            // Get the current thread and stack frame
            const threadsResponse = await debugSession.customRequest("threads");
            const threadId = threadsResponse.threads[0].id;
            const stackTraceResponse = await debugSession.customRequest("stackTrace", {
                threadId: threadId,
                startFrame: 0,
                levels: 20,
            });
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
                await drawMatImage(debugSession, variableInfo);
            } else {
                vscode.window.showErrorMessage("Variable is neither a vector of cv::Point3f nor a cv::Mat.");
                console.log("Variable type check failed. Type:", variableInfo.type);
            }
        } catch (error) {
            vscode.window.showErrorMessage(`Error: ${error}`);
            console.log("Error during execution:", error);
        }
    });

    context.subscriptions.push(disposable);
}

// Function to check if the variable is a vector of cv::Point3f
function isPoint3fVector(variableInfo: any): boolean {
    return variableInfo.type && (
        variableInfo.type.includes("std::vector<cv::Point3f>") ||
        variableInfo.type.includes("std::vector<cv::Point3_<float>") ||
        variableInfo.type.includes("std::vector<cv::Point3d>") ||
        variableInfo.type.includes("std::vector<cv::Point3_<double>")
    );
}

// Function to check if the variable is a cv::Mat
function isMat(variableInfo: any): boolean {
    return variableInfo.type && variableInfo.type.includes("cv::Mat");
}

// Function to draw point cloud
async function drawPointCloud(debugSession: vscode.DebugSession, variableInfo: any) {
    // Retrieve the elements of the vector
    const elementsResponse = await debugSession.customRequest("variables", {
        variablesReference: variableInfo.variablesReference,
    });
    console.log("Elements of the vector:", elementsResponse);

    let points: { x: number; y: number; z: number }[] = [];

    // Extract points assuming it's a vector<cv::Point3f>
    elementsResponse.variables.forEach((element: any) => {
        if (element.value && element.value.includes("x=") && element.value.includes("y=") && element.value.includes("z=")) {
            const matches = element.value.match(/x=([-+]?[0-9]*\.?[0-9]+) y=([-+]?[0-9]*\.?[0-9]+) z=([-+]?[0-9]*\.?[0-9]+)/);
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
    const panel = vscode.window.createWebviewPanel("3DPointViewer", "3D Point Viewer", vscode.ViewColumn.One, {
        enableScripts: true,
    });
    panel.webview.html = getWebviewContentForPointCloud(points);
}

// Function to draw the cv::Mat image
async function drawMatImage(debugSession: vscode.DebugSession, variableInfo: any) {
    // Retrieve the cv::Mat properties
    const matPropertiesResponse = await debugSession.customRequest("variables", {
        variablesReference: variableInfo.variablesReference,
    });
    console.log("cv::Mat properties:", matPropertiesResponse);

    let rows = 0, cols = 0, data = [];
    let dataAddress = '';

    // Extract rows, cols, and data address from matPropertiesResponse
    for (const property of matPropertiesResponse.variables) {
        if (property.name === 'rows') {
            rows = parseInt(property.value);
        } else if (property.name === 'cols') {
            cols = parseInt(property.value);
        } else if (property.name === 'data') {
            dataAddress = property.memoryReference;
        }
    }

    if (rows === 0 || cols === 0 || !dataAddress) {
        vscode.window.showErrorMessage('Failed to retrieve matrix data.');
        return;
    }

    // Read matrix data (assuming it's an 8-bit single-channel image)
    const dataResponse = await debugSession.customRequest('readMemory', { memoryReference: dataAddress, offset: 0, count: rows * cols });
    if (!dataResponse || !dataResponse.data) {
        vscode.window.showErrorMessage('Failed to read matrix memory.');
        return;
    }

    // Decode the matrix data (Base64 to binary)
    const buffer = Buffer.from(dataResponse.data, 'base64');
    data = Array.from(buffer);

    // Show the webview to visualize the matrix as an image
    const panel = vscode.window.createWebviewPanel('MatImageViewer', 'Matrix Image Viewer', vscode.ViewColumn.One, {
        enableScripts: true,
    });
    panel.webview.html = getWebviewContentForMat(rows, cols, data);
}

// Function to generate the webview content for the point cloud
function getWebviewContentForPointCloud(points: { x: number; y: number; z: number }[]): string {
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

// Function to generate the webview content for displaying cv::Mat as an image
function getWebviewContentForMat(rows: number, cols: number, data: number[]): string {
    const imageData = JSON.stringify(data);
    return `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Matrix Image Viewer</title>
            <style> body { margin: 0; display: flex; justify-content: center; align-items: center; height: 100vh; background-color: #333; } canvas { border: 1px solid #fff; } </style>
        </head>
        <body>
            <canvas id="canvas" width="${cols}" height="${rows}"></canvas>
            <script>
                const rows = ${rows};
                const cols = ${cols};
                const data = ${imageData};

                const canvas = document.getElementById('canvas');
                const ctx = canvas.getContext('2d');
                const imageData = ctx.createImageData(cols, rows);

                for (let i = 0; i < data.length; i++) {
                    const value = data[i];
                    imageData.data[i * 4] = value;
                    imageData.data[i * 4 + 1] = value;
                    imageData.data[i * 4 + 2] = value;
                    imageData.data[i * 4 + 3] = 255;
                }

                ctx.putImageData(imageData, 0, 0);
            </script>
        </body>
        </html>
    `;
}

export function deactivate() {}
