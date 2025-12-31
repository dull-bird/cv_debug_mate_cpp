#!/bin/bash
# =============================================================
# CV DebugMate Test - Build Script (macOS / Linux)
# =============================================================
# Usage:
#   ./build.sh          # Build with default compiler
#   ./build.sh clang    # Force Clang
#   ./build.sh gcc      # Force GCC
#   ./build.sh clean    # Clean build directory
# =============================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUILD_DIR="$SCRIPT_DIR/build"
BUILD_TYPE="Debug"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Parse argument
COMPILER=""
case "$1" in
    clang)
        COMPILER="-DCMAKE_C_COMPILER=clang -DCMAKE_CXX_COMPILER=clang++"
        echo -e "${CYAN}Using Clang${NC}"
        ;;
    gcc)
        COMPILER="-DCMAKE_C_COMPILER=gcc -DCMAKE_CXX_COMPILER=g++"
        echo -e "${CYAN}Using GCC${NC}"
        ;;
    clean)
        echo -e "${YELLOW}Cleaning build directory...${NC}"
        rm -rf "$BUILD_DIR"
        echo -e "${GREEN}Done!${NC}"
        exit 0
        ;;
    *)
        echo -e "${CYAN}Using default compiler${NC}"
        ;;
esac

# Check dependencies
command -v cmake >/dev/null 2>&1 || { echo -e "${RED}Error: cmake not found${NC}"; exit 1; }

# Create build directory
mkdir -p "$BUILD_DIR"
cd "$BUILD_DIR"

# Configure
echo -e "${CYAN}[1/2] Configuring...${NC}"
cmake $COMPILER -DCMAKE_BUILD_TYPE=$BUILD_TYPE ..

# Build
echo -e "${CYAN}[2/2] Building...${NC}"
cmake --build . --parallel

echo ""
echo -e "${GREEN}✓ Build successful!${NC}"
echo -e "${GREEN}  Output: $BUILD_DIR/test_debugmate${NC}"
echo ""
echo -e "${YELLOW}Next steps:${NC}"
echo "  1. Open test_cpp folder in VS Code"
echo "  2. Set breakpoints in main.cpp"
echo "  3. Start debugging (F5)"
echo "  4. Use CV DebugMate to visualize!"

