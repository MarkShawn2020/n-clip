// Quick test to create and check window-settings.json
import fs from 'fs'
import path from 'path'
import os from 'os'

const windowSettingsPath = path.join(os.homedir(), '.neurora', 'n-clip', 'window-settings.json')

// Create test settings
const testSettings = {
  mainWindow: {
    x: 150,
    y: 150,
    width: 640,
    height: 480
  },
  settingsWindow: {
    x: 200,
    y: 200,
    width: 800,
    height: 600
  }
}

// Ensure directory exists
const settingsDir = path.dirname(windowSettingsPath)
if (!fs.existsSync(settingsDir)) {
  fs.mkdirSync(settingsDir, { recursive: true })
}

// Write test settings
fs.writeFileSync(windowSettingsPath, JSON.stringify(testSettings, null, 2))
console.log('Test window settings created at:', windowSettingsPath)
console.log('Content:', JSON.stringify(testSettings, null, 2))

// Verify the file was created
if (fs.existsSync(windowSettingsPath)) {
  console.log('✓ File created successfully')
} else {
  console.log('✗ File creation failed')
}