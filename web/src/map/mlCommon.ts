// MapLibre helpers shared by FlatMap and FieldMap.
import { setWorkerUrl, type Map as MLMap, type GeoJSONSource } from 'maplibre-gl'
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
import type { StyleSpecification } from '@maplibre/maplibre-gl-style-spec'
import type { FeatureCollection, Geometry } from 'geojson'
import { ATTRIBUTION, EOX_S2_2016, GIBS_BLUE_MARBLE, NAIP_BOUNDS, naipTileTemplate, OSM_STANDARD } from './sources'
import { placesGeoJson, toGeometry } from './geo'
import type { FieldGeometryInput } from './types'

// MapLibre 6 locates its worker next to its own module, which breaks once Vite pre-bundles it.
setWorkerUrl(maplibreWorkerUrl)

export const FIELD_YELLOW = '#F2C230'
export const EMPTY_FC: FeatureCollection = { type: 'FeatureCollection', features: [] }
const dataBase = () => `${(import.meta.env.BASE_URL || '/').replace(/\/$/, '')}/data`
const absolute = (p: string) => new URL(p, window.location.href).href

/** Raster basemap: GIBS Blue Marble (planet) -> EOX S2 cloudless 2016 (regional) -> NAIP (US, z>=12). */
export function baseStyle(opts: { blueMarble?: boolean; eoxMinZoom?: number; naipMinZoom?: number } = {}): StyleSpecification {
  const { blueMarble = true, eoxMinZoom = 5, naipMinZoom = 12 } = opts
  const style: StyleSpecification = {
    version: 8,
    sources: {
      eox: {
        type: 'raster',
        tiles: [EOX_S2_2016.template],
        tileSize: 256,
        maxzoom: EOX_S2_2016.maxzoom,
        attribution: ATTRIBUTION.eox2016,
      },
      naip: {
        type: 'raster',
        tiles: [naipTileTemplate(512)],
        tileSize: 512,
        minzoom: naipMinZoom,
        maxzoom: 19,
        bounds: NAIP_BOUNDS,
        attribution: ATTRIBUTION.naip,
      },
    },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': '#0e2a47' } },
      { id: 'eox', type: 'raster', source: 'eox', minzoom: blueMarble ? eoxMinZoom : 0 },
      { id: 'naip', type: 'raster', source: 'naip', minzoom: naipMinZoom },
      // "Map" view: a street map over the imagery, hidden until the user picks it (no tiles load while hidden)
      { id: 'streets', type: 'raster', source: 'streets', layout: { visibility: 'none' } },
    ],
  }
  style.sources.streets = { type: 'raster', tiles: [OSM_STANDARD.template], tileSize: 256, maxzoom: OSM_STANDARD.maxzoom, attribution: ATTRIBUTION.osm }
  if (blueMarble) {
    style.sources.bluemarble = {
      type: 'raster',
      tiles: [GIBS_BLUE_MARBLE.template],
      tileSize: 256,
      maxzoom: GIBS_BLUE_MARBLE.maxzoom,
      attribution: ATTRIBUTION.gibs,
    }
    style.layers.splice(1, 0, { id: 'bluemarble', type: 'raster', source: 'bluemarble', maxzoom: eoxMinZoom + 0.5 })
  }
  return style
}

/** Country + state outlines and LOD place labels (Natural Earth, GeoNames). */
export function addReferenceLayers(map: MLMap) {
  map.addSource('admin0', { type: 'geojson', data: absolute(`${dataBase()}/admin0.geojson`), attribution: ATTRIBUTION.naturalEarth })
  map.addSource('admin1', { type: 'geojson', data: absolute(`${dataBase()}/admin1.geojson`) })
  map.addLayer({
    id: 'admin1-line',
    type: 'line',
    source: 'admin1',
    minzoom: 3,
    filter: ['!=', ['get', 'adm0'], 'USA'],
    paint: { 'line-color': '#ffffff', 'line-opacity': 0.45, 'line-width': 0.8 },
  })
  // US state lines a touch stronger: they guide the Globe Home drill-down to a state.
  map.addLayer({
    id: 'admin1-us-line',
    type: 'line',
    source: 'admin1',
    minzoom: 2.5,
    filter: ['==', ['get', 'adm0'], 'USA'],
    paint: { 'line-color': '#ffffff', 'line-opacity': 0.78, 'line-width': 1.3 },
  })
  map.addLayer({
    id: 'admin0-line',
    type: 'line',
    source: 'admin0',
    paint: { 'line-color': '#ffffff', 'line-opacity': 0.8, 'line-width': ['interpolate', ['linear'], ['zoom'], 1, 0.8, 6, 1.6] },
  })
  map.addSource('places', { type: 'geojson', data: EMPTY_FC, attribution: ATTRIBUTION.geonames })
  const text = {
    'text-field': ['get', 'name'],
    'text-font': ['Inter', 'Segoe UI', 'Helvetica Neue', 'Arial', 'sans-serif'],
    'text-anchor': 'bottom',
    'text-offset': [0, -0.4],
    'symbol-sort-key': ['-', 0, ['get', 'pop']],
  } as const
  const paint = { 'text-color': '#ffffff', 'text-halo-color': '#08182a', 'text-halo-width': 1.6 }
  const tiers: [string, unknown[], number, number][] = [
    ['places-0', ['==', ['get', 'tier'], 0], 1, 14],
    ['places-1', ['all', ['>', ['get', 'tier'], 0], ['>=', ['get', 'pop'], 1000000]], 4, 12],
    ['places-2', ['all', ['==', ['get', 'tier'], 1], ['<', ['get', 'pop'], 1000000]], 5, 12],
    ['places-3', ['all', ['==', ['get', 'tier'], 2], ['<', ['get', 'pop'], 1000000]], 6.5, 12],
  ]
  for (const [id, filter, minzoom, size] of tiers) {
    map.addLayer({
      id,
      type: 'symbol',
      source: 'places',
      minzoom,
      filter: filter as never,
      layout: { ...text, 'text-size': size } as never,
      paint,
    })
  }
  placesGeoJson()
    .then((fc) => (map.getSource('places') as GeoJSONSource | undefined)?.setData(fc))
    .catch((e) => console.warn('[map] places', e))
}

/** Selected field: semi-transparent fill + yellow outline. */
export function addFieldLayers(map: MLMap) {
  map.addSource('field', { type: 'geojson', data: EMPTY_FC })
  map.addLayer({ id: 'field-fill', type: 'fill', source: 'field', paint: { 'fill-color': FIELD_YELLOW, 'fill-opacity': 0.18 } })
  map.addLayer({
    id: 'field-casing',
    type: 'line',
    source: 'field',
    paint: { 'line-color': '#08182a', 'line-width': 5, 'line-opacity': 0.5 },
  })
  map.addLayer({ id: 'field-line', type: 'line', source: 'field', paint: { 'line-color': FIELD_YELLOW, 'line-width': 3 } })
}

export function setFieldData(map: MLMap, input: FieldGeometryInput) {
  const g = toGeometry(input)
  const src = map.getSource('field') as GeoJSONSource | undefined
  src?.setData(g ? { type: 'Feature', properties: {}, geometry: g as Geometry } : EMPTY_FC)
}

export function setGeoJson(map: MLMap, id: string, data: FeatureCollection) {
  ;(map.getSource(id) as GeoJSONSource | undefined)?.setData(data)
}

/** Height in metres -> approximate web-mercator zoom. */
export const heightToZoom = (h: number) => Math.max(1, Math.min(18, Math.log2(4e7 / Math.max(h, 50))))

/** Diagonal hatch image for low-spot cells. */
export function hatchImage(color = [255, 255, 255, 230], size = 8) {
  const data = new Uint8Array(size * size * 4)
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const on = (x + y) % size === 0 || (x + y + 1) % size === 0
      const i = (y * size + x) * 4
      if (on) data.set(color, i)
    }
  return { width: size, height: size, data }
}
