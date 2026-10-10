<template>
  <div class="stage" @mouseenter="onEnter" @mouseleave="onLeave" @contextmenu.prevent="openWidgetMenu">
    <div v-if="!state.ready" class="boot">…</div>

    <SquareOrb v-else-if="state.mode === 'square'" @expand="expandNow" @pointerdown="onOrbPointerDown" />

    <HoverPill v-else-if="state.mode === 'pill'" :extend="state.pillExtend" @expand="expandNow" @orb-down="onOrbPointerDown" />

    <SettingsPanel v-else-if="state.mode === 'settings'" @close="expandNow" />

    <section v-else class="card pop">
      <header class="head drag">
        <div class="brand no-drag">
          <span class="mark"><Sparkles :size="13" /></span>
          <div class="brand-text">
            <strong>GradDock</strong>
            <em>{{ dateLabel }}</em>
          </div>
        </div>
        <nav class="tools no-drag" aria-label="控制">
          <button class="tool" :class="{ 'is-on': prefs.alwaysOnTop }" :title="prefs.alwaysOnTop ? '取消置顶' : '保持置顶'" @click="actions.setPref('alwaysOnTop', !prefs.alwaysOnTop)">
            <Pin v-if="prefs.alwaysOnTop" :size="14" />
            <PinOff v-else :size="14" />
          </button>
          <button class="tool" title="重新采集服务器数据" @click="refreshLab(true)">
            <RefreshCw :size="14" :class="{ spinning: state.lab.running }" />
          </button>
          <button class="tool" title="设置" @click="setMode('settings')"><Settings :size="14" /></button>
          <button class="tool tool--close" title="关闭展开" @click="collapse()"><X :size="15" /></button>
        </nav>
      </header>

      <section class="progress-block">
        <div class="progress-line">
          <span class="status-dot" :class="statusDot" />
          <strong>{{ getters.pending.value.length }}</strong>
          <small>项待办</small>
          <span v-if="getters.overdueCount.value" class="badge badge--danger">逾期 {{ getters.overdueCount.value }}</span>
          <span v-else-if="getters.dueTodayCount.value" class="badge badge--urgent">今天 {{ getters.dueTodayCount.value }}</span>
          <span class="ml-auto pct">{{ getters.progress.value }}%</span>
        </div>
        <div class="bar"><i :style="{ width: `${getters.progress.value}%` }" /></div>
      </section>

      <nav class="tabs no-drag">
        <button
          v-for="tab in TABS"
          :key="tab.key"
          :class="{ 'is-active': state.tab === tab.key }"
          @click="setTab(tab.key)"
        >
          <component :is="tab.icon" :size="13" />
          <span>{{ tab.label }}</span>
          <b v-if="tab.badge">{{ tab.badge }}</b>
        </button>
      </nav>

      <main class="body" data-scroll>
        <KeepAlive>
          <component :is="activePanel" />
        </KeepAlive>
      </main>

      <footer class="foot drag">
        <p class="no-drag foot-line">
          <i class="led" :class="state.visible ? 'led--on' : 'led--off'" />
          <span>{{ footLabel }}</span>
        </p>
        <button class="quit no-drag" title="退出" @click="quitApp"><Power :size="12" /></button>
      </footer>
    </section>

    <ContextMenu v-if="menu.open" />

    <p v-if="state.bootError && state.mode !== 'square'" class="boot-err">{{ state.bootError }}</p>
  </div>
</template>

<script setup>
import { computed, markRaw, onBeforeUnmount, onMounted, watch } from 'vue'
import {
  Sparkles, Pin, PinOff, RefreshCw, Settings, X, Power,
  ListTodo, CalendarClock, Cpu, Wallet, CloudUpload
} from 'lucide-vue-next'
import SquareOrb from './components/SquareOrb.vue'
import HoverPill from './components/HoverPill.vue'
import ContextMenu from './components/ContextMenu.vue'
import SettingsPanel from './components/SettingsPanel.vue'
import TodoPanel from './components/TodoPanel.vue'
import SchedulePanel from './components/SchedulePanel.vue'
import LabPanel from './components/LabPanel.vue'
import LifePanel from './components/LifePanel.vue'
import BackupPanel from './components/BackupPanel.vue'
import { state, getters, actions, boot, setMode, setTab, refreshLab, runAlerts, wireBackupEvents, applyBackupWatchers, syncTodos, menu, closeMenu } from './store.js'
import { weekdayCn } from './domain/time.js'

const desktop = typeof window !== 'undefined' ? window.gradDock : null

const TABS = computed(() => [
  { key: 'todo', label: '待办', icon: markRaw(ListTodo), badge: getters.pending.value.length },
  { key: 'schedule', label: '日程', icon: markRaw(CalendarClock), badge: getters.scheduleList.value.length },
  { key: 'lab', label: '服务器', icon: markRaw(Cpu), badge: 0 },
  { key: 'life', label: '生活', icon: markRaw(Wallet), badge: getters.shoppingLeft.value },
  { key: 'backup', label: '备份', icon: markRaw(CloudUpload), badge: 0 }
])

const PANELS = { todo: TodoPanel, schedule: SchedulePanel, lab: LabPanel, life: LifePanel, backup: BackupPanel }
const activePanel = computed(() => PANELS[state.tab] || TodoPanel)
const prefs = computed(() => state.data.prefs)

const dateLabel = computed(() => {
  const d = new Date(state.now)
  return `${d.getMonth() + 1}月${d.getDate()}日 · ${weekdayCn(state.now)}`
})

const statusDot = computed(() => {
  if (getters.overdueCount.value) return 'status-dot--danger'
  if (getters.dueTodayCount.value) return 'status-dot--urgent'
  return 'status-dot--ok'
})

const footLabel = computed(() => {
  if (!state.lab.at) return `本地存储 · 每 ${prefs.value.refreshSeconds}s 刷新`
  const t = new Date(state.lab.at)
  return `服务器数据 ${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')} 更新`
})

let clock = null
let labTimer = null
let alertTimer = null
let cloudTimer = null
let collapseTimer = null
let dragging = false
let dragLast = null
let dragMoved = 0

function onOrbPointerDown(event) {
  if (!desktop || event.button !== 0) return
  dragging = true
  dragMoved = 0
  dragLast = { x: event.clientX, y: event.clientY }
  try {
    event.target.setPointerCapture?.(event.pointerId)
  } catch {
    /* 元素已被替换，忽略 */
  }
  window.addEventListener('pointermove', onWindowPointerMove)
  window.addEventListener('pointerup', onWindowPointerUp)
  window.addEventListener('pointercancel', onWindowPointerUp)
  desktop.dragStart()
}

function onWindowPointerMove(event) {
  if (!dragging || !dragLast) return
  dragMoved += Math.abs(event.clientX - dragLast.x) + Math.abs(event.clientY - dragLast.y)
  dragLast = { x: event.clientX, y: event.clientY }
}

function onWindowPointerUp() {
  if (!dragging) return
  dragging = false
  dragLast = null
  window.removeEventListener('pointermove', onWindowPointerMove)
  window.removeEventListener('pointerup', onWindowPointerUp)
  window.removeEventListener('pointercancel', onWindowPointerUp)
  if (desktop) desktop.dragStop()
  // 拖拽时窗口在指针底下移动，event 的 clientX/Y 判断不出指针在不在窗内
  if (state.mode === 'pill') closeIfPointerLeft()
}

function expandNow() {
  if (dragMoved > 4) {
    dragMoved = 0
    return
  }
  clearTimeout(collapseTimer)
  if (state.mode !== 'card') setMode('card')
  if (desktop) desktop.focus()
  refreshLab()
  syncTodos()
}

function collapse() {
  clearTimeout(collapseTimer)
  setMode('square')
}

function onEnter() {
  clearTimeout(collapseTimer)
  if (state.mode === 'square') setMode('pill')
}

function onLeave() {
  // 拖拽时指针会短暂跑出窗口，此时收起会和主进程的移动轮询打架
  if (dragging) return
  if (state.mode !== 'pill') return
  clearTimeout(collapseTimer)
  collapseTimer = setTimeout(closeIfPointerLeft, 140)
}

/**
 * mouseleave 的坐标可能仍在窗口内（窄条刚把自身撑大一圈时也会补发一次 leave），
 * 所以不直接收，也不靠固定时长猜，收之前问一次系统光标到底还在不在窗内。
 */
async function closeIfPointerLeft() {
  if (dragging || state.mode !== 'pill') return
  if (desktop && await desktop.cursorInside()) return
  collapse()
}

const onBlur = () => {
  if (!prefs.value.collapseOnBlur) return
  if (state.mode !== 'card' && state.mode !== 'pill') return
  collapse()
}

function quitApp() {
  if (desktop) desktop.quit()
  else window.close()
}

/** 条目菜单没接住的右键落到外壳这层，出小方块那套系统菜单。 */
function openWidgetMenu() {
  closeMenu()
  if (desktop) desktop.showWidgetMenu()
}

function onKey(event) {
  if (event.key !== 'Escape') return
  if (menu.open) {
    closeMenu()
    return
  }
  if (state.mode !== 'square') collapse()
}

function drawTrayIcon() {
  if (!desktop) return
  try {
    const canvas = document.createElement('canvas')
    canvas.width = 64
    canvas.height = 64
    const ctx = canvas.getContext('2d')
    const gradient = ctx.createLinearGradient(0, 0, 64, 64)
    gradient.addColorStop(0, '#6366f1')
    gradient.addColorStop(1, '#a855f7')
    ctx.fillStyle = gradient
    ctx.beginPath()
    ctx.roundRect(2, 2, 60, 60, 18)
    ctx.fill()
    ctx.strokeStyle = '#ffffff'
    ctx.lineWidth = 7
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.beginPath()
    ctx.moveTo(20, 33)
    ctx.lineTo(28, 41)
    ctx.lineTo(45, 22)
    ctx.stroke()
    desktop.setTrayIcon(canvas.toDataURL('image/png'))
  } catch (err) {
    state.bootError = `托盘图标生成失败：${err.message}`
  }
}

function startLabTimer() {
  if (labTimer) clearInterval(labTimer)
  const ms = Math.max(10, Number(prefs.value.refreshSeconds) || 30) * 1000
  labTimer = setInterval(() => {
    if (state.visible) refreshLab(true)
  }, ms)
}

/** 界面最细只到分钟：收起成小方块时没必要每秒把全部 computed 重算一遍。 */
function clockStep() {
  if (!state.visible) return 0
  return state.mode === 'card' || state.mode === 'settings' ? 5000 : 30000
}

function restartClock() {
  clearInterval(clock)
  clock = null
  const step = clockStep()
  if (!step) return
  state.now = Date.now()
  clock = setInterval(() => { state.now = Date.now() }, step)
}

watch(() => [state.mode, state.visible], restartClock)

/** 待办的云端轮询和服务器采集分开：60 秒一次，只在窗口可见时跑。 */
function startCloudTimer() {
  if (cloudTimer) clearInterval(cloudTimer)
  cloudTimer = setInterval(() => {
    if (state.visible) syncTodos()
  }, 60000)
}

const onVisibility = (visible) => {
  state.visible = visible
  if (visible) refreshLab()
}

const onModeFromTray = (payload) => {
  if (!payload) return
  state.mode = payload.mode || payload
  if (payload.extend) state.pillExtend = payload.extend
}

const onTrayCommand = (payload) => {
  if (!payload) return
  if (payload.action === 'refresh') {
    refreshLab(true)
    syncTodos()
  }
  if (payload.action === 'set-top') actions.setPref('alwaysOnTop', !!payload.value)
}

onMounted(async () => {
  state.visible = true
  await boot()
  drawTrayIcon()
  startLabTimer()
  startCloudTimer()
  restartClock()
  alertTimer = setInterval(runAlerts, 60000)
  window.addEventListener('keydown', onKey)
  if (desktop) {
    desktop.on('win:mode', onModeFromTray)
    desktop.on('win:visible', onVisibility)
    desktop.on('win:blur', onBlur)
    desktop.on('tray:command', onTrayCommand)
    desktop.setTopmost(!!state.data.prefs.alwaysOnTop)
  }
  runAlerts()
  refreshLab(true)
  wireBackupEvents()
  applyBackupWatchers()
})

onBeforeUnmount(() => {
  clearInterval(clock)
  clearInterval(labTimer)
  clearInterval(alertTimer)
  clearInterval(cloudTimer)
  clearTimeout(collapseTimer)
  window.removeEventListener('pointermove', onWindowPointerMove)
  window.removeEventListener('keydown', onKey)
  if (desktop) {
    desktop.off('win:mode', onModeFromTray)
    desktop.off('win:visible', onVisibility)
    desktop.off('win:blur', onBlur)
    desktop.off('tray:command', onTrayCommand)
  }
})
</script>

<style scoped>
.stage {
  width: 100%;
  height: 100%;
  background: transparent;
}

/* 读盘/存盘/托盘这类故障以前只写进 state.bootError 却没人显示，用户只会看到圆点不动 */
.boot-err {
  position: fixed;
  right: 6px;
  bottom: 6px;
  left: 6px;
  z-index: 40;
  margin: 0;
  padding: 6px 9px;
  font-size: 11px;
  line-height: 1.4;
  color: #be123c;
  background: #fff1f2;
  border: 1px solid #fecdd3;
  border-radius: 10px;
}

.boot {
  display: grid;
  place-items: center;
  width: 100%;
  height: 100%;
  font-size: 14px;
  color: #94a3b8;
  background: linear-gradient(145deg, #6366f1, #8b5cf6);
  border-radius: 18px;
}

.card {
  display: flex;
  flex-direction: column;
  height: 100%;
  border-radius: 20px;
  overflow: hidden;
  border: 1px solid rgba(203, 213, 225, 0.95);
  background: #FFFFFF;
}

.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px 8px;
  background: linear-gradient(180deg, #F6F7FB, #FAFBFD);
}

.brand {
  display: flex;
  align-items: center;
  gap: 8px;
}

.mark {
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  border-radius: 9px;
  color: #fff;
  background: linear-gradient(135deg, #6366f1, #a855f7);
  box-shadow: 0 6px 14px -8px rgba(99, 102, 241, 0.9);
}

.brand-text {
  display: flex;
  flex-direction: column;
  line-height: 1.15;
}

.brand-text strong {
  font-size: 13px;
  font-weight: 800;
  letter-spacing: -0.01em;
  background: linear-gradient(90deg, #4f46e5, #9333ea);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}

.brand-text em {
  font-style: normal;
  font-size: 10px;
  color: #94a3b8;
}

.tools {
  display: flex;
  gap: 1px;
}

.tool {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  border: none;
  border-radius: 8px;
  color: #94a3b8;
  background: transparent;
  cursor: pointer;
}

.tool:hover {
  color: #6366f1;
  background: #eef2ff;
}

.tool.is-on {
  color: #4f46e5;
  background: #eef2ff;
}

.tool--close:hover {
  color: #f43f5e;
  background: #fff1f2;
}

.progress-block {
  padding: 0 12px 9px;
  border-bottom: 1px solid #F1F5F9;
  background: #FAFBFD;
}

.progress-line {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  color: #94a3b8;
}

.progress-line strong {
  font-size: 13px;
  color: #334155;
  font-variant-numeric: tabular-nums;
}

.pct {
  font-size: 11px;
  color: #94a3b8;
  font-variant-numeric: tabular-nums;
}

.status-dot {
  width: 7px;
  height: 7px;
  border-radius: 999px;
  background: #cbd5e1;
}

.status-dot--ok { background: #34d399; }
.status-dot--urgent { background: #fb923c; }
.status-dot--danger { background: #f43f5e; }

.badge {
  font-size: 10px;
  font-weight: 700;
  padding: 1px 6px;
  border-radius: 999px;
}

.badge--danger { background: #fff1f2; color: #e11d48; }
.badge--urgent { background: #fff7ed; color: #ea580c; }

.bar {
  height: 4px;
  margin-top: 6px;
  border-radius: 999px;
  background: #F1F5F9;
  overflow: hidden;
}

.bar i {
  display: block;
  height: 100%;
  border-radius: 999px;
  background: linear-gradient(90deg, #6366f1, #a855f7);
  transition: width 0.4s ease;
}

.tabs {
  display: flex;
  gap: 3px;
  padding: 8px 8px 0;
  background: #FBFCFE;
}

.tabs button {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 2px;
  flex: 1;
  min-width: 0;
  padding: 6px 0;
  font-size: 11px;
  font-weight: 600;
  color: #94a3b8;
  border: none;
  border-radius: 10px 10px 0 0;
  background: transparent;
  cursor: pointer;
  white-space: nowrap;
}

.tabs button:hover {
  color: #6366f1;
  background: #F5F7FF;
}

.tabs .is-active {
  color: #4f46e5;
  background: #EEF2FF;
}

.tabs b {
  font-size: 9.5px;
  font-weight: 700;
  min-width: 14px;
  padding: 0 4px;
  text-align: center;
  border-radius: 999px;
  background: #E2E8F0;
  color: #64748B;
}

.tabs .is-active b {
  background: #C7D2FE;
  color: #4338CA;
}

.body {
  flex: 1;
  overflow-y: auto;
  padding: 10px;
  background: #F8FAFC;
  border-top: 1px solid #F1F5F9;
  border-bottom: 1px solid #F1F5F9;
}

.foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 7px 11px;
  background: #FAFBFD;
}

.foot-line {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  font-size: 10.5px;
  color: #94a3b8;
}

.led {
  width: 6px;
  height: 6px;
  border-radius: 999px;
  display: block;
}

.led--on { background: #34d399; }
.led--off { background: #cbd5e1; animation: none; }

.quit {
  display: grid;
  place-items: center;
  width: 20px;
  height: 20px;
  border: none;
  border-radius: 6px;
  color: #cbd5e1;
  background: transparent;
  cursor: pointer;
}

.quit:hover {
  color: #f43f5e;
  background: #fff1f2;
}

.ml-auto { margin-left: auto; }
</style>
