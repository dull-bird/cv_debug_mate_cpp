# Implementation Plan: Adaptive Plot Ticks

## Overview

本实现计划将在`src/plot/plotWebview.ts`中添加自适应刻度生成功能。核心工作包括：实现刻度生成算法、集成到现有绘图系统、编写测试验证正确性。实现将保持向后兼容，不影响现有功能。

## Tasks

- [x] 1. 实现核心刻度生成函数
  - 在plotWebview.ts的`<script>`标签内添加`niceNumber()`函数
  - 实现基于Wilkinson算法的nice number计算
  - 处理正数、负数和跨零范围
  - _Requirements: 2.1_

- [-] 2. 实现刻度生成器主函数
  - [x] 2.1 实现`generateTicks(min, max, targetCount, pixelLength)`函数
    - 计算粗略间隔和nice step
    - 生成刻度值数组
    - 确保刻度覆盖输入范围
    - _Requirements: 1.1, 1.2, 4.1, 4.2_

  - [ ]* 2.2 编写property test验证刻度数量
    - **Property 1: 刻度数量在目标范围内**
    - **Validates: Requirements 1.1, 1.2**

  - [ ]* 2.3 编写property test验证刻度单调性
    - **Property 2: 刻度值单调递增**
    - **Validates: Requirements 1.1**

  - [ ]* 2.4 编写property test验证范围覆盖
    - **Property 3: 刻度覆盖可见范围**
    - **Validates: Requirements 4.1, 4.2**

  - [ ]* 2.5 编写property test验证间隔一致性
    - **Property 4: 刻度间隔一致**
    - **Validates: Requirements 2.1**

  - [ ]* 2.6 编写property test验证nice number属性
    - **Property 5: 刻度间隔为nice number**
    - **Validates: Requirements 2.1**

- [-] 3. 实现标签格式化函数
  - [x] 3.1 实现`formatTickLabel(value, step)`函数
    - 根据step大小确定小数位数
    - 处理科学计数法（大于1e6或小于1e-3）
    - 确保所有标签格式一致
    - _Requirements: 2.2, 2.3_

  - [ ]* 3.2 编写property test验证标签格式一致性
    - **Property 6: 标签格式一致性**
    - **Validates: Requirements 2.3**

  - [ ]* 3.3 编写property test验证科学计数法使用
    - **Property 7: 科学计数法使用条件**
    - **Validates: Requirements 2.2**

- [x] 4. 集成到draw()函数 - Y轴刻度
  - [x] 4.1 修改Y轴刻度绘制逻辑
    - 调用`generateTicks()`替换硬编码的循环
    - 处理plot/scatter模式（使用minY, maxY）
    - 处理histogram模式（使用0到histMaxY）
    - 使用生成的labels而不是toFixed(2)
    - _Requirements: 3.1, 4.1, 4.2_

  - [ ]* 4.2 编写unit test验证Y轴刻度在不同模式下正确生成
    - 测试plot模式
    - 测试histogram模式
    - _Requirements: 4.1, 4.2_

- [x] 5. 集成到draw()函数 - X轴刻度
  - [x] 5.1 修改X轴刻度绘制逻辑
    - 调用`generateTicks()`替换硬编码的循环
    - 处理plot/scatter模式（使用minX, maxX）
    - 处理histogram模式（使用histDataMin, histDataMax）
    - 使用生成的labels
    - _Requirements: 3.1, 4.1, 4.2_

  - [ ]* 5.2 编写unit test验证X轴刻度在不同模式下正确生成
    - 测试plot模式
    - 测试histogram模式
    - _Requirements: 4.1, 4.2_

- [x] 6. Checkpoint - 基本功能验证
  - 手动测试缩放和平移操作
  - 验证刻度在不同缩放级别下正确更新
  - 确认所有测试通过
  - 如有问题请向用户反馈

- [x] 7. 实现防重叠优化
  - [x] 7.1 在generateTicks()中添加最小间距检查
    - 计算每个刻度的像素间距
    - 如果间距小于minSpacing（默认40px），减少刻度数量
    - 确保至少保留2个刻度
    - _Requirements: 5.1, 5.2, 5.3_

  - [ ]* 7.2 编写property test验证最小间距
    - **Property 8: 最小刻度间距保证**
    - **Validates: Requirements 5.1, 5.2**

  - [ ]* 7.3 编写edge case test验证极小空间
    - 测试空间不足时至少显示2个刻度
    - _Requirements: 5.3_

- [x] 8. 性能优化和测试
  - [x] 8.1 添加刻度计算缓存
    - 缓存上次计算的范围和结果
    - 只在范围改变时重新计算
    - _Requirements: 6.1_

  - [ ]* 8.2 编写property test验证性能
    - **Property 9: 性能约束**
    - **Validates: Requirements 6.1**

  - [ ]* 8.3 编写性能benchmark测试
    - 测试不同数据量下的性能
    - 测试连续缩放的帧率
    - _Requirements: 6.1_

- [x] 9. 边界条件处理
  - [x] 9.1 添加输入验证和错误处理
    - 处理min >= max的情况
    - 处理NaN和Infinity
    - 处理零范围（min === max）
    - 处理极端数值范围
    - _Requirements: 1.1, 2.1_

  - [x]* 9.2 编写unit tests验证边界条件
    - 测试零范围
    - 测试负数范围
    - 测试极小范围（< 1e-10）
    - 测试极大范围（> 1e10）
    - _Requirements: 1.1, 2.1_

- [x] 10. Final checkpoint - 完整功能验证
  - 运行所有测试确保通过
  - 手动测试所有绘图模式（plot, scatter, histogram）
  - 测试缩放、平移、重置功能
  - 测试自定义范围设置
  - 验证性能满足要求
  - 如有问题请向用户反馈

## Notes

- 任务标记`*`的为可选测试任务，可以跳过以加快MVP开发
- 每个任务都引用了具体的需求编号以便追溯
- Checkpoint任务确保增量验证
- Property tests使用fast-check库（如果项目中未安装，需要先安装）
- 所有代码修改集中在`src/plot/plotWebview.ts`文件中
- 保持向后兼容，不影响现有功能
