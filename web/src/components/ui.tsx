import { useState, type ReactNode } from 'react'

export function Skeleton({ h = 320, className = '' }: { h?: number; className?: string }) {
  return <div className={`skeleton w-full ${className}`} style={{ height: h }} aria-hidden="true" />
}

export function ErrorState({ error, retry }: { error: Error; retry?: () => void }) {
  return (
    <div role="alert" className="rounded-xl border border-rule bg-surface p-6 text-sm">
      <p className="font-medium">This view couldn't load its data.</p>
      <p className="mt-1 text-muted">{error.message}</p>
      {retry && <button onClick={retry} className="mt-3 rounded-full border border-rule px-3 py-1 hover:bg-paper">Try again</button>}
    </div>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="flex min-h-40 items-center justify-center rounded-xl border border-dashed border-rule p-6 text-center text-sm text-muted">{children}</div>
}

/** Every chart: title, n + caveat line, the chart, and a table view as its text alternative. */
export function ChartFrame({ title, subtitle, n, caveat, table, children, actions, id }: {
  title: string; subtitle?: ReactNode; n?: number | string; caveat?: string; table?: ReactNode
  children: ReactNode; actions?: ReactNode; id?: string
}) {
  const [showTable, setShowTable] = useState(false)
  return (
    <figure className="rounded-2xl border border-rule bg-surface p-4 sm:p-6" aria-labelledby={id ? `${id}-t` : undefined}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id={id ? `${id}-t` : undefined} className="text-base font-semibold">{title}</h2>
          {subtitle && <p className="mt-0.5 text-sm text-muted">{subtitle}</p>}
        </div>
        <div className="flex items-center gap-2">
          {actions}
          {table && (
            <button onClick={() => setShowTable((s) => !s)} aria-pressed={showTable}
              className="rounded-full border border-rule px-3 py-1 text-xs text-muted hover:text-ink">
              {showTable ? 'Show chart' : 'Show table'}
            </button>
          )}
        </div>
      </div>
      <div className="mt-4">{showTable && table ? <div className="max-h-[480px] overflow-auto">{table}</div> : children}</div>
      {(n !== undefined || caveat) && (
        <figcaption className="mt-3 text-xs text-faint">
          {n !== undefined && <span className="tabular">n = {typeof n === 'number' ? n.toLocaleString('en-US') : n}. </span>}
          {caveat}
        </figcaption>
      )}
    </figure>
  )
}

export function DataTable({ cols, rows, caption }: { cols: string[]; rows: (string | number | null)[][]; caption?: string }) {
  return (
    <table className="w-full text-left text-sm tabular">
      {caption && <caption className="sr-only">{caption}</caption>}
      <thead className="sticky top-0 bg-surface text-xs text-muted"><tr>{cols.map((c) => <th key={c} scope="col" className="border-b border-rule py-1.5 pr-4 font-medium">{c}</th>)}</tr></thead>
      <tbody>{rows.map((r, i) => <tr key={i} className="border-b border-rule/60">{r.map((v, j) => <td key={j} className="py-1 pr-4">{v ?? '—'}</td>)}</tr>)}</tbody>
    </table>
  )
}

export function Legend({ items }: { items: { label: string; color: string; dashed?: boolean }[] }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted" aria-label="Legend">
      {items.map((it) => (
        <li key={it.label} className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: it.color }} aria-hidden="true" />
          {it.label}
        </li>
      ))}
    </ul>
  )
}

export function PageHeader({ kicker, title, children }: { kicker: string; title: string; children?: ReactNode }) {
  return (
    <header className="mb-8 max-w-3xl">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-accent">{kicker}</p>
      <h1 className="font-display mt-2 text-4xl leading-tight sm:text-5xl">{title}</h1>
      {children && <div className="mt-4 text-lg leading-relaxed text-muted">{children}</div>}
    </header>
  )
}

export function Tooltip({ x, y, children, bounds }: { x: number; y: number; children: ReactNode; bounds: number }) {
  const left = x > bounds - 200 ? x - 12 : x + 12
  return (
    <div role="status" className="pointer-events-none absolute z-20 max-w-60 rounded-lg border border-rule bg-surface px-3 py-2 text-xs shadow-lg"
      style={{ left, top: y + 12, transform: x > bounds - 200 ? 'translateX(-100%)' : undefined }}>
      {children}
    </div>
  )
}
