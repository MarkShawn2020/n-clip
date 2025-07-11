export interface ClipboardItem {
  id: string
  type: 'text' | 'image' | 'file'
  content: string
  preview?: string
  timestamp: number
  size?: string
}

export interface ClipboardAPI {
  getClipboardHistory: () => Promise<ClipboardItem[]>
  setClipboardContent: (item: ClipboardItem) => Promise<boolean>
  onClipboardChange: (callback: (content: ClipboardItem) => void) => void
  removeClipboardListener: () => void
}

declare global {
  interface Window {
    clipboardAPI: ClipboardAPI
    ipcRenderer: {
      on: (channel: string, listener: (event: any, ...args: any[]) => void) => void
      off: (channel: string, ...args: any[]) => void
      send: (channel: string, ...args: any[]) => void
      invoke: (channel: string, ...args: any[]) => Promise<any>
    }
  }
}