/**
 * 随口咖 intent relay — Aliyun Function Compute (FC 3.0, Node.js runtime,
 * HTTP trigger). Same contract as relay-worker.js, hosted inside China so
 * Shanghai users never cross the border for a parse.
 *
 * Deploy (console): 函数计算 3.0 → 创建函数 → Web函数 / HTTP触发器,
 * runtime Node.js 18+, paste this file as index.js, handler `index.handler`,
 * and set environment variable DASHSCOPE_API_KEY.
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

exports.handler = async (req, resp) => {
  for (const [k, v] of Object.entries(CORS)) resp.setHeader(k, v)

  if (req.method === 'OPTIONS') {
    resp.setStatusCode(204)
    resp.send('')
    return
  }
  if (req.method !== 'POST') {
    resp.setStatusCode(405)
    resp.send(JSON.stringify({ error: 'POST only' }))
    return
  }

  let text
  try {
    const body = JSON.parse(req.body ? req.body.toString() : '{}')
    text = body.text
  } catch {
    text = undefined
  }
  if (typeof text !== 'string' || text.trim().length === 0 || text.length > 300) {
    resp.setStatusCode(400)
    resp.send(JSON.stringify({ error: 'text required, ≤300 chars' }))
    return
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
    if (!upstream.ok) {
      resp.setStatusCode(502)
      resp.send(JSON.stringify({ error: 'upstream' }))
      return
    }
    const data = await upstream.json()
    const content = data.choices && data.choices[0] && data.choices[0].message.content
    resp.setHeader('Content-Type', 'application/json')
    resp.setStatusCode(200)
    resp.send(typeof content === 'string' ? content : '{}')
  } catch {
    resp.setStatusCode(502)
    resp.send(JSON.stringify({ error: 'upstream' }))
  }
}
