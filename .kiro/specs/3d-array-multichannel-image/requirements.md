# Requirements Document

## Introduction

本功能为 CV DebugMate 扩展添加对 3D 数组（多通道图像）的支持。在 C++ 中，使用 `T[H][W][C]` 或 `std::array<std::array<std::array<T, C>, W>, H>` 来表示 RGB/BGR 等多通道图像是非常常见的做法，尤其在底层驱动、嵌入式系统或需要极致性能的场景中。

当前 CV DebugMate 已支持：
- 2D 数组（单通道图像）：`T[H][W]` 和 `std::array<std::array<T, W>, H>`
- 1D 数组（曲线图）：`T[N]` 和 `std::array<T, N>`

本功能将扩展支持 3D 数组，将其识别为多通道图像并在 Image Viewer 中显示。

## Glossary

- **3D_Array**: 三维数组，形如 `T[H][W][C]` 或嵌套三层的 `std::array`
- **C_Style_3D_Array**: C 风格三维数组，如 `uint8_t img[480][640][3]`
- **Std_3D_Array**: 三层嵌套的 std::array，如 `std::array<std::array<std::array<uint8_t, 3>, 640>, 480>`
- **Interleaved_Format**: 交织存储格式，像素数据按 `R1G1B1 R2G2B2 ...` 顺序存储
- **Image_Viewer**: CV DebugMate 的图像查看器组件
- **Depth**: OpenCV 深度类型（CV_8U, CV_32F 等）
- **Channels**: 图像通道数（1=灰度, 3=RGB/BGR, 4=RGBA/BGRA）

## Requirements

### Requirement 1: C 风格 3D 数组检测

**User Story:** As a C++ developer, I want CV DebugMate to automatically detect C-style 3D arrays like `uint8_t img[480][640][3]`, so that I can visualize multi-channel images without manual configuration.

#### Acceptance Criteria

1. WHEN a variable has type matching pattern `T[H][W][C]` where C is 1, 3, or 4, THE Type_Detector SHALL identify it as a 3D C-style array suitable for image visualization
2. WHEN the last dimension C is not 1, 3, or 4, THE Type_Detector SHALL NOT identify it as an image (could be other 3D data)
3. THE Type_Detector SHALL extract height (H), width (W), channels (C), and element type (T) from the type string
4. THE Type_Detector SHALL support common numeric types: `unsigned char`, `uchar`, `uint8_t`, `char`, `int8_t`, `short`, `int16_t`, `uint16_t`, `int`, `int32_t`, `float`, `double`

### Requirement 2: std::array 3D 数组检测

**User Story:** As a C++ developer, I want CV DebugMate to automatically detect 3-level nested std::array like `std::array<std::array<std::array<uint8_t, 3>, 640>, 480>`, so that I can visualize multi-channel images stored in modern C++ containers.

#### Acceptance Criteria

1. WHEN a variable has type matching 3-level nested std::array pattern with innermost dimension 1, 3, or 4, THE Type_Detector SHALL identify it as a 3D std::array suitable for image visualization
2. THE Type_Detector SHALL correctly parse dimensions from various std::array type string formats including `std::__1::array` (libc++) and `class std::array` (MSVC)
3. THE Type_Detector SHALL extract height, width, channels, and element type from the nested type string
4. WHEN the innermost dimension is not 1, 3, or 4, THE Type_Detector SHALL NOT identify it as an image

### Requirement 3: 3D 数组数据指针获取

**User Story:** As a developer, I want the extension to correctly obtain the memory address of 3D array data, so that pixel data can be read for visualization.

#### Acceptance Criteria

1. WHEN visualizing a C-style 3D array, THE Data_Reader SHALL obtain the address of `&arr[0][0][0]`
2. WHEN visualizing a std::array 3D array, THE Data_Reader SHALL obtain the address of the first element through the internal data member (`__elems_`, `_M_elems`, or `_Elems` depending on STL implementation)
3. THE Data_Reader SHALL support all three debugger types: LLDB (CodeLLDB), cppdbg (GDB), and cppvsdbg (MSVC)
4. IF the variables approach fails, THEN THE Data_Reader SHALL fallback to evaluate expressions

### Requirement 4: 3D 数组图像可视化

**User Story:** As a developer, I want 3D arrays to be displayed in the Image Viewer with correct multi-channel rendering, so that I can inspect RGB/BGR image data during debugging.

#### Acceptance Criteria

1. WHEN a 3D array is visualized, THE Image_Viewer SHALL display it as a multi-channel image with correct dimensions (H×W) and channel count (C)
2. THE Image_Viewer SHALL read `H * W * C * sizeof(T)` bytes of contiguous memory
3. THE Image_Viewer SHALL correctly interpret the interleaved pixel format (R1G1B1 R2G2B2 ...)
4. THE Image_Viewer SHALL support all existing depth types: CV_8U, CV_8S, CV_16U, CV_16S, CV_32S, CV_32F, CV_64F

### Requirement 5: Variables Panel 集成

**User Story:** As a developer, I want 3D arrays to appear in the CV DebugMate variables panel with appropriate icons and size information, so that I can easily identify and click to visualize them.

#### Acceptance Criteria

1. WHEN a 3D array variable is in scope, THE Variables_Panel SHALL display it with the image icon (🖼️)
2. THE Variables_Panel SHALL show size information in format `HxWxC` (e.g., `480x640x3`)
3. WHEN the user clicks on a 3D array variable, THE Variables_Panel SHALL trigger image visualization
4. WHEN a 3D array has zero dimensions, THE Variables_Panel SHALL mark it as empty and disable click action

### Requirement 6: 空数组处理

**User Story:** As a developer, I want appropriate feedback when trying to visualize an empty 3D array, so that I understand why visualization is not available.

#### Acceptance Criteria

1. WHEN a 3D array has H=0, W=0, or C=0, THE System SHALL identify it as empty
2. WHEN attempting to visualize an empty 3D array, THE System SHALL display an informative message "3D array is empty"
3. THE Variables_Panel SHALL visually indicate empty arrays (show "empty" in size info)

