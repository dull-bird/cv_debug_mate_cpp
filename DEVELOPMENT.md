# CV DebugMate C++ 开发文档

本文档面向 AI 编程助手和开发者，详细说明项目的技术架构、调试器适配策略和代码组织方式。

## 目录

- [项目架构概览](#项目架构概览)
- [调试器适配策略](#调试器适配策略)
- [数据类型检测与处理](#数据类型检测与处理)
- [内存读取策略](#内存读取策略)
- [关键函数说明](#关键函数说明)
- [代码组织与模块职责](#代码组织与模块职责)
- [开发注意事项](#开发注意事项)

---

## 项目架构概览

```
src/
├── extension.ts              # 扩展入口，变量可视化主逻辑
├── cvVariablesProvider.ts    # TreeView 变量列表提供器
├── utils/
│   ├── debugger.ts           # 调试器适配层（核心）
│   ├── opencv.ts             # OpenCV 类型检测（纯字符串匹配）
│   ├── panelManager.ts       # Webview 面板管理
│   └── syncManager.ts        # 变量配对同步管理
├── matImage/
│   ├── matProvider.ts        # 2D 图像数据读取
│   └── matWebview.ts         # 图像 Webview 渲染
├── plot/
│   ├── plotProvider.ts       # 1D 数据读取
│   └── plotWebview.ts        # 曲线图 Webview 渲染
└── pointCloud/
    ├── pointCloudProvider.ts # 3D 点云数据读取
    └── pointCloudWebview.ts  # 点云 Webview 渲染
```

---

## 调试器适配策略

### 支持的调试器类型

| 调试器类型 | `debugSession.type` | 编译器/平台 | 标准库实现 |
|-----------|---------------------|------------|-----------|
| **LLDB (CodeLLDB)** | `"lldb"` | Clang (macOS/Linux) | libc++ |
| **GDB (cppdbg)** | `"cppdbg"` | GCC (Linux/MinGW) | libstdc++ |
| **MSVC (cppvsdbg)** | `"cppvsdbg"` | MSVC (Windows) | MSVC STL |

### 调试器检测函数 (`src/utils/debugger.ts`)

```typescript
// 检测当前调试器类型
export function isUsingLLDB(debugSession: vscode.DebugSession): boolean {
  return debugSession.type === "lldb";
}

export function isUsingCppdbg(debugSession: vscode.DebugSession): boolean {
  return debugSession.type === "cppdbg";
}

export function isUsingMSVC(debugSession: vscode.DebugSession): boolean {
  return debugSession.type === "cppvsdbg";
}
```

### 表达式求值上下文 (`context` 参数)

不同调试器对 `evaluate` 请求的 `context` 参数处理不同：

```typescript
export function getEvaluateContext(debugSession: vscode.DebugSession): string {
  // CodeLLDB 将 "repl" 视为命令模式，需要用 "watch" 进行表达式求值
  if (isUsingLLDB(debugSession)) {
    return "watch";
  }
  // cppdbg 和 cppvsdbg 使用 "repl" 即可
  return "repl";
}
```

### 标准库内部成员名称差异

`std::array` 和 `std::vector` 的内部数据成员在不同标准库实现中名称不同：

| 标准库 | `std::array` 内部成员 | `std::vector` 数据指针 |
|-------|---------------------|----------------------|
| **libc++ (Clang)** | `__elems_` | `__begin_` |
| **libstdc++ (GCC)** | `_M_elems` | `_M_start` |
| **MSVC STL** | `_Elems` | `_Myfirst` |

代码中定义了常量来统一处理：

```typescript
export const STL_ARRAY_MEMBERS = ["__elems_", "_M_elems", "_Elems"];
export const STL_VECTOR_DATA_MEMBERS = ["__begin_", "_M_start", "_Myfirst"];
```

### 调试器特定表达式构建

不同调试器对表达式语法的支持不同，使用辅助函数构建：

```typescript
// 构建获取数据指针的表达式
export function buildDataPointerExpressions(
  debugSession: vscode.DebugSession,
  variableName: string,
  accessPath: string = ".data()"
): string[]

// 构建获取容器大小的表达式
export function buildSizeExpressions(
  debugSession: vscode.DebugSession,
  variableName: string
): string[]
```

---

## 数据类型检测与处理

### 两层检测架构

项目采用**两层检测架构**：

1. **基础检测层** (`src/utils/opencv.ts`)
   - 纯字符串匹配，基于 `variableInfo.type` 字符串
   - 不依赖调试器，速度快
   - 用于 TreeView 变量列表的快速分类

2. **增强检测层** (`src/utils/debugger.ts`)
   - 使用调试器命令获取更准确的类型信息
   - 仅在 LLDB 下使用（因为 LLDB 的类型字符串可能不完整）
   - 用于实际可视化时的精确检测
   - 回退到基础检测层

### 类型检测函数对照表

| 数据类型 | 基础检测 (`opencv.ts`) | 增强检测 (`debugger.ts`) |
|---------|----------------------|------------------------|
| 3D `std::array` | `is3DStdArray()` | - |
| 3D C 风格数组 | `is3DCStyleArray()` | `is3DCStyleArrayEnhanced()` |
| 2D `std::array` | `is2DStdArray()` | `is2DStdArrayEnhanced()` |
| 2D C 风格数组 | `is2DCStyleArray()` | `is2DCStyleArrayEnhanced()` |
| 1D `std::array` | `is1DStdArray()` | - |
| 1D C 风格数组 | `is1DCStyleArray()` | `is1DCStyleArrayEnhanced()` |
| `cv::Mat` | `isMat()` | - |
| `cv::Matx` | `isMatx()` | - |
| `std::vector<Point3>` | `isPoint3Vector()` | - |
| `std::array<Point3>` | `isPoint3StdArray()` | - |
| 1D `std::vector` | `is1DVector()` | - |
| 1D `std::set` | `is1DSet()` | - |

### 增强检测的工作原理

`is2DStdArrayEnhanced()` 和 `is2DCStyleArrayEnhanced()` 使用调试器命令获取类型信息：

```typescript
// LLDB: 使用 frame variable 命令
`frame variable --show-types --depth 0 ${variableName}`
// 输出示例: (int[2][3]) rawArr = {...}

// GDB: 使用 ptype 命令
`-exec ptype ${variableName}`
// 输出示例: type = int [2][3]

// MSVC: 使用格式说明符
`${variableName},t`
```

增强检测函数会先尝试调试器命令，失败后自动回退到基础检测：

```typescript
export async function is2DStdArrayEnhanced(...) {
  // 1. 尝试调试器命令
  const typeInfo = await getArrayTypeInfo(debugSession, variableName, frameId);
  
  if (typeInfo) {
    // 成功，返回结果
    return { is2DArray: true, rows, cols, elementType, depth };
  }
  
  // 2. 回退到基础检测
  return is2DStdArray(variableInfo);
}
```

---

## 内存读取策略

### 获取数据指针的多策略方法

由于不同调试器返回的信息格式不同，获取数据指针采用多策略尝试：

**策略 1: 通过 `variablesReference` 展开变量树**

```typescript
// 展开变量获取子成员
const varsResponse = await debugSession.customRequest("variables", {
  variablesReference: variableInfo.variablesReference
});

// 查找 [0] 元素或内部成员
for (const v of varsResponse.variables) {
  if (v.memoryReference) {
    return v.memoryReference;  // 直接获取内存引用
  }
}
```

**策略 2: 通过表达式求值**

```typescript
// 使用辅助函数构建调试器特定的表达式
const expressions = buildDataPointerExpressions(debugSession, variableName);
dataPtr = await tryGetDataPointer(debugSession, variableName, expressions, frameId, context);
```

### 分块内存读取

大数据量使用并行分块读取：

```typescript
export async function readMemoryChunked(
  debugSession: vscode.DebugSession,
  memoryReference: string,
  totalBytes: number,
  progress?: vscode.Progress<{ message?: string; increment?: number }>
): Promise<Buffer | null> {
  const CHUNK_SIZE = 8 * 1024 * 1024; // 8MB per chunk
  const CONCURRENCY = Math.min(8, Math.max(2, os.cpus().length));
  // ... 并行读取逻辑
}
```

---

## 关键函数说明

### `is2DStdArrayEnhanced()` 函数

**位置**: `src/utils/debugger.ts`

**功能**: 使用调试器命令检测 2D `std::array`，支持所有调试器类型。

**为什么需要这个函数**:
- LLDB 返回的 `variableInfo.type` 字符串可能不包含完整的模板参数
- 通过 `frame variable --show-types` 命令可以获取完整类型信息

**调用时机**:
```typescript
// extension.ts 中
let stdArray2D;
if (isLLDB) {
  stdArray2D = await is2DStdArrayEnhanced(debugSession, variableName, frameId, variableInfo);
} else {
  stdArray2D = is2DStdArray(variableInfo);  // 使用基础检测
}
```

### `is2DCStyleArrayEnhanced()` 函数

**位置**: `src/utils/debugger.ts`

**功能**: 使用调试器命令检测 2D C 风格数组（如 `int[2][3]`）。

### `is1DCStyleArrayEnhanced()` 函数

**位置**: `src/utils/debugger.ts`

**功能**: 使用调试器命令检测 1D C 风格数组（如 `int[10]`）。

**工作原理**:
- 使用与 2D 检测相同的调试器命令获取类型信息
- 解析输出时排除 2D 数组模式（`type[rows][cols]`）
- 仅匹配 1D 数组模式（`type[size]`）
- 失败时回退到基础检测 `is1DCStyleArray()`

### `is3DCStyleArray()` 函数

**位置**: `src/utils/opencv.ts`

**功能**: 检测 C 风格 3D 数组（如 `uint8_t[480][640][3]`），用于多通道图像可视化。

**类型字符串匹配模式**:
- `unsigned char [480][640][3]`
- `uint8_t[100][100][3]`
- `float [H][W][C]`

**返回值**: `{ is3DArray, height, width, channels, elementType, depth }`

**通道数限制**: 仅当最内层维度为 1、3 或 4 时才识别为图像（其他通道数可能是非图像 3D 数据）

### `is3DStdArray()` 函数

**位置**: `src/utils/opencv.ts`

**功能**: 检测 3 层嵌套的 std::array（如 `std::array<std::array<std::array<uint8_t, 3>, 640>, 480>`）。

**类型字符串匹配模式**:
- `std::array<std::array<std::array<uint8_t, 3>, 640>, 480>`
- `std::__1::array<std::__1::array<std::__1::array<float, 3>, 100>, 100>` (libc++)
- `class std::array<class std::array<class std::array<unsigned char, 3>, 640>, 480>` (MSVC)

**返回值**: `{ is3DArray, height, width, channels, elementType, depth }`

### `is3DCStyleArrayEnhanced()` 函数

**位置**: `src/utils/debugger.ts`

**功能**: 使用调试器命令增强检测 C 风格 3D 数组。

**工作原理**:
- 先尝试调试器命令获取准确类型信息
- 失败时回退到基础检测 `is3DCStyleArray()`

### `get3DArrayDataPointer()` 函数

**位置**: `src/utils/debugger.ts`

**功能**: 获取 3D 数组的数据指针，支持 C 风格和 std::array 两种类型。

**数据指针获取策略**:
1. **Variables 方法**（优先）：通过 DAP variables 请求遍历到 `[0][0][0]` 元素
2. **Evaluate 方法**（回退）：使用表达式 `&arr[0][0][0]`

### `draw3DArrayImage()` 函数

**位置**: `src/matImage/matProvider.ts`

**功能**: 绘制 3D 数组图像，复用现有的 Image Viewer webview。

**实现逻辑**:
1. 计算总字节数：`height * width * channels * bytesPerElement`
2. 调用 `get3DArrayDataPointer()` 获取数据指针
3. 使用 `readMemoryChunked()` 读取内存数据
4. 发送到 webview（现有 Image Viewer 已支持多通道）

### `getArrayTypeInfo()` 函数

**位置**: `src/utils/debugger.ts`

**功能**: 底层函数，执行调试器命令并解析类型信息。

**被调用者**: `is2DStdArrayEnhanced()`, `is2DCStyleArrayEnhanced()`

---

## 代码组织与模块职责

### `src/utils/opencv.ts` - 类型检测（纯函数）

**职责**: 
- 基于字符串匹配的类型检测
- 不依赖调试器 API
- 提供 OpenCV 深度类型转换

**导出函数**:
- `isMat()`, `isMatx()` - cv::Mat 类型检测
- `is3DStdArray()`, `is3DCStyleArray()` - 3D 数组检测（多通道图像）
- `is2DStdArray()`, `is1DStdArray()` - std::array 检测
- `is2DCStyleArray()` - C 风格数组检测
- `isPoint3Vector()`, `isPoint3StdArray()` - 点云类型检测
- `is1DVector()`, `is1DSet()` - 1D 容器检测
- `getDepthFromCppType()` - C++ 类型到 OpenCV 深度映射
- `getBytesPerElement()`, `convertBytesToValues()` - 数据转换

### `src/utils/debugger.ts` - 调试器适配层

**职责**:
- 调试器类型检测
- 调试器特定的表达式构建
- 增强类型检测（使用调试器命令，回退到基础检测）
- 内存读取
- 数据指针获取

**导出函数**:
- `isUsingLLDB()`, `isUsingCppdbg()`, `isUsingMSVC()` - 调试器检测
- `getEvaluateContext()` - 获取求值上下文
- `buildDataPointerExpressions()`, `buildSizeExpressions()` - 表达式构建
- `evaluateWithTimeout()` - 带超时的表达式求值
- `getCurrentFrameId()` - 获取当前栈帧 ID
- `readMemoryChunked()` - 分块内存读取
- `getVectorSize()` - 获取 vector 大小
- `getStdArrayDataPointer()`, `get2DStdArrayDataPointer()` - std::array 数据指针
- `getCStyle2DArrayDataPointer()` - C 风格数组数据指针
- `get3DArrayDataPointer()` - 3D 数组数据指针（C 风格和 std::array）
- `is2DStdArrayEnhanced()`, `is2DCStyleArrayEnhanced()` - 增强类型检测
- `is3DCStyleArrayEnhanced()` - 3D C 风格数组增强检测
- `getArrayTypeInfo()` - 调试器命令获取类型信息

### `src/cvVariablesProvider.ts` - 变量列表

**职责**:
- 提供 TreeView 数据
- 快速分类变量（使用基础检测）
- 管理变量配对

### `src/extension.ts` - 主入口

**职责**:
- 注册命令和事件
- 协调可视化流程
- 根据调试器类型选择检测策略

---

## 开发注意事项

### 添加新数据类型支持

1. 在 `opencv.ts` 添加基础检测函数
2. 如果需要调试器命令支持，在 `debugger.ts` 添加增强检测函数（使用基础检测作为回退）
3. 在 `cvVariablesProvider.ts` 添加 TreeView 分类逻辑
4. 在 `extension.ts` 添加可视化分支
5. 在相应的 Provider 中添加数据读取逻辑

### 调试器兼容性测试

新功能需要在以下环境测试：
- macOS + Clang + CodeLLDB
- Linux + GCC + cppdbg
- Windows + MSVC + cppvsdbg
- Windows + MinGW + cppdbg

### 常见问题

**Q: 为什么 LLDB 需要特殊处理？**

A: CodeLLDB 的 `evaluate` 请求在 `context: "repl"` 时会进入命令模式而非表达式求值模式，需要使用 `context: "watch"`。此外，LLDB 返回的类型字符串可能不完整，需要使用 `frame variable` 命令获取完整信息。

**Q: 为什么有两层检测架构？**

A: TreeView 需要快速响应，使用纯字符串匹配的基础检测。实际可视化时可以花更多时间使用调试器命令获取准确信息。增强检测会自动回退到基础检测，避免代码重复。

**Q: 如何处理标准库差异？**

A: 在访问内部成员时，使用 `STL_ARRAY_MEMBERS` 和 `STL_VECTOR_DATA_MEMBERS` 常量同时检查所有可能的命名。

---

## 版本历史

### v0.0.34 (3D 数组支持)
- 新增 3D 数组（多通道图像）支持
- 添加 `is3DCStyleArray()` 和 `is3DStdArray()` 基础检测函数
- 添加 `is3DCStyleArrayEnhanced()` 增强检测函数
- 添加 `get3DArrayDataPointer()` 数据指针获取函数
- 添加 `draw3DArrayImage()` 可视化函数
- 支持 `T[H][W][C]` C 风格 3D 数组
- 支持 `std::array<std::array<std::array<T, C>, W>, H>` 嵌套数组
- 通道数限制为 1、3、4（灰度、RGB/BGR、RGBA/BGRA）

### v0.0.33 (重构)
- 重构增强检测函数，使用基础检测作为回退，消除代码重复
- 将 `is2DStdArrayLLDB` 重命名为 `is2DStdArrayEnhanced`（保留别名兼容）
- 添加 `buildDataPointerExpressions()` 和 `buildSizeExpressions()` 辅助函数
- 添加 `STL_ARRAY_MEMBERS` 和 `STL_VECTOR_DATA_MEMBERS` 常量
- 改进代码组织和文档

### v0.0.32
- 新增 2D C 风格数组支持
- 增强 LLDB 下的 2D std::array 检测
- 使用调试器命令获取更准确的类型信息
