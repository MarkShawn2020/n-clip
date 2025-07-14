#include <napi.h>
#include <ApplicationServices/ApplicationServices.h>
#include <CoreFoundation/CoreFoundation.h>
#include <Carbon/Carbon.h>
#include <string>
#include <iostream>

// 检查是否有辅助权限
Napi::Value CheckAccessibilityPermission(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    Boolean isTrusted = AXIsProcessTrusted();
    return Napi::Boolean::New(env, isTrusted);
}

// 请求辅助权限
Napi::Value RequestAccessibilityPermission(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    // 创建权限请求选项
    CFStringRef keys[] = { kAXTrustedCheckOptionPrompt };
    CFBooleanRef values[] = { kCFBooleanTrue };
    CFDictionaryRef options = CFDictionaryCreate(
        kCFAllocatorDefault,
        (const void**)keys,
        (const void**)values,
        sizeof(keys) / sizeof(keys[0]),
        &kCFTypeDictionaryKeyCallBacks,
        &kCFTypeDictionaryValueCallBacks
    );
    
    Boolean isTrusted = AXIsProcessTrustedWithOptions(options);
    
    if (options) {
        CFRelease(options);
    }
    
    return Napi::Boolean::New(env, isTrusted);
}

// 获取当前焦点的UI元素
Napi::Value GetFocusedElement(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    // 检查权限
    if (!AXIsProcessTrusted()) {
        Napi::TypeError::New(env, "Accessibility permission required").ThrowAsJavaScriptException();
        return env.Null();
    }
    
    // 获取系统范围的accessibility object
    AXUIElementRef systemWideElement = AXUIElementCreateSystemWide();
    if (!systemWideElement) {
        Napi::TypeError::New(env, "Failed to create system wide element").ThrowAsJavaScriptException();
        return env.Null();
    }
    
    // 获取焦点应用
    CFTypeRef focusedApp = NULL;
    AXError error = AXUIElementCopyAttributeValue(
        systemWideElement, 
        kAXFocusedApplicationAttribute, 
        &focusedApp
    );
    
    if (error != kAXErrorSuccess || !focusedApp) {
        CFRelease(systemWideElement);
        return Napi::Boolean::New(env, false);
    }
    
    // 获取焦点元素
    CFTypeRef focusedElement = NULL;
    error = AXUIElementCopyAttributeValue(
        (AXUIElementRef)focusedApp,
        kAXFocusedUIElementAttribute,
        &focusedElement
    );
    
    bool hasFocus = (error == kAXErrorSuccess && focusedElement != NULL);
    
    // 清理资源
    if (focusedElement) CFRelease(focusedElement);
    if (focusedApp) CFRelease(focusedApp);
    CFRelease(systemWideElement);
    
    return Napi::Boolean::New(env, hasFocus);
}

// 直接插入文本到焦点元素
Napi::Value InsertTextToFocusedElement(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    // 检查参数
    if (info.Length() < 1 || !info[0].IsString()) {
        return Napi::Boolean::New(env, false);
    }
    
    std::string text = info[0].As<Napi::String>();
    
    // 检查权限
    if (!AXIsProcessTrusted()) {
        return Napi::Boolean::New(env, false);
    }
    
    // 获取系统范围的accessibility object
    AXUIElementRef systemWideElement = AXUIElementCreateSystemWide();
    if (!systemWideElement) {
        return Napi::Boolean::New(env, false);
    }
    
    bool success = false;
    CFTypeRef focusedApp = NULL;
    CFTypeRef focusedElement = NULL;
    
    // 方法1: 直接从系统级别获取焦点元素
    AXError error = AXUIElementCopyAttributeValue(
        systemWideElement, 
        kAXFocusedUIElementAttribute, 
        &focusedElement
    );
    
    if (error == kAXErrorSuccess && focusedElement) {
        // 直接获取到了焦点元素，跳过应用层级
    } else {
        // 方法2: 通过应用获取焦点元素
        error = AXUIElementCopyAttributeValue(
            systemWideElement, 
            kAXFocusedApplicationAttribute, 
            &focusedApp
        );
        
        if (error == kAXErrorSuccess && focusedApp) {
            // 获取焦点元素
            error = AXUIElementCopyAttributeValue(
                (AXUIElementRef)focusedApp,
                kAXFocusedUIElementAttribute,
                &focusedElement
            );
        }
    }
    
    if (focusedElement) {
        // 创建要插入的文本
        CFStringRef textToInsert = CFStringCreateWithCString(
            kCFAllocatorDefault, 
            text.c_str(), 
            kCFStringEncodingUTF8
        );
        
        if (textToInsert) {
            // 获取元素类型以决定插入策略
            CFTypeRef elementRole = NULL;
            AXUIElementCopyAttributeValue(
                (AXUIElementRef)focusedElement,
                kAXRoleAttribute,
                &elementRole
            );
            
            bool isTextArea = false;
            if (elementRole) {
                CFStringRef roleStr = (CFStringRef)elementRole;
                isTextArea = CFStringCompare(roleStr, CFSTR("AXTextArea"), 0) == kCFCompareEqualTo;
                CFRelease(elementRole);
            }
            
            if (isTextArea) {
                // 终端和文本区域的特殊处理
                // 方法1: 尝试在当前光标位置插入文本
                CFTypeRef currentValue = NULL;
                AXError valueError = AXUIElementCopyAttributeValue(
                    (AXUIElementRef)focusedElement,
                    kAXValueAttribute,
                    &currentValue
                );
                
                if (valueError == kAXErrorSuccess && currentValue) {
                    CFStringRef currentText = (CFStringRef)currentValue;
                    CFMutableStringRef newText = CFStringCreateMutableCopy(
                        kCFAllocatorDefault,
                        0,
                        currentText
                    );
                    
                    if (newText) {
                        // 获取插入点
                        CFTypeRef insertionPoint = NULL;
                        AXUIElementCopyAttributeValue(
                            (AXUIElementRef)focusedElement,
                            kAXInsertionPointLineNumberAttribute,
                            &insertionPoint
                        );
                        
                        // 在末尾添加文本
                        CFStringAppend(newText, textToInsert);
                        
                        // 设置新的文本值
                        error = AXUIElementSetAttributeValue(
                            (AXUIElementRef)focusedElement,
                            kAXValueAttribute,
                            newText
                        );
                        
                        success = (error == kAXErrorSuccess);
                        
                        if (insertionPoint) CFRelease(insertionPoint);
                        CFRelease(newText);
                    }
                    CFRelease(currentValue);
                }
                
                // 如果追加失败，尝试直接替换选中文本
                if (!success) {
                    error = AXUIElementSetAttributeValue(
                        (AXUIElementRef)focusedElement,
                        kAXSelectedTextAttribute,
                        textToInsert
                    );
                    success = (error == kAXErrorSuccess);
                }
            } else {
                // 普通文本字段的处理
                // 方法1: 尝试直接设置文本值
                error = AXUIElementSetAttributeValue(
                    (AXUIElementRef)focusedElement,
                    kAXValueAttribute,
                    textToInsert
                );
                
                if (error == kAXErrorSuccess) {
                    success = true;
                } else {
                    // 方法2: 尝试设置选中文本
                    error = AXUIElementSetAttributeValue(
                        (AXUIElementRef)focusedElement,
                        kAXSelectedTextAttribute,
                        textToInsert
                    );
                    success = (error == kAXErrorSuccess);
                }
            }
            
            CFRelease(textToInsert);
        }
    }
    
    // 清理资源
    if (focusedElement) CFRelease(focusedElement);
    if (focusedApp) CFRelease(focusedApp);
    CFRelease(systemWideElement);
    
    return Napi::Boolean::New(env, success);
}

// 获取当前应用信息
Napi::Value GetFocusedAppInfo(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    Napi::Object result = Napi::Object::New(env);
    
    // 检查权限
    if (!AXIsProcessTrusted()) {
        result.Set("error", Napi::String::New(env, "Accessibility permission required"));
        result.Set("hasFocusedElement", Napi::Boolean::New(env, false));
        return result;
    }
    
    // 获取系统范围的accessibility object
    AXUIElementRef systemWideElement = AXUIElementCreateSystemWide();
    if (!systemWideElement) {
        result.Set("error", Napi::String::New(env, "Failed to create system wide element"));
        result.Set("hasFocusedElement", Napi::Boolean::New(env, false));
        return result;
    }
    
    // 获取焦点应用
    CFTypeRef focusedApp = NULL;
    AXError error = AXUIElementCopyAttributeValue(
        systemWideElement, 
        kAXFocusedApplicationAttribute, 
        &focusedApp
    );
    
    // 添加调试信息
    result.Set("axError", Napi::Number::New(env, error));
    result.Set("hasFocusedApp", Napi::Boolean::New(env, focusedApp != NULL));
    
    if (error == kAXErrorSuccess && focusedApp) {
        // 获取应用的进程信息
        pid_t pid = 0;
        AXError pidError = AXUIElementGetPid((AXUIElementRef)focusedApp, &pid);
        
        if (pidError == kAXErrorSuccess) {
            result.Set("pid", Napi::Number::New(env, pid));
            
            // 通过进程获取应用名称
            ProcessSerialNumber psn;
            OSStatus status = GetProcessForPID(pid, &psn);
            if (status == noErr) {
                CFStringRef processName = NULL;
                status = CopyProcessName(&psn, &processName);
                if (status == noErr && processName) {
                    CFIndex length = CFStringGetLength(processName);
                    CFIndex maxSize = CFStringGetMaximumSizeForEncoding(length, kCFStringEncodingUTF8) + 1;
                    char* buffer = new char[maxSize];
                    
                    if (CFStringGetCString(processName, buffer, maxSize, kCFStringEncodingUTF8)) {
                        result.Set("appName", Napi::String::New(env, buffer));
                    }
                    
                    delete[] buffer;
                    CFRelease(processName);
                }
            }
        }
        
        // 获取焦点元素信息
        CFTypeRef focusedElement = NULL;
        AXError elementError = AXUIElementCopyAttributeValue(
            (AXUIElementRef)focusedApp,
            kAXFocusedUIElementAttribute,
            &focusedElement
        );
        
        result.Set("focusedElementError", Napi::Number::New(env, elementError));
        
        if (elementError == kAXErrorSuccess && focusedElement) {
            result.Set("hasFocusedElement", Napi::Boolean::New(env, true));
            
            // 获取元素类型
            CFTypeRef elementRole = NULL;
            AXError roleError = AXUIElementCopyAttributeValue(
                (AXUIElementRef)focusedElement,
                kAXRoleAttribute,
                &elementRole
            );
            
            if (roleError == kAXErrorSuccess && elementRole) {
                CFStringRef roleStr = (CFStringRef)elementRole;
                CFIndex length = CFStringGetLength(roleStr);
                CFIndex maxSize = CFStringGetMaximumSizeForEncoding(length, kCFStringEncodingUTF8) + 1;
                char* buffer = new char[maxSize];
                
                if (CFStringGetCString(roleStr, buffer, maxSize, kCFStringEncodingUTF8)) {
                    result.Set("elementRole", Napi::String::New(env, buffer));
                }
                
                delete[] buffer;
                CFRelease(elementRole);
            }
            
            CFRelease(focusedElement);
        } else {
            result.Set("hasFocusedElement", Napi::Boolean::New(env, false));
        }
        
        CFRelease(focusedApp);
    } else {
        result.Set("hasFocusedElement", Napi::Boolean::New(env, false));
        
        // 提供错误解释
        std::string errorMsg;
        switch (error) {
            case -25212:
                errorMsg = "Invalid UI Element (kAXErrorInvalidUIElement)";
                break;
            case -25211:
                errorMsg = "Accessibility API disabled (kAXErrorAPIDisabled)";
                break;
            case -25210:
                errorMsg = "Action unsupported (kAXErrorActionUnsupported)";
                break;
            case -25209:
                errorMsg = "Cannot complete operation (kAXErrorCannotComplete)";
                break;
            case -25208:
                errorMsg = "Not implemented (kAXErrorNotImplemented)";
                break;
            case -25207:
                errorMsg = "Illegal argument (kAXErrorIllegalArgument)";
                break;
            case -25206:
                errorMsg = "No value (kAXErrorNoValue)";
                break;
            case -25205:
                errorMsg = "Attribute unsupported (kAXErrorAttributeUnsupported)";
                break;
            case -25204:
                errorMsg = "Failure (kAXErrorFailure)";
                break;
            case 0:
                errorMsg = "Success (kAXErrorSuccess)";
                break;
            default:
                errorMsg = "Unknown error: " + std::to_string(error);
                break;
        }
        result.Set("errorDescription", Napi::String::New(env, errorMsg));
    }
    
    CFRelease(systemWideElement);
    
    return result;
}

// 模拟 Cmd+V 键盘事件
Napi::Value SimulatePasteKeystroke(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    // 创建事件源
    CGEventSourceRef source = CGEventSourceCreate(kCGEventSourceStatePrivate);
    if (!source) {
        return Napi::Boolean::New(env, false);
    }
    
    // 创建 Cmd+V 按键事件
    CGEventRef keyDownEvent = CGEventCreateKeyboardEvent(source, kVK_ANSI_V, true);
    CGEventRef keyUpEvent = CGEventCreateKeyboardEvent(source, kVK_ANSI_V, false);
    
    if (keyDownEvent && keyUpEvent) {
        // 设置 Command 修饰键
        CGEventSetFlags(keyDownEvent, kCGEventFlagMaskCommand);
        CGEventSetFlags(keyUpEvent, kCGEventFlagMaskCommand);
        
        // 发送按键事件
        CGEventPost(kCGHIDEventTap, keyDownEvent);
        CGEventPost(kCGHIDEventTap, keyUpEvent);
        
        // 清理资源
        CFRelease(keyDownEvent);
        CFRelease(keyUpEvent);
    }
    
    CFRelease(source);
    
    return Napi::Boolean::New(env, true);
}

// 模块初始化
Napi::Object Init(Napi::Env env, Napi::Object exports) {
    exports.Set("checkAccessibilityPermission", Napi::Function::New(env, CheckAccessibilityPermission));
    exports.Set("requestAccessibilityPermission", Napi::Function::New(env, RequestAccessibilityPermission));
    exports.Set("getFocusedElement", Napi::Function::New(env, GetFocusedElement));
    exports.Set("insertTextToFocusedElement", Napi::Function::New(env, InsertTextToFocusedElement));
    exports.Set("getFocusedAppInfo", Napi::Function::New(env, GetFocusedAppInfo));
    exports.Set("simulatePasteKeystroke", Napi::Function::New(env, SimulatePasteKeystroke));
    
    return exports;
}

NODE_API_MODULE(accessibility, Init)