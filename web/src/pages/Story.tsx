import { useEffect, useRef, useState } from 'react'
import { scaleLinear } from 'd3-scale'
import { line, curveMonotoneX, curveStepAfter } from 'd3-shape'
import { fetchJSON, loadFindings, loadMeta, type Finding, type Meta } from '../lib/data'
import { useAppState } from '../lib/state'
import { useAsync, useSize } from '../lib/useAsync'
import { countryColor, groupColor } from '../lib/colors'
import { ErrorState, Legend, Skeleton } from '../components/ui'
import { fmt, pct } from '../lib/format'

interface Cog { decades: number[]; totals: number[]; shares: Record<string, number[]>; handoffs: { decade: number; from: string; to: string }[]; names: Record<string, string> }
interface Mig { migrants: { origin: string; dest: string }[]; countries: { iso3: string; name: string }[] }
interface Surv { curves: { group: string; by: string; age: number[]; s: number[]; median: number | null; n: number }[] }
interface Gen { chemist_families: { name: string; birth_year: number | null; chem_descendants: number; generations: number; nobel_descendants: number }[]; n_nodes: number; n_edges: number }

const ORDER = ['handoff', 'migration', 'specialties', 'women', 'survival', 'genealogy']
const ROUTE: Record<string, [string, string]> = {
  handoff: ['/gravity', 'Explore the center of gravity'], migration: ['/migration', 'Open the migration map'],
  specialties: ['/specialties', 'See the specialty tree'], women: ['/explorer', 'Query it in the explorer'],
  survival: ['/lifespans', 'Compare lifespans'], genealogy: ['/families', 'Browse family trees'],
}
const TITLE: Record<string, string> = {
  handoff: 'Paris, then Berlin, then America', migration: 'Talent flowed one way', specialties: 'Chemistry turned toward life',
  women: 'Women: from footnote to a growing share', survival: 'Longer lives, with an asterisk', genealogy: 'Families of ideas',
}

export default function Story() {
  const meta = useAsync<Meta>(loadMeta)
  const findings = useAsync<Finding[]>(loadFindings)
  const cog = useAsync<Cog>(() => fetchJSON<Cog>('cog.json'))
  const mig = useAsync<Mig>(() => fetchJSON<Mig>('migration.json'))
  const surv = useAsync<Surv>(() => fetchJSON<Surv>('survival.json'))
  const gen = useAsync<Gen>(() => fetchJSON<Gen>('genealogy_summary.json'))
  const { navigate } = useAppState()
  const [active, setActive] = useState(0)
  const stepRefs = useRef<(HTMLElement | null)[]>([])
  const steps = (findings.data ?? []).slice().sort((a, b) => ORDER.indexOf(a.id) - ORDER.indexOf(b.id))

  useEffect(() => {
    const io = new IntersectionObserver((es) => {
      for (const e of es) if (e.isIntersecting) setActive(Number((e.target as HTMLElement).dataset.step))
    }, { rootMargin: '-45% 0px -45% 0px' })
    stepRefs.current.forEach((el) => el && io.observe(el))
    return () => io.disconnect()
  }, [steps.length])

  if (meta.error || findings.error) return <ErrorState error={(meta.error || findings.error)!} retry={() => { meta.retry(); findings.retry() }} />
  const m = meta.data
  return (
    <article>
      <section className="grid min-h-[70vh] items-center gap-10 py-6 lg:grid-cols-[1.25fr_1fr]">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent">The science of scientists</p>
          <h1 className="font-display mt-4 text-5xl leading-[1.04] sm:text-7xl">
            {m ? fmt(m.n_people) : <span className="skeleton inline-block h-16 w-64 align-middle" />} chemists.<br />Three centuries.<br />
            <span className="text-muted">One moving center.</span>
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted">
            Every chemist on Wikidata with an English Wikipedia article: born where, citizens of where, trained by whom, and how long they lived.
            The data shows a discipline that moved from France to Germany to the United States, carried by people who moved with it.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <a href="#steps" className="rounded-full bg-ink px-5 py-2.5 text-sm text-paper">Read the story ↓</a>
            <button onClick={() => navigate('/explorer')} className="rounded-full border border-rule px-5 py-2.5 text-sm">Explore the data</button>
          </div>
        </div>
        <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-rule bg-rule">
          {[
            ['Chemists', m?.n_people], ['Countries & predecessors', m?.n_country_labels],
            ['Nobel laureates in Chemistry', m?.n_nobel_chemistry], ['Likely still living', m?.n_living],
          ].map(([k, v]) => (
            <div key={k as string} className="bg-surface p-5"><dt className="text-xs text-muted">{k}</dt>
              <dd className="font-display mt-1 text-4xl tabular">{v === undefined ? <span className="skeleton inline-block h-9 w-20" /> : fmt(v as number)}</dd></div>
          ))}
        </dl>
      </section>

      <section id="steps" className="relative grid gap-10 lg:grid-cols-[1fr_1.15fr]" aria-label="Story">
        <div className="space-y-[42vh] pb-[30vh] pt-[10vh]">
          {!findings.data && <Skeleton h={200} />}
          {steps.map((f, i) => (
            <section key={f.id} data-step={i} ref={(el) => { stepRefs.current[i] = el }} aria-current={active === i ? 'step' : undefined}
              className={`rounded-2xl border border-l-4 bg-surface p-6 transition-colors duration-500 ${active === i ? 'border-rule border-l-accent' : 'border-rule border-l-rule'}`}>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-accent">{i + 1} / {steps.length}</p>
              <h2 className="font-display mt-2 text-3xl leading-tight">{TITLE[f.id] ?? f.id}</h2>
              <p className="mt-3 text-[17px] leading-relaxed">{f.hook}</p>
              <p className="mt-3 text-xs text-faint">n = {fmt(f.n)}. {f.caveat}</p>
              <div className="mt-4 lg:hidden"><StepChart id={f.id} cog={cog.data} mig={mig.data} surv={surv.data} gen={gen.data} finding={f} /></div>
              {ROUTE[f.id] && <button onClick={() => navigate(ROUTE[f.id][0])} className="mt-4 text-sm text-accent hover:underline">{ROUTE[f.id][1]} →</button>}
            </section>
          ))}
        </div>
        <div className="hidden lg:block">
          <div className="sticky top-24 rounded-2xl border border-rule bg-surface p-6" aria-live="polite">
            {steps[active] && <div key={steps[active].id} className="fade-in"><StepChart id={steps[active].id} cog={cog.data} mig={mig.data} surv={surv.data} gen={gen.data} finding={steps[active]} /></div>}
          </div>
        </div>
      </section>
    </article>
  )
}

function StepChart({ id, cog, mig, surv, gen, finding }: { id: string; cog: Cog | null; mig: Mig | null; surv: Surv | null; gen: Gen | null; finding: Finding }) {
  const [ref, { width }] = useSize<HTMLDivElement>()
  const H = 340
  const body = () => {
    if (!width) return null
    if (id === 'handoff') {
      if (!cog) return <Skeleton h={H} />
      const keys = ['FRA', 'DEU', 'GBR', 'USA']
      const idx = cog.decades.map((d, i) => [d, i]).filter(([d, i]) => d >= 1750 && cog.totals[i] >= 15)
      const xs = scaleLinear().domain([1750, 1990]).range([36, width - 70]), ys = scaleLinear().domain([0, 0.5]).range([H - 26, 10])
      return <>
        <h3 className="mb-2 text-sm font-semibold">Share of each birth decade's chemists</h3>
        <svg width={width} height={H} role="img" aria-label="Line chart: France leads in the 1700s, Germany in the mid-1800s, the US from the 1860s">
          <g className="grid">{[0.1, 0.2, 0.3, 0.4, 0.5].map((t) => <line key={t} x1={36} x2={width - 70} y1={ys(t)} y2={ys(t)} />)}</g>
          <g className="axis">{[0, 0.2, 0.4].map((t) => <text key={t} x={30} y={ys(t)} dy="0.32em" textAnchor="end">{pct(t)}</text>)}
            {[1750, 1800, 1850, 1900, 1950].map((t) => <text key={t} x={xs(t)} y={H - 6} textAnchor="middle">{t}</text>)}</g>
          {keys.map((k) => {
            const pts = idx.map(([d, i]) => [d, cog.shares[k]?.[i] ?? 0])
            const smooth = pts.map(([d], j) => { const w = pts.slice(Math.max(0, j - 1), j + 2); return [d, w.reduce((s, p) => s + p[1], 0) / w.length] })
            const last = smooth.at(-1)!
            return <g key={k}><path d={line().x((p) => xs(p[0])).y((p) => ys(p[1])).curve(curveMonotoneX)(smooth as [number, number][]) ?? ''} fill="none" stroke={countryColor(k)} strokeWidth={2.5} />
              <circle cx={xs(last[0])} cy={ys(last[1])} r={4} fill={countryColor(k)} stroke="var(--surface)" strokeWidth={2} />
              <text x={xs(last[0]) + 8} y={ys(last[1])} dy="0.32em" fontSize={12} fill="var(--ink)">{cog.names[k].replace('United ', 'U. ')}</text></g>
          })}
        </svg>
        <p className="mt-2 text-xs text-faint">3-decade smoothing; decades with &lt; 15 chemists omitted.</p></>
    }
    if (id === 'migration') {
      if (!mig) return <Skeleton h={H} />
      const cnt = new Map<string, number>()
      for (const x of mig.migrants) cnt.set(`${x.origin}>${x.dest}`, (cnt.get(`${x.origin}>${x.dest}`) ?? 0) + 1)
      const name = new Map(mig.countries.map((c) => [c.iso3, c.name.replace('United States', 'US').replace('United Kingdom', 'UK')]))
      const top = [...cnt.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)
      const xs = scaleLinear().domain([0, top[0]?.[1] ?? 1]).range([0, width - 210])
      return <>
        <h3 className="mb-3 text-sm font-semibold">Busiest corridors, birth country → citizenship</h3>
        <ul className="space-y-2" aria-label="Top migration corridors">
          {top.map(([k, v]) => { const [o, d] = k.split('>'); return (
            <li key={k} className="flex items-center gap-2 text-sm"><span className="w-40 shrink-0 truncate text-right">{name.get(o)} → {name.get(d)}</span>
              <span className="h-5 rounded-r" style={{ width: Math.max(3, xs(v)), background: d === 'USA' ? 'var(--s1)' : 'var(--other)' }} /><span className="text-xs text-muted tabular">{v}</span></li>) })}
        </ul>
        <p className="mt-3 text-xs text-faint">Blue = into the United States.</p></>
    }
    if (id === 'survival') {
      if (!surv) return <Skeleton h={H} />
      const cs = surv.curves.filter((c) => c.by === 'surv_era' && ['1700–1799', '1850–1899', '1900–1929'].includes(c.group)).sort((a, b) => a.group.localeCompare(b.group))
      const xs = scaleLinear().domain([20, 105]).range([36, width - 10]), ys = scaleLinear().domain([0, 1]).range([H - 26, 10])
      return <>
        <h3 className="mb-2 text-sm font-semibold">Share still alive by age, by birth era</h3>
        <Legend items={cs.map((c, i) => ({ label: `${c.group} (median ${c.median})`, color: groupColor(i) }))} />
        <svg width={width} height={H} className="mt-2" role="img" aria-label="Survival curves shift right for later birth eras">
          <g className="grid">{[0.25, 0.5, 0.75].map((t) => <line key={t} x1={36} x2={width - 10} y1={ys(t)} y2={ys(t)} />)}</g>
          <g className="axis">{[0, 0.5, 1].map((t) => <text key={t} x={30} y={ys(t)} dy="0.32em" textAnchor="end">{pct(t)}</text>)}
            {[20, 40, 60, 80, 100].map((t) => <text key={t} x={xs(t)} y={H - 6} textAnchor="middle">{t}</text>)}</g>
          {cs.map((c, i) => <path key={c.group} d={line<number>().x((_, j) => xs(c.age[j])).y((s) => ys(s)).curve(curveStepAfter)(c.s) ?? ''} fill="none" stroke={groupColor(i)} strokeWidth={2.5} />)}
        </svg></>
    }
    if (id === 'women') {
      const bd = finding.numbers.by_decade as Record<string, number> | undefined
      if (!bd) return null
      const pts = Object.entries(bd).map(([d, v]) => [Number(d), v] as [number, number]).filter(([d]) => d <= 1990)
      const xs = scaleLinear().domain([1850, 1990]).range([36, width - 10]), ys = scaleLinear().domain([0, Math.max(0.3, ...pts.map((p) => p[1]))]).range([H - 26, 10])
      return <>
        <h3 className="mb-2 text-sm font-semibold">Women as a share of chemists, by birth decade</h3>
        <svg width={width} height={H} role="img" aria-label={`Share of women by birth decade, from ${pct(pts[0]?.[1] ?? 0)} to ${pct(pts.at(-1)?.[1] ?? 0)}`}>
          <g className="grid">{ys.ticks(4).map((t) => <line key={t} x1={36} x2={width - 10} y1={ys(t)} y2={ys(t)} />)}</g>
          <g className="axis">{ys.ticks(4).map((t) => <text key={t} x={30} y={ys(t)} dy="0.32em" textAnchor="end">{pct(t)}</text>)}
            {[1850, 1900, 1950].map((t) => <text key={t} x={xs(t)} y={H - 6} textAnchor="middle">{t}</text>)}</g>
          <path d={line().x((p) => xs(p[0])).y((p) => ys(p[1])).curve(curveMonotoneX)(pts) ?? ''} fill="none" stroke="var(--s7)" strokeWidth={2.5} />
          {pts.filter(([d]) => d % 50 === 0 || d === pts.at(-1)![0]).map(([d, v]) => <g key={d}><circle cx={xs(d)} cy={ys(v)} r={4} fill="var(--s7)" stroke="var(--surface)" strokeWidth={2} /><text x={xs(d)} y={ys(v) - 10} textAnchor="middle" fontSize={11} fill="var(--ink)">{pct(v)}</text></g>)}
        </svg></>
    }
    if (id === 'specialties') {
      const a = finding.numbers.life_share_1850_79 as number, b = finding.numbers.life_share_1940_69 as number
      return <>
        <h3 className="mb-4 text-sm font-semibold">Life & medicinal chemistry, share of birth cohort</h3>
        {[['Born 1850–1879', a], ['Born 1940–1969', b]].map(([k, v]) => (
          <div key={k as string} className="mb-5"><div className="flex justify-between text-sm"><span>{k}</span><b className="font-display text-2xl tabular">{pct(v as number)}</b></div>
            <div className="mt-1 h-6 overflow-hidden rounded-full bg-paper"><div className="h-full rounded-full transition-[width] duration-700" style={{ width: pct(v as number), background: 'var(--s1)' }} /></div></div>
        ))}
        <p className="text-xs text-faint">Biochemists, pharmacologists, toxicologists, chemical biologists and related labels.</p></>
    }
    if (id === 'genealogy') {
      if (!gen) return <Skeleton h={H} />
      return <>
        <h3 className="mb-3 text-sm font-semibold">Chemistry's largest founding families: chemist descendants</h3>
        <ol className="space-y-1.5 text-sm">{gen.chemist_families.map((t) => (
          <li key={t.name} className="flex items-center gap-2"><span className="w-48 shrink-0 truncate">{t.name}{t.birth_year ? <span className="text-muted"> {t.birth_year}</span> : null}</span>
            <span className="h-4 rounded-r" style={{ width: `${(t.chem_descendants / gen.chemist_families[0].chem_descendants) * 50}%`, background: 'var(--s1)' }} />
            <span className="text-xs text-muted tabular">{t.chem_descendants}{t.nobel_descendants ? ` · ★${t.nobel_descendants}` : ''}</span></li>))}</ol>
        <p className="mt-3 text-xs text-faint">{fmt(gen.n_edges)} advisor links among {fmt(gen.n_nodes)} people. A founder is never a descendant of a founder listed above them. ★ = Nobel laureates among descendants.</p></>
    }
    return null
  }
  return <div ref={ref}>{body()}</div>
}
