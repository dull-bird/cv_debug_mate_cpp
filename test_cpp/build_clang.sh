#!/bin/bash
# Build script for Mac/Linux using Clang + Ninja
# Requires: Clang, Ninja, CMake, OpenCV

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUILD_DIR="$SCRIPT_DIR/build_ninja"
BUILD_TYPE="Debug"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Check for required tools
command -v clang >/dev/null 2>&1 || { echo -e "${RED}Error: clang not found${NC}"; exit 1; }
command -v ninja >/dev/null 2>&1 || { echo -e "${RED}Error: ninja not found${NC}"; exit 1; }
command -v cmake >/dev/null 2>&1 || { echo -e "${RED}Error: cmake not found${NC}"; exit 1; }

# Create build directory
mkdir -p "$BUILD_DIR"
cd "$BUILD_DIR"

echo -e "${CYAN}Configuring with CMake...${NC}"
cmake -G Ninja \
    -DCMAKE_C_COMPILER=clang \
    -DCMAKE_CXX_COMPILER=clang++ \
    -DCMAKE_BUILD_TYPE=$BUILD_TYPE \
    ..

echo -e "${CYAN}Building...${NC}"
ninja

echo -e "${GREEN}Build successful!${NC}"
echo -e "${GREEN}Output: $BUILD_DIR/test_debugmate${NC}"
