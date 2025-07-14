import { accessibilityModule } from './accessibility-wrapper'

// 导出所有功能
export const {
  checkAccessibilityPermission,
  requestAccessibilityPermission,
  getFocusedElement,
  insertTextToFocusedElement,
  getFocusedAppInfo
} = accessibilityModule