import type { Cafe, Detail } from '../data/types'

export type BusyEstimate = { level: 0 | 1 | 2; label: '空' | '适中' | '挤'; note: string }

function hourFor(now: Date): number {
  return now.getHours() + now.getMinutes() / 60
}

function peakCurve(hour: number, start: number, end: number, peak: number, baseline: number): number {
  if (hour < start - 1 || hour > end + 1) return baseline
  if (hour < start) return baseline + (peak - baseline) * (hour - (start - 1))
  if (hour > end) return baseline + (peak - baseline) * ((end + 1 - hour))
  return peak
}

function openAt(cafe: Cafe, detail: Detail, now: Date): { open: number; close: number } | null {
  const day = now.getDay()
  const hours = detail.hours?.find((entry) => entry.day === day)
  const open = hours?.open ?? cafe.opens
  const close = hours?.close ?? cafe.closes
  const hour = hourFor(now)
  if (hour < open || hour >= close) return null
  return { open, close }
}

export function estimateBusy(cafe: Cafe, detail: Detail, now: Date): BusyEstimate | null {
  if (!openAt(cafe, detail, now)) return null
  const weekend = now.getDay() === 0 || now.getDay() === 6
  const h = hourFor(now)
  const isMall = cafe.archetype === 'gallery' || detail.tags.includes('mall')
  const isLaptop = detail.tags.includes('laptop') || cafe.axes.focus >= 65
  let base: number
  let noteRule: string
  if (isMall) {
    if (weekend) {
      base = peakCurve(h, 13, 17, 1, 0.3)
      if (h >= 13 && h < 17) {
        base = 1
        noteRule = '周末下午商场店通常较满'
      } else {
        noteRule = '周末商场店逐渐热起来'
      }
    } else if (h >= 12 && h < 14) {
      base = 0.6
      noteRule = '工作日午间商场店人会多些'
    } else {
      base = 0.3
      noteRule = '工作日商场店通常较安静'
    }
  } else if (isLaptop) {
    if (weekend) {
      base = peakCurve(h, 14, 17, 0.7, 0.25)
      if (h >= 14 && h < 17) {
        base = 0.7
        noteRule = '周末下午办公友好店会有长坐客'
      } else {
        noteRule = '周末办公友好店逐渐热起来'
      }
    } else {
      base = Math.max(
        peakCurve(h, 9, 11, 0.8, 0.25),
        peakCurve(h, 14, 17, 0.8, 0.25),
      )
      if ((h >= 9 && h < 11) || (h >= 14 && h < 17)) {
        noteRule = '工作日适合办公的时段通常较满'
      } else {
        noteRule = '工作日办公友好店通常较安静'
      }
    }
  } else if (weekend) {
    base = Math.max(peakCurve(h, 10, 12, 0.9, 0.25), peakCurve(h, 14, 17, 0.9, 0.25))
    if ((h >= 10 && h < 12) || (h >= 14 && h < 17)) {
      noteRule = '周末热门时段通常较满'
    } else {
      noteRule = '周末热门时段逐渐热起来'
    }
  } else {
    base = Math.max(peakCurve(h, 8, 10, 0.5, 0.25), peakCurve(h, 14, 16, 0.6, 0.25))
    if (h >= 8 && h < 10) {
      noteRule = '工作日早间会有一波客人'
    } else if (h >= 14 && h < 16) {
      noteRule = '工作日下午通常有一波客人'
    } else {
      noteRule = '工作日通常较安静'
    }
  }
  const popularity = detail.popularity ?? 0.4
  const capacity = detail.tables === undefined ? 1 : detail.tables <= 6 ? 1.3 : detail.tables <= 16 ? 1 : 0.8
  const score = base * (0.6 + 0.8 * popularity) / capacity
  const level: 0 | 1 | 2 = score < 0.45 ? 0 : score < 0.8 ? 1 : 2
  const label = level === 0 ? '空' : level === 1 ? '适中' : '挤'
  return { level, label, note: noteRule }
}
