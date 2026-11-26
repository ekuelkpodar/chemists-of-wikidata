// Global UI state (time scrubber + filters), mirrored into the URL hash so any view is shareable.
// Hash format:  #/<route>?y=1900&d=2&c=USA&s=living
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Person } from './data'

export const YEAR_MIN = 1700
export const YEAR_MAX = 2000

export type Status = 'all' | 'living' | 'deceased'
export interface Filters { year: number; domain: number | null; country: string | null; status: Status }

interface Route { path: string; params: URLSearchParams }

function parseHash(): Route {
  const h = window.location.hash.replace(/^#/, '') || '/'
  const [path, qs] = h.split('?')
  return { path: path || '/', params: new URLSearchParams(qs ?? '') }
}

function filtersFrom(p: URLSearchParams): Filters {
  const y = Number(p.get('y'))
  const d = p.get('d')
  const s = p.get('s')
  return {
    year: Number.isFinite(y) && y >= YEAR_MIN && y <= YEAR_MAX ? y : YEAR_MAX,
    domain: d !== null && d !== '' && Number.isFinite(Number(d)) ? Number(d) : null,
    country: p.get('c') || null,
    status: s === 'living' || s === 'deceased' ? s : 'all',
  }
}

interface Ctx {
  route: Route
  navigate: (path: string) => void
  filters: Filters
  setFilters: (patch: Partial<Filters>) => void
  playing: boolean
  setPlaying: (p: boolean) => void
  personId: string | null
  openPerson: (id: string | null) => void
  paletteOpen: boolean
  setPaletteOpen: (o: boolean) => void
}

const StateCtx = createContext<Ctx | null>(null)

export function StateProvider({ children }: { children: ReactNode }) {
  const [route, setRoute] = useState<Route>(parseHash)
  const [filters, setF] = useState<Filters>(() => filtersFrom(parseHash().params))
  const [playing, setPlaying] = useState(false)
  const [personId, setPersonId] = useState<string | null>(() => parseHash().params.get('p'))
  const [paletteOpen, setPaletteOpen] = useState(false)
  const filtersRef = useRef(filters)
  filtersRef.current = filters

  useEffect(() => {
    const on = () => { const r = parseHash(); setRoute(r); setF(filtersFrom(r.params)); setPersonId(r.params.get('p')) }
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])

  const writeHash = useCallback((path: string, f: Filters, pid: string | null) => {
    const q = new URLSearchParams()
    if (f.year !== YEAR_MAX) q.set('y', String(f.year))
    if (f.domain !== null) q.set('d', String(f.domain))
    if (f.country) q.set('c', f.country)
    if (f.status !== 'all') q.set('s', f.status)
    if (pid) q.set('p', pid)
    const qs = q.toString()
    const next = `#${path}${qs ? `?${qs}` : ''}`
    if (next !== window.location.hash) history.replaceState(null, '', next)
  }, [])

  const setFilters = useCallback((patch: Partial<Filters>) => {
    setF((prev) => {
      const next = { ...prev, ...patch }
      writeHash(parseHash().path, next, new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('p'))
      return next
    })
  }, [writeHash])

  const navigate = useCallback((path: string) => {
    const pid = null
    const q = new URLSearchParams()
    const f = filtersRef.current
    if (f.year !== YEAR_MAX) q.set('y', String(f.year))
    if (f.domain !== null) q.set('d', String(f.domain))
    if (f.country) q.set('c', f.country)
    if (f.status !== 'all') q.set('s', f.status)
    const qs = q.toString()
    window.location.hash = `${path}${qs ? `?${qs}` : ''}`
    setPersonId(pid)
    window.scrollTo({ top: 0 })
  }, [])

  const openPerson = useCallback((id: string | null) => {
    setPersonId(id)
    writeHash(parseHash().path, filtersRef.current, id)
  }, [writeHash])

  const value = useMemo(() => ({ route, navigate, filters, setFilters, playing, setPlaying, personId, openPerson,
    paletteOpen, setPaletteOpen }), [route, navigate, filters, setFilters, playing, personId, openPerson, paletteOpen])
  return <StateCtx.Provider value={value}>{children}</StateCtx.Provider>
}

export function useAppState(): Ctx {
  const c = useContext(StateCtx)
  if (!c) throw new Error('useAppState outside provider')
  return c
}

/** Filter predicate shared by every view. `useYear=false` ignores the time scrubber. */
export function matches(p: Person, f: Filters, useYear = true): boolean {
  if (p.excluded) return false
  if (useYear && f.year < YEAR_MAX && (p.by === null || p.by > f.year)) return false
  if (f.domain !== null && p.dom !== f.domain) return false
  if (f.country && !p.iso.includes(f.country)) return false
  if (f.status === 'living' && !p.living) return false
  if (f.status === 'deceased' && p.dy === null) return false
  return true
}

export function useReducedMotion(): boolean {
  const [r, setR] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  useEffect(() => {
    const m = window.matchMedia('(prefers-reduced-motion: reduce)')
    const on = () => setR(m.matches)
    m.addEventListener('change', on)
    return () => m.removeEventListener('change', on)
  }, [])
  return r
}
