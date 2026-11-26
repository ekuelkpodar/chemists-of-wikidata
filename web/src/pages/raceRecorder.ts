// Renders the bar-chart race to an offscreen canvas and records it with MediaRecorder → WebM download.
import type { Person } from '../lib/data'
import type { Filters } from '../lib/state'
import { raceFrame } from './gravityData'
import { countryColor, OTHER } from '../lib/colors'

const css = (v: string) => getComputedStyle(document.documentElement).getPropertyValue(v).trim() || '#888'
const resolve = (c: string) => (c.startsWith('var(') ? css(c.slice(4, -1)) : c)

export async function recordRace(people: Person[], f: Filters, names: Record<string, string>, size = 1080): Promise<void> {
  const canvas = document.createElement('canvas')
  canvas.width = size; canvas.height = size
  const ctx = canvas.getContext('2d')!
  const stream = canvas.captureStream(30)
  const mime = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find((m) => MediaRecorder.isTypeSupported(m)) ?? 'video/webm'
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 6_000_000 })
  const chunks: Blob[] = []
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data)
  const done = new Promise<void>((res) => { rec.onstop = () => res() })
  rec.start()
  const bg = css('--paper'), ink = css('--ink'), muted = css('--muted')
  const frames: { y: number; rows: { iso: string; v: number }[] }[] = []
  for (let y = 1750; y <= 2000; y += 1) frames.push({ y, rows: raceFrame(people, { ...f, year: 2000 }, y).slice(0, 12) })
  const pos = new Map<string, number>()
  const drawFrame = (i: number) => {
    const { y, rows } = frames[i]
    ctx.fillStyle = bg; ctx.fillRect(0, 0, size, size)
    ctx.fillStyle = ink; ctx.font = '600 52px Georgia, serif'
    ctx.fillText('Where chemists came from', 64, 110)
    ctx.fillStyle = muted; ctx.font = '28px system-ui, sans-serif'
    ctx.fillText('Cumulative notable chemists by country of citizenship', 64, 156)
    ctx.fillStyle = ink; ctx.font = '700 120px Georgia, serif'; ctx.textAlign = 'right'
    ctx.fillText(String(y), size - 64, size - 90); ctx.textAlign = 'left'
    const max = Math.max(1, rows[0]?.v ?? 1), top = 210, rowH = 54, labelW = 260, barMax = size - labelW - 200
    rows.forEach((r, k) => {
      const target = top + k * rowH
      const cur = pos.get(r.iso) ?? target
      const yy = cur + (target - cur) * 0.25
      pos.set(r.iso, yy)
      const c = countryColor(r.iso)
      ctx.fillStyle = resolve(c === OTHER ? 'var(--faint)' : c)
      const w = Math.max(4, (r.v / max) * barMax)
      ctx.beginPath(); ctx.roundRect(64 + labelW, yy, w, rowH - 14, [0, 6, 6, 0]); ctx.fill()
      ctx.fillStyle = ink; ctx.font = '26px system-ui, sans-serif'; ctx.textAlign = 'right'
      ctx.fillText((names[r.iso] ?? r.iso).replace('United States', 'United States'), 64 + labelW - 14, yy + 30)
      ctx.textAlign = 'left'; ctx.fillStyle = muted
      ctx.fillText(String(Math.round(r.v)), 64 + labelW + w + 12, yy + 30)
    })
    ctx.fillStyle = muted; ctx.font = '20px system-ui, sans-serif'
    ctx.fillText('Data: Wikidata (CC0) · notable = has an English Wikipedia article', 64, size - 40)
  }
  await new Promise<void>((res) => {
    let i = 0
    const tick = () => {
      drawFrame(Math.min(i >> 1, frames.length - 1))
      i++
      if ((i >> 1) < frames.length + 45) requestAnimationFrame(tick); else res()
    }
    tick()
  })
  rec.stop()
  await done
  const blob = new Blob(chunks, { type: 'video/webm' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob); a.download = 'chemistry-bar-race.webm'; a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 5000)
}
