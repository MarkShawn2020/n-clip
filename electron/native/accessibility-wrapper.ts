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
  simulatePasteKeystroke(): boolean
  handleMouseEventWithoutFocus(x: number, y: number, eventType: string): boolean
  getElementAtPosition(x: number, y: number): {
    hasElement: boolean
    elementRole?: string
    elementTitle?: string
    isClickable?: boolean
    error?: string
  }
  performElementAction(x: number, y: number, action: string): boolean
}

interface FocusedAppInfo {
  appName?: string
  hasFocusedElement: boolean
  elementRole?: string
}

interface ElementInfo {
  hasElement: boolean
  elementRole?: string
  elementTitle?: string
  isClickable?: boolean
  error?: string
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

// 延迟加载的原生模块引用
let nativeModule: AccessibilityModule | null = null

// 获取或加载原生模块
function getNativeModule(): AccessibilityModule {
  if (!nativeModule) {
    nativeModule = loadAccessibilityModule()
    if (!nativeModule) {
      throw new Error('Accessibility module is required but could not be loaded')
    }
  }
  return nativeModule
}

// 导出包装器
export const accessibilityModule: AccessibilityModule = {
  checkAccessibilityPermission: () => getNativeModule().checkAccessibilityPermission(),
  requestAccessibilityPermission: () => getNativeModule().requestAccessibilityPermission(),
  getFocusedElement: () => getNativeModule().getFocusedElement(),
  insertTextToFocusedElement: (text: string) => getNativeModule().insertTextToFocusedElement(text),
  getFocusedAppInfo: () => getNativeModule().getFocusedAppInfo(),
  simulatePasteKeystroke: () => getNativeModule().simulatePasteKeystroke(),
  handleMouseEventWithoutFocus: (x: number, y: number, eventType: string) => getNativeModule().handleMouseEventWithoutFocus(x, y, eventType),
  getElementAtPosition: (x: number, y: number) => getNativeModule().getElementAtPosition(x, y),
  performElementAction: (x: number, y: number, action: string) => getNativeModule().performElementAction(x, y, action)
}

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

export const simulatePasteKeystroke = (): boolean => {
  return accessibilityModule.simulatePasteKeystroke()
}

// 高级鼠标事件处理（无焦点抢夺）
export const handleMouseEventWithoutFocus = (x: number, y: number, eventType: string): boolean => {
  return accessibilityModule.handleMouseEventWithoutFocus(x, y, eventType)
}

// 获取指定位置的UI元素信息
export const getElementAtPosition = (x: number, y: number): ElementInfo => {
  return accessibilityModule.getElementAtPosition(x, y)
}

// 执行UI元素操作（无焦点抢夺）
export const performElementAction = (x: number, y: number, action: string): boolean => {
  return accessibilityModule.performElementAction(x, y, action)
}

// 导出类型
export type { FocusedAppInfo, ElementInfo }