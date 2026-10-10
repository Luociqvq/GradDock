import { DAY, startOfDay } from './time.js'

export function upcomingSchedules(templates, now = Date.now(), horizonDays = 14) {
  const out = []
  const base = startOfDay(now)
  for (const tpl of templates || []) {
    if (!tpl || tpl.enabled === false) continue
    const [hh, mm] = String(tpl.time || '09:00').split(':').map(Number)
    if (!Number.isFinite(hh)) continue
    for (let offset = 0; offset < horizonDays; offset += 1) {
      const day = new Date(base + offset * DAY)
      if (day.getDay() !== Number(tpl.weekday)) continue
      const start = day.getTime() + (hh * 60 + (mm || 0)) * 60000
      const end = start + Number(tpl.duration || 60) * 60000
      if (end < now) continue
      out.push({
        ...tpl,
        instanceKey: `${tpl.id}@${start}`,
        start,
        end,
        finished: end < now
      })
      break
    }
  }
  return out.sort((a, b) => a.start - b.start)
}

export function todaySchedules(templates, now = Date.now()) {
  const day = startOfDay(now)
  return upcomingSchedules(templates, now, 1)
    .filter((s) => s.start >= day && s.start < day + DAY)
    .sort((a, b) => a.start - b.start)
}
