# CV DebugMate C++

[English](https://github.com/dull-bird/cv_debug_mate_cpp#readme) | 中文

一个用于在 C++ 调试过程中可视化 OpenCV 数据结构的 VS Code 扩展。

**灵感来源于 Visual Studio 的 [Image Watch](https://marketplace.visualstudio.com/items?itemName=VisualCPPTeam.ImageWatch2022) 插件。**

---

## 功能特性

### 📈 1D 数据曲线图可视化

![1D 曲线图可视化](https://raw.githubusercontent.com/dull-bird/cv_debug_mate_cpp/main/assets/plot.png)

- 将 `std::vector<int/float/double/uchar>` 等数值向量绘制为折线图
- **自动识别 1D Mat**：自动将 `1xN` 或 `Nx1` 的单通道 `cv::Mat` 识别为 1D 数据并进行曲线绘制
- **自定义 X 轴**：支持选择“索引 (Index)”或当前作用域内其他长度一致的 1D 变量作为 X 轴坐标
- **丰富交互**：支持框选放大 (Zoom to Rectangle)、平移 (Pan) 以及一键复位 (Home)
- **数值追踪**：鼠标悬停自动捕捉最近的数据点并显示精确的 X-Y 坐标
- **数据导出**：支持将当前曲线图保存为 PNG 图片，或将 X-Y 原始数据导出为 CSV 文件

### 🖼️ Mat 图像可视化

![Mat 可视化](https://raw.githubusercontent.com/dull-bird/cv_debug_mate_cpp/main/assets/image_mac.png)

- 在调试时直接在 VS Code 中查看 `cv::Mat` 图像
- 支持灰度图、RGB 图像和多通道图像
- 支持多种数据类型：`CV_8U`、`CV_8S`、`CV_16U`、`CV_16S`、`CV_32S`、`CV_32F`、`CV_64F`
- **智能渲染模式**：
  - `Byte [0, 255]`：直接字节映射
  - `Float * 255 → Byte`：将 [0, 1] 浮点数映射到字节
  - `[min, max] → [0, 255]`：根据数据范围自动归一化
  - `Clamp → [0, 255]`：饱和映射
- **灵活的数值格式**：支持以 Fixed(3)、Fixed(6) 或 科学计数法显示像素值
- **UI 缩放**：针对高 DPI 屏幕的可调缩放比例（Auto, 1x, 1.25x, 1.5x, 2x）
- 鼠标滚轮缩放（支持高达 100 倍放大）
- 拖动平移
- 鼠标悬停显示像素值
- 放大时显示网格

### 📊 点云可视化

![点云可视化](https://raw.githubusercontent.com/dull-bird/cv_debug_mate_cpp/main/assets/pointcloud.png)

- 将 `std::vector<cv::Point3f>` 和 `std::vector<cv::Point3d>` 显示为 3D 点云
- **颜色映射**：可按 X、Y 或 Z 轴坐标对点云进行着色
- **点大小可调**：微调点的可见度
- 鼠标交互式 3D 旋转、平移和缩放
- 基于 Three.js 渲染

### 🔍 CV DebugMate 面板

- **自动变量收集**：自动检测当前堆栈帧中所有可可视化的 OpenCV 变量。
- **专用侧边栏视图**：在“运行和调试”侧边栏中新增专用面板，快速访问所有 Mat 和点云变量。
- **类型识别图标**：为图像 (Mat) 和 3D 数据 (点云) 提供直观的区分图标。
- **一键查看**：通过行内快捷按钮直接打开可视化标签页，无需右键菜单。

![CV DebugMate 面板](https://raw.githubusercontent.com/dull-bird/cv_debug_mate_cpp/main/assets/panel.png)

### 🔗 视图同步与配对

- **同步组 (Sync Groups)**：将多个变量进行配对，实现视角的实时联动（缩放、平移、3D 旋转）。
- **颜色编码识别**：通过不同颜色的图标和组标签（`Group 1`, `Group 2` 等）直观区分不同的同步组。
- **初始状态继承**：新打开的组成员会自动继承该组当前的视图状态，确保对比连续性。
- **高精度点云同步**：针对 3D 视角优化，同步相机位置、旋转、目标点及向上矢量。

![CV DebugMate 面板](https://raw.githubusercontent.com/dull-bird/cv_debug_mate_cpp/main/assets/panel_grouped.png)

### 💾 导出选项

- **保存 PNG**：将图像导出为 PNG 文件
- **保存 TIFF**：将图像导出为 TIFF 文件（支持原始浮点数据）
- **保存 PLY**：将点云导出为 PLY 格式，便于外部工具查看

---

## 调试器支持

| 编译器     | VS Code 插件     | cv::Mat | 点云 | 备注                                                           |
| ---------- | ---------------- | ------- | ---- | -------------------------------------------------------------- |
| MSVC       | C/C++ (cppvsdbg) | ✅      | ✅   | Windows 已测试                                                 |
| GCC        | C/C++ (cppdbg)   | ✅      | ✅   | Windows MinGW 环境已测试                                       |
| Clang+MSVC | CodeLLDB         | ✅      | ❌   | Windows 已测试。LLDB 无法解析 MSVC STL，vector size 始终返回 0 |
| Clang      | CodeLLDB         | ✅      | ✅   | macOS 已测试                                                   |

### 已知限制

- **cppvsdbg 许可证**：如果您使用 **Cursor**、**Qoder** 等闭源 VS Code 衍生版本，可能需要使用 **CodeLLDB** 来调试 MSVC 编译的代码，因为这些环境中可能无法使用 cppvsdbg。请注意，由于 LLDB 对 MSVC STL 支持有限，此情况下点云可视化将不可用。

---

## 使用方法

### 方法 1：CV DebugMate 面板（推荐）

1. 在 VS Code 中启动 C++ 调试会话。
2. 打开 **“运行和调试”** 侧边栏。
3. 找到 **CV DebugMate** 标题栏。
4. 当前作用域内所有可预览的变量将自动显示。
5. 点击变量名进行查看。
6. 点击 **“链接”图标** 可将变量与其他变量配对，实现联动对比。

### 方法 2：右键菜单

1. 在传统的 **“变量”** 或 **“监视”** 面板中，右键点击支持的变量。
2. 选择 **"View by CV DebugMate"**。

---

## 支持的类型

### 图像

- `cv::Mat` & `cv::Mat_<T>`
- 灰度图像（单通道）
- 彩色图像（3 通道，BGR）
- RGBA 图像（4 通道）
- 数据类型：`CV_8U`、`CV_8S`、`CV_16U`、`CV_16S`、`CV_32S`、`CV_32F`、`CV_64F`
- 支持模板矩阵类型，如 `cv::Mat_<uchar>`、`cv::Mat_<cv::Vec3b>` 等

### 点云

- `std::vector<cv::Point3f>`
- `std::vector<cv::Point3d>`

### 1D 数据 (曲线图)

- `std::vector<int>`、`std::vector<float>`、`std::vector<double>`、`std::vector<uchar>` 等数值向量
- `1xN` 或 `Nx1` 的单通道 `cv::Mat` (自动转换)

---

## 键鼠操作

### 图像查看器

| 操作      | 控制方式                  |
| --------- | ------------------------- |
| 放大      | 向上滚动 / 点击"Zoom In"  |
| 缩小      | 向下滚动 / 点击"Zoom Out" |
| 平移      | 点击拖动                  |
| 重置视图  | 点击"Reset"               |
| 保存 PNG  | 点击"Save PNG"            |
| 保存 TIFF | 点击"Save TIFF"           |

以及其他设置选项。

### 3D 点云查看器

| 操作     | 控制方式                             |
| -------- | ------------------------------------ |
| 旋转     | 点击拖动                             |
| 缩放     | 滚动滚轮                             |
| 颜色模式 | 点击按钮切换（纯色/按 Z/Y/X 轴着色） |
| 点大小   | 输入框调整                           |
| 保存 Ply | 点击"Save PLY"                       |

---

## 实现原理

CV DebugMate C++ 通过 **VS Code 调试适配器协议（DAP）** 从调试会话中读取 OpenCV 数据，再用 **Webview**（Canvas / Three.js）进行可视化渲染。

### 数据流（简化版）

- **1）识别类型**：根据调试器提供的类型信息（必要时通过 `evaluate()`）识别 `cv::Mat` / `std::vector<cv::Point3f/Point3d>`。
- **2）读取元数据**：`cv::Mat` 读取 `rows/cols/channels/depth` 等信息（通过 `variables`/`variablesReference`）。
- **3）读取内存**：拿到数据指针（如 `mat.data`、`&vec[0]` 或不同调试器的内部表达式），用 DAP 的 **`readMemory`** 一次性读取连续内存。
- **4）解析并渲染**：
  - Mat：解码原始字节/原始浮点 → Canvas 渲染（缩放/平移/网格/像素值）。
  - 点云：解析 XYZ → Three.js 渲染与交互。
  - 1D 数据：解析数值序列 → 高性能 Canvas 曲线绘制（支持框选放大、数据导出）。

### 说明 / 限制

- **LLDB + MSVC STL** 支持有限，`vector` 相关信息可能不可靠（例如 size=0），点云功能可能不可用或更慢。
- 浮点 `cv::Mat` 会以 **原始浮点值** 传入 Webview，并在 UI 中选择映射方式（如 min/max 归一化）后再显示。

---

## 安装

### 从 VSIX 安装

1. 下载 `.vsix` 文件
2. 在 VS Code 中打开扩展视图（`Ctrl+Shift+X`）
3. 点击 `...` 菜单 → "从 VSIX 安装..."
4. 选择下载的文件

### 从源码构建

```bash
git clone https://github.com/dull-bird/cv_debug_mate_cpp
cd cv_debug_mate_cpp
npm install
npm run compile
# 按 F5 在扩展开发主机中运行
```

---

## 系统要求

- VS Code 1.93.0 或更高版本
- C++ 调试器扩展：
  - [C/C++ Extension](https://marketplace.visualstudio.com/items?itemName=ms-vscode.cpptools)（用于 cppdbg/cppvsdbg）
  - [CodeLLDB](https://marketplace.visualstudio.com/items?itemName=vadimcn.vscode-lldb)（用于 lldb）

---

## 致谢

本扩展的灵感来源于 [Image Watch](https://marketplace.visualstudio.com/items?itemName=VisualCPPTeam.ImageWatch2022)，这是一个广受欢迎的 Visual Studio 扩展，用于在调试时查看图像。CV DebugMate C++ 将类似的功能带到了 Visual Studio Code，使其可用于跨平台 C++ 开发。

---

## 许可证

MIT

---

## 贡献

欢迎贡献！请随时提交 Issue 和 Pull Request。
