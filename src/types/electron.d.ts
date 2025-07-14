export interface ClipboardItem {
  id: string
  type: 'text' | 'image' | 'file'
  content: string
  preview?: string
  timestamp: number
  size?: string
  isPinned?: boolean
}

export interface StorageSettings {
  textDuration: number
  imageDuration: number
  fileDuration: number
}

export interface ClipboardAPI {
  getClipboardHistory: () => Promise<ClipboardItem[]>
  setClipboardContent: (item: ClipboardItem) => Promise<boolean>
  onClipboardChange: (callback: (content: ClipboardItem) => void) => void
  onClipboardHistoryUpdate: (callback: (history: ClipboardItem[]) => void) => void
  removeClipboardListener: () => void
  deleteItem: (itemId: string) => Promise<boolean>
  togglePin: (itemId: string) => Promise<boolean>
  generateShareCard: (item: ClipboardItem, template?: string, ratio?: string) => Promise<string>
  generateShareCardPreview: (item: ClipboardItem, template?: string, ratio?: string) => Promise<string>
  openShareCardWindow: (item: ClipboardItem) => Promise<void>
  createTempFile: (item: ClipboardItem) => Promise<string>
  startDrag: (item: ClipboardItem) => Promise<void>
  getStorageSettings: () => Promise<StorageSettings>
  setStorageSettings: (settings: StorageSettings) => Promise<boolean>
  cleanupExpiredItems: () => Promise<boolean>
  clearHistory: () => Promise<boolean>
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
}

declare global {
  interface Window {
    clipboardAPI: ClipboardAPI
    windowAPI: WindowAPI
    ipcRenderer: {
      on: (channel: string, listener: (event: any, ...args: any[]) => void) => void
      off: (channel: string, ...args: any[]) => void
      send: (channel: string, ...args: any[]) => void
      invoke: (channel: string, ...args: any[]) => Promise<any>
    }
  }
}