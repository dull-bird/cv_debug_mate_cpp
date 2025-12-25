#include <cmath>
#include <iostream>
#include <opencv2/opencv.hpp>
#include <vector>

#define M_PI 3.14159265358979323846

int main() {
  // ============================================
  // Test 1: Create a cv::Mat image
  // ============================================

  // Create a 640x480 color image with gradient
  cv::Mat img(4000, 600, CV_8UC3);

  for (int y = 0; y < img.rows; y++) {
    for (int x = 0; x < img.cols; x++) {
      // Create a colorful gradient pattern
      img.at<cv::Vec3b>(y, x) =
          cv::Vec3b(static_cast<uchar>(x * 255 / img.cols), // Blue channel
                    static_cast<uchar>(y * 255 / img.rows), // Green channel
                    static_cast<uchar>((x + y) * 255 /
                                       (img.cols + img.rows)) // Red channel
          );
    }
  }

  // Draw some shapes for visual testing
  cv::circle(img, cv::Point(320, 240), 100, cv::Scalar(0, 0, 255),
             3); // Red circle
  cv::rectangle(img, cv::Point(100, 100), cv::Point(200, 200),
                cv::Scalar(0, 255, 0), 2); // Green rectangle
  cv::putText(img, "CV DebugMate Test", cv::Point(180, 50),
              cv::FONT_HERSHEY_SIMPLEX, 1, cv::Scalar(255, 255, 255), 2);

  // Create a grayscale image
  cv::Mat grayImg;
  cv::cvtColor(img, grayImg, cv::COLOR_BGR2GRAY);

  // Create a floating point image
  cv::Mat floatImg;
  img.convertTo(floatImg, CV_32FC3, 1.0 / 255.0 / 2);
  floatImg -= cv::Scalar(0.5f, 0.5f, 0.5f) / 2;
  floatImg *= 1000.0f; // Scale up for better visualization

  cv::Mat_<uchar> grayImg_template;
  grayImg.copyTo(grayImg_template);

  cv::Mat_<cv::Vec3f> floatImg_template;
  floatImg.copyTo(floatImg_template);

  cv::Mat img_small;
  cv::resize(img, img_small, cv::Size(), 0.1, 0.1);

  // 1-D mat
  cv::Mat mat_1d = (cv::Mat_<float>(1, 10) << 0.0f, 1.0f, 2.0f, 3.0f, 4.0f,
                    5.0f, 6.0f, 7.0f, 8.0f, 9.0f);

  // ============================================
  // Test 2: Create a point cloud
  // ============================================

  std::vector<cv::Point3f> cloud;
  std::vector<cv::Point3d> cloud_d;
  std::vector<float> vec_x, vec_y, vec_z;

  // Generate a sphere point cloud
  const int numPoints = 5000;
  const float radius = 10.0f;

  for (int i = 0; i < numPoints; i++) {
    // Random spherical coordinates
    float theta = static_cast<float>(rand()) / RAND_MAX * 2.0f * M_PI;
    float phi = static_cast<float>(rand()) / RAND_MAX * M_PI;
    float r = radius * (0.8f + 0.2f * static_cast<float>(rand()) / RAND_MAX);

    float x = r * sin(phi) * cos(theta);
    float y = r * sin(phi) * sin(theta);
    float z = r * cos(phi);

    cloud.push_back(cv::Point3f(x, y, z));
    cloud_d.push_back(cv::Point3d(x, y, z));
  }

  // Add a ground plane
  for (int i = 0; i < 2000; i++) {
    float x = (static_cast<float>(rand()) / RAND_MAX - 0.5f) * 30.0f;
    float y = (static_cast<float>(rand()) / RAND_MAX - 0.5f) * 30.0f;
    float z = -radius - 1.0f; // Ground below the sphere
    cloud.push_back(cv::Point3f(x, y, z));
    cloud_d.push_back(cv::Point3d(x, y, z));
  }

  // Add a vertical pillar
  for (int i = 0; i < 1000; i++) {
    float x = 12.0f + (static_cast<float>(rand()) / RAND_MAX - 0.5f) * 1.0f;
    float y = 0.0f + (static_cast<float>(rand()) / RAND_MAX - 0.5f) * 1.0f;
    float z = (static_cast<float>(rand()) / RAND_MAX) * 20.0f - 10.0f;
    cloud.push_back(cv::Point3f(x, y, z));
    cloud_d.push_back(cv::Point3d(x, y, z));
    vec_x.push_back(x);
    vec_y.push_back(y);
    vec_z.push_back(z);
  }

  std::cout << "Test data created:" << std::endl;
  std::cout << "  - img: " << img.cols << "x" << img.rows << " BGR image"
            << std::endl;
  std::cout << "  - grayImg: " << grayImg.cols << "x" << grayImg.rows
            << " grayscale image" << std::endl;
  std::cout << "  - floatImg: " << floatImg.cols << "x" << floatImg.rows
            << " float image" << std::endl;
  std::cout << "  - cloud: " << cloud.size() << " points" << std::endl;
  std::cout << std::endl;
  std::cout
      << "Set a breakpoint on the next line and use CV DebugMate to visualize!"
      << std::endl;

  // ====== SET BREAKPOINT HERE ======
  int breakpoint_here = 0; // <-- Set breakpoint here, then right-click on img,
                           // grayImg, floatImg, or cloud_d in the
                           // Variables pane to visualize.
  (void)breakpoint_here;

  return 0;
}
