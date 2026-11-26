import { useMemo, useState } from 'react'
import { geoNaturalEarth1, geoPath } from 'd3-geo'
import { scaleLinear } from 'd3-scale'
import { area, stack, stackOffsetExpand, curveMonotoneX } from 'd3-shape'
import { fetchJSON, loadMeta, loadPeople, type Meta, type PeopleData } from '../lib/data'
import { loadWorld } from '../lib/world'
import { countByDecadeShares, raceFrame, TOP_SERIES } from './gravityData'
import { useAppState } from '../lib/state'
import { useAsync, useSize } from '../lib/useAsync'
import { countryColor, OTHER } from '../lib/colors'
import { ChartFrame, DataTable, Empty, ErrorState, Legend, PageHeader, Skeleton, Tooltip } from '../components/ui'
import { fmt, pct } from '../lib/format'
import { decades } from '../lib/agg'
import { recordRace } from './raceRecorder'

interface Cog {
  handoffs: { decade: number; from: string; to: string; to_share: number }[]
  center: { decade: number; lat: number; lon: number; n: number }[]
  names: Record<string, string>
}

export default function Gravity() {
  const people = useAsync<PeopleData>(loadPeople)
  const meta = useAsync<Meta>(loadMeta)
  const cog = useAsync<Cog>(() => fetchJSON<Cog>('cog.json'))
  if (people.error || meta.error || cog.error) return <ErrorState error={(people.error || meta.error || cog.error)!} retry={() => { people.retry(); meta.retry(); cog.retry() }} />
  return (
    <>
      <PageHeader kicker="Center of gravity" title="Where chemistry lived, cohort by cohort">
        Each chemist counts toward their country of citizenship. People with several unrelated citizenships split their weight between them.
        Press play to watch three centuries of birth cohorts accumulate.
      </PageHeader>
      {!people.data || !meta.data || !cog.data ? <div className="space-y-6"><Skeleton h={460} /><Skeleton h={360} /></div> : (
        <div className="grid gap-6">
          <Race data={people.data} names={cog.data.names} />
          <Shares data={people.data} names={cog.data.names} handoffs={cog.data.handoffs} />
          <Drift center={cog.data.center} />
        </div>
      )}
    </>
  )
}

function Race({ data, names }: { data: PeopleData; names: Record<string, string> }) {
  const { filters } = useAppState()
  const [ref, { width }] = useSize<HTMLDivElement>()
  const [rec, setRec] = useState<'idle' | 'recording' | 'unsupported'>('idle')
  const frame = useMemo(() => raceFrame(data.people, filters, filters.year), [data, filters])
  const top = frame.slice(0, 12)
  const max = Math.max(1, top[0]?.v ?? 1)
  const rowH = 30
  const labelW = width < 500 ? 96 : 150
  const x = scaleLinear().domain([0, max]).range([0, Math.max(10, width - labelW - 60)])
  const total = frame.reduce((s, d) => s + d.v, 0)
  const record = async () => {
    if (typeof MediaRecorder === 'undefined') { setRec('unsupported'); return }
    setRec('recording')
    try { await recordRace(data.people, { ...filters }, names) } finally { setRec('idle') }
  }
  return (
    <ChartFrame id="race" title={`Cumulative chemists by country, born up to ${filters.year}`}
      subtitle={`${fmt(total)} chemists with a known birth year and country in the current filter`}
      n={Math.round(total)} caveat="Fractional counting for multi-country people. English-Wikipedia notability over-represents anglophone countries."
      actions={<button onClick={record} disabled={rec === 'recording'} className="rounded-full border border-rule px-3 py-1 text-xs text-muted hover:text-ink disabled:opacity-60" aria-live="polite">
        {rec === 'recording' ? '● Recording…' : rec === 'unsupported' ? 'Recording unsupported' : '⏺ Record video (WebM)'}
      </button>}
      table={<DataTable cols={['Rank', 'Country', 'Chemists']} rows={frame.slice(0, 30).map((d, i) => [i + 1, names[d.iso] ?? d.iso, Math.round(d.v)])} />}>
      <div ref={ref} className="relative" style={{ height: top.length * rowH + 8 }} role="img" aria-label={`Bar chart race. Leading at ${filters.year}: ${top.slice(0, 3).map((d) => `${names[d.iso]} ${Math.round(d.v)}`).join(', ')}`}>
        {top.length === 0 && <Empty>No chemists born by {filters.year} match the filters.</Empty>}
        {frame.slice(0, 16).map((d, i) => (
          <div key={d.iso} className="absolute left-0 flex w-full items-center transition-transform duration-300 ease-out"
            style={{ transform: `translateY(${i * rowH}px)`, opacity: i < 12 ? 1 : 0, height: rowH - 6 }}>
            <span className="shrink-0 truncate pr-3 text-right text-sm" style={{ width: labelW }}>{names[d.iso] ?? d.iso}</span>
            <span className="h-full rounded-r transition-[width] duration-300 ease-out" style={{ width: Math.max(2, x(d.v)), background: countryColor(d.iso) === OTHER ? 'var(--faint)' : countryColor(d.iso), maxWidth: 'calc(100% - 200px)' }} />
            <span className="pl-2 text-xs text-muted tabular">{fmt(d.v)}</span>
          </div>
        ))}
      </div>
    </ChartFrame>
  )
}

function Shares({ data, names, handoffs }: { data: PeopleData; names: Record<string, string>; handoffs: Cog['handoffs'] }) {
  const { filters } = useAppState()
  const [ref, { width }] = useSize<HTMLDivElement>()
  const [hover, setHover] = useState<{ x: number; y: number; d: number } | null>(null)
  const { rows, n } = useMemo(() => countByDecadeShares(data.people, filters), [data, filters])
  const H = 340, m = { t: 10, r: 12, b: 28, l: 40 }
  const keys = [...TOP_SERIES, 'OTHER']
  const xs = scaleLinear().domain([1700, 1990]).range([m.l, Math.max(m.l + 10, width - m.r)])
  const ys = scaleLinear().domain([0, 1]).range([H - m.b, m.t])
  const series = stack<Record<string, number>>().keys(keys).offset(stackOffsetExpand)(rows as Record<string, number>[])
  const ar = area<[number, number] & { data: Record<string, number> }>().x((d) => xs(d.data.decade)).y0((d) => ys(d[0])).y1((d) => ys(d[1])).curve(curveMonotoneX)
  const yr = Math.min(1990, Math.max(1700, filters.year))
  const hovRow = hover ? rows.find((r) => r.decade === hover.d) : null
  if (!rows.length) return <Empty>No chemists match the filters.</Empty>
  return (
    <ChartFrame id="shares" title="Share of each birth decade's chemists, by country" subtitle="100% stacked; the line marks the scrubber year"
      n={n} caveat="Decades with fewer than ~30 chemists (mostly before 1760) are noisy."
      table={<DataTable cols={['Decade', ...keys.map((k) => names[k] ?? 'Other')]} rows={rows.map((r) => [r.decade, ...keys.map((k) => pct(r[k] / Math.max(1e-9, r.total), 1))])} />}>
      <Legend items={keys.map((k) => ({ label: names[k] ?? 'Other', color: k === 'OTHER' ? OTHER : countryColor(k) }))} />
      <div ref={ref} className="relative mt-3">
        <svg width={width} height={H} role="img" aria-label="Stacked area chart of country shares by birth decade"
          onMouseMove={(e) => { const r = e.currentTarget.getBoundingClientRect(); const d = Math.round(xs.invert(e.clientX - r.left) / 10) * 10; setHover({ x: e.clientX - r.left, y: e.clientY - r.top, d: Math.min(1990, Math.max(1700, d)) }) }}
          onMouseLeave={() => setHover(null)}>
          {series.map((s) => <path key={s.key} d={ar(s as never) ?? ''} fill={s.key === 'OTHER' ? OTHER : countryColor(s.key)} stroke="var(--surface)" strokeWidth={1} />)}
          <g className="axis">
            {[0, 0.25, 0.5, 0.75, 1].map((v) => <text key={v} x={m.l - 6} y={ys(v)} dy="0.32em" textAnchor="end">{pct(v)}</text>)}
            {decades().filter((d) => d % 50 === 0).map((d) => <text key={d} x={xs(d)} y={H - 8} textAnchor="middle">{d}</text>)}
          </g>
          {handoffs.map((h) => (
            <g key={h.decade}>
              <line x1={xs(h.decade)} x2={xs(h.decade)} y1={m.t} y2={H - m.b} stroke="var(--ink)" strokeOpacity={0.35} strokeWidth={1} />
              <text x={xs(h.decade) + 4} y={m.t + 12} fontSize={11} fill="var(--ink)">{names[h.from]?.split(' ')[0]} → {names[h.to]?.replace('United States', 'US')}</text>
            </g>
          ))}
          <line x1={xs(yr)} x2={xs(yr)} y1={m.t} y2={H - m.b} stroke="var(--ink)" strokeWidth={2} />
          {hover && <line x1={xs(hover.d)} x2={xs(hover.d)} y1={m.t} y2={H - m.b} stroke="var(--surface)" strokeWidth={1.5} />}
        </svg>
        {hover && hovRow && (
          <Tooltip x={hover.x} y={hover.y} bounds={width}>
            <p className="font-semibold">Born {hover.d}s · {fmt(hovRow.total)} chemists</p>
            <ul className="mt-1 space-y-0.5">{keys.map((k) => (
              <li key={k} className="flex items-center justify-between gap-3"><span className="flex items-center gap-1.5"><i className="inline-block h-2 w-2 rounded-full" style={{ background: k === 'OTHER' ? OTHER : countryColor(k) }} />{names[k] ?? 'Other'}</span><span className="tabular">{pct(hovRow[k] / Math.max(1e-9, hovRow.total))}</span></li>
            ))}</ul>
          </Tooltip>
        )}
      </div>
      <p className="mt-3 text-sm text-muted">
        Leadership handoffs (computed with a 3-decade rolling window, new leader must hold ≥ 2 decades):{' '}
        {handoffs.map((h, i) => <span key={i}>{i > 0 && '; '}<b className="text-ink">{names[h.from]} → {names[h.to]}</b> in the {h.decade}s</span>)}.
        Britain and the German states trade the lead decade by decade between the 1760s and 1800s.
      </p>
    </ChartFrame>
  )
}

function Drift({ center }: { center: Cog['center'] }) {
  const world = useAsync(loadWorld)
  const { filters } = useAppState()
  const [ref, { width }] = useSize<HTMLDivElement>()
  const H = Math.max(220, Math.min(380, width * 0.5))
  const proj = useMemo(() => geoNaturalEarth1().center([-20, 48]).scale(width * 0.9).translate([width / 2, H / 2]), [width, H])
  const path = geoPath(proj)
  const pts = center.filter((c) => c.n >= 20).map((c) => ({ ...c, p: proj([c.lon, c.lat])! }))
  const cur = pts.filter((c) => c.decade <= filters.year).at(-1)
  return (
    <ChartFrame id="drift" title="The geographic center of chemistry drifts west"
      subtitle="Spherical mean of birthplaces (or citizenship country) by birth decade, decades with ≥ 20 chemists"
      n={center.reduce((s, c) => s + c.n, 0)} caveat="Unfiltered. A mean of points on two continents can sit in the ocean between them — that is the point."
      table={<DataTable cols={['Decade', 'Lat', 'Lon', 'n']} rows={center.map((c) => [c.decade, c.lat.toFixed(1), c.lon.toFixed(1), c.n])} />}>
      <div ref={ref}>
        {world.error ? <ErrorState error={world.error} retry={world.retry} /> : !world.data ? <Skeleton h={H} /> : (
          <svg width={width} height={H} role="img" aria-label={`Map: the mean position of chemists moves from ${pts[0]?.decade}s Europe westward over the Atlantic by the ${pts.at(-1)?.decade}s`}>
            <path d={path({ type: 'Sphere' }) ?? ''} fill="var(--paper)" />
            {world.data.features.map((f, i) => <path key={i} d={path(f) ?? ''} fill="var(--rule)" stroke="var(--surface)" strokeWidth={0.5} />)}
            <path d={`M${pts.map((c) => c.p.join(',')).join('L')}`} fill="none" stroke="var(--accent)" strokeWidth={2} strokeLinejoin="round" />
            {pts.filter((c) => c.decade % 50 === 0).map((c) => (
              <g key={c.decade}><circle cx={c.p[0]} cy={c.p[1]} r={4} fill="var(--accent)" stroke="var(--surface)" strokeWidth={2} />
                <text x={c.p[0] + 7} y={c.p[1] - 6} fontSize={11} fill="var(--ink)">{c.decade}s</text></g>
            ))}
            {cur && <circle cx={cur.p[0]} cy={cur.p[1]} r={7} fill="var(--highlight)" stroke="var(--surface)" strokeWidth={2}><title>{cur.decade}s</title></circle>}
          </svg>
        )}
      </div>
    </ChartFrame>
  )
}
