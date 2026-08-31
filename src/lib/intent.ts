import type { Axes } from '../data/types'
import { EMPTY_FILTERS, NEUTRAL, type Filters, type Weights } from './match'

/**
 * What one spoken sentence boils down to: where the compass should point,
 * how hard each axis matters, and the practical constraints.
 */
export interface Intent {
  axes: Axes
  weights: Weights
  filters: Filters
  /** Human-readable echo of what was understood, for the confirmation line. */
  heard: { en: string; zh: string }[]
}

interface Rule {
  /** Substrings, matched case-insensitively against the raw transcript. */
  cues: string[]
  axes?: Partial<Axes>
  maxPrice?: 1 | 2 | 3
  heard: { en: string; zh: string }
}

const RULES: Rule[] = [
  {
    cues: ['工作', '办公', '加班', '学习', '写作业', '复习', '备考', '码字', '写代码', 'work', 'study', 'laptop', 'focus', 'deadline', 'writing'],
    axes: { focus: 90, linger: 78, energy: 30 },
    heard: { en: 'to get work done', zh: '要专心干活' },
  },
  {
    cues: ['安静', '清静', '不吵', 'quiet', 'calm', 'peaceful', 'silence'],
    axes: { energy: 15 },
    heard: { en: 'somewhere quiet', zh: '要安静' },
  },
  {
    cues: ['约会', '浪漫', '相亲', 'date', 'romantic', 'anniversary'],
    axes: { energy: 45, linger: 75, adventure: 62, spend: 65, focus: 20 },
    heard: { en: 'a date', zh: '约会' },
  },
  {
    cues: ['聊天', '叙旧', '见朋友', '闺蜜', '朋友', '聚', 'chat', 'catch up', 'friends', 'talk'],
    axes: { focus: 15, energy: 60, linger: 68 },
    heard: { en: 'to talk with someone', zh: '和人聊天' },
  },
  {
    cues: ['热闹', '有气氛', '人多', 'lively', 'buzzy', 'energetic'],
    axes: { energy: 85 },
    heard: { en: 'somewhere lively', zh: '要热闹' },
  },
  {
    cues: ['便宜', '实惠', '穷', '性价比', '别太贵', '不要太贵', 'cheap', 'budget', 'affordable'],
    axes: { spend: 12 },
    maxPrice: 2,
    heard: { en: 'easy on the wallet', zh: '价格实惠' },
  },
  {
    cues: ['精致', '高级', '贵点', '舍得', '犒劳', 'fancy', 'splurge', 'special occasion', 'treat'],
    axes: { spend: 88 },
    heard: { en: 'worth a splurge', zh: '值得花钱' },
  },
  {
    cues: ['手冲', '单品', '特别的', '惊喜', '新奇', '猎奇', '豆子', 'pour over', 'single origin', 'surprise', 'adventurous', 'interesting coffee', 'geisha', '瑰夏'],
    axes: { adventure: 90 },
    heard: { en: 'an adventurous cup', zh: '想喝点特别的' },
  },
  {
    cues: ['拿铁', '经典', '稳妥', '奶咖', 'latte', 'flat white', 'classic', 'reliable'],
    axes: { adventure: 15 },
    heard: { en: 'a classic cup', zh: '经典口味' },
  },
  {
    cues: ['一下午', '坐很久', '久坐', '呆着', '发呆', '看书', '待一天', 'hours', 'all afternoon', 'linger', 'read', 'settle in'],
    axes: { linger: 90 },
    heard: { en: 'to stay a while', zh: '想久坐' },
  },
  {
    cues: ['带走', '外带', '顺路', '赶时间', '快点', 'takeaway', 'take away', 'to go', 'quick', 'grab'],
    axes: { linger: 8 },
    heard: { en: 'in and out', zh: '喝完就走' },
  },
  {
    cues: ['独处', '一个人', '自己待', 'alone', 'by myself', 'me time'],
    axes: { energy: 25, linger: 70 },
    heard: { en: 'time alone', zh: '一个人待着' },
  },
]

/** Axes actually pushed by the sentence weigh 2; the rest fade to 0.6. */
export function parseIntent(transcript: string): Intent {
  const t = transcript.toLowerCase()
  const axes: Axes = { ...NEUTRAL }
  const touched = new Set<keyof Axes>()
  const heard: Intent['heard'] = []
  const filters: Filters = { ...EMPTY_FILTERS, openAt: currentHour() }

  for (const rule of RULES) {
    if (!rule.cues.some((c) => t.includes(c))) continue
    heard.push(rule.heard)
    if (rule.maxPrice) filters.maxPrice = rule.maxPrice
    for (const [k, v] of Object.entries(rule.axes ?? {}) as [keyof Axes, number][]) {
      axes[k] = touched.has(k) ? Math.round((axes[k] + v) / 2) : v
      touched.add(k)
    }
  }

  const weights = weightsFor(touched)

  return { axes, weights, filters, heard }
}

export function weightsFor(touched: ReadonlySet<keyof Axes>): Weights {
  const w = (k: keyof Axes) => (touched.has(k) ? 2 : 0.6)
  return { focus: w('focus'), energy: w('energy'), linger: w('linger'), adventure: w('adventure'), spend: w('spend') }
}

export function currentHour(): number {
  const now = new Date()
  return now.getHours() + now.getMinutes() / 60
}

/** Words that mean "show me another round", not a new request. */
export function isMoreCommand(transcript: string): boolean {
  const t = transcript.toLowerCase().trim()
  return ['换一批', '换一换', '再来', '下一批', '还有吗', 'next', 'more', 'others', 'another'].some((c) =>
    t.includes(c),
  )
}
