#!/bin/bash
# 自动更新版本并且使用对应的格式提交，触发 Github Action 自动发布

# 确保在项目根目录运行
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$DIR/.."

# 检查当前 git 工作区是否干净 (除了 package.json/package-lock.json 允许被 npm version 修改)
if [ -n "$(git status --porcelain | grep -v 'package')" ]; then
  echo "⚠️ 错误: 你的代码仓库有未提交的代码更改。"
  echo "请先使用 git commit 提交您的修改，然后再运行发布脚本。"
  exit 1
fi

CURRENT_VERSION=$(node -p "require('./package.json').version")
echo "🚀 当前拓展版本号为: v$CURRENT_VERSION"
echo ""
echo "请输入你要升级的版本类型，或直接输入新版本号："
echo "  1) patch: 修复小 bug (例如 0.0.38 -> 0.0.39)"
echo "  2) minor: 增加新特性 (例如 0.0.38 -> 0.1.0)"
echo "  3) major: 重大更新   (例如 0.0.38 -> 1.0.0)"
echo "或者直接输入自定义版本数字 (如: 0.0.40)"
read -p "选择/输入 > " VERSION_INPUT

if [ -z "$VERSION_INPUT" ]; then
    echo "❌ 错误: 输入不能为空。"
    exit 1
fi

case "$VERSION_INPUT" in
    1|patch)
        BUMP_TARGET="patch"
        ;;
    2|minor)
        BUMP_TARGET="minor"
        ;;
    3|major)
        BUMP_TARGET="major"
        ;;
    *)
        # User input a specific version
        # 验证是否符合数字规范 x.y.z
        if ! [[ "$VERSION_INPUT" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
            echo "❌ 错误: 版本号输入格式不正确，必须形如 1.2.3"
            exit 1
        fi
        BUMP_TARGET="$VERSION_INPUT"
        ;;
esac

echo ">> 正在升级版本 ($BUMP_TARGET) ..."

# npm version 会自动修改 package.json, package-lock.json，并且创建一个 commit 和 tag
# -m "%s" 参数确保产生一个只有版本号没有别的内容的纯净 commit 信息
# 我们的 github action 规定 commit msg 必须全是 "数字.数字.数字" 也就是 "%s" (不要带前面的 'v')
npm version $BUMP_TARGET -m "%s"

# 如果上一步成功
if [ $? -eq 0 ]; then
    NEW_VERSION=$(node -p "require('./package.json').version")
    echo "📦 版本号已成功升级并提交为: $NEW_VERSION"
    
    echo ">> 正在自动推送到 Github (包含 Tags)..."
    # 我们不仅推分支，连同新的 semantic tag (例如 v0.0.39) 一起推上去
    git push origin main
    git push origin "v$NEW_VERSION"
    
    echo "✅ 发布流程已触发！"
    echo "请前往 Github Actions 页面查看 'Publish Extension' 工作流发布状态："
    echo "https://github.com/dull-bird/cv_debug_mate_cpp/actions"
else
    echo "❌ npm version 执行失败"
fi
