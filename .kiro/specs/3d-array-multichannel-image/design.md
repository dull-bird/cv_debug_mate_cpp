# Design Document: 3D Array Multi-Channel Image Support

## Overview

本设计文档描述如何为 CV DebugMate 扩展添加 3D 数组（多通道图像）的支持。设计遵循现有代码架构，复用已有的 2D 数组处理逻辑，并扩展类型检测和数据读取功能以支持三维数组。

核心设计原则：
1. **最小化代码改动** - 复用现有的 `draw2DStdArrayImage` 函数，只需传入正确的 channels 参数
2. **遵循现有架构** - 类型检测在 `opencv.ts`（基础）和 `debugger.ts`（增强）中实现
3. **统一处理逻辑** - C 风格和 std::array 3D 数组共享相同的可视化路径

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        extension.ts                              │
│  (主入口：类型检测分支 → 调用对应的可视化函数)                      │
└─────────────────────────────────────────────────────────────────┘
                              │
         ┌────────────────────┼────────────────────┐
         ▼                    ▼                    ▼
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│   opencv.ts     │  │   debugger.ts   │  │ matProvider.ts  │
│ (基础类型检测)   │  │ (增强类型检测)   │  │ (图像可视化)     │
│                 │  │ (数据指针获取)   │  │                 │
│ is3DCStyleArray │  │ is3DCStyleArray │  │ draw3DArrayImage│
│ is3DStdArray    │  │   Enhanced      │  │ (新增函数)       │
│ (新增函数)       │  │ get3DArrayData  │  │                 │
│                 │  │   Pointer       │  │                 │
└─────────────────┘  └─────────────────┘  └─────────────────┘
         │                    │                    │
         └────────────────────┼────────────────────┘
                              ▼
                    ┌─────────────────┐
                    │ cvVariables     │
                    │ Provider.ts     │
                    │ (TreeView 显示)  │
                    └─────────────────┘
```

## Components and Interfaces

### 1. 类型检测函数 (opencv.ts)

#### is3DCStyleArray

```typescript
/**
 * 检测 C 风格 3D 数组 (e.g., uint8_t[480][640][3])
 * @returns { is3DArray, height, width, channels, elementType, depth }
 */
export function is3DCStyleArray(variableInfo: any): {
  is3DArray: boolean;
  height: number;
  width: number;
  channels: number;
  elementType: string;
  depth: number;
}
```

类型字符串匹配模式：
- `unsigned char [480][640][3]`
- `uint8_t[100][100][3]`
- `float [H][W][C]`

正则表达式：
```typescript
const pattern = /([a-zA-Z_][a-zA-Z0-9_*\s]*)\s*\[\s*(\d+)\s*\]\s*\[\s*(\d+)\s*\]\s*\[\s*(\d+)\s*\]/;
```

#### is3DStdArray

```typescript
/**
 * 检测 3 层嵌套的 std::array (e.g., std::array<std::array<std::array<uint8_t, 3>, 640>, 480>)
 * @returns { is3DArray, height, width, channels, elementType, depth }
 */
export function is3DStdArray(variableInfo: any): {
  is3DArray: boolean;
  height: number;
  width: number;
  channels: number;
  elementType: string;
  depth: number;
}
```

类型字符串匹配模式：
- `std::array<std::array<std::array<uint8_t, 3>, 640>, 480>`
- `std::__1::array<std::__1::array<std::__1::array<float, 3>, 100>, 100>`
- `class std::array<class std::array<class std::array<unsigned char, 3>, 640>, 480>`

正则表达式：
```typescript
const pattern3D = /std::(?:__1::)?array\s*<\s*(?:class\s+)?std::(?:__1::)?array\s*<\s*(?:class\s+)?std::(?:__1::)?array\s*<\s*([^,>]+?)\s*,\s*(\d+)\s*>\s*,\s*(\d+)\s*>\s*,\s*(\d+)\s*>/;
// 捕获组: [1]=elementType, [2]=channels, [3]=width, [4]=height
```

### 2. 增强检测函数 (debugger.ts)

#### is3DCStyleArrayEnhanced

```typescript
/**
 * 使用调试器命令增强检测 C 风格 3D 数组
 * 先尝试调试器命令获取准确类型信息，失败则回退到基础字符串匹配
 */
export async function is3DCStyleArrayEnhanced(
  debugSession: vscode.DebugSession,
  variableName: string,
  frameId: number,
  variableInfo?: any
): Promise<{
  is3DArray: boolean;
  height: number;
  width: number;
  channels: number;
  elementType: string;
  depth: number;
}>
```

#### get3DArrayDataPointer

```typescript
/**
 * 获取 3D 数组的数据指针
 * 支持 C 风格和 std::array 两种类型
 */
export async function get3DArrayDataPointer(
  debugSession: vscode.DebugSession,
  variableName: string,
  frameId: number,
  variableInfo?: any,
  isStdArray: boolean = false
): Promise<string | null>
```

数据指针获取策略：
1. **Variables 方法**（优先）：通过 DAP variables 请求遍历到 `[0][0][0]` 元素
2. **Evaluate 方法**（回退）：使用表达式 `&arr[0][0][0]`

### 3. 可视化函数 (matProvider.ts)

#### draw3DArrayImage

```typescript
/**
 * 绘制 3D 数组图像
 * 复用现有的 Image Viewer webview，传入正确的 channels 参数
 */
export async function draw3DArrayImage(
  debugSession: vscode.DebugSession,
  variableInfo: any,
  frameId: number,
  variableName: string,
  arrayInfo: {
    is3DArray: boolean;
    height: number;
    width: number;
    channels: number;
    elementType: string;
    depth: number;
  },
  reveal: boolean = true,
  force: boolean = false
)
```

实现逻辑：
1. 计算总字节数：`height * width * channels * bytesPerElement`
2. 获取数据指针
3. 读取内存数据
4. 发送到 webview（现有 Image Viewer 已支持多通道）

### 4. TreeView 集成 (cvVariablesProvider.ts)

在 `getChildren` 方法中添加 3D 数组检测：

```typescript
// 3D array detection
const cStyleArray3D = is3DCStyleArray(v);
const stdArray3D = is3DStdArray(v);

if (cStyleArray3D.is3DArray || stdArray3D.is3DArray) {
  const info = cStyleArray3D.is3DArray ? cStyleArray3D : stdArray3D;
  kind = 'mat';
  size = info.height * info.width * info.channels;
  sizeInfo = `${info.height}x${info.width}x${info.channels}`;
}
```

## Data Models

### 3D Array Info 结构

```typescript
interface Array3DInfo {
  is3DArray: boolean;
  height: number;      // 第一维度 (行数)
  width: number;       // 第二维度 (列数)
  channels: number;    // 第三维度 (通道数，通常为 1, 3, 或 4)
  elementType: string; // 元素类型 (e.g., "unsigned char", "float")
  depth: number;       // OpenCV 深度 (0=CV_8U, 5=CV_32F, etc.)
}
```

### 内存布局

3D 数组在内存中是连续存储的，采用行优先（row-major）顺序：

```
内存地址: [0][0][0] [0][0][1] [0][0][2] [0][1][0] [0][1][1] [0][1][2] ...
          ↑ R1      ↑ G1      ↑ B1      ↑ R2      ↑ G2      ↑ B2
          └─────── Pixel 1 ──────┘      └─────── Pixel 2 ──────┘
```

这与 OpenCV `cv::Mat` 的默认存储方式（Interleaved）完全一致。

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: 3D 数组类型检测正确性

*For any* type string representing a C-style 3D array (`T[H][W][C]`) or std::array 3D array with valid channel count (1, 3, or 4), the type detector SHALL correctly identify it as a 3D array suitable for image visualization.

**Validates: Requirements 1.1, 2.1**

### Property 2: 非图像 3D 数组排除

*For any* type string representing a 3D array with channel count NOT in {1, 3, 4}, the type detector SHALL return `is3DArray: false` and NOT identify it as an image-suitable 3D array.

**Validates: Requirements 1.2, 2.4**

### Property 3: 维度提取准确性

*For any* valid 3D array type string with known dimensions (H, W, C) and element type T, the type detector SHALL extract the exact same values for height, width, channels, and elementType.

**Validates: Requirements 1.3, 2.3**

### Property 4: 内存字节计算正确性

*For any* 3D array with dimensions H×W×C and element depth D, the total bytes calculated SHALL equal `H * W * C * getBytesPerElement(D)`.

**Validates: Requirements 4.2**

### Property 5: 尺寸字符串格式

*For any* 3D array with dimensions H, W, C, the size info string SHALL be formatted as `${H}x${W}x${C}`.

**Validates: Requirements 5.2**

### Property 6: 空数组检测

*For any* 3D array where H=0 OR W=0 OR C=0, the system SHALL identify it as empty (size === 0 or isEmpty === true).

**Validates: Requirements 5.4, 6.1**

## Error Handling

### 类型检测错误

| 错误场景 | 处理方式 |
|---------|---------|
| 类型字符串无法解析 | 返回 `is3DArray: false`，不影响其他类型检测 |
| 通道数不是 1/3/4 | 返回 `is3DArray: false`，可能是其他 3D 数据结构 |
| 调试器命令失败 | 回退到基础字符串匹配 |

### 数据读取错误

| 错误场景 | 处理方式 |
|---------|---------|
| 数据指针获取失败 | 显示错误消息 "Cannot get data pointer from 3D array" |
| 内存读取失败 | 显示错误消息，建议使用支持的调试器 |
| 数组为空 | 显示信息消息 "3D array is empty" |

### 调试器兼容性

| 调试器 | 支持状态 | 备注 |
|--------|---------|------|
| cppvsdbg (MSVC) | ✅ 完全支持 | Windows |
| cppdbg (GDB) | ✅ 完全支持 | Linux/MinGW |
| CodeLLDB | ✅ 完全支持 | macOS |

## Testing Strategy

### 单元测试

1. **类型检测测试**
   - 测试各种 C 风格 3D 数组类型字符串
   - 测试各种 std::array 3D 嵌套类型字符串
   - 测试边界情况（无效通道数、空数组）

2. **维度提取测试**
   - 验证从类型字符串正确提取 H, W, C
   - 验证元素类型到 OpenCV depth 的映射

### 属性测试

使用 fast-check 进行属性测试，每个属性测试至少运行 100 次迭代。

1. **Property 1 测试**: 生成随机有效 3D 数组类型字符串，验证检测结果
2. **Property 2 测试**: 生成随机无效通道数的 3D 数组，验证被排除
3. **Property 5 测试**: 生成包含零维度的 3D 数组，验证空检测

### 集成测试

1. 在 `test_cpp/` 目录添加 3D 数组测试用例
2. 测试 C 风格 `uint8_t img[100][100][3]`
3. 测试 std::array 嵌套 `std::array<std::array<std::array<uint8_t, 3>, 100>, 100>`
4. 测试不同数据类型（uint8_t, float, double）
5. 测试不同通道数（1, 3, 4）

