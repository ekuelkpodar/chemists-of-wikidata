import type { Person } from './data'
import { matches, type Filters } from './state'

export const DEC_MIN = 1700
export const DEC_MAX = 1990

/** Fractional counts per (decade, iso3): a person with k countries contributes 1/k to each. */
export function countryByDecade(people: Person[], f: Filters) {
  const m = new Map<number, Map<string, number>>()
  let n = 0
  for (const p of people) {
    if (!matches(p, f, false) || p.by === null || p.iso.length === 0) continue
    if (p.by < DEC_MIN || p.by >= DEC_MAX + 10) continue
    const d = Math.floor(p.by / 10) * 10
    const row = m.get(d) ?? new Map<string, number>()
    for (const iso of p.iso) row.set(iso, (row.get(iso) ?? 0) + 1 / p.iso.length)
    m.set(d, row)
    n++
  }
  return { m, n }
}

/** Cumulative fractional counts per country for people born ≤ year. */
export function cumulativeAt(people: Person[], f: Filters, year: number) {
  const out = new Map<string, number>()
  for (const p of people) {
    if (!matches(p, { ...f, year: 2000 }, false) || p.by === null || p.by > year || p.iso.length === 0) continue
    for (const iso of p.iso) out.set(iso, (out.get(iso) ?? 0) + 1 / p.iso.length)
  }
  return out
}

export function decades(): number[] {
  const out = []
  for (let d = DEC_MIN; d <= DEC_MAX; d += 10) out.push(d)
  return out
}
