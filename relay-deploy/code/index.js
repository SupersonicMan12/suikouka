/**
 * 随口咖 intent relay — Aliyun Function Compute 3.0, Node.js runtime,
 * HTTP trigger (event-style handler: FC3 delivers the HTTP request as a JSON
 * event and expects {statusCode, headers, body} back).
 */
'use strict'

const SYSTEM = `你是一个上海咖啡馆推荐器的意图解析器。用户会说一句话描述场合和需求（中文或英文）。
把它翻译成五个 0-100 的坐标轴，只输出确实被这句话表达的轴：
- focus: 0=纯聊天社交 100=埋头工作学习
- energy: 0=图书馆般安静 100=热闹喧哗
- linger: 0=买完就走 100=坐一下午
- adventure: 0=经典奶咖 100=猎奇单品手冲
- spend: 0=便宜日常 100=贵但值得
可选 maxPrice: 1(便宜)/2(中等)/3(不限)，仅当用户明确提到预算时输出。
heard: 最多4条，每条 {"en":"...","zh":"..."}，用3-5个词概括你听懂的每个需求。
只输出 JSON，形如 {"axes":{"focus":90},"maxPrice":2,"heard":[{"en":"to get work done","zh":"要专心干活"}]}`

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

const reply = (statusCode, body) => ({
  statusCode,
  headers: { ...CORS, 'Content-Type': 'application/json' },
  body,
})

exports.handler = async (event) => {
  let evt
  try {
    evt = JSON.parse(event.toString())
  } catch {
    evt = {}
  }
  const method = evt.requestContext?.http?.method ?? evt.httpMethod ?? 'POST'
  if (method === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' }
  if (method !== 'POST') return reply(405, '{"error":"POST only"}')

  let text
  try {
    const raw = evt.isBase64Encoded ? Buffer.from(evt.body ?? '', 'base64').toString('utf8') : (evt.body ?? '{}')
    text = JSON.parse(raw).text
  } catch {
    text = undefined
  }
  if (typeof text !== 'string' || text.trim().length === 0 || text.length > 300) {
    return reply(400, '{"error":"text required, \u2264300 chars"}')
  }

  try {
    const upstream = await fetch('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.DASHSCOPE_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'qwen-flash',
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: text },
        ],
      }),
    })
    if (!upstream.ok) throw new Error('upstream ' + upstream.status)
    const data = await upstream.json()
    const content = data.choices?.[0]?.message?.content
    return reply(200, typeof content === 'string' ? content : '{}')
  } catch {
    return reply(502, '{"error":"upstream"}')
  }
}
