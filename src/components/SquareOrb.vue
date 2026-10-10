<template>
  <button class="orb" :class="`orb--${tone}`" @click="$emit('expand')">
    <span class="ring" :style="{ '--sweep': `${sweep}deg` }" aria-hidden="true" />
    <span class="face">
      <strong>{{ number }}</strong>
      <em>{{ label }}</em>
    </span>
    <span class="dot" :class="`dot--${tone}`" />
  </button>
</template>

<script setup>
import { computed } from 'vue'
import { state, getters } from '../store.js'

defineEmits(['expand'])

const pending = computed(() => getters.pending.value.length)
const overdue = computed(() => getters.overdueCount.value)
const dueToday = computed(() => getters.dueTodayCount.value)
const busy = computed(() => state.lab.results.some((r) => r.summary && r.summary.busiest >= 30))

const tone = computed(() => {
  if (overdue.value) return 'danger'
  if (dueToday.value) return 'urgent'
  if (busy.value) return 'busy'
  if (!pending.value) return 'clear'
  return 'calm'
})

const number = computed(() => {
  if (overdue.value) return overdue.value
  if (dueToday.value) return dueToday.value
  return pending.value
})

const label = computed(() => {
  if (overdue.value) return '逾期'
  if (dueToday.value) return '今天'
  if (!pending.value) return '空闲'
  return '待办'
})

const sweep = computed(() => Math.round((getters.progress.value / 100) * 360))
</script>

<style scoped>
.orb {
  position: relative;
  display: block;
  width: 100%;
  height: 100%;
  padding: 0;
  border: 1px solid rgba(15, 23, 42, 0.14);
  border-radius: 18px;
  cursor: grab;
  color: #fff;
  background: linear-gradient(145deg, #6366f1, #8b5cf6 55%, #a855f7);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.3);
  touch-action: none;
}

.orb:active {
  cursor: grabbing;
}

.orb--danger {
  border-color: rgba(159, 18, 57, 0.35);
  background: linear-gradient(145deg, #f43f5e, #e11d48 60%, #be123c);
}

.orb--urgent {
  border-color: rgba(194, 65, 12, 0.32);
  background: linear-gradient(145deg, #fb923c, #f97316 60%, #ea580c);
}

.orb--busy {
  border-color: rgba(4, 120, 87, 0.32);
  background: linear-gradient(145deg, #10b981, #059669 60%, #047857);
}

.orb--clear {
  border-color: rgba(71, 85, 105, 0.3);
  background: linear-gradient(145deg, #94a3b8, #64748b 60%, #475569);
}

.ring {
  position: absolute;
  inset: 4px;
  box-sizing: border-box;
  border: 3px solid transparent;
  border-radius: 14px;
  background: conic-gradient(rgba(255, 255, 255, 0.75) var(--sweep), rgba(255, 255, 255, 0.14) 0) border-box;
  -webkit-mask: linear-gradient(#000 0 0) padding-box, linear-gradient(#000 0 0) border-box;
  -webkit-mask-composite: xor;
  mask: linear-gradient(#000 0 0) padding-box, linear-gradient(#000 0 0) border-box;
  mask-composite: exclude;
  pointer-events: none;
}

.face {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  line-height: 1;
  pointer-events: none;
}

.face strong {
  font-size: 19px;
  font-weight: 800;
  letter-spacing: -0.03em;
  font-variant-numeric: tabular-nums;
  text-shadow: 0 1px 3px rgba(15, 23, 42, 0.28);
}

.face em {
  margin-top: 2px;
  font-style: normal;
  font-size: 9px;
  font-weight: 600;
  letter-spacing: 0.04em;
  opacity: 0.86;
}

.dot {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: #fff;
  box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.35);
}

.dot--danger,
.dot--urgent {
  animation: orb-blink 1.4s ease-in-out infinite;
}

@keyframes orb-blink {
  50% {
    opacity: 0.25;
  }
}
</style>
