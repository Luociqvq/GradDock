const { contextBridge, ipcRenderer } = require('electron')

const listeners = new Map()

contextBridge.exposeInMainWorld('gradDock', {
  isDesktop: true,
  readStore: () => ipcRenderer.invoke('store:read'),
  writeStore: (data) => ipcRenderer.invoke('store:write', data),
  appInfo: () => ipcRenderer.invoke('app:info'),
  probeLab: (targets) => ipcRenderer.invoke('lab:probe', targets),
  resetLab: (id) => ipcRenderer.send('lab:reset', id),
  pickFolder: () => ipcRenderer.invoke('backup:pick'),
  runBackup: (job, node) => ipcRenderer.invoke('backup:run', { job, node }),
  backupStatus: (job, node) => ipcRenderer.invoke('backup:status', { job, node }),
  watchBackups: (jobs, node) => ipcRenderer.send('backup:watch', { jobs, node }),
  onBackupState: (handler) => ipcRenderer.on('backup:state', (_e, payload) => handler(payload)),
  onBackupProgress: (handler) => ipcRenderer.on('backup:progress', (_e, payload) => handler(payload)),
  setSecret: (id, password) => ipcRenderer.invoke('secret:set', { id, password }),
  hasSecret: (id) => ipcRenderer.invoke('secret:has', id),
  deleteSecret: (id) => ipcRenderer.invoke('secret:delete', id),
  setMode: (mode) => ipcRenderer.send('win:mode', mode),
  cursorInside: () => ipcRenderer.invoke('win:cursor-inside'),
  showWidgetMenu: () => ipcRenderer.send('win:widget-menu'),
  cloudStatus: () => ipcRenderer.invoke('cloud:status'),
  cloudLogin: (item) => ipcRenderer.invoke('cloud:login', item),
  cloudLogout: () => ipcRenderer.invoke('cloud:logout'),
  cloudPull: () => ipcRenderer.invoke('cloud:pull'),
  cloudCreate: (input) => ipcRenderer.invoke('cloud:create', input),
  cloudUpdate: (remoteId, patch) => ipcRenderer.invoke('cloud:update', { remoteId, patch }),
  cloudToggle: (remoteId) => ipcRenderer.invoke('cloud:toggle', { remoteId }),
  cloudRemove: (remoteId) => ipcRenderer.invoke('cloud:remove', { remoteId }),
  aiStatus: () => ipcRenderer.invoke('ai:status'),
  aiModels: () => ipcRenderer.invoke('ai:models'),
  aiSetKey: (key) => ipcRenderer.invoke('ai:set-key', key),
  aiParse: (text, now) => ipcRenderer.invoke('ai:parse', { text, now }),
  hide: () => ipcRenderer.send('win:hide'),
  quit: () => ipcRenderer.send('win:quit'),
  setTopmost: (on) => ipcRenderer.send('win:topmost', on),
  focus: () => ipcRenderer.send('win:focus'),
  dragStart: () => ipcRenderer.send('win:drag-start'),
  dragStop: () => ipcRenderer.send('win:drag-stop'),
  setTrayIcon: (dataUrl) => ipcRenderer.send('tray:icon', dataUrl),
  notify: (item) => ipcRenderer.send('notify:show', item),
  on: (channel, handler) => {
    const wrapped = (_e, payload) => handler(payload)
    listeners.set(handler, wrapped)
    ipcRenderer.on(channel, wrapped)
  },
  off: (channel, handler) => {
    const wrapped = listeners.get(handler)
    if (wrapped) {
      ipcRenderer.removeListener(channel, wrapped)
      listeners.delete(handler)
    }
  }
})
