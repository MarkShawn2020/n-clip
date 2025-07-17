import {
    app,
    BrowserWindow,
    clipboard,
    dialog,
    globalShortcut,
    ipcMain,
    Menu,
    MessageBoxReturnValue,
    nativeImage,
    screen,
    Tray
} from 'electron'
import {createRequire} from 'node:module'
import {fileURLToPath} from 'node:url'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'
import {update} from './update'
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
            fs.mkdirSync(APP_DATA_PATH, {recursive: true})
        }

        console.log('Data storage initialized at:', APP_DATA_PATH)
        return Promise.resolve()
    } catch (error) {
        console.error('Failed to initialize data storage:', error)
        return Promise.reject(error)
    }
}

// 加载剪切板历史数据 - 异步版本
async function loadClipboardHistory() {
    try {
        if (fs.existsSync(CLIPBOARD_DATA_FILE)) {
            const data = await fs.promises.readFile(CLIPBOARD_DATA_FILE, 'utf8')
            const items = JSON.parse(data) as ClipboardItem[]
            clipboardHistory = items || []
            console.log(`Loaded ${clipboardHistory.length} clipboard items from storage`)
        } else {
            console.log('No existing clipboard history file found')
        }
    } catch (error) {
        console.error('Failed to load clipboard history:', error)
        clipboardHistory = []
    }
}

// 加载档案库数据 - 异步版本
async function loadArchiveItems() {
    try {
        if (fs.existsSync(ARCHIVE_DATA_FILE)) {
            const data = await fs.promises.readFile(ARCHIVE_DATA_FILE, 'utf8')
            const items = JSON.parse(data) as ArchiveItem[]
            archiveItems = items || []
            console.log(`Loaded ${archiveItems.length} archive items from storage`)
        } else {
            console.log('No existing archive data file found')
        }
    } catch (error) {
        console.error('Failed to load archive items:', error)
        archiveItems = []
    }
}

// 保存剪切板历史到文件 - 异步版本
async function saveClipboardHistory() {
    try {
        const data = JSON.stringify(clipboardHistory, null, 2)
        await fs.promises.writeFile(CLIPBOARD_DATA_FILE, data, 'utf8')
    } catch (error) {
        console.error('Failed to save clipboard history:', error)
        throw error
    }
}

// 保存档案库数据到文件 - 异步版本
async function saveArchiveItems() {
    try {
        const data = JSON.stringify(archiveItems, null, 2)
        await fs.promises.writeFile(ARCHIVE_DATA_FILE, data, 'utf8')
    } catch (error) {
        console.error('Failed to save archive items:', error)
        throw error
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
        const {screen} = require('electron')
        const primaryDisplay = screen.getPrimaryDisplay()
        const {width: screenWidth, height: screenHeight} = primaryDisplay.workAreaSize

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
                win?.setBounds({...windowPosition, width: 800, height: 600})
            }

            // DOM准备好后，发送当前剪切板历史
            if (clipboardHistory.length > 0) {
                win?.webContents.send('clipboard:history-updated', clipboardHistory)
            }

            windowReady = true
            console.log('Window ready for use')
            
            // 初始化自动更新功能
            if (app.isPackaged) {
                update(win!)
                console.log('Auto-updater initialized')
            }
            
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

// 优化的系统托盘创建 - 直接使用预定义路径
function createTray() {
    console.log('=== 托盘图标创建 (优化版) ===')
    let icon: Electron.NativeImage

    // 简单直接的logo加载
    try {
        const logoPath = getLogoResourcePath()
        console.log('Logo路径:', logoPath)
        icon = nativeImage.createFromPath(logoPath).resize({width: 16, height: 16})
        console.log('✅ 托盘图标加载成功')
    } catch (error) {
        console.log('⚠️  Logo加载失败，创建简单图标:', error instanceof Error ? error.message : 'Unknown error')
        
        // 创建一个简单但可见的图标，而不是空图标
        try {
            const size = 16
            const buffer = Buffer.alloc(size * size * 4) // RGBA
            
            // 创建一个简单的紫色圆圈图标
            for (let y = 0; y < size; y++) {
                for (let x = 0; x < size; x++) {
                    const centerX = size / 2
                    const centerY = size / 2
                    const distance = Math.sqrt((x - centerX) ** 2 + (y - centerY) ** 2)
                    const index = (y * size + x) * 4
                    
                    if (distance <= 6) {
                        // 紫色圆圈
                        buffer[index] = 147     // R
                        buffer[index + 1] = 51  // G  
                        buffer[index + 2] = 234 // B
                        buffer[index + 3] = 255 // A
                    } else {
                        // 透明背景
                        buffer[index] = 0       // R
                        buffer[index + 1] = 0   // G
                        buffer[index + 2] = 0   // B
                        buffer[index + 3] = 0   // A
                    }
                }
            }
            
            icon = nativeImage.createFromBuffer(buffer, {width: size, height: size})
            console.log('✅ 创建了默认紫色圆圈图标')
        } catch (fallbackError) {
            // 最后的备用方案
            icon = nativeImage.createEmpty()
            console.log('⚠️  使用空图标作为最后备用方案')
        }
    }

    try {
        tray = new Tray(icon)
        console.log('✅ 托盘创建成功')
    } catch (trayError) {
        console.error('❌ 托盘创建失败:', trayError)
        throw trayError
    }

    // 检查快捷键状态
    const hasGlobalShortcuts = globalShortcut.isRegistered('CommandOrControl+Shift+V') ||
        globalShortcut.isRegistered('CommandOrControl+Option+V')

    // 设置清爽的托盘菜单
    const recentItems = clipboardHistory.slice(0, 3) // 限制为3个最近项目
    const statusText = `📊 剪贴板 ${clipboardHistory.length} 项 | 收藏 ${archiveItems.length} 项`
    
    const contextMenu = Menu.buildFromTemplate([
        // 核心功能区
        {
            label: '打开剪切板记录',
            click: () => {
                toggleWindow()
            }
        },
        {
            label: '打开收藏库',
            click: async () => {
                try {
                    console.log('用户从托盘打开收藏库')
                    await openArchiveWindow()
                } catch (error) {
                    console.error('从托盘打开收藏库失败:', error)
                }
            }
        },
        
        // 最近项目区（仅在有项目时显示）
        ...(recentItems.length > 0 ? [
            { type: 'separator' as const },
            ...recentItems.map((item, index) => ({
                label: `${index + 1}. ${(item.preview || item.content).substring(0, 35)}${(item.preview || item.content).length > 35 ? '...' : ''}`,
                click: () => {
                    clipboard.writeText(item.content)
                    console.log('Copied to clipboard:', item.preview)
                }
            }))
        ] : []),
        
        // 状态信息区
        { type: 'separator' as const },
        {
            label: statusText,
            enabled: false
        },
        {
            label: hasGlobalShortcuts ? '✅ 快捷键 ⌘⇧V' : '❌ 快捷键未启用',
            enabled: false
        },
        
        // 管理功能区
        { type: 'separator' as const },
        {
            label: '管理',
            submenu: [
                {
                    label: '清除历史记录',
                    click: () => {
                        clipboardHistory = []
                        updateTrayMenu()
                        if (win) {
                            win?.webContents.send('clipboard:history-updated', clipboardHistory)
                        }
                    }
                },
                {
                    label: '偏好设置...',
                    enabled: false // 暂时禁用
                },
                {
                    label: '检查更新',
                    click: async () => {
                        if (app.isPackaged) {
                            try {
                                const { autoUpdater } = require('electron-updater')
                                await autoUpdater.checkForUpdatesAndNotify()
                            } catch (error) {
                                const {dialog} = require('electron')
                                await dialog.showMessageBox({
                                    type: 'error',
                                    title: '检查更新失败',
                                    message: '无法检查更新',
                                    detail: error instanceof Error ? error.message : '网络错误'
                                })
                            }
                        } else {
                            const {dialog} = require('electron')
                            await dialog.showMessageBox({
                                type: 'info',
                                title: '检查更新',
                                message: '自动更新功能仅在打包后的应用中可用',
                                detail: '开发环境中无法使用自动更新功能。'
                            })
                        }
                    }
                },
                ...(hasGlobalShortcuts ? [] : [
                    { type: 'separator' as const },
                    {
                        label: '重新初始化快捷键',
                        click: async () => {
                            console.log('用户手动请求重新初始化快捷键')
                            const success = await recheckPermissionsAndReinitialize()
                            updateTrayMenu()

                            const {dialog} = require('electron')
                            if (success) {
                                await dialog.showMessageBox({
                                    type: 'info',
                                    title: '重新初始化完成',
                                    message: '快捷键和权限已重新初始化',
                                    detail: '如果问题仍然存在，请尝试完全重启应用。'
                                })
                            } else {
                                await dialog.showMessageBox({
                                    type: 'warning',
                                    title: '重新初始化失败',
                                    message: '无法重新初始化快捷键',
                                    detail: '请检查辅助功能权限设置，或尝试重启应用。'
                                })
                            }
                        }
                    }
                ]),
                { type: 'separator' as const },
                {
                    label: '系统诊断',
                    submenu: [
                        {
                            label: '显示诊断信息',
                            click: async () => {
                                const {dialog} = require('electron')
                                const diagnostics = await getDiagnosticInfo()

                                await dialog.showMessageBox({
                                    type: 'info',
                                    title: 'N-Clip 系统诊断',
                                    message: '当前系统状态',
                                    detail: diagnostics,
                                    buttons: ['知道了', '复制到剪贴板']
                                }).then((result: MessageBoxReturnValue) => {
                                    if (result.response === 1) {
                                        clipboard.writeText(diagnostics)
                                    }
                                })
                            }
                        },
                        {
                            label: '测试快捷键',
                            click: () => {
                                console.log('用户手动测试快捷键')
                                toggleWindow()
                            }
                        },
                        {
                            label: '重新创建托盘',
                            click: () => {
                                try {
                                    if (tray) {
                                        tray.destroy()
                                        tray = null
                                    }
                                    createTray()
                                    updateTrayMenu()
                                    console.log('托盘已重新创建')
                                } catch (error) {
                                    console.error('重新创建托盘失败:', error)
                                }
                            }
                        },
                        { type: 'separator' as const },
                        {
                            label: '完全重启应用',
                            click: async () => {
                                const {dialog} = require('electron')
                                const result = await dialog.showMessageBox({
                                    type: 'question',
                                    title: '重启应用',
                                    message: '确定要重启 N-Clip 应用吗？',
                                    detail: '这将完全退出并重新启动应用，可能解决权限和快捷键问题。',
                                    buttons: ['重启', '取消'],
                                    defaultId: 0,
                                    cancelId: 1
                                })

                                if (result.response === 0) {
                                    app.relaunch()
                                    app.quit()
                                }
                            }
                        }
                    ]
                }
            ]
        },
        
        // 退出功能
        { type: 'separator' as const },
        {
            label: '退出 N-Clip',
            click: () => {
                console.log('Quit clicked from tray, completely exiting app')
                unregisterNavigationShortcuts()
                globalShortcut.unregisterAll()
                if (tray) {
                    tray.destroy()
                    tray = null
                }
                (app as any).isQuitting = true
                app.exit(0)
            }
        }
    ])

    tray.setContextMenu(contextMenu)
    tray.setToolTip('N-Clip - 剪贴板管理器')

    // 点击托盘图标切换窗口
    tray.on('click', () => {
        toggleWindow()
    })

    console.log('System tray created successfully')
}

// 更新托盘菜单
function updateTrayMenu() {
    if (!tray) return

    // 检查快捷键状态
    const hasGlobalShortcuts = globalShortcut.isRegistered('CommandOrControl+Shift+V') ||
        globalShortcut.isRegistered('CommandOrControl+Option+V')

    // 设置清爽的托盘菜单
    const recentItems = clipboardHistory.slice(0, 3) // 限制为3个最近项目
    const statusText = `📊 剪贴板 ${clipboardHistory.length} 项 | 收藏 ${archiveItems.length} 项`
    
    const contextMenu = Menu.buildFromTemplate([
        // 核心功能区
        {
            label: '打开剪切板记录',
            click: () => {
                toggleWindow()
            }
        },
        {
            label: '打开收藏库',
            click: async () => {
                try {
                    console.log('用户从托盘打开收藏库')
                    await openArchiveWindow()
                } catch (error) {
                    console.error('从托盘打开收藏库失败:', error)
                }
            }
        },
        
        // 最近项目区（仅在有项目时显示）
        ...(recentItems.length > 0 ? [
            { type: 'separator' as const },
            ...recentItems.map((item, index) => ({
                label: `${index + 1}. ${(item.preview || item.content).substring(0, 35)}${(item.preview || item.content).length > 35 ? '...' : ''}`,
                click: () => {
                    clipboard.writeText(item.content)
                    console.log('Copied to clipboard:', item.preview)
                }
            }))
        ] : []),
        
        // 状态信息区
        { type: 'separator' as const },
        {
            label: statusText,
            enabled: false
        },
        {
            label: hasGlobalShortcuts ? '✅ 快捷键 ⌘⇧V' : '❌ 快捷键未启用',
            enabled: false
        },
        
        // 管理功能区
        { type: 'separator' as const },
        {
            label: '管理',
            submenu: [
                {
                    label: '清除历史记录',
                    click: () => {
                        clipboardHistory = []
                        updateTrayMenu()
                        if (win) {
                            win?.webContents.send('clipboard:history-updated', clipboardHistory)
                        }
                    }
                },
                {
                    label: '偏好设置...',
                    enabled: false // 暂时禁用
                },
                {
                    label: '检查更新',
                    click: async () => {
                        if (app.isPackaged) {
                            try {
                                const { autoUpdater } = require('electron-updater')
                                await autoUpdater.checkForUpdatesAndNotify()
                            } catch (error) {
                                const {dialog} = require('electron')
                                await dialog.showMessageBox({
                                    type: 'error',
                                    title: '检查更新失败',
                                    message: '无法检查更新',
                                    detail: error instanceof Error ? error.message : '网络错误'
                                })
                            }
                        } else {
                            const {dialog} = require('electron')
                            await dialog.showMessageBox({
                                type: 'info',
                                title: '检查更新',
                                message: '自动更新功能仅在打包后的应用中可用',
                                detail: '开发环境中无法使用自动更新功能。'
                            })
                        }
                    }
                },
                ...(hasGlobalShortcuts ? [] : [
                    { type: 'separator' as const },
                    {
                        label: '重新初始化快捷键',
                        click: async () => {
                            console.log('用户手动请求重新初始化快捷键')
                            const success = await recheckPermissionsAndReinitialize()
                            updateTrayMenu()

                            const {dialog} = require('electron')
                            if (success) {
                                await dialog.showMessageBox({
                                    type: 'info',
                                    title: '重新初始化完成',
                                    message: '快捷键和权限已重新初始化',
                                    detail: '如果问题仍然存在，请尝试完全重启应用。'
                                })
                            } else {
                                await dialog.showMessageBox({
                                    type: 'warning',
                                    title: '重新初始化失败',
                                    message: '无法重新初始化快捷键',
                                    detail: '请检查辅助功能权限设置，或尝试重启应用。'
                                })
                            }
                        }
                    }
                ]),
                { type: 'separator' as const },
                {
                    label: '系统诊断',
                    submenu: [
                        {
                            label: '显示诊断信息',
                            click: async () => {
                                const {dialog} = require('electron')
                                const diagnostics = await getDiagnosticInfo()

                                await dialog.showMessageBox({
                                    type: 'info',
                                    title: 'N-Clip 系统诊断',
                                    message: '当前系统状态',
                                    detail: diagnostics,
                                    buttons: ['知道了', '复制到剪贴板']
                                }).then((result: MessageBoxReturnValue) => {
                                    if (result.response === 1) {
                                        clipboard.writeText(diagnostics)
                                    }
                                })
                            }
                        },
                        {
                            label: '测试快捷键',
                            click: () => {
                                console.log('用户手动测试快捷键')
                                toggleWindow()
                            }
                        },
                        {
                            label: '重新创建托盘',
                            click: () => {
                                try {
                                    if (tray) {
                                        tray.destroy()
                                        tray = null
                                    }
                                    createTray()
                                    updateTrayMenu()
                                    console.log('托盘已重新创建')
                                } catch (error) {
                                    console.error('重新创建托盘失败:', error)
                                }
                            }
                        },
                        { type: 'separator' as const },
                        {
                            label: '完全重启应用',
                            click: async () => {
                                const {dialog} = require('electron')
                                const result = await dialog.showMessageBox({
                                    type: 'question',
                                    title: '重启应用',
                                    message: '确定要重启 N-Clip 应用吗？',
                                    detail: '这将完全退出并重新启动应用，可能解决权限和快捷键问题。',
                                    buttons: ['重启', '取消'],
                                    defaultId: 0,
                                    cancelId: 1
                                })

                                if (result.response === 0) {
                                    app.relaunch()
                                    app.quit()
                                }
                            }
                        }
                    ]
                }
            ]
        },
        
        // 退出功能
        { type: 'separator' as const },
        {
            label: '退出 N-Clip',
            click: () => {
                console.log('Quit clicked from tray, completely exiting app')
                unregisterNavigationShortcuts()
                globalShortcut.unregisterAll()
                if (tray) {
                    tray.destroy()
                    tray = null
                }
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
        win.setBounds({...windowPosition, width: 800, height: 600})
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
                    const {screen} = require('electron')
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

// 强化的全局快捷键注册系统
function registerGlobalShortcuts() {
    console.log('=== 全局快捷键注册诊断 ===')

    // 清理所有现有的快捷键
    globalShortcut.unregisterAll()
    console.log('已清理所有现有快捷键')

    const shortcutsToTry = [
        'CommandOrControl+Shift+V',
        'CommandOrControl+Option+V',
        'CommandOrControl+Shift+C',
        'CommandOrControl+Alt+V',
        'CommandOrControl+Shift+X'
    ]

    let registeredShortcut = null

    for (const shortcut of shortcutsToTry) {
        try {
            console.log(`尝试注册快捷键: ${shortcut}`)

            // 检查是否已被占用
            const isAlreadyRegistered = globalShortcut.isRegistered(shortcut)
            if (isAlreadyRegistered) {
                console.log(`⚠️  快捷键 ${shortcut} 已被本应用注册`)
                continue
            }

            const registered = globalShortcut.register(shortcut, () => {
                console.log(`快捷键 ${shortcut} 被触发`)
                toggleWindow()
            })

            if (registered) {
                registeredShortcut = shortcut
                console.log(`✅ 成功注册快捷键: ${shortcut}`)
                break
            } else {
                console.log(`❌ 注册失败: ${shortcut} (可能被其他应用占用)`)
            }
        } catch (error) {
            console.log(`❌ 注册快捷键时出错 ${shortcut}:`, error)
        }
    }

    if (!registeredShortcut) {
        console.error('❌ 所有快捷键注册都失败')

        // 检查权限状态
        if (process.platform === 'darwin') {
            const {systemPreferences} = require('electron')
            const hasAccessibility = systemPreferences.isTrustedAccessibilityClient(false)
            console.log('辅助功能权限状态:', hasAccessibility)

            if (!hasAccessibility) {
                console.log('⚠️  快捷键注册失败可能是由于缺少辅助功能权限')
            }
        }
    } else {
        console.log(`🎉 快捷键系统初始化完成，使用: ${registeredShortcut}`)
    }

    return registeredShortcut
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
            icon: (() => {
                // 优先使用 logo.png，备用 favicon.ico
                const logoPngPath = path.join(process.env.VITE_PUBLIC, 'logo.png')
                const faviconPath = path.join(process.env.VITE_PUBLIC, 'favicon.ico')

                if (fs.existsSync(logoPngPath)) {
                    console.log('使用 logo.png 作为 Archive 窗口图标')
                    return logoPngPath
                } else {
                    console.log('logo.png 不存在，使用 favicon.ico 作为 Archive 窗口图标')
                    return faviconPath
                }
            })(),
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
            await archiveWindow.loadFile(indexHtml, {hash: 'archive'})
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

            const {spawn} = require('child_process')

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
            return {success: false, error: error instanceof Error ? error.message : String(error)}
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
                    fs.mkdirSync(tempDir, {recursive: true})
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
                        icon: nativeImage.createFromBuffer(imageBuffer).resize({width: 64, height: 64})
                    })
                    console.log('Drag started successfully')
                    return {success: true, tempFile: tempFilePath}
                } else {
                    console.error('startDrag not available on sender')
                    return {success: false, error: 'startDrag not available'}
                }
            } else if (item.type === 'text') {
                // 对于文本，创建临时文本文件
                const tempDir = path.join(os.tmpdir(), 'n-clip-drag')
                if (!fs.existsSync(tempDir)) {
                    fs.mkdirSync(tempDir, {recursive: true})
                }

                const tempFileName = `clipboard-text-${Date.now()}.txt`
                const tempFilePath = path.join(tempDir, tempFileName)

                fs.writeFileSync(tempFilePath, item.content, 'utf8')

                console.log('Temp text file created for drag:', tempFilePath)

                if (event.sender && event.sender.startDrag) {
                    event.sender.startDrag({
                        file: tempFilePath,
                        icon: (() => {
                            // 使用 logo.png 作为拖拽图标
                            try {
                                const logoPngPath = path.join(process.env.VITE_PUBLIC || '', 'logo.png')
                                if (fs.existsSync(logoPngPath)) {
                                    const logoIcon = nativeImage.createFromPath(logoPngPath)
                                    if (!logoIcon.isEmpty()) {
                                        // 调整为拖拽图标合适的大小
                                        return logoIcon.resize({width: 64, height: 64})
                                    }
                                }

                                // 备用方案：使用 favicon.ico
                                console.log('logo.png 不可用，使用 favicon.ico 作为拖拽图标')
                                return nativeImage.createFromPath(path.join(process.env.VITE_PUBLIC || '', 'favicon.ico'))
                            } catch (error) {
                                console.log('拖拽图标创建失败:', error)
                                return nativeImage.createFromPath(path.join(process.env.VITE_PUBLIC || '', 'favicon.ico'))
                            }
                        })()
                    })
                    console.log('Text drag started successfully')
                    return {success: true, tempFile: tempFilePath}
                } else {
                    console.error('startDrag not available on sender')
                    return {success: false, error: 'startDrag not available'}
                }
            }

            return {success: false, error: 'Unsupported item type for drag'}
        } catch (error) {
            console.error('Failed to start drag:', error)
            return {success: false, error: error instanceof Error ? error.message : String(error)}
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

            return {success: true}
        } catch (error) {
            console.error('DEBUG: Exception in archive:open handler:', error)
            return {success: false, error: error instanceof Error ? error.message : 'Unknown error'}
        }
    })

    // Star相关功能 - 操作独立的档案库
    ipcMain.handle('clipboard:star-item', async (event, itemId: string, category?: string) => {
        try {
            // 在剪切板历史中查找原项目
            const originalItem = clipboardHistory.find(item => item.id === itemId)
            if (!originalItem) {
                return {success: false, error: 'Original item not found'}
            }

            // 检查是否已经在档案库中
            const existingArchiveItem = archiveItems.find(item => item.originalId === itemId)
            if (existingArchiveItem) {
                return {success: false, error: 'Item already starred'}
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
            return {success: true}
        } catch (error) {
            return {success: false, error: error instanceof Error ? error.message : String(error)}
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
                return {success: true}
            }
            return {success: false, error: 'Item not found in archive'}
        } catch (error) {
            return {success: false, error: error instanceof Error ? error.message : String(error)}
        }
    })

    ipcMain.handle('clipboard:get-starred-items', async (event, category?: string) => {
        try {
            let filteredItems = archiveItems

            if (category && category !== 'all') {
                filteredItems = archiveItems.filter(item => item.category === category)
            }

            return {success: true, items: filteredItems}
        } catch (error) {
            return {success: false, error: error instanceof Error ? error.message : String(error)}
        }
    })

    // 检查项目是否已收藏
    ipcMain.handle('clipboard:is-item-starred', async (event, itemId: string) => {
        try {
            const isStarred = archiveItems.some(item => item.originalId === itemId)
            return {success: true, isStarred}
        } catch (error) {
            return {success: false, error: error instanceof Error ? error.message : String(error)}
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

            return {success: true, categories: categoryList}
        } catch (error) {
            return {success: false, error: error instanceof Error ? error.message : String(error)}
        }
    })

    // 创建新分类
    ipcMain.handle('clipboard:create-category', async (event, name: string, type: 'text' | 'image' | 'file' | 'mixed') => {
        try {
            // 简单实现：分类名即为ID
            return {
                success: true,
                category: {id: name, name, type, itemCount: 0, createdAt: Date.now(), updatedAt: Date.now()}
            }
        } catch (error) {
            return {success: false, error: error instanceof Error ? error.message : String(error)}
        }
    })

    // 更新项目分类
    ipcMain.handle('clipboard:update-item-category', async (event, itemId: string, categoryId: string) => {
        try {
            const itemIndex = archiveItems.findIndex(item => item.id === itemId)
            if (itemIndex !== -1) {
                archiveItems[itemIndex].category = categoryId
                return {success: true}
            }
            return {success: false, error: 'Item not found'}
        } catch (error) {
            return {success: false, error: error instanceof Error ? error.message : String(error)}
        }
    })

    // 更新项目标签
    ipcMain.handle('clipboard:update-item-tags', async (event, itemId: string, tags: string[]) => {
        try {
            const itemIndex = archiveItems.findIndex(item => item.id === itemId)
            if (itemIndex !== -1) {
                archiveItems[itemIndex].tags = tags
                return {success: true}
            }
            return {success: false, error: 'Item not found'}
        } catch (error) {
            return {success: false, error: error instanceof Error ? error.message : String(error)}
        }
    })

    // 更新项目描述
    ipcMain.handle('clipboard:update-item-description', async (event, itemId: string, description: string) => {
        try {
            const itemIndex = archiveItems.findIndex(item => item.id === itemId)
            if (itemIndex !== -1) {
                archiveItems[itemIndex].description = description
                return {success: true}
            }
            return {success: false, error: 'Item not found'}
        } catch (error) {
            return {success: false, error: error instanceof Error ? error.message : String(error)}
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
                return {success: true}
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

                return {success: true}
            }

            return {success: false, error: 'Item not found'}
        } catch (error) {
            return {success: false, error: error instanceof Error ? error.message : String(error)}
        }
    })

    // 创建临时文件用于拖拽
    ipcMain.handle('clipboard:create-temp-file', async (event, item: ClipboardItem) => {
        try {
            if (item.type !== 'image' || !item.preview) {
                return {success: false, error: 'Only image items can be dragged'}
            }

            const fs = require('fs')
            const path = require('path')
            const os = require('os')

            // 创建临时目录
            const tempDir = path.join(os.tmpdir(), 'n-clip-drag')
            if (!fs.existsSync(tempDir)) {
                fs.mkdirSync(tempDir, {recursive: true})
            }

            // 生成临时文件名
            const timestamp = Date.now()
            const tempFilePath = path.join(tempDir, `image_${timestamp}.png`)

            // 将Base64数据转换为文件
            const base64Data = item.preview.replace(/^data:image\/[a-z]+;base64,/, '')
            const buffer = Buffer.from(base64Data, 'base64')

            fs.writeFileSync(tempFilePath, buffer)

            console.log('Created temp file for drag:', tempFilePath)
            return {success: true, filePath: tempFilePath}
        } catch (error) {
            console.error('Failed to create temp file:', error)
            return {success: false, error: error instanceof Error ? error.message : String(error)}
        }
    })


    // Accessibility handlers
    ipcMain.handle('accessibility:check-permission', async () => {
        return true
    })

    // Window handlers
    ipcMain.handle('window:get-bounds', async () => {
        return win ? win.getBounds() : {x: 100, y: 100, width: 800, height: 600}
    })

    ipcMain.handle('window:set-bounds', async (event, bounds) => {
        if (win) {
            win.setBounds(bounds)
        }
    })
}

// 简单直接的logo路径获取
function getLogoResourcePath(): string {
    if (process.env.VITE_DEV_SERVER_URL) {
        return path.join(process.cwd(), 'public', 'logo.png')
    } else {
        // 生产环境：extraFiles配置直接复制到Resources根目录
        return path.join(process.resourcesPath, 'logo.png')
    }
}

// 强化的权限检查和诊断系统
async function checkAndRequestPermissions() {
    if (process.platform !== 'darwin') {
        return true // 非macOS平台直接返回
    }

    try {
        // 检查辅助功能权限
        const {systemPreferences} = require('electron')
        const hasAccessibilityPermission = systemPreferences.isTrustedAccessibilityClient(false)

        console.log('=== 权限诊断 ===')
        console.log('辅助功能权限状态:', hasAccessibilityPermission)

        if (!hasAccessibilityPermission) {
            console.log('辅助功能权限未授予，智能处理...')

            // 智能权限处理：检查是否是首次运行
            const isFirstRun = !fs.existsSync(path.join(os.homedir(), '.neurora', 'n-clip', 'settings.json'))
            
            if (isFirstRun) {
                console.log('检测到首次运行，显示权限引导对话框')
                
                // 显示权限请求对话框
                const {dialog} = require('electron')
                const result = await dialog.showMessageBox({
                    type: 'warning',
                    title: 'N-Clip 需要辅助功能权限',
                    message: 'N-Clip 需要辅助功能权限才能使用全局快捷键功能。',
                    detail: '点击"打开系统偏好设置"后：\n1. 在弹出的"安全性与隐私"窗口中\n2. 点击左下角的锁图标并输入密码\n3. 在"辅助功能"列表中勾选 N-Clip\n4. 完成后应用将自动重启',
                    buttons: ['打开系统偏好设置', '稍后设置', '应用重启指南'],
                    defaultId: 0,
                    cancelId: 1
                })

                if (result.response === 0) {
                    // 请求权限（这会打开系统偏好设置）
                    systemPreferences.isTrustedAccessibilityClient(true)

                    // 开始监听权限变化
                    startPermissionMonitoring()

                } else if (result.response === 2) {
                    // 显示重启指南
                    await dialog.showMessageBox({
                        type: 'info',
                        title: 'N-Clip 应用重启指南',
                        message: '如果您已经在系统偏好设置中授权了 N-Clip，但功能仍不工作：',
                        detail: '请完全重启应用：\n\n1. 右键点击托盘中的 N-Clip 图标\n2. 选择"退出 N-Clip"\n3. 重新启动 N-Clip 应用\n\n如果托盘图标不可见，请使用 Activity Monitor 强制退出应用。',
                        buttons: ['知道了', '立即退出应用']
                    }).then((restartResult: MessageBoxReturnValue) => {
                        if (restartResult.response === 1) {
                            app.quit()
                        }
                    })
                }
            } else {
                // 非首次运行，静默处理
                console.log('非首次运行，静默处理权限缺失')
                // 通过托盘菜单提示用户，而不是阻塞对话框
                updateTrayMenu() // 更新托盘菜单状态
            }

            return false
        }

        console.log('辅助功能权限已授予')
        return true
    } catch (error) {
        console.error('权限检查错误:', error)
        return false
    }
}

// 权限监听定时器
let permissionCheckInterval: NodeJS.Timeout | null = null

// 开始监听权限变化
function startPermissionMonitoring() {
    if (permissionCheckInterval) {
        clearInterval(permissionCheckInterval)
    }
    
    console.log('开始监听权限变化...')
    
    // 检查macOS版本，优先使用原生Hook
    const osVersion = require('os').release()
    const majorVersion = parseInt(osVersion.split('.')[0])
    
    // Darwin 25.x 对应 macOS 15.4+，支持 ES_EVENT_TYPE_NOTIFY_TCC_MODIFY
    if (majorVersion >= 25) {
        console.log('检测到macOS 15.4+，尝试使用Endpoint Security Hook')
        if (tryEndpointSecurityHook()) {
            return // 成功启用Hook，无需轮询
        }
        console.log('Endpoint Security Hook初始化失败，降级为轮询模式')
    } else {
        console.log('检测到旧版macOS，使用轮询模式')
    }
    
    // 降级为轮询模式
    startPollingMode()
}

// 尝试使用Endpoint Security Hook
function tryEndpointSecurityHook(): boolean {
    try {
        // 这里需要原生模块支持，暂时返回false降级为轮询
        // TODO: 实现真正的Endpoint Security客户端
        console.log('Endpoint Security需要原生模块支持，当前降级为轮询')
        return false
    } catch (error) {
        console.error('Endpoint Security Hook初始化失败:', error)
        return false
    }
}

// 轮询模式
function startPollingMode() {
    let checkCount = 0
    const maxChecks = 60 // 最多检查2分钟 (60 * 2秒 = 120秒)
    
    permissionCheckInterval = setInterval(async () => {
        const {systemPreferences} = require('electron')
        const hasAccessibilityPermission = systemPreferences.isTrustedAccessibilityClient(false)
        
        checkCount++
        
        if (hasAccessibilityPermission) {
            console.log('检测到权限已授予，准备重启应用')
            
            // 停止监听
            if (permissionCheckInterval) {
                clearInterval(permissionCheckInterval)
                permissionCheckInterval = null
            }
            
            await showRestartDialog()
        } else if (checkCount >= maxChecks) {
            // 2分钟后停止检查，避免无限轮询
            console.log('权限检查超时，停止监听')
            if (permissionCheckInterval) {
                clearInterval(permissionCheckInterval)
                permissionCheckInterval = null
            }
        }
    }, 2000) // 每2秒检查一次
}

// 显示重启确认对话框
async function showRestartDialog() {
    const {dialog} = require('electron')
    const result = await dialog.showMessageBox({
        type: 'success',
        title: '权限授权成功',
        message: '检测到辅助功能权限已授予，是否立即重启应用以启用全部功能？',
        detail: '重启后，N-Clip 将支持全局快捷键和所有高级功能。',
        buttons: ['立即重启', '稍后手动重启'],
        defaultId: 0
    })
    
    if (result.response === 0) {
        // 自动重启应用
        app.relaunch()
        app.exit()
    }
}

// 权限重新检查和重新初始化
async function recheckPermissionsAndReinitialize() {
    console.log('=== 重新检查权限并重新初始化 ===')

    const hasPermissions = await checkAndRequestPermissions()
    if (hasPermissions) {
        // 重新注册全局快捷键
        globalShortcut.unregisterAll()
        registerGlobalShortcuts()

        // 重新创建托盘（如果需要）
        if (!tray || tray.isDestroyed()) {
            createTray()
        } else {
            updateTrayMenu()
        }

        console.log('权限重新检查完成，功能已重新初始化')
        return true
    }

    return false
}

// 收集系统诊断信息
async function getDiagnosticInfo() {
    const info = []

    try {
        // 基本信息
        info.push('=== N-Clip 系统诊断信息 ===')
        info.push(`时间: ${new Date().toLocaleString()}`)
        info.push(`平台: ${process.platform} ${process.arch}`)
        info.push(`Electron 版本: ${process.versions.electron}`)
        info.push(`Node.js 版本: ${process.versions.node}`)
        info.push('')

        // 权限状态
        if (process.platform === 'darwin') {
            const {systemPreferences} = require('electron')
            const hasAccessibility = systemPreferences.isTrustedAccessibilityClient(false)
            info.push('=== macOS 权限状态 ===')
            info.push(`辅助功能权限: ${hasAccessibility ? '✅ 已授权' : '❌ 未授权'}`)
            info.push('')
        }

        // 快捷键状态
        info.push('=== 快捷键状态 ===')
        const shortcuts = [
            'CommandOrControl+Shift+V',
            'CommandOrControl+Option+V',
            'CommandOrControl+Shift+C',
            'CommandOrControl+Alt+V',
            'CommandOrControl+Shift+X'
        ]

        for (const shortcut of shortcuts) {
            const isRegistered = globalShortcut.isRegistered(shortcut)
            info.push(`${shortcut}: ${isRegistered ? '✅ 已注册' : '❌ 未注册'}`)
        }
        info.push('')

        // 托盘状态
        info.push('=== 托盘状态 ===')
        info.push(`托盘存在: ${tray ? '✅ 是' : '❌ 否'}`)
        if (tray) {
            info.push(`托盘已销毁: ${tray.isDestroyed() ? '❌ 是' : '✅ 否'}`)
            info.push(`托盘标题: ${tray.getTitle?.() || 'N/A'}`)
        }
        info.push('')

        // 窗口状态
        info.push('=== 窗口状态 ===')
        info.push(`主窗口存在: ${win ? '✅ 是' : '❌ 否'}`)
        if (win) {
            info.push(`窗口已销毁: ${win.isDestroyed() ? '❌ 是' : '✅ 否'}`)
            info.push(`窗口可见: ${win.isVisible() ? '✅ 是' : '❌ 否'}`)
            info.push(`窗口准备就绪: ${windowReady ? '✅ 是' : '❌ 否'}`)
            const bounds = win.getBounds()
            info.push(`窗口位置: ${bounds.x}, ${bounds.y}`)
            info.push(`窗口大小: ${bounds.width} x ${bounds.height}`)
        }
        info.push('')

        // 数据状态
        info.push('=== 数据状态 ===')
        info.push(`剪切板历史条目: ${clipboardHistory.length}`)
        info.push(`档案库条目: ${archiveItems.length}`)
        info.push(`数据目录: ${APP_DATA_PATH}`)
        info.push(`数据目录存在: ${fs.existsSync(APP_DATA_PATH) ? '✅ 是' : '❌ 否'}`)
        info.push('')

        // 环境信息
        info.push('=== 环境信息 ===')
        info.push(`开发模式: ${VITE_DEV_SERVER_URL ? '✅ 是' : '❌ 否'}`)
        info.push(`VITE_PUBLIC: ${process.env.VITE_PUBLIC || 'N/A'}`)
        info.push(`APP_ROOT: ${process.env.APP_ROOT || 'N/A'}`)
        info.push(`__dirname: ${__dirname}`)
        info.push('')

        // 最近的错误（如果有的话）
        info.push('=== 其他信息 ===')
        info.push(`进程 PID: ${process.pid}`)
        info.push(`内存使用: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)} MB`)

    } catch (error) {
        info.push(`诊断信息收集时出错: ${error}`)
    }

    return info.join('\n')
}

app.whenReady().then(async () => {
    // 设置应用为辅助应用，不在Dock中显示
    app.dock?.hide()

    try {
        console.log('=== 应用启动优化模式 ===')
        
        // 第一阶段：核心初始化（非阻塞）
        console.log('第一阶段：核心初始化')
        await initDataStorage()
        registerIpcHandlers()
        
        // 第二阶段：UI初始化（快速显示）
        console.log('第二阶段：UI初始化')
        await createWindow()
        createTray()
        
        // 第三阶段：数据加载（并行）
        console.log('第三阶段：数据加载')
        await Promise.all([
            loadClipboardHistory(),
            loadArchiveItems()
        ])
        
        // 第四阶段：启动监听器
        console.log('第四阶段：启动监听器')
        startClipboardWatcher()
        
        // 第五阶段：权限检查（延迟非阻塞）
        console.log('第五阶段：权限检查（延迟）')
        setTimeout(async () => {
            try {
                const hasPermissions = await checkAndRequestPermissions()
                if (hasPermissions) {
                    registerGlobalShortcuts()
                    console.log('Global shortcuts registered with permissions')
                } else {
                    console.log('Global shortcuts skipped - no accessibility permission')
                }
            } catch (error) {
                console.error('权限检查失败:', error)
            }
        }, 1000) // 1秒延迟，让应用先完全启动
        
        console.log('Application startup completed (快速模式)')
    } catch (error) {
        console.error('Failed to initialize application:', error)
    }

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
    // 清理权限监听
    if (permissionCheckInterval) {
        clearInterval(permissionCheckInterval)
        permissionCheckInterval = null
    }
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