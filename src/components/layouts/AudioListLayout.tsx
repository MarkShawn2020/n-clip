import { useCallback } from 'react'
import { EnhancedClipboardItem } from '../../types/archive-types'
import './AudioListLayout.css'

interface AudioListLayoutProps {
  items: EnhancedClipboardItem[]
  onItemClick: (item: EnhancedClipboardItem) => void
  onItemUnstar: (item: EnhancedClipboardItem) => void
}

export default function AudioListLayout({ 
  items, 
  onItemClick, 
  onItemUnstar 
}: AudioListLayoutProps) {
  
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

  const formatDuration = (seconds: number) => {
    if (!seconds) return '未知时长'
    
    const hours = Math.floor(seconds / 3600)
    const minutes = Math.floor((seconds % 3600) / 60)
    const secs = Math.floor(seconds % 60)
    
    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
    }
    return `${minutes}:${secs.toString().padStart(2, '0')}`
  }

  const getFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  const getAudioFormat = (fileName: string) => {
    const extension = fileName.split('.').pop()?.toUpperCase()
    return extension || 'AUDIO'
  }

  return (
    <div className="audio-list-layout">
      {items.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">🎵</div>
          <div className="empty-title">还没有音频内容</div>
          <div className="empty-description">
            复制音频文件到剪切板并收藏，它们就会出现在这里
          </div>
        </div>
      ) : (
        <div className="audio-list">
          {items.map(item => (
            <div 
              key={item.id} 
              className="audio-item"
              onClick={() => onItemClick(item)}
            >
              <div className="audio-item-icon">
                <div className="audio-waveform">
                  {[...Array(8)].map((_, i) => (
                    <div key={i} className="waveform-bar"></div>
                  ))}
                </div>
                <div className="format-badge">
                  {getAudioFormat(item.metadata?.fileName || item.content)}
                </div>
              </div>
              
              <div className="audio-item-content">
                <div className="audio-header">
                  <div className="audio-title">
                    {item.metadata?.fileName || item.content}
                  </div>
                  <div className="audio-actions">
                    <span className="audio-time">
                      {formatTimestamp(item.starredAt || item.timestamp)}
                    </span>
                    <button 
                      className="unstar-btn"
                      onClick={(e) => handleUnstar(e, item)}
                      title="取消收藏"
                    >
                      ⭐
                    </button>
                  </div>
                </div>
                
                <div className="audio-metadata">
                  <div className="audio-stats">
                    {item.metadata?.duration && (
                      <span className="duration">
                        时长: {formatDuration(item.metadata.duration)}
                      </span>
                    )}
                    {item.metadata?.fileSize && (
                      <span className="file-size">
                        大小: {getFileSize(item.metadata.fileSize)}
                      </span>
                    )}
                  </div>
                  
                  {item.description && (
                    <div className="audio-description">
                      {item.description}
                    </div>
                  )}
                </div>
                
                {item.tags && item.tags.length > 0 && (
                  <div className="audio-tags">
                    {item.tags.map(tag => (
                      <span key={tag} className="tag">{tag}</span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}