#include <napi.h>

// Stub implementation for non-macOS platforms
// These functions return false since accessibility features are macOS-specific

Napi::Value CheckAccessibilityPermission(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    // Return false for non-macOS platforms
    return Napi::Boolean::New(env, false);
}

Napi::Value RequestAccessibilityPermission(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    // Return false for non-macOS platforms
    return Napi::Boolean::New(env, false);
}

Napi::Value SimulateKeyPress(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    // Return false for non-macOS platforms
    return Napi::Boolean::New(env, false);
}

Napi::Value GetActiveAppInfo(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    // Return empty object for non-macOS platforms
    Napi::Object result = Napi::Object::New(env);
    result.Set("name", Napi::String::New(env, ""));
    result.Set("bundleId", Napi::String::New(env, ""));
    result.Set("pid", Napi::Number::New(env, 0));
    return result;
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
    exports.Set(Napi::String::New(env, "checkAccessibilityPermission"), 
                Napi::Function::New(env, CheckAccessibilityPermission));
    exports.Set(Napi::String::New(env, "requestAccessibilityPermission"), 
                Napi::Function::New(env, RequestAccessibilityPermission));
    exports.Set(Napi::String::New(env, "simulateKeyPress"), 
                Napi::Function::New(env, SimulateKeyPress));
    exports.Set(Napi::String::New(env, "getActiveAppInfo"), 
                Napi::Function::New(env, GetActiveAppInfo));
    return exports;
}

NODE_API_MODULE(accessibility, Init)