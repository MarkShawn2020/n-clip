export interface ClipboardItem {
  id: string
  type: 'text' | 'image' | 'file'
  content: string
  preview?: string
  timestamp: number
  size?: string
  
  // Star机制字段
  isStarred?: boolean        // 是否被收藏到档案库
  starredAt?: number         // 收藏时间戳
  category?: string          // 用户自定义分类
  tags?: string[]            // 标签系统
  description?: string       // 用户备注
}

// 档案库分类结构
export interface ArchiveCategory {
  id: string
  name: string
  type: 'text' | 'image' | 'file' | 'mixed'
  itemCount: number
  createdAt: number
  updatedAt: number
}

export interface StorageSettings {
  textDuration: number
  imageDuration: number
  fileDuration: number
}

export interface ClipboardAPI {
  getClipboardHistory: () => Promise<ClipboardItem[]>
  setClipboardContent: (item: ClipboardItem) => Promise<boolean>
  pasteToActiveApp: () => Promise<{ success: boolean; error?: string }>
  pasteToActiveAppEnhanced: (text: string) => Promise<{ success: boolean; error?: string; method: string }>
  onClipboardChange: (callback: (content: ClipboardItem) => void) => void
  onClipboardHistoryUpdate: (callback: (history: ClipboardItem[]) => void) => void
  removeClipboardListener: () => void
  deleteItem: (itemId: string) => Promise<boolean>
  
  // Star机制API（替代pin机制）
  starItem: (itemId: string, category?: string, description?: string) => Promise<{ success: boolean; error?: string }>
  unstarItem: (itemId: string) => Promise<{ success: boolean; error?: string }>
  getStarredItems: (category?: string) => Promise<ClipboardItem[]>
  getCategories: () => Promise<ArchiveCategory[]>
  createCategory: (name: string, type: 'text' | 'image' | 'file' | 'mixed') => Promise<{ success: boolean; categoryId?: string; error?: string }>
  updateItemCategory: (itemId: string, categoryId: string) => Promise<{ success: boolean; error?: string }>
  updateItemTags: (itemId: string, tags: string[]) => Promise<{ success: boolean; error?: string }>
  updateItemDescription: (itemId: string, description: string) => Promise<{ success: boolean; error?: string }>
  
  generateShareCard: (item: ClipboardItem, template?: string, ratio?: string) => Promise<string>
  generateShareCardPreview: (item: ClipboardItem, template?: string, ratio?: string) => Promise<string>
  openShareCardWindow: (item: ClipboardItem) => Promise<void>
  openArchiveWindow: () => Promise<{ success: boolean; error?: string }>
  createTempFile: (item: ClipboardItem) => Promise<string>
  startDrag: (item: ClipboardItem) => Promise<void>
  getStorageSettings: () => Promise<StorageSettings>
  setStorageSettings: (settings: StorageSettings) => Promise<boolean>
  cleanupExpiredItems: () => Promise<boolean>
  clearHistory: () => Promise<boolean>
  
  // 全局键盘事件支持
  pasteSelectedItem: (item: ClipboardItem) => Promise<{ success: boolean; error?: string; method: string }>
  onNavigateItems: (callback: (direction: 'up' | 'down') => void) => void
  onSelectCurrentItem: (callback: () => void) => void
  onDeleteCurrentItem: (callback: () => void) => void
  onToggleStar: (callback: () => void) => void   // Star/Unstar快捷键
  onOpenArchive: (callback: () => void) => void  // 打开档案库快捷键
  onTogglePreview: (callback: () => void) => void
  removeGlobalKeyboardListeners: () => void
}

export interface AccessibilityAPI {
  checkPermission: () => Promise<boolean>
  requestPermission: () => Promise<boolean>
  getFocusedElement: () => Promise<boolean>
  insertText: (text: string) => Promise<boolean>
  getAppInfo: () => Promise<{
    appName?: string
    hasFocusedElement: boolean
    elementRole?: string
  }>
}

export interface WindowBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface WindowAPI {
  getBounds: () => Promise<WindowBounds>
  setBounds: (bounds: WindowBounds) => Promise<boolean>
  onBoundsChanged: (callback: (bounds: WindowBounds) => void) => void
  removeWindowListener: () => void
  getSettingsBounds: () => Promise<WindowBounds>
  setSettingsBounds: (bounds: WindowBounds) => Promise<boolean>
  onSettingsBoundsChanged: (callback: (bounds: WindowBounds) => void) => void
  removeSettingsWindowListener: () => void
  getCurrentShortcut: () => Promise<string>
  testShortcut: (shortcut: string) => Promise<{ isRegistered: boolean; currentShortcut: string; canRegisterShortcuts: boolean; targetCanRegister: boolean }>
  updateGlobalShortcut: (shortcut: string) => Promise<{ success: boolean; error?: string }>
  hideWindow: () => Promise<boolean>
}

declare global {
  interface Window {
    clipboardAPI: ClipboardAPI
    windowAPI: WindowAPI
    accessibilityAPI: AccessibilityAPI
    ipcRenderer: {
      on: (channel: string, listener: (event: any, ...args: any[]) => void) => void
      off: (channel: string, ...args: any[]) => void
      send: (channel: string, ...args: any[]) => void
      invoke: (channel: string, ...args: any[]) => Promise<any>
    }
  }
}