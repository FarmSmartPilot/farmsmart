// Tile sources and attribution strings. URLs from docs/reference/ENDPOINTS.md,
// attribution strings from docs/LICENSES.md. Tested 2026-11-14.
import type { BBox, LayerId } from './types'

export const GIBS_BASE = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best'

/** Planet scale: static, cloud-free Blue Marble (GIBS, levels 0-8). */
export const GIBS_BLUE_MARBLE = {
  template: `${GIBS_BASE}/BlueMarble_ShadedRelief_Bathymetry/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg`,
  maxzoom: 8,
}

/** Regional: EOX Sentinel-2 cloudless 2016 (the only CC BY 4.0 vintage). */
export const EOX_S2_2016 = {
  template: 'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/g/{z}/{y}/{x}.jpg',
  maxzoom: 15,
  /** Native 10 m Sentinel-2 bands. */
  resolution: '10 m',
}

/** USDA NAIP via USGS The National Map. No tile cache: tiles come from exportImage. */
export const NAIP_SERVICE = 'https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPImagery/ImageServer'
/** Service extent (EPSG:3857 from the service JSON) converted to degrees. */
export const NAIP_BOUNDS: BBox = [-124.83, 24.5, -66.85, 49.5]
// Tiles go through the FarmSmart API's caching proxy (/api/tiles/naip) to avoid CORS failures and slow repeats.
const API_ORIGIN = typeof window !== 'undefined' ? window.location.origin : ''
export const naipTileTemplate = (size = 512) =>
  `${API_ORIGIN}/api/tiles/naip?bbox={bbox-epsg-3857}&size=${size}`
/** Cesium UrlTemplateImageryProvider form: 512 px tiles, so the slow exportImage service is called 4× less often. */
export const NAIP_CESIUM_TEMPLATE = `${API_ORIGIN}/api/tiles/naip?bbox={westProjected},{southProjected},{eastProjected},{northProjected}&size=512`

/** AWS Terrain Tiles (terrarium encoding), used for the 3D tilt in FieldMap. */
export const TERRARIUM_TEMPLATE = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'

export const ATTRIBUTION = {
  gibs: 'Imagery: NASA Global Imagery Browse Services (GIBS), part of NASA ESDIS.',
  eox2016:
    '<a href="https://s2maps.eu" target="_blank" rel="noopener">Sentinel-2 cloudless – s2maps.eu</a> by EOX IT Services GmbH (Contains modified Copernicus Sentinel data 2016 &amp; 2017), CC BY 4.0',
  naip: 'Imagery: USDA NAIP, served by USGS The National Map.',
  naturalEarth: 'Boundaries: Natural Earth.',
  geonames: 'Place names: <a href="https://www.geonames.org" target="_blank" rel="noopener">GeoNames.org</a> (CC BY 4.0).',
  csb: 'Field boundaries and sequence: USDA NASS Crop Sequence Boundaries 2017–2024.',
  terrain:
    'Terrain: Terrain Tiles via AWS Open Data (USGS 3DEP, SRTM, GMTED2010, ETOPO1, EU-DEM produced using Copernicus data, and others).',
  elevation3dep: 'Elevation: U.S. Geological Survey 3D Elevation Program.',
  osm: 'Map data © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors.',
}

/** Street map ("Map" view): OpenStreetMap standard tiles. Light, interactive use only, per the OSM tile policy. */
export const OSM_STANDARD = { template: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', maxzoom: 19 }

/** Plain-text versions for Cesium credits (no HTML). */
export const stripHtml = (s: string) => s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&')

export interface GibsOverlay {
  id: LayerId
  layer: string
  tileMatrixSet: string
  maxzoom: number
  label: string
  /** Shown beside the layer: it is a regional value, never field truth. */
  scaleNote: string
  product: string
  units: string
}

/** NASA GIBS science overlays (map display only, not data values). Layer ids from ENDPOINTS.md §9. */
export const GIBS_OVERLAYS: GibsOverlay[] = [
  {
    id: 'soil_moisture',
    layer: 'SMAP_L4_Analyzed_Root_Zone_Soil_Moisture',
    tileMatrixSet: 'GoogleMapsCompatible_Level6',
    maxzoom: 6,
    label: 'Soil moisture (root zone)',
    scaleNote: 'regional value (≈9 km)',
    product: 'SMAP L4 Analyzed Root Zone Soil Moisture',
    units: 'm³/m³',
  },
  {
    id: 'rain',
    layer: 'IMERG_Precipitation_Rate',
    tileMatrixSet: 'GoogleMapsCompatible_Level6',
    maxzoom: 6,
    label: 'Rain rate',
    scaleNote: 'regional value (≈10 km)',
    product: 'GPM IMERG Precipitation Rate',
    units: 'mm/h',
  },
  {
    id: 'heat',
    layer: 'MODIS_Terra_L3_Land_Surface_Temp_8Day_Day',
    tileMatrixSet: 'GoogleMapsCompatible_Level7',
    maxzoom: 7,
    label: 'Land surface temperature (day, 8-day)',
    scaleNote: 'regional value (≈1 km)',
    product: 'MODIS Terra L3 Land Surface Temperature 8-Day Day',
    units: '°C',
  },
]

export const gibsTemplate = (o: GibsOverlay, date = 'default') =>
  `${GIBS_BASE}/${o.layer}/default/${date || 'default'}/${o.tileMatrixSet}/{z}/{y}/{x}.png`

/**
 * Ask GIBS which date a request actually resolves to (header Layer-Time-Actual).
 * Returns YYYY-MM-DD or null.
 */
export async function gibsActualDate(o: GibsOverlay, date = 'default', signal?: AbortSignal): Promise<string | null> {
  const url = gibsTemplate(o, date).replace('{z}', '0').replace('{y}', '0').replace('{x}', '0')
  try {
    const r = await fetch(url, { signal })
    const t = r.headers.get('layer-time-actual')
    return t ? t.slice(0, 10) : null
  } catch {
    return null
  }
}

export interface NaipStamp {
  year: number | null
  acquired: string | null
  resolution: string | null
  state: string | null
}

const naipCache = new Map<string, Promise<NaipStamp | null>>()

/** Newest primary NAIP catalog item at a point (service metadata), or null outside coverage. */
export function naipStampAt(lat: number, lon: number): Promise<NaipStamp | null> {
  const key = `${lat.toFixed(3)},${lon.toFixed(3)}`
  const hit = naipCache.get(key)
  if (hit) return hit
  const params = new URLSearchParams({
    where: 'Category=1',
    geometry: `${lon},${lat}`,
    geometryType: 'esriGeometryPoint',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: 'Year,acquisition_date,resolution_value,resolution_units,State',
    orderByFields: 'Year DESC',
    returnGeometry: 'false',
    f: 'json',
  })
  const p = fetch(`${NAIP_SERVICE}/query?${params}`)
    .then((r) => (r.ok ? r.json() : null))
    .then((j) => {
      const a = j?.features?.[0]?.attributes
      if (!a) return null
      const res =
        a.resolution_value != null
          ? `${a.resolution_value} ${String(a.resolution_units || 'm').toLowerCase().startsWith('met') ? 'm' : a.resolution_units}`
          : null
      return {
        year: a.Year ?? null,
        acquired: a.acquisition_date ? new Date(a.acquisition_date).toISOString().slice(0, 10) : null,
        resolution: res,
        state: a.State ?? null,
      } as NaipStamp
    })
    .catch(() => null)
  naipCache.set(key, p)
  return p
}

export const inBounds = (lon: number, lat: number, b: BBox) => lon >= b[0] && lon <= b[2] && lat >= b[1] && lat <= b[3]

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export const monthYear = (iso: string) => {
  const [y, m] = iso.split('-').map(Number)
  return `${MONTHS[(m || 1) - 1]} ${y}`
}
