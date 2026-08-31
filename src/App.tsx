import { useCallback, useEffect, useRef, useState } from 'react'
import './App.css'
import { CAFES } from './data/cafes'
import { SIGNATURES_ZH } from './data/signaturesZh'
import type { Cafe } from './data/types'
import { isMoreCommand, type Intent } from './lib/intent'
import { rank } from './lib/match'
import { rankNear, type Anchor, type NearRanked } from './lib/near'
import { parseWithQwen } from './lib/qwen'
import { listenOnce, primeVoices, recognitionSupported, speak, stopSpeaking, type ListenHandle } from './lib/voice'

/** 人民广场 — the fallback anchor when the reader keeps their location private. */
const CENTER = { lng: 121.4737, lat: 31.2304 }

type Stage = 'idle' | 'listening' | 'thinking' | 'deck' | 'unsupported'

const SPEECH_LANG = 'zh-CN'

const ORDINALS_ZH = ['第一家', '第二家', '第三家']

function signatureZh(c: Cafe): string {
  return SIGNATURES_ZH[c.id] ?? c.signature
}

function narration(r: NearRanked, i: number): string {
  const c = r.cafe
  return `${ORDINALS_ZH[i]}，${c.nameZh || c.name}，步行${r.minutes}分钟，${signatureZh(c)}。`
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
      () => setNotice('拿不到定位，先从人民广场算起'),
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
    await speak('再说一句，帮你换一批。', SPEECH_LANG)
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
        setNotice('这个条件附近找不到了，换个说法试试')
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
        if (err === 'no-speech') setNotice('没听清，再点一下试试')
        else if (err === 'not-allowed') setNotice('需要麦克风权限才能听你说')
        else setNotice('这台浏览器的语音识别开小差了')
      },
    )
  }, [handleTranscript, locate])

  if (stage === 'unsupported') {
    return (
      <main className="stage">
        <div className="mark">随口咖</div>
        <p className="tagline">这台浏览器不支持语音识别 — 用 iPhone 的 Safari 或系统自带浏览器打开试试。</p>
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
            <p className="tagline">点一下，再说一句</p>
            <p className="hint">说「换一批」看下三家</p>
          </>
        ) : (
          <article className="slide" key={slide}>
            <div className="ordinal">{ORDINALS_ZH[slide]}</div>
            <h1 className="cafe-name">{c.nameZh || c.name}</h1>
            <div className="cafe-sub">{c.nameZh ? c.name : ''}</div>
            <p className="reason">{signatureZh(c)}</p>
            <div className="facts">
              <span>{`步行 ${r.minutes} 分钟`}</span>
              <span>{priceMarks(c.price)}</span>
              <span>{`开到 ${closes(c)}`}</span>
            </div>
            <div className="street">{c.streetZh || c.street}</div>
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
          <p className="tagline">点一下，随口说说你的场合和需求</p>
          <p className="hint">「我想找个安静的地方工作两小时，别太贵」</p>
        </>
      )}
      {stage === 'listening' && <p className="tagline live">{interim || '在听……'}</p>}
      {stage === 'thinking' && (
        <>
          <p className="tagline">{interim}</p>
          <p className="hint">
            {intent?.heard.map((h) => h.zh).join(' · ') || '想想看……'}
          </p>
        </>
      )}
      {notice && <p className="notice">{notice}</p>}
    </main>
  )
}
