export const DAY = 86400000

export function startOfDay(ts) {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

export function daysFromToday(ts, now = Date.now()) {
  return Math.round((startOfDay(ts) - startOfDay(now)) / DAY)
}

const WEEKDAY = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

export function weekdayCn(ts) {
  return WEEKDAY[new Date(ts).getDay()]
}

export function fmtClock(ts) {
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export function fmtDateCn(ts) {
  const d = new Date(ts)
  return `${d.getMonth() + 1}月${d.getDate()}日`
}

export function dueMeta(ts, now = Date.now()) {
  if (!ts) return { label: '无截止', tone: 'none', rank: 9, overdue: false }
  const diff = daysFromToday(ts, now)
  if (diff < 0) return { label: `逾期 ${-diff} 天`, tone: 'danger', rank: 0, overdue: true }
  if (diff === 0) return { label: '今天', tone: 'urgent', rank: 1, overdue: false }
  if (diff === 1) return { label: '明天', tone: 'urgent', rank: 2, overdue: false }
  if (diff <= 3) return { label: `${diff} 天`, tone: 'warn', rank: 3, overdue: false }
  return { label: `${diff} 天`, tone: 'calm', rank: 4, overdue: false }
}

export const TONE_CLASS = {
  danger: 'bg-rose-50 text-rose-600 ring-rose-200',
  urgent: 'bg-orange-50 text-orange-600 ring-orange-200',
  warn: 'bg-amber-50 text-amber-600 ring-amber-200',
  calm: 'bg-sky-50 text-sky-600 ring-sky-200',
  none: 'bg-slate-100 text-slate-500 ring-slate-200'
}

export const TONE_DOT = {
  danger: 'bg-rose-500',
  urgent: 'bg-orange-500',
  warn: 'bg-amber-400',
  calm: 'bg-sky-500',
  none: 'bg-slate-300'
}

export function humanCountdown(ms, now = Date.now()) {
  const delta = ms - now
  if (delta <= 0) return '进行中'
  const totalMinutes = Math.floor(delta / 60000)
  const days = Math.floor(totalMinutes / 1440)
  const hours = Math.floor((totalMinutes % 1440) / 60)
  const minutes = totalMinutes % 60
  if (days > 0) return `${days} 天 ${hours} 小时后`
  if (hours > 0) return `${hours} 小时 ${minutes} 分后`
  return `${minutes} 分钟后`
}

export function dayKey(ts) {
  const d = new Date(ts)
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
}
