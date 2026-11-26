import type { Person } from '../lib/data'
import type { Filters } from '../lib/state'
import { countryByDecade, cumulativeAt, decades } from '../lib/agg'

export const TOP_SERIES = ['USA', 'DEU', 'GBR', 'FRA', 'RUS', 'JPN']

export function countByDecadeShares(people: Person[], f: Filters) {
  const { m, n } = countryByDecade(people, f)
  const rows = decades().map((d) => {
    const row = m.get(d) ?? new Map<string, number>()
    let total = 0, top = 0
    const out: Record<string, number> = { decade: d }
    for (const v of row.values()) total += v
    for (const k of TOP_SERIES) { out[k] = row.get(k) ?? 0; top += out[k] }
    out.OTHER = total - top
    out.total = total
    return out as Record<string, number> & { decade: number; total: number }
  }).filter((r) => r.total > 0)
  return { rows, n }
}

export function raceFrame(people: Person[], f: Filters, year: number) {
  return [...cumulativeAt(people, f, year).entries()].map(([iso, v]) => ({ iso, v })).sort((a, b) => b.v - a.v)
}
