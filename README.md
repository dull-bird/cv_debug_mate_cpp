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

Other configrations.

### 3D Point Cloud Viewer
| Action | Control |
|--------|---------|
| Rotate | Click and Drag |
| Zoom | Scroll |
| Color Mode | Click "Color by X/Y/Z" or "Solid" |
| Save PLY | Click "Save PLY" | 

---

## How It Works

CV DebugMate C++ uses the **VS Code Debug Adapter Protocol (DAP)** to pull OpenCV data out of a live debug session, then renders it in a **Webview** (HTML5 Canvas / Three.js).

### Data flow (high level)
- **1) Identify the type**: detect `cv::Mat` / `std::vector<cv::Point3f/Point3d>` from debugger-provided type info (sometimes via `evaluate()`).
- **2) Extract metadata**: for `cv::Mat` read `rows/cols/channels/depth` (via `variables`/`variablesReference`).
- **3) Read memory**: obtain the underlying data pointer (e.g. `mat.data`, `&vec[0]`, or debugger-specific expressions) and use DAP **`readMemory`** to fetch a contiguous buffer.
- **4) Decode & render**:
  - Mat → decode raw bytes (or raw floats) and render via Canvas (pan/zoom/grid/values).
  - Point cloud → parse XYZ triplets and render via Three.js.

### Notes / limitations
- **LLDB + MSVC STL** has limited support; vector parsing may fail (e.g. size reported as 0), so point clouds can be unavailable or slower.
- Floating-point Mats are transferred as **raw values** and mapped to display range in the UI (e.g. min/max normalize).

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
