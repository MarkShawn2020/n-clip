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

// 全局鼠标事件监听
static CFMachPortRef mouseEventTap = nullptr;
static Napi::ThreadSafeFunction mouseCallback;

// 鼠标事件回调
CGEventRef MouseEventCallback(CGEventTapProxy proxy, CGEventType type, CGEventRef event, void *refcon) {
    if (type == kCGEventLeftMouseDown || type == kCGEventRightMouseDown) {
        CGPoint location = CGEventGetLocation(event);
        
        if (mouseCallback) {
            mouseCallback.NonBlockingCall([location](Napi::Env env, Napi::Function jsCallback) {
                jsCallback.Call({ 
                    Napi::Number::New(env, location.x),
                    Napi::Number::New(env, location.y)
                });
            });
        }
    }
    
    // 让事件继续传播
    return event;
}

// 启动全局鼠标监听
Napi::Value StartGlobalMouseListener(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    if (info.Length() < 1 || !info[0].IsFunction()) {
        Napi::TypeError::New(env, "Callback function required").ThrowAsJavaScriptException();
        return env.Null();
    }
    
    // 检查权限
    if (!AXIsProcessTrusted()) {
        Napi::TypeError::New(env, "Accessibility permission required").ThrowAsJavaScriptException();
        return env.Null();
    }
    
    // 停止之前的监听
    if (mouseEventTap) {
        CGEventTapEnable(mouseEventTap, false);
        CFRelease(mouseEventTap);
        mouseEventTap = nullptr;
    }
    
    // 创建线程安全的回调
    mouseCallback = Napi::ThreadSafeFunction::New(
        env,
        info[0].As<Napi::Function>(),
        "GlobalMouseListener",
        0,
        1
    );
    
    // 创建事件监听器
    mouseEventTap = CGEventTapCreate(
        kCGSessionEventTap,
        kCGHeadInsertEventTap,
        kCGEventTapOptionDefault,
        CGEventMaskBit(kCGEventLeftMouseDown) | CGEventMaskBit(kCGEventRightMouseDown),
        MouseEventCallback,
        nullptr
    );
    
    if (!mouseEventTap) {
        Napi::Error::New(env, "Failed to create mouse event tap").ThrowAsJavaScriptException();
        return env.Null();
    }
    
    // 添加到运行循环
    CFRunLoopSourceRef runLoopSource = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, mouseEventTap, 0);
    CFRunLoopAddSource(CFRunLoopGetCurrent(), runLoopSource, kCFRunLoopCommonModes);
    CGEventTapEnable(mouseEventTap, true);
    CFRelease(runLoopSource);
    
    return Napi::Boolean::New(env, true);
}

// 停止全局鼠标监听
Napi::Value StopGlobalMouseListener(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    if (mouseEventTap) {
        CGEventTapEnable(mouseEventTap, false);
        CFRelease(mouseEventTap);
        mouseEventTap = nullptr;
    }
    
    if (mouseCallback) {
        mouseCallback.Release();
    }
    
    return Napi::Boolean::New(env, true);
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

// 高级鼠标事件处理（无焦点抢夺）
Napi::Value HandleMouseEventWithoutFocus(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    if (info.Length() < 3) {
        Napi::TypeError::New(env, "Expected 3 arguments: x, y, eventType").ThrowAsJavaScriptException();
        return env.Null();
    }
    
    double x = info[0].As<Napi::Number>().DoubleValue();
    double y = info[1].As<Napi::Number>().DoubleValue();
    std::string eventType = info[2].As<Napi::String>();
    
    CGPoint location = CGPointMake(x, y);
    
    // 获取当前焦点窗口信息（用于恢复）
    pid_t currentFocusedPID = 0;
    AXUIElementRef systemWideElement = AXUIElementCreateSystemWide();
    CFTypeRef focusedApp = NULL;
    
    if (systemWideElement) {
        AXUIElementCopyAttributeValue(
            systemWideElement,
            kAXFocusedApplicationAttribute,
            &focusedApp
        );
        
        if (focusedApp) {
            AXUIElementGetPid((AXUIElementRef)focusedApp, &currentFocusedPID);
        }
    }
    
    bool success = false;
    
    if (eventType == "click") {
        // 创建鼠标点击事件但不改变焦点
        CGEventRef mouseDown = CGEventCreateMouseEvent(
            NULL,
            kCGEventLeftMouseDown,
            location,
            kCGMouseButtonLeft
        );
        
        CGEventRef mouseUp = CGEventCreateMouseEvent(
            NULL,
            kCGEventLeftMouseUp,
            location,
            kCGMouseButtonLeft
        );
        
        if (mouseDown && mouseUp) {
            // 设置事件标志以避免焦点切换
            CGEventSetIntegerValueField(mouseDown, kCGMouseEventSubtype, kCGEventMouseSubtypeDefault);
            CGEventSetIntegerValueField(mouseUp, kCGMouseEventSubtype, kCGEventMouseSubtypeDefault);
            
            // 发送事件
            CGEventPost(kCGAnnotatedSessionEventTap, mouseDown);
            usleep(10000); // 10ms延迟
            CGEventPost(kCGAnnotatedSessionEventTap, mouseUp);
            
            CFRelease(mouseDown);
            CFRelease(mouseUp);
            success = true;
        }
    } else if (eventType == "hover") {
        // 创建鼠标移动事件
        CGEventRef mouseMove = CGEventCreateMouseEvent(
            NULL,
            kCGEventMouseMoved,
            location,
            kCGMouseButtonLeft
        );
        
        if (mouseMove) {
            CGEventPost(kCGAnnotatedSessionEventTap, mouseMove);
            CFRelease(mouseMove);
            success = true;
        }
    }
    
    // 强制恢复焦点到原应用（如果焦点被意外改变）
    if (currentFocusedPID > 0) {
        // 检查焦点是否被改变
        CFTypeRef newFocusedApp = NULL;
        if (systemWideElement) {
            AXUIElementCopyAttributeValue(
                systemWideElement,
                kAXFocusedApplicationAttribute,
                &newFocusedApp
            );
            
            if (newFocusedApp) {
                pid_t newPID = 0;
                AXUIElementGetPid((AXUIElementRef)newFocusedApp, &newPID);
                
                // 如果焦点被改变，尝试恢复
                if (newPID != currentFocusedPID) {
                    ProcessSerialNumber psn;
                    if (GetProcessForPID(currentFocusedPID, &psn) == noErr) {
                        SetFrontProcess(&psn);
                    }
                }
                
                CFRelease(newFocusedApp);
            }
        }
    }
    
    // 清理资源
    if (focusedApp) CFRelease(focusedApp);
    if (systemWideElement) CFRelease(systemWideElement);
    
    return Napi::Boolean::New(env, success);
}

// 获取鼠标下的UI元素信息（无焦点抢夺）
Napi::Value GetElementAtPosition(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    Napi::Object result = Napi::Object::New(env);
    
    if (info.Length() < 2) {
        result.Set("error", Napi::String::New(env, "Expected x, y coordinates"));
        return result;
    }
    
    double x = info[0].As<Napi::Number>().DoubleValue();
    double y = info[1].As<Napi::Number>().DoubleValue();
    
    // 检查权限
    if (!AXIsProcessTrusted()) {
        result.Set("error", Napi::String::New(env, "Accessibility permission required"));
        return result;
    }
    
    CGPoint location = CGPointMake(x, y);
    
    // 获取系统范围的accessibility object
    AXUIElementRef systemWideElement = AXUIElementCreateSystemWide();
    if (!systemWideElement) {
        result.Set("error", Napi::String::New(env, "Failed to create system wide element"));
        return result;
    }
    
    // 获取指定位置的UI元素
    AXUIElementRef elementAtPosition = NULL;
    AXError error = AXUIElementCopyElementAtPosition(
        systemWideElement,
        x, y,
        &elementAtPosition
    );
    
    if (error == kAXErrorSuccess && elementAtPosition) {
        result.Set("hasElement", Napi::Boolean::New(env, true));
        
        // 获取元素类型
        CFTypeRef elementRole = NULL;
        AXError roleError = AXUIElementCopyAttributeValue(
            elementAtPosition,
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
        
        // 获取元素标题/描述
        CFTypeRef elementTitle = NULL;
        AXUIElementCopyAttributeValue(
            elementAtPosition,
            kAXTitleAttribute,
            &elementTitle
        );
        
        if (elementTitle) {
            CFStringRef titleStr = (CFStringRef)elementTitle;
            CFIndex length = CFStringGetLength(titleStr);
            CFIndex maxSize = CFStringGetMaximumSizeForEncoding(length, kCFStringEncodingUTF8) + 1;
            char* buffer = new char[maxSize];
            
            if (CFStringGetCString(titleStr, buffer, maxSize, kCFStringEncodingUTF8)) {
                result.Set("elementTitle", Napi::String::New(env, buffer));
            }
            
            delete[] buffer;
            CFRelease(elementTitle);
        }
        
        // 检查是否可点击
        CFArrayRef actions = NULL;
        AXUIElementCopyActionNames(elementAtPosition, &actions);
        
        bool isClickable = false;
        if (actions) {
            CFIndex actionCount = CFArrayGetCount(actions);
            for (CFIndex i = 0; i < actionCount; i++) {
                CFStringRef action = (CFStringRef)CFArrayGetValueAtIndex(actions, i);
                if (CFStringCompare(action, kAXPressAction, 0) == kCFCompareEqualTo) {
                    isClickable = true;
                    break;
                }
            }
            CFRelease(actions);
        }
        
        result.Set("isClickable", Napi::Boolean::New(env, isClickable));
        
        CFRelease(elementAtPosition);
    } else {
        result.Set("hasElement", Napi::Boolean::New(env, false));
        result.Set("error", Napi::String::New(env, "No element found at position"));
    }
    
    CFRelease(systemWideElement);
    
    return result;
}

// 执行UI元素操作（无焦点抢夺）
Napi::Value PerformElementAction(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    if (info.Length() < 3) {
        Napi::TypeError::New(env, "Expected 3 arguments: x, y, action").ThrowAsJavaScriptException();
        return env.Null();
    }
    
    double x = info[0].As<Napi::Number>().DoubleValue();
    double y = info[1].As<Napi::Number>().DoubleValue();
    std::string action = info[2].As<Napi::String>();
    
    // 检查权限
    if (!AXIsProcessTrusted()) {
        return Napi::Boolean::New(env, false);
    }
    
    // 保存当前焦点状态
    AXUIElementRef systemWideElement = AXUIElementCreateSystemWide();
    CFTypeRef originalFocusedApp = NULL;
    pid_t originalPID = 0;
    
    if (systemWideElement) {
        AXUIElementCopyAttributeValue(
            systemWideElement,
            kAXFocusedApplicationAttribute,
            &originalFocusedApp
        );
        
        if (originalFocusedApp) {
            AXUIElementGetPid((AXUIElementRef)originalFocusedApp, &originalPID);
        }
    }
    
    bool success = false;
    
    // 获取指定位置的UI元素
    AXUIElementRef elementAtPosition = NULL;
    AXError error = AXUIElementCopyElementAtPosition(
        systemWideElement,
        x, y,
        &elementAtPosition
    );
    
    if (error == kAXErrorSuccess && elementAtPosition) {
        CFStringRef actionName = NULL;
        
        // 将action字符串转换为CFStringRef
        if (action == "press" || action == "click") {
            actionName = kAXPressAction;
        } else if (action == "increment") {
            actionName = kAXIncrementAction;
        } else if (action == "decrement") {
            actionName = kAXDecrementAction;
        }
        
        if (actionName) {
            // 执行操作
            AXError actionError = AXUIElementPerformAction(elementAtPosition, actionName);
            success = (actionError == kAXErrorSuccess);
            
            // 立即尝试恢复焦点
            if (success && originalPID > 0) {
                usleep(5000); // 5ms延迟让操作完成
                
                // 检查焦点是否被改变
                CFTypeRef currentFocusedApp = NULL;
                AXUIElementCopyAttributeValue(
                    systemWideElement,
                    kAXFocusedApplicationAttribute,
                    &currentFocusedApp
                );
                
                if (currentFocusedApp) {
                    pid_t currentPID = 0;
                    AXUIElementGetPid((AXUIElementRef)currentFocusedApp, &currentPID);
                    
                    if (currentPID != originalPID) {
                        // 焦点被改变，恢复到原应用
                        ProcessSerialNumber psn;
                        if (GetProcessForPID(originalPID, &psn) == noErr) {
                            SetFrontProcess(&psn);
                        }
                    }
                    
                    CFRelease(currentFocusedApp);
                }
            }
        }
        
        CFRelease(elementAtPosition);
    }
    
    // 清理资源
    if (originalFocusedApp) CFRelease(originalFocusedApp);
    if (systemWideElement) CFRelease(systemWideElement);
    
    return Napi::Boolean::New(env, success);
}

// 模块初始化
Napi::Object Init(Napi::Env env, Napi::Object exports) {
    exports.Set("checkAccessibilityPermission", Napi::Function::New(env, CheckAccessibilityPermission));
    exports.Set("requestAccessibilityPermission", Napi::Function::New(env, RequestAccessibilityPermission));
    exports.Set("getFocusedElement", Napi::Function::New(env, GetFocusedElement));
    exports.Set("insertTextToFocusedElement", Napi::Function::New(env, InsertTextToFocusedElement));
    exports.Set("getFocusedAppInfo", Napi::Function::New(env, GetFocusedAppInfo));
    exports.Set("simulatePasteKeystroke", Napi::Function::New(env, SimulatePasteKeystroke));
    
    // 全局鼠标监听功能
    exports.Set("startGlobalMouseListener", Napi::Function::New(env, StartGlobalMouseListener));
    exports.Set("stopGlobalMouseListener", Napi::Function::New(env, StopGlobalMouseListener));
    
    // 新增的高级鼠标事件处理功能
    exports.Set("handleMouseEventWithoutFocus", Napi::Function::New(env, HandleMouseEventWithoutFocus));
    exports.Set("getElementAtPosition", Napi::Function::New(env, GetElementAtPosition));
    exports.Set("performElementAction", Napi::Function::New(env, PerformElementAction));
    
    return exports;
}

NODE_API_MODULE(accessibility, Init)