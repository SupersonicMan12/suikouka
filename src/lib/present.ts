import { SIGNATURES_ZH } from '../data/signaturesZh'
import { TAG_LABELS } from '../data/tagLabels'
import type { Cafe, Detail } from '../data/types'
import type { NearRanked } from './near'

export const GENERIC_SIGNATURES = new Set([
  'Flat white, no fuss',
  'Espresso at the counter',
  'House-roasted pour-over',
  'Rotating brew bar',
  'Coffee and something from the oven',
])

export const TAG_ORDER = ['mall', 'street', 'takeaway', 'view', 'window', 'outdoor', 'tea', 'decaf', 'food', 'laptop', 'quiet', 'pet', 'late'] as const

export function blurb(c: Cafe, detail: Detail): string {
  if (!GENERIC_SIGNATURES.has(c.signature)) return SIGNATURES_ZH[c.id] ?? c.signature
  if (detail.dishes.length > 0) return `推荐 ${detail.dishes.slice(0, 2).join('、')}`
  return [...detail.tags]
    .sort((a, b) => TAG_ORDER.indexOf(a) - TAG_ORDER.indexOf(b))
    .slice(0, 2)
    .map((tag) => TAG_LABELS[tag])
    .join(' · ')
}

export function narration(r: NearRanked, i: number, detail: Detail): string {
  const c = r.cafe
  const reason = blurb(c, detail)
  return `${['第一家', '第二家', '第三家'][i]}，${c.nameZh || c.name}，步行${r.minutes}分钟${reason ? `，${reason}` : ''}。`
}

export function priceMarks(p: Cafe['price']): string {
  return '¥'.repeat(p)
}

export function formatHour(value: number): string {
  const h = Math.floor(value % 24)
  const m = Math.round((value % 1) * 60)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

export function todayClosing(c: Cafe, detail: Detail): string {
  const day = new Date().getDay()
  return formatHour(detail.hours?.find((hours) => hours.day === day)?.close ?? c.closes)
}
