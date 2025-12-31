# CV DebugMate C++

[![VS Code](https://img.shields.io/badge/VS%20Code-1.93%2B-blue?logo=visualstudiocode)](https://code.visualstudio.com/)
[![OpenCV](https://img.shields.io/badge/OpenCV-4.x-green?logo=opencv)](https://opencv.org/)
[![License](https://img.shields.io/badge/License-MIT-yellow)](LICENSE)
[![C++17](https://img.shields.io/badge/C%2B%2B-17-orange?logo=cplusplus)](https://en.cppreference.com/w/cpp/17)

[English](https://github.com/dull-bird/cv_debug_mate_cpp#readme) | 中文

一个用于在 C++ 调试过程中可视化 1/2/3D 数据结构的 VS Code 扩展。

**灵感来源于 Visual Studio 的 [Image Watch](https://marketplace.visualstudio.com/items?itemName=VisualCPPTeam.ImageWatch2022) 插件。**

---

## 🚀 立即体验！

> **📂 示例项目: [`test_cpp/`](test_cpp/)**
> 
> 包含所有支持类型的完整演示！编译并调试即可体验 CV DebugMate。
> 
> ```bash
> # macOS / Linux
> cd test_cpp && ./build.sh && code .
> 
> # Windows PowerShell
> cd test_cpp; .\build.ps1; code .
> ```

---

## ⚡ 支持类型速查表

| 类别 | 类型 | 可视化方式 |
|------|------|-----------|
| **图像 (2D)** | `cv::Mat`, `cv::Mat_<T>` | 🖼️ 图像查看器 |
| | `cv::Matx` (`Matx33f`, `Matx44d` 等) | 🖼️ 图像查看器 |
| | `std::array<std::array<T, cols>, rows>` | 🖼️ 图像查看器 |
| **点云 (3D)** | `std::vector<cv::Point3f>` | 📊 3D 查看器 |
| | `std::vector<cv::Point3d>` | 📊 3D 查看器 |
| | `std::array<cv::Point3f, N>` | 📊 3D 查看器 |
| | `std::array<cv::Point3d, N>` | 📊 3D 查看器 |
| **曲线图 (1D)** | `std::vector<T>` (数值类型) | 📈 曲线查看器 |
| | `std::array<T, N>` (数值类型) | 📈 曲线查看器 |
| | `std::set<T>` (数值类型) | 📈 曲线查看器 |
| | `cv::Mat` (1×N 或 N×1, 单通道) | 📈 曲线查看器 |

> **数值类型**: `int`, `float`, `double`, `uchar`, `short`, `long`, `int8_t`, `uint8_t`, `int16_t`, `uint16_t`, `int32_t`, `uint32_t`, `int64_t`, `uint64_t` 等

> **图像深度**: `CV_8U`, `CV_8S`, `CV_16U`, `CV_16S`, `CV_32S`, `CV_32F`, `CV_64F`

---

## 🎯 功能特性

| 功能 | 说明 |
|------|------|
| **📈 1D 曲线图** | 折线/散点/直方图，自定义 X 轴，缩放平移，导出 PNG/CSV |
| **🖼️ 2D 图像** | 多通道，自动归一化，伪彩色，100× 放大，悬停显示像素值 |
| **📊 3D 点云** | Three.js 渲染，按 X/Y/Z 着色，可调点大小，导出 PLY |
| **🔗 视图同步** | 配对变量实现缩放/平移/旋转联动 |
| **🔍 自动检测** | 变量面板自动检测当前作用域内所有可视化类型 |
| **🔄 自动刷新** | 单步调试时 Webview 自动更新 |

---

## 🔧 调试器支持

| 编译器 | 插件 | 1D 数据 | cv::Mat | 点云 | 备注 |
|--------|------|---------|---------|------|------|
| MSVC | C/C++ (cppvsdbg) | ✅ | ✅ | ✅ | Windows |
| GCC | C/C++ (cppdbg) | ✅ | ✅ | ✅ | Windows MinGW |
| Clang+MSVC | CodeLLDB | ⚠️ | ✅ | ❌ | LLDB 无法解析 MSVC STL |
| Clang | CodeLLDB | ✅ | ✅ | ✅ | macOS |

---

## 📖 使用方法

### 方法 1：CV DebugMate 面板（推荐）

1. 启动 C++ 调试会话
2. 打开 **"运行和调试"** 侧边栏
3. 找到 **CV DebugMate** 区域
4. 点击变量名即可查看

### 方法 2：右键菜单

右键变量 → **"View by CV DebugMate"**

---

## 📷 截图

### 1D 曲线图
![1D 曲线图](https://raw.githubusercontent.com/dull-bird/cv_debug_mate_cpp/main/assets/plot.png)

### 2D 图像
![Mat 可视化](https://raw.githubusercontent.com/dull-bird/cv_debug_mate_cpp/main/assets/image_mac.png)

### 3D 点云
![点云可视化](https://raw.githubusercontent.com/dull-bird/cv_debug_mate_cpp/main/assets/pointcloud.png)

### 变量面板
![CV DebugMate 面板](https://raw.githubusercontent.com/dull-bird/cv_debug_mate_cpp/main/assets/panel_grouped.png)

---

## 🎮 操作说明

### 图像查看器

| 操作 | 方式 |
|------|------|
| 缩放 | 滚轮 |
| 平移 | 拖动 |
| 重置 | 点击 "Reset" |
| 导出 | Save PNG / TIFF |

### 3D 点云查看器

| 操作 | 方式 |
|------|------|
| 旋转 | 拖动 |
| 缩放 | 滚轮 |
| 颜色 | 按 X/Y/Z 轴切换 |
| 导出 | Save PLY |

### 曲线查看器

| 操作 | 方式 |
|------|------|
| 缩放 | 框选 或 滚轮 |
| 平移 | 拖动 |
| 模式 | 折线 / 散点 / 直方图 |
| 导出 | Save PNG / CSV |

---

## 📦 安装

### 从 VSIX 安装
1. 下载 `.vsix` 文件
2. 扩展视图 (`Ctrl+Shift+X`) → `...` → "从 VSIX 安装..."

### 从源码构建
```bash
git clone https://github.com/dull-bird/cv_debug_mate_cpp
cd cv_debug_mate_cpp
npm install
npm run compile
# 按 F5 运行
```

---

## 📋 系统要求

- VS Code 1.93.0+
- C++ 调试器: [C/C++ Extension](https://marketplace.visualstudio.com/items?itemName=ms-vscode.cpptools) 或 [CodeLLDB](https://marketplace.visualstudio.com/items?itemName=vadimcn.vscode-lldb)

---

## 🙏 致谢

灵感来源于 Visual Studio 的 [Image Watch](https://marketplace.visualstudio.com/items?itemName=VisualCPPTeam.ImageWatch2022) 插件。

---

## 📄 许可证

MIT

---

## 🤝 贡献

欢迎提交 Issue 和 PR！
