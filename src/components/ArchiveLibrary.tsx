import { useEffect, useState } from 'react'
import { useAtom } from 'jotai'
import { ClipboardItem } from '../types/electron'
import { starredItemsAtom } from '../store/atoms'
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
  const [starredItems] = useAtom(starredItemsAtom)
  const [categories, setCategories] = useState<ArchiveCategory[]>([])
  const [selectedCategory, setSelectedCategory] = useState<string>('all')
  const [filteredItems, setFilteredItems] = useState<ClipboardItem[]>([])
  const [searchQuery, setSearchQuery] = useState('')

  console.log('DEBUG ArchiveLibrary: Rendering with', {
    starredItemsCount: starredItems.length,
    categoriesCount: categories.length,
    selectedCategory,
    filteredItemsCount: filteredItems.length
  })

  // 加载分类数据
  useEffect(() => {
    const loadCategories = async () => {
      try {
        const categoriesData = await window.clipboardAPI.getCategories()
        setCategories(categoriesData)
      } catch (error) {
        console.error('Failed to load categories:', error)
      }
    }
    
    loadCategories()
  }, [])

  // 过滤项目
  useEffect(() => {
    let filtered = starredItems

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

    setFilteredItems(filtered)
  }, [starredItems, selectedCategory, searchQuery])

  const handleItemClick = async (item: ClipboardItem) => {
    try {
      await window.clipboardAPI.setClipboardContent(item)
      console.log('Content copied to clipboard:', item.content)
      onClose?.() // 关闭档案库
    } catch (error) {
      console.error('Failed to copy to clipboard:', error)
    }
  }

  const handleUnstar = async (item: ClipboardItem) => {
    try {
      const result = await window.clipboardAPI.unstarItem(item.id)
      if (result.success) {
        console.log('Item unstarred successfully')
      } else {
        console.error('Failed to unstar item:', result.error)
      }
    } catch (error) {
      console.error('Failed to unstar item:', error)
    }
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

      <div className="archive-content">
        <div className="category-sidebar">
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

        <div className="items-grid">
          {filteredItems.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">⭐</div>
              <div className="empty-title">还没有收藏任何内容</div>
              <div className="empty-description">
                在主界面中点击⭐按钮来收藏重要的剪切板内容
              </div>
            </div>
          ) : (
            filteredItems.map(item => (
              <div key={item.id} className="archive-item" onClick={() => handleItemClick(item)}>
                <div className="item-header">
                  <span className="item-icon">{getItemIcon(item.type)}</span>
                  <div className="item-meta">
                    <span className="item-time">{formatTimestamp(item.starredAt || item.timestamp)}</span>
                    <button 
                      className="unstar-btn"
                      onClick={(e) => {
                        e.stopPropagation()
                        handleUnstar(item)
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
      </div>
    </div>
  )
}