#!/bin/bash
# 自动打包供本地 VSCode 测试的 VSIX 文件

# 确保在项目根目录运行
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$DIR/.."

echo "📦 开始打包 VSCode 插件..."

# 检查是否安装了依赖 (node_modules 是否存在)
if [ ! -d "node_modules" ]; then
    echo ">> 安装依赖"
    npm install
fi

# 使用 vsce 打包
echo ">> 打包成 VSIX 文件"
npx @vscode/vsce package

echo ""
echo "✅ 打包完成！"
echo "你可以将生成的 .vsix 文件拖入 VSCode 的 '扩展(Extensions)' 侧边栏进行手动安装，"
echo "或者在当前目录下运行以下命令安装："
echo ""
echo "code --install-extension xxxxx.vsix"
