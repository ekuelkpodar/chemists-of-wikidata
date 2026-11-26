// Kaplan–Meier estimator with Greenwood variance and log(-log) 95% CIs (lifelines' default),
// computed client-side so every global filter applies.
export interface KMPoint { t: number; s: number; lo: number; hi: number; atRisk: number }
export interface KMResult { points: KMPoint[]; n: number; events: number; median: number | null; tEnd: number }

/** Curves are cut where fewer than MIN_AT_RISK people remain: the tail of a KM curve is noise. */
export const MIN_AT_RISK = 10

export function kaplanMeier(durations: number[], events: boolean[], tMax = 110): KMResult {
  const n = durations.length
  const byT = new Map<number, { d: number; c: number }>()
  for (let i = 0; i < n; i++) {
    const t = Math.round(durations[i])
    const e = byT.get(t) ?? { d: 0, c: 0 }
    if (events[i]) e.d++; else e.c++
    byT.set(t, e)
  }
  const times = [...byT.keys()].sort((a, b) => a - b)
  let atRisk = n, s = 1, gw = 0, nEvents = 0
  const sAt = new Map<number, { s: number; gw: number; r: number }>()
  for (const t of times) {
    const { d, c } = byT.get(t)!
    if (d > 0 && atRisk > 0) {
      s *= 1 - d / atRisk
      if (atRisk > d) gw += d / (atRisk * (atRisk - d))
      nEvents += d
    }
    sAt.set(t, { s, gw, r: atRisk })
    atRisk -= d + c
  }
  const points: KMPoint[] = []
  let cur = { s: 1, gw: 0, r: n }
  let median: number | null = null
  for (let t = 0; t <= tMax; t++) {
    const v = sAt.get(t)
    if (v) cur = v
    let lo = cur.s, hi = cur.s
    if (cur.s > 0 && cur.s < 1) {
      const se = Math.sqrt(cur.gw) / Math.abs(Math.log(cur.s))
      const ll = Math.log(-Math.log(cur.s))
      lo = Math.exp(-Math.exp(ll + 1.96 * se))
      hi = Math.exp(-Math.exp(ll - 1.96 * se))
    }
    if (median === null && cur.s <= 0.5) median = t
    points.push({ t, s: cur.s, lo, hi, atRisk: cur.r })
  }
  const tEnd = points.find((p) => p.atRisk < MIN_AT_RISK)?.t ?? tMax
  return { points, n, events: nEvents, median: median !== null && median <= tEnd ? median : null, tEnd }
}
