cmake_minimum_required(VERSION 3.10)
project(cv_debugmate_test)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Find OpenCV
set(OpenCV_DIR "D:/work/repos/3rdParty/OpenCV/opencv4/build/x64/vc15/lib")
find_package(OpenCV REQUIRED)

add_executable(test_debugmate main.cpp)
target_link_libraries(test_debugmate ${OpenCV_LIBS})

# Auto copy OpenCV DLLs to output directory
if(WIN32)
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
