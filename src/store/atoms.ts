import { atom } from 'jotai'
import { atomWithStorage } from 'jotai/utils'

// 窗口位置状态
export interface WindowPosition {
  x: number
  y: number
  width: number
  height: number
}

// 使用 localStorage 持久化窗口位置
export const windowPositionAtom = atomWithStorage<WindowPosition>('n-clip-window-position', {
  x: 0,
  y: 0,
  width: 640,
  height: 480
})

// 设置窗口位置状态
export const settingsWindowPositionAtom = atomWithStorage<WindowPosition>('n-clip-settings-window-position', {
  x: 100,
  y: 100,
  width: 800,
  height: 600
})

// 窗口显示状态
export const windowVisibleAtom = atom(false)

// 搜索查询状态
export const searchQueryAtom = atom('')

// 选中项目索引
export const selectedIndexAtom = atom(0)

// 剪切板项目状态
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

export const clipboardItemsAtom = atom<ClipboardItem[]>([])

// 主历史项目（非star项目）- 保持纯净的FIFO
export const mainHistoryItemsAtom = atom((get) => {
  const items = get(clipboardItemsAtom)
  
  // 只显示未收藏的项目，严格按时间倒序
  return items
    .filter(item => !item.isStarred)
    .sort((a, b) => b.timestamp - a.timestamp)
})

// 档案库项目（star项目）- 按分类和收藏时间排序
export const starredItemsAtom = atom((get) => {
  const items = get(clipboardItemsAtom)
  
  // 只显示已收藏的项目
  return items
    .filter(item => item.isStarred)
    .sort((a, b) => {
      // 先按分类，再按收藏时间
      if (a.category !== b.category) {
        return (a.category || '').localeCompare(b.category || '')
      }
      return (b.starredAt || 0) - (a.starredAt || 0)
    })
})

// 过滤后的项目（派生状态）- 基于主历史
export const filteredItemsAtom = atom((get) => {
  const items = get(mainHistoryItemsAtom)
  const query = get(searchQueryAtom)
  
  if (!query.trim()) {
    return items
  }
  
  return items.filter(item =>
    item.content.toLowerCase().includes(query.toLowerCase())
  )
})

// 重置选中索引当过滤结果改变时
export const resetSelectedIndexAtom = atom(
  null,
  (get, set) => {
    const filteredItems = get(filteredItemsAtom)
    const currentIndex = get(selectedIndexAtom)
    
    if (currentIndex >= filteredItems.length) {
      set(selectedIndexAtom, Math.max(0, filteredItems.length - 1))
    }
  }
)

// 应用设置状态
export interface AppSettings {
  theme: 'light' | 'dark' | 'auto'
  autoStart: boolean
  showNotifications: boolean
  hotkey: string
  maxHistoryItems: number
  autoCleanup: boolean
  storage: {
    textDuration: number
    imageDuration: number
    fileDuration: number
  }
}

// 使用 localStorage 持久化设置
export const settingsAtom = atomWithStorage<AppSettings>('n-clip-settings', {
  theme: 'auto',
  autoStart: false,
  showNotifications: true,
  hotkey: 'CommandOrControl+Shift+C',
  maxHistoryItems: 1000,
  autoCleanup: true,
  storage: {
    textDuration: 7,
    imageDuration: 3,
    fileDuration: 1
  }
})