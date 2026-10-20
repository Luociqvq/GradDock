import { reactive, computed, watch } from 'vue'
import { parseQuickAdd, needsAi } from './domain/parse.js'
import { upcomingSchedules } from './domain/schedule.js'
import { dueMeta, startOfDay, DAY, dayKey } from './domain/time.js'
import { parseProbe, summarize } from './domain/lab.js'

const desktop = typeof window !== 'undefined' ? window.gradDock : null
const LS_KEY = 'grad-dock:data'
// 待办服务器是可选配置，源码里不带任何具体地址
export const CLOUD_DEFAULT_URL = ''

function seed() {
  const today = startOfDay(Date.now())
  const endOf = (offset) => today + offset * DAY + DAY - 1000
  return {
    version: 2,
    todos: [
      { id: 't1', title: '组会 PPT：补跑 Rebuttal 实验', done: false, tags: ['组会', '论文'], priority: 'high', dueDate: endOf(0), createdAt: today - 4 * DAY },
      { id: 't2', title: '第三章方法部分改写', done: false, tags: ['论文'], priority: 'high', dueDate: endOf(2), createdAt: today - 3 * DAY },
      { id: 't3', title: '精读 2 篇 KV-Cache 论文', done: false, tags: ['文献'], priority: 'medium', dueDate: endOf(1), createdAt: today - 2 * DAY },
      { id: 't4', title: '报销单交财务', done: false, tags: ['杂事'], priority: 'low', dueDate: endOf(5), createdAt: today - DAY },
      { id: 't5', title: '给导师发本周周报', done: false, tags: ['组会'], priority: 'medium', dueDate: endOf(7), createdAt: today },
      { id: 't6', title: '预约打印彩色封面', done: false, tags: ['杂事'], priority: 'low', dueDate: endOf(-1), createdAt: today - 6 * DAY },
      { id: 't7', title: '整理实验数据表', done: true, tags: ['论文'], priority: 'medium', dueDate: endOf(0), createdAt: today - 2 * DAY },
      { id: 't8', title: '更新参考文献', done: true, tags: ['论文'], priority: 'low', dueDate: null, createdAt: today - DAY }
    ],
    schedules: [
      { id: 'sch-group', title: '课题组组会', weekday: 3, time: '14:00', duration: 90, location: '主楼 A305', tag: '组会', enabled: true },
      { id: 'sch-english', title: '博士生英语', weekday: 2, time: '19:00', duration: 90, location: '外语楼 201', tag: '课', enabled: true },
      { id: 'sch-standup', title: '实验室例会', weekday: 4, time: '09:30', duration: 45, location: '线上 · 腾讯会议', tag: '会', enabled: true },
      { id: 'sch-gym', title: '健身 · 腿日', weekday: 5, time: '18:30', duration: 60, location: '南门健身房', tag: '生活', enabled: true }
    ],
    lab: {
      targets: [
        { id: 'lab-demo', name: '演示节点（不联网）', user: '', host: '', port: 22, identityFile: '', mock: true, enabled: true }
      ]
    },
    life: {
      monthKey: dayKey(Date.now()),
      budget: 3000,
      spent: 1731.6,
      shopping: [
        { id: 'b1', name: 'A4 打印纸 5 包', done: false },
        { id: 'b2', name: '机械键盘红轴', done: false },
        { id: 'b3', name: '插线板（实验室缺一个）', done: true }
      ]
    },
    backups: [
      { id: 'bk-default', name: '实验数据', local: '', remotePath: 'backups/lab', excludes: '*.tmp\n~$\n.ipynb_checkpoints/\n*.synctex.gz\n', bwlimit: '', enabled: false }
    ],
    prefs: {
      refreshSeconds: 30,
      alwaysOnTop: true,
      collapseOnBlur: true,
      notifyEnabled: true,
      defaultTab: 'todo'
    },
    // 令牌本身存在主进程的加密文件里，这里只留服务器地址
    cloud: { url: CLOUD_DEFAULT_URL },
    // API Key 同样不进这里，这里只有可以公开的服务商配置
    ai: { enabled: false, baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' }
  }
}

function merge(saved) {
  const base = seed()
  if (!saved || typeof saved !== 'object') return base
  // 结构升级时保留内容，只重置偏好与节点，避免旧默认值盖掉新行为
  const stale = saved.version !== base.version
  const merged = {
    ...base,
    ...saved,
    version: base.version,
    prefs: stale ? base.prefs : { ...base.prefs, ...(saved.prefs || {}) },
    lab: stale ? base.lab : { ...base.lab, ...(saved.lab || {}) },
    life: { ...base.life, ...(saved.life || {}) },
    cloud: { ...base.cloud, ...(saved.cloud || {}) },
    ai: { ...base.ai, ...(saved.ai || {}) }
  }
  // 后加的顶层集合在旧数据里不存在，不回填会让面板拿到 undefined
  for (const key of Object.keys(base)) {
    if (Array.isArray(base[key]) && !Array.isArray(merged[key])) merged[key] = base[key]
  }
  return merged
}

export const state = reactive({
  data: merge(null),
  ready: false,
  mode: 'square',
  pillExtend: 'right',
  tab: 'todo',
  now: Date.now(),
  visible: true,
  hovered: false,
  lab: { running: false, results: [], at: 0, error: '', secrets: {} },
  backup: { jobs: {}, progress: {} },
  cloud: { signedIn: false, email: '', name: '', url: CLOUD_DEFAULT_URL, syncing: false, error: '', at: 0 },
  ai: { hasKey: false, busy: false, error: '', tokens: 0 },
  bootError: ''
})

export async function boot() {
  let saved = null
  try {
    if (desktop) saved = await desktop.readStore()
    else saved = JSON.parse(localStorage.getItem(LS_KEY) || 'null')
  } catch (err) {
    state.bootError = `读取本地数据失败：${err.message}`
  }
  const data = merge(saved)
  if (data.life.monthKey !== dayKey(Date.now())) {
    data.life.monthKey = dayKey(Date.now())
  }
  state.data = data
  state.tab = data.prefs.defaultTab || 'todo'
  state.ready = true
  await syncSecrets()
  // 网络慢也不能挡住界面出来，云端拉取自己完成后再刷新列表
  bootCloud()
  syncAiStatus()
}

let saveTimer = null
function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(persist, 400)
}

/** 主进程是直接读盘拿配置的，改完 AI 设置要立刻落盘，否则紧接着试跑会读到旧值。 */
export async function flushSave() {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  await persist()
}

async function persist() {
  const payload = JSON.parse(JSON.stringify(state.data))
  try {
    if (desktop) await desktop.writeStore(payload)
    else localStorage.setItem(LS_KEY, JSON.stringify(payload))
  } catch (err) {
    state.bootError = `保存失败：${err.message}`
  }
}

watch(() => state.data, scheduleSave, { deep: true })

export function setMode(next) {
  state.mode = next
  if (next === 'card' || next === 'settings') state.data.prefs.defaultTab = state.tab
  if (desktop) desktop.setMode(next)
}

export function setTab(next) {
  state.tab = next
  state.data.prefs.defaultTab = next
}

/* ---------- 面板内的条目右键菜单 ---------- */

export const menu = reactive({ open: false, x: 0, y: 0, items: [] })

/** 分隔线传 { separator: true }；null 用来方便调用方按条件拼列表，会被丢掉。 */
export function openMenu(event, items) {
  const rows = (items || []).filter(Boolean)
  if (!rows.length) return
  menu.items = rows
  menu.x = event.clientX
  menu.y = event.clientY
  menu.open = true
}

export function closeMenu() {
  menu.open = false
  menu.items = []
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(String(text ?? ''))
    return true
  } catch {
    return false
  }
}

let seq = Date.now()
const nextId = (prefix) => `${prefix}${(seq += 1).toString(36)}`

export const getters = {
  pending: computed(() =>
    state.data.todos
      .filter((t) => !t.done)
      .sort((a, b) => {
        const av = a.dueDate || Number.MAX_SAFE_INTEGER
        const bv = b.dueDate || Number.MAX_SAFE_INTEGER
        return av - bv
      })
  ),
  completed: computed(() => state.data.todos.filter((t) => t.done).length),
  dueTodayCount: computed(() => getters.pending.value.filter((t) => {
    const m = dueMeta(t.dueDate, state.now)
    return m.rank <= 2
  }).length),
  overdueCount: computed(() => getters.pending.value.filter((t) => dueMeta(t.dueDate, state.now).overdue).length),
  progress: computed(() => {
    const total = state.data.todos.length
    if (!total) return 0
    return Math.round((state.data.todos.filter((t) => t.done).length / total) * 100)
  }),
  headline: computed(() => getters.pending.value[0] || null),
  scheduleList: computed(() => upcomingSchedules(state.data.schedules, state.now, 14)),
  nextSchedule: computed(() => getters.scheduleList.value[0] || null),
  shoppingLeft: computed(() => state.data.life.shopping.filter((s) => !s.done).length),
  balance: computed(() => Math.max(0, state.data.life.budget - state.data.life.spent))
}

export const actions = {
  /** 一条已解析好的待办落到服务器上。 */
  async createTodo(parsed) {
    if (!parsed.title) return null
    const res = cloudOk(await desktop.cloudCreate({
      title: parsed.title,
      priority: parsed.priority,
      dueDate: parsed.dueDate,
      tags: parsed.tags
    }))
    state.data.todos.unshift(res.todo)
    return res.todo
  },
  /**
   * 输入一句话 → 若干条待办。开了大模型就用它（能拆句、能懂「下周三下午三点」），
   * 没开、没配密钥或调用失败都退回本机规则解析，不能让断网时添加不了待办。
   * 返回创建出来的条目数组。
   */
  async addTodo(raw) {
    const text = String(raw || '').trim()
    if (!text) return []
    const created = []
    for (const parsed of await parseInput(text)) {
      const todo = state.cloud.signedIn ? await actions.createTodo(parsed) : localCreate(parsed)
      if (todo) created.push(todo)
    }
    return created
  },
  async toggleTodo(id) {
    const todo = state.data.todos.find((t) => t.id === id)
    if (!todo) return
    if (state.cloud.signedIn && todo.remoteId) {
      todo.done = cloudOk(await desktop.cloudToggle(todo.remoteId)).done
      return
    }
    todo.done = !todo.done
    todo.completedAt = todo.done ? Date.now() : null
  },
  async updateTodo(id, patch) {
    const todo = state.data.todos.find((t) => t.id === id)
    if (!todo) return
    if (state.cloud.signedIn && todo.remoteId) {
      Object.assign(todo, cloudOk(await desktop.cloudUpdate(todo.remoteId, patch)).todo)
      return
    }
    Object.assign(todo, patch)
  },
  async removeTodo(id) {
    const todo = state.data.todos.find((t) => t.id === id)
    if (state.cloud.signedIn && todo && todo.remoteId) cloudOk(await desktop.cloudRemove(todo.remoteId))
    state.data.todos = state.data.todos.filter((t) => t.id !== id)
  },
  async clearDone() {
    if (state.cloud.signedIn) {
      for (const todo of state.data.todos.filter((t) => t.done)) {
        if (todo.remoteId) cloudOk(await desktop.cloudRemove(todo.remoteId))
      }
    }
    state.data.todos = state.data.todos.filter((t) => !t.done)
  },
  addSchedule(input) {
    if (!input.title || !input.time) return
    state.data.schedules.push({
      id: nextId('sch-'),
      title: input.title,
      weekday: Number(input.weekday ?? new Date().getDay()),
      time: input.time,
      duration: Number(input.duration || 60),
      location: input.location || '',
      tag: input.tag || '安排',
      enabled: true
    })
  },
  removeSchedule(id) {
    state.data.schedules = state.data.schedules.filter((s) => s.id !== id)
  },
  setScheduleEnabled(id, value) {
    const item = state.data.schedules.find((s) => s.id === id)
    if (item) item.enabled = value
  },
  addShopping(name) {
    const trimmed = String(name || '').trim()
    if (!trimmed) return
    state.data.life.shopping.unshift({ id: nextId('b'), name: trimmed, done: false })
  },
  toggleShopping(id) {
    const item = state.data.life.shopping.find((s) => s.id === id)
    if (item) item.done = !item.done
  },
  removeShopping(id) {
    state.data.life.shopping = state.data.life.shopping.filter((s) => s.id !== id)
  },
  setPref(key, value) {
    state.data.prefs[key] = value
    if (key === 'alwaysOnTop' && desktop) desktop.setTopmost(!!value)
  },
  saveLabTarget(target) {
    const list = state.data.lab.targets
    const at = target.id ? list.findIndex((t) => t.id === target.id) : -1
    if (at >= 0) {
      list[at] = { ...list[at], ...target }
      if (desktop) desktop.resetLab(list[at].id)
      return list[at]
    }
    const created = { id: nextId('lab-'), enabled: true, ...target }
    list.push(created)
    return created
  },
  removeLabTarget(id) {
    state.data.lab.targets = state.data.lab.targets.filter((t) => t.id !== id)
    if (desktop) desktop.resetLab(id)
    state.lab.results = state.lab.results.filter((r) => r.id !== id)
  },
  resetAll() {
    state.data = seed()
  }
}

export async function syncSecrets() {
  if (!desktop) return
  const map = {}
  for (const target of state.data.lab.targets) {
    const res = await desktop.hasSecret(target.id).catch(() => null)
    map[target.id] = !!(res && res.has)
  }
  state.lab.secrets = map
}

export async function saveSecret(id, password) {
  if (!desktop) throw new Error('桌面端才能保存密码')
  const res = await desktop.setSecret(id, password)
  if (res && !res.ok) throw new Error(res.error)
  state.lab.secrets = { ...state.lab.secrets, [id]: !!(res && res.has) }
  desktop.resetLab(id)
}

const probeArgs = (t) => ({
  id: t.id,
  name: t.name,
  user: t.user,
  host: t.host,
  port: t.port,
  identityFile: t.identityFile,
  auth: t.auth,
  mock: !!t.mock,
  command: t.command
})

const withProbe = (r) => {
  const info = r && r.ok ? parseProbe(r.stdout) : null
  return { ...r, at: Date.now(), info, summary: info ? summarize(info) : null }
}

export async function refreshLab(force = false) {
  // 没填密码的密码认证节点直接跳过：反复认证失败可能触发 fail2ban 把你的 IP 封掉
  const targets = state.data.lab.targets.filter((t) => t.enabled && !(t.auth === 'password' && !t.mock && !state.lab.secrets[t.id]))
  if (!targets.length || (!force && (state.mode === 'square' || state.mode === 'pill') && state.lab.results.length)) return
  if (!desktop) {
    state.lab.error = '浏览器预览模式无法执行 SSH，桌面端可用'
    return
  }
  if (state.lab.running) return
  state.lab.running = true
  state.lab.error = ''
  try {
    const results = await desktop.probeLab(targets.map(probeArgs))
    state.lab.results = (results || []).map(withProbe)
    await syncSecrets()
    state.lab.at = Date.now()
  } catch (err) {
    state.lab.error = err.message || '刷新失败'
  } finally {
    state.lab.running = false
  }
}

/** 只探一个节点，结果按 id 合并回列表（右键菜单里的「刷新此节点」）。 */
export async function refreshTarget(target) {
  if (!desktop || state.lab.running || !target) return
  state.lab.running = true
  state.lab.error = ''
  try {
    const [result] = await desktop.probeLab([probeArgs(target)])
    if (result) state.lab.results = [...state.lab.results.filter((r) => r.id !== result.id), withProbe(result)]
    state.lab.at = Date.now()
  } catch (err) {
    state.lab.error = err.message || '刷新失败'
  } finally {
    state.lab.running = false
  }
}

/* ---------- 备份 ---------- */

export function backupTarget() {
  return state.data.lab.targets.find((t) => t.enabled && !t.mock) || null
}

export const backupGetters = {
  statusOf: (id) => state.backup.jobs[id] || {},
  progressOf: (id) => state.backup.progress[id] || null
}

Object.assign(actions, {
  addBackup() {
    state.data.backups.push({
      id: nextId('bk-'),
      name: '新备份任务',
      local: '',
      remotePath: `backups/task${state.data.backups.length + 1}`,
      excludes: '',
      bwlimit: '',
      enabled: false
    })
  },
  updateBackup(id, patch) {
    const job = state.data.backups.find((b) => b.id === id)
    if (!job) return
    Object.assign(job, patch)
  },
  removeBackup(id) {
    state.data.backups = state.data.backups.filter((b) => b.id !== id)
    delete state.backup.jobs[id]
    delete state.backup.progress[id]
  }
})

export async function pickBackupFolder(id) {
  if (!desktop) return
  const picked = await desktop.pickFolder()
  if (picked && picked.ok) actions.updateBackup(id, { local: picked.path })
}

export async function runBackupNow(id) {
  const job = state.data.backups.find((b) => b.id === id)
  const target = backupTarget()
  if (!job || !job.local) return { ok: false, error: '还没有选择要备份的文件夹' }
  if (!target) return { ok: false, error: '先在服务器卡里启用一个上传目标' }
  state.backup.progress[id] = null
  return desktop.runBackup({ ...job, nodeId: target.id }, { host: target.host })
}

export async function refreshBackupStatus(id) {
  const job = state.data.backups.find((b) => b.id === id)
  const target = backupTarget()
  if (!job || !job.local || !target || !desktop) return
  const res = await desktop.backupStatus({ ...job, nodeId: target.id }, { host: target.host })
  if (res && res.ok) {
    state.backup.jobs[id] = { ...(state.backup.jobs[id] || {}), remoteBytes: res.bytes, remoteCount: res.count, statusAt: Date.now() }
  }
}

export function applyBackupWatchers() {
  if (!desktop) return
  const jobs = state.data.backups.filter((b) => b.enabled && b.local)
  const target = backupTarget()
  if (!jobs.length || !target) {
    desktop.watchBackups([], null)
    return
  }
  desktop.watchBackups(
    jobs.map((j) => ({ ...j, nodeId: target.id })),
    { host: target.host }
  )
}

export function wireBackupEvents() {
  if (!desktop) return
  desktop.onBackupState((payload) => {
    if (!payload || !payload.id) return
    const prev = state.backup.jobs[payload.id] || {}
    state.backup.jobs[payload.id] = { ...prev, ...payload }
    if (payload.running) state.backup.progress[payload.id] = null
    else if (!payload.skipped) refreshBackupStatus(payload.id)
  })
  desktop.onBackupProgress((payload) => {
    if (payload && payload.id) state.backup.progress[payload.id] = payload
  })
}

/* ---------- 待办云同步（TodoFlow） ---------- */

function cloudOk(res) {
  if (res && res.ok) {
    state.cloud.error = ''
    state.cloud.at = Date.now()
    return res
  }
  state.cloud.error = (res && res.error) || '同步失败'
  if (res && res.needLogin) state.cloud.signedIn = false
  throw new Error(state.cloud.error)
}

export async function bootCloud() {
  if (!desktop) return
  const status = await desktop.cloudStatus().catch(() => null)
  if (!status) return
  state.cloud.signedIn = !!status.signedIn
  state.cloud.email = status.email || ''
  state.cloud.name = status.name || ''
  state.cloud.url = status.url || state.data.cloud.url || CLOUD_DEFAULT_URL
  state.data.cloud.url = state.cloud.url
  if (state.cloud.signedIn) await syncTodos()
}

/** 拉一次服务器列表，本机 todos 只当离线缓存。失败不抛，错误记在 state.cloud.error。 */
export async function syncTodos() {
  if (!desktop || !state.cloud.signedIn || state.cloud.syncing) return false
  state.cloud.syncing = true
  try {
    state.data.todos = cloudOk(await desktop.cloudPull()).todos
    return true
  } catch {
    return false
  } finally {
    state.cloud.syncing = false
  }
}

export async function cloudConnect({ url, email, password }) {
  if (!desktop) throw new Error('桌面端才能联网')
  const clean = String(url || '').trim()
  if (!clean) throw new Error('请先填写待办服务器地址')
  if (!/^https?:\/\//i.test(clean)) throw new Error('服务器地址要以 http:// 或 https:// 开头')
  const res = await desktop.cloudLogin({ url: clean, email, password })
  if (!res || !res.ok) {
    state.cloud.error = (res && res.error) || '登录失败'
    throw new Error(state.cloud.error)
  }
  state.cloud.signedIn = true
  state.cloud.email = res.email || String(email || '')
  state.cloud.name = res.name || ''
  state.cloud.url = clean
  state.cloud.error = ''
  state.data.cloud.url = clean
  await syncTodos()
  return res
}

/** 断开后保留最后一次服务器快照作为本地数据，不会把云端的东西删掉。 */
export async function cloudDisconnect() {
  if (desktop) await desktop.cloudLogout()
  state.cloud.signedIn = false
  state.cloud.email = ''
  state.cloud.name = ''
  state.cloud.at = 0
  state.cloud.error = ''
}

/* ---------- 快速添加的大模型解析（可选） ---------- */

function localCreate(parsed) {
  const todo = {
    id: nextId('t'),
    title: parsed.title,
    done: false,
    tags: parsed.tags || [],
    priority: parsed.priority || 'medium',
    dueDate: parsed.dueDate || null,
    createdAt: Date.now()
  }
  state.data.todos.unshift(todo)
  return todo
}

/** 四项都齐了才真去联网，否则直接走本机规则，省得每敲一条都报一次「没配好」。 */
export function aiReady() {
  const cfg = state.data.ai
  return !!(cfg.enabled && state.ai.hasKey && String(cfg.baseUrl || '').trim() && String(cfg.model || '').trim())
}

async function parseInput(text) {
  const local = parseQuickAdd(text, state.now)
  // 规则本来就读得懂的（「明天交报告 #杂事」）直接本地建，不联网、不等那两秒
  if (!desktop || !aiReady() || !needsAi(text, local)) return [local]
  state.ai.busy = true
  state.ai.error = ''
  try {
    const res = await desktop.aiParse(text, state.now)
    if (res && res.ok) {
      state.ai.tokens = res.tokens || 0
      // 模型认为这句话里没有待办（比如误触回车），就别再拿规则硬凑一条出来
      if (!res.items || !res.items.length) return []
      return res.items
    }
    state.ai.error = (res && res.error) || '大模型解析失败'
  } catch (err) {
    state.ai.error = err && err.message ? err.message : '大模型解析失败'
  } finally {
    state.ai.busy = false
  }
  return [local]
}

export async function syncAiStatus() {
  if (!desktop) return
  const res = await desktop.aiStatus().catch(() => null)
  if (res) state.ai.hasKey = !!res.hasKey
}

export async function saveAiConfig(patch) {
  Object.assign(state.data.ai, patch || {})
  await flushSave()
}

export async function setAiKey(key) {
  if (!desktop) throw new Error('浏览器预览模式不能保存密钥')
  const res = await desktop.aiSetKey(String(key || '').trim())
  if (!res || !res.ok) throw new Error((res && res.error) || '保存失败')
  state.ai.hasKey = !!res.hasKey
  if (!state.ai.hasKey) state.ai.error = ''
}

/** 试跑：走和添加待办完全相同的一条链路，只是不落库。 */
export async function testAiParse(text) {
  if (!desktop) throw new Error('浏览器预览模式不能联网')
  state.ai.busy = true
  state.ai.error = ''
  try {
    await flushSave()
    const res = await desktop.aiParse(text, Date.now())
    if (!res || !res.ok) {
      state.ai.error = (res && res.error) || '调用失败'
      return null
    }
    state.ai.tokens = res.tokens || 0
    return res.items || []
  } finally {
    state.ai.busy = false
  }
}

export function runAlerts() {
  if (!state.data.prefs.notifyEnabled || !desktop) return
  const today = dayKey(state.now)
  for (const todo of getters.pending.value) {
    const meta = dueMeta(todo.dueDate, state.now)
    if (meta.overdue) desktop.notify({ key: `todo:${todo.id}:overdue:${today}`, title: `「${todo.title}」已逾期`, body: `${meta.label}，先把它清掉` })
    else if (meta.label === '今天') desktop.notify({ key: `todo:${todo.id}:today:${today}`, title: '今天到期', body: `「${todo.title}」还没完成` })
  }
  const next = getters.nextSchedule.value
  if (next && next.start - state.now < 3600000 && next.start > state.now) {
    const mins = Math.max(1, Math.round((next.start - state.now) / 60000))
    desktop.notify({ key: `sch:${next.instanceKey}`, title: `${mins} 分钟后：${next.title}`, body: next.location || next.tag || '' })
  }
}
