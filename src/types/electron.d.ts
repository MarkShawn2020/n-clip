export interface ClipboardItem {
  id: string
  type: 'text' | 'image' | 'file'
  content: string
  preview?: string
  timestamp: number
  size?: string
  isPinned?: boolean
}

export interface ClipboardAPI {
  getClipboardHistory: () => Promise<ClipboardItem[]>
  setClipboardContent: (item: ClipboardItem) => Promise<boolean>
  onClipboardChange: (callback: (content: ClipboardItem) => void) => void
  removeClipboardListener: () => void
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