// 推理型模型（要先把话想一遍那种）动不动二三十秒，快速添加这条路径上给到 30 秒已经偏宽
const AI_TIMEOUT_MS = 30000
const MAX_ITEMS = 12
const PRIORITIES = ['high', 'medium', 'low']
const WEEKDAY = ['日', '一', '二', '三', '四', '五', '六']

function pad(value) {
  return String(value).padStart(2, '0')
}

/** 大模型算相对日期全靠这行锚点，少了时区和星期，「下周三」就会算错。 */
function describeNow(now) {
  const d = new Date(now)
  const offset = -d.getTimezoneOffset()
  const sign = offset >= 0 ? '+' : '-'
  const abs = Math.abs(offset)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())} ` +
    `星期${WEEKDAY[d.getDay()]}（本地时区 UTC${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}）`
}

function buildMessages(text, now, tags) {
  const known = (tags || []).filter(Boolean).slice(0, 20)
  return [
    {
      role: 'system',
      content: [
        '你是待办清单的输入解析器。把用户写的一句话整理成 0 到 N 条待办，并且只输出 JSON。',
        '形状：{"items":[{"title":"...","tags":["..."],"priority":"medium","dueDate":"2026-01-05T23:59:59+08:00"}]}',
        '1. title 只留要做的事本身，删掉日期、时间，以及 #标签、结尾的 ! / !! 这类记号；已经被解析成 dueDate 的词（明天、周五、3 天后）不要再留在 title 里。',
        '2. 一句话里说了几件独立的事就拆成几条，每条带自己的截止日。',
        '3. dueDate 按最后给出的当前时间推算，输出带时区偏移的 ISO 8601；只提日期没提钟点就用当天 23:59:59；没有截止时间输出 null。',
        '4. priority 只能取 high、medium、low：出现「务必、马上、赶紧、DDL、今天必须」这类给 high，「有空、顺便、不着急」给 low，其余 medium。',
        `5. tags 给 0 到 3 个短标签，优先复用已有标签：${known.length ? known.join('、') : '（暂无）'}；确实没有合适的再新建两三个字的中文标签。`,
        '6. 认不出任何待办（闲聊、测试串）就输出 {"items":[]}。',
        '不要包 markdown 代码块，不要输出解释。',
        `当前时间：${describeNow(now)}`
      ].join('\n')
    },
    { role: 'user', content: text }
  ]
}

function completionsUrl(baseUrl) {
  const base = String(baseUrl || '').trim().replace(/\/+$/, '')
  return /\/chat\/completions$/i.test(base) ? base : `${base}/chat/completions`
}

function modelsUrl(baseUrl) {
  const base = String(baseUrl || '').trim().replace(/\/+$/, '')
  return /\/models$/i.test(base) ? base : `${base}/models`
}

function extractJson(raw) {
  const text = String(raw || '').trim()
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    return JSON.parse(text.slice(start, end + 1))
  } catch {
    return null
  }
}

function cleanTitle(value) {
  return String(value ?? '')
    .replace(/#/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200)
}

function cleanTags(list) {
  if (!Array.isArray(list)) return []
  const out = []
  for (const item of list) {
    const tag = String(item ?? '').replace(/^#/, '').trim().slice(0, 12)
    if (tag && !out.includes(tag)) out.push(tag)
    if (out.length === 3) break
  }
  return out
}

/** 模型给「下下个周一」时可能算出离谱年份，宁可不带日期也不能显示成 4413 年。 */
function cleanDueDate(value) {
  if (value === null || value === undefined || value === '') return null
  const ms = typeof value === 'number' ? value : Date.parse(String(value))
  if (!Number.isFinite(ms)) return null
  const year = new Date(ms).getFullYear()
  return year >= 1971 && year <= 2099 ? ms : null
}

function normalizeItems(payload) {
  const list = payload && Array.isArray(payload.items) ? payload.items : []
  const out = []
  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    const title = cleanTitle(item.title)
    if (!title) continue
    out.push({
      title,
      tags: cleanTags(item.tags),
      priority: PRIORITIES.includes(item.priority) ? item.priority : 'medium',
      dueDate: cleanDueDate(item.dueDate)
    })
    if (out.length === MAX_ITEMS) break
  }
  return out
}

/** 各家错误体形状不一：OpenAI 是 {error:{message}}，也有套在 detail 里的。 */
function errorDetail(payload) {
  if (!payload || typeof payload !== 'object') return ''
  const nested = payload.detail && payload.detail.error
  return String(
    (payload.error && payload.error.message) ||
    (nested && nested.message) ||
    (payload.detail && typeof payload.detail === 'string' && payload.detail) ||
    payload.msg || payload.message || ''
  ).trim()
}

function providerError(status, detail) {
  const msg = detail ? `：${detail}` : `：HTTP ${status}`
  if (status === 401 || status === 403) return 'API Key 不对或没有调用这个模型的权限'
  if (status === 404) return `接口地址或模型名不对${msg}`
  if (status === 429) return `请求太频繁或余额不够${msg}`
  // 不少网关把「模型不存在」包成 5xx 回上来，只说「暂时不可用」会误导人去查服务器
  if (status >= 500) return `服务商返回 HTTP ${status}${msg}（模型名不存在也常报这个）`
  return detail || `请求失败（HTTP ${status}）`
}

function contentToText(content) {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) return content.map((part) => (typeof part === 'string' ? part : part && part.text) || '').join('')
  return ''
}

/**
 * 故意不发 response_format: json_object —— 各家 OpenAI 兼容端点对这个字段的支持不齐，
 * 报了 400 反而更难排查；提示词已经强约束，脏输出交给 extractJson 兜。
 */
async function aiParse({ baseUrl, model, key, text, now = Date.now(), tags = [] } = {}) {
  const input = String(text || '').trim()
  if (!input) return { ok: true, items: [] }
  if (!String(baseUrl || '').trim()) return { ok: false, error: '还没有填写大模型接口地址' }
  if (!String(model || '').trim()) return { ok: false, error: '还没有填写模型名' }
  if (!key) return { ok: false, error: '还没有保存 API Key' }

  let res
  try {
    res = await fetch(completionsUrl(baseUrl), {
      method: 'POST',
      signal: AbortSignal.timeout(AI_TIMEOUT_MS),
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: String(model).trim(), temperature: 0, messages: buildMessages(input, now, tags) })
    })
  } catch (err) {
    const reason = err && (err.name === 'TimeoutError' || err.name === 'AbortError') ? `超过 ${AI_TIMEOUT_MS / 1000} 秒没响应` : err && err.message
    return { ok: false, error: `连不上大模型：${reason}` }
  }

  const payload = await res.json().catch(() => null)
  if (!res.ok) {
    return { ok: false, error: providerError(res.status, errorDetail(payload)) }
  }

  const content = contentToText(payload && payload.choices && payload.choices[0] && payload.choices[0].message && payload.choices[0].message.content)
  if (!content.trim()) return { ok: false, error: '大模型没有返回内容，可能是模型名不对或不支持这种提示' }
  const parsed = extractJson(content)
  if (!parsed) return { ok: false, error: `大模型返回的不是 JSON：${content.slice(0, 60)}` }
  return { ok: true, items: normalizeItems(parsed), tokens: (payload.usage && payload.usage.total_tokens) || 0 }
}

/** 模型清单：把「慢的那种」标出来并排到后面，快速添加要的是 2 秒出结果。 */
function toModelOption(item) {
  const id = String(item && item.id ? item.id : '').trim()
  if (!id) return null
  const display = String(item.display_name || '').trim()
  const reasoning = !!item.is_reasoning
  const label = `${id}${display && display !== id ? `（${display}）` : ''}${reasoning ? ' · 推理型，会慢' : ''}`
  return { id, label, reasoning }
}

const FASTISH = /flash|turbo|fast|lite|mini|small/i

function sortModelOptions(list) {
  return list.sort((a, b) => {
    if (a.reasoning !== b.reasoning) return a.reasoning ? 1 : -1
    const af = FASTISH.test(a.id) ? 0 : 1
    const bf = FASTISH.test(b.id) ? 0 : 1
    if (af !== bf) return af - bf
    return a.id.localeCompare(b.id)
  })
}

async function aiListModels({ baseUrl, key } = {}) {
  if (!String(baseUrl || '').trim()) return { ok: false, error: '还没有填写接口地址' }
  if (!key) return { ok: false, error: '还没有保存 API Key' }
  let res
  try {
    res = await fetch(modelsUrl(baseUrl), {
      method: 'GET',
      signal: AbortSignal.timeout(15000),
      headers: { Accept: 'application/json', Authorization: `Bearer ${key}` }
    })
  } catch (err) {
    const reason = err && (err.name === 'TimeoutError' || err.name === 'AbortError') ? '超过 15 秒没响应' : err && err.message
    return { ok: false, error: `连不上接口：${reason}` }
  }
  const payload = await res.json().catch(() => null)
  if (!res.ok) return { ok: false, error: providerError(res.status, errorDetail(payload)) }
  const raw = Array.isArray(payload && payload.data) ? payload.data : Array.isArray(payload) ? payload : null
  if (!raw) return { ok: false, error: '这个接口没返回模型清单（不是标准 /models 形状），手填模型名即可' }
  const options = raw.map(toModelOption).filter(Boolean)
  const seen = new Set()
  const unique = options.filter((m) => (seen.has(m.id) ? false : (seen.add(m.id), true)))
  return { ok: true, models: sortModelOptions(unique) }
}

module.exports = { aiParse, aiListModels, normalizeItems, extractJson, describeNow, buildMessages, MAX_ITEMS }
