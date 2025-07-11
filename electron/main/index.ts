import { app, BrowserWindow, shell, ipcMain, clipboard, globalShortcut, Tray, Menu, nativeImage } from 'electron'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'
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
let tray: Tray | null = null
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
  expiryTime?: number // 过期时间戳
}

// 存储有效期设置（毫秒）
interface StorageSettings {
  text: number    // 文本存储时间
  image: number   // 图片存储时间
  file: number    // 文件存储时间
}

// 默认存储设置（7天）
const defaultStorageSettings: StorageSettings = {
  text: 7 * 24 * 60 * 60 * 1000,    // 7天
  image: 3 * 24 * 60 * 60 * 1000,   // 3天
  file: 1 * 24 * 60 * 60 * 1000     // 1天
}

let storageSettings: StorageSettings = { ...defaultStorageSettings }

let clipboardHistory: ClipboardItem[] = []
let lastClipboardContent = ''
let isSettingClipboard = false // 标记是否正在设置剪切板内容

// 窗口位置存储
interface WindowBounds {
  x: number
  y: number
  width: number
  height: number
}

let windowBounds: WindowBounds = {
  x: 0,
  y: 0,
  width: 640,
  height: 480
}

async function createWindow() {
  win = new BrowserWindow({
    title: 'NClip',
    x: windowBounds.x,
    y: windowBounds.y,
    width: windowBounds.width,
    height: windowBounds.height,
    minWidth: 400,
    minHeight: 300,
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
  
  // 设置窗口不在Dock中显示
  if (process.platform === 'darwin') {
    app.dock.hide()
  }

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

  // 监听窗口位置变化
  win.on('moved', () => {
    if (win) {
      const bounds = win.getBounds()
      windowBounds = bounds
      // 发送位置更新到渲染进程
      win.webContents.send('window-bounds-changed', bounds)
    }
  })

  // 监听窗口大小变化
  win.on('resized', () => {
    if (win) {
      const bounds = win.getBounds()
      windowBounds = bounds
      // 发送位置更新到渲染进程
      win.webContents.send('window-bounds-changed', bounds)
    }
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
  
  // 创建系统托盘
  createTray()
  
  // 启动定期清理过期项目
  startExpiryCleanup()
  
  // 加载存储设置
  loadStorageSettings()
}

// 注册全局快捷键
function registerGlobalShortcuts() {
  // 使用不同的快捷键避免与Alfred冲突
  // 注册 Cmd/Ctrl + Shift + C 显示/隐藏窗口
  const shortcutRegistered = globalShortcut.register('CommandOrControl+Shift+C', () => {
    if (win) {
      if (win.isVisible()) {
        win.hide()
      } else {
        win.show()
        win.focus()
      }
    }
  })
  
  if (!shortcutRegistered) {
    console.warn('Failed to register global shortcut CommandOrControl+Shift+C')
  }
  
  // 备用快捷键 Cmd/Ctrl + Option + C
  const altShortcutRegistered = globalShortcut.register('CommandOrControl+Alt+C', () => {
    if (win) {
      if (win.isVisible()) {
        win.hide()
      } else {
        win.show()
        win.focus()
      }
    }
  })
  
  if (!altShortcutRegistered) {
    console.warn('Failed to register global shortcut CommandOrControl+Alt+C')
  }
}

// 创建系统托盘
function createTray() {
  // 创建托盘图标
  const iconPath = process.platform === 'darwin' 
    ? path.join(process.env.VITE_PUBLIC, 'tray-icon.png')
    : path.join(process.env.VITE_PUBLIC, 'favicon.ico')
  
  // 如果没有托盘图标，创建一个简单的
  let trayIcon
  try {
    trayIcon = nativeImage.createFromPath(iconPath)
  } catch {
    // 创建一个简单的16x16像素图标
    trayIcon = nativeImage.createFromNamedImage('NSImageNameFolder', [16, 16])
  }
  
  if (trayIcon.isEmpty()) {
    trayIcon = nativeImage.createFromNamedImage('NSImageNameFolder', [16, 16])
  }
  
  tray = new Tray(trayIcon)
  
  // 创建托盘菜单
  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show NClip',
      click: () => {
        if (win) {
          win.show()
          win.focus()
        }
      }
    },
    {
      label: 'Hide NClip',
      click: () => {
        if (win) {
          win.hide()
        }
      }
    },
    { type: 'separator' },
    {
      label: 'Clear History',
      click: () => {
        clipboardHistory = []
        if (win) {
          win.webContents.send('clipboard:history-updated', clipboardHistory)
        }
      }
    },
    { type: 'separator' },
    {
      label: 'Quit NClip',
      click: () => {
        app.quit()
      }
    }
  ])
  
  tray.setContextMenu(contextMenu)
  tray.setToolTip('NClip - Copy. Paste. Repeat.')
  
  // 点击托盘图标显示/隐藏窗口
  tray.on('click', () => {
    if (win) {
      if (win.isVisible()) {
        win.hide()
      } else {
        win.show()
        win.focus()
      }
    }
  })
}

// 剪切板监听器
function startClipboardMonitor() {
  // 获取初始剪切板内容
  lastClipboardContent = clipboard.readText()
  
  // 定时检查剪切板变化
  setInterval(() => {
    // 如果正在设置剪切板内容，跳过这次检查
    if (isSettingClipboard) {
      return
    }
    
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
        size: `${Math.round(imageBuffer.length / 1024)} KB`,
        expiryTime: Date.now() + storageSettings.image
      }
      
      // 检查是否是新的图片（通过大小和时间戳判断）
      const lastItem = clipboardHistory[0]
      if (!lastItem || lastItem.type !== 'image' || lastItem.content !== newItem.content) {
        // 检查是否已存在相同的图片内容
        const existingItem = clipboardHistory.find(item => 
          item.type === 'image' && item.content === newItem.content
        )
        
        if (!existingItem) {
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
    }
    // 检查文本
    else if (currentText !== lastClipboardContent && currentText.trim()) {
      // 检查是否已存在相同的文本内容
      const existingItem = clipboardHistory.find(item => 
        item.type === 'text' && item.content === currentText
      )
      
      if (!existingItem) {
        const newItem: ClipboardItem = {
          id: Date.now().toString(),
          type: 'text',
          content: currentText,
          timestamp: Date.now(),
          expiryTime: Date.now() + storageSettings.text
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
      } else {
        // 如果存在相同内容，将其移动到最前面
        const index = clipboardHistory.indexOf(existingItem)
        if (index > 0) {
          clipboardHistory.splice(index, 1)
          clipboardHistory.unshift(existingItem)
          
          // 通知渲染进程更新
          if (win) {
            win.webContents.send('clipboard:history-updated', clipboardHistory)
          }
        }
        
        lastClipboardContent = currentText
      }
    }
  }, 1000) // 每秒检查一次
}

// 启动过期清理
function startExpiryCleanup() {
  // 每小时清理一次过期项目
  setInterval(() => {
    const now = Date.now()
    const initialLength = clipboardHistory.length
    
    clipboardHistory = clipboardHistory.filter(item => {
      // 如果没有过期时间，保留项目
      if (!item.expiryTime) return true
      
      // 检查是否过期
      return item.expiryTime > now
    })
    
    // 如果有项目被清理，通知渲染进程
    if (clipboardHistory.length < initialLength) {
      console.log(`Cleaned up ${initialLength - clipboardHistory.length} expired items`)
      
      if (win) {
        win.webContents.send('clipboard:history-updated', clipboardHistory)
      }
    }
  }, 60 * 60 * 1000) // 每小时执行一次
}

app.whenReady().then(createWindow)

app.on('window-all-closed', () => {
  win = null
  // 不要退出应用，保持托盘运行
  // if (process.platform !== 'darwin') app.quit()
})

app.on('will-quit', () => {
  // 清理全局快捷键
  globalShortcut.unregisterAll()
  
  // 清理托盘
  if (tray) {
    tray.destroy()
    tray = null
  }
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
    // 设置标记，避免触发剪切板监听器
    isSettingClipboard = true
    
    if (item.type === 'image' && item.preview) {
      // 处理图片 - 从 base64 转换回图片
      const base64Data = item.preview.replace(/^data:image\/\w+;base64,/, '')
      const imageBuffer = Buffer.from(base64Data, 'base64')
      const nativeImage = require('electron').nativeImage.createFromBuffer(imageBuffer)
      clipboard.writeImage(nativeImage)
    } else {
      // 处理文本
      clipboard.writeText(item.content)
      lastClipboardContent = item.content
    }
    
    // 延迟重置标记，给剪切板一些时间更新
    setTimeout(() => {
      isSettingClipboard = false
    }, 500)
    
    return true
  } catch (error) {
    console.error('Failed to set clipboard content:', error)
    isSettingClipboard = false
    return false
  }
})

// 窗口位置相关 IPC
ipcMain.handle('window:get-bounds', () => {
  return windowBounds
})

ipcMain.handle('window:set-bounds', (_, bounds: WindowBounds) => {
  windowBounds = bounds
  if (win) {
    win.setBounds(bounds)
  }
  return true
})

ipcMain.handle('window:hide', () => {
  if (win) {
    win.hide()
  }
  return true
})

// 创建临时图片文件用于拖拽
ipcMain.handle('clipboard:create-temp-file', async (_, item: ClipboardItem) => {
  try {
    if (item.type === 'image' && item.preview) {
      // 从base64数据创建临时文件
      const base64Data = item.preview.replace(/^data:image\/\w+;base64,/, '')
      const imageBuffer = Buffer.from(base64Data, 'base64')
      
      // 创建临时文件路径
      const tempDir = os.tmpdir()
      const fileName = `nclip-${item.id}.png`
      const tempPath = path.join(tempDir, fileName)
      
      // 写入临时文件
      await fs.promises.writeFile(tempPath, imageBuffer)
      
      return tempPath
    }
    return null
  } catch (error) {
    console.error('Failed to create temp file:', error)
    return null
  }
})

// 启动原生拖拽
ipcMain.handle('clipboard:start-drag', async (_, item: ClipboardItem) => {
  try {
    if (item.type === 'image' && item.preview && win) {
      // 创建临时文件
      const base64Data = item.preview.replace(/^data:image\/\w+;base64,/, '')
      const imageBuffer = Buffer.from(base64Data, 'base64')
      
      const tempDir = os.tmpdir()
      const fileName = `nclip-${item.id}.png`
      const tempPath = path.join(tempDir, fileName)
      
      // 同步写入文件
      fs.writeFileSync(tempPath, imageBuffer)
      
      // 确保文件存在
      if (fs.existsSync(tempPath)) {
        console.log('Starting drag for file:', tempPath)
        
        // 创建拖拽图标
        let dragIcon
        try {
          dragIcon = nativeImage.createFromPath(tempPath)
          if (dragIcon.isEmpty()) {
            dragIcon = nativeImage.createFromBuffer(imageBuffer)
          }
          dragIcon = dragIcon.resize({ width: 64, height: 64 })
        } catch (error) {
          console.warn('Failed to create drag icon:', error)
          dragIcon = nativeImage.createEmpty()
        }
        
        // 启动原生拖拽
        win.webContents.startDrag({
          file: tempPath,
          icon: dragIcon
        })
        
        console.log('Drag started successfully')
        return true
      } else {
        console.error('Temp file was not created:', tempPath)
        return false
      }
    }
    return false
  } catch (error) {
    console.error('Failed to start drag:', error)
    return false
  }
})

// 删除剪切板项目
ipcMain.handle('clipboard:delete-item', async (_, itemId: string) => {
  try {
    const index = clipboardHistory.findIndex(item => item.id === itemId)
    if (index !== -1) {
      clipboardHistory.splice(index, 1)
      
      // 通知渲染进程更新
      if (win) {
        win.webContents.send('clipboard:history-updated', clipboardHistory)
      }
      
      return true
    }
    return false
  } catch (error) {
    console.error('Failed to delete item:', error)
    return false
  }
})

// 生成分享卡片
ipcMain.handle('clipboard:generate-share-card', async (_, item: ClipboardItem) => {
  try {
    if (item.type === 'image' && item.preview) {
      // 为图片生成分享卡片
      const tempPath = await generateImageShareCard(item)
      if (tempPath) {
        // 将生成的卡片复制到剪切板
        const cardImage = nativeImage.createFromPath(tempPath)
        clipboard.writeImage(cardImage)
        
        // 显示通知
        if (win) {
          win.webContents.send('notification', {
            type: 'success',
            message: '分享卡片已生成并复制到剪切板'
          })
        }
        
        return true
      }
    } else if (item.type === 'text') {
      // 为文本生成分享卡片
      const tempPath = await generateTextShareCard(item)
      if (tempPath) {
        const cardImage = nativeImage.createFromPath(tempPath)
        clipboard.writeImage(cardImage)
        
        if (win) {
          win.webContents.send('notification', {
            type: 'success',
            message: '分享卡片已生成并复制到剪切板'
          })
        }
        
        return true
      }
    }
    
    return false
  } catch (error) {
    console.error('Failed to generate share card:', error)
    return false
  }
})

// 生成图片分享卡片
async function generateImageShareCard(item: ClipboardItem): Promise<string | null> {
  try {
    const { createCanvas, loadImage } = require('canvas')
    
    // 创建画布
    const canvas = createCanvas(800, 600)
    const ctx = canvas.getContext('2d')
    
    // 背景渐变
    const gradient = ctx.createLinearGradient(0, 0, 800, 600)
    gradient.addColorStop(0, '#667eea')
    gradient.addColorStop(1, '#764ba2')
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, 800, 600)
    
    // 添加图片
    const base64Data = item.preview!.replace(/^data:image\/\w+;base64,/, '')
    const imageBuffer = Buffer.from(base64Data, 'base64')
    const image = await loadImage(imageBuffer)
    
    // 计算图片位置和大小
    const maxWidth = 600
    const maxHeight = 400
    const scale = Math.min(maxWidth / image.width, maxHeight / image.height)
    const imageWidth = image.width * scale
    const imageHeight = image.height * scale
    const x = (800 - imageWidth) / 2
    const y = (600 - imageHeight) / 2 - 50
    
    // 绘制图片
    ctx.drawImage(image, x, y, imageWidth, imageHeight)
    
    // 添加 NClip 品牌
    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)'
    ctx.font = 'bold 24px Arial'
    ctx.textAlign = 'center'
    ctx.fillText('NClip', 400, 550)
    
    ctx.fillStyle = 'rgba(255, 255, 255, 0.7)'
    ctx.font = '16px Arial'
    ctx.fillText('Copy. Paste. Repeat.', 400, 580)
    
    // 保存为PNG
    const tempDir = os.tmpdir()
    const fileName = `nclip-share-${Date.now()}.png`
    const tempPath = path.join(tempDir, fileName)
    
    const buffer = canvas.toBuffer('image/png')
    await fs.promises.writeFile(tempPath, buffer)
    
    return tempPath
  } catch (error) {
    console.error('Failed to generate image share card:', error)
    return null
  }
}

// 生成文本分享卡片
async function generateTextShareCard(item: ClipboardItem): Promise<string | null> {
  try {
    const { createCanvas } = require('canvas')
    
    // 创建画布
    const canvas = createCanvas(800, 600)
    const ctx = canvas.getContext('2d')
    
    // 背景渐变
    const gradient = ctx.createLinearGradient(0, 0, 800, 600)
    gradient.addColorStop(0, '#667eea')
    gradient.addColorStop(1, '#764ba2')
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, 800, 600)
    
    // 添加文本内容
    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)'
    ctx.font = '18px Arial'
    ctx.textAlign = 'center'
    
    // 分割文本为多行
    const maxWidth = 700
    const lines = wrapText(ctx, item.content, maxWidth)
    const lineHeight = 30
    const startY = 300 - (lines.length * lineHeight) / 2
    
    lines.forEach((line, index) => {
      ctx.fillText(line, 400, startY + index * lineHeight)
    })
    
    // 添加 NClip 品牌
    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)'
    ctx.font = 'bold 24px Arial'
    ctx.textAlign = 'center'
    ctx.fillText('NClip', 400, 550)
    
    ctx.fillStyle = 'rgba(255, 255, 255, 0.7)'
    ctx.font = '16px Arial'
    ctx.fillText('Copy. Paste. Repeat.', 400, 580)
    
    // 保存为PNG
    const tempDir = os.tmpdir()
    const fileName = `nclip-share-${Date.now()}.png`
    const tempPath = path.join(tempDir, fileName)
    
    const buffer = canvas.toBuffer('image/png')
    await fs.promises.writeFile(tempPath, buffer)
    
    return tempPath
  } catch (error) {
    console.error('Failed to generate text share card:', error)
    return null
  }
}

// 文本换行辅助函数
function wrapText(ctx: any, text: string, maxWidth: number): string[] {
  const words = text.split(' ')
  const lines: string[] = []
  let currentLine = ''
  
  for (const word of words) {
    const testLine = currentLine + word + ' '
    const metrics = ctx.measureText(testLine)
    const testWidth = metrics.width
    
    if (testWidth > maxWidth && currentLine !== '') {
      lines.push(currentLine.trim())
      currentLine = word + ' '
    } else {
      currentLine = testLine
    }
  }
  
  if (currentLine.trim() !== '') {
    lines.push(currentLine.trim())
  }
  
  return lines.slice(0, 10) // 限制最多10行
}

// 获取存储设置
ipcMain.handle('storage:get-settings', () => {
  return storageSettings
})

// 设置存储设置
ipcMain.handle('storage:set-settings', (_, settings: StorageSettings) => {
  storageSettings = { ...settings }
  
  // 更新现有项目的过期时间
  const now = Date.now()
  clipboardHistory.forEach(item => {
    if (item.expiryTime) {
      const timeLeft = item.expiryTime - now
      const newExpiryTime = now + storageSettings[item.type]
      
      // 如果新的过期时间更长，则更新
      if (newExpiryTime > item.expiryTime) {
        item.expiryTime = newExpiryTime
      }
    }
  })
  
  // 保存设置到文件
  const settingsPath = path.join(os.homedir(), '.nclip-settings.json')
  fs.writeFileSync(settingsPath, JSON.stringify(storageSettings, null, 2))
  
  return true
})

// 手动清理过期项目
ipcMain.handle('storage:cleanup-expired', () => {
  const now = Date.now()
  const initialLength = clipboardHistory.length
  
  clipboardHistory = clipboardHistory.filter(item => {
    if (!item.expiryTime) return true
    return item.expiryTime > now
  })
  
  const removedCount = initialLength - clipboardHistory.length
  
  if (removedCount > 0 && win) {
    win.webContents.send('clipboard:history-updated', clipboardHistory)
  }
  
  return removedCount
})

// 启动时加载存储设置
function loadStorageSettings() {
  try {
    const settingsPath = path.join(os.homedir(), '.nclip-settings.json')
    if (fs.existsSync(settingsPath)) {
      const savedSettings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'))
      storageSettings = { ...defaultStorageSettings, ...savedSettings }
    }
  } catch (error) {
    console.error('Failed to load storage settings:', error)
  }
}

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
