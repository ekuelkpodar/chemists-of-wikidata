import { fetchJSON, loadMeta, url, type Meta } from '../lib/data'
import { useAsync } from '../lib/useAsync'
import { DataTable, ErrorState, PageHeader, Skeleton } from '../components/ui'
import { fmt, pct } from '../lib/format'

interface Imp {
  country: { n: number; classes: number; accuracy: Record<string, [number, number]>; macro_f1: Record<string, number>; top3_accuracy_model: number; target: string }
  specialty: { n: number; accuracy: Record<string, [number, number]>; macro_f1: Record<string, number>; unweighted_model?: { accuracy: number; macro_f1: number }; target: string }
  country_confident: number; country_missing: number; anomaly_counts: Record<string, number>
  anomalies: { qid: string; name: string; check: string; detail: string }[]
}

const QUERIES = ['original.rq', 'enrich_relations.rq', 'enrich_attributes.rq', 'enrich_lineage.rq']
const STAGES = [
  ['Raw export', 'chemist.csv · 15,635 card-view rows (never modified)'],
  ['Parse', 'by cell content, not position · QIDs · dates & precision'],
  ['Canonicalise', '291 citizenship labels → modern ISO3 + territory sets · 46 occupations → 7 domains'],
  ['Enrich', 'SPARQL, 200 QIDs per batch, cached: advisors, awards, employers, gender, birthplace'],
  ['Analyse', 'migration · cohorts · specialties · survival · imputation · genealogy · Neo4j export'],
  ['Publish', 'compact JSON + Parquet → this static site (DuckDB-WASM, no backend)'],
]

export default function Methods() {
  const meta = useAsync<Meta>(loadMeta)
  const imp = useAsync<Imp>(() => fetchJSON<Imp>('imputation.json'))
  const queries = useAsync(() => Promise.all(QUERIES.map((q) => fetch(url(`queries/${q}`)).then((r) => (r.ok ? r.text() : `# ${q} unavailable`)))))
  const m = meta.data
  return (
    <>
      <PageHeader kicker="Data & methods" title="How this was made, and what it can't tell you">
        Everything here can be rebuilt from one command. Every number is computed from Wikidata; nothing is hand-entered.
      </PageHeader>
      <div className="grid gap-10">
        <section aria-labelledby="pipe">
          <h2 id="pipe" className="font-display text-2xl">Pipeline</h2>
          <ol className="mt-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {STAGES.map(([t, d], i) => (
              <li key={t} className="relative rounded-2xl border border-rule bg-surface p-4">
                <p className="text-xs text-accent tabular">{String(i + 1).padStart(2, '0')}</p>
                <p className="mt-1 font-semibold">{t}</p><p className="mt-1 text-xs leading-relaxed text-muted">{d}</p>
                {i < STAGES.length - 1 && <span aria-hidden="true" className="absolute -right-2.5 top-1/2 hidden -translate-y-1/2 text-faint lg:block">→</span>}
              </li>
            ))}
          </ol>
        </section>

        <section aria-labelledby="qual" className="grid gap-6 lg:grid-cols-2">
          <div>
            <h2 id="qual" className="font-display text-2xl">Data quality</h2>
            {meta.error ? <ErrorState error={meta.error} retry={meta.retry} /> : !m ? <Skeleton h={300} /> : (
              <>
                <p className="mt-3 text-sm leading-relaxed text-muted">
                  {fmt(m.quality.raw.rows)} raw rows (one per person × country × occupation) collapse to {fmt(m.n_people)} people. In {m.quality.raw.misaligned_rows} rows
                  the field keys were out of step with their values, so every cell is parsed by its content. Quality problems are flagged, never silently dropped.
                </p>
                <div className="mt-4 rounded-2xl border border-rule bg-surface p-4">
                  <DataTable cols={['Field', 'Filled']} rows={Object.entries(m.quality.fill_rates_pct).map(([k, v]) => [k.replace('_', ' '), `${v}%`])} />
                </div>
                <div className="mt-4 max-h-80 overflow-auto rounded-2xl border border-rule bg-surface p-4">
                  <DataTable cols={['Flag', 'People', 'Meaning']} rows={Object.entries(m.quality.flags).map(([k, v]) => [k, v, m.quality.flag_definitions[k] ?? ''])} />
                </div>
              </>
            )}
          </div>
          <div>
            <h2 className="font-display text-2xl">Limitations</h2>
            <ul className="mt-3 space-y-3 text-sm leading-relaxed">
              <li><b>Notability bias.</b> <span className="text-muted">Only people with both a Wikidata item and an English Wikipedia article are included. That over-represents anglophone, Western and 20th-century chemists, and men. Shares describe <i>notable</i> chemists.</span></li>
              <li><b>Western and anglophone bias.</b> <span className="text-muted">English Wikipedia covers American and British chemists far more thoroughly than Chinese, Russian or Japanese ones. The rise of the US is real but exaggerated.</span></li>
              <li><b>Date precision.</b> <span className="text-muted">Dates shown as "1 January" are year-precision values in Wikidata; {m ? fmt(m.quality.flags.birth_year_precision) : '…'} birth dates are year-only. Real 1 January birthdays can't be told apart.</span></li>
              <li><b>Citizenship ≠ residence.</b> <span className="text-muted">Migration needs a change of citizenship (P27) or a birthplace outside every citizenship. Moves without naturalisation are invisible. Historical states map to modern successors through territory sets; border changes between modern states can still look like migration.</span></li>
              <li><b>Survivorship bias.</b> <span className="text-muted">To become notable you have to live long enough. Lifespans are right-censored for the likely living; early-age survival is still overstated.</span></li>
              <li><b>Sparse genealogy.</b> <span className="text-muted">Advisor links (P184/P185) exist for a minority of chemists and cluster around famous labs.</span></li>
              <li><b>Occupation labels are coarse.</b> <span className="text-muted">Most people are only labelled "chemist", so specialty counts are minimums.</span></li>
            </ul>
          </div>
        </section>

        <section aria-labelledby="imp">
          <h2 id="imp" className="font-display text-2xl">Imputation & anomaly detection</h2>
          {imp.error ? <ErrorState error={imp.error} retry={imp.retry} /> : !imp.data ? <Skeleton h={200} /> : (
            <div className="mt-4 grid gap-4 lg:grid-cols-3">
              <div className="rounded-2xl border border-rule bg-surface p-5 text-sm">
                <h3 className="font-semibold">Predicting missing country</h3>
                <p className="mt-1 text-xs text-muted">{imp.data.country.target}; logistic regression on name character n-grams, birth decade, occupations, sex, birthplace and institution words. 5-fold stratified CV, n = {fmt(imp.data.country.n)}.</p>
                <DataTable cols={['Method', 'Accuracy', 'Macro-F1']} rows={[
                  ['Majority class', pct(imp.data.country.accuracy.baseline_majority[0], 1), '—'],
                  ['Birthplace rule', pct(imp.data.country.accuracy.baseline_rule[0], 1), pct(imp.data.country.macro_f1.baseline_rule, 1)],
                  ['Model', pct(imp.data.country.accuracy.model[0], 1), pct(imp.data.country.macro_f1.model, 1)],
                  ['Model, top-3', pct(imp.data.country.top3_accuracy_model, 1), '—'],
                ]} />
                <p className="mt-2 text-xs text-muted">{fmt(imp.data.country_confident)} of {fmt(imp.data.country_missing)} people without a country get a prediction with p ≥ 0.6. Predictions are stored separately and never mixed into the analyses.</p>
              </div>
              <div className="rounded-2xl border border-rule bg-surface p-5 text-sm">
                <h3 className="font-semibold">Predicting specialty</h3>
                <p className="mt-1 text-xs text-muted">{imp.data.specialty.target}; occupation features removed. n = {fmt(imp.data.specialty.n)}.</p>
                <DataTable cols={['Method', 'Accuracy', 'Macro-F1']} rows={[
                  ['Majority class', pct(imp.data.specialty.accuracy.baseline_majority[0], 1), pct(imp.data.specialty.macro_f1.baseline_rule, 1)],
                  ['Model (balanced)', pct(imp.data.specialty.accuracy.model[0], 1), pct(imp.data.specialty.macro_f1.model, 1)],
                  ...(imp.data.specialty.unweighted_model ? [['Model (unweighted)', pct(imp.data.specialty.unweighted_model.accuracy, 1), pct(imp.data.specialty.unweighted_model.macro_f1, 1)]] : []),
                ]} />
                <p className="mt-2 text-xs text-muted">An honest negative result: without occupation text, specialty barely beats the majority class, so we don't impute it.</p>
              </div>
              <div className="rounded-2xl border border-rule bg-surface p-5 text-sm">
                <h3 className="font-semibold">Likely-erroneous dates</h3>
                <p className="mt-1 text-xs text-muted">Rule checks plus a relational check: an advisor born fewer than 15 or more than 80 years before their student.</p>
                <DataTable cols={['Check', 'Flags']} rows={Object.entries(imp.data.anomaly_counts)} />
                <details className="mt-2 text-xs"><summary className="cursor-pointer text-accent">Examples</summary>
                  <ul className="mt-1 space-y-0.5 text-muted">{imp.data.anomalies.filter((a) => a.check === 'advisor_age_gap').slice(0, 10).map((a, i) => <li key={i}>{a.name}: {a.detail}</li>)}</ul></details>
              </div>
            </div>
          )}
        </section>

        <section aria-labelledby="sparql">
          <h2 id="sparql" className="font-display text-2xl">SPARQL queries</h2>
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            {queries.data?.map((q, i) => (
              <figure key={QUERIES[i]} className="rounded-2xl border border-rule bg-surface p-4">
                <figcaption className="mb-2 font-mono text-xs text-muted">queries/{QUERIES[i]}</figcaption>
                <pre className="max-h-72 overflow-auto rounded-xl bg-paper p-3 text-xs leading-relaxed"><code>{q}</code></pre>
              </figure>
            )) ?? <Skeleton h={200} />}
          </div>
        </section>

        <section aria-labelledby="repro" className="grid gap-6 lg:grid-cols-2">
          <div>
            <h2 id="repro" className="font-display text-2xl">Reproduce it</h2>
            <pre className="mt-3 overflow-auto rounded-2xl border border-rule bg-surface p-4 text-xs leading-relaxed"><code>{`git clone <this repo> && cd chemists-of-wikidata
make setup      # uv venv + pinned deps (Python 3.11)
make enrich     # optional: SPARQL pass, cached in data/interim/
make all        # data → analyses + notebooks → web build
cd web && npm run dev`}</code></pre>
            <p className="mt-3 text-sm text-muted">The enrichment step is optional: the pipeline runs offline from the cached SPARQL responses committed to the repo.
              A Neo4j-ready knowledge graph (Person, Country, Occupation, Era, Award, Institution) ships in <code>data/processed/neo4j/</code> with a <code>load.cypher</code>.</p>
            {m && <p className="mt-2 text-xs text-faint">Data generated {m.generated}. Enrichment finished {m.enrichment.finished ?? 'n/a'}.</p>}
          </div>
          <div>
            <h2 className="font-display text-2xl">License & citation</h2>
            <p className="mt-3 text-sm leading-relaxed text-muted">Data: <a className="text-accent underline underline-offset-2" href="https://www.wikidata.org/wiki/Wikidata:Licensing">Wikidata, CC0 1.0</a>. Names link to Wikipedia (CC BY-SA). Code: MIT.</p>
            <pre className="mt-3 overflow-auto rounded-2xl border border-rule bg-surface p-4 text-xs leading-relaxed"><code>{`Chemists of Wikidata: an interactive explorer of 11,903 chemists (2026).
Data: Wikidata contributors, CC0. Retrieved ${m?.generated ?? '2026'}.`}</code></pre>
          </div>
        </section>
      </div>
    </>
  )
}
