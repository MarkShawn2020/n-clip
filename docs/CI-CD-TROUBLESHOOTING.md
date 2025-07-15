# CI/CD 故障排除指南

## 常见问题及解决方案

### 1. 依赖锁定文件问题

**错误信息**:
```
Error: Dependencies lock file is not found in /home/runner/work/n-clip/n-clip. 
Supported file patterns: package-lock.json,npm-shrinkwrap.json,yarn.lock
Will run Yarn commands in directory "."
```

**解决方案**:
- ✅ 已修复: 移除了Node.js setup中的`cache: 'npm'`配置
- ✅ 已修复: 使用pnpm专用的缓存配置
- ✅ 已修复: 所有脚本改为使用pnpm而非npm
- ✅ 已修复: 替换samuelmeuli/action-electron-builder为直接使用pnpm build命令

### 2. PNPM锁定文件缺失

**错误信息**:
```
ERR_PNPM_NO_LOCKFILE  Cannot install with "frozen-lockfile" because pnpm-lock.yaml is absent
```

**解决方案**:
- ✅ 已修复: 从`.gitignore`中移除了`pnpm-lock.yaml`
- ✅ 已修复: 确保`pnpm-lock.yaml`文件被提交到仓库
- ✅ 已修复: 更新CI中的pnpm版本至9.0以匹配lockfile版本
- 这个文件对于确保CI环境和本地环境的依赖版本一致性非常重要

### 3. 原生模块构建失败

**可能原因**:
- Python环境缺失
- 系统依赖缺失
- node-gyp配置问题
- 平台特定的代码在错误的平台上构建
- Python distutils模块在新版本中被移除
- N-API版本不兼容（sqlite3等依赖不支持新版本Electron）

**解决方案**:
- ✅ 已修复: 为所有平台添加Python 3.11环境（避免distutils问题）
- ✅ 已修复: 安装必要的系统依赖包
- ✅ 已修复: 添加平台特定的依赖安装步骤
- ✅ 已修复: 为accessibility模块添加平台特定的构建配置
- ✅ 已修复: 创建非macOS平台的stub实现
- ✅ 已修复: 添加postinstall脚本使用electron-builder install-app-deps（仅本地环境）
- ✅ 已修复: CI环境中手动运行electron-builder install-app-deps（在Python设置后）
- ✅ 已修复: 配置electron-builder跳过自动重建依赖
- ✅ 已修复: 改用分离架构构建避免universal二进制文件冲突
- ✅ 已修复: 移除未使用的sqlite3依赖（解决N-API版本不兼容）
- ✅ 已修复: 移除不必要的@electron/rebuild依赖

### 4. YAML语法错误

**错误信息**:
```
Invalid workflow file: .github/workflows/version.yml#L81
You have an error in your yaml syntax on line 81
```

**解决方案**:
- ✅ 已修复: 重写了version.yml中的CHANGELOG更新逻辑
- ✅ 已添加: workflow语法验证脚本
- 使用验证脚本检查语法:
  ```bash
  pnpm run validate-workflows
  ```

### 5. PNPM版本不匹配

**错误信息**:
```
Error: This project requires pnpm version X but found version Y
ERR_PNPM_NO_LOCKFILE  Cannot install with "frozen-lockfile" because pnpm-lock.yaml is absent
```

**解决方案**:
- ✅ 已修复: 更新workflows中的pnpm版本至9.0以匹配lockfile版本
- 确保CI中的pnpm版本与本地开发环境一致
- 检查`pnpm-lock.yaml`文件顶部的`lockfileVersion`来确定需要的pnpm版本
- 使用`pnpm install --frozen-lockfile`确保依赖版本一致

### 6. 代码签名失败

**错误信息**:
```
Error: Code signing failed
```

**解决方案**:
1. 确保GitHub Secrets配置正确:
   - `CSC_LINK`: Base64编码的证书文件
   - `CSC_KEY_PASSWORD`: 证书密码
   - `APPLE_ID`, `APPLE_ID_PASS`, `APPLE_TEAM_ID`: Apple公证相关

2. 证书格式检查:
   ```bash
   # 转换证书为Base64
   base64 -i certificate.p12 -o certificate.txt
   ```

### 7. 构建超时

**错误信息**:
```
Error: The job running on runner has exceeded the maximum execution time
```

**解决方案**:
- 优化构建流程，使用缓存
- 考虑分阶段构建
- 增加timeout设置

### 8. Universal二进制构建失败

**错误信息**:
```
Detected file "Contents/native/accessibility.node" that's the same in both x64 and arm64 builds and not covered by the x64ArchFiles rule
```

**解决方案**:
- ✅ 已修复: 改用分离架构构建（x64, arm64）而非universal
- ✅ 已修复: 这样可以为每个架构单独构建原生模块
- 如果需要universal构建，可以配置x64ArchFiles规则

### 9. Postinstall脚本失败

**错误信息**:
```
postinstall: ModuleNotFoundError: No module named 'distutils'
ELIFECYCLE Command failed with exit code 1
```

**解决方案**:
- ✅ 已修复: 在CI环境中跳过postinstall自动执行
- ✅ 已修复: 在CI中手动运行electron-builder install-app-deps（在Python设置后）
- ✅ 已修复: 本地环境仍然使用postinstall自动重建依赖

### 10. N-API版本不兼容和构建超时

**错误信息**:
```
prebuild-install warn This package does not support N-API version 36
prebuild-install http request GET https://github.com/TryGhost/node-sqlite3/releases/download/v5.1.7/sqlite3-v5.1.7-napi-v36-darwin-x64.tar.gz
prebuild-install http 404 https://github.com/TryGhost/node-sqlite3/releases/download/v5.1.7/sqlite3-v5.1.7-napi-v36-darwin-x64.tar.gz
Error: Process completed with exit code 1
```

**解决方案**:
- ✅ 已修复: 移除了未使用的sqlite3依赖（应用实际使用JSON文件存储）
- ✅ 已修复: 移除了不必要的@electron/rebuild依赖
- ✅ 已修复: 添加CI步骤超时配置防止挂起
- ✅ 已修复: 现在只有canvas作为唯一的原生依赖，兼容性更好

### 11. 测试失败

**错误信息**:
```
Tests failed in CI environment
No test files found, exiting with code 1
```

**解决方案**:
- ✅ 已修复: 添加`--passWithNoTests`标志，当没有测试文件时不会失败
- ✅ 已修复: CI中添加条件检查，只在有测试文件时运行测试
- 检查headless环境兼容性
- 确保测试不依赖特定的系统配置
- 使用虚拟显示器（如需要）

## 调试步骤

### 1. 本地复现

在推送到GitHub之前，先本地测试：

```bash
# 清理环境
rm -rf node_modules pnpm-lock.yaml

# 重新安装
pnpm install

# 构建测试
pnpm run build:native
pnpm run type-check
pnpm test
pnpm build
```

### 2. 逐步调试

如果CI失败，逐步启用workflow步骤：

1. 先只运行依赖安装
2. 然后添加TypeScript检查
3. 再添加测试
4. 最后添加构建

### 3. 查看详细日志

在workflow中启用详细日志：

```yaml
- name: Debug step
  run: |
    echo "Node version: $(node --version)"
    echo "PNPM version: $(pnpm --version)"
    echo "Working directory: $(pwd)"
    ls -la
```

### 4. 使用GitHub Actions的调试功能

在repository settings中启用：
- Actions > General > "Enable debug logging"

## 平台特定问题

### macOS
- 确保Xcode命令行工具已安装
- 检查代码签名证书有效性
- 验证Apple Developer账号权限

### Windows
- 确保Visual Studio Build Tools已安装
- 检查Windows SDK版本
- 验证Windows代码签名证书

### Linux
- 确保必要的系统库已安装
- 检查X11相关依赖
- 验证AppImage构建工具

## 预防措施

1. **定期更新依赖**: 使用`pnpm update`保持依赖最新
2. **锁定版本**: 使用`pnpm-lock.yaml`确保版本一致
3. **测试覆盖**: 确保CI和本地环境的一致性
4. **监控构建**: 设置构建状态通知
5. **文档同步**: 保持构建文档与实际配置同步

## 获取帮助

如果遇到无法解决的问题：

1. 查看GitHub Actions日志
2. 检查项目的Issue和Discussion
3. 参考electron-builder官方文档
4. 搜索相关的GitHub Issues

## 有用的链接

- [GitHub Actions文档](https://docs.github.com/en/actions)
- [electron-builder文档](https://www.electron.build/)
- [PNPM文档](https://pnpm.io/)