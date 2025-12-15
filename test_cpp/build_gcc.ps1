# Build script for Windows using GCC (MSYS2) + Ninja
# Requires: MSYS2 with mingw-w64-ucrt-x86_64-gcc installed

$ErrorActionPreference = "Stop"

# Configuration
$BuildDir = "$PSScriptRoot\build_gcc"
$BuildType = "Debug"
$MSYS2_BIN = "C:\msys64\ucrt64\bin"

# Check GCC exists
if (-not (Test-Path "$MSYS2_BIN\gcc.exe")) {
    Write-Host "Error: GCC not found at $MSYS2_BIN" -ForegroundColor Red
    Write-Host "Please install MSYS2 and run: pacman -S mingw-w64-ucrt-x86_64-gcc" -ForegroundColor Yellow
    exit 1
}

# Add MSYS2 to PATH for this session
$env:Path = "$MSYS2_BIN;$env:Path"

Write-Host "Using GCC: $MSYS2_BIN\gcc.exe" -ForegroundColor Green

# Create build directory
if (-not (Test-Path $BuildDir)) {
    New-Item -ItemType Directory -Path $BuildDir | Out-Null
}

Push-Location $BuildDir
try {
    Write-Host "Configuring with CMake..." -ForegroundColor Cyan
    & cmake -G Ninja "-DCMAKE_C_COMPILER=$MSYS2_BIN/gcc.exe" "-DCMAKE_CXX_COMPILER=$MSYS2_BIN/g++.exe" "-DCMAKE_BUILD_TYPE=$BuildType" ..
    
    if ($LASTEXITCODE -ne 0) {
        throw "CMake configuration failed"
    }

    Write-Host "Building..." -ForegroundColor Cyan
    ninja

    if ($LASTEXITCODE -ne 0) {
        throw "Build failed"
    }

    Write-Host "Build successful!" -ForegroundColor Green
    Write-Host "Output: $BuildDir\test_debugmate.exe" -ForegroundColor Green
}
finally {
    Pop-Location
}
