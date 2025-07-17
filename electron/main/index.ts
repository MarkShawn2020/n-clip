import { app, BrowserWindow, ipcMain, globalShortcut, clipboard, screen, Tray, Menu, nativeImage } from 'electron'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'
// import sqlite3 from 'sqlite3'

const require = createRequire(import.meta.url)
const __dirname = path.dirname(fileURLToPath(import.meta.url))

process.env.APP_ROOT = path.join(__dirname, '../..')

export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')
export const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL
  ? path.join(process.env.APP_ROOT, 'public')
  : RENDERER_DIST

let win: BrowserWindow | null = null
let archiveWindow: BrowserWindow | null = null
let tray: Tray | null = null
// 窗口状态管理
let windowPosition: { x: number; y: number } | null = null
let windowReady = false
const preload = path.join(__dirname, '../preload/index.mjs')
const indexHtml = path.join(RENDERER_DIST, 'index.html')

// 剪切板历史存储
interface ClipboardItem {
  id: string
  type: 'text' | 'image'
  content: string
  preview?: string
  timestamp: number
  size?: string
}

// 档案库项目（独立存储）
interface ArchiveItem {
  id: string
  originalId: string  // 原剪切板条目的ID
  type: 'text' | 'image'
  content: string
  preview?: string
  timestamp: number
  size?: string
  starredAt: number
  category: string
  tags?: string[]
  description?: string
}

let clipboardHistory: ClipboardItem[] = []
let archiveItems: ArchiveItem[] = []
let lastClipboardText = ''
let navigationShortcutsRegistered = false
let operationInProgress = false

// 数据存储相关 - 使用JSON文件持久化
const APP_DATA_PATH = path.join(os.homedir(), '.neurora', 'n-clip')
const CLIPBOARD_DATA_FILE = path.join(APP_DATA_PATH, 'clipboard-history.json')
const ARCHIVE_DATA_FILE = path.join(APP_DATA_PATH, 'archive-items.json')

// 初始化数据存储
function initDataStorage() {
  try {
    // 确保数据目录存在
    if (!fs.existsSync(APP_DATA_PATH)) {
      fs.mkdirSync(APP_DATA_PATH, { recursive: true })
    }
    
    console.log('Data storage initialized at:', APP_DATA_PATH)
    return Promise.resolve()
  } catch (error) {
    console.error('Failed to initialize data storage:', error)
    return Promise.reject(error)
  }
}

// 加载剪切板历史数据
function loadClipboardHistory() {
  try {
    if (fs.existsSync(CLIPBOARD_DATA_FILE)) {
      const data = fs.readFileSync(CLIPBOARD_DATA_FILE, 'utf8')
      const items = JSON.parse(data) as ClipboardItem[]
      clipboardHistory = items || []
      console.log(`Loaded ${clipboardHistory.length} clipboard items from storage`)
    } else {
      console.log('No existing clipboard history file found')
    }
    return Promise.resolve()
  } catch (error) {
    console.error('Failed to load clipboard history:', error)
    clipboardHistory = []
    return Promise.resolve()
  }
}

// 加载档案库数据
function loadArchiveItems() {
  try {
    if (fs.existsSync(ARCHIVE_DATA_FILE)) {
      const data = fs.readFileSync(ARCHIVE_DATA_FILE, 'utf8')
      const items = JSON.parse(data) as ArchiveItem[]
      archiveItems = items || []
      console.log(`Loaded ${archiveItems.length} archive items from storage`)
    } else {
      console.log('No existing archive data file found')
    }
    return Promise.resolve()
  } catch (error) {
    console.error('Failed to load archive items:', error)
    archiveItems = []
    return Promise.resolve()
  }
}

// 保存剪切板历史到文件
function saveClipboardHistory() {
  try {
    const data = JSON.stringify(clipboardHistory, null, 2)
    fs.writeFileSync(CLIPBOARD_DATA_FILE, data, 'utf8')
    return Promise.resolve()
  } catch (error) {
    console.error('Failed to save clipboard history:', error)
    return Promise.reject(error)
  }
}

// 保存档案库数据到文件
function saveArchiveItems() {
  try {
    const data = JSON.stringify(archiveItems, null, 2)
    fs.writeFileSync(ARCHIVE_DATA_FILE, data, 'utf8')
    return Promise.resolve()
  } catch (error) {
    console.error('Failed to save archive items:', error)
    return Promise.reject(error)
  }
}

// 数据库操作函数 - 使用JSON文件存储
function saveClipboardItem(item: ClipboardItem) {
  return saveClipboardHistory()
}

function saveArchiveItem(item: ArchiveItem) {
  return saveArchiveItems()
}

function deleteArchiveItem(itemId: string) {
  return saveArchiveItems()
}

function deleteClipboardItem(itemId: string) {
  return saveClipboardHistory()
}

async function createWindow() {
  // 如果窗口已存在，直接返回
  if (win && !win.isDestroyed()) {
    console.log('Window already exists, skipping creation')
    return
  }
  
  console.log('Creating new window...')
  windowReady = false
  
  win = new BrowserWindow({
    title: 'N-Clip',
    width: 800,
    height: 600,
    show: false, // 初始隐藏
    // 临时启用frame和shadow用于调试可见性
    frame: false,
    transparent: false, // 临时改为非透明
    hasShadow: true, // 临时启用阴影
    titleBarStyle: 'hidden',
    backgroundColor: '#1e1e1e', // 添加深色背景
    // 前台显示且可交互的关键配置
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    closable: false,
    fullscreenable: false,
    // 关键：Alfred风格焦点管理配置
    focusable: true, // 允许接收键盘事件
    acceptFirstMouse: true, // 允许点击激活以便检测失焦
    // vibrancy: 'under-window', // 临时禁用
    webPreferences: {
      preload,
      nodeIntegration: false,
      contextIsolation: true,
    },
  })
  
  // 计算并保存固定窗口位置
  if (!windowPosition) {
    const { screen } = require('electron')
    const primaryDisplay = screen.getPrimaryDisplay()
    const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize
    
    const windowWidth = 800
    const windowHeight = 600
    windowPosition = {
      x: Math.round((screenWidth - windowWidth) / 2),
      y: Math.round((screenHeight - windowHeight) / 2)
    }
    console.log(`Fixed window position calculated: ${windowPosition.x}, ${windowPosition.y}`)
  }

  // 等待窗口完全准备就绪
  return new Promise<void>((resolve) => {
    win!.webContents.once('dom-ready', () => {
      console.log('=== DOM READY ===')
      console.log('Window bounds:', win?.getBounds())
      console.log('Window visible:', win?.isVisible())
      console.log('Window focused:', win?.isFocused())
      
      // 设置固定位置
      if (windowPosition) {
        win?.setBounds({ ...windowPosition, width: 800, height: 600 })
      }
      
      // DOM准备好后，发送当前剪切板历史
      if (clipboardHistory.length > 0) {
        win?.webContents.send('clipboard:history-updated', clipboardHistory)
      }
      
      windowReady = true
      console.log('Window ready for use')
      resolve()
    })
    
    win!.webContents.on('did-finish-load', () => {
      console.log('=== PAGE LOADED ===')
      console.log('Window bounds:', win?.getBounds())
      console.log('Window visible:', win?.isVisible())
    })

    // 阻止窗口关闭，只是隐藏 - 只注册一次
    win!.once('close', (event) => {
      if (!(app as any).isQuitting) {
        event.preventDefault()
        atomicHide()
        console.log('Window close prevented, hiding instead')
      }
    })
    
    // 加载页面
    if (VITE_DEV_SERVER_URL) {
      win!.loadURL(VITE_DEV_SERVER_URL)
    } else {
      win!.loadFile(indexHtml)
    }
  })
}

// 剪切板监听
function startClipboardWatcher() {
  setInterval(() => {
    let newItem: ClipboardItem | null = null
    
    // 检查图片
    const currentImage = clipboard.readImage()
    if (!currentImage.isEmpty()) {
      const imageSize = currentImage.getSize()
      const imageBuffer = currentImage.toPNG()
      const imageBase64 = imageBuffer.toString('base64')
      const imageSizeKB = Math.round(imageBuffer.length / 1024)
      
      const imageContent = `Image: ${imageSize.width}×${imageSize.height}`
      const imageDataUrl = `data:image/png;base64,${imageBase64}`
      
      // 检查是否已存在相同图片（通过大小和内容hash比较）
      const isDuplicate = clipboardHistory.some(item => 
        item.type === 'image' && 
        item.content === imageContent &&
        item.size === `${imageSizeKB} KB`
      )
      
      if (!isDuplicate) {
        newItem = {
          id: Date.now().toString(),
          type: 'image',
          content: imageContent,
          preview: imageDataUrl,
          timestamp: Date.now(),
          size: `${imageSizeKB} KB`
        }
      }
    } 
    // 检查文本（仅在没有图片时）
    else {
      const currentText = clipboard.readText()
      
      if (currentText && currentText !== lastClipboardText) {
        lastClipboardText = currentText
        
        // 检查是否已存在相同文本
        const isDuplicate = clipboardHistory.some(item => 
          item.type === 'text' && item.content === currentText
        )
        
        if (!isDuplicate) {
          newItem = {
            id: Date.now().toString(),
            type: 'text',
            content: currentText,
            preview: currentText.length > 100 ? currentText.substring(0, 100) + '...' : currentText,
            timestamp: Date.now()
          }
        }
      }
    }
    
    // 添加新项目到历史记录
    if (newItem) {
      clipboardHistory.unshift(newItem)
      
      // 限制历史记录数量
      if (clipboardHistory.length > 50) {
        clipboardHistory = clipboardHistory.slice(0, 50)
      }
      
      // 保存到数据库
      saveClipboardItem(newItem).catch(err => {
        console.error('Failed to save clipboard item to database:', err)
      })
      
      // 通知渲染进程更新
      if (win) {
        win?.webContents.send('clipboard:history-updated', clipboardHistory)
      }
      
      // 更新托盘菜单
      updateTrayMenu()
      
      console.log('New clipboard item:', newItem.type, newItem.content)
    }
  }, 1000) // 每秒检查一次
}

// 创建系统托盘
function createTray() {
  // 创建托盘图标 - 使用简单的文本图标
  const iconSize = 16
  const canvas = require('canvas').createCanvas(iconSize, iconSize)
  const ctx = canvas.getContext('2d')
  
  // 绘制简单的剪切板图标
  ctx.fillStyle = '#000000'
  ctx.fillRect(2, 2, 12, 12)
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(3, 3, 10, 10)
  ctx.fillStyle = '#000000'
  ctx.fillRect(4, 6, 8, 1)
  ctx.fillRect(4, 8, 6, 1)
  ctx.fillRect(4, 10, 8, 1)
  
  const iconBuffer = canvas.toBuffer('image/png')
  const icon = nativeImage.createFromBuffer(iconBuffer)
  
  tray = new Tray(icon)
  
  // 设置托盘菜单
  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Open N-Clip',
      click: () => {
        toggleWindow()
      }
    },
    {
      label: `Clipboard Items: ${clipboardHistory.length}`,
      enabled: false
    },
    { type: 'separator' },
    {
      label: 'Recent Items',
      submenu: clipboardHistory.slice(0, 5).map((item, index) => ({
        label: `${index + 1}. ${item.preview || item.content}`.substring(0, 50),
        click: () => {
          clipboard.writeText(item.content)
        }
      }))
    },
    { type: 'separator' },
    {
      label: 'Preferences...',
      enabled: false // 暂时禁用
    },
    {
      label: 'Quit N-Clip',
      click: () => {
        console.log('Quit clicked from tray, completely exiting app')
        // 停止剪切板监听
        // 清理所有快捷键
        unregisterNavigationShortcuts()
        globalShortcut.unregisterAll()
        // 销毁托盘
        if (tray) {
          tray.destroy()
          tray = null
        }
        // 设置退出标志并强制退出应用
        (app as any).isQuitting = true
        app.exit(0)
      }
    }
  ])
  
  tray.setContextMenu(contextMenu)
  tray.setToolTip('N-Clip - Clipboard Manager')
  
  // 点击托盘图标切换窗口
  tray.on('click', () => {
    toggleWindow()
  })
  
  console.log('System tray created successfully')
}

// 更新托盘菜单
function updateTrayMenu() {
  if (!tray) return
  
  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Open N-Clip',
      click: () => {
        toggleWindow()
      }
    },
    {
      label: `Clipboard Items: ${clipboardHistory.length}`,
      enabled: false
    },
    { type: 'separator' },
    {
      label: 'Recent Items',
      submenu: clipboardHistory.slice(0, 5).map((item, index) => ({
        label: `${index + 1}. ${(item.preview || item.content).substring(0, 40)}${(item.preview || item.content).length > 40 ? '...' : ''}`,
        click: () => {
          clipboard.writeText(item.content)
          console.log('Copied to clipboard:', item.preview)
        }
      }))
    },
    { type: 'separator' },
    {
      label: 'Test Paste (Hello World)',
      click: async () => {
        console.log('Testing paste functionality...')
        clipboard.writeText('Hello World from N-Clip!')
        
        // 先测试一个简单的通知
        const { spawn } = require('child_process')
        const notificationScript = `display notification "About to paste..." with title "N-Clip"`
        
        const notifProcess = spawn('osascript', ['-e', notificationScript])
        notifProcess.on('close', () => {
          console.log('Notification sent')
        })
        
        const appleScript = `
          tell application "System Events"
            keystroke "v" using {command down}
          end tell
        `
        
        const process = spawn('osascript', ['-e', appleScript.trim()])
        process.on('close', (code: any) => {
          console.log('Test paste finished with code:', code)
          
          // 发送完成通知
          const doneScript = `display notification "Paste attempt completed" with title "N-Clip"`
          spawn('osascript', ['-e', doneScript])
        })
      }
    },
    {
      label: 'Clear History',
      click: () => {
        clipboardHistory = []
        updateTrayMenu()
        if (win) {
          win?.webContents.send('clipboard:history-updated', clipboardHistory)
        }
      }
    },
    {
      label: 'Preferences...',
      enabled: false // 暂时禁用
    },
    { type: 'separator' },
    {
      label: 'Quit N-Clip',
      click: () => {
        console.log('Quit clicked from tray, completely exiting app')
        // 停止剪切板监听
        // 清理所有快捷键
        unregisterNavigationShortcuts()
        globalShortcut.unregisterAll()
        // 销毁托盘
        if (tray) {
          tray.destroy()
          tray = null
        }
        // 设置退出标志并强制退出应用
        (app as any).isQuitting = true
        app.exit(0)
      }
    }
  ])
  
  tray.setContextMenu(contextMenu)
}

// 简单的失焦自动隐藏
function setupAutoHide() {
  if (!win) return
  
  const onBlur = () => {
    if (win && win.isVisible() && !operationInProgress) {
      console.log('Window lost focus, auto-hiding...')
      atomicHide()
    }
  }
  
  // 只添加一次性的blur监听器
  win.once('blur', onBlur)
}

// 原子性显示窗口
function atomicShow() {
  if (!win || !windowReady || operationInProgress) {
    console.log(`Cannot show window: win=${!!win}, ready=${windowReady}, inProgress=${operationInProgress}`)
    return
  }
  
  operationInProgress = true
  console.log('=== ATOMIC SHOW ===')
  
  // 使用固定位置，避免重复计算
  if (windowPosition) {
    console.log(`Using fixed position: ${windowPosition.x}, ${windowPosition.y}`)
    win.setBounds({ ...windowPosition, width: 800, height: 600 })
  }
  
  // 确保窗口正确显示和设置alwaysOnTop
  win.show()
  
  // 延迟一点时间确保显示完成再设置alwaysOnTop
  process.nextTick(() => {
    if (win && !win.isDestroyed()) {
      win.focus()
      win.setAlwaysOnTop(true, 'floating')
      console.log('AlwaysOnTop re-enabled after show')
    }
  })
  registerNavigationShortcuts()
  
  console.log('Window bounds after show:', win.getBounds())
  console.log('Window visible:', win.isVisible())
  
  // 设置自动隐藏 - 使用双重nextTick确保所有操作完成
  process.nextTick(() => {
    process.nextTick(() => {
      if (win && !win.isDestroyed()) {
        console.log('Window focused:', win.isFocused())
        console.log('Window always on top:', win.isAlwaysOnTop())
        setupAutoHide()
        operationInProgress = false
        console.log('Show operation completed')
      }
    })
  })
}

// 原子性隐藏窗口 - 增强版，解决macOS alwaysOnTop问题
function atomicHide() {
  if (!win || operationInProgress) {
    console.log('Cannot hide: win exists =', !!win, 'operation in progress =', operationInProgress)
    return
  }
  
  operationInProgress = true
  console.log('=== ATOMIC HIDE ===')
  console.log('Window visible before hide:', win.isVisible())
  console.log('Window always on top:', win.isAlwaysOnTop())
  
  // 注销导航快捷键
  unregisterNavigationShortcuts()
  
  // macOS上的alwaysOnTop窗口隐藏修复
  try {
    // 1. 先禁用alwaysOnTop（macOS关键步骤）
    if (win.isAlwaysOnTop()) {
      console.log('Disabling alwaysOnTop before hide...')
      win.setAlwaysOnTop(false)
    }
    
    // 2. 执行隐藏
    win.hide()
    
    // 3. 验证隐藏结果
    process.nextTick(() => {
      const isStillVisible = win && !win.isDestroyed() && win.isVisible()
      console.log('Window visible after hide:', isStillVisible)
      
      if (isStillVisible) {
        console.log('Hide failed, trying alternative methods...')
        // 备用方法1: 最小化 + 隐藏
        try {
          if (win && win.isMinimizable()) {
            win.minimize()
          }
          win?.hide()
        } catch (error) {
          console.error('Alternative hide method failed:', error)
        }
        
        // 备用方法2: 移到屏幕外
        try {
          const { screen } = require('electron')
          const displays = screen.getAllDisplays()
          if (displays.length > 0) {
            const display = displays[0]
            win?.setBounds({
              x: -10000,
              y: -10000,
              width: 800,
              height: 600
            })
            console.log('Moved window off-screen as fallback')
          }
        } catch (error) {
          console.error('Off-screen fallback failed:', error)
        }
      }
      
      operationInProgress = false
      console.log('Hide operation completed, final state:', win?.isVisible())
    })
    
  } catch (error) {
    console.error('Error during hide operation:', error)
    operationInProgress = false
  }
}

// 切换窗口显示/隐藏 - 彻底修复版本
function toggleWindow() {
  console.log('=== TOGGLE WINDOW ===')
  console.log('Window exists:', !!win)
  console.log('Window destroyed:', win ? win.isDestroyed() : 'N/A')
  console.log('Window visible:', win?.isVisible())
  console.log('Window ready:', windowReady)
  console.log('Operation in progress:', operationInProgress)
  
  // 如果窗口不存在或已销毁，重新创建
  if (!win || win.isDestroyed()) {
    console.log('Window missing or destroyed, recreating...')
    operationInProgress = true
    createWindow()
      .then(() => {
        console.log('Window recreated successfully, showing...')
        atomicShow()
      })
      .catch(error => {
        console.error('Failed to recreate window:', error)
        operationInProgress = false
      })
    return
  }
  
  // 如果窗口存在但未准备好，等待准备完成
  if (!windowReady) {
    console.log('Window not ready, waiting...')
    const checkReady = () => {
      if (windowReady) {
        atomicShow()
      } else {
        // 使用process.nextTick避免setTimeout
        process.nextTick(checkReady)
      }
    }
    checkReady()
    return
  }
  
  // 如果操作正在进行中，但窗口可见，强制隐藏（用户期望的toggle行为）
  if (operationInProgress && win.isVisible()) {
    console.log('Force hiding window during operation')
    operationInProgress = false  // 重置状态
    atomicHide()
    return
  }
  
  // 如果操作正在进行中且窗口不可见，跳过（避免冲突）
  if (operationInProgress) {
    console.log('Skipping toggle - operation in progress')
    return
  }
  
  // 正常的toggle逻辑
  if (win.isVisible()) {
    atomicHide()
  } else {
    atomicShow()
  }
}

// 注册全局快捷键
function registerGlobalShortcuts() {
  const shortcutRegistered = globalShortcut.register('CommandOrControl+Shift+V', toggleWindow)
  
  if (!shortcutRegistered) {
    console.log('Failed to register global shortcut Cmd+Shift+V')
  } else {
    console.log('Global shortcut Cmd+Shift+V registered successfully')
  }
}

// 注册导航快捷键 - 只在窗口显示时启用
function registerNavigationShortcuts() {
  if (navigationShortcutsRegistered) return
  
  globalShortcut.register('Up', () => {
    if (win && win.isVisible()) {
      win.webContents.send('navigate-items', 'up')
    }
  })

  globalShortcut.register('Down', () => {
    if (win && win.isVisible()) {
      win.webContents.send('navigate-items', 'down')
    }
  })

  globalShortcut.register('Return', () => {
    if (win && win.isVisible()) {
      win.webContents.send('select-current-item')
    }
  })

  globalShortcut.register('Tab', () => {
    if (win && win.isVisible()) {
      win.webContents.send('navigate-items', 'down')
    }
  })

  globalShortcut.register('Escape', () => {
    if (win && win.isVisible()) {
      atomicHide()
    }
  })

  navigationShortcutsRegistered = true
  console.log('Navigation shortcuts registered')
}

// 注销导航快捷键
function unregisterNavigationShortcuts() {
  if (!navigationShortcutsRegistered) return
  
  globalShortcut.unregister('Up')
  globalShortcut.unregister('Down') 
  globalShortcut.unregister('Return')
  globalShortcut.unregister('Tab')
  globalShortcut.unregister('Escape')
  
  navigationShortcutsRegistered = false
  console.log('Navigation shortcuts unregistered')
}

// 打开档案库窗口
async function openArchiveWindow() {
  console.log('=== DEBUG: openArchiveWindow() START ===')
  
  // 如果窗口已存在，聚焦到该窗口
  if (archiveWindow) {
    console.log('DEBUG: Archive window already exists, focusing...')
    archiveWindow.focus()
    console.log('DEBUG: Archive window focused, bounds:', archiveWindow.getBounds())
    return
  }

  console.log('DEBUG: No existing archive window, creating new one...')

  try {
    archiveWindow = new BrowserWindow({
      title: 'N-Clip 档案库',
      width: 1000,
      height: 700,
      minWidth: 800,
      minHeight: 600,
      frame: true,
      transparent: false,
      resizable: true,
      alwaysOnTop: false,
      skipTaskbar: false,
      show: false,
      icon: path.join(process.env.VITE_PUBLIC, 'favicon.ico'),
      webPreferences: {
        preload,
        nodeIntegration: false,
        contextIsolation: true,
      },
      autoHideMenuBar: true,
    })
    
    console.log('DEBUG: BrowserWindow created successfully, ID:', archiveWindow.id)
    
    // 加载档案库页面
    console.log('DEBUG: Loading archive page...')
    if (VITE_DEV_SERVER_URL) {
      const url = VITE_DEV_SERVER_URL + '#archive'
      console.log('DEBUG: Loading URL:', url)
      await archiveWindow.loadURL(url)
    } else {
      console.log('DEBUG: Loading file with hash: archive')
      await archiveWindow.loadFile(indexHtml, { hash: 'archive' })
    }
    
    console.log('DEBUG: Archive page loaded successfully')
    
    // 显示窗口
    console.log('DEBUG: Showing archive window')
    archiveWindow.show()
    console.log('DEBUG: Archive window show() called, isVisible:', archiveWindow?.isVisible())
    
    // 监听窗口关闭事件
    archiveWindow.on('closed', () => {
      console.log('Archive window closed')
      archiveWindow = null
    })
    
  } catch (error) {
    console.error('DEBUG: Error creating or loading archive window:', error)
    if (archiveWindow) {
      archiveWindow.destroy()
      archiveWindow = null
    }
    throw error
  }
  
  console.log('=== DEBUG: openArchiveWindow() END ===')
}


// Register IPC handlers
function registerIpcHandlers() {
  // Clipboard handlers
  ipcMain.handle('clipboard:get-history', async () => {
    return clipboardHistory
  })

  // 设置剪切板内容
  ipcMain.handle('clipboard:set-content', async (event, content: string) => {
    clipboard.writeText(content)
    return true
  })

  // 粘贴选中的项目到当前应用
  ipcMain.handle('clipboard:paste-selected-item', async (event, item: ClipboardItem) => {
    try {
      console.log('=== PASTE DIAGNOSIS START ===')
      console.log('Pasting item:', item.type, item.content)
      
      // 根据类型设置剪切板内容
      if (item.type === 'image' && item.preview) {
        // 处理图片类型
        const base64Data = item.preview.replace(/^data:image\/[a-z]+;base64,/, '')
        const imageBuffer = Buffer.from(base64Data, 'base64')
        const image = nativeImage.createFromBuffer(imageBuffer)
        clipboard.writeImage(image)
        console.log('1. Clipboard image content set')
      } else {
        // 处理文本类型
        clipboard.writeText(item.content)
        console.log('1. Clipboard text content set')
      }
      
      const { spawn } = require('child_process')
      
      return new Promise((resolve) => {
        // 获取当前前台应用，隐藏N-Clip，激活目标应用，粘贴
        const script = `
          set targetApp to ""
          tell application "System Events"
            set allProcesses to (every application process whose frontmost is true)
            repeat with proc in allProcesses
              set appName to name of proc
              if appName is not "Electron" then
                set targetApp to appName
                exit repeat
              end if
            end repeat
          end tell
          
          if targetApp is "" then
            tell application "System Events"
              set targetApp to name of (first application process whose frontmost is false)
            end tell
          end if
          
          log "Activating: " & targetApp
          tell application targetApp
            activate
          end tell
          
          tell application "System Events"
            keystroke "v" using command down
          end tell
        `
        
        atomicHide()
        
        const process = spawn('osascript', ['-e', script])
        
        let output = ''
        let error = ''
        
        process.stdout.on('data', (data: any) => {
          output += data.toString()
        })
        
        process.stderr.on('data', (data: any) => {
          error += data.toString()
        })
        
        process.on('close', (code: any) => {
          console.log('3. AppleScript output:', output.trim())
          console.log('4. AppleScript error:', error.trim())
          console.log('5. Exit code:', code)
          console.log('=== PASTE DIAGNOSIS END ===')
          
          resolve({ 
            success: code === 0, 
            method: 'enhanced-paste',
            output: output.trim(),
            error: error.trim()
          })
        })
      })
      
    } catch (error) {
      console.error('Failed to paste item:', error)
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  })

  // 主动刷新剪切板历史
  ipcMain.handle('clipboard:refresh-history', async () => {
    if (win) {
      win?.webContents.send('clipboard:history-updated', clipboardHistory)
    }
    return clipboardHistory
  })

  // 启动拖拽功能
  ipcMain.handle('clipboard:start-drag', async (event, item: ClipboardItem) => {
    try {
      console.log('Starting drag for item:', item.type, item.id)
      
      if (item.type === 'image' && item.preview) {
        // 创建临时文件用于拖拽图片
        const tempDir = path.join(os.tmpdir(), 'n-clip-drag')
        if (!fs.existsSync(tempDir)) {
          fs.mkdirSync(tempDir, { recursive: true })
        }
        
        // 解码Base64图片数据
        const base64Data = item.preview.replace(/^data:image\/[a-z]+;base64,/, '')
        const imageBuffer = Buffer.from(base64Data, 'base64')
        
        // 生成临时文件路径
        const tempFileName = `clipboard-image-${Date.now()}.png`
        const tempFilePath = path.join(tempDir, tempFileName)
        
        // 写入临时文件
        fs.writeFileSync(tempFilePath, imageBuffer)
        
        console.log('Temp file created for drag:', tempFilePath)
        
        // 启动拖拽
        if (event.sender && event.sender.startDrag) {
          event.sender.startDrag({
            file: tempFilePath,
            icon: nativeImage.createFromBuffer(imageBuffer).resize({ width: 64, height: 64 })
          })
          console.log('Drag started successfully')
          return { success: true, tempFile: tempFilePath }
        } else {
          console.error('startDrag not available on sender')
          return { success: false, error: 'startDrag not available' }
        }
      } else if (item.type === 'text') {
        // 对于文本，创建临时文本文件
        const tempDir = path.join(os.tmpdir(), 'n-clip-drag')
        if (!fs.existsSync(tempDir)) {
          fs.mkdirSync(tempDir, { recursive: true })
        }
        
        const tempFileName = `clipboard-text-${Date.now()}.txt`
        const tempFilePath = path.join(tempDir, tempFileName)
        
        fs.writeFileSync(tempFilePath, item.content, 'utf8')
        
        console.log('Temp text file created for drag:', tempFilePath)
        
        if (event.sender && event.sender.startDrag) {
          event.sender.startDrag({
            file: tempFilePath,
            icon: nativeImage.createFromPath(path.join(process.env.VITE_PUBLIC || '', 'favicon.ico'))
          })
          console.log('Text drag started successfully')
          return { success: true, tempFile: tempFilePath }
        } else {
          console.error('startDrag not available on sender')
          return { success: false, error: 'startDrag not available' }
        }
      }
      
      return { success: false, error: 'Unsupported item type for drag' }
    } catch (error) {
      console.error('Failed to start drag:', error)
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  })

  // 打开档案库窗口
  ipcMain.handle('archive:open', async () => {
    console.log('=== DEBUG: IPC archive:open received ===')
    
    try {
      // 立即隐藏剪切板窗口
      if (win && win.isVisible()) {
        console.log('DEBUG: Hiding clipboard window before opening archive')
        atomicHide()
      }
      
      console.log('DEBUG: Calling openArchiveWindow()...')
      await openArchiveWindow()
      console.log('DEBUG: openArchiveWindow() completed successfully')
      
      return { success: true }
    } catch (error) {
      console.error('DEBUG: Exception in archive:open handler:', error)
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  })

  // Star相关功能 - 操作独立的档案库
  ipcMain.handle('clipboard:star-item', async (event, itemId: string, category?: string) => {
    try {
      // 在剪切板历史中查找原项目
      const originalItem = clipboardHistory.find(item => item.id === itemId)
      if (!originalItem) {
        return { success: false, error: 'Original item not found' }
      }
      
      // 检查是否已经在档案库中
      const existingArchiveItem = archiveItems.find(item => item.originalId === itemId)
      if (existingArchiveItem) {
        return { success: false, error: 'Item already starred' }
      }
      
      // 创建档案库项目（拷贝）
      const archiveItem: ArchiveItem = {
        id: `archive_${Date.now()}`, // 独立的档案库ID
        originalId: originalItem.id,
        type: originalItem.type,
        content: originalItem.content,
        preview: originalItem.preview,
        timestamp: originalItem.timestamp,
        size: originalItem.size,
        starredAt: Date.now(),
        category: category || 'mixed-favorites'
      }
      
      archiveItems.unshift(archiveItem)
      
      // 保存到数据库
      await saveArchiveItem(archiveItem)
      
      console.log(`Item starred: ${originalItem.content} -> Archive ID: ${archiveItem.id}`)
      return { success: true }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  })

  ipcMain.handle('clipboard:unstar-item', async (event, itemId: string) => {
    try {
      // 在档案库中查找并删除（通过originalId匹配）
      const archiveIndex = archiveItems.findIndex(item => item.originalId === itemId)
      if (archiveIndex !== -1) {
        const removedItem = archiveItems.splice(archiveIndex, 1)[0]
        
        // 从数据库删除
        await deleteArchiveItem(removedItem.id)
        
        console.log(`Item unstarred: ${removedItem.content}`)
        return { success: true }
      }
      return { success: false, error: 'Item not found in archive' }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  })

  ipcMain.handle('clipboard:get-starred-items', async (event, category?: string) => {
    try {
      let filteredItems = archiveItems
      
      if (category && category !== 'all') {
        filteredItems = archiveItems.filter(item => item.category === category)
      }
      
      return { success: true, items: filteredItems }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  })

  // 检查项目是否已收藏
  ipcMain.handle('clipboard:is-item-starred', async (event, itemId: string) => {
    try {
      const isStarred = archiveItems.some(item => item.originalId === itemId)
      return { success: true, isStarred }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  })

  // 获取分类列表
  ipcMain.handle('clipboard:get-categories', async () => {
    try {
      // 获取所有唯一的分类
      const categories = new Set<string>()
      archiveItems.forEach(item => {
        if (item.category) {
          categories.add(item.category)
        }
      })
      
      // 转换为分类对象数组
      const categoryList = Array.from(categories).map(categoryName => ({
        id: categoryName,
        name: categoryName,
        type: 'mixed' as const,
        itemCount: archiveItems.filter(item => item.category === categoryName).length,
        createdAt: Date.now(),
        updatedAt: Date.now()
      }))
      
      // 添加默认分类
      if (!categoryList.some(cat => cat.id === 'mixed-favorites')) {
        categoryList.unshift({
          id: 'mixed-favorites',
          name: '收藏夹',
          type: 'mixed' as const,
          itemCount: archiveItems.filter(item => item.category === 'mixed-favorites').length,
          createdAt: Date.now(),
          updatedAt: Date.now()
        })
      }
      
      return { success: true, categories: categoryList }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  })

  // 创建新分类
  ipcMain.handle('clipboard:create-category', async (event, name: string, type: 'text' | 'image' | 'file' | 'mixed') => {
    try {
      // 简单实现：分类名即为ID
      return { success: true, category: { id: name, name, type, itemCount: 0, createdAt: Date.now(), updatedAt: Date.now() } }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  })

  // 更新项目分类
  ipcMain.handle('clipboard:update-item-category', async (event, itemId: string, categoryId: string) => {
    try {
      const itemIndex = archiveItems.findIndex(item => item.id === itemId)
      if (itemIndex !== -1) {
        archiveItems[itemIndex].category = categoryId
        return { success: true }
      }
      return { success: false, error: 'Item not found' }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  })

  // 更新项目标签
  ipcMain.handle('clipboard:update-item-tags', async (event, itemId: string, tags: string[]) => {
    try {
      const itemIndex = archiveItems.findIndex(item => item.id === itemId)
      if (itemIndex !== -1) {
        archiveItems[itemIndex].tags = tags
        return { success: true }
      }
      return { success: false, error: 'Item not found' }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  })

  // 更新项目描述
  ipcMain.handle('clipboard:update-item-description', async (event, itemId: string, description: string) => {
    try {
      const itemIndex = archiveItems.findIndex(item => item.id === itemId)
      if (itemIndex !== -1) {
        archiveItems[itemIndex].description = description
        return { success: true }
      }
      return { success: false, error: 'Item not found' }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  })

  // 删除档案库项目
  ipcMain.handle('clipboard:delete-item', async (event, itemId: string) => {
    try {
      // 先尝试从档案库删除
      const archiveIndex = archiveItems.findIndex(item => item.id === itemId)
      if (archiveIndex !== -1) {
        archiveItems.splice(archiveIndex, 1)
        await deleteArchiveItem(itemId)
        return { success: true }
      }
      
      // 如果不在档案库，则从剪切板历史删除
      const clipboardIndex = clipboardHistory.findIndex(item => item.id === itemId)
      if (clipboardIndex !== -1) {
        clipboardHistory.splice(clipboardIndex, 1)
        await deleteClipboardItem(itemId)
        
        // 通知渲染进程更新
        if (win) {
          win?.webContents.send('clipboard:history-updated', clipboardHistory)
        }
        updateTrayMenu()
        
        return { success: true }
      }
      
      return { success: false, error: 'Item not found' }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  })

  // 创建临时文件用于拖拽
  ipcMain.handle('clipboard:create-temp-file', async (event, item: ClipboardItem) => {
    try {
      if (item.type !== 'image' || !item.preview) {
        return { success: false, error: 'Only image items can be dragged' }
      }

      const fs = require('fs')
      const path = require('path')
      const os = require('os')

      // 创建临时目录
      const tempDir = path.join(os.tmpdir(), 'n-clip-drag')
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true })
      }

      // 生成临时文件名
      const timestamp = Date.now()
      const tempFilePath = path.join(tempDir, `image_${timestamp}.png`)

      // 将Base64数据转换为文件
      const base64Data = item.preview.replace(/^data:image\/[a-z]+;base64,/, '')
      const buffer = Buffer.from(base64Data, 'base64')
      
      fs.writeFileSync(tempFilePath, buffer)
      
      console.log('Created temp file for drag:', tempFilePath)
      return { success: true, filePath: tempFilePath }
    } catch (error) {
      console.error('Failed to create temp file:', error)
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  })


  // Accessibility handlers  
  ipcMain.handle('accessibility:check-permission', async () => {
    return true
  })

  // Window handlers
  ipcMain.handle('window:get-bounds', async () => {
    return win ? win.getBounds() : { x: 100, y: 100, width: 800, height: 600 }
  })

  ipcMain.handle('window:set-bounds', async (event, bounds) => {
    if (win) {
      win.setBounds(bounds)
    }
  })
}

app.whenReady().then(async () => {
  // 设置应用为辅助应用，不在Dock中显示
  app.dock?.hide()
  
  try {
    // 初始化数据存储
    await initDataStorage()
    
    // 加载历史数据
    await loadClipboardHistory()
    await loadArchiveItems()
    
    console.log('Data storage initialization completed')
  } catch (error) {
    console.error('Failed to initialize data storage:', error)
  }
  
  registerIpcHandlers()
  registerGlobalShortcuts()
  createWindow()
  createTray() // 创建系统托盘
  startClipboardWatcher() // 启动剪切板监听
  
  // 监听命令行退出信号
  process.on('SIGINT', () => {
    console.log('Received SIGINT (Ctrl+C), exiting...')
    ;(app as any).isQuitting = true
    unregisterNavigationShortcuts()
    globalShortcut.unregisterAll()
    if (tray) {
      tray.destroy()
      tray = null
    }
    app.exit(0)
  })
  
  process.on('SIGTERM', () => {
    console.log('Received SIGTERM, exiting...')
    ;(app as any).isQuitting = true
    unregisterNavigationShortcuts()
    globalShortcut.unregisterAll()
    if (tray) {
      tray.destroy()
      tray = null
    }
    app.exit(0)
  })
})

app.on('window-all-closed', () => {
  win = null
  // 不退出应用，只是隐藏窗口，应用继续在托盘中运行
  console.log('All windows closed, but app continues running in tray')
})

app.on('will-quit', () => {
  // 清理导航快捷键
  unregisterNavigationShortcuts()
  // 清理所有全局快捷键
  globalShortcut.unregisterAll()
  // 销毁托盘
  if (tray) {
    tray.destroy()
    tray = null
  }
  // 保存数据到文件
  try {
    saveClipboardHistory()
    saveArchiveItems()
    console.log('Data saved on exit')
  } catch (error) {
    console.error('Error saving data on exit:', error)
  }
})

app.on('second-instance', () => {
  if (win) {
    if (win.isMinimized()) win.restore()
    win.focus()
  }
})

app.on('activate', () => {
  // 不在Dock中，所以不需要处理activate事件
  // 只通过托盘和快捷键来控制窗口显示
  console.log('App activated, but ignoring since we only use tray')
})