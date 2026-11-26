export const nf = new Intl.NumberFormat('en-US')
export const fmt = (n: number | null | undefined) => (n === null || n === undefined ? '—' : nf.format(Math.round(n)))
export const pct = (x: number, digits = 0) => `${(x * 100).toFixed(digits)}%`
export const years = (by: number | null, dy: number | null, living?: boolean) =>
  `${by === null ? '?' : by < 0 ? `${-by} BCE` : by}–${dy === null ? (living ? '' : '?') : dy}`
