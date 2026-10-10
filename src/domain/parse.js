const TAG_RE = /#([\p{L}\p{N}_-]+)/gu
const PRIO_RE = /(!{1,3})$/

const DAY_WORDS = { 今天: 0, 明天: 1, 后天: 2, 大后天: 3 }
const WEEK = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 0, 天: 0 }

export function parseQuickAdd(raw, now = Date.now()) {
  let text = String(raw || '').trim()
  const tags = []
  text = text.replace(TAG_RE, (_m, tag) => {
    tags.push(tag)
    return ' '
  })

  let priority = 'medium'
  const prio = text.match(PRIO_RE)
  if (prio) {
    priority = prio[1].length >= 2 ? 'high' : 'low'
    text = text.replace(PRIO_RE, '').trim()
  }

  let dueDate = null
  const dayWord = text.match(/(今天|明天|后天|大后天)/)
  if (dayWord) {
    dueDate = endOf(dayOffset(dayWord[1], now))
    text = text.replace(dayWord[1], ' ')
  }
  const afterN = text.match(/(\d+)\s*(天后|小时后|分钟后)/)
  if (afterN && !dueDate) {
    const n = Number(afterN[1])
    dueDate = afterN[2] === '天后' ? endOf(now + n * 86400000) : now + n * (afterN[2] === '小时后' ? 3600000 : 60000)
    text = text.replace(afterN[0], ' ')
  }
  const weekMatch = text.match(/(?:周|星期)([一二三四五六日天])/)
  if (weekMatch && !dueDate) {
    dueDate = endOf(nextWeekday(weekMatch[1], now))
    text = text.replace(weekMatch[0], ' ')
  }
  const md = text.match(/(\d{1,2})[/月](\d{1,2})日?/)
  if (md && !dueDate) {
    const d = new Date(now)
    d.setMonth(Number(md[1]) - 1, Number(md[2]))
    d.setHours(23, 59, 59, 0)
    dueDate = d.getTime()
    text = text.replace(md[0], ' ')
  }

  return {
    title: text.replace(/\s+/g, ' ').trim(),
    tags,
    priority,
    dueDate
  }
}

function dayOffset(word, now) {
  const base = new Date(now)
  base.setDate(base.getDate() + DAY_WORDS[word])
  return base.getTime()
}

function nextWeekday(symbol, now) {
  const target = WEEK[symbol]
  const base = new Date(now)
  const diff = (target - base.getDay() + 7) % 7 || 7
  base.setDate(base.getDate() + diff)
  return base.getTime()
}

function endOf(ts) {
  const d = new Date(ts)
  d.setHours(23, 59, 59, 0)
  return d.getTime()
}
