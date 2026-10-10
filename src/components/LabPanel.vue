<template>
  <div class="flex flex-col gap-2.5">
    <div v-if="!targets.length" class="empty">
      <span>🖥️</span>
      <p>还没有监控节点</p>
      <button class="link no-drag" @click="addNode">添加 SSH 目标</button>
    </div>

    <article
      v-for="target in targets"
      :key="target.id"
      class="node"
      @contextmenu.prevent.stop="nodeMenu($event, target)"
    >
      <header>
        <div class="flex-1 min-w-0">
          <h4>{{ target.name }}</h4>
          <p class="mono">{{ destOf(target) }}<span v-if="specOf(infoOf(target))"> · {{ specOf(infoOf(target)) }}</span><span v-if="target.mock"> · 演示</span><span v-else-if="target.auth === 'password'" class="auth-tag" :class="{ 'auth-tag--warn': state.lab.secrets[target.id] }">{{ state.lab.secrets[target.id] ? '密码已存本机' : '密码未保存' }}</span><span v-else> · 密钥</span></p>
        </div>
        <span class="state" :class="target.enabled === false ? 'state--off' : `state--${toneOf(target)}`">{{ target.enabled === false ? '已停用' : labelOf(target) }}</span>
      </header>

      <div v-if="infoOf(target)" class="metrics">
        <div class="metric">
          <span>负载 · {{ infoOf(target).nproc || '?' }} 核</span>
          <strong>{{ loadLabel(infoOf(target)) }}</strong>
          <div class="bar"><i :class="barClass(loadPercent(infoOf(target)))" :style="{ width: `${loadPercent(infoOf(target))}%` }" /></div>
        </div>
        <div class="metric">
          <span>内存</span>
          <strong>{{ infoOf(target).mem ? `${infoOf(target).mem.percent}%` : '—' }}</strong>
          <div class="bar"><i :class="barClass(infoOf(target).mem?.percent)" :style="{ width: `${infoOf(target).mem?.percent || 0}%` }" /></div>
        </div>
        <div class="metric">
          <span>磁盘 /</span>
          <strong>{{ infoOf(target).disk ? `${infoOf(target).disk.percent}%` : '—' }}</strong>
          <div class="bar"><i :class="barClass(infoOf(target).disk?.percent)" :style="{ width: `${infoOf(target).disk?.percent || 0}%` }" /></div>
        </div>
        <div class="metric">
          <span>运行</span>
          <strong>{{ fmtUptime(infoOf(target).uptimeSec) }}</strong>
        </div>
      </div>

      <div v-if="infoOf(target)?.gpus?.length" class="gpus">
        <div v-for="(gpu, i) in infoOf(target).gpus" :key="i" class="gpu">
          <div class="gpu-head">
            <span class="truncate">{{ gpu.name }}</span>
            <b>{{ gpu.util }}%</b>
          </div>
          <div class="bar"><i :class="barClass(gpu.util)" :style="{ width: `${gpu.util}%` }" /></div>
          <p class="gpu-mem">{{ (gpu.usedMiB / 1024).toFixed(1) }} / {{ (gpu.totalMiB / 1024).toFixed(0) }} GiB</p>
        </div>
      </div>

      <div v-if="detailId === target.id" class="detail">
        <div v-for="row in detailRows(target)" :key="row.k" class="d-row">
          <span>{{ row.k }}</span>
          <b>{{ row.v }}</b>
        </div>
        <pre v-if="rawOf(target)" class="raw">{{ rawOf(target) }}</pre>
        <button class="link no-drag" @click="copyDetail(target)">复制这份数据</button>
      </div>

      <p v-if="resultOf(target) && !resultOf(target).ok" class="err">{{ resultOf(target).error }}</p>
      <p v-else-if="needsPassword(target)" class="hint needs">尚未填写登录密码 —— 点下方「编辑」填入后即可采集。</p>
      <p v-else-if="!infoOf(target)" class="hint">点右上刷新，通过本机 <code>ssh</code> 执行只读探针。</p>

      <div v-if="resultOf(target)?.ms" class="summary">
        <span>{{ infoOf(target)?.host || target.host }}</span>
        <i />
        <span>{{ resultOf(target).ms }}ms</span>
        <i />
        <span class="link no-drag" @click="edit(target)">编辑</span>
      </div>
      <div v-else class="summary">
        <span class="link no-drag" @click="edit(target)">编辑</span>
      </div>

      <LabNodeForm
        v-if="showForm && editingId === target.id"
        :target="target"
        @close="closeForm"
        @deleted="onDeleted"
      />
    </article>

    <p v-if="state.lab.error" class="err global">{{ state.lab.error }}</p>

    <button class="add-toggle no-drag" @click="addNode">
      <Settings2 :size="13" /> {{ showForm && !editingId ? '收起' : '添加新节点' }}
    </button>

    <LabNodeForm v-if="showForm && !editingId" :target="null" @close="closeForm" />
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import { Settings2, RefreshCw, Gauge, Copy, Power, Trash2 } from 'lucide-vue-next'
import LabNodeForm from './LabNodeForm.vue'
import { state, actions, refreshTarget, openMenu, copyText } from '../store.js'
import { toneOfSummary, fmtUptime, specOf } from '../domain/lab.js'
import { fmtClock } from '../domain/time.js'

const showForm = ref(false)
const editingId = ref('')
const detailId = ref('')

const targets = computed(() => state.data.lab.targets)
const resultOf = (target) => state.lab.results.find((r) => r.id === target.id)
const infoOf = (target) => {
  const r = resultOf(target)
  return r && r.ok ? r.info : null
}

function destOf(target) {
  if (target.mock) return '本机模拟'
  const who = target.user ? `${target.user}@` : ''
  const port = Number(target.port) && Number(target.port) !== 22 ? `:${target.port}` : ''
  return `${who}${target.host || '未填'}${port}`
}

function toneOf(target) {
  if (needsPassword(target)) return 'unknown'
  const r = resultOf(target)
  if (!r) return 'unknown'
  if (!r.ok) return 'error'
  return toneOfSummary(r.summary)
}

function needsPassword(target) {
  return !target.mock && target.auth === 'password' && !state.lab.secrets[target.id]
}

function labelOf(target) {
  const map = { hot: '高负载', busy: '运行中', idle: '空闲', unknown: '未采集', error: '连接失败' }
  if (needsPassword(target)) return '待填密码'
  return map[toneOf(target)] || '未采集'
}

function barClass(percent) {
  if (percent >= 90) return 'is-hot'
  if (percent >= 70) return 'is-busy'
  return ''
}

function loadLabel(info) {
  if (!info.load.length) return '—'
  const pct = loadPercent(info)
  return info.load.map((n) => n.toFixed(2)).join(' ') + (info.nproc ? ` · ${pct}%` : '')
}

function loadPercent(info) {
  if (!info.nproc || !info.load.length) return 0
  return Math.min(100, Math.round((info.load[0] / info.nproc) * 100))
}

function edit(target) {
  editingId.value = target.id
  showForm.value = true
}

function addNode() {
  if (showForm.value && !editingId.value) {
    closeForm()
    return
  }
  editingId.value = ''
  showForm.value = true
}

function closeForm() {
  showForm.value = false
  editingId.value = ''
}

function onDeleted(id) {
  if (detailId.value === id) detailId.value = ''
}

function rawOf(target) {
  const r = resultOf(target)
  return r ? String(r.stdout || r.error || '').trim() : ''
}

/** 详细指标：探针拿到的每一项都摊开，包括折算后的占用率。 */
function detailRows(target) {
  const r = resultOf(target)
  if (!r) return [{ k: '状态', v: '还没采集过' }]
  const rows = [{ k: '采集', v: r.ok ? `${r.ms}ms · ${fmtClock(r.at)}` : `${r.ms}ms 后失败` }]
  if (!r.ok) return [...rows, { k: '错误', v: r.error || '未知错误' }]
  const info = r.info
  if (info.host) rows.push({ k: '主机名', v: info.host })
  const load = info.load.length ? info.load.map((n) => n.toFixed(2)).join(' / ') : '—'
  rows.push({ k: 'CPU', v: `${info.nproc || '?'} 核 · load ${load}${info.nproc && info.load.length ? ` · ${loadPercent(info)}%` : ''}` })
  if (info.mem) rows.push({ k: '内存', v: `${(info.mem.usedMiB / 1024).toFixed(1)} / ${(info.mem.totalMiB / 1024).toFixed(1)} GiB · ${info.mem.percent}%` })
  if (info.disk) rows.push({ k: '磁盘 /', v: `${info.disk.usedGiB} / ${info.disk.totalGiB} GiB · 剩 ${(info.disk.totalGiB - info.disk.usedGiB).toFixed(1)} GiB · ${info.disk.percent}%` })
  rows.push({ k: '运行', v: fmtUptime(info.uptimeSec) })
  info.gpus.forEach((g, i) => rows.push({
    k: `GPU${info.gpus.length > 1 ? ` ${i}` : ''}`,
    v: `${g.util}% · ${(g.usedMiB / 1024).toFixed(1)} / ${(g.totalMiB / 1024).toFixed(0)} GiB · ${g.name}`
  }))
  return rows
}

function copyDetail(target) {
  const body = detailRows(target).map((row) => `${row.k}: ${row.v}`).join('\n')
  const raw = rawOf(target)
  copyText(`${target.name} (${destOf(target)})\n${body}${raw ? `\n\n${raw}` : ''}`)
}

function nodeMenu(event, target) {
  const enabled = target.enabled !== false
  const opened = detailId.value === target.id
  openMenu(event, [
    { label: '刷新此节点', icon: RefreshCw, action: () => refreshTarget(target) },
    {
      label: opened ? '收起详细指标' : '详细指标',
      icon: Gauge,
      action: () => { detailId.value = opened ? '' : target.id }
    },
    { label: '编辑配置', icon: Settings2, action: () => edit(target) },
    {
      label: '复制连接地址',
      icon: Copy,
      disabled: !!target.mock,
      action: () => copyText(`${target.user ? `${target.user}@` : ''}${target.host || ''}${Number(target.port) && Number(target.port) !== 22 ? ` -p ${target.port}` : ''}`)
    },
    { separator: true },
    { label: enabled ? '停用采集' : '启用采集', icon: Power, action: () => actions.saveLabTarget({ id: target.id, enabled: !enabled }) },
    { label: '从面板移除', icon: Trash2, danger: true, action: () => removeTarget(target) }
  ])
}

async function removeTarget(target) {
  const name = target.name || target.host
  if (!confirm(`从面板移除「${name}」？\n\n这只删本地记录。用密码认证的节点会连同本机保存的密码一起删除；用密钥认证的节点，服务器上的授权密钥仍然有效，需登录机器删除 /root/.ssh/authorized_keys 里含 grad-dock-widget 的那一行。`)) return
  if (window.gradDock) await window.gradDock.deleteSecret(target.id).catch(() => {})
  actions.removeLabTarget(target.id)
  onDeleted(target.id)
  if (editingId.value === target.id) closeForm()
}
</script>

<style scoped>
.node {
  padding: 11px 12px;
  border-radius: 16px;
  background: #FFFFFF;
  border: 1px solid rgba(226, 232, 240, 0.9);
}

.node header {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}

.node h4 {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  color: #334155;
}

.node .mono {
  margin: 2px 0 0;
  font-size: 10.5px;
  color: #94a3b8;
  font-family: ui-monospace, Consolas, monospace;
}

.detail {
  margin-top: 9px;
  padding: 8px 9px;
  border-radius: 12px;
  background: #F8FAFC;
  border: 1px solid #EEF2F7;
}

.d-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  padding: 2px 0;
  font-size: 11px;
}

.d-row span {
  flex: none;
  color: #94a3b8;
}

.d-row b {
  color: #334155;
  font-weight: 600;
  text-align: right;
  font-variant-numeric: tabular-nums;
  word-break: break-all;
}

.raw {
  max-height: 96px;
  margin: 6px 0 0;
  padding: 6px 7px;
  overflow-y: auto;
  font-size: 10px;
  line-height: 1.5;
  color: #64748b;
  background: #fff;
  border: 1px solid #EEF2F7;
  border-radius: 8px;
  white-space: pre-wrap;
  word-break: break-all;
}

.state {
  flex: none;
  font-size: 10px;
  font-weight: 700;
  padding: 2px 8px;
  border-radius: 999px;
  background: #F1F5F9;
  color: #64748b;
}

.state--hot { background: #FEF2F2; color: #DC2626; }
.state--busy { background: #FFFBEB; color: #D97706; }
.state--idle { background: #ECFDF5; color: #059669; }
.state--off { background: #F1F5F9; color: #94A3B8; }

.metrics {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px 10px;
  margin-top: 10px;
}

.metric span {
  display: block;
  font-size: 10px;
  color: #94a3b8;
}

.metric strong {
  display: block;
  margin-top: 1px;
  font-size: 12px;
  font-weight: 700;
  color: #334155;
  font-variant-numeric: tabular-nums;
}

.bar {
  height: 4px;
  margin-top: 4px;
  border-radius: 999px;
  background: #F1F5F9;
  overflow: hidden;
}

.bar i {
  display: block;
  height: 100%;
  border-radius: 999px;
  background: #34D399;
  transition: width 0.5s ease;
}

.bar i.is-busy { background: linear-gradient(90deg, #FBBF24, #F59E0B); }
.bar i.is-hot { background: linear-gradient(90deg, #FB7185, #EF4444); }

.gpus {
  margin-top: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.gpu-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 11px;
  color: #64748b;
}

.gpu-head b {
  color: #334155;
  font-variant-numeric: tabular-nums;
}

.gpu-mem {
  margin: 3px 0 0;
  font-size: 10px;
  color: #94a3b8;
  font-variant-numeric: tabular-nums;
}

.summary {
  display: flex;
  align-items: center;
  gap: 7px;
  margin-top: 9px;
  font-size: 10.5px;
  color: #94a3b8;
}

.summary i {
  width: 3px;
  height: 3px;
  border-radius: 999px;
  background: #CBD5E1;
}

.err {
  margin: 8px 0 0;
  font-size: 11px;
  line-height: 1.5;
  color: #E11D48;
  word-break: break-word;
}

.err.global { margin: 0; }

.hint {
  margin: 8px 0 0;
  font-size: 11px;
  color: #94A3B8;
}

.hint code {
  font-size: 10.5px;
  padding: 1px 4px;
  border-radius: 5px;
  background: #F1F5F9;
  color: #64748B;
}

.hint.needs {
  color: #B45309;
}

.empty {
  padding: 20px 0;
  text-align: center;
  color: #94a3b8;
}

.empty span { display: block; font-size: 24px; margin-bottom: 4px; }
.empty p { margin: 0 0 6px; font-size: 12px; }

.link {
  border: none;
  background: transparent;
  color: #6366F1;
  font-size: 11px;
  cursor: pointer;
}

.add-toggle {
  display: flex;
  align-items: center;
  gap: 4px;
  align-self: flex-start;
  margin-top: 2px;
  padding: 4px 9px;
  font-size: 11px;
  color: #6366f1;
  border: 1px dashed #C7D2FE;
  border-radius: 999px;
  background: transparent;
  cursor: pointer;
}

.auth-tag {
  margin-left: 4px;
  padding: 0 5px;
  border-radius: 999px;
  font-size: 9.5px;
  background: #F1F5F9;
  color: #94A3B8;
}

.auth-tag--warn { background: #FEF3C7; color: #B45309; }
</style>
