import { useEffect, useRef, useState } from 'react'
import { useAtom } from 'jotai'
import { ClipboardItem } from '../types/electron'
import { 
  clipboardItemsAtom, 
  searchQueryAtom, 
  selectedIndexAtom, 
  filteredItemsAtom,
  mainHistoryItemsAtom,
  starredItemsAtom,
  windowPositionAtom,
  resetSelectedIndexAtom
} from '../store/atoms'
import PermissionDialog from './PermissionDialog'
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
  const [showPermissionDialog, setShowPermissionDialog] = useState(false)
  const [hasAccessibilityPermission, setHasAccessibilityPermission] = useState(false)


  // 加载剪切板历史和检查权限
  useEffect(() => {
    const loadClipboardHistory = async () => {
      try {
        const history = await window.clipboardAPI.getClipboardHistory()
        // 直接设置历史数据，排序由atoms处理
        setItems(history)
      } catch (error) {
        console.error('Failed to load clipboard history:', error)
      }
    }
    
    const checkAccessibilityPermission = async () => {
      try {
        const hasPermission = await window.accessibilityAPI.checkPermission()
        setHasAccessibilityPermission(hasPermission)
        
        // 如果没有权限，显示权限对话框（仅在首次启动时）
        if (!hasPermission) {
          // 可以通过 localStorage 来控制是否显示权限对话框
          const hasShownPermissionDialog = localStorage.getItem('hasShownPermissionDialog')
          if (!hasShownPermissionDialog) {
            setShowPermissionDialog(true)
            localStorage.setItem('hasShownPermissionDialog', 'true')
          }
        }
      } catch (error) {
        console.error('Failed to check accessibility permission:', error)
      }
    }
    
    loadClipboardHistory()
    checkAccessibilityPermission()
    
    // 监听剪切板变化
    window.clipboardAPI.onClipboardChange((newItem: ClipboardItem) => {
      setItems(prev => {
        // 添加新项目，排序由atoms处理
        return [newItem, ...prev]
      })
    })
    
    // 监听剪切板历史更新
    window.clipboardAPI.onClipboardHistoryUpdate((history: ClipboardItem[]) => {
      // 直接设置历史数据，排序由atoms处理
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

  // 监听主进程发送的导航事件
  useEffect(() => {
    window.clipboardAPI.onNavigateItems((direction: 'up' | 'down') => {
      if (direction === 'down') {
        setSelectedIndex(prev => Math.min(prev + 1, filteredItems.length - 1))
      } else if (direction === 'up') {
        setSelectedIndex(prev => Math.max(prev - 1, 0))
      }
    })
    
    window.clipboardAPI.onSelectCurrentItem(() => {
      if (filteredItems[selectedIndex]) {
        handleItemSelectAndClose(filteredItems[selectedIndex], selectedIndex)
      }
    })
    
    window.clipboardAPI.onDeleteCurrentItem(() => {
      if (filteredItems[selectedIndex]) {
        handleDeleteItem(filteredItems[selectedIndex])
      }
    })
    
    
    window.clipboardAPI.onToggleStar(() => {
      if (filteredItems[selectedIndex]) {
        handleToggleStar(filteredItems[selectedIndex])
      }
    })
    
    window.clipboardAPI.onOpenArchive(() => {
      console.log('Global shortcut A pressed - opening archive')
      handleOpenArchive()
    })
    
    return () => {
      window.clipboardAPI.removeGlobalKeyboardListeners()
    }
  }, [filteredItems, selectedIndex])

  // 本地键盘事件处理（备用，只在窗口有焦点时响应）
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // 忽略修饰键组合，避免冲突
      if (e.metaKey || e.ctrlKey || e.altKey) {
        return
      }

      // 如果焦点在搜索框内，某些键让搜索框处理
      if (document.activeElement === searchInputRef.current) {
        // 在搜索框中，只处理导航键，让文本输入正常工作
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === 'Escape') {
          // 导航键由我们处理
        } else {
          // 其他键让搜索框正常处理
          return
        }
      }

      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedIndex(prev => Math.min(prev + 1, filteredItems.length - 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedIndex(prev => Math.max(prev - 1, 0))
      } else if (e.key === 'Enter') {
        e.preventDefault()
        if (filteredItems[selectedIndex]) {
          handleItemSelectAndClose(filteredItems[selectedIndex], selectedIndex)
        }
      } else if (e.key === 'Escape') {
        e.preventDefault()
        window.windowAPI.hideWindow()
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        // 只有当焦点不在搜索框时才删除项目
        if (document.activeElement !== searchInputRef.current && filteredItems[selectedIndex]) {
          e.preventDefault()
          handleDeleteItem(filteredItems[selectedIndex])
        }
      } else if (e.key === 's' || e.key === 'S') {
        // S键：Star/Unstar当前项目
        if (document.activeElement !== searchInputRef.current && filteredItems[selectedIndex]) {
          e.preventDefault()
          handleToggleStar(filteredItems[selectedIndex])
        }
      } else if (e.key === 'a' || e.key === 'A') {
        // A键：打开档案库窗口
        if (document.activeElement !== searchInputRef.current) {
          e.preventDefault()
          console.log('DEBUG: A key pressed, opening archive window')
          handleOpenArchive()
        }
      } else if (e.key === 'Tab') {
        // Tab键可以用于切换预览或其他功能
        if (document.activeElement !== searchInputRef.current) {
          e.preventDefault()
          console.log('Toggle preview or other Tab functionality')
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [filteredItems, selectedIndex])

  // 自动聚焦搜索框
  useEffect(() => {
    if (searchInputRef.current) {
      searchInputRef.current.focus()
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

  // 选择项目并关闭窗口（更新版本）
  const handleItemSelectAndClose = async (item: ClipboardItem, index: number) => {
    try {
      // 更新选中索引
      setSelectedIndex(index)
      
      // 使用新的粘贴选中项目方法
      const pasteResult = await window.clipboardAPI.pasteSelectedItem(item)
      if (pasteResult.success) {
        console.log(`Content pasted to active app using ${pasteResult.method}`)
      } else {
        console.error('Failed to paste to active app:', pasteResult.error)
      }
    } catch (error) {
      console.error('Failed to paste selected item:', error)
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


  // 打开档案库
  const handleOpenArchive = async () => {
    console.log('=== DEBUG: handleOpenArchive START ===')
    try {
      console.log('DEBUG: About to call window.clipboardAPI.openArchiveWindow()')
      
      if (!window.clipboardAPI) {
        console.error('DEBUG: window.clipboardAPI is not available!')
        return
      }
      
      if (!window.clipboardAPI.openArchiveWindow) {
        console.error('DEBUG: window.clipboardAPI.openArchiveWindow is not available!')
        return
      }
      
      console.log('DEBUG: API is available, making call...')
      const result = await window.clipboardAPI.openArchiveWindow()
      console.log('DEBUG: Archive window API result:', result)
      
      if (result && result.success) {
        console.log('DEBUG: Archive window opened successfully!')
      } else if (result && !result.success) {
        console.error('DEBUG: Archive window failed to open:', result.error)
      } else {
        console.warn('DEBUG: Unexpected result format:', result)
      }
    } catch (error) {
      console.error('DEBUG: Exception in handleOpenArchive:', error)
      console.error('DEBUG: Error stack:', error instanceof Error ? error.stack : 'No stack')
    }
    console.log('=== DEBUG: handleOpenArchive END ===')
  }

  // Star/Unstar项目
  const handleToggleStar = async (item: ClipboardItem) => {
    try {
      if (item.isStarred) {
        // Unstar项目
        const result = await window.clipboardAPI.unstarItem(item.id)
        if (result.success) {
          setItems(prev => prev.map(i => 
            i.id === item.id ? { ...i, isStarred: false, starredAt: undefined, category: 'default' } : i
          ))
          console.log('Item unstarred successfully')
        } else {
          console.error('Failed to unstar item:', result.error)
        }
      } else {
        // Star项目 - 使用默认分类
        const result = await window.clipboardAPI.starItem(item.id, 'mixed-favorites')
        if (result.success) {
          setItems(prev => prev.map(i => 
            i.id === item.id ? { 
              ...i, 
              isStarred: true, 
              starredAt: Date.now(), 
              category: 'mixed-favorites' 
            } : i
          ))
          console.log('Item starred successfully')
        } else {
          console.error('Failed to star item:', result.error)
        }
      }
    } catch (error) {
      console.error('Failed to toggle star:', error)
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

  // 权限对话框处理函数
  const handlePermissionDialogClose = () => {
    setShowPermissionDialog(false)
  }

  const handlePermissionGranted = () => {
    setHasAccessibilityPermission(true)
    setShowPermissionDialog(false)
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
            onKeyDown={(e) => {
              // 让导航键传递到全局处理器
              if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === 'Escape') {
                // 不阻止事件，让它继续冒泡到全局处理器
                return
              }
            }}
            className="search-input"
          />
        </div>
        <div className="header-actions">
          <button
            className="archive-btn"
            onClick={handleOpenArchive}
            title="打开档案库 (A键)"
          >
            📚 档案库
          </button>
        </div>
      </div>
      
      <div className="main-content">
        <div className="left-panel">
          <div className="items-container">
            {filteredItems.map((item, index) => (
              <div
                key={item.id}
                data-item-id={item.id}
                className={`item ${index === selectedIndex ? 'selected' : ''} ${item.type === 'image' ? 'draggable-item' : ''} ${item.isStarred ? 'starred' : ''}`}
                onClick={() => handleItemSelectAndClose(item, index)}
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
                  <div className="item-text">
                    {item.content}
                    {item.size && (
                      <span className="item-size-inline"> · {item.size}</span>
                    )}
                  </div>
                </div>
                <div className="item-meta">
                  {item.isStarred && (
                    <div className="item-star-indicator">⭐</div>
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
                  <div className="action-buttons">
                    <button 
                      className="action-btn star-btn"
                      onClick={() => handleToggleStar(selectedItem)}
                      title={selectedItem.isStarred ? "取消收藏" : "收藏到档案库 (S键)"}
                    >
                      {selectedItem.isStarred ? '⭐' : '☆'}
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
      
      {/* 权限对话框 */}
      <PermissionDialog
        isOpen={showPermissionDialog}
        onClose={handlePermissionDialogClose}
        onPermissionGranted={handlePermissionGranted}
      />
    </div>
  )
}