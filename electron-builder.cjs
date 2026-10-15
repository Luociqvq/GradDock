/**
 * electron-builder 配置。
 * 默认打「精简版」：不带 rclone（85MB）、locales 只留中英文。
 * 要把本地 tools/ 下的 rclone 一起打进安装包：GRADDOCK_BUNDLE_RCLONE=1 npm run dist
 */
const fs = require('node:fs')
const path = require('node:path')

const bundleRclone = process.env.GRADDOCK_BUNDLE_RCLONE === '1'
const rcloneHere = fs.existsSync(path.join(__dirname, 'tools')) &&
  fs.readdirSync(path.join(__dirname, 'tools')).some((entry) =>
    fs.existsSync(path.join(__dirname, 'tools', entry, 'rclone.exe')))

if (bundleRclone && !rcloneHere) {
  console.warn('[electron-builder] 要求打包 rclone，但 tools/ 下没有 rclone.exe，这次仍然不带它')
}

module.exports = {
  appId: 'app.graddock.desktop',
  productName: 'GradDock',
  directories: { output: 'release', buildResources: 'build' },
  files: ['dist/**/*', 'electron/**/*', 'package.json'],
  // ssh2 的原生加速模块 cpu-features 是可选的，缺了会退回纯 JS。
  // CI 的 Windows runner 装了编译工具链，rebuild 会去编译它并失败，所以直接跳过。
  npmRebuild: false,
  extraResources: bundleRclone && rcloneHere
    ? [{ from: 'tools', to: 'tools', filter: ['**/rclone.exe'] }]
    : [],
  // 界面只有中文，Chromium 那 50 多种语言的字符串是白带的 40MB
  electronLanguages: ['zh-CN', 'en-US'],
  win: {
    icon: 'build/icon.png',
    target: [
      { target: 'nsis', arch: ['x64'] },
      { target: 'portable', arch: ['x64'] }
    ]
  },
  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    artifactName: '${productName}-Setup-${version}.${ext}'
  },
  portable: { artifactName: '${productName}-Portable-${version}.${ext}' }
}
