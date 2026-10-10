<template>
  <div class="flex flex-col gap-2.5">
    <section v-if="next" class="hero" @contextmenu.prevent.stop="itemMenu($event, next)">
      <p class="eyebrow">下一个安排 · {{ humanCountdown(next.start, state.now) }}</p>
      <h3>{{ next.title }}</h3>
      <p class="hero-meta">
        {{ fmtDateCn(next.start) }} {{ weekdayCn(next.start) }} {{ next.time }}
        <span v-if="next.location"> · {{ next.location }}</span>
      </p>
      <div class="bar"><i :style="{ width: `${percent}%` }" /></div>
      <p class="bar-note">{{ barNote }}</p>
    </section>
    <section v-else class="empty">
      <span>🗓️</span>
      <p>未来两周没有固定安排</p>
    </section>

    <div class="flex items-center gap-2 px-1 mt-1">
      <span class="w-1.5 h-1.5 rounded-full bg-indigo-500" />
      <h4 class="section-title">近期</h4>
      <span class="count">{{ list.length }}</span>
    </div>

    <div v-for="item in list.slice(0, 5)" :key="item.instanceKey" class="row" @contextmenu.prevent.stop="itemMenu($event, item)">
      <div class="when">
        <strong>{{ weekdayCn(item.start) }}</strong>
        <span>{{ item.time }}</span>
      </div>
      <div class="flex-1 min-w-0">
        <p class="row-title">{{ item.title }}</p>
        <p class="row-meta">{{ item.location || item.tag }} · {{ item.duration }} 分钟</p>
      </div>
      <span class="tag">{{ item.tag }}</span>
    </div>

    <button class="add-toggle no-drag" @click="showForm = !showForm">
      <Plus :size="13" /> {{ showForm ? '收起' : '新增固定安排' }}
    </button>

    <form v-if="showForm" class="form" @submit.prevent="submit">
      <input v-model="form.title" placeholder="标题，如 中期检查" />
      <div class="form-grid">
        <select v-model.number="form.weekday">
          <option v-for="(w, i) in WEEK" :key="w" :value="i">{{ w }}</option>
        </select>
        <input v-model="form.time" type="time" />
        <input v-model.number="form.duration" type="number" min="5" step="5" placeholder="分钟" />
        <input v-model="form.location" placeholder="地点" />
      </div>
      <button class="primary" type="submit" :disabled="!form.title.trim()">保存</button>
    </form>
  </div>
</template>

<script setup>
import { computed, reactive, ref } from 'vue'
import { Plus, Power, Copy, Trash2 } from 'lucide-vue-next'
import { state, getters, actions, openMenu, copyText } from '../store.js'
import { humanCountdown, weekdayCn, fmtDateCn, DAY } from '../domain/time.js'

const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
const showForm = ref(false)
const form = reactive({ title: '', weekday: new Date().getDay(), time: '14:00', duration: 60, location: '' })

const list = computed(() => getters.scheduleList.value)
const next = computed(() => list.value[0] || null)

const percent = computed(() => {
  if (!next.value) return 0
  const total = next.value.start - (next.value.start % DAY)
  return Math.max(2, Math.min(100, Math.round(((state.now - total) / (next.value.start - total)) * 100)))
})

const barNote = computed(() => {
  if (!next.value) return ''
  const diff = next.value.start - state.now
  if (diff < DAY) return '就在今天，别忘了'
  return `还有 ${Math.ceil(diff / DAY)} 天`
})

function itemMenu(event, item) {
  const enabled = item.enabled !== false
  openMenu(event, [
    { label: enabled ? '停用这个安排' : '启用这个安排', icon: Power, action: () => actions.setScheduleEnabled(item.id, !enabled) },
    { label: '复制内容', icon: Copy, action: () => copyText(`${item.title} · ${weekdayCn(item.start)} ${item.time}${item.location ? ` · ${item.location}` : ''}`) },
    { label: '删除', icon: Trash2, danger: true, action: () => actions.removeSchedule(item.id) }
  ])
}

function submit() {
  if (!form.title.trim()) return
  actions.addSchedule({ ...form })
  form.title = ''
  form.location = ''
  showForm.value = false
}
</script>

<style scoped>
.hero {
  padding: 12px 13px;
  border-radius: 16px;
  border: 1px solid rgba(199, 210, 254, 0.8);
  background: linear-gradient(135deg, rgba(238, 242, 255, 0.95), rgba(250, 245, 255, 0.95));
}

.eyebrow {
  margin: 0;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.02em;
  color: #4f46e5;
}

.hero h3 {
  margin: 4px 0 2px;
  font-size: 15px;
  font-weight: 700;
  color: #1e293b;
}

.hero-meta {
  margin: 0;
  font-size: 11px;
  color: #64748b;
}

.bar {
  height: 4px;
  margin-top: 9px;
  border-radius: 999px;
  background: rgba(99, 102, 241, 0.15);
  overflow: hidden;
}

.bar i {
  display: block;
  height: 100%;
  border-radius: 999px;
  background: linear-gradient(90deg, #6366f1, #a855f7);
  transition: width 0.4s ease;
}

.bar-note {
  margin: 5px 0 0;
  font-size: 10px;
  color: #94a3b8;
}

.section-title {
  margin: 0;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #6366f1;
}

.count {
  font-size: 10px;
  color: #94a3b8;
  background: #f1f5f9;
  padding: 1px 6px;
  border-radius: 999px;
}

.row {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 8px 10px;
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.9);
  border: 1px solid rgba(226, 232, 240, 0.7);
}

.when {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 40px;
  flex: none;
}

.when strong {
  font-size: 11px;
  color: #4f46e5;
}

.when span {
  font-size: 10px;
  color: #94a3b8;
}

.row-title {
  margin: 0;
  font-size: 12.5px;
  font-weight: 600;
  color: #334155;
}

.row-meta {
  margin: 1px 0 0;
  font-size: 10.5px;
  color: #94a3b8;
}

.tag {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 999px;
  background: #f1f5f9;
  color: #64748b;
  flex: none;
}

.empty {
  padding: 18px 0;
  text-align: center;
  color: #94a3b8;
}

.empty span {
  display: block;
  font-size: 24px;
  margin-bottom: 4px;
}

.empty p {
  margin: 0;
  font-size: 12px;
}

.add-toggle {
  display: flex;
  align-items: center;
  gap: 4px;
  align-self: flex-start;
  margin-top: 4px;
  padding: 4px 9px;
  font-size: 11px;
  color: #6366f1;
  border: 1px dashed #c7d2fe;
  border-radius: 999px;
  background: transparent;
  cursor: pointer;
}

.form {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px;
  border-radius: 14px;
  background: rgba(248, 250, 252, 0.9);
  border: 1px solid #e2e8f0;
}

.form input,
.form select {
  height: 30px;
  padding: 0 8px;
  font-size: 12px;
  color: #334155;
  border-radius: 9px;
  border: 1px solid #e2e8f0;
  background: #fff;
  outline: none;
  width: 100%;
}

.form-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
}

.primary {
  height: 30px;
  border: none;
  border-radius: 9px;
  font-size: 12px;
  color: #fff;
  cursor: pointer;
  background: linear-gradient(135deg, #6366f1, #8b5cf6);
}
</style>
