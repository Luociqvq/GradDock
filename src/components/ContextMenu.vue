<template>
  <div ref="el" class="menu no-drag" :style="pos" @contextmenu.prevent>
    <template v-for="(item, i) in menu.items" :key="i">
      <i v-if="item.separator" class="sep" />
      <button v-else class="row" :class="{ 'row--danger': item.danger }" :disabled="item.disabled" @click="pick(item)">
        <component :is="item.icon" v-if="item.icon" :size="12" />
        <span>{{ item.label }}</span>
      </button>
    </template>
  </div>
</template>

<script setup>
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { menu, closeMenu } from '../store.js'

const el = ref(null)
const pos = ref({ left: '0px', top: '0px' })

/** 菜单可能贴着面板右缘或下缘弹出，量完实际尺寸再收进窗口内。 */
async function place() {
  await nextTick()
  const box = el.value && el.value.getBoundingClientRect()
  if (!box) return
  pos.value = {
    left: `${Math.max(4, Math.min(menu.x, window.innerWidth - box.width - 4))}px`,
    top: `${Math.max(4, Math.min(menu.y, window.innerHeight - box.height - 4))}px`
  }
}

function pick(item) {
  closeMenu()
  if (item.action) item.action()
}

function onDown(event) {
  if (el.value && !el.value.contains(event.target)) closeMenu()
}

onMounted(() => {
  place()
  window.addEventListener('mousedown', onDown, true)
  window.addEventListener('wheel', closeMenu, { passive: true })
  window.addEventListener('blur', closeMenu)
})

onBeforeUnmount(() => {
  window.removeEventListener('mousedown', onDown, true)
  window.removeEventListener('wheel', closeMenu)
  window.removeEventListener('blur', closeMenu)
})
</script>

<style scoped>
.menu {
  position: fixed;
  z-index: 50;
  min-width: 132px;
  padding: 4px;
  border-radius: 12px;
  border: 1px solid #E2E8F0;
  background: #fff;
  box-shadow: 0 14px 34px -14px rgba(15, 23, 42, 0.34);
}

.row {
  display: flex;
  align-items: center;
  gap: 7px;
  width: 100%;
  padding: 5px 8px;
  font-size: 12px;
  text-align: left;
  color: #334155;
  border: none;
  border-radius: 8px;
  background: transparent;
  cursor: pointer;
}

.row:hover {
  color: #4338CA;
  background: #EEF2FF;
}

.row:disabled {
  color: #CBD5E1;
  background: transparent;
  cursor: default;
}

.row--danger {
  color: #E11D48;
}

.row--danger:hover {
  background: #FFF1F2;
}

.row :deep(svg) {
  flex: none;
  opacity: 0.7;
}

.sep {
  display: block;
  height: 1px;
  margin: 4px 6px;
  background: #F1F5F9;
}
</style>
