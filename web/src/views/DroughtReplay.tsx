/* Drought Replay: a real past year replayed week by week, current rotation vs a chosen alternative. Model replay, labelled. */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { scaleLinear } from "d3";
import { Button, Chip, SIButton, Skeleton, StatusBanner, IconPlay } from "../design";
import type { ReplayResult, ReplaySide } from "../api";
import { useReplayQ } from "../api";
import { useApp } from "../store";
import { Ev, NeedField, QueryState, Reminder, Term } from "../components/common";
import { cx, fmtU, nice, ordinal, toConfidence, weekMonth } from "../lib";
import { useCompare } from "./Options";
import RainfallYears from "../components/RainfallYears";

function ReplayChart({ data, week }: { data: ReplayResult; week: number }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const [table, setTable] = useState(false);
  const W = 1200;
  const H = 260;
  const pad = { l: 40, r: 12, t: 12, b: 24 };
  const x = scaleLinear().domain([0, 51]).range([pad.l, W - pad.r]);
  const y = scaleLinear().domain([0, 100]).range([H - pad.b, pad.t]);
  const sides = [data.current, data.alternative].filter(Boolean) as ReplaySide[];
  const colors = ["var(--navy)", "var(--field)"];
  // Weeks without a clear NDVI value are skipped (a null would break the line).
  const ndvi = data.ndvi?.status === "ready" ? data.ndvi.points.filter((p) => Number.isFinite(p.ndvi)) : [];
  const yN = scaleLinear().domain([0, 1]).range([H - pad.b, pad.t]);
  if (table)
    return (
      <div>
        <Button variant="ghost" size="sm" onClick={() => setTable(false)}>
          {t("common.show_chart")}
        </Button>
        <div className="table-scroll" style={{ maxHeight: 280 }}>
          <table className="fs-table compact">
            <thead>
              <tr>
                <th scope="col">{t("tl.week")}</th>
                <th scope="col">{t("replay.rain")}</th>
                {sides.map((s) => (
                  <th key={s.card_id} scope="col">
                    {s.name}: {t("replay.soil_water")}
                  </th>
                ))}
                {sides.map((s) => (
                  <th key={`c${s.card_id}`} scope="col">
                    {s.name}: {t("replay.cover")}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sides[0].weeks.map((w, i) => (
                <tr key={w.week}>
                  <th scope="row">
                    {w.week + 1} · {weekMonth(w.week, lang)}
                  </th>
                  <td>{nice(w.rain_mm, lang)}</td>
                  {sides.map((s) => (
                    <td key={s.card_id}>
                      {nice(s.weeks[i]?.soil_water_pct_mid, lang)}% ({nice(s.weeks[i]?.soil_water_pct_high, lang)}–{nice(s.weeks[i]?.soil_water_pct_low, lang)})
                    </td>
                  ))}
                  {sides.map((s) => (
                    <td key={`c${s.card_id}`}>{nice((s.weeks[i]?.soil_cover ?? 0) * 100, lang)}%</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  return (
    <div>
      <div className="h-row">
        <p className="fs-meta">{t("replay.chart_help")}</p>
        <Button variant="ghost" size="sm" onClick={() => setTable(true)}>
          {t("common.show_table")}
        </Button>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="svg-fluid" role="img" aria-label={t("replay.chart_aria")}>
        {[0, 25, 50, 75, 100].map((v) => (
          <g key={v}>
            <line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} stroke="var(--line)" />
            <text x={pad.l - 4} y={y(v) + 4} textAnchor="end" className="axis-t">
              {v}%
            </text>
          </g>
        ))}
        {Array.from({ length: 12 }, (_, m) => (
          <text key={m} x={x((m * 52) / 12 + 2)} y={H - 6} textAnchor="middle" className="axis-t">
            {weekMonth((m * 52) / 12 + 2, lang)}
          </text>
        ))}
        {/* rain bars */}
        {sides[0]?.weeks.map((w) => (
          <rect key={`r${w.week}`} x={x(w.week) - 3} y={H - pad.b - Math.min(60, w.rain_mm)} width={6} height={Math.min(60, w.rain_mm)} fill="var(--sky)" opacity={0.25} />
        ))}
        {ndvi.length ? (
          <path d={ndvi.map((p, i) => `${i ? "L" : "M"}${x(p.week)},${yN(p.ndvi)}`).join(" ")} fill="none" stroke="var(--field)" strokeWidth={6} opacity={0.18} strokeLinecap="round" />
        ) : null}
        {sides.map((s, k) => {
          const band = s.weeks.filter((w) => w.soil_water_pct_low !== null && w.soil_water_pct_high !== null);
          const area =
            band.map((w, i) => `${i ? "L" : "M"}${x(w.week)},${y(w.soil_water_pct_low!)}`).join(" ") +
            " " +
            [...band].reverse().map((w) => `L${x(w.week)},${y(w.soil_water_pct_high!)}`).join(" ") +
            " Z";
          const line = s.weeks.filter((w) => w.soil_water_pct_mid !== null).map((w, i) => `${i ? "L" : "M"}${x(w.week)},${y(w.soil_water_pct_mid!)}`).join(" ");
          return (
            <g key={s.card_id}>
              <path d={area} fill={colors[k]} opacity={0.12} />
              <path d={line} fill="none" stroke={colors[k]} strokeWidth={2} />
            </g>
          );
        })}
        <line x1={x(week)} x2={x(week)} y1={pad.t} y2={H - pad.b} stroke="var(--alert)" strokeWidth={1.5} />
      </svg>
      <div className="legend-row">
        {sides.map((s, k) => (
          <span key={s.card_id}>
            <span className="key key--line" style={{ background: colors[k] }} /> {s.name}
          </span>
        ))}
        <span>
          <span className="key key--bar" style={{ background: "var(--sky)", opacity: 0.4 }} /> {t("replay.rain")}
        </span>
        {ndvi.length ? (
          <span>
            <span className="key key--line" style={{ background: "var(--field)", opacity: 0.3, height: 6 }} /> <Term id="ndvi">NDVI</Term> {t("replay.ghost")}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function SideCard({ s, week, best }: { s: ReplaySide; week: number; best?: boolean }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const units = useApp((st) => st.units);
  const w = s.weeks[week];
  const erosionSoFar = s.weeks.slice(0, week + 1).reduce((a, b) => a + (b.erosion_t_ha ?? 0), 0);
  return (
    <article className={cx("rp-side", best && "is-best")}>
      <h3 className="fs-title">{s.name}</h3>
      {s.available === false ? <StatusBanner kind="unsupported">{s.reason}</StatusBanner> : null}
      <dl className="facts">
        <div className="facts__row">
          <dt>{t("replay.week_n", { n: week + 1, m: weekMonth(week, lang) })}</dt>
          <dd>
            {t("replay.soil_water")} {nice(w?.soil_water_pct_mid, lang)}% · {t("replay.cover")} {nice((w?.soil_cover ?? 0) * 100, lang)}%
          </dd>
        </div>
        <div className="facts__row">
          <dt>{t("replay.erosion_sofar")}</dt>
          <dd>
            {fmtU(erosionSoFar, "t_ha", units, lang)} <span className="fs-meta">/ {fmtU(s.erosion_total_t_ha, "t_ha", units, lang)}</span>
          </dd>
        </div>
        <div className="facts__row">
          <dt>{t("replay.bare_weeks")}</dt>
          <dd>{nice(s.bare_weeks, lang)}</dd>
        </div>
        {s.yield ? (
          <div className="facts__row">
            <dt>{t("replay.yield", { crop: s.yield.crop })}</dt>
            <dd>
              {t("replay.yield_val", { pct: nice(s.yield.pct_of_typical, lang), rank: ordinal(s.yield.rank_among_years, lang), n: s.yield.n_years })}
              <span className="fs-meta">
                {" "}
                ({t("replay.band")} {nice(s.yield.low * 100, lang)}–{nice(s.yield.high * 100, lang)}%)
              </span>
            </dd>
          </div>
        ) : null}
      </dl>
    </article>
  );
}

/** Every complete year of the NASA POWER weather record (1991 to last year). */
const ALL_YEARS = Array.from({ length: new Date().getFullYear() - 1991 }, (_, i) => new Date().getFullYear() - 1 - i);

export default function DroughtReplay() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const field = useApp((s) => s.field);
  const reduced = useApp((s) => s.reducedMotion);
  const units = useApp((s) => s.units);
  const cmpQ = useCompare();
  const alts = (cmpQ.data?.cards ?? []).filter((c) => !c.is_baseline);
  const [year, setYear] = useState(2012);
  const [alt, setAlt] = useState<string | undefined>(undefined);
  const altId = alt ?? alts.find((c) => c.best_for_you)?.id ?? alts[0]?.id;
  const q = useReplayQ(field?.id ?? null, year, altId);
  const [week, setWeek] = useState(26);
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => setWeek((w) => (w >= 51 ? (setPlaying(false), 51) : w + 1)), reduced ? 600 : 220);
    return () => clearInterval(id);
  }, [playing, reduced]);
  if (!field) return <NeedField />;
  const d = q.data;
  const years = [...new Set([2012, year, ...(d?.driest_years ?? [])])].sort();
  const yc = d?.current?.yield;
  const ya = d?.alternative?.yield;
  const bestAlt = d?.alternative && d.current && (d.alternative.erosion_total_t_ha ?? 0) < (d.current.erosion_total_t_ha ?? 0);

  return (
    <div className="page" data-tour="replay">
      <header className="page__head">
        <div>
          <h1 className="fs-h1">{t("replay.title", { name: field.name })}</h1>
          <p className="fs-meta">{t("replay.sub")}</p>
        </div>
        <div className="fs-cluster" style={{ ["--gap" as string]: "8px" }} role="group" aria-label={t("replay.pick_year")}>
          <span className="fs-meta">{t("replay.quick")}</span>
          {years.map((y) => (
            <Chip key={y} onClick={() => setYear(y)} pressed={year === y} tone={year === y ? "alert" : "outline"}>
              {y}
            </Chip>
          ))}
          {/* Any year of the NASA POWER record can be replayed, not only the quick picks. */}
          <label className="fs-meta replay-anyyear">
            {t("replay.any_year")}{" "}
            <select value={year} onChange={(e) => setYear(Number(e.target.value))}>
              {ALL_YEARS.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </label>
          <label className="fs-meta">
            {t("replay.compare_with")}{" "}
            <select value={altId ?? ""} onChange={(e) => setAlt(e.target.value)}>
              {alts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      </header>
      <section className="card-sec" aria-label={t("rain.section")}>
        <RainfallYears fieldId={field.id} year={year} onYear={setYear} />
      </section>
      {q.isLoading ? <Skeleton height={320} /> : null}
      {q.error ? <QueryState error={q.error} what={t("nav.replay")} onRetry={() => void q.refetch()} /> : null}
      {d && !d.available ? <StatusBanner kind="unsupported">{d.reason}</StatusBanner> : null}
      {d?.available ? (
        <>
          <StatusBanner kind="partial" title={d.label}>
            {d.band_method} · {d.never_claim}
          </StatusBanner>
          <div className="rp-kpis">
            <div className="kpi-cell">
              <div className="kpi-cell__label">
                {t("replay.season_rain", { y: year })} <Ev id={d.evidence?.weather} describes={t("replay.season_rain", { y: year })} />
              </div>
              <div className="kpi-cell__value">{fmtU(d.season_rain_mm, "mm", units, lang)}</div>
              <div className="fs-meta">{t("replay.rain_pctl", { p: ordinal(d.season_rain_percentile ?? 0, lang) })}</div>
              <div className="fs-meta">{t("rain.kpi_window")}</div>
            </div>
            {yc && ya ? (
              <div className="kpi-cell">
                <div className="kpi-cell__label">
                  {t("replay.yield_cmp")}{" "}
                  <SIButton
                    record={{
                      model_name: t("replay.model"),
                      kind: "process",
                      top_drivers: [{ name: t("replay.rain") }, { name: t("replay.soil_water") }],
                      confidence: toConfidence({ level: "medium", reasons: [d.band_method ?? "", d.label] }),
                      information_cutoff: `${year}-12-31`,
                      model_card_url: "#/sources",
                    }}
                    describes={t("replay.yield_cmp")}
                  />
                </div>
                <div className="kpi-cell__value">
                  {nice(yc.pct_of_typical, lang)}% → {nice(ya.pct_of_typical, lang)}%
                </div>
                <div className="fs-meta">{t("replay.of_typical")}</div>
              </div>
            ) : null}
            {d.ndvi ? (
              <div className="kpi-cell">
                <div className="kpi-cell__label">
                  <Term id="ndvi">NDVI</Term> {t("replay.ghost")} {d.evidence?.ndvi ? <Ev ev={d.evidence.ndvi} describes="NDVI" /> : null}
                </div>
                <div className="kpi-cell__value fs-title">{d.ndvi.status === "ready" ? t("replay.ndvi_ready", { n: d.ndvi.points.length }) : t("replay.ndvi_loading")}</div>
              </div>
            ) : null}
          </div>
          <section className="card-sec">
            <div className="replay-play">
              <Button variant="secondary" size="sm" icon={<IconPlay size={14} />} onClick={() => (week >= 51 ? (setWeek(0), setPlaying(true)) : setPlaying((p) => !p))} aria-pressed={playing}>
                {playing ? t("replay.pause") : t("replay.play")}
              </Button>
              <label className="replay-scrub">
                <span className="fs-visually-hidden">{t("replay.week_slider")}</span>
                <input type="range" min={0} max={51} value={week} onChange={(e) => setWeek(Number(e.target.value))} aria-valuetext={t("replay.week_n", { n: week + 1, m: weekMonth(week, lang) })} />
              </label>
              <span className="fs-meta">{t("replay.week_n", { n: week + 1, m: weekMonth(week, lang) })}</span>
            </div>
            <ReplayChart data={d} week={week} />
          </section>
          <div className="rp-sides">
            {d.current ? <SideCard s={d.current} week={week} /> : null}
            {d.alternative ? <SideCard s={d.alternative} week={week} best={!!bestAlt} /> : null}
          </div>
          {d.current && d.alternative ? (
            <p className="tl-summary">
              <strong>
                {t("replay.kpi", {
                  y: year,
                  a: fmtU(d.current.erosion_total_t_ha, "t_ha", units, lang),
                  b: fmtU(d.alternative.erosion_total_t_ha, "t_ha", units, lang),
                  alt: d.alternative.name,
                })}
              </strong>
            </p>
          ) : null}
        </>
      ) : null}
      <Reminder text={cmpQ.data?.reminder} />
    </div>
  );
}
