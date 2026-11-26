import { feature } from 'topojson-client'
import type { FeatureCollection, Geometry } from 'geojson'
import worldUrl from 'world-atlas/countries-110m.json?url'

let p: Promise<FeatureCollection<Geometry>> | null = null
export function loadWorld() {
  if (!p) {
    p = fetch(worldUrl).then((r) => r.json()).then((topo) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      feature(topo, (topo as any).objects.countries) as unknown as FeatureCollection<Geometry>)
    p.catch(() => { p = null })
  }
  return p
}
