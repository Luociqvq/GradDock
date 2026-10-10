export function parseNvidiaSmi(stdout) {
  const gpus = []
  for (const line of String(stdout || '').split('\n')) {
    const cols = line.split(',').map((c) => c.trim())
    if (cols.length < 4) continue
    const util = Number(cols[1])
    const used = Number(cols[2])
    const total = Number(cols[3])
    if (!Number.isFinite(util) || !Number.isFinite(total) || total <= 0) continue
    gpus.push({ name: cols[0], util, usedMiB: used, totalMiB: total })
  }
  return gpus
}

/**
 * 探针输出是 `KEY 值…` 行 + 可选 `GPU name, util, used, total` 行，
 * 无 GPU 的机器只有前者，所以不能把 GPU 当成必需项。
 */
export function parseProbe(stdout) {
  const info = { host: '', nproc: 0, load: [], uptimeSec: 0, mem: null, disk: null, gpus: [] }
  for (const raw of String(stdout || '').split('\n')) {
    const line = raw.trim()
    if (!line) continue
    const [key, ...rest] = line.split(/\s+/)
    const value = rest.join(' ')
    if (key === 'GPU') {
      const [gpu] = parseNvidiaSmi(value)
      if (gpu) info.gpus.push(gpu)
    } else if (key === 'HOST') {
      info.host = value
    } else if (key === 'NPROC') {
      info.nproc = Number(rest[0]) || 0
    } else if (key === 'LOAD') {
      info.load = rest.map(Number).filter(Number.isFinite)
    } else if (key === 'UP') {
      info.uptimeSec = Number(rest[0]) || 0
    } else if (key === 'MEM') {
      const [avail, total] = rest.map(Number)
      if (Number.isFinite(total) && total > 0) {
        info.mem = { totalMiB: Math.round(total / 1024), usedMiB: Math.round((total - avail) / 1024), percent: Math.round(((total - avail) / total) * 100) }
      }
    } else if (key === 'DISK') {
      const [total, used] = rest.map(Number)
      if (Number.isFinite(total) && total > 0) {
        info.disk = { totalGiB: +(total / 1048576).toFixed(1), usedGiB: +(used / 1048576).toFixed(1), percent: Math.round((used / total) * 100) }
      }
    }
  }
  return info
}

export function specOf(info) {
  if (!info || !info.nproc || !info.mem) return ''
  return `${info.nproc}H${Math.max(1, Math.round(info.mem.totalMiB / 1024))}G`
}

export function summarize(info) {
  if (!info) return null
  if (info.gpus.length) {
    const total = info.gpus.reduce((acc, g) => acc + g.totalMiB, 0)
    const used = info.gpus.reduce((acc, g) => acc + g.usedMiB, 0)
    return {
      kind: 'gpu',
      count: info.gpus.length,
      busiest: Math.max(...info.gpus.map((g) => g.util)),
      memPercent: Math.round((used / total) * 100),
      memLabel: `${(used / 1024).toFixed(1)} / ${(total / 1024).toFixed(0)} GiB`
    }
  }
  if (info.mem || info.load.length) {
    const cores = info.nproc > 0 ? info.nproc : 0
    const load1 = info.load[0] || 0
    return {
      kind: 'server',
      cores,
      load: load1,
      busiest: cores ? Math.min(100, Math.round((load1 / cores) * 100)) : 0,
      memPercent: info.mem ? info.mem.percent : 0,
      memLabel: info.mem ? `${(info.mem.usedMiB / 1024).toFixed(1)} / ${(info.mem.totalMiB / 1024).toFixed(1)} GiB` : '—'
    }
  }
  return null
}

export function toneOfSummary(summary) {
  if (!summary) return 'idle'
  if (summary.busiest >= 90) return 'hot'
  if (summary.busiest >= 30) return 'busy'
  return 'idle'
}

export function fmtUptime(seconds) {
  if (!seconds) return '—'
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  if (days > 0) return `${days}天${hours}时`
  const mins = Math.floor((seconds % 3600) / 60)
  return `${hours}时${mins}分`
}
