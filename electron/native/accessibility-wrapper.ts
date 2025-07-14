import path from 'path'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'

// 创建 require 函数用于加载原生模块
const require = createRequire(import.meta.url)

// 获取当前文件的目录
const __dirname = path.dirname(fileURLToPath(import.meta.url))

// 接口定义
interface AccessibilityModule {
  checkAccessibilityPermission(): boolean
  requestAccessibilityPermission(): boolean
  getFocusedElement(): boolean
  insertTextToFocusedElement(text: string): boolean
  getFocusedAppInfo(): {
    appName?: string
    hasFocusedElement: boolean
    elementRole?: string
  }
}

interface FocusedAppInfo {
  appName?: string
  hasFocusedElement: boolean
  elementRole?: string
}

// 创建一个安全的加载函数
function loadAccessibilityModule(): AccessibilityModule | null {
  try {
    // 尝试从多个可能的路径加载原生模块
    const possiblePaths = [
      path.join(__dirname, 'build/Release/accessibility.node'),
      path.join(__dirname, '../native/build/Release/accessibility.node'),
      path.join(process.cwd(), 'electron/native/build/Release/accessibility.node'),
      // 开发环境路径
      path.resolve(__dirname, '../../electron/native/build/Release/accessibility.node')
    ]
    
    for (const modulePath of possiblePaths) {
      try {
        const nativeModule = require(modulePath)
        console.log(`Successfully loaded accessibility module from: ${modulePath}`)
        return nativeModule
      } catch (err) {
        // 继续尝试下一个路径
        continue
      }
    }
    
    throw new Error('Could not find accessibility.node in any expected location')
  } catch (error) {
    console.error('Failed to load accessibility native module:', error)
    return null
  }
}

// 加载模块
const nativeModule = loadAccessibilityModule()

if (!nativeModule) {
  throw new Error('Accessibility module is required but could not be loaded')
}

// 导出包装器
export const accessibilityModule: AccessibilityModule = nativeModule

// 导出单独的功能函数
export const checkAccessibilityPermission = (): boolean => {
  return accessibilityModule.checkAccessibilityPermission()
}

export const requestAccessibilityPermission = (): boolean => {
  return accessibilityModule.requestAccessibilityPermission()
}

export const getFocusedElement = (): boolean => {
  return accessibilityModule.getFocusedElement()
}

export const insertTextToFocusedElement = (text: string): boolean => {
  return accessibilityModule.insertTextToFocusedElement(text)
}

export const getFocusedAppInfo = (): FocusedAppInfo => {
  return accessibilityModule.getFocusedAppInfo()
}

// 导出类型
export type { FocusedAppInfo }