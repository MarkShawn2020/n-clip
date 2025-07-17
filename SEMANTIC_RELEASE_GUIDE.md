# Semantic Release 使用指南

## 当前状态修复

由于你手动创建了 3.1.1-3.1.4 的标签，semantic-release 现在处于冲突状态。需要先修复这个问题。

### 修复步骤：

1. **删除手动创建的标签**（建议）:
```bash
git tag -d v3.1.1 v3.1.2 v3.1.3 v3.1.4
git push origin :refs/tags/v3.1.1 :refs/tags/v3.1.2 :refs/tags/v3.1.3 :refs/tags/v3.1.4
```

2. **重置 package.json 版本**:
```bash
# 将 package.json 中的版本改回 3.1.0
# 然后提交这个更改
git add package.json
git commit -m "chore: reset version for semantic-release compatibility"
```

3. **推送并让 semantic-release 接管**:
```bash
git push origin main
```

## 正确的提交格式

Semantic Release 使用 [Conventional Commits](https://www.conventionalcommits.org/) 格式：

### 基本格式：
```
<type>[optional scope]: <description>

[optional body]

[optional footer(s)]
```

### 版本影响：

| 提交类型 | 版本变化 | 示例 |
|---------|---------|------|
| `fix:` | patch (3.1.0 → 3.1.1) | `fix: resolve clipboard copy issue` |
| `feat:` | minor (3.1.0 → 3.2.0) | `feat: add dark mode support` |
| `BREAKING CHANGE:` | major (3.1.0 → 4.0.0) | `feat!: redesign API interface` |

### 常用类型：

- `feat:` - 新功能
- `fix:` - 修复 bug
- `docs:` - 文档更新
- `style:` - 代码格式化
- `refactor:` - 重构代码
- `perf:` - 性能优化
- `test:` - 测试相关
- `chore:` - 构建过程或辅助工具变动
- `ci:` - CI/CD 配置
- `build:` - 构建系统

### 示例提交：

```bash
# Patch 版本 (3.1.0 → 3.1.1)
git commit -m "fix: prevent clipboard manager from crashing on empty content"

# Minor 版本 (3.1.0 → 3.2.0)
git commit -m "feat: add keyboard shortcuts for clipboard navigation"

# Major 版本 (3.1.0 → 4.0.0)
git commit -m "feat!: redesign clipboard storage format

BREAKING CHANGE: clipboard data structure changed, requires migration"
```

## 推荐工作流

1. **开发功能**：在你的代码中实现功能
2. **测试**：确保功能正常工作
3. **提交**：使用正确的 conventional commit 格式
4. **推送**：推送到 main 分支
5. **自动发布**：semantic-release 会自动：
   - 分析提交历史
   - 确定版本号
   - 生成 CHANGELOG
   - 创建 GitHub release
   - 构建和发布应用

## 不会触发发布的提交

这些类型的提交不会触发新版本：
- `docs:` - 文档更新
- `style:` - 代码格式
- `test:` - 测试
- `chore:` - 杂项任务
- `build:` - 构建配置
- `ci:` - CI/CD 配置

## 强制跳过发布

如果你想要某个提交不触发发布，可以在提交消息中添加 `[skip ci]` 或使用 `chore:` 类型。

## 查看即将发布的版本

你可以在本地运行 semantic-release 的 dry-run 模式来查看会发布什么版本：

```bash
npx semantic-release --dry-run
```

## 紧急情况处理

如果 semantic-release 出现问题，你可以：

1. 在 GitHub 上手动创建 release
2. 暂时禁用 semantic-release
3. 修复问题后重新启用

## 当前建议

基于你的情况，我建议：

1. 先修复当前的标签冲突
2. 然后使用 semantic-release 管理所有未来的版本
3. 遵循 conventional commits 格式进行提交

这样可以确保版本管理的一致性和自动化。