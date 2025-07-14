// Test script to verify window position persistence
const { app, BrowserWindow } = require('electron')
const fs = require('fs')
const path = require('path')
const os = require('os')

// Wait for app to be ready
setTimeout(() => {
  console.log('Testing window position persistence...')
  
  // Get the main window
  const windows = BrowserWindow.getAllWindows()
  if (windows.length > 0) {
    const mainWindow = windows[0]
    
    // Log current bounds
    const currentBounds = mainWindow.getBounds()
    console.log('Current window bounds:', currentBounds)
    
    // Move window to test position
    const testBounds = {
      x: 200,
      y: 200,
      width: 640,
      height: 480
    }
    
    console.log('Moving window to test position:', testBounds)
    mainWindow.setBounds(testBounds)
    
    // Check if settings file was created
    setTimeout(() => {
      const windowSettingsPath = path.join(os.homedir(), '.neurora', 'n-clip', 'window-settings.json')
      if (fs.existsSync(windowSettingsPath)) {
        const settings = JSON.parse(fs.readFileSync(windowSettingsPath, 'utf8'))
        console.log('Window settings saved:', settings)
      } else {
        console.log('Window settings file not created yet')
      }
    }, 1000)
  }
}, 3000)