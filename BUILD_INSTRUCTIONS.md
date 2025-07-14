# Alfred 风格剪切板功能构建说明

## 概述

我们已经为 N-Clip 实现了 Alfred 风格的剪切板功能，包括：
- 直接文本插入到其他应用（无需手动粘贴）
- 悬浮窗口不抢占焦点
- 智能权限管理
- 完整的回退机制

## 构建步骤

### 1. 安装原生模块依赖

```bash
# 安装项目依赖
pnpm install

# 安装原生模块依赖
cd electron/native
npm install
cd ../..
```

### 2. 构建原生模块

```bash
# 构建原生 accessibility 模块
npm run build:native
```

### 3. 构建完整应用

```bash
# 构建完整应用
npm run build
```

## 功能特性

### 1. 直接文本插入
- 使用 macOS Accessibility API 直接将文本插入到当前焦点的输入框
- 无需手动粘贴，实现 Alfred 相同的交互体验

### 2. 权限管理
- 自动检查 Accessibility 权限
- 友好的权限请求对话框
- 详细的权限设置指导

### 3. 智能回退
- 当没有 Accessibility 权限时，自动回退到传统的 AppleScript 方法
- 确保功能始终可用

### 4. 窗口管理
- 悬浮窗口不抢占当前应用焦点
- 支持键盘交互和鼠标点击
- 完整的 Alfred 风格体验

## 使用方法

### 1. 启动应用
- 首次启动时会显示权限请求对话框
- 用户可以选择立即授权或稍后设置

### 2. 授权 Accessibility 权限
- 打开"系统偏好设置" → "安全性与隐私" → "辅助功能"
- 添加 N-Clip 到允许列表

### 3. 使用功能
- 使用全局快捷键 `Cmd+Shift+C` 打开剪切板
- 选择任意条目后按 Enter 即可直接插入到当前应用
- 无需手动粘贴

## 技术实现

### 1. 原生模块 (electron/native/accessibility.mm)
- 使用 Objective-C++ 调用 macOS Accessibility API
- 实现焦点检测和直接文本插入
- 完整的权限管理

### 2. 权限对话框 (src/components/PermissionDialog.tsx)
- 现代化的权限请求界面
- 详细的设置指导
- 智能权限状态检测

### 3. 增强的粘贴功能
- 优先使用 Accessibility API
- 自动回退到 AppleScript
- 完整的错误处理

## 故障排除

### 1. 权限问题
- 确保在"系统偏好设置"中授权了 N-Clip
- 重启应用使权限生效

### 2. 构建问题
- 确保安装了 Xcode Command Line Tools
- 检查 Node.js 版本兼容性

### 3. 功能异常
- 检查控制台日志输出
- 尝试重新授权 Accessibility 权限

## 开发说明

### 文件结构
```
electron/
├── native/
│   ├── accessibility.mm          # 原生模块实现
│   ├── accessibility-wrapper.ts  # TypeScript 包装器
│   ├── binding.gyp               # 构建配置
│   └── package.json              # 原生模块配置
├── main/index.ts                 # 主进程 IPC 处理
└── preload/index.ts              # 预加载脚本 API

src/
├── components/
│   ├── PermissionDialog.tsx      # 权限对话框
│   └── ClipboardManager.tsx      # 剪切板管理器
└── types/electron.d.ts           # TypeScript 类型定义
```

### API 接口
- `accessibilityAPI.checkPermission()` - 检查权限
- `accessibilityAPI.requestPermission()` - 请求权限
- `accessibilityAPI.insertText(text)` - 直接插入文本
- `clipboardAPI.pasteToActiveAppEnhanced(text)` - 增强粘贴

这个实现提供了与 Alfred 相同的用户体验，同时保持了完整的向后兼容性。