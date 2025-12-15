# Build script for Windows using Clang + Ninja
# Requires: Clang, Ninja, CMake, Visual Studio 2019

$ErrorActionPreference = "Stop"

# Configuration
$BuildDir = "$PSScriptRoot\build_ninja"
$BuildType = "Debug"

# Use VS 2019 toolchain (compatible with Clang 18)
$VS2019Path = "C:\Program Files (x86)\Microsoft Visual Studio\2019\Community\VC\Tools\MSVC"
if (Test-Path $VS2019Path) {
    $MSVCVersion = (Get-ChildItem $VS2019Path -Directory | Select-Object -First 1).Name
    $env:VCToolsInstallDir = "$VS2019Path\$MSVCVersion\"
    Write-Host "Using MSVC toolchain: $env:VCToolsInstallDir" -ForegroundColor Green
} else {
    Write-Host "Warning: VS 2019 not found, using system default" -ForegroundColor Yellow
}

# Create build directory
if (-not (Test-Path $BuildDir)) {
    New-Item -ItemType Directory -Path $BuildDir | Out-Null
}

Push-Location $BuildDir
try {
    Write-Host "Configuring with CMake..." -ForegroundColor Cyan
    & cmake -G Ninja "-DCMAKE_C_COMPILER=clang" "-DCMAKE_CXX_COMPILER=clang++" "-DCMAKE_BUILD_TYPE=$BuildType" ..
    
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
