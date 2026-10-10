<template>
  <div class="shell">
    <header class="head drag">
      <div class="title no-drag"><SlidersHorizontal :size="15" /><strong>设置</strong></div>
      <button class="icon no-drag" title="返回" @click="$emit('close')"><X :size="15" /></button>
    </header>

    <div class="body" data-scroll>
      <section>
        <h5>显示</h5>
        <label class="line">
          <span>窗口置顶</span>
          <input type="checkbox" :checked="prefs.alwaysOnTop" @change="actions.setPref('alwaysOnTop', $event.target.checked)" />
        </label>
        <label class="line">
          <span>点别处自动收起</span>
          <input type="checkbox" :checked="prefs.collapseOnBlur" @change="actions.setPref('collapseOnBlur', $event.target.checked)" />
        </label>
        <p class="note">悬停圆点只弹出窄条预览，不自动展开；点一下才展开成完整面板，之后只有点桌面别处、按 Esc 或点右上角关闭才收回。</p>
        <label class="line">
          <span>开机提醒（逾期 / 今天到期 / 组会前一小时）</span>
          <input type="checkbox" :checked="prefs.notifyEnabled" @change="actions.setPref('notifyEnabled', $event.target.checked)" />
        </label>
        <label class="line">
          <span>服务器刷新间隔</span>
          <span class="suffix">
            <input v-model.number="prefs.refreshSeconds" type="number" min="10" max="600" step="10" />
            <em>秒</em>
          </span>
        </label>
      </section>

      <section>
        <h5>待办云同步</h5>
        <template v-if="!cloud.signedIn">
          <p class="note">连上你自己的 TodoFlow 后，「待办」卡直接读写服务器数据，本机只留一份离线缓存。登录令牌用系统 DPAPI 加密单独存放，密码不会被保存。</p>
          <label class="field"><span>服务器</span><input v-model="form.url" placeholder="https://你的 TodoFlow 地址" /></label>
          <label class="field"><span>邮箱</span><input v-model="form.email" type="email" autocomplete="username" /></label>
          <label class="field"><span>密码</span><input v-model="form.password" type="password" autocomplete="current-password" @keyup.enter="connect" /></label>
          <p v-if="cloud.error" class="err">{{ cloud.error }}</p>
          <div class="actions">
            <button class="ghost" :disabled="connecting || !form.email || !form.password" @click="connect">
              {{ connecting ? '连接中…' : '连接并同步' }}
            </button>
          </div>
        </template>
        <template v-else>
          <p class="note">已连接 <code class="break">{{ cloudHost }}</code> · {{ cloud.email }}<em v-if="cloud.name">（{{ cloud.name }}）</em></p>
          <p class="note">
            最近同步 {{ cloud.at ? fmtClock(cloud.at) : '尚未开始' }}
            <span v-if="cloud.error" class="err-inline">· {{ cloud.error }}</span>
          </p>
          <div class="actions">
            <button class="ghost" :disabled="cloud.syncing" @click="syncNow">{{ cloud.syncing ? '同步中…' : '立即同步' }}</button>
            <button class="danger" @click="disconnect">断开连接</button>
          </div>
          <p class="note">断开只是回到本地模式，保留最后一次同步下来的清单，服务器上的数据不会动。</p>
        </template>
      </section>

      <section>
        <h5>数据</h5>
        <p class="note">日程、服务器、生活、备份都存在本机；待办在连了 TodoFlow 时以服务器为准，本机那份是缓存。文件位置：<code class="break">{{ dataFile || '（浏览器预览用 localStorage）' }}</code></p>
        <div class="actions">
          <button class="ghost" @click="exportData"><Download :size="13" />导出 JSON</button>
          <button class="ghost" @click="pickFile"><Upload :size="13" />导入</button>
          <button class="danger" @click="reset">清空并恢复示例</button>
        </div>
        <input ref="fileInput" type="file" accept="application/json" class="hidden-file" @change="importData" />
      </section>

      <section>
        <h5>关于</h5>
        <p class="note">GradDock v{{ version }} · Electron 悬浮岛外壳。五张卡（待办 / 日程 / 服务器 / 生活 / 备份），数据存在本机，备份上传到你自己的服务器。</p>
      </section>
    </div>
  </div>
</template>

<script setup>
import { computed, reactive, ref } from 'vue'
import { SlidersHorizontal, X, Download, Upload } from 'lucide-vue-next'
import { state, actions, cloudConnect, cloudDisconnect, syncTodos } from '../store.js'
import { fmtClock } from '../domain/time.js'

const emit = defineEmits(['close'])
const prefs = computed(() => state.data.prefs)
const cloud = computed(() => state.cloud)
const version = ref('0.1.0')
const dataFile = ref('')
const fileInput = ref(null)
const connecting = ref(false)
const form = reactive({ url: state.data.cloud.url, email: '', password: '' })
const cloudHost = computed(() => String(cloud.value.url || '').replace(/^https?:\/\//, '').replace(/\/+$/, ''))

async function connect() {
  if (connecting.value) return
  connecting.value = true
  try {
    await cloudConnect({ url: form.url, email: form.email, password: form.password })
    form.password = ''
  } catch {
    /* 错误已经写进 state.cloud.error */
  } finally {
    connecting.value = false
  }
}

async function disconnect() {
  if (!confirm('断开后「待办」回到纯本地模式？服务器上的数据不会被删除。')) return
  await cloudDisconnect()
}

function syncNow() {
  syncTodos()
}

if (window.gradDock) {
  window.gradDock.appInfo().then((info) => {
    if (info) {
      version.value = info.version
      dataFile.value = info.dataFile
    }
  }).catch(() => {})
}

function exportData() {
  const blob = new Blob([JSON.stringify(state.data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'grad-dock-data.json'
  a.click()
  URL.revokeObjectURL(url)
}

function pickFile() {
  fileInput.value?.click()
}

function importData(event) {
  const file = event.target.files?.[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = () => {
    try {
      state.data = { ...state.data, ...JSON.parse(String(reader.result)) }
    } catch (err) {
      state.bootError = `导入失败：${err.message}`
    }
  }
  reader.readAsText(file)
  event.target.value = ''
}

function reset() {
  if (!confirm('确定清空当前数据并恢复示例内容？')) return
  actions.resetAll()
  emit('close')
}
</script>

<style scoped>
.shell {
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
  padding: 11px 13px;
  border-bottom: 1px solid #F1F5F9;
  background: #F6F7FB;
}

.title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: #334155;
}

.title :deep(svg) {
  color: #6366f1;
}

.icon {
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  border: none;
  border-radius: 8px;
  color: #94a3b8;
  background: transparent;
  cursor: pointer;
}

.icon:hover {
  color: #334155;
  background: #f1f5f9;
}

.body {
  flex: 1;
  overflow-y: auto;
  padding: 12px 13px 16px;
}

section + section {
  margin-top: 16px;
}

h5 {
  margin: 0 0 7px;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: #6366f1;
}

.line {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 7px 0;
  font-size: 12px;
  color: #475569;
  border-bottom: 1px dashed rgba(226, 232, 240, 0.8);
}

.line input[type='checkbox'] {
  width: 16px;
  height: 16px;
  accent-color: #6366f1;
}

.suffix {
  display: flex;
  align-items: center;
  gap: 4px;
}

.suffix input {
  width: 62px;
  height: 26px;
  padding: 0 8px;
  font-size: 12px;
  border-radius: 8px;
  border: 1px solid #e2e8f0;
  outline: none;
}

.suffix em {
  font-style: normal;
  font-size: 11px;
  color: #94a3b8;
}

.field {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 0;
  font-size: 12px;
  color: #475569;
  border-bottom: 1px dashed rgba(226, 232, 240, 0.8);
}

.field > span {
  flex: none;
  width: 46px;
}

.field input {
  flex: 1;
  min-width: 0;
  height: 28px;
  padding: 0 8px;
  font-size: 12px;
  color: #334155;
  border-radius: 8px;
  border: 1px solid #e2e8f0;
  outline: none;
}

.field input:focus {
  border-color: #a5b4fc;
  box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.14);
}

.err {
  margin: 6px 0 0;
  font-size: 11px;
  color: #be123c;
}

.err-inline {
  color: #be123c;
}

.note {
  margin: 0;
  font-size: 11px;
  line-height: 1.6;
  color: #94a3b8;
}

.note code {
  font-size: 10px;
  color: #64748b;
}

.break {
  word-break: break-all;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
}

.ghost,
.danger {
  display: flex;
  align-items: center;
  gap: 4px;
  height: 28px;
  padding: 0 10px;
  font-size: 11.5px;
  border-radius: 9px;
  cursor: pointer;
}

.ghost {
  border: 1px solid #e2e8f0;
  color: #475569;
  background: #fff;
}

.danger {
  border: 1px solid #fecdd3;
  color: #e11d48;
  background: #fff1f2;
}

.hidden-file {
  display: none;
}
</style>
