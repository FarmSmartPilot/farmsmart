// 2D / mobile fallback for GlobeView: a MapLibre world map with the same props,
// including the Globe Home drill-down (zoom levels, county outlines, field boundaries, draw your own).
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { AttributionControl, Map as MLMap, NavigationControl, type MapMouseEvent } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { Feature, FeatureCollection, Polygon } from 'geojson'
import { areaHa, greatCircle, prefersReducedMotion } from './geo'
import { addFieldLayers, addReferenceLayers, baseStyle, EMPTY_FC, FIELD_YELLOW, heightToZoom, setFieldData, setGeoJson } from './mlCommon'
import {
  clickTargetHeight,
  COUNTY_ATTRIBUTION,
  COUNTY_MAX_H,
  COUNTY_MIN_H,
  FieldBoundaryStore,
  FIELDS_MAX_H,
  FTW_MAX_H,
  LEVEL_HEIGHT,
  levelOf,
  waitForField,
  type DrillLevel,
} from './drill'
import type { FlatMapProps, FlyToTarget, MapHandle } from './types'
import './map.css'

const ARC_PURPLE = '#6B4FA0'
/** Inverse of heightToZoom: approximate camera height (m) for a web-mercator zoom. */
const zoomToHeight = (z: number) => 4e7 / 2 ** z
const dataBase = () => `${(import.meta.env.BASE_URL || '/').replace(/\/$/, '')}/data`

export const FlatMap = forwardRef<MapHandle, FlatMapProps>(function FlatMap(props, ref) {
  const { onPickPoint, fieldGeometry, arcs, showReference = true, ariaLabel, className, drillDown = false } = props
  const cb = useRef(props)
  cb.current = props
  const elRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MLMap | null>(null)
  const [ready, setReady] = useState(false)
  const pending = useRef<FlyToTarget | null>(null)
  const pickRef = useRef(onPickPoint)
  pickRef.current = onPickPoint
  const drillRef = useRef(drillDown)
  drillRef.current = drillDown
  const reduced = useRef(prefersReducedMotion())
  const storeRef = useRef<FieldBoundaryStore | null>(null)
  const hoverKey = useRef<string | null>(null)
  const draw = useRef<{ active: boolean; pts: [number, number][]; hover: [number, number] | null }>({ active: false, pts: [], hover: null })
  const evRef = useRef<{ click: (e: MapMouseEvent) => void; move: (e: MapMouseEvent) => void; dbl: (e: MapMouseEvent) => void }>({
    click: () => undefined,
    move: () => undefined,
    dbl: () => undefined,
  })

  useEffect(() => {
    if (!elRef.current) return
    const t0 = performance.now()
    const map = new MLMap({
      container: elRef.current,
      style: baseStyle(),
      center: [-60, 25],
      zoom: 1.4,
      attributionControl: false,
      maxPitch: 60,
      maxZoom: 19,
      renderWorldCopies: true,
    })
    mapRef.current = map
    map.addControl(new AttributionControl({ compact: true }), 'bottom-right')
    map.addControl(new NavigationControl({ visualizePitch: true }), 'top-right')
    map.getCanvas().setAttribute(
      'aria-label',
      ariaLabel ?? 'World map. Arrow keys pan, plus and minus zoom, Enter selects the point at the centre.',
    )
    map.on('load', () => {
      if (showReference) addReferenceLayers(map)
      if (drillDown) {
        map.addSource('us-counties', { type: 'geojson', data: new URL(`${dataBase()}/us_counties.geojson`, window.location.href).href, attribution: COUNTY_ATTRIBUTION })
        map.addLayer({
          id: 'us-counties-line',
          type: 'line',
          source: 'us-counties',
          minzoom: heightToZoom(COUNTY_MAX_H),
          maxzoom: heightToZoom(COUNTY_MIN_H),
          paint: { 'line-color': '#e8eef5', 'line-opacity': 0.4, 'line-width': 0.8 },
        })
        const fieldsMin = heightToZoom(FIELDS_MAX_H)
        map.addSource('drill-fields', { type: 'geojson', data: EMPTY_FC })
        // Fields of The World outlines are dense: thinner, and only from a closer zoom (FTW_MAX_H).
        const ftwMin = heightToZoom(FTW_MAX_H)
        map.addLayer({ id: 'drill-fields-halo', type: 'line', source: 'drill-fields', minzoom: fieldsMin, filter: ['!=', ['get', '_src'], 'ftw'], paint: { 'line-color': '#0b1d30', 'line-width': 3.5 } })
        map.addLayer({ id: 'drill-fields-line', type: 'line', source: 'drill-fields', minzoom: fieldsMin, filter: ['!=', ['get', '_src'], 'ftw'], paint: { 'line-color': '#ffffff', 'line-width': 1.4 } })
        map.addLayer({ id: 'drill-ftw-halo', type: 'line', source: 'drill-fields', minzoom: ftwMin, filter: ['==', ['get', '_src'], 'ftw'], paint: { 'line-color': '#0b1d30', 'line-width': 2.4 } })
        map.addLayer({ id: 'drill-ftw-line', type: 'line', source: 'drill-fields', minzoom: ftwMin, filter: ['==', ['get', '_src'], 'ftw'], paint: { 'line-color': '#ffffff', 'line-width': 0.9 } })
        map.addSource('drill-hover', { type: 'geojson', data: EMPTY_FC })
        map.addLayer({ id: 'drill-hover-fill', type: 'fill', source: 'drill-hover', paint: { 'fill-color': '#ffffff', 'fill-opacity': 0.22 } })
        map.addLayer({ id: 'drill-hover-line', type: 'line', source: 'drill-hover', paint: { 'line-color': '#ffffff', 'line-width': 3 } })
      }
      addFieldLayers(map)
      if (drillDown) {
        map.addSource('draft', { type: 'geojson', data: EMPTY_FC })
        map.addLayer({ id: 'draft-fill', type: 'fill', source: 'draft', filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': FIELD_YELLOW, 'fill-opacity': 0.2 } })
        map.addLayer({ id: 'draft-line', type: 'line', source: 'draft', filter: ['==', ['geometry-type'], 'LineString'], paint: { 'line-color': FIELD_YELLOW, 'line-width': 2.5 } })
        map.addLayer({
          id: 'draft-pts',
          type: 'circle',
          source: 'draft',
          filter: ['==', ['geometry-type'], 'Point'],
          paint: { 'circle-radius': 4.5, 'circle-color': '#fff', 'circle-stroke-color': '#0e2a47', 'circle-stroke-width': 2 },
        })
      }
      map.addSource('arcs', { type: 'geojson', data: EMPTY_FC })
      map.addLayer({
        id: 'arcs-solid',
        type: 'line',
        source: 'arcs',
        filter: ['all', ['==', ['geometry-type'], 'LineString'], ['!', ['get', 'dashed']]],
        layout: { 'line-cap': 'round' },
        paint: { 'line-color': ['get', 'color'], 'line-width': ['get', 'width'] },
      })
      map.addLayer({
        id: 'arcs-dashed',
        type: 'line',
        source: 'arcs',
        filter: ['all', ['==', ['geometry-type'], 'LineString'], ['get', 'dashed']],
        paint: { 'line-color': ['get', 'color'], 'line-width': ['get', 'width'], 'line-dasharray': [3, 2] },
      })
      map.addLayer({
        id: 'arcs-ends',
        type: 'circle',
        source: 'arcs',
        filter: ['==', ['geometry-type'], 'Point'],
        paint: { 'circle-radius': 5, 'circle-color': ['get', 'color'], 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 },
      })
      map.addLayer({
        id: 'arcs-labels',
        type: 'symbol',
        source: 'arcs',
        filter: ['all', ['==', ['geometry-type'], 'Point'], ['has', 'label']],
        layout: {
          'text-field': ['get', 'label'],
          'text-font': ['Inter', 'Segoe UI', 'Arial', 'sans-serif'],
          'text-size': 13,
          'text-anchor': 'bottom',
          'text-offset': [0, -0.7],
          'text-allow-overlap': true,
        },
        paint: { 'text-color': '#fff', 'text-halo-color': '#08182a', 'text-halo-width': 1.8 },
      })
      console.info(`[FlatMap] first render ${Math.round(performance.now() - t0)} ms`)
      setReady(true)
    })
    map.on('click', (e) => evRef.current.click(e))
    map.on('mousemove', (e) => evRef.current.move(e))
    map.on('dblclick', (e) => evRef.current.dbl(e))
    return () => {
      map.remove()
      mapRef.current = null
      setReady(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showReference, drillDown])

  useEffect(() => {
    const map = mapRef.current
    if (ready && map) setFieldData(map, fieldGeometry)
  }, [ready, fieldGeometry])

  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    const fc: FeatureCollection = { type: 'FeatureCollection', features: [] }
    for (const a of arcs ?? []) {
      const color = a.color ?? ARC_PURPLE
      const props = { color, dashed: !!a.dashed, width: a.width ?? 3 }
      fc.features.push({
        type: 'Feature',
        properties: props,
        geometry: { type: 'LineString', coordinates: greatCircle([a.from.lon, a.from.lat], [a.to.lon, a.to.lat], 128) },
      })
      for (const end of [a.from, a.to])
        fc.features.push({
          type: 'Feature',
          properties: end.label ? { ...props, label: end.label } : props,
          geometry: { type: 'Point', coordinates: [end.lon, end.lat] },
        })
    }
    setGeoJson(map, 'arcs', fc)
  }, [ready, arcs])

  // ---------- drill-down: levels and field boundaries ----------
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map || !drillDown) return
    const store = new FieldBoundaryStore('', () => {
      setGeoJson(map, 'drill-fields', {
        type: 'FeatureCollection',
        features: store.all().map((f) => ({ ...f.feature, properties: { ...(f.feature.properties ?? {}), _src: f.source } })),
      })
      cb.current.onFieldsStatus?.(store.status())
    })
    storeRef.current = store
    let cur: DrillLevel | null = null
    const info = () => {
      const c = map.getCenter().wrap()
      return { height: zoomToHeight(map.getZoom()), lon: c.lng, lat: c.lat }
    }
    const onMove = () => {
      const i = info()
      const lv = levelOf(i.height)
      if (lv === cur) return
      cur = lv
      if (i.height >= FIELDS_MAX_H) setHover(null)
      cb.current.onLevelChange?.(lv, i)
    }
    let timer = 0
    const onMoveEnd = () => {
      onMove()
      const i = info()
      cb.current.onLevelChange?.(levelOf(i.height), i)
      window.clearTimeout(timer)
      if (i.height >= FIELDS_MAX_H) return
      timer = window.setTimeout(() => {
        if (zoomToHeight(map.getZoom()) >= FIELDS_MAX_H) return
        const b = map.getBounds()
        const c = map.getCenter().wrap()
        store.ensure([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()], [c.lng, c.lat])
        cb.current.onFieldsStatus?.(store.status())
      }, 600)
    }
    map.on('move', onMove)
    map.on('moveend', onMoveEnd)
    onMoveEnd()
    return () => {
      map.off('move', onMove)
      map.off('moveend', onMoveEnd)
      window.clearTimeout(timer)
      store.dispose()
      storeRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, drillDown])

  const setHover = (f: Feature | null, key: string | null = null) => {
    const map = mapRef.current
    if (!map || key === hoverKey.current) return
    hoverKey.current = key
    setGeoJson(map, 'drill-hover', f ? { type: 'FeatureCollection', features: [f] } : EMPTY_FC)
    map.getCanvas().style.cursor = f ? 'pointer' : draw.current.active ? 'crosshair' : ''
  }

  // ---------- drill-down: draw your own boundary ----------
  const renderDraft = () => {
    const map = mapRef.current
    if (!map) return
    const d = draw.current
    const line = d.hover && d.active ? [...d.pts, d.hover] : d.pts
    const feats: Feature[] = d.pts.map((p) => ({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: p } }))
    if (line.length >= 2)
      feats.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [...line, ...(line.length >= 3 ? [line[0]] : [])] } })
    if (line.length >= 3) feats.push({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[...line, line[0]]] } })
    setGeoJson(map, 'draft', { type: 'FeatureCollection', features: feats })
  }
  const notifyDraw = (geometry?: Polygon) => {
    const d = draw.current
    const ring = d.pts.length >= 3 ? [...d.pts, d.pts[0]] : null
    cb.current.onDrawChange?.({
      active: d.active,
      points: d.pts.length,
      areaHa: geometry ? areaHa(geometry) : ring ? areaHa({ type: 'Polygon', coordinates: [ring] }) : null,
      geometry,
    })
  }
  const endDraw = () => {
    draw.current = { active: false, pts: [], hover: null }
    renderDraft()
    const map = mapRef.current
    if (map) {
      map.doubleClickZoom.enable()
      map.getCanvas().style.cursor = ''
    }
  }
  const startDraw = () => {
    const map = mapRef.current
    if (!map) return
    setHover(null)
    draw.current = { active: true, pts: [], hover: null }
    map.doubleClickZoom.disable()
    map.getCanvas().style.cursor = 'crosshair'
    renderDraft()
    notifyDraw()
  }
  const addVertex = (p: [number, number]) => {
    const d = draw.current
    if (!d.active) return
    const last = d.pts[d.pts.length - 1]
    if (last && Math.hypot(last[0] - p[0], last[1] - p[1]) < 1e-7) return
    d.pts.push(p)
    renderDraft()
    notifyDraw()
  }
  const undoDrawPoint = () => {
    if (!draw.current.active || !draw.current.pts.length) return
    draw.current.pts.pop()
    renderDraft()
    notifyDraw()
  }
  const finishDraw = () => {
    const d = draw.current
    if (!d.active) return
    // A double-click also fires two clicks: drop near-duplicate trailing vertices.
    const pts = d.pts.filter((p, i, a) => i === 0 || Math.hypot(p[0] - a[i - 1][0], p[1] - a[i - 1][1]) > 1e-6)
    if (pts.length < 3) return
    const geometry: Polygon = { type: 'Polygon', coordinates: [[...pts, pts[0]]] }
    endDraw()
    draw.current.pts = pts
    notifyDraw(geometry)
    draw.current.pts = []
  }
  const cancelDraw = () => {
    if (!draw.current.active) return
    endDraw()
    notifyDraw()
  }

  const drillClick = (lon: number, lat: number) => {
    const map = mapRef.current
    if (!map) return
    const lv = levelOf(zoomToHeight(map.getZoom()))
    const target = clickTargetHeight(lv)
    if (target != null) {
      flyRef.current({ lon, lat, height: target, duration: 2 })
      return
    }
    const store = storeRef.current
    const f = store?.hit(lon, lat) ?? null
    // A Fields of The World outline that is not drawn yet (too high): fly closer first so the farmer sees it.
    if (f?.source === 'ftw' && zoomToHeight(map.getZoom()) >= FTW_MAX_H) {
      flyRef.current({ lon, lat, height: FTW_MAX_H * 0.6, duration: 1.5 })
      return
    }
    cb.current.onFieldPick?.(
      f ? { kind: 'field', lat, lon, field: f } : { kind: 'none', lat, lon, loading: !!store && (store.loadingAt(lon, lat) || store.status().loading) },
    )
  }

  evRef.current = {
    click: (e) => {
      const ll = e.lngLat.wrap()
      if (draw.current.active) return addVertex([ll.lng, ll.lat])
      if (!drillRef.current) return pickRef.current?.(ll.lat, ll.lng)
      drillClick(ll.lng, ll.lat)
    },
    move: (e) => {
      const ll = e.lngLat.wrap()
      if (draw.current.active) {
        draw.current.hover = [ll.lng, ll.lat]
        renderDraft()
        return
      }
      const map = mapRef.current
      if (!drillRef.current || !storeRef.current || !map) return
      const h = zoomToHeight(map.getZoom())
      const hit = h < FIELDS_MAX_H ? storeRef.current.hit(ll.lng, ll.lat) : null
      const f = hit?.source === 'ftw' && h >= FTW_MAX_H ? null : hit
      setHover(f?.feature ?? null, f?.key ?? null)
    },
    dbl: (e) => {
      if (!draw.current.active) return
      e.preventDefault()
      finishDraw()
    },
  }

  const zoomToLevel = (lv: DrillLevel) => {
    const map = mapRef.current
    if (!map) return
    const c = map.getCenter().wrap()
    flyRef.current({ lon: c.lng, lat: c.lat, height: LEVEL_HEIGHT[lv], duration: 1.6 })
  }

  const flyTo = (t: FlyToTarget) => {
    const map = mapRef.current
    if (!map || !ready) {
      pending.current = t
      return
    }
    const duration = reduced.current ? 0 : (t.duration ?? 2.5) * 1000
    if (t.bbox) map.fitBounds([[t.bbox[0], t.bbox[1]], [t.bbox[2], t.bbox[3]]], { padding: 60, duration, maxZoom: 17 })
    else map.flyTo({ center: [t.lon, t.lat], zoom: heightToZoom(t.height ?? 25000), duration, essential: true })
  }
  const flyRef = useRef(flyTo)
  flyRef.current = flyTo
  const pickAt = async (lat: number, lon: number) => {
    const f = await waitForField(() => storeRef.current, lon, lat)
    cb.current.onFieldPick?.(f ? { kind: 'field', lat, lon, field: f } : { kind: 'none', lat, lon })
    return !!f
  }
  const api = useRef({ zoomToLevel, startDraw, undoDrawPoint, finishDraw, cancelDraw, pickAt })
  api.current = { zoomToLevel, startDraw, undoDrawPoint, finishDraw, cancelDraw, pickAt }
  useImperativeHandle(
    ref,
    () => ({
      flyTo: (t) => flyRef.current(t),
      resetNorth: () => mapRef.current?.resetNorthPitch(),
      zoomToLevel: (lv) => api.current.zoomToLevel(lv),
      startDraw: () => api.current.startDraw(),
      undoDrawPoint: () => api.current.undoDrawPoint(),
      finishDraw: () => api.current.finishDraw(),
      cancelDraw: () => api.current.cancelDraw(),
      pickAt: (lat, lon) => api.current.pickAt(lat, lon),
    }),
    [],
  )
  useEffect(() => {
    if (ready && pending.current) {
      const t = pending.current
      pending.current = null
      flyRef.current(t)
    }
  }, [ready])

  const onKeyDown = (e: React.KeyboardEvent) => {
    const map = mapRef.current
    if (!map) return
    const c = map.getCenter().wrap()
    if (draw.current.active) {
      if (e.key === 'Escape') cancelDraw()
      else if (e.key === 'Enter') finishDraw()
      else if (e.key === ' ') addVertex([c.lng, c.lat])
      else if (e.key === 'Backspace') undoDrawPoint()
      else return
      e.preventDefault()
      return
    }
    if (e.key === 'Enter') {
      if (drillRef.current) drillClick(c.lng, c.lat)
      else pickRef.current?.(c.lat, c.lng)
      e.preventDefault()
    } else if (e.key === 'n' || e.key === 'N') map.resetNorthPitch()
  }

  return (
    <div className={`fsm-root fsm-globe ${className ?? ''}`} onKeyDown={onKeyDown}>
      <div ref={elRef} className="fsm-canvas" role="region" aria-label={ariaLabel ?? 'World map'} />
    </div>
  )
})

export default FlatMap
