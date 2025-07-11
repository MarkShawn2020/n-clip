import { useEffect, useState } from 'react'
import { ClipboardItem } from '../types/electron'
import './ShareCardWindow.css'

export default function ShareCardWindow() {
  const [clipboardItem, setClipboardItem] = useState<ClipboardItem | null>(null)
  const [selectedTemplate, setSelectedTemplate] = useState<string>('default')
  const [selectedRatio, setSelectedRatio] = useState<string>('3:4')
  const [previewImageSrc, setPreviewImageSrc] = useState<string | null>(null)
  const [isGenerating, setIsGenerating] = useState(false)

  const templates = [
    { value: 'default', label: '经典蓝' },
    { value: 'ultrathin', label: '极薄' },
    { value: 'dark', label: '暗夜' },
    { value: 'pastel', label: '柔和' },
    { value: 'luxury', label: '奢华金' },
    { value: 'monochrome', label: '黑白' },
    { value: 'sunset', label: '日落' }
  ]

  const ratios = [
    { value: 'auto', label: '自适应' },
    { value: '3:4', label: '3:4 竖向' },
    { value: '4:3', label: '4:3 横向' },
    { value: '1:1', label: '1:1 方形' }
  ]

  // 接收来自主进程的数据
  useEffect(() => {
    const handleShareCardData = (event: any, item: ClipboardItem) => {
      console.log('Received share card data:', item)
      setClipboardItem(item)
      setSelectedTemplate('default')
      setSelectedRatio('auto')
      setPreviewImageSrc(null)
      
      // 自动生成第一个预览
      generatePreview(item, 'default', 'auto')
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
      {/* 顶部控制栏 */}
      <div className="toolbar">
        <div className="toolbar-left">
          <h1 className="toolbar-title">分享卡片</h1>
          <span className="content-type">{clipboardItem.type}</span>
        </div>
        
        <div className="toolbar-controls">
          <div className="control-group">
            <label className="control-label">模板</label>
            <select 
              className="select"
              value={selectedTemplate}
              onChange={(e) => handleTemplateChange(e.target.value)}
            >
              {templates.map(template => (
                <option key={template.value} value={template.value}>
                  {template.label}
                </option>
              ))}
            </select>
          </div>
          
          <div className="control-group">
            <label className="control-label">比例</label>
            <select 
              className="select"
              value={selectedRatio}
              onChange={(e) => handleRatioChange(e.target.value)}
            >
              {ratios.map(ratio => (
                <option key={ratio.value} value={ratio.value}>
                  {ratio.label}
                </option>
              ))}
            </select>
          </div>
          
          <div className="control-actions">
            <button 
              className="btn btn-secondary"
              onClick={() => window.close()}
            >
              取消
            </button>
            <button 
              className="btn btn-primary"
              onClick={copyShareCard}
              disabled={isGenerating || !previewImageSrc}
            >
              {isGenerating ? '生成中...' : '复制'}
            </button>
          </div>
        </div>
      </div>

      {/* 主预览区域 */}
      <div className="main-preview">
        <div className="preview-container">
          {isGenerating ? (
            <div className="preview-loading">
              <div className="loading-spinner"></div>
              <span>生成分享卡片中...</span>
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
              <div className="placeholder-text">选择模板和比例开始生成</div>
            </div>
          )}
        </div>
        
        {/* 底部内容信息 */}
        <div className="content-info">
          <div className="content-preview">
            {clipboardItem.type === 'image' && clipboardItem.preview ? (
              <img src={clipboardItem.preview} alt="Content" className="content-thumbnail" />
            ) : (
              <div className="content-text">
                {clipboardItem.content.length > 80 
                  ? clipboardItem.content.substring(0, 80) + '...' 
                  : clipboardItem.content}
              </div>
            )}
          </div>
          <div className="content-meta">
            <span className="content-time">
              {new Date(clipboardItem.timestamp).toLocaleString()}
            </span>
            {clipboardItem.size && (
              <span className="content-size">{clipboardItem.size}</span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}