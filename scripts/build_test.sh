#!/usr/bin/env bash
set -e

# 获取脚本所在的目录，然后推演项目根目录，确保无论在哪儿调用都不会迷路
PROJ_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)

echo "🔧 切换到 test_cpp 目录配置 CMake..."
mkdir -p "$PROJ_ROOT/test_cpp/build"
cd "$PROJ_ROOT/test_cpp/build"

# 配置与编译
cmake ..
echo "🔨 开始编译 (cmake --build .)..."
cmake --build . -j

echo "🚀 运行测试程序 test_debugmate..."
./test_debugmate

echo "✅ 执行完毕!"
