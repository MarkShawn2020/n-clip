import { app, BrowserWindow, shell, ipcMain, clipboard, globalShortcut } from 'electron'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import os from 'node:os'
import { update } from './update'

const require = createRequire(import.meta.url)
const __dirname = path.dirname(fileURLToPath(import.meta.url))

// The built directory structure
//
// ├─┬ dist-electron
// │ ├─┬ main
// │ │ └── index.js    > Electron-Main
// │ └─┬ preload
// │   └── index.mjs   > Preload-Scripts
// ├─┬ dist
// │ └── index.html    > Electron-Renderer
//
process.env.APP_ROOT = path.join(__dirname, '../..')

export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')
export const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL
  ? path.join(process.env.APP_ROOT, 'public')
  : RENDERER_DIST

// Disable GPU Acceleration for Windows 7
if (os.release().startsWith('6.1')) app.disableHardwareAcceleration()

// Set application name for Windows 10+ notifications
if (process.platform === 'win32') app.setAppUserModelId(app.getName())

if (!app.requestSingleInstanceLock()) {
  app.quit()
  process.exit(0)
}

let win: BrowserWindow | null = null
const preload = path.join(__dirname, '../preload/index.mjs')
const indexHtml = path.join(RENDERER_DIST, 'index.html')

// 剪切板历史存储
interface ClipboardItem {
  id: string
  type: 'text' | 'image' | 'file'
  content: string
  preview?: string
  timestamp: number
  size?: string
}

let clipboardHistory: ClipboardItem[] = []
let lastClipboardContent = ''

async function createWindow() {
  win = new BrowserWindow({
    title: 'n-clip',
    width: 640,
    height: 480,
    minWidth: 600,
    minHeight: 400,
    frame: false,
    transparent: true,
    resizable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    icon: path.join(process.env.VITE_PUBLIC, 'favicon.ico'),
    webPreferences: {
      preload,
      nodeIntegration: false,
      contextIsolation: true,
    },
  })

  if (VITE_DEV_SERVER_URL) { // #298
    win.loadURL(VITE_DEV_SERVER_URL)
    // Open devTool if the app is not packaged
    // win.webContents.openDevTools()
  } else {
    win.loadFile(indexHtml)
  }

  // Show window when ready
  win.once('ready-to-show', () => {
    win?.show()
  })

  // Test actively push message to the Electron-Renderer
  win.webContents.on('did-finish-load', () => {
    win?.webContents.send('main-process-message', new Date().toLocaleString())
  })

  // Make all links open with the browser, not with the application
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https:')) shell.openExternal(url)
    return { action: 'deny' }
  })

  // Auto update
  update(win)
  
  // 启动剪切板监听
  startClipboardMonitor()
  
  // 注册全局快捷键
  registerGlobalShortcuts()
}

// 注册全局快捷键
function registerGlobalShortcuts() {
  // 注册 Cmd/Ctrl + Shift + V 显示/隐藏窗口
  globalShortcut.register('CommandOrControl+Shift+V', () => {
    if (win) {
      if (win.isVisible()) {
        win.hide()
      } else {
        win.show()
        win.focus()
      }
    }
  })
  
  // 注册 Esc 隐藏窗口
  globalShortcut.register('Escape', () => {
    if (win && win.isVisible()) {
      win.hide()
    }
  })
}

// 剪切板监听器
function startClipboardMonitor() {
  // 获取初始剪切板内容
  lastClipboardContent = clipboard.readText()
  
  // 定时检查剪切板变化
  setInterval(() => {
    const currentText = clipboard.readText()
    const currentImage = clipboard.readImage()
    
    // 检查图片
    if (!currentImage.isEmpty()) {
      const imageSize = currentImage.getSize()
      const imageBuffer = currentImage.toPNG()
      const imageBase64 = imageBuffer.toString('base64')
      
      const newItem: ClipboardItem = {
        id: Date.now().toString(),
        type: 'image',
        content: `Image: ${imageSize.width}x${imageSize.height}`,
        preview: `data:image/png;base64,${imageBase64}`,
        timestamp: Date.now(),
        size: `${Math.round(imageBuffer.length / 1024)} KB`
      }
      
      // 检查是否是新的图片（通过大小和时间戳判断）
      const lastItem = clipboardHistory[0]
      if (!lastItem || lastItem.type !== 'image' || lastItem.content !== newItem.content) {
        clipboardHistory.unshift(newItem)
        
        // 限制历史记录数量
        if (clipboardHistory.length > 100) {
          clipboardHistory = clipboardHistory.slice(0, 100)
        }
        
        // 通知渲染进程
        if (win) {
          win.webContents.send('clipboard:changed', newItem)
        }
      }
    }
    // 检查文本
    else if (currentText !== lastClipboardContent && currentText.trim()) {
      const newItem: ClipboardItem = {
        id: Date.now().toString(),
        type: 'text',
        content: currentText,
        timestamp: Date.now()
      }
      
      // 添加到历史记录
      clipboardHistory.unshift(newItem)
      
      // 限制历史记录数量
      if (clipboardHistory.length > 100) {
        clipboardHistory = clipboardHistory.slice(0, 100)
      }
      
      lastClipboardContent = currentText
      
      // 通知渲染进程
      if (win) {
        win.webContents.send('clipboard:changed', newItem)
      }
    }
  }, 1000) // 每秒检查一次
}

app.whenReady().then(createWindow)

app.on('window-all-closed', () => {
  win = null
  if (process.platform !== 'darwin') app.quit()
})

app.on('will-quit', () => {
  // 清理全局快捷键
  globalShortcut.unregisterAll()
})

app.on('second-instance', () => {
  if (win) {
    // Focus on the main window if the user tried to open another
    if (win.isMinimized()) win.restore()
    win.focus()
  }
})

app.on('activate', () => {
  const allWindows = BrowserWindow.getAllWindows()
  if (allWindows.length) {
    allWindows[0].focus()
  } else {
    createWindow()
  }
})

// IPC handlers
ipcMain.handle('clipboard:get-history', () => {
  return clipboardHistory
})

ipcMain.handle('clipboard:set-content', (_, item: ClipboardItem) => {
  try {
    if (item.type === 'image' && item.preview) {
      // 处理图片 - 从 base64 转换回图片
      const base64Data = item.preview.replace(/^data:image\/\w+;base64,/, '')
      const imageBuffer = Buffer.from(base64Data, 'base64')
      const nativeImage = require('electron').nativeImage.createFromBuffer(imageBuffer)
      clipboard.writeImage(nativeImage)
    } else {
      // 处理文本
      clipboard.writeText(item.content)
    }
    return true
  } catch (error) {
    console.error('Failed to set clipboard content:', error)
    return false
  }
})

// New window example arg: new windows url
ipcMain.handle('open-win', (_, arg) => {
  const childWindow = new BrowserWindow({
    webPreferences: {
      preload,
      nodeIntegration: true,
      contextIsolation: false,
    },
  })

  if (VITE_DEV_SERVER_URL) {
    childWindow.loadURL(`${VITE_DEV_SERVER_URL}#${arg}`)
  } else {
    childWindow.loadFile(indexHtml, { hash: arg })
  }
})
