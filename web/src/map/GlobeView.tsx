// Globe Home and 3D mode: CesiumJS globe, loaded lazily from /cesium.
// Imagery sharpens with zoom: NASA GIBS Blue Marble -> EOX Sentinel-2 cloudless 2016 -> USDA NAIP (US).
import { forwardRef, lazy, Suspense, useEffect, useImperativeHandle, useRef, useState } from 'react'
import type * as CesiumNS from 'cesium'
import type { Polygon as GeoPolygon } from 'geojson'
import { hasIonToken, loadCesium, type Cesium } from './cesiumLoader'
import {
  areaHa,
  densify,
  detectGlobeSupport,
  distanceM,
  greatCircle,
  loadAdmin0,
  loadAdmin1,
  loadPlaces,
  prefersReducedMotion,
  ringsOf,
  toGeometry,
  type PlaceRow,
} from './geo'
import {
  ATTRIBUTION,
  EOX_S2_2016,
  GIBS_BLUE_MARBLE,
  inBounds,
  NAIP_BOUNDS,
  NAIP_CESIUM_TEMPLATE,
  stripHtml,
} from './sources'
import {
  clickTargetHeight,
  COUNTY_ATTRIBUTION,
  COUNTY_MAX_H,
  COUNTY_MIN_H,
  CSB_ATTRIBUTION,
  FieldBoundaryStore,
  FIELDS_MAX_H,
  FTW_MAX_H,
  LINE_W,
  FTW_ATTRIBUTION,
  LEVEL_HEIGHT,
  levelOf,
  loadCounties,
  waitForField,
  type DrillField,
  type DrillLevel,
} from './drill'
import type { FlyToTarget, GlobeArc, GlobeViewProps, MapHandle } from './types'
import './map.css'

const FlatMap = lazy(() => import('./FlatMap'))

const FIELD_YELLOW = '#F2C230'
const ARC_PURPLE = '#6B4FA0'
const HOME = { lon: -60, lat: 22, height: 2.1e7 }
/** One full turn every 4 minutes. */
const SPIN_RAD_PER_S = (2 * Math.PI) / 240

type Mode = 'checking' | 'globe' | 'flat'

export const GlobeView = forwardRef<MapHandle, GlobeViewProps>(function GlobeView(props, ref) {
  const { preferFlat, onFallback, ...flatProps } = props
  const [mode, setMode] = useState<Mode>(() => (preferFlat ? 'flat' : 'checking'))
  const [fallbackReason, setFallbackReason] = useState<string | null>(preferFlat ? 'preferred' : null)

  useEffect(() => {
    if (preferFlat) {
      setMode('flat')
      return
    }
    const s = detectGlobeSupport()
    if (s.ok) setMode('globe')
    else {
      setMode('flat')
      setFallbackReason(s.reason ?? 'WebGL check failed')
    }
  }, [preferFlat])

  useEffect(() => {
    if (mode === 'flat' && fallbackReason && fallbackReason !== 'preferred') onFallback?.(fallbackReason)
  }, [mode, fallbackReason, onFallback])

  if (mode === 'flat')
    return (
      <Suspense fallback={<div className={`fsm-root fsm-globe ${props.className ?? ''}`} />}>
        <FlatMap ref={ref} {...flatProps} />
      </Suspense>
    )
  if (mode === 'checking') return <div className={`fsm-root fsm-globe ${props.className ?? ''}`} />
  return (
    <CesiumGlobe
      ref={ref}
      {...props}
      onFatal={(reason) => {
        setFallbackReason(reason)
        setMode('flat')
      }}
    />
  )
})

export default GlobeView

interface InnerProps extends GlobeViewProps {
  onFatal: (reason: string) => void
}

interface Runtime {
  C: Cesium
  viewer: CesiumNS.Viewer
  fieldEntities: CesiumNS.Entity[]
  arcEntities: CesiumNS.Entity[]
  arcAnim: { start: number; positions: CesiumNS.Cartesian3[] }[]
}

const CesiumGlobe = forwardRef<MapHandle, InnerProps>(function CesiumGlobe(props, ref) {
  const {
    onPickPoint,
    fieldGeometry,
    arcs,
    autoRotate = true,
    showReference = true,
    ariaLabel,
    className,
    onFatal,
    drillDown = false,
  } = props
  const drillCb = useRef(props)
  drillCb.current = props
  const hostRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLDivElement>(null)
  const creditRef = useRef<HTMLDivElement>(null)
  const compassRef = useRef<SVGSVGElement>(null)
  const rt = useRef<Runtime | null>(null)
  const pending = useRef<FlyToTarget | null>(null)
  const pickRef = useRef(onPickPoint)
  pickRef.current = onPickPoint
  const fatalRef = useRef(onFatal)
  fatalRef.current = onFatal
  const reduced = useRef(prefersReducedMotion())
  const [ready, setReady] = useState(false)
  const [spinning, setSpinning] = useState(autoRotate && !reduced.current)
  const spinRef = useRef(spinning)
  spinRef.current = spinning
  const [status, setStatus] = useState<string | null>('Loading globe…')
  /** Drill-down: current level and whether the view centre is outside NAIP (for the ion note). */
  const [level, setLevel] = useState<DrillLevel>('planet')
  const [outsideNaip, setOutsideNaip] = useState(false)
  const drillRef = useRef(drillDown)
  drillRef.current = drillDown
  /** Click / move / double-click handlers that need fresh closures (set below, called from Cesium events). */
  const evRef = useRef<{
    click: (ll: [number, number], px: CesiumNS.Cartesian2) => void
    move: (ll: [number, number] | null) => void
    dbl: () => void
  }>({ click: () => undefined, move: () => undefined, dbl: () => undefined })

  // ---------- create viewer ----------
  useEffect(() => {
    let disposed = false
    let raf = 0
    const t0 = performance.now()
    const cleanups: (() => void)[] = []
    loadCesium()
      .then((C) => {
        if (disposed || !canvasRef.current || !creditRef.current) return
        let viewer: CesiumNS.Viewer
        try {
          viewer = new C.Viewer(canvasRef.current, {
            baseLayer: false,
            baseLayerPicker: false,
            geocoder: false,
            homeButton: false,
            sceneModePicker: false,
            navigationHelpButton: false,
            animation: false,
            timeline: false,
            fullscreenButton: false,
            infoBox: false,
            selectionIndicator: false,
            creditContainer: creditRef.current,
            terrainProvider: new C.EllipsoidTerrainProvider(),
            requestRenderMode: true,
            maximumRenderTimeChange: Infinity,
            contextOptions: { webgl: { alpha: true } },
          })
        } catch (e) {
          fatalRef.current(`globe failed to start (${(e as Error).message})`)
          return
        }
        console.info(`[GlobeView] Cesium ready + viewer created ${Math.round(performance.now() - t0)} ms`)
        const scene = viewer.scene
        scene.backgroundColor = C.Color.TRANSPARENT
        if (scene.skyBox) scene.skyBox.show = false
        if (scene.sun) scene.sun.show = false
        if (scene.moon) scene.moon.show = false
        scene.globe.baseColor = C.Color.fromCssColorString('#16314f')
        scene.globe.showGroundAtmosphere = true
        scene.screenSpaceCameraController.enableCollisionDetection = true
        // Mouse-wheel zoom goes straight in on the centre of the view (Cesium's default zooms toward the pointer,
        // which slides the globe sideways out of its panel). Pinch and right-drag zoom keep Cesium's behaviour.
        scene.screenSpaceCameraController.zoomEventTypes = [C.CameraEventType.RIGHT_DRAG, C.CameraEventType.PINCH]
        const onWheel = (ev: WheelEvent) => {
          ev.preventDefault()
          const cam = viewer.camera
          const h = cam.positionCartographic.height
          const step = Math.min(0.35, Math.max(0.06, Math.abs(ev.deltaY) / 600))
          if (ev.deltaY < 0) {
            if (h > 120) cam.zoomIn(h * step)
          } else if (h < 3.0e7) cam.zoomOut(h * step)
          scene.requestRender()
        }
        viewer.canvas.addEventListener('wheel', onWheel, { passive: false })
        viewer.camera.percentageChanged = 0.001
        if (hasIonToken()) scene.setTerrain(C.Terrain.fromWorldTerrain())

        // Browsers allow ~6 HTTP/1.1 connections per host. NAIP tiles come through our own API, so cap Cesium's
        // tile requests to that host at 3 and leave room for field-boundary and analysis calls.
        C.RequestScheduler.requestsByServer[window.location.host] = 3

        // Imagery that sharpens with zoom.
        const merc = new C.WebMercatorTilingScheme()
        viewer.imageryLayers.addImageryProvider(
          new C.UrlTemplateImageryProvider({
            url: GIBS_BLUE_MARBLE.template,
            tilingScheme: merc,
            maximumLevel: GIBS_BLUE_MARBLE.maxzoom,
            credit: new C.Credit(stripHtml(ATTRIBUTION.gibs), true),
          }),
        )
        viewer.imageryLayers.add(
          new C.ImageryLayer(
            new C.UrlTemplateImageryProvider({
              url: EOX_S2_2016.template,
              tilingScheme: merc,
              maximumLevel: EOX_S2_2016.maxzoom,
              credit: new C.Credit(stripHtml(ATTRIBUTION.eox2016), true),
            }),
            { minimumTerrainLevel: 6 },
          ),
        )
        const [w, s, e, n] = NAIP_BOUNDS
        viewer.imageryLayers.add(
          new C.ImageryLayer(
            new C.UrlTemplateImageryProvider({
              url: NAIP_CESIUM_TEMPLATE,
              tilingScheme: merc,
              rectangle: C.Rectangle.fromDegrees(w, s, e, n),
              tileWidth: 512,
              tileHeight: 512,
              // Level 17 at 512 px ≈ 0.45 m/px at 42° N: finer than NAIP's native 0.6 m, so full sharpness at Farm level.
              maximumLevel: 17,
              credit: new C.Credit(stripHtml(ATTRIBUTION.naip), true),
            }),
            { minimumTerrainLevel: 11 },
          ),
        )
        if (showReference) {
          viewer.creditDisplay.addStaticCredit(new C.Credit(stripHtml(ATTRIBUTION.naturalEarth), true))
          viewer.creditDisplay.addStaticCredit(new C.Credit(stripHtml(ATTRIBUTION.geonames), true))
        }

        viewer.camera.setView({ destination: C.Cartesian3.fromDegrees(HOME.lon, HOME.lat, HOME.height) })

        rt.current = { C, viewer, fieldEntities: [], arcEntities: [], arcAnim: [] }
        // Test hook (dev only): Playwright reads camera height and primitive counts from here.
        if (import.meta.env.DEV) (window as unknown as { __fsGlobe?: Runtime }).__fsGlobe = rt.current

        // First-render timing (budget < 3 s).
        const off = scene.postRender.addEventListener(() => {
          off()
          console.info(`[GlobeView] first globe render ${Math.round(performance.now() - t0)} ms`)
          setStatus(null)
        })
        scene.renderError.addEventListener((_s: unknown, err: unknown) => {
          console.error('[GlobeView] render error', err)
          fatalRef.current('globe rendering failed')
        })

        // Click to pick (drill-down: fly closer, pick a field, or add a boundary corner).
        const handler = new C.ScreenSpaceEventHandler(scene.canvas)
        handler.setInputAction((ev: { position: CesiumNS.Cartesian2 }) => {
          const ll = pickLonLat(C, viewer, ev.position)
          if (ll) evRef.current.click(ll, ev.position)
        }, C.ScreenSpaceEventType.LEFT_CLICK)
        let moveRaf = 0
        let lastMove: CesiumNS.Cartesian2 | null = null
        handler.setInputAction((ev: { endPosition: CesiumNS.Cartesian2 }) => {
          lastMove = ev.endPosition
          if (moveRaf) return
          moveRaf = requestAnimationFrame(() => {
            moveRaf = 0
            if (lastMove && !viewer.isDestroyed()) evRef.current.move(pickLonLat(C, viewer, lastMove))
          })
        }, C.ScreenSpaceEventType.MOUSE_MOVE)
        // Cesium's default double-click tracks an entity; we use it to finish a drawn boundary.
        viewer.cesiumWidget.screenSpaceEventHandler.removeInputAction(C.ScreenSpaceEventType.LEFT_DOUBLE_CLICK)
        handler.setInputAction(() => evRef.current.dbl(), C.ScreenSpaceEventType.LEFT_DOUBLE_CLICK)
        cleanups.push(() => {
          cancelAnimationFrame(moveRaf)
          handler.destroy()
        })

        // Sharper global imagery when a Cesium ion key is configured (Bing Maps Aerial via ion, below NAIP).
        if (hasIonToken()) {
          try {
            const ionLayer = C.ImageryLayer.fromProviderAsync(C.IonImageryProvider.fromAssetId(2), {
              minimumTerrainLevel: 10,
            })
            viewer.imageryLayers.add(ionLayer, 2)
          } catch (e) {
            console.warn('[GlobeView] ion imagery', e)
          }
        }

        // Any interaction stops the spin.
        const stop = () => setSpinning(false)
        const cv = scene.canvas
        for (const evName of ['pointerdown', 'wheel', 'touchstart'] as const) {
          cv.addEventListener(evName, stop, { passive: true })
          cleanups.push(() => cv.removeEventListener(evName, stop))
        }

        // Compass + label/outline level of detail.
        const onCam = () => {
          if (compassRef.current)
            compassRef.current.style.transform = `rotate(${-C.Math.toDegrees(viewer.camera.heading)}deg)`
        }
        cleanups.push(viewer.camera.changed.addEventListener(onCam))

        // Spin + arc animation loop (only requests frames while something moves).
        let last = performance.now()
        const tick = (now: number) => {
          const dt = Math.min(0.1, (now - last) / 1000)
          last = now
          const r = rt.current
          if (r) {
            if (spinRef.current) {
              r.viewer.camera.rotate(C.Cartesian3.UNIT_Z, -SPIN_RAD_PER_S * dt)
              r.viewer.scene.requestRender()
            } else if (r.arcAnim.length) r.viewer.scene.requestRender()
          }
          raf = requestAnimationFrame(tick)
        }
        raf = requestAnimationFrame(tick)

        setReady(true)
      })
      .catch((e: Error) => {
        if (!disposed) fatalRef.current(e.message)
      })
    return () => {
      disposed = true
      cancelAnimationFrame(raf)
      cleanups.forEach((f) => f())
      const r = rt.current
      rt.current = null
      if (r && !r.viewer.isDestroyed()) r.viewer.destroy()
      setReady(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ---------- reference layers (outlines + labels) ----------
  useEffect(() => {
    const r = rt.current
    if (!ready || !r || !showReference) return
    const { C, viewer } = r
    let cancelled = false
    const scene = viewer.scene
    const admin0 = scene.primitives.add(new C.PolylineCollection())
    const admin1 = scene.primitives.add(new C.PolylineCollection())
    const counties = scene.primitives.add(new C.PolylineCollection())
    const labels = scene.primitives.add(new C.LabelCollection({ scene }))
    const dots = scene.primitives.add(new C.PointPrimitiveCollection())
    admin1.show = false
    counties.show = false
    let admin1Loaded = false
    let countiesLoaded = false
    const countyCredit = new C.Credit(COUNTY_ATTRIBUTION, true)
    let countyCreditOn = false
    let places: PlaceRow[] = []
    const added = new Set<number>()

    const addLines = (coll: CesiumNS.PolylineCollection, rings: number[][][], color: CesiumNS.Color, width: number) => {
      const mat = C.Material.fromType('Color', { color })
      for (const ring of rings) {
        const d = densify(ring, 0.5)
        if (d.length < 2) continue
        coll.add({ positions: C.Cartesian3.fromDegreesArray(d.flat()), width, material: mat })
      }
    }
    const outline = C.Color.WHITE.withAlpha(0.8)
    const outline1 = C.Color.WHITE.withAlpha(0.45)
    const outlineUS = C.Color.WHITE.withAlpha(0.78)
    const outlineCounty = C.Color.fromCssColorString('#e8eef5').withAlpha(0.38)
    const labelFor = (row: PlaceRow, i: number) => {
      if (added.has(i)) return
      added.add(i)
      const [name, lon, lat, pop, tier] = row
      const far = tier === 0 ? 1.1e7 : tier === 1 || pop >= 1e6 ? 2.6e6 : 9e5
      const ddc = new C.DistanceDisplayCondition(0, far)
      const pos = C.Cartesian3.fromDegrees(lon, lat, 0)
      labels.add({
        position: pos,
        text: name,
        font: tier === 0 ? '700 14px Inter, system-ui, sans-serif' : '600 12px Inter, system-ui, sans-serif',
        fillColor: C.Color.WHITE,
        outlineColor: C.Color.fromCssColorString('#08182a').withAlpha(0.95),
        outlineWidth: 4,
        style: C.LabelStyle.FILL_AND_OUTLINE,
        verticalOrigin: C.VerticalOrigin.BOTTOM,
        pixelOffset: new C.Cartesian2(0, -6),
        distanceDisplayCondition: ddc,
        eyeOffset: new C.Cartesian3(0, 0, -2000),
      })
      dots.add({
        position: pos,
        pixelSize: tier === 0 ? 6 : 4,
        color: tier === 0 ? C.Color.fromCssColorString(FIELD_YELLOW) : C.Color.WHITE,
        outlineColor: C.Color.fromCssColorString('#08182a'),
        outlineWidth: 1,
        distanceDisplayCondition: ddc,
      })
    }

    const height = () => viewer.camera.positionCartographic.height
    const refreshLod = () => {
      if (cancelled) return
      const h = height()
      if (h < 6e6 && !admin1Loaded) {
        admin1Loaded = true
        loadAdmin1()
          .then((fc) => {
            if (cancelled) return
            const isUS = (f: (typeof fc.features)[number]) => f.properties?.adm0 === 'USA'
            addLines(admin1, fc.features.filter((f) => !isUS(f)).flatMap((f) => ringsOf(f.geometry)), outline1, 1)
            // US state lines a touch stronger: they guide the drill-down to a state.
            addLines(admin1, fc.features.filter(isUS).flatMap((f) => ringsOf(f.geometry)), outlineUS, 1.6)
            scene.requestRender()
          })
          .catch((e) => console.warn('[GlobeView] admin1', e))
      }
      admin1.show = h < 6e6
      // US counties at State / County level only (drill-down).
      const wantCounties = drillRef.current && h < COUNTY_MAX_H && h >= COUNTY_MIN_H
      if (wantCounties && !countiesLoaded) {
        countiesLoaded = true
        loadCounties()
          .then((fc) => {
            if (cancelled) return
            const mat = C.Material.fromType('Color', { color: outlineCounty })
            for (const ring of fc.features.flatMap((f) => ringsOf(f.geometry))) {
              const d = densify(ring, 0.1)
              if (d.length >= 2) counties.add({ positions: C.Cartesian3.fromDegreesArray(d.flat()), width: 1, material: mat })
            }
            scene.requestRender()
          })
          .catch((e) => console.warn('[GlobeView] counties', e))
      }
      counties.show = wantCounties
      if (wantCounties !== countyCreditOn) {
        countyCreditOn = wantCounties
        if (wantCounties) viewer.creditDisplay.addStaticCredit(countyCredit)
        else viewer.creditDisplay.removeStaticCredit(countyCredit)
      }
      // Add regional labels lazily for what is in view.
      if (h < 3e6 && places.length) {
        const rect = viewer.camera.computeViewRectangle()
        if (rect) {
          const w = C.Math.toDegrees(rect.west), s = C.Math.toDegrees(rect.south)
          const e = C.Math.toDegrees(rect.east), n = C.Math.toDegrees(rect.north)
          const inLon = (x: number) => (w <= e ? x >= w && x <= e : x >= w || x <= e)
          let budget = 2500
          for (let i = 0; i < places.length && budget > 0; i++) {
            const p = places[i]
            if (p[4] === 0 || added.has(i)) continue
            if (p[2] >= s && p[2] <= n && inLon(p[1])) {
              labelFor(p, i)
              budget--
            }
          }
        }
      }
      scene.requestRender()
    }

    loadAdmin0()
      .then((fc) => {
        if (cancelled) return
        addLines(admin0, fc.features.flatMap((f) => ringsOf(f.geometry)), outline, 1.5)
        scene.requestRender()
      })
      .catch((e) => console.warn('[GlobeView] admin0', e))
    loadPlaces()
      .then(({ rows }) => {
        if (cancelled) return
        places = rows
        rows.forEach((p, i) => p[4] === 0 && labelFor(p, i))
        refreshLod()
      })
      .catch((e) => console.warn('[GlobeView] places', e))
    const off = viewer.camera.moveEnd.addEventListener(refreshLod)
    return () => {
      cancelled = true
      off()
      if (!viewer.isDestroyed()) {
        for (const p of [admin0, admin1, counties, labels, dots]) scene.primitives.remove(p)
        if (countyCreditOn) viewer.creditDisplay.removeStaticCredit(countyCredit)
      }
    }
  }, [ready, showReference])

  // ---------- selected field ----------
  useEffect(() => {
    const r = rt.current
    if (!ready || !r) return
    const { C, viewer } = r
    r.fieldEntities.forEach((e) => viewer.entities.remove(e))
    r.fieldEntities = []
    const g = toGeometry(fieldGeometry)
    if (!g) {
      viewer.scene.requestRender()
      return
    }
    const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []
    const yellow = C.Color.fromCssColorString(FIELD_YELLOW)
    const terrain = hasIonToken()
    for (const poly of polys) {
      const [outer, ...holes] = poly
      const toPos = (ring: number[][]) => C.Cartesian3.fromDegreesArray(ring.flatMap((p) => [p[0], p[1]]))
      r.fieldEntities.push(
        viewer.entities.add({
          polygon: {
            hierarchy: new C.PolygonHierarchy(
              toPos(outer),
              holes.map((h) => new C.PolygonHierarchy(toPos(h))),
            ),
            material: yellow.withAlpha(0.25),
          },
        }),
      )
      for (const ring of poly)
        r.fieldEntities.push(
          viewer.entities.add({
            polyline: {
              positions: terrain ? toPos(ring) : lift(C, ring),
              width: 5,
              material: new C.PolylineOutlineMaterialProperty({ color: yellow, outlineColor: C.Color.fromCssColorString('#0b1d30'), outlineWidth: 1.2 }),
              clampToGround: terrain,
            },
          }),
        )
    }
    viewer.scene.requestRender()
  }, [ready, fieldGeometry])

  // ---------- arcs ----------
  useEffect(() => {
    const r = rt.current
    if (!ready || !r) return
    const { C, viewer } = r
    r.arcEntities.forEach((e) => viewer.entities.remove(e))
    r.arcEntities = []
    r.arcAnim = []
    const list: GlobeArc[] = arcs ?? []
    const now = performance.now()
    for (const arc of list) {
      const a: [number, number] = [arc.from.lon, arc.from.lat]
      const b: [number, number] = [arc.to.lon, arc.to.lat]
      const peak = Math.min(distanceM(a, b) * 0.15, 1.5e6)
      const pts = greatCircle(a, b, 128)
      const positions = pts.map(([x, y], i) => C.Cartesian3.fromDegrees(x, y, Math.sin((Math.PI * i) / (pts.length - 1)) * peak))
      const color = C.Color.fromCssColorString(arc.color ?? ARC_PURPLE)
      const anim = { start: now, positions }
      const growMs = reduced.current ? 0 : 1800
      const material = arc.dashed
        ? new C.PolylineDashMaterialProperty({ color, dashLength: 16 })
        : new C.PolylineOutlineMaterialProperty({ color, outlineColor: C.Color.WHITE.withAlpha(0.75), outlineWidth: 1 })
      r.arcEntities.push(
        viewer.entities.add({
          polyline: {
            positions: new C.CallbackProperty(() => {
              const p = growMs ? Math.min(1, (performance.now() - anim.start) / growMs) : 1
              return positions.slice(0, Math.max(2, Math.round(p * positions.length)))
            }, false),
            width: (arc.width ?? 3) + (arc.dashed ? 0 : 2),
            material,
            arcType: C.ArcType.NONE,
          },
        }),
      )
      if (!reduced.current)
        r.arcEntities.push(
          viewer.entities.add({
            position: new C.CallbackPositionProperty(() => {
              const t = ((performance.now() - anim.start) / 3200) % 1
              return positions[Math.min(positions.length - 1, Math.floor(t * positions.length))]
            }, false),
            point: { pixelSize: 7, color: C.Color.WHITE, outlineColor: color, outlineWidth: 2 },
          }),
        )
      for (const end of [arc.from, arc.to]) {
        r.arcEntities.push(
          viewer.entities.add({
            position: C.Cartesian3.fromDegrees(end.lon, end.lat),
            point: { pixelSize: 9, color, outlineColor: C.Color.WHITE, outlineWidth: 2 },
            label: end.label
              ? {
                  text: end.label,
                  font: '600 13px Inter, system-ui, sans-serif',
                  fillColor: C.Color.WHITE,
                  outlineColor: C.Color.fromCssColorString('#08182a'),
                  outlineWidth: 4,
                  style: C.LabelStyle.FILL_AND_OUTLINE,
                  verticalOrigin: C.VerticalOrigin.BOTTOM,
                  pixelOffset: new C.Cartesian2(0, -10),
                  disableDepthTestDistance: Number.POSITIVE_INFINITY,
                }
              : undefined,
          }),
        )
      }
      r.arcAnim.push(anim)
    }
    viewer.scene.requestRender()
  }, [ready, arcs])

  // ---------- drill-down: levels, field boundaries, hover ----------
  const storeRef = useRef<FieldBoundaryStore | null>(null)
  const hoverRef = useRef<{ key: string | null; entities: CesiumNS.Entity[] }>({ key: null, entities: [] })

  const setHover = (f: DrillField | null) => {
    const r = rt.current
    const hv = hoverRef.current
    if (!r || (f?.key ?? null) === hv.key) return
    const { C, viewer } = r
    hv.entities.forEach((e) => viewer.entities.remove(e))
    hv.entities = []
    hv.key = f?.key ?? null
    if (f) {
      const terrain = hasIonToken()
      const g = f.feature.geometry
      const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates
      const toPos = (ring: number[][]) => C.Cartesian3.fromDegreesArray(ring.flatMap((p) => [p[0], p[1]]))
      for (const [outer, ...holes] of polys) {
        hv.entities.push(
          viewer.entities.add({
            polygon: {
              hierarchy: new C.PolygonHierarchy(toPos(outer), holes.map((h) => new C.PolygonHierarchy(toPos(h)))),
              material: C.Color.WHITE.withAlpha(0.22),
              height: terrain ? undefined : 0,
            },
            polyline: {
              positions: terrain ? toPos(outer) : lift(C, outer),
              width: 4,
              material: new C.PolylineOutlineMaterialProperty({ color: C.Color.WHITE, outlineColor: C.Color.fromCssColorString('#0b1d30'), outlineWidth: 1 }),
              clampToGround: terrain,
            },
          }),
        )
      }
    }
    viewer.scene.canvas.style.cursor = f ? 'pointer' : draw.current.active ? 'crosshair' : ''
    viewer.scene.requestRender()
  }

  useEffect(() => {
    const r = rt.current
    if (!ready || !r || !drillDown) return
    const { C, viewer } = r
    const scene = viewer.scene
    const terrain = hasIonToken()
    // One polyline per ring: a thin white line with a dark halo (PolylineOutline), readable on any imagery.
    const outlineMat = () =>
      C.Material.fromType('PolylineOutline', {
        color: C.Color.fromCssColorString('#ffffff'),
        outlineColor: C.Color.fromCssColorString('#0b1d30'),
        outlineWidth: 1.1,
      })
    const mat = outlineMat()
    // One collection per source: Fields of The World outlines are thinner and drawn only lower down (FTW_MAX_H).
    const lineColl = scene.primitives.add(new C.PolylineCollection())
    const lineCollFtw = scene.primitives.add(new C.PolylineCollection())
    const groundPrims: CesiumNS.GroundPolylinePrimitive[] = []
    const groundPrimsFtw: CesiumNS.GroundPolylinePrimitive[] = []
    let ftwVisible = false
    const drawn = new Set<string>()
    let fieldsVisible = false
    const credits = { csb: new C.Credit(CSB_ATTRIBUTION, true), ftw: new C.Credit(FTW_ATTRIBUTION, true) }
    const creditOn = { csb: false, ftw: false }

    const updateCredits = () => {
      const st = store.status()
      for (const k of ['csb', 'ftw'] as const) {
        const want = fieldsVisible && st.sources.includes(k)
        if (want === creditOn[k]) continue
        creditOn[k] = want
        if (want) viewer.creditDisplay.addStaticCredit(credits[k])
        else viewer.creditDisplay.removeStaticCredit(credits[k])
      }
    }
    const setVisible = (v: boolean, h: number) => {
      fieldsVisible = v
      ftwVisible = v && h < FTW_MAX_H
      lineColl.show = v
      groundPrims.forEach((p) => (p.show = v))
      lineCollFtw.show = ftwVisible
      groundPrimsFtw.forEach((p) => (p.show = ftwVisible))
      if (!v) setHover(null)
      updateCredits()
    }
    const drawNew = () => {
      const fresh = store.all().filter((f) => !drawn.has(f.key))
      if (!fresh.length) return
      const inst: Record<'csb' | 'ftw', CesiumNS.GeometryInstance[]> = { csb: [], ftw: [] }
      for (const f of fresh) {
        drawn.add(f.key)
        const width = LINE_W[f.source]
        for (const ring of ringsOf(f.feature.geometry)) {
          if (ring.length < 2) continue
          const positions = C.Cartesian3.fromDegreesArray(ring.flatMap((p) => [p[0], p[1]]))
          if (terrain) inst[f.source].push(new C.GeometryInstance({ geometry: new C.GroundPolylineGeometry({ positions, width }) }))
          else (f.source === 'ftw' ? lineCollFtw : lineColl).add({ positions, width, material: mat })
        }
      }
      for (const k of ['csb', 'ftw'] as const) {
        if (!terrain || !inst[k].length) continue
        const prim = new C.GroundPolylinePrimitive({
          geometryInstances: inst[k],
          appearance: new C.PolylineMaterialAppearance({ material: outlineMat() }),
        })
        prim.show = k === 'ftw' ? ftwVisible : fieldsVisible
        scene.groundPrimitives.add(prim)
        if (k === 'ftw') groundPrimsFtw.push(prim)
        else groundPrims.push(prim)
      }
      scene.requestRender()
    }

    const store = new FieldBoundaryStore('', () => {
      drawNew()
      updateCredits()
      drillCb.current.onFieldsStatus?.(store.status())
    })
    storeRef.current = store

    let cur: DrillLevel | null = null
    const report = () => {
      if (viewer.isDestroyed()) return
      const h = viewer.camera.positionCartographic.height
      const lv = levelOf(h)
      if (h < FIELDS_MAX_H && (h < FTW_MAX_H) !== ftwVisible) setVisible(true, h)
      if (lv === cur) return
      cur = lv
      setLevel(lv)
      setVisible(h < FIELDS_MAX_H, h)
      const c = centerLonLat(C, viewer)
      drillCb.current.onLevelChange?.(lv, { height: h, lon: c[0], lat: c[1] })
    }
    let timer = 0
    const onMoveEnd = () => {
      if (viewer.isDestroyed()) return
      report()
      const h = viewer.camera.positionCartographic.height
      const c = centerLonLat(C, viewer)
      setOutsideNaip(!inBounds(c[0], c[1], NAIP_BOUNDS))
      drillCb.current.onLevelChange?.(levelOf(h), { height: h, lon: c[0], lat: c[1] })
      window.clearTimeout(timer)
      if (h >= FIELDS_MAX_H) return
      timer = window.setTimeout(() => {
        if (viewer.isDestroyed() || viewer.camera.positionCartographic.height >= FIELDS_MAX_H) return
        const c2 = centerLonLat(C, viewer)
        const rect = viewer.camera.computeViewRectangle()
        const deg = C.Math.toDegrees
        const fallback: [number, number, number, number] = [c2[0] - 0.05, c2[1] - 0.04, c2[0] + 0.05, c2[1] + 0.04]
        const view: [number, number, number, number] =
          rect && rect.west <= rect.east ? [deg(rect.west), deg(rect.south), deg(rect.east), deg(rect.north)] : fallback
        store.ensure(view, c2)
        drillCb.current.onFieldsStatus?.(store.status())
      }, 600)
    }
    const offChanged = viewer.camera.changed.addEventListener(report)
    const offEnd = viewer.camera.moveEnd.addEventListener(onMoveEnd)
    onMoveEnd()

    return () => {
      offChanged()
      offEnd()
      window.clearTimeout(timer)
      store.dispose()
      storeRef.current = null
      setHover(null)
      if (!viewer.isDestroyed()) {
        scene.primitives.remove(lineColl)
        scene.primitives.remove(lineCollFtw)
        groundPrims.forEach((p) => scene.groundPrimitives.remove(p))
        groundPrimsFtw.forEach((p) => scene.groundPrimitives.remove(p))
        for (const k of ['csb', 'ftw'] as const) if (creditOn[k]) viewer.creditDisplay.removeStaticCredit(credits[k])
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, drillDown])

  // ---------- drill-down: draw your own boundary ----------
  const draw = useRef<{ active: boolean; pts: [number, number][]; lastPx: CesiumNS.Cartesian2 | null; hover: [number, number] | null }>({
    active: false,
    pts: [],
    lastPx: null,
    hover: null,
  })
  const drawObjs = useRef<{ entities: CesiumNS.Entity[]; dots: CesiumNS.PointPrimitiveCollection | null }>({ entities: [], dots: null })

  const notifyDraw = (geometry?: GeoPolygon) => {
    const d = draw.current
    const ring = d.pts.length >= 3 ? [...d.pts, d.pts[0]] : null
    drillCb.current.onDrawChange?.({
      active: d.active,
      points: d.pts.length,
      areaHa: geometry ? areaHa(geometry) : ring ? areaHa({ type: 'Polygon', coordinates: [ring] }) : null,
      geometry,
    })
  }
  const clearDraw = () => {
    const r = rt.current
    const o = drawObjs.current
    if (r && !r.viewer.isDestroyed()) {
      o.entities.forEach((e) => r.viewer.entities.remove(e))
      if (o.dots) r.viewer.scene.primitives.remove(o.dots)
      r.viewer.scene.canvas.style.cursor = ''
      r.viewer.scene.requestRender()
    }
    drawObjs.current = { entities: [], dots: null }
    draw.current = { active: false, pts: [], lastPx: null, hover: null }
  }
  const startDraw = () => {
    const r = rt.current
    if (!r) return
    clearDraw()
    setHover(null)
    setSpinning(false)
    const { C, viewer } = r
    const terrain = hasIonToken()
    const yellow = C.Color.fromCssColorString(FIELD_YELLOW)
    draw.current = { active: true, pts: [], lastPx: null, hover: null }
    const live = () => {
      const d = draw.current
      return d.hover ? [...d.pts, d.hover] : d.pts
    }
    const positions = new C.CallbackProperty(() => {
      const pts = live()
      const ring = pts.length >= 3 ? [...pts, pts[0]] : pts
      return C.Cartesian3.fromDegreesArray(ring.flat())
    }, false)
    const hierarchy = new C.CallbackProperty(() => new C.PolygonHierarchy(C.Cartesian3.fromDegreesArray(live().flat())), false)
    const dots = viewer.scene.primitives.add(new C.PointPrimitiveCollection())
    drawObjs.current = {
      dots,
      entities: [
        viewer.entities.add({
          polygon: {
            hierarchy,
            show: new C.CallbackProperty(() => live().length >= 3, false),
            material: yellow.withAlpha(0.2),
            height: terrain ? undefined : 0,
          },
        }),
        viewer.entities.add({
          polyline: {
            positions,
            show: new C.CallbackProperty(() => live().length >= 2, false),
            width: 2.5,
            material: yellow,
            clampToGround: terrain,
          },
        }),
      ],
    }
    viewer.scene.canvas.style.cursor = 'crosshair'
    viewer.scene.requestRender()
    notifyDraw()
  }
  const addVertex = (ll: [number, number], px: CesiumNS.Cartesian2 | null) => {
    const r = rt.current
    const d = draw.current
    if (!r || !d.active) return
    const { C } = r
    // A double-click also fires two clicks at the same spot: ignore near-duplicates.
    if (px && d.lastPx && C.Cartesian2.distance(px, d.lastPx) < 6) return
    d.lastPx = px ? C.Cartesian2.clone(px) : null
    d.pts.push(ll)
    drawObjs.current.dots?.add({
      position: C.Cartesian3.fromDegrees(ll[0], ll[1]),
      pixelSize: 9,
      color: C.Color.WHITE,
      outlineColor: C.Color.fromCssColorString('#0e2a47'),
      outlineWidth: 2,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    })
    r.viewer.scene.requestRender()
    notifyDraw()
  }
  const undoDrawPoint = () => {
    const r = rt.current
    const d = draw.current
    if (!r || !d.active || !d.pts.length) return
    d.pts.pop()
    d.lastPx = null
    const dots = drawObjs.current.dots
    if (dots && dots.length) dots.remove(dots.get(dots.length - 1))
    r.viewer.scene.requestRender()
    notifyDraw()
  }
  const finishDraw = () => {
    const d = draw.current
    if (!d.active || d.pts.length < 3) return
    const pts = d.pts.slice()
    const geometry: GeoPolygon = { type: 'Polygon', coordinates: [[...pts, pts[0]]] }
    clearDraw()
    draw.current.pts = pts
    notifyDraw(geometry)
    draw.current.pts = []
  }
  const cancelDraw = () => {
    if (!draw.current.active) return
    clearDraw()
    notifyDraw()
  }
  useEffect(() => () => clearDraw(), []) // eslint-disable-line react-hooks/exhaustive-deps

  const drillClick = (ll: [number, number]) => {
    const r = rt.current
    if (!r) return
    const lv = levelOf(r.viewer.camera.positionCartographic.height)
    const target = clickTargetHeight(lv)
    if (target != null) {
      flyRef.current({ lon: ll[0], lat: ll[1], height: target, duration: lv === 'planet' || lv === 'country' ? 2.5 : 2 })
      return
    }
    const store = storeRef.current
    const f = store?.hit(ll[0], ll[1]) ?? null
    // A Fields of The World outline that is not drawn yet (too high): fly closer first so the farmer sees it.
    if (f?.source === 'ftw' && r.viewer.camera.positionCartographic.height >= FTW_MAX_H) {
      flyRef.current({ lon: ll[0], lat: ll[1], height: FTW_MAX_H * 0.6, duration: 1.5 })
      return
    }
    drillCb.current.onFieldPick?.(
      f
        ? { kind: 'field', lat: ll[1], lon: ll[0], field: f }
        : { kind: 'none', lat: ll[1], lon: ll[0], loading: !!store && (store.loadingAt(ll[0], ll[1]) || store.status().loading) },
    )
  }

  evRef.current = {
    click: (ll, px) => {
      if (draw.current.active) return addVertex(ll, px)
      if (!drillRef.current) return pickRef.current?.(ll[1], ll[0])
      drillClick(ll)
    },
    move: (ll) => {
      const r = rt.current
      if (!r) return
      if (draw.current.active) {
        draw.current.hover = ll
        r.viewer.scene.requestRender()
        return
      }
      if (!drillRef.current || !storeRef.current) return
      const h = r.viewer.camera.positionCartographic.height
      const hit = ll && h < FIELDS_MAX_H ? storeRef.current.hit(ll[0], ll[1]) : null
      setHover(hit?.source === 'ftw' && h >= FTW_MAX_H ? null : hit)
    },
    dbl: () => finishDraw(),
  }

  const zoomToLevel = (lv: DrillLevel) => {
    const r = rt.current
    if (!r) return
    const c = centerLonLat(r.C, r.viewer)
    flyRef.current({ lon: c[0], lat: c[1], height: LEVEL_HEIGHT[lv], duration: 1.6 })
  }
  const pickAt = async (lat: number, lon: number) => {
    const f = await waitForField(() => storeRef.current, lon, lat)
    drillCb.current.onFieldPick?.(f ? { kind: 'field', lat, lon, field: f } : { kind: 'none', lat, lon })
    return !!f
  }
  const drillApi = useRef({ zoomToLevel, startDraw, undoDrawPoint, finishDraw, cancelDraw, pickAt })
  drillApi.current = { zoomToLevel, startDraw, undoDrawPoint, finishDraw, cancelDraw, pickAt }

  // ---------- imperative API ----------
  const flyTo = (t: FlyToTarget) => {
    const r = rt.current
    if (!r) {
      pending.current = t
      return
    }
    setSpinning(false)
    const { C, viewer } = r
    const duration = reduced.current ? 0 : (t.duration ?? 2.5)
    if (t.bbox) {
      const [w, s, e, n] = padBox(t.bbox, 0.35)
      viewer.camera.flyTo({ destination: C.Rectangle.fromDegrees(w, s, e, n), duration })
    } else {
      viewer.camera.flyTo({ destination: C.Cartesian3.fromDegrees(t.lon, t.lat, t.height ?? 25000), duration })
    }
  }
  const resetNorth = () => {
    const r = rt.current
    if (!r) return
    const { C, viewer } = r
    const cam = viewer.camera
    const canvas = viewer.scene.canvas
    const center = new C.Cartesian2(canvas.clientWidth / 2, canvas.clientHeight / 2)
    const ray = cam.getPickRay(center)
    const target = (ray && viewer.scene.globe.pick(ray, viewer.scene)) || cam.pickEllipsoid(center)
    if (!target) {
      cam.setView({ orientation: { heading: 0, pitch: cam.pitch, roll: 0 } })
    } else {
      const range = C.Cartesian3.distance(cam.positionWC, target)
      cam.lookAt(target, new C.HeadingPitchRange(0, cam.pitch, range))
      cam.lookAtTransform(C.Matrix4.IDENTITY)
    }
    viewer.scene.requestRender()
  }
  const flyRef = useRef(flyTo)
  flyRef.current = flyTo
  useImperativeHandle(
    ref,
    () => ({
      flyTo: (t) => flyRef.current(t),
      resetNorth,
      zoomToLevel: (lv) => drillApi.current.zoomToLevel(lv),
      startDraw: () => drillApi.current.startDraw(),
      undoDrawPoint: () => drillApi.current.undoDrawPoint(),
      finishDraw: () => drillApi.current.finishDraw(),
      cancelDraw: () => drillApi.current.cancelDraw(),
      pickAt: (lat, lon) => drillApi.current.pickAt(lat, lon),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  useEffect(() => {
    if (ready && pending.current) {
      const t = pending.current
      pending.current = null
      flyRef.current(t)
    }
  }, [ready])

  const zoom = (factor: number) => {
    const r = rt.current
    if (!r) return
    setSpinning(false)
    const h = r.viewer.camera.positionCartographic.height
    if (factor > 0) r.viewer.camera.zoomIn(h * factor)
    else r.viewer.camera.zoomOut(h * -factor)
    r.viewer.scene.requestRender()
  }

  // Keyboard navigation on the focused map.
  const onKeyDown = (e: React.KeyboardEvent) => {
    const r = rt.current
    if (!r) return
    const { C, viewer } = r
    const cam = viewer.camera
    const h = cam.positionCartographic.height
    const step = Math.min(0.35, Math.max(0.0005, (h / 6.4e6) * 0.15))
    let handled = true
    switch (e.key) {
      case 'ArrowLeft':
        cam.rotateRight(step)
        break
      case 'ArrowRight':
        cam.rotateLeft(step)
        break
      case 'ArrowUp':
        cam.rotateDown(step)
        break
      case 'ArrowDown':
        cam.rotateUp(step)
        break
      case '+':
      case '=':
        zoom(0.35)
        break
      case '-':
      case '_':
        zoom(-0.5)
        break
      case 'n':
      case 'N':
        resetNorth()
        break
      case 'Enter':
      case ' ': {
        const cv = viewer.scene.canvas
        const px = new C.Cartesian2(cv.clientWidth / 2, cv.clientHeight / 2)
        const ll = pickLonLat(C, viewer, px)
        if (draw.current.active) {
          if (e.key === 'Enter') finishDraw()
          else if (ll) addVertex(ll, null)
        } else if (ll) evRef.current.click(ll, px)
        break
      }
      case 'Escape':
        if (!draw.current.active) handled = false
        else cancelDraw()
        break
      case 'Backspace':
        if (!draw.current.active) handled = false
        else undoDrawPoint()
        break
      default:
        handled = false
    }
    if (handled) {
      e.preventDefault()
      setSpinning(false)
      viewer.scene.requestRender()
    }
  }

  return (
    <div
      ref={hostRef}
      className={`fsm-root fsm-globe ${className ?? ''}`}
      role="application"
      aria-roledescription="3D globe"
      aria-label={
        ariaLabel ??
        'Globe. Arrow keys move, plus and minus zoom, N resets north, Enter selects the point at the centre.'
      }
      tabIndex={0}
      onKeyDown={onKeyDown}
    >
      <div ref={canvasRef} className="fsm-canvas" />
      {status && <div className="fsm-status" role="status">{status}</div>}
      <div className="fsm-controls">
        <button type="button" className="fsm-btn" aria-label="Zoom in" title="Zoom in" onClick={() => zoom(0.4)}>
          +
        </button>
        <button type="button" className="fsm-btn" aria-label="Zoom out" title="Zoom out" onClick={() => zoom(-0.7)}>
          −
        </button>
        <button type="button" className="fsm-btn" aria-label="Reset north" title="Reset north" onClick={resetNorth}>
          <svg ref={compassRef} viewBox="0 0 16 16" aria-hidden="true">
            <path d="M8 1 L11 9 L8 7.5 L5 9 Z" fill="#C2483A" />
            <path d="M8 15 L5 9 L8 10.5 L11 9 Z" fill="#7A8899" />
          </svg>
        </button>
        <button
          type="button"
          className="fsm-btn"
          aria-pressed={spinning}
          aria-label={spinning ? 'Stop rotation' : 'Rotate globe'}
          title={spinning ? 'Stop rotation' : 'Rotate globe'}
          onClick={() => setSpinning((s) => !s)}
        >
          {spinning ? '❚❚' : '⟳'}
        </button>
      </div>
      <div ref={creditRef} className="fsm-attrib">
        {drillDown && !hasIonToken() && outsideNaip && (level === 'county' || level === 'farm') && (
          <span className="fsm-ion-note">Sharper global imagery available with a Cesium ion key</span>
        )}
      </div>
    </div>
  )
})

function pickLonLat(C: Cesium, viewer: CesiumNS.Viewer, pos: CesiumNS.Cartesian2): [number, number] | null {
  const ray = viewer.camera.getPickRay(pos)
  const cart = (ray && viewer.scene.globe.pick(ray, viewer.scene)) || viewer.camera.pickEllipsoid(pos)
  if (!cart) return null
  const c = C.Cartographic.fromCartesian(cart)
  return [C.Math.toDegrees(c.longitude), C.Math.toDegrees(c.latitude)]
}

/** Ring positions 2 m above the ellipsoid, so a highlight never z-fights with the field outlines under it. */
function lift(C: Cesium, ring: number[][]): CesiumNS.Cartesian3[] {
  return C.Cartesian3.fromDegreesArrayHeights(ring.flatMap((p) => [p[0], p[1], 2]))
}

/** Ground point under the middle of the view, else the point below the camera. */
function centerLonLat(C: Cesium, viewer: CesiumNS.Viewer): [number, number] {
  const cv = viewer.scene.canvas
  const ll = pickLonLat(C, viewer, new C.Cartesian2(cv.clientWidth / 2, cv.clientHeight / 2))
  if (ll) return ll
  const c = viewer.camera.positionCartographic
  return [C.Math.toDegrees(c.longitude), C.Math.toDegrees(c.latitude)]
}

function padBox([w, s, e, n]: [number, number, number, number], frac: number): [number, number, number, number] {
  const dx = Math.max((e - w) * frac, 0.002)
  const dy = Math.max((n - s) * frac, 0.002)
  return [w - dx, s - dy, e + dx, n + dy]
}

