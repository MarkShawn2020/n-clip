import { Provider } from 'jotai'
import ClipboardManager from './components/ClipboardManager'
import ShareCardWindow from './components/ShareCardWindow'
import './App.css'

function App() {
  // 检查是否是分享卡片窗口
  const isShareCardWindow = window.location.hash === '#share-card'

  return (
    <Provider>
      {isShareCardWindow ? (
        <ShareCardWindow />
      ) : (
        <div className='App'>
          <ClipboardManager />
        </div>
      )}
    </Provider>
  )
}

export default App