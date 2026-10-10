<template>
  <form ref="root" class="form" @submit.prevent="submit">
    <input v-model="form.name" placeholder="名称，如 训练服务器" />
    <div class="grid2">
      <input v-model="form.user" placeholder="用户名（可空）" />
      <input v-model="form.host" placeholder="IP / 域名 / config 别名" />
    </div>
    <div class="auth-picker">
      <label :class="{ active: form.auth !== 'password' }">
        <input v-model="form.auth" type="radio" value="key" />
        <span>密钥</span>
      </label>
      <label :class="{ active: form.auth === 'password' }">
        <input v-model="form.auth" type="radio" value="password" />
        <span>密码</span>
      </label>
    </div>
    <div class="grid2">
      <input v-model.number="form.port" type="number" min="1" max="65535" placeholder="端口，默认 22" />
      <input v-if="form.auth === 'password'" v-model="form.password" type="password" autocomplete="new-password" :placeholder="hasSavedSecret ? '已存密码，留空则不修改' : '登录密码'" />
      <input v-else v-model="form.identityFile" placeholder="私钥路径，如 ~/.ssh/id_ed25519" />
    </div>
    <input v-model="form.command" placeholder="自定义探针命令（留空用默认）" />
    <label class="check-line">
      <input v-model="form.enabled" type="checkbox" />
      <span>启用采集（关掉只是不轮询，节点仍留在列表里）</span>
    </label>
    <label class="check-line">
      <input v-model="form.mock" type="checkbox" />
      <span>使用演示数据（不联网）</span>
    </label>
    <p class="note">
      <template v-if="form.auth === 'password'">密码经 Windows DPAPI 加密后单独存放，不会写进节点配置、也不会传给界面。风险自觉：这等于把该主机的登录凭据长期留在本机。</template>
      <template v-else>需要已在服务器授权过的密钥或运行中的 ssh-agent；BatchMode 下不会弹密码提示。</template>
    </p>
    <p v-if="formError" class="err">{{ formError }}</p>
    <div class="acts">
      <button class="primary" type="submit" :disabled="!form.name.trim() || form.mock === false && !form.host.trim()">保存节点</button>
      <button type="button" class="ghost" @click="$emit('close')">取消</button>
      <button v-if="form.id" type="button" class="danger" @click="remove">删除</button>
    </div>
  </form>
</template>

<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { state, actions, refreshLab, saveSecret } from '../store.js'

const props = defineProps({ target: { type: Object, default: null } })
const emit = defineEmits(['close', 'deleted'])

const root = ref(null)
const formError = ref('')
const blank = () => ({ id: '', name: '', user: '', host: '', port: 22, identityFile: '~/.ssh/grad_dock', command: '', mock: false, enabled: true, auth: 'key', password: '' })
const form = reactive(blank())

const hasSavedSecret = computed(() => !!state.lab.secrets[form.id])

watch(() => props.target, (target) => {
  Object.assign(form, blank())
  if (!target) return
  Object.assign(form, {
    id: target.id,
    name: target.name,
    user: target.user || '',
    host: target.host || '',
    port: target.port || 22,
    identityFile: target.identityFile || '',
    command: target.command || '',
    mock: !!target.mock,
    enabled: target.enabled !== false,
    auth: target.auth || 'key'
  })
  formError.value = ''
}, { immediate: true })

// 内联在节点下面时，列表可能还停在上面，展开后滚到看得见的位置
onMounted(() => {
  root.value?.scrollIntoView({ block: 'nearest' })
})

async function submit() {
  formError.value = ''
  const wantsPassword = form.auth === 'password' && !form.mock
  if (wantsPassword && !form.password && !hasSavedSecret.value) {
    formError.value = '请填写登录密码'
    return
  }
  const saved = actions.saveLabTarget({
    id: form.id || undefined,
    name: form.name,
    user: form.user,
    host: form.host,
    port: form.port,
    identityFile: form.auth === 'password' ? '' : form.identityFile,
    command: form.command,
    mock: form.mock,
    enabled: form.enabled,
    auth: form.auth
  })
  try {
    if (wantsPassword && form.password) await saveSecret(saved.id, form.password)
    else if (!wantsPassword) await saveSecret(saved.id, '')
  } catch (err) {
    formError.value = err.message
    return
  }
  form.password = ''
  emit('close')
  await refreshLab(true)
}

async function remove() {
  const name = form.name || form.host
  if (!confirm(`从面板移除「${name}」？\n\n这只删本地记录。用密码认证的节点会连同本机保存的密码一起删除；用密钥认证的节点，服务器上的授权密钥仍然有效，需登录机器删除 /root/.ssh/authorized_keys 里含 grad-dock-widget 的那一行。`)) return
  const id = form.id
  if (window.gradDock) await window.gradDock.deleteSecret(id).catch(() => {})
  actions.removeLabTarget(id)
  emit('deleted', id)
  emit('close')
}
</script>

<style scoped>
.form {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 9px;
  padding: 10px;
  border-radius: 14px;
  background: #F1F5F9;
  border: 1px solid #E2E8F0;
}

.form input {
  width: 100%;
  height: 30px;
  padding: 0 8px;
  font-size: 12px;
  color: #334155;
  border-radius: 9px;
  border: 1px solid #E2E8F0;
  background: #fff;
  outline: none;
}

.grid2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
}

.auth-picker {
  display: flex;
  gap: 4px;
  padding: 2px;
  border-radius: 9px;
  background: #fff;
  border: 1px solid #E2E8F0;
}

.auth-picker label {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  height: 26px;
  border-radius: 7px;
  font-size: 11.5px;
  color: #64748B;
  cursor: pointer;
}

.auth-picker label.active {
  background: #EEF2FF;
  color: #4338CA;
  font-weight: 600;
}

.auth-picker input {
  width: 12px;
  height: 12px;
  accent-color: #6366F1;
}

.check-line {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: #64748B;
}

.check-line input {
  width: 15px;
  height: 15px;
  accent-color: #6366F1;
}

.note {
  margin: 0;
  font-size: 10.5px;
  line-height: 1.5;
  color: #94A3B8;
}

.err {
  margin: 0;
  font-size: 11px;
  line-height: 1.5;
  color: #E11D48;
  word-break: break-word;
}

.acts {
  display: flex;
  gap: 6px;
}

.primary,
.ghost,
.danger {
  height: 30px;
  border-radius: 9px;
  font-size: 12px;
  cursor: pointer;
}

.primary {
  flex: 1;
  border: none;
  color: #fff;
  background: linear-gradient(135deg, #6366F1, #8B5CF6);
}

.ghost {
  padding: 0 12px;
  border: 1px solid #E2E8F0;
  color: #475569;
  background: #fff;
}

.danger {
  padding: 0 10px;
  border: 1px solid #FECDD3;
  color: #E11D48;
  background: #FFF1F2;
}
</style>
