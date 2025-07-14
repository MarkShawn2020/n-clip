import { Provider } from 'jotai'
import ClipboardManager from './components/ClipboardManager'
import ShareCardWindow from './components/ShareCardWindow'
import SettingsWindow from './components/SettingsWindow'
import './App.css'

function App() {
  // 检查当前路由
  const currentHash = window.location.hash
  const isShareCardWindow = currentHash === '#share-card'
  const isSettingsWindow = currentHash === '#settings'

  return (
    <Provider>
      {isShareCardWindow ? (
        <ShareCardWindow />
      ) : isSettingsWindow ? (
        <SettingsWindow />
      ) : (
        <div className='App'>
          <ClipboardManager />
        </div>
      )}
    </Provider>
  )
}

export default App