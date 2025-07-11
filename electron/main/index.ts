import { app, BrowserWindow, shell, ipcMain, clipboard, globalShortcut, Tray, Menu, nativeImage } from 'electron'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'
import sqlite3 from 'sqlite3'
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
let shareCardWindow: BrowserWindow | null = null
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

// 数据库实例
let db: sqlite3.Database | null = null

// 初始化数据库
async function initDatabase() {
  return new Promise<void>((resolve, reject) => {
    const dbPath = path.join(os.homedir(), '.neurora', 'n-clip', 'clipboard.db')
    
    // 确保目录存在
    const dbDir = path.dirname(dbPath)
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true })
    }
    
    db = new sqlite3.Database(dbPath, (err) => {
      if (err) {
        console.error('Failed to open database:', err)
        reject(err)
        return
      }
      
      console.log('Database opened successfully')
      
      // 创建表
      db!.run(`
        CREATE TABLE IF NOT EXISTS clipboard_items (
          id TEXT PRIMARY KEY,
          type TEXT NOT NULL,
          content TEXT NOT NULL,
          preview TEXT,
          timestamp INTEGER NOT NULL,
          size TEXT,
          expiry_time INTEGER
        )
      `, (err) => {
        if (err) {
          console.error('Failed to create table:', err)
          reject(err)
        } else {
          console.log('Table created successfully')
          resolve()
        }
      })
    })
  })
}

// 保存剪切板项目到数据库
async function saveClipboardItem(item: ClipboardItem): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!db) {
      reject(new Error('Database not initialized'))
      return
    }
    
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO clipboard_items 
      (id, type, content, preview, timestamp, size, expiry_time) 
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
    
    stmt.run([
      item.id,
      item.type,
      item.content,
      item.preview || null,
      item.timestamp,
      item.size || null,
      item.expiryTime || null
    ], (err) => {
      if (err) {
        console.error('Failed to save clipboard item:', err)
        reject(err)
      } else {
        resolve()
      }
    })
    
    stmt.finalize()
  })
}

// 从数据库加载剪切板历史
async function loadClipboardHistory(): Promise<ClipboardItem[]> {
  return new Promise((resolve, reject) => {
    if (!db) {
      reject(new Error('Database not initialized'))
      return
    }
    
    const now = Date.now()
    
    // 删除过期项目
    db.run('DELETE FROM clipboard_items WHERE expiry_time IS NOT NULL AND expiry_time < ?', [now], (err) => {
      if (err) {
        console.error('Failed to delete expired items:', err)
      }
    })
    
    // 加载有效项目
    db.all(`
      SELECT * FROM clipboard_items 
      WHERE expiry_time IS NULL OR expiry_time > ?
      ORDER BY timestamp DESC
      LIMIT 1000
    `, [now], (err, rows: any[]) => {
      if (err) {
        console.error('Failed to load clipboard history:', err)
        reject(err)
        return
      }
      
      const items: ClipboardItem[] = rows.map(row => ({
        id: row.id,
        type: row.type,
        content: row.content,
        preview: row.preview,
        timestamp: row.timestamp,
        size: row.size,
        expiryTime: row.expiry_time
      }))
      
      resolve(items)
    })
  })
}

// 从数据库删除剪切板项目
async function deleteClipboardItem(itemId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!db) {
      reject(new Error('Database not initialized'))
      return
    }
    
    db.run('DELETE FROM clipboard_items WHERE id = ?', [itemId], (err) => {
      if (err) {
        console.error('Failed to delete clipboard item:', err)
        reject(err)
      } else {
        resolve()
      }
    })
  })
}

// 清理过期项目
async function cleanupExpiredItems(): Promise<number> {
  return new Promise((resolve, reject) => {
    if (!db) {
      reject(new Error('Database not initialized'))
      return
    }
    
    const now = Date.now()
    
    db.run('DELETE FROM clipboard_items WHERE expiry_time IS NOT NULL AND expiry_time < ?', [now], function(err) {
      if (err) {
        console.error('Failed to cleanup expired items:', err)
        reject(err)
      } else {
        resolve(this.changes || 0)
      }
    })
  })
}

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
  
  // 初始化数据库
  await initDatabase()
  
  // 加载存储设置
  loadStorageSettings()
  
  // 从数据库加载剪切板历史
  await loadClipboardHistoryFromDB()
  
  // 启动定期清理过期项目
  startExpiryCleanup()
}

// 创建分享卡片窗口
async function createShareCardWindow(item: ClipboardItem) {
  try {
    // 如果窗口已存在，先关闭
    if (shareCardWindow) {
      shareCardWindow.close()
      shareCardWindow = null
    }

    console.log('Creating share card window...')
    shareCardWindow = new BrowserWindow({
      title: '生成分享卡片',
      width: 800,
      height: 600,
      minWidth: 600,
      minHeight: 500,
      frame: true,
      transparent: false,
      resizable: true,
      alwaysOnTop: true,
      show: false,
      webPreferences: {
        preload,
        nodeIntegration: false,
        contextIsolation: true,
      },
    })

    if (!shareCardWindow) {
      throw new Error('Failed to create BrowserWindow')
    }

    console.log('Share card window created, loading URL...')
    
    // 窗口关闭时清理
    shareCardWindow.on('closed', () => {
      console.log('Share card window closed')
      shareCardWindow = null
    })

    // 创建一个Promise来确保窗口完全准备好
    const windowReadyPromise = new Promise<void>((resolve) => {
      let isResolved = false
      
      const showWindow = () => {
        if (isResolved || !shareCardWindow || shareCardWindow.isDestroyed()) return
        isResolved = true
        
        console.log('Showing share card window')
        shareCardWindow.show()
        shareCardWindow.focus()
        
        // 延迟发送数据，确保渲染进程完全准备好
        setTimeout(() => {
          if (shareCardWindow && !shareCardWindow.isDestroyed()) {
            console.log('Sending share card data')
            shareCardWindow.webContents.send('share-card-data', item)
          }
        }, 200)
        
        resolve()
      }
      
      // 监听ready-to-show事件
      shareCardWindow.once('ready-to-show', () => {
        console.log('Share card window ready to show')
        showWindow()
      })
      
      // 超时保护 - 如果3秒内还没显示，强制显示
      setTimeout(() => {
        if (!isResolved && shareCardWindow && !shareCardWindow.isDestroyed()) {
          console.log('Force showing share card window due to timeout')
          showWindow()
        }
      }, 3000)
    })
    
    // 加载分享卡片页面
    if (VITE_DEV_SERVER_URL) {
      await shareCardWindow.loadURL(`${VITE_DEV_SERVER_URL}#share-card`)
    } else {
      await shareCardWindow.loadFile(indexHtml, { hash: 'share-card' })
    }

    console.log('Share card window URL loaded')

    // 检查窗口是否仍然存在
    if (!shareCardWindow || shareCardWindow.isDestroyed()) {
      throw new Error('Share card window was destroyed during creation')
    }

    // 等待窗口完全准备好
    await windowReadyPromise

    return shareCardWindow
  } catch (error) {
    console.error('Error creating share card window:', error)
    shareCardWindow = null
    throw error
  }
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
          
          // 保存到数据库
          saveClipboardItem(newItem).catch(console.error)
          
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
        
        // 保存到数据库
        saveClipboardItem(newItem).catch(console.error)
        
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

// 从数据库加载剪切板历史
async function loadClipboardHistoryFromDB() {
  try {
    clipboardHistory = await loadClipboardHistory()
    console.log(`Loaded ${clipboardHistory.length} clipboard items from database`)
  } catch (error) {
    console.error('Failed to load clipboard history from database:', error)
  }
}

// 启动过期清理
function startExpiryCleanup() {
  // 每小时清理一次过期项目
  setInterval(async () => {
    try {
      const removedCount = await cleanupExpiredItems()
      
      if (removedCount > 0) {
        console.log(`Cleaned up ${removedCount} expired items from database`)
        
        // 重新加载剪切板历史
        await loadClipboardHistoryFromDB()
        
        // 通知渲染进程
        if (win) {
          win.webContents.send('clipboard:history-updated', clipboardHistory)
        }
      }
    } catch (error) {
      console.error('Failed to cleanup expired items:', error)
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
  
  // 关闭数据库连接
  if (db) {
    db.close((err) => {
      if (err) {
        console.error('Failed to close database:', err)
      } else {
        console.log('Database connection closed')
      }
    })
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
      
      // 从数据库删除
      await deleteClipboardItem(itemId)
      
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
ipcMain.handle('clipboard:generate-share-card', async (_, item: ClipboardItem, template: string = 'default', ratio: string = '3:4') => {
  try {
    console.log('Generate share card request for item:', item.type, item.id)
    
    if (item.type === 'image' && item.preview) {
      console.log('Processing image share card...')
      // 为图片生成分享卡片
      const tempPath = await generateImageShareCard(item, template, ratio)
      if (tempPath) {
        // 将生成的卡片复制到剪切板
        const cardImage = nativeImage.createFromPath(tempPath)
        clipboard.writeImage(cardImage)
        
        console.log('Image share card copied to clipboard')
        
        // 显示通知
        if (win) {
          win.webContents.send('notification', {
            type: 'success',
            message: '分享卡片已生成并复制到剪切板'
          })
        }
        
        return true
      } else {
        console.error('Failed to generate image share card - tempPath is null')
      }
    } else if (item.type === 'text') {
      console.log('Processing text share card...')
      // 为文本生成分享卡片
      const tempPath = await generateTextShareCard(item, template, ratio)
      if (tempPath) {
        const cardImage = nativeImage.createFromPath(tempPath)
        clipboard.writeImage(cardImage)
        
        console.log('Text share card copied to clipboard')
        
        if (win) {
          win.webContents.send('notification', {
            type: 'success',
            message: '分享卡片已生成并复制到剪切板'
          })
        }
        
        return true
      } else {
        console.error('Failed to generate text share card - tempPath is null')
      }
    }
    
    console.log('No valid share card generation path found')
    return false
  } catch (error) {
    console.error('Failed to generate share card:', error)
    console.error('Error details:', error.stack)
    return false
  }
})

// 打开分享卡片窗口
ipcMain.handle('share-card:open', async (_, item: ClipboardItem) => {
  try {
    console.log('IPC: Opening share card window for item:', item.type, item.id)
    
    // 如果窗口已经存在且未销毁，先关闭它
    if (shareCardWindow && !shareCardWindow.isDestroyed()) {
      console.log('Closing existing share card window')
      shareCardWindow.close()
      shareCardWindow = null
      // 等待一下确保窗口完全关闭
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    
    await createShareCardWindow(item)
    return true
  } catch (error) {
    console.error('Failed to open share card window:', error)
    return false
  }
})

// 生成分享卡片预览（返回base64图片用于预览）
ipcMain.handle('clipboard:generate-share-card-preview', async (_, item: ClipboardItem, template: string = 'default', ratio: string = '3:4') => {
  try {
    console.log('Generate share card preview request for item:', item.type, item.id, 'template:', template, 'ratio:', ratio)
    
    let tempPath: string | null = null
    
    if (item.type === 'image' && item.preview) {
      tempPath = await generateImageShareCard(item, template, ratio)
    } else if (item.type === 'text') {
      tempPath = await generateTextShareCard(item, template, ratio)
    }
    
    if (tempPath) {
      // 读取生成的图片文件并转换为base64
      const imageBuffer = await fs.promises.readFile(tempPath)
      const base64Image = `data:image/png;base64,${imageBuffer.toString('base64')}`
      
      // 删除临时文件
      try {
        await fs.promises.unlink(tempPath)
      } catch (error) {
        console.warn('Failed to delete temp file:', error)
      }
      
      return base64Image
    }
    
    return null
  } catch (error) {
    console.error('Failed to generate share card preview:', error)
    return null
  }
})

// 生成图片分享卡片
async function generateImageShareCard(item: ClipboardItem, template: string = 'default', ratio: string = '3:4'): Promise<string | null> {
  try {
    console.log('Starting image share card generation...')
    const { createCanvas, loadImage } = require('canvas')
    
    // 计算画布尺寸
    let width: number, height: number
    if (ratio === '4:3') {
      width = 800
      height = 600
    } else if (ratio === '1:1') {
      width = 600
      height = 600
    } else { // 默认 3:4
      width = 600
      height = 800
    }
    
    // 创建画布
    const canvas = createCanvas(width, height)
    const ctx = canvas.getContext('2d')
    
    // 背景渐变
    const gradient = ctx.createLinearGradient(0, 0, width, height)
    if (template === 'dark') {
      gradient.addColorStop(0, '#1a1a1a')
      gradient.addColorStop(1, '#2d2d2d')
    } else if (template === 'pastel') {
      gradient.addColorStop(0, '#ffeaa7')
      gradient.addColorStop(1, '#fab1a0')
    } else {
      gradient.addColorStop(0, '#667eea')
      gradient.addColorStop(1, '#764ba2')
    }
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, width, height)
    
    // 添加图片
    const base64Data = item.preview!.replace(/^data:image\/\w+;base64,/, '')
    const imageBuffer = Buffer.from(base64Data, 'base64')
    const image = await loadImage(imageBuffer)
    
    // 计算图片位置和大小
    const maxWidth = width - 100
    const maxHeight = height - 200
    const scale = Math.min(maxWidth / image.width, maxHeight / image.height)
    const imageWidth = image.width * scale
    const imageHeight = image.height * scale
    const x = (width - imageWidth) / 2
    const y = (height - imageHeight) / 2 - 50
    
    // 绘制图片
    ctx.drawImage(image, x, y, imageWidth, imageHeight)
    
    // 添加 NClip 品牌
    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)'
    ctx.font = 'bold 28px Arial'
    ctx.textAlign = 'center'
    ctx.fillText('NClip', width / 2, height - 80)
    
    ctx.fillStyle = 'rgba(255, 255, 255, 0.7)'
    ctx.font = '18px Arial'
    ctx.fillText('Copy. Paste. Repeat.', width / 2, height - 50)
    
    // 保存为PNG
    const tempDir = os.tmpdir()
    const fileName = `nclip-share-${Date.now()}.png`
    const tempPath = path.join(tempDir, fileName)
    
    const buffer = canvas.toBuffer('image/png')
    await fs.promises.writeFile(tempPath, buffer)
    
    console.log('Image share card generated successfully:', tempPath)
    return tempPath
  } catch (error) {
    console.error('Failed to generate image share card:', error)
    console.error('Error details:', error.stack)
    return null
  }
}

// 生成文本分享卡片
async function generateTextShareCard(item: ClipboardItem, template: string = 'default', ratio: string = '3:4'): Promise<string | null> {
  try {
    console.log('Starting text share card generation...')
    const { createCanvas } = require('canvas')
    
    // 计算画布尺寸
    let width: number, height: number
    if (ratio === '4:3') {
      width = 800
      height = 600
    } else if (ratio === '1:1') {
      width = 600
      height = 600
    } else { // 默认 3:4
      width = 600
      height = 800
    }
    
    // 创建画布
    const canvas = createCanvas(width, height)
    const ctx = canvas.getContext('2d')
    
    // 背景渐变
    const gradient = ctx.createLinearGradient(0, 0, width, height)
    if (template === 'dark') {
      gradient.addColorStop(0, '#1a1a1a')
      gradient.addColorStop(1, '#2d2d2d')
    } else if (template === 'pastel') {
      gradient.addColorStop(0, '#ffeaa7')
      gradient.addColorStop(1, '#fab1a0')
    } else {
      gradient.addColorStop(0, '#667eea')
      gradient.addColorStop(1, '#764ba2')
    }
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, width, height)
    
    // 设置文本颜色
    const textColor = template === 'dark' ? 'rgba(255, 255, 255, 0.9)' : 
                      template === 'pastel' ? 'rgba(0, 0, 0, 0.8)' : 'rgba(255, 255, 255, 0.9)'
    
    // 添加文本内容
    ctx.fillStyle = textColor
    ctx.font = '20px Arial'
    ctx.textAlign = 'center'
    
    // 分割文本为多行，考虑画布高度
    const maxWidth = width - 80
    const maxContentHeight = height - 200 // 留出品牌区域
    const lines = wrapText(ctx, item.content, maxWidth)
    const lineHeight = 32
    const totalTextHeight = lines.length * lineHeight
    
    // 如果文本太长，减少行数并添加省略号
    let displayLines = lines
    if (totalTextHeight > maxContentHeight) {
      const maxLines = Math.floor(maxContentHeight / lineHeight) - 1
      displayLines = lines.slice(0, maxLines)
      if (displayLines.length > 0) {
        displayLines[displayLines.length - 1] = displayLines[displayLines.length - 1] + '...'
      }
    }
    
    // 计算起始Y位置，垂直居中
    const actualTextHeight = displayLines.length * lineHeight
    const startY = (height - actualTextHeight) / 2 - 50
    
    // 绘制文本
    displayLines.forEach((line, index) => {
      ctx.fillText(line, width / 2, startY + index * lineHeight)
    })
    
    // 添加 NClip 品牌
    const brandColor = template === 'pastel' ? 'rgba(0, 0, 0, 0.8)' : 'rgba(255, 255, 255, 0.9)'
    ctx.fillStyle = brandColor
    ctx.font = 'bold 28px Arial'
    ctx.textAlign = 'center'
    ctx.fillText('NClip', width / 2, height - 80)
    
    const taglineColor = template === 'pastel' ? 'rgba(0, 0, 0, 0.6)' : 'rgba(255, 255, 255, 0.7)'
    ctx.fillStyle = taglineColor
    ctx.font = '18px Arial'
    ctx.fillText('Copy. Paste. Repeat.', width / 2, height - 50)
    
    // 保存为PNG
    const tempDir = os.tmpdir()
    const fileName = `nclip-share-${Date.now()}.png`
    const tempPath = path.join(tempDir, fileName)
    
    const buffer = canvas.toBuffer('image/png')
    await fs.promises.writeFile(tempPath, buffer)
    
    console.log('Text share card generated successfully:', tempPath)
    return tempPath
  } catch (error) {
    console.error('Failed to generate text share card:', error)
    console.error('Error details:', error.stack)
    return null
  }
}

// 文本换行辅助函数
function wrapText(ctx: any, text: string, maxWidth: number): string[] {
  const lines: string[] = []
  
  // 按换行符分割段落
  const paragraphs = text.split('\n')
  
  for (const paragraph of paragraphs) {
    if (paragraph.trim() === '') {
      lines.push('')
      continue
    }
    
    // 处理每个段落
    const words = paragraph.split(' ')
    let currentLine = ''
    
    for (const word of words) {
      const testLine = currentLine + (currentLine ? ' ' : '') + word
      const metrics = ctx.measureText(testLine)
      const testWidth = metrics.width
      
      if (testWidth > maxWidth && currentLine !== '') {
        lines.push(currentLine)
        currentLine = word
      } else {
        currentLine = testLine
      }
      
      // 如果单个单词就超过宽度，强制换行
      if (ctx.measureText(currentLine).width > maxWidth) {
        const chars = currentLine.split('')
        let charLine = ''
        
        for (const char of chars) {
          const testCharLine = charLine + char
          if (ctx.measureText(testCharLine).width > maxWidth && charLine !== '') {
            lines.push(charLine)
            charLine = char
          } else {
            charLine = testCharLine
          }
        }
        
        if (charLine) {
          currentLine = charLine
        }
      }
    }
    
    if (currentLine) {
      lines.push(currentLine)
    }
  }
  
  return lines
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
  const settingsPath = path.join(os.homedir(), '.neurora', 'n-clip', 'settings.json')
  const settingsDir = path.dirname(settingsPath)
  if (!fs.existsSync(settingsDir)) {
    fs.mkdirSync(settingsDir, { recursive: true })
  }
  fs.writeFileSync(settingsPath, JSON.stringify(storageSettings, null, 2))
  
  return true
})

// 手动清理过期项目
ipcMain.handle('storage:cleanup-expired', async () => {
  try {
    const removedCount = await cleanupExpiredItems()
    
    if (removedCount > 0) {
      // 重新加载剪切板历史
      await loadClipboardHistoryFromDB()
      
      // 通知渲染进程
      if (win) {
        win.webContents.send('clipboard:history-updated', clipboardHistory)
      }
    }
    
    return removedCount
  } catch (error) {
    console.error('Failed to cleanup expired items:', error)
    return 0
  }
})

// 启动时加载存储设置
function loadStorageSettings() {
  try {
    const settingsPath = path.join(os.homedir(), '.neurora', 'n-clip', 'settings.json')
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
