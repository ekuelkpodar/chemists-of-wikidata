import { useEffect, useRef } from 'react'
import { loadDetail, loadPeople, type PersonDetail, type PeopleData } from '../lib/data'
import { useAppState } from '../lib/state'
import { useAsync } from '../lib/useAsync'
import { years } from '../lib/format'

const FLAG_TEXT: Record<string, string> = {
  birth_year_precision: 'birth date known to the year only', death_year_precision: 'death date known to the year only',
  lifespan_over_110: 'implausible lifespan (>110)', lifespan_under_15: 'implausible lifespan (<15)',
  conflicting_birth_dates: 'conflicting birth dates in Wikidata', conflicting_death_dates: 'conflicting death dates in Wikidata',
  missing_country: 'no country of citizenship', missing_birth: 'no birth date', suspected_non_human: 'not a real chemist',
  not_instance_of_human: 'Wikidata item is not a human', death_missing_presumed_dead: 'death date missing',
}

export function PersonDrawer() {
  const { personId, openPerson, navigate } = useAppState()
  const panel = useRef<HTMLDivElement>(null)
  const detail = useAsync<PersonDetail | undefined>(() => (personId ? loadDetail(personId) : Promise.resolve(undefined)), [personId])
  const people = useAsync<PeopleData>(loadPeople)
  useEffect(() => {
    if (!personId) return
    const prev = document.activeElement as HTMLElement | null
    panel.current?.focus()
    const on = (e: KeyboardEvent) => { if (e.key === 'Escape') openPerson(null) }
    window.addEventListener('keydown', on)
    return () => { window.removeEventListener('keydown', on); prev?.focus?.() }
  }, [personId, openPerson])
  if (!personId) return null
  const p = people.data?.byId.get(personId)
  const d = detail.data
  const link = (id: string, name: string, inData: boolean) => inData
    ? <button className="text-left text-accent underline-offset-2 hover:underline" onClick={() => openPerson(id)}>{name}</button>
    : <a className="text-left underline-offset-2 hover:underline" href={`https://www.wikidata.org/wiki/${id}`} target="_blank" rel="noreferrer">{name} <span className="text-faint">↗</span></a>
  return (
    <div className="fixed inset-0 z-40" role="presentation">
      <div className="absolute inset-0 bg-black/30" onClick={() => openPerson(null)} />
      <aside ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="drawer-title"
        className="fade-in absolute right-0 top-0 h-full w-full max-w-md overflow-y-auto border-l border-rule bg-surface p-6 shadow-2xl outline-none">
        <button onClick={() => openPerson(null)} className="absolute right-4 top-4 rounded-full border border-rule px-2.5 py-1 text-sm" aria-label="Close">✕</button>
        {detail.loading && <div className="space-y-3 pt-8"><div className="skeleton h-8 w-2/3" /><div className="skeleton h-4 w-1/2" /><div className="skeleton h-40" /></div>}
        {detail.error && <p className="pt-8 text-sm text-muted">Couldn't load this person.</p>}
        {!detail.loading && !d && !detail.error && <p className="pt-8 text-sm text-muted">No record for {personId}.</p>}
        {d && (
          <div className="space-y-5 pt-6">
            <div>
              <h2 id="drawer-title" className="font-display text-3xl leading-tight">{d.n}</h2>
              <p className="mt-1 text-sm text-muted tabular">
                {d.bd ?? 'birth unknown'} — {d.dd ?? (d.liv ? 'likely living' : 'death unknown')}
                {p?.nobel && <span className="ml-2 rounded-full bg-paper px-2 py-0.5 text-xs text-ink">★ Nobel Prize in Chemistry</span>}
              </p>
              {d.bp && <p className="text-sm text-muted">Born in {d.bp}{d.sex ? ` · ${d.sex}` : ''}</p>}
            </div>
            <Section title="Countries of citizenship">{d.c?.join(' · ') || '—'}</Section>
            <Section title="Occupations">{d.o?.join(' · ') || '—'}</Section>
            {(d.adv?.length || d.stu?.length) ? (
              <Section title="Academic family">
                {d.adv?.length ? <p><span className="text-muted">Advisors: </span>{d.adv.map(([id, n, i], k) => <span key={id}>{k > 0 && ', '}{link(id, n, i)}</span>)}</p> : null}
                {d.stu?.length ? <p className="mt-1"><span className="text-muted">Students: </span>{d.stu.map(([id, n, i], k) => <span key={id}>{k > 0 && ', '}{link(id, n, i)}</span>)}</p> : null}
                <button className="mt-2 text-xs text-accent underline-offset-2 hover:underline" onClick={() => { openPerson(null); navigate(`/families`); setTimeout(() => window.dispatchEvent(new CustomEvent('focus-lineage', { detail: personId })), 50) }}>
                  View in family trees →
                </button>
              </Section>
            ) : null}
            {d.aw?.length ? <Section title={`Awards (${d.aw.length})`}><ul className="list-disc space-y-0.5 pl-4">{d.aw.slice(0, 15).map(([id, n]) => <li key={id}>{n}</li>)}</ul></Section> : null}
            {d.emp?.length ? <Section title="Employers">{d.emp.join(' · ')}</Section> : null}
            {d.edu?.length ? <Section title="Educated at">{d.edu.join(' · ')}</Section> : null}
            {d.f?.length ? <Section title="Data notes"><ul className="space-y-0.5 text-muted">{d.f.filter((f) => FLAG_TEXT[f]).map((f) => <li key={f}>· {FLAG_TEXT[f]}</li>)}</ul></Section> : null}
            <div className="flex gap-3 border-t border-rule pt-4 text-sm">
              {d.u && <a className="text-accent underline-offset-2 hover:underline" href={d.u} target="_blank" rel="noreferrer">Wikipedia ↗</a>}
              <a className="text-accent underline-offset-2 hover:underline" href={`https://www.wikidata.org/wiki/${personId}`} target="_blank" rel="noreferrer">Wikidata {personId} ↗</a>
            </div>
            {p && <p className="text-xs text-faint tabular">{years(p.by, p.dy, p.living)}</p>}
          </div>
        )}
      </aside>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <section><h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-faint">{title}</h3><div className="text-sm leading-relaxed">{children}</div></section>
}
