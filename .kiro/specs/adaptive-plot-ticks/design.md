# Design Document: Adaptive Plot Ticks

## Overview

本设计文档描述了如何在1D plot webview中实现自适应刻度系统。当前实现使用固定的6个刻度点（i从0到5），无论缩放级别如何都保持不变。新设计将引入智能刻度生成算法，根据可见数据范围动态计算合适的刻度位置和数值。

核心改进：
- 实现基于Wilkinson's "nice numbers"算法的刻度生成器
- 根据可见范围和屏幕空间动态调整刻度数量
- 确保刻度值为"整齐"的数字（如0.1, 0.5, 1, 2, 5, 10的倍数）
- 支持所有绘图模式（plot, scatter, histogram）

## Architecture

### 当前架构问题

当前代码在`draw()`函数中硬编码刻度生成：

```javascript
// Y-axis tick labels
for (let i = 0; i <= 5; i++) {
    let val = minY + (rangeY * i / 5);
    let yPos = toScreenY(val);
    // ... 绘制刻度
}

// X-axis tick labels
for (let i = 0; i <= 5; i++) {
    let val = minX + (rangeX * i / 5);
    let xPos = toScreenX(val);
    // ... 绘制刻度
}
```

这种方法的问题：
1. 刻度数量固定为6个，不考虑缩放级别
2. 刻度值可能是"不整齐"的数字（如3.7142857）
3. 没有考虑标签重叠问题
4. 缩放后刻度密度不合理

### 新架构设计

引入独立的刻度生成模块：

```
┌─────────────────────────────────────┐
│         Plot System                 │
│  ┌──────────────────────────────┐  │
│  │   draw() function            │  │
│  │  - 调用 generateTicks()      │  │
│  │  - 绘制刻度和标签            │  │
│  └──────────────────────────────┘  │
│                                     │
│  ┌──────────────────────────────┐  │
│  │   Tick Generator             │  │
│  │  - generateTicks(min, max)   │  │
│  │  - niceNumber(range)         │  │
│  │  - formatTickLabel(value)    │  │
│  └──────────────────────────────┘  │
└─────────────────────────────────────┘
```

## Components and Interfaces

### 1. Tick Generator

核心函数：`generateTicks(min, max, targetCount, pixelLength)`

**输入参数：**
- `min`: 可见范围的最小值
- `max`: 可见范围的最大值
- `targetCount`: 目标刻度数量（默认6）
- `pixelLength`: 坐标轴的像素长度（用于防止标签重叠）

**输出：**
```javascript
{
    values: [0, 0.5, 1.0, 1.5, 2.0],  // 刻度值数组
    labels: ['0.0', '0.5', '1.0', '1.5', '2.0'],  // 格式化的标签
    step: 0.5  // 刻度间隔
}
```

**算法步骤：**

1. 计算粗略间隔：`roughStep = (max - min) / (targetCount - 1)`
2. 将间隔标准化为"nice number"：
   - 计算数量级：`magnitude = Math.pow(10, Math.floor(Math.log10(roughStep)))`
   - 标准化：`normalized = roughStep / magnitude`
   - 选择最接近的nice number：[1, 2, 5, 10]
   - 最终间隔：`niceStep = niceNumber * magnitude`
3. 计算刻度起点：`tickMin = Math.floor(min / niceStep) * niceStep`
4. 生成刻度序列：从`tickMin`开始，每次增加`niceStep`，直到超过`max`
5. 格式化标签：根据数值大小选择合适的小数位数

### 2. Nice Number Function

```javascript
function niceNumber(value, round) {
    const exponent = Math.floor(Math.log10(value));
    const fraction = value / Math.pow(10, exponent);
    let niceFraction;
    
    if (round) {
        if (fraction < 1.5) niceFraction = 1;
        else if (fraction < 3) niceFraction = 2;
        else if (fraction < 7) niceFraction = 5;
        else niceFraction = 10;
    } else {
        if (fraction <= 1) niceFraction = 1;
        else if (fraction <= 2) niceFraction = 2;
        else if (fraction <= 5) niceFraction = 5;
        else niceFraction = 10;
    }
    
    return niceFraction * Math.pow(10, exponent);
}
```

### 3. Label Formatter

```javascript
function formatTickLabel(value, step) {
    // 确定小数位数
    const stepMagnitude = Math.floor(Math.log10(Math.abs(step)));
    const decimalPlaces = Math.max(0, -stepMagnitude + 1);
    
    // 处理非常小或非常大的数字
    if (Math.abs(value) >= 1e6 || (Math.abs(value) < 1e-3 && value !== 0)) {
        return value.toExponential(2);
    }
    
    return value.toFixed(decimalPlaces);
}
```

### 4. 集成到draw()函数

修改`draw()`函数中的刻度绘制逻辑：

```javascript
function draw() {
    // ... 现有代码 ...
    
    // 生成Y轴刻度
    const yTicks = generateTicks(
        plotMode === 'hist' ? 0 : minY,
        plotMode === 'hist' ? histMaxY : maxY,
        6,
        innerHeight
    );
    
    // 绘制Y轴刻度
    ctx.fillStyle = '#888';
    ctx.font = axisFontSize + 'px Arial';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    
    for (let i = 0; i < yTicks.values.length; i++) {
        const val = yTicks.values[i];
        const label = yTicks.labels[i];
        let yPos;
        
        if (plotMode === 'hist') {
            yPos = height - padding.bottom - (val / histMaxY) * innerHeight;
        } else {
            yPos = toScreenY(val);
        }
        
        if (yPos >= padding.top && yPos <= height - padding.bottom) {
            ctx.fillText(label, padding.left - yTickOffset, yPos);
            ctx.beginPath();
            ctx.moveTo(padding.left - 4, yPos);
            ctx.lineTo(padding.left, yPos);
            ctx.stroke();
        }
    }
    
    // 生成X轴刻度（类似逻辑）
    const xTicks = generateTicks(
        plotMode === 'hist' ? histDataMin : minX,
        plotMode === 'hist' ? histDataMax : maxX,
        6,
        innerWidth
    );
    
    // 绘制X轴刻度
    // ... 类似Y轴的绘制逻辑 ...
}
```

## Data Models

### TickData Interface

```typescript
interface TickData {
    values: number[];      // 刻度的数值
    labels: string[];      // 格式化后的标签文本
    step: number;          // 刻度间隔
}
```

### TickGeneratorConfig

```typescript
interface TickGeneratorConfig {
    targetCount: number;   // 目标刻度数量（默认6）
    minCount: number;      // 最少刻度数量（默认2）
    maxCount: number;      // 最多刻度数量（默认10）
    minSpacing: number;    // 最小像素间距（默认40px）
}
```

## Correctness Properties

*属性是关于系统应该保持为真的特征或行为的形式化陈述——本质上是关于系统应该做什么的形式化声明。属性作为人类可读规范和机器可验证正确性保证之间的桥梁。*

### Property 1: 刻度数量在目标范围内

*对于任意*有效的数据范围（min < max）和目标刻度数量targetCount，生成的刻度数量应该在[targetCount-2, targetCount+2]范围内，且至少为2个

**Validates: Requirements 1.1, 1.2**

### Property 2: 刻度值单调递增

*对于任意*生成的刻度序列，相邻刻度值应该严格递增，即 `ticks.values[i] < ticks.values[i+1]` 对所有有效索引i成立

**Validates: Requirements 1.1**

### Property 3: 刻度覆盖可见范围

*对于任意*数据范围[min, max]，生成的第一个刻度应该小于等于min，最后一个刻度应该大于等于max

**Validates: Requirements 4.1, 4.2**

### Property 4: 刻度间隔一致

*对于任意*生成的刻度序列，相邻刻度之间的间隔应该相等（在浮点精度1e-10范围内），即 `Math.abs((ticks.values[i+1] - ticks.values[i]) - ticks.step) < 1e-10`

**Validates: Requirements 2.1**

### Property 5: 刻度间隔为nice number

*对于任意*生成的刻度间隔step，step应该可以表示为 `k * 10^n` 的形式，其中k ∈ {1, 2, 5}，n为整数（在浮点精度范围内）

**Validates: Requirements 2.1**

### Property 6: 标签格式一致性

*对于任意*刻度序列（不使用科学计数法时），所有标签应该包含相同数量的小数点后数字

**Validates: Requirements 2.3**

### Property 7: 科学计数法使用条件

*对于任意*数据范围，当范围内存在绝对值大于等于1e6或小于1e-3（且非零）的值时，标签应该使用科学计数法格式

**Validates: Requirements 2.2**

### Property 8: 最小刻度间距保证

*对于任意*给定的像素长度pixelLength和最小间距minSpacing，生成的刻度数量应该满足 `pixelLength / (刻度数量 - 1) >= minSpacing`

**Validates: Requirements 5.1, 5.2**

### Property 9: 性能约束

*对于任意*数据范围，刻度生成函数的执行时间应该小于10毫秒

**Validates: Requirements 6.1**

## Error Handling

### 1. 无效输入处理

- **场景**: min >= max
- **处理**: 返回默认刻度 [min, max]，或使用 [min, min+1] 作为范围

### 2. 极端数值范围

- **场景**: 范围非常小（< 1e-10）或非常大（> 1e10）
- **处理**: 使用科学计数法格式化标签，调整nice number选择策略

### 3. 零范围

- **场景**: min === max
- **处理**: 创建人工范围 [min - 1, min + 1] 或 [min * 0.9, min * 1.1]

### 4. NaN或Infinity

- **场景**: 输入包含NaN或Infinity
- **处理**: 过滤无效值，使用有效数据的范围

## Testing Strategy

### Unit Tests

1. **基本刻度生成测试**
   - 测试标准范围（如[0, 10]）生成合理刻度
   - 测试负数范围（如[-5, 5]）
   - 测试小数范围（如[0.1, 0.9]）

2. **Nice number测试**
   - 验证niceNumber函数返回1, 2, 5, 10的倍数
   - 测试不同数量级的输入

3. **标签格式化测试**
   - 测试整数、小数、科学计数法的格式化
   - 验证小数位数一致性

4. **边界条件测试**
   - 零范围
   - 极小范围（< 1e-10）
   - 极大范围（> 1e10）
   - 负数范围

### Property-Based Tests

使用JavaScript的property-based testing库（如fast-check）进行测试：

1. **Property 1测试**: 生成随机范围，验证刻度数量在[2, 10]之间
2. **Property 2测试**: 验证刻度序列单调递增
3. **Property 3测试**: 验证刻度覆盖输入范围
4. **Property 4测试**: 验证刻度间隔一致性
5. **Property 5测试**: 验证刻度间隔为nice number
6. **Property 6测试**: 验证标签格式一致性

每个property test应该运行至少100次迭代，标签格式：
**Feature: adaptive-plot-ticks, Property {number}: {property_text}**

### Integration Tests

1. **缩放交互测试**
   - 模拟用户缩放操作，验证刻度更新
   - 测试连续缩放的性能

2. **模式切换测试**
   - 在plot/scatter/histogram模式间切换
   - 验证每种模式下刻度正确生成

3. **视觉回归测试**
   - 捕获不同缩放级别的截图
   - 验证刻度标签不重叠

## Implementation Notes

### 代码位置

修改文件：`src/plot/plotWebview.ts`

主要修改区域：
1. 在`<script>`标签内添加`generateTicks()`、`niceNumber()`、`formatTickLabel()`函数
2. 修改`draw()`函数中的刻度绘制逻辑（约第700-750行）

### 向后兼容性

- 保持现有的设置面板功能不变
- 自定义范围（xMin, xMax, yMin, yMax）仍然有效
- 不影响其他功能（导出、模式切换等）

### 性能优化

- 刻度计算结果可以缓存，只在范围改变时重新计算
- 避免在每次鼠标移动时重新计算刻度
- 使用requestAnimationFrame优化连续缩放时的重绘

### 国际化考虑

- 数字格式化应该考虑locale（当前使用默认的toFixed）
- 未来可以添加千位分隔符支持
