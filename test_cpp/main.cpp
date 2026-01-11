/**
 * CV DebugMate C++ - Test & Demo
 *
 * This file contains examples of ALL supported types.
 * Set breakpoints and use CV DebugMate to visualize!
 *
 * Supported Types:
 *   - 2D Image: cv::Mat, cv::Mat_<T>, cv::Matx, std::array<std::array<T,C>,R>,
 *               T[rows][cols] (C-style 2D array)
 *   - 3D Image: T[H][W][C] (C-style 3D array, C=1,3,4),
 *               std::array<std::array<std::array<T,C>,W>,H>
 *   - 3D Point Cloud: std::vector<cv::Point3f/3d>, std::array<cv::Point3f/3d,N>
 *   - 1D Plot: std::vector<T>, std::array<T,N>, T[N] (C-style 1D array),
 *              std::set<T>, cv::Mat(1×N or N×1)
 *   - Pointers: All above types can also be visualized via pointers (e.g.,
 * cv::Mat*)
 *   - Multi-threaded: Variables from any thread can be visualized by selecting
 *                     the thread in the debugger
 */

#include <array>
#include <chrono>
#include <cmath>
#include <iostream>
#include <opencv2/opencv.hpp>
#include <set>
#include <thread>
#include <vector>

#ifndef M_PI
#define M_PI 3.14159265358979323846
#endif

// ============================================================
// SECTION 1: 2D IMAGE EXAMPLES
// ============================================================
void demo_2d_images() {
  std::cout << "\n=== 2D Image Examples ===" << std::endl;

  // --- cv::Mat (standard) ---
  cv::Mat img_bgr(4800, 6400, CV_8UC3);
  for (int y = 0; y < img_bgr.rows; y++) {
    for (int x = 0; x < img_bgr.cols; x++) {
      img_bgr.at<cv::Vec3b>(y, x) = cv::Vec3b(
          static_cast<uchar>(x * 255 / img_bgr.cols),
          static_cast<uchar>(y * 255 / img_bgr.rows),
          static_cast<uchar>((x + y) * 255 / (img_bgr.cols + img_bgr.rows)));
    }
  }
  cv::putText(img_bgr, "cv::Mat BGR", cv::Point(20, 40),
              cv::FONT_HERSHEY_SIMPLEX, 1, cv::Scalar(255, 255, 255), 2);

  // --- cv::Mat grayscale ---
  cv::Mat img_gray;
  cv::cvtColor(img_bgr, img_gray, cv::COLOR_BGR2GRAY);

  // --- cv::Mat float ---
  cv::Mat img_float;
  img_bgr.convertTo(img_float, CV_32FC3, 1.0 / 255.0);

  // --- cv::Mat_<T> template types ---
  cv::Mat_<uchar> mat_template_gray = img_gray.clone();
  cv::Mat_<cv::Vec3b> mat_template_bgr = img_bgr.clone();
  cv::Mat_<cv::Vec3f> mat_template_float;
  img_float.copyTo(mat_template_float);

  // --- cv::Matx (fixed-size matrix) ---
  cv::Matx33f matx_3x3(1.0f, 2.0f, 3.0f, 4.0f, 5.0f, 6.0f, 7.0f, 8.0f, 9.0f);
  cv::Matx44d matx_4x4(1, 0, 0, 0, 0, 2, 0, 0, 0, 0, 3, 0, 0, 0, 0, 4);

  // --- std::array 2D (NEW!) ---
  std::array<std::array<int, 4>, 3> array_2d_int = {
      {{1, 2, 3, 4}, {5, 6, 7, 8}, {9, 10, 11, 12}}};

  std::array<std::array<float, 5>, 4> array_2d_float = {
      {{0.0f, 0.25f, 0.5f, 0.75f, 1.0f},
       {0.1f, 0.35f, 0.6f, 0.85f, 1.1f},
       {0.2f, 0.45f, 0.7f, 0.95f, 1.2f},
       {0.3f, 0.55f, 0.8f, 1.05f, 1.3f}}};

  std::array<std::array<double, 3>, 3> array_2d_double = {
      {{1.1, 2.2, 3.3}, {4.4, 5.5, 6.6}, {7.7, 8.8, 9.9}}};

  std::cout << "  img_bgr: " << img_bgr.cols << "x" << img_bgr.rows
            << " CV_8UC3" << std::endl;
  std::cout << "  img_gray: " << img_gray.cols << "x" << img_gray.rows
            << " CV_8U" << std::endl;
  std::cout << "  img_float: " << img_float.cols << "x" << img_float.rows
            << " CV_32FC3" << std::endl;
  std::cout << "  matx_3x3: 3x3 Matx33f" << std::endl;
  std::cout << "  array_2d_int: 3x4 std::array<std::array<int,4>,3>"
            << std::endl;

  // --- C-style 2D array (NEW!) ---
  int rawArr2D[2][3] = {{1, 2, 3}, {4, 5, 6}};
  float rawArr2D_float[3][4] = {{1.1f, 2.2f, 3.3f, 4.4f},
                                {5.5f, 6.6f, 7.7f, 8.8f},
                                {9.9f, 10.1f, 11.1f, 12.2f}};
  double rawArr2D_double[2][2] = {{1.0, 2.0}, {3.0, 4.0}};

  // --- C-style 1D array (NEW!) ---
  int rawArr1D[6] = {1, 2, 3, 4, 5, 6};
  float rawArr1D_float[10] = {0.1f, 0.2f, 0.3f, 0.4f, 0.5f,
                              0.6f, 0.7f, 0.8f, 0.9f, 1.0f};
  double rawArr1D_double[5] = {1.1, 2.2, 3.3, 4.4, 5.5};

  // --- C-style 3D array (multi-channel image) ---
  const int height = 100;
  const int width = 150;

  // 布局：[行][列][通道]
  uint8_t c_img[height][width][3];

  for (int y = 0; y < height; ++y) {
    for (int x = 0; x < width; ++x) {
      c_img[y][x][0] = static_cast<uint8_t>(y * 255 / height); // R: 纵向渐变
      c_img[y][x][1] = static_cast<uint8_t>(x * 255 / width);  // G: 横向渐变
      c_img[y][x][2] = 128;                                    // B: 固定值
    }
  }

  // --- C-style 3D array (grayscale, single channel) ---
  uint8_t c_img_gray[50][80][1];
  for (int y = 0; y < 50; ++y) {
    for (int x = 0; x < 80; ++x) {
      c_img_gray[y][x][0] = static_cast<uint8_t>((x + y) * 255 / 130);
    }
  }

  // --- C-style 3D array (RGBA, 4 channels) ---
  uint8_t c_img_rgba[60][60][4];
  for (int y = 0; y < 60; ++y) {
    for (int x = 0; x < 60; ++x) {
      c_img_rgba[y][x][0] = static_cast<uint8_t>(x * 255 / 60); // R
      c_img_rgba[y][x][1] = static_cast<uint8_t>(y * 255 / 60); // G
      c_img_rgba[y][x][2] = 100;                                // B
      c_img_rgba[y][x][3] = 255;                                // A
    }
  }

  // --- std::array 3D (multi-channel image, Modern C++) ---
  using Pixel = std::array<uint8_t, 3>;
  std::array<std::array<Pixel, width>, height> std_img;

  for (int y = 0; y < height; ++y) {
    for (int x = 0; x < width; ++x) {
      // 填充一个蓝色调的渐变
      std_img[y][x] = {
          0,                                            // R
          static_cast<uint8_t>(255 - y * 255 / height), // G
          static_cast<uint8_t>(x * 255 / width)         // B
      };
    }
  }

  // --- std::array 3D (grayscale, single channel) ---
  std::array<std::array<std::array<uint8_t, 1>, 40>, 30> std_img_gray;
  for (int y = 0; y < 30; ++y) {
    for (int x = 0; x < 40; ++x) {
      std_img_gray[y][x][0] = static_cast<uint8_t>(y * 255 / 30);
    }
  }

  std::cout << "  rawArr2D: 2x3 int[2][3]" << std::endl;
  std::cout << "  rawArr1D: 6 int[6]" << std::endl;
  std::cout << "  c_img: 100x150x3 uint8_t[100][150][3]" << std::endl;
  std::cout << "  std_img: 100x150x3 std::array<std::array<Pixel,150>,100>"
            << std::endl;

  // ===== BREAKPOINT HERE =====
  int bp1 = 0; // Set breakpoint here to view all 2D images
  (void)bp1;
  (void)img_bgr;
  (void)img_gray;
  (void)img_float;
  (void)mat_template_gray;
  (void)mat_template_bgr;
  (void)mat_template_float;
  (void)matx_3x3;
  (void)matx_4x4;
  (void)array_2d_int;
  (void)array_2d_float;
  (void)array_2d_double;
  (void)rawArr2D;
  (void)rawArr2D_float;
  (void)rawArr2D_double;
  (void)rawArr1D;
  (void)rawArr1D_float;
  (void)rawArr1D_double;
  (void)c_img;
  (void)c_img_gray;
  (void)c_img_rgba;
  (void)std_img;
  (void)std_img_gray;
}

// ============================================================
// SECTION 2: 3D POINT CLOUD EXAMPLES
// ============================================================
void demo_3d_pointcloud() {
  std::cout << "\n=== 3D Point Cloud Examples ===" << std::endl;

  // --- std::vector<cv::Point3f> ---
  std::vector<cv::Point3f> cloud_f;
  std::vector<cv::Point3d> cloud_d;

  // Generate a large sphere with 500,000 points
  const int numPoints = 500000;
  const float radius = 5.0f;
  for (int i = 0; i < numPoints; i++) {
    float theta = static_cast<float>(rand()) / RAND_MAX * 2.0f * M_PI;
    float phi = static_cast<float>(rand()) / RAND_MAX * M_PI;
    float r = radius * (0.9f + 0.1f * static_cast<float>(rand()) / RAND_MAX);
    float x = r * sin(phi) * cos(theta);
    float y = r * sin(phi) * sin(theta);
    float z = r * cos(phi);
    cloud_f.push_back(cv::Point3f(x, y, z));
    cloud_d.push_back(cv::Point3d(x, y, z));
  }

  // Add a large ground plane with 100,000 points
  for (int i = 0; i < 100000; i++) {
    float x = (static_cast<float>(rand()) / RAND_MAX - 0.5f) * 20.0f;
    float y = (static_cast<float>(rand()) / RAND_MAX - 0.5f) * 20.0f;
    float z = -radius - 1.0f;
    cloud_f.push_back(cv::Point3f(x, y, z));
    cloud_d.push_back(cv::Point3d(x, y, z));
  }

  // --- std::array<cv::Point3f, N> (NEW!) ---
  constexpr size_t ARRAY_SIZE = 10000;
  std::array<cv::Point3f, ARRAY_SIZE> array_cloud_f;
  std::array<cv::Point3d, ARRAY_SIZE> array_cloud_d;

  for (size_t i = 0; i < ARRAY_SIZE; i++) {
    float t = static_cast<float>(i) / ARRAY_SIZE * 4.0f * M_PI;
    float x = cos(t) * (1.0f + t * 0.1f);
    float y = sin(t) * (1.0f + t * 0.1f);
    float z = t * 0.5f;
    array_cloud_f[i] = cv::Point3f(x, y, z);
    array_cloud_d[i] = cv::Point3d(x, y, z);
  }

  std::cout << "  cloud_f: " << cloud_f.size() << " Point3f" << std::endl;
  std::cout << "  cloud_d: " << cloud_d.size() << " Point3d" << std::endl;
  std::cout << "  array_cloud_f: " << array_cloud_f.size()
            << " Point3f (std::array)" << std::endl;

  // ===== BREAKPOINT HERE =====
  int bp2 = 0; // Set breakpoint here to view all point clouds
  (void)bp2;
  (void)cloud_f;
  (void)cloud_d;
  (void)array_cloud_f;
  (void)array_cloud_d;
}

// ============================================================
// SECTION 3: 1D PLOT EXAMPLES
// ============================================================
void demo_1d_plots() {
  std::cout << "\n=== 1D Plot Examples ===" << std::endl;

  // Large data size for testing postMessage performance
  const size_t N = 100000;

  // --- std::vector<T> ---
  std::vector<float> vec_sin(N), vec_cos(N);
  std::vector<double> vec_double(N);
  std::vector<int> vec_int(N);
  std::vector<uchar> vec_uchar(N);

  for (size_t i = 0; i < N; i++) {
    float t = static_cast<float>(i) / N * 100.0f * M_PI;
    vec_sin[i] = sin(t) + 0.1f * sin(t * 10);
    vec_cos[i] = cos(t) + 0.1f * cos(t * 10);
    vec_double[i] = sin(t) * cos(t * 0.5) + 0.05 * sin(t * 20);
    vec_int[i] = static_cast<int>(sin(t) * 100 + 50 * sin(t * 5));
    vec_uchar[i] = static_cast<uchar>((sin(t) + 1.0f) * 127.5f);
  }

  // --- std::array<T, N> (NEW!) ---
  std::array<float, 10000> array_float;
  std::array<double, 10000> array_double;
  std::array<int, 10000> array_int;

  for (size_t i = 0; i < 10000; i++) {
    float t = static_cast<float>(i) / 10000.0f * 20.0f * M_PI;
    array_float[i] = sin(t) * exp(-t * 0.01f) + 0.2f * sin(t * 5);
    array_double[i] = cos(t) * (1.0 - t / (20.0 * M_PI)) + 0.1 * cos(t * 7);
    array_int[i] = static_cast<int>(sin(t * 2) * 50 + 50 + 20 * sin(t * 10));
  }

  // --- std::set<T> ---
  std::set<double> set_double;
  for (size_t i = 0; i < 1000; i++) {
    set_double.insert(static_cast<double>(rand()) / RAND_MAX * 100.0);
  }

  // --- cv::Mat 1D ---
  cv::Mat mat_1d_row =
      (cv::Mat_<float>(1, 10) << 1, 4, 9, 16, 25, 36, 49, 64, 81, 100);
  cv::Mat mat_1d_col = (cv::Mat_<double>(5, 1) << 1.1, 2.2, 3.3, 4.4, 5.5);

  std::cout << "  vec_sin: " << vec_sin.size() << " floats" << std::endl;
  std::cout << "  array_float: " << array_float.size() << " floats (std::array)"
            << std::endl;
  std::cout << "  set_double: " << set_double.size() << " doubles" << std::endl;
  std::cout << "  mat_1d_row: 1x10 CV_32F" << std::endl;

  // ===== BREAKPOINT HERE =====
  int bp3 = 0; // Set breakpoint here to view all 1D plots
  (void)bp3;
  (void)vec_sin;
  (void)vec_cos;
  (void)vec_double;
  (void)vec_int;
  (void)vec_uchar;
  (void)array_float;
  (void)array_double;
  (void)array_int;
  (void)set_double;
  (void)mat_1d_row;
  (void)mat_1d_col;
}

// ============================================================
// SECTION 4: AUTO-REFRESH TEST (Loop with data modification)
// ============================================================
void demo_auto_refresh() {
  std::cout << "\n=== Auto-Refresh Test ===" << std::endl;
  std::cout << "This demo modifies data in a loop." << std::endl;
  std::cout << "Step through with debugger to see webview auto-refresh!"
            << std::endl;

  // Image that changes each iteration
  cv::Mat dynamic_img(200, 200, CV_8UC3, cv::Scalar(0, 0, 0));

  // Vector that grows each iteration
  std::vector<float> dynamic_vec;

  // Array that changes each iteration
  std::array<float, 50> dynamic_array;
  dynamic_array.fill(0.0f);

  // Point cloud that rotates
  std::vector<cv::Point3f> dynamic_cloud;
  for (int i = 0; i < 100; i++) {
    float angle = static_cast<float>(i) / 100.0f * 2.0f * M_PI;
    dynamic_cloud.push_back(cv::Point3f(cos(angle) * 10, sin(angle) * 5, 0));
  }

  // ===== SET BREAKPOINT INSIDE LOOP =====
  for (int iteration = 0; iteration < 10; iteration++) {
    // Update image - draw expanding circle
    cv::circle(
        dynamic_img, cv::Point(100, 100), 10 + iteration * 15,
        cv::Scalar(50 * iteration, 255 - 20 * iteration, 100 + 10 * iteration),
        -1);
    cv::putText(dynamic_img, "Frame " + std::to_string(iteration),
                cv::Point(10, 30), cv::FONT_HERSHEY_SIMPLEX, 0.7,
                cv::Scalar(255, 255, 255), 2);

    // Update vector - add more points
    for (int j = 0; j < 10; j++) {
      float val = sin((iteration * 10 + j) * 0.1f) * (iteration + 1);
      dynamic_vec.push_back(val);
    }

    // Update array - wave pattern
    for (size_t i = 0; i < dynamic_array.size(); i++) {
      dynamic_array[i] = sin((i + iteration * 5) * 0.2f) * (iteration + 1);
    }

    // Rotate point cloud
    for (auto &pt : dynamic_cloud) {
      float x = pt.x * cos(0.1f) - pt.y * sin(0.1f);
      float y = pt.x * sin(0.1f) + pt.y * cos(0.1f);
      pt.x = x;
      pt.y = y;
      pt.z = sin(iteration * 0.5f) * 2.0f;
    }

    std::cout << "  Iteration " << iteration
              << ": vec size=" << dynamic_vec.size() << std::endl;

    // ===== BREAKPOINT HERE =====
    // Step through (F10) and watch webview auto-refresh!
    int bp_loop = iteration; // <-- Breakpoint here
    (void)bp_loop;
    (void)dynamic_img;
    (void)dynamic_vec;
    (void)dynamic_array;
    (void)dynamic_cloud;

    // Small delay for visual effect (optional)
    // std::this_thread::sleep_for(std::chrono::milliseconds(100));
  }

  std::cout << "  Loop finished!" << std::endl;
}

// ============================================================
// SECTION 5: POINTER TYPE EXAMPLES (NEW!)
// ============================================================
void demo_pointer_types() {
  std::cout << "\n=== Pointer Type Examples ===" << std::endl;
  std::cout << "Pointers to supported types can also be visualized!"
            << std::endl;

  // --- cv::Mat pointer ---
  cv::Mat mat_original(100, 150, CV_8UC3);
  for (int y = 0; y < mat_original.rows; y++) {
    for (int x = 0; x < mat_original.cols; x++) {
      mat_original.at<cv::Vec3b>(y, x) =
          cv::Vec3b(static_cast<uchar>(x * 255 / mat_original.cols),
                    static_cast<uchar>(y * 255 / mat_original.rows), 128);
    }
  }
  cv::putText(mat_original, "Original", cv::Point(10, 30),
              cv::FONT_HERSHEY_SIMPLEX, 0.7, cv::Scalar(255, 255, 255), 2);

  cv::Mat *pMat = &mat_original; // Pointer to Mat

  // --- std::vector pointer ---
  std::vector<float> vec_original(100);
  for (size_t i = 0; i < vec_original.size(); i++) {
    vec_original[i] = sin(i * 0.1f) * 50.0f;
  }
  std::vector<float> *pVec = &vec_original; // Pointer to vector

  // --- Point cloud pointer ---
  std::vector<cv::Point3f> cloud_original;
  for (int i = 0; i < 200; i++) {
    float t = static_cast<float>(i) / 200.0f * 2.0f * M_PI;
    cloud_original.push_back(cv::Point3f(
        cos(t) * 3.0f, sin(t) * 3.0f, static_cast<float>(i) / 200.0f * 5.0f));
  }
  std::vector<cv::Point3f> *pCloud = &cloud_original; // Pointer to point cloud

  // --- cv::Matx pointer ---
  cv::Matx33f matx_original(1.0f, 2.0f, 3.0f, 4.0f, 5.0f, 6.0f, 7.0f, 8.0f,
                            9.0f);
  cv::Matx33f *pMatx = &matx_original; // Pointer to Matx

  // --- std::array pointer ---
  std::array<double, 50> array_original;
  for (size_t i = 0; i < array_original.size(); i++) {
    array_original[i] = cos(i * 0.15) * 30.0;
  }
  std::array<double, 50> *pArray = &array_original; // Pointer to std::array

  // --- 2D std::array pointer ---
  std::array<std::array<int, 5>, 4> array2d_original = {{{1, 2, 3, 4, 5},
                                                         {6, 7, 8, 9, 10},
                                                         {11, 12, 13, 14, 15},
                                                         {16, 17, 18, 19, 20}}};
  std::array<std::array<int, 5>, 4> *pArray2D =
      &array2d_original; // Pointer to 2D array

  std::cout << "  mat_original: " << mat_original.cols << "x"
            << mat_original.rows << " CV_8UC3" << std::endl;
  std::cout << "  pMat: pointer to mat_original" << std::endl;
  std::cout << "  vec_original: " << vec_original.size() << " floats"
            << std::endl;
  std::cout << "  pVec: pointer to vec_original" << std::endl;
  std::cout << "  cloud_original: " << cloud_original.size() << " Point3f"
            << std::endl;
  std::cout << "  pCloud: pointer to cloud_original" << std::endl;
  std::cout << "  pMatx: pointer to Matx33f" << std::endl;
  std::cout << "  pArray: pointer to std::array<double, 50>" << std::endl;
  std::cout << "  pArray2D: pointer to std::array<std::array<int, 5>, 4>"
            << std::endl;
  std::cout << std::endl;
  std::cout << "  Note: Both the original variable and its pointer"
            << std::endl;
  std::cout << "        will share the same visualization tab!" << std::endl;

  // ===== BREAKPOINT HERE =====
  int bp5 = 0; // Set breakpoint here to view pointer types
  (void)bp5;
  (void)mat_original;
  (void)pMat;
  (void)vec_original;
  (void)pVec;
  (void)cloud_original;
  (void)pCloud;
  (void)matx_original;
  (void)pMatx;
  (void)array_original;
  (void)pArray;
  (void)array2d_original;
  (void)pArray2D;
}

// ============================================================
// SECTION 6: MULTI-THREADED DEBUGGING EXAMPLES (NEW!)
// ============================================================

// Worker thread function - processes image data
void worker_thread_image(int thread_id) {
  std::cout << "  Thread " << thread_id << " (Image): Starting..." << std::endl;

  // Create thread-local image
  cv::Mat thread_img(100, 100, CV_8UC3);
  for (int y = 0; y < thread_img.rows; y++) {
    for (int x = 0; x < thread_img.cols; x++) {
      // Different color based on thread_id
      thread_img.at<cv::Vec3b>(y, x) =
          cv::Vec3b(static_cast<uchar>((thread_id * 50 + x) % 256),
                    static_cast<uchar>((thread_id * 80 + y) % 256),
                    static_cast<uchar>(thread_id * 40 % 256));
    }
  }
  cv::putText(thread_img, "Thread " + std::to_string(thread_id),
              cv::Point(10, 50), cv::FONT_HERSHEY_SIMPLEX, 0.5,
              cv::Scalar(255, 255, 255), 1);

  // ===== BREAKPOINT HERE =====
  // Select this thread in debugger, then view thread_img
  int bp_thread_img = thread_id;
  (void)bp_thread_img;
  (void)thread_img;

  std::cout << "  Thread " << thread_id << " (Image): Done" << std::endl;
}

// Worker thread function - processes vector data
void worker_thread_vector(int thread_id) {
  std::cout << "  Thread " << thread_id << " (Vector): Starting..."
            << std::endl;

  // Create thread-local vector with unique pattern
  std::vector<float> thread_vec(50);
  for (size_t i = 0; i < thread_vec.size(); i++) {
    // Different wave pattern based on thread_id
    thread_vec[i] = sin(i * 0.2f + thread_id) * (thread_id + 1) * 10.0f;
  }

  // ===== BREAKPOINT HERE =====
  // Select this thread in debugger, then view thread_vec
  int bp_thread_vec = thread_id;
  (void)bp_thread_vec;
  (void)thread_vec;

  std::cout << "  Thread " << thread_id << " (Vector): Done" << std::endl;
}

// Worker thread function - processes point cloud data
void worker_thread_pointcloud(int thread_id) {
  std::cout << "  Thread " << thread_id << " (PointCloud): Starting..."
            << std::endl;

  // Create thread-local point cloud with unique shape
  std::vector<cv::Point3f> thread_cloud;
  for (int i = 0; i < 100; i++) {
    float t = static_cast<float>(i) / 100.0f * 2.0f * M_PI;
    // Different spiral based on thread_id
    float radius = 2.0f + thread_id * 0.5f;
    thread_cloud.push_back(cv::Point3f(cos(t * (thread_id + 1)) * radius,
                                       sin(t * (thread_id + 1)) * radius,
                                       t * thread_id * 0.5f));
  }

  // ===== BREAKPOINT HERE =====
  // Select this thread in debugger, then view thread_cloud
  int bp_thread_cloud = thread_id;
  (void)bp_thread_cloud;
  (void)thread_cloud;

  std::cout << "  Thread " << thread_id << " (PointCloud): Done" << std::endl;
}

void demo_multithreaded() {
  std::cout << "\n=== Multi-Threaded Debugging Examples ===" << std::endl;
  std::cout << "This demo creates multiple threads with local variables."
            << std::endl;
  std::cout << "To test:" << std::endl;
  std::cout << "  1. Set breakpoints inside worker_thread_* functions"
            << std::endl;
  std::cout << "  2. When stopped, select different threads in debugger"
            << std::endl;
  std::cout << "  3. CV DebugMate will show variables from selected thread!"
            << std::endl;
  std::cout << std::endl;

  // Create threads
  std::vector<std::thread> threads;

  // Launch image processing threads
  for (int i = 0; i < 2; i++) {
    threads.emplace_back(worker_thread_image, i);
  }

  // Launch vector processing threads
  for (int i = 2; i < 4; i++) {
    threads.emplace_back(worker_thread_vector, i);
  }

  // Launch point cloud processing threads
  for (int i = 4; i < 6; i++) {
    threads.emplace_back(worker_thread_pointcloud, i);
  }

  // Wait for all threads to complete
  for (auto &t : threads) {
    t.join();
  }

  std::cout << "  All threads completed!" << std::endl;
}

// ============================================================
// MAIN
// ============================================================
int main() {
  std::cout << "========================================" << std::endl;
  std::cout << "  CV DebugMate C++ - Test & Demo" << std::endl;
  std::cout << "========================================" << std::endl;
  std::cout << std::endl;
  std::cout << "Set breakpoints at the marked locations," << std::endl;
  std::cout << "then use CV DebugMate to visualize!" << std::endl;

  // Run all demos
  demo_2d_images();
  demo_3d_pointcloud();
  demo_1d_plots();
  demo_auto_refresh();
  demo_pointer_types();
  demo_multithreaded(); // NEW: Multi-threaded debugging examples

  std::cout << "\n=== All demos complete ===" << std::endl;
  return 0;
}
