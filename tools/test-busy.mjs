import assert from 'node:assert/strict'
import { estimateBusy } from '../src/lib/busy.ts'

const cafe = (overrides = {}) => ({
  id: 'test',
  name: 'Test',
  nameZh: '测试店',
  district: 'Xuhui',
  hood: 'test',
  street: 'test',
  streetZh: '测试路',
  lat: 31.2,
  lng: 121.4,
  archetype: 'neighborhood',
  axes: { focus: 40, energy: 50, linger: 50, adventure: 40, spend: 40 },
  tags: [],
  signature: 'coffee',
  note: '',
  opens: 8,
  closes: 22,
  seats: 30,
  price: 2,
  ...overrides,
})
const detail = (overrides = {}) => ({ photos: [], dishes: [], tags: [], ...overrides })
assert.equal(estimateBusy(cafe(), detail(), new Date(2026, 7, 9, 23)), null)
assert.equal(estimateBusy(cafe({ seats: 10 }), detail(), new Date(2026, 7, 8, 8, 30)).level, 0)
assert.equal(estimateBusy(cafe(), detail(), new Date(2026, 7, 8, 10)).level, 2)
assert.equal(estimateBusy(cafe(), detail(), new Date(2026, 7, 8, 15)).level, 2)
assert.equal(estimateBusy(cafe(), detail(), new Date(2026, 7, 10, 9)).level, 1)
assert.equal(estimateBusy(cafe({ axes: { focus: 80, energy: 20, linger: 70, adventure: 30, spend: 40 } }), detail({ popularity: 1 }), new Date(2026, 7, 10, 10)).level, 2)
assert.equal(estimateBusy(cafe(), detail({ popularity: 0 }), new Date(2026, 7, 8, 10)).level, 1)
assert.equal(estimateBusy(cafe(), detail({ popularity: 1 }), new Date(2026, 7, 8, 10)).level, 2)
assert.equal(estimateBusy(cafe(), detail({ hours: [{ day: 6, open: 12, close: 16 }] }), new Date(2026, 7, 8, 10)), null)
assert.match(estimateBusy(cafe(), detail(), new Date(2026, 7, 8, 10)).note, /预估/)
console.log('busy assertions: 10 passed')
