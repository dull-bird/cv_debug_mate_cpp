# =============================================================
# CV DebugMate Test - Build Script (Windows)
# =============================================================
# Usage:
#   .\build.ps1              # Build with auto-detected compiler
#   .\build.ps1 -Compiler msvc    # Use MSVC
#   .\build.ps1 -Compiler gcc     # Use GCC (MSYS2 UCRT64)
#   .\build.ps1 -Compiler clang   # Use Clang (MSYS2 Clang64)
#   .\build.ps1 -Clean            # Clean build directory
# =============================================================

param(
    [ValidateSet("auto", "msvc", "gcc", "clang")]
    [string]$Compiler = "auto",
    [switch]$Clean
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$BuildDir = "$ScriptDir\build"
$BuildType = "Debug"

# MSYS2 paths (modify if installed elsewhere)
$MSYS2_UCRT64 = "C:\msys64\ucrt64\bin"
$MSYS2_CLANG64 = "C:\msys64\clang64\bin"

# Clean
if ($Clean) {
    Write-Host "Cleaning build directory..." -ForegroundColor Yellow
    if (Test-Path $BuildDir) {
        Remove-Item -Recurse -Force $BuildDir
    }
    Write-Host "Done!" -ForegroundColor Green
    exit 0
}

# Auto-detect compiler
if ($Compiler -eq "auto") {
    if (Get-Command cl.exe -ErrorAction SilentlyContinue) {
        $Compiler = "msvc"
    } elseif (Test-Path "$MSYS2_CLANG64\clang++.exe") {
        $Compiler = "clang"
    } elseif (Test-Path "$MSYS2_UCRT64\g++.exe") {
        $Compiler = "gcc"
    } else {
        Write-Host "Error: No compiler found!" -ForegroundColor Red
        Write-Host "Install one of: MSVC, MSYS2 GCC, or MSYS2 Clang" -ForegroundColor Yellow
        exit 1
    }
}

# Configure based on compiler
$Generator = "Ninja"
$CMakeArgs = @()

switch ($Compiler) {
    "msvc" {
        Write-Host "Using MSVC" -ForegroundColor Cyan
        $Generator = "Visual Studio 17 2022"
        $CMakeArgs = @("-A", "x64")
    }
    "gcc" {
        Write-Host "Using GCC (MSYS2 UCRT64)" -ForegroundColor Cyan
        if (-not (Test-Path "$MSYS2_UCRT64\g++.exe")) {
            Write-Host "Error: GCC not found at $MSYS2_UCRT64" -ForegroundColor Red
            Write-Host "Install: pacman -S mingw-w64-ucrt-x86_64-gcc" -ForegroundColor Yellow
            exit 1
        }
        $env:PATH = "$MSYS2_UCRT64;$env:PATH"
        $CMakeArgs = @("-G", "Ninja",
                       "-DCMAKE_C_COMPILER=$MSYS2_UCRT64/gcc.exe",
                       "-DCMAKE_CXX_COMPILER=$MSYS2_UCRT64/g++.exe")
    }
    "clang" {
        Write-Host "Using Clang (MSYS2 Clang64)" -ForegroundColor Cyan
        if (-not (Test-Path "$MSYS2_CLANG64\clang++.exe")) {
            Write-Host "Error: Clang not found at $MSYS2_CLANG64" -ForegroundColor Red
            Write-Host "Install: pacman -S mingw-w64-clang-x86_64-toolchain" -ForegroundColor Yellow
            exit 1
        }
        $env:PATH = "$MSYS2_CLANG64;$env:PATH"
        $CMakeArgs = @("-G", "Ninja",
                       "-DCMAKE_C_COMPILER=$MSYS2_CLANG64/clang.exe",
                       "-DCMAKE_CXX_COMPILER=$MSYS2_CLANG64/clang++.exe")
    }
}

# Create build directory
if (-not (Test-Path $BuildDir)) {
    New-Item -ItemType Directory -Path $BuildDir | Out-Null
}

Push-Location $BuildDir
try {
    # Configure
    Write-Host "[1/2] Configuring..." -ForegroundColor Cyan
    if ($Compiler -eq "msvc") {
        & cmake $CMakeArgs ..
    } else {
        & cmake @CMakeArgs "-DCMAKE_BUILD_TYPE=$BuildType" ..
    }
    if ($LASTEXITCODE -ne 0) { throw "CMake configuration failed" }

    # Build
    Write-Host "[2/2] Building..." -ForegroundColor Cyan
    & cmake --build . --config $BuildType --parallel
    if ($LASTEXITCODE -ne 0) { throw "Build failed" }

    Write-Host ""
    Write-Host "Build successful!" -ForegroundColor Green
    Write-Host "  Output: $BuildDir\test_debugmate.exe" -ForegroundColor Green
    Write-Host ""
    Write-Host "Next steps:" -ForegroundColor Yellow
    Write-Host "  1. Open test_cpp folder in VS Code"
    Write-Host "  2. Set breakpoints in main.cpp"
    Write-Host "  3. Start debugging (F5)"
    Write-Host "  4. Use CV DebugMate to visualize!"
}
finally {
    Pop-Location
}

