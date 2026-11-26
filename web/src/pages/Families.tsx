import { useEffect, useMemo, useRef, useState } from 'react'
import { hierarchy, tree as d3tree, type HierarchyPointNode } from 'd3-hierarchy'
import { select } from 'd3-selection'
import { zoom as d3zoom, zoomIdentity, type ZoomBehavior } from 'd3-zoom'
import { fetchJSON, fold, loadPeople, type PeopleData } from '../lib/data'
import { matches, useAppState } from '../lib/state'
import { useAsync, useSize } from '../lib/useAsync'
import { ChartFrame, DataTable, Empty, ErrorState, PageHeader, Skeleton } from '../components/ui'
import { fmt } from '../lib/format'

interface GRaw {
  n_nodes: number; n_edges: number; n_in_dataset: number; n_components: number[]
  nodes: [string, string, number | null, number, number, number, number, number, number][]
  edges: [string, string][]
  top_pagerank: { qid: string; name: string; birth_year: number | null; descendants: number; pagerank: number; nobel_descendants: number; students: number }[]
  top_nobel_lineages: { qid: string; name: string; birth_year: number | null; descendants: number; nobel_descendants: number; generations: number }[]
  trees: { root: string; name: string; descendants: number; chem_descendants: number; birth_year: number | null; nobel_descendants: number; generations: number }[]
  chemist_families: { root: string; name: string; birth_year: number | null; descendants: number; chem_descendants: number; nobel_descendants: number; generations: number }[]
  top_chemist_mentors: { qid: string; name: string; birth_year: number | null; descendants: number; chem_descendants: number; nobel_descendants: number; students: number }[]
}
interface GNode { id: string; name: string; by: number | null; inData: boolean; nobel: boolean; nc: boolean; desc: number; pr: number; comm: number }
interface Graph { nodes: Map<string, GNode>; kids: Map<string, string[]>; parents: Map<string, string[]>; raw: GRaw }

function build(raw: GRaw): Graph {
  const nodes = new Map<string, GNode>(raw.nodes.map(([id, name, by, i, nb, nc, desc, pr, comm]) => [id, { id, name, by, inData: !!i, nobel: !!nb, nc: !!nc, desc, pr, comm }]))
  const kids = new Map<string, string[]>(), parents = new Map<string, string[]>()
  for (const [a, s] of raw.edges) {
    kids.set(a, [...(kids.get(a) ?? []), s]); parents.set(s, [...(parents.get(s) ?? []), a])
  }
  for (const v of kids.values()) v.sort((x, y) => (nodes.get(x)?.by ?? 9999) - (nodes.get(y)?.by ?? 9999) || x.localeCompare(y))
  return { nodes, kids, parents, raw }
}

export default function Families() {
  const g = useAsync<Graph>(() => fetchJSON<GRaw>('genealogy.json').then(build))
  const people = useAsync<PeopleData>(loadPeople)
  return (
    <>
      <PageHeader kicker="Academic family trees" title="Who trained whom">
        Doctoral advisor links from Wikidata, extended upward beyond chemistry so lineages aren't cut short.
        Gold stars mark Nobel laureates; filled stars mark the Nobel Prize in Chemistry.
      </PageHeader>
      {g.error ? <ErrorState error={g.error} retry={g.retry} /> : !g.data || !people.data ? <Skeleton h={600} />
        : g.data.nodes.size === 0 ? <Empty>No advisor data is available yet (enrichment not run).</Empty>
        : <FamilyView g={g.data} people={people.data} />}
    </>
  )
}

function rootOf(g: Graph, id: string): string {
  let cur = id
  const seen = new Set<string>()
  while (g.parents.get(cur)?.length && !seen.has(cur)) { seen.add(cur); cur = g.parents.get(cur)![0] }
  return cur
}

function FamilyView({ g, people }: { g: Graph; people: PeopleData }) {
  const [root, setRoot] = useState(g.raw.chemist_families[0]?.root ?? g.raw.trees[0]?.root ?? '')
  const [focus, setFocus] = useState<string | null>(null)
  useEffect(() => {
    const on = (e: Event) => { const id = (e as CustomEvent<string>).detail; if (g.nodes.has(id)) { setFocus(id); setRoot(rootOf(g, id)) } }
    window.addEventListener('focus-lineage', on)
    return () => window.removeEventListener('focus-lineage', on)
  }, [g])
  return (
    <div className="grid gap-6">
      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label="People in the advisor graph" value={fmt(g.raw.n_nodes)} />
        <Stat label="Advisor → student links" value={fmt(g.raw.n_edges)} />
        <Stat label="…of whom chemists in this dataset" value={fmt(g.raw.n_in_dataset)} />
        <Stat label="Largest connected family" value={fmt(g.raw.n_components[0] ?? 0)} />
      </div>
      <TreeView g={g} people={people} root={root} setRoot={setRoot} focus={focus} setFocus={setFocus} />
      <Trace g={g} />
      <div className="grid gap-6 lg:grid-cols-3">
        <ChartFrame title="Chemists with the most chemist descendants" subtitle="Academic descendants who are themselves in this dataset" n={g.raw.n_in_dataset} caveat="Only links recorded in Wikidata.">
          <DataTable cols={['Chemist', 'Born', 'Students', 'Chemist descendants', 'Nobel descendants']} rows={g.raw.top_chemist_mentors.slice(0, 15).map((r) => [r.name, r.birth_year, r.students, r.chem_descendants, r.nobel_descendants])} />
        </ChartFrame>
        <ChartFrame title="Most central mentors (PageRank)" subtitle="Credit flows from students to advisors, recursively" n={g.raw.n_nodes} caveat="Only links recorded in Wikidata.">
          <DataTable cols={['Mentor', 'Born', 'Students', 'Descendants', 'PageRank ×10⁴']} rows={g.raw.top_pagerank.slice(0, 15).map((r) => [r.name, r.birth_year, r.students, r.descendants, (r.pagerank * 1e4).toFixed(1)])} />
        </ChartFrame>
        <ChartFrame title="Nobel-producing lineages" subtitle="Nobel laureates (any prize) among academic descendants" n={g.raw.n_nodes} caveat="Ancestors outside chemistry included.">
          <DataTable cols={['Ancestor', 'Born', 'Descendants', 'Generations', 'Nobel descendants']} rows={g.raw.top_nobel_lineages.slice(0, 15).map((r) => [r.name, r.birth_year, r.descendants, r.generations, r.nobel_descendants])} />
        </ChartFrame>
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return <div className="rounded-2xl border border-rule bg-surface p-4"><p className="text-xs text-muted">{label}</p><p className="font-display mt-1 text-3xl tabular">{value}</p></div>
}

interface TNode { id: string; children?: TNode[]; hidden?: number }

function TreeView({ g, people, root, setRoot, focus, setFocus }: { g: Graph; people: PeopleData; root: string; setRoot: (r: string) => void; focus: string | null; setFocus: (f: string | null) => void }) {
  const { filters, openPerson } = useAppState()
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [treeSet, setTreeSet] = useState<'founders' | 'roots'>('founders')
  const [ref, { width }] = useSize<HTMLDivElement>()
  const svgRef = useRef<SVGSVGElement>(null)
  const gRef = useRef<SVGGElement>(null)
  const zoomRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null)
  const H = 560

  const pathToFocus = useMemo(() => {
    const s = new Set<string>()
    if (!focus) return s
    let cur: string | undefined = focus
    while (cur && !s.has(cur)) { s.add(cur); cur = g.parents.get(cur)?.[0] }
    return s
  }, [focus, g])
  useEffect(() => {
    // Open breadth-first from the root until ~80 nodes are visible, plus the path to the focused person.
    const s = new Set<string>(pathToFocus)
    const q = [root]; let visible = 1
    const seen = new Set([root])
    while (q.length && visible < 80) {
      const id = q.shift()!
      const kids = (g.kids.get(id) ?? []).filter((k) => !seen.has(k))
      s.add(id); visible += kids.length
      kids.forEach((k) => { seen.add(k); q.push(k) })
    }
    setOpen(s)
  }, [root, pathToFocus, g])

  const data = useMemo(() => {
    const seen = new Set<string>()
    const rec = (id: string, depth: number): TNode => {
      seen.add(id)
      const kids = (g.kids.get(id) ?? []).filter((k) => !seen.has(k))
      const expand = open.has(id) || (depth === 0)
      if (!expand) return { id, hidden: kids.length }
      kids.forEach((k) => seen.add(k))
      return { id, children: kids.map((k) => { seen.delete(k); return rec(k, depth + 1) }) }
    }
    return rec(root, 0)
  }, [g, root, open])

  const layout = useMemo(() => {
    const h = hierarchy<TNode>(data)
    return d3tree<TNode>().nodeSize([22, 190])(h)
  }, [data])
  const nodes = layout.descendants()

  useEffect(() => {
    if (!svgRef.current || !gRef.current) return
    const z = d3zoom<SVGSVGElement, unknown>().scaleExtent([0.2, 2.5]).on('zoom', (e) => gRef.current?.setAttribute('transform', e.transform.toString()))
    zoomRef.current = z
    select(svgRef.current).call(z)
    return () => { select(svgRef.current!).on('.zoom', null) }
  }, [])
  useEffect(() => {
    if (!svgRef.current || !zoomRef.current || !width) return
    // Fit the whole visible tree into the viewport (labels need ~170px to the right).
    const xs = nodes.map((n) => n.x), ys = nodes.map((n) => n.y)
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys) + 170]
    // Never shrink below a readable scale; if the tree is bigger than the box, anchor on the root and let people pan.
    const k = Math.max(0.75, Math.min(1.1, (width - 40) / (y1 - y0 + 1), (H - 40) / (x1 - x0 + 1)))
    const rootX = nodes[0].x
    const target = focus ? nodes.find((n) => n.data.id === focus) : null
    const t = target
      ? zoomIdentity.translate(width / 2 - target.y * Math.max(k, 0.8), H / 2 - target.x * Math.max(k, 0.8)).scale(Math.max(k, 0.8))
      : zoomIdentity.translate(24 - y0 * k, (x1 - x0) * k <= H - 40 ? H / 2 - ((x0 + x1) / 2) * k : H / 2 - rootX * k).scale(k)
    select(svgRef.current).call(zoomRef.current.transform, t)
  }, [root, focus, width, nodes.length]) // eslint-disable-line react-hooks/exhaustive-deps

  const dim = (id: string) => {
    const n = g.nodes.get(id)!
    if (n.by !== null && n.by > filters.year) return true
    const p = people.byId.get(id)
    if ((filters.domain !== null || filters.country || filters.status !== 'all') && (!p || !matches(p, filters, false))) return true
    return false
  }
  const toggle = (id: string) => setOpen((o) => { const s = new Set(o); if (s.has(id)) s.delete(id); else s.add(id); return s })
  const rootNode = g.nodes.get(root)
  return (
    <ChartFrame id="tree" title={`Academic family of ${rootNode?.name ?? root}`}
      subtitle={`${fmt(rootNode?.desc ?? 0)} recorded academic descendants. Click +n to expand, a name for details; drag to pan, scroll to zoom.`}
      n={rootNode?.desc} caveat="Each person appears once, under their first-listed advisor. Grey nodes are outside the current filters or born after the scrubber year."
      actions={<PersonPicker g={g} placeholder="Find a person's lineage…" onPick={(id) => { setFocus(id); setRoot(rootOf(g, id)) }} />}>
      <div className="mb-2 flex items-center gap-2 text-xs text-muted">
        <span>Start from</span>
        <div role="radiogroup" className="flex rounded-full border border-rule p-0.5">
          {(['founders', 'roots'] as const).map((m) => <button key={m} role="radio" aria-checked={treeSet === m} onClick={() => setTreeSet(m)}
            className={`rounded-full px-2.5 py-0.5 ${treeSet === m ? 'bg-ink text-paper' : ''}`}>{m === 'founders' ? "Chemistry's founding families" : 'Earliest recorded roots'}</button>)}
        </div>
        <span className="hidden sm:inline">· ranked by descendants who are chemists in this dataset</span>
      </div>
      <div className="mb-3 flex flex-wrap gap-1.5" role="group" aria-label="Largest family trees">
        {(treeSet === 'founders' ? g.raw.chemist_families : g.raw.trees).map((t) => <button key={t.root} onClick={() => { setFocus(null); setRoot(t.root) }} aria-pressed={root === t.root}
          className={`rounded-full border px-2.5 py-1 text-xs ${root === t.root ? 'border-ink bg-ink text-paper' : 'border-rule text-muted hover:text-ink'}`}>
          {t.name}{t.birth_year ? ` (${t.birth_year})` : ''} <span className={`tabular ${root === t.root ? '' : 'text-muted'}`}>{t.chem_descendants} chemists</span></button>)}
      </div>
      <div ref={ref} className="overflow-hidden rounded-xl border border-rule bg-paper">
        <svg ref={svgRef} width={width} height={H} role="tree" aria-label={`Family tree rooted at ${rootNode?.name}`} className="cursor-grab active:cursor-grabbing">
          <g ref={gRef}>
            {layout.links().map((l, i) => (
              <path key={i} d={`M${l.source.y},${l.source.x}C${(l.source.y + l.target.y) / 2},${l.source.x} ${(l.source.y + l.target.y) / 2},${l.target.x} ${l.target.y},${l.target.x}`}
                fill="none" stroke={pathToFocus.has(l.target.data.id) && pathToFocus.has(l.source.data.id) ? 'var(--accent)' : 'var(--axis)'} strokeWidth={pathToFocus.has(l.target.data.id) ? 2.5 : 1} />
            ))}
            {nodes.map((n: HierarchyPointNode<TNode>) => {
              const d = g.nodes.get(n.data.id)!
              const faded = dim(n.data.id)
              return (
                <g key={n.data.id} transform={`translate(${n.y},${n.x})`} opacity={faded ? 0.35 : 1} role="treeitem" aria-label={`${d.name}${d.by ? ` ${d.by}` : ''}${d.nobel ? ' (Nobel laureate)' : ''}`}
                  aria-expanded={n.data.hidden ? false : n.children ? true : undefined} tabIndex={0}
                  onKeyDown={(e) => { if (e.key === 'Enter') toggle(n.data.id); if (e.key === 'i') openPerson(n.data.id) }}>
                  {d.nobel
                    ? <path d="M0,-7 L2,-2 7,-2 3,1.5 4.5,7 0,3.5 -4.5,7 -3,1.5 -7,-2 -2,-2Z" fill={d.nc ? 'var(--highlight)' : 'var(--surface)'} stroke="var(--highlight)" strokeWidth={1.5} />
                    : <circle r={n.data.id === focus ? 6 : 4} fill={d.inData ? 'var(--s1)' : 'var(--other)'} stroke={n.data.id === focus ? 'var(--ink)' : 'var(--surface)'} strokeWidth={2} />}
                  <text x={9} dy="0.32em" fontSize={11} fill="var(--ink)" fontWeight={n.data.id === focus ? 700 : 400} className="cursor-pointer"
                    onClick={() => (d.inData ? openPerson(n.data.id) : window.open(`https://www.wikidata.org/wiki/${n.data.id}`, '_blank'))}>
                    {d.name}{d.by ? <tspan fill="var(--muted)"> {d.by}</tspan> : null}
                  </text>
                  {(n.data.hidden ?? 0) > 0 && <text x={-10} dy="0.32em" textAnchor="end" fontSize={10} fill="var(--accent)" className="cursor-pointer" onClick={() => toggle(n.data.id)}>+{n.data.hidden}</text>}
                  {n.children && n.depth >= 1 && <text x={-10} dy="0.32em" textAnchor="end" fontSize={10} fill="var(--muted)" className="cursor-pointer" onClick={() => toggle(n.data.id)}>−</text>}
                </g>
              )
            })}
          </g>
        </svg>
      </div>
      <p className="mt-2 text-xs text-muted"><span className="inline-block h-2 w-2 rounded-full align-middle" style={{ background: 'var(--s1)' }} /> chemist in this dataset ·
        {' '}<span className="inline-block h-2 w-2 rounded-full align-middle" style={{ background: 'var(--other)' }} /> ancestor outside chemistry · ★ Nobel laureate (filled = Chemistry). Keyboard: Tab to a node, Enter to expand, i for details.</p>
    </ChartFrame>
  )
}

function PersonPicker({ g, onPick, placeholder }: { g: Graph; onPick: (id: string) => void; placeholder: string }) {
  const [q, setQ] = useState('')
  const [openList, setOpenList] = useState(false)
  const list = useMemo(() => {
    const k = fold(q.trim())
    if (k.length < 2) return []
    const out: GNode[] = []
    for (const n of g.nodes.values()) { if (fold(n.name).includes(k)) out.push(n); if (out.length > 40) break }
    return out.sort((a, b) => b.desc - a.desc).slice(0, 12)
  }, [q, g])
  return (
    <div className="relative">
      <input value={q} onChange={(e) => { setQ(e.target.value); setOpenList(true) }} onFocus={() => setOpenList(true)} onBlur={() => setTimeout(() => setOpenList(false), 150)}
        placeholder={placeholder} aria-label={placeholder} className="w-56 rounded-full border border-rule bg-surface px-3 py-1.5 text-xs" />
      {openList && list.length > 0 && (
        <ul className="absolute right-0 z-20 mt-1 max-h-72 w-72 overflow-auto rounded-xl border border-rule bg-surface py-1 text-sm shadow-lg" role="listbox">
          {list.map((n) => <li key={n.id} role="option" aria-selected="false"><button className="flex w-full justify-between gap-2 px-3 py-1.5 text-left hover:bg-paper" onMouseDown={() => { onPick(n.id); setQ(n.name); setOpenList(false) }}>
            <span className="truncate">{n.nobel ? '★ ' : ''}{n.name}</span><span className="text-xs text-muted tabular">{n.by ?? ''}</span></button></li>)}
        </ul>
      )}
    </div>
  )
}

function Trace({ g }: { g: Graph }) {
  const { openPerson } = useAppState()
  const [a, setA] = useState<string | null>(null)
  const [b, setB] = useState<string | null>(null)
  const path = useMemo(() => {
    if (!a || !b) return null
    const prev = new Map<string, string | null>([[a, null]])
    const q = [a]
    while (q.length) {
      const cur = q.shift()!
      if (cur === b) break
      for (const nx of [...(g.kids.get(cur) ?? []), ...(g.parents.get(cur) ?? [])]) if (!prev.has(nx)) { prev.set(nx, cur); q.push(nx) }
    }
    if (!prev.has(b)) return []
    const out: string[] = []
    for (let c: string | null = b; c; c = prev.get(c) ?? null) out.unshift(c)
    return out
  }, [a, b, g])
  return (
    <ChartFrame title="Trace the lineage between two people" subtitle="Shortest chain of advisor–student links, in either direction">
      <div className="flex flex-wrap items-center gap-3">
        <PersonPicker g={g} placeholder="First person…" onPick={setA} />
        <span className="text-muted">↔</span>
        <PersonPicker g={g} placeholder="Second person…" onPick={setB} />
      </div>
      <div className="mt-4" aria-live="polite">
        {path === null ? <p className="text-sm text-muted">Pick two people, e.g. Linus Pauling and Arnold Sommerfeld.</p>
          : path.length === 0 ? <p className="text-sm text-muted">No recorded academic connection between them.</p>
          : (
            <ol className="flex flex-wrap items-center gap-x-2 gap-y-2 text-sm">
              {path.map((id, i) => {
                const n = g.nodes.get(id)!
                const next = path[i + 1]
                const down = next && g.kids.get(id)?.includes(next)
                return (
                  <li key={id} className="flex items-center gap-2">
                    <button onClick={() => n.inData && openPerson(id)} className={`rounded-full border border-rule px-3 py-1 ${n.inData ? 'hover:border-ink' : 'cursor-default'}`}>
                      {n.nobel ? '★ ' : ''}{n.name}{n.by ? <span className="text-muted"> {n.by}</span> : null}</button>
                    {next && <span className="text-xs text-muted" title={down ? 'advised' : 'was advised by'}>{down ? 'advised →' : 'was a student of →'}</span>}
                  </li>
                )
              })}
            </ol>
          )}
        {path && path.length > 0 && <p className="mt-2 text-xs text-faint">{path.length - 1} link{path.length === 2 ? '' : 's'} apart</p>}
      </div>
    </ChartFrame>
  )
}
