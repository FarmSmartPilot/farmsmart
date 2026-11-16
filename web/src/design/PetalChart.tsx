import { useMemo } from "react";
import { arc as d3arc, scaleSqrt } from "d3";
import { useStableId } from "./hooks";

export interface PetalIndicator {
  key: string;
  label: string;
  /** 0..1, where 1 = best possible for this indicator. Null/undefined = unknown (drawn as a dashed outline). */
  value0to1: number | null | undefined;
  /** Optional color; defaults to the Okabe-Ito sequence. */
  color?: string;
}

export interface PetalChartProps {
  indicators: PetalIndicator[];
  /** Outer size in px (square). */
  size?: number;
  /** Accessible title, e.g. "Trade-offs for A · + cereal rye cover". */
  title?: string;
  /** Show petal labels around the flower (auto when size >= 180). */
  showLabels?: boolean;
}

const OKABE_ITO = ["#E69F00", "#56B4E9", "#009E73", "#0072B2", "#D55E00", "#CC79A7", "#F0E442", "#000000"];

/**
 * Radial trade-off "petal" glyph: one wedge per indicator, area ∝ value (sqrt radius scale).
 * Faint outer petals show the maximum, so short petals read as "room to improve".
 * Always paired with a visually hidden data table.
 */
export function PetalChart({ indicators, size = 72, title = "Trade-off petal chart", showLabels }: PetalChartProps) {
  const id = useStableId("petal");
  const labels = showLabels ?? size >= 180;
  const pad = labels ? 28 : 2;
  const R = size / 2 - pad;
  const inner = Math.max(2, R * 0.12);
  const n = Math.max(1, indicators.length);
  const step = (2 * Math.PI) / n;

  const paths = useMemo(() => {
    const r = scaleSqrt().domain([0, 1]).range([inner, R]).clamp(true);
    const gen = d3arc<{ start: number; end: number; outer: number }>()
      .innerRadius(inner)
      .outerRadius((d) => d.outer)
      .startAngle((d) => d.start)
      .endAngle((d) => d.end)
      .padAngle(n > 1 ? 0.06 : 0)
      .cornerRadius(Math.min(6, R / 6));
    return indicators.map((ind, i) => {
      const start = i * step - step / 2;
      const end = start + step;
      const known = typeof ind.value0to1 === "number" && Number.isFinite(ind.value0to1);
      return {
        ind,
        color: ind.color ?? OKABE_ITO[i % OKABE_ITO.length],
        bg: gen({ start, end, outer: R }) ?? "",
        fg: known ? gen({ start, end, outer: r(ind.value0to1 as number) }) ?? "" : "",
        known,
        mid: start + step / 2,
      };
    });
  }, [indicators, inner, R, n, step]);

  const c = size / 2;
  return (
    <figure className="fs-petal" style={{ width: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-labelledby={`${id}-t`}>
        <title id={`${id}-t`}>{`${title}. Details in the table that follows.`}</title>
        <g transform={`translate(${c},${c})`}>
          {paths.map((p) => (
            <g key={p.ind.key}>
              <path d={p.bg} fill={p.color} opacity={0.14} stroke={p.known ? "none" : p.color} strokeDasharray={p.known ? undefined : "3 2"} strokeOpacity={0.8} />
              {p.known ? <path d={p.fg} fill={p.color} stroke="#fff" strokeWidth={1} /> : null}
            </g>
          ))}
          <circle r={inner} fill="#fff" stroke="var(--line-strong)" />
          {labels
            ? paths.map((p) => {
                const lr = R + 14;
                const x = Math.sin(p.mid) * lr;
                const y = -Math.cos(p.mid) * lr;
                const anchor = Math.abs(x) < 4 ? "middle" : x > 0 ? "start" : "end";
                return (
                  <text key={p.ind.key} x={x} y={y} dy="0.35em" textAnchor={anchor} className="fs-petal__label" aria-hidden="true">
                    {p.ind.label}
                  </text>
                );
              })
            : null}
        </g>
      </svg>
      <div className="fs-visually-hidden">
      <table>
        <caption>{title}</caption>
        <thead>
          <tr>
            <th scope="col">Indicator</th>
            <th scope="col">Score (0 to 100, higher is better)</th>
          </tr>
        </thead>
        <tbody>
          {indicators.map((ind) => (
            <tr key={ind.key}>
              <th scope="row">{ind.label}</th>
              <td>{typeof ind.value0to1 === "number" ? Math.round(ind.value0to1 * 100) : "Unknown"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </figure>
  );
}
