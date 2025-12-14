# CV DebugMate C++

[English](https://github.com/dull-bird/cv_debug_mate_cpp#readme) | 中文

一个用于在 C++ 调试过程中可视化 OpenCV 数据结构的 VS Code 扩展。

**灵感来源于 Visual Studio 的 [Image Watch](https://marketplace.visualstudio.com/items?itemName=VisualCPPTeam.ImageWatch2022) 插件。**

---

## 功能特性

### 🖼️ Mat 图像可视化
- 在调试时直接在 VS Code 中查看 `cv::Mat` 图像
- 支持灰度图、RGB 图像和多通道图像
- 支持多种数据类型：`CV_8U`、`CV_32F`、`CV_64F` 等
- 鼠标滚轮缩放
- 拖动平移
- 鼠标悬停显示像素值
- 放大时显示网格

### 📊 点云可视化
- 将 `std::vector<cv::Point3f>` 显示为 3D 点云
- 鼠标交互式 3D 旋转
- 基于 Three.js 渲染
- 按高度/轴向颜色映射
- 可调节点大小

### 💾 导出选项
- **保存 PNG**：将图像导出为 PNG 文件
- **保存 TIFF**：将图像导出为 TIFF 文件（支持浮点数据）

---

## 截图

### Mat 可视化
![Mat 可视化](https://raw.githubusercontent.com/dull-bird/cv_debug_mate_cpp/main/assets/image.png)

### 点云可视化
![点云可视化](https://raw.githubusercontent.com/dull-bird/cv_debug_mate_cpp/main/assets/pointcloud.png)

---

## 调试器支持

| 调试器 | cv::Mat | 点云 | 备注 |
|--------|---------|------|------|
| **cppvsdbg** (Visual Studio 调试器) | ✅ 已测试 | ✅ 已测试 | Windows 完整支持 |
| **cppdbg** (GDB/LLDB via cpptools) | ❓ 未测试 | ❓ 未测试 | 理论可行，未经测试 |
| **lldb** (CodeLLDB + MSVC) | ✅ 已测试 | ❌ 不可用 | LLDB 无法解析 MSVC STL，vector size 始终为 0 |
| **lldb** (CodeLLDB + GCC/Clang) | ❓ 未测试 | ❓ 未测试 | 使用 libstdc++/libc++ 可能可行，未经测试 |

### 已知限制

- **CodeLLDB + MSVC**：使用 CodeLLDB 调试 MSVC 编译的代码时，点云可视化不可用，因为 LLDB 无法正确解析 MSVC 的 STL 实现（`std::vector` 的 size 始终返回 0）。但 `cv::Mat` 可视化正常工作。

- **CodeLLDB + GCC/Clang**：如果使用 GCC 或 Clang 编译（使用 libstdc++ 或 libc++），点云可视化可能可行，但尚未测试。

- **cppvsdbg 许可证**：如果您使用 **Cursor**、**Qoder** 等闭源 VS Code 衍生版本，可能需要使用 **CodeLLDB** 来调试 MSVC 编译的代码，因为这些环境中可能无法使用 cppvsdbg。请注意，由于 LLDB 对 MSVC STL 支持有限，此情况下点云可视化将不可用。

---

## 使用方法

1. 在 VS Code 中启动 C++ 调试会话
2. 在 OpenCV 变量可见的位置设置断点
3. 在 **变量** 或 **监视** 面板中，右键点击支持的变量（`cv::Mat` 或 `std::vector<cv::Point3f>`）
4. 在右键菜单中选择 **"View by CV DebugMate"**
5. 可视化界面将在新标签页中打开

![调试使用方法](https://raw.githubusercontent.com/dull-bird/cv_debug_mate_cpp/main/assets/debug_usage.png)

---

## 支持的类型

### cv::Mat
- 灰度图像（单通道）
- 彩色图像（3 通道，BGR）
- RGBA 图像（4 通道）
- 数据类型：`CV_8U`、`CV_8S`、`CV_16U`、`CV_16S`、`CV_32S`、`CV_32F`、`CV_64F`

### 点云
- `std::vector<cv::Point3f>`
- `std::vector<cv::Point3d>`

---

## 键鼠操作

### 图像查看器
| 操作 | 控制方式 |
|------|----------|
| 放大 | 向上滚动 / 点击"Zoom In" |
| 缩小 | 向下滚动 / 点击"Zoom Out" |
| 平移 | 点击拖动 |
| 重置视图 | 点击"Reset" |
| 保存 PNG | 点击"Save PNG" |
| 保存 TIFF | 点击"Save TIFF" |

### 3D 点云查看器
| 操作 | 控制方式 |
|------|----------|
| 旋转 | 点击拖动 |
| 缩放 | 滚动滚轮 |
| 颜色模式 | 点击按钮切换（纯色/按 Z/Y/X 轴着色） |
| 点大小 | 输入框调整 |

---

## 实现原理

### 概述

CV DebugMate C++ 利用 **VS Code 调试适配器协议（DAP）** 在活动调试会话期间提取和可视化 OpenCV 数据结构。该扩展充当调试器和自定义可视化 UI 之间的桥梁。

### 核心概念

#### 1. 调试适配器协议（Debug Adapter Protocol, DAP）
- **定义**：VS Code 与调试器之间通信的标准化协议
- **作用**：提供 API 用于检查变量、求值表达式、读取内存等调试操作
- **支持的调试器**：兼容任何符合 DAP 标准的调试器（cppvsdbg、cppdbg、CodeLLDB）

#### 2. 变量检查流水线

**步骤 1：右键菜单触发**
- 用户在变量/监视面板中右键点击变量（`cv::Mat` 或 `std::vector<cv::Point3f>`）
- 扩展接收变量的元数据（名称、类型、值、variablesReference）

**步骤 2：类型检测**
- Windows（MSVC）：类型信息可直接从调试器获取
- macOS/Linux（LLDB）：扩展调用 `evaluate()` 请求获取完整类型信息
- 正则表达式匹配识别支持的类型：`cv::Mat`、`std::vector<cv::Point3f>` 等

**步骤 3：数据提取**

对于 **cv::Mat**：
```
1. 通过 DAP variables 请求提取元数据：
   - rows, cols（图像尺寸）
   - channels（1=灰度图，3=BGR，4=BGRA）
   - depth（CV_8U, CV_32F 等）
   - step（每行字节数）
   
2. 获取数据指针地址：
   - 求值表达式：mat.data
   - 解析内存地址（例如：0x12345678）
   
3. 读取原始图像数据：
   - 使用 DAP readMemory() 请求
   - 计算总字节数：rows × step
   - 数据以 Base64 编码缓冲区形式返回
   
4. 解码并渲染：
   - 解码 Base64 → 原始字节
   - 根据 depth/channels 解析数据
   - 渲染到 HTML5 Canvas
```

对于 **点云**：
```
1. 从调试信息解析 vector 大小：
   - 从值字符串提取："{ size=1234 }"
   
2. 尝试快速路径（readMemory）：
   - 获取数据指针：vec.data()
   - 一次性读取所有点：size × 12 字节（3 个 float）
   - 解析二进制数据：[x1,y1,z1, x2,y2,z2, ...]
   
3. 回退路径（variables 请求）：
   - 如果 readMemory 失败，遍历 vector 元素
   - 通过 variablesReference 展开 [0], [1], [2], ...
   - 解析每个 Point3f 的 x, y, z 字段
   - 达到目标 size 时停止
   
4. 验证点数据：
   - 仅接受同时具有 x, y, z 三个字段的对象
   - 遵守 size 限制，避免虚假的点
   
5. 使用 Three.js 渲染：
   - 创建包含点位置的 BufferGeometry
   - 应用颜色映射（纯色/按轴着色）
   - 交互式 3D 控制
```

#### 3. Webview 渲染
- 扩展创建 VS Code Webview 面板
- 注入包含可视化 UI 的 HTML/JS/CSS
- 图像：HTML5 Canvas，支持平移/缩放控制
- 点云：Three.js WebGL 渲染器
- 数据通过消息传递从扩展 → webview

### 架构图

```
用户操作（右键点击变量）
         |
         v
[扩展主机] ────────────> [调试适配器]
         |                            |
         |  1. 获取变量元数据         |
         |  2. 求值表达式             |
         |  3. 读取内存（DAP）        |
         |<───────────────────────────|
         |
         v
[数据解析器]
   - Mat: 提取 rows/cols/数据指针
   - PointCloud: 解析 size，读取点
         |
         v
[Webview 面板]
   - Canvas（Mat）
   - Three.js（点云）
         |
         v
   用户看到可视化结果
```

### 平台差异

| 平台 | 调试器 | 类型检测 | 内存读取 | 点云支持 |
|------|--------|----------|----------|----------|
| Windows | cppvsdbg | 直接获取 | ✅ 快速 | ✅ 完整支持 |
| macOS | CodeLLDB | evaluate() | ✅ 快速 | ✅ 完整支持 |
| Linux | cppdbg/lldb | evaluate() | ✅ 快速 | ⚠️ 取决于 STL |

**注意**：LLDB + MSVC 组合对 STL 支持有限，导致 vector 解析不可靠。

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
