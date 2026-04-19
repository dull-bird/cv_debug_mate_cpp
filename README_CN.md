# C++ DebugMate

[![VS Code](https://img.shields.io/badge/VS%20Code-1.93%2B-blue?logo=visualstudiocode)](https://code.visualstudio.com/)
[![Version](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Fdull-bird%2Fcv_debug_mate_cpp%2Fmain%2Fpackage.json&query=%24.version&label=version&color=blue)](https://github.com/dull-bird/cv_debug_mate_cpp)
[![OpenCV](https://img.shields.io/badge/OpenCV-4.x-green?logo=opencv)](https://opencv.org/)
[![PCL](https://img.shields.io/badge/PCL-1.x-blue?logo=c%2B%2B)](https://pointclouds.org/)
[![License](https://img.shields.io/badge/License-MIT-yellow)](LICENSE)
[![C++11](https://img.shields.io/badge/C%2B%2B-11-orange?logo=cplusplus)](https://en.cppreference.com/w/cpp/11)
[![Demo Build](https://github.com/dull-bird/cv_debug_mate_cpp/actions/workflows/demo-build.yml/badge.svg)](https://github.com/dull-bird/cv_debug_mate_cpp/actions/workflows/demo-build.yml)

[English](https://github.com/dull-bird/cv_debug_mate_cpp#readme) | 中文

一个用于在 C++ 调试过程中可视化 1/2/3D 数据结构的 VS Code 扩展。

**灵感来源于 Visual Studio 的 [Image Watch](https://marketplace.visualstudio.com/items?itemName=VisualCPPTeam.ImageWatch2022) 插件。**

---

## 🚀 立即体验！

> **📂 示例项目: [`test_cpp/`](test_cpp/)**
>
> 包含了**所有**支持类型的完整测试代码，欢迎本地编译以便亲自体验！
> 
> ⚠️ **编译环境依赖要求:**
> - **OpenCV** (必需): `brew install opencv` / `apt install libopencv-dev`
> - **PCL** (可选, 用于体验3D特性): `brew install pcl` / `apt install libpcl-dev`
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
| :--- | :--- | :--------- |
| **图像 (2D & 3D)** | `cv::Mat`, `cv::Mat_<T>` | 🖼️ 图像查看器 |
| | `cv::Matx` (`Matx33f`, `Matx44d` 等) | 🖼️ 图像查看器 |
| | `std::array<std::array<T, cols>, rows>` | 🖼️ 图像查看器 |
| | `T[rows][cols]` (C 风格 2D 数组) | 🖼️ 图像查看器 |
| | `T[H][W][C]` (C 风格 3D 数组, C=1,3,4) | 🖼️ 图像查看器 |
| | `std::array<...<T, C>, W>, H>` | 🖼️ 图像查看器 |
| **点云 (3D)** | `pcl::PointCloud<T>` (支持 XYZ, RGB, Normal 等) | ✨ 3D 查看器 |
| | `std::vector<cv::Point3f / cv::Point3d>` | ✨ 3D 查看器 |
| | `std::array<cv::Point3f / cv::Point3d, N>` | ✨ 3D 查看器 |
| **曲线图 (1D)** | `std::vector<T>`, `std::array<T, N>` | 📈 曲线查看器 |
| | `T[N]` (C 风格 1D 数组), `std::set<T>` | 📈 曲线查看器 |
| | `cv::Mat` (1×N 或 N×1, 单通道) | 📈 曲线查看器 |
| **指针类型** | `cv::Mat*`, `pcl::PointCloud<T>::Ptr` | 自动剥壳解读 |
| | `std::shared_ptr<T>`, `std::unique_ptr<T>` | 自动剥壳解读 |

> **数值类型**: `int`, `float`, `double`, `uchar`, `short`, `long`, `int8_t`, `uint8_t`, `int16_t`, `uint16_t`, `int32_t`, `uint32_t`, `int64_t`, `uint64_t` 等

> **图像深度**: `CV_8U`, `CV_8S`, `CV_16U`, `CV_16S`, `CV_32S`, `CV_32F`, `CV_64F`

> **指针与智能指针支持**: 插件原生支持自动解包各种原始指针（如 `cv::Mat*`）以及标准库的智能指针（如 `std::shared_ptr<cv::Mat>`，`std::unique_ptr<std::vector<float>>`，`boost::shared_ptr`）。无论是 1D/2D 还是 3D 数据，只要被包装在智能指针中，插件都能自动剥壳并读取底层数据。指向同一内存地址的指针和真实变量会共享渲染标签页以节省您的屏幕空间。

---

## 🎯 功能特性

| 功能 | 说明 |
|------|------|
| **📈 1D 曲线图** | 折线/散点/直方图，自定义 X 轴，框选缩放，无级平移，导出 PNG/CSV |
| **🖼️ 2D 图像** | 多通道原生支持，自动极值归一化，多种伪彩色，百倍放大无损，悬停显示准确像素值 |
| **✨ 3D 点云** | 原生无缝支持 `pcl::PointCloud` 与 OpenCV 点集！Three.js 引擎驱动，按 RGB/反射率/XYZ 着色，自由调节点大小，一键导出 PLY 和 PCD 格式 |
| **🔗 视图同步** | 配对多个同类型变量以实现缩放、平移以及相机视角的实时联动分析 |
| **🔍 自动检测** | 侧边栏变量面板会自动从乱七八糟的堆栈中为您筛选出所有可供渲染的数据，并按类别分组整理 |
| **🔄 自动刷新** | 当您执行单步调试过完代码断点时，打开的监视面板会自动且无感地跟进数据更新 |

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

### 方法 1：C++ DebugMate 面板（推荐）

1. 启动 C++ 调试会话
2. 打开 **"运行和调试"** 侧边栏
3. 找到 **C++ DebugMate** 区域
4. 点击变量名即可查看

### 方法 2：右键菜单

右键变量 → **"View by C++ DebugMate"**

---

## 📷 截图

### 1D 曲线图
![1D 曲线图](https://raw.githubusercontent.com/dull-bird/cv_debug_mate_cpp/main/assets/plot.png)

### 2D 图像
![Image Overview](https://raw.githubusercontent.com/dull-bird/cv_debug_mate_cpp/main/assets/image_overview.png)
![Pixel Details](https://raw.githubusercontent.com/dull-bird/cv_debug_mate_cpp/main/assets/image_pixel.png)
![Matrix Values](https://raw.githubusercontent.com/dull-bird/cv_debug_mate_cpp/main/assets/image_matrix.png)

### 3D 点云
![点云可视化](https://raw.githubusercontent.com/dull-bird/cv_debug_mate_cpp/main/assets/pointcloud.png)

### 变量面板
![C++ DebugMate 面板](https://raw.githubusercontent.com/dull-bird/cv_debug_mate_cpp/main/assets/panel.png)

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
| 旋转 | 鼠标左键框选拖动 |
| 平移 | 鼠标右键按住拖动 |
| 缩放 | 滚轮上下滚动 |
| 颜色 | RGB 原色渲染，高度图（X/Y/Z 热力图） |
| 导出 | 导出为 ASCII/Binary 的 PLY 和 PCD 格式 |

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
