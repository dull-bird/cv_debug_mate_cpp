cmake_minimum_required(VERSION 3.10)
project(cv_debugmate_test)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Find OpenCV - use different paths based on compiler
if(CMAKE_CXX_COMPILER_ID STREQUAL "GNU")
    # For GCC (MSYS2), let CMake find OpenCV automatically
    # OpenCV is installed at C:/msys64/ucrt64
    message(STATUS "Using GCC - searching for MSYS2 OpenCV")
else()
    # For MSVC/Clang, use prebuilt OpenCV
    set(OpenCV_DIR "D:/work/repos/3rdParty/OpenCV/opencv4/build/x64/vc15/lib")
    message(STATUS "Using MSVC/Clang - using prebuilt OpenCV")
endif()

find_package(OpenCV REQUIRED)
message(STATUS "OpenCV found: ${OpenCV_VERSION} at ${OpenCV_DIR}")

add_executable(test_debugmate main.cpp)
target_link_libraries(test_debugmate ${OpenCV_LIBS})

# Auto copy OpenCV DLLs to output directory (only for MSVC/Clang builds)
if(WIN32 AND NOT CMAKE_CXX_COMPILER_ID STREQUAL "GNU")
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
