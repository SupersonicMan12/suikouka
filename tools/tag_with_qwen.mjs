import fs from 'node:fs/promises'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const SOURCE = path.join(ROOT, 'src/data/cafes.ts')
const AMAP = path.join(ROOT, 'tools/cache/amap-detail')
const DP = path.join(ROOT, 'tools/cache/dianping')
const OUT = path.join(ROOT, 'tools/cache/tags.json')
const ENDPOINT = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions'
const TAGS = ['view', 'window', 'street', 'mall', 'takeaway', 'decaf', 'tea', 'food', 'outdoor', 'laptop', 'quiet', 'pet', 'late']
const SYSTEM = '你是上海咖啡馆数据标注员。根据给出的每家店信息，判断它符合哪些标签，只在有依据（描述、地址、菜品、类型）时打标签，不确定就不打。标签键只能来自：view,window,street,mall,takeaway,decaf,tea,food,outdoor,laptop,quiet,pet,late。规则：地址或名称含“广场/中心/商场/Mall/大厦/百货/购物”→ mall，否则若明确是路边门店→ street（两者互斥）；菜品含茶/抹茶/乌龙/红茶→ tea；含 decaf/低因/无咖啡因/热巧/果汁/气泡→ decaf；含面包/可颂/三明治/早午餐/甜品/蛋糕/餐→ food；描述含外带/站喝/无座→ takeaway；关店时间≥22点→ late。输出 JSON：{"<id>":["tag",...],...}'

function field(body, pattern, fallback = '') {
  const match = body.match(pattern)
  return match?.[1] ?? match?.[2] ?? fallback
}

function parseCafes(source) {
  const result = []
  for (const chunk of source.split('\n  {\n    id: ').slice(1)) {
    const [header] = chunk.split('\n  },', 2)
    const body = header
    const id = header.match(/^'([^']+)',\n/)?.[1]
    if (!id) continue
    result.push({
      id,
      name: field(body, /name:\s*(?:'([^']*)'|"([^"]*)")/),
      nameZh: field(body, /nameZh:\s*(?:'([^']*)'|"([^"]*)")/),
      archetype: field(body, /archetype:\s*'([^']*)'/),
      tags: [...body.matchAll(/tags:\s*\[([^\]]*)\]/g)][0]?.[1].replaceAll(/['\s]/g, '') ?? '',
      signature: field(body, /signature:\s*(?:'([^']*)'|"([^"]*)")/),
      note: field(body, /note:\s*(?:'([^']*)'|"([^"]*)")/),
      seats: field(body, /seats:\s*(\d+)/, '0'),
      price: field(body, /price:\s*(\d+)/, '0'),
      amap: field(body, /amap:\s*\{\s*id:\s*'([^']+)'/),
      closes: field(body, /closes:\s*([\d.]+)/, '0'),
    })
  }
  return result
}

async function readJson(file) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')) } catch { return null }
}

async function main() {
  const key = process.env.DASHSCOPE_API_KEY
  if (!key) throw new Error('DASHSCOPE_API_KEY is required')
  const cafes = parseCafes(await fs.readFile(SOURCE, 'utf8'))
  const cache = (await readJson(OUT)) ?? {}
  const inputs = []
  for (const cafe of cafes) {
    if (Array.isArray(cache[cafe.id])) continue
    const amap = await readJson(path.join(AMAP, `${cafe.id}.json`))
    const dp = await readJson(path.join(DP, `${cafe.id}.json`))
    inputs.push({
      id: cafe.id,
      nameZh: cafe.nameZh,
      name: cafe.name,
      archetype: cafe.archetype,
      tags: cafe.tags,
      signature: cafe.signature,
      note: cafe.note,
      amap: amap ? { type: amap.type, address: amap.address, business_area: amap.business_area, dishes: amap.tag } : {},
      dianpingDishes: dp?.dishes ?? [],
      seats: Number(cafe.seats),
      price: Number(cafe.price),
      closes: Number(cafe.closes),
    })
  }
  for (let offset = 0; offset < inputs.length; offset += 20) {
    const batch = inputs.slice(offset, offset + 20)
    let parsed = null
    for (let attempt = 0; attempt < 3 && !parsed; attempt++) {
      try {
        const response = await fetch(ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
          body: JSON.stringify({
            model: 'qwen-flash',
            response_format: { type: 'json_object' },
            messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: JSON.stringify(batch) }],
          }),
        })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const data = await response.json()
        parsed = JSON.parse(data.choices?.[0]?.message?.content ?? '{}')
      } catch (error) {
        console.error(`batch ${offset}-${offset + batch.length}: attempt ${attempt + 1}`, error.message)
        await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)))
      }
    }
    for (const cafe of batch) {
      const tags = Array.isArray(parsed?.[cafe.id]) ? parsed[cafe.id].filter((tag) => TAGS.includes(tag)) : []
      cache[cafe.id] = [...new Set(tags)]
    }
    await fs.mkdir(path.dirname(OUT), { recursive: true })
    await fs.writeFile(OUT, `${JSON.stringify(cache, null, 2)}\n`)
    console.log(`classified ${Math.min(offset + 20, inputs.length)}/${inputs.length}`)
  }
  console.log(`tags classified=${Object.keys(cache).length}`)
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
