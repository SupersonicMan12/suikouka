/** Thin wrappers over the Web Speech API — the free, on-device voice stack. */

interface SpeechRecognitionResultEvent {
  results: { [i: number]: { [j: number]: { transcript: string }; isFinal: boolean }; length: number }
  resultIndex: number
}

interface SpeechRecognitionLike {
  lang: string
  continuous: boolean
  interimResults: boolean
  start(): void
  stop(): void
  abort(): void
  onresult: ((e: SpeechRecognitionResultEvent) => void) | null
  onend: (() => void) | null
  onerror: ((e: { error: string }) => void) | null
}

interface RecognitionWindow {
  SpeechRecognition?: new () => SpeechRecognitionLike
  webkitSpeechRecognition?: new () => SpeechRecognitionLike
}

export function recognitionSupported(): boolean {
  const w = window as unknown as RecognitionWindow
  return Boolean(w.SpeechRecognition ?? w.webkitSpeechRecognition)
}

export interface ListenHandle {
  stop(): void
}

/**
 * Listen for one utterance and resolve with its transcript. zh-CN recognizers
 * on both iOS and Android handle the odd embedded English word, which is how
 * Shanghai actually talks.
 */
export function listenOnce(
  lang: string,
  onInterim: (text: string) => void,
  onFinal: (text: string) => void,
  onError: (error: string) => void,
  onActivity?: () => void,
): ListenHandle {
  const w = window as unknown as RecognitionWindow
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition
  if (!Ctor) {
    onError('unsupported')
    return { stop: () => {} }
  }
  const rec = new Ctor()
  rec.lang = lang
  rec.continuous = true
  rec.interimResults = true
  let final = ''
  let interim = ''
  let heardResult = false
  let settled = false
  let silenceTimer: ReturnType<typeof setTimeout> | undefined
  const settle = (error?: string) => {
    if (settled) return
    settled = true
    if (silenceTimer) clearTimeout(silenceTimer)
    rec.stop()
    const transcript = `${final}${interim}`.trim()
    if (transcript) onFinal(transcript)
    else onError(error ?? 'no-speech')
  }
  const armSilence = () => {
    if (silenceTimer) clearTimeout(silenceTimer)
    silenceTimer = setTimeout(() => settle(), 1300)
  }
  const noSpeechTimer = setTimeout(() => {
    if (!heardResult) settle('no-speech')
  }, 6000)
  const hardCapTimer = setTimeout(() => settle(), 15000)
  rec.onresult = (e) => {
    heardResult = true
    onActivity?.()
    interim = ''
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i]
      if (r.isFinal) final += r[0].transcript
      else interim += r[0].transcript
    }
    onInterim(`${final}${interim}`.trim())
    armSilence()
  }
  rec.onend = () => {
    clearTimeout(noSpeechTimer)
    clearTimeout(hardCapTimer)
    if (!settled) {
      settled = true
      if (silenceTimer) clearTimeout(silenceTimer)
      const transcript = `${final}${interim}`.trim()
      if (transcript) onFinal(transcript)
      else onError('no-speech')
    }
  }
  rec.onerror = (e) => {
    clearTimeout(noSpeechTimer)
    clearTimeout(hardCapTimer)
    if (e.error !== 'aborted' && e.error !== 'no-speech') onError(e.error)
  }
  rec.start()
  return {
    stop: () => {
      if (settled) return
      settled = true
      clearTimeout(noSpeechTimer)
      clearTimeout(hardCapTimer)
      if (silenceTimer) clearTimeout(silenceTimer)
      rec.abort()
    },
  }
}

let voiceCache: SpeechSynthesisVoice | null | undefined

function pickVoice(lang: string): SpeechSynthesisVoice | null {
  if (voiceCache !== undefined) return voiceCache
  const voices = window.speechSynthesis.getVoices()
  const exact = voices.filter((v) => v.lang.replace('_', '-').startsWith(lang))
  voiceCache = exact.find((v) => v.localService) ?? exact[0] ?? null
  return voiceCache
}

/** Speak a line and resolve when it finishes (or after a safety timeout). */
export function speak(text: string, lang: string): Promise<void> {
  return new Promise((resolve) => {
    if (!('speechSynthesis' in window)) return resolve()
    const u = new SpeechSynthesisUtterance(text)
    u.lang = lang
    const v = pickVoice(lang)
    if (v) u.voice = v
    u.rate = 0.98
    const timeout = setTimeout(resolve, 1500 + text.length * 350)
    u.onend = () => {
      clearTimeout(timeout)
      resolve()
    }
    u.onerror = () => {
      clearTimeout(timeout)
      resolve()
    }
    window.speechSynthesis.cancel()
    window.speechSynthesis.speak(u)
  })
}

export function stopSpeaking(): void {
  if ('speechSynthesis' in window) window.speechSynthesis.cancel()
}

/** Warm the voice list — some browsers populate it asynchronously. */
export function primeVoices(): void {
  if (!('speechSynthesis' in window)) return
  window.speechSynthesis.getVoices()
  window.speechSynthesis.onvoiceschanged = () => {
    voiceCache = undefined
  }
}
