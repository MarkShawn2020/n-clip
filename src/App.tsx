import { Provider } from 'jotai'
import ClipboardManager from './components/ClipboardManager'
import './App.css'

function App() {
  return (
    <Provider>
      <div className='App'>
        <ClipboardManager />
      </div>
    </Provider>
  )
}

export default App