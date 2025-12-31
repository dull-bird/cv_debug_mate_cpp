# CV DebugMate Test Project

This folder contains a complete test project demonstrating ALL supported types.

## 📁 Files

| File | Description |
|------|-------------|
| `main.cpp` | Demo code with all supported types |
| `CMakeLists.txt` | CMake build configuration |
| `build.sh` | Build script for macOS/Linux |
| `build.ps1` | Build script for Windows |

## 🚀 Quick Start

### macOS / Linux
```bash
./build.sh
```

### Windows (PowerShell)
```powershell
.\build.ps1                    # Auto-detect compiler
.\build.ps1 -Compiler msvc     # Use MSVC
.\build.ps1 -Compiler gcc      # Use GCC (MSYS2)
.\build.ps1 -Compiler clang    # Use Clang (MSYS2)
```

## 🧪 Test Sections in main.cpp

| Section | Function | Types Tested |
|---------|----------|--------------|
| **2D Images** | `demo_2d_images()` | `cv::Mat`, `cv::Mat_<T>`, `cv::Matx`, `std::array<std::array<T,C>,R>` |
| **3D Point Cloud** | `demo_3d_pointcloud()` | `std::vector<cv::Point3f/3d>`, `std::array<cv::Point3f/3d, N>` |
| **1D Plots** | `demo_1d_plots()` | `std::vector<T>`, `std::array<T,N>`, `std::set<T>`, `cv::Mat(1×N)` |
| **Auto-Refresh** | `demo_auto_refresh()` | Loop test - step through to see live updates |

## 🔧 Debugging

1. Open this folder in VS Code
2. Create/modify `.vscode/launch.json`:

```json
{
    "version": "0.2.0",
    "configurations": [
        {
            "name": "Debug test_debugmate",
            "type": "lldb",  // or "cppdbg" for GCC, "cppvsdbg" for MSVC
            "request": "launch",
            "program": "${workspaceFolder}/build/test_debugmate",
            "args": [],
            "cwd": "${workspaceFolder}"
        }
    ]
}
```

3. Set breakpoints at marked locations in `main.cpp`
4. Press F5 to start debugging
5. Use CV DebugMate to visualize variables!

## 📋 Requirements

- CMake 3.10+
- OpenCV 4.x
- C++17 compiler (GCC, Clang, or MSVC)

