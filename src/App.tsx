import { useCallback, useEffect, useRef, useState } from 'react'
import './App.css'
import { CAFES } from './data/cafes'
import { DETAILS } from './data/details'
import { SIGNATURES_ZH } from './data/signaturesZh'
import { TAG_LABELS } from './data/tagLabels'
import type { Cafe, Detail } from './data/types'
import { estimateBusy } from './lib/busy'
import { isMoreCommand, navCommand, type Intent } from './lib/intent'
import { rank } from './lib/match'
import { rankNear, type Anchor, type NearRanked } from './lib/near'
import { parseWithQwen } from './lib/qwen'
import { listenOnce, primeVoices, recognitionSupported, speak, stopSpeaking, type ListenHandle } from './lib/voice'

/** 人民广场 — the fallback anchor when the reader keeps their location private. */
const CENTER = { lng: 121.4737, lat: 31.2304 }

type Stage = 'idle' | 'listening' | 'thinking' | 'deck' | 'unsupported'

const SPEECH_LANG = 'zh-CN'

const ORDINALS_ZH = ['第一家', '第二家', '第三家']
const GENERIC_SIGNATURES = new Set([
  'Flat white, no fuss',
  'Espresso at the counter',
  'House-roasted pour-over',
  'Rotating brew bar',
  'Coffee and something from the oven',
])
const TAG_ORDER = ['mall', 'street', 'takeaway', 'view', 'window', 'outdoor', 'tea', 'decaf', 'food', 'laptop', 'quiet', 'pet', 'late'] as const

function blurb(c: Cafe, detail: Detail): string {
  if (!GENERIC_SIGNATURES.has(c.signature)) return SIGNATURES_ZH[c.id] ?? c.signature
  if (detail.dishes.length > 0) return `推荐 ${detail.dishes.slice(0, 2).join('、')}`
  return [...detail.tags]
    .sort((a, b) => TAG_ORDER.indexOf(a) - TAG_ORDER.indexOf(b))
    .slice(0, 2)
    .map((tag) => TAG_LABELS[tag])
    .join(' · ')
}

function narration(r: NearRanked, i: number, detail: Detail): string {
  const c = r.cafe
  const reason = blurb(c, detail)
  return `${ORDINALS_ZH[i]}，${c.nameZh || c.name}，步行${r.minutes}分钟${reason ? `，${reason}` : ''}。`
}

function priceMarks(p: Cafe['price']): string {
  return '¥'.repeat(p)
}

function formatHour(value: number): string {
  const h = Math.floor(value % 24)
  const m = Math.round((value % 1) * 60)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

function todayClosing(c: Cafe, detail: Detail): string {
  const day = new Date().getDay()
  return formatHour(detail.hours?.find((hours) => hours.day === day)?.close ?? c.closes)
}

export default function App() {
  const [stage, setStage] = useState<Stage>(() => (recognitionSupported() ? 'idle' : 'unsupported'))
  const [interim, setInterim] = useState('')
  const [intent, setIntent] = useState<Intent | null>(null)
  const [results, setResults] = useState<NearRanked[]>([])
  const [slide, setSlide] = useState(0)
  const [round, setRound] = useState(0)
  const [notice, setNotice] = useState('')
  const [activity, setActivity] = useState(false)
  const anchorRef = useRef<Anchor>({ kind: 'pin', ...CENTER })
  const listenRef = useRef<ListenHandle | null>(null)
  const intentRef = useRef<Intent | null>(null)
  const runRef = useRef(0)
  const continuationCountRef = useRef(0)
  const handleTranscriptRef = useRef<((text: string) => Promise<void>) | null>(null)
  const continuationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const activityTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const skipRef = useRef<(() => void) | null>(null)
  const pinnedRef = useRef(false)

  useEffect(() => {
    primeVoices()
    return () => {
      listenRef.current?.stop()
      if (continuationTimerRef.current) clearTimeout(continuationTimerRef.current)
      if (activityTimerRef.current) clearTimeout(activityTimerRef.current)
      stopSpeaking()
    }
  }, [])

  const locate = useCallback(() => {
    if (pinnedRef.current) return
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
    for (const pick of picks) {
      const photo = DETAILS[pick.cafe.id]?.photos[0]
      if (photo) new Image().src = photo
    }
    setSlide(0)
    setStage('deck')
    for (let i = 0; i < picks.length; i++) {
      if (runRef.current !== run) return
      setSlide(i)
      const detail = DETAILS[picks[i].cafe.id] ?? { photos: [], dishes: [], tags: [] }
      const wait = (task: Promise<void>) => new Promise<boolean>((resolve) => {
        let finished = false
        const finish = (skipped: boolean) => {
          if (finished) return
          finished = true
          if (skipRef.current === skip) skipRef.current = null
          resolve(skipped)
        }
        const skip = () => finish(true)
        skipRef.current = skip
        void task.then(() => finish(false))
      })
      const skipped = await wait(speak(narration(picks[i], i, detail), SPEECH_LANG))
      if (!skipped) await wait(new Promise<void>((resolve) => setTimeout(resolve, 900)))
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
      const destination = navCommand(text)
      if (destination !== null && results.length > destination) {
        const target = results[destination].cafe
        window.location.href = `https://uri.amap.com/navigation?to=${target.lng},${target.lat},${encodeURIComponent(target.nameZh || target.name)}&mode=walk&src=suikouka`
        return
      }
      const more = isMoreCommand(text) && intentRef.current
      const parsed = more ? (intentRef.current as Intent) : await parseWithQwen(text)
      if (runRef.current !== run) return
      if (!more && !parsed.complete && continuationCountRef.current < 1) {
        continuationCountRef.current += 1
        setNotice('接着说……')
        setStage('listening')
        listenRef.current?.stop()
        const continuationRun = run
        let active = true
        const finishOriginal = () => {
          if (!active || runRef.current !== continuationRun) return
          active = false
          if (continuationTimerRef.current) clearTimeout(continuationTimerRef.current)
          listenRef.current?.stop()
          intentRef.current = parsed
          setIntent(parsed)
          const ranked = rank(CAFES, parsed.axes, parsed.filters, parsed.weights)
          const picks = rankNear(ranked, anchorRef.current).slice(0, 3)
          if (picks.length > 0) void present(picks, continuationRun)
        }
        listenRef.current = listenOnce(
          SPEECH_LANG,
          setInterim,
          (next) => {
            if (!active) return
            active = false
            if (continuationTimerRef.current) clearTimeout(continuationTimerRef.current)
            void handleTranscriptRef.current?.(`${text}，${next}`)
          },
          (err) => {
            if (err === 'no-speech') finishOriginal()
            else if (active) {
              active = false
              setStage('idle')
              setNotice('这台浏览器的语音识别开小差了')
            }
          },
          () => {
            setActivity(true)
            if (activityTimerRef.current) clearTimeout(activityTimerRef.current)
            activityTimerRef.current = setTimeout(() => setActivity(false), 400)
          },
        )
        continuationTimerRef.current = setTimeout(finishOriginal, 5000)
        return
      }
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
    [present, results, round],
  )
  useEffect(() => {
    handleTranscriptRef.current = handleTranscript
  }, [handleTranscript])

  const deepLinkDone = useRef(false)
  useEffect(() => {
    if (deepLinkDone.current) return
    deepLinkDone.current = true
    const query = `${window.location.search}${window.location.hash}`
    const at = /[#?&]at=(-?[\d.]+),(-?[\d.]+)/.exec(query)
    if (at) {
      pinnedRef.current = true
      anchorRef.current = { kind: 'pin', lat: Number(at[1]), lng: Number(at[2]) }
      setNotice(`定位已设为 ${at[1]}, ${at[2]}`)
    }
    const m = /[#?&]q=([^&]+)/.exec(query)
    if (m) setTimeout(() => void handleTranscript(decodeURIComponent(m[1])), 0)
  }, [handleTranscript])

  const startListening = useCallback(() => {
    runRef.current++
    stopSpeaking()
    locate()
    setInterim('')
    setNotice('')
    continuationCountRef.current = 0
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
      () => {
        setActivity(true)
        if (activityTimerRef.current) clearTimeout(activityTimerRef.current)
        activityTimerRef.current = setTimeout(() => setActivity(false), 400)
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
      <main className="stage deck" onClick={done ? startListening : () => {
        stopSpeaking()
        skipRef.current?.()
      }}>
        {done ? (
          <>
            <div className="mark small">随口咖</div>
            <p className="tagline">点一下，再说一句</p>
            <p className="hint">说「换一批」看下三家</p>
            <p className="hint">说「导航第二家」可以直接去</p>
          </>
        ) : (
          <article className="slide" key={slide}>
            <div className="ordinal">{ORDINALS_ZH[slide]}</div>
            <div className="photo-block">
              {DETAILS[c.id]?.photos[0] ? (
                <img src={DETAILS[c.id].photos[0]} alt="" referrerPolicy="no-referrer" />
              ) : (
                <svg viewBox="0 0 160 120" role="img" aria-label="咖啡杯占位">
                  <path d="M45 43h60v32c0 16-12 26-30 26S45 91 45 75z" />
                  <path d="M105 52h12c12 0 16 8 12 17-3 7-9 10-24 10M39 104h81" />
                  <path d="M61 30c-5-8 7-10 2-19M81 30c-5-8 7-10 2-19" />
                </svg>
              )}
            </div>
            <h1 className="cafe-name">{c.nameZh || c.name}</h1>
            <div className="cafe-sub">{c.nameZh ? c.name : ''}</div>
            {(() => {
              const detail = DETAILS[c.id] ?? { photos: [], dishes: [], tags: [] }
              const reason = blurb(c, detail)
              const busy = estimateBusy(c, detail, new Date())
              const tags = [...detail.tags].sort((a, b) => TAG_ORDER.indexOf(a) - TAG_ORDER.indexOf(b)).slice(0, 5)
              return (
                <>
                  {reason ? <p className="reason">{reason}</p> : null}
                  <div className="facts">
                    <span>{`步行 ${r.minutes} 分钟`}</span>
                    <span>{priceMarks(c.price)}</span>
                    <span>{`开到 ${todayClosing(c, detail)}`}</span>
                    {detail.tables ? <span>{`约 ${detail.tables} 桌`}</span> : null}
                  </div>
                  {busy ? (
                    <div className="busy">
                      <span>预估·{busy.label}</span>
                      <span className="busy-meter" aria-label={busy.label}>
                        {[0, 1, 2].map((dot) => <i key={dot} className={dot <= busy.level ? 'filled' : ''} />)}
                      </span>
                      <small>{busy.note}</small>
                    </div>
                  ) : null}
                  {tags.length > 0 ? <div className="tag-pills">{tags.map((tag) => <span key={tag}>{TAG_LABELS[tag]}</span>)}</div> : null}
                  {detail.dishes.length > 0 ? <div className="dishes">推荐：{detail.dishes.slice(0, 3).join(' / ')}</div> : null}
                </>
              )
            })()}
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
      <div className={`mark ${stage === 'listening' ? 'breathing' : ''} ${activity ? 'active' : ''}`}>随口咖</div>
      {stage === 'idle' && (
        <>
          <p className="tagline">点一下，随口说说你的场合和需求</p>
          <p className="hint">「我想找个安静的地方工作两小时，别太贵」</p>
        </>
      )}
      {stage === 'listening' && (
        <>
          <p className="tagline live">{interim || '在听……'}</p>
          <p className="hint">说完停一下，我就开始找</p>
        </>
      )}
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
