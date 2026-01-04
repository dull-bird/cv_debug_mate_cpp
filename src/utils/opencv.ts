// Basic numeric types that can be plotted
const BASIC_NUMERIC_TYPES = [
  'int', 'float', 'double', 'char', 'unsigned char', 'uchar', 
  'short', 'unsigned short', 'ushort', 'long', 'unsigned long',
  'long long', 'unsigned long long', 'int32_t', 'uint32_t', 
  'int16_t', 'uint16_t', 'int8_t', 'uint8_t', 'size_t'
];

function isBasicNumericType(elementType: string): boolean {
  return BASIC_NUMERIC_TYPES.some(t => 
    elementType === t || 
    elementType === `class ${t}` || 
    elementType === `struct ${t}` ||
    (elementType.startsWith('unsigned ') && BASIC_NUMERIC_TYPES.includes(elementType.replace('unsigned ', '')))
  );
}

function parseSizeFromValue(variableInfo: any): number {
  const val = variableInfo.value || variableInfo.result || "";
  
  // Common patterns:
  // MSVC/cppvsdbg: "{ size=5 }" or "[5]"
  // LLDB: "size=5" or "([5])"
  // GDB pretty-print: "std::vector of length 5, capacity 8 = {...}"
  // GDB pretty-print: "vector of length 5"
  // GDB alternative: "{...}" with no size info
  
  const sizeMatch = 
    val.match(/size=(\d+)/) || 
    val.match(/length=(\d+)/) ||
    val.match(/of length (\d+)/) ||  // GDB pretty-print format
    val.match(/\[(\d+)\]/) ||
    val.match(/^(\d+)$/);  // Just a number
  
  if (sizeMatch) {
    return parseInt(sizeMatch[1]);
  }
  
  // GDB fallback: count elements in {...} if present
  // e.g., "{1, 2, 3, 4, 5}" -> 5 elements
  const braceMatch = val.match(/\{([^}]+)\}/);
  if (braceMatch) {
    const content = braceMatch[1].trim();
    if (content === "..." || content === "") {
      return 0; // Unknown or empty
    }
    // Count commas + 1 to estimate size
    const elements = content.split(',').map((s: string) => s.trim()).filter((s: string) => s.length > 0 && s !== '...');
    if (elements.length > 0) {
      return elements.length;
    }
  }
  
  return 0;
}

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
    size = parseSizeFromValue(variableInfo);
  }

  console.log(`isPoint3Vector result: isPoint3=${isPoint3}, isDouble=${isDouble}, size=${size}`);
  return { isPoint3, isDouble, size };
}

// Function to check if the variable is a cv::Mat or cv::Mat_<T>
export function isMat(variableInfo: any): boolean {
  console.log("Checking if variable is Mat");
  const type = variableInfo.type || "";
  console.log("Variable type string:", type);
  
  // Exclude cv::Matx types (they are handled separately)
  if (/cv::Matx\d*[fdis]?\b/.test(type) || /cv::Matx</.test(type)) {
    console.log("isMat result: false (is Matx type)");
    return false;
  }
  
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

// Function to check if the variable is a cv::Matx (fixed-size matrix)
// Returns: { isMatx: boolean, rows: number, cols: number, depth: number }
// Matx types: Matx<T, m, n>, Matx21f, Matx33f, Matx44d, etc.
export function isMatx(variableInfo: any): { isMatx: boolean; rows: number; cols: number; depth: number } {
  const type = variableInfo.type || "";
  console.log("Checking if variable is Matx, type:", type);
  
  let rows = 0, cols = 0, depth = 5; // default to float (CV_32F)
  
  // Pattern 1: cv::Matx<T, m, n> (template form)
  const templateMatch = type.match(/cv::Matx<\s*(\w+)\s*,\s*(\d+)\s*,\s*(\d+)\s*>/);
  if (templateMatch) {
    const elementType = templateMatch[1];
    rows = parseInt(templateMatch[2]);
    cols = parseInt(templateMatch[3]);
    depth = getDepthFromElementType(elementType);
    console.log(`isMatx (template): rows=${rows}, cols=${cols}, depth=${depth}`);
    return { isMatx: true, rows, cols, depth };
  }
  
  // Pattern 2: cv::Matx{rows}{cols}{type} (typedef form like Matx33f, Matx44d, Matx21f)
  // Format: Matx{m}{n}{suffix} where suffix is f (float), d (double), i (int), s (short)
  const typedefMatch = type.match(/cv::Matx(\d)(\d)([fdis])\b/);
  if (typedefMatch) {
    rows = parseInt(typedefMatch[1]);
    cols = parseInt(typedefMatch[2]);
    const suffix = typedefMatch[3];
    switch (suffix) {
      case 'f': depth = 5; break; // CV_32F
      case 'd': depth = 6; break; // CV_64F
      case 'i': depth = 4; break; // CV_32S
      case 's': depth = 3; break; // CV_16S
    }
    console.log(`isMatx (typedef): rows=${rows}, cols=${cols}, depth=${depth}`);
    return { isMatx: true, rows, cols, depth };
  }
  
  // Pattern 3: Generic cv::Matx without dimensions (rare, but check)
  if (/cv::Matx\b/.test(type) && !templateMatch && !typedefMatch) {
    // Try to extract from value string
    const val = variableInfo.value || variableInfo.result || "";
    // Look for patterns like "val = {...}" with element count
    const braceMatch = val.match(/\{([^}]+)\}/);
    if (braceMatch) {
      const elements = braceMatch[1].split(',').filter((s: string) => s.trim().length > 0);
      // Common Matx sizes: 2x1, 3x1, 4x1, 2x2, 3x3, 4x4, etc.
      const count = elements.length;
      // Guess dimensions based on common sizes
      if (count === 4) { rows = 2; cols = 2; }
      else if (count === 9) { rows = 3; cols = 3; }
      else if (count === 16) { rows = 4; cols = 4; }
      else if (count === 2) { rows = 2; cols = 1; }
      else if (count === 3) { rows = 3; cols = 1; }
      else if (count === 6) { rows = 2; cols = 3; }
      else { rows = count; cols = 1; } // Treat as column vector
      
      if (count > 0) {
        console.log(`isMatx (guessed from value): rows=${rows}, cols=${cols}`);
        return { isMatx: true, rows, cols, depth };
      }
    }
  }
  
  console.log("isMatx result: false");
  return { isMatx: false, rows: 0, cols: 0, depth: 0 };
}

// Helper to get CV depth from C++ type name
function getDepthFromElementType(elementType: string): number {
  const t = elementType.toLowerCase();
  if (t.includes('double')) return 6; // CV_64F
  if (t.includes('float')) return 5;  // CV_32F
  if (t.includes('int') || t === 'int32_t') return 4; // CV_32S
  if (t.includes('short') || t === 'int16_t') return 3; // CV_16S
  if (t.includes('ushort') || t === 'uint16_t') return 2; // CV_16U
  if (t.includes('char') || t === 'int8_t') return 1; // CV_8S
  if (t.includes('uchar') || t === 'uint8_t') return 0; // CV_8U
  return 5; // default to float
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
    
    if (isBasicNumericType(elementType)) {
      const size = parseSizeFromValue(variableInfo);
      return { is1D: true, elementType, size };
    }
  }
  
  return { is1D: false, elementType: "", size: 0 };
}

// Function to check if the variable is a std::set of numeric types
export function is1DSet(variableInfo: any): { isSet: boolean; elementType: string; size: number } {
  const type = variableInfo.type || "";
  
  // Match std::set<T> where T is a basic numeric type
  const setMatch = type.match(/std::(?:__1::)?set<\s*([^,>]+?)\s*(?:,.*)?>/);
  
  if (setMatch) {
    const elementType = setMatch[1].trim();
    
    if (isBasicNumericType(elementType)) {
      const size = parseSizeFromValue(variableInfo);
      return { isSet: true, elementType, size };
    }
  }
  
  return { isSet: false, elementType: "", size: 0 };
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

// ============== std::array Support ==============

/**
 * Check if the variable is a 2D std::array (std::array<std::array<T, cols>, rows>)
 * Returns: { is2DArray: boolean, rows: number, cols: number, elementType: string, depth: number }
 */
export function is2DStdArray(variableInfo: any): { 
  is2DArray: boolean; 
  rows: number; 
  cols: number; 
  elementType: string; 
  depth: number 
} {
  const type = variableInfo.type || "";
  console.log("Checking if variable is 2D std::array, type:", type);
  
  // First check it's NOT a 3D array (3-level nested std::array)
  const pattern3D = /std::(?:__1::)?array\s*<\s*(?:class\s+)?std::(?:__1::)?array\s*<\s*(?:class\s+)?std::(?:__1::)?array\s*</;
  if (pattern3D.test(type)) {
    console.log("is2DStdArray result: false (is 3D array)");
    return { is2DArray: false, rows: 0, cols: 0, elementType: "", depth: 0 };
  }
  
  // Match patterns like:
  // std::array<std::array<int, 4>, 3>
  // std::__1::array<std::__1::array<float, 4>, 3>
  // class std::array<class std::array<double, 4>, 3>
  // std::array<std::array<unsigned char, 4>, 3>
  const pattern2D = /std::(?:__1::)?array\s*<\s*(?:class\s+)?std::(?:__1::)?array\s*<\s*([^,>]+?)\s*,\s*(\d+)\s*>\s*,\s*(\d+)\s*>/;
  const match = type.match(pattern2D);
  
  if (match) {
    const elementType = match[1].trim();
    const cols = parseInt(match[2]);
    const rows = parseInt(match[3]);
    
    // Get depth from element type
    const depth = getDepthFromCppType(elementType);
    
    console.log(`is2DStdArray result: rows=${rows}, cols=${cols}, elementType=${elementType}, depth=${depth}`);
    return { is2DArray: true, rows, cols, elementType, depth };
  }
  
  console.log("is2DStdArray result: false");
  return { is2DArray: false, rows: 0, cols: 0, elementType: "", depth: 0 };
}

/**
 * Check if the variable is a 3D std::array (std::array<std::array<std::array<T, C>, W>, H>)
 * Used for multi-channel image representation where the innermost dimension is channels (1, 3, or 4)
 * Returns: { is3DArray: boolean, height: number, width: number, channels: number, elementType: string, depth: number }
 */
export function is3DStdArray(variableInfo: any): { 
  is3DArray: boolean; 
  height: number; 
  width: number; 
  channels: number; 
  elementType: string; 
  depth: number 
} {
  const type = variableInfo.type || "";
  console.log("Checking if variable is 3D std::array, type:", type);
  
  // Match 3-level nested std::array patterns like:
  // std::array<std::array<std::array<uint8_t, 3>, 640>, 480>
  // std::__1::array<std::__1::array<std::__1::array<float, 3>, 100>, 100>
  // class std::array<class std::array<class std::array<unsigned char, 3>, 640>, 480>
  const pattern3D = /std::(?:__1::)?array\s*<\s*(?:class\s+)?std::(?:__1::)?array\s*<\s*(?:class\s+)?std::(?:__1::)?array\s*<\s*([^,>]+?)\s*,\s*(\d+)\s*>\s*,\s*(\d+)\s*>\s*,\s*(\d+)\s*>/;
  const match = type.match(pattern3D);
  
  if (match) {
    const elementType = match[1].trim();
    const channels = parseInt(match[2]);
    const width = parseInt(match[3]);
    const height = parseInt(match[4]);
    
    // Only consider it an image-suitable 3D array if channels is 1, 3, or 4
    if (channels !== 1 && channels !== 3 && channels !== 4) {
      console.log(`is3DStdArray result: false (channels=${channels} is not 1, 3, or 4)`);
      return { is3DArray: false, height: 0, width: 0, channels: 0, elementType: "", depth: 0 };
    }
    
    // Get depth from element type
    const depth = getDepthFromCppType(elementType);
    
    console.log(`is3DStdArray result: height=${height}, width=${width}, channels=${channels}, elementType=${elementType}, depth=${depth}`);
    return { is3DArray: true, height, width, channels, elementType, depth };
  }
  
  console.log("is3DStdArray result: false");
  return { is3DArray: false, height: 0, width: 0, channels: 0, elementType: "", depth: 0 };
}

/**
 * Check if the variable is a 1D std::array of basic numeric types
 * Returns: { is1DArray: boolean, elementType: string, size: number }
 */
export function is1DStdArray(variableInfo: any): { 
  is1DArray: boolean; 
  elementType: string; 
  size: number 
} {
  const type = variableInfo.type || "";
  console.log("Checking if variable is 1D std::array, type:", type);
  
  // First check it's NOT a 2D array (array of arrays)
  if (/std::(?:__1::)?array\s*<\s*(?:class\s+)?std::(?:__1::)?array/.test(type)) {
    console.log("is1DStdArray result: false (is 2D array)");
    return { is1DArray: false, elementType: "", size: 0 };
  }
  
  // Check it's NOT a Point3 array (handled separately)
  if (/std::(?:__1::)?array\s*<\s*(?:class\s+)?cv::Point3/.test(type)) {
    console.log("is1DStdArray result: false (is Point3 array)");
    return { is1DArray: false, elementType: "", size: 0 };
  }
  
  // Match patterns like:
  // std::array<int, 10>
  // std::__1::array<float, 100>
  // class std::array<double, 50>
  // std::array<unsigned char, 256>
  const pattern1D = /std::(?:__1::)?array\s*<\s*([^,>]+?)\s*,\s*(\d+)\s*>/;
  const match = type.match(pattern1D);
  
  if (match) {
    const elementType = match[1].trim();
    const size = parseInt(match[2]);
    
    // Check if element type is a basic numeric type
    if (isBasicNumericType(elementType)) {
      console.log(`is1DStdArray result: is1DArray=true, elementType=${elementType}, size=${size}`);
      return { is1DArray: true, elementType, size };
    }
  }
  
  console.log("is1DStdArray result: false");
  return { is1DArray: false, elementType: "", size: 0 };
}

/**
 * Check if the variable is a 1D std::array of cv::Point3f or cv::Point3d
 * Returns: { isPoint3Array: boolean, isDouble: boolean, size: number }
 */
export function isPoint3StdArray(variableInfo: any): { 
  isPoint3Array: boolean; 
  isDouble: boolean; 
  size: number 
} {
  const type = variableInfo.type || "";
  console.log("Checking if variable is Point3 std::array, type:", type);
  
  // Check for Point3d (double) first
  // Patterns:
  // std::array<cv::Point3d, 100>
  // std::array<cv::Point3_<double>, 100>
  // std::__1::array<cv::Point3d, 100>
  const isDouble = 
    /std::(?:__1::)?array\s*<\s*(?:class\s+)?cv::Point3d\s*,\s*(\d+)\s*>/.test(type) ||
    /std::(?:__1::)?array\s*<\s*(?:class\s+)?cv::Point3_<double>\s*,\s*(\d+)\s*>/.test(type);
  
  // Check for Point3f (float)
  const isFloat = 
    /std::(?:__1::)?array\s*<\s*(?:class\s+)?cv::Point3f\s*,\s*(\d+)\s*>/.test(type) ||
    /std::(?:__1::)?array\s*<\s*(?:class\s+)?cv::Point3_<float>\s*,\s*(\d+)\s*>/.test(type);
  
  const isPoint3Array = isDouble || isFloat;
  
  let size = 0;
  if (isPoint3Array) {
    // Extract size from type
    const sizeMatch = type.match(/std::(?:__1::)?array\s*<\s*(?:class\s+)?cv::Point3[fd_<>a-z]*\s*,\s*(\d+)\s*>/i);
    if (sizeMatch) {
      size = parseInt(sizeMatch[1]);
    }
  }
  
  console.log(`isPoint3StdArray result: isPoint3Array=${isPoint3Array}, isDouble=${isDouble}, size=${size}`);
  return { isPoint3Array, isDouble, size };
}

/**
 * Helper to get OpenCV depth from C++ type name
 */
export function getDepthFromCppType(cppType: string): number {
  const t = cppType.toLowerCase().trim();
  
  if (t === 'double' || t.includes('double')) return 6; // CV_64F
  if (t === 'float' || t.includes('float')) return 5;  // CV_32F
  if (t === 'int' || t === 'int32_t' || t.includes('int32_t')) return 4; // CV_32S
  if (t === 'short' || t === 'int16_t' || t.includes('int16_t')) return 3; // CV_16S
  if (t === 'unsigned short' || t === 'ushort' || t === 'uint16_t' || t.includes('uint16_t')) return 2; // CV_16U
  // Check uint8_t BEFORE int8_t because 'uint8_t'.includes('int8_t') is true
  if (t === 'unsigned char' || t === 'uchar' || t === 'uint8_t' || t.includes('uint8_t')) return 0; // CV_8U
  if (t === 'char' || t === 'signed char' || t === 'int8_t' || t.includes('int8_t')) return 1; // CV_8S
  if (t.includes('unsigned') && t.includes('int')) return 4; // treat as CV_32S (could be unsigned but we only have signed 32)
  if (t.includes('long long')) return 6; // CV_64F (approximate for 64-bit int)
  if (t.includes('long')) return 4; // CV_32S (assuming 32-bit long, platform dependent)
  
  return 0; // default to CV_8U
}

/**
 * Check if the variable is a C-style 1D array (e.g., int[10], float[100])
 * Returns: { is1DArray: boolean, elementType: string, size: number }
 * 
 * Note: This excludes 2D arrays which are handled by is2DCStyleArray()
 */
export function is1DCStyleArray(variableInfo: any): { 
  is1DArray: boolean; 
  elementType: string; 
  size: number 
} {
  const type = variableInfo.type || "";
  console.log("Checking if variable is C-style 1D array, type:", type);
  
  // First check it's NOT a 2D array (type[rows][cols])
  if (/\[\s*\d+\s*\]\s*\[\s*\d+\s*\]/.test(type)) {
    console.log("is1DCStyleArray result: false (is 2D array)");
    return { is1DArray: false, elementType: "", size: 0 };
  }
  
  // Match C-style 1D array patterns like:
  // int [10]
  // float[100]
  // double [50]
  // unsigned char[256]
  const cStyle1DPattern = /([a-zA-Z_][a-zA-Z0-9_*\s]*)\s*\[\s*(\d+)\s*\]/;
  const match = type.match(cStyle1DPattern);
  
  if (match) {
    const elementType = match[1].trim();
    const size = parseInt(match[2]);
    
    // Check if element type is a basic numeric type
    if (isBasicNumericType(elementType)) {
      console.log(`is1DCStyleArray result: is1DArray=true, elementType=${elementType}, size=${size}`);
      return { is1DArray: true, elementType, size };
    }
  }
  
  console.log("is1DCStyleArray result: false");
  return { is1DArray: false, elementType: "", size: 0 };
}

/**
 * Check if the variable is a C-style 2D array (e.g., int[2][3], float[4][5])
 * Returns: { is2DArray: boolean, rows: number, cols: number, elementType: string, depth: number }
 */
export function is2DCStyleArray(variableInfo: any): { 
  is2DArray: boolean; 
  rows: number; 
  cols: number; 
  elementType: string; 
  depth: number 
} {
  const type = variableInfo.type || "";
  console.log("Checking if variable is C-style 2D array, type:", type);
  
  // First check it's NOT a 3D array (type[H][W][C])
  if (/\[\s*\d+\s*\]\s*\[\s*\d+\s*\]\s*\[\s*\d+\s*\]/.test(type)) {
    console.log("is2DCStyleArray result: false (is 3D array)");
    return { is2DArray: false, rows: 0, cols: 0, elementType: "", depth: 0 };
  }
  
  // Match C-style array patterns like:
  // int [2][3]
  // float[4][5]
  // double [10][20]
  // char[100][50]
  const cStylePattern = /([a-zA-Z_][a-zA-Z0-9_*\s]*)\s*\[\s*(\d+)\s*\]\s*\[\s*(\d+)\s*\]/;
  const match = type.match(cStylePattern);
  
  if (match) {
    const elementType = match[1].trim();
    const rows = parseInt(match[2]);
    const cols = parseInt(match[3]);
    
    // Get depth from element type
    const depth = getDepthFromCppType(elementType);
    
    console.log(`is2DCStyleArray result: rows=${rows}, cols=${cols}, elementType=${elementType}, depth=${depth}`);
    return { is2DArray: true, rows, cols, elementType, depth };
  }
  
  console.log("is2DCStyleArray result: false");
  return { is2DArray: false, rows: 0, cols: 0, elementType: "", depth: 0 };
}

/**
 * Check if the variable is a C-style 3D array (e.g., uint8_t[480][640][3])
 * Used for multi-channel image representation where the last dimension is channels (1, 3, or 4)
 * Returns: { is3DArray: boolean, height: number, width: number, channels: number, elementType: string, depth: number }
 */
export function is3DCStyleArray(variableInfo: any): { 
  is3DArray: boolean; 
  height: number; 
  width: number; 
  channels: number; 
  elementType: string; 
  depth: number 
} {
  const type = variableInfo.type || "";
  console.log("Checking if variable is C-style 3D array, type:", type);
  
  // Match C-style 3D array patterns like:
  // unsigned char [480][640][3]
  // uint8_t[100][100][3]
  // float [H][W][C]
  const cStyle3DPattern = /([a-zA-Z_][a-zA-Z0-9_*\s]*)\s*\[\s*(\d+)\s*\]\s*\[\s*(\d+)\s*\]\s*\[\s*(\d+)\s*\]/;
  const match = type.match(cStyle3DPattern);
  
  if (match) {
    const elementType = match[1].trim();
    const height = parseInt(match[2]);
    const width = parseInt(match[3]);
    const channels = parseInt(match[4]);
    
    // Only consider it an image-suitable 3D array if channels is 1, 3, or 4
    if (channels !== 1 && channels !== 3 && channels !== 4) {
      console.log(`is3DCStyleArray result: false (channels=${channels} is not 1, 3, or 4)`);
      return { is3DArray: false, height: 0, width: 0, channels: 0, elementType: "", depth: 0 };
    }
    
    // Get depth from element type
    const depth = getDepthFromCppType(elementType);
    
    console.log(`is3DCStyleArray result: height=${height}, width=${width}, channels=${channels}, elementType=${elementType}, depth=${depth}`);
    return { is3DArray: true, height, width, channels, elementType, depth };
  }
  
  console.log("is3DCStyleArray result: false");
  return { is3DArray: false, height: 0, width: 0, channels: 0, elementType: "", depth: 0 };
}
