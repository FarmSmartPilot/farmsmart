// Field Studio centre map (MapLibre GL): NAIP / EOX basemap, selected field, neighbouring
// USDA CSB fields, draw + upload tools, terrain zones, NASA GIBS overlays and the wind rose inset.
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { AttributionControl, Map as MLMap, type MapMouseEvent } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { interpolateViridis } from 'd3'
import type { Feature, FeatureCollection, MultiPolygon, Polygon } from 'geojson'
import { DataButton } from '../design'
import type { Evidence } from '../design'
import { areaHa, bboxOf, centroidOf, firstPolygon, parseKml, prefersReducedMotion, toGeometry } from './geo'
import { addFieldLayers, baseStyle, EMPTY_FC, hatchImage, heightToZoom, setFieldData, setGeoJson } from './mlCommon'
import {
  ATTRIBUTION,
  EOX_S2_2016,
  GIBS_OVERLAYS,
  gibsActualDate,
  gibsTemplate,
  inBounds,
  NAIP_BOUNDS,
  naipStampAt,
  monthYear,
  TERRARIUM_TEMPLATE,
  type NaipStamp,
} from './sources'
import { WindRose } from './WindRose'
import { csbMeta } from './drill'
import type { FieldMapProps, FieldMeta, FlyToTarget, LayerId, MapHandle, TerrainZone } from './types'
import './map.css'

const LOW_SPOT_M = -1.5
const SLOPE_STOPS = [0, 3, 6, 9, 12]
const slopeColor = (i: number) => interpolateViridis(i / (SLOPE_STOPS.length - 1))
const NEIGHBOUR_MIN_ZOOM = 13

type Stamp = { text: string; evidence: Evidence } | null

export const FieldMap = forwardRef<MapHandle, FieldMapProps>(function FieldMap(props, ref) {
  const {
    fieldId,
    fieldGeometry,
    fieldName,
    activeLayers = [],
    overlayDate = 'default',
    terrainZones,
    windMonths,
    onSelectField,
    onGeometryInput,
    showNeighbours = true,
    apiBase = '',
    ariaLabel,
    className,
    toolbar,
  } = props
  const elRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const mapRef = useRef<MLMap | null>(null)
  const [ready, setReady] = useState(false)
  const reduced = useRef(prefersReducedMotion())
  const [pitched, setPitched] = useState(false)
  const [streets, setStreets] = useState<boolean>(() => {
    try { return localStorage.getItem('fieldshift-basemap') === 'map' } catch { return false }
  })
  const [stamp, setStamp] = useState<Stamp>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [overlayDates, setOverlayDates] = useState<Record<string, string | null>>({})
  const [fetchedZones, setFetchedZones] = useState<TerrainZone[] | null>(null)
  const [zonesNote, setZonesNote] = useState<string | null>(null)
  const [neighbourCount, setNeighbourCount] = useState<number | null>(null)

  // Drawing state lives in refs so map handlers see the latest values.
  const [drawing, setDrawing] = useState(false)
  const [draftCount, setDraftCount] = useState(0)
  const drawingRef = useRef(false)
  const draft = useRef<[number, number][]>([])
  const hover = useRef<[number, number] | null>(null)

  const cbRef = useRef({ onSelectField, onGeometryInput })
  cbRef.current = { onSelectField, onGeometryInput }

  const geometry = useMemo(() => toGeometry(fieldGeometry), [fieldGeometry])
  const center = useMemo(() => centroidOf(geometry), [geometry])
  const inUS = center ? inBounds(center[0], center[1], NAIP_BOUNDS) : false
  const active = useMemo(() => new Set<LayerId>(activeLayers), [activeLayers])

  // ---------- map ----------
  useEffect(() => {
    if (!elRef.current) return
    const map = new MLMap({
      container: elRef.current,
      style: baseStyle({ blueMarble: true, eoxMinZoom: 5, naipMinZoom: 11 }),
      center: center ?? [-93.42, 42.08],
      zoom: center ? 14 : 4,
      attributionControl: false,
      maxPitch: 70,
      doubleClickZoom: true,
    })
    mapRef.current = map
    map.addControl(new AttributionControl({ compact: true }), 'bottom-right')
    // Keep the credits folded behind the (i) button so they do not cover the field; one click opens them.
    const foldCredits = () => elRef.current?.querySelectorAll('.maplibregl-ctrl-attrib.maplibregl-compact-show').forEach((n) => n.classList.remove('maplibregl-compact-show'))
    map.once('load', foldCredits)
    map.once('idle', foldCredits)
    map.getCanvas().setAttribute(
      'aria-label',
      ariaLabel ?? 'Field map. Arrow keys pan, plus and minus zoom. In draw mode, Space adds a point at the centre.',
    )
    map.on('load', () => {
      map.addSource('dem', {
        type: 'raster-dem',
        tiles: [TERRARIUM_TEMPLATE],
        encoding: 'terrarium',
        tileSize: 256,
        maxzoom: 15,
        attribution: ATTRIBUTION.terrain,
      })
      // GIBS overlays (added hidden; toggled by activeLayers).
      for (const o of GIBS_OVERLAYS) {
        map.addSource(`gibs-${o.id}`, {
          type: 'raster',
          tiles: [gibsTemplate(o, overlayDate)],
          tileSize: 256,
          maxzoom: o.maxzoom,
          attribution: ATTRIBUTION.gibs,
        })
        map.addLayer({
          id: `gibs-${o.id}`,
          type: 'raster',
          source: `gibs-${o.id}`,
          layout: { visibility: 'none' },
          paint: { 'raster-opacity': 0.6, 'raster-resampling': 'nearest' },
        })
      }
      // Neighbouring CSB fields.
      map.addSource('csb', { type: 'geojson', data: EMPTY_FC, attribution: ATTRIBUTION.csb })
      map.addLayer({ id: 'csb-fill', type: 'fill', source: 'csb', minzoom: NEIGHBOUR_MIN_ZOOM - 0.5, paint: { 'fill-color': '#fff', 'fill-opacity': 0.01 } })
      map.addLayer({
        id: 'csb-line',
        type: 'line',
        source: 'csb',
        minzoom: NEIGHBOUR_MIN_ZOOM - 0.5,
        paint: { 'line-color': '#ffffff', 'line-opacity': 0.85, 'line-width': 1 },
      })
      // Terrain zones and low spots.
      map.addImage('fsm-hatch', hatchImage())
      map.addSource('zones', { type: 'geojson', data: EMPTY_FC, attribution: ATTRIBUTION.elevation3dep })
      const color: unknown[] = ['interpolate', ['linear'], ['get', 'slope']]
      SLOPE_STOPS.forEach((s, i) => color.push(s, slopeColor(i)))
      map.addLayer({
        id: 'zones-fill',
        type: 'fill',
        source: 'zones',
        layout: { visibility: 'none' },
        paint: { 'fill-color': color as never, 'fill-opacity': 0.62 },
      })
      map.addLayer({
        id: 'lowspots-fill',
        type: 'fill',
        source: 'zones',
        filter: ['<', ['get', 'rel'], LOW_SPOT_M],
        layout: { visibility: 'none' },
        paint: { 'fill-pattern': 'fsm-hatch' },
      })
      map.addLayer({
        id: 'lowspots-line',
        type: 'line',
        source: 'zones',
        filter: ['<', ['get', 'rel'], LOW_SPOT_M],
        layout: { visibility: 'none' },
        paint: { 'line-color': '#2F7FB5', 'line-width': 0.8, 'line-opacity': 0.9 },
      })
      addFieldLayers(map)
      // Draft polygon while drawing.
      map.addSource('draft', { type: 'geojson', data: EMPTY_FC })
      map.addLayer({ id: 'draft-fill', type: 'fill', source: 'draft', filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': '#F2C230', 'fill-opacity': 0.15 } })
      map.addLayer({
        id: 'draft-line',
        type: 'line',
        source: 'draft',
        filter: ['==', ['geometry-type'], 'LineString'],
        paint: { 'line-color': '#F2C230', 'line-width': 2, 'line-dasharray': [2, 1] },
      })
      map.addLayer({
        id: 'draft-pts',
        type: 'circle',
        source: 'draft',
        filter: ['==', ['geometry-type'], 'Point'],
        paint: { 'circle-radius': 4, 'circle-color': '#fff', 'circle-stroke-color': '#0e2a47', 'circle-stroke-width': 1.5 },
      })
      setReady(true)
    })

    const onClick = (e: MapMouseEvent) => {
      if (drawingRef.current) {
        addVertex([e.lngLat.lng, e.lngLat.lat])
        return
      }
      const f = map.queryRenderedFeatures(e.point, { layers: ['csb-fill'] })[0]
      if (f && cbRef.current.onSelectField) {
        const feature: Feature = { type: 'Feature', properties: { ...f.properties }, geometry: f.geometry }
        cbRef.current.onSelectField(feature, metaFromCsb(f.properties ?? {}))
      }
    }
    const onDbl = (e: MapMouseEvent) => {
      if (!drawingRef.current) return
      e.preventDefault()
      finishDraw()
    }
    const onMove = (e: MapMouseEvent) => {
      if (drawingRef.current) {
        hover.current = [e.lngLat.lng, e.lngLat.lat]
        renderDraft()
        return
      }
      const hit = map.getLayer('csb-fill') && map.queryRenderedFeatures(e.point, { layers: ['csb-fill'] }).length > 0
      map.getCanvas().style.cursor = hit ? 'pointer' : ''
    }
    map.on('click', onClick)
    map.on('dblclick', onDbl)
    map.on('mousemove', onMove)
    return () => {
      map.remove()
      mapRef.current = null
      setReady(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ---------- selected field ----------
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    setFieldData(map, geometry)
    const b = bboxOf(geometry)
    if (b) map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: 48, duration: reduced.current ? 0 : 1200, maxZoom: 17 })
  }, [ready, geometry])

  // ---------- imagery stamp ----------
  useEffect(() => {
    let live = true
    if (!center) {
      setStamp(null)
      return
    }
    const eox: Stamp = {
      text: `Sentinel-2 cloudless · 2016 · ${EOX_S2_2016.resolution}`,
      evidence: {
        source: 'EOX IT Services GmbH',
        product: 'Sentinel-2 cloudless 2016 (s2cloudless_3857)',
        native_res: EOX_S2_2016.resolution,
        licence: 'CC BY 4.0',
        citation: 'Sentinel-2 cloudless – s2maps.eu by EOX IT Services GmbH (Contains modified Copernicus Sentinel data 2016 & 2017)',
        is_nasa: false,
      },
    }
    if (!inUS) {
      setStamp(eox)
      return
    }
    setStamp({ text: 'NAIP (latest available)', evidence: naipEvidence(null) })
    naipStampAt(center[1], center[0]).then((s) => {
      if (!live) return
      if (!s) setStamp(eox)
      else
        setStamp({
          text: ['NAIP', s.acquired ? monthYear(s.acquired) : s.year ? String(s.year) : 'latest available', s.resolution]
            .filter(Boolean)
            .join(' · '),
          evidence: naipEvidence(s),
        })
    })
    return () => {
      live = false
    }
  }, [center, inUS])

  // ---------- neighbouring CSB fields ----------
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    if (!showNeighbours) {
      setGeoJson(map, 'csb', EMPTY_FC)
      setNeighbourCount(null)
      return
    }
    let ac: AbortController | null = null
    let timer = 0
    let lastKey = ''
    const load = () => {
      if (map.getZoom() < NEIGHBOUR_MIN_ZOOM) return
      const b = map.getBounds()
      const [w, s, e, n] = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]
      if (!inBounds((w + e) / 2, (s + n) / 2, NAIP_BOUNDS)) return
      const key = [w, s, e, n].map((v) => v.toFixed(3)).join(',')
      if (key === lastKey) return
      lastKey = key
      ac?.abort()
      ac = new AbortController()
      const q = new URLSearchParams({ w: w.toFixed(5), s: s.toFixed(5), e: e.toFixed(5), n: n.toFixed(5) })
      fetch(`${apiBase}/api/fields/bbox?${q}`, { signal: ac.signal })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .then((fc: FeatureCollection) => {
          setGeoJson(map, 'csb', fc)
          setNeighbourCount(fc.features?.length ?? 0)
        })
        .catch((err: Error) => {
          if (err.name !== 'AbortError') console.warn('[FieldMap] neighbours', err)
        })
    }
    const onMoveEnd = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(load, 350)
    }
    map.on('moveend', onMoveEnd)
    onMoveEnd()
    return () => {
      map.off('moveend', onMoveEnd)
      window.clearTimeout(timer)
      ac?.abort()
    }
  }, [ready, showNeighbours, apiBase])

  // ---------- terrain zones ----------
  const wantZones = active.has('erosion_zones')
  useEffect(() => {
    if (!wantZones || terrainZones || !fieldId) return
    const ac = new AbortController()
    setFetchedZones(null)
    setZonesNote('Loading terrain zones…')
    fetch(`${apiBase}/api/fields/${encodeURIComponent(fieldId)}/report`, { signal: ac.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((rep) => {
        const z: TerrainZone[] = rep?.terrain?.zones ?? []
        setFetchedZones(z)
        setZonesNote(z.length ? null : 'No terrain zones in this field report')
      })
      .catch((e: Error) => {
        if (e.name !== 'AbortError') setZonesNote('Terrain zones not available yet (field report missing)')
      })
    return () => ac.abort()
  }, [wantZones, terrainZones, fieldId, apiBase])
  const zones = terrainZones ?? fetchedZones
  const zoneGrid = useMemo(() => (zones?.length ? zonesToCells(zones) : null), [zones])

  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    setGeoJson(map, 'zones', zoneGrid?.fc ?? EMPTY_FC)
    const vis = wantZones && zoneGrid ? 'visible' : 'none'
    for (const id of ['zones-fill', 'lowspots-fill', 'lowspots-line']) map.setLayoutProperty(id, 'visibility', vis)
  }, [ready, zoneGrid, wantZones])

  // ---------- GIBS overlays ----------
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    for (const o of GIBS_OVERLAYS) {
      const src = map.getSource(`gibs-${o.id}`) as { setTiles?: (t: string[]) => void } | undefined
      src?.setTiles?.([gibsTemplate(o, overlayDate)])
      map.setLayoutProperty(`gibs-${o.id}`, 'visibility', active.has(o.id) ? 'visible' : 'none')
    }
  }, [ready, active, overlayDate])

  useEffect(() => {
    const ac = new AbortController()
    for (const o of GIBS_OVERLAYS) {
      if (!active.has(o.id)) continue
      gibsActualDate(o, overlayDate, ac.signal).then((d) => {
        if (!ac.signal.aborted) setOverlayDates((prev) => ({ ...prev, [`${o.id}@${overlayDate}`]: d }))
      })
    }
    return () => ac.abort()
  }, [active, overlayDate])

  // ---------- Satellite / Map ----------
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready || !map.getLayer('streets')) return
    map.setLayoutProperty('streets', 'visibility', streets ? 'visible' : 'none')
    try { localStorage.setItem('fieldshift-basemap', streets ? 'map' : 'satellite') } catch { /* private window */ }
  }, [streets, ready])

  // ---------- 2D / 3D ----------
  const togglePitch = () => {
    const map = mapRef.current
    if (!map) return
    const next = !pitched
    setPitched(next)
    if (next) map.setTerrain({ source: 'dem', exaggeration: 1 })
    else map.setTerrain(null)
    map.easeTo({ pitch: next ? 60 : 0, duration: reduced.current ? 0 : 800 })
  }

  // ---------- drawing ----------
  const renderDraft = useCallback(() => {
    const map = mapRef.current
    if (!map) return
    const pts = draft.current
    const line = hover.current && drawingRef.current ? [...pts, hover.current] : pts
    const feats: Feature[] = pts.map((p) => ({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: p } }))
    if (line.length >= 2)
      feats.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [...line, ...(line.length >= 3 ? [line[0]] : [])] } })
    if (line.length >= 3)
      feats.push({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[...line, line[0]]] } })
    setGeoJson(map, 'draft', { type: 'FeatureCollection', features: feats })
  }, [])

  const addVertex = (p: [number, number]) => {
    const last = draft.current[draft.current.length - 1]
    if (last && Math.abs(last[0] - p[0]) < 1e-9 && Math.abs(last[1] - p[1]) < 1e-9) return
    draft.current = [...draft.current, p]
    setDraftCount(draft.current.length)
    renderDraft()
  }
  const stopDraw = () => {
    drawingRef.current = false
    setDrawing(false)
    draft.current = []
    hover.current = null
    setDraftCount(0)
    renderDraft()
    mapRef.current?.doubleClickZoom.enable()
  }
  const finishDraw = () => {
    // A double-click also fires two clicks: drop duplicate trailing vertices.
    const pts = draft.current.filter((p, i, a) => i === 0 || Math.hypot(p[0] - a[i - 1][0], p[1] - a[i - 1][1]) > 1e-7)
    if (pts.length < 3) {
      setMessage('A field needs at least 3 points.')
      return
    }
    const geom: Polygon = { type: 'Polygon', coordinates: [[...pts, pts[0]]] }
    const ha = areaHa(geom)
    stopDraw()
    setMessage(`Drawn boundary: ${ha.toFixed(1)} ha (${(ha * 2.47105).toFixed(1)} acres)`)
    cbRef.current.onGeometryInput?.(geom, { source: 'draw', areaHa: ha })
  }
  const startDraw = () => {
    setMessage(null)
    drawingRef.current = true
    setDrawing(true)
    draft.current = []
    setDraftCount(0)
    mapRef.current?.doubleClickZoom.disable()
    elRef.current?.querySelector('canvas')?.focus()
  }
  const finishRef = useRef(finishDraw)
  finishRef.current = finishDraw

  const onKeyDown = (e: React.KeyboardEvent) => {
    const map = mapRef.current
    if (!map) return
    if (drawingRef.current) {
      if (e.key === 'Escape') stopDraw()
      else if (e.key === 'Enter') finishRef.current()
      else if (e.key === ' ') {
        const c = map.getCenter()
        addVertex([c.lng, c.lat])
      } else if (e.key === 'Backspace') {
        draft.current = draft.current.slice(0, -1)
        setDraftCount(draft.current.length)
        renderDraft()
      } else return
      e.preventDefault()
      e.stopPropagation()
    } else if (e.key === 'n' || e.key === 'N') map.resetNorthPitch()
  }

  // ---------- upload ----------
  const onFile = async (file: File) => {
    setMessage(null)
    const name = file.name.toLowerCase()
    try {
      if (name.endsWith('.zip') || name.endsWith('.shp')) {
        setMessage('Zipped shapefile upload is not supported yet. Please export the boundary as GeoJSON or KML and upload that.')
        return
      }
      const text = await file.text()
      let res: { geometry: Polygon | MultiPolygon; name?: string } | null = null
      if (name.endsWith('.kml') || text.trimStart().startsWith('<')) res = parseKml(text)
      else res = firstPolygon(JSON.parse(text))
      if (!res) {
        setMessage(`No polygon found in ${file.name}.`)
        return
      }
      const ha = areaHa(res.geometry)
      setMessage(`Uploaded ${file.name}: ${ha.toFixed(1)} ha (${(ha * 2.47105).toFixed(1)} acres)`)
      cbRef.current.onGeometryInput?.(res.geometry, { source: 'upload', name: res.name ?? file.name, areaHa: ha })
    } catch (err) {
      setMessage(`Could not read ${file.name}: ${(err as Error).message}`)
    }
  }

  // ---------- imperative API ----------
  useImperativeHandle(
    ref,
    () => ({
      flyTo: (t: FlyToTarget) => {
        const map = mapRef.current
        if (!map) return
        const duration = reduced.current ? 0 : (t.duration ?? 1.5) * 1000
        if (t.bbox) map.fitBounds([[t.bbox[0], t.bbox[1]], [t.bbox[2], t.bbox[3]]], { padding: 48, duration, maxZoom: 17 })
        else map.flyTo({ center: [t.lon, t.lat], zoom: heightToZoom(t.height ?? 3000), duration })
      },
      resetNorth: () => mapRef.current?.resetNorthPitch(),
    }),
    [],
  )

  const zoomBy = (d: number) => mapRef.current?.zoomTo(mapRef.current.getZoom() + d, { duration: reduced.current ? 0 : 300 })

  const overlayNotes = GIBS_OVERLAYS.filter((o) => active.has(o.id))
  const showWind = active.has('wind')

  return (
    <div className={`fsm-root fsm-root--stack ${drawing ? 'fsm-drawing' : ''} ${className ?? ''}`} onKeyDown={onKeyDown}>
      <div className="fsm-mapbox">
      <div ref={elRef} className="fsm-canvas" role="region" aria-label={ariaLabel ?? `Field map${fieldName ? `: ${fieldName}` : ''}`} />
      {drawing && <div className="fsm-crosshair" aria-hidden="true" />}
      <div className="fsm-controls">
        <button type="button" className="fsm-btn" aria-label="Zoom in" title="Zoom in" onClick={() => zoomBy(1)}>
          +
        </button>
        <button type="button" className="fsm-btn" aria-label="Zoom out" title="Zoom out" onClick={() => zoomBy(-1)}>
          −
        </button>
      </div>
      {drawing && (
        <div className="fsm-draw-hint" role="status">
          {draftCount} point{draftCount === 1 ? '' : 's'} · Click to add points, double-click or Enter to finish, Esc to cancel. Keyboard:
          Space adds the centre point, Backspace undoes.
        </div>
      )}
      </div>

      <div className="fsm-below">
      <div className="fsm-tools" role="group" aria-label="Map tools">
        {toolbar}
        <span className="fsm-tools__sep" aria-hidden="true" />
        <span className="fsm-seg" role="group" aria-label="Background">
          <button type="button" className="fsm-btn" aria-pressed={!streets} title="Satellite and aerial photos" onClick={() => setStreets(false)}>
            Satellite
          </button>
          <button type="button" className="fsm-btn" aria-pressed={streets} title="Street map with roads and place names (OpenStreetMap)" onClick={() => setStreets(true)}>
            Map
          </button>
        </span>
        <button type="button" className="fsm-btn" aria-label="Reset north" title="Reset north" onClick={() => mapRef.current?.resetNorthPitch()}>
          N
        </button>
        <button type="button" className="fsm-btn" aria-pressed={pitched} title="Tilt the map (3D)" onClick={togglePitch}>
          {pitched ? '3D' : '2D'}
        </button>
        <button
          type="button"
          className="fsm-btn"
          aria-pressed={drawing}
          title="Draw a field: click to add points, double-click to finish, Esc cancels"
          onClick={() => (drawing ? stopDraw() : startDraw())}
        >
          {drawing ? 'Cancel drawing' : 'Draw a boundary'}
        </button>
        {drawing && draftCount >= 3 && (
          <button type="button" className="fsm-btn" onClick={() => finishRef.current()}>
            Finish
          </button>
        )}
        <button type="button" className="fsm-btn" title="Upload GeoJSON or KML" onClick={() => fileRef.current?.click()}>
          Upload a boundary
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".geojson,.json,.kml,.zip"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) void onFile(f)
            e.target.value = ''
          }}
        />
      </div>

      <div className="fsm-notes">
        {stamp && (
          <span className="fsm-chip">
            {stamp.text} <DataButton evidence={stamp.evidence} describes="map imagery" />
          </span>
        )}
        {overlayNotes.map((o) => {
          const d = overlayDates[`${o.id}@${overlayDate}`]
          return (
            <span key={o.id} className="fsm-chip fsm-chip--muted">
              {o.label} · {d ? d : overlayDate === 'default' ? 'latest' : overlayDate} · {o.scaleNote}
              <DataButton
                describes={o.label}
                evidence={{
                  source: 'NASA GIBS',
                  product: o.product,
                  observation_end: d ?? undefined,
                  effective_res: o.scaleNote,
                  qa_flags: ['map display only: colours are not data values'],
                  citation: ATTRIBUTION.gibs,
                  is_nasa: true,
                }}
              />
            </span>
          )
        })}
        {(active.has('cover') || active.has('soils')) && (
          <span className="fsm-chip fsm-chip--warn" role="status">
            {[active.has('cover') && 'Cover', active.has('soils') && 'Soils'].filter(Boolean).join(' and ')} map layer not available
            yet
          </span>
        )}
        {wantZones && !zoneGrid && (
          <span className="fsm-chip fsm-chip--warn" role="status">
            {terrainZones ? 'No terrain zones for this field' : fieldId ? (zonesNote ?? 'Loading terrain zones…') : 'Terrain zones need a saved field'}
          </span>
        )}
        {neighbourCount != null && showNeighbours && (
          <span className="fsm-chip fsm-chip--muted">
            {neighbourCount} USDA field boundaries in view
            <DataButton
              describes="field boundaries"
              evidence={{ source: 'USDA NASS', product: 'Crop Sequence Boundaries 2017–2024', licence: 'Public domain', citation: ATTRIBUTION.csb, is_nasa: false }}
            />
          </span>
        )}
        {message && (
          <span className="fsm-chip fsm-chip--muted" role="status" style={{ whiteSpace: 'normal', height: 'auto', padding: '6px 10px' }}>
            {message}
          </span>
        )}
      </div>

      <div className="fsm-legends">
      {showWind && (
        <div className="fsm-windrose-inset">
          {fieldId ? (
            <WindRose fieldId={fieldId} months={windMonths} apiBase={apiBase} size={140} />
          ) : (
            <div className="fsm-windrose">Wind rose needs a saved field.</div>
          )}
        </div>
      )}

      {wantZones && zoneGrid && (
        <div className="fsm-legend" aria-label="Erosion zones legend">
          <h4>Slope (erosion zones)</h4>
          <div
            className="fsm-ramp"
            style={{ background: `linear-gradient(to right, ${SLOPE_STOPS.map((_, i) => slopeColor(i)).join(',')})` }}
          />
          <div className="fsm-ramp-labels">
            {SLOPE_STOPS.map((s, i) => (
              <span key={s}>{i === SLOPE_STOPS.length - 1 ? `≥${s}%` : `${s}%`}</span>
            ))}
          </div>
          <p>
            <span className="fsm-swatch" /> Low spots (more than {Math.abs(LOW_SPOT_M)} m below the field median): frost-pocket and
            wet-spot proxy, {zoneGrid.lowShare}% of map cells
          </p>
          <p>
            Cells ≈{zoneGrid.cellM} m from USGS 3DEP elevation{' '}
            <DataButton
              describes="terrain zones"
              evidence={{ source: 'USGS', product: '3D Elevation Program (3DEP)', native_res: `cells ≈${zoneGrid.cellM} m`, licence: 'Public domain', citation: ATTRIBUTION.elevation3dep, is_nasa: false }}
            />
          </p>
        </div>
      )}
      </div>
      </div>
    </div>
  )
})

export default FieldMap

// ---------- helpers ----------

function naipEvidence(s: NaipStamp | null): Evidence {
  return {
    source: 'USDA FSA / USGS The National Map',
    product: 'NAIP orthoimagery (USGSNAIPImagery)',
    observation_end: s?.acquired ?? undefined,
    native_res: s?.resolution ?? undefined,
    footprint: s?.state ? `NAIP ${s.state} ${s.year ?? ''}`.trim() : undefined,
    licence: 'Public domain',
    citation: ATTRIBUTION.naip,
    is_nasa: false,
  }
}

/** Build the same `meta` shape as GET /api/fields/at from a CSB feature's properties. */
export const metaFromCsb = (p: Record<string, unknown>): FieldMeta => csbMeta(p)

/** Terrain zone points -> square cells (GeoJSON) sized from the grid spacing. */
function zonesToCells(zones: TerrainZone[]) {
  const step = (vals: number[]) => {
    const u = [...new Set(vals.map((v) => v.toFixed(6)))].map(Number).sort((a, b) => a - b)
    const d: number[] = []
    for (let i = 1; i < u.length; i++) if (u[i] - u[i - 1] > 1e-7) d.push(u[i] - u[i - 1])
    d.sort((a, b) => a - b)
    return d.length ? d[Math.floor(d.length / 2)] : 0.0003
  }
  const dx = step(zones.map((z) => z[0]))
  const dy = step(zones.map((z) => z[1]))
  const lat0 = zones[0][1]
  const cellM = Math.round(Math.sqrt(dx * 111320 * Math.cos((lat0 * Math.PI) / 180) * dy * 110574))
  let low = 0
  const fc: FeatureCollection = {
    type: 'FeatureCollection',
    features: zones.map(([x, y, slope, rel]) => {
      if (rel < LOW_SPOT_M) low++
      const hx = dx / 2, hy = dy / 2
      return {
        type: 'Feature',
        properties: { slope, rel },
        geometry: { type: 'Polygon', coordinates: [[[x - hx, y - hy], [x + hx, y - hy], [x + hx, y + hy], [x - hx, y + hy], [x - hx, y - hy]]] },
      }
    }),
  }
  return { fc, cellM, lowShare: Math.round((100 * low) / zones.length) }
}
