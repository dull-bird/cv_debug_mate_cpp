/**
 * CV DebugMate C++ - Test & Demo
 *
 * This file contains examples of ALL supported types.
 * Set breakpoints and use CV DebugMate to visualize!
 *
 * Supported Types:
 *   - 2D Image: cv::Mat, cv::Mat_<T>, cv::Matx, std::array<std::array<T,C>,R>
 *   - 3D Point Cloud: std::vector<cv::Point3f/3d>, std::array<cv::Point3f/3d,
 * N>
 *   - 1D Plot: std::vector<T>, std::array<T,N>, std::set<T>, cv::Mat(1×N)
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
  cv::Mat img_bgr(480, 640, CV_8UC3);
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

  int rawArr2D[2][3] = {{1, 2, 3}, {4, 5, 6}};
  int rawArr1D[6] = {1, 2, 3, 4, 5, 6};

  const int height = 100;
  const int width = 150;

  // --- 1. C 风格 3 维数组 (C-Style Array) ---
  // 布局：[行][列][通道]
  uint8_t c_img[height][width][3];

  for (int y = 0; y < height; ++y) {
    for (int x = 0; x < width; ++x) {
      c_img[y][x][0] = static_cast<uint8_t>(y * 255 / height); // R: 纵向渐变
      c_img[y][x][1] = static_cast<uint8_t>(x * 255 / width);  // G: 横向渐变
      c_img[y][x][2] = 128;                                    // B: 固定值
    }
  }

  // --- 2. std::array 风格 3 维数组 (Modern C++) ---
  // 为了可读性，我们可以先定义像素类型
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
}

// ============================================================
// SECTION 2: 3D POINT CLOUD EXAMPLES
// ============================================================
void demo_3d_pointcloud() {
  std::cout << "\n=== 3D Point Cloud Examples ===" << std::endl;

  // --- std::vector<cv::Point3f> ---
  std::vector<cv::Point3f> cloud_f;
  std::vector<cv::Point3d> cloud_d;

  // Generate a sphere
  const int numPoints = 3000;
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

  // Add a ground plane
  for (int i = 0; i < 1000; i++) {
    float x = (static_cast<float>(rand()) / RAND_MAX - 0.5f) * 20.0f;
    float y = (static_cast<float>(rand()) / RAND_MAX - 0.5f) * 20.0f;
    float z = -radius - 1.0f;
    cloud_f.push_back(cv::Point3f(x, y, z));
    cloud_d.push_back(cv::Point3d(x, y, z));
  }

  // --- std::array<cv::Point3f, N> (NEW!) ---
  constexpr size_t ARRAY_SIZE = 500;
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

  const size_t N = 200;

  // --- std::vector<T> ---
  std::vector<float> vec_sin(N), vec_cos(N);
  std::vector<double> vec_double(N);
  std::vector<int> vec_int(N);
  std::vector<uchar> vec_uchar(N);

  for (size_t i = 0; i < N; i++) {
    float t = static_cast<float>(i) / N * 4.0f * M_PI;
    vec_sin[i] = sin(t);
    vec_cos[i] = cos(t);
    vec_double[i] = sin(t) * cos(t * 0.5);
    vec_int[i] = static_cast<int>(sin(t) * 100);
    vec_uchar[i] = static_cast<uchar>((sin(t) + 1.0f) * 127.5f);
  }

  // --- std::array<T, N> (NEW!) ---
  std::array<float, 100> array_float;
  std::array<double, 100> array_double;
  std::array<int, 100> array_int;

  for (size_t i = 0; i < 100; i++) {
    float t = static_cast<float>(i) / 100.0f * 2.0f * M_PI;
    array_float[i] = sin(t) * exp(-t * 0.1f);
    array_double[i] = cos(t) * (1.0 - t / (2.0 * M_PI));
    array_int[i] = static_cast<int>(sin(t * 2) * 50 + 50);
  }

  // --- std::set<T> ---
  std::set<double> set_double;
  for (size_t i = 0; i < 50; i++) {
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
    dynamic_cloud.push_back(cv::Point3f(cos(angle) * 5, sin(angle) * 5, 0));
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

  std::cout << "\n=== All demos complete ===" << std::endl;
  return 0;
}
