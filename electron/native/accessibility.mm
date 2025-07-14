#include <napi.h>
#include <ApplicationServices/ApplicationServices.h>
#include <CoreFoundation/CoreFoundation.h>
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
        Napi::TypeError::New(env, "Expected string argument").ThrowAsJavaScriptException();
        return env.Null();
    }
    
    std::string text = info[0].As<Napi::String>();
    
    // 检查权限
    if (!AXIsProcessTrusted()) {
        Napi::TypeError::New(env, "Accessibility permission required").ThrowAsJavaScriptException();
        return env.Null();
    }
    
    // 获取系统范围的accessibility object
    AXUIElementRef systemWideElement = AXUIElementCreateSystemWide();
    if (!systemWideElement) {
        return Napi::Boolean::New(env, false);
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
    
    bool success = false;
    
    if (error == kAXErrorSuccess && focusedElement) {
        // 创建要插入的文本
        CFStringRef textToInsert = CFStringCreateWithCString(
            kCFAllocatorDefault, 
            text.c_str(), 
            kCFStringEncodingUTF8
        );
        
        if (textToInsert) {
            // 尝试直接设置文本值
            error = AXUIElementSetAttributeValue(
                (AXUIElementRef)focusedElement,
                kAXValueAttribute,
                textToInsert
            );
            
            success = (error == kAXErrorSuccess);
            
            // 如果直接设置失败，尝试获取当前值并替换
            if (!success) {
                // 获取当前选择范围
                CFTypeRef selectedTextRange = NULL;
                error = AXUIElementCopyAttributeValue(
                    (AXUIElementRef)focusedElement,
                    kAXSelectedTextRangeAttribute,
                    &selectedTextRange
                );
                
                if (error == kAXErrorSuccess && selectedTextRange) {
                    // 设置选中的文本为我们要插入的文本
                    error = AXUIElementSetAttributeValue(
                        (AXUIElementRef)focusedElement,
                        kAXSelectedTextAttribute,
                        textToInsert
                    );
                    
                    success = (error == kAXErrorSuccess);
                    CFRelease(selectedTextRange);
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
    
    // 检查权限
    if (!AXIsProcessTrusted()) {
        Napi::TypeError::New(env, "Accessibility permission required").ThrowAsJavaScriptException();
        return env.Null();
    }
    
    // 获取系统范围的accessibility object
    AXUIElementRef systemWideElement = AXUIElementCreateSystemWide();
    if (!systemWideElement) {
        return env.Null();
    }
    
    // 获取焦点应用
    CFTypeRef focusedApp = NULL;
    AXError error = AXUIElementCopyAttributeValue(
        systemWideElement, 
        kAXFocusedApplicationAttribute, 
        &focusedApp
    );
    
    Napi::Object result = Napi::Object::New(env);
    
    // 添加调试信息
    result.Set("axError", Napi::Number::New(env, error));
    result.Set("hasFocusedApp", Napi::Boolean::New(env, focusedApp != NULL));
    
    if (error == kAXErrorSuccess && focusedApp) {
        // 先尝试获取应用的进程信息
        pid_t pid = 0;
        error = AXUIElementGetPid((AXUIElementRef)focusedApp, &pid);
        
        if (error == kAXErrorSuccess) {
            result.Set("pid", Napi::Number::New(env, pid));
        }
        
        // 获取应用名称 - 尝试多个属性
        CFTypeRef appName = NULL;
        
        // 首先尝试获取应用标题
        error = AXUIElementCopyAttributeValue(
            (AXUIElementRef)focusedApp,
            kAXTitleAttribute,
            &appName
        );
        
        // 如果标题失败，尝试获取应用名称
        if (error != kAXErrorSuccess || !appName) {
            if (appName) CFRelease(appName);
            error = AXUIElementCopyAttributeValue(
                (AXUIElementRef)focusedApp,
                kAXRoleDescriptionAttribute,
                &appName
            );
        }
        
        if (error == kAXErrorSuccess && appName) {
            CFStringRef appNameStr = (CFStringRef)appName;
            CFIndex length = CFStringGetLength(appNameStr);
            CFIndex maxSize = CFStringGetMaximumSizeForEncoding(length, kCFStringEncodingUTF8) + 1;
            char* buffer = new char[maxSize];
            
            if (CFStringGetCString(appNameStr, buffer, maxSize, kCFStringEncodingUTF8)) {
                result.Set("appName", Napi::String::New(env, buffer));
            }
            
            delete[] buffer;
            CFRelease(appName);
        }
        
        // 获取焦点元素信息
        CFTypeRef focusedElement = NULL;
        error = AXUIElementCopyAttributeValue(
            (AXUIElementRef)focusedApp,
            kAXFocusedUIElementAttribute,
            &focusedElement
        );
        
        if (error == kAXErrorSuccess && focusedElement) {
            result.Set("hasFocusedElement", Napi::Boolean::New(env, true));
            
            // 获取元素类型
            CFTypeRef elementRole = NULL;
            error = AXUIElementCopyAttributeValue(
                (AXUIElementRef)focusedElement,
                kAXRoleAttribute,
                &elementRole
            );
            
            if (error == kAXErrorSuccess && elementRole) {
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
    }
    
    CFRelease(systemWideElement);
    
    return result;
}

// 模块初始化
Napi::Object Init(Napi::Env env, Napi::Object exports) {
    exports.Set("checkAccessibilityPermission", Napi::Function::New(env, CheckAccessibilityPermission));
    exports.Set("requestAccessibilityPermission", Napi::Function::New(env, RequestAccessibilityPermission));
    exports.Set("getFocusedElement", Napi::Function::New(env, GetFocusedElement));
    exports.Set("insertTextToFocusedElement", Napi::Function::New(env, InsertTextToFocusedElement));
    exports.Set("getFocusedAppInfo", Napi::Function::New(env, GetFocusedAppInfo));
    
    return exports;
}

NODE_API_MODULE(accessibility, Init)