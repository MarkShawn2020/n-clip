# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

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

### Global Shortcuts
- Primary: `Cmd+Shift+C` (or `Cmd+Option+C`)
- System tray integration for easy access

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