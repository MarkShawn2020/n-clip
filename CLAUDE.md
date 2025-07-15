# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## **开发军规**

- 禁止备用方案
- 禁止测试用例
- 禁止try-catch
- 禁止setTimeout
- 禁止动态导入
- 不要测试，本地在run dev

## Project Overview

N-Clip is a modern clipboard manager built with Electron, React, and TypeScript. It provides intelligent clipboard monitoring, search functionality, and share card generation with local SQLite storage.

## Development Commands

### Package Manager
- Use `pnpm` as the package manager (not npm or yarn)
- Install dependencies: `pnpm install`

### Development
- Start development server: `pnpm dev`
- Run tests: `pnpm test`
- Preview build: `pnpm preview`

### Build
- **IMPORTANT**: Do not run `pnpm build` automatically - it takes a long time
- Build command: `pnpm build` (runs TypeScript compilation, Vite build, and electron-builder)

### Test
- Test setup: `pnpm pretest` (builds in test mode)
- Run tests: `pnpm test` (uses Vitest)
- Test files are in `test/` directory with pattern `*.{test,spec}.?(c|m)[jt]s?(x)`

## Architecture

### Tech Stack
- **Frontend**: React 18 + TypeScript + Vite
- **Desktop**: Electron with main/preload/renderer architecture
- **State Management**: Jotai atoms
- **Storage**: SQLite3 database
- **Styling**: CSS3 + Tailwind CSS
- **Canvas**: For image processing and share card generation

### Key Directories
- `electron/` - Electron main process and preload scripts
  - `main/` - Main process code (index.ts, update.ts)
  - `preload/` - Preload scripts for secure IPC
- `src/` - React renderer process
  - `components/` - React components (ClipboardManager, ShareCardWindow)
  - `store/` - Jotai atoms for state management
  - `types/` - TypeScript type definitions
- `dist-electron/` - Build output for Electron processes
- `dist/` - Build output for web assets

### Data Storage
- Application data stored in `~/.neurora/n-clip/`
- SQLite database: `clipboard.db`
- Database schema includes: id, type, content, preview, timestamp, size, expiry_time
- Images stored in date-organized directories

### Key Components

#### ClipboardManager (src/components/ClipboardManager.tsx)
- Main interface component
- Handles clipboard history display and search
- Manages keyboard navigation and item selection
- Integrates with Jotai atoms for state management

#### ShareCardWindow (src/components/ShareCardWindow.tsx)
- Generates share cards from clipboard content
- Supports multiple templates (default, dark, soft)
- Multiple aspect ratios (3:4, 4:3, 1:1)
- Canvas-based image generation

#### SettingsWindow (src/components/SettingsWindow.tsx)
- Independent settings window application
- Comprehensive settings interface with modern design
- Manages app preferences (theme, notifications, auto-start)
- Storage duration configuration for different content types
- Global hotkey customization
- Data management (cleanup, clear history)
- Persistent settings with localStorage
- Responsive design with dark mode support

#### State Management (src/store/atoms.ts)
- Uses Jotai for atomic state management
- Key atoms: clipboardItemsAtom, searchQueryAtom, selectedIndexAtom, filteredItemsAtom
- Persistent window position storage with localStorage
- Settings management: settingsAtom
- Settings stored in localStorage with key 'n-clip-settings'

### IPC Communication
- Main process handles clipboard monitoring and database operations
- Preload script provides secure API bridge
- Renderer process communicates via `window.clipboardAPI` and `window.windowAPI`
- Settings API: getStorageSettings, setStorageSettings, cleanupExpiredItems, clearHistory

### Alfred-Style Focus Management System

**核心技术突破**: 实现了真正的Alfred风格无焦点抢夺交互

#### 技术挑战
在macOS应用开发中，实现类似Alfred的剪贴板管理器面临一个经典的焦点管理困境：
- **接收用户输入需要窗口焦点** (键盘/鼠标交互)
- **保持原始app焦点不变** (不中断用户工作流)

这两个需求在传统窗口系统中是互斥的。

#### 解决方案: 混合焦点管理

##### 1. 智能窗口配置
```typescript
win = new BrowserWindow({
  // Alfred风格：无窗口装饰但保持前台交互
  frame: false,
  transparent: true,
  titleBarStyle: 'hidden',
  hasShadow: false,
  
  // 关键：智能焦点管理配置
  focusable: true,        // 允许接收键盘事件
  acceptFirstMouse: false, // 防止意外点击激活
  alwaysOnTop: true,      // 前台显示
  skipTaskbar: true,      // 不在任务栏显示
  
  // 使用普通窗口类型避免panel冲突
  visibleOnAllWorkspaces: true,
  vibrancy: 'under-window'
})
```

##### 2. 全局键盘事件监听
```typescript
// 真正的全局键盘监听实现
function startGlobalKeyboardListener() {
  const shortcuts = [
    { key: 'Up', handler: () => navigateItems('up') },
    { key: 'Down', handler: () => navigateItems('down') },
    { key: 'Return', handler: () => selectCurrentItem() },
    { key: 'Escape', handler: () => hideWindow() }
  ]
  
  shortcuts.forEach(({ key, handler }) => {
    globalShortcut.register(key, handler)
  })
}
```

##### 3. 智能窗口显示/隐藏
```typescript
// 显示窗口但不抢夺焦点
async function showWindowIntelligently() {
  // 获取当前焦点应用信息
  const focusedAppInfo = getFocusedAppInfo()
  
  // 使用showInactive显示窗口但不激活
  win.showInactive()
  win.setAlwaysOnTop(true, 'floating')
  
  // 短暂延迟后启动全局键盘监听
  setTimeout(() => {
    if (win && win.isVisible()) {
      startGlobalKeyboardListener()
    }
  }, 50)
}
```

##### 4. 优化的粘贴流程
```typescript
// 选择项目并粘贴到原应用
async function pasteSelectedItem(item: ClipboardItem) {
  // 1. 立即隐藏窗口，让焦点回到原应用
  hideWindowIntelligently()
  
  // 2. 短暂延迟确保焦点完全返回
  await new Promise(resolve => setTimeout(resolve, 100))
  
  // 3. 设置剪贴板内容
  if (item.type === 'image') {
    clipboard.writeImage(nativeImage.createFromBuffer(imageBuffer))
  } else {
    clipboard.writeText(item.content)
  }
  
  // 4. 模拟Cmd+V键盘事件
  const keystrokeSuccess = simulatePasteKeystroke()
  
  return { success: true, method: 'enhanced-paste' }
}
```

#### 技术架构

**主进程 (Main Process)**:
- 全局快捷键注册和监听
- 窗口焦点状态管理
- 辅助功能API调用
- 键盘事件模拟

**渲染进程 (Renderer Process)**:
- 接收主进程发送的键盘事件
- UI交互和状态更新
- 备用的本地键盘事件处理

**IPC通信**:
```typescript
// 主进程 -> 渲染进程
win.webContents.send('navigate-items', direction)
win.webContents.send('select-current-item')

// 渲染进程 -> 主进程
ipcRenderer.invoke('clipboard:paste-selected-item', item)
```

#### 关键文件
- `electron/main/index.ts`: 智能窗口管理和全局键盘监听
- `electron/preload/index.ts`: IPC桥接和事件代理
- `src/components/ClipboardManager.tsx`: UI交互和渲染进程事件处理
- `electron/native/accessibility.mm`: macOS辅助功能API集成

#### 测试验证
1. **焦点保持**: 在文本编辑器中，按快捷键唤起剪贴板，光标应该仍然闪烁
2. **键盘交互**: 上下键导航，回车键选择，ESC键隐藏
3. **鼠标交互**: 点击选择项目，不应抢夺原应用焦点
4. **粘贴功能**: 选择项目后应该正确粘贴到原应用输入框

**技术成果**: 实现了真正的Alfred风格用户体验，解决了桌面应用开发中的经典焦点管理难题。

### Global Shortcuts
- Primary: `Cmd+Shift+C` (or `Cmd+Option+C`)
- System tray integration for easy access
- Global keyboard navigation: Up/Down/Enter/Escape/Tab/Delete/Space

## Build Configuration

### Vite Configuration
- Uses `vite-plugin-electron/simple` for Electron integration
- Alias `@/` points to `src/`
- Development server runs on port 7777
- Sourcemaps enabled in development

### Electron Builder
- Output to `release/${version}/`
- Supports macOS (dmg, zip) and Windows (nsis)
- Auto-updater configuration included

### TypeScript
- ESNext target with React JSX
- Strict mode enabled
- Path alias `@/*` for src imports
- Includes both src and electron directories

## Development Notes

### Database Schema
```sql
CREATE TABLE clipboard_items (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  content TEXT NOT NULL,
  preview TEXT,
  timestamp INTEGER NOT NULL,
  size TEXT,
  expiry_time INTEGER
)
```

### Build Notes
- **IMPORTANT**: Do not run build automatically - it takes significant time
- Build process includes TypeScript compilation, Vite bundling, and Electron packaging

### Settings System
- **Settings Window**: Independent window accessible via tray menu
- **Activation**: Click "Settings" in system tray context menu
- **Window Properties**: 800x600 pixels, resizable, with standard window frame
- **Persistent Storage**: Settings stored in localStorage and main process
- **Configuration Options**:
  - Theme selection (light, dark, auto)
  - Auto-start and notifications
  - Storage duration for different content types
  - Global hotkey customization
  - Data management features (cleanup, clear history)
- **Modern Design**: Responsive layout with dark mode support

## SuperCompact 记录

最后执行时间: 2025-07-12 15:45:00
执行内容: 会话压缩 + 自动提交 + 项目文件更新

## Development Best Practices

### Code Guidelines
- 不要自己测试

### Timing and Async Patterns
- **禁止使用 setTimeout/setInterval**: 禁止使用时间延迟函数，它们会导致不可预测的竞态条件和时序依赖
- **推荐替代方案**:
  - 使用 `async/await` 和 Promise 进行异步操作
  - 使用事件驱动模式和适当的事件监听器
  - 使用回调函数和响应式模式
  - 使用状态机模式管理复杂的异步流程
  - 使用观察者模式处理状态变化
- **例外情况**: 仅在用户界面反馈（如显示保存成功消息3秒后自动清除）等非关键路径场景中允许使用，且必须有明确注释说明

## SuperCompact 记录

最后执行时间: 2025-07-12 15:45:00
执行内容: 会话压缩 + 自动提交 + 项目文件更新

## Development Notes

### Current Local State
- 本地正在pnpm dev，请你不要动