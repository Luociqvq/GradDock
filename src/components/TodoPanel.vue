<template>
  <div class="flex flex-col gap-2.5">
    <p v-if="cloud.signedIn" class="cloud" :class="{ 'cloud--bad': cloud.error }">
      <CloudUpload :size="11" />
      <span class="truncate">{{ cloud.error || `${cloudHost} · ${cloud.at ? '已同步 ' + fmtClock(cloud.at) : '尚未同步'}` }}</span>
      <button class="no-drag" :disabled="cloud.syncing" @click="run(syncTodos)">{{ cloud.syncing ? '同步中' : '重新同步' }}</button>
    </p>

    <form class="add-row" @submit.prevent="submit">
      <input v-model="draft" :placeholder="placeholder" />
      <button type="submit" :disabled="!draft.trim() || busy || ai.busy">
        <Sparkles v-if="aiOn" :size="15" />
        <Plus v-else :size="15" />
      </button>
    </form>
    <p v-if="ai.busy" class="ai-tip">正在让大模型拆这句…</p>
    <p v-else-if="ai.error" class="ai-tip ai-tip--bad">{{ ai.error }}</p>

    <div v-if="!pending.length" class="empty">
      <span>🎉</span>
      <p>待办清空了，去跑实验吧</p>
    </div>

    <TransitionGroup v-else tag="div" class="todo-list flex flex-col gap-2">
      <article v-for="todo in pending" :key="todo.id" class="todo" :class="{ 'todo--over': meta(todo).overdue, 'todo--win': winning.has(todo.id) }" @contextmenu.prevent.stop="todoMenu($event, todo)">
        <button class="check no-drag" :class="`check--${todo.priority}`" @click="completeTodo(todo)">
          <svg class="check-mark" viewBox="0 0 16 16"><path d="M3.5 8.5l3 3 6-6.5" /></svg>
        </button>
        <div class="flex-1 min-w-0">
          <h4>{{ todo.title }}</h4>
          <div class="flex flex-wrap items-center gap-1.5 mt-1">
            <span v-for="tag in todo.tags" :key="tag" class="tag" :class="tagClass(tag)">{{ tag }}</span>
            <span class="chip" :class="chipClass(meta(todo))">{{ meta(todo).label }}</span>
          </div>
        </div>
        <button class="kill no-drag" title="删除" @click="run(() => actions.removeTodo(todo.id))"><X :size="13" /></button>
      </article>
    </TransitionGroup>

    <div v-if="completed.length" class="done-row">
      <span class="text-[11px] text-ink-faint">已完成 {{ completed.length }} 项</span>
      <button class="no-drag" @click="run(() => actions.clearDone())">清空</button>
    </div>

    <div v-if="completed.length" class="flex flex-col gap-1">
      <p v-for="todo in completed.slice(0, 3)" :key="todo.id" class="done-line" @contextmenu.prevent.stop="doneMenu($event, todo)">
        <Check :size="12" />
        <span>{{ todo.title }}</span>
      </p>
    </div>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import { Plus, X, Check, CloudUpload, CalendarClock, ArrowUp, Minus, ArrowDown, RotateCcw, Copy, Trash2, Sparkles } from 'lucide-vue-next'
import { state, getters, actions, syncTodos, openMenu, copyText, aiReady } from '../store.js'
import { dueMeta, TONE_CLASS, fmtClock, startOfDay, DAY } from '../domain/time.js'

const draft = ref('')
const busy = ref(false)
/** 正在播放「完成」动画的待办 id，动画播完才真正切换状态，让用户看得见反馈。 */
const winning = ref(new Set())
const pending = computed(() => getters.pending.value)
const completed = computed(() => state.data.todos.filter((t) => t.done))
const cloud = computed(() => state.cloud)
const ai = computed(() => state.ai)
const aiOn = computed(() => aiReady())
const placeholder = computed(() => (aiOn.value ? '随便写一句，比如「周四前跑完 rebuttal，报销单也交了」' : '添加任务，支持 明天 #论文 !!'))
const cloudHost = computed(() => String(cloud.value.url || '').replace(/^https?:\/\//, '').replace(/\/+$/, ''))

const meta = (todo) => dueMeta(todo.dueDate, state.now)
const chipClass = (m) => `ring-1 text-[11px] font-semibold px-2 py-0.5 rounded-full ${TONE_CLASS[m.tone]}`

/** 云端失败已经记进 state.cloud.error，这里只负责不让它变成未处理的 Promise 异常。 */
async function run(task) {
  busy.value = true
  try {
    await task()
  } catch {
    /* 忽略：错误显示在顶部状态行 */
  } finally {
    busy.value = false
  }
}

async function submit() {
  const text = draft.value.trim()
  if (!text) return
  await run(async () => {
    // 大模型认为这句里没有待办时返回空数组，输入保持原样让用户自己改
    if ((await actions.addTodo(text)).length) draft.value = ''
  })
}

/** 勾选框和右键菜单共用：先播 420ms 的完成动画（画勾 + 弹跳 + 划线），再把状态切到已完成。 */
function completeTodo(todo) {
  if (winning.value.has(todo.id)) return
  winning.value = new Set(winning.value).add(todo.id)
  setTimeout(() => {
    winning.value = new Set([...winning.value].filter((id) => id !== todo.id))
    run(() => actions.toggleTodo(todo.id))
  }, 420)
}

/** 当天 23:59:59，和新建待办时的默认口径保持一致。 */
const endOfDayPlus = (n) => startOfDay(state.now) + n * DAY + DAY - 1000
const daysToSunday = () => (7 - new Date(state.now).getDay()) % 7
const patchTodo = (todo, patch) => run(() => actions.updateTodo(todo.id, patch))

function todoMenu(event, todo) {
  const sunday = daysToSunday()
  openMenu(event, [
    { label: '标记完成', icon: Check, action: () => completeTodo(todo) },
    { separator: true },
    { label: '今天到期', icon: CalendarClock, action: () => patchTodo(todo, { dueDate: endOfDayPlus(0) }) },
    { label: '明天到期', icon: CalendarClock, action: () => patchTodo(todo, { dueDate: endOfDayPlus(1) }) },
    { label: '本周日到期', icon: CalendarClock, action: () => patchTodo(todo, { dueDate: endOfDayPlus(sunday || 7) }) },
    // 服务器把 due_date=null 当成"没传"，清除日期只在纯本地模式下可用
    state.cloud.signedIn ? null : { label: '清除日期', icon: CalendarClock, disabled: !todo.dueDate, action: () => patchTodo(todo, { dueDate: null }) },
    { separator: true },
    { label: '高优先级', icon: ArrowUp, disabled: todo.priority === 'high', action: () => patchTodo(todo, { priority: 'high' }) },
    { label: '中优先级', icon: Minus, disabled: todo.priority === 'medium', action: () => patchTodo(todo, { priority: 'medium' }) },
    { label: '低优先级', icon: ArrowDown, disabled: todo.priority === 'low', action: () => patchTodo(todo, { priority: 'low' }) },
    { separator: true },
    { label: '复制标题', icon: Copy, action: () => copyText(todo.title) },
    { label: '删除', icon: Trash2, danger: true, action: () => run(() => actions.removeTodo(todo.id)) }
  ])
}

function doneMenu(event, todo) {
  openMenu(event, [
    { label: '重新打开', icon: RotateCcw, action: () => run(() => actions.toggleTodo(todo.id)) },
    { label: '复制标题', icon: Copy, action: () => copyText(todo.title) },
    { label: '删除', icon: Trash2, danger: true, action: () => run(() => actions.removeTodo(todo.id)) }
  ])
}

function tagClass(tag) {
  const map = { 论文: 'bg-indigo-50 text-indigo-600', 组会: 'bg-violet-50 text-violet-600', 文献: 'bg-sky-50 text-sky-600', 杂事: 'bg-slate-100 text-slate-500' }
  return map[tag] || 'bg-emerald-50 text-emerald-600'
}
</script>

<style scoped>
.cloud {
  display: flex;
  align-items: center;
  gap: 5px;
  margin: 0;
  padding: 4px 8px;
  font-size: 10.5px;
  color: #64748b;
  border-radius: 9px;
  background: #EEF2FF;
}

.cloud--bad {
  color: #be123c;
  background: #fff1f2;
}

.cloud button {
  margin-left: auto;
  flex: none;
  border: none;
  background: transparent;
  font-size: 10.5px;
  color: #6366f1;
  cursor: pointer;
}

.cloud button:disabled {
  color: #a5b4fc;
  cursor: default;
}

.ai-tip {
  margin: -2px 0 0;
  padding: 0 4px;
  font-size: 10.5px;
  color: #94a3b8;
}

.ai-tip--bad {
  color: #be123c;
}

.add-row {
  display: flex;
  gap: 6px;
}

.add-row input {
  flex: 1;
  height: 34px;
  padding: 0 12px;
  font-size: 13px;
  color: #334155;
  border-radius: 12px;
  border: 1px solid #e2e8f0;
  background: rgba(248, 250, 252, 0.9);
  outline: none;
}

.add-row input:focus {
  border-color: #a5b4fc;
  background: #fff;
  box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.14);
}

.add-row button {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border: none;
  border-radius: 12px;
  color: #fff;
  cursor: pointer;
  background: linear-gradient(135deg, #6366f1, #8b5cf6);
}

.add-row button:disabled {
  opacity: 0.4;
  cursor: default;
}

.todo {
  display: flex;
  align-items: flex-start;
  gap: 9px;
  padding: 10px 11px;
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.92);
  border: 1px solid rgba(226, 232, 240, 0.75);
  box-shadow: 0 6px 18px -14px rgba(15, 23, 42, 0.5);
}

.todo--over {
  border-color: rgba(254, 205, 211, 0.9);
}

.todo h4 {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  line-height: 1.35;
  color: #334155;
}

.check {
  position: relative;
  width: 20px;
  height: 20px;
  margin-top: 1px;
  flex: none;
  border-radius: 8px;
  border: 2px solid #cbd5e1;
  background: #fff;
  cursor: pointer;
  transition: transform 0.15s ease, border-color 0.15s ease, background 0.2s ease, box-shadow 0.2s ease;
}

.check:hover {
  border-color: #818cf8;
}

.check:active {
  transform: scale(0.82);
}

.check--high {
  border-color: #fca5a5;
}

.check--low {
  border-style: dashed;
}

/* 完成时勾选框填充绿色并画勾 */
.todo--win .check {
  border-color: #10b981;
  background: linear-gradient(135deg, #34d399, #10b981);
  box-shadow: 0 0 0 4px rgba(16, 185, 129, 0.18);
}

.check-mark {
  position: absolute;
  inset: 0;
  margin: auto;
  width: 12px;
  height: 12px;
  fill: none;
  stroke: #fff;
  stroke-width: 2.5;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-dasharray: 22;
  stroke-dashoffset: 22;
}

.todo--win .check-mark {
  animation: check-draw 0.32s 0.08s ease forwards;
}

@keyframes check-draw {
  to {
    stroke-dashoffset: 0;
  }
}

/* 卡片完成时的弹跳 + 绿色高亮 */
.todo--win {
  border-color: rgba(110, 231, 183, 0.9);
  animation: todo-pop 0.42s cubic-bezier(0.22, 1.2, 0.36, 1);
}

@keyframes todo-pop {
  0% {
    transform: scale(1);
  }
  35% {
    transform: scale(1.03);
    box-shadow: 0 8px 24px -12px rgba(16, 185, 129, 0.6);
  }
  100% {
    transform: scale(1);
  }
}

/* 标题划线扫过 */
.todo h4 {
  position: relative;
  width: fit-content;
}

.todo--win h4::after {
  content: '';
  position: absolute;
  left: -2px;
  right: -2px;
  top: 55%;
  height: 1.5px;
  border-radius: 2px;
  background: #94a3b8;
  transform: scaleX(0);
  transform-origin: left center;
  animation: strike 0.28s 0.12s ease forwards;
}

@keyframes strike {
  to {
    transform: scaleX(1);
  }
}

/* 列表进出场：完成后卡片滑出，其余卡片平滑上移补位 */
.todo-list {
  position: relative;
}

.todo-enter-active {
  transition: opacity 0.28s ease, transform 0.28s ease;
}

.todo-enter-from {
  opacity: 0;
  transform: translateY(-6px);
}

.todo-leave-active {
  position: absolute;
  width: 100%;
  transition: opacity 0.16s ease, transform 0.16s ease;
}

.todo-leave-to {
  opacity: 0;
  transform: translateX(28px) scale(0.96);
}

.todo-move {
  transition: transform 0.18s ease;
}

.tag {
  font-size: 11px;
  padding: 1px 7px;
  border-radius: 999px;
}

.kill {
  display: grid;
  place-items: center;
  width: 20px;
  height: 20px;
  border: none;
  border-radius: 7px;
  color: #cbd5e1;
  background: transparent;
  cursor: pointer;
}

.kill:hover {
  color: #f43f5e;
  background: #fff1f2;
}

.empty {
  padding: 22px 0;
  text-align: center;
  color: #94a3b8;
}

.empty span {
  display: block;
  font-size: 26px;
  margin-bottom: 6px;
}

.empty p {
  margin: 0;
  font-size: 12px;
}

.done-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-top: 2px;
}

.done-row button {
  border: none;
  background: transparent;
  font-size: 11px;
  color: #94a3b8;
  cursor: pointer;
}

.done-row button:hover {
  color: #6366f1;
}

.done-line {
  display: flex;
  align-items: center;
  gap: 5px;
  margin: 0;
  font-size: 11px;
  color: #cbd5e1;
}

.done-line :deep(svg) {
  color: #34d399;
}
</style>
