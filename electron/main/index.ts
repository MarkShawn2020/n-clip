import { app, BrowserWindow, shell, ipcMain, clipboard, globalShortcut, Tray, Menu, nativeImage, systemPreferences } from 'electron'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'
import sqlite3 from 'sqlite3'
import { update } from './update'
import { 
  checkAccessibilityPermission, 
  requestAccessibilityPermission, 
  getFocusedElement, 
  insertTextToFocusedElement, 
  getFocusedAppInfo,
  simulatePasteKeystroke,
  handleMouseEventWithoutFocus,
  getElementAtPosition,
  performElementAction
} from '../native/accessibility-wrapper'

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
let settingsWindow: BrowserWindow | null = null
let archiveWindow: BrowserWindow | null = null
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
  
  // Star机制字段
  isStarred?: boolean        // 是否被收藏到档案库
  starredAt?: number         // 收藏时间戳
  category?: string          // 用户自定义分类
  tags?: string[]            // 标签系统
  description?: string       // 用户备注
}

// 档案库分类结构
interface ArchiveCategory {
  id: string
  name: string
  type: 'text' | 'image' | 'file' | 'mixed'
  itemCount: number
  createdAt: number
  updatedAt: number
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

// 全局事件监听器
let globalEventListener: any = null
let activeShortcuts: string[] = []

// 全局鼠标点击监听 - 检测用户点击我们窗口外的任何地方
let globalMouseListener: any = null

function startGlobalMouseListener() {
  if (globalMouseListener) return
  
  try {
    // 使用原生模块监听全局鼠标事件
    const { startGlobalMouseListener } = require('../../electron/native/build/Release/accessibility.node')
    
    startGlobalMouseListener((x: number, y: number) => {
      // 如果正在创建窗口，忽略鼠标点击事件
      if (isCreatingWindow) {
        console.log(`Mouse click at ${x},${y} ignored - creating window`)
        return
      }
      
      if (win && win.isVisible()) {
        const bounds = win.getBounds()
        
        // 检查点击是否在窗口外
        const isOutside = x < bounds.x || 
                         x > bounds.x + bounds.width ||
                         y < bounds.y || 
                         y > bounds.y + bounds.height
        
        if (isOutside) {
          console.log(`Mouse click outside window at ${x},${y}, hiding`)
          hideWindowIntelligently()
        }
      }
    })
    
    globalMouseListener = true // 标记为已启动
  } catch (error) {
    console.warn('Global mouse listener not available:', error)
  }
}

function stopGlobalMouseListener() {
  if (globalMouseListener) {
    try {
      const { stopGlobalMouseListener } = require('../../electron/native/build/Release/accessibility.node')
      stopGlobalMouseListener()
      globalMouseListener = null
    } catch (error) {
      console.warn('Error stopping global mouse listener:', error)
    }
  }
}

// 添加标志来暂时禁用自动隐藏
let isCreatingWindow = false

// 安全设置创建窗口标志
function setCreatingWindow(creating: boolean) {
  isCreatingWindow = creating
  
  if (creating) {
    console.log('DEBUG: Setting isCreatingWindow = true')
  } else {
    console.log('DEBUG: Setting isCreatingWindow = false')
  }
}

// 应用切换检测 - 使用原生app事件
app.on('browser-window-focus', (event, window) => {
  console.log('DEBUG: browser-window-focus event', {
    windowTitle: window?.getTitle() || 'unknown',
    isOurWindow: window === win || window === settingsWindow || window === archiveWindow || window === shareCardWindow,
    isCreatingWindow,
    archiveWindowExists: !!archiveWindow
  })
  
  // 如果正在创建窗口，暂时忽略焦点事件
  if (isCreatingWindow) {
    console.log('Currently creating window, ignoring focus event')
    return
  }
  
  // 忽略我们自己的窗口获得焦点的情况
  if (window === win || window === settingsWindow || window === archiveWindow || window === shareCardWindow) {
    console.log('Our own window gained focus, ignoring auto-hide')
    return
  }
  
  // 当其他应用或窗口获得焦点时，隐藏我们的主窗口
  if (win && win.isVisible()) {
    console.log('Other app gained focus, hiding clipboard window')
    hideWindowIntelligently()
  }
})

// 启动全局键盘事件监听 (完整实现)
function startGlobalKeyboardListener() {
  console.log('Starting global keyboard listener')
  
  // 清除之前的监听器
  stopGlobalKeyboardListener()
  
  // 只在窗口可见时注册导航快捷键
  if (!win || !win.isVisible()) {
    console.log('Window not visible, skipping keyboard listener registration')
    return
  }
  
  // 注册导航快捷键
  const shortcuts = [
    { key: 'Up', handler: () => navigateItems('up') },
    { key: 'Down', handler: () => navigateItems('down') },
    { key: 'Return', handler: () => selectCurrentItem() },
    { key: 'Escape', handler: () => hideWindow() },
    { key: 'Delete', handler: () => deleteCurrentItem() },
    { key: 's', handler: () => toggleStar() },    // S键：Star/Unstar
    { key: 'a', handler: () => openArchive() }    // A键：打开档案库
  ]
  
  shortcuts.forEach(({ key, handler }) => {
    try {
      const success = globalShortcut.register(key, handler)
      if (success) {
        activeShortcuts.push(key)
        console.log(`Registered global shortcut: ${key}`)
      } else {
        console.warn(`Failed to register global shortcut: ${key}`)
      }
    } catch (error) {
      console.error(`Error registering shortcut ${key}:`, error)
    }
  })
}

// 停止全局键盘事件监听 (完整实现)
function stopGlobalKeyboardListener() {
  console.log('Stopping global keyboard listener')
  
  // 取消注册导航快捷键
  activeShortcuts.forEach(key => {
    try {
      globalShortcut.unregister(key)
      console.log(`Unregistered global shortcut: ${key}`)
    } catch (error) {
      console.error(`Error unregistering shortcut ${key}:`, error)
    }
  })
  
  activeShortcuts = []
}

// 隐藏窗口
function hideWindow() {
  if (win && win.isVisible()) {
    win.hide()
    stopGlobalKeyboardListener()
    stopGlobalMouseListener()
  }
}

// 导航项目函数
function navigateItems(direction: 'up' | 'down') {
  if (win && win.isVisible()) {
    win.webContents.send('navigate-items', direction)
  }
}

// 选择当前项目
function selectCurrentItem() {
  if (win && win.isVisible()) {
    win.webContents.send('select-current-item')
  }
}

// 切换预览
function togglePreview() {
  if (win && win.isVisible()) {
    win.webContents.send('toggle-preview')
  }
}

// 删除当前项目
function deleteCurrentItem() {
  if (win && win.isVisible()) {
    win.webContents.send('delete-current-item')
  }
}

// 切换Star状态
function toggleStar() {
  if (win && win.isVisible()) {
    win.webContents.send('toggle-star')
  }
}

// 打开档案库
function openArchive() {
  if (win && win.isVisible()) {
    win.webContents.send('open-archive')
  }
}

// 辅助函数：插入项目到历史记录（简化版）
function insertItemIntoHistory(newItem: ClipboardItem) {
  // 直接插入到开头，按时间排序
  clipboardHistory.unshift(newItem)
}

// 辅助函数：移动现有项目到前面（简化版）
function moveItemToFront(item: ClipboardItem) {
  const currentIndex = clipboardHistory.indexOf(item)
  if (currentIndex > 0) {
    // 移除当前位置的项目
    clipboardHistory.splice(currentIndex, 1)
    // 移到最前面
    clipboardHistory.unshift(item)
  }
}

// 辅助函数：智能限制历史记录数量，保护置顶项目
function limitHistorySize(maxSize: number = 100) {
  if (clipboardHistory.length <= maxSize) return
  
  // 分离置顶和非置顶项目
  const pinnedItems = clipboardHistory.filter(item => item.isPinned)
  const unpinnedItems = clipboardHistory.filter(item => !item.isPinned)
  
  // 计算可以保留的非置顶项目数量
  const maxUnpinnedItems = Math.max(0, maxSize - pinnedItems.length)
  
  // 保留最新的非置顶项目
  const limitedUnpinnedItems = unpinnedItems.slice(0, maxUnpinnedItems)
  
  // 重新组合：置顶项目在前，非置顶项目在后
  clipboardHistory = [...pinnedItems, ...limitedUnpinnedItems]
  
  console.log(`Limited history: ${pinnedItems.length} pinned + ${limitedUnpinnedItems.length} unpinned = ${clipboardHistory.length} total`)
}

// 辅助函数：验证并确保数组排序正确
function ensureCorrectSorting(context: string = '') {
  let needsReSort = false
  
  // 检查是否有未置顶项目出现在置顶项目之前
  let foundUnpinned = false
  for (let i = 0; i < clipboardHistory.length; i++) {
    const item = clipboardHistory[i]
    if (!item.isPinned) {
      foundUnpinned = true
    } else if (foundUnpinned) {
      // 发现置顶项目出现在非置顶项目之后，需要重新排序
      needsReSort = true
      break
    }
  }
  
  if (needsReSort) {
    console.warn(`[${context}] Sorting violation detected, re-sorting clipboard history`)
    clipboardHistory.sort((a, b) => {
      if (a.isPinned && !b.isPinned) return -1
      if (!a.isPinned && b.isPinned) return 1
      return b.timestamp - a.timestamp
    })
  }
}

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
      
      // 创建剪切板项目表
      db!.run(`
        CREATE TABLE IF NOT EXISTS clipboard_items (
          id TEXT PRIMARY KEY,
          type TEXT NOT NULL,
          content TEXT NOT NULL,
          preview TEXT,
          timestamp INTEGER NOT NULL,
          size TEXT,
          expiry_time INTEGER,
          is_starred INTEGER DEFAULT 0,
          starred_at INTEGER,
          category TEXT DEFAULT 'default',
          tags TEXT,
          description TEXT
        )
      `, (err) => {
        if (err) {
          console.error('Failed to create clipboard_items table:', err)
          reject(err)
          return
        }
        
        console.log('clipboard_items table created successfully')
        
        // 创建档案库分类表
        db!.run(`
          CREATE TABLE IF NOT EXISTS archive_categories (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            type TEXT NOT NULL,
            item_count INTEGER DEFAULT 0,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
          )
        `, (categoryErr) => {
          if (categoryErr) {
            console.error('Failed to create archive_categories table:', categoryErr)
            reject(categoryErr)
            return
          }
          
          console.log('archive_categories table created successfully')
          
          // 数据库迁移：添加新字段
          const migrations = [
            'ALTER TABLE clipboard_items ADD COLUMN is_starred INTEGER DEFAULT 0', 
            'ALTER TABLE clipboard_items ADD COLUMN starred_at INTEGER',
            'ALTER TABLE clipboard_items ADD COLUMN category TEXT DEFAULT "default"',
            'ALTER TABLE clipboard_items ADD COLUMN tags TEXT',
            'ALTER TABLE clipboard_items ADD COLUMN description TEXT'
          ]
          
          let migrationsCompleted = 0
          const totalMigrations = migrations.length
          
          migrations.forEach((migration, index) => {
            db!.run(migration, (migrationErr) => {
              if (migrationErr && !migrationErr.message.includes('duplicate column name')) {
                console.error(`Migration ${index + 1} failed:`, migrationErr)
              } else {
                console.log(`Migration ${index + 1} completed`)
              }
              
              migrationsCompleted++
              if (migrationsCompleted === totalMigrations) {
                // 初始化默认分类
                initDefaultCategories().then(() => {
                  console.log('Database initialization completed')
                  resolve()
                }).catch(reject)
              }
            })
          })
        })
      })
    })
  })
}

// 初始化默认分类
async function initDefaultCategories(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!db) {
      reject(new Error('Database not initialized'))
      return
    }
    
    const now = Date.now()
    const defaultCategories = [
      { id: 'text-default', name: '文本笔记', type: 'text' },
      { id: 'text-code', name: '代码片段', type: 'text' },
      { id: 'image-screenshots', name: '截图收藏', type: 'image' },
      { id: 'image-designs', name: '设计素材', type: 'image' },
      { id: 'file-documents', name: '文档资料', type: 'file' },
      { id: 'file-configs', name: '配置文件', type: 'file' },
      { id: 'mixed-favorites', name: '我的收藏', type: 'mixed' }
    ]
    
    let categoriesProcessed = 0
    const totalCategories = defaultCategories.length
    
    defaultCategories.forEach((category) => {
      db!.run(`
        INSERT OR IGNORE INTO archive_categories 
        (id, name, type, item_count, created_at, updated_at)
        VALUES (?, ?, ?, 0, ?, ?)
      `, [category.id, category.name, category.type, now, now], (err) => {
        if (err) {
          console.error(`Failed to insert category ${category.name}:`, err)
        } else {
          console.log(`Default category ${category.name} initialized`)
        }
        
        categoriesProcessed++
        if (categoriesProcessed === totalCategories) {
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
      (id, type, content, preview, timestamp, size, expiry_time, is_starred, starred_at, category, tags, description) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    
    stmt.run([
      item.id,
      item.type,
      item.content,
      item.preview || null,
      item.timestamp,
      item.size || null,
      item.expiryTime || null,
      item.isStarred ? 1 : 0,
      item.starredAt || null,
      item.category || 'default',
      item.tags ? JSON.stringify(item.tags) : null,
      item.description || null
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
    
    // 加载有效项目，按时间排序
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
        expiryTime: row.expiry_time,
        isStarred: row.is_starred === 1,
        starredAt: row.starred_at,
        category: row.category || 'default',
        tags: row.tags ? JSON.parse(row.tags) : [],
        description: row.description
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
    // Alfred 风格：完全无窗口装饰，但保持前台交互
    frame: false,
    transparent: true,
    hasShadow: false,
    thickFrame: true, // 启用厚边框以支持无边框窗口的尺寸调整
    // 前台显示且可交互的关键配置 - 优化版本
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: true, // 允许调整大小
    minimizable: false,
    maximizable: false,
    closable: true, // 允许关闭但不会真正关闭
    fullscreenable: false,
    show: false,
    // 关键：Alfred风格焦点管理配置
    focusable: true, // 允许接收键盘事件
    acceptFirstMouse: false, // 防止点击激活
    // 使用普通窗口类型避免 panel 冲突
    // visibleOnAllWorkspaces: true, // 注释掉，因为TypeScript类型不支持
    vibrancy: 'under-window',
    icon: path.join(process.env.VITE_PUBLIC, 'favicon.ico'),
    webPreferences: {
      preload,
      nodeIntegration: false,
      contextIsolation: true,
      backgroundThrottling: false, // 防止后台限制
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

  // Show window when ready - Alfred 风格，等待用户触发
  win.once('ready-to-show', () => {
    console.log('Window ready to show')
    // Alfred 风格：不自动显示，等待快捷键触发
  })
  
  // 注意：窗口配置为 Alfred 风格，支持键盘交互但避免不必要的焦点抢夺
  
  
  // 监听窗口关闭事件
  win.on('close', (event) => {
    // 阻止窗口关闭，只是隐藏
    event.preventDefault()
    hideWindow()
  })

  // 监听窗口位置变化
  win.on('moved', () => {
    if (win) {
      const bounds = win.getBounds()
      windowBounds = bounds
      // 发送位置更新到渲染进程
      win.webContents.send('window-bounds-changed', bounds)
      // 保存窗口位置设置
      saveWindowSettings()
    }
  })

  // 监听窗口大小变化
  win.on('resized', () => {
    if (win) {
      const bounds = win.getBounds()
      windowBounds = bounds
      // 发送位置更新到渲染进程
      win.webContents.send('window-bounds-changed', bounds)
      // 保存窗口位置设置
      saveWindowSettings()
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

// 设置窗口位置存储
let settingsWindowBounds = {
  x: 100,
  y: 100,
  width: 800,
  height: 600
}

// 档案库窗口位置存储
let archiveWindowBounds = {
  x: 200,
  y: 100,
  width: 900,
  height: 700
}

// 当前快捷键设置
let currentShortcut = 'CommandOrControl+Shift+C'

// 快捷键设置文件路径
const shortcutSettingsPath = path.join(os.homedir(), '.neurora', 'n-clip', 'shortcut-settings.json')
// 窗口位置设置文件路径
const windowSettingsPath = path.join(os.homedir(), '.neurora', 'n-clip', 'window-settings.json')

// 加载快捷键设置
function loadShortcutSettings() {
  try {
    if (fs.existsSync(shortcutSettingsPath)) {
      const settings = JSON.parse(fs.readFileSync(shortcutSettingsPath, 'utf8'))
      currentShortcut = settings.hotkey || 'CommandOrControl+Shift+C'
      console.log(`Loaded shortcut setting: ${currentShortcut}`)
    }
  } catch (error) {
    console.error('Failed to load shortcut settings:', error)
    currentShortcut = 'CommandOrControl+Shift+C'
  }
}

// 加载窗口位置设置
function loadWindowSettings() {
  try {
    if (fs.existsSync(windowSettingsPath)) {
      const settings = JSON.parse(fs.readFileSync(windowSettingsPath, 'utf8'))
      if (settings.mainWindow) {
        windowBounds = {
          x: settings.mainWindow.x || 0,
          y: settings.mainWindow.y || 0,
          width: settings.mainWindow.width || 640,
          height: settings.mainWindow.height || 480
        }
        console.log(`Loaded window bounds: ${JSON.stringify(windowBounds)}`)
      }
      if (settings.settingsWindow) {
        settingsWindowBounds = {
          x: settings.settingsWindow.x || 100,
          y: settings.settingsWindow.y || 100,
          width: settings.settingsWindow.width || 800,
          height: settings.settingsWindow.height || 600
        }
        console.log(`Loaded settings window bounds: ${JSON.stringify(settingsWindowBounds)}`)
      }
    }
  } catch (error) {
    console.error('Failed to load window settings:', error)
  }
}

// 保存窗口位置设置
function saveWindowSettings() {
  try {
    const settings = {
      mainWindow: windowBounds,
      settingsWindow: settingsWindowBounds
    }
    
    // 确保目录存在
    const settingsDir = path.dirname(windowSettingsPath)
    if (!fs.existsSync(settingsDir)) {
      fs.mkdirSync(settingsDir, { recursive: true })
    }
    
    fs.writeFileSync(windowSettingsPath, JSON.stringify(settings, null, 2))
    console.log('Window settings saved successfully')
  } catch (error) {
    console.error('Failed to save window settings:', error)
  }
}

// 保存快捷键设置
function saveShortcutSettings(hotkey: string) {
  try {
    const settingsDir = path.dirname(shortcutSettingsPath)
    if (!fs.existsSync(settingsDir)) {
      fs.mkdirSync(settingsDir, { recursive: true })
    }
    
    const settings = { hotkey }
    fs.writeFileSync(shortcutSettingsPath, JSON.stringify(settings, null, 2))
    console.log(`Saved shortcut setting: ${hotkey}`)
  } catch (error) {
    console.error('Failed to save shortcut settings:', error)
  }
}

// 创建设置窗口
async function openSettingsWindow() {
  // 如果窗口已存在，聚焦到该窗口
  if (settingsWindow) {
    settingsWindow.focus()
    return
  }

  // 设置标志防止自动隐藏
  setCreatingWindow(true)
  console.log('DEBUG: Starting to create settings window')

  settingsWindow = new BrowserWindow({
    title: 'NClip 设置',
    x: settingsWindowBounds.x,
    y: settingsWindowBounds.y,
    width: settingsWindowBounds.width,
    height: settingsWindowBounds.height,
    minWidth: 600,
    minHeight: 500,
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

  // 加载设置页面
  if (VITE_DEV_SERVER_URL) {
    settingsWindow.loadURL(VITE_DEV_SERVER_URL + '#settings')
  } else {
    settingsWindow.loadFile(indexHtml, { hash: 'settings' })
  }

  // 显示窗口
  settingsWindow.once('ready-to-show', () => {
    settingsWindow?.show()
    console.log('DEBUG: Settings window shown, clearing isCreatingWindow flag')
    // 窗口已准备好显示，立即清理创建标志
    setCreatingWindow(false)
  })

  // 窗口加载完成后，请求渲染进程提供保存的位置
  settingsWindow.webContents.once('did-finish-load', () => {
    if (settingsWindow) {
      settingsWindow.webContents.send('request-saved-bounds')
    }
  })

  // 监听窗口位置变化
  settingsWindow.on('moved', () => {
    if (settingsWindow) {
      const bounds = settingsWindow.getBounds()
      settingsWindowBounds = bounds
      // 发送位置更新到渲染进程
      settingsWindow.webContents.send('settings-window-bounds-changed', bounds)
      // 保存窗口位置设置
      saveWindowSettings()
    }
  })

  // 监听窗口大小变化
  settingsWindow.on('resized', () => {
    if (settingsWindow) {
      const bounds = settingsWindow.getBounds()
      settingsWindowBounds = bounds
      // 发送位置更新到渲染进程
      settingsWindow.webContents.send('settings-window-bounds-changed', bounds)
      // 保存窗口位置设置
      saveWindowSettings()
    }
  })

  // 窗口关闭时清理引用
  settingsWindow.on('closed', () => {
    settingsWindow = null
    // 确保清理标志
    setCreatingWindow(false)
    console.log('DEBUG: Settings window closed, clearing isCreatingWindow flag')
  })

  // 阻止外部链接在设置窗口中打开
  settingsWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https:')) shell.openExternal(url)
    return { action: 'deny' }
  })
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
  
  // 设置标志防止自动隐藏
  setCreatingWindow(true)
  console.log('DEBUG: Set creating window flag, starting BrowserWindow creation...')

  try {
    console.log('DEBUG: Creating BrowserWindow with bounds:', archiveWindowBounds)
    archiveWindow = new BrowserWindow({
      title: 'NClip 档案库',
      x: archiveWindowBounds.x,
      y: archiveWindowBounds.y,
      width: archiveWindowBounds.width,
      height: archiveWindowBounds.height,
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
    
    // 直接显示窗口，避免ready-to-show事件不可靠的问题
    console.log('DEBUG: Showing archive window directly after load')
    archiveWindow.show()
    console.log('DEBUG: Archive window show() called, isVisible:', archiveWindow?.isVisible())
    console.log('DEBUG: Archive window bounds after show:', archiveWindow?.getBounds())
    
    // 清理创建标志
    setCreatingWindow(false)
    console.log('DEBUG: Archive window creation completed, isCreatingWindow flag cleared')
  } catch (error) {
    console.error('DEBUG: Error creating or loading archive window:', error)
    // 清理状态
    setCreatingWindow(false)
    if (archiveWindow) {
      archiveWindow.destroy()
      archiveWindow = null
    }
    throw error
  }
  
  console.log('=== DEBUG: openArchiveWindow() END ===')

  // 监听窗口位置变化
  archiveWindow.on('moved', () => {
    if (archiveWindow) {
      const bounds = archiveWindow.getBounds()
      archiveWindowBounds = bounds
      // 保存窗口位置设置
      saveWindowSettings()
    }
  })

  // 监听窗口大小变化
  archiveWindow.on('resized', () => {
    if (archiveWindow) {
      const bounds = archiveWindow.getBounds()
      archiveWindowBounds = bounds
      // 保存窗口位置设置
      saveWindowSettings()
    }
  })

  // 窗口关闭时清理引用
  archiveWindow.on('closed', () => {
    archiveWindow = null
    // 确保清理标志
    setCreatingWindow(false)
    console.log('DEBUG: Archive window closed, clearing isCreatingWindow flag')
  })

  // 阻止外部链接在档案库窗口中打开
  archiveWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https:')) shell.openExternal(url)
    return { action: 'deny' }
  })
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
      width: 1000,
      height: 700,
      minWidth: 800,
      minHeight: 600,
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

    // 直接显示窗口并发送数据
    console.log('Showing share card window and sending data')
    shareCardWindow.show()
    shareCardWindow.focus()
    
    // 发送数据到渲染进程
    console.log('Sending share card data')
    shareCardWindow.webContents.send('share-card-data', item)

    return shareCardWindow
  } catch (error) {
    console.error('Error creating share card window:', error)
    shareCardWindow = null
    throw error
  }
}

// 显示窗口的智能方法
async function showWindowIntelligently() {
  if (!win) return
  
  try {
    // 使用 showInactive 显示窗口但不激活
    win.showInactive()
    win.setAlwaysOnTop(true, 'floating')
    
    // 立即启动键盘和鼠标监听
    startGlobalKeyboardListener()
    startGlobalMouseListener()
    
  } catch (error) {
    console.error('Error showing window intelligently:', error)
    // 备用方案
    win.showInactive()
    win.setAlwaysOnTop(true, 'floating')
    startGlobalKeyboardListener()
    startGlobalMouseListener()
  }
}

// 隐藏窗口的智能方法
async function hideWindowIntelligently() {
  if (!win) return
  
  try {
    // 停止全局监听
    stopGlobalKeyboardListener()
    stopGlobalMouseListener()
    
    // 隐藏窗口
    win.hide()
    
  } catch (error) {
    console.error('Error hiding window intelligently:', error)
    // 备用方案
    stopGlobalKeyboardListener()
    stopGlobalMouseListener()
    win.hide()
  }
}

// 注册全局快捷键
function registerGlobalShortcuts() {
  // 先取消注册所有快捷键
  globalShortcut.unregisterAll()
  
  // 使用当前设置的快捷键 - 显示剪切板窗口（Alfred 风格）
  const shortcutRegistered = globalShortcut.register(currentShortcut, () => {
    if (win) {
      if (win.isVisible()) {
        hideWindowIntelligently()
      } else {
        showWindowIntelligently()
      }
    }
  })
  
  if (!shortcutRegistered) {
    console.warn(`Failed to register global shortcut ${currentShortcut}`)
  }
  
  // 备用快捷键 Cmd/Ctrl + Option + C
  const altShortcutRegistered = globalShortcut.register('CommandOrControl+Alt+C', () => {
    if (win) {
      if (win.isVisible()) {
        hideWindowIntelligently()
      } else {
        showWindowIntelligently()
      }
    }
  })
  
  if (!altShortcutRegistered) {
    console.warn('Failed to register backup shortcut CommandOrControl+Alt+C')
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
      label: 'Show Clipboard Window',
      click: () => {
        if (win) {
          if (win.isVisible()) {
            win.hide()
            stopGlobalKeyboardListener()
          } else {
            win.showInactive()
            win.setAlwaysOnTop(true, 'floating')
            startGlobalKeyboardListener()
          }
        }
      }
    },
    { type: 'separator' },
    {
      label: 'Settings',
      click: async () => {
        await openSettingsWindow()
      }
    },
    {
      label: 'Archive',
      click: async () => {
        await openArchiveWindow()
      }
    },
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
        console.log('Quit clicked from tray menu')
        
        // 先尝试正常退出
        app.quit()
        
        // 如果正常退出失败，立即强制退出
        console.log('Force quitting immediately')
        process.exit(0)
      }
    }
  ])
  
  tray.setContextMenu(contextMenu)
  tray.setToolTip('NClip - Copy. Paste. Repeat.')
  
  // 点击托盘图标显示/隐藏剪切板窗口
  tray.on('click', () => {
    if (win) {
      if (win.isVisible()) {
        hideWindowIntelligently()
      } else {
        showWindowIntelligently()
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
          // 简单粗暴：直接添加到前面，然后重新排序
          clipboardHistory.unshift(newItem)
          
          // 立即重新排序：置顶项目在前，然后按时间排序
          clipboardHistory.sort((a, b) => {
            if (a.isPinned && !b.isPinned) return -1
            if (!a.isPinned && b.isPinned) return 1
            return b.timestamp - a.timestamp
          })
          
          // 保存到数据库
          saveClipboardItem(newItem).catch(console.error)
          
          // 限制历史记录数量，保护置顶项目
          limitHistorySize(100)
          
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
        
        // 简单粗暴：直接添加到前面，然后重新排序
        clipboardHistory.unshift(newItem)
        
        // 立即重新排序：置顶项目在前，然后按时间排序
        clipboardHistory.sort((a, b) => {
          if (a.isPinned && !b.isPinned) return -1
          if (!a.isPinned && b.isPinned) return 1
          return b.timestamp - a.timestamp
        })
        
        // 保存到数据库
        saveClipboardItem(newItem).catch(console.error)
        
        // 限制历史记录数量，保护置顶项目
        limitHistorySize(100)
        
        lastClipboardContent = currentText
        
        // 通知渲染进程
        if (win) {
          win.webContents.send('clipboard:changed', newItem)
        }
      } else {
        // 如果存在相同内容，将其移动到最前面，然后重新排序
        const index = clipboardHistory.indexOf(existingItem)
        if (index > 0) {
          clipboardHistory.splice(index, 1)
          clipboardHistory.unshift(existingItem)
          
          // 立即重新排序：置顶项目在前，然后按时间排序
          clipboardHistory.sort((a, b) => {
            if (a.isPinned && !b.isPinned) return -1
            if (!a.isPinned && b.isPinned) return 1
            return b.timestamp - a.timestamp
          })
        }
        
        // 通知渲染进程更新
        if (win) {
          win.webContents.send('clipboard:history-updated', clipboardHistory)
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
    
    // 简单按时间排序，star状态的排序由前端atoms处理
    clipboardHistory.sort((a, b) => b.timestamp - a.timestamp)
    
    console.log(`Loaded ${clipboardHistory.length} clipboard items from database (${clipboardHistory.filter(item => item.isPinned).length} pinned)`)
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

app.whenReady().then(() => {
  // 先加载快捷键设置
  loadShortcutSettings()
  // 加载窗口位置设置
  loadWindowSettings()
  // 然后创建窗口
  createWindow()
})

app.on('window-all-closed', () => {
  win = null
  // 对于开发模式，允许正常退出
  if (process.env.NODE_ENV === 'development' || !tray) {
    app.quit()
  }
  // 生产模式保持托盘运行
})

app.on('before-quit', (event) => {
  console.log('Application is quitting...')
  
  // 在开发模式下，确保能够完全退出
  if (process.env.NODE_ENV === 'development') {
    // 关闭所有窗口
    const allWindows = BrowserWindow.getAllWindows()
    allWindows.forEach(window => {
      if (!window.isDestroyed()) {
        window.destroy()
      }
    })
    
    // 清理托盘
    if (tray && !tray.isDestroyed()) {
      tray.destroy()
      tray = null
    }
    
    // 取消注册全局快捷键
    globalShortcut.unregisterAll()
  }
})

app.on('will-quit', () => {
  // 清理全局快捷键
  globalShortcut.unregisterAll()
  
  // 关闭设置窗口
  if (settingsWindow) {
    settingsWindow.close()
    settingsWindow = null
  }
  
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
    // Show the main window if the user tried to open another
    if (win.isMinimized()) win.restore()
    showWindowIntelligently() // 使用智能显示方法
  }
})

app.on('activate', () => {
  const allWindows = BrowserWindow.getAllWindows()
  if (allWindows.length) {
    showWindowIntelligently() // 使用智能显示方法
  } else {
    createWindow()
  }
})

// IPC handlers
ipcMain.handle('clipboard:get-history', () => {
  // 验证并确保内存中的数据排序正确
  ensureCorrectSorting('get-history')
  
  // 确保返回时按固定状态排序：固定项目在前，时间倒序
  return [...clipboardHistory].sort((a, b) => {
    if (a.isPinned && !b.isPinned) return -1
    if (!a.isPinned && b.isPinned) return 1
    return b.timestamp - a.timestamp
  })
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
    
    // 剪切板操作完成，立即重置标记
    isSettingClipboard = false
    
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
  // 保存窗口位置设置
  saveWindowSettings()
  return true
})

ipcMain.handle('window:hide', () => {
  hideWindowIntelligently()
  return true
})

// 打开档案库窗口
ipcMain.handle('archive:open', async () => {
  console.log('=== DEBUG: IPC archive:open received ===')
  console.log('DEBUG: Current state:', {
    archiveWindowExists: !!archiveWindow,
    isCreatingWindow: isCreatingWindow
  })
  
  try {
    // 立即隐藏剪切板窗口
    if (win && win.isVisible()) {
      console.log('DEBUG: Hiding clipboard window before opening archive')
      await hideWindowIntelligently()
    }
    
    console.log('DEBUG: Calling openArchiveWindow()...')
    await openArchiveWindow()
    console.log('DEBUG: openArchiveWindow() completed successfully')
    
    console.log('DEBUG: Final archive window state:', {
      archiveWindowExists: !!archiveWindow,
      isVisible: archiveWindow?.isVisible() || false,
      bounds: archiveWindow?.getBounds() || null
    })
    
    return { success: true }
  } catch (error) {
    console.error('DEBUG: Exception in archive:open handler:', error)
    console.error('DEBUG: Error stack:', error instanceof Error ? error.stack : 'No stack')
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
})

// 设置窗口位置相关 IPC
ipcMain.handle('settings-window:get-bounds', () => {
  return settingsWindowBounds
})

ipcMain.handle('settings-window:set-bounds', (_, bounds: WindowBounds) => {
  settingsWindowBounds = bounds
  if (settingsWindow) {
    settingsWindow.setBounds(bounds)
  }
  // 保存窗口位置设置
  saveWindowSettings()
  return true
})

// 获取当前快捷键设置
ipcMain.handle('shortcuts:get-current-shortcut', () => {
  return currentShortcut
})

// 自动粘贴到当前应用 - 仅使用 Accessibility API
ipcMain.handle('clipboard:paste-to-active-app', async () => {
  const hasPermission = checkAccessibilityPermission()
  
  if (!hasPermission) {
    throw new Error('Accessibility permission required')
  }
  
  const success = insertTextToFocusedElement('')
  
  if (!success) {
    throw new Error('Failed to paste using Accessibility API')
  }
  
  return { success: true, method: 'accessibility' }
})

// 测试快捷键是否已注册以及是否可以注册新快捷键
ipcMain.handle('shortcuts:test-shortcut', (_, shortcut: string) => {
  console.log(`=== 快捷键测试开始 ===`)
  const isRegistered = globalShortcut.isRegistered(shortcut)
  console.log(`目标快捷键 ${shortcut}: ${isRegistered ? 'REGISTERED' : 'NOT REGISTERED'}`)
  
  // 测试系统是否支持全局快捷键注册
  const testKeys = [
    'CommandOrControl+F12',
    'CommandOrControl+Shift+F11', 
    'CommandOrControl+Alt+F10',
    'CommandOrControl+Shift+\`'
  ]
  
  let canRegisterShortcuts = false
  
  for (const testKey of testKeys) {
    try {
      const testRegistered = globalShortcut.register(testKey, () => {
        console.log(`Test shortcut ${testKey} triggered!`)
      })
      
      if (testRegistered) {
        console.log(`✓ 测试快捷键 ${testKey} 注册成功`)
        globalShortcut.unregister(testKey)
        console.log(`✓ 测试快捷键 ${testKey} 已注销`)
        canRegisterShortcuts = true
        break
      } else {
        console.log(`✗ 测试快捷键 ${testKey} 注册失败（可能被占用）`)
      }
    } catch (error) {
      console.log(`✗ 测试快捷键 ${testKey} 出错: ${(error as Error).message}`)
    }
  }
  
  if (!canRegisterShortcuts) {
    console.log(`⚠️  警告：无法注册任何测试快捷键，可能需要系统权限`)
  }
  
  // 测试目标快捷键是否可以注册
  let targetCanRegister = false
  if (!isRegistered) {
    try {
      const targetRegistered = globalShortcut.register(shortcut, () => {
        console.log(`Target shortcut ${shortcut} triggered!`)
      })
      
      if (targetRegistered) {
        console.log(`✓ 目标快捷键 ${shortcut} 可以注册`)
        globalShortcut.unregister(shortcut)
        targetCanRegister = true
      } else {
        console.log(`✗ 目标快捷键 ${shortcut} 无法注册（被其他应用占用）`)
      }
    } catch (error) {
      console.log(`✗ 目标快捷键 ${shortcut} 测试出错: ${(error as Error).message}`)
    }
  }
  
  // 列出所有已注册的快捷键
  console.log('当前应用已注册的快捷键:')
  const testShortcuts = [
    'CommandOrControl+Shift+C',
    'CommandOrControl+Shift+C', 
    'CommandOrControl+Alt+C',
    shortcut
  ]
  
  testShortcuts.forEach(test => {
    const registered = globalShortcut.isRegistered(test)
    console.log(`  ${test}: ${registered ? '✓' : '✗'}`)
  })
  
  console.log(`=== 快捷键测试结束 ===`)
  
  return { 
    isRegistered, 
    currentShortcut, 
    canRegisterShortcuts,
    targetCanRegister: !isRegistered ? targetCanRegister : true
  }
})

// 更新全局快捷键
ipcMain.handle('shortcuts:update-global-shortcut', (_, newShortcut: string) => {
  try {
    // 验证快捷键格式
    if (!newShortcut || typeof newShortcut !== 'string') {
      return { success: false, error: '无效的快捷键格式' }
    }
    
    // 先取消注册所有快捷键
    globalShortcut.unregisterAll()
    
    // 尝试注册新的快捷键
    const shortcutRegistered = globalShortcut.register(newShortcut, () => {
      if (win) {
        if (win.isVisible()) {
          win.hide()
          stopGlobalKeyboardListener()
        } else {
          win.showInactive() // 使用showInactive()防止抢占焦点
          startGlobalKeyboardListener()
        }
      }
    })
    
    if (shortcutRegistered) {
      currentShortcut = newShortcut
      
      // 保存快捷键设置到文件
      saveShortcutSettings(newShortcut)
      
      // 重新注册备用快捷键
      const altShortcutRegistered = globalShortcut.register('CommandOrControl+Alt+C', () => {
        if (win) {
          if (win.isVisible()) {
            win.hide()
            stopGlobalKeyboardListener()
          } else {
            win.showInactive() // 使用showInactive()防止抢占焦点
            startGlobalKeyboardListener()
          }
        }
      })
      
      if (!altShortcutRegistered) {
        console.warn('Failed to register backup shortcut CommandOrControl+Alt+C')
      }
      
      return { success: true }
    } else {
      // 如果新快捷键注册失败，恢复之前的快捷键
      registerGlobalShortcuts()
      return { success: false, error: '快捷键注册失败，可能已被其他应用占用' }
    }
  } catch (error) {
    console.error('Failed to update global shortcut:', error)
    // 恢复之前的快捷键
    registerGlobalShortcuts()
    return { success: false, error: (error as Error).message }
  }
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

// 清空历史记录
ipcMain.handle('clipboard:clear-history', async () => {
  try {
    // 清空内存中的历史记录
    clipboardHistory.length = 0
    
    // 清空数据库
    await new Promise<void>((resolve, reject) => {
      db?.run('DELETE FROM clipboard_items', (err) => {
        if (err) reject(err)
        else resolve()
      })
    })
    
    // 通知渲染进程更新
    if (win) {
      win.webContents.send('clipboard:history-updated', clipboardHistory)
    }
    
    return true
  } catch (error) {
    console.error('Failed to clear history:', error)
    return false
  }
})

// ===== Star机制相关API =====

// Star项目到档案库
ipcMain.handle('clipboard:star-item', async (_, itemId: string, category?: string, description?: string) => {
  try {
    const item = clipboardHistory.find(item => item.id === itemId)
    if (!item) {
      return { success: false, error: 'Item not found' }
    }
    
    if (item.isStarred) {
      return { success: false, error: 'Item already starred' }
    }
    
    // 更新项目状态
    item.isStarred = true
    item.starredAt = Date.now()
    item.category = category || 'mixed-favorites'
    if (description) {
      item.description = description
    }
    
    // 保存到数据库
    await saveClipboardItem(item)
    
    // 更新分类计数
    await updateCategoryItemCount(item.category)
    
    console.log(`Item ${itemId} starred to category: ${item.category}`)
    return { success: true }
  } catch (error) {
    console.error('Failed to star item:', error)
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
})

// Unstar项目从档案库
ipcMain.handle('clipboard:unstar-item', async (_, itemId: string) => {
  try {
    const item = clipboardHistory.find(item => item.id === itemId)
    if (!item) {
      return { success: false, error: 'Item not found' }
    }
    
    if (!item.isStarred) {
      return { success: false, error: 'Item not starred' }
    }
    
    const oldCategory = item.category
    
    // 更新项目状态
    item.isStarred = false
    item.starredAt = undefined
    item.category = 'default'
    item.description = undefined
    
    // 保存到数据库
    await saveClipboardItem(item)
    
    // 更新分类计数
    if (oldCategory) {
      await updateCategoryItemCount(oldCategory)
    }
    
    console.log(`Item ${itemId} unstarred`)
    return { success: true }
  } catch (error) {
    console.error('Failed to unstar item:', error)
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
})

// 获取已收藏的项目
ipcMain.handle('clipboard:get-starred-items', async (_, category?: string) => {
  try {
    const starredItems = clipboardHistory.filter(item => {
      if (!item.isStarred) return false
      if (category && item.category !== category) return false
      return true
    })
    
    // 按收藏时间排序
    starredItems.sort((a, b) => (b.starredAt || 0) - (a.starredAt || 0))
    
    return starredItems
  } catch (error) {
    console.error('Failed to get starred items:', error)
    return []
  }
})

// 获取所有分类
ipcMain.handle('clipboard:get-categories', async () => {
  return new Promise((resolve, reject) => {
    if (!db) {
      reject(new Error('Database not initialized'))
      return
    }
    
    db.all('SELECT * FROM archive_categories ORDER BY created_at ASC', (err, rows: any[]) => {
      if (err) {
        console.error('Failed to get categories:', err)
        reject(err)
        return
      }
      
      const categories = rows.map(row => ({
        id: row.id,
        name: row.name,
        type: row.type,
        itemCount: row.item_count,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      }))
      
      resolve(categories)
    })
  })
})

// 创建新分类
ipcMain.handle('clipboard:create-category', async (_, name: string, type: 'text' | 'image' | 'file' | 'mixed') => {
  return new Promise((resolve, reject) => {
    if (!db) {
      reject(new Error('Database not initialized'))
      return
    }
    
    const categoryId = `${type}-${Date.now()}`
    const now = Date.now()
    
    db.run(`
      INSERT INTO archive_categories 
      (id, name, type, item_count, created_at, updated_at)
      VALUES (?, ?, ?, 0, ?, ?)
    `, [categoryId, name, type, now, now], (err) => {
      if (err) {
        console.error('Failed to create category:', err)
        resolve({ success: false, error: err.message })
      } else {
        console.log(`Category ${name} created with id: ${categoryId}`)
        resolve({ success: true, categoryId })
      }
    })
  })
})

// 更新项目分类
ipcMain.handle('clipboard:update-item-category', async (_, itemId: string, categoryId: string) => {
  try {
    const item = clipboardHistory.find(item => item.id === itemId)
    if (!item) {
      return { success: false, error: 'Item not found' }
    }
    
    const oldCategory = item.category
    item.category = categoryId
    
    // 保存到数据库
    await saveClipboardItem(item)
    
    // 更新分类计数
    if (oldCategory) {
      await updateCategoryItemCount(oldCategory)
    }
    await updateCategoryItemCount(categoryId)
    
    console.log(`Item ${itemId} moved to category: ${categoryId}`)
    return { success: true }
  } catch (error) {
    console.error('Failed to update item category:', error)
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
})

// 更新项目标签
ipcMain.handle('clipboard:update-item-tags', async (_, itemId: string, tags: string[]) => {
  try {
    const item = clipboardHistory.find(item => item.id === itemId)
    if (!item) {
      return { success: false, error: 'Item not found' }
    }
    
    item.tags = tags
    
    // 保存到数据库
    await saveClipboardItem(item)
    
    console.log(`Item ${itemId} tags updated:`, tags)
    return { success: true }
  } catch (error) {
    console.error('Failed to update item tags:', error)
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
})

// 更新项目描述
ipcMain.handle('clipboard:update-item-description', async (_, itemId: string, description: string) => {
  try {
    const item = clipboardHistory.find(item => item.id === itemId)
    if (!item) {
      return { success: false, error: 'Item not found' }
    }
    
    item.description = description
    
    // 保存到数据库
    await saveClipboardItem(item)
    
    console.log(`Item ${itemId} description updated`)
    return { success: true }
  } catch (error) {
    console.error('Failed to update item description:', error)
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
})

// 更新分类项目计数的辅助函数
async function updateCategoryItemCount(categoryId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!db) {
      reject(new Error('Database not initialized'))
      return
    }
    
    // 计算该分类下的项目数量
    db.get(`
      SELECT COUNT(*) as count 
      FROM clipboard_items 
      WHERE category = ? AND is_starred = 1
    `, [categoryId], (err, row: any) => {
      if (err) {
        console.error(`Failed to count items for category ${categoryId}:`, err)
        reject(err)
        return
      }
      
      const count = row.count || 0
      
      // 更新分类表中的计数
      db!.run(`
        UPDATE archive_categories 
        SET item_count = ?, updated_at = ? 
        WHERE id = ?
      `, [count, Date.now(), categoryId], (updateErr) => {
        if (updateErr) {
          console.error(`Failed to update category ${categoryId} count:`, updateErr)
          reject(updateErr)
        } else {
          console.log(`Category ${categoryId} count updated to ${count}`)
          resolve()
        }
      })
    })
  })
}

// 新增的IPC处理器 - 支持渲染进程的全局键盘事件

// 处理渲染进程的导航事件
ipcMain.on('navigate-items', (event, direction: 'up' | 'down') => {
  // 这个事件由主进程的全局快捷键触发，发送给渲染进程
  console.log(`Navigate items: ${direction}`)
})

// 处理渲染进程的选择事件
ipcMain.on('select-current-item', (event) => {
  // 这个事件由主进程的全局快捷键触发，发送给渲染进程
  console.log('Select current item')
})

// 处理渲染进程的删除事件
ipcMain.on('delete-current-item', (event) => {
  // 这个事件由主进程的全局快捷键触发，发送给渲染进程
  console.log('Delete current item')
})

// 处理渲染进程的预览切换事件
ipcMain.on('toggle-preview', (event) => {
  // 这个事件由主进程的全局快捷键触发，发送给渲染进程
  console.log('Toggle preview')
})

// 处理渲染进程的Star切换事件
ipcMain.on('toggle-star', (event) => {
  // 这个事件由主进程的全局快捷键触发，发送给渲染进程
  console.log('Toggle star')
})

// 处理渲染进程的档案库打开事件
ipcMain.on('open-archive', (event) => {
  // 这个事件由主进程的全局快捷键触发，发送给渲染进程
  console.log('Open archive')
})

// 处理选择项目后的粘贴操作
ipcMain.handle('clipboard:paste-selected-item', async (_, item: ClipboardItem) => {
  console.log('Paste selected item:', item.id)
  
  try {
    // 先隐藏窗口并等待完成
    if (win && win.isVisible()) {
      await hideWindowIntelligently()
    }
    
    // 将项目内容设置到剪贴板
    isSettingClipboard = true
    
    if (item.type === 'image' && item.preview) {
      const base64Data = item.preview.replace(/^data:image\/\w+;base64,/, '')
      const imageBuffer = Buffer.from(base64Data, 'base64')
      const nativeImage = require('electron').nativeImage.createFromBuffer(imageBuffer)
      clipboard.writeImage(nativeImage)
    } else {
      clipboard.writeText(item.content)
      lastClipboardContent = item.content
    }
    
    // 模拟 Cmd+V 键盘事件
    const keystrokeSuccess = simulatePasteKeystroke()
    console.log('Keystroke simulation result:', keystrokeSuccess)
    
    // 粘贴操作完成，立即重置标记
    isSettingClipboard = false
    
    return { success: true, method: 'enhanced-paste' }
  } catch (error) {
    console.error('Failed to paste selected item:', error)
    isSettingClipboard = false
    throw error
  }
})

// 生成分享卡片
ipcMain.handle('clipboard:generate-share-card', async (_, item: ClipboardItem, template: string = 'default', ratio: string = '3:4') => {
  try {
    console.log('Generate share card request for item:', item.type, item.id)
    
    // 计算项目序号
    const itemIndex = clipboardHistory.findIndex(h => h.id === item.id) + 1
    
    if (item.type === 'image' && item.preview) {
      console.log('Processing image share card...')
      // 为图片生成分享卡片
      const tempPath = await generateImageShareCard(item, template, ratio, itemIndex)
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
      const tempPath = await generateTextShareCard(item, template, ratio, itemIndex)
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
    console.error('Error details:', (error as Error).stack)
    return false
  }
})

// 打开分享卡片窗口
ipcMain.handle('share-card:open', async (_, item: ClipboardItem) => {
  try {
    console.log('IPC: Opening share card window for item:', item.type, item.id)
    
    // 立即隐藏剪切板窗口
    if (win && win.isVisible()) {
      console.log('DEBUG: Hiding clipboard window before opening share card')
      await hideWindowIntelligently()
    }
    
    // 如果窗口已经存在且未销毁，先关闭它
    if (shareCardWindow && !shareCardWindow.isDestroyed()) {
      console.log('Closing existing share card window')
      shareCardWindow.close()
      shareCardWindow = null
      // 窗口已关闭
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
    
    // 计算项目序号
    const itemIndex = clipboardHistory.findIndex(h => h.id === item.id) + 1
    
    let tempPath: string | null = null
    
    if (item.type === 'image' && item.preview) {
      tempPath = await generateImageShareCard(item, template, ratio, itemIndex)
    } else if (item.type === 'text') {
      tempPath = await generateTextShareCard(item, template, ratio, itemIndex)
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
async function generateImageShareCard(item: ClipboardItem, template: string = 'default', ratio: string = '3:4', itemIndex: number = 0): Promise<string | null> {
  try {
    console.log('Starting image share card generation...')
    const { createCanvas, loadImage } = require('canvas')
    
    // 计算画布尺寸
    let width: number, height: number
    if (ratio === 'auto') {
      // 自适应：紧贴内容尺寸
      const base64Data = item.preview!.replace(/^data:image\/\w+;base64,/, '')
      const imageBuffer = Buffer.from(base64Data, 'base64')
      const tempImage = await loadImage(imageBuffer)
      
      // 计算最优显示尺寸
      const maxSize = 800
      const minSize = 400
      let targetWidth = tempImage.width
      let targetHeight = tempImage.height
      
      // 如果图片太大，等比缩放
      if (targetWidth > maxSize || targetHeight > maxSize) {
        const scale = maxSize / Math.max(targetWidth, targetHeight)
        targetWidth = Math.round(targetWidth * scale)
        targetHeight = Math.round(targetHeight * scale)
      }
      
      // 确保最小尺寸
      if (targetWidth < minSize || targetHeight < minSize) {
        const scale = minSize / Math.min(targetWidth, targetHeight)
        targetWidth = Math.round(targetWidth * scale)
        targetHeight = Math.round(targetHeight * scale)
      }
      
      // 画布尺寸 = 图片尺寸 + 最小必要边距
      const padding = 20 // 极简边距
      const brandSpace = 80 // 精简品牌区域
      width = targetWidth + (padding * 2)
      height = targetHeight + brandSpace + padding
    } else if (ratio === '4:3') {
      width = 800
      height = 600
    } else if (ratio === '1:1') {
      width = 600
      height = 600
    } else { // 默认 3:4
      width = 600
      height = 800
    }
    
    // 创建高清画布
    const dpr = 2 // 设备像素比，提高清晰度
    const canvas = createCanvas(width * dpr, height * dpr)
    const ctx = canvas.getContext('2d')
    
    // 缩放上下文以适应高DPI
    ctx.scale(dpr, dpr)
    
    // 启用抗锯齿
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    
    // 背景渐变 - 精心设计的高级配色
    const gradient = ctx.createLinearGradient(0, 0, width, height)
    
    switch (template) {
      case 'ultrathin':
        // 极薄：纯净白色背景，极简至上
        ctx.fillStyle = '#fafafa'
        ctx.fillRect(0, 0, width, height)
        break
        
      case 'dark':
        // 暗夜：深邃渐变
        gradient.addColorStop(0, '#0f0f23')
        gradient.addColorStop(1, '#1a1a2e')
        ctx.fillStyle = gradient
        ctx.fillRect(0, 0, width, height)
        break
        
      case 'pastel':
        // 柔和：温暖渐变
        gradient.addColorStop(0, '#ffeaa7')
        gradient.addColorStop(1, '#fab1a0')
        ctx.fillStyle = gradient
        ctx.fillRect(0, 0, width, height)
        break
        
      case 'luxury':
        // 奢华金：金色渐变
        gradient.addColorStop(0, '#f7971e')
        gradient.addColorStop(0.5, '#ffd200')
        gradient.addColorStop(1, '#ffb347')
        ctx.fillStyle = gradient
        ctx.fillRect(0, 0, width, height)
        break
        
      case 'monochrome':
        // 黑白：经典渐变
        gradient.addColorStop(0, '#2c3e50')
        gradient.addColorStop(1, '#34495e')
        ctx.fillStyle = gradient
        ctx.fillRect(0, 0, width, height)
        break
        
      case 'sunset':
        // 日落：温暖渐变
        gradient.addColorStop(0, '#ff6b6b')
        gradient.addColorStop(0.5, '#feca57')
        gradient.addColorStop(1, '#ff9ff3')
        ctx.fillStyle = gradient
        ctx.fillRect(0, 0, width, height)
        break
        
      default:
        // 经典蓝：原版设计
        gradient.addColorStop(0, '#667eea')
        gradient.addColorStop(1, '#764ba2')
        ctx.fillStyle = gradient
        ctx.fillRect(0, 0, width, height)
        break
    }
    
    // 添加图片
    const base64Data = item.preview!.replace(/^data:image\/\w+;base64,/, '')
    const imageBuffer = Buffer.from(base64Data, 'base64')
    const image = await loadImage(imageBuffer)
    
    // 计算图片位置和大小 - 自适应紧贴优化
    let imageWidth: number, imageHeight: number, x: number, y: number
    
    if (ratio === 'auto') {
      // 自适应模式：图片占据最大可用空间
      const padding = 20
      const brandSpace = 80
      const availableWidth = width - (padding * 2)
      const availableHeight = height - brandSpace - padding
      
      const scale = Math.min(availableWidth / image.width, availableHeight / image.height)
      imageWidth = image.width * scale
      imageHeight = image.height * scale
      x = (width - imageWidth) / 2
      y = padding
    } else {
      // 固定比例模式：保持原有逻辑
      const maxWidth = width - 100
      const maxHeight = height - 200
      const scale = Math.min(maxWidth / image.width, maxHeight / image.height)
      imageWidth = image.width * scale
      imageHeight = image.height * scale
      x = (width - imageWidth) / 2
      y = (height - imageHeight) / 2 - 50
    }
    
    // 绘制图片
    ctx.drawImage(image, x, y, imageWidth, imageHeight)
    
    // 添加高级感装饰元素
    addPremiumDecorations(ctx, width, height, template)
    
    // 高级感序号设计
    if (itemIndex > 0) {
      const fontSize = Math.max(10, Math.min(12, width * 0.016))
      
      // 序号位置和样式
      const numberX = width - 30
      const numberY = 30
      
      // 根据模板设计不同风格的序号
      switch (template) {
        case 'ultrathin':
          // 极简风：纯文字
          ctx.fillStyle = 'rgba(0, 0, 0, 0.25)'
          ctx.font = `300 ${fontSize}px SF Pro Display, -apple-system, system-ui`
          ctx.textAlign = 'center'
          ctx.textBaseline = 'middle'
          ctx.fillText(`${String(itemIndex).padStart(2, '0')}`, numberX, numberY)
          break
          
        case 'luxury':
          // 奢华风：金色圆环
          ctx.strokeStyle = 'rgba(255, 215, 0, 0.4)'
          ctx.lineWidth = 1.5
          ctx.beginPath()
          ctx.arc(numberX, numberY, 15, 0, Math.PI * 2)
          ctx.stroke()
          
          ctx.fillStyle = 'rgba(139, 69, 19, 0.8)'
          ctx.font = `600 ${fontSize}px SF Pro Display, -apple-system, system-ui`
          ctx.textAlign = 'center'
          ctx.textBaseline = 'middle'
          ctx.fillText(`${itemIndex}`, numberX, numberY)
          break
          
        default:
          // 现代风：半透明背景
          ctx.fillStyle = 'rgba(255, 255, 255, 0.1)'
          ctx.beginPath()
          ctx.arc(numberX, numberY, 12, 0, Math.PI * 2)
          ctx.fill()
          
          const textColor = template === 'pastel' ? 'rgba(0, 0, 0, 0.5)' : 'rgba(255, 255, 255, 0.7)'
          ctx.fillStyle = textColor
          ctx.font = `500 ${fontSize}px SF Pro Display, -apple-system, system-ui`
          ctx.textAlign = 'center'
          ctx.textBaseline = 'middle'
          ctx.fillText(`${String(itemIndex).padStart(2, '0')}`, numberX, numberY)
          break
      }
    }
    
    // 添加 NClip 品牌 - 根据画布尺寸动态调整字体大小
    const brandFontSize = Math.max(20, Math.min(32, width * 0.045)) // 根据宽度调整，范围 20-32px
    const taglineFontSize = Math.max(12, Math.min(20, width * 0.028)) // 根据宽度调整，范围 12-20px
    
    // 根据模板调整品牌颜色
    let brandColor = 'rgba(255, 255, 255, 0.9)'
    let taglineColor = 'rgba(255, 255, 255, 0.7)'
    
    switch (template) {
      case 'ultrathin':
        brandColor = 'rgba(0, 0, 0, 0.9)'
        taglineColor = 'rgba(0, 0, 0, 0.6)'
        break
      case 'dark':
        brandColor = 'rgba(255, 255, 255, 0.9)'
        taglineColor = 'rgba(255, 255, 255, 0.7)'
        break
      case 'pastel':
        brandColor = 'rgba(0, 0, 0, 0.8)'
        taglineColor = 'rgba(0, 0, 0, 0.6)'
        break
      case 'luxury':
        brandColor = 'rgba(139, 69, 19, 0.9)' // 深棕色
        taglineColor = 'rgba(139, 69, 19, 0.7)'
        break
      case 'monochrome':
        brandColor = 'rgba(255, 255, 255, 0.95)'
        taglineColor = 'rgba(255, 255, 255, 0.8)'
        break
      case 'sunset':
        brandColor = 'rgba(255, 255, 255, 0.95)'
        taglineColor = 'rgba(255, 255, 255, 0.8)'
        break
    }
    
    // 高级感品牌设计
    const brandY = height - 65
    const taglineY = height - 40
    
    // 品牌名称
    ctx.fillStyle = brandColor
    ctx.font = `700 ${brandFontSize}px SF Pro Display, -apple-system, system-ui`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'alphabetic'
    ctx.letterSpacing = '0.5px'
    ctx.fillText('NClip', width / 2, brandY)
    
    // 添加品牌装饰
    if (template === 'luxury') {
      // 奢华模板：金色装饰线
      const lineWidth = ctx.measureText('NClip').width
      ctx.strokeStyle = 'rgba(255, 215, 0, 0.3)'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(width / 2 - lineWidth / 2 - 10, brandY + 8)
      ctx.lineTo(width / 2 + lineWidth / 2 + 10, brandY + 8)
      ctx.stroke()
    } else if (template === 'ultrathin') {
      // 极简模板：细线装饰
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.1)'
      ctx.lineWidth = 0.5
      ctx.beginPath()
      ctx.moveTo(width / 2 - 20, brandY + 6)
      ctx.lineTo(width / 2 + 20, brandY + 6)
      ctx.stroke()
    }
    
    // 标语
    ctx.fillStyle = taglineColor
    ctx.font = `400 ${taglineFontSize}px SF Pro Display, -apple-system, system-ui`
    ctx.textBaseline = 'alphabetic'
    ctx.letterSpacing = '0.3px'
    ctx.fillText('Copy. Paste. Repeat.', width / 2, taglineY)
    
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
    console.error('Error details:', (error as Error).stack)
    return null
  }
}

// 生成文本分享卡片
async function generateTextShareCard(item: ClipboardItem, template: string = 'default', ratio: string = '3:4', itemIndex: number = 0): Promise<string | null> {
  try {
    console.log('Starting text share card generation...')
    const { createCanvas } = require('canvas')
    
    // 计算画布尺寸
    let width: number, height: number
    if (ratio === 'auto') {
      // 自适应：根据文本内容紧贴计算尺寸
      const fontSize = 20
      const lineHeight = 32
      const padding = 40
      const brandSpace = 80
      
      // 创建临时画布测量文本
      const tempCanvas = createCanvas(1000, 1000)
      const tempCtx = tempCanvas.getContext('2d')
      tempCtx.font = `${fontSize}px SF Pro Display, -apple-system, system-ui`
      
      // 计算文本行数和最大宽度
      const lines = wrapText(tempCtx, item.content, 600) // 最大行宽600
      const textHeight = lines.length * lineHeight
      const maxLineWidth = Math.max(...lines.map(line => tempCtx.measureText(line).width))
      
      // 画布尺寸紧贴文本
      width = Math.max(400, Math.min(800, maxLineWidth + padding * 2))
      height = textHeight + brandSpace + padding * 2
    } else if (ratio === '4:3') {
      width = 800
      height = 600
    } else if (ratio === '1:1') {
      width = 600
      height = 600
    } else { // 默认 3:4
      width = 600
      height = 800
    }
    
    // 创建高清画布
    const dpr = 2 // 设备像素比，提高清晰度
    const canvas = createCanvas(width * dpr, height * dpr)
    const ctx = canvas.getContext('2d')
    
    // 缩放上下文以适应高DPI
    ctx.scale(dpr, dpr)
    
    // 启用抗锯齿
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    
    // 背景渐变 - 精心设计的高级配色
    const gradient = ctx.createLinearGradient(0, 0, width, height)
    
    switch (template) {
      case 'ultrathin':
        // 极薄：纯净白色背景，极简至上
        ctx.fillStyle = '#fafafa'
        ctx.fillRect(0, 0, width, height)
        break
        
      case 'dark':
        // 暗夜：深邃渐变
        gradient.addColorStop(0, '#0f0f23')
        gradient.addColorStop(1, '#1a1a2e')
        ctx.fillStyle = gradient
        ctx.fillRect(0, 0, width, height)
        break
        
      case 'pastel':
        // 柔和：温暖渐变
        gradient.addColorStop(0, '#ffeaa7')
        gradient.addColorStop(1, '#fab1a0')
        ctx.fillStyle = gradient
        ctx.fillRect(0, 0, width, height)
        break
        
      case 'luxury':
        // 奢华金：金色渐变
        gradient.addColorStop(0, '#f7971e')
        gradient.addColorStop(0.5, '#ffd200')
        gradient.addColorStop(1, '#ffb347')
        ctx.fillStyle = gradient
        ctx.fillRect(0, 0, width, height)
        break
        
      case 'monochrome':
        // 黑白：经典渐变
        gradient.addColorStop(0, '#2c3e50')
        gradient.addColorStop(1, '#34495e')
        ctx.fillStyle = gradient
        ctx.fillRect(0, 0, width, height)
        break
        
      case 'sunset':
        // 日落：温暖渐变
        gradient.addColorStop(0, '#ff6b6b')
        gradient.addColorStop(0.5, '#feca57')
        gradient.addColorStop(1, '#ff9ff3')
        ctx.fillStyle = gradient
        ctx.fillRect(0, 0, width, height)
        break
        
      default:
        // 经典蓝：原版设计
        gradient.addColorStop(0, '#667eea')
        gradient.addColorStop(1, '#764ba2')
        ctx.fillStyle = gradient
        ctx.fillRect(0, 0, width, height)
        break
    }
    
    // 添加高级感装饰元素
    addPremiumDecorations(ctx, width, height, template)
    
    // 设置文本颜色 - 适配新模板
    let textColor = 'rgba(255, 255, 255, 0.9)'
    
    switch (template) {
      case 'ultrathin':
        textColor = 'rgba(0, 0, 0, 0.9)'
        break
      case 'dark':
        textColor = 'rgba(255, 255, 255, 0.9)'
        break
      case 'pastel':
        textColor = 'rgba(0, 0, 0, 0.8)'
        break
      case 'luxury':
        textColor = 'rgba(139, 69, 19, 0.9)' // 深棕色
        break
      case 'monochrome':
        textColor = 'rgba(255, 255, 255, 0.95)'
        break
      case 'sunset':
        textColor = 'rgba(255, 255, 255, 0.95)'
        break
      default:
        textColor = 'rgba(255, 255, 255, 0.9)'
        break
    }
    
    // 添加文本内容 - 高质量渲染
    ctx.fillStyle = textColor
    ctx.font = '20px SF Pro Display, -apple-system, system-ui'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'alphabetic'
    
    // 启用文本抗锯齿和子像素渲染
    if (ctx.textRenderingOptimization) {
      ctx.textRenderingOptimization = 'optimizeLegibility'
    }
    
    // 分割文本为多行 - 自适应优化
    const lineHeight = 32
    let maxWidth: number, maxContentHeight: number, lines: string[], displayLines: string[], startY: number
    
    if (ratio === 'auto') {
      // 自适应模式：文字位于视觉重心
      const padding = 40
      const brandSpace = 80
      maxWidth = width - padding * 2
      lines = wrapText(ctx, item.content, 600)
      displayLines = lines
      
      // 计算文字总高度
      const textHeight = displayLines.length * lineHeight
      const availableHeight = height - brandSpace
      
      // 黄金比例布局：文字重心位于上1/3处
      const goldenRatio = 0.618
      const topSpace = (availableHeight - textHeight) * goldenRatio
      startY = Math.max(padding, topSpace)
      
    } else {
      // 固定比例模式：优化文字位置
      maxWidth = width - 80
      maxContentHeight = height - 160 // 减少品牌区域占用
      lines = wrapText(ctx, item.content, maxWidth)
      const totalTextHeight = lines.length * lineHeight
      
      // 如果文本太长，减少行数并添加省略号
      displayLines = lines
      if (totalTextHeight > maxContentHeight) {
        const maxLines = Math.floor(maxContentHeight / lineHeight) - 1
        displayLines = lines.slice(0, maxLines)
        if (displayLines.length > 0) {
          displayLines[displayLines.length - 1] = displayLines[displayLines.length - 1] + '...'
        }
      }
      
      // 文字位于视觉重心：上1/3处
      const actualTextHeight = displayLines.length * lineHeight
      const availableHeight = height - 160
      const goldenRatio = 0.618
      const topSpace = (availableHeight - actualTextHeight) * goldenRatio
      startY = Math.max(60, topSpace + 40)
    }
    
    // 绘制文本
    displayLines.forEach((line, index) => {
      ctx.fillText(line, width / 2, startY + index * lineHeight)
    })
    
    // 高级感序号设计
    if (itemIndex > 0) {
      const fontSize = Math.max(10, Math.min(12, width * 0.016))
      
      // 序号位置和样式
      const numberX = width - 30
      const numberY = 30
      
      // 根据模板设计不同风格的序号
      switch (template) {
        case 'ultrathin':
          // 极简风：纯文字
          ctx.fillStyle = 'rgba(0, 0, 0, 0.25)'
          ctx.font = `300 ${fontSize}px SF Pro Display, -apple-system, system-ui`
          ctx.textAlign = 'center'
          ctx.textBaseline = 'middle'
          ctx.fillText(`${String(itemIndex).padStart(2, '0')}`, numberX, numberY)
          break
          
        case 'luxury':
          // 奢华风：金色圆环
          ctx.strokeStyle = 'rgba(255, 215, 0, 0.4)'
          ctx.lineWidth = 1.5
          ctx.beginPath()
          ctx.arc(numberX, numberY, 15, 0, Math.PI * 2)
          ctx.stroke()
          
          ctx.fillStyle = 'rgba(139, 69, 19, 0.8)'
          ctx.font = `600 ${fontSize}px SF Pro Display, -apple-system, system-ui`
          ctx.textAlign = 'center'
          ctx.textBaseline = 'middle'
          ctx.fillText(`${itemIndex}`, numberX, numberY)
          break
          
        default:
          // 现代风：半透明背景
          ctx.fillStyle = 'rgba(255, 255, 255, 0.1)'
          ctx.beginPath()
          ctx.arc(numberX, numberY, 12, 0, Math.PI * 2)
          ctx.fill()
          
          const textColor = template === 'pastel' ? 'rgba(0, 0, 0, 0.5)' : 'rgba(255, 255, 255, 0.7)'
          ctx.fillStyle = textColor
          ctx.font = `500 ${fontSize}px SF Pro Display, -apple-system, system-ui`
          ctx.textAlign = 'center'
          ctx.textBaseline = 'middle'
          ctx.fillText(`${String(itemIndex).padStart(2, '0')}`, numberX, numberY)
          break
      }
    }
    
    // 添加 NClip 品牌 - 根据画布尺寸动态调整字体大小
    const brandFontSize = Math.max(20, Math.min(32, width * 0.045)) // 根据宽度调整，范围 20-32px
    const taglineFontSize = Math.max(12, Math.min(20, width * 0.028)) // 根据宽度调整，范围 12-20px
    
    // 根据模板调整品牌颜色
    let brandColor = 'rgba(255, 255, 255, 0.9)'
    let taglineColor = 'rgba(255, 255, 255, 0.7)'
    
    switch (template) {
      case 'ultrathin':
        brandColor = 'rgba(0, 0, 0, 0.9)'
        taglineColor = 'rgba(0, 0, 0, 0.6)'
        break
      case 'dark':
        brandColor = 'rgba(255, 255, 255, 0.9)'
        taglineColor = 'rgba(255, 255, 255, 0.7)'
        break
      case 'pastel':
        brandColor = 'rgba(0, 0, 0, 0.8)'
        taglineColor = 'rgba(0, 0, 0, 0.6)'
        break
      case 'luxury':
        brandColor = 'rgba(139, 69, 19, 0.9)' // 深棕色
        taglineColor = 'rgba(139, 69, 19, 0.7)'
        break
      case 'monochrome':
        brandColor = 'rgba(255, 255, 255, 0.95)'
        taglineColor = 'rgba(255, 255, 255, 0.8)'
        break
      case 'sunset':
        brandColor = 'rgba(255, 255, 255, 0.95)'
        taglineColor = 'rgba(255, 255, 255, 0.8)'
        break
    }
    
    // 高级感品牌设计
    const brandY = height - 65
    const taglineY = height - 40
    
    // 品牌名称
    ctx.fillStyle = brandColor
    ctx.font = `700 ${brandFontSize}px SF Pro Display, -apple-system, system-ui`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'alphabetic'
    ctx.letterSpacing = '0.5px'
    ctx.fillText('NClip', width / 2, brandY)
    
    // 添加品牌装饰
    if (template === 'luxury') {
      // 奢华模板：金色装饰线
      const lineWidth = ctx.measureText('NClip').width
      ctx.strokeStyle = 'rgba(255, 215, 0, 0.3)'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(width / 2 - lineWidth / 2 - 10, brandY + 8)
      ctx.lineTo(width / 2 + lineWidth / 2 + 10, brandY + 8)
      ctx.stroke()
    } else if (template === 'ultrathin') {
      // 极简模板：细线装饰
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.1)'
      ctx.lineWidth = 0.5
      ctx.beginPath()
      ctx.moveTo(width / 2 - 20, brandY + 6)
      ctx.lineTo(width / 2 + 20, brandY + 6)
      ctx.stroke()
    }
    
    // 标语
    ctx.fillStyle = taglineColor
    ctx.font = `400 ${taglineFontSize}px SF Pro Display, -apple-system, system-ui`
    ctx.textBaseline = 'alphabetic'
    ctx.letterSpacing = '0.3px'
    ctx.fillText('Copy. Paste. Repeat.', width / 2, taglineY)
    
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
    console.error('Error details:', (error as Error).stack)
    return null
  }
}

// 添加高级感装饰元素
function addPremiumDecorations(ctx: any, width: number, height: number, template: string) {
  switch (template) {
    case 'ultrathin':
      // 极简几何线条
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.08)'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(width * 0.15, height * 0.2)
      ctx.lineTo(width * 0.85, height * 0.2)
      ctx.stroke()
      
      ctx.beginPath()
      ctx.moveTo(width * 0.15, height * 0.8)
      ctx.lineTo(width * 0.85, height * 0.8)
      ctx.stroke()
      break
      
    case 'luxury':
      // 奢华装饰边框
      const gradientBorder = ctx.createLinearGradient(0, 0, width, 0)
      gradientBorder.addColorStop(0, 'rgba(255, 215, 0, 0.3)')
      gradientBorder.addColorStop(0.5, 'rgba(255, 215, 0, 0.6)')
      gradientBorder.addColorStop(1, 'rgba(255, 215, 0, 0.3)')
      
      ctx.strokeStyle = gradientBorder
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.roundRect(20, 20, width - 40, height - 40, 8)
      ctx.stroke()
      break
      
    case 'sunset':
    case 'default':
      // 微妙光晕效果
      const glowGradient = ctx.createRadialGradient(width / 2, height / 3, 0, width / 2, height / 3, width * 0.6)
      glowGradient.addColorStop(0, 'rgba(255, 255, 255, 0.05)')
      glowGradient.addColorStop(1, 'rgba(255, 255, 255, 0)')
      
      ctx.fillStyle = glowGradient
      ctx.fillRect(0, 0, width, height)
      break
      
    case 'monochrome':
      // 工业风网格
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.03)'
      ctx.lineWidth = 0.5
      
      const gridSize = 40
      for (let x = 0; x <= width; x += gridSize) {
        ctx.beginPath()
        ctx.moveTo(x, 0)
        ctx.lineTo(x, height)
        ctx.stroke()
      }
      for (let y = 0; y <= height; y += gridSize) {
        ctx.beginPath()
        ctx.moveTo(0, y)
        ctx.lineTo(width, y)
        ctx.stroke()
      }
      break
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

// Accessibility API handlers
ipcMain.handle('accessibility:check-permission', () => {
  try {
    return checkAccessibilityPermission()
  } catch (error) {
    console.error('Error checking accessibility permission:', error)
    return false
  }
})

ipcMain.handle('accessibility:request-permission', () => {
  try {
    return requestAccessibilityPermission()
  } catch (error) {
    console.error('Error requesting accessibility permission:', error)
    return false
  }
})

ipcMain.handle('accessibility:get-focused-element', () => {
  try {
    return getFocusedElement()
  } catch (error) {
    console.error('Error getting focused element:', error)
    return false
  }
})

ipcMain.handle('accessibility:insert-text', (_, text: string) => {
  try {
    return insertTextToFocusedElement(text)
  } catch (error) {
    console.error('Error inserting text:', error)
    return false
  }
})

ipcMain.handle('accessibility:get-app-info', () => {
  try {
    return getFocusedAppInfo()
  } catch (error) {
    console.error('Error getting app info:', error)
    return { hasFocusedElement: false }
  }
})

// 高级鼠标事件处理（无焦点抢夺）
ipcMain.handle('accessibility:handle-mouse-event', (_, x: number, y: number, eventType: string) => {
  try {
    return handleMouseEventWithoutFocus(x, y, eventType)
  } catch (error) {
    console.error('Error handling mouse event:', error)
    return false
  }
})

// 获取指定位置的UI元素信息
ipcMain.handle('accessibility:get-element-at-position', (_, x: number, y: number) => {
  try {
    return getElementAtPosition(x, y)
  } catch (error) {
    console.error('Error getting element at position:', error)
    return { hasElement: false, error: (error as Error).message }
  }
})

// 执行UI元素操作（无焦点抢夺）
ipcMain.handle('accessibility:perform-element-action', (_, x: number, y: number, action: string) => {
  try {
    return performElementAction(x, y, action)
  } catch (error) {
    console.error('Error performing element action:', error)
    return false
  }
})

// Enhanced paste functionality using clipboard + keyboard simulation (Alfred 真实方法)
ipcMain.handle('clipboard:paste-to-active-app-enhanced', async (_, text: string) => {
  console.log('Enhanced paste requested with text:', text.length > 50 ? text.substring(0, 50) + '...' : text)
  
  // 第一步：立即隐藏窗口（Alfred 关键步骤）
  if (win && win.isVisible()) {
    win.hide()
    stopGlobalKeyboardListener()
  }
  
  try {
    // 第二步：将文本放入系统剪贴板
    clipboard.writeText(text)
    console.log('Text written to clipboard')
    
    // 第三步：模拟 Cmd+V 键盘事件
    const keystrokeSuccess = simulatePasteKeystroke()
    console.log('Keystroke simulation result:', keystrokeSuccess)
    
    if (!keystrokeSuccess) {
      throw new Error('Failed to simulate paste keystroke')
    }
    
    return { success: true, method: 'keyboard-simulation' }
  } catch (error) {
    console.error('Enhanced paste failed:', error)
    throw error
  }
})

// 处理打开外部 URL 的请求
ipcMain.on('open-external-url', (_, url: string) => {
  shell.openExternal(url)
})

// 处理应用退出请求
ipcMain.handle('app:quit', () => {
  console.log('Quit requested from renderer process')
  app.quit()
  return true
})

// 处理强制退出请求
ipcMain.handle('app:force-quit', () => {
  console.log('Force quit requested from renderer process')
  
  // 强制清理所有资源
  const allWindows = BrowserWindow.getAllWindows()
  allWindows.forEach(window => {
    if (!window.isDestroyed()) {
      window.destroy()
    }
  })
  
  if (tray && !tray.isDestroyed()) {
    tray.destroy()
  }
  
  globalShortcut.unregisterAll()
  
  // 强制退出进程
  process.exit(0)
})
