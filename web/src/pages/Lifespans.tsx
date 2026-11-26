import { useMemo, useState } from 'react'
import { scaleLinear, scaleLog } from 'd3-scale'
import { area, line, curveStepAfter } from 'd3-shape'
import { fetchJSON, loadMeta, loadPeople, type Meta, type PeopleData, type Person } from '../lib/data'
import { matches, useAppState } from '../lib/state'
import { useAsync, useSize } from '../lib/useAsync'
import { kaplanMeier, type KMResult } from '../lib/km'
import { groupColor } from '../lib/colors'
import { ChartFrame, DataTable, Empty, ErrorState, PageHeader, Skeleton, Tooltip } from '../components/ui'
import { fmt } from '../lib/format'

interface Surv {
  reference_year: number
  cox: { n: number; events: number; concordance: number; references: Record<string, string>; ph_violations: string[]
    terms: { term: string; hr: number; lo: number; hi: number; p: number; ph_p: number | null }[] }
  stratified_cox: { strata: string; n: number; terms: { term: string; hr: number; lo: number; hi: number; p: number }[] }
  logrank: { statistic: number; p: number }[]
}

type Dim = 'era' | 'domain' | 'region' | 'sex' | 'country'
const ERAS: [string, number, number][] = [['1700–1799', 1700, 1799], ['1800–1849', 1800, 1849], ['1850–1899', 1850, 1899], ['1900–1929', 1900, 1929], ['1930–1959', 1930, 1959], ['1960+', 1960, 2100]]

export default function Lifespans() {
  const people = useAsync<PeopleData>(loadPeople)
  const meta = useAsync<Meta>(loadMeta)
  const surv = useAsync<Surv>(() => fetchJSON<Surv>('survival.json'))
  const err = people.error || meta.error || surv.error
  return (
    <>
      <PageHeader kicker="Lifespans" title="How long did chemists live?">
        Kaplan–Meier curves show the share of chemists still alive at each age. Pick up to four groups to compare.
        The curves are recomputed in your browser for whatever filters are active.
      </PageHeader>
      {err ? <ErrorState error={err} retry={() => { people.retry(); meta.retry(); surv.retry() }} />
        : !people.data || !meta.data || !surv.data ? <Skeleton h={520} />
        : <div className="grid gap-6"><KM data={people.data} meta={meta.data} /><Explainer /><Cox surv={surv.data} /></div>}
    </>
  )
}

function groupOf(p: Person, dim: Dim, region: Map<string, string>, data: PeopleData): string | null {
  switch (dim) {
    case 'era': return ERAS.find(([, a, b]) => p.by! >= a && p.by! <= b)?.[0] ?? null
    case 'domain': return data.domains[p.dom]
    case 'region': return p.iso.length ? region.get(p.iso[0]) ?? null : null
    case 'sex': return p.sex === 1 ? 'male' : p.sex === 2 ? 'female' : null
    case 'country': return p.iso.length === 1 ? p.iso[0] : null
  }
}

function KM({ data, meta }: { data: PeopleData; meta: Meta }) {
  const { filters } = useAppState()
  const [dim, setDim] = useState<Dim>('era')
  const [picked, setPicked] = useState<Record<Dim, string[]>>({ era: ['1700–1799', '1850–1899', '1900–1929', '1930–1959'], domain: [], region: [], sex: ['male', 'female'], country: ['USA', 'DEU', 'GBR', 'RUS'] })
  const [hover, setHover] = useState<number | null>(null)
  const [ref, { width }] = useSize<HTMLDivElement>()
  const region = useMemo(() => new Map(meta.countries.map((c) => [c.iso3, c.region])), [meta])
  const cname = useMemo(() => new Map(meta.countries.map((c) => [c.iso3, c.name])), [meta])
  const ref_year = 2026

  const groups = useMemo(() => {
    const m = new Map<string, { d: number[]; e: boolean[] }>()
    for (const p of data.people) {
      if (!p.sv || !matches(p, { ...filters, domain: dim === 'domain' ? null : filters.domain })) continue
      const g = groupOf(p, dim, region, data)
      if (!g) continue
      const v = m.get(g) ?? { d: [], e: [] }
      v.d.push(p.dy !== null ? p.dy - p.by! : ref_year - p.by!); v.e.push(p.dy !== null)
      m.set(g, v)
    }
    return m
  }, [data, filters, dim, region])
  const options = [...groups.entries()].filter(([, v]) => v.d.length >= 30).sort((a, b) => dim === 'era' ? a[0].localeCompare(b[0]) : b[1].d.length - a[1].d.length).map(([k]) => k)
  const sel = (picked[dim].length ? picked[dim] : options.slice(0, 4)).filter((g) => options.includes(g)).slice(0, 4)
  const curves = useMemo(() => sel.map((g) => ({ g, km: kaplanMeier(groups.get(g)!.d, groups.get(g)!.e) as KMResult })), [sel.join('|'), groups])  // eslint-disable-line react-hooks/exhaustive-deps
  const label = (g: string) => dim === 'country' ? cname.get(g) ?? g : g
  const toggle = (g: string) => setPicked((p) => {
    const cur = sel.includes(g) ? sel.filter((x) => x !== g) : [...sel, g].slice(-4)
    return { ...p, [dim]: cur }
  })

  const H = 380, m = { t: 12, r: 16, b: 36, l: 44 }
  const xs = scaleLinear().domain([20, 105]).range([m.l, Math.max(m.l + 10, width - m.r)])
  const ys = scaleLinear().domain([0, 1]).range([H - m.b, m.t])
  return (
    <ChartFrame id="km" title="Share still alive, by age" subtitle="Kaplan–Meier estimate with 95% confidence bands (Greenwood, log–log). Likely-living people are censored at their age in 2026."
      n={curves.reduce((s, c) => s + c.km.n, 0)}
      caveat="Curves stop where fewer than 10 people remain at risk. Survivorship bias: a chemist has to live long enough to become notable, so early-age survival is overstated. Comparisons across eras mix real mortality change with changes in who becomes notable."
      table={<DataTable cols={['Group', 'n', 'Deaths', 'Censored', 'Median age', 'S(60)', 'S(80)']} rows={curves.map((c) => [label(c.g), c.km.n, c.km.events, c.km.n - c.km.events, c.km.median ?? '> 110', c.km.points[60].s.toFixed(3), c.km.points[80].s.toFixed(3)])} />}>
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-xs text-muted" htmlFor="km-dim">Compare by</label>
        <select id="km-dim" value={dim} onChange={(e) => setDim(e.target.value as Dim)} className="rounded-full border border-rule bg-surface px-3 py-1.5 text-xs">
          <option value="era">Birth era</option><option value="domain">Specialty domain</option><option value="region">World region</option>
          <option value="sex">Sex (Wikidata P21)</option><option value="country">Country (single citizenship)</option>
        </select>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Groups (up to 4)">
          {options.slice(0, 16).map((g) => {
            const i = sel.indexOf(g)
            return <button key={g} onClick={() => toggle(g)} aria-pressed={i >= 0}
              className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${i >= 0 ? 'border-ink' : 'border-rule text-muted'}`}>
              {i >= 0 && <i className="inline-block h-2 w-2 rounded-full" style={{ background: groupColor(i) }} />}{label(g)}
              <span className="text-faint tabular">{fmt(groups.get(g)!.d.length)}</span></button>
          })}
        </div>
      </div>
      <div ref={ref} className="relative mt-4">
        {curves.length === 0 ? <Empty>No group has 30+ people under these filters.</Empty> : (
          <svg width={width} height={H} role="img" aria-label={`Survival curves. Median ages: ${curves.map((c) => `${label(c.g)} ${c.km.median ?? 'over 110'}`).join(', ')}`}
            onMouseMove={(e) => { const b = e.currentTarget.getBoundingClientRect(); setHover(Math.round(Math.min(105, Math.max(20, xs.invert(e.clientX - b.left))))) }} onMouseLeave={() => setHover(null)}>
            <g className="grid">{[0.25, 0.5, 0.75, 1].map((t) => <line key={t} x1={m.l} x2={width - m.r} y1={ys(t)} y2={ys(t)} />)}</g>
            <g className="axis">
              {[0, 0.25, 0.5, 0.75, 1].map((t) => <text key={t} x={m.l - 6} y={ys(t)} dy="0.32em" textAnchor="end">{t * 100}%</text>)}
              {[20, 40, 60, 80, 100].map((t) => <text key={t} x={xs(t)} y={H - 16} textAnchor="middle">{t}</text>)}
              <text x={width - m.r} y={H - 2} textAnchor="end">age</text>
            </g>
            <line x1={m.l} x2={width - m.r} y1={ys(0.5)} y2={ys(0.5)} stroke="var(--axis)" strokeDasharray="0" />
            {curves.map((c, i) => {
              const pts = c.km.points.filter((p) => p.t >= 20 && p.t <= Math.min(105, c.km.tEnd))
              return (
                <g key={c.g}>
                  <path d={area<typeof pts[0]>().x((p) => xs(p.t)).y0((p) => ys(p.lo)).y1((p) => ys(p.hi)).curve(curveStepAfter)(pts) ?? ''} fill={groupColor(i)} fillOpacity={0.12} />
                  <path d={line<typeof pts[0]>().x((p) => xs(p.t)).y((p) => ys(p.s)).curve(curveStepAfter)(pts) ?? ''} fill="none" stroke={groupColor(i)} strokeWidth={2} />
                  {c.km.median !== null && <circle cx={xs(c.km.median)} cy={ys(0.5)} r={4} fill={groupColor(i)} stroke="var(--surface)" strokeWidth={2} />}
                </g>
              )
            })}
            {hover !== null && <line x1={xs(hover)} x2={xs(hover)} y1={m.t} y2={H - m.b} stroke="var(--axis)" />}
          </svg>
        )}
        {hover !== null && curves.length > 0 && (
          <Tooltip x={xs(hover)} y={30} bounds={width}>
            <p className="font-semibold">At age {hover}</p>
            {curves.map((c, i) => { const p = c.km.points[hover]; if (hover > c.km.tEnd) return <p key={c.g} className="text-faint">{label(c.g)}: fewer than 10 at risk</p>; return (
              <p key={c.g} className="flex items-center justify-between gap-3"><span className="flex items-center gap-1.5"><i className="inline-block h-2 w-2 rounded-full" style={{ background: groupColor(i) }} />{label(c.g)}</span>
                <span className="tabular">{(p.s * 100).toFixed(1)}% <span className="text-faint">({fmt(p.atRisk)} at risk)</span></span></p>) })}
          </Tooltip>
        )}
      </div>
      <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted" aria-label="Legend with median survival">
        {curves.map((c, i) => <li key={c.g} className="flex items-center gap-1.5"><i className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: groupColor(i) }} />
          {label(c.g)} · median <b className="text-ink tabular">{c.km.median ?? '> 110'}</b> · n {fmt(c.km.n)}, {fmt(c.km.n - c.km.events)} censored</li>)}
      </ul>
    </ChartFrame>
  )
}

function Explainer() {
  return (
    <section className="grid gap-4 rounded-2xl border border-rule bg-surface p-6 text-sm leading-relaxed sm:grid-cols-3">
      <div><h2 className="font-display text-xl">Censoring, in plain English</h2>
        <p className="mt-2 text-muted">A chemist born in 1950 with no death date is very probably alive. We don't know their lifespan, only that it's <i>at least</i> 76 years. Kaplan–Meier counts them as "at risk" up to age 76 and then lets them leave the sample without recording a death. Dropping them would bias the curve downward; treating them as dead at 76 would be worse.</p></div>
      <div><h2 className="font-display text-xl">Who is excluded</h2>
        <p className="mt-2 text-muted">People born before 1700. People born in 1916 or earlier with no death date: they are almost certainly dead, so their missing date is a data gap, not censoring. Lifespans over 110 or under 15, which are date errors.</p></div>
      <div><h2 className="font-display text-xl">What this is not</h2>
        <p className="mt-2 text-muted">It isn't a life table for scientists. To appear here, someone had to achieve notability, which usually takes decades. That is <i>immortal-time bias</i>: early deaths are under-counted, most of all in older eras.</p></div>
    </section>
  )
}

function Cox({ surv }: { surv: Surv }) {
  const [ref, { width }] = useSize<HTMLDivElement>()
  const terms = surv.cox.terms
  const nice = (t: string) => t.replace('surv_era_', 'Born ').replace('primary_domain_', '').replace('region_', '').replace('multi_country', 'More than one citizenship').replace('female', 'Female (vs male)')
  const rowH = 24, m = { l: Math.min(240, width * 0.45), r: 70, t: 10 }
  const H = terms.length * rowH + 40
  const xs = scaleLog().domain([0.25, 4]).range([m.l, Math.max(m.l + 10, width - m.r)]).clamp(true)
  return (
    <ChartFrame id="cox" title="Cox proportional-hazards model" subtitle={`Hazard ratio of death with 95% CI. HR < 1 means longer-lived. References: ${Object.entries(surv.cox.references).map(([k, v]) => `${k.replace('surv_era', 'era').replace('primary_domain', 'domain')} = ${v}`).join(', ')}.`}
      n={`${fmt(surv.cox.n)} (${fmt(surv.cox.events)} deaths); concordance ${surv.cox.concordance.toFixed(3)}`}
      caveat={`Proportional-hazards check (Schoenfeld residuals, rank time): violated (p < 0.01) for ${surv.cox.ph_violations.map(nice).join(', ') || 'none'}. A model stratified by birth era gives domain/sex/migration HRs that don't rely on PH for era. Descriptive only, because of notability selection.`}
      table={<DataTable cols={['Term', 'HR', '95% CI', 'p', 'PH test p']} rows={terms.map((t) => [nice(t.term), t.hr.toFixed(2), `${t.lo.toFixed(2)}–${t.hi.toFixed(2)}`, t.p < 0.001 ? '<0.001' : t.p.toFixed(3), t.ph_p === null ? '—' : t.ph_p < 0.001 ? '<0.001' : t.ph_p.toFixed(3)])} />}>
      <div ref={ref}>
        <svg width={width} height={H} role="img" aria-label="Forest plot of hazard ratios">
          <line x1={xs(1)} x2={xs(1)} y1={0} y2={H - 26} stroke="var(--axis)" />
          <g className="axis">{[0.25, 0.5, 1, 2, 4].map((t) => <text key={t} x={xs(t)} y={H - 8} textAnchor="middle">{t}</text>)}</g>
          {terms.map((t, i) => {
            const y = m.t + i * rowH + rowH / 2
            const viol = surv.cox.ph_violations.includes(t.term)
            return (
              <g key={t.term}>
                <text x={m.l - 10} y={y} dy="0.32em" textAnchor="end" fontSize={12} fill="var(--ink)">{nice(t.term)}{viol ? ' †' : ''}</text>
                <line x1={xs(t.lo)} x2={xs(t.hi)} y1={y} y2={y} stroke="var(--ink)" strokeWidth={2} strokeLinecap="round" />
                <circle cx={xs(t.hr)} cy={y} r={5} fill={t.p < 0.05 ? 'var(--s1)' : 'var(--surface)'} stroke="var(--s1)" strokeWidth={2} />
                <text x={width - m.r + 8} y={y} dy="0.32em" fontSize={11} fill="var(--muted)" className="tabular">{t.hr.toFixed(2)}</text>
              </g>
            )
          })}
        </svg>
        <p className="mt-2 text-xs text-muted">Filled = p &lt; 0.05. † = proportional-hazards assumption violated; read that HR as an average over age.
          {' '}Stratified by birth era: {surv.stratified_cox.terms.map((t) => `${nice(t.term)} ${t.hr.toFixed(2)} (${t.lo.toFixed(2)}–${t.hi.toFixed(2)})`).join('; ')}.</p>
      </div>
    </ChartFrame>
  )
}
