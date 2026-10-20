const TAG_RE = /#([\p{L}\p{N}_-]+)/gu
const PRIO_RE = /(!{1,3})$/

const DAY_WORDS = { 今天: 0, 明天: 1, 后天: 2, 大后天: 3 }
const WEEK = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 0, 天: 0 }

/**
 * 规则解析完还剩下来的时间线索 —— 说明这句话里有规则看不懂的说法。
 * 刻意按词来匹配，不单独匹配「周/月/日」这类字，否则「写周报」也会被拖去联网。
 */
const LEFTOVER_TIME_RE = [
  '(?:下|上|本|这)周', '周[一二三四五六日天]', '星期[一二三四五六日天]', '周末', '周[一二三四五六日天][以之]?前',
  '\\d+\\s*月', '(?:上|下|这)个?月', '月[底初终中]', '\\d+\\s*[号日]',
  '\\d+\\s*[点时]', '半[点钟]', '凌晨', '清早', '早上', '上午', '中午', '下午', '傍晚', '晚上', '夜里?', '今晚', '明早', '明晚', '后晚',
  '[之以]后', '[之以]前', '以内', '过后', '之前', '以前', '截止', 'DDL', 'ddl',
  '马上', '立刻', '尽快', '赶紧', '优先', '急',
  '考完', '考过', '答辩', '结题', '交完', '做完', '跑完', '假期?', '下班', '课间'
].join('|')

const MULTI_CLAUSE_RE = /[，,；;、]|然后|另外|还有|顺便|并且|同时|再(?:去|把|看|交|跑|买|写|弄|约)/
const LEFTOVER_TIME = new RegExp(LEFTOVER_TIME_RE, 'i')

/** 规则能吃下的（#标签、结尾 !、明天、周五、3 天后、M/D）就不必联网。 */
export function needsAi(raw, parsed) {
  const text = String(raw || '').trim()
  if (!text) return false
  if (MULTI_CLAUSE_RE.test(text)) return true
  return LEFTOVER_TIME.test(parsed && parsed.title ? parsed.title : text)
}

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
  // 「下周五」不能被当成这周五，留给大模型；没开大模型时宁可没有日期
  const weekMatch = text.match(/(?<![下上本这])(?:周|星期)([一二三四五六日天])/)
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
