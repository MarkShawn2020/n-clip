import { useEffect, useState, useCallback } from 'react'
import { ClipboardItem } from '../types/electron'
import { ContentType, EnhancedClipboardItem } from '../types/archive-types'
import ContentTypeNavigator from './ContentTypeNavigator'
import ImageWaterfallLayout from './layouts/ImageWaterfallLayout'
import TextListLayout from './layouts/TextListLayout'
import AudioListLayout from './layouts/AudioListLayout'
import VideoGridLayout from './layouts/VideoGridLayout'
import './ArchiveLibrary.css'

interface ArchiveCategory {
  id: string
  name: string
  type: 'text' | 'image' | 'file' | 'mixed'
  itemCount: number
  createdAt: number
  updatedAt: number
}

interface ArchiveLibraryProps {
  onClose?: () => void
}

export default function ArchiveLibrary({ onClose }: ArchiveLibraryProps) {
  const [starredItems, setStarredItems] = useState<ClipboardItem[]>([])
  const [categories, setCategories] = useState<ArchiveCategory[]>([])
  const [selectedCategory, setSelectedCategory] = useState<string>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedContentType, setSelectedContentType] = useState<ContentType | 'all'>('all')
  const [filteredItems, setFilteredItems] = useState<EnhancedClipboardItem[]>([])
  const [displayItems, setDisplayItems] = useState<EnhancedClipboardItem[]>([])
  const [showLegacyView, setShowLegacyView] = useState(false)

  console.log('DEBUG ArchiveLibrary: Rendering with', {
    starredItemsCount: starredItems.length,
    categoriesCount: categories.length,
    selectedCategory,
    filteredItemsCount: filteredItems.length
  })

  // 加载档案库数据
  useEffect(() => {
    const loadArchiveData = async () => {
      try {
        // 加载分类数据
        const categoriesResult = await window.clipboardAPI.getCategories()
        if (categoriesResult.success) {
          setCategories(categoriesResult.categories)
        }
        
        // 加载收藏项目数据
        const itemsResult = await window.clipboardAPI.getStarredItems()
        if (itemsResult.success) {
          setStarredItems(itemsResult.items)
          console.log('DEBUG: Loaded starred items:', itemsResult.items)
        }
      } catch (error) {
        console.error('Failed to load archive data:', error)
      }
    }
    
    loadArchiveData()
  }, [])

  // Handle content type filtering from ContentTypeNavigator
  const handleItemsFiltered = useCallback((items: EnhancedClipboardItem[]) => {
    setFilteredItems(items)
  }, [])

  // Apply search and category filtering to the content-type filtered items
  useEffect(() => {
    let filtered = filteredItems

    // 按分类过滤
    if (selectedCategory !== 'all') {
      filtered = filtered.filter(item => item.category === selectedCategory)
    }

    // 按搜索查询过滤
    if (searchQuery.trim()) {
      filtered = filtered.filter(item =>
        item.content.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (item.description && item.description.toLowerCase().includes(searchQuery.toLowerCase()))
      )
    }

    setDisplayItems(filtered)
  }, [filteredItems, selectedCategory, searchQuery])

  const handleItemClick = async (item: EnhancedClipboardItem) => {
    try {
      await window.clipboardAPI.setClipboardContent(item)
      console.log('Content copied to clipboard:', item.content)
      onClose?.() // 关闭档案库
    } catch (error) {
      console.error('Failed to copy to clipboard:', error)
    }
  }

  const handleItemUnstar = async (item: EnhancedClipboardItem) => {
    try {
      // 对于档案库项目，我们需要使用originalId来取消收藏
      // 但是这里item可能有originalId字段，或者需要直接删除档案库项目
      const result = await window.clipboardAPI.deleteItem(item.id)
      if (result.success) {
        console.log('Item unstarred successfully')
        // 从本地状态中移除
        setStarredItems(prev => prev.filter(i => i.id !== item.id))
      } else {
        console.error('Failed to unstar item:', result.error)
      }
    } catch (error) {
      console.error('Failed to unstar item:', error)
    }
  }

  // Render content layout based on selected content type
  const renderContentLayout = () => {
    if (showLegacyView) {
      return renderLegacyLayout()
    }

    if (displayItems.length === 0) {
      return (
        <div className="empty-state">
          <div className="empty-icon">⭐</div>
          <div className="empty-title">
            {searchQuery ? '没有找到匹配的内容' : '还没有收藏任何内容'}
          </div>
          <div className="empty-description">
            {searchQuery ? '尝试修改搜索条件' : '在主界面中点击⭐按钮来收藏重要的剪切板内容'}
          </div>
        </div>
      )
    }

    // Filter items by content type for specialized layouts
    const contentTypeItems = selectedContentType === 'all' 
      ? displayItems 
      : displayItems.filter(item => item.contentType === selectedContentType)

    switch (selectedContentType) {
      case 'image':
        return (
          <ImageWaterfallLayout
            items={contentTypeItems}
            onItemClick={handleItemClick}
            onItemUnstar={handleItemUnstar}
          />
        )
      case 'text':
        return (
          <TextListLayout
            items={contentTypeItems}
            onItemClick={handleItemClick}
            onItemUnstar={handleItemUnstar}
          />
        )
      case 'audio':
        return (
          <AudioListLayout
            items={contentTypeItems}
            onItemClick={handleItemClick}
            onItemUnstar={handleItemUnstar}
          />
        )
      case 'video':
        return (
          <VideoGridLayout
            items={contentTypeItems}
            onItemClick={handleItemClick}
            onItemUnstar={handleItemUnstar}
          />
        )
      case 'document':
      case 'other':
        return (
          <TextListLayout
            items={contentTypeItems}
            onItemClick={handleItemClick}
            onItemUnstar={handleItemUnstar}
          />
        )
      case 'all':
      default:
        // For 'all', show mixed layout or default to legacy
        return renderLegacyLayout()
    }
  }

  // Legacy layout renderer for backward compatibility and 'all' view
  const renderLegacyLayout = () => {
    return (
      <div className="items-grid">
        {displayItems.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">⭐</div>
            <div className="empty-title">还没有收藏任何内容</div>
            <div className="empty-description">
              在主界面中点击⭐按钮来收藏重要的剪切板内容
            </div>
          </div>
        ) : (
          displayItems.map(item => (
            <div key={item.id} className="archive-item" onClick={() => handleItemClick(item)}>
              <div className="item-header">
                <span className="item-icon">{getItemIcon(item.type)}</span>
                <div className="item-meta">
                  <span className="item-time">{formatTimestamp(item.starredAt || item.timestamp)}</span>
                  <button 
                    className="unstar-btn"
                    onClick={(e) => {
                      e.stopPropagation()
                      handleItemUnstar(item)
                    }}
                    title="取消收藏"
                  >
                    ⭐
                  </button>
                </div>
              </div>
              
              <div className="item-content">
                {item.type === 'image' && item.preview ? (
                  <img src={item.preview} alt="Preview" className="item-image" />
                ) : (
                  <div className="item-text">
                    {item.content.substring(0, 200)}
                    {item.content.length > 200 && '...'}
                  </div>
                )}
              </div>
              
              {item.description && (
                <div className="item-description">
                  {item.description}
                </div>
              )}
              
              {item.tags && item.tags.length > 0 && (
                <div className="item-tags">
                  {item.tags.map(tag => (
                    <span key={tag} className="tag">{tag}</span>
                  ))}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    )
  }

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

  const getCategoryIcon = (type: string) => {
    switch (type) {
      case 'text':
        return '📄'
      case 'image':
        return '🖼️'
      case 'file':
        return '📁'
      default:
        return '📚'
    }
  }

  const formatTimestamp = (timestamp: number) => {
    const date = new Date(timestamp)
    const now = new Date()
    const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24))
    
    if (diffDays === 0) {
      return '今天'
    } else if (diffDays === 1) {
      return '昨天'
    } else if (diffDays < 7) {
      return `${diffDays}天前`
    } else {
      return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
    }
  }

  return (
    <div className="archive-library">
      <div className="archive-header">
        <div className="archive-title">
          {onClose && (
            <button className="back-btn" onClick={onClose}>
              ← 返回主界面
            </button>
          )}
          <h2>📚 我的档案库</h2>
          <div className="view-toggle">
            <button 
              className={`toggle-btn ${!showLegacyView ? 'active' : ''}`}
              onClick={() => setShowLegacyView(false)}
              title="增强视图"
            >
              🎨
            </button>
            <button 
              className={`toggle-btn ${showLegacyView ? 'active' : ''}`}
              onClick={() => setShowLegacyView(true)}
              title="经典视图"
            >
              📋
            </button>
          </div>
        </div>
        <div className="archive-search">
          <input
            type="text"
            placeholder="在档案库中搜索..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="search-input"
          />
        </div>
      </div>

      {/* Content Type Navigator - only show in enhanced view */}
      {!showLegacyView && (
        <ContentTypeNavigator
          items={starredItems}
          selectedContentType={selectedContentType}
          onContentTypeChange={setSelectedContentType}
          onItemsFiltered={handleItemsFiltered}
        />
      )}

      <div className="archive-content">
        {/* Category sidebar - show in both views but modify behavior */}
        <div className={`category-sidebar ${showLegacyView ? 'legacy' : 'enhanced'}`}>
          <div className="category-list">
            <div 
              className={`category-item ${selectedCategory === 'all' ? 'active' : ''}`}
              onClick={() => setSelectedCategory('all')}
            >
              <span className="category-icon">🗂️</span>
              <span className="category-name">全部收藏</span>
              <span className="category-count">{starredItems.length}</span>
            </div>
            
            {categories.map(category => (
              <div 
                key={category.id}
                className={`category-item ${selectedCategory === category.id ? 'active' : ''}`}
                onClick={() => setSelectedCategory(category.id)}
              >
                <span className="category-icon">{getCategoryIcon(category.type)}</span>
                <span className="category-name">{category.name}</span>
                <span className="category-count">{category.itemCount}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Dynamic content area */}
        <div className={`content-area ${showLegacyView ? 'legacy' : 'enhanced'}`}>
          {renderContentLayout()}
        </div>
      </div>
    </div>
  )
}