cmake_minimum_required(VERSION 3.10)
project(cv_debugmate_test)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Find OpenCV - use different paths based on compiler
if(CMAKE_CXX_COMPILER_ID STREQUAL "GNU")
    # For GCC (MSYS2), let CMake find OpenCV automatically
    # OpenCV is installed at C:/msys64/ucrt64
    message(STATUS "Using GCC - searching for MSYS2 OpenCV")
elseif(CMAKE_CXX_COMPILER_ID STREQUAL "Clang")
    # For Clang (MSYS2 Clang64), use MinGW/Clang compatible OpenCV
    # MSVC compiled OpenCV (.lib) is NOT compatible with Clang's lld linker
    message(STATUS "Using Clang - searching for compatible OpenCV")
    
    # Option 1: Use MSYS2 installed OpenCV (recommended)
    # Install via: pacman -S mingw-w64-clang-x86_64-opencv
    # Then CMake should find it automatically
    
    # Option 2: If you have MinGW/GCC compiled OpenCV, you can try using it
    # (MinGW libraries are usually compatible with Clang)
    # Uncomment and set the path:
    # set(OpenCV_DIR "C:/msys64/ucrt64/lib/cmake/opencv4")
    
    # Option 3: If you have a Clang-compiled OpenCV, set the path here
    # set(OpenCV_DIR "path/to/clang/opencv/lib/cmake/opencv4")
else()
    # For MSVC only, use prebuilt OpenCV
    set(OpenCV_DIR "D:/work/repos/3rdParty/OpenCV/opencv4/build/x64/vc15/lib")
    message(STATUS "Using MSVC - using prebuilt OpenCV")
endif()

find_package(OpenCV REQUIRED)
message(STATUS "OpenCV found: ${OpenCV_VERSION} at ${OpenCV_DIR}")

add_executable(test_debugmate main.cpp)
target_link_libraries(test_debugmate ${OpenCV_LIBS})

# Auto copy OpenCV DLLs to output directory (only for MSVC builds)
if(WIN32 AND CMAKE_CXX_COMPILER_ID STREQUAL "MSVC")
    # Get OpenCV bin directory (where DLLs are located)
    get_filename_component(OpenCV_BIN_DIR "${OpenCV_DIR}/../bin" ABSOLUTE)
    
    # Copy OpenCV DLLs after build
    add_custom_command(TARGET test_debugmate POST_BUILD
        COMMAND ${CMAKE_COMMAND} -E copy_if_different
            "${OpenCV_BIN_DIR}/opencv_world451$<$<CONFIG:Debug>:d>.dll"
            $<TARGET_FILE_DIR:test_debugmate>
        COMMENT "Copying OpenCV DLLs to output directory"
    )
endif()
