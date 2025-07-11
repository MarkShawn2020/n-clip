import { useEffect, useState } from 'react'
import { ClipboardItem } from '../types/electron'
import './ShareCardWindow.css'

export default function ShareCardWindow() {
  const [clipboardItem, setClipboardItem] = useState<ClipboardItem | null>(null)
  const [selectedTemplate, setSelectedTemplate] = useState<string>('default')
  const [selectedRatio, setSelectedRatio] = useState<string>('3:4')
  const [previewImageSrc, setPreviewImageSrc] = useState<string | null>(null)
  const [isGenerating, setIsGenerating] = useState(false)

  // 接收来自主进程的数据
  useEffect(() => {
    const handleShareCardData = (event: any, item: ClipboardItem) => {
      console.log('Received share card data:', item)
      setClipboardItem(item)
      setSelectedTemplate('default')
      setSelectedRatio('3:4')
      setPreviewImageSrc(null)
      
      // 自动生成第一个预览
      generatePreview(item, 'default', '3:4')
    }

    window.ipcRenderer.on('share-card-data', handleShareCardData)

    return () => {
      window.ipcRenderer.off('share-card-data', handleShareCardData)
    }
  }, [])

  // 生成预览图片
  const generatePreview = async (item: ClipboardItem, template: string, ratio: string) => {
    try {
      setIsGenerating(true)
      console.log('Generating preview for item:', item.type, item.id, 'template:', template, 'ratio:', ratio)
      const result = await window.clipboardAPI.generateShareCardPreview(item, template, ratio)
      if (result) {
        setPreviewImageSrc(result)
      }
    } catch (error) {
      console.error('Failed to generate preview:', error)
    } finally {
      setIsGenerating(false)
    }
  }

  // 复制分享卡片到剪切板
  const copyShareCard = async () => {
    if (!clipboardItem) return
    
    try {
      setIsGenerating(true)
      console.log('Copying share card to clipboard...')
      const result = await window.clipboardAPI.generateShareCard(clipboardItem, selectedTemplate, selectedRatio)
      if (result) {
        console.log('Share card copied successfully')
        // 关闭窗口
        window.close()
      }
    } catch (error) {
      console.error('Failed to copy share card:', error)
    } finally {
      setIsGenerating(false)
    }
  }

  // 处理模板变化
  const handleTemplateChange = (template: string) => {
    setSelectedTemplate(template)
    if (clipboardItem) {
      generatePreview(clipboardItem, template, selectedRatio)
    }
  }

  // 处理比例变化
  const handleRatioChange = (ratio: string) => {
    setSelectedRatio(ratio)
    if (clipboardItem) {
      generatePreview(clipboardItem, selectedTemplate, ratio)
    }
  }

  if (!clipboardItem) {
    return (
      <div className="share-card-window">
        <div className="loading-state">
          <div className="loading-spinner"></div>
          <span>加载中...</span>
        </div>
      </div>
    )
  }

  return (
    <div className="share-card-window">
      <div className="share-card-header">
        <div className="share-card-title">
          <span>生成分享卡片</span>
          <span className="share-card-type">({clipboardItem.type})</span>
        </div>
        <div className="share-card-info">
          <span className="item-timestamp">
            {new Date(clipboardItem.timestamp).toLocaleString()}
          </span>
        </div>
      </div>

      <div className="share-card-main">
        <div className="share-card-controls">
          <div className="controls-section">
            <h3>模板设置</h3>
            <div className="template-grid">
              {[
                { value: 'default', label: '默认', color: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' },
                { value: 'dark', label: '深色', color: 'linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 100%)' },
                { value: 'pastel', label: '柔和', color: 'linear-gradient(135deg, #ffeaa7 0%, #fab1a0 100%)' }
              ].map(template => (
                <button
                  key={template.value}
                  className={`template-option ${selectedTemplate === template.value ? 'selected' : ''}`}
                  onClick={() => handleTemplateChange(template.value)}
                >
                  <div 
                    className="template-preview" 
                    style={{ background: template.color }}
                  ></div>
                  <span>{template.label}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="controls-section">
            <h3>比例设置</h3>
            <div className="ratio-grid">
              {[
                { value: '3:4', label: '3:4 (竖向)', width: '30px', height: '40px' },
                { value: '4:3', label: '4:3 (横向)', width: '40px', height: '30px' },
                { value: '1:1', label: '1:1 (方形)', width: '35px', height: '35px' }
              ].map(ratio => (
                <button
                  key={ratio.value}
                  className={`ratio-option ${selectedRatio === ratio.value ? 'selected' : ''}`}
                  onClick={() => handleRatioChange(ratio.value)}
                >
                  <div 
                    className="ratio-preview" 
                    style={{ width: ratio.width, height: ratio.height }}
                  ></div>
                  <span>{ratio.label}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="controls-section">
            <h3>内容预览</h3>
            <div className="content-preview">
              {clipboardItem.type === 'image' && clipboardItem.preview ? (
                <img src={clipboardItem.preview} alt="Content" className="content-thumbnail" />
              ) : (
                <div className="content-text">
                  {clipboardItem.content.length > 100 
                    ? clipboardItem.content.substring(0, 100) + '...' 
                    : clipboardItem.content}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="share-card-preview-area">
          <div className="preview-header">
            <h3>预览</h3>
            <span className="preview-info">{selectedTemplate} • {selectedRatio}</span>
          </div>
          
          <div className="preview-container">
            {isGenerating ? (
              <div className="preview-loading">
                <div className="loading-spinner"></div>
                <span>生成中...</span>
              </div>
            ) : previewImageSrc ? (
              <img 
                src={previewImageSrc} 
                alt="Share Card Preview" 
                className="preview-image"
              />
            ) : (
              <div className="preview-placeholder">
                <div className="placeholder-icon">🎨</div>
                <div className="placeholder-text">预览生成中...</div>
              </div>
            )}
          </div>

          <div className="preview-actions">
            <button 
              className="btn btn-primary"
              onClick={copyShareCard}
              disabled={isGenerating || !previewImageSrc}
            >
              {isGenerating ? '生成中...' : '复制到剪切板'}
            </button>
            <button 
              className="btn btn-secondary"
              onClick={() => window.close()}
            >
              关闭
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}