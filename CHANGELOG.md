# Change Log

All notable changes to the "CV DebugMate C++" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

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
