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
        <h5>快速添加助手</h5>
        <p class="note">开启后，「待办」输入框里随口写的一句会交给大模型拆成条目 —— 比如「周四前跑完 rebuttal 实验，报销单也要交了」会变成两条，顺带认出「下周三下午三点」这种说法。填的接口是你自己的服务商，输入内容会发过去。</p>
        <label class="line">
          <span>用大模型解析</span>
          <input type="checkbox" v-model="aiForm.enabled" />
        </label>
        <label class="field"><span>接口</span><input v-model="aiForm.baseUrl" placeholder="https://api.deepseek.com/v1" @change="modelList = []" /></label>
        <label class="field">
          <span>模型</span>
          <select v-if="modelList.length" v-model="aiForm.model">
            <option v-for="m in modelOptions" :key="m.id" :value="m.id">{{ m.label }}</option>
          </select>
          <input v-else v-model="aiForm.model" placeholder="deepseek-chat" />
          <button class="mini" :disabled="loadingModels" @click="loadModels">{{ loadingModels ? '读取中…' : modelList.length ? '刷新列表' : '拉取列表' }}</button>
        </label>
        <p v-if="modelsError" class="err">{{ modelsError }}</p>
        <label class="field"><span>Key</span><input v-model="aiForm.key" type="password" :placeholder="ai.hasKey ? '已保存，留空则不改动' : '粘贴 API Key'" autocomplete="off" /></label>
        <p v-if="ai.error" class="err">{{ ai.error }}</p>
        <div v-if="probeResult" class="probe">
          <p v-for="item in probeResult" :key="item.title" class="probe-row">
            <strong>{{ item.title }}</strong>
            <em>{{ dueLabel(item.dueDate) }}</em>
            <span>{{ item.priority }} · {{ item.tags.join(' ') || '无标签' }}</span>
          </p>
          <p class="probe-at">这次用了 {{ ai.tokens }} token</p>
        </div>
        <div class="actions">
          <button class="ghost" :disabled="aiBusy" @click="saveAi">保存设置</button>
          <button class="ghost" :disabled="aiBusy || !aiForm.key" @click="saveKey">{{ ai.hasKey ? '更新密钥' : '保存密钥' }}</button>
          <button class="ghost" :disabled="aiBusy" @click="probe">{{ aiBusy ? '解析中…' : '试跑一句' }}</button>
          <button v-if="ai.hasKey" class="danger" @click="clearKey">清除密钥</button>
        </div>
        <p class="note">现在{{ aiOn ? '已启用大模型：规则读得懂的直接本地建，只有「下周五」「月底前」这类规则看不懂的说法、或一句话里塞了几件事时才联网' : '未启用大模型，添加待办只走本机规则：认 今天/明天/后天、周几、M/D、#标签、结尾的 ! 和 !!' }}。</p>
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
import { state, actions, cloudConnect, cloudDisconnect, syncTodos, aiReady, saveAiConfig, setAiKey, testAiParse } from '../store.js'
import { fmtClock } from '../domain/time.js'

const PROBE_TEXT = '周四前跑完 rebuttal 实验，下周三组会要交 PPT，报销单有空交一下'

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

const ai = computed(() => state.ai)
const aiOn = computed(() => aiReady())
const aiBusy = computed(() => state.ai.busy)
const probeResult = ref(null)
const modelList = ref([])
const loadingModels = ref(false)
const modelsError = ref('')
const aiForm = reactive({
  enabled: state.data.ai.enabled,
  baseUrl: state.data.ai.baseUrl,
  model: state.data.ai.model,
  key: ''
})

/** 手填过、但清单里没有的模型要留在选项里，否则下拉一渲染就把当前值改掉了。 */
const modelOptions = computed(() => {
  const list = modelList.value.slice()
  const current = String(aiForm.model || '').trim()
  if (current && !list.some((m) => m.id === current)) list.unshift({ id: current, label: `${current}（当前填写）` })
  return list
})

async function loadModels() {
  if (loadingModels.value) return
  if (!window.gradDock) {
    modelsError.value = '浏览器预览模式不能联网'
    return
  }
  loadingModels.value = true
  modelsError.value = ''
  try {
    // 主进程从磁盘读接口地址和密钥：先把界面上填的落盘，Key 填了没存的也一并存掉
    await persistAi()
    if (aiForm.key.trim()) {
      await setAiKey(aiForm.key)
      aiForm.key = ''
    }
    const res = await window.gradDock.aiModels()
    if (!res || !res.ok) {
      modelsError.value = (res && res.error) || '读取模型清单失败'
      return
    }
    const list = res.models || []
    modelList.value = list
    // 列表更新后默认选第一个；只有当前填写的模型还在新清单里时才保留原选择
    const current = String(aiForm.model || '').trim()
    if (list.length && (!current || !list.some((m) => m.id === current))) {
      aiForm.model = list[0].id
      await persistAi()
    }
  } catch (err) {
    modelsError.value = err.message || '读取模型清单失败'
  } finally {
    loadingModels.value = false
  }
}

async function persistAi() {
  return saveAiConfig({ enabled: aiForm.enabled, baseUrl: aiForm.baseUrl.trim(), model: aiForm.model.trim() })
}

/** 保存设置后顺手刷新模型清单：接口换了、密钥存了，列表就该跟着新接口走。 */
async function saveAi() {
  await persistAi()
  probeResult.value = null
  if (state.ai.hasKey || aiForm.key.trim()) loadModels()
}

async function saveKey() {
  try {
    await setAiKey(aiForm.key)
    aiForm.key = ''
    state.ai.error = ''
    loadModels()
  } catch (err) {
    state.ai.error = err.message
  }
}

function clearKey() {
  probeResult.value = null
  return setAiKey('')
}

/** 没勾选启用也能试跑，开关只决定添加待办时走不走大模型。 */
async function probe() {
  probeResult.value = null
  try {
    await persistAi()
    probeResult.value = await testAiParse(PROBE_TEXT)
  } catch (err) {
    state.ai.error = `试跑失败：${err.message || err}`
  }
}

const dueLabel = (ms) => (ms ? new Date(ms).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '无截止')

if (window.gradDock) {
  window.gradDock.appInfo().then((info) => {
    if (info) {
      version.value = info.version
      dataFile.value = info.dataFile
    }
  }).catch(() => {})
  // 已经存过密钥就顺手把模型清单拉下来，省得还要手填 id
  window.gradDock.aiStatus().then((status) => {
    if (status && status.hasKey && status.config && status.config.baseUrl) loadModels()
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

.field .mini {
  flex: none;
  height: 28px;
  padding: 0 8px;
  font-size: 11px;
  color: #475569;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #fff;
  cursor: pointer;
}

.field .mini:hover {
  border-color: #a5b4fc;
  color: #4f46e5;
}

.field .mini:disabled {
  color: #cbd5e1;
  cursor: default;
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

.field select {
  flex: 1;
  min-width: 0;
  height: 28px;
  padding: 0 6px;
  font-size: 12px;
  color: #334155;
  border-radius: 8px;
  border: 1px solid #e2e8f0;
  background: #fff;
  outline: none;
}

.probe {
  margin-top: 8px;
  padding: 8px 10px;
  font-size: 11px;
  color: #475569;
  border-radius: 10px;
  background: #EEF2FF;
}

.probe-row {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 6px;
  margin: 0;
  padding: 3px 0;
  border-bottom: 1px dashed rgba(99, 102, 241, 0.2);
}

.probe-row:last-of-type {
  border-bottom: none;
}

.probe-row strong {
  flex: 1;
  min-width: 120px;
  font-size: 11.5px;
  font-weight: 600;
  color: #334155;
}

.probe-row em {
  font-style: normal;
  color: #6366f1;
}

.probe-row span {
  color: #94a3b8;
}

.probe-at {
  margin: 4px 0 0;
  color: #94a3b8;
}

.hidden-file {
  display: none;
}
</style>
