/* "How well does it work?": the checks behind the numbers, all from /api/validation (existing reports and model
   artifacts, no new claims). M2 county yields on held-out years (actual vs the P10–P90 range), coverage per crop,
   M10 confidence levels, NASA POWER weather vs ground stations and M3 next-crop skill. */
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { scaleLinear } from "d3";
import { Button, DataButton, SIButton, Skeleton, StatusBanner } from "../design";
import type { SIRecord, Evidence } from "../design";
import { useValidationQ } from "../api";
import { useValidationAllQ } from "../apiPlan";
import type { M2Point, ValidationAll } from "../apiPlan";
import { QueryState, Reminder } from "../components/common";
import { cx, fmt, isNum, nice } from "../lib";
import { useCropName } from "./ActionPlan";
import "../plan.css";

const pct = (v: number | null | undefined, lang: string) => (isNum(v) ? `${fmt(v * 100, 0, lang)}%` : "—");

/** Confidence for a validation SI button: stated rule, computed from the held-out numbers shown. */
function coverageConfidence(cov: number | undefined, reasons: string[], t: (k: string) => string): SIRecord["confidence"] {
  const level = !isNum(cov) ? "low" : cov >= 0.8 ? "high" : cov >= 0.7 ? "medium" : "low";
  return { level, reasons: [...reasons, t("val.conf_rule")] };
}

const POWER_EV: Evidence = {
  source: "NASA Langley Research Center",
  product: "NASA POWER daily (MERRA-2 / GEOS based)",
  native_res: "≈50 km",
  effective_res: "regional value (≈50 km)",
  is_nasa: true,
  url: "https://power.larc.nasa.gov/",
};
const GHCN_EV: Evidence = {
  source: "NOAA NCEI",
  product: "GHCN-Daily station records",
  footprint: "one rain gauge / thermometer site",
  is_nasa: false,
  url: "https://www.ncei.noaa.gov/products/land-based-station/global-historical-climatology-network-daily",
};
const NASS_EV: Evidence = {
  source: "USDA NASS",
  product: "Quick Stats county yields (survey)",
  effective_res: "county",
  is_nasa: false,
  url: "https://quickstats.nass.usda.gov/",
};

function Note({ text, what }: { text?: string; what: string }) {
  const { t } = useTranslation();
  return (
    <StatusBanner kind="no-observation" title={t("val.missing_title", { what })}>
      {text ?? t("val.missing_body")}
    </StatusBanner>
  );
}

function CardLink({ path }: { path?: string }) {
  const { t } = useTranslation();
  if (!path) return null;
  return (
    <p className="fs-meta">
      {t("val.details_in")} <code>{path}</code> ·{" "}
      <a className="fs-link" href="#/sources">
        {t("val.open_cards")}
      </a>
    </p>
  );
}

/* ---------------- M2 chart ---------------- */

function M2Chart({ points, unit }: { points: M2Point[]; unit?: string }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const [table, setTable] = useState(false);
  const inside = points.filter((p) => p.actual >= p.p10 && p.actual <= p.p90).length;
  const lo = Math.min(...points.flatMap((p) => [p.p10, p.actual]));
  const hi = Math.max(...points.flatMap((p) => [p.p90, p.actual]));
  const W = 520;
  const H = 320;
  const pad = { l: 56, r: 12, t: 12, b: 34 };
  const x = scaleLinear().domain([lo, hi]).nice().range([pad.l, W - pad.r]);
  const y = scaleLinear().domain(x.domain()).range([H - pad.b, pad.t]);
  const u = unit ? ` (${unit})` : "";
  return (
    <div className="chart-block">
      <div className="h-row">
        <p className="fs-meta">{t("val.m2_inside", { n: inside, m: points.length, p: pct(inside / Math.max(1, points.length), lang) })}</p>
        <Button variant="ghost" size="sm" onClick={() => setTable((v) => !v)} aria-pressed={table}>
          {table ? t("common.show_chart") : t("common.show_table")}
        </Button>
      </div>
      {table ? (
        <div className="table-scroll" style={{ maxHeight: 320 }}>
          <table className="fs-table compact">
            <thead>
              <tr>
                <th scope="col">{t("val.place")}</th>
                <th scope="col">{t("val.year")}</th>
                <th scope="col">P10–P90{u}</th>
                <th scope="col">P50</th>
                <th scope="col">{t("val.actual")}</th>
                <th scope="col">{t("val.inside")}</th>
              </tr>
            </thead>
            <tbody>
              {points.map((p, i) => (
                <tr key={i}>
                  <th scope="row">{[p.county, p.state].filter(Boolean).join(", ") || "—"}</th>
                  <td>{p.year}</td>
                  <td>
                    {nice(p.p10, lang)}–{nice(p.p90, lang)}
                  </td>
                  <td>{nice(p.p50, lang)}</td>
                  <td>{nice(p.actual, lang)}</td>
                  <td>{p.actual >= p.p10 && p.actual <= p.p90 ? t("common.yes") : t("common.no")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <svg viewBox={`0 0 ${W} ${H}`} className="svg-fluid val-m2" role="img" aria-label={t("val.m2_aria", { n: inside, m: points.length })}>
          {x.ticks(5).map((v) => (
            <g key={v}>
              <line x1={x(v)} x2={x(v)} y1={pad.t} y2={H - pad.b} stroke="var(--line)" />
              <line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} stroke="var(--line)" />
              <text x={x(v)} y={H - pad.b + 14} textAnchor="middle" className="axis-t">
                {nice(v, lang)}
              </text>
              <text x={pad.l - 4} y={y(v) + 4} textAnchor="end" className="axis-t">
                {nice(v, lang)}
              </text>
            </g>
          ))}
          <line x1={x(lo)} y1={y(lo)} x2={x(hi)} y2={y(hi)} stroke="var(--ink-3)" strokeDasharray="4 4" />
          {points.map((p, i) => {
            const ok = p.actual >= p.p10 && p.actual <= p.p90;
            return (
              <g key={i} opacity={0.75}>
                <line x1={x(p.actual)} x2={x(p.actual)} y1={y(p.p10)} y2={y(p.p90)} stroke={ok ? "var(--si)" : "var(--alert)"} strokeWidth={1.5} />
                <circle cx={x(p.actual)} cy={y(p.p50)} r={2} fill={ok ? "var(--si)" : "var(--alert)"} />
              </g>
            );
          })}
          <text x={(pad.l + W - pad.r) / 2} y={H - 4} textAnchor="middle" className="axis-t strong">
            {t("val.x_actual")}
            {u}
          </text>
          <text x={12} y={(pad.t + H - pad.b) / 2} textAnchor="middle" className="axis-t strong" transform={`rotate(-90 12 ${(pad.t + H - pad.b) / 2})`}>
            {t("val.y_range")}
          </text>
        </svg>
      )}
      <div className="legend-row">
        <span>
          <span className="key key--line" style={{ background: "var(--si)" }} /> {t("val.leg_in")}
        </span>
        <span>
          <span className="key key--line" style={{ background: "var(--alert)" }} /> {t("val.leg_out")}
        </span>
        <span>
          <span className="key key--line" style={{ background: "var(--ink-3)" }} /> {t("val.leg_diag")}
        </span>
      </div>
    </div>
  );
}

function M2Block({ m2 }: { m2: NonNullable<ValidationAll["m2"]> }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const name = useCropName();
  const crops = useMemo(() => [...new Set((m2.points ?? []).map((p) => p.crop))], [m2.points]);
  const [crop, setCrop] = useState<string | null>(null);
  const cur = crop ?? crops[0] ?? null;
  const pts = (m2.points ?? []).filter((p) => p.crop === cur);
  const cov = Object.entries(m2.coverage_80 ?? {});
  const covMean = cov.length ? cov.reduce((a, [, v]) => a + v, 0) / cov.length : undefined;
  const si: SIRecord = {
    model_name: t("val.m2_model"),
    kind: "si",
    version: "M2",
    top_drivers: [{ name: t("val.drv_weather") }, { name: t("val.drv_trend") }, { name: t("val.drv_soil") }],
    confidence: coverageConfidence(covMean, cov.map(([c, v]) => t("val.cov_reason", { crop: name(c), p: pct(v, lang), years: m2.test_years ?? "" })), t),
    information_cutoff: m2.test_years ? `${m2.test_years.slice(-4)}-12-31` : undefined,
    model_card_url: "#/sources",
  };
  return (
    <section className="card-sec" aria-labelledby="val-m2-h">
      <div className="h-row">
        <h2 id="val-m2-h" className="fs-h2">
          {t("val.m2_title")}
        </h2>
        <span className="fs-cluster" style={{ ["--gap" as string]: "6px" }}>
          <SIButton record={si} describes={t("val.m2_title")} />
          <DataButton evidence={NASS_EV} describes={t("val.actual")} />
        </span>
      </div>
      <p className="fs-meta">{t("val.m2_help", { years: m2.test_years ?? "—" })}</p>
      {cov.length ? (
        <ul className="val-cov">
          {cov.map(([c, v]) => (
            <li key={c} className="val-cov__row">
              <span className="val-cov__label">{name(c)}</span>
              <span className="val-cov__track" aria-hidden="true">
                <span className="val-cov__fill" style={{ width: `${Math.min(100, v * 100)}%` }} />
                <span className="val-cov__target" style={{ left: "80%" }} />
              </span>
              <span className="val-cov__val">{pct(v, lang)}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {cov.length ? <p className="fs-meta">{t("val.cov_target")}</p> : null}
      {crops.length > 1 ? (
        <div className="fs-cluster" role="group" aria-label={t("val.pick_crop")}>
          {crops.map((c) => (
            <button key={c} type="button" className={cx("fs-chip", "val-chip")} aria-pressed={c === cur} onClick={() => setCrop(c)}>
              {name(c)}
            </button>
          ))}
        </div>
      ) : null}
      {pts.length ? <M2Chart points={pts} unit={m2.points_unit ?? m2.unit} /> : <p className="fs-meta">{t("val.no_points")}</p>}
      {m2.points_note ? <p className="fs-meta">{m2.points_note}</p> : null}
      {Object.entries(m2.detail ?? {})
        .filter(([, v]) => v.deployed === false)
        .map(([c, v]) => (
          <p key={c} className="fs-meta">
            <strong>{t("val.not_deployed", { crop: name(c) })}</strong> {v.not_deployed_reason}
            {isNum(v.coverage_80) ? ` (${t("val.cov_short", { p: pct(v.coverage_80, lang) })})` : ""}
          </p>
        ))}
      {m2.note ? <p className="fs-meta">{m2.note}</p> : null}
      <CardLink path={m2.model_card} />
    </section>
  );
}

function M10Block({ m10 }: { m10: NonNullable<ValidationAll["m10"]> }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const levels = m10.levels ?? [];
  const high = levels.find((l) => l.level.toLowerCase() === "high");
  const si: SIRecord = {
    model_name: t("val.m10_model"),
    kind: "rules",
    version: "M10",
    top_drivers: [{ name: t("val.drv_width") }, { name: t("val.drv_regional") }],
    confidence: coverageConfidence(high?.coverage, levels.map((l) => t("val.lvl_reason", { level: l.level, p: pct(l.coverage, lang), n: fmt(l.n, 0, lang) })), t),
    model_card_url: "#/sources",
  };
  return (
    <section className="card-sec" aria-labelledby="val-m10-h">
      <div className="h-row">
        <h2 id="val-m10-h" className="fs-h2">
          {t("val.m10_title")}
        </h2>
        <SIButton record={si} describes={t("val.m10_title")} />
      </div>
      <p className="fs-meta">{t("val.m10_help")}</p>
      {m10.what ? <p className="fs-meta">{m10.what}</p> : null}
      <ul className="val-cov">
        {levels.map((l) => (
          <li key={l.level} className="val-cov__row">
            <span className="val-cov__label">{t(`val.level.${l.level.toLowerCase()}`, { defaultValue: l.level })}</span>
            <span className="val-cov__track" aria-hidden="true">
              <span className="val-cov__fill" style={{ width: `${Math.min(100, l.coverage * 100)}%` }} />
              <span className="val-cov__target" style={{ left: "80%" }} />
            </span>
            <span className="val-cov__val">
              {pct(l.coverage, lang)} <span className="fs-meta">n = {fmt(l.n, 0, lang)}</span>
            </span>
          </li>
        ))}
      </ul>
      {m10.note ? <p className="fs-meta">{m10.note}</p> : null}
      <CardLink path={m10.report} />
    </section>
  );
}

function WeatherBlock({ pairs: raw, report, note }: { pairs: { site: string; station?: string; variable: string; r: number; n?: number }[]; report?: string; note?: string }) {
  const pairs = raw.map((p) => ({ ...p, site: p.station ? `${p.site} · ${p.station}` : p.site }));
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const sites = [...new Set(pairs.map((p) => p.site))];
  const vars = [...new Set(pairs.map((p) => p.variable))];
  return (
    <section className="card-sec" aria-labelledby="val-wx-h">
      <div className="h-row">
        <h2 id="val-wx-h" className="fs-h2">
          {t("val.wx_title")}
        </h2>
        <span className="fs-cluster" style={{ ["--gap" as string]: "6px" }}>
          <DataButton evidence={POWER_EV} describes="NASA POWER" />
          <DataButton evidence={GHCN_EV} describes={t("val.station")} />
        </span>
      </div>
      <p className="fs-meta">{t("val.wx_help")}</p>
      <div className="table-scroll">
        <table className="fs-table compact">
          <caption className="fs-meta cap-left">{t("val.wx_caption")}</caption>
          <thead>
            <tr>
              <th scope="col">{t("val.site")}</th>
              {vars.map((v) => (
                <th key={v} scope="col">
                  {t(`val.var.${v}`, { defaultValue: v })}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sites.map((s) => (
              <tr key={s}>
                <th scope="row">{s}</th>
                {vars.map((v) => {
                  const p = pairs.find((x) => x.site === s && x.variable === v);
                  return <td key={v}>{p && isNum(p.r) ? fmt(p.r, 2, lang) : "—"}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="fs-meta">{t("val.wx_read")}</p>
      {note ? <p className="fs-meta">{note}</p> : null}
      <CardLink path={report} />
    </section>
  );
}

function M3Block({ m3 }: { m3: NonNullable<ValidationAll["m3"]> }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const base = Object.entries(m3.baselines ?? {});
  const flat = base.filter(([, v]) => isNum(v)) as [string, number][];
  const nested = base.filter(([, v]) => v && typeof v === "object") as [string, Record<string, number>][];
  const si: SIRecord = {
    model_name: t("val.m3_model"),
    kind: "si",
    version: "M3",
    top_drivers: [{ name: t("val.drv_prev") }, { name: t("val.drv_mix") }],
    confidence: {
      level: isNum(m3.top1) && flat.every(([, v]) => (m3.top1 ?? 0) > v) ? "medium" : "low",
      reasons: [t("val.m3_reason", { a: pct(m3.top1, lang), b: pct(m3.top3, lang) }), t("val.m3_habit"), t("val.m3_rule")],
    },
    model_card_url: "#/sources",
  };
  return (
    <section className="card-sec" aria-labelledby="val-m3-h">
      <div className="h-row">
        <h2 id="val-m3-h" className="fs-h2">
          {t("val.m3_title")}
        </h2>
        <SIButton record={si} describes={t("val.m3_title")} />
      </div>
      <p className="fs-meta">{t("val.m3_help")}</p>
      {m3.area ? <p className="fs-meta">{t("val.m3_area", { a: m3.area })}</p> : null}
      <div className="kpi-grid">
        <div className="kpi-cell">
          <div className="kpi-cell__label">{t("val.top1")}</div>
          <div className="kpi-cell__value">{pct(m3.top1, lang)}</div>
        </div>
        <div className="kpi-cell">
          <div className="kpi-cell__label">{t("val.top3")}</div>
          <div className="kpi-cell__value">{pct(m3.top3, lang)}</div>
        </div>
        {flat.map(([k, v]) => (
          <div className="kpi-cell" key={k}>
            <div className="kpi-cell__label">{t(`val.base.${k}`, { defaultValue: k.replace(/_/g, " ") })}</div>
            <div className="kpi-cell__value">{pct(v, lang)}</div>
          </div>
        ))}
      </div>
      {nested.length ? (
        <div className="table-scroll">
          <table className="fs-table compact">
            <tbody>
              {nested.map(([k, v]) => (
                <tr key={k}>
                  <th scope="row">{k.replace(/_/g, " ")}</th>
                  {Object.entries(v).map(([kk, vv]) => (
                    <td key={kk}>
                      {t(`val.base.${kk}`, { defaultValue: kk.replace(/_/g, " ") })}: {pct(vv, lang)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {m3.areas?.length ? (
        <div className="table-scroll">
          <table className="fs-table compact">
            <caption className="fs-meta cap-left">{t("val.m3_areas")}</caption>
            <thead>
              <tr>
                <th scope="col">{t("val.area")}</th>
                <th scope="col">{t("val.fields")}</th>
                <th scope="col">{t("val.top1")}</th>
                <th scope="col">{t("val.top3")}</th>
                {Object.keys(m3.areas[0].baselines ?? {}).map((k) => (
                  <th key={k} scope="col">
                    {t(`val.base.${k}`, { defaultValue: k.replace(/_/g, " ") })}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {m3.areas.map((a) => (
                <tr key={a.area}>
                  <th scope="row">
                    {a.area}
                    {a.held_out_year ? <span className="fs-meta"> · {a.held_out_year}</span> : null}
                  </th>
                  <td>{fmt(a.n_fields, 0, lang)}</td>
                  <td>{pct(a.top1, lang)}</td>
                  <td>{pct(a.top3, lang)}</td>
                  {Object.keys(m3.areas![0].baselines ?? {}).map((k) => (
                    <td key={k}>{pct(a.baselines?.[k], lang)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {m3.what ? <p className="fs-meta">{m3.what}</p> : null}
      <p className="fs-meta">{t("val.m3_habit")}</p>
      {m3.note ? <p className="fs-meta">{m3.note}</p> : null}
      <CardLink path={m3.model_card} />
    </section>
  );
}

export default function Validation() {
  const { t } = useTranslation();
  const q = useValidationAllQ();
  // The weather comparison already has its own endpoint; it fills in when /api/validation has no weather block.
  const wxQ = useValidationQ();
  const d = q.data;
  const wxPairs = useMemo(() => {
    if (d?.weather?.pairs?.length) return d.weather.pairs;
    const out: { site: string; variable: string; r: number; n?: number }[] = [];
    for (const s of wxQ.data?.sites ?? []) {
      const site = s.station_name ? `${s.pilot} · ${s.station_name}` : s.pilot;
      for (const k of ["tmax_daily", "tmin_daily", "precip_daily", "precip_monthly"] as const) {
        const v = s[k];
        if (v && isNum(v.r)) out.push({ site, variable: k, r: v.r, n: v.n });
      }
    }
    return out;
  }, [d, wxQ.data]);

  return (
    <div className="page page--narrowish" data-tour="validation">
      <header className="page__head">
        <div>
          <h1 className="fs-h1">{t("val.title")}</h1>
          <p className="fs-meta">{t("val.sub")}</p>
        </div>
        {d?.generated ? <span className="fs-meta">{t("val.generated", { d: d.generated })}</span> : null}
      </header>
      {d?.note ? <p className="fs-meta">{d.note}</p> : null}
      {q.isLoading ? <Skeleton height={240} /> : null}
      {q.error ? <QueryState error={q.error} what={t("val.title")} onRetry={() => void q.refetch()} /> : null}
      {d ? (d.m2 ? <M2Block m2={d.m2} /> : <Note text={d.m2_note} what={t("val.m2_title")} />) : null}
      {d ? (d.m10 ? <M10Block m10={d.m10} /> : <Note text={d.m10_note} what={t("val.m10_title")} />) : null}
      {wxPairs.length ? (
        <WeatherBlock pairs={wxPairs} report={d?.weather?.report ?? (wxQ.data ? "qc/reports/weather_agreement.md" : undefined)} note={d?.weather?.note} />
      ) : d || q.error ? (
        <Note text={d?.weather_note} what={t("val.wx_title")} />
      ) : null}
      {d ? (d.m3 ? <M3Block m3={d.m3} /> : <Note text={d.m3_note} what={t("val.m3_title")} />) : null}
      <Reminder />
    </div>
  );
}
