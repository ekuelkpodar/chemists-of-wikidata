import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AsyncDuckDB, AsyncDuckDBConnection } from '@duckdb/duckdb-wasm'
import { loadPeople, url, type PeopleData } from '../lib/data'
import { useAppState, YEAR_MAX } from '../lib/state'
import { useAsync } from '../lib/useAsync'
import { ErrorState, PageHeader, Skeleton } from '../components/ui'

let dbPromise: Promise<{ db: AsyncDuckDB; conn: AsyncDuckDBConnection }> | null = null
async function initDB() {
  if (!dbPromise) {
    dbPromise = (async () => {
      const duckdb = await import('@duckdb/duckdb-wasm')
      const bundle = await duckdb.selectBundle(duckdb.getJsDelivrBundles())
      const workerUrl = URL.createObjectURL(new Blob([`importScripts("${bundle.mainWorker!}");`], { type: 'text/javascript' }))
      const db = new duckdb.AsyncDuckDB(new duckdb.VoidLogger(), new Worker(workerUrl))
      await db.instantiate(bundle.mainModule, bundle.pthreadWorker)
      URL.revokeObjectURL(workerUrl)
      const abs = new URL(url('data/chemists.parquet'), window.location.href).href
      const buf = new Uint8Array(await (await fetch(abs)).arrayBuffer())
      await db.registerFileBuffer('chemists.parquet', buf)
      const conn = await db.connect()
      await conn.query(`CREATE VIEW chemists AS SELECT * FROM read_parquet('chemists.parquet')`)
      return { db, conn }
    })()
    dbPromise.catch(() => { dbPromise = null })
  }
  return dbPromise
}

const PRESETS: { label: string; sql: string }[] = [
  { label: 'Current filters', sql: '' },
  { label: 'Longest-lived chemists', sql: `SELECT name, birth_year, death_year, lifespan, countries\nFROM chemists\nWHERE lifespan IS NOT NULL AND quality_flags NOT LIKE '%lifespan_over_110%'\nORDER BY lifespan DESC\nLIMIT 50;` },
  { label: 'Nobel laureates in Chemistry', sql: `SELECT name, birth_year, death_year, iso3, primary_domain\nFROM chemists WHERE nobel_chemistry\nORDER BY birth_year;` },
  { label: 'Chemists per country (top 25)', sql: `SELECT unnest(string_split(iso3, '|')) AS country, count(*) AS chemists\nFROM chemists WHERE iso3 IS NOT NULL\nGROUP BY 1 ORDER BY 2 DESC LIMIT 25;` },
  { label: 'Women by birth decade', sql: `SELECT (birth_year // 10) * 10 AS decade,\n       count(*) FILTER (WHERE sex = 'female') AS women,\n       count(*) AS total,\n       round(100.0 * women / total, 1) AS pct_women\nFROM chemists WHERE birth_year BETWEEN 1800 AND 1999\nGROUP BY 1 ORDER BY 1;` },
  { label: 'Most students (Wikidata P185/P184)', sql: `SELECT name, birth_year, n_students, n_awards\nFROM chemists ORDER BY n_students DESC LIMIT 30;` },
  { label: 'Median lifespan by era', sql: `SELECT era, count(*) AS n, median(lifespan) AS median_lifespan\nFROM chemists WHERE lifespan BETWEEN 15 AND 110\nGROUP BY era ORDER BY era;` },
]

function filterSQL(f: ReturnType<typeof useAppState>['filters'], domains: string[]): string {
  const w: string[] = []
  if (f.year < YEAR_MAX) w.push(`birth_year <= ${f.year}`)
  if (f.domain !== null) w.push(`primary_domain = '${domains[f.domain].replace(/'/g, "''")}'`)
  if (f.country) w.push(`'${f.country}' = ANY(string_split(iso3, '|'))`)
  if (f.status === 'living') w.push('is_living_likely')
  if (f.status === 'deceased') w.push('death_year IS NOT NULL')
  return `SELECT name, birth_year, death_year, lifespan, countries, occupations, primary_domain, sex, n_awards, qid\nFROM chemists${w.length ? `\nWHERE ${w.join('\n  AND ')}` : ''}\nORDER BY birth_year NULLS LAST\nLIMIT 1000;`
}

type Row = Record<string, unknown>

export default function Explorer() {
  const { filters, openPerson } = useAppState()
  const people = useAsync<PeopleData>(loadPeople)
  const db = useAsync(initDB)
  const [sql, setSql] = useState('')
  const [edited, setEdited] = useState(false)
  const [res, setRes] = useState<{ cols: string[]; rows: Row[]; ms: number } | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [sort, setSort] = useState<{ col: string; dir: 1 | -1 } | null>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => { if (people.data && !edited) setSql(filterSQL(filters, people.data.domains)) }, [filters, people.data, edited])

  const run = useCallback(async (q: string) => {
    if (!db.data || !q.trim()) return
    setRunning(true); setErr(null)
    const t0 = performance.now()
    try {
      const t = await db.data.conn.query(q)
      const cols = t.schema.fields.map((f) => f.name)
      const rows = t.toArray().map((r) => {
        const o = r.toJSON() as Row
        for (const k of cols) if (typeof o[k] === 'bigint') o[k] = Number(o[k])
        return o
      })
      setRes({ cols, rows, ms: performance.now() - t0 }); setSort(null)
    } catch (e) { setErr((e as Error).message) } finally { setRunning(false) }
  }, [db.data])
  useEffect(() => { if (db.data && sql && !edited) run(sql) }, [db.data, sql, edited, run])

  const sorted = useMemo(() => {
    if (!res || !sort) return res?.rows ?? []
    return [...res.rows].sort((a, b) => {
      const x = a[sort.col], y = b[sort.col]
      if (x === y) return 0
      if (x === null || x === undefined) return 1
      if (y === null || y === undefined) return -1
      return (x < y ? -1 : 1) * sort.dir
    })
  }, [res, sort])

  const download = () => {
    if (!res) return
    const esc = (v: unknown) => { const s = v === null || v === undefined ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
    const csv = [res.cols.join(','), ...sorted.map((r) => res.cols.map((c) => esc(r[c])).join(','))].join('\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = 'chemists-query.csv'; a.click()
  }

  return (
    <>
      <PageHeader kicker="Explorer" title="Query the dataset yourself">
        DuckDB runs in your browser, compiled to WebAssembly, over the processed Parquet file (one row per chemist). The query follows the global filters
        until you edit it. Table: <code className="rounded bg-surface px-1.5 py-0.5 text-sm">chemists</code>.
      </PageHeader>
      <div className="grid gap-4">
        <div className="rounded-2xl border border-rule bg-surface p-4">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <label htmlFor="preset" className="text-xs text-muted">Examples</label>
            <select id="preset" className="rounded-full border border-rule bg-surface px-3 py-1.5 text-xs" defaultValue=""
              onChange={(e) => { const p = PRESETS[Number(e.target.value)]; if (!p) return; if (!p.sql) { setEdited(false) } else { setEdited(true); setSql(p.sql); run(p.sql) } }}>
              {PRESETS.map((p, i) => <option key={p.label} value={i}>{p.label}</option>)}
            </select>
            {edited && <button className="text-xs text-accent hover:underline" onClick={() => setEdited(false)}>Reset to filters</button>}
            <span className="ml-auto text-xs text-faint">⌘/Ctrl + Enter to run</span>
          </div>
          <label htmlFor="sql" className="sr-only">SQL query</label>
          <textarea id="sql" ref={taRef} value={sql} spellCheck={false} rows={7}
            onChange={(e) => { setSql(e.target.value); setEdited(true) }}
            onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); run(sql) } }}
            className="w-full resize-y rounded-xl border border-rule bg-paper p-3 font-mono text-[13px] leading-relaxed" />
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <button onClick={() => run(sql)} disabled={!db.data || running} className="rounded-full bg-ink px-4 py-1.5 text-sm text-paper disabled:opacity-50">{running ? 'Running…' : 'Run query'}</button>
            <button onClick={download} disabled={!res?.rows.length} className="rounded-full border border-rule px-4 py-1.5 text-sm disabled:opacity-50">Download CSV</button>
            <span className="text-xs text-muted tabular" aria-live="polite">
              {db.loading ? 'Loading DuckDB-WASM (~6 MB, first time only)…' : res ? `${res.rows.length.toLocaleString()} rows · ${res.ms.toFixed(0)} ms` : ''}
            </span>
          </div>
        </div>
        {db.error && <ErrorState error={db.error} retry={db.retry} />}
        {err && <div role="alert" className="rounded-xl border border-rule bg-surface p-4 font-mono text-xs text-muted">{err}</div>}
        {db.loading && <Skeleton h={360} />}
        {res && (
          <div className="overflow-auto rounded-2xl border border-rule bg-surface" style={{ maxHeight: 560 }}>
            {res.rows.length === 0 ? <p className="p-6 text-sm text-muted">The query returned no rows.</p> : (
              <table className="w-full text-left text-sm tabular">
                <thead className="sticky top-0 bg-surface text-xs text-muted shadow-[0_1px_0_var(--rule)]">
                  <tr>{res.cols.map((c) => (
                    <th key={c} scope="col" aria-sort={sort?.col === c ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'} className="px-3 py-2 font-medium">
                      <button className="flex items-center gap-1 hover:text-ink" onClick={() => setSort((s) => s?.col === c ? { col: c, dir: s.dir === 1 ? -1 : 1 } : { col: c, dir: 1 })}>
                        {c}{sort?.col === c ? (sort.dir === 1 ? ' ↑' : ' ↓') : ''}</button></th>))}</tr>
                </thead>
                <tbody>
                  {sorted.slice(0, 1000).map((r, i) => (
                    <tr key={i} className="border-t border-rule/60 hover:bg-paper">
                      {res.cols.map((c) => <td key={c} className="max-w-72 truncate px-3 py-1.5">
                        {c === 'name' && typeof r.qid === 'string' ? <button className="text-accent hover:underline" onClick={() => openPerson(r.qid as string)}>{String(r[c])}</button>
                          : r[c] === null || r[c] === undefined ? <span className="text-faint">—</span> : String(r[c])}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>
    </>
  )
}
