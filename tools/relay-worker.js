/**
 * 随口咖 intent relay — a single-file Cloudflare Worker (or any fetch-shaped
 * runtime). Keeps the DashScope key server-side and turns one spoken sentence
 * into compass axes.
 *
 * Deploy:  wrangler deploy tools/relay-worker.js --name suikouka-relay
 * Secret:  wrangler secret put DASHSCOPE_API_KEY
 * Then build the app with VITE_INTENT_RELAY=https://<worker-url>
 */

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

export default {
  async fetch(request, env) {
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    }
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors })
    if (request.method !== 'POST') return new Response('POST only', { status: 405, headers: cors })

    const { text } = await request.json()
    if (typeof text !== 'string' || !text.trim() || text.length > 300) {
      return new Response(JSON.stringify({ error: 'bad text' }), { status: 400, headers: cors })
    }

    const res = await fetch('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.DASHSCOPE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'qwen-flash',
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: text.trim() },
        ],
      }),
    })
    if (!res.ok) return new Response(JSON.stringify({ error: 'upstream' }), { status: 502, headers: cors })
    const data = await res.json()
    const content = data.choices?.[0]?.message?.content ?? '{}'
    return new Response(content, {
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  },
}
