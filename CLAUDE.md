# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build and Development Commands

### Building the Extension
```bash
# Install dependencies
npm install

# Compile (TypeScript type checking + esbuild)
npm run compile

# Watch mode (auto-rebuild on changes)
npm run watch

# Type check only
npm run check-types

# Production build (minified, no sourcemaps)
npm run package
```

### Running Tests
```bash
# Compile tests
npm run compile-tests

# Lint
npm run lint

# Run tests
npm run test
```

### Building the Test C++ Demo
```bash
# macOS / Linux
cd test_cpp && ./build.sh

# Force specific compiler
cd test_cpp && ./build.sh clang  # or ./build.sh gcc

# Clean build
cd test_cpp && ./build.sh clean
```

### Debugging the Extension
Press `F5` in VS Code to launch the extension in debug mode.

## Architecture Overview

### Core Components

**Entry Point**: `src/extension.ts`
- Activates extension on debug session start
- Registers tree data provider for CV DebugMate panel
- Handles variable visualization requests via context menu or tree view
- Manages debug session lifecycle (start, stop, stack frame changes)

**Variable Detection**: `src/cvVariablesProvider.ts`
- Tree data provider that populates CV DebugMate panel in debug view
- Scopes variable types using regex patterns and debugger commands
- Detects uninitialized/invalid variables and shows warnings
- Detects pointer types and dereferences them for type checking

**Three Visualization Providers**:

1. **Image Viewer** (`src/matImage/`)
   - `matProvider.ts`: Reads cv::Mat data via debugger's readMemory API
   - `matWebview.ts`: HTML/Canvas renderer for 2D images with zoom/pan/colormap
   - Supports: cv::Mat, cv::Matx, std::array<std::array<T,C>,R>, T[rows][cols], T[H][W][C]

2. **Plot Viewer** (`src/plot/`)
   - `plotProvider.ts`: Reads 1D numeric data (vector, array, set, 1D Mat)
   - `plotWebview.ts`: Canvas renderer with line/scatter/histogram modes, adaptive tick generation
   - Supports: std::vector<T>, std::array<T,N>, T[N], std::set<T>, cv::Mat(1×N or N×1)

3. **Point Cloud Viewer** (`src/pointCloud/`)
   - `pointCloudProvider.ts`: Reads std::vector<cv::Point3f/d> or std::array<cv::Point3f/d,N>
   - `pointCloudWebview.ts`: Three.js-based 3D renderer with OrbitControls
   - Supports color mapping by X/Y/Z axis, export to PLY format

### Utilities

**Debugger Abstraction** (`src/utils/debugger.ts`)
- Type detection: LLDB (CodeLLDB), GDB (cppdbg), MSVC (cppvsdbg)
- Frame management: Respects user-selected stack frame for multi-threaded debugging
- Memory reading: Chunked parallel reads with timeout protection (8MB chunks)
- Expression building: Debugger-specific cast syntax for accessing STL internals
- Type info extraction: Uses `frame variable` (LLDB) or `ptype` (GDB) commands

**Panel Management** (`src/utils/panelManager.ts`)
- Webview panel lifecycle: Create, reuse, dispose
- Panel sharing: Variables pointing to same memory address share the same panel
- State persistence: Supports "Move to New Window" (serializers currently disabled due to bugs)
- Debug state versioning: Tracks when data should refresh across debug steps
- Dispose watchdog: Pauses debugger and triggers aggressive UI refresh on panel close to prevent freezes

**View Synchronization** (`src/utils/syncManager.ts`)
- Variable grouping: Link multiple variables to sync zoom/pan/rotation
- View state management: Stores scale, offset, camera position across panels
- Group state broadcasting: When one panel's view changes, all paired panels update
- 1D variable tracking: Confirms which cv::Mat instances are 1D (not images)

**OpenCV Utilities** (`src/utils/opencv.ts`)
- Type detection: Regex patterns for cv::Mat, cv::Matx, std::vector, std::array, std::set
- STL member names: Handles libc++ (`__elems_`), libstdc++ (`_M_elems`), MSVC (`_Elems`)
- Depth calculation: Maps CV types (CV_8U, CV_32F, etc.) to bit depth
- Pointer detection: Identifies pointer types and extracts base types

### Debugger-Specific Considerations

**LLDB (CodeLLDB on macOS/Linux with libc++)**
- Uses `variablesReference` instead of `evaluate` for accessing members (more reliable)
- Enhanced array detection uses `frame variable --show-types` command for accurate dimensions
- Context must be "watch" (not "repl") for expression evaluation
- Cannot parse MSVC STL types

**GDB (cppdbg on Linux/Windows MinGW with libstdc++)**
- Supports both `variablesReference` and `evaluate` approaches
- Uses `ptype` command for type information
- Supports `(int)` and C-style casts

**MSVC (cppvsdbg on Windows)**
- Uses `evaluate` with "repl" context
- Supports `reinterpret_cast` syntax
- STL members: `_Elems`, `_Myfirst` (different from libstdc++)
- **Cannot parse Clang+MSVC compiled binaries** (STL structure differs)

### Data Flow

1. User right-clicks variable in debug view or clicks in CV DebugMate panel
2. `extension.ts` calls `visualizeVariable()` with variable info
3. Type detection determines viewer type (mat/plot/pointcloud)
4. Provider (matProvider/plotProvider/pointCloudProvider) queries debugger:
   - Get metadata (size, data pointer) via `evaluate` or `variables`
   - Read memory chunks via `readMemory` API (8MB chunks, parallel)
5. Webview receives data via `postMessage` and renders:
   - Images: Canvas 2D with colormap, auto-normalize, pixel values on hover
   - Plots: Canvas with adaptive ticks, line/scatter/histogram modes
   - Point clouds: Three.js scene with OrbitControls
6. Panel changes sync via `SyncManager` if variables are grouped
7. Debug step triggers `onDidChangeActiveStackItem` → increment debug state version
8. Panel close triggers watchdog: pause debugger, aggressive UI refresh, cleanup

### Panel Key Naming Convention

Panels are keyed by: `${viewType}:::${sessionId}:::${variableName}`

This allows:
- Same variable name in different debug sessions = different panels
- Same data pointer (different variable names) = shared panel
- Pointer and its pointee use same panel

### Known Issues and Workarounds

1. **Webview serializers disabled**: Moving panels to new windows can cause debug freezes
2. **Auto-refresh disabled on new windows**: Manual reload required for data updates
3. **Dispose watchdog**: When closing panels, sends pause command and triggers UI refresh to prevent debugger hanging
4. **CSV export bug**: In `plotWebview.ts`, line ~1435 uses `'\\r\\n'` instead of `'\r\n'` (double-escaped)

### Test Project Structure

`test_cpp/main.cpp` contains complete examples of all supported types:
- Section 1: 2D images (cv::Mat, cv::Matx, std::array, C-style 2D arrays)
- Section 2: 3D point clouds (std::vector<cv::Point3f/d>, std::array<cv::Point3f/d,N>)
- Section 3: 1D plots (std::vector<T>, std::array<T,N>, C-style 1D arrays, std::set<T>)
- Section 4: Auto-refresh demo (loop with data modification)
- Section 5: Pointer types (cv::Mat*, std::vector<T>*, etc.)
- Section 6: Multi-threaded debugging (thread-local variables)
