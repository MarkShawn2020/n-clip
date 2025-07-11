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
  
  // 移除剪切板监听
  removeClipboardListener: () => {
    ipcRenderer.removeAllListeners('clipboard:changed')
    ipcRenderer.removeAllListeners('clipboard:history-updated')
  }
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
  }
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

const { appendLoading, removeLoading } = useLoading()
domReady().then(appendLoading)

window.onmessage = (ev) => {
  ev.data.payload === 'removeLoading' && removeLoading()
}

setTimeout(removeLoading, 4999)