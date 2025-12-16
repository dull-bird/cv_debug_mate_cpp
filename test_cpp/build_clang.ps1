# build_native.ps1
# 功能：使用绝对路径调用 MSYS2 Clang64 进行编译，不依赖 MSVC
# 前提：已安装 MSYS2 且执行过 pacman -S mingw-w64-clang-x86_64-toolchain ...

$ErrorActionPreference = "Stop"

# ================= 配置区域 =================
# 1. MSYS2 安装根目录 (如果你安装在 D 盘，请修改这里)
$MsysRoot = "C:\msys64"

# 2. Clang64 环境的具体路径
$Clang64Bin = "$MsysRoot\clang64\bin"

# 3. 绝对路径定义编译器和构建工具
$Compilers = @{
    C   = "$Clang64Bin\clang.exe"
    CXX = "$Clang64Bin\clang++.exe"
    Ninja = "$Clang64Bin\ninja.exe"
}

# 4. 构建输出目录
$BuildDir = "$PSScriptRoot\build_clang_native"
$BuildType = "Debug"
# ===========================================

# --- 检查工具是否存在 ---
if (-not (Test-Path $Compilers.CXX)) {
    Write-Error "错误: 找不到 Clang++编译器，请检查路径: $($Compilers.CXX)"
}
if (-not (Test-Path $Compilers.Ninja)) {
    Write-Error "错误: 找不到 Ninja，请检查路径: $($Compilers.Ninja)"
}

Write-Host "=== 使用原生 MSYS2 Clang64 环境构建 ===" -ForegroundColor Cyan
Write-Host "编译器路径: $($Compilers.CXX)" -ForegroundColor Gray

# --- 关键步骤：配置临时环境变量 ---
# 将 Clang64/bin 放到 PATH 最前面，确保找到的是 lld 链接器和正确的 DLL
# 这不会永久修改你的系统环境变量，只对当前脚本运行期间有效
$env:PATH = "$Clang64Bin;" + $env:PATH

# --- 创建构建目录 ---
if (-not (Test-Path $BuildDir)) {
    New-Item -ItemType Directory -Path $BuildDir | Out-Null
}

Push-Location $BuildDir

try {
    # --- 运行 CMake ---
    Write-Host "`n[1/2] Configuring CMake..." -ForegroundColor Cyan
    
    # 显式指定编译器绝对路径，防止 CMake 乱找
    # -G Ninja: 使用 Ninja 生成器
    & $MsysRoot\clang64\bin\cmake.exe -G Ninja `
        "-DCMAKE_C_COMPILER=$($Compilers.C)" `
        "-DCMAKE_CXX_COMPILER=$($Compilers.CXX)" `
        "-DCMAKE_MAKE_PROGRAM=$($Compilers.Ninja)" `
        "-DCMAKE_BUILD_TYPE=$BuildType" `
        "-DCMAKE_EXPORT_COMPILE_COMMANDS=ON" `
        ..

    if ($LASTEXITCODE -ne 0) { throw "CMake 配置失败" }

    # --- 运行 Ninja ---
    Write-Host "`n[2/2] Building..." -ForegroundColor Cyan
    & $Compilers.Ninja

    if ($LASTEXITCODE -ne 0) { throw "编译失败" }

    Write-Host "`n构建成功! 输出文件在: $BuildDir" -ForegroundColor Green
}
catch {
    Write-Error $_
}
finally {
    Pop-Location
}