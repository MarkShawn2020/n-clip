import { useEffect, useState } from 'react'
import { useAtom } from 'jotai'
import { settingsAtom, settingsWindowPositionAtom } from '../store/atoms'
import './SettingsWindow.css'

interface StorageSettings {
  textDuration: number
  imageDuration: number
  fileDuration: number
}

interface AppSettings {
  theme: 'light' | 'dark' | 'auto'
  autoStart: boolean
  showNotifications: boolean
  hotkey: string
  maxHistoryItems: number
  autoCleanup: boolean
  storage: StorageSettings
}

export default function SettingsWindow() {
  const [settings, setSettings] = useAtom(settingsAtom)
  const [windowPosition, setWindowPosition] = useAtom(settingsWindowPositionAtom)
  const [localSettings, setLocalSettings] = useState<AppSettings>(settings)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [savedMessage, setSavedMessage] = useState('')

  useEffect(() => {
    const loadSettings = async () => {
      try {
        const storageSettings = await window.clipboardAPI.getStorageSettings()
        setLocalSettings(prev => ({
          ...prev,
          storage: storageSettings
        }))
        setIsLoading(false)
      } catch (error) {
        console.error('Failed to load settings:', error)
        setIsLoading(false)
      }
    }

    loadSettings()
  }, [])

  // 初始化窗口位置
  useEffect(() => {
    const initWindowPosition = async () => {
      try {
        const bounds = await window.windowAPI.getSettingsBounds()
        setWindowPosition(bounds)
      } catch (error) {
        console.error('Failed to load settings window position:', error)
      }
    }
    
    initWindowPosition()
    
    // 监听窗口位置变化
    window.windowAPI.onSettingsBoundsChanged((bounds) => {
      setWindowPosition(bounds)
    })
    
    return () => {
      window.windowAPI.removeSettingsWindowListener()
    }
  }, [setWindowPosition])

  // 响应主进程请求保存的窗口位置
  useEffect(() => {
    const handleRequestSavedBounds = () => {
      // 将当前保存的位置发送给主进程
      window.windowAPI.setSettingsBounds(windowPosition)
    }

    window.ipcRenderer.on('request-saved-bounds', handleRequestSavedBounds)

    return () => {
      window.ipcRenderer.off('request-saved-bounds', handleRequestSavedBounds)
    }
  }, [windowPosition])

  const handleSaveSettings = async () => {
    setIsSaving(true)
    try {
      // 保存存储设置
      await window.clipboardAPI.setStorageSettings(localSettings.storage)
      
      // 保存应用设置
      setSettings(localSettings)
      
      setSavedMessage('设置已保存')
      setTimeout(() => setSavedMessage(''), 3000)
    } catch (error) {
      console.error('Failed to save settings:', error)
      setSavedMessage('保存失败')
      setTimeout(() => setSavedMessage(''), 3000)
    } finally {
      setIsSaving(false)
    }
  }

  const handleStorageChange = (key: keyof StorageSettings, value: number) => {
    setLocalSettings(prev => ({
      ...prev,
      storage: {
        ...prev.storage,
        [key]: value
      }
    }))
  }

  const handleSettingChange = (key: keyof AppSettings, value: any) => {
    setLocalSettings(prev => ({
      ...prev,
      [key]: value
    }))
  }

  const handleResetSettings = () => {
    if (confirm('确定要恢复默认设置吗？此操作不可撤销。')) {
      const defaultSettings: AppSettings = {
        theme: 'auto',
        autoStart: false,
        showNotifications: true,
        hotkey: 'CommandOrControl+Shift+C',
        maxHistoryItems: 1000,
        autoCleanup: true,
        storage: {
          textDuration: 7,
          imageDuration: 3,
          fileDuration: 1
        }
      }
      setLocalSettings(defaultSettings)
    }
  }

  if (isLoading) {
    return (
      <div className="settings-window loading">
        <div className="loading-spinner">
          <div className="spinner"></div>
          <div className="loading-text">加载设置中...</div>
        </div>
      </div>
    )
  }

  return (
    <div className="settings-window">
      <div className="settings-header">
        <h1>NClip 设置</h1>
        <p>管理您的剪切板和应用偏好设置</p>
      </div>

      <div className="settings-content">
        <div className="settings-grid">
          {/* 外观设置 */}
          <div className="settings-section">
            <h2>外观</h2>
            <div className="settings-group">
              <div className="setting-item">
                <label htmlFor="theme">主题</label>
                <select 
                  id="theme"
                  value={localSettings.theme} 
                  onChange={(e) => handleSettingChange('theme', e.target.value)}
                >
                  <option value="light">浅色</option>
                  <option value="dark">深色</option>
                  <option value="auto">跟随系统</option>
                </select>
              </div>
            </div>
          </div>

          {/* 行为设置 */}
          <div className="settings-section">
            <h2>行为</h2>
            <div className="settings-group">
              <div className="setting-item checkbox-item">
                <label>
                  <input 
                    type="checkbox" 
                    checked={localSettings.autoStart}
                    onChange={(e) => handleSettingChange('autoStart', e.target.checked)}
                  />
                  <span className="checkbox-label">开机自启动</span>
                </label>
                <p className="setting-description">系统启动时自动运行 NClip</p>
              </div>
              <div className="setting-item checkbox-item">
                <label>
                  <input 
                    type="checkbox" 
                    checked={localSettings.showNotifications}
                    onChange={(e) => handleSettingChange('showNotifications', e.target.checked)}
                  />
                  <span className="checkbox-label">显示通知</span>
                </label>
                <p className="setting-description">显示系统通知提醒</p>
              </div>
              <div className="setting-item checkbox-item">
                <label>
                  <input 
                    type="checkbox" 
                    checked={localSettings.autoCleanup}
                    onChange={(e) => handleSettingChange('autoCleanup', e.target.checked)}
                  />
                  <span className="checkbox-label">自动清理过期项目</span>
                </label>
                <p className="setting-description">自动删除过期的剪切板项目</p>
              </div>
            </div>
          </div>

          {/* 快捷键设置 */}
          <div className="settings-section">
            <h2>快捷键</h2>
            <div className="settings-group">
              <div className="setting-item">
                <label htmlFor="hotkey">全局快捷键</label>
                <input 
                  id="hotkey"
                  type="text" 
                  value={localSettings.hotkey}
                  onChange={(e) => handleSettingChange('hotkey', e.target.value)}
                  placeholder="CommandOrControl+Shift+C"
                />
                <p className="setting-description">用于显示/隐藏 NClip 窗口的快捷键</p>
              </div>
            </div>
          </div>

          {/* 存储设置 */}
          <div className="settings-section">
            <h2>存储</h2>
            <div className="settings-group">
              <div className="setting-item">
                <label htmlFor="maxItems">最大历史记录数</label>
                <input 
                  id="maxItems"
                  type="number" 
                  value={localSettings.maxHistoryItems}
                  onChange={(e) => handleSettingChange('maxHistoryItems', parseInt(e.target.value))}
                  min="100"
                  max="10000"
                />
                <p className="setting-description">保存的最大剪切板项目数量</p>
              </div>
              <div className="setting-item">
                <label htmlFor="textDuration">文本保存时间 (天)</label>
                <input 
                  id="textDuration"
                  type="number" 
                  value={localSettings.storage.textDuration}
                  onChange={(e) => handleStorageChange('textDuration', parseInt(e.target.value))}
                  min="1"
                  max="365"
                />
                <p className="setting-description">文本项目的保存时间</p>
              </div>
              <div className="setting-item">
                <label htmlFor="imageDuration">图片保存时间 (天)</label>
                <input 
                  id="imageDuration"
                  type="number" 
                  value={localSettings.storage.imageDuration}
                  onChange={(e) => handleStorageChange('imageDuration', parseInt(e.target.value))}
                  min="1"
                  max="365"
                />
                <p className="setting-description">图片项目的保存时间</p>
              </div>
              <div className="setting-item">
                <label htmlFor="fileDuration">文件保存时间 (天)</label>
                <input 
                  id="fileDuration"
                  type="number" 
                  value={localSettings.storage.fileDuration}
                  onChange={(e) => handleStorageChange('fileDuration', parseInt(e.target.value))}
                  min="1"
                  max="365"
                />
                <p className="setting-description">文件项目的保存时间</p>
              </div>
            </div>
          </div>

          {/* 数据管理 */}
          <div className="settings-section">
            <h2>数据管理</h2>
            <div className="settings-group">
              <div className="setting-item action-item">
                <div className="action-info">
                  <h3>清理过期项目</h3>
                  <p>删除超过保存时间的项目</p>
                </div>
                <button 
                  className="btn btn-secondary"
                  onClick={async () => {
                    try {
                      await window.clipboardAPI.cleanupExpiredItems()
                      setSavedMessage('过期项目已清理')
                      setTimeout(() => setSavedMessage(''), 3000)
                    } catch (error) {
                      console.error('Failed to cleanup expired items:', error)
                      setSavedMessage('清理失败')
                      setTimeout(() => setSavedMessage(''), 3000)
                    }
                  }}
                >
                  立即清理
                </button>
              </div>
              <div className="setting-item action-item">
                <div className="action-info">
                  <h3>清空历史记录</h3>
                  <p>删除所有剪切板历史记录</p>
                </div>
                <button 
                  className="btn btn-danger"
                  onClick={async () => {
                    if (confirm('确定要清空所有剪切板历史记录吗？此操作不可撤销。')) {
                      try {
                        await window.clipboardAPI.clearHistory()
                        setSavedMessage('历史记录已清空')
                        setTimeout(() => setSavedMessage(''), 3000)
                      } catch (error) {
                        console.error('Failed to clear history:', error)
                        setSavedMessage('清空失败')
                        setTimeout(() => setSavedMessage(''), 3000)
                      }
                    }
                  }}
                >
                  清空记录
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="settings-footer">
        <div className="footer-message">
          {savedMessage && <span className="saved-message">{savedMessage}</span>}
        </div>
        <div className="footer-actions">
          <button 
            className="btn btn-secondary" 
            onClick={handleResetSettings}
            disabled={isSaving}
          >
            恢复默认
          </button>
          <button 
            className="btn btn-primary" 
            onClick={handleSaveSettings}
            disabled={isSaving}
          >
            {isSaving ? '保存中...' : '保存设置'}
          </button>
        </div>
      </div>
    </div>
  )
}