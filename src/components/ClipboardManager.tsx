import { useEffect, useRef } from 'react'
import { useAtom } from 'jotai'
import { ClipboardItem } from '../types/electron'
import { 
  clipboardItemsAtom, 
  searchQueryAtom, 
  selectedIndexAtom, 
  filteredItemsAtom,
  windowPositionAtom,
  resetSelectedIndexAtom
} from '../store/atoms'
import './ClipboardManager.css'

export default function ClipboardManager() {
  const [items, setItems] = useAtom(clipboardItemsAtom)
  const [searchQuery, setSearchQuery] = useAtom(searchQueryAtom)
  const [selectedIndex, setSelectedIndex] = useAtom(selectedIndexAtom)
  const [filteredItems] = useAtom(filteredItemsAtom)
  const [windowPosition, setWindowPosition] = useAtom(windowPositionAtom)
  const [, resetSelectedIndex] = useAtom(resetSelectedIndexAtom)
  const searchInputRef = useRef<HTMLInputElement>(null)

  // 加载剪切板历史
  useEffect(() => {
    const loadClipboardHistory = async () => {
      try {
        const history = await window.clipboardAPI.getClipboardHistory()
        setItems(history)
      } catch (error) {
        console.error('Failed to load clipboard history:', error)
      }
    }
    
    loadClipboardHistory()
    
    // 监听剪切板变化
    window.clipboardAPI.onClipboardChange((newItem: ClipboardItem) => {
      setItems(prev => [newItem, ...prev])
    })
    
    // 监听剪切板历史更新
    window.clipboardAPI.onClipboardHistoryUpdate((history: ClipboardItem[]) => {
      setItems(history)
    })
    
    return () => {
      window.clipboardAPI.removeClipboardListener()
    }
  }, [setItems])

  // 初始化窗口位置
  useEffect(() => {
    const initWindowPosition = async () => {
      try {
        const bounds = await window.windowAPI.getBounds()
        setWindowPosition(bounds)
      } catch (error) {
        console.error('Failed to load window position:', error)
      }
    }
    
    initWindowPosition()
    
    // 监听窗口位置变化
    window.windowAPI.onBoundsChanged((bounds) => {
      setWindowPosition(bounds)
    })
    
    return () => {
      window.windowAPI.removeWindowListener()
    }
  }, [setWindowPosition])

  // 当搜索结果变化时重置选中索引
  useEffect(() => {
    resetSelectedIndex()
  }, [filteredItems.length, resetSelectedIndex])

  // 键盘导航
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedIndex(prev => Math.min(prev + 1, filteredItems.length - 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedIndex(prev => Math.max(prev - 1, 0))
      } else if (e.key === 'Enter') {
        e.preventDefault()
        if (filteredItems[selectedIndex]) {
          handleItemSelect(filteredItems[selectedIndex], selectedIndex)
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [filteredItems, selectedIndex])

  // 自动聚焦搜索框和失焦隐藏
  useEffect(() => {
    if (searchInputRef.current) {
      searchInputRef.current.focus()
    }
    
    // 监听窗口失焦事件
    const handleBlur = () => {
      window.windowAPI.hideWindow()
    }
    
    window.addEventListener('blur', handleBlur)
    
    return () => {
      window.removeEventListener('blur', handleBlur)
    }
  }, [])

  // 选择项目
  const handleItemSelect = async (item: ClipboardItem, index: number) => {
    try {
      // 更新选中索引
      setSelectedIndex(index)
      
      await window.clipboardAPI.setClipboardContent(item)
      console.log('Content copied to clipboard:', item.content)
    } catch (error) {
      console.error('Failed to copy to clipboard:', error)
    }
  }

  // 获取项目图标
  const getItemIcon = (type: string) => {
    switch (type) {
      case 'image':
        return '🖼️'
      case 'file':
        return '📁'
      default:
        return '📄'
    }
  }

  // 获取快捷键显示
  const getShortcutKey = (index: number) => {
    if (index < 9) return `⌘${index + 1}`
    return ''
  }

  // 获取当前选中项目
  const selectedItem = filteredItems[selectedIndex]

  return (
    <div className="clipboard-manager">
      <div className="header">
        <div className="search-container">
          <div className="search-icon">🔍</div>
          <input
            ref={searchInputRef}
            type="text"
            placeholder="All Snippets"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="search-input"
          />
        </div>
      </div>
      
      <div className="main-content">
        <div className="left-panel">
          <div className="items-container">
            {filteredItems.map((item, index) => (
              <div
                key={item.id}
                className={`item ${index === selectedIndex ? 'selected' : ''}`}
                onClick={() => handleItemSelect(item, index)}
              >
                <div className="item-icon">
                  {item.type === 'image' && item.preview ? (
                    <img src={item.preview} alt="Preview" className="item-image-preview" />
                  ) : (
                    getItemIcon(item.type)
                  )}
                </div>
                <div className="item-content">
                  <div className="item-text">{item.content}</div>
                  {item.size && (
                    <div className="item-size">{item.size}</div>
                  )}
                </div>
                <div className="item-shortcut">
                  {getShortcutKey(index)}
                </div>
              </div>
            ))}
            
            {filteredItems.length === 0 && (
              <div className="no-results">
                No items found
              </div>
            )}
          </div>
        </div>
        
        <div className="right-panel">
          {selectedItem ? (
            <div className="preview-container">
              <div className="preview-header">
                <div className="preview-type">{selectedItem.type}</div>
                {selectedItem.size && (
                  <div className="preview-size">{selectedItem.size}</div>
                )}
              </div>
              
              <div className="preview-content">
                {selectedItem.type === 'image' && selectedItem.preview ? (
                  <img 
                    src={selectedItem.preview} 
                    alt="Preview" 
                    className="preview-image"
                  />
                ) : (
                  <div className="preview-text">{selectedItem.content}</div>
                )}
              </div>
              
              <div className="preview-footer">
                <div className="preview-timestamp">
                  {new Date(selectedItem.timestamp).toLocaleString()}
                </div>
              </div>
            </div>
          ) : (
            <div className="preview-placeholder">
              <div className="placeholder-icon">📋</div>
              <div className="placeholder-text">Select an item to preview</div>
            </div>
          )}
        </div>
      </div>
      
      <div className="footer">
        <div className="branding">
          <span className="brand-name">NClip</span>
          <span className="brand-tagline">Copy. Paste. Repeat.</span>
        </div>
      </div>
    </div>
  )
}