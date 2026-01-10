# Change Log

All notable changes to the "CV DebugMate C++" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [0.0.35] - 2025-01-10

### Added

- **Pointer type support**: Visualize pointers to supported types (`cv::Mat*`, `std::vector<T>*`, `std::array<T,N>*`, etc.). Pointers are automatically dereferenced, and variables pointing to the same memory address share the same visualization tab.
- **Uninitialized variable detection**: Detect and warn about uninitialized variables, including:
  - `cv::Mat` with suspicious member values (garbage dimensions, invalid flags)
  - `std::vector` with garbage size values (MSVC debug patterns like 0xCCCCCCCC)
  - Variables marked as `<uninitialized>`, `<optimized out>`, or `<not available>`
- **Adaptive plot tick generation**: Dynamic axis tick formatting with smart label placement, preventing overlap and improving readability for various data ranges.
- **Real-time view range display**: Plot viewer now shows current zoom level and visible data range in an overlay.
- **Zoom limits**: Plot viewer prevents excessive zooming to maintain usability.

### Fixed

- **Memory address reuse safety**: Clear pointer-to-panel mappings on each debug step to prevent stale memory addresses from incorrectly matching new variables after the original was freed.

### Changed

- Improved Y-axis label measurement for better tick formatting in plots.
- Updated documentation (EN/CN) with pointer type support information.

## [0.0.34] - 2025-01-05

### Added

- **Multi-platform CI/CD**: Added GitHub Actions workflow for building demos on Windows, macOS, and Linux.
- **RGBA 4-channel support**: Added support for visualizing 4-channel RGBA images.

## [0.0.33] - 2025-01-03

### Added

- **3D array multi-channel image support**: Visualize `T[H][W][C]` and `std::array<std::array<std::array<T,C>,W>,H>` as multi-channel images (C=1,3,4).
- **2D C-style array support**: Visualize `T[rows][cols]` C-style 2D arrays as images.

### Fixed

- **Memory reference validation**: Added validation to all pointer extraction paths to prevent invalid pointer usage.

### Changed

- Enhanced debugger support documentation in DEVELOPMENT.md.

## [0.0.27] - 2025-12-31

### Fixed

- **Linux/GDB point cloud empty bug**: Add fallback to get real size of the vector of Point3f/3d.

## [0.0.25] - 2025-12-30

### Added

- **Jet Colormap**: New render mode for `cv::Mat`, colorized by grayscale (or mean RGB)
- **Matx support**: Detect and visualize `cv::Matx` fixed-size matrices (e.g., `Matx33f`, `Matx44d`)
- **Small-image auto-scale**: Mats auto-zoom to a minimum 400px display size for tiny images (e.g., 3x3)

### Fixed

- **GDB STL parsing**: More robust size detection for vectors/sets/Point3 under gdb pretty-printers
- **Empty variables guard**: Prevent opening empty/zero-sized variables from the panel or context menu

### Changed

- Documentation updated (EN/CN) for Jet Colormap, Matx support, and small-image auto-scale

## [0.0.24] - 2024-12-29

### Added

- **std::set support**: Added visualization support for `std::set<int>`, `std::set<float>`, `std::set<double>`
- **Multiple plot types**: Switch between Line Plot, Scatter Plot, and Histogram in the 1D data viewer
- **Plot settings panel**: Real-time customization with the following options:
  - Line width (for line plots)
  - Point size (for scatter plots)
  - Bin count (for histograms)
  - Custom X/Y axis limits
  - Chart title (centered above the plot)
  - Canvas size (width × height)
  - Axis font size
  - Reset all settings button
- **Dynamic padding**: Axis labels and tick marks automatically adjust based on font size

### Fixed

- Fixed LLDB vector size detection when selecting X-axis variable in plot viewer
- Improved axis label positioning to prevent overlap with tick marks

### Changed

- Disabled mouse wheel zoom in plot viewer to prevent accidental zooming (use Zoom button instead)

## [0.0.22] - 2024-12-27

### Changed

- Migrated build system from tsc to esbuild for faster builds and smaller bundle size
- Reduced extension package size from 8MB to ~145KB by excluding unnecessary assets
- Updated documentation with clearer feature descriptions

### Fixed

- Improved README structure and screenshots placement

## [Unreleased]

- Initial release
