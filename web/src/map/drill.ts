// Globe Home drill-down shared by GlobeView (Cesium) and FlatMap (MapLibre):
// zoom levels, field-boundary loading (cached in aligned z14 tile blocks) and point-in-field hit tests.
import type { Feature, FeatureCollection, MultiPolygon, Polygon } from 'geojson'
import { areaHa, bboxOf, loadJson } from './geo'
import type { BBox, FieldMeta } from './types'

export type DrillLevel = 'planet' | 'country' | 'state' | 'county' | 'farm'
export const DRILL_LEVELS: DrillLevel[] = ['planet', 'country', 'state', 'county', 'farm']

/** Camera height (m) each ladder rung flies to. */
export const LEVEL_HEIGHT: Record<DrillLevel, number> = {
  planet: 2.0e7,
  country: 4.5e6,
  state: 4.5e5,
  county: 5.0e4,
  farm: 3500,
}

/** Lower bounds (m) of each level by camera height. */
const FLOOR = { planet: 8e6, country: 6e5, state: 1e5, county: 1.2e4 }

export function levelOf(h: number): DrillLevel {
  if (h >= FLOOR.planet) return 'planet'
  if (h >= FLOOR.country) return 'country'
  if (h >= FLOOR.state) return 'state'
  if (h >= FLOOR.county) return 'county'
  return 'farm'
}

/** Where a click at this level takes the camera (m), or null when a click picks a field. */
export function clickTargetHeight(level: DrillLevel): number | null {
  if (level === 'planet' || level === 'country') return 2.5e5
  if (level === 'state' || level === 'county') return 4000
  return null
}

/** County outlines show at State / County level only. */
export const COUNTY_MAX_H = FLOOR.country
export const COUNTY_MIN_H = FLOOR.county
/** Field boundaries load and show below this height (Farm level). */
export const FIELDS_MAX_H = FLOOR.county
/** Fields of The World outlines are dense (e.g. Punjab smallholdings): drawn only below this height, and thinner. */
export const FTW_MAX_H = 6000
export const LINE_W = { csb: 3.2, ftw: 2 }

// ---------- field boundaries ----------

export type BoundarySource = 'csb' | 'ftw' | 'drawn'

export interface DrillField {
  key: string
  feature: Feature<Polygon | MultiPolygon>
  source: 'csb' | 'ftw'
  bbox: BBox
}

export interface FieldsStatus {
  loading: boolean
  /** Boundaries loaded for the current area. */
  count: number
  /** Server note, e.g. "zoom in to see field boundaries". */
  note?: string
  sources: ('csb' | 'ftw')[]
  attributions: string[]
}

export interface FieldPick {
  /** 'field' = a mapped boundary was hit; 'none' = nothing mapped at this point. */
  kind: 'field' | 'none'
  lat: number
  lon: number
  field?: DrillField
  /** Boundaries were still loading when the click happened. */
  loading?: boolean
}

export interface DrawStatus {
  active: boolean
  points: number
  /** Area of the placed points (≥ 3), hectares. */
  areaHa: number | null
  /** Set once when the boundary is finished. */
  geometry?: Polygon
}

export const CSB_ATTRIBUTION = 'Field boundaries: USDA NASS Crop Sequence Boundaries 2017–2024'
export const FTW_ATTRIBUTION = 'Field boundaries: Fields of The World (FTW) global 2025, CC BY 4.0'
export const COUNTY_ATTRIBUTION = 'Counties: US Census Bureau'

const Z = 14
const BLOCK = 3 // 3×3 z14 tiles per request: the API's FTW limit is 9 tiles
const MAX_BLOCKS_PER_LOAD = 4
const tileX = (lon: number) => Math.floor(((lon + 180) / 360) * 2 ** Z)
const tileY = (lat: number) => {
  const r = (lat * Math.PI) / 180
  return Math.floor(((1 - Math.asinh(Math.tan(r)) / Math.PI) / 2) * 2 ** Z)
}
const lonOf = (x: number) => (x / 2 ** Z) * 360 - 180
const latOf = (y: number) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / 2 ** Z))) * 180) / Math.PI

function blockBox(bx: number, by: number): BBox {
  const eps = 1e-6
  return [lonOf(bx * BLOCK) + eps, latOf((by + 1) * BLOCK) + eps, lonOf((bx + 1) * BLOCK) - eps, latOf(by * BLOCK) - eps]
}

interface BlockResult {
  features: Feature[]
  source?: 'csb' | 'ftw'
  attribution?: string
  note?: string
}

/**
 * Loads field boundaries for the view from GET /api/fields/bbox in aligned blocks of 3×3 z14 tiles
 * (≈6 × 5 km), caches every block, and answers "which field is under this point".
 */
export class FieldBoundaryStore {
  private blocks = new Map<string, BlockResult | 'loading' | 'queued'>()
  private fields = new Map<string, DrillField>()
  private ac = new AbortController()
  private lastNote: string | undefined
  private wanted: string[] = []
  private apiBase: string
  private onChange: () => void
  version = 0

  constructor(apiBase: string, onChange: () => void) {
    this.apiBase = apiBase
    this.onChange = onChange
  }

  dispose() {
    this.ac.abort()
  }

  /** Load the blocks covering the view (clamped around the centre). No refetch inside loaded blocks. */
  ensure(view: BBox, center: [number, number]) {
    const [cx, cy] = center
    // Clamp the view to ≈ ±0.07° around the centre so a tilted or high camera never asks for a huge area.
    const w = Math.max(view[0], cx - 0.07)
    const e = Math.min(view[2], cx + 0.07)
    const s = Math.max(view[1], cy - 0.05)
    const n = Math.min(view[3], cy + 0.05)
    const bx0 = Math.floor(tileX(w) / BLOCK)
    const bx1 = Math.floor(tileX(e) / BLOCK)
    const by0 = Math.floor(tileY(n) / BLOCK)
    const by1 = Math.floor(tileY(s) / BLOCK)
    const cbx = tileX(cx) / BLOCK - 0.5
    const cby = tileY(cy) / BLOCK - 0.5
    const want: [string, number, number, number][] = []
    for (let bx = bx0; bx <= bx1; bx++)
      for (let by = by0; by <= by1; by++) want.push([`${bx},${by}`, bx, by, Math.hypot(bx - cbx, by - cby)])
    want.sort((a, b) => a[3] - b[3])
    const keep = want.slice(0, MAX_BLOCKS_PER_LOAD)
    this.wanted = keep.map((k) => k[0])
    // Nearest block first; at most 2 requests at a time so map tiles and other API calls still get through.
    // Blocks queued earlier but not started are dropped; they are queued again below if still wanted.
    for (const [key, v] of [...this.blocks]) if (v === 'queued') this.blocks.delete(key)
    this.queue = keep.filter(([key]) => !this.blocks.has(key)).map(([key, bx, by]) => [key, blockBox(bx, by)] as [string, BBox])
    for (const [key] of this.queue) this.blocks.set(key, 'queued')
    this.pump()
    this.bump()
  }

  private queue: [string, BBox][] = []
  private active = 0
  private pump() {
    while (this.active < 2 && this.queue.length) {
      const [key, box] = this.queue.shift()!
      this.blocks.set(key, 'loading')
      this.active++
      void this.fetchBlock(key, box).finally(() => {
        this.active--
        this.pump()
      })
    }
  }

  private async fetchBlock(key: string, [w, s, e, n]: BBox) {
    const q = new URLSearchParams({ w: w.toFixed(6), s: s.toFixed(6), e: e.toFixed(6), n: n.toFixed(6) })
    try {
      const r = await fetch(`${this.apiBase}/api/fields/bbox?${q}`, { signal: this.ac.signal })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const j = (await r.json()) as { features?: Feature[]; source?: 'csb' | 'ftw'; attribution?: string; note?: string }
      const res: BlockResult = { features: j.features ?? [], source: j.source, attribution: j.attribution, note: j.note }
      this.blocks.set(key, res)
      for (const f of res.features) this.add(f, res.source)
    } catch (err) {
      if ((err as Error).name === 'AbortError') return
      this.blocks.delete(key) // retry on the next settle
      this.lastNote = `Field boundaries could not be loaded (${(err as Error).message}).`
    }
    this.bump()
  }

  private add(f: Feature, src?: 'csb' | 'ftw') {
    const g = f.geometry
    if (!g || (g.type !== 'Polygon' && g.type !== 'MultiPolygon')) return
    const p = (f.properties ?? {}) as Record<string, unknown>
    const source: 'csb' | 'ftw' = src ?? (p.source === 'ftw' ? 'ftw' : 'csb')
    const key =
      p.csbid != null
        ? `csb:${p.csbid}`
        : p.pick_lon != null
          ? `ftw:${Number(p.pick_lon).toFixed(5)},${Number(p.pick_lat).toFixed(5)}`
          : `g:${JSON.stringify(g.coordinates).slice(0, 80)}`
    if (this.fields.has(key)) return
    const bbox = bboxOf(g)
    if (!bbox) return
    this.fields.set(key, { key, source, bbox, feature: f as Feature<Polygon | MultiPolygon> })
  }

  private bump() {
    this.version++
    this.onChange()
  }

  all(): DrillField[] {
    return [...this.fields.values()]
  }

  status(): FieldsStatus {
    let loading = false
    let note: string | undefined
    const sources = new Set<'csb' | 'ftw'>()
    const attributions = new Set<string>()
    let count = 0
    for (const k of this.wanted) {
      const b = this.blocks.get(k)
      if (b === 'loading' || b === 'queued') loading = true
      else if (b) {
        count += b.features.length
        if (b.source) sources.add(b.source)
        if (b.attribution) attributions.add(b.attribution)
        if (!b.features.length && b.note) note = b.note
      }
    }
    if (!loading && !count && !note && this.lastNote) note = this.lastNote
    return { loading, count, note: count || loading ? undefined : note, sources: [...sources], attributions: [...attributions] }
  }

  /** The smallest loaded field containing the point. */
  hit(lon: number, lat: number): DrillField | null {
    let best: DrillField | null = null
    let bestArea = Infinity
    for (const f of this.fields.values()) {
      const [w, s, e, n] = f.bbox
      if (lon < w || lon > e || lat < s || lat > n) continue
      if (!containsPoint(f.feature.geometry, lon, lat)) continue
      const a = (e - w) * (n - s)
      if (a < bestArea) {
        best = f
        bestArea = a
      }
    }
    return best
  }

  /** True while a block that covers the point is still loading. */
  loadingAt(lon: number, lat: number): boolean {
    const key = `${Math.floor(tileX(lon) / BLOCK)},${Math.floor(tileY(lat) / BLOCK)}`
    const b = this.blocks.get(key)
    return b === 'loading' || b === 'queued'
  }
}

function inRing(ring: number[][], x: number, y: number): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

export function containsPoint(g: Polygon | MultiPolygon, x: number, y: number): boolean {
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates
  for (const poly of polys) {
    if (!poly.length || !inRing(poly[0], x, y)) continue
    if (poly.slice(1).some((h) => inRing(h, x, y))) continue
    return true
  }
  return false
}

export const fieldAreaHa = (f: DrillField) => areaHa(f.feature.geometry)

/** Wait (≤ timeoutMs) until the boundaries at a point have loaded, then return the field there. */
export async function waitForField(
  getStore: () => FieldBoundaryStore | null,
  lon: number,
  lat: number,
  timeoutMs = 20000,
): Promise<DrillField | null> {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    const s = getStore()
    const f = s?.hit(lon, lat)
    if (f) return f
    if (s && !s.loadingAt(lon, lat) && s.status().count > 0 && Date.now() - t0 > 2000) return null
    await new Promise((r) => setTimeout(r, 250))
  }
  return null
}

/** US county outlines (US Census Bureau cartographic boundaries, 1:20m), built by scripts/web_data_counties.py. */
export const loadCounties = () =>
  loadJson<FeatureCollection>(`${(import.meta.env.BASE_URL || '/').replace(/\/$/, '')}/data/us_counties.geojson`)

/** Same `meta` shape as GET /api/fields/at, from a CSB feature's properties. */
export function csbMeta(p: Record<string, unknown>): FieldMeta {
  const seq: Record<string, number> = {}
  for (const [k, v] of Object.entries(p)) {
    const m = /^cdl(\d{4})$/.exec(k)
    if (m && typeof v === 'number') seq[m[1]] = v
  }
  const st = p.statefips != null ? String(p.statefips).padStart(2, '0') : undefined
  const cn = p.cntyfips != null ? String(p.cntyfips).padStart(3, '0') : undefined
  return {
    statefips: st,
    county_fips: st && cn ? `${st}${cn}` : undefined,
    country_code: 'us',
    csbid: p.csbid != null ? String(p.csbid) : undefined,
    acres: typeof p.csbacres === 'number' ? p.csbacres : undefined,
    county: p.cnty != null ? String(p.cnty) : undefined,
    cdl_sequence: seq,
  }
}

/** `meta` for a Fields of The World polygon picked from the map. */
export function ftwMeta(p: Record<string, unknown>): FieldMeta {
  return {
    source: 'ftw',
    ftw_confidence_mean: typeof p.confidence_mean === 'number' ? p.confidence_mean : undefined,
    attribution: FTW_ATTRIBUTION,
    licence: 'CC BY 4.0',
  }
}

// ---------- crop history (CSB) ----------

/** USDA NASS Cropland Data Layer class names (same table as fieldshift/ingest/cdl.py). */
export const CDL_NAMES: Record<number, string> = {
  1: 'Corn', 2: 'Cotton', 3: 'Rice', 4: 'Sorghum', 5: 'Soybeans', 6: 'Sunflower', 10: 'Peanuts', 12: 'Sweet Corn',
  21: 'Barley', 22: 'Durum Wheat', 23: 'Spring Wheat', 24: 'Winter Wheat', 25: 'Other Small Grains',
  26: 'Dbl Crop WinWht/Soybeans', 27: 'Rye', 28: 'Oats', 29: 'Millet', 31: 'Canola', 32: 'Flaxseed',
  33: 'Safflower', 36: 'Alfalfa', 37: 'Other Hay/Non Alfalfa', 41: 'Sugarbeets', 42: 'Dry Beans', 43: 'Potatoes',
  52: 'Lentils', 53: 'Peas', 54: 'Tomatoes', 58: 'Clover/Wildflowers', 59: 'Sod/Grass Seed', 61: 'Fallow/Idle Cropland',
  69: 'Grapes', 75: 'Almonds', 76: 'Walnuts', 111: 'Open Water', 121: 'Developed/Open Space', 122: 'Developed/Low',
  123: 'Developed/Med', 124: 'Developed/High', 141: 'Deciduous Forest', 142: 'Evergreen Forest', 152: 'Shrubland',
  176: 'Grassland/Pasture', 190: 'Woody Wetlands', 195: 'Herbaceous Wetlands',
  205: 'Triticale', 225: 'Dbl Crop WinWht/Corn', 236: 'Dbl Crop WinWht/Sorghum', 238: 'Dbl Crop WinWht/Cotton',
  240: 'Dbl Crop Soybeans/Oats', 241: 'Dbl Crop Corn/Soybeans', 254: 'Dbl Crop Barley/Soybeans',
}

export interface HistoryYear {
  year: number
  code: number
  name: string
}

/** 2017–2024 crop sequence from CSB properties cdl2017..cdl2024. */
export function cropHistory(props: Record<string, unknown> | null | undefined): HistoryYear[] {
  const out: HistoryYear[] = []
  for (const [k, v] of Object.entries(props ?? {})) {
    const m = /^cdl(\d{4})$/.exec(k)
    const code = typeof v === 'number' ? v : Number(v)
    if (!m || !Number.isFinite(code)) continue
    out.push({ year: Number(m[1]), code, name: CDL_NAMES[code] ?? `CDL class ${code}` })
  }
  return out.sort((a, b) => a.year - b.year)
}
