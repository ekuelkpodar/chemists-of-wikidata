import { useMemo, useState } from 'react'
import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY, type SimulationNodeDatum } from 'd3-force'
import { scaleLinear, scaleSqrt } from 'd3-scale'
import { line, curveMonotoneX } from 'd3-shape'
import { fetchJSON, loadPeople, type PeopleData } from '../lib/data'
import { matches, useAppState } from '../lib/state'
import { useAsync, useSize } from '../lib/useAsync'
import { domainColor } from '../lib/colors'
import { ChartFrame, DataTable, Empty, ErrorState, Legend, PageHeader, Skeleton, Tooltip } from '../components/ui'
import { fmt } from '../lib/format'
import { decades } from '../lib/agg'

interface Spec { first: { occupation: string; domain: string; first_year: number; first_person: string; first_qid: string; year_k3: number | null; n: number }[] }

export default function Specialties() {
  const people = useAsync<PeopleData>(loadPeople)
  const spec = useAsync<Spec>(() => fetchJSON<Spec>('specialties.json'))
  const err = people.error || spec.error
  return (
    <>
      <PageHeader kicker="Specialty tree" title="How one profession branched">
        Wikidata records each chemist's occupations. When one person holds two labels, the labels are linked.
        The network shows which specialties overlap. The timeline shows when each label first gathered at least three holders.
      </PageHeader>
      {err ? <ErrorState error={err} retry={() => { people.retry(); spec.retry() }} />
        : !people.data || !spec.data ? <div className="grid gap-6"><Skeleton h={520} /><Skeleton h={420} /></div>
        : <div className="grid gap-6"><Network data={people.data} /><Growth data={people.data} /><Timeline spec={spec.data} /></div>}
    </>
  )
}

interface N extends SimulationNodeDatum { id: number; name: string; dom: string; n: number }

function Network({ data }: { data: PeopleData }) {
  const { filters, setFilters } = useAppState()
  const [ref, { width }] = useSize<HTMLDivElement>()
  const [hover, setHover] = useState<{ node: N; x: number; y: number } | null>(null)
  const [hideGeneral, setHideGeneral] = useState(true)
  const H = Math.max(380, Math.min(560, width * 0.6))
  const { nodes, links, nPeople } = useMemo(() => {
    const count = new Map<number, number>(), pair = new Map<string, number>()
    let nPeople = 0
    for (const p of data.people) {
      if (!matches(p, { ...filters, domain: null })) continue
      const occ = hideGeneral ? p.occ.filter((o) => data.occupations[o] !== 'chemist') : p.occ
      if (!occ.length) continue
      nPeople++
      for (const o of occ) count.set(o, (count.get(o) ?? 0) + 1)
      for (let i = 0; i < occ.length; i++) for (let j = i + 1; j < occ.length; j++) {
        const k = `${occ[i]}-${occ[j]}`; pair.set(k, (pair.get(k) ?? 0) + 1)
      }
    }
    const nodes: N[] = [...count.entries()].map(([id, n]) => ({ id, n, name: data.occupations[id], dom: data.domains[data.occupationDomain[id]] }))
    const ids = new Set(nodes.map((n) => n.id))
    const links = [...pair.entries()].map(([k, n]) => { const [a, b] = k.split('-').map(Number); return { source: a, target: b, n } })
      .filter((l) => ids.has(l.source) && ids.has(l.target))
    return { nodes, links, nPeople }
  }, [data, filters, hideGeneral])

  const layout = useMemo(() => {
    if (!width) return null
    const r = scaleSqrt().domain([1, Math.max(2, ...nodes.map((n) => n.n))]).range([6, Math.min(46, width / 16)])
    const labelMinRef = [...nodes].sort((a, b) => b.n - a.n)[Math.min(13, nodes.length - 1)]?.n ?? 0
    const ns = nodes.map((n) => ({ ...n }))
    const ls = links.map((l) => ({ ...l }))
    const sim = forceSimulation<N>(ns)
      .force('link', forceLink<N, { source: number | N; target: number | N; n: number }>(ls).id((d) => d.id).distance(95).strength((l) => Math.min(1, 0.1 + l.n / 40)))
      .force('charge', forceManyBody().strength(-280))
      .force('x', forceX(width / 2).strength(0.06)).force('y', forceY(H / 2).strength(0.09))
      .force('collide', forceCollide<N>((d) => r(d.n) + (d.n >= labelMinRef ? 16 : 4)))
      .stop()
    for (let i = 0; i < 180; i++) sim.tick()
    for (const n of ns) { n.x = Math.max(r(n.n), Math.min(width - r(n.n), n.x!)); n.y = Math.max(r(n.n), Math.min(H - r(n.n), n.y!)) }
    return { ns, ls: ls as unknown as { source: N; target: N; n: number }[], r }
  }, [nodes, links, width, H])
  const sel = filters.domain !== null ? data.domains[filters.domain] : null
  const labelMin = [...nodes].sort((a, b) => b.n - a.n)[Math.min(13, nodes.length - 1)]?.n ?? 0
  const wl = scaleLinear().domain([1, Math.max(2, ...links.map((l) => l.n))]).range([0.6, 7])
  const domainsPresent = [...new Set(nodes.map((n) => n.dom))].sort()
  return (
    <ChartFrame id="net" title={`Specialty co-occurrence, chemists born up to ${filters.year}`}
      subtitle="Circle area ∝ holders; line width ∝ people holding both labels" n={nPeople}
      caveat={`Only ${fmt(nPeople)} people carry a label beyond the generic one shown here. Many people are only labelled "chemist", so specialist counts are minimums.`}
      actions={<label className="flex items-center gap-1.5 text-xs text-muted"><input type="checkbox" checked={hideGeneral} onChange={(e) => setHideGeneral(e.target.checked)} />Hide generic “chemist”</label>}
      table={<DataTable cols={['Specialty A', 'Specialty B', 'People']} rows={[...links].sort((a, b) => b.n - a.n).map((l) => [data.occupations[l.source as number], data.occupations[l.target as number], l.n])} />}>
      <Legend items={domainsPresent.map((d) => ({ label: d, color: domainColor(d) }))} />
      <div ref={ref} className="relative mt-2">
        {!layout ? <Skeleton h={H} /> : nodes.length === 0 ? <Empty>No specialists match these filters.</Empty> : (
          <svg width={width} height={H} role="img" aria-label={`Network of ${nodes.length} specialties. Largest: ${[...nodes].sort((a, b) => b.n - a.n).slice(0, 4).map((n) => `${n.name} (${n.n})`).join(', ')}`}>
            {layout.ls.map((l, i) => <line key={i} x1={l.source.x} y1={l.source.y} x2={l.target.x} y2={l.target.y} stroke="var(--axis)" strokeOpacity={0.7} strokeWidth={wl(l.n)} />)}
            {layout.ns.map((n) => {
              const dim = sel && n.dom !== sel
              return (
                <g key={n.id} transform={`translate(${n.x},${n.y})`} tabIndex={0} role="button" aria-label={`${n.name}: ${n.n} people, ${n.dom}`}
                  onMouseEnter={() => setHover({ node: n, x: n.x!, y: n.y! })} onMouseLeave={() => setHover(null)} onFocus={() => setHover({ node: n, x: n.x!, y: n.y! })} onBlur={() => setHover(null)}
                  onClick={() => setFilters({ domain: sel === n.dom ? null : data.domains.indexOf(n.dom) })} className="cursor-pointer outline-none">
                  <circle r={layout.r(n.n)} fill={domainColor(n.dom)} fillOpacity={dim ? 0.15 : 0.9} stroke="var(--surface)" strokeWidth={2} />
                </g>
              )
            })}
            <g aria-hidden="true" style={{ pointerEvents: 'none' }}>
              {layout.ns.filter((n) => n.n >= labelMin).map((n) => {
                const inside = layout.r(n.n) > 30
                return <text key={n.id} x={n.x} y={inside ? n.y : n.y! + layout.r(n.n) + 12} dy={inside ? '0.32em' : 0} textAnchor="middle" fontSize={11}
                  fill={inside ? '#fff' : 'var(--ink)'} style={inside ? undefined : { paintOrder: 'stroke', stroke: 'var(--surface)', strokeWidth: 3 }}>{n.name}</text>
              })}
            </g>
          </svg>
        )}
        {hover && <Tooltip x={hover.x} y={hover.y} bounds={width}><p className="font-semibold">{hover.node.name}</p><p className="text-muted">{hover.node.dom}</p><p className="tabular">{fmt(hover.node.n)} people · click to filter domain</p></Tooltip>}
      </div>
    </ChartFrame>
  )
}

function Growth({ data }: { data: PeopleData }) {
  const { filters } = useAppState()
  const [ref, { width }] = useSize<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)
  const H = 300, m = { t: 12, r: 120, b: 28, l: 44 }
  const specials = data.domains.filter((d) => d !== 'General chemistry')
  const { rows, n } = useMemo(() => {
    const rows = decades().map((d) => ({ decade: d, total: 0, ...Object.fromEntries(specials.map((s) => [s, 0])) } as Record<string, number>))
    let n = 0
    for (const p of data.people) {
      if (!matches(p, { ...filters, domain: null }, false) || p.by === null || p.by < 1700 || p.by >= 2000) continue
      const r = rows[Math.floor((p.by - 1700) / 10)]
      r.total++; n++
      const doms = new Set(p.occ.map((o) => data.domains[data.occupationDomain[o]]))
      for (const d of doms) if (d in r) r[d]++
    }
    return { rows: rows.filter((r) => r.decade >= 1800), n }
  }, [data, filters, specials])
  const xs = scaleLinear().domain([1800, 1990]).range([m.l, Math.max(m.l + 10, width - m.r)])
  const ys = scaleLinear().domain([0, Math.max(0.05, ...rows.flatMap((r) => specials.map((s) => r.total >= 20 ? r[s] / r.total : 0)))]).nice().range([H - m.b, m.t])
  const ln = (s: string) => line<Record<string, number>>().defined((r) => r.total >= 20).x((r) => xs(r.decade)).y((r) => ys(r[s] / r.total)).curve(curveMonotoneX)(rows) ?? ''
  const hr = hover !== null ? rows.find((r) => r.decade === hover) : null
  const ends = specials.map((s) => { const last = [...rows].reverse().find((r) => r.total >= 20); return { s, y: last ? ys(last[s] / last.total) : 0 } })
    .sort((a, b) => a.y - b.y)
  for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 13) ends[i].y = ends[i - 1].y + 13
  return (
    <ChartFrame id="growth" title="Share of each birth decade holding a specialist label" subtitle="Decades with fewer than 20 chemists hidden"
      n={n} caveat="A person can hold several domains. The generic 'chemist' label is excluded."
      table={<DataTable cols={['Decade', 'Chemists', ...specials]} rows={rows.map((r) => [r.decade, r.total, ...specials.map((s) => r.total ? `${(100 * r[s] / r.total).toFixed(1)}%` : '—')])} />}>
      <div ref={ref} className="relative">
        <svg width={width} height={H} role="img" aria-label="Line chart: life and medicinal chemistry rises most strongly through the 20th century"
          onMouseMove={(e) => { const b = e.currentTarget.getBoundingClientRect(); setHover(Math.min(1990, Math.max(1800, Math.round(xs.invert(e.clientX - b.left) / 10) * 10))) }} onMouseLeave={() => setHover(null)}>
          <g className="grid">{ys.ticks(4).map((t) => <line key={t} x1={m.l} x2={width - m.r} y1={ys(t)} y2={ys(t)} />)}</g>
          <g className="axis">{ys.ticks(4).map((t) => <text key={t} x={m.l - 6} y={ys(t)} dy="0.32em" textAnchor="end">{Math.round(t * 100)}%</text>)}
            {[1800, 1850, 1900, 1950].map((d) => <text key={d} x={xs(d)} y={H - 8} textAnchor="middle">{d}</text>)}</g>
          {specials.map((s) => <path key={s} d={ln(s)} fill="none" stroke={domainColor(s)} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />)}
          {ends.map((e) => <g key={e.s}><circle cx={width - m.r + 6} cy={e.y} r={4} fill={domainColor(e.s)} /><text x={width - m.r + 14} y={e.y} dy="0.32em" fontSize={11} fill="var(--ink)">{e.s.split(' ')[0]}</text></g>)}
          {filters.year >= 1800 && filters.year < 2000 && <line x1={xs(Math.min(1990, filters.year))} x2={xs(Math.min(1990, filters.year))} y1={m.t} y2={H - m.b} stroke="var(--ink)" strokeOpacity={0.5} />}
          {hover !== null && <line x1={xs(hover)} x2={xs(hover)} y1={m.t} y2={H - m.b} stroke="var(--axis)" />}
        </svg>
        {hr && <Tooltip x={xs(hr.decade)} y={20} bounds={width}><p className="font-semibold">Born {hr.decade}s · {fmt(hr.total)}</p>
          {specials.map((s) => <p key={s} className="flex justify-between gap-3"><span>{s}</span><span className="tabular">{hr.total ? `${(100 * hr[s] / hr.total).toFixed(1)}%` : '—'}</span></p>)}</Tooltip>}
      </div>
    </ChartFrame>
  )
}

function Timeline({ spec }: { spec: Spec }) {
  const { filters, openPerson } = useAppState()
  const [ref, { width }] = useSize<HTMLDivElement>()
  const rows = spec.first.filter((f) => f.year_k3 !== null && f.n >= 3 && f.occupation !== 'chemist')
    .sort((a, b) => a.domain.localeCompare(b.domain) || (a.year_k3! - b.year_k3!))
  const rowH = 20, m = { l: Math.min(180, width * 0.35), r: 16, t: 24 }
  const H = rows.length * rowH + m.t + 10
  const xs = scaleLinear().domain([1650, 2000]).range([m.l, Math.max(m.l + 10, width - m.r)])
  return (
    <ChartFrame id="timeline" title="When each specialty emerged" subtitle="Bar starts at the birth year by which ≥ 3 holders exist; dot marks the earliest holder"
      n={rows.reduce((s, r) => s + r.n, 0)} caveat="Labels are applied retroactively by Wikidata editors (e.g. 18th-century 'biochemists'). Read emergence as a label's adoption, not the field's founding."
      table={<DataTable cols={['Specialty', 'Domain', 'Earliest holder', 'Born', '3rd holder born', 'Holders']} rows={rows.map((r) => [r.occupation, r.domain, r.first_person, r.first_year, r.year_k3, r.n])} />}>
      <div ref={ref}>
        <svg width={width} height={H} role="img" aria-label="Timeline of specialty emergence">
          <g className="axis">{[1700, 1750, 1800, 1850, 1900, 1950, 2000].map((d) => <g key={d}><line x1={xs(d)} x2={xs(d)} y1={m.t - 6} y2={H} stroke="var(--grid)" /><text x={xs(d)} y={12} textAnchor="middle">{d}</text></g>)}</g>
          {rows.map((r, i) => {
            const y = m.t + i * rowH + rowH / 2
            const on = r.year_k3! <= filters.year
            return (
              <g key={r.occupation} opacity={on ? 1 : 0.3}>
                <text x={m.l - 8} y={y} dy="0.32em" textAnchor="end" fontSize={11} fill="var(--ink)">{r.occupation}</text>
                <line x1={xs(Math.max(1650, r.year_k3!))} x2={xs(2000)} y1={y} y2={y} stroke={domainColor(r.domain)} strokeWidth={Math.min(10, 2 + Math.log2(r.n))} strokeLinecap="round" />
                {r.first_year >= 1650 && <circle cx={xs(r.first_year)} cy={y} r={4} fill={domainColor(r.domain)} stroke="var(--surface)" strokeWidth={2} className="cursor-pointer" onClick={() => openPerson(r.first_qid)}>
                  <title>{`Earliest: ${r.first_person} (b. ${r.first_year})`}</title></circle>}
              </g>
            )
          })}
          {filters.year < 2000 && <line x1={xs(filters.year)} x2={xs(filters.year)} y1={m.t - 6} y2={H} stroke="var(--ink)" strokeWidth={1.5} />}
        </svg>
      </div>
    </ChartFrame>
  )
}
