import { useEffect, useState } from 'react'
import { loadMeta, type Meta } from '../lib/data'
import { useAppState, YEAR_MAX, YEAR_MIN, useReducedMotion, type Status } from '../lib/state'
import { useAsync } from '../lib/useAsync'

export const ROUTES = [
  { path: '/', label: 'Story' },
  { path: '/migration', label: 'Migration' },
  { path: '/gravity', label: 'Center of gravity' },
  { path: '/specialties', label: 'Specialties' },
  { path: '/lifespans', label: 'Lifespans' },
  { path: '/families', label: 'Family trees' },
  { path: '/explorer', label: 'Explorer' },
  { path: '/methods', label: 'Data & methods' },
]

export function Header() {
  const { route, navigate, setPaletteOpen } = useAppState()
  const [open, setOpen] = useState(false)
  return (
    <header className="sticky top-0 z-30 border-b border-rule bg-paper/90 backdrop-blur">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:rounded focus:bg-surface focus:px-3 focus:py-2">Skip to content</a>
      <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-3 sm:px-6">
        <a href="#/" onClick={(e) => { e.preventDefault(); navigate('/') }} className="font-display shrink-0 text-lg font-semibold">
          Chemists <span className="text-muted">of</span> Wikidata
        </a>
        <nav aria-label="Main" className="hidden flex-1 xl:block">
          <ul className="flex gap-0.5">
            {ROUTES.map((r) => (
              <li key={r.path}>
                <a href={`#${r.path}`} onClick={(e) => { e.preventDefault(); navigate(r.path) }}
                  aria-current={route.path === r.path ? 'page' : undefined}
                  className={`whitespace-nowrap rounded-full px-2.5 py-1.5 text-[13px] transition-colors ${route.path === r.path ? 'bg-ink text-paper' : 'text-muted hover:text-ink'}`}>
                  {r.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <button onClick={() => setPaletteOpen(true)} className="flex items-center gap-2 rounded-full border border-rule bg-surface px-3 py-1.5 text-sm text-muted hover:text-ink" aria-label="Search chemists (Command K)">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
            <span className="hidden sm:inline xl:hidden 2xl:inline">Search 11.9k chemists</span><span className="hidden xl:inline 2xl:hidden">Search</span>
            <kbd className="hidden rounded border border-rule px-1 text-[10px] sm:inline">⌘K</kbd>
          </button>
          <ThemeToggle />
          <button className="rounded-full border border-rule p-2 xl:hidden" aria-expanded={open} aria-controls="mobile-nav" aria-label="Menu" onClick={() => setOpen((o) => !o)}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
          </button>
        </div>
      </div>
      {open && (
        <nav id="mobile-nav" aria-label="Main mobile" className="border-t border-rule px-4 py-2 xl:hidden">
          <ul className="grid grid-cols-2 gap-1 text-sm">
            {ROUTES.map((r) => (
              <li key={r.path}><a href={`#${r.path}`} onClick={(e) => { e.preventDefault(); setOpen(false); navigate(r.path) }}
                aria-current={route.path === r.path ? 'page' : undefined}
                className={`block rounded-lg px-3 py-2 ${route.path === r.path ? 'bg-ink text-paper' : 'text-muted'}`}>{r.label}</a></li>
            ))}
          </ul>
        </nav>
      )}
    </header>
  )
}

function ThemeToggle() {
  const [theme, setTheme] = useState<string | null>(() => document.documentElement.dataset.theme ?? null)
  const dark = theme ? theme === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches
  const toggle = () => {
    const next = dark ? 'light' : 'dark'
    document.documentElement.dataset.theme = next
    try { localStorage.setItem('theme', next) } catch { /* private mode */ }
    setTheme(next)
  }
  return (
    <button onClick={toggle} className="rounded-full border border-rule p-2 text-muted hover:text-ink" aria-label={`Switch to ${dark ? 'light' : 'dark'} theme`}>
      {dark
        ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
        : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" /></svg>}
    </button>
  )
}

/** Persistent bottom bar: time scrubber + global filters. */
export function ControlBar() {
  const { filters, setFilters, playing, setPlaying } = useAppState()
  const reduced = useReducedMotion()
  const meta = useAsync<Meta>(loadMeta)
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    if (!playing) return
    const step = reduced ? 10 : 2
    const id = window.setInterval(() => {
      setFilters({ year: Math.min(YEAR_MAX, filters.year + step) })
      if (filters.year + step >= YEAR_MAX) setPlaying(false)
    }, reduced ? 600 : 120)
    return () => window.clearInterval(id)
  }, [playing, filters.year, setFilters, setPlaying, reduced])

  const countries = meta.data?.countries.slice().sort((a, b) => a.name.localeCompare(b.name)) ?? []
  const active = (filters.domain !== null ? 1 : 0) + (filters.country ? 1 : 0) + (filters.status !== 'all' ? 1 : 0)
  return (
    <div className="fixed inset-x-0 bottom-0 z-30 border-t border-rule bg-paper/95 backdrop-blur" role="region" aria-label="Time and filters">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5 sm:px-6">
        <button onClick={() => { if (!playing && filters.year >= YEAR_MAX) setFilters({ year: YEAR_MIN }); setPlaying(!playing) }}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-ink text-paper" aria-label={playing ? 'Pause timeline' : 'Play timeline from 1700'}>
          {playing
            ? <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg>
            : <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 5v14l12-7z" /></svg>}
        </button>
        <label className="flex min-w-48 flex-1 items-center gap-3">
          <span className="sr-only">Born up to year</span>
          <span className="w-24 shrink-0 text-xs text-muted">born ≤ <b className="font-display text-lg text-ink tabular">{filters.year}</b></span>
          <input type="range" min={YEAR_MIN} max={YEAR_MAX} step={1} value={filters.year} className="w-full"
            onChange={(e) => { setPlaying(false); setFilters({ year: Number(e.target.value) }) }}
            aria-valuetext={`Chemists born up to ${filters.year}`} />
        </label>
        <button className="rounded-full border border-rule px-3 py-1.5 text-xs text-muted sm:hidden" aria-expanded={expanded} onClick={() => setExpanded((e) => !e)}>
          Filters{active ? ` (${active})` : ''}
        </button>
        <div className={`${expanded ? 'flex' : 'hidden'} w-full flex-wrap items-center gap-2 sm:flex sm:w-auto`}>
          <select aria-label="Specialty" value={filters.domain ?? ''} onChange={(e) => setFilters({ domain: e.target.value === '' ? null : Number(e.target.value) })}
            className="rounded-full border border-rule bg-surface px-3 py-1.5 text-xs">
            <option value="">All specialties</option>
            {meta.data?.domains.map((d, i) => <option key={d} value={i}>{d}</option>)}
          </select>
          <select aria-label="Country" value={filters.country ?? ''} onChange={(e) => setFilters({ country: e.target.value || null })}
            className="max-w-44 rounded-full border border-rule bg-surface px-3 py-1.5 text-xs">
            <option value="">All countries</option>
            {countries.map((c) => <option key={c.iso3} value={c.iso3}>{c.name}</option>)}
          </select>
          <select aria-label="Living status" value={filters.status} onChange={(e) => setFilters({ status: e.target.value as Status })}
            className="rounded-full border border-rule bg-surface px-3 py-1.5 text-xs">
            <option value="all">Living & deceased</option>
            <option value="living">Likely living</option>
            <option value="deceased">Deceased</option>
          </select>
          {(active > 0 || filters.year !== YEAR_MAX) && (
            <button onClick={() => { setPlaying(false); setFilters({ domain: null, country: null, status: 'all', year: YEAR_MAX }) }}
              className="rounded-full px-2 py-1.5 text-xs text-accent underline-offset-2 hover:underline">Reset</button>
          )}
        </div>
      </div>
    </div>
  )
}
