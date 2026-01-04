# Implementation Plan: 3D Array Multi-Channel Image Support

## Overview

本实现计划将 3D 数组（多通道图像）支持添加到 CV DebugMate 扩展。实现遵循现有代码架构，复用已有的 2D 数组处理逻辑。

## Tasks

- [x] 1. 添加基础类型检测函数 (opencv.ts)
  - [x] 1.1 实现 `is3DCStyleArray()` 函数
    - 添加正则表达式匹配 `T[H][W][C]` 格式
    - 验证通道数为 1, 3, 或 4
    - 提取 height, width, channels, elementType
    - 调用 `getDepthFromCppType()` 获取 depth
    - _Requirements: 1.1, 1.2, 1.3, 1.4_
  - [x] 1.2 实现 `is3DStdArray()` 函数
    - 添加正则表达式匹配三层嵌套 std::array
    - 支持 `std::__1::array` (libc++) 和 `class std::array` (MSVC) 格式
    - 验证通道数为 1, 3, 或 4
    - 提取 height, width, channels, elementType
    - _Requirements: 2.1, 2.2, 2.3, 2.4_
  - [ ]* 1.3 编写属性测试：类型检测正确性
    - **Property 1: 3D 数组类型检测正确性**
    - **Validates: Requirements 1.1, 2.1**
  - [ ]* 1.4 编写属性测试：非图像 3D 数组排除
    - **Property 2: 非图像 3D 数组排除**
    - **Validates: Requirements 1.2, 2.4**
  - [ ]* 1.5 编写属性测试：维度提取准确性
    - **Property 3: 维度提取准确性**
    - **Validates: Requirements 1.3, 2.3**

- [x] 2. 添加增强检测和数据指针获取函数 (debugger.ts)
  - [x] 2.1 实现 `is3DCStyleArrayEnhanced()` 函数
    - 使用调试器命令获取准确类型信息
    - 回退到 `is3DCStyleArray()` 基础检测
    - _Requirements: 1.1, 1.3_
  - [x] 2.2 实现 `get3DArrayDataPointer()` 函数
    - 支持 C 风格和 std::array 两种类型
    - 通过 variables 方法遍历到 `[0][0][0]`
    - 回退到 evaluate 表达式 `&arr[0][0][0]`
    - 支持 LLDB, GDB, MSVC 三种调试器
    - _Requirements: 3.1, 3.2, 3.3, 3.4_

- [x] 3. 添加可视化函数 (matProvider.ts)
  - [x] 3.1 实现 `draw3DArrayImage()` 函数
    - 计算总字节数 `H * W * C * bytesPerElement`
    - 调用 `get3DArrayDataPointer()` 获取数据指针
    - 复用 `readMemoryChunked()` 读取内存
    - 复用现有 Image Viewer webview
    - 传入正确的 channels 参数
    - _Requirements: 4.1, 4.2, 4.3, 4.4_
  - [ ]* 3.2 编写属性测试：内存字节计算正确性
    - **Property 4: 内存字节计算正确性**
    - **Validates: Requirements 4.2**

- [-] 4. 集成到 Variables Panel (cvVariablesProvider.ts)
  - [x] 4.1 添加 3D 数组检测逻辑
    - 导入 `is3DCStyleArray`, `is3DStdArray`
    - 在 `getChildren()` 中添加检测分支
    - 设置 `kind = 'mat'`
    - 计算 `size = H * W * C`
    - 设置 `sizeInfo = '${H}x${W}x${C}'`
    - _Requirements: 5.1, 5.2, 5.3, 5.4_
  - [ ]* 4.2 编写属性测试：尺寸字符串格式
    - **Property 5: 尺寸字符串格式**
    - **Validates: Requirements 5.2**
  - [ ]* 4.3 编写属性测试：空数组检测
    - **Property 6: 空数组检测**
    - **Validates: Requirements 5.4, 6.1**

- [x] 5. 集成到主入口 (extension.ts)
  - [x] 5.1 添加 3D 数组检测和可视化分支
    - 导入新函数
    - 在 `visualizeVariable()` 中添加检测逻辑
    - 对 LLDB 使用增强检测
    - 添加空数组检查
    - 调用 `draw3DArrayImage()`
    - _Requirements: 4.1, 6.1, 6.2_

- [x] 6. Checkpoint - 确保所有测试通过
  - 运行 `npm run compile` 确保编译通过
  - 运行属性测试确保正确性
  - 如有问题请询问用户

- [x] 7. 更新文档
  - [x] 7.1 更新 DEVELOPMENT.md
    - 添加 3D 数组相关函数文档
    - 更新架构说明
    - _Requirements: N/A_
  - [x] 7.2 更新 README.md 和 README_CN.md
    - 在支持类型表格中添加 3D 数组
    - `T[H][W][C]` (C-style 3D array)
    - `std::array<std::array<std::array<T, C>, W>, H>`
    - _Requirements: N/A_

- [x] 8. Final Checkpoint - 确保所有测试通过
  - 运行完整测试套件
  - 验证编译无错误
  - 如有问题请询问用户

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties
- 实现顺序：基础检测 → 增强检测 → 可视化 → 集成 → 文档

