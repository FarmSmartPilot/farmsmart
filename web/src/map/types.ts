// Shared types for the map components (owner: globe-map agent).
import type { Feature, FeatureCollection, Geometry, MultiPolygon, Polygon } from 'geojson'
import type { DrawStatus, DrillLevel, FieldPick, FieldsStatus } from './drill'
export type { DrawStatus, DrillLevel, DrillField, FieldPick, FieldsStatus } from './drill'

export type { Feature, FeatureCollection, Geometry, Polygon, MultiPolygon }

/** [west, south, east, north] in degrees. */
export type BBox = [number, number, number, number]

export interface FlyToTarget {
  lat: number
  lon: number
  /** When given, the camera frames this box instead of a fixed height. */
  bbox?: BBox
  /** Camera height in metres (globe) when no bbox is given. Default 25 km. */
  height?: number
  /** Seconds. Ignored (0) when the user prefers reduced motion. */
  duration?: number
}

/** Imperative handle exposed by GlobeView, FlatMap and FieldMap through `ref`. */
export interface MapHandle {
  flyTo(target: FlyToTarget): void
  resetNorth(): void
  /** Drill-down (GlobeView / FlatMap with `drillDown`): fly to a ladder rung around the current centre. */
  zoomToLevel?(level: DrillLevel): void
  /** Drill-down: draw your own boundary on the map. */
  startDraw?(): void
  undoDrawPoint?(): void
  finishDraw?(): void
  cancelDraw?(): void
  /** Drill-down: pick the field at a point once its boundaries have loaded (the Demo tour). Resolves true if one was found. */
  pickAt?(lat: number, lon: number): Promise<boolean>
}

export interface ArcEnd {
  lat: number
  lon: number
  label?: string
}

export interface GlobeArc {
  id?: string
  from: ArcEnd
  to: ArcEnd
  /** CSS colour. Default purple #6B4FA0 (climate futures). */
  color?: string
  /** Dashed = other models / lower agreement. */
  dashed?: boolean
  /** Line width in px. Default 3. */
  width?: number
}

/** A GeoJSON geometry, a Feature, or null. */
export type FieldGeometryInput = Geometry | Feature | null | undefined

export interface GlobeViewProps {
  /** Called with the clicked ground point. */
  onPickPoint?: (lat: number, lon: number) => void
  /** Selected field outline (drawn yellow, semi-transparent fill). */
  fieldGeometry?: FieldGeometryInput
  /** Animated great-circle arcs (Climate Twins). */
  arcs?: GlobeArc[]
  /** Slow spin on the home view until the user interacts. Default true. Off with prefers-reduced-motion. */
  autoRotate?: boolean
  /** Country/state outlines and place labels. Default true. */
  showReference?: boolean
  /** Force the MapLibre fallback (e.g. mobile, user setting). */
  preferFlat?: boolean
  /** Told when the globe falls back to the 2D map and why. */
  onFallback?: (reason: string) => void
  /** Accessible name for the map region. */
  ariaLabel?: string
  className?: string
  /**
   * Globe Home drill-down: clicks at coarse zoom fly closer instead of picking; at Farm level the
   * field boundaries in view load and a click reports the field (onFieldPick). onPickPoint is not called.
   */
  drillDown?: boolean
  /** Drill-down: the zoom level changed. */
  onLevelChange?: (level: DrillLevel, info: { height: number; lat: number; lon: number }) => void
  /** Drill-down: field-boundary loading state for the view. */
  onFieldsStatus?: (s: FieldsStatus) => void
  /** Drill-down: a click at Farm level (a field, or no mapped field there). */
  onFieldPick?: (pick: FieldPick) => void
  /** Drill-down: draw-your-own-boundary progress; `geometry` is set when finished. */
  onDrawChange?: (d: DrawStatus) => void
}

export type FlatMapProps = Omit<GlobeViewProps, 'preferFlat' | 'onFallback'>

/** Layer chip ids used by Field Studio. */
export type LayerId = 'cover' | 'wind' | 'rain' | 'soil_moisture' | 'heat' | 'soils' | 'erosion_zones'

/** One terrain cell from report.terrain.zones: [lon, lat, slope_pct, rel_elev_m]. */
export type TerrainZone = [number, number, number, number]

/** Same shape as `meta` from GET /api/fields/at. */
export interface FieldMeta {
  statefips?: string
  county_fips?: string
  country_code?: string
  csbid?: string
  acres?: number
  county?: string
  cdl_sequence?: Record<string, number>
  [k: string]: unknown
}

export interface WindRoseData {
  sectors: number
  speed_bins_ms: number[]
  /** freq[sector][bin], fraction of all hours. Sector 0 = wind FROM north. */
  freq: number[][]
  hours: number
  share_above_8ms?: number
  months: number[]
  years: number[]
  evidence?: { source?: string; product?: string; native_res?: string; is_nasa?: boolean; citation?: string }
}

export interface GeometryInputInfo {
  source: 'draw' | 'upload'
  /** File name or feature name for uploads. */
  name?: string
  /** Area in hectares, computed on a sphere (R = 6,371 km). */
  areaHa: number
}

export interface FieldMapProps {
  /** Saved field id; enables the wind rose and report-based zones. */
  fieldId?: string | null
  fieldGeometry?: FieldGeometryInput
  fieldName?: string
  activeLayers?: LayerId[]
  /** YYYY-MM-DD for the NASA GIBS overlays, or 'default' for the latest available. */
  overlayDate?: string
  /** report.terrain.zones; when omitted and erosion_zones is on, the report is fetched. */
  terrainZones?: TerrainZone[] | null
  /** Months for the wind rose (default 3,4,5,10,11: the bare-soil seasons). */
  windMonths?: number[]
  /** Clicking a neighbouring USDA CSB field. */
  onSelectField?: (feature: Feature, meta: FieldMeta) => void
  /** A drawn or uploaded boundary. The parent saves it with POST /api/fields. */
  onGeometryInput?: (geometry: Polygon | MultiPolygon, info: GeometryInputInfo) => void
  /** Show neighbouring CSB boundaries (US only). Default true. */
  showNeighbours?: boolean
  /** Prefix for API calls. Default '' (same origin, Vite proxies /api). */
  apiBase?: string
  ariaLabel?: string
  className?: string
  /** Controls drawn in the bar under the map (e.g. layer chips), so nothing covers the field. */
  toolbar?: import('react').ReactNode
}
