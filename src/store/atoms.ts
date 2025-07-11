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
}

export const clipboardItemsAtom = atom<ClipboardItem[]>([])

// 过滤后的项目（派生状态）
export const filteredItemsAtom = atom((get) => {
  const items = get(clipboardItemsAtom)
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