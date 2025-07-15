import { ipcRenderer, contextBridge } from 'electron'

// --------- Expose some API to the Renderer process ---------
contextBridge.exposeInMainWorld('ipcRenderer', {
  on(...args: Parameters<typeof ipcRenderer.on>) {
    const [channel, listener] = args
    return ipcRenderer.on(channel, (event, ...args) => listener(event, ...args))
  },
  off(...args: Parameters<typeof ipcRenderer.off>) {
    const [channel, ...omit] = args
    return ipcRenderer.off(channel, ...omit)
  },
  send(...args: Parameters<typeof ipcRenderer.send>) {
    const [channel, ...omit] = args
    return ipcRenderer.send(channel, ...omit)
  },
  invoke(...args: Parameters<typeof ipcRenderer.invoke>) {
    const [channel, ...omit] = args
    return ipcRenderer.invoke(channel, ...omit)
  },

  // You can expose other APTs you need here.
  // ...
})

// --------- Expose clipboard API ---------
contextBridge.exposeInMainWorld('clipboardAPI', {
  // 获取剪切板历史
  getClipboardHistory: () => ipcRenderer.invoke('clipboard:get-history'),
  
  // 设置剪切板内容
  setClipboardContent: (item: any) => ipcRenderer.invoke('clipboard:set-content', item),
  
  // 粘贴到当前活跃的应用
  pasteToActiveApp: () => ipcRenderer.invoke('clipboard:paste-to-active-app'),
  
  // 增强的粘贴功能（使用辅助API）
  pasteToActiveAppEnhanced: (text: string) => ipcRenderer.invoke('clipboard:paste-to-active-app-enhanced', text),
  
  // 监听剪切板变化
  onClipboardChange: (callback: (content: any) => void) => {
    ipcRenderer.on('clipboard:changed', (_, content) => callback(content))
  },
  
  // 监听剪切板历史更新
  onClipboardHistoryUpdate: (callback: (history: any[]) => void) => {
    ipcRenderer.on('clipboard:history-updated', (_, history) => callback(history))
  },
  
  // 创建临时文件用于拖拽
  createTempFile: (item: any) => ipcRenderer.invoke('clipboard:create-temp-file', item),
  
  // 启动原生拖拽
  startDrag: (item: any) => ipcRenderer.invoke('clipboard:start-drag', item),
  
  // 删除项目
  deleteItem: (itemId: string) => ipcRenderer.invoke('clipboard:delete-item', itemId),
  
  // Star机制API
  starItem: (itemId: string, category?: string, description?: string) => ipcRenderer.invoke('clipboard:star-item', itemId, category, description),
  unstarItem: (itemId: string) => ipcRenderer.invoke('clipboard:unstar-item', itemId),
  getStarredItems: (category?: string) => ipcRenderer.invoke('clipboard:get-starred-items', category),
  getCategories: () => ipcRenderer.invoke('clipboard:get-categories'),
  createCategory: (name: string, type: 'text' | 'image' | 'file' | 'mixed') => ipcRenderer.invoke('clipboard:create-category', name, type),
  updateItemCategory: (itemId: string, categoryId: string) => ipcRenderer.invoke('clipboard:update-item-category', itemId, categoryId),
  updateItemTags: (itemId: string, tags: string[]) => ipcRenderer.invoke('clipboard:update-item-tags', itemId, tags),
  updateItemDescription: (itemId: string, description: string) => ipcRenderer.invoke('clipboard:update-item-description', itemId, description),
  
  // 生成分享卡片
  generateShareCard: (item: any, template?: string, ratio?: string) => ipcRenderer.invoke('clipboard:generate-share-card', item, template, ratio),
  
  // 生成分享卡片预览
  generateShareCardPreview: (item: any, template?: string, ratio?: string) => ipcRenderer.invoke('clipboard:generate-share-card-preview', item, template, ratio),

  // 打开分享卡片窗口
  openShareCardWindow: (item: any) => ipcRenderer.invoke('share-card:open', item),
  
  // 打开档案库窗口
  openArchiveWindow: () => ipcRenderer.invoke('archive:open'),
  
  // 移除剪切板监听
  removeClipboardListener: () => {
    ipcRenderer.removeAllListeners('clipboard:changed')
    ipcRenderer.removeAllListeners('clipboard:history-updated')
  },
  
  // 获取存储设置
  getStorageSettings: () => ipcRenderer.invoke('storage:get-settings'),
  
  // 设置存储设置
  setStorageSettings: (settings: any) => ipcRenderer.invoke('storage:set-settings', settings),
  
  // 清理过期项目
  cleanupExpiredItems: () => ipcRenderer.invoke('storage:cleanup-expired'),
  
  // 清空历史记录
  clearHistory: () => ipcRenderer.invoke('clipboard:clear-history'),
  
  // 新增：处理选中项目的粘贴
  pasteSelectedItem: (item: any) => ipcRenderer.invoke('clipboard:paste-selected-item', item),
  
  // 检查项目是否已收藏
  isItemStarred: (itemId: string) => ipcRenderer.invoke('clipboard:is-item-starred', itemId),
  
  // 新增：全局键盘事件监听
  onNavigateItems: (callback: (direction: 'up' | 'down') => void) => {
    ipcRenderer.on('navigate-items', (_, direction) => callback(direction))
  },
  
  onSelectCurrentItem: (callback: () => void) => {
    ipcRenderer.on('select-current-item', () => callback())
  },
  
  onDeleteCurrentItem: (callback: () => void) => {
    ipcRenderer.on('delete-current-item', () => callback())
  },
  
  onToggleStar: (callback: () => void) => {
    ipcRenderer.on('toggle-star', () => callback())
  },
  
  onOpenArchive: (callback: () => void) => {
    ipcRenderer.on('open-archive', () => callback())
  },
  
  onTogglePreview: (callback: () => void) => {
    ipcRenderer.on('toggle-preview', () => callback())
  },
  
  // 移除全局键盘事件监听
  removeGlobalKeyboardListeners: () => {
    ipcRenderer.removeAllListeners('navigate-items')
    ipcRenderer.removeAllListeners('select-current-item')
    ipcRenderer.removeAllListeners('delete-current-item')
    ipcRenderer.removeAllListeners('toggle-star')
    ipcRenderer.removeAllListeners('open-archive')
    ipcRenderer.removeAllListeners('toggle-preview')
  }
})

// --------- Expose accessibility API ---------
contextBridge.exposeInMainWorld('accessibilityAPI', {
  // 检查辅助权限
  checkPermission: () => ipcRenderer.invoke('accessibility:check-permission'),
  
  // 请求辅助权限
  requestPermission: () => ipcRenderer.invoke('accessibility:request-permission'),
  
  // 获取焦点元素
  getFocusedElement: () => ipcRenderer.invoke('accessibility:get-focused-element'),
  
  // 插入文本到焦点元素
  insertText: (text: string) => ipcRenderer.invoke('accessibility:insert-text', text),
  
  // 获取焦点应用信息
  getAppInfo: () => ipcRenderer.invoke('accessibility:get-app-info'),
  
  // 高级鼠标事件处理（无焦点抢夺）
  handleMouseEvent: (x: number, y: number, eventType: string) => 
    ipcRenderer.invoke('accessibility:handle-mouse-event', x, y, eventType),
  
  // 获取指定位置的UI元素信息
  getElementAtPosition: (x: number, y: number) => 
    ipcRenderer.invoke('accessibility:get-element-at-position', x, y),
  
  // 执行UI元素操作（无焦点抢夺）
  performElementAction: (x: number, y: number, action: string) => 
    ipcRenderer.invoke('accessibility:perform-element-action', x, y, action)
})

// --------- Expose window API ---------
contextBridge.exposeInMainWorld('windowAPI', {
  // 获取窗口边界
  getBounds: () => ipcRenderer.invoke('window:get-bounds'),
  
  // 设置窗口边界
  setBounds: (bounds: any) => ipcRenderer.invoke('window:set-bounds', bounds),
  
  // 隐藏窗口
  hideWindow: () => ipcRenderer.invoke('window:hide'),
  
  // 监听窗口边界变化
  onBoundsChanged: (callback: (bounds: any) => void) => {
    ipcRenderer.on('window-bounds-changed', (_, bounds) => callback(bounds))
  },
  
  // 移除窗口监听
  removeWindowListener: () => {
    ipcRenderer.removeAllListeners('window-bounds-changed')
  },
  
  // 获取设置窗口边界
  getSettingsBounds: () => ipcRenderer.invoke('settings-window:get-bounds'),
  
  // 设置设置窗口边界
  setSettingsBounds: (bounds: any) => ipcRenderer.invoke('settings-window:set-bounds', bounds),
  
  // 监听设置窗口边界变化
  onSettingsBoundsChanged: (callback: (bounds: any) => void) => {
    ipcRenderer.on('settings-window-bounds-changed', (_, bounds) => callback(bounds))
  },
  
  // 移除设置窗口监听
  removeSettingsWindowListener: () => {
    ipcRenderer.removeAllListeners('settings-window-bounds-changed')
  },
  
  // 获取当前快捷键设置
  getCurrentShortcut: () => ipcRenderer.invoke('shortcuts:get-current-shortcut'),
  
  // 测试快捷键是否已注册
  testShortcut: (shortcut: string) => ipcRenderer.invoke('shortcuts:test-shortcut', shortcut),
  
  // 更新全局快捷键
  updateGlobalShortcut: (shortcut: string) => ipcRenderer.invoke('shortcuts:update-global-shortcut', shortcut)
})

// --------- Preload scripts loading ---------
function domReady(condition: DocumentReadyState[] = ['complete', 'interactive']) {
  return new Promise(resolve => {
    if (condition.includes(document.readyState)) {
      resolve(true)
    } else {
      document.addEventListener('readystatechange', () => {
        if (condition.includes(document.readyState)) {
          resolve(true)
        }
      })
    }
  })
}

const safeDOM = {
  append(parent: HTMLElement, child: HTMLElement) {
    if (!Array.from(parent.children).find(e => e === child)) {
      return parent.appendChild(child)
    }
  },
  remove(parent: HTMLElement, child: HTMLElement) {
    if (Array.from(parent.children).find(e => e === child)) {
      return parent.removeChild(child)
    }
  },
}

/**
 * https://tobiasahlin.com/spinkit
 * https://connoratherton.com/loaders
 * https://projects.lukehaas.me/css-loaders
 * https://matejkustec.github.io/SpinThatShit
 */
function useLoading() {
  const className = `loaders-css__square-spin`
  const styleContent = `
@keyframes square-spin {
  25% { transform: perspective(100px) rotateX(180deg) rotateY(0); }
  50% { transform: perspective(100px) rotateX(180deg) rotateY(180deg); }
  75% { transform: perspective(100px) rotateX(0) rotateY(180deg); }
  100% { transform: perspective(100px) rotateX(0) rotateY(0); }
}
.${className} > div {
  animation-fill-mode: both;
  width: 50px;
  height: 50px;
  background: #fff;
  animation: square-spin 3s 0s cubic-bezier(0.09, 0.57, 0.49, 0.9) infinite;
}
.app-loading-wrap {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #282c34;
  z-index: 9;
}
    `
  const oStyle = document.createElement('style')
  const oDiv = document.createElement('div')

  oStyle.id = 'app-loading-style'
  oStyle.innerHTML = styleContent
  oDiv.className = 'app-loading-wrap'
  oDiv.innerHTML = `<div class="${className}"><div></div></div>`

  return {
    appendLoading() {
      safeDOM.append(document.head, oStyle)
      safeDOM.append(document.body, oDiv)
    },
    removeLoading() {
      safeDOM.remove(document.head, oStyle)
      safeDOM.remove(document.body, oDiv)
    },
  }
}

// ----------------------------------------------------------------------

// Loading animation disabled
// const { appendLoading, removeLoading } = useLoading()
// domReady().then(appendLoading)

// window.onmessage = (ev) => {
//   ev.data.payload === 'removeLoading' && removeLoading()
// }

// setTimeout(removeLoading, 4999)