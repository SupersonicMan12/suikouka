import type { Axes } from '../data/types'
import { currentHour, parseIntent, weightsFor, type Intent } from './intent'
import { EMPTY_FILTERS, NEUTRAL, type Filters } from './match'

/**
 * Qwen-flash (阿里云百炼) understands the sentence when the rule book doesn't.
 * The API key never ships to the browser: calls go through a tiny relay whose
 * URL is injected at build time. No relay configured → rules only.
 */
const RELAY_URL: string = (import.meta.env.VITE_INTENT_RELAY as string | undefined) ?? ''

export function qwenEnabled(): boolean {
  return RELAY_URL.length > 0
}

interface QwenIntentPayload {
  axes?: Partial<Record<keyof Axes, number>>
  maxPrice?: 1 | 2 | 3
  heard?: { en: string; zh: string }[]
}

const AXIS_KEYS: (keyof Axes)[] = ['focus', 'energy', 'linger', 'adventure', 'spend']

/**
 * Ask the relay to parse; fall back to the on-device rules if it is slow,
 * unreachable, or returns nonsense. The reader should never wait on a network
 * hop for more than a moment.
 */
export async function parseWithQwen(transcript: string, timeoutMs = 3500): Promise<Intent> {
  const fallback = parseIntent(transcript)
  if (!qwenEnabled()) return fallback
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeoutMs)
    const res = await fetch(RELAY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: transcript }),
      signal: ctrl.signal,
    })
    clearTimeout(timer)
    if (!res.ok) return fallback
    const data = (await res.json()) as QwenIntentPayload
    if (!data.axes || Object.keys(data.axes).length === 0) return fallback

    const axes: Axes = { ...NEUTRAL }
    const touched = new Set<keyof Axes>()
    for (const k of AXIS_KEYS) {
      const v = data.axes[k]
      if (typeof v === 'number' && v >= 0 && v <= 100) {
        axes[k] = Math.round(v)
        touched.add(k)
      }
    }
    if (touched.size === 0) return fallback

    const filters: Filters = { ...EMPTY_FILTERS, openAt: currentHour() }
    if (data.maxPrice === 1 || data.maxPrice === 2 || data.maxPrice === 3) {
      filters.maxPrice = data.maxPrice
    }
    const weights = weightsFor(touched)
    const heard = Array.isArray(data.heard)
      ? data.heard.filter((h) => typeof h?.en === 'string' && typeof h?.zh === 'string').slice(0, 4)
      : fallback.heard

    return { axes, weights, filters, heard }
  } catch {
    return fallback
  }
}
