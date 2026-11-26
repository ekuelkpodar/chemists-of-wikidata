// Colour follows the entity, never its rank. Fixed assignments, validated categorical slots
// (dataviz reference palette: adjacent CVD ΔE ≥ 10 in both modes). Everything else is "other" grey.
export const SLOTS = ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s4)', 'var(--s5)', 'var(--s6)', 'var(--s7)', 'var(--s8)']
export const OTHER = 'var(--other)'

// The countries the story is about get permanent hues.
const COUNTRY_SLOT: Record<string, number> = { USA: 0, DEU: 1, GBR: 2, FRA: 3, RUS: 4, JPN: 5, ITA: 6, CHE: 7 }
export function countryColor(iso: string): string {
  return iso in COUNTRY_SLOT ? SLOTS[COUNTRY_SLOT[iso]] : OTHER
}

const DOMAIN_SLOT: Record<string, number> = {
  'General chemistry': -1, 'Life & medicinal chemistry': 0, 'Applied & industrial': 1,
  'Physical & theoretical': 2, 'Earth & environment': 5, 'Synthesis & materials': 6, 'Analytical & measurement': 4,
}
export function domainColor(name: string): string {
  const s = DOMAIN_SLOT[name]
  return s === undefined || s < 0 ? OTHER : SLOTS[s]
}

/** Up to 4 compared groups on one chart: first four slots, in selection order. */
export const groupColor = (i: number) => SLOTS[i % 4]
