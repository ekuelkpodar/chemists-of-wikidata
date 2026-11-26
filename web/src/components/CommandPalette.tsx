import { useEffect, useMemo, useRef, useState } from 'react'
import { fold, getSearchKeys, loadPeople, type PeopleData } from '../lib/data'
import { useAppState } from '../lib/state'
import { useAsync } from '../lib/useAsync'
import { years } from '../lib/format'

export function CommandPalette() {
  const { paletteOpen, setPaletteOpen, openPerson } = useAppState()
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPaletteOpen(true) }
      if (e.key === '/' && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement)) {
        e.preventDefault(); setPaletteOpen(true)
      }
    }
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [setPaletteOpen])
  if (!paletteOpen) return null
  return <Palette onClose={() => setPaletteOpen(false)} onPick={(id) => { setPaletteOpen(false); openPerson(id) }} />
}

function Palette({ onClose, onPick }: { onClose: () => void; onPick: (id: string) => void }) {
  const data = useAsync<PeopleData>(loadPeople)
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => { input.current?.focus() }, [])
  const results = useMemo(() => {
    if (!data.data) return []
    const k = fold(q.trim())
    if (!k) return data.data.people.filter((p) => p.nobel).slice(0, 12)
    const starts: typeof data.data.people = [], word: typeof starts = [], inner: typeof starts = []
    const keys = getSearchKeys(data.data.people)
    data.data.people.forEach((p, i) => {
      if (starts.length > 30) return
      const key = keys[i]
      if (key.startsWith(k)) starts.push(p)
      else if (key.includes(` ${k}`)) word.push(p)
      else if (key.includes(k)) inner.push(p)
    })
    return [...starts, ...word, ...inner].slice(0, 30)
  }, [q, data.data])
  useEffect(() => setSel(0), [q])
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-[12vh]" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="Search chemists" className="fade-in w-full max-w-xl overflow-hidden rounded-2xl border border-rule bg-surface shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name — try “Curie”, “Pauling”, “Haber”"
          className="w-full border-b border-rule bg-transparent px-5 py-4 text-base outline-none" role="combobox" aria-expanded="true"
          aria-controls="palette-list" aria-activedescendant={results[sel] ? `pal-${results[sel].id}` : undefined}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose()
            if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(results.length - 1, s + 1)) }
            if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(0, s - 1)) }
            if (e.key === 'Enter' && results[sel]) onPick(results[sel].id)
          }} />
        <ul id="palette-list" role="listbox" className="max-h-[50vh] overflow-auto py-2">
          {data.loading && <li className="px-5 py-3 text-sm text-muted">Loading 11.9k chemists…</li>}
          {data.error && <li className="px-5 py-3 text-sm text-muted">Couldn't load the index.</li>}
          {!q && data.data && <li className="px-5 pb-1 text-xs uppercase tracking-wider text-faint">Nobel laureates in Chemistry</li>}
          {data.data && results.length === 0 && <li className="px-5 py-3 text-sm text-muted">No chemist matches “{q}”.</li>}
          {results.map((p, i) => (
            <li key={p.id} id={`pal-${p.id}`} role="option" aria-selected={i === sel}
              className={`flex cursor-pointer items-baseline justify-between gap-3 px-5 py-2 text-sm ${i === sel ? 'bg-paper' : ''}`}
              onMouseEnter={() => setSel(i)} onClick={() => onPick(p.id)}>
              <span className="truncate">{p.name}{p.nobel && <span className="ml-1.5 text-xs text-highlight" title="Nobel Prize in Chemistry">★</span>}</span>
              <span className="shrink-0 text-xs text-muted tabular">{years(p.by, p.dy, p.living)} · {p.iso.join(', ') || '—'}</span>
            </li>
          ))}
        </ul>
        <p className="border-t border-rule px-5 py-2 text-[11px] text-faint">↑↓ to move · Enter to open · Esc to close</p>
      </div>
    </div>
  )
}
