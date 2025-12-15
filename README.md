# CV DebugMate C++

English | [中文](https://github.com/dull-bird/cv_debug_mate_cpp/blob/main/README_CN.md)

A Visual Studio Code extension for visualizing OpenCV data structures during C++ debugging.

**Inspired by [Image Watch](https://marketplace.visualstudio.com/items?itemName=VisualCPPTeam.ImageWatch2022) for Visual Studio.**

---

## Features

### 🖼️ Mat Visualization
- View `cv::Mat` images directly in VS Code during debugging
- Support for grayscale, RGB, and multi-channel images
- Support for various data types: `CV_8U`, `CV_32F`, `CV_64F`, etc.
- Zoom in/out with mouse wheel
- Pan by dragging
- Pixel value display on hover
- Grid overlay when zoomed in

### 📊 Point Cloud Visualization  
- View `std::vector<cv::Point3f>` as 3D point clouds
- Interactive 3D rotation with mouse
- Powered by Three.js

### 💾 Export Options
- **Save PNG**: Export image as PNG file
- **Save TIFF**: Export image as TIFF file (supports floating-point data)

---

## Screenshots

### Mat Visualization
![Mat Visualization](https://raw.githubusercontent.com/dull-bird/cv_debug_mate_cpp/main/assets/image.png)

### Point Cloud Visualization
![Point Cloud Visualization](https://raw.githubusercontent.com/dull-bird/cv_debug_mate_cpp/main/assets/pointcloud.png)

---

## Supported Debuggers

| Compiler| VS Code Extension | cv::Mat | Point Cloud | Notes |
|-----|----|---------|-------------|-------|
| MSVC | C/C++ (cppvsdbg) | ✅ | ✅ | Tested on Windows |
|GCC | C/C++ (cppdbg) |✅ | ✅ | Tested on Windows MinGW Environment |
| Clang+MSVC | CodeLLDB | ✅ | ❌ | Tested on Windows. LLDB cannot parse MSVC STL, vector size always returns 0 |
| Clang |  CodeLLDB | ✅ | ✅ | Tested on macOS |
| GDB | C/C++ (cppdbg) | ✅ | ✅ | Linux support confirmed |

### Known Limitations

- **cppvsdbg license**: If you are using closed-source VS Code forks like **Cursor**, **Qoder**, or similar IDEs, you may need to use **CodeLLDB** for debugging MSVC-compiled code, as cppvsdbg may not be available in these environments. Note that point cloud visualization will not work in this case due to LLDB's limited support for MSVC STL.

---

## Usage

1. Start a C++ debug session in VS Code
2. Set a breakpoint where OpenCV variables are in scope
3. In the **Variables** or **Watch** panel, right-click on a supported variable (`cv::Mat` or `std::vector<cv::Point3f>`)
4. Select **"View by CV DebugMate"** from the context menu
5. The visualization will open in a new tab

![Debug Usage](https://raw.githubusercontent.com/dull-bird/cv_debug_mate_cpp/main/assets/debug_usage.png)

---

## Supported Types

### cv::Mat
- Grayscale images (1 channel)
- Color images (3 channels, BGR)
- RGBA images (4 channels)
- Depth types: `CV_8U`, `CV_8S`, `CV_16U`, `CV_16S`, `CV_32S`, `CV_32F`, `CV_64F`

### Point Clouds
- `std::vector<cv::Point3f>`
- `std::vector<cv::Point3d>`

---

## Keyboard & Mouse Controls

### Image Viewer
| Action | Control |
|--------|---------|
| Zoom In | Scroll Up / Click "Zoom In" |
| Zoom Out | Scroll Down / Click "Zoom Out" |
| Pan | Click and Drag |
| Reset View | Click "Reset" |
| Save PNG | Click "Save PNG" |
| Save TIFF | Click "Save TIFF" |

### 3D Point Cloud Viewer
| Action | Control |
|--------|---------|
| Rotate | Click and Drag |
| Zoom | Scroll |

---

## How It Works

### Overview

CV DebugMate C++ leverages the **VS Code Debug Adapter Protocol (DAP)** to extract and visualize OpenCV data structures during active debugging sessions. The extension acts as a bridge between the debugger and custom visualization UI.

### Key Concepts

#### 1. Debug Adapter Protocol (DAP)
- **What**: A standardized protocol for communication between VS Code and debuggers
- **Role**: Provides APIs to inspect variables, evaluate expressions, and read memory during debugging
- **Supported Debuggers**: Works with any DAP-compliant debugger (cppvsdbg, cppdbg, CodeLLDB)

#### 2. Variable Inspection Pipeline

**Step 1: Context Menu Trigger**
- User right-clicks on a variable (`cv::Mat` or `std::vector<cv::Point3f>`) in Variables/Watch panel
- Extension receives the variable's metadata (name, type, value, variablesReference)

**Step 2: Type Detection**
- On Windows (MSVC): Type information available directly from the debugger
- On macOS/Linux (LLDB): Extension calls `evaluate()` request to get full type information
- Regex matching identifies supported types: `cv::Mat`, `std::vector<cv::Point3f>`, etc.

**Step 3: Data Extraction**

For **cv::Mat**:
```
1. Extract metadata via DAP variables request:
   - rows, cols (image dimensions)
   - channels (1=grayscale, 3=BGR, 4=BGRA)
   - depth (CV_8U, CV_32F, etc.)
   - step (bytes per row)
   
2. Get data pointer address:
   - Evaluate expression: mat.data
   - Parse memory address (e.g., 0x12345678)
   
3. Read raw image data:
   - Use DAP readMemory() request
   - Calculate total bytes: rows × step
   - Data returned as Base64-encoded buffer
   
4. Decode and render:
   - Decode Base64 → raw bytes
   - Parse according to depth/channels
   - Render to HTML5 Canvas
```

For **Point Clouds**:
```
1. Parse vector size from debug info:
   - Extract from value string: "{ size=1234 }"
   
2. Attempt fast path (readMemory):
   - Get data pointer: vec.data()
   - Read all points at once: size × 12 bytes (3 floats)
   - Parse binary data: [x1,y1,z1, x2,y2,z2, ...]
   
3. Fallback path (variables request):
   - If readMemory fails, iterate through vector elements
   - Expand [0], [1], [2], ... via variablesReference
   - Parse each Point3f's x, y, z fields
   - Stop when reaching target size
   
4. Validate points:
   - Only accept objects with all three fields (x, y, z)
   - Respect size limit to avoid phantom points
   
5. Render with Three.js:
   - Create BufferGeometry with point positions
   - Apply color mapping (solid/by axis)
   - Interactive 3D controls
```

#### 3. Webview Rendering
- Extension creates a VS Code Webview panel
- HTML/JS/CSS injected with visualization UI
- For images: HTML5 Canvas with pan/zoom controls
- For point clouds: Three.js WebGL renderer
- Data passed from extension → webview via message passing

### Architecture Diagram

```
    User Action (Right-click variable)
         |
         v
   [Extension Host] ────────────> [Debug Adapter]
         |                            |
         |  1. Get variable metadata  |
         |  2. Evaluate expressions   |
         |  3. Read memory (DAP)      |
         |<───────────────────────────|
         |
         v
   [Data Parser]
    - Mat: Extract rows/cols/data pointer
    - PointCloud: Parse size, read points
         |
         v
   [Webview Panel]
    - Canvas (Mat)
    - Three.js (PointCloud)
         |
         v
   User sees visualization
```

### Platform Differences

| Platform | Debugger | Type Detection | Memory Read | Point Cloud |
|----------|----------|----------------|-------------|-------------|
| Windows | cppvsdbg | Direct | ✅ Fast | ✅ Full support |
| macOS | CodeLLDB | evaluate() | ✅ Fast | ✅ Full support |
| Linux | cppdbg/lldb | evaluate() | ✅ Fast | ⚠️ Depends on STL |

**Note**: LLDB + MSVC combination has limited STL support, making vector parsing unreliable.

### Implementation Details by Debugger

#### 1. cppvsdbg (Windows MSVC)
- **Mat Visualization**: Uses `variablesReference` to get metadata, then evaluates `mat.data` to get pointer
- **Point Cloud Visualization**: 
  - Fast path: Evaluates `&vec[0]` to get data pointer, then uses `readMemory` to read all points at once
  - Fallback: Uses `variablesReference` with `[More]` expansion for large vectors
  
#### 2. cppdbg (Linux/macOS GDB)
- **Mat Visualization**: Same approach as cppvsdbg
- **Point Cloud Visualization**: 
  - Fast path: Evaluates `vec._M_impl._M_start` (GDB's internal structure) to get data pointer, then uses `readMemory`
  - Fallback: Same as cppvsdbg
  
#### 3. lldb (CodeLLDB)
- **Mat Visualization**: Uses `evaluate()` to get full type information, then reads data via memory
- **Point Cloud Visualization**: 
  - Due to LLDB's limited support for MSVC STL, `vec.size()` often returns 0
  - Must use `variablesReference` approach, iterating through elements
  - Performance is slower for large point clouds due to multiple DAP requests

---

## Installation

### From VSIX
1. Download the `.vsix` file
2. In VS Code, go to Extensions view (`Ctrl+Shift+X`)
3. Click `...` menu → "Install from VSIX..."
4. Select the downloaded file

### From Source
```bash
git clone <repository-url>
cd cv-visualizer
npm install
npm run compile
# Press F5 to run in Extension Development Host
```

---

## Requirements

- VS Code 1.93.0 or higher
- A C++ debugger extension:
  - [C/C++ Extension](https://marketplace.visualstudio.com/items?itemName=ms-vscode.cpptools) (for cppdbg/cppvsdbg)
  - [CodeLLDB](https://marketplace.visualstudio.com/items?itemName=vadimcn.vscode-lldb) (for lldb)

---

## Acknowledgments

This extension is inspired by [Image Watch](https://marketplace.visualstudio.com/items?itemName=VisualCPPTeam.ImageWatch2022), a popular Visual Studio extension for viewing images during debugging. CV DebugMate C++ brings similar functionality to Visual Studio Code, making it available for cross-platform C++ development.

---

## License

MIT

---

## Contributing

Contributions are welcome! Please feel free to submit issues and pull requests.
