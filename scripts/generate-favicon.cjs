#!/usr/bin/env node

/**
 * 基于 logo.png 生成 favicon.ico 的脚本
 * 依赖: sharp 图像处理库
 */

const fs = require('fs')
const path = require('path')

async function generateFavicon() {
  try {
    // 动态导入 sharp
    const sharp = await import('sharp')
    
    const projectRoot = path.join(__dirname, '..')
    const logoPngPath = path.join(projectRoot, 'public/logo.png')
    const faviconPath = path.join(projectRoot, 'public/favicon.ico')
    
    console.log('开始基于 logo.png 生成 favicon.ico...')
    console.log('源文件:', logoPngPath)
    console.log('目标文件:', faviconPath)
    
    // 检查源文件是否存在
    if (!fs.existsSync(logoPngPath)) {
      throw new Error(`logo.png 不存在: ${logoPngPath}`)
    }
    
    // 生成不同尺寸的 ICO
    // ICO 格式通常包含多个尺寸: 16x16, 32x32, 48x48, 256x256
    const sizes = [16, 32, 48, 256]
    const buffers = []
    
    for (const size of sizes) {
      console.log(`生成 ${size}x${size} 尺寸...`)
      const buffer = await sharp.default(logoPngPath)
        .resize(size, size, {
          fit: 'contain',
          background: { r: 255, g: 255, b: 255, alpha: 0 } // 透明背景
        })
        .png()
        .toBuffer()
      
      buffers.push(buffer)
    }
    
    // 由于 sharp 不直接支持 ICO 格式输出，我们使用最常用的 32x32 尺寸作为 favicon
    // 并保存为 PNG 格式，然后重命名为 .ico（大多数浏览器都支持）
    const favicon32Buffer = await sharp.default(logoPngPath)
      .resize(32, 32, {
        fit: 'contain',
        background: { r: 255, g: 255, b: 255, alpha: 0 }
      })
      .png()
      .toBuffer()
    
    // 先备份原有的 favicon.ico（如果存在）
    if (fs.existsSync(faviconPath)) {
      const backupPath = faviconPath + '.backup.' + Date.now()
      fs.copyFileSync(faviconPath, backupPath)
      console.log('原 favicon.ico 已备份到:', backupPath)
    }
    
    // 写入新的 favicon
    fs.writeFileSync(faviconPath, favicon32Buffer)
    
    console.log('✅ favicon.ico 生成成功!')
    console.log('新文件大小:', fs.statSync(faviconPath).size, 'bytes')
    
    return true
    
  } catch (error) {
    console.error('❌ 生成 favicon.ico 失败:', error.message)
    
    if (error.code === 'MODULE_NOT_FOUND' && error.message.includes('sharp')) {
      console.log('\n解决方案: 请安装 sharp 依赖')
      console.log('运行命令: pnpm add -D sharp')
      console.log('或者: npm install --save-dev sharp')
    }
    
    return false
  }
}

// 如果直接运行此脚本
if (require.main === module) {
  generateFavicon().then(success => {
    process.exit(success ? 0 : 1)
  })
}

module.exports = generateFavicon