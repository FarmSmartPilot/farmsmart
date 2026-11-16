// Dev harness for the map components. Not wired into the app.
// Mount temporarily with: createRoot(el).render(<MapHarness />), or open /?harness=map
// if the frontend adds that switch. Uses the live API (Vite proxies /api).
import { useEffect, useRef, useState } from 'react'
import type { Feature } from 'geojson'
import { FieldMap } from './FieldMap'
import { FlatMap } from './FlatMap'
import { GlobeView } from './GlobeView'
import type { FieldMeta, GlobeArc, LayerId, MapHandle } from './types'

const LAYERS: LayerId[] = ['cover', 'wind', 'rain', 'soil_moisture', 'heat', 'soils', 'erosion_zones']

export function MapHarness() {
  const globe = useRef<MapHandle>(null)
  const [view, setView] = useState<'globe' | 'flat' | 'field'>('globe')
  const [field, setField] = useState<Feature | null>(null)
  const [fieldId, setFieldId] = useState<string | null>(null)
  const [meta, setMeta] = useState<FieldMeta | null>(null)
  const [layers, setLayers] = useState<LayerId[]>(['wind', 'erosion_zones'])
  const [arcs, setArcs] = useState<GlobeArc[]>([])
  const [log, setLog] = useState<string[]>([])
  const say = (s: string) => setLog((l) => [s, ...l].slice(0, 6))

  // Start from the first pilot field the API knows (real, analysed field).
  useEffect(() => {
    fetch('/api/pilots')
      .then((r) => r.json())
      .then((j) => {
        const p = j?.pilots?.[0]
        if (!p) return
        setFieldId(p.field_id)
        setField({ type: 'Feature', properties: {}, geometry: p.feature.geometry })
        say(`pilot ${p.label}`)
      })
      .catch(() => say('no /api/pilots'))
  }, [])

  const pick = async (lat: number, lon: number) => {
    say(`pick ${lat.toFixed(4)}, ${lon.toFixed(4)}`)
    try {
      const r = await fetch(`/api/fields/at?lat=${lat}&lon=${lon}`)
      const j = await r.json()
      if (j.found) {
        setField(j.feature)
        setMeta(j.meta)
        say(`field ${j.meta?.csbid} · ${j.meta?.county}`)
      } else say('no field at point')
    } catch (e) {
      say(`api error ${(e as Error).message}`)
    }
  }

  return (
    <div style={{ display: 'grid', gridTemplateRows: 'auto 1fr', height: '100vh', fontFamily: 'Inter, system-ui, sans-serif' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, padding: 8, alignItems: 'center', fontSize: 13 }}>
        <strong>Map harness</strong>
        {(['globe', 'flat', 'field'] as const).map((v) => (
          <button key={v} aria-pressed={view === v} onClick={() => setView(v)}>
            {v}
          </button>
        ))}
        <button onClick={() => globe.current?.flyTo({ lat: 42.111, lon: -93.469, height: 6000 })}>Fly to Story Co.</button>
        <button
          onClick={() =>
            setArcs([
              { from: { lat: 42.08, lon: -93.42, label: 'Your farm' }, to: { lat: 37.97, lon: -100.87, label: 'Example endpoint' } },
              { from: { lat: 42.08, lon: -93.42 }, to: { lat: 35.2, lon: -97.4 }, dashed: true, width: 1.5 },
            ])
          }
        >
          Demo arcs
        </button>
        <button onClick={() => setArcs([])}>Clear arcs</button>
        <label>
          field id <input value={fieldId ?? ''} onChange={(e) => setFieldId(e.target.value || null)} size={14} />
        </label>
        {LAYERS.map((l) => (
          <label key={l}>
            <input
              type="checkbox"
              checked={layers.includes(l)}
              onChange={(e) => setLayers((x) => (e.target.checked ? [...x, l] : x.filter((y) => y !== l)))}
            />
            {l}
          </label>
        ))}
        <span style={{ color: '#4a5b6e' }}>{log.join(' | ')}</span>
        {meta && <span>csbid {meta.csbid}</span>}
      </div>
      <div style={{ position: 'relative', minHeight: 0 }}>
        {view === 'globe' && (
          <GlobeView ref={globe} onPickPoint={pick} fieldGeometry={field} arcs={arcs} onFallback={(r) => say(`fallback: ${r}`)} />
        )}
        {view === 'flat' && <FlatMap ref={globe} onPickPoint={pick} fieldGeometry={field} arcs={arcs} />}
        {view === 'field' && (
          <FieldMap
            fieldId={fieldId}
            fieldGeometry={field}
            activeLayers={layers}
            onSelectField={(f, m) => {
              setField(f)
              setMeta(m)
              say(`neighbour ${m.csbid}`)
            }}
            onGeometryInput={(g, info) => {
              setField({ type: 'Feature', properties: {}, geometry: g })
              say(`${info.source}: ${info.areaHa.toFixed(1)} ha`)
            }}
          />
        )}
      </div>
    </div>
  )
}

export default MapHarness
