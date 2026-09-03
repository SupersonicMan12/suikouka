import { intentFromRelayPayload, parseIntent, type Intent } from './intent'

/**
 * Qwen-flash (阿里云百炼) understands the sentence when the rule book doesn't.
 * The API key never ships to the browser: calls go through a tiny relay whose
 * URL is injected at build time. No relay configured → rules only.
 */
const RELAY_URL: string = (import.meta.env.VITE_INTENT_RELAY as string | undefined) ?? ''

export function qwenEnabled(): boolean {
  return RELAY_URL.length > 0
}

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
    return intentFromRelayPayload(await res.json(), transcript)
  } catch {
    return fallback
  }
}
