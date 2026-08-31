import { useCallback, useEffect, useRef, useState } from 'react'
import './App.css'
import { CAFES } from './data/cafes'
import type { Cafe } from './data/types'
import { isMoreCommand, type Intent } from './lib/intent'
import { rank } from './lib/match'
import { rankNear, type Anchor, type NearRanked } from './lib/near'
import { parseWithQwen } from './lib/qwen'
import { listenOnce, primeVoices, recognitionSupported, speak, stopSpeaking, type ListenHandle } from './lib/voice'

/** 人民广场 — the fallback anchor when the reader keeps their location private. */
const CENTER = { lng: 121.4737, lat: 31.2304 }

type Stage = 'idle' | 'listening' | 'thinking' | 'deck' | 'unsupported'

const ZH = navigator.language.toLowerCase().startsWith('zh')
const SPEECH_LANG = ZH ? 'zh-CN' : 'en-US'

const ORDINALS_ZH = ['第一家', '第二家', '第三家']
const ORDINALS_EN = ['First', 'Second', 'Third']

function narration(r: NearRanked, i: number): string {
  const c = r.cafe
  return ZH
    ? `${ORDINALS_ZH[i]}，${c.nameZh || c.name}，步行${r.minutes}分钟，${c.signature}。`
    : `${ORDINALS_EN[i]}: ${c.name}, a ${r.minutes} minute walk. Known for ${c.signature}.`
}

function priceMarks(p: Cafe['price']): string {
  return '¥'.repeat(p)
}

function closes(c: Cafe): string {
  const h = Math.floor(c.closes % 24)
  const m = Math.round((c.closes % 1) * 60)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

export default function App() {
  const [stage, setStage] = useState<Stage>(() => (recognitionSupported() ? 'idle' : 'unsupported'))
  const [interim, setInterim] = useState('')
  const [intent, setIntent] = useState<Intent | null>(null)
  const [results, setResults] = useState<NearRanked[]>([])
  const [slide, setSlide] = useState(0)
  const [round, setRound] = useState(0)
  const [notice, setNotice] = useState('')
  const anchorRef = useRef<Anchor>({ kind: 'pin', ...CENTER })
  const listenRef = useRef<ListenHandle | null>(null)
  const intentRef = useRef<Intent | null>(null)
  const runRef = useRef(0)

  useEffect(() => {
    primeVoices()
    return () => {
      listenRef.current?.stop()
      stopSpeaking()
    }
  }, [])

  const locate = useCallback(() => {
    if (!('geolocation' in navigator)) return
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        anchorRef.current = { kind: 'me', lng: pos.coords.longitude, lat: pos.coords.latitude }
      },
      () => setNotice(ZH ? '拿不到定位，先从人民广场算起' : 'No location — measuring from People\u2019s Square'),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 120000 },
    )
  }, [])

  const present = useCallback(async (picks: NearRanked[], run: number) => {
    setResults(picks)
    setSlide(0)
    setStage('deck')
    for (let i = 0; i < picks.length; i++) {
      if (runRef.current !== run) return
      setSlide(i)
      await speak(narration(picks[i], i), SPEECH_LANG)
      await new Promise((r) => setTimeout(r, 900))
    }
    if (runRef.current !== run) return
    setSlide(picks.length)
    await speak(ZH ? '再说一句，帮你换一批。' : 'Say another word and I\u2019ll find you more.', SPEECH_LANG)
  }, [])

  const handleTranscript = useCallback(
    async (text: string) => {
      const run = ++runRef.current
      setStage('thinking')
      setInterim(text)
      const more = isMoreCommand(text) && intentRef.current
      const parsed = more ? (intentRef.current as Intent) : await parseWithQwen(text)
      if (runRef.current !== run) return
      intentRef.current = parsed
      setIntent(parsed)
      const nextRound = more ? round + 1 : 0
      setRound(nextRound)
      const ranked = rank(CAFES, parsed.axes, parsed.filters, parsed.weights)
      const near = rankNear(ranked, anchorRef.current)
      const picks = near.slice(nextRound * 3, nextRound * 3 + 3)
      if (picks.length === 0) {
        setNotice(ZH ? '这个条件附近找不到了，换个说法试试' : 'Nothing left nearby for that — try rewording')
        setStage('idle')
        return
      }
      void present(picks, run)
    },
    [present, round],
  )

  const deepLinkDone = useRef(false)
  useEffect(() => {
    if (deepLinkDone.current) return
    deepLinkDone.current = true
    const m = /[#?&]q=([^&]+)/.exec(window.location.hash || window.location.search)
    if (m) setTimeout(() => void handleTranscript(decodeURIComponent(m[1])), 0)
  }, [handleTranscript])

  const startListening = useCallback(() => {
    runRef.current++
    stopSpeaking()
    locate()
    setInterim('')
    setNotice('')
    setStage('listening')
    listenRef.current?.stop()
    listenRef.current = listenOnce(
      SPEECH_LANG,
      setInterim,
      (text) => void handleTranscript(text),
      (err) => {
        setStage('idle')
        if (err === 'no-speech') setNotice(ZH ? '没听清，再点一下试试' : 'Didn\u2019t catch that — tap and try again')
        else if (err === 'not-allowed') setNotice(ZH ? '需要麦克风权限才能听你说' : 'I need microphone permission to listen')
        else setNotice(ZH ? '这台浏览器的语音识别开小差了' : 'Speech recognition hiccuped on this browser')
      },
    )
  }, [handleTranscript, locate])

  if (stage === 'unsupported') {
    return (
      <main className="stage">
        <div className="mark">随口咖</div>
        <p className="tagline">
          {ZH
            ? '这台浏览器不支持语音识别 — 用 iPhone 的 Safari 或系统自带浏览器打开试试。'
            : 'This browser has no speech recognition — try Safari on iPhone or your system browser.'}
        </p>
      </main>
    )
  }

  if (stage === 'deck' && results.length > 0) {
    const done = slide >= results.length
    const r = results[Math.min(slide, results.length - 1)]
    const c = r.cafe
    return (
      <main className="stage deck" onClick={done ? startListening : () => setSlide((s) => Math.min(s + 1, results.length))}>
        {done ? (
          <>
            <div className="mark small">随口咖</div>
            <p className="tagline">{ZH ? '点一下，再说一句' : 'Tap, then say another word'}</p>
            <p className="hint">{ZH ? '说「换一批」看下三家' : 'Say \u201cmore\u201d for the next three'}</p>
          </>
        ) : (
          <article className="slide" key={slide}>
            <div className="ordinal">{ZH ? ORDINALS_ZH[slide] : ORDINALS_EN[slide]}</div>
            <h1 className="cafe-name">{ZH ? c.nameZh || c.name : c.name}</h1>
            <div className="cafe-sub">{ZH ? c.name : c.nameZh}</div>
            <p className="reason">{c.signature}</p>
            <div className="facts">
              <span>{ZH ? `步行 ${r.minutes} 分钟` : `${r.minutes} min walk`}</span>
              <span>{priceMarks(c.price)}</span>
              <span>{ZH ? `开到 ${closes(c)}` : `open till ${closes(c)}`}</span>
            </div>
            <div className="street">{ZH ? c.streetZh : c.street}</div>
            <div className="dots">
              {results.map((_, i) => (
                <i key={i} className={i === slide ? 'on' : ''} />
              ))}
            </div>
          </article>
        )}
      </main>
    )
  }

  return (
    <main className="stage" onClick={stage === 'idle' ? startListening : undefined}>
      <div className={`mark ${stage === 'listening' ? 'breathing' : ''}`}>随口咖</div>
      {stage === 'idle' && (
        <>
          <p className="tagline">{ZH ? '点一下，随口说说你的场合和需求' : 'Tap once, then just say the occasion'}</p>
          <p className="hint">
            {ZH ? '「我想找个安静的地方工作两小时，别太贵」' : '\u201cSomewhere quiet to work for two hours, not too pricey\u201d'}
          </p>
        </>
      )}
      {stage === 'listening' && <p className="tagline live">{interim || (ZH ? '在听……' : 'Listening\u2026')}</p>}
      {stage === 'thinking' && (
        <>
          <p className="tagline">{interim}</p>
          <p className="hint">
            {intent?.heard.map((h) => (ZH ? h.zh : h.en)).join(' · ') || (ZH ? '想想看……' : 'Thinking\u2026')}
          </p>
        </>
      )}
      {notice && <p className="notice">{notice}</p>}
    </main>
  )
}
