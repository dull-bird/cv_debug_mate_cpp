# CV DebugMate C++

[![VS Code](https://img.shields.io/badge/VS%20Code-1.93%2B-blue?logo=visualstudiocode)](https://code.visualstudio.com/)
[![OpenCV](https://img.shields.io/badge/OpenCV-4.x-green?logo=opencv)](https://opencv.org/)
[![License](https://img.shields.io/badge/License-MIT-yellow)](LICENSE)
[![C++17](https://img.shields.io/badge/C%2B%2B-17-orange?logo=cplusplus)](https://en.cppreference.com/w/cpp/17)

English | [中文](https://github.com/dull-bird/cv_debug_mate_cpp/blob/main/README_CN.md)

A Visual Studio Code extension for visualizing 1/2/3D data structures during C++ debugging.

**Inspired by [Image Watch](https://marketplace.visualstudio.com/items?itemName=VisualCPPTeam.ImageWatch2022) for Visual Studio.**

---

## 🚀 Try It Now!

> **📂 Example Project: [`test_cpp/`](test_cpp/)**
>
> Complete demo with ALL supported types! Build and debug to see CV DebugMate in action.
>
> ```bash
> # macOS / Linux
> cd test_cpp && ./build.sh && code .
>
> # Windows PowerShell
> cd test_cpp; .\build.ps1; code .
> ```

---

## ⚡ Supported Types (Quick Reference)

| Category             | Type                                    | Visualization   |
| -------------------- | --------------------------------------- | --------------- |
| **Image (2D)**       | `cv::Mat`, `cv::Mat_<T>`                | 🖼️ Image Viewer |
|                      | `cv::Matx` (`Matx33f`, `Matx44d`, etc.) | 🖼️ Image Viewer |
|                      | `std::array<std::array<T, cols>, rows>` | 🖼️ Image Viewer |
|                      | `T[rows][cols]` (C-style 2D array)      | 🖼️ Image Viewer |
| **Multi-Channel Image** | `T[H][W][C]` (C-style 3D array, C=1,3,4) | 🖼️ Image Viewer |
|                      | `std::array<std::array<std::array<T, C>, W>, H>` | 🖼️ Image Viewer |
| **Point Cloud (3D)** | `std::vector<cv::Point3f>`              | 📊 3D Viewer    |
|                      | `std::vector<cv::Point3d>`              | 📊 3D Viewer    |
|                      | `std::array<cv::Point3f, N>`            | 📊 3D Viewer    |
|                      | `std::array<cv::Point3d, N>`            | 📊 3D Viewer    |
| **Plot (1D)**        | `std::vector<T>` (numeric)              | 📈 Plot Viewer  |
|                      | `std::array<T, N>` (numeric)            | 📈 Plot Viewer  |
|                      | `T[N]` (C-style 1D array, numeric)      | 📈 Plot Viewer  |
|                      | `std::set<T>` (numeric)                 | 📈 Plot Viewer  |
|                      | `cv::Mat` (1×N or N×1, single channel)  | 📈 Plot Viewer  |

> **Numeric types**: `int`, `float`, `double`, `uchar`, `short`, `long`, `int8_t`, `uint8_t`, `int16_t`, `uint16_t`, `int32_t`, `uint32_t`, `int64_t`, `uint64_t`, etc.

> **Image depth**: `CV_8U`, `CV_8S`, `CV_16U`, `CV_16S`, `CV_32S`, `CV_32F`, `CV_64F`

---

## 🎯 Features

| Feature               | Description                                                                     |
| --------------------- | ------------------------------------------------------------------------------- |
| **📈 1D Plot**        | Line/Scatter/Histogram, custom X-axis, zoom, pan, export PNG/CSV                |
| **🖼️ 2D Image**       | Multi-channel, auto-normalize, colormap, zoom up to 100×, pixel values on hover |
| **📊 3D Point Cloud** | Three.js powered, color by X/Y/Z, adjustable point size, export PLY             |
| **🔗 View Sync**      | Pair variables for synchronized zoom/pan/rotation across viewers                |
| **🔍 Auto Detection** | Variables panel auto-detects all visualizable types in current scope            |
| **🔄 Auto Refresh**   | Webview auto-updates when stepping through code                                 |

---

## 🔧 Debugger Support

| Compiler   | Extension        | 1D Data | cv::Mat | Point Cloud | Notes                     |
| ---------- | ---------------- | ------- | ------- | ----------- | ------------------------- |
| MSVC       | C/C++ (cppvsdbg) | ✅      | ✅      | ✅          | Windows                   |
| GCC        | C/C++ (cppdbg)   | ✅      | ✅      | ✅          | Windows MinGW             |
| Clang+MSVC | CodeLLDB         | ⚠️      | ✅      | ❌          | LLDB can't parse MSVC STL |
| Clang      | CodeLLDB         | ✅      | ✅      | ✅          | macOS                     |

---

## 📖 Usage

### Option 1: CV DebugMate Panel (Recommended)

1. Start a C++ debug session
2. Open **"Run and Debug"** sidebar
3. Find **CV DebugMate** section
4. Click variable name to view

### Option 2: Context Menu

Right-click a variable → **"View by CV DebugMate"**

---

## 📷 Screenshots

### 1D Plot

![1D Curve Plotting](https://raw.githubusercontent.com/dull-bird/cv_debug_mate_cpp/main/assets/plot.png)

### 2D Image

![Mat Visualization](https://raw.githubusercontent.com/dull-bird/cv_debug_mate_cpp/main/assets/image_mac.png)

### 3D Point Cloud

![Point Cloud Visualization](https://raw.githubusercontent.com/dull-bird/cv_debug_mate_cpp/main/assets/pointcloud.png)

### Variables Panel

![CV DebugMate Panel](https://raw.githubusercontent.com/dull-bird/cv_debug_mate_cpp/main/assets/panel_grouped.png)

---

## 🎮 Controls

### Image Viewer

| Action | Control         |
| ------ | --------------- |
| Zoom   | Scroll wheel    |
| Pan    | Drag            |
| Reset  | Click "Reset"   |
| Export | Save PNG / TIFF |

### 3D Point Cloud Viewer

| Action | Control              |
| ------ | -------------------- |
| Rotate | Drag                 |
| Zoom   | Scroll wheel         |
| Color  | Switch by X/Y/Z axis |
| Export | Save PLY             |

### Plot Viewer

| Action | Control                    |
| ------ | -------------------------- |
| Zoom   | Rectangle select or scroll |
| Pan    | Drag                       |
| Mode   | Line / Scatter / Histogram |
| Export | Save PNG / CSV             |

---

## 📦 Installation

### From VSIX

1. Download `.vsix` file
2. Extensions view (`Ctrl+Shift+X`) → `...` → "Install from VSIX..."

### From Source

```bash
git clone https://github.com/dull-bird/cv_debug_mate_cpp
cd cv_debug_mate_cpp
npm install
npm run compile
# Press F5 to run
```

---

## 📋 Requirements

- VS Code 1.93.0+
- C++ debugger: [C/C++ Extension](https://marketplace.visualstudio.com/items?itemName=ms-vscode.cpptools) or [CodeLLDB](https://marketplace.visualstudio.com/items?itemName=vadimcn.vscode-lldb)

---

## 🙏 Acknowledgments

Inspired by [Image Watch](https://marketplace.visualstudio.com/items?itemName=VisualCPPTeam.ImageWatch2022) for Visual Studio.

---

## 📄 License

MIT

---

## 🤝 Contributing

Issues and PRs welcome!
