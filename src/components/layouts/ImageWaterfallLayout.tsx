import { useState, useCallback } from 'react'
import Masonry from 'react-masonry-css'
import { EnhancedClipboardItem } from '../../types/archive-types'
import './ImageWaterfallLayout.css'

interface ImageWaterfallLayoutProps {
  items: EnhancedClipboardItem[]
  onItemClick: (item: EnhancedClipboardItem) => void
  onItemUnstar: (item: EnhancedClipboardItem) => void
}

export default function ImageWaterfallLayout({ 
  items, 
  onItemClick, 
  onItemUnstar 
}: ImageWaterfallLayoutProps) {
  const [loadedImages, setLoadedImages] = useState<Set<string>>(new Set())
  const [failedImages, setFailedImages] = useState<Set<string>>(new Set())

  // Responsive breakpoints for masonry columns
  const breakpointColumnsObj = {
    default: 4,
    1100: 3,
    700: 2,
    500: 1
  }

  const handleImageLoad = useCallback((itemId: string) => {
    setLoadedImages(prev => new Set(prev).add(itemId))
  }, [])

  const handleImageError = useCallback((itemId: string) => {
    setFailedImages(prev => new Set(prev).add(itemId))
  }, [])

  const handleUnstar = useCallback((e: React.MouseEvent, item: EnhancedClipboardItem) => {
    e.stopPropagation()
    onItemUnstar(item)
  }, [onItemUnstar])

  const formatTimestamp = (timestamp: number) => {
    const date = new Date(timestamp)
    const now = new Date()
    const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24))
    
    if (diffDays === 0) return '今天'
    if (diffDays === 1) return '昨天'
    if (diffDays < 7) return `${diffDays}天前`
    return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
  }

  const getDimensions = (item: EnhancedClipboardItem) => {
    if (item.metadata?.dimensions) {
      const { width, height } = item.metadata.dimensions
      return `${width} × ${height}`
    }
    return null
  }

  const getFileSize = (item: EnhancedClipboardItem) => {
    if (item.metadata?.fileSize) {
      const size = item.metadata.fileSize
      if (size < 1024) return `${size} B`
      if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
      return `${(size / (1024 * 1024)).toFixed(1)} MB`
    }
    return null
  }

  return (
    <div className="image-waterfall-layout">
      {items.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">🖼️</div>
          <div className="empty-title">还没有图像内容</div>
          <div className="empty-description">
            复制图片到剪切板并收藏，它们就会出现在这里
          </div>
        </div>
      ) : (
        <Masonry
          breakpointCols={breakpointColumnsObj}
          className="masonry-grid"
          columnClassName="masonry-grid-column"
        >
          {items.map(item => (
            <div 
              key={item.id} 
              className="image-item"
              onClick={() => onItemClick(item)}
            >
              <div className="image-container">
                {item.preview && !failedImages.has(item.id) ? (
                  <>
                    <img
                      src={item.preview}
                      alt={item.metadata?.fileName || "Image"}
                      className={`image-preview ${loadedImages.has(item.id) ? 'loaded' : 'loading'}`}
                      onLoad={() => handleImageLoad(item.id)}
                      onError={() => handleImageError(item.id)}
                      loading="lazy"
                    />
                    {!loadedImages.has(item.id) && (
                      <div className="image-placeholder">
                        <div className="loading-spinner"></div>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="image-fallback">
                    <div className="fallback-icon">🖼️</div>
                    <div className="fallback-text">无法加载图片</div>
                  </div>
                )}
                
                <div className="image-overlay">
                  <div className="image-actions">
                    <button 
                      className="unstar-btn"
                      onClick={(e) => handleUnstar(e, item)}
                      title="取消收藏"
                    >
                      ⭐
                    </button>
                  </div>
                  
                  <div className="image-info">
                    <div className="image-meta">
                      <span className="image-time">
                        {formatTimestamp(item.starredAt || item.timestamp)}
                      </span>
                      {getDimensions(item) && (
                        <span className="image-dimensions">
                          {getDimensions(item)}
                        </span>
                      )}
                      {getFileSize(item) && (
                        <span className="image-size">
                          {getFileSize(item)}
                        </span>
                      )}
                    </div>
                    
                    {item.metadata?.fileName && (
                      <div className="image-filename">
                        {item.metadata.fileName}
                      </div>
                    )}
                    
                    {item.description && (
                      <div className="image-description">
                        {item.description}
                      </div>
                    )}
                  </div>
                </div>
              </div>
              
              {item.tags && item.tags.length > 0 && (
                <div className="image-tags">
                  {item.tags.map(tag => (
                    <span key={tag} className="tag">{tag}</span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </Masonry>
      )}
    </div>
  )
}