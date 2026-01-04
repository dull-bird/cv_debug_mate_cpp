cmake_minimum_required(VERSION 3.10)
project(cv_debugmate_test)

set(CMAKE_CXX_STANDARD 11)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

# ============================================================
# OpenCV Configuration
# ============================================================
# Option 1: Auto-detect (works for most setups)
# Option 2: Set OpenCV_DIR manually if not found:
#   cmake -DOpenCV_DIR=/path/to/opencv/lib/cmake/opencv4 ..

# Platform-specific hints
if(WIN32)
    if(CMAKE_CXX_COMPILER_ID STREQUAL "MSVC")
        # MSVC: Set your OpenCV path here if needed
        # set(OpenCV_DIR "C:/opencv/build/x64/vc16/lib")
        message(STATUS "Compiler: MSVC")
    elseif(CMAKE_CXX_COMPILER_ID STREQUAL "GNU")
        # MSYS2 UCRT64 GCC
        message(STATUS "Compiler: GCC (MSYS2)")
    elseif(CMAKE_CXX_COMPILER_ID STREQUAL "Clang")
        # MSYS2 Clang64
        message(STATUS "Compiler: Clang (MSYS2)")
    endif()
else()
    # macOS / Linux: Usually auto-detected via brew or apt
    message(STATUS "Compiler: ${CMAKE_CXX_COMPILER_ID}")
endif()

find_package(OpenCV REQUIRED)
message(STATUS "OpenCV: ${OpenCV_VERSION} at ${OpenCV_DIR}")

# ============================================================
# Build Target
# ============================================================
add_executable(test_debugmate main.cpp)
target_link_libraries(test_debugmate ${OpenCV_LIBS})

# ============================================================
# Debug Symbols (for all build types)
# ============================================================
if(MSVC)
    target_compile_options(test_debugmate PRIVATE /Zi)
    target_link_options(test_debugmate PRIVATE /DEBUG)
else()
    # GCC / Clang
    target_compile_options(test_debugmate PRIVATE -g)
endif()

# ============================================================
# Copy DLLs (Windows MSVC only)
# ============================================================
if(WIN32 AND CMAKE_CXX_COMPILER_ID STREQUAL "MSVC")
    get_filename_component(OpenCV_BIN_DIR "${OpenCV_DIR}/../bin" ABSOLUTE)
    file(GLOB OPENCV_DLLS "${OpenCV_BIN_DIR}/*.dll")
    if(OPENCV_DLLS)
        add_custom_command(TARGET test_debugmate POST_BUILD
            COMMAND ${CMAKE_COMMAND} -E copy_if_different ${OPENCV_DLLS} $<TARGET_FILE_DIR:test_debugmate>
            COMMENT "Copying OpenCV DLLs"
        )
    endif()
endif()
