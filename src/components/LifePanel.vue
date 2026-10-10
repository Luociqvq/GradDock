<template>
  <div class="flex flex-col gap-2.5">
    <section class="wallet">
      <div class="flex items-baseline gap-1.5">
        <strong class="amount">¥{{ balance.toFixed(2) }}</strong>
        <span class="unit">本月可用</span>
      </div>
      <div class="bar"><i :style="{ width: `${spentPercent}%` }" /></div>
      <p class="bar-note">
        已花 ¥{{ life.spent.toFixed(0) }} / 预算 ¥{{ life.budget.toFixed(0) }}
        <span class="left">· 日均 ¥{{ daily }}</span>
      </p>
    </section>

    <div class="flex items-center gap-2 px-1">
      <span class="w-1.5 h-1.5 rounded-full bg-emerald-500" />
      <h4 class="section-title">待买清单</h4>
      <span class="count">{{ shoppingLeft }} 项</span>
    </div>

    <form class="add-row" @submit.prevent="submit">
      <input v-model="draft" placeholder="要买什么？回车添加" />
      <button type="submit"><Plus :size="15" /></button>
    </form>

    <TransitionGroup tag="div" class="flex flex-col gap-1.5">
      <div v-for="item in life.shopping" :key="item.id" class="row" :class="{ 'row--done': item.done }" @contextmenu.prevent.stop="itemMenu($event, item)">
        <button class="box no-drag" @click="actions.toggleShopping(item.id)">
          <Check v-if="item.done" :size="12" />
        </button>
        <span class="flex-1 truncate">{{ item.name }}</span>
        <button class="kill no-drag" @click="actions.removeShopping(item.id)"><X :size="12" /></button>
      </div>
    </TransitionGroup>

    <p v-if="!life.shopping.length" class="empty-line">清单是空的</p>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import { Plus, X, Check, RotateCcw, Trash2 } from 'lucide-vue-next'
import { state, getters, actions, openMenu } from '../store.js'

const draft = ref('')
const life = computed(() => state.data.life)
const balance = computed(() => getters.balance.value)
const shoppingLeft = computed(() => getters.shoppingLeft.value)
const spentPercent = computed(() => {
  const { spent, budget } = state.data.life
  if (!budget) return 0
  return Math.max(2, Math.min(100, Math.round((spent / budget) * 100)))
})
const daily = computed(() => {
  const day = new Date(state.now).getDate()
  return (state.data.life.spent / day).toFixed(0)
})

function itemMenu(event, item) {
  openMenu(event, [
    item.done
      ? { label: '重新标记要买', icon: RotateCcw, action: () => actions.toggleShopping(item.id) }
      : { label: '标记已买', icon: Check, action: () => actions.toggleShopping(item.id) },
    { label: '删除', icon: Trash2, danger: true, action: () => actions.removeShopping(item.id) }
  ])
}

function submit() {
  const name = draft.value.trim()
  if (!name) return
  actions.addShopping(name)
  draft.value = ''
}
</script>

<style scoped>
.wallet {
  padding: 12px 13px;
  border-radius: 16px;
  border: 1px solid rgba(209, 250, 229, 0.9);
  background: linear-gradient(135deg, rgba(236, 253, 245, 0.95), rgba(240, 249, 255, 0.95));
}

.amount {
  font-size: 22px;
  font-weight: 800;
  letter-spacing: -0.02em;
  color: #047857;
  font-variant-numeric: tabular-nums;
}

.unit {
  font-size: 11px;
  color: #6b7280;
}

.bar {
  height: 5px;
  margin-top: 9px;
  border-radius: 999px;
  background: rgba(16, 185, 129, 0.15);
  overflow: hidden;
}

.bar i {
  display: block;
  height: 100%;
  border-radius: 999px;
  background: linear-gradient(90deg, #10b981, #34d399);
}

.bar-note {
  margin: 5px 0 0;
  font-size: 10.5px;
  color: #64748b;
  font-variant-numeric: tabular-nums;
}

.left {
  color: #94a3b8;
}

.section-title {
  margin: 0;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #059669;
}

.count {
  font-size: 10px;
  color: #94a3b8;
  background: #f1f5f9;
  padding: 1px 6px;
  border-radius: 999px;
}

.add-row {
  display: flex;
  gap: 6px;
}

.add-row input {
  flex: 1;
  height: 32px;
  padding: 0 12px;
  font-size: 12.5px;
  color: #334155;
  border-radius: 11px;
  border: 1px solid #e2e8f0;
  background: rgba(248, 250, 252, 0.9);
  outline: none;
}

.add-row input:focus {
  border-color: #6ee7b7;
  background: #fff;
  box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.14);
}

.add-row button {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border: none;
  border-radius: 11px;
  color: #fff;
  cursor: pointer;
  background: linear-gradient(135deg, #10b981, #059669);
}

.row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  font-size: 12.5px;
  color: #334155;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.9);
  border: 1px solid rgba(226, 232, 240, 0.7);
}

.row--done {
  color: #cbd5e1;
  text-decoration: line-through;
}

.box {
  display: grid;
  place-items: center;
  width: 17px;
  height: 17px;
  flex: none;
  border-radius: 6px;
  border: 2px solid #cbd5e1;
  background: #fff;
  color: #fff;
  cursor: pointer;
}

.box:hover {
  border-color: #34d399;
}

.row--done .box {
  border-color: #10b981;
  background: #10b981;
}

.kill {
  border: none;
  background: transparent;
  color: #e2e8f0;
  cursor: pointer;
}

.kill:hover {
  color: #f43f5e;
}

.empty-line {
  margin: 4px 0 0;
  font-size: 11.5px;
  color: #94a3b8;
  text-align: center;
}
</style>
