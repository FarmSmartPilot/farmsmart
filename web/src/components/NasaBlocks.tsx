/* NASA water & cover blocks: SMAP L4 root-zone soil moisture, GRACE-FO water storage, HLS 30 m monthly
   greenness status and the IMERG missing-data state. Every value comes from /api/fields/{id}/nasa. */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { scaleLinear } from "d3";
import { Button, DataButton, Skeleton, StatusBanner } from "../design";
import { useNasaQ, useNasaValidationQ } from "../api";
import type { NasaEvidence, NasaResult } from "../api";
import { useApp } from "../store";
import { cx, isNum, nice, ordinal, toEvidence } from "../lib";

const doyOf = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`);
  return Math.floor((d.getTime() - Date.UTC(d.getUTCFullYear(), 0, 1)) / 86400000) + 1;
};
/** Week-of-year (1–52) used to look up the SMAP same-week climatology. */
const weekOf = (iso: string) => Math.min(52, Math.floor((doyOf(iso) - 1) / 7) + 1);

function NasaDot({ ev, describes }: { ev?: NasaEvidence; describes: string }) {
  const e = toEvidence(ev);
  return e ? <DataButton evidence={e} describes={describes} /> : null;
}

function Missing({ ev, what }: { ev?: NasaEvidence; what: string }) {
  const { t } = useTranslation();
  return (
    <StatusBanner kind="no-observation" title={t("nasa.missing_title", { what })}>
      {ev?.reason ?? t("nasa.missing_body")}
    </StatusBanner>
  );
}

/* ---------------- SMAP ---------------- */

export function SmapBlock({ smap }: { smap: NonNullable<NasaResult["smap"]> }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const [table, setTable] = useState(false);
  const pts = smap.last_12_months_weekly.filter((p) => isNum(p.sm_rootzone));
  const last = [...pts].reverse().find((p) => isNum(p.percentile));
  const clim = new Map(smap.weekly_climatology.map((c) => [c.week, c]));
  if (!pts.length) return <Missing ev={smap.evidence} what="SMAP" />;
  const W = 520;
  const H = 170;
  const pad = { l: 40, r: 10, t: 10, b: 22 };
  const band = pts.map((p) => clim.get(weekOf(p.week_ending)));
  const ys = [...pts.map((p) => p.sm_rootzone), ...band.flatMap((b) => (b ? [b.p10, b.p90] : []))];
  const x = scaleLinear().domain([0, pts.length - 1]).range([pad.l, W - pad.r]);
  const y = scaleLinear().domain([Math.min(...ys), Math.max(...ys)]).nice().range([H - pad.b, pad.t]);
  const bandPath =
    band.every(Boolean) && band.length > 1
      ? `M${band.map((b, i) => `${x(i)},${y(b!.p90)}`).join("L")}L${[...band].reverse().map((b, i) => `${x(band.length - 1 - i)},${y(b!.p10)}`).join("L")}Z`
      : null;
  const line = `M${pts.map((p, i) => `${x(i)},${y(p.sm_rootzone)}`).join("L")}`;
  const months = pts.map((p, i) => ({ i, m: p.week_ending.slice(0, 7) })).filter((p, k, a) => k === 0 || p.m !== a[k - 1].m);
  return (
    <div className="nasa-block">
      <div className="h-row">
        <h4 className="h4">
          {last ? t("nasa.smap_now", { p: ordinal(Math.round(last.percentile!), lang) }) : t("nasa.smap_title")}
        </h4>
        <NasaDot ev={smap.evidence} describes={t("nasa.smap_title")} />
      </div>
      <p className="fs-meta">
        {t("nasa.smap_sub", { a: smap.record?.[0]?.slice(0, 4) ?? "", d: last?.week_ending ?? "" })}
        {" · "}
        {smap.evidence.effective_res ?? ""}
      </p>
      <div className="h-row">
        <span className="legend-row">
          <span className="leg__sw" style={{ background: "var(--sky-tint)", border: "1px solid var(--sky)" }} aria-hidden="true" /> {t("nasa.smap_band")}
          <span className="leg__line" aria-hidden="true" /> {t("nasa.smap_line")}
        </span>
        <Button variant="ghost" size="sm" aria-pressed={table} onClick={() => setTable((v) => !v)}>
          {table ? t("common.show_chart") : t("common.show_table")}
        </Button>
      </div>
      {table ? (
        <div className="table-scroll">
          <table className="fs-table compact">
            <thead>
              <tr>
                <th scope="col">{t("nasa.week_ending")}</th>
                <th scope="col">{t("nasa.sm")} ({smap.units ?? "m³/m³"})</th>
                <th scope="col">{t("nasa.pctl")}</th>
              </tr>
            </thead>
            <tbody>
              {pts.map((p) => (
                <tr key={p.week_ending}>
                  <td>{p.week_ending}</td>
                  <td>{p.sm_rootzone.toFixed(3)}</td>
                  <td>{isNum(p.percentile) ? ordinal(Math.round(p.percentile), lang) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <svg viewBox={`0 0 ${W} ${H}`} className="svg-fluid" role="img" aria-label={t("nasa.smap_aria", { p: last ? ordinal(Math.round(last.percentile!), lang) : "—" })}>
          {y.ticks(4).map((tk) => (
            <g key={tk}>
              <line x1={pad.l} x2={W - pad.r} y1={y(tk)} y2={y(tk)} stroke="var(--line)" />
              <text x={pad.l - 4} y={y(tk) + 4} textAnchor="end" className="axis-t">
                {tk.toFixed(2)}
              </text>
            </g>
          ))}
          {bandPath ? <path d={bandPath} fill="var(--sky-tint)" stroke="var(--sky)" strokeOpacity={0.4} /> : null}
          <path d={line} fill="none" stroke="var(--navy)" strokeWidth={2} />
          {months.map((m) => (
            <text key={m.m} x={x(m.i)} y={H - 6} className="axis-t">
              {new Date(`${m.m}-15T00:00:00Z`).toLocaleDateString(lang === "es" ? "es" : "en-US", { month: "short", timeZone: "UTC" })}
            </text>
          ))}
        </svg>
      )}
      <p className="fs-meta">{t("nasa.smap_never")}</p>
    </div>
  );
}

/* ---------------- GRACE-FO ---------------- */

export function GraceBlock({ grace }: { grace: NonNullable<NasaResult["grace"]> }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const [table, setTable] = useState(false);
  const pts = grace.monthly.filter((m): m is [string, number] => isNum(m[1]));
  if (!pts.length) return <Missing ev={grace.evidence} what="GRACE-FO" />;
  const tr = grace.trend;
  const W = 520;
  const H = 150;
  const pad = { l: 36, r: 10, t: 10, b: 22 };
  const t0 = (s: string) => Number(s.slice(0, 4)) + (Number(s.slice(5, 7)) - 1) / 12;
  const x = scaleLinear().domain([t0(pts[0][0]), t0(pts[pts.length - 1][0])]).range([pad.l, W - pad.r]);
  const y = scaleLinear().domain([Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[1]))]).nice().range([H - pad.b, pad.t]);
  // Draw gaps (e.g. GRACE → GRACE-FO 2017–2018) as breaks, not lines.
  let d = "";
  pts.forEach((p, i) => {
    const gap = i > 0 && t0(p[0]) - t0(pts[i - 1][0]) > 0.17;
    d += `${i === 0 || gap ? "M" : "L"}${x(t0(p[0]))},${y(p[1])}`;
  });
  const sig = tr ? tr.ci95_cm_per_yr[0] > 0 || tr.ci95_cm_per_yr[1] < 0 : false;
  const years = x.ticks(6);
  return (
    <div className="nasa-block">
      <div className="h-row">
        <h4 className="h4">{t("nasa.grace_title")}</h4>
        <NasaDot ev={grace.evidence} describes={t("nasa.grace_title")} />
      </div>
      <p className="fs-chip fs-chip--outline chip-wrap">{grace.scale_label}</p>
      {tr ? (
        <p className={cx("nasa-kpi", tr.cm_per_yr < 0 && sig && "is-down")}>
          <strong>
            {tr.cm_per_yr > 0 ? "+" : ""}
            {nice(tr.cm_per_yr, lang)} {t("nasa.cm_yr")}
          </strong>{" "}
          <span className="fs-meta">
            {t("nasa.ci", { lo: nice(tr.ci95_cm_per_yr[0], lang), hi: nice(tr.ci95_cm_per_yr[1], lang) })} ·{" "}
            {sig ? (tr.cm_per_yr < 0 ? t("nasa.grace_down") : t("nasa.grace_up")) : t("nasa.grace_flat")}
          </span>
        </p>
      ) : null}
      <div className="h-row">
        <span className="fs-meta">
          {t("nasa.grace_sub", { a: pts[0][0], b: pts[pts.length - 1][0], u: grace.units ?? "cm" })}
        </span>
        <Button variant="ghost" size="sm" aria-pressed={table} onClick={() => setTable((v) => !v)}>
          {table ? t("common.show_chart") : t("common.show_table")}
        </Button>
      </div>
      {table ? (
        <div className="table-scroll nasa-table-scroll" tabIndex={0} role="region" aria-label={t("nasa.grace_title")}>
          <table className="fs-table compact">
            <thead>
              <tr>
                <th scope="col">{t("nasa.month")}</th>
                <th scope="col">{t("nasa.storage")} (cm)</th>
              </tr>
            </thead>
            <tbody>
              {pts.map((p) => (
                <tr key={p[0]}>
                  <td>{p[0]}</td>
                  <td>{nice(p[1], lang)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <svg viewBox={`0 0 ${W} ${H}`} className="svg-fluid" role="img" aria-label={t("nasa.grace_aria", { v: tr ? nice(tr.cm_per_yr, lang) : "—" })}>
          {y.ticks(4).map((tk) => (
            <g key={tk}>
              <line x1={pad.l} x2={W - pad.r} y1={y(tk)} y2={y(tk)} stroke={tk === 0 ? "var(--line-strong)" : "var(--line)"} />
              <text x={pad.l - 4} y={y(tk) + 4} textAnchor="end" className="axis-t">
                {nice(tk, lang)}
              </text>
            </g>
          ))}
          <path d={d} fill="none" stroke="var(--sky)" strokeWidth={1.5} />
          {years.map((yr) => (
            <text key={yr} x={x(yr)} y={H - 6} textAnchor="middle" className="axis-t">
              {Math.round(yr)}
            </text>
          ))}
        </svg>
      )}
      {tr?.method ? <p className="fs-meta">{t("nasa.method", { m: tr.method })}</p> : null}
    </div>
  );
}

/* ---------------- HLS ---------------- */

export function HlsStrip({ hls, compact }: { hls: NonNullable<NasaResult["hls"]>; compact?: boolean }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const ms = hls.monthly;
  if (!ms.length) return <Missing ev={hls.evidence} what="HLS" />;
  const byYear = new Map<string, typeof ms>();
  for (const m of ms) byYear.set(m.month.slice(0, 4), [...(byYear.get(m.month.slice(0, 4)) ?? []), m]);
  const mon = (i: number) => new Date(Date.UTC(2021, i, 15)).toLocaleDateString(lang === "es" ? "es" : "en-US", { month: "narrow", timeZone: "UTC" });
  return (
    <div className={cx("nasa-block hls", compact && "hls--compact")} data-tour="hls">
      <div className="h-row">
        <h4 className="h4">{t("nasa.hls_title")}</h4>
        <NasaDot ev={hls.evidence} describes={t("nasa.hls_title")} />
      </div>
      <p className="fs-meta">
        {hls.label} · {t("nasa.hls_sub", { n: hls.scenes_usable ?? "", thr: hls.threshold_ndvi ?? "" })}
      </p>
      <table className="hls-grid">
        <caption className="fs-visually-hidden">{t("nasa.hls_title")}</caption>
        <thead>
          <tr>
            <th scope="col">
              <span className="fs-visually-hidden">{t("nasa.year")}</span>
            </th>
            {Array.from({ length: 12 }, (_, i) => (
              <th key={i} scope="col" aria-label={new Date(Date.UTC(2021, i, 15)).toLocaleDateString(lang === "es" ? "es" : "en-US", { month: "long", timeZone: "UTC" })}>
                {mon(i)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {[...byYear.entries()].map(([yr, list]) => (
            <tr key={yr}>
              <th scope="row">{yr}</th>
              {Array.from({ length: 12 }, (_, i) => {
                const m = list.find((x) => Number(x.month.slice(5, 7)) === i + 1);
                const st = !m || !m.n_clear_scenes ? "none" : m.status === "green" ? "green" : "bare";
                const label =
                  st === "none" ? t("nasa.hls_none") : `${st === "green" ? t("nasa.hls_green") : t("nasa.hls_bare")} · NDVI ${nice(m!.ndvi_median, lang)} · ${t("nasa.hls_scenes", { n: m!.n_clear_scenes })}`;
                return (
                  <td key={i} className={`hls-cell hls-cell--${st}`} title={label}>
                    <span className="fs-visually-hidden">{label}</span>
                    <span aria-hidden="true">{st === "green" ? "●" : st === "bare" ? "" : "·"}</span>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="legend-row fs-meta">
        <span className="hls-key hls-cell--green" aria-hidden="true">●</span> {t("nasa.hls_green")}
        <span className="hls-key hls-cell--bare" aria-hidden="true" /> {t("nasa.hls_bare")}
        <span className="hls-key hls-cell--none" aria-hidden="true">·</span> {t("nasa.hls_none")}
      </p>
      <p className="fs-meta">{t("nasa.hls_never")}</p>
    </div>
  );
}

/* ---------------- section ---------------- */

export function useFieldNasa() {
  const id = useApp((s) => s.field?.id ?? null);
  return useNasaQ(id);
}

export default function NasaWaterCover() {
  const { t } = useTranslation();
  const q = useFieldNasa();
  if (q.isLoading) return <Skeleton lines={5} />;
  if (q.error)
    return (
      <StatusBanner kind="error" title={t("nasa.error_title")}>
        {q.error instanceof Error ? q.error.message : String(q.error)}
      </StatusBanner>
    );
  const n = q.data;
  if (!n?.available) return <StatusBanner kind="unsupported">{n?.reason ?? t("nasa.unavailable")}</StatusBanner>;
  return (
    <div className="fs-stack nasa" style={{ ["--gap" as string]: "16px" }}>
      {n.smap ? (n.smap.evidence?.available === false ? <Missing ev={n.smap.evidence} what="SMAP" /> : <SmapBlock smap={n.smap} />) : null}
      {n.grace ? (n.grace.evidence?.available === false ? <Missing ev={n.grace.evidence} what="GRACE-FO" /> : <GraceBlock grace={n.grace} />) : null}
      {n.hls ? (n.hls.evidence?.available === false ? <Missing ev={n.hls.evidence} what="HLS" /> : <HlsStrip hls={n.hls} />) : null}
      {n.imerg && (n.imerg.evidence?.available === false || n.imerg.value == null) ? (
        <StatusBanner kind="no-observation" title={t("nasa.imerg_title")}>
          {n.imerg.evidence?.reason ?? t("nasa.missing_body")} {t("nasa.imerg_fallback")}
        </StatusBanner>
      ) : null}
    </div>
  );
}

/** "What the satellite saw on your field": HLS monthly status beside the modelled season timeline. */
export function HlsTimelineNote() {
  const { t } = useTranslation();
  const q = useFieldNasa();
  const hls = q.data?.available ? q.data.hls : undefined;
  if (q.isLoading) return null;
  return (
    <details className="hls-details">
      <summary>{t("nasa.hls_title")}</summary>
      {hls && hls.evidence?.available !== false ? (
        <>
          <p className="fs-meta">{t("nasa.hls_vs_model")}</p>
          <HlsStrip hls={hls} compact />
        </>
      ) : (
        <p className="fs-meta">{q.data?.reason ?? hls?.evidence?.reason ?? t("nasa.unavailable")}</p>
      )}
    </details>
  );
}

/* ---------------- Sources & Methods: satellite vs model checks ---------------- */

function GraceRow({ id, name }: { id: string; name: string }) {
  const { i18n, t } = useTranslation();
  const q = useNasaQ(id);
  const tr = q.data?.available ? q.data.grace?.trend : undefined;
  return (
    <tr>
      <th scope="row">{name}</th>
      <td>
        {q.isLoading
          ? "…"
          : tr
            ? `${tr.cm_per_yr > 0 ? "+" : ""}${nice(tr.cm_per_yr, i18n.language)} ${t("nasa.cm_yr")} (${nice(tr.ci95_cm_per_yr[0], i18n.language)} … ${nice(tr.ci95_cm_per_yr[1], i18n.language)})`
            : t("nasa.not_available")}
      </td>
    </tr>
  );
}

export function NasaValidationSection({ pilots }: { pilots: { field_id?: string; label: string }[] }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const q = useNasaValidationQ();
  const v = q.data;
  return (
    <section className="card-sec" aria-labelledby="nval-h">
      <h2 id="nval-h" className="fs-h2">
        {t("nasa.val_title")}
      </h2>
      <p className="fs-meta">{t("nasa.val_help")}</p>
      {q.isLoading ? <Skeleton lines={4} /> : null}
      {q.error ? (
        <StatusBanner kind="error" title={t("nasa.error_title")}>
          {q.error instanceof Error ? q.error.message : String(q.error)}
        </StatusBanner>
      ) : null}
      {v?.smap?.length ? (
        <div className="table-scroll" tabIndex={0} role="region" aria-label={t("nasa.val_title")}>
          <table className="fs-table compact">
            <caption className="fs-meta cap-left">{t("nasa.val_smap")}</caption>
            <thead>
              <tr>
                <th scope="col">{t("nasa.pilot")}</th>
                <th scope="col">{t("nasa.val_r_anom")}</th>
                <th scope="col">{t("nasa.val_r_raw")}</th>
                <th scope="col">{t("nasa.val_weeks")}</th>
              </tr>
            </thead>
            <tbody>
              {v.smap.map((s) => (
                <tr key={s.field_id}>
                  <th scope="row">{s.name}</th>
                  <td>{s.available && s.weekly_anomaly ? nice(s.weekly_anomaly.r, lang) : (s.reason ?? "—")}</td>
                  <td>{s.weekly_raw ? nice(s.weekly_raw.r, lang) : "—"}</td>
                  <td>{s.weekly_anomaly?.n ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {pilots.length ? (
        <div className="table-scroll" tabIndex={0} role="region" aria-label={t("nasa.val_title")}>
          <table className="fs-table compact">
            <caption className="fs-meta cap-left">{t("nasa.val_grace")}</caption>
            <thead>
              <tr>
                <th scope="col">{t("nasa.pilot")}</th>
                <th scope="col">{t("nasa.val_trend")}</th>
              </tr>
            </thead>
            <tbody>
              {pilots.filter((p) => p.field_id).map((p) => (
                <GraceRow key={p.field_id} id={p.field_id!} name={p.label} />
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {v?.hls?.length ? (
        <div className="table-scroll" tabIndex={0} role="region" aria-label={t("nasa.val_title")}>
          <table className="fs-table compact">
            <caption className="fs-meta cap-left">{t("nasa.val_hls")}</caption>
            <thead>
              <tr>
                <th scope="col">{t("nasa.pilot")}</th>
                <th scope="col">{t("nasa.year")}</th>
                <th scope="col">{t("nasa.val_agree")}</th>
              </tr>
            </thead>
            <tbody>
              {v.hls.flatMap((h) =>
                h.available && h.years?.length
                  ? h.years.map((y) => (
                      <tr key={`${h.field_id}-${y.year}`}>
                        <th scope="row">{h.name}</th>
                        <td>
                          {y.year}
                          {y.cdl_crop ? ` · ${y.cdl_crop.replace(/_/g, " ")}` : ""}
                        </td>
                        <td>{y.comparable ? t("nasa.val_agree_v", { a: y.agree_months, n: y.months_with_clear_scene }) : (y.note ?? t("nasa.not_comparable"))}</td>
                      </tr>
                    ))
                  : [
                      <tr key={h.field_id}>
                        <th scope="row">{h.name}</th>
                        <td colSpan={2}>{h.reason ?? t("nasa.not_available")}</td>
                      </tr>,
                    ],
              )}
            </tbody>
          </table>
        </div>
      ) : null}
      {v?.imerg?.length ? <StatusBanner kind="no-observation" title={t("nasa.imerg_title")}>{v.imerg[0].reason ?? t("nasa.missing_body")}</StatusBanner> : null}
    </section>
  );
}
