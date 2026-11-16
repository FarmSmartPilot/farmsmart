// Wind rose (D3): 16 sectors x 5 speed bins from GET /api/fields/{id}/wind.
// Colourblind-safe sequential colours (viridis); a visually hidden table carries the same numbers.
import { useEffect, useMemo, useState } from 'react'
import { arc as d3arc, interpolateViridis, scaleSqrt } from 'd3'
import { DataButton } from '../design'
import type { WindRoseData } from './types'
import './map.css'

export interface WindRoseProps {
  /** Pre-fetched data. When omitted, the component fetches it for `fieldId`. */
  data?: WindRoseData | null
  fieldId?: string | null
  /** Months (1-12). Default 3,4,5,10,11. */
  months?: number[]
  apiBase?: string
  /** Diameter of the rose in px. Default 150. */
  size?: number
  className?: string
}

const DIRS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW']
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const DEFAULT_MONTHS = [3, 4, 5, 10, 11]

/** "Mar–May, Oct–Nov" from [3,4,5,10,11]. */
export function monthRanges(months: number[]): string {
  const m = [...new Set(months)].sort((a, b) => a - b)
  const out: string[] = []
  for (let i = 0; i < m.length; ) {
    let j = i
    while (j + 1 < m.length && m[j + 1] === m[j] + 1) j++
    out.push(i === j ? MON[m[i] - 1] : `${MON[m[i] - 1]}–${MON[m[j] - 1]}`)
    i = j + 1
  }
  return out.join(', ')
}

function binLabel(bins: number[], k: number) {
  const lo = bins[k], hi = bins[k + 1]
  if (hi == null || hi >= 50) return `≥${lo} m/s`
  return `${lo}–${hi} m/s`
}

export function WindRose({ data, fieldId, months = DEFAULT_MONTHS, apiBase = '', size = 150, className }: WindRoseProps) {
  const [fetched, setFetched] = useState<WindRoseData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const monthsKey = months.join(',')

  useEffect(() => {
    if (data || !fieldId) return
    const ac = new AbortController()
    setError(null)
    setFetched(null)
    fetch(`${apiBase}/api/fields/${encodeURIComponent(fieldId)}/wind?months=${monthsKey}`, { signal: ac.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`wind ${r.status}`))))
      .then((j: WindRoseData) => setFetched(j))
      .catch((e: Error) => {
        if (e.name !== 'AbortError') setError('Wind data is not available for this field yet.')
      })
    return () => ac.abort()
  }, [data, fieldId, monthsKey, apiBase])

  const d = data ?? fetched
  const geom = useMemo(() => {
    if (!d) return null
    const nBins = d.speed_bins_ms.length - 1
    const totals = d.freq.map((row) => row.reduce((a, b) => a + b, 0))
    const max = Math.max(...totals, 1e-9)
    const R = size / 2 - 16
    const r = scaleSqrt().domain([0, max]).range([0, R])
    const colors = Array.from({ length: nBins }, (_, k) => interpolateViridis(0.92 - (0.85 * k) / Math.max(1, nBins - 1)))
    const step = (2 * Math.PI) / d.sectors
    const pad = step * 0.06
    const gen = d3arc<{ inner: number; outer: number; a0: number; a1: number }>()
      .innerRadius((v) => v.inner)
      .outerRadius((v) => v.outer)
      .startAngle((v) => v.a0)
      .endAngle((v) => v.a1)
    const wedges: { path: string; color: string; key: string }[] = []
    d.freq.forEach((row, s) => {
      let cum = 0
      const a0 = s * step - step / 2 + pad
      const a1 = s * step + step / 2 - pad
      row.forEach((f, k) => {
        if (f <= 0) return
        const inner = r(cum)
        cum += f
        wedges.push({ path: gen({ inner, outer: r(cum), a0, a1 }) ?? '', color: colors[k], key: `${s}-${k}` })
      })
    })
    // Rings at round percentages.
    const maxPct = max * 100
    const ringStep = maxPct > 12 ? 5 : maxPct > 6 ? 2 : 1
    const rings: { r: number; label: string }[] = []
    for (let p = ringStep; p <= maxPct + 1e-9; p += ringStep) rings.push({ r: r(p / 100), label: `${p}%` })
    return { wedges, colors, rings, R, totals, nBins }
  }, [d, size])

  if (error) return <div className={`fsm-windrose ${className ?? ''}`} role="status">{error}</div>
  if (!d || !geom)
    return (
      <div className={`fsm-windrose ${className ?? ''}`} role="status" aria-busy="true">
        Loading wind…
      </div>
    )

  const half = size / 2
  const yrs = d.years?.length ? (d.years[0] === d.years[d.years.length - 1] ? `${d.years[0]}` : `${d.years[0]}–${d.years[d.years.length - 1]}`) : ''
  const title = `Wind · ${monthRanges(d.months ?? months)}`
  const strong = d.share_above_8ms != null ? `${Math.round(d.share_above_8ms * 100)}% of hours > 8 m/s` : null
  const ev = d.evidence ?? {}
  const evidence = {
    source: ev.source ?? 'NASA POWER',
    product: ev.product ?? 'Hourly wind',
    native_res: ev.native_res,
    effective_res: ev.native_res ? `regional value (${ev.native_res})` : 'regional value',
    observation_start: d.years?.length ? `${d.years[0]}` : undefined,
    observation_end: d.years?.length ? `${d.years[d.years.length - 1]}` : undefined,
    citation: ev.citation,
    is_nasa: ev.is_nasa ?? true,
  }

  return (
    <figure className={`fsm-windrose ${className ?? ''}`} style={{ margin: 0 }}>
      <h4>
        {title} <DataButton evidence={evidence} describes="wind rose" />
      </h4>
      <p className="fsm-wr-sub">
        {yrs} · {d.hours.toLocaleString()} h{strong ? ` · ${strong}` : ''}
      </p>
      <svg width={size} height={size} viewBox={`${-half} ${-half} ${size} ${size}`} role="img" aria-label={`${title}. Wind rose; see the table for values.`}>
        {geom.rings.map((g) => (
          <g key={g.label}>
            <circle r={g.r} fill="none" stroke="#c3ccd6" strokeWidth={0.75} />
            <text x={2} y={-g.r - 1} fontSize={8} fill="#4a5b6e">
              {g.label}
            </text>
          </g>
        ))}
        {geom.wedges.map((w) => (
          <path key={w.key} d={w.path} fill={w.color} stroke="#fff" strokeWidth={0.4} />
        ))}
        {(['N', 'E', 'S', 'W'] as const).map((t, i) => {
          const a = (i * Math.PI) / 2
          const rr = geom.R + 9
          return (
            <text key={t} x={Math.sin(a) * rr} y={-Math.cos(a) * rr + 3} textAnchor="middle" fontSize={10} fontWeight={700} fill="#0e2a47">
              {t}
            </text>
          )
        })}
      </svg>
      <div className="fsm-wr-legend" aria-hidden="true">
        {geom.colors.map((c, k) => (
          <span key={c}>
            <i style={{ background: c }} />
            {binLabel(d.speed_bins_ms, k)}
          </span>
        ))}
      </div>
      <figcaption className="fsm-wr-src">
        Direction wind blows from. {ev.source ?? 'NASA POWER'}
        {ev.native_res ? `, regional value (${ev.native_res})` : ''}. Not a field measurement.
      </figcaption>
      <table className="fsm-sr-only">
        <caption>{title}: share of hours by direction (from) and speed</caption>
        <thead>
          <tr>
            <th scope="col">Direction</th>
            {d.speed_bins_ms.slice(0, -1).map((_, k) => (
              <th key={k} scope="col">
                {binLabel(d.speed_bins_ms, k)}
              </th>
            ))}
            <th scope="col">All speeds</th>
          </tr>
        </thead>
        <tbody>
          {d.freq.map((row, s) => (
            <tr key={s}>
              <th scope="row">{d.sectors === 16 ? DIRS[s] : `${Math.round((s * 360) / d.sectors)}°`}</th>
              {row.map((f, k) => (
                <td key={k}>{(f * 100).toFixed(1)}%</td>
              ))}
              <td>{(geom.totals[s] * 100).toFixed(1)}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  )
}

export default WindRose
