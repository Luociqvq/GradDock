<template>
  <div class="pill" :class="`pill--${extend}`">
    <div class="pill-orb">
      <SquareOrb @expand="$emit('expand')" @pointerdown="$emit('orb-down', $event)" />
    </div>
    <button class="pill-info no-drag" @click="$emit('expand')">
      <span class="line-one">
        <em class="chip" :class="chipClass">{{ chip }}</em>
        <i class="time">{{ clockLabel }}</i>
      </span>
      <span class="line-two">{{ title }}</span>
    </button>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import SquareOrb from './SquareOrb.vue'
import { state, getters } from '../store.js'
import { dueMeta, TONE_CLASS, fmtClock } from '../domain/time.js'

defineProps({ extend: { type: String, default: 'right' } })
defineEmits(['expand', 'orb-down'])

const todo = computed(() => getters.headline.value)
const next = computed(() => getters.nextSchedule.value)

const title = computed(() => {
  if (todo.value) return todo.value.title
  if (next.value) return next.value.title
  return '今天没有待办了'
})

const chip = computed(() => {
  if (todo.value) return dueMeta(todo.value.dueDate, state.now).label
  if (next.value) return '日程'
  return '空闲'
})

const chipClass = computed(() => {
  const tone = todo.value ? dueMeta(todo.value.dueDate, state.now).tone : next.value ? 'calm' : 'none'
  return `ring-1 ${TONE_CLASS[tone]}`
})

const clockLabel = computed(() => {
  if (todo.value?.dueDate) return fmtClock(todo.value.dueDate)
  if (next.value) return `${fmtClock(next.value.start)} ${next.value.location || ''}`.trim()
  return fmtClock(state.now)
})
</script>

<style scoped>
.pill {
  display: flex;
  align-items: center;
  width: 100%;
  height: 100%;
}

.pill--left {
  flex-direction: row-reverse;
}

.pill-orb {
  width: 56px;
  height: 56px;
  flex: none;
}

.pill-info {
  flex: 1;
  min-width: 0;
  height: 44px;
  margin: 0 6px;
  padding: 0 10px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 3px;
  text-align: left;
  border: 1px solid rgba(203, 213, 225, 0.9);
  border-radius: 14px;
  background: #FFFFFF;
  cursor: pointer;
}

.line-one {
  display: flex;
  align-items: center;
  gap: 6px;
}

.chip {
  font-style: normal;
  font-size: 10px;
  font-weight: 700;
  padding: 0 6px;
  border-radius: 999px;
  flex: none;
}

.time {
  font-style: normal;
  font-size: 10px;
  color: #94a3b8;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.line-two {
  font-size: 12px;
  font-weight: 600;
  color: #334155;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
