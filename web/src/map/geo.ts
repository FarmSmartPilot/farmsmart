// Geometry helpers shared by the map components.
import { geoArea, geoInterpolate } from 'd3'
import type { Feature, FeatureCollection, Geometry, MultiPolygon, Polygon } from 'geojson'
import type { BBox, FieldGeometryInput } from './types'

const EARTH_R = 6371008.8

export function toGeometry(input: FieldGeometryInput): Geometry | null {
  if (!input) return null
  if ((input as Feature).type === 'Feature') return (input as Feature).geometry ?? null
  return input as Geometry
}

/** Exterior and interior rings of a (Multi)Polygon, or lines of a (Multi)LineString. */
export function ringsOf(g: Geometry | null): number[][][] {
  if (!g) return []
  switch (g.type) {
    case 'Polygon':
      return g.coordinates
    case 'MultiPolygon':
      return g.coordinates.flat()
    case 'LineString':
      return [g.coordinates]
    case 'MultiLineString':
      return g.coordinates
    case 'GeometryCollection':
      return g.geometries.flatMap(ringsOf)
    default:
      return []
  }
}

export function bboxOf(g: Geometry | null): BBox | null {
  const rings = ringsOf(g)
  if (!rings.length) {
    if (g?.type === 'Point') return [g.coordinates[0], g.coordinates[1], g.coordinates[0], g.coordinates[1]]
    return null
  }
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity
  for (const r of rings)
    for (const [x, y] of r) {
      if (x < w) w = x
      if (x > e) e = x
      if (y < s) s = y
      if (y > n) n = y
    }
  return [w, s, e, n]
}

export function centroidOf(g: Geometry | null): [number, number] | null {
  const b = bboxOf(g)
  return b ? [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2] : null
}

/** Spherical area in hectares (d3-geo, winding-agnostic). */
export function areaHa(g: Polygon | MultiPolygon): number {
  // d3 expects clockwise exterior rings; take the smaller of the two interpretations.
  let sr = geoArea({ type: 'Feature', geometry: g, properties: {} })
  if (sr > 2 * Math.PI) sr = 4 * Math.PI - sr
  return (sr * EARTH_R * EARTH_R) / 10000
}

/** Great-circle points from a to b ([lon, lat]), longitudes unwrapped so lines don't jump at ±180. */
export function greatCircle(a: [number, number], b: [number, number], n = 96): [number, number][] {
  const f = geoInterpolate(a, b)
  const out: [number, number][] = []
  let prev: number | null = null
  for (let i = 0; i <= n; i++) {
    let [x, y] = f(i / n)
    if (prev != null) {
      while (x - prev > 180) x -= 360
      while (x - prev < -180) x += 360
    }
    prev = x
    out.push([x, y])
  }
  return out
}

/** Great-circle distance in metres. */
export function distanceM(a: [number, number], b: [number, number]): number {
  const r = Math.PI / 180
  const dLat = (b[1] - a[1]) * r
  const dLon = (b[0] - a[0]) * r
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.sin(dLon / 2) ** 2
  return 2 * EARTH_R * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** Insert vertices so no segment is longer than maxDeg (keeps long straight borders on the curved globe). */
export function densify(ring: number[][], maxDeg = 0.5): number[][] {
  const out: number[][] = []
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i]
    if (i > 0) {
      const q = ring[i - 1]
      const d = Math.max(Math.abs(p[0] - q[0]), Math.abs(p[1] - q[1]))
      const steps = Math.ceil(d / maxDeg)
      for (let k = 1; k < steps; k++) out.push([q[0] + ((p[0] - q[0]) * k) / steps, q[1] + ((p[1] - q[1]) * k) / steps])
    }
    out.push(p)
  }
  return out
}

/** First Polygon/MultiPolygon in any GeoJSON object. */
export function firstPolygon(obj: unknown): { geometry: Polygon | MultiPolygon; name?: string } | null {
  const o = obj as { type?: string }
  if (!o || typeof o !== 'object') return null
  if (o.type === 'FeatureCollection') {
    for (const f of (obj as FeatureCollection).features) {
      const r = firstPolygon(f)
      if (r) return r
    }
    return null
  }
  if (o.type === 'Feature') {
    const f = obj as Feature
    const r = firstPolygon(f.geometry)
    const nm = f.properties && (f.properties.name ?? f.properties.Name ?? f.properties.NAME)
    return r ? { ...r, name: nm != null ? String(nm) : undefined } : null
  }
  if (o.type === 'Polygon' || o.type === 'MultiPolygon') return { geometry: obj as Polygon | MultiPolygon }
  if (o.type === 'GeometryCollection') {
    for (const g of (obj as { geometries: Geometry[] }).geometries) {
      const r = firstPolygon(g)
      if (r) return r
    }
  }
  return null
}

/** Tiny KML parser: the first <Polygon> (outer + inner boundaries) and its Placemark name. */
export function parseKml(text: string): { geometry: Polygon; name?: string } | null {
  const doc = new DOMParser().parseFromString(text, 'application/xml')
  if (doc.getElementsByTagName('parsererror').length) return null
  const byTag = (el: Element | Document, tag: string) => Array.from(el.getElementsByTagNameNS('*', tag))
  const poly = byTag(doc, 'Polygon')[0]
  if (!poly) return null
  const ringFrom = (el: Element | undefined) => {
    const c = el && byTag(el, 'coordinates')[0]
    if (!c?.textContent) return null
    const pts = c.textContent
      .trim()
      .split(/\s+/)
      .map((t) => t.split(',').map(Number))
      .filter((p) => p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]))
      .map((p) => [p[0], p[1]])
    if (pts.length < 3) return null
    const [f, l] = [pts[0], pts[pts.length - 1]]
    if (f[0] !== l[0] || f[1] !== l[1]) pts.push([f[0], f[1]])
    return pts
  }
  const outer = ringFrom(byTag(poly, 'outerBoundaryIs')[0])
  if (!outer) return null
  const inners = byTag(poly, 'innerBoundaryIs').map(ringFrom).filter((r): r is number[][] => !!r)
  let name: string | undefined
  let p: Element | null = poly.parentElement
  while (p && p.localName !== 'Placemark') p = p.parentElement
  if (p) name = byTag(p, 'name')[0]?.textContent?.trim() || undefined
  return { geometry: { type: 'Polygon', coordinates: [outer, ...inners] }, name }
}

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
}

export interface GlobeSupport {
  ok: boolean
  reason?: string
}

/** WebGL capability check for the Cesium globe. Weak or software GL -> use FlatMap. */
export function detectGlobeSupport(): GlobeSupport {
  try {
    const c = document.createElement('canvas')
    const gl2 = c.getContext('webgl2', { failIfMajorPerformanceCaveat: true }) as WebGL2RenderingContext | null
    const gl = gl2 || (c.getContext('webgl', { failIfMajorPerformanceCaveat: true }) as WebGLRenderingContext | null)
    if (!gl) {
      const any = c.getContext('webgl2') || c.getContext('webgl')
      return { ok: false, reason: any ? 'WebGL runs in software mode' : 'WebGL is not available' }
    }
    const maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number
    const lose = gl.getExtension('WEBGL_lose_context')
    lose?.loseContext()
    if (maxTex < 4096) return { ok: false, reason: `WebGL is limited (max texture ${maxTex})` }
    const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory
    if (mem != null && mem < 2) return { ok: false, reason: 'device memory is low' }
    return { ok: true }
  } catch {
    return { ok: false, reason: 'WebGL check failed' }
  }
}

// ---------- Reference data (web/public/data) ----------

export type PlaceRow = [name: string, lon: number, lat: number, population: number, tier: 0 | 1 | 2, country: string]

const cache = new Map<string, Promise<unknown>>()
export function loadJson<T>(url: string): Promise<T> {
  let p = cache.get(url)
  if (!p) {
    p = fetch(url).then((r) => {
      if (!r.ok) throw new Error(`${url}: ${r.status}`)
      return r.json()
    })
    p.catch(() => cache.delete(url))
    cache.set(url, p)
  }
  return p as Promise<T>
}

const base = () => (import.meta.env.BASE_URL || '/').replace(/\/$/, '')
export const loadAdmin0 = () => loadJson<FeatureCollection>(`${base()}/data/admin0.geojson`)
export const loadAdmin1 = () => loadJson<FeatureCollection>(`${base()}/data/admin1.geojson`)
export const loadPlaces = () => loadJson<{ rows: PlaceRow[]; attribution: string }>(`${base()}/data/places.json`)

/** Places as a GeoJSON FeatureCollection (for MapLibre). */
export async function placesGeoJson(): Promise<FeatureCollection> {
  const { rows } = await loadPlaces()
  return {
    type: 'FeatureCollection',
    features: rows.map((r) => ({
      type: 'Feature',
      properties: { name: r[0], pop: r[3], tier: r[4], cc: r[5] },
      geometry: { type: 'Point', coordinates: [r[1], r[2]] },
    })),
  }
}
