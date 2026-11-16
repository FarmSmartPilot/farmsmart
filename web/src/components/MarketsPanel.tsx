/* Markets (wave U8): what each crop in play sells for now, how its price moved, what USDA expects, and what fertilizer
   costs. Data from GET /api/markets (wave U7): USDA NASS monthly price received (state average), USDA ERS harvest-price
   history (farm resource region), the latest USDA WASDE season-average forecast, USDA baseline projections (the early
   release leads when present) and World Bank fertilizer benchmarks. Gray data buttons (non-NASA sources). Forecasts are
   labelled as forecasts; futures are links only. Nothing here is invented: a missing block says so. */
import { useId, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { DataButton, Skeleton } from "../design";
import type { Evidence } from "../design";
import { inCropUnit, latestReceived, useMarketsQ, wasdePrice } from "../apiMoney";
import type { MarketBlockBase, MarketCrop, MarketMonth, MarketsData, MarketYears } from "../apiMoney";
import { cx } from "../lib";
import "../money.css";

const fin = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** "2026-09" → "September 2026" (or "Sep 2026" when short). */
export function monthLabel(m: string | null | undefined, lang: string, short = false): string {
  if (!m) return "—";
  const [y, mo] = m.split("-").map(Number);
  if (!fin(y) || !fin(mo)) return m;
  return new Date(Date.UTC(y, mo - 1, 15)).toLocaleDateString(lang === "es" ? "es" : "en-US", { month: short ? "short" : "long", year: "numeric", timeZone: "UTC" });
}

export function marketEvidence(b: MarketBlockBase | null | undefined, product: string, extra?: { start?: string; end?: string }): Evidence {
  return {
    source: b?.source ?? "—",
    product,
    effective_res: b?.scope ?? undefined,
    observation_start: extra?.start,
    observation_end: extra?.end,
    licence: b?.licence ?? undefined,
    citation: b?.citation ?? undefined,
    url: b?.url ?? undefined,
    qa_flags: [...(b?.retrieved ? [`Retrieved ${b.retrieved}`] : []), ...((b?.notes ?? []).filter(Boolean) as string[])],
    is_nasa: false,
  };
}

/** The projection series to lead with: the early release (newer) when present, else the full report. */
export function leadProjection(c: MarketCrop | undefined): { block: MarketYears; early: boolean } | null {
  const e = c?.projections_early_release;
  if (e && e.available !== false && (e.usd ?? []).some(fin)) return { block: e, early: true };
  const p = c?.projections;
  if (p && p.available !== false && (p.usd ?? []).some(fin)) return { block: p, early: false };
  return null;
}

const yearNum = (y: number | string | null | undefined) => (typeof y === "number" ? y : Number(String(y ?? "").slice(0, 4)));

/* ---------------- a small line chart ---------------- */

interface Series {
  id: string;
  label: string;
  points: { x: number; y: number }[];
  color: string;
  dash?: boolean;
}

function MiniChart({
  series,
  refLine,
  xTicks,
  yFmt,
  label,
}: {
  series: Series[];
  refLine?: { y: number; label: string; color: string } | null;
  xTicks: { x: number; label: string }[];
  yFmt: (v: number) => string;
  label: string;
}) {
  const W = 320;
  const H = 150;
  const L = 44;
  const R = 10;
  const T = 10;
  const B = 24;
  const xs = series.flatMap((s) => s.points.map((p) => p.x));
  const ys = [...series.flatMap((s) => s.points.map((p) => p.y)), ...(refLine ? [refLine.y] : [])];
  if (!xs.length || !ys.length) return null;
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  let y0 = Math.min(...ys);
  let y1 = Math.max(...ys);
  const pad = (y1 - y0) * 0.12 || Math.abs(y1) * 0.1 || 1;
  y0 -= pad;
  y1 += pad;
  const sx = (x: number) => L + ((x - x0) / (x1 - x0 || 1)) * (W - L - R);
  const sy = (y: number) => T + (1 - (y - y0) / (y1 - y0 || 1)) * (H - T - B);
  const yt = [y0 + pad, (y0 + y1) / 2, y1 - pad];
  return (
    <svg className="mk-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
      {yt.map((v, i) => (
        <g key={i}>
          <line x1={L} x2={W - R} y1={sy(v)} y2={sy(v)} className="mk-chart__grid" />
          <text x={L - 4} y={sy(v) + 4} textAnchor="end" className="mk-chart__tick">
            {yFmt(v)}
          </text>
        </g>
      ))}
      {xTicks.map((tk, i) => (
        <text key={i} x={sx(tk.x)} y={H - 6} textAnchor={i === 0 ? "start" : i === xTicks.length - 1 ? "end" : "middle"} className="mk-chart__tick">
          {tk.label}
        </text>
      ))}
      {refLine ? <line x1={L} x2={W - R} y1={sy(refLine.y)} y2={sy(refLine.y)} stroke={refLine.color} strokeWidth={2} strokeDasharray="2 3" /> : null}
      {series.map((s) =>
        s.points.length > 1 ? (
          <polyline
            key={s.id}
            fill="none"
            stroke={s.color}
            strokeWidth={2}
            strokeDasharray={s.dash ? "6 4" : undefined}
            strokeLinejoin="round"
            points={s.points.map((p) => `${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join(" ")}
          />
        ) : s.points.length === 1 ? (
          <circle key={s.id} cx={sx(s.points[0].x)} cy={sy(s.points[0].y)} r={3.5} fill={s.color} />
        ) : null,
      )}
    </svg>
  );
}

function Legend({ items }: { items: { label: string; color: string; dash?: boolean; dots?: boolean }[] }) {
  return (
    <ul className="mk-legend">
      {items.map((it) => (
        <li key={it.label}>
          <span className={cx("mk-legend__sw", it.dash && "is-dash", it.dots && "is-dots")} style={{ ["--c" as string]: it.color }} aria-hidden="true" />
          {it.label}
        </li>
      ))}
    </ul>
  );
}

/* ---------------- panel ---------------- */

export default function MarketsPanel({
  state,
  country,
  crops,
  cropName,
  units,
}: {
  /** 2-letter US state; null outside the US. */
  state: string | null;
  country: string | null;
  /** FarmSmart crop ids in play. */
  crops: string[];
  cropName?: (cid: string) => string;
  /** Planning unit per crop (bu, cwt, lb…), to say which unit the prices are in. */
  units?: Record<string, string>;
}) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const es = lang === "es";
  const q = useMarketsQ(state, country, crops);
  const hId = useId();
  const d = q.data;
  const money = (v: number, dp = 2) => `$${v.toLocaleString(es ? "es" : "en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp })}`;
  const name = (cid: string, c?: MarketCrop) => cropName?.(cid) ?? c?.label ?? cid.replace(/_/g, " ");

  return (
    <section className="card-sec mk" aria-labelledby={hId} data-tour="markets">
      <h2 id={hId} className="fs-h2">
        {t("markets.title")}
      </h2>
      <p className="money-lead-help">{t("markets.help")}</p>
      {q.isLoading ? (
        <Skeleton lines={3} />
      ) : q.isError || !d ? (
        <p className="money-note">{t("markets.unavailable")}</p>
      ) : (
        <MarketsBody d={d} crops={crops} name={name} units={units} money={money} lang={lang} />
      )}
    </section>
  );
}

function MarketsBody({
  d,
  crops,
  name,
  units,
  money,
  lang,
}: {
  d: MarketsData;
  crops: string[];
  name: (cid: string, c?: MarketCrop) => string;
  units?: Record<string, string>;
  money: (v: number, dp?: number) => string;
  lang: string;
}) {
  const { t } = useTranslation();
  const es = lang === "es";
  const where = d.state_name ?? d.state ?? t("markets.us");
  const rows = crops.filter((cid) => d.crops?.[cid]);
  const fert = (d.inputs?.items ?? []).filter((x) => x && x.available !== false && (x.series ?? []).some((m) => fin(m.value)));
  const links = d.links ?? [];

  const headline = (cid: string) => {
    const c = d.crops![cid];
    const u = units?.[cid] ?? c.unit ?? "";
    const r = latestReceived(c);
    const w = wasdePrice(c);
    const scopeUS = r && /\bUS\b|United States|national/i.test(`${r.scope ?? ""} ${r.source ?? ""}`) && !/state average/i.test(r.scope ?? "");
    const parts: string[] = [];
    if (r) parts.push(t("markets.head_now", { crop: name(cid, c), where: scopeUS ? t("markets.us") : where, v: money(r.usd), u, month: monthLabel(r.month, lang) }));
    if (w) parts.push(t(r ? "markets.head_usda" : "markets.head_usda_only", { crop: name(cid, c), v: money(w.usd), u, my: w.my ?? "" }));
    if (!parts.length) {
      const g = c.global;
      const gl = g && g.available !== false ? (g.latest ?? [...(g.series ?? [])].reverse().find((m) => fin(m.value))) : null;
      if (gl && fin(gl.value)) return t("markets.head_world", { crop: name(cid, c), v: money(gl.value, 0), unit: (g?.unit ?? "").replace(/^\$\//, ""), month: monthLabel(gl.month, lang, true) });
      return t("markets.head_none", { crop: name(cid, c) });
    }
    return parts.join(" · ");
  };

  return (
    <>
      {!d.us_available ? <p className="money-note">{t("markets.non_us")}</p> : null}
      <ul className="mk-heads">
        {rows.map((cid) => {
          const c = d.crops![cid];
          const r = latestReceived(c);
          return (
            <li key={cid} className="mk-head" data-crop={cid}>
              <span>{headline(cid)}</span>
              {r ? <DataButton evidence={marketEvidence(c.received, t("markets.ev_received"))} describes={name(cid, c)} /> : null}
              {wasdePrice(c) ? <span className="fs-chip mk-forecast">{t("markets.forecast_tag")}</span> : null}
            </li>
          );
        })}
        {crops.filter((cid) => !d.crops?.[cid]).length ? (
          <li className="fs-meta">{t("markets.missing_crops", { crops: crops.filter((cid) => !d.crops?.[cid]).map((cid) => name(cid)).join(", ") })}</li>
        ) : null}
      </ul>

      <details className="money-more mk-more">
        <summary>{t("markets.show")}</summary>
        <div className="mk-grid">
          {rows.map((cid) => (
            <CropCharts key={cid} cid={cid} c={d.crops![cid]} name={name(cid, d.crops![cid])} unit={units?.[cid] ?? d.crops![cid].unit ?? ""} money={money} lang={lang} />
          ))}
          {fert.length ? (
            <figure className="mk-fig">
              <figcaption className="mk-fig__cap">
                {t("markets.fert_h")}{" "}
                <DataButton evidence={marketEvidence(d.inputs, t("markets.fert_h"))} describes={t("markets.fert_h")} />
              </figcaption>
              <MiniChart
                label={t("markets.fert_aria", {
                  list: fert
                    .map((x) => {
                      const l = x.latest ?? [...(x.series ?? [])].reverse().find((m) => fin(m.value));
                      return `${(es && x.label_es) || x.label_en}: ${l && fin(l.value) ? money(l.value, 0) : "—"}/mt (${monthLabel(l?.month, lang, true)})`;
                    })
                    .join("; "),
                })}
                series={fert.map((x, i) => ({
                  id: x.id,
                  label: (es && x.label_es) || x.label_en || x.id,
                  color: FERT_COLORS[i % FERT_COLORS.length],
                  points: monthPoints(x.series),
                }))}
                xTicks={monthTicks(fert[0].series, lang)}
                yFmt={(v) => money(v, 0)}
              />
              <Legend
                items={fert.map((x, i) => {
                  const l = x.latest ?? [...(x.series ?? [])].reverse().find((m) => fin(m.value));
                  return { label: `${((es && x.label_es) || x.label_en || x.id).split(" (")[0]}: ${l && fin(l.value) ? money(l.value, 0) : "—"}/mt`, color: FERT_COLORS[i % FERT_COLORS.length] };
                })}
              />
              <p className="fs-meta">{d.inputs?.scope ?? t("markets.fert_scope")}</p>
            </figure>
          ) : null}
        </div>
        {links.length ? (
          <div className="mk-links">
            <p className="fs-meta">{t("markets.links_h")}</p>
            <ul>
              {links.map((l) => (
                <li key={l.url}>
                  <a href={l.url} target="_blank" rel="noopener noreferrer" className="fs-link">
                    {(es && l.label_es) || l.label_en}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {d.notes?.length ? (
          <ul className="money-notes" aria-label={t("markets.notes_h")}>
            {d.notes
              .filter((n) => !/to_crop_unit/.test(n))
              .map((n, i) => (
                <li key={i}>{n}</li>
              ))}
          </ul>
        ) : null}
      </details>
    </>
  );
}

const FERT_COLORS = ["var(--cat-5)", "var(--cat-6)", "var(--cat-3)"];

function monthPoints(series: MarketMonth[] | null | undefined, conv = 1, key: "usd" | "value" = "value") {
  const out: { x: number; y: number }[] = [];
  for (const m of series ?? []) {
    const v = m[key];
    const [y, mo] = (m.month ?? "").split("-").map(Number);
    if (fin(v) && fin(y) && fin(mo)) out.push({ x: y * 12 + (mo - 1), y: v * conv });
  }
  return out;
}

function monthTicks(series: MarketMonth[] | null | undefined, lang: string) {
  const s = (series ?? []).filter((m) => m.month);
  if (!s.length) return [];
  const pick = [s[0], s[Math.floor((s.length - 1) / 2)], s[s.length - 1]];
  return pick.map((m) => {
    const [y, mo] = m.month.split("-").map(Number);
    return { x: y * 12 + (mo - 1), label: monthLabel(m.month, lang, true) };
  });
}

function CropCharts({ cid, c, name, unit, money, lang }: { cid: string; c: MarketCrop; name: string; unit: string; money: (v: number, dp?: number) => string; lang: string }) {
  const { t } = useTranslation();
  const r = c.received && c.received.available !== false ? c.received : null;
  const conv = fin(r?.to_crop_unit) && r!.to_crop_unit! > 0 ? r!.to_crop_unit! : null;
  const monthly = r && conv ? monthPoints(r.series, conv, "usd") : [];
  const w = wasdePrice(c);
  const hh = c.harvest_history && c.harvest_history.available !== false ? c.harvest_history : null;
  const lead = leadProjection(c);
  const yearly = useMemo(() => {
    const pts = (b: MarketYears | null | undefined) => {
      const out: { x: number; y: number }[] = [];
      (b?.years ?? []).forEach((y, i) => {
        const v = inCropUnit(b, b?.usd?.[i] ?? null);
        const x = yearNum(y);
        if (v !== null && fin(x)) out.push({ x, y: v });
      });
      return out;
    };
    return { hist: pts(hh), proj: pts(lead?.block) };
  }, [hh, lead]);
  const projLabel = lead
    ? lead.early
      ? t("markets.proj_early", { date: monthLabel(lead.block.published ?? null, lang, true) })
      : t("markets.proj_full", { date: monthLabel(lead.block.published ?? null, lang, true) })
    : "";
  const yrs = [...yearly.hist, ...yearly.proj].map((p) => p.x);
  const yTicks = yrs.length ? [Math.min(...yrs), Math.max(...yrs)].map((x) => ({ x, label: String(x) })) : [];
  const lastHist = yearly.hist[yearly.hist.length - 1];
  const firstProj = yearly.proj[0];
  return (
    <div className="mk-crop" data-crop={cid}>
      <h3 className="mk-crop__h">{t("markets.crop_h", { crop: name, u: unit })}</h3>
      {monthly.length > 1 ? (
        <figure className="mk-fig">
          <figcaption className="mk-fig__cap">
            {t("markets.monthly_h")} <DataButton evidence={marketEvidence(r, t("markets.ev_received"), { start: r?.series?.[0]?.month, end: r?.latest?.month ?? undefined })} describes={`${name} ${t("markets.monthly_h")}`} />
          </figcaption>
          <MiniChart
            label={t("markets.monthly_aria", {
              crop: name,
              n: monthly.length,
              lo: money(Math.min(...monthly.map((p) => p.y))),
              hi: money(Math.max(...monthly.map((p) => p.y))),
              last: money(monthly[monthly.length - 1].y),
              f: w ? money(w.usd) : "—",
            })}
            series={[{ id: "rcv", label: t("markets.l_received"), points: monthly, color: "var(--sky)" }]}
            refLine={w ? { y: w.usd, label: t("markets.l_wasde"), color: "var(--wheat)" } : null}
            xTicks={monthTicks(r?.series, lang)}
            yFmt={(v) => money(v)}
          />
          <Legend
            items={[
              { label: `${t("markets.l_received")} (${/state average/i.test(r?.scope ?? "") ? t("markets.scope_state") : /US|national/i.test(r?.scope ?? "") ? t("markets.scope_us") : (r?.scope ?? "")})`, color: "var(--sky)" },
              ...(w ? [{ label: t("markets.l_wasde_v", { v: money(w.usd), my: w.my ?? "" }), color: "var(--wheat)", dots: true }] : []),
            ]}
          />
          {w ? (
            <p className="fs-meta">
              {t("markets.wasde_note", { date: c.wasde?.report_date ?? "—", report: c.wasde?.report ?? "WASDE" })}{" "}
              <DataButton evidence={marketEvidence(c.wasde, `${c.wasde?.report ?? "WASDE"}: ${c.wasde?.scope ?? ""}`)} describes={t("markets.l_wasde")} />
            </p>
          ) : null}
        </figure>
      ) : (
        <p className="fs-meta">{t("markets.no_monthly")}</p>
      )}
      {yearly.hist.length + yearly.proj.length > 1 ? (
        <figure className="mk-fig">
          <figcaption className="mk-fig__cap">
            {t("markets.yearly_h")}{" "}
            {hh ? <DataButton evidence={marketEvidence(hh, t("markets.ev_harvest"))} describes={`${name} ${t("markets.l_harvest")}`} /> : null}
            {lead ? <DataButton evidence={marketEvidence(lead.block, projLabel)} describes={`${name} ${projLabel}`} /> : null}
          </figcaption>
          <MiniChart
            label={t("markets.yearly_aria", {
              crop: name,
              h: lastHist ? `${lastHist.x}: ${money(lastHist.y)}` : "—",
              p: firstProj ? `${firstProj.x}: ${money(firstProj.y)}` : "—",
            })}
            series={[
              { id: "hist", label: t("markets.l_harvest"), points: yearly.hist, color: "var(--soil)" },
              { id: "proj", label: projLabel, points: yearly.proj, color: "var(--purple)", dash: true },
            ]}
            xTicks={yTicks}
            yFmt={(v) => money(v)}
          />
          <Legend
            items={[
              ...(yearly.hist.length ? [{ label: hh?.region ? `${t("markets.l_harvest")}, ${hh.region} (USDA ERS)` : t("markets.l_harvest"), color: "var(--soil)" }] : []),
              ...(yearly.proj.length ? [{ label: `${projLabel}: ${t("markets.forecast_tag")}`, color: "var(--purple)", dash: true }] : []),
            ]}
          />
        </figure>
      ) : null}
    </div>
  );
}
