import { useEffect, useMemo, useRef, useState } from 'react'
import { select } from 'd3-selection'
import 'd3-transition'
import { zoom as d3zoom, zoomIdentity, type ZoomBehavior } from 'd3-zoom'
import { geoNaturalEarth1, geoPath } from 'd3-geo'
import { scaleSqrt } from 'd3-scale'
import { fetchJSON, loadPeople, type Country, type PeopleData } from '../lib/data'
import { loadWorld } from '../lib/world'
import { matches, useAppState } from '../lib/state'
import { useAsync, useSize } from '../lib/useAsync'
import { ChartFrame, DataTable, Empty, ErrorState, PageHeader, Skeleton } from '../components/ui'
import { fmt } from '../lib/format'

interface Mig {
  n_people: number; n_edges: number; n_undirected: number; n_border_shift: number; methods: Record<string, number>
  countries: Country[]; migrants: { qid: string; name: string; origin: string; dest: string; birth_year: number | null; era: string | null }[]
}
type Mode = 'cumulative' | 'era'

export default function Migration() {
  const mig = useAsync<Mig>(() => fetchJSON<Mig>('migration.json'))
  const people = useAsync<PeopleData>(loadPeople)
  const world = useAsync(loadWorld)
  const err = mig.error || people.error || world.error
  return (
    <>
      <PageHeader kicker="Migration map" title="The corridors chemists travelled">
        An arc runs from a chemist's country of birth to a country whose citizenship they later held. Click a country to see who arrived and who left.
      </PageHeader>
      {err ? <ErrorState error={err} retry={() => { mig.retry(); people.retry(); world.retry() }} />
        : !mig.data || !people.data || !world.data ? <Skeleton h={560} />
        : <MapView mig={mig.data} people={people.data} world={world.data} />}
    </>
  )
}

function MapView({ mig, people, world }: { mig: Mig; people: PeopleData; world: Awaited<ReturnType<typeof loadWorld>> }) {
  const { filters, openPerson, setFilters } = useAppState()
  const [mode, setMode] = useState<Mode>('cumulative')
  const [sel, setSel] = useState<string | null>(filters.country)
  const [hover, setHover] = useState<string | null>(null)
  const [ref, { width }] = useSize<HTMLDivElement>()
  const H = Math.max(300, Math.min(600, width * 0.52))
  const iso = useMemo(() => new Map(mig.countries.map((c) => [c.iso3, c])), [mig])
  const proj = useMemo(() => geoNaturalEarth1().fitExtent([[8, 8], [width - 8, H - 8]], { type: 'Sphere' }), [width, H])
  const path = geoPath(proj)

  const eraStart = Math.floor((filters.year - 1700) / 25) * 25 + 1700
  const active = useMemo(() => mig.migrants.filter((m) => {
    const p = people.byId.get(m.qid)
    if (!p || !matches(p, { ...filters, country: null }, false)) return false
    if (m.birth_year === null) return false
    if (mode === 'era') return m.birth_year >= eraStart && m.birth_year < eraStart + 25
    return m.birth_year <= filters.year
  }), [mig, people, filters, mode, eraStart])

  const flows = useMemo(() => {
    const m = new Map<string, { o: string; d: string; n: number }>()
    for (const x of active) {
      const k = `${x.origin}>${x.dest}`
      const f = m.get(k) ?? { o: x.origin, d: x.dest, n: 0 }
      f.n++; m.set(k, f)
    }
    return [...m.values()].filter((f) => iso.has(f.o) && iso.has(f.d)).sort((a, b) => b.n - a.n)
  }, [active, iso])
  const balance = useMemo(() => {
    const b = new Map<string, { in: number; out: number }>()
    for (const f of flows) {
      const o = b.get(f.o) ?? { in: 0, out: 0 }; o.out += f.n; b.set(f.o, o)
      const d = b.get(f.d) ?? { in: 0, out: 0 }; d.in += f.n; b.set(f.d, d)
    }
    return b
  }, [flows])
  const shown = flows.slice(0, 80)
  const w = scaleSqrt().domain([1, Math.max(2, flows[0]?.n ?? 2)]).range([0.8, 9])
  const r = scaleSqrt().domain([0, Math.max(1, ...[...balance.values()].map((v) => v.in + v.out))]).range([2.5, 18])
  const focus = hover ?? sel
  const svgRef = useRef<SVGSVGElement>(null)
  const zb = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null)
  const [t, setT] = useState({ k: 1, x: 0, y: 0 })
  useEffect(() => {
    if (!svgRef.current) return
    const z = d3zoom<SVGSVGElement, unknown>().scaleExtent([1, 8]).translateExtent([[0, 0], [width, H]])
      .filter((e) => e.type !== 'wheel' || e.ctrlKey || e.metaKey || e.shiftKey)  // don't hijack page scroll
      .on('zoom', (e) => setT({ k: e.transform.k, x: e.transform.x, y: e.transform.y }))
    zb.current = z
    select(svgRef.current).call(z)
    const el = svgRef.current
    return () => { select(el).on('.zoom', null) }
  }, [width, H, flows.length > 0])  // eslint-disable-line react-hooks/exhaustive-deps
  const goTo = (view: 'world' | 'europe' | 'atlantic') => {
    if (!svgRef.current || !zb.current) return
    const [cx, cy, k] = view === 'world' ? [width / 2, H / 2, 1] : view === 'europe' ? [...proj([12, 50])!, 4.2] : [...proj([-30, 45])!, 2]
    select(svgRef.current).transition().duration(600).call(zb.current.transform, view === 'world' ? zoomIdentity : zoomIdentity.translate(width / 2 - cx * k, H / 2 - cy * k).scale(k))
  }
  // Greedy label placement in screen space: biggest countries first, skip overlaps.
  const labelled = useMemo(() => {
    const placed: [number, number, number, number][] = []
    const out = new Set<string>()
    const entries = [...balance.entries()].sort((a, b) => (b[1].in + b[1].out) - (a[1].in + a[1].out))
    for (const [i, b] of entries) {
      const c = iso.get(i); if (!c) continue
      const [px, py] = proj([c.lon, c.lat])!
      const x = px * t.k + t.x, y = py * t.k + t.y - (r(b.in + b.out) + 5)
      const w = c.name.length * 6.3, box: [number, number, number, number] = [x - w / 2, y - 12, x + w / 2, y + 2]
      if (x < 0 || x > width || y < 0 || y > H) continue
      if (placed.some((p) => !(box[2] < p[0] || box[0] > p[2] || box[3] < p[1] || box[1] > p[3]))) continue
      placed.push(box); out.add(i)
      if (out.size >= 18) break
    }
    return out
  }, [balance, iso, proj, t, width, H, r])
  const arc = (o: Country, d: Country) => {
    const [x1, y1] = proj([o.lon, o.lat])!, [x2, y2] = proj([d.lon, d.lat])!
    const dx = x2 - x1, dy = y2 - y1, dist = Math.hypot(dx, dy)
    const cx = (x1 + x2) / 2 - dy * 0.22, cy = (y1 + y2) / 2 + dx * 0.22 - dist * 0.08
    return `M${x1},${y1} Q${cx},${cy} ${x2},${y2}`
  }
  const selB = sel ? balance.get(sel) : null
  const selMigrants = sel ? active.filter((m) => m.origin === sel || m.dest === sel) : []
  const name = (i: string) => iso.get(i)?.name ?? i

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
      <ChartFrame id="map" title={mode === 'era' ? `Moves by chemists born ${eraStart}–${eraStart + 24}` : `Moves by chemists born up to ${filters.year}`}
        subtitle={`${fmt(active.length)} directed moves, top ${shown.length} corridors drawn; width ∝ √people`}
        n={active.length}
        caveat={`Direction = birthplace country → citizenship. Not drawn: ${fmt(mig.n_undirected)} multi-country links with no birthplace, and ${fmt(mig.n_border_shift)} births in regions that changed country (e.g. Breslau, now Wrocław). Citizenship ≠ residence.`}
        actions={<div role="radiogroup" aria-label="Time window" className="flex rounded-full border border-rule p-0.5 text-xs">
          {(['cumulative', 'era'] as Mode[]).map((m) => <button key={m} role="radio" aria-checked={mode === m} onClick={() => setMode(m)}
            className={`rounded-full px-2.5 py-1 ${mode === m ? 'bg-ink text-paper' : 'text-muted'}`}>{m === 'era' ? '25-yr era' : 'Cumulative'}</button>)}
        </div>}
        table={<DataTable cols={['From', 'To', 'People']} rows={flows.slice(0, 200).map((f) => [name(f.o), name(f.d), f.n])} caption="Migration corridors" />}>
        <div ref={ref} className="relative">
          {flows.length === 0 ? <Empty>No recorded moves for this selection. Try a later year or clear filters.</Empty> : (
            <svg ref={svgRef} width={width} height={H} role="img" aria-label={`Flow map. Busiest corridors: ${flows.slice(0, 3).map((f) => `${name(f.o)} to ${name(f.d)}, ${f.n}`).join('; ')}`}>
              <g transform={`translate(${t.x},${t.y}) scale(${t.k})`}>
              <path d={path({ type: 'Sphere' }) ?? ''} fill="var(--paper)" />
              {world.features.map((f, i) => <path key={i} d={path(f) ?? ''} fill="var(--rule)" stroke="var(--surface)" strokeWidth={0.5} vectorEffect="non-scaling-stroke" />)}
              {shown.map((f) => {
                const on = !focus || f.o === focus || f.d === focus
                const outgoing = focus && f.o === focus
                return <path key={`${f.o}>${f.d}`} d={arc(iso.get(f.o)!, iso.get(f.d)!)} fill="none" className="flow-arc"
                  stroke={outgoing ? 'var(--s2)' : 'var(--s1)'} strokeOpacity={focus ? (on ? 0.9 : 0.06) : 0.55} strokeWidth={w(f.n) / Math.sqrt(t.k)} strokeLinecap="round">
                  <title>{`${name(f.o)} → ${name(f.d)}: ${f.n}`}</title></path>
              })}
              {[...balance.entries()].map(([i, b]) => {
                const c = iso.get(i); if (!c) return null
                const [x, y] = proj([c.lon, c.lat])!
                const net = b.in - b.out
                return (
                  <g key={i} transform={`translate(${x},${y}) scale(${1 / t.k})`} tabIndex={0} role="button" aria-pressed={sel === i}
                    aria-label={`${c.name}: ${b.in} in, ${b.out} out`} className="cursor-pointer outline-none"
                    onClick={() => setSel(sel === i ? null : i)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSel(sel === i ? null : i) } }}
                    onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(i)} onBlur={() => setHover(null)}>
                    <circle r={r(b.in + b.out) + 6} fill="transparent" />
                    <circle r={r(b.in + b.out)} fill={net >= 0 ? 'var(--s1)' : 'var(--s2)'} fillOpacity={0.9} stroke={sel === i ? 'var(--ink)' : 'var(--surface)'} strokeWidth={2} />
                    {(labelled.has(i) || sel === i || hover === i) && <text y={-r(b.in + b.out) - 5} textAnchor="middle" fontSize={11} fill="var(--ink)" style={{ paintOrder: 'stroke', stroke: 'var(--surface)', strokeWidth: 3 }}>{c.name}</text>}
                  </g>
                )
              })}
              </g>
            </svg>
          )}
          {flows.length > 0 && <div className="absolute left-2 top-2 flex gap-1 text-xs" role="group" aria-label="Map view">
            {(['world', 'europe', 'atlantic'] as const).map((v) => <button key={v} onClick={() => goTo(v)} className="rounded-full border border-rule bg-surface/90 px-2.5 py-1 capitalize text-muted hover:text-ink">{v}</button>)}
          </div>}
          <ul className="mt-2 flex flex-wrap gap-4 text-xs text-muted" aria-label="Legend">
            <li className="flex items-center gap-1.5"><i className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: 'var(--s1)' }} />net gain (circle) / inflow (arc)</li>
            <li className="flex items-center gap-1.5"><i className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: 'var(--s2)' }} />net loss (circle) / outflow from selected</li>
            <li>dashes flow origin → destination</li>
            <li>drag to pan · ⌘/Ctrl/Shift + scroll to zoom</li>
          </ul>
        </div>
      </ChartFrame>

      <aside className="space-y-4" aria-live="polite">
        {!sel ? (
          <div className="rounded-2xl border border-rule bg-surface p-5">
            <h2 className="font-semibold">Net brain gain</h2>
            <p className="mb-3 text-xs text-muted">Arrivals minus departures in the current selection</p>
            <ol className="space-y-1.5 text-sm">
              {[...balance.entries()].map(([i, b]) => ({ i, net: b.in - b.out, ...b })).sort((a, b) => b.net - a.net).filter((_, k, arr) => k < 6 || k >= arr.length - 4).map((d) => (
                <li key={d.i} className="flex justify-between gap-2"><button className="truncate text-left hover:underline" onClick={() => setSel(d.i)}>{name(d.i)}</button>
                  <span className={`tabular ${d.net >= 0 ? '' : 'text-muted'}`}>{d.net > 0 ? '+' : ''}{d.net}</span></li>
              ))}
            </ol>
            <p className="mt-4 text-xs text-faint">Click a circle, or a name, to see that country's migrants.</p>
          </div>
        ) : (
          <div className="rounded-2xl border border-rule bg-surface p-5">
            <div className="flex items-start justify-between gap-2">
              <div><h2 className="font-display text-2xl">{name(sel)}</h2>
                <p className="text-sm text-muted tabular">{selB?.in ?? 0} arrived · {selB?.out ?? 0} left · net {((selB?.in ?? 0) - (selB?.out ?? 0)) > 0 ? '+' : ''}{(selB?.in ?? 0) - (selB?.out ?? 0)}</p></div>
              <button className="rounded-full border border-rule px-2 py-0.5 text-sm" onClick={() => setSel(null)} aria-label="Clear selection">✕</button>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
              <div><h4 className="text-xs uppercase tracking-wider text-faint">From</h4>
                <ul>{flows.filter((f) => f.d === sel).slice(0, 6).map((f) => <li key={f.o} className="flex justify-between"><span className="truncate">{name(f.o)}</span><span className="tabular text-muted">{f.n}</span></li>)}</ul></div>
              <div><h4 className="text-xs uppercase tracking-wider text-faint">To</h4>
                <ul>{flows.filter((f) => f.o === sel).slice(0, 6).map((f) => <li key={f.d} className="flex justify-between"><span className="truncate">{name(f.d)}</span><span className="tabular text-muted">{f.n}</span></li>)}</ul></div>
            </div>
            <h4 className="mt-4 text-xs uppercase tracking-wider text-faint">Migrants ({selMigrants.length})</h4>
            <ul className="mt-1 max-h-72 space-y-1 overflow-auto text-sm">
              {selMigrants.slice(0, 300).map((m) => (
                <li key={`${m.qid}${m.origin}${m.dest}`}><button className="text-left hover:underline" onClick={() => openPerson(m.qid)}>{m.name}</button>
                  <span className="text-xs text-muted"> · b. {m.birth_year} · {m.origin === sel ? `→ ${name(m.dest)}` : `from ${name(m.origin)}`}</span></li>
              ))}
            </ul>
            <button className="mt-3 text-xs text-accent hover:underline" onClick={() => setFilters({ country: sel })}>Filter every view to {name(sel)} →</button>
          </div>
        )}
      </aside>
    </div>
  )
}
