# CI/CD 故障排除指南

## 常见问题及解决方案

### 1. 依赖锁定文件问题

**错误信息**:
```
Error: Dependencies lock file is not found in /home/runner/work/n-clip/n-clip. 
Supported file patterns: package-lock.json,npm-shrinkwrap.json,yarn.lock
```

**解决方案**:
- ✅ 已修复: 移除了Node.js setup中的`cache: 'npm'`配置
- ✅ 已修复: 使用pnpm专用的缓存配置
- ✅ 已修复: 所有脚本改为使用pnpm而非npm

### 2. 原生模块构建失败

**可能原因**:
- Python环境缺失
- 系统依赖缺失
- node-gyp配置问题

**解决方案**:
- ✅ 已修复: 为Ubuntu添加Python 3.x环境
- ✅ 已修复: 安装必要的系统依赖包
- ✅ 已修复: 添加平台特定的依赖安装步骤

### 3. YAML语法错误

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

### 4. PNPM版本不匹配

**错误信息**:
```
Error: This project requires pnpm version X but found version Y
```

**解决方案**:
- 在workflows中指定pnpm版本: `version: 8`
- 使用`pnpm install --frozen-lockfile`确保依赖版本一致

### 4. 代码签名失败

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

### 5. 构建超时

**错误信息**:
```
Error: The job running on runner has exceeded the maximum execution time
```

**解决方案**:
- 优化构建流程，使用缓存
- 考虑分阶段构建
- 增加timeout设置

### 6. 测试失败

**错误信息**:
```
Tests failed in CI environment
```

**解决方案**:
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