const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')
const { spawn, spawnSync } = require('node:child_process')
const { app, BrowserWindow, Tray, Menu, ipcMain, Notification, nativeImage, shell, screen, safeStorage, dialog } = require('electron')
const { aiParse, aiListModels } = require('./ai.js')

const DEV_URL = process.env.GRADDOCK_DEV
const CLOUD_DEFAULT_URL = ''
const CLOUD_SECRET_KEY = 'todoflow'
const AI_SECRET_KEY = 'ai'
const DATA_FILE = () => path.join(app.getPath('userData'), 'grad-dock.json')
const SECRET_FILE = () => path.join(app.getPath('userData'), 'grad-dock-secrets.json')

// Windows 通知中心顶部的来源名称取自 AppUserModelId：
// 不注册的话开发态会显示成 electron.app.Electron。这里对齐 electron-builder 的 appId，
// 并在 HKCU 登记一次显示名，这样通知标题就是 GradDock 而不是 Electron。
const APP_ID = 'app.graddock.desktop'
app.setAppUserModelId(APP_ID)
if (process.platform === 'win32') {
  try {
    // 不依赖 PATH：Git Bash 环境里启动时 spawnSync('reg') 可能解析不到，直接给绝对路径
    const reg = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'reg.exe')
    const res = spawnSync(reg, ['add', `HKCU\\Software\\Classes\\AppUserModelId\\${APP_ID}`, '/v', 'DisplayName', '/t', 'REG_SZ', '/d', 'GradDock', '/f'], { windowsHide: true, timeout: 5000 })
    if (res.error) console.warn('[GradDock] 注册通知显示名失败：', res.error.message)
  } catch (err) {
    /* 注册失败只影响通知上的应用名，不影响提醒本身 */
    console.warn('[GradDock] 注册通知显示名失败：', err.message)
  }
}

const SIZE = {
  square: { width: 56, height: 56 },
  pill: { width: 244, height: 56 },
  card: { width: 380, height: 580 },
  settings: { width: 380, height: 540 }
}

const PROBE_COMMAND = [
  'echo "HOST $(hostname)";',
  'echo "NPROC $(nproc 2>/dev/null)";',
  'echo "LOAD $(cut -d" " -f1-3 /proc/loadavg)";',
  'echo "UP $(cut -d" " -f1 /proc/uptime)";',
  'awk "/MemTotal/{t=\\$2}/MemAvailable/{a=\\$2}END{print \\"MEM \\" a \\" \\" t}" /proc/meminfo;',
  'df -P / | awk \'NR==2{print "DISK " $2 " " $3}\';',
  'nvidia-smi --query-gpu=name,utilization.gpu,memory.used,memory.total --format=csv,noheader,nounits 2>/dev/null | sed "s/^/GPU /"'
].join(' ')

let win = null
let tray = null
let mode = 'square'
let pillExtend = 'right'
let anchor = null
let moveTimer = null
let dragTimer = null
let unresponsiveTimer = null
let quitRequested = false
const notified = new Set()

function appWindow() {
  if (!win || win.isDestroyed()) return null
  return win
}

function send(channel, payload) {
  const w = appWindow()
  if (w && !w.webContents.isDestroyed()) w.webContents.send(channel, payload)
}

/**
 * 拖拽放在主进程轮询光标，而不是靠渲染层的 pointermove：
 * 窗口只有 56px，指针一挪出去渲染进程就拿不到事件了。
 */
function startWindowDrag() {
  const w = appWindow()
  if (!w) return
  stopWindowDrag()
  const box = w.getBounds()
  const cursor = screen.getCursorScreenPoint()
  // 偏移按圆点的原点算：窄条向左展开时圆点在窗口右端
  const orbOffsetX = mode === 'pill' && pillExtend === 'left' ? box.width - SIZE.square.width : 0
  const offX = cursor.x - box.x - orbOffsetX
  const offY = cursor.y - box.y
  const deadline = Date.now() + 30000

  dragTimer = setInterval(() => {
    const current = appWindow()
    if (!current || Date.now() > deadline) return stopWindowDrag()
    const point = screen.getCursorScreenPoint()
    const area = screen.getDisplayMatching({
      x: point.x,
      y: point.y,
      width: SIZE.square.width,
      height: SIZE.square.height
    }).workArea
    // 只保证圆点整颗留在屏内；窄条朝向每帧交给 placeFor 重算，
    // 这样圆点能一路贴到最右边，tip 到边上会自动翻向另一边展开。
    anchor = {
      x: Math.min(Math.max(point.x - offX, area.x), area.x + area.width - SIZE.square.width),
      y: Math.min(Math.max(point.y - offY, area.y), area.y + area.height - SIZE.square.height)
    }
    const before = pillExtend
    const next = placeFor(mode)
    const now = current.getBounds()
    if (next.x !== now.x || next.y !== now.y) current.setBounds(next, true)
    if (mode === 'pill' && pillExtend !== before) send('win:mode', { mode: 'pill', extend: pillExtend })
  }, 16)
}

function stopWindowDrag() {
  if (dragTimer) {
    clearInterval(dragTimer)
    dragTimer = null
  }
  const w = appWindow()
  if (w) {
    const b = w.getBounds()
    anchor = orbOriginFrom(b, mode)
    if (mode === 'square') persistBounds(b)
  }
}

function readStore() {
  try {
    const parsed = JSON.parse(fs.readFileSync(DATA_FILE(), 'utf8'))
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function writeStore(data) {
  const file = DATA_FILE()
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8')
  fs.renameSync(tmp, file)
  return true
}

function defaultAnchor() {
  const area = screen.getPrimaryDisplay().workArea
  return { x: area.x + area.width - SIZE.square.width - 26, y: area.y + 84 }
}

/** 窗口按这个 x 摆放时会溢出工作区多少像素（0 = 完全放得下）。 */
function overflowOf(x, width, area) {
  return Math.max(0, area.x - x) + Math.max(0, x + width - (area.x + area.width))
}

/**
 * 圆点始终以 anchor 为原点，窄条默认向右边长；右边放不下就整体翻到左边
 * （圆点贴窗口右缘），两边都放不下时选溢出更少的一侧。
 * 这样窗口变大时圆点既不会从指针底下溜走，tip 也不会被屏幕边缘裁掉。
 */
function placeFor(next) {
  const target = SIZE[next] || SIZE.card
  const area = screen.getDisplayMatching({ ...anchor, width: target.width, height: target.height }).workArea
  let x = anchor.x
  pillExtend = 'right'

  if (next === 'pill') {
    const leftX = anchor.x + SIZE.square.width - target.width
    const fitsRight = overflowOf(x, target.width, area) === 0
    const fitsLeft = overflowOf(leftX, target.width, area) === 0
    if (!fitsRight && (fitsLeft || overflowOf(leftX, target.width, area) < overflowOf(x, target.width, area))) {
      x = leftX
      pillExtend = 'left'
    }
  }

  x = Math.min(Math.max(x, area.x), Math.max(area.x, area.x + area.width - target.width))
  const y = Math.min(Math.max(anchor.y, area.y), Math.max(area.y, area.y + area.height - target.height))
  return { x, y, width: target.width, height: target.height }
}

/** 当前模式下圆点在屏幕上的原点，用于拖拽后回写 anchor。 */
function orbOriginFrom(bounds, currentMode) {
  if (currentMode === 'pill' && pillExtend === 'left') {
    return { x: bounds.x + SIZE.pill.width - SIZE.square.width, y: bounds.y }
  }
  return { x: bounds.x, y: bounds.y }
}

function applyMode(next) {
  mode = next
  const w = appWindow()
  if (!w) return
  const bounds = placeFor(next)
  w.setBounds(bounds, true)
  send('win:mode', { mode: next, extend: pillExtend })
}

function createWindow() {
  const saved = readStore()
  const savedBounds = saved.windowBounds && Number.isFinite(saved.windowBounds.x) ? saved.windowBounds : null
  anchor = savedBounds ? orbOriginFrom(savedBounds, 'square') : defaultAnchor()

  win = new BrowserWindow({
    ...SIZE.square,
    x: anchor.x,
    y: anchor.y,
    frame: false,
    transparent: true,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  win.setAlwaysOnTop(true, 'floating')
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

  if (DEV_URL) win.loadURL(DEV_URL)
  else win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))

  win.once('ready-to-show', () => win.show())
  win.on('show', () => send('win:visible', true))
  win.on('hide', () => send('win:visible', false))
  win.on('blur', () => send('win:blur'))
  // 渲染层卡死时给 5 秒自愈，还不行就重载界面；数据都在本机文件里，不会丢
  win.on('unresponsive', () => {
    clearTimeout(unresponsiveTimer)
    unresponsiveTimer = setTimeout(() => {
      const w = appWindow()
      if (!w || w.isResponsive()) return
      w.webContents.once('did-finish-load', () => applyMode('square'))
      w.webContents.reload()
    }, 5000)
  })
  win.on('responsive', () => { clearTimeout(unresponsiveTimer); unresponsiveTimer = null })
  win.on('moved', () => {
    clearTimeout(moveTimer)
    moveTimer = setTimeout(() => {
      const b = win.getBounds()
      anchor = orbOriginFrom(b, mode)
      if (mode === 'square') persistBounds(b)
    }, 350)
  })
  win.on('closed', () => { win = null })
}

function persistBounds(b) {
  const current = readStore()
  current.windowBounds = b
  try {
    writeStore(current)
  } catch {
    /* 位置丢失不影响数据，渲染层的写入会覆盖 */
  }
}

/** 方块右键菜单与托盘菜单共用；每次现建，所以标题和勾选都是当前状态。 */
function widgetMenu() {
  const prefs = readStore().prefs || {}
  return Menu.buildFromTemplate([
    { label: mode === 'square' ? '展开面板' : '收起为小方块', click: () => toggleFromTray() },
    { label: '立即刷新', click: () => send('tray:command', { action: 'refresh' }) },
    { label: '设置', click: () => { const w = appWindow(); if (w && !w.isVisible()) w.show(); applyMode('settings') } },
    { type: 'separator' },
    {
      label: '保持置顶',
      type: 'checkbox',
      checked: !!prefs.alwaysOnTop,
      click: (item) => send('tray:command', { action: 'set-top', value: item.checked })
    },
    { label: '隐藏窗口', click: () => { const w = appWindow(); if (w) w.hide() } },
    { label: '打开数据目录', click: () => shell.openPath(path.dirname(DATA_FILE())) },
    { type: 'separator' },
    { label: '退出 GradDock', click: () => { quitRequested = true; app.quit() } }
  ])
}

function buildTray(icon) {
  const image = icon && !icon.isEmpty() ? icon.resize({ width: 32, height: 32 }) : null
  if (!tray) tray = new Tray(image || nativeImage.createEmpty())
  else if (image) tray.setImage(image)

  tray.setContextMenu(widgetMenu())
  tray.setToolTip('GradDock · 研究生悬浮岛')
}

function toggleFromTray() {
  const w = appWindow()
  if (!w) return
  if (!w.isVisible()) w.show()
  applyMode(mode === 'square' ? 'card' : 'square')
  if (mode === 'card') w.focus()
}

function expandHome(input) {  const value = String(input || '').trim()
  if (value === '~' || value.startsWith('~/') || value.startsWith('~\\')) {
    return path.join(os.homedir(), value.slice(1).replace(/^[\\/]/, ''))
  }
  return value
}

/* ---------- 密码保管：DPAPI 加密，明文绝不进渲染层、绝不落明文盘 ---------- */

function readSecrets() {
  try {
    const parsed = JSON.parse(fs.readFileSync(SECRET_FILE(), 'utf8'))
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function writeSecrets(map) {
  const file = SECRET_FILE()
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(map, null, 2), 'utf8')
  fs.renameSync(tmp, file)
}

function takePassword(id) {
  const packed = readSecrets()[id]
  if (!packed) return null
  try {
    return safeStorage.decryptString(Buffer.from(packed, 'base64'))
  } catch {
    return null
  }
}

/**
 * 常驻连接池：每个节点维持一条 SSH 连接，采集只是在已有连接上 exec。
 * 避免每 30 秒重新握手认证一次（省 1 秒多的握手，也减少被 fail2ban 误判的机会）。
 */
const connections = new Map()

function connectionAuth(target) {
  if (target.auth === 'password') {
    const password = takePassword(target.id)
    if (!password) throw new Error('没有可用的已存密码，请点「编辑」重新填写')
    return { password, tryKeyboard: true }
  }
  const identity = expandHome(target.identityFile) || path.join(os.homedir(), '.ssh', 'id_ed25519')
  if (!fs.existsSync(identity)) throw new Error(`找不到私钥：${identity}`)
  return { privateKey: fs.readFileSync(identity) }
}

function ensureConnection(target) {
  return new Promise((resolve, reject) => {
    const key = target.id
    const existing = connections.get(key)
    if (existing?.alive) return resolve(existing.conn)
    if (existing?.pending) return existing.pending.then(resolve, reject)

    let Client
    try {
      Client = require('ssh2').Client
    } catch (err) {
      return reject(new Error(`ssh2 模块不可用：${err.message}`))
    }

    let auth
    try {
      auth = connectionAuth(target)
    } catch (err) {
      return reject(err)
    }

    const conn = new Client()
    const slot = { conn, alive: false, pending: null }
    connections.set(key, slot)

    const settleFail = (err) => {
      slot.pending = null
      if (connections.get(key) === slot) connections.delete(key)
      try { conn.end() } catch { /* 未建立 */ }
      reject(err)
    }

    slot.pending = new Promise((res, rej) => {
      conn.once('ready', () => {
        slot.alive = true
        slot.pending = null
        res(conn)
      })
      conn.once('error', (err) => settleFail(new Error(describeSshFailure(err.message, -1))))
      conn.on('close', () => {
        slot.alive = false
        if (connections.get(key) === slot) connections.delete(key)
      })
      conn.on('end', () => { slot.alive = false })
    }).then(resolve, reject)

    conn.connect({
      host: target.host,
      port: Number(target.port) || 22,
      username: target.user || 'root',
      readyTimeout: 8000,
      keepaliveInterval: 15000,
      keepaliveCountMax: 3,
      ...auth
    })
  })
}

function dropConnection(id) {
  const slot = connections.get(id)
  if (!slot) return
  connections.delete(id)
  try { slot.conn.end() } catch { /* 已断开 */ }
}

function execProbe(conn, target, started) {
  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    let settled = false
    const finish = (payload) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ id: target.id, ms: Date.now() - started, stdout, ...payload })
    }
    const timer = setTimeout(() => finish({ ok: false, error: '采集超时（15 秒），连接可能已被中间设备回收' }), 15000)

    conn.exec(target.command || PROBE_COMMAND, (err, stream) => {
      if (err) return finish({ ok: false, error: `无法执行命令：${err.message}` })
      stream.on('data', (chunk) => { stdout += chunk.toString() })
      stream.stderr.on('data', (chunk) => { stderr += chunk.toString() })
      stream.on('close', (code) => finish({
        ok: code === 0,
        error: code === 0 ? '' : describeSshFailure(stderr, code)
      }))
    })
  })
}

function describeSshFailure(stderr, code) {
  const text = String(stderr || '').trim()
  const first = text.split('\n').filter(Boolean).pop() || `退出码 ${code}`
  if (/all configured authentication methods failed/i.test(text)) return '用户名或密码不正确，或服务器未开启密码认证'
  if (/host key .*has changed|REMOTE HOST IDENTIFICATION HAS CHANGED|host key verification failed/i.test(text)) {
    return '服务器主机密钥与本机记录不一致（可能被重装或重置过）。请先向服务商/登录控制台核实指纹，确认无误后再更新 known_hosts，不要盲目信任'
  }
  if (/permission denied/i.test(text)) return `${first} · BatchMode 下不能输密码，请先配好密钥或启动 ssh-agent`
  if (/could not resolve hostname/i.test(text)) return `${first} · 主机名无法解析，内网别名需先写进 ~/.ssh/config`
  if (/connection timed out/i.test(text)) return `${first} · 连接超时，检查网络或防火墙`
  if (/no route to host/i.test(text)) return `${first} · 无法到达该主机`
  if (/command not found/i.test(text)) return `${first} · 远端缺少命令，服务器可能没有 nvidia-smi`
  return first
}

async function probeTarget(target) {
  const started = Date.now()
  if (!target) return { id: 'unknown', ok: false, error: '无效目标' }
  if (target.mock) {
    return {
      id: target.id,
      ok: true,
      mock: true,
      ms: 42,
      stdout: 'HOST demo-lab\nNPROC 4\nLOAD 3.41 2.18 1.62\nUP 298600\nMEM 2867200 7864320\nDISK 40960000 12582912\nGPU NVIDIA GeForce RTX 4090, 96, 22145, 24576\nGPU NVIDIA GeForce RTX 4090, 12, 1024, 24576\n'
    }
  }
  if (!target.host) return { id: target.id, ok: false, error: '未填写主机地址' }

  let conn
  try {
    conn = await ensureConnection(target)
  } catch (err) {
    dropConnection(target.id)
    return { id: target.id, ok: false, error: err.message }
  }

  const result = await execProbe(conn, target, started)
  // 常驻连接可能被服务端或中间设备悄悄断掉，失败一次就重建，下次采集用新连接
  if (!result.ok) dropConnection(target.id)
  return result
}

/* ---------- 备份：rclone 子进程 + 目录监听 ---------- */

// 只信任已核实过指纹的主机；没有条目就拒绝上传，而不是悄悄 TOFU。
// Go 的 SSH 库按服务端偏好协商算法，所以三种密钥都要收录，并在配置里锁定 ed25519。
/**
 * rclone 走 SFTP 且强制固定主机密钥：指纹不写在源码里，放在 userData/host-pins.json，
 * 格式 { "1.2.3.4": "一行一条 known_hosts 记录" }。没有登记过的地址一律拒绝上传，
 * 宁可不传也不悄悄接受一个可能被中间人的连接。
 */
const HOST_PINS_FILE = () => path.join(app.getPath('userData'), 'host-pins.json')

function readHostPins() {
  try {
    const parsed = JSON.parse(fs.readFileSync(HOST_PINS_FILE(), 'utf8'))
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

const PROGRESS_RE = /([\d.]+\s*[KMGTPE]?i?B)\s*\/\s*([\d.]+\s*[KMGTPE]?i?B),\s*(\d+)%,\s*([\w.]+\s*[KMGTPE]?i?B\/s),\s*ETA\s*(\S+)/

let rclonePath = null
function findRclone() {
  if (rclonePath) return rclonePath
  // 打包后 tools 走 extraResources，落在 resources/ 下而不是 asar 里
  const roots = app.isPackaged ? [path.join(process.resourcesPath, 'tools')] : [path.join(__dirname, '..', 'tools')]
  for (const base of roots) {
    const direct = path.join(base, 'rclone.exe')
    if (fs.existsSync(direct)) {
      rclonePath = direct
      return rclonePath
    }
    try {
      for (const entry of fs.readdirSync(base)) {
        const candidate = path.join(base, entry, 'rclone.exe')
        if (fs.existsSync(candidate)) {
          rclonePath = candidate
          return rclonePath
        }
      }
    } catch { /* 这个根下没带 rclone，退回 PATH */ }
  }
  rclonePath = 'rclone'
  return rclonePath
}

function backupDir() {
  return path.join(app.getPath('userData'), 'backup')
}

function toPosix(p) {
  return String(p).replace(/\\/g, '/')
}

function ensureRcloneConfig(node) {
  const pinned = readHostPins()[node.host]
  if (!pinned) throw new Error(`未固定 ${node.host} 的主机密钥指纹，已拒绝上传。先自行核实指纹，再把 ssh-keyscan 的结果写进 ${HOST_PINS_FILE()}`)
  const dir = backupDir()
  fs.mkdirSync(dir, { recursive: true })
  const knownHosts = path.join(dir, 'known_hosts')
  fs.writeFileSync(knownHosts, `${pinned}\n`)
  // 备份固定走只能 SFTP 的 graddock 账号，绝不借用监控节点的 root 身份
  const identity = path.join(os.homedir(), '.ssh', 'grad_dock_backup')
  if (!fs.existsSync(identity)) throw new Error(`找不到备份私钥：${identity}`)
  const conf = path.join(dir, 'rclone.conf')
  fs.writeFileSync(conf, [
    '[graddock]',
    'type = sftp',
    `host = ${node.host}`,
    'user = graddock',
    `key_file = ${toPosix(identity)}`,
    `known_hosts_file = ${toPosix(knownHosts)}`,
    'host_key_algorithms = ssh-ed25519',
    // graddock 是 forced-command 账号，服务器上跑不了 md5sum，
    // 所以关掉 shell 校验，改由 size + modtime 判断（见 README 里的取舍说明）
    'disable_hashcheck = true',
    'shell_type = unix',
    ''
  ].join('\n'))
  return conf
}

const rcloneChildren = new Set()

function runRclone(args, conf, onProgress) {
  return new Promise((resolve) => {
    let child
    try {
      child = spawn(findRclone(), ['--config', conf, ...args], { windowsHide: true })
    } catch (err) {
      return resolve({ ok: false, error: `无法启动 rclone：${err.message}` })
    }
    rcloneChildren.add(child)
    let tail = ''
    const handle = (chunk) => {
      const text = chunk.toString()
      for (const piece of text.split(/[\r\n]/)) {
        const match = PROGRESS_RE.exec(piece)
        if (match && onProgress) {
          onProgress({ transferred: match[1], total: match[2], percent: Number(match[3]), speed: match[4], eta: match[5] })
        }
      }
      tail = (tail + text).slice(-6000)
    }
    child.stdout.on('data', handle)
    child.stderr.on('data', handle)
    child.on('error', (err) => {
      rcloneChildren.delete(child)
      resolve({ ok: false, error: `rclone 执行失败：${err.message}`, hint: '未找到 tools/ 下的 rclone' })
    })
    child.on('close', (code) => {
      rcloneChildren.delete(child)
      resolve({ ok: code === 0, code, output: tail })
    })
  })
}

function describeRcloneFailure(output) {
  const text = String(output || '')
  if (/Host key verification failed|REMOTE HOST IDENTIFICATION HAS CHANGED/i.test(text)) return '服务器主机密钥与固定值不符，已中止上传（可能被中间人，或服务器重装过）'
  if (/Permission denied \(publickey/i.test(text)) return '备份私钥未被服务器接受，需重新登记公钥'
  if (/connection refused|no route to host|network is unreachable/i.test(text)) return '连不上服务器，检查网络或防火墙'
  if (/Authentication failed/i.test(text)) return '认证失败'
  const lines = text.split(/[\r\n]/).map((l) => l.trim()).filter((l) => /ERROR|Couldn't|failed/i.test(l))
  return lines.pop() || `rclone 退出码异常`
}

function excludePatterns(job) {
  return String(job.excludes || '')
    .split(/[\n;]+/)
    .map((line) => line.trim())
    .filter(Boolean)
}

const runningJobs = new Map()
const watchers = new Map()
const watchTimers = new Map()
let watchedJobs = new Map()
let watchedNode = null

async function startBackup(job, node, trigger) {
  if (runningJobs.get(job.id)) return { ok: false, skipped: true, id: job.id }
  runningJobs.set(job.id, true)
  const started = Date.now()
  send('backup:state', { id: job.id, running: true, trigger, at: started })

  let conf
  try {
    conf = ensureRcloneConfig(node)
  } catch (err) {
    runningJobs.set(job.id, false)
    const payload = { id: job.id, running: false, ok: false, error: err.message, at: started }
    send('backup:state', payload)
    return payload
  }

  const args = ['sync', job.local, `graddock:${job.remotePath}`,
    '--transfers', '4', '--checkers', '8',
    '--stats', '1s', '--stats-one-line', '--progress',
    '--contimeout', '15s', '--timeout', '30s', '--retries', '2',
    '--user-agent', 'GradDock']
  // sync 默认镜像删除：本地误删或被勒索软件加密，备份会跟着一起没。
  // 所以被覆盖/被删掉的文件先挪进带日期的历史目录，保留可回滚的余地。
  // 注意 rclone 要求 backup-dir 不能和目标重叠，所以放同级而不是子目录。
  const stamp = new Date().toISOString().slice(0, 10)
  args.push('--backup-dir', `graddock:${job.remotePath.replace(/\/$/, '')}_history/${stamp}`)
  for (const pattern of excludePatterns(job)) args.push('--exclude', pattern)

  const result = await runRclone(args, conf, (progress) => send('backup:progress', { id: job.id, ...progress }))
  runningJobs.set(job.id, false)
  const payload = {
    id: job.id,
    running: false,
    ok: result.ok,
    error: result.ok ? '' : describeRcloneFailure(result.output),
    at: Date.now(),
    ms: Date.now() - started
  }
  send('backup:state', payload)
  return payload
}

function scheduleSync(jobId) {
  if (watchTimers.has(jobId)) clearTimeout(watchTimers.get(jobId))
  watchTimers.set(jobId, setTimeout(() => {
    watchTimers.delete(jobId)
    const job = watchedJobs.get(jobId)
    if (job && watchedNode) startBackup(job, watchedNode, 'watch')
  }, 8000))
}

function setupWatchers(jobs, node) {
  watchedNode = node
  const wanted = new Map((jobs || []).filter((j) => j.enabled && j.local).map((j) => [j.id, j]))
  watchedJobs = wanted

  for (const [id, watcher] of watchers) {
    if (!wanted.has(id)) {
      watcher.close()
      watchers.delete(id)
    }
  }
  for (const [id, job] of wanted) {
    if (watchers.has(id)) continue
    try {
      const watcher = fs.watch(job.local, { recursive: true }, () => scheduleSync(id))
      watcher.on('error', () => {
        watcher.close()
        watchers.delete(id)
        send('backup:state', { id, running: false, ok: false, error: '监听中断：文件夹可能被删除或卸载' })
      })
      watchers.set(id, watcher)
      scheduleSync(id)
    } catch (err) {
      send('backup:state', { id, running: false, ok: false, error: `无法监听该文件夹：${err.message}` })
    }
  }
}

async function remoteStatus(job, node) {
  let conf
  try {
    conf = ensureRcloneConfig(node)
  } catch (err) {
    return { ok: false, error: err.message }
  }
  const result = await runRclone(['size', `graddock:${job.remotePath}`, '--json', '--no-check-embed'], conf)
  if (!result.ok) return { ok: false, error: describeRcloneFailure(result.output) }
  try {
    const parsed = JSON.parse(result.output.slice(result.output.indexOf('[')))
    const first = parsed[0] || {}
    return { ok: true, bytes: Number(first.bytes) || 0, count: Number(first.count) || 0 }
  } catch {
    return { ok: false, error: '无法解析远端统计' }
  }
}

/* ---------- 待办云同步：可选，连用户自建的 TodoFlow ---------- */

function tfBase() {
  const saved = readStore()
  const url = saved.cloud && saved.cloud.url
  return typeof url === 'string' && url.trim() ? url.trim().replace(/\/+$/, '') : CLOUD_DEFAULT_URL
}

function tfSession() {
  const packed = readSecrets()[CLOUD_SECRET_KEY]
  if (!packed) return null
  try {
    const parsed = JSON.parse(safeStorage.decryptString(Buffer.from(packed, 'base64')))
    return parsed && parsed.refresh ? parsed : null
  } catch {
    return null
  }
}

function tfSave(session) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('本机系统加密不可用，无法保存登录令牌')
  const map = readSecrets()
  map[CLOUD_SECRET_KEY] = safeStorage.encryptString(JSON.stringify(session)).toString('base64')
  writeSecrets(map)
}

function tfClear() {
  const map = readSecrets()
  delete map[CLOUD_SECRET_KEY]
  writeSecrets(map)
}

function tfTokenPair(data, base, email) {
  return {
    base,
    email: (data.user && data.user.email) || email || '',
    name: (data.user && (data.user.display_name || data.user.displayName)) || '',
    access: data.access_token,
    refresh: data.refresh_token,
    // 提前 30 秒判定过期，避免正好卡在请求途中失效
    exp: Date.now() + ((Number(data.expires_in) || 900) * 1000 - 30000)
  }
}

async function tfCall(base, path, { method = 'GET', body, token } = {}) {
  try {
    const res = await fetch(`${base}/api${path}`, {
      method,
      // 没有超时的 fetch 会让服务器那边半死不活时一直挂着，同步状态就再也回不来了
      signal: AbortSignal.timeout(15000),
      headers: {
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      body: body ? JSON.stringify(body) : undefined
    })
    let payload = null
    try {
      payload = await res.json()
    } catch {
      /* 网关错误页之类的非 JSON 返回，走下面的统一报错 */
    }
    return { status: res.status, payload }
  } catch (err) {
    return { status: 0, payload: null, networkError: err.message }
  }
}

function tfFail(result) {
  const payload = result.payload
  if (result.networkError) return { ok: false, offline: true, error: `连不上服务器：${result.networkError}` }
  return { ok: false, status: result.status, error: (payload && (payload.msg || payload.error)) || `请求失败（HTTP ${result.status}）` }
}

/**
 * 刷新令牌是一次性的（服务端做了重放即全部撤销），
 * 所以拿到新令牌必须立刻落盘，中途崩溃也不能再用旧的。
 */
async function tfRefresh(session) {
  const result = await tfCall(session.base, '/auth/refresh', { method: 'POST', body: { refresh_token: session.refresh } })
  const data = result.payload && result.payload.data
  if (result.status !== 200 || !data || !data.access_token) {
    tfClear()
    return null
  }
  const next = tfTokenPair(data, session.base, session.email)
  try {
    tfSave(next)
  } catch {
    return null
  }
  return next
}

async function tfAuthorized(path, options = {}) {
  let session = tfSession()
  if (!session) return { ok: false, needLogin: true, error: '还没有登录待办服务器' }
  if (!session.exp || Date.now() > session.exp) {
    session = await tfRefresh(session)
    if (!session) return { ok: false, needLogin: true, error: '登录已过期，请重新登录' }
  }
  let result = await tfCall(session.base, path, { ...options, token: session.access })
  if (result.status === 401) {
    session = await tfRefresh(session)
    if (!session) return { ok: false, needLogin: true, error: '登录已过期，请重新登录' }
    result = await tfCall(session.base, path, { ...options, token: session.access })
  }
  if (result.status !== 200 || !result.payload || result.payload.code !== 200) return tfFail(result)
  return { ok: true, data: result.payload.data }
}

function tfFromServer(row) {
  return {
    id: `tf${row.id}`,
    remoteId: Number(row.id),
    title: String(row.title || ''),
    done: !!row.done,
    tags: Array.isArray(row.tags) ? row.tags.filter(Boolean) : [],
    priority: ['high', 'medium', 'low'].includes(row.priority) ? row.priority : 'medium',
    dueDate: row.dueDate ? Number(row.dueDate) : null,
    createdAt: Number(row.createdAt) || Date.now(),
    updatedAt: Number(row.updatedAt) || 0,
    description: row.description || ''
  }
}

/** 服务端用 due_date 收、用 dueDate 发；null 会被当成"没传"，所以清日期得整字段跳过。 */
function tfToServer(input) {
  const out = {}
  if (input.title !== undefined) out.title = input.title
  if (input.priority !== undefined) out.priority = input.priority
  if (input.dueDate) out.due_date = Number(input.dueDate)
  if (input.tags !== undefined) out.tags = input.tags
  return out
}

const CLOUD_HANDLERS = {
  'cloud:status': () => {
    const session = tfSession()
    return { signedIn: !!session, email: session ? session.email : '', name: session ? session.name : '', url: session ? session.base : tfBase() }
  },
  'cloud:login': async (_e, item) => {
    const base = String((item && item.url) || tfBase()).trim().replace(/\/+$/, '')
    if (!base) return { ok: false, error: '请先填写待办服务器地址' }
    const result = await tfCall(base, '/auth/login', {
      method: 'POST',
      body: { email: String(item.email || '').trim(), password: String(item.password || '') }
    })
    const data = result.payload && result.payload.data
    if (result.status !== 200 || !data || !data.access_token) return tfFail(result)
    try {
      tfSave(tfTokenPair(data, base, item.email))
    } catch (err) {
      return { ok: false, error: err.message }
    }
    const current = readStore()
    current.cloud = { ...(current.cloud || {}), url: base }
    writeStore(current)
    return { ok: true, email: data.user ? data.user.email : String(item.email || ''), name: data.user ? (data.user.display_name || '') : '' }
  },
  'cloud:logout': async () => {
    const session = tfSession()
    if (session) {
      await tfCall(session.base, '/auth/logout', { method: 'POST', body: { refresh_token: session.refresh }, token: session.access })
      tfClear()
    }
    return { ok: true }
  },
  'cloud:pull': async () => {
    const res = await tfAuthorized('/todos')
    return res.ok ? { ok: true, todos: (res.data || []).map(tfFromServer) } : res
  },
  'cloud:create': async (_e, input) => {
    const res = await tfAuthorized('/todos', { method: 'POST', body: tfToServer(input || {}) })
    return res.ok ? { ok: true, todo: tfFromServer(res.data) } : res
  },
  'cloud:update': async (_e, payload) => {
    const res = await tfAuthorized('/todos', {
      method: 'PUT',
      body: { id: payload.remoteId, ...tfToServer(payload.patch || {}) }
    })
    return res.ok ? { ok: true, todo: tfFromServer(res.data) } : res
  },
  'cloud:toggle': async (_e, payload) => {
    const res = await tfAuthorized('/todos/toggle', { method: 'PUT', body: { id: payload.remoteId } })
    return res.ok ? { ok: true, id: payload.remoteId, done: !!res.data.done } : res
  },
  'cloud:remove': async (_e, payload) => {
    const res = await tfAuthorized('/todos', { method: 'DELETE', body: { id: payload.remoteId } })
    return res.ok ? { ok: true, id: payload.remoteId } : res
  }
}

/* ---------- 快速添加：可选用大模型把随口一句话拆成待办 ---------- */

function aiKey() {
  const packed = readSecrets()[AI_SECRET_KEY]
  if (!packed) return ''
  try {
    return safeStorage.decryptString(Buffer.from(packed, 'base64'))
  } catch {
    return ''
  }
}

/** 服务商、模型这些是非敏感配置，跟着 store 走；只有 API Key 进加密的 secrets 文件。 */
function aiConfig() {
  const saved = readStore().ai
  return saved && typeof saved === 'object' ? saved : {}
}

/** 让模型复用已有标签，不然同一件事会被拆成「论文」和「写论文」两个标签。 */
function aiTagPool() {
  const todos = Array.isArray(readStore().todos) ? readStore().todos : []
  const tags = []
  for (const todo of todos) {
    for (const tag of Array.isArray(todo && todo.tags) ? todo.tags : []) {
      if (tag && !tags.includes(tag)) tags.push(tag)
      if (tags.length === 20) return tags
    }
  }
  return tags
}

const AI_HANDLERS = {
  'ai:status': () => ({ hasKey: !!aiKey(), config: aiConfig() }),
  'ai:models': async () => {
    const config = aiConfig()
    return aiListModels({ baseUrl: config.baseUrl, key: aiKey() })
  },
  'ai:set-key': (_e, value) => {
    const next = String(value ?? '').trim()
    if (next && !safeStorage.isEncryptionAvailable()) {
      return { ok: false, error: '本机系统加密不可用，为避免明文保存已拒绝' }
    }
    const map = readSecrets()
    if (next) map[AI_SECRET_KEY] = safeStorage.encryptString(next).toString('base64')
    else delete map[AI_SECRET_KEY]
    writeSecrets(map)
    return { ok: true, hasKey: !!next }
  },
  'ai:parse': async (_e, payload) => {
    // 启用与否由渲染层的开关决定，这里只管「配置齐了就解析」，设置页才能不开开关先试跑
    const config = aiConfig()
    return aiParse({
      baseUrl: config.baseUrl,
      model: config.model,
      key: aiKey(),
      text: payload && payload.text,
      now: payload && payload.now,
      tags: aiTagPool()
    })
  }
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const w = appWindow()
    if (!w) return
    if (!w.isVisible()) w.show()
    applyMode('card')
  })

  app.whenReady().then(() => {
    createWindow()
    buildTray()

    ipcMain.handle('store:read', () => readStore())
    ipcMain.handle('store:write', (_e, data) => writeStore(data))
    ipcMain.handle('app:info', () => ({ version: app.getVersion(), platform: process.platform, dataFile: DATA_FILE() }))
    ipcMain.handle('lab:probe', (_e, targets) => Promise.all((targets || []).map(probeTarget)))
    ipcMain.on('lab:reset', (_e, id) => {
      if (id) dropConnection(id)
      else for (const key of [...connections.keys()]) dropConnection(key)
    })

    ipcMain.handle('backup:pick', async () => {
      const result = await dialog.showOpenDialog({ title: '选择要备份的文件夹', properties: ['openDirectory'] })
      return result.canceled ? { ok: false } : { ok: true, path: result.filePaths[0] }
    })
    ipcMain.handle('backup:run', (_e, payload) => startBackup(payload.job, payload.node, 'manual'))
    ipcMain.handle('backup:status', (_e, payload) => remoteStatus(payload.job, payload.node))
    ipcMain.on('backup:watch', (_e, payload) => setupWatchers(payload.jobs, payload.node))
    ipcMain.on('backup:stop', () => setupWatchers([], null))

    for (const [channel, handler] of Object.entries({ ...CLOUD_HANDLERS, ...AI_HANDLERS })) ipcMain.handle(channel, handler)

    ipcMain.handle('secret:set', (_e, item) => {
      if (!item || !item.id) return { ok: false, error: '缺少节点标识' }
      if (!safeStorage.isEncryptionAvailable()) {
        return { ok: false, error: '本机系统加密不可用，为避免明文存储已拒绝，请改用密钥认证' }
      }
      const map = readSecrets()
      if (item.password) map[item.id] = safeStorage.encryptString(String(item.password)).toString('base64')
      else delete map[item.id]
      writeSecrets(map)
      return { ok: true, has: !!map[item.id] }
    })
    ipcMain.handle('secret:has', (_e, id) => ({ has: !!readSecrets()[id] }))
    ipcMain.handle('secret:delete', (_e, id) => {
      const map = readSecrets()
      delete map[id]
      writeSecrets(map)
      return { ok: true }
    })

    ipcMain.on('win:mode', (_e, next) => applyMode(next))
    // 右键归属由渲染层决定：条目行自己弹 HTML 菜单并阻止冒泡，空白处才走到这里
    ipcMain.on('win:widget-menu', () => {
      const w = appWindow()
      if (w) widgetMenu().popup({ window: w })
    })
    // 渲染层判断不出指针是不是真的离开了窗口（透明窗、窗口刚改过尺寸都可能误报），
    // 由主进程拿系统光标坐标对着窗口边界确认。
    ipcMain.handle('win:cursor-inside', () => {
      const w = appWindow()
      if (!w || !w.isVisible()) return false
      const b = w.getBounds()
      const p = screen.getCursorScreenPoint()
      return p.x >= b.x && p.x < b.x + b.width && p.y >= b.y && p.y < b.y + b.height
    })
    ipcMain.on('win:hide', () => { const w = appWindow(); if (w) w.hide() })
    ipcMain.on('win:focus', () => { const w = appWindow(); if (w) w.focus() })
    ipcMain.on('win:quit', () => { quitRequested = true; app.quit() })
    ipcMain.on('win:topmost', (_e, on) => { const w = appWindow(); if (w) w.setAlwaysOnTop(!!on, 'floating') })
    ipcMain.on('win:drag-start', () => startWindowDrag())
    ipcMain.on('win:drag-stop', () => stopWindowDrag())
    ipcMain.on('tray:icon', (_e, dataUrl) => {
      buildTray(nativeImage.createFromDataURL(dataUrl))
    })
    ipcMain.on('notify:show', (_e, item) => {
      if (!item || !Notification.isSupported()) return
      const key = String(item.key || item.title)
      if (notified.has(key)) return
      notified.add(key)
      // 提醒去重表按「待办 × 天」增长，删掉的待办会留下永久键，封顶后整表重置
      if (notified.size > 400) notified.clear()
      const note = new Notification({ title: item.title, body: item.body || '' })
      note.on('click', () => { const w = appWindow(); if (w) { w.show(); applyMode('card') } })
      note.show()
    })
  })

  app.on('before-quit', () => {
    quitRequested = true
    // 不主动收干净的话，退出后 rclone 还在传、SSH 连接还挂在服务器上
    for (const child of rcloneChildren) {
      try { child.kill() } catch { /* 已退出 */ }
    }
    for (const key of [...connections.keys()]) dropConnection(key)
  })

  app.on('window-all-closed', () => {
    if (quitRequested) app.quit()
  })
}
