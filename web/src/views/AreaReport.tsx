/* Area Report: climate normals + trends, this season, frost, soil, terrain, crop history, crops common here, coverage. */
import { useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { StatusBanner, Skeleton, Chip, Button } from "../design";
import type { Report, Trend } from "../api";
import { useReportQ } from "../api";
import { useApp } from "../store";
import type { Units } from "../store";
import { Ev, H, Term, QueryState } from "../components/common";
import NasaWaterCover from "../components/NasaBlocks";
import FieldSatellite from "../components/FieldSatellite";
import { conv, cropColor, doyLabel, fmt, fmtU, isNum, monthShort, nice, ordinal, pWords } from "../lib";
import type { UnitKind, TFn } from "../lib";

const CLIMATE_ROWS: { key: string; unit: UnitKind; term?: string }[] = [
  { key: "tmean", unit: "c" },
  { key: "precip", unit: "mm" },
  { key: "gdd10", unit: "none", term: "gdd" },
  { key: "et0", unit: "mm", term: "et" },
  { key: "water_balance", unit: "mm", term: "water_balance" },
  { key: "heavy_rain_days", unit: "days" },
  { key: "hot_days", unit: "days" },
  { key: "windy_days", unit: "days" },
];

const TREND_UNIT: Record<string, UnitKind> = {
  tmean: "c_delta",
  precip: "mm",
  hot_days: "days",
  heavy_rain_days: "days",
  water_balance: "mm",
  gdd10: "none",
};

function trendText(k: string, tr: Trend, units: Units, lang: string, t: (k: string, o?: Record<string, unknown>) => string): string {
  const unit = TREND_UNIT[k] ?? "none";
  const [v, u] = conv(tr.per_decade, unit, units);
  const [lo] = conv(tr.low, unit, units);
  const [hi] = conv(tr.high, unit, units);
  const dir = (v ?? 0) > 0 ? t("trend.up") : (v ?? 0) < 0 ? t("trend.down") : t("trend.flat");
  return t("trend.sentence", {
    dir,
    v: `${(v ?? 0) > 0 ? "+" : ""}${nice(v, lang)}${u ? ` ${u}` : ""}`,
    lo: nice(lo, lang),
    hi: nice(hi, lang),
    a: tr.first_year,
    b: tr.last_year,
  });
}

function Section({ title, dots, children, id }: { title: ReactNode; dots?: ReactNode; children: ReactNode; id: string }) {
  return (
    <section className="ar-sec" aria-labelledby={id}>
      <H level={3} id={id} dots={dots}>
        {title}
      </H>
      {children}
    </section>
  );
}

function MonthlyChart({ r, units, lang }: { r: Report; units: Units; lang: string }) {
  const { t } = useTranslation();
  const [table, setTable] = useState(false);
  const m = r.climate?.monthly ?? [];
  if (!m.length) return null;
  const W = 520;
  const Hh = 140;
  const pad = { l: 36, r: 36, t: 8, b: 20 };
  const bw = (W - pad.l - pad.r) / 12;
  const pmax = Math.max(...m.map((x) => x.precip), 1);
  const tmin = Math.min(...m.map((x) => x.tmean));
  const tmax = Math.max(...m.map((x) => x.tmean));
  const ty = (v: number) => pad.t + (1 - (v - tmin) / Math.max(1e-6, tmax - tmin)) * (Hh - pad.t - pad.b);
  const py = (v: number) => (v / pmax) * (Hh - pad.t - pad.b);
  const line = m.map((x, i) => `${i ? "L" : "M"}${pad.l + bw * (i + 0.5)},${ty(x.tmean)}`).join(" ");
  return (
    <div className="chart-block">
      <div className="h-row">
        <p className="fs-meta">
          {t("ar.monthly_caption", { a: r.climate?.normal_period?.[0], b: r.climate?.normal_period?.[1] })}
        </p>
        <Button variant="ghost" size="sm" onClick={() => setTable((x) => !x)} aria-pressed={table}>
          {table ? t("common.show_chart") : t("common.show_table")}
        </Button>
      </div>
      {table ? (
        <table className="fs-table">
          <caption className="fs-visually-hidden">{t("ar.monthly_title")}</caption>
          <thead>
            <tr>
              <th scope="col">{t("ar.month")}</th>
              <th scope="col">{t("clim.tmean")}</th>
              <th scope="col">{t("clim.precip")}</th>
              <th scope="col">{t("clim.et0")}</th>
            </tr>
          </thead>
          <tbody>
            {m.map((x) => (
              <tr key={x.month}>
                <th scope="row">{monthShort(x.month, lang)}</th>
                <td>{fmtU(x.tmean, "c", units, lang)}</td>
                <td>{fmtU(x.precip, "mm", units, lang)}</td>
                <td>{fmtU(x.et0, "mm", units, lang)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <svg viewBox={`0 0 ${W} ${Hh}`} className="svg-fluid" role="img" aria-label={t("ar.monthly_title")}>
          {m.map((x, i) => (
            <g key={x.month}>
              <rect x={pad.l + bw * i + 3} y={Hh - pad.b - py(x.precip)} width={bw - 6} height={py(x.precip)} fill="var(--sky)" opacity={0.75} rx={2} />
              <text x={pad.l + bw * (i + 0.5)} y={Hh - 6} textAnchor="middle" className="axis-t">
                {monthShort(x.month, lang).slice(0, 1)}
              </text>
            </g>
          ))}
          <path d={line} fill="none" stroke="var(--alert)" strokeWidth={2} />
          {m.map((x, i) => (
            <circle key={x.month} cx={pad.l + bw * (i + 0.5)} cy={ty(x.tmean)} r={2.5} fill="var(--alert)" />
          ))}
          <text x={4} y={14} className="axis-t">
            {conv(tmax, "c", units)[0]?.toFixed(0)}
            {conv(0, "c", units)[1]}
          </text>
          <text x={4} y={Hh - pad.b} className="axis-t">
            {conv(tmin, "c", units)[0]?.toFixed(0)}
          </text>
          <text x={W - 4} y={14} textAnchor="end" className="axis-t">
            {nice(conv(pmax, "mm", units)[0])} {conv(0, "mm", units)[1]}
          </text>
        </svg>
      )}
      <div className="legend-row" aria-hidden={table}>
        <span className="key key--bar" style={{ background: "var(--sky)" }} /> {t("clim.precip")}
        <span className="key key--line" style={{ background: "var(--alert)" }} /> {t("clim.tmean")}
      </div>
    </div>
  );
}

export default function AreaReport() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const field = useApp((s) => s.field);
  const units = useApp((s) => s.units);
  const mode = useApp((s) => s.mode);
  const q = useReportQ(field?.id ?? null);
  if (q.isLoading) return <Skeleton lines={10} />;
  if (q.error) return <QueryState error={q.error} what={t("ar.title")} onRetry={() => void q.refetch()} />;
  const r = q.data;
  if (!r) return null;
  const c = r.climate;
  const s = r.season;
  const powerEv = c?.evidence_id;
  const props = r.soil?.properties ?? {};
  const hist = r.history ?? [];
  const county = r.county_crops?.rows ?? [];

  return (
    <div className="area-report" data-tour="area-report">
      {r.errors && Object.keys(r.errors).length ? (
        <StatusBanner kind="partial" title={t("ar.partial_title")}>
          {t("ar.partial_body", { parts: Object.keys(r.errors).map((k) => t(`ar.part.${k}`, { defaultValue: k })).join(", ") })}
        </StatusBanner>
      ) : null}

      {/* Climate normals */}
      <Section id="ar-normals" title={t("ar.normals", { a: c?.normal_period?.[0], b: c?.normal_period?.[1] })} dots={<Ev id={powerEv} describes={t("ar.normals_short")} />}>
        {c ? (
          <>
            <p className="fs-meta">{t("ar.regional_note")}</p>
            <div className="kpi-grid">
              {CLIMATE_ROWS.map((row) => (
                <div className="kpi-cell" key={row.key}>
                  <div className="kpi-cell__label">{row.term ? <Term id={row.term}>{t(`clim.${row.key}`)}</Term> : t(`clim.${row.key}`)}</div>
                  <div className="kpi-cell__value">
                    {row.unit === "days" ? `${nice(c.normals[row.key], lang)} ${t("units.days_yr")}` : row.unit === "none" ? nice(c.normals[row.key], lang) : fmtU(c.normals[row.key], row.unit, units, lang)}
                  </div>
                </div>
              ))}
            </div>
            <MonthlyChart r={r} units={units} lang={lang} />
          </>
        ) : (
          <StatusBanner kind="no-observation">{t("ar.no_climate")}</StatusBanner>
        )}
      </Section>

      {/* Trends */}
      {c?.trends ? (
        <Section id="ar-trends" title={t("ar.trends", { a: c.years?.[0], b: c.years?.[1] })} dots={<Ev id={powerEv} describes={t("ar.trends_short")} />}>
          <p className="fs-meta">{t("ar.trends_method")}</p>
          <ul className="trend-list">
            {Object.entries(c.trends).map(([k, tr]) => (
              <li key={k}>
                <strong>{t(`clim.${k}`)}</strong>: {trendText(k, tr, units, lang, t as unknown as TFn)}{" "}
                <span className={`pword ${tr.p_value < 0.05 ? "is-clear" : ""}`}>
                  {pWords(tr.p_value, t)}
                  {mode === "expert" ? ` (p = ${fmt(tr.p_value, 3, lang)})` : ""}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {/* This season */}
      <Section id="ar-season" title={t("ar.season", { y: s?.year ?? "" })} dots={<Ev id={s?.evidence_id} describes={t("ar.season_short")} />}>
        {s?.available && s.metrics ? (
          <>
            <p className="fs-meta">{t("ar.season_asof", { d: s.as_of, n: s.n_years_compared })}</p>
            <ul className="season-list">
              {Object.entries(s.metrics).map(([k, m]) => {
                const n = s.n_years_compared ?? 0;
                const below = Math.round((m.percentile / 100) * n);
                const unit: UnitKind = k === "tmean" ? "c" : k === "precip" || k === "et0" ? "mm" : "none";
                return (
                  <li key={k} className="season-row">
                    <span className="season-row__label">{k === "rootzone_wetness" ? <Term id="root_zone">{t(`clim.${k}`)}</Term> : t(`clim.${k}`)}</span>
                    <span className="season-row__val">
                      {unit === "none" ? nice(m.value, lang) : fmtU(m.value, unit, units, lang)}
                      <span className="fs-meta"> · {t("ar.normal")} {unit === "none" ? nice(m.normal, lang) : fmtU(m.normal, unit, units, lang)}</span>
                    </span>
                    <span className="pctl" title="">
                      <span className="pctl__track" aria-hidden="true">
                        <span className="pctl__dot" style={{ left: `${Math.max(0, Math.min(100, m.percentile))}%` }} />
                      </span>
                      <span className="pctl__text">{t("ar.pctl", { p: ordinal(m.percentile, lang), below, n })}</span>
                    </span>
                  </li>
                );
              })}
            </ul>
          </>
        ) : (
          <StatusBanner kind="no-observation" title={t("ar.no_season_title")}>
            {s?.reason ?? t("ar.no_season")}
          </StatusBanner>
        )}
      </Section>

      {/* Frost */}
      {c?.frost ? (
        <Section id="ar-frost" title={<Term id="frost_risk">{t("ar.frost")}</Term>} dots={<Ev id={powerEv} describes={t("ar.frost")} />}>
          <dl className="facts">
            <div className="facts__row">
              <dt>{t("ar.last_spring")}</dt>
              <dd>{t("ar.typical_late", { a: doyLabel(c.frost.last_spring_frost_doy_median, lang), b: doyLabel(c.frost.last_spring_frost_doy_p90, lang) })}</dd>
            </div>
            <div className="facts__row">
              <dt>{t("ar.first_fall")}</dt>
              <dd>{t("ar.typical_early", { a: doyLabel(c.frost.first_fall_frost_doy_median, lang), b: doyLabel(c.frost.first_fall_frost_doy_p10, lang) })}</dd>
            </div>
            <div className="facts__row">
              <dt>{t("ar.frost_free")}</dt>
              <dd>{t("ar.ff_days", { a: nice(c.frost.frost_free_days_median, lang), b: nice(c.frost.frost_free_days_p10, lang) })}</dd>
            </div>
          </dl>
        </Section>
      ) : null}

      {/* Soil */}
      <Section id="ar-soil" title={t("ar.soil")} dots={<Ev id={r.soil?.evidence_id} describes={t("ar.soil")} />}>
        {r.soil?.available ? (
          <>
            {r.soil.source === "soilgrids" ? (
              <p className="fs-chip fs-chip--wheat chip-wrap">{r.soil.label ?? t("ar.soilgrids_label")}</p>
            ) : null}
            <dl className="facts">
              <div className="facts__row">
                <dt>{t("ar.texture")}</dt>
                <dd>{t("ar.texture_val", { clay: nice(props.claytotal_r as number, lang), sand: nice(props.sandtotal_r as number, lang), silt: nice(props.silttotal_r as number, lang) })}</dd>
              </div>
              <div className="facts__row">
                <dt>{t("myfield.om")}</dt>
                <dd>{nice(props.om_r as number, lang)}%</dd>
              </div>
              <div className="facts__row">
                <dt>{t("ar.drainage")}</dt>
                <dd>{props.drainagecl ? String(props.drainagecl) : t("ar.drainage_unknown")}</dd>
              </div>
              <div className="facts__row">
                <dt>pH</dt>
                <dd>{nice(props.ph1to1h2o_r as number, lang)}</dd>
              </div>
              <div className="facts__row">
                <dt>
                  <Term id="root_zone">{t("myfield.awc")}</Term>
                </dt>
                <dd>{fmtU(isNum(props.aws100_cm) ? props.aws100_cm * 10 : null, "mm", units, lang)}</dd>
              </div>
              {mode === "expert" ? (
                <div className="facts__row">
                  <dt>
                    <Term id="rusle">K</Term>
                  </dt>
                  <dd>{nice(props.kwfact as number, lang)}</dd>
                </div>
              ) : null}
            </dl>
            {r.soil.units?.length ? (
            <table className="fs-table compact">
              <caption className="fs-meta cap-left">{t("ar.map_units")}</caption>
              <thead>
                <tr>
                  <th scope="col">{t("ar.unit")}</th>
                  <th scope="col">{t("ar.share")}</th>
                </tr>
              </thead>
              <tbody>
                {(r.soil.units ?? []).map((u) => (
                  <tr key={u.mukey}>
                    <td>{u.name}</td>
                    <td>{Math.round(u.share * 100)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
            ) : null}
          </>
        ) : (
          <StatusBanner kind="no-observation">{r.soil?.reason ?? t("ar.no_soil")}</StatusBanner>
        )}
      </Section>

      {/* NASA Earthdata: SMAP, GRACE-FO, HLS, IMERG */}
      <Section id="ar-nasa" title={t("nasa.section")}>
        <NasaWaterCover />
      </Section>

      {/* Field-scale NASA observations: HLS 30 m greenness through the season + pixel grid, ECOSTRESS water use */}
      <Section id="ar-fieldsat" title={t("fsat.section")}>
        <FieldSatellite report={r} />
      </Section>

      {/* Terrain */}
      <Section id="ar-terrain" title={t("ar.terrain")} dots={<Ev id={r.terrain?.evidence_id} describes={t("ar.terrain")} />}>
        {r.terrain ? (
          <dl className="facts">
            <div className="facts__row">
              <dt>{t("ar.slope_mean")}</dt>
              <dd>{nice(r.terrain.slope_mean_pct, lang)}%</dd>
            </div>
            <div className="facts__row">
              <dt>{t("ar.slope_p90")}</dt>
              <dd>{nice(r.terrain.slope_p90_pct, lang)}%</dd>
            </div>
            <div className="facts__row">
              <dt>{t("ar.steep_share")}</dt>
              <dd>{nice(r.terrain.share_slope_gt5 * 100, lang)}%</dd>
            </div>
            <div className="facts__row">
              <dt>{t("ar.low_spots")}</dt>
              <dd>{isNum(r.terrain.low_spot_share) ? `${nice(r.terrain.low_spot_share * 100, lang)}%` : t("ar.not_resolvable")}</dd>
            </div>
            <div className="facts__row">
              <dt>{t("ar.relief")}</dt>
              <dd>{fmtU(r.terrain.elev_range_m, "m", units, lang)}</dd>
            </div>
            {r.terrain.method ? <p className="fs-meta">{t("ar.terrain_method", { m: r.terrain.method })}</p> : null}
            {!r.terrain.zones?.length ? <p className="fs-meta">{t("ar.zones_none")}</p> : null}
          </dl>
        ) : (
          <StatusBanner kind="no-observation">{t("ar.no_terrain")}</StatusBanner>
        )}
      </Section>

      {/* Crop history */}
      <Section id="ar-hist" title={<Term id="cdl">{t("ar.history")}</Term>} dots={<Ev id={r.crop_history?.evidence_id} describes={t("ar.history")} />}>
        {hist.length ? (
          <div className="hist-strip" role="list">
            {hist.map((h) => (
              <div role="listitem" key={h.year} className="hist-cell" title="">
                <span className="hist-cell__bar" style={{ background: cropColor(h.crop_id) }} aria-hidden="true" />
                <span className="hist-cell__yr">{h.year}</span>
                <span className="hist-cell__crop">{h.name ?? t("myfield.unknown")}</span>
                <span className="fs-meta">{isNum(h.share) ? `${Math.round(h.share * 100)}%` : ""}</span>
              </div>
            ))}
          </div>
        ) : (
          <StatusBanner kind="no-observation">{t("ar.no_history")}</StatusBanner>
        )}
      </Section>

      {/* Crops common here */}
      <Section id="ar-county" title={t("ar.county_crops")} dots={<Chip tone="alert">{t("ar.common_not_suitable")}</Chip>}>
        {county.length ? (
          <ul className="bars">
            {county.slice(0, 8).map((row) => (
              <li key={row.name} className="bars__row">
                <span className="bars__label">{row.name}</span>
                <span className="bars__track">
                  <span className="bars__fill" style={{ width: `${Math.round((row.share ?? 0) * 100)}%`, background: cropColor(row.crop_id) }} />
                </span>
                <span className="bars__val">{isNum(row.share) ? `${Math.round(row.share * 100)}%` : "—"}</span>
              </li>
            ))}
          </ul>
        ) : (
          <StatusBanner kind="partial" title={t("ar.county_missing_title")}>
            {r.errors?.county_crops ? t("ar.county_missing_err") : t("ar.county_missing")}
          </StatusBanner>
        )}
      </Section>

      {/* Coverage */}
      <Section id="ar-cov" title={t("ar.coverage")}>
        <ul className="coverage">
          {(r.coverage ?? []).map((row) => {
            const st = row.status === "supported" ? "supported" : row.status === "partial" ? "partial" : "unavailable";
            return (
              <li key={row.layer} className={`cov cov--${st}`}>
                <span className="cov__mark" aria-hidden="true">
                  {st === "supported" ? "●" : st === "partial" ? "◆" : "○"}
                </span>
                <span className="cov__layer">{row.layer}</span>
                <span className="cov__status">{t(`cov.${st}`)}</span>
                {row.note ? <span className="cov__note">{row.note}</span> : null}
              </li>
            );
          })}
        </ul>
      </Section>
    </div>
  );
}
