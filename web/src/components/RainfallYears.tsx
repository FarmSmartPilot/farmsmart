/* Rainfall by year (Drought Replay): growing-season rain for every year at the field (NASA POWER, regional ≈50 km)
   with the median drawn. Click or tap a bar (or use the menu) to replay that year. Values from /rainfall-years. */
import { useEffect, useRef, useState } from "react";
import type { MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import { scaleBand, scaleLinear } from "d3";
import { Button, DataButton, Skeleton, StatusBanner } from "../design";
import type { Evidence } from "../design";
import { isNotFound } from "../api";
import { useRainfallYearsQ } from "../apiPlan";
import { useApp } from "../store";
import { conv, cx, fmtU, isNum, nice } from "../lib";
import "../plan.css";

export default function RainfallYears({ fieldId, year, onYear, driest = [] }: { fieldId: string; year: number; onYear: (y: number) => void; driest?: number[] }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const units = useApp((s) => s.units);
  const q = useRainfallYearsQ(fieldId);
  const [table, setTable] = useState(false);
  const [hover, setHover] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  // The chart is drawn at its real pixel width so labels keep their size from phone to desktop.
  const boxRef = useRef<HTMLDivElement>(null);
  const [boxW, setBoxW] = useState(640);
  useEffect(() => {
    const el = boxRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((es) => setBoxW(Math.max(280, Math.round(es[0].contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, [q.data]);
  const d = q.data;
  if (q.isLoading) return <Skeleton height={150} label={t("rain.loading")} />;
  if (q.error)
    return (
      <StatusBanner kind={isNotFound(q.error) ? "unsupported" : "error"} title={t("rain.unavail")}>
        {isNotFound(q.error) ? t("rain.not_on_server") : (q.error as Error).message}
      </StatusBanner>
    );
  const years = (d?.years ?? []).filter((y) => isNum(y.season_mm));
  if (!d || d.available === false || !years.length)
    return (
      <StatusBanner kind="no-observation" title={t("rain.unavail")}>
        {d?.reason ?? t("rain.none")}
      </StatusBanner>
    );

  const ev: Evidence = {
    source: d.evidence?.source ?? "NASA POWER",
    product: d.evidence?.product ?? d.source ?? "NASA POWER (PRECTOTCORR)",
    effective_res: d.evidence?.scale ?? d.scale_note ?? "regional value (≈50 km)",
    observation_start: d.period?.[0] ?? `${years[0].year}-01-01`,
    observation_end: d.period?.[1] ?? `${years[years.length - 1].year}-12-31`,
    qa_flags: [
      ...(d.season ? [t("rain.season_def", { s: d.season.label })] : []),
      ...(d.season?.basis ? [d.season.basis] : []),
      ...(d.median_years ? [t("rain.median_years", { a: d.median_years[0], b: d.median_years[1] })] : []),
      ...(d.partial_note ? [d.partial_note] : []),
    ],
    citation: d.evidence?.citation,
    url: d.evidence?.url ?? "https://power.larc.nasa.gov/",
    is_nasa: true,
  };
  const cv = (mm: number) => conv(mm, "mm", units)[0] ?? mm;
  const unit = conv(0, "mm", units)[1];
  const W = boxW;
  const H = W < 500 ? 150 : 180;
  const pad = { l: 40, r: 8, t: 10, b: 22 };
  const x = scaleBand<number>()
    .domain(years.map((y) => y.year))
    .range([pad.l, W - pad.r])
    .paddingInner(0.18);
  const hi = Math.max(...years.map((y) => cv(y.season_mm!)));
  const yS = scaleLinear().domain([0, hi]).nice().range([H - pad.b, pad.t]);
  const med = isNum(d.median_season_mm) ? cv(d.median_season_mm) : null;
  const step = Math.ceil(years.length / Math.max(3, Math.floor(W / 70)));
  const selIdx = years.findIndex((y) => y.year === year);
  const sel = years.find((y) => y.year === year);
  const show = years.find((y) => y.year === hover) ?? sel;

  // Any tap on the chart picks the nearest year: bars are thin on phones, so the whole chart is the target.
  const yearAt = (e: MouseEvent<SVGSVGElement>) => {
    const r = svgRef.current?.getBoundingClientRect();
    if (!r) return null;
    const vx = ((e.clientX - r.left) / r.width) * W;
    let best: number | null = null;
    let dist = Infinity;
    for (const y of years) {
      const c = (x(y.year) ?? 0) + x.bandwidth() / 2;
      if (Math.abs(c - vx) < dist) {
        dist = Math.abs(c - vx);
        best = y.year;
      }
    }
    return best;
  };

  return (
    <div className="rain-years" ref={boxRef}>
      <div className="h-row">
        <h2 className="fs-title">
          {t("rain.title", { s: d.season?.label ?? "" })} <DataButton evidence={ev} describes={t("rain.title", { s: d.season?.label ?? "" })} />
        </h2>
        <span className="fs-chip fs-chip--wheat">{d.scale_note ?? "regional value (≈50 km)"}</span>
        <Button variant="ghost" size="sm" onClick={() => setTable((v) => !v)} aria-pressed={table}>
          {table ? t("common.show_chart") : t("common.show_table")}
        </Button>
      </div>
      <p className="fs-meta">
        {show ? t("rain.readout", { y: show.year, v: fmtU(show.season_mm, "mm", units, lang), m: med !== null ? `${nice(med, lang)} ${unit}` : "—" }) : null}
        {show?.partial ? ` · ${t("rain.partial")}` : ""}
      </p>
      {table ? (
        <div className="table-scroll" style={{ maxHeight: 260 }}>
          <table className="fs-table compact">
            <thead>
              <tr>
                <th scope="col">{t("rain.year")}</th>
                <th scope="col">
                  {t("rain.season_col", { s: d.season?.label ?? "" })} ({unit})
                </th>
                <th scope="col">
                  {t("rain.annual_col")} ({unit})
                </th>
                <th scope="col">
                  <span className="fs-visually-hidden">{t("rain.replay")}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {years.map((y) => (
                <tr key={y.year} aria-current={y.year === year ? "true" : undefined}>
                  <th scope="row">
                    {y.year}
                    {y.partial ? ` (${t("rain.partial_short")})` : ""}
                  </th>
                  <td>{nice(cv(y.season_mm!), lang)}</td>
                  <td>{isNum(y.annual_mm) ? nice(cv(y.annual_mm), lang) : "—"}</td>
                  <td>
                    <Button size="sm" variant={y.year === year ? "primary" : "ghost"} onClick={() => onYear(y.year)} aria-pressed={y.year === year}>
                      {t("rain.replay")}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          className="svg-fluid rain-years__svg"
          role="img"
          aria-label={t("rain.aria", { a: years[0].year, b: years[years.length - 1].year, m: med !== null ? `${nice(med, lang)} ${unit}` : "—" })}
          onClick={(e) => {
            const y = yearAt(e);
            if (y !== null) onYear(y);
          }}
          onMouseMove={(e) => setHover(yearAt(e))}
          onMouseLeave={() => setHover(null)}
        >
          {yS.ticks(4).map((v) => (
            <g key={v}>
              <line x1={pad.l} x2={W - pad.r} y1={yS(v)} y2={yS(v)} stroke="var(--line)" />
              <text x={pad.l - 4} y={yS(v) + 4} textAnchor="end" className="axis-t">
                {nice(v, lang)}
              </text>
            </g>
          ))}
          {years.map((y, i) => {
            const v = cv(y.season_mm!);
            const isSel = y.year === year;
            const dry = driest.includes(y.year);
            return (
              <g key={y.year}>
                <rect
                  x={x(y.year)}
                  y={yS(v)}
                  width={x.bandwidth()}
                  height={yS(0) - yS(v)}
                  rx={1.5}
                  className={cx("rain-bar", isSel && "is-sel", dry && "is-dry", y.partial && "is-partial", hover === y.year && "is-hover")}
                />
                {isSel || (i % step === 0 && (selIdx < 0 || Math.abs(i - selIdx) * x.step() > 34)) ? (
                  <text x={(x(y.year) ?? 0) + x.bandwidth() / 2} y={H - 6} textAnchor="middle" className={cx("axis-t", isSel && "strong")}>
                    {y.year}
                  </text>
                ) : null}
              </g>
            );
          })}
          {med !== null ? (
            <g>
              <line x1={pad.l} x2={W - pad.r} y1={yS(med)} y2={yS(med)} stroke="var(--navy)" strokeDasharray="5 4" strokeWidth={1.5} />
              <text x={W - pad.r} y={yS(med) - 4} textAnchor="end" className="axis-t strong">
                {t("rain.median")}
              </text>
            </g>
          ) : null}
          <text x={pad.l} y={pad.t - 1} className="axis-t">
            {unit}
          </text>
        </svg>
      )}
      <div className="rain-years__foot">
        <div className="legend-row">
          <span>
            <span className="key key--bar rain-key" /> {t("rain.leg_rain")}
          </span>
          <span>
            <span className="key key--bar rain-key is-sel" /> {t("rain.leg_sel")}
          </span>
          {driest.length ? (
            <span>
              <span className="key key--bar rain-key is-dry" /> {t("rain.leg_dry")}
            </span>
          ) : null}
          <span>
            <span className="key key--line" style={{ background: "var(--navy)" }} /> {t("rain.median")}
          </span>
        </div>
        <label className="field-l rain-pick">
          <span>{t("rain.pick")}</span>
          <select value={sel ? year : ""} onChange={(e) => onYear(Number(e.target.value))}>
            {!sel ? <option value="">{year}</option> : null}
            {[...years].reverse().map((y) => (
              <option key={y.year} value={y.year}>
                {y.year} · {fmtU(y.season_mm, "mm", units, lang)}
                {y.partial ? ` (${t("rain.partial_short")})` : ""}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="fs-meta">
        {t("rain.help")}
        {d.season?.basis ? ` ${t("rain.season_def", { s: d.season.label })}. ${d.season.basis}.` : ""}
        {years.some((y) => y.partial) && d.partial_note ? ` ${d.partial_note}` : ""}
      </p>
    </div>
  );
}
