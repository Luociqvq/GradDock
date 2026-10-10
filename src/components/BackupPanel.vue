<template>
  <div class="flex flex-col gap-2.5">
    <div class="target-line">
      <span class="lbl">上传到</span>
      <strong v-if="target">{{ target.name }} · {{ target.host }}</strong>
      <strong v-else class="warn">未启用服务器节点</strong>
      <button class="mini no-drag" @click="addAll">全部立即备份</button>
    </div>
    <p v-if="!target" class="note">备份走服务器卡里第一个已启用的真实节点，请先去「服务器」启用一个，或用密钥认证的节点。</p>

    <article v-for="job in jobs" :key="job.id" class="card">
      <header>
        <input v-model="job.name" class="name" @change="touch()" />
        <label class="switch" :title="job.enabled ? '监听中' : '已停用'">
          <input type="checkbox" v-model="job.enabled" @change="toggle(job)" />
          <i />
        </label>
      </header>

      <button class="folder no-drag" @click="choose(job)">
        <FolderInput :size="12" />
        <span class="truncate">{{ job.local || '选择要备份的文件夹…' }}</span>
      </button>

      <div class="grid2">
        <label class="field"><span>远端路径</span><input v-model="job.remotePath" @change="touch()" /></label>
        <label class="field"><span>限速 (例 2M)</span><input v-model="job.bwlimit" placeholder="不限" @change="touch()" /></label>
      </div>
      <label class="field"><span>排除（每行一个，rclone 语法）</span>
        <textarea v-model="job.excludes" rows="2" @change="touch()" />
      </label>

      <div v-if="running(job)" class="prog">
        <div class="prog-bar"><i :style="{ width: `${percent(job)}%` }" /></div>
        <p class="prog-text">{{ progressText(job) }}</p>
      </div>

      <p v-else-if="stateOf(job).error" class="err">{{ stateOf(job).error }}</p>

      <div class="foot">
        <span class="meta">{{ footMeta(job) }}</span>
        <span class="acts no-drag">
          <button class="mini" :disabled="!job.local || running(job) || !target" @click="run(job)">立即备份</button>
          <button class="mini ghost" @click="remove(job)">删除</button>
        </span>
      </div>
    </article>

    <button class="add-toggle no-drag" @click="add"><Plus :size="13" /> 新增备份任务</button>

    <p class="tip">改动后 8 秒自动上传；rclone 负责断点续传与校验，中途断网会在下次触发时接着传。</p>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { Plus, FolderInput } from 'lucide-vue-next'
import { state, actions, backupTarget, pickBackupFolder, runBackupNow, applyBackupWatchers, refreshBackupStatus } from '../store.js'

const jobs = computed(() => state.data.backups)
const target = computed(() => backupTarget())

const stateOf = (job) => state.backup.jobs[job.id] || {}
const running = (job) => !!stateOf(job).running
const percent = (job) => (state.backup.progress[job.id] || {}).percent || 0

function progressText(job) {
  const p = state.backup.progress[job.id]
  if (!p) return '正在连接并比对差异…'
  return `${p.transferred} / ${p.total} · ${p.speed} · 剩余 ${p.eta}`
}

function fmtBytes(bytes) {
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  return `${(bytes / 1024 ** i).toFixed(i ? 1 : 0)} ${units[i]}`
}

function footMeta(job) {
  const s = stateOf(job)
  const parts = []
  if (s.at) parts.push(`${s.ok ? '已同步' : '失败'} ${new Date(s.at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`)
  if (s.remoteCount) parts.push(`远端 ${s.remoteCount} 个 / ${fmtBytes(s.remoteBytes)}`)
  return parts.length ? parts.join(' · ') : '尚未备份'
}

async function choose(job) {
  await pickBackupFolder(job.id)
  applyBackupWatchers()
}

async function run(job) {
  await runBackupNow(job.id)
}

function toggle() {
  applyBackupWatchers()
}

function touch() {
  applyBackupWatchers()
}

function add() {
  actions.addBackup()
}

async function remove(job) {
  if (!confirm(`删除备份任务「${job.name}」？只删本地配置，服务器上已上传的文件不会动。`)) return
  actions.removeBackup(job.id)
  applyBackupWatchers()
}

async function addAll() {
  for (const job of jobs.value) {
    if (job.enabled && job.local) await runBackupNow(job.id)
  }
}
</script>

<style scoped>
.target-line {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 10px;
  border-radius: 12px;
  background: #EEF2FF;
  border: 1px solid #C7D2FE;
}

.target-line .lbl {
  font-size: 10.5px;
  color: #6366F1;
}

.target-line strong {
  flex: 1;
  min-width: 0;
  font-size: 11.5px;
  color: #4338CA;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.target-line strong.warn { color: #B45309; }

.note,
.tip {
  margin: 0;
  font-size: 10.5px;
  line-height: 1.5;
  color: #94A3B8;
}

.card {
  display: flex;
  flex-direction: column;
  gap: 7px;
  padding: 10px 11px;
  border-radius: 16px;
  background: #FFFFFF;
  border: 1px solid rgba(226, 232, 240, 0.9);
}

.card header {
  display: flex;
  align-items: center;
  gap: 8px;
}

.name {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  font-weight: 600;
  color: #334155;
  border: none;
  border-bottom: 1px dashed transparent;
  background: transparent;
  outline: none;
  padding: 2px 0;
}

.name:focus { border-bottom-color: #C7D2FE; }

.switch {
  position: relative;
  display: inline-block;
  width: 32px;
  height: 18px;
  flex: none;
}

.switch input { opacity: 0; width: 0; height: 0; }

.switch i {
  position: absolute;
  inset: 0;
  border-radius: 999px;
  background: #CBD5E1;
  transition: background 0.18s ease;
  cursor: pointer;
}

.switch i::after {
  content: '';
  position: absolute;
  top: 2px;
  left: 2px;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #fff;
  transition: transform 0.18s ease;
}

.switch input:checked + i { background: #10B981; }
.switch input:checked + i::after { transform: translateX(14px); }

.folder {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 7px 9px;
  font-size: 11.5px;
  color: #475569;
  text-align: left;
  border: 1px dashed #CBD5E1;
  border-radius: 11px;
  background: #F8FAFC;
  cursor: pointer;
}

.folder:hover { border-color: #818CF8; color: #4F46E5; }
.folder :deep(svg) { color: #94A3B8; flex: none; }

.grid2 {
  display: grid;
  grid-template-columns: 1fr 90px;
  gap: 6px;
}

.field span {
  display: block;
  margin-bottom: 3px;
  font-size: 10px;
  color: #94A3B8;
}

.field input,
.field textarea {
  width: 100%;
  padding: 5px 8px;
  font-size: 11.5px;
  color: #334155;
  border-radius: 9px;
  border: 1px solid #E2E8F0;
  background: #F8FAFC;
  outline: none;
  font-family: inherit;
  resize: vertical;
}

.field input:focus,
.field textarea:focus {
  border-color: #A5B4FC;
  background: #fff;
}

.prog-bar {
  height: 5px;
  border-radius: 999px;
  background: #F1F5F9;
  overflow: hidden;
}

.prog-bar i {
  display: block;
  height: 100%;
  border-radius: 999px;
  background: linear-gradient(90deg, #6366F1, #A855F7);
  transition: width 0.4s ease;
}

.prog-text {
  margin: 4px 0 0;
  font-size: 10.5px;
  color: #6366F1;
  font-variant-numeric: tabular-nums;
}

.err {
  margin: 0;
  font-size: 11px;
  line-height: 1.5;
  color: #E11D48;
  word-break: break-word;
}

.foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.meta {
  font-size: 10.5px;
  color: #94A3B8;
}

.acts { display: flex; gap: 5px; }

.mini {
  height: 24px;
  padding: 0 9px;
  font-size: 11px;
  font-weight: 600;
  color: #fff;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  background: linear-gradient(135deg, #6366F1, #8B5CF6);
  flex: none;
}

.mini:disabled { opacity: 0.4; cursor: default; }

.mini.ghost {
  color: #94A3B8;
  background: transparent;
  border: 1px solid #E2E8F0;
}

.add-toggle {
  display: flex;
  align-items: center;
  gap: 4px;
  align-self: flex-start;
  padding: 4px 9px;
  font-size: 11px;
  color: #6366f1;
  border: 1px dashed #C7D2FE;
  border-radius: 999px;
  background: transparent;
  cursor: pointer;
}
</style>