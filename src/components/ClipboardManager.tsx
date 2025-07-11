import { useEffect, useRef, useState } from 'react'
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
  const [fullscreenImage, setFullscreenImage] = useState<ClipboardItem | null>(null)

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

  // 处理鼠标按下事件（用于拖拽）
  const handleMouseDown = async (e: React.MouseEvent, item: ClipboardItem) => {
    if (item.type === 'image' && item.preview && e.button === 0) {
      // 阻止默认行为和文字选择
      e.preventDefault()
      
      // 左键按下，准备拖拽
      let isDragging = false
      const startX = e.clientX
      const startY = e.clientY
      const threshold = 5 // 拖拽阈值
      
      const handleMouseMove = (e: MouseEvent) => {
        const deltaX = Math.abs(e.clientX - startX)
        const deltaY = Math.abs(e.clientY - startY)
        
        if (!isDragging && (deltaX > threshold || deltaY > threshold)) {
          isDragging = true
          // 开始拖拽
          window.clipboardAPI.startDrag(item).catch(console.error)
          // 清理事件监听器
          document.removeEventListener('mousemove', handleMouseMove)
          document.removeEventListener('mouseup', handleMouseUp)
        }
      }
      
      const handleMouseUp = () => {
        // 清理事件监听器
        document.removeEventListener('mousemove', handleMouseMove)
        document.removeEventListener('mouseup', handleMouseUp)
      }
      
      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
    }
  }

  // 删除项目
  const handleDeleteItem = async (item: ClipboardItem) => {
    try {
      await window.clipboardAPI.deleteItem(item.id)
      // 更新本地状态
      setItems(prev => prev.filter(i => i.id !== item.id))
    } catch (error) {
      console.error('Failed to delete item:', error)
    }
  }

  // 切换固定状态
  const handleTogglePin = async (item: ClipboardItem) => {
    try {
      const result = await window.clipboardAPI.togglePin(item.id)
      if (result.success) {
        // 更新本地状态
        setItems(prev => prev.map(i => 
          i.id === item.id ? { ...i, isPinned: result.isPinned } : i
        ).sort((a, b) => {
          // 重新排序：固定项目在前
          if (a.isPinned && !b.isPinned) return -1
          if (!a.isPinned && b.isPinned) return 1
          return b.timestamp - a.timestamp
        }))
      } else if (result.error) {
        console.warn('Pin toggle failed:', result.error)
        // 可以在这里显示错误提示
      }
    } catch (error) {
      console.error('Failed to toggle pin:', error)
    }
  }

  // 打开分享卡片窗口
  const handleShareCard = async (item: ClipboardItem) => {
    try {
      console.log('Opening share card window for item:', item.type, item.id)
      await window.clipboardAPI.openShareCardWindow(item)
    } catch (error) {
      console.error('Failed to open share card window:', error)
    }
  }


  // 处理右键菜单
  const handleContextMenu = (e: React.MouseEvent, item: ClipboardItem) => {
    e.preventDefault()
    // 这里可以显示自定义右键菜单
    console.log('Context menu for item:', item.id)
  }

  // 处理图片全屏预览
  const handleImageFullscreen = (item: ClipboardItem) => {
    if (item.type === 'image') {
      setFullscreenImage(item)
    }
  }

  // 关闭全屏预览
  const handleCloseFullscreen = () => {
    setFullscreenImage(null)
  }

  // 处理全屏预览的键盘事件
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (fullscreenImage && e.key === 'Escape') {
        handleCloseFullscreen()
      }
    }

    if (fullscreenImage) {
      document.addEventListener('keydown', handleKeyDown)
      return () => document.removeEventListener('keydown', handleKeyDown)
    }
  }, [fullscreenImage])

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
                className={`item ${index === selectedIndex ? 'selected' : ''} ${item.type === 'image' ? 'draggable-item' : ''} ${item.isPinned ? 'pinned' : ''}`}
                onClick={() => handleItemSelect(item, index)}
                onMouseDown={(e) => handleMouseDown(e, item)}
                onContextMenu={(e) => handleContextMenu(e, item)}
              >
                <div className="item-icon">
                  {item.type === 'image' && item.preview ? (
                    <img 
                      src={item.preview} 
                      alt="Preview" 
                      className="item-image-preview" 
                      onClick={(e) => {
                        e.stopPropagation()
                        handleImageFullscreen(item)
                      }}
                    />
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
                <div className="item-meta">
                  {item.isPinned && (
                    <div className="item-pin-indicator">📌</div>
                  )}
                  <div className="item-shortcut">
                    {getShortcutKey(index)}
                  </div>
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
                <div className="preview-info">
                  <div className="preview-type">{selectedItem.type}</div>
                  {selectedItem.size && (
                    <div className="preview-size">{selectedItem.size}</div>
                  )}
                </div>
                
                
                <div className="preview-actions">
                  <button 
                    className="action-btn pin-btn"
                    onClick={() => handleTogglePin(selectedItem)}
                    title={selectedItem.isPinned ? "取消固定" : "固定项目"}
                  >
                    {selectedItem.isPinned ? '📌' : '📍'}
                  </button>
                  <button 
                    className="action-btn share-btn"
                    onClick={() => handleShareCard(selectedItem)}
                    title="生成分享卡片"
                  >
                    📤
                  </button>
                  <button 
                    className="action-btn delete-btn"
                    onClick={() => handleDeleteItem(selectedItem)}
                    title="删除"
                  >
                    🗑️
                  </button>
                </div>
              </div>
              
              <div className="preview-content">
                {selectedItem.type === 'image' && selectedItem.preview ? (
                  <img 
                    src={selectedItem.preview} 
                    alt="Preview" 
                    className="preview-image"
                    onMouseDown={(e) => handleMouseDown(e, selectedItem)}
                    onClick={() => handleImageFullscreen(selectedItem)}
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
      
      {/* 全屏图片预览 */}
      {fullscreenImage && (
        <div className="fullscreen-overlay" onClick={handleCloseFullscreen}>
          <div className="fullscreen-content" onClick={(e) => e.stopPropagation()}>
            <button className="fullscreen-close" onClick={handleCloseFullscreen}>
              ✕
            </button>
            <img 
              src={fullscreenImage.preview} 
              alt="Fullscreen Preview" 
              className="fullscreen-image"
              onMouseDown={(e) => handleMouseDown(e, fullscreenImage)}
            />
            <div className="fullscreen-info">
              <div className="fullscreen-title">{fullscreenImage.content}</div>
              <div className="fullscreen-meta">
                {fullscreenImage.size} • {new Date(fullscreenImage.timestamp).toLocaleString()}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}