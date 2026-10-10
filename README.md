# GradDock

研究生用的 Windows 桌面悬浮岛。平时是屏幕角落一个 56px 的小方块，上面写着还有几条待办、外圈是完成进度；
鼠标悬停弹出一条窄条预览最紧要的一件事，点一下展开成完整面板。

![GradDock 面板](docs/screenshot.png)

**下载**：去 [Releases](https://github.com/Luociqvq/GradDock/releases/latest) 拿 `GradDock-Portable-x.y.z.exe`，
单文件双击即用，不用装 Node、不用安装。

> 首次运行 Windows 会弹「未知发布者」——因为项目没有买代码签名证书。点「更多信息 → 仍要运行」即可。

## 交互

| 动作 | 结果 |
| --- | --- |
| 悬停小方块 | 弹出窄条，显示最紧要的一条待办或下一个安排 |
| 点一下 | 展开 380×580 面板（五张卡） |
| `Esc` / 点桌面别处 / 右上 × | 收回小方块 |
| 按住小方块拖动 | 可以贴到屏幕任意边缘，窄条会自动朝屏幕内侧展开 |
| 右键小方块 / 面板空白处 | 系统菜单：展开、刷新、设置、保持置顶、隐藏、退出 |
| 右键某一条待办 / 某个节点 / 某条日程 | 该项自己的操作菜单（见下） |

## 五张卡

- **待办**：自然语言快速添加 —— `组会 PPT 明天 #论文 !!` 会解析出标题、截止日、标签、优先级。
  逾期标红、今天到期标橙；逾期和当天到期发系统通知。右键一条可以改期、改优先级、完成、删除。
- **日程**：每周固定安排（组会、上课、健身），显示倒计时，开始前一小时通知。
- **服务器**：通过本机 `ssh` 跑**只读**探针，显示负载、内存、磁盘、运行时长、GPU（有卡才显示）。
  连接是常驻池，不会每 30 秒重新握手一次。右键节点可以单独刷新、看详细指标表、复制连接地址、停用或删除。
- **生活**：本月预算余额 + 待买清单。
- **备份**：选一个本地文件夹，用 rclone 增量同步到你自己的服务器；改动后 8 秒自动传，
  被覆盖或被删掉的文件先挪进带日期的历史目录，留一条回滚的路。

## 数据与隐私

这一节是先要说清楚的：

- 所有内容存在本机 `%APPDATA%\GradDock\grad-dock.json`。没有账号体系，没有遥测，不联网做任何后台请求。
- SSH 密码和云同步令牌存在同目录的 `grad-dock-secrets.json`，用 Windows DPAPI 加密，
  只有这台机器上你这个登录用户能解开；明文既不写进配置也不进渲染进程。
- 服务器卡只执行只读命令（`/proc/loadavg`、`/proc/meminfo`、`df -P`、`nproc`、`nvidia-smi`），
  `BatchMode=yes` 不弹交互，不往服务器写任何东西。
- 备份卡**强制固定服务器主机密钥**：指纹放在 `%APPDATA%\GradDock\host-pins.json`，
  没登记过的地址直接拒绝上传，不会静默接受一个可能是中间人的连接。
- 待办云同步默认关闭，源码里不含任何预置服务器地址。

## 从源码跑

环境：Windows 10/11，Node ≥ 20（开发用 24），npm。

```bash
npm install
npm run dev        # vite 热更新 + Electron，改代码用这个
npm start          # 先构建再直接跑
npm run dist       # 打包：release/ 下产出 NSIS 安装包 + 便携版
npm run dist:full  # 同上，但把本地 tools/ 里的 rclone 一起打进去（约 +35MB）
npm run icon       # 改品牌色后重新生成 build/icon.png
```

国内网络下载 Electron 与打包工具链需要镜像，否则 `npm run dist` 会在下载阶段卡住：

```bat
set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
set ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/
```

### 产物体积

安装包约 **70MB**（带 rclone 的 `dist:full` 约 104MB），装到硬盘约 231MB。里面绝大部分是
Electron/Chromium 运行时本体（`GradDock.exe` 一个就 188MB），我们的代码打包后只有约 1MB。
已经做过的裁剪：`locales` 只留 `zh-CN` + `en-US`（省约 39MB），`vue` / `lucide-vue-next`
这类只在构建期用到的包放在 devDependencies，不会被打进 `app.asar`（省 35MB）。

## 备份卡的额外准备

1. 把 `rclone.exe` 放到 `tools/<任意目录名>/`（用 `npm run dist:full` 会带上），或者装进系统 PATH。
2. 服务器上建一个只能 SFTP 的受限账号，然后 `ssh-keyscan -t ed25519 <host>`，
   **自己核实指纹无误后**写进 `%APPDATA%\GradDock\host-pins.json`，格式：
   ```json
   { "203.0.113.10": "203.0.113.10 ssh-ed25519 AAAA...（一行一条 known_hosts 记录）" }
   ```
3. 本机放好备份私钥（默认 `~/.ssh/grad_dock_backup`）。

> 走 forced-command 账号时 rclone 没法在远端算 md5，所以配置里关掉了 shell 校验，
> 改用 size + mtime 判断差异。代价是内容相同但改了名字或时间戳的文件不会被重新传。

## 待办云同步（可选）

设置 → 待办云同步 → 填你自己部署的 TodoFlow 地址、邮箱、密码。连上后「待办」卡直接读写服务器，
本机 JSON 退化成离线缓存；断网时还能看，改动会失败并提示。

注意：TodoFlow 的刷新令牌是**一次性**的（服务端做了重放检测，旧令牌再用一次就把该用户所有会话全部撤销），
所以同一账号只能有一个 GradDock 实例在同步，别同时开开发实例和安装版。

## 目录结构

```
electron/main.js        主进程：窗口与位置、托盘、右键菜单、SSH 连接池、rclone、云同步
electron/preload.js     受控的 IPC 白名单，渲染层拿不到 node
src/                    Vue 3 + Tailwind 渲染层，不含 Electron 专有逻辑
src/domain/             纯函数：时间与 DDL、日程展开、探针输出解析、快速添加解析
src/components/         五张卡 + 小方块 + 窄条 + 设置 + 右键菜单
scripts/make-icon.mjs   生成 build/icon.png
tools/                  可选：本地 rclone（不入库）
```

## 已知取舍

- **Electron 而不是 Tauri**：不需要 Rust 工具链，前端也没写任何 Electron 专有逻辑，留了以后迁移的余地；
  代价是常驻内存约 250–350MB。
- **没有代码签名**：Windows 会提示「未知发布者」。
- **没有自动更新**：升级靠下载新版覆盖。
- **中文界面**：只有简体中文。

## 许可

MIT，见 [LICENSE](LICENSE)。
