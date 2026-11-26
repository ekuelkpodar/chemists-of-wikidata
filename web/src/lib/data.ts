// Data loading: every file is fetched once and cached as a promise.
const cache = new Map<string, Promise<unknown>>()

export function url(path: string): string {
  return `${import.meta.env.BASE_URL}${path}`
}

export function fetchJSON<T>(path: string): Promise<T> {
  if (!cache.has(path)) {
    const p = fetch(url(`data/${path}`)).then((r) => {
      if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`)
      return r.json()
    })
    p.catch(() => cache.delete(path)) // allow retry after a failure
    cache.set(path, p)
  }
  return cache.get(path) as Promise<T>
}

export interface Person {
  id: string; name: string; by: number | null; dy: number | null; iso: string[]
  dom: number; living: boolean; nobel: boolean; excluded: boolean; occ: number[]; sex: number; sv: boolean
}

export interface PeopleData {
  people: Person[]; byId: Map<string, Person>
  domains: string[]; occupations: string[]; occupationDomain: number[]; sex: string[]
}

interface PeopleRaw {
  cols: string[]; rows: unknown[][]; domains: string[]; occupations: string[]
  occupation_domain: number[]; sex: string[]
}

/** Search keys are built on first use (the palette), not at load: folding 11.9k names costs ~100 ms. */
let searchKeys: string[] | null = null
export function getSearchKeys(people: Person[]): string[] {
  if (!searchKeys || searchKeys.length !== people.length) searchKeys = people.map((p) => fold(p.name))
  return searchKeys
}

export const fold = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()

let peoplePromise: Promise<PeopleData> | null = null
export function loadPeople(): Promise<PeopleData> {
  if (!peoplePromise) {
    peoplePromise = fetchJSON<PeopleRaw>('people.json').then((raw) => {
      const people: Person[] = raw.rows.map((r) => {
        const [id, name, by, dy, iso, dom, living, nobel, excluded, occ, sex, sv] = r as [
          string, string, number | null, number | null, string, number, number, number, number, number[], number, number]
        return { id, name, by, dy, iso: iso ? iso.split('|') : [], dom, living: !!living, nobel: !!nobel,
          excluded: !!excluded, occ, sex, sv: !!sv }
      })
      return { people, byId: new Map(people.map((p) => [p.id, p])), domains: raw.domains,
        occupations: raw.occupations, occupationDomain: raw.occupation_domain, sex: raw.sex }
    })
    peoplePromise.catch(() => { peoplePromise = null })
  }
  return peoplePromise
}

export interface Country { iso3: string; name: string; region: string; lat: number; lon: number }
export interface Meta {
  generated: string; reference_year: number; n_people: number; n_analysable: number; n_with_birth: number
  n_with_country: number; n_living: number; n_nobel_chemistry: number; n_female: number | null; n_male: number | null
  n_countries: number; n_country_labels: number; enriched: boolean; birth_year_range: [number, number]
  countries: Country[]; n_misaligned_rows: number; multi_country_people: number; domains: string[]
  enrichment: { people?: number; lineage_rounds?: number; failed?: unknown[]; finished?: string }
  quality: { fill_rates_pct: Record<string, number>; flags: Record<string, number>; flag_definitions: Record<string, string>; raw: { rows: number; misaligned_rows: number } }
}
export const loadMeta = () => fetchJSON<Meta>('meta.json')

export interface Finding { id: string; chart: string; hook: string; n: number; caveat: string; numbers: Record<string, unknown> }
export const loadFindings = () => fetchJSON<Finding[]>('findings.json')

export interface PersonDetail {
  n: string; u?: string; bd?: string; dd?: string; bp?: string; sex?: string; c?: string[]; o?: string[]
  f?: string[]; liv?: boolean; adv?: [string, string, boolean][]; stu?: [string, string, boolean][]
  aw?: [string, string][]; emp?: string[]; edu?: string[]
}
export async function loadDetail(qid: string): Promise<PersonDetail | undefined> {
  const shard = Number(qid.slice(1)) % 32
  const d = await fetchJSON<Record<string, PersonDetail>>(`details/${shard}.json`)
  return d[qid]
}
