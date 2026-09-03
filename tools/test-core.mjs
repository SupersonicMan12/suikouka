import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const core = require('../miniprogram/lib/core.js')

const intent = core.parseIntent('安静工作两小时')
const ranked = core.rank(core.CAFES, intent.axes, intent.filters, intent.weights)
const near = core.rankNear(ranked, { kind: 'pin', lng: 121.4737, lat: 31.2304 })
const top = near.slice(0, 3)

console.log('top3:', top.map((item) => item.cafe.nameZh || item.cafe.name).join(' / '))
top.forEach((item, index) => {
  const detail = core.DETAILS[item.cafe.id]
  console.log(core.narration(item, index, detail))
})

const converted = core.wgs84ToGcj02(121.4737, 31.2304)
console.log('gcj02:', converted.map((value) => value.toFixed(4)).join(','))
if (Math.abs(converted[0] - 121.4783) > 0.002 || Math.abs(converted[1] - 31.2285) > 0.002) {
  throw new Error(`坐标转换偏差过大: ${converted.join(',')}`)
}
