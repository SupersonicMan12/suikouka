const core = require('../../lib/core.js')

// 填入已备案 HTTPS 中继域名后启用
const RELAY = ''
const CENTER = { lng: 121.4737, lat: 31.2304 }
const ORDINALS = ['第一家', '第二家', '第三家']

let plugin
let manager

function requestIntent(text) {
  if (!RELAY) return Promise.resolve(core.parseIntent(text))
  return new Promise((resolve) => {
    wx.request({
      url: RELAY,
      method: 'POST',
      data: { text },
      header: { 'content-type': 'application/json' },
      timeout: 3500,
      success: (res) => resolve(core.intentFromRelayPayload(res.data, text)),
      fail: () => resolve(core.parseIntent(text)),
    })
  })
}

function fallbackDetail() {
  return { photos: [], dishes: [], tags: [] }
}

Page({
  data: {
    stage: 'idle',
    interim: '',
    notice: '',
    results: [],
    slide: 0,
    round: 0,
    meterDots: [0, 1, 2],
  },

  onLoad() {
    plugin = requirePlugin('WechatSI')
    manager = plugin.getRecordRecognitionManager()
    this.anchor = { kind: 'pin', ...CENTER }
    this.recordToken = 0
    this.continuationCount = 0
    this.skipResolver = null
    this.audio = null
    this.bindRecognition()
  },

  onUnload() {
    this.stopRecording()
    this.stopAudio()
  },

  bindRecognition() {
    manager.onRecognize = (res) => {
      const session = this.recordSession
      if (!session || session.settled) return
      session.heard = true
      session.interim = (res && res.result) || ''
      this.setData({ interim: session.interim })
      if (session.silenceTimer) clearTimeout(session.silenceTimer)
      session.silenceTimer = setTimeout(() => manager.stop(), 1300)
    }
    manager.onStop = (res) => {
      const session = this.recordSession
      if (!session || session.settled) return
      session.settled = true
      this.clearRecordTimers(session)
      this.recordSession = null
      const text = ((res && res.result) || session.interim || '').trim()
      if (text) session.onText(text)
      else session.onNoSpeech()
    }
    manager.onError = (res) => {
      const session = this.recordSession
      if (!session || session.settled) return
      session.settled = true
      this.clearRecordTimers(session)
      this.recordSession = null
      const code = String(res && (res.retcode ?? res.retCode ?? res.errMsg ?? ''))
      if (code.includes('-30001') || code.includes('-30002') || /permission|auth|denied/i.test(code)) {
        session.onError('permission')
      } else {
        session.onError('no-speech')
      }
    }
  },

  clearRecordTimers(session) {
    if (session.silenceTimer) clearTimeout(session.silenceTimer)
    if (session.noSpeechTimer) clearTimeout(session.noSpeechTimer)
    if (session.continuationTimer) clearTimeout(session.continuationTimer)
  },

  stopRecording() {
    const session = this.recordSession
    if (session) {
      this.clearRecordTimers(session)
      session.settled = true
      this.recordSession = null
    }
    if (manager) manager.stop()
  },

  startRecording(onText, onNoSpeech, onError) {
    this.stopRecording()
    const token = ++this.recordToken
    const session = {
      token,
      interim: '',
      heard: false,
      settled: false,
      onText,
      onNoSpeech,
      onError,
    }
    this.recordSession = session
    session.noSpeechTimer = setTimeout(() => {
      if (this.recordSession === session && !session.heard) manager.stop()
    }, 6000)
    try {
      manager.start({ duration: 15000, lang: 'zh_CN' })
    } catch {
      session.settled = true
      this.recordSession = null
      onError('record')
    }
    return token
  },

  askRecordPermission(onGranted) {
    wx.getSetting({
      success: (res) => {
        if (res.authSetting && res.authSetting['scope.record'] === false) {
          wx.openSetting({
            success: (setting) => {
              if (setting.authSetting && setting.authSetting['scope.record']) onGranted()
              else this.setData({ stage: 'idle', notice: '需要麦克风权限才能听你说' })
            },
          })
        } else {
          onGranted()
        }
      },
      fail: onGranted,
    })
  },

  onStageTap() {
    if (this.data.stage === 'idle' || this.data.stage === 'done') this.startListening()
    else if (this.data.stage === 'deck') this.onDeckTap()
  },

  startListening() {
    this.stopAudio()
    this.continuationCount = 0
    this.setData({ stage: 'listening', interim: '', notice: '' })
    wx.getLocation({
      type: 'wgs84',
      success: (res) => {
        this.anchor = { kind: 'me', lng: res.longitude, lat: res.latitude }
        this.beginInitialRecording()
      },
      fail: () => {
        this.anchor = { kind: 'pin', ...CENTER }
        this.setData({ notice: '拿不到定位，先从人民广场算起' })
        this.beginInitialRecording()
      },
    })
  },

  beginInitialRecording() {
    this.askRecordPermission(() => {
      this.startRecording(
        (text) => this.handleTranscript(text),
        () => this.setData({ stage: 'idle', notice: '没听清，再点一下试试' }),
        (kind) => this.handleRecordError(kind),
      )
    })
  },

  handleRecordError(kind) {
    this.setData({
      stage: 'idle',
      notice: kind === 'permission' ? '需要麦克风权限才能听你说' : '没听清，再点一下试试',
    })
  },

  handleTranscript(text) {
    const destination = core.navCommand(text)
    if (destination !== null && this.data.results.length > destination) {
      const target = this.data.results[destination].cafe
      const [longitude, latitude] = core.wgs84ToGcj02(target.lng, target.lat)
      wx.openLocation({
        latitude,
        longitude,
        name: target.nameZh || target.name,
        address: target.streetZh || target.street,
        scale: 17,
      })
      return
    }
    const more = core.isMoreCommand(text) && this.intent
    this.setData({ stage: 'thinking', interim: text })
    const parsedPromise = more ? Promise.resolve(this.intent) : requestIntent(text)
    parsedPromise.then((parsed) => {
      if (!parsed) return
      if (!more && !parsed.complete && this.continuationCount < 1) {
        this.continuationCount += 1
        this.setData({ stage: 'listening', notice: '接着说……', interim: '' })
        let active = true
        const finishOriginal = () => {
          if (!active) return
          active = false
          this.stopRecording()
          this.intent = parsed
          this.showResults(parsed, this.data.round)
        }
        this.startRecording(
          (next) => {
            if (!active) return
            active = false
            this.handleTranscript(`${text}，${next}`)
          },
          finishOriginal,
          (kind) => {
            if (kind === 'no-speech') finishOriginal()
            else if (active) {
              active = false
              this.handleRecordError(kind)
            }
          },
        )
        const session = this.recordSession
        if (session) session.continuationTimer = setTimeout(finishOriginal, 5000)
        return
      }
      this.intent = parsed
      const nextRound = more ? this.data.round + 1 : 0
      this.setData({ round: nextRound })
      this.showResults(parsed, nextRound)
    })
  },

  showResults(parsed, round) {
    const ranked = core.rank(core.CAFES, parsed.axes, parsed.filters, parsed.weights)
    const picks = core.rankNear(ranked, this.anchor).slice(round * 3, round * 3 + 3)
    if (!picks.length) {
      this.setData({ stage: 'idle', notice: '这个条件附近找不到了，换个说法试试' })
      return
    }
    this.present(picks)
  },

  makeCard(item, index) {
    const cafe = item.cafe
    const detail = core.DETAILS[cafe.id] || fallbackDetail()
    const busy = core.estimateBusy(cafe, detail, new Date())
    const tags = (detail.tags || [])
      .slice()
      .sort((a, b) => core.TAG_ORDER.indexOf(a) - core.TAG_ORDER.indexOf(b))
      .slice(0, 5)
      .map((tag) => core.TAG_LABELS[tag])
    return {
      id: cafe.id,
      ordinal: ORDINALS[index],
      photo: detail.photos && detail.photos[0] ? detail.photos[0] : '',
      name: cafe.nameZh || cafe.name,
      originalName: cafe.nameZh ? cafe.name : '',
      blurb: core.blurb(cafe, detail),
      minutes: item.minutes,
      price: core.priceMarks(cafe.price),
      closing: core.todayClosing(cafe, detail),
      tables: detail.tables || 0,
      busyLabel: busy ? `预估·${busy.label}` : '',
      busyNote: busy ? busy.note : '',
      busyLevel: busy ? busy.level : -1,
      tags,
      dishes: (detail.dishes || []).slice(0, 3),
      dishText: (detail.dishes || []).slice(0, 3).join(' / '),
      street: cafe.streetZh || cafe.street,
    }
  },

  present(picks) {
    const run = (this.runToken || 0) + 1
    this.runToken = run
    const cards = picks.map((item, index) => this.makeCard(item, index))
    this.setData({ results: picks, cards, slide: 0, stage: 'deck' })
    this.presentLoop(picks, cards, run)
  },

  waitSkippable(task) {
    return new Promise((resolve) => {
      let finished = false
      const skip = () => {
        if (finished) return
        finished = true
        if (this.skipResolver === skip) this.skipResolver = null
        resolve(true)
      }
      this.skipResolver = skip
      task.then(() => {
        if (finished) return
        finished = true
        if (this.skipResolver === skip) this.skipResolver = null
        resolve(false)
      })
    })
  },

  presentLoop(picks, cards, run) {
    const loop = async () => {
      for (let index = 0; index < picks.length; index += 1) {
        if (this.runToken !== run) return
        this.setData({ slide: index })
        const skipped = await this.waitSkippable(this.speak(core.narration(picks[index], index, core.DETAILS[picks[index].cafe.id] || fallbackDetail())))
        if (!skipped) await this.waitSkippable(new Promise((resolve) => setTimeout(resolve, 900)))
      }
      if (this.runToken !== run) return
      this.setData({ slide: cards.length, stage: 'done' })
      this.speak('再说一句，帮你换一批。')
    }
    loop()
  },

  speak(text) {
    return new Promise((resolve) => {
      try {
        if (!plugin || text.length > 300) return resolve()
        plugin.textToSpeech({
          lang: 'zh_CN',
          tts: true,
          content: text,
          success: (res) => {
            this.stopAudio()
            this.audio = wx.createInnerAudioContext()
            this.audio.src = res.filename
            this.audio.onEnded(() => resolve())
            this.audio.onError(() => resolve())
            this.audio.play()
          },
          fail: () => resolve(),
        })
      } catch {
        resolve()
      }
    })
  },

  stopAudio() {
    if (this.audio) {
      this.audio.stop()
      this.audio.destroy()
      this.audio = null
    }
  },

  onDeckTap() {
    this.stopAudio()
    if (this.skipResolver) this.skipResolver()
  },
})
