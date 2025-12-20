// Function to check if the variable is a vector of cv::Point3f or cv::Point3d
// Returns: { isPoint3: boolean, isDouble: boolean }
// isDouble: true for Point3d (double), false for Point3f (float)
export function isPoint3Vector(variableInfo: any): { isPoint3: boolean; isDouble: boolean } {
  console.log("Checking if variable is Point3 vector");
  const type = variableInfo.type || "";
  console.log("Variable type string:", type);
  
  // Check for Point3d (double) first
  const isDouble = 
    type.includes("std::vector<cv::Point3d>") ||
    type.includes("std::vector<cv::Point3_<double>") ||
    type.includes("std::__1::vector<cv::Point3_<double>") ||
    type.includes("class std::vector<class cv::Point3_<double>") ||
    /std::.*vector\s*<\s*cv::Point3d\s*>/.test(type) ||
    /std::.*vector\s*<\s*cv::Point3_<double>/.test(type);
  
  // Check for Point3f (float) or generic Point3
  const isFloat = 
    type.includes("std::vector<cv::Point3f>") ||
    type.includes("std::vector<cv::Point3_<float>") ||
    type.includes("std::__1::vector<cv::Point3_<float>") ||
    type.includes("class std::vector<class cv::Point3_<float>") ||
    /std::.*vector\s*<\s*cv::Point3f\s*>/.test(type) ||
    /std::.*vector\s*<\s*cv::Point3_<float>/.test(type);
  
  // Generic Point3 check (without type parameter)
  const isGeneric = /std::.*vector\s*<\s*cv::Point3[fd]?\s*>/.test(type);
  
  const isPoint3 = isDouble || isFloat || isGeneric;
  
  console.log(`isPoint3Vector result: isPoint3=${isPoint3}, isDouble=${isDouble}`);
  return { isPoint3, isDouble };
}

// Function to check if the variable is a cv::Mat or cv::Mat_<T>
export function isMat(variableInfo: any): boolean {
  console.log("Checking if variable is Mat");
  const type = variableInfo.type || "";
  console.log("Variable type string:", type);
  
  const result = 
    type.includes("cv::Mat") ||
    // LLDB format sometimes includes namespace
    type.includes("class cv::Mat") ||
    // cppdbg format
    type.includes("class cv::Mat") ||
    // Template Mat types: cv::Mat_<T> (e.g., cv::Mat_<uchar>, cv::Mat_<cv::Vec3d>)
    /cv::Mat_</.test(type) ||
    // Generic format (matches cv::Mat but not cv::Mat_)
    /cv::Mat\b/.test(type);
  
  console.log("isMat result:", result);
  return result;
}

// Get bytes per element based on depth
export function getBytesPerElement(depth: number): number {
  switch (depth) {
    case 0: // CV_8U
    case 1: // CV_8S
      return 1;
    case 2: // CV_16U
    case 3: // CV_16S
      return 2;
    case 4: // CV_32S
    case 5: // CV_32F
      return 4;
    case 6: // CV_64F
      return 8;
    default:
      return 1;
  }
}

// Convert raw byte array to typed values
export function convertBytesToValues(bytes: number[], depth: number, count: number): number[] {
  const values: number[] = [];
  const bytesPerElement = getBytesPerElement(depth);
  
  for (let i = 0; i < count && i * bytesPerElement < bytes.length; i++) {
    const offset = i * bytesPerElement;
    let value: number;
    
    switch (depth) {
      case 0: // CV_8U
        value = bytes[offset];
        break;
      case 1: // CV_8S
        value = bytes[offset] > 127 ? bytes[offset] - 256 : bytes[offset];
        break;
      case 2: // CV_16U
        value = bytes[offset] | (bytes[offset + 1] << 8);
        break;
      case 3: // CV_16S
        value = bytes[offset] | (bytes[offset + 1] << 8);
        if (value > 32767) {
          value -= 65536;
        }
        break;
      case 4: // CV_32S
        value = bytes[offset] | (bytes[offset + 1] << 8) | 
                (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24);
        break;
      case 5: // CV_32F
        // Keep raw float value; scaling/normalization is handled in the webview UI.
        const floatArr = new Float32Array(new Uint8Array(bytes.slice(offset, offset + 4)).buffer);
        value = floatArr[0];
        break;
      case 6: // CV_64F
        // Keep raw double value; scaling/normalization is handled in the webview UI.
        const doubleArr = new Float64Array(new Uint8Array(bytes.slice(offset, offset + 8)).buffer);
        value = doubleArr[0];
        break;
      default:
        value = bytes[offset];
    }
    values.push(value);
  }
  
  return values;
}

// Parse numeric result from evaluate response
export function parseNumericResult(result: string, depth: number): number {
  let value: number;
  if (depth === 5 || depth === 6) {
    value = parseFloat(result);
    if (isNaN(value)) {
      value = 0;
    }
  } else {
    value = parseInt(result);
    if (isNaN(value)) {
      value = 0;
    }
  }
  return value;
}

