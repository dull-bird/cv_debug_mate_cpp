// Function to check if the variable is a vector of cv::Point3f or cv::Point3d
// Returns: { isPoint3: boolean, isDouble: boolean, size: number }
// isDouble: true for Point3d (double), false for Point3f (float)
export function isPoint3Vector(variableInfo: any): { isPoint3: boolean; isDouble: boolean; size: number } {
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
  
  let size = 0;
  if (isPoint3) {
    const val = variableInfo.value || "";
    const sizeMatch = val.match(/size=(\d+)/) || val.match(/length=(\d+)/) || val.match(/\[(\d+)\]/);
    if (sizeMatch) size = parseInt(sizeMatch[1]);
  }

  console.log(`isPoint3Vector result: isPoint3=${isPoint3}, isDouble=${isDouble}, size=${size}`);
  return { isPoint3, isDouble, size };
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

// Function to check if a cv::Mat is likely 1D (n*1 or 1*n) based on its summary/value string
export function isLikely1DMat(variableInfo: any): { is1D: boolean; size: number } {
  if (!isMat(variableInfo)) return { is1D: false, size: 0 };
  const result = (variableInfo.result || variableInfo.value || "").toLowerCase();
  const type = (variableInfo.type || "").toLowerCase();
  
  // 1. Try to parse dimensions from summary string (e.g. "[1 x 100]", "100x1")
  const dimMatch = result.match(/\[\s*(\d+)\s*x\s*(\d+)\s*\]/) || result.match(/(\d+)\s*x\s*(\d+)/);
  if (dimMatch) {
    const rows = parseInt(dimMatch[1]);
    const cols = parseInt(dimMatch[2]);
    if (rows === 1 || cols === 1) {
      return { is1D: true, size: rows * cols };
    }
  }

  // 2. Check for common 1D Mat typedefs/templates if dimensions aren't in summary
  // e.g., Mat1b, Mat1f, Mat1d (usually 1D vectors or single channel images)
  // but many people use Mat1f for 1D data.
  if (type.includes("mat1b") || type.includes("mat1s") || type.includes("mat1w") || 
      type.includes("mat1i") || type.includes("mat1f") || type.includes("mat1d")) {
    // If it's one of these and we see a single number in result like "100", 
    // it might be a 1D mat.
    const sizeMatch = result.match(/^(\d+)$/) || result.match(/size=(\d+)/);
    if (sizeMatch) {
      return { is1D: true, size: parseInt(sizeMatch[1]) };
    }
  }

  return { is1D: false, size: 0 };
}

// Function to check if the variable is a standard 1D vector (int, float, double, uchar, etc.)
export function is1DVector(variableInfo: any): { is1D: boolean; elementType: string; size: number } {
  const type = variableInfo.type || "";
  
  // Match std::vector<T> where T is a basic numeric type
  const vectorMatch = type.match(/std::(?:__1::)?vector<\s*([^,>]+?)\s*(?:,.*)?>/);
  
  if (vectorMatch) {
    const elementType = vectorMatch[1].trim();
    const basicTypes = [
      'int', 'float', 'double', 'char', 'unsigned char', 'uchar', 
      'short', 'unsigned short', 'ushort', 'long', 'unsigned long',
      'long long', 'unsigned long long', 'int32_t', 'uint32_t', 
      'int16_t', 'uint16_t', 'int8_t', 'uint8_t', 'size_t'
    ];
    
    // Check if it's a basic numeric type
    const isBasic = basicTypes.some(t => 
      elementType === t || 
      elementType === `class ${t}` || 
      elementType === `struct ${t}` ||
      (elementType.startsWith('unsigned ') && basicTypes.includes(elementType.replace('unsigned ', '')))
    );
    
    if (isBasic) {
      // Try to parse size from value string (check both value and result fields)
      let size = 0;
      const val = variableInfo.value || variableInfo.result || "";
      const sizeMatch = val.match(/size=(\d+)/) || val.match(/length=(\d+)/) || val.match(/\[(\d+)\]/);
      if (sizeMatch) size = parseInt(sizeMatch[1]);
      
      return { is1D: true, elementType, size };
    }
  }
  
  return { is1D: false, elementType: "", size: 0 };
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

