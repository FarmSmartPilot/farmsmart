/* Field satellite (Area Report): HLS 30 m greenness (NDVI) through the season for the field polygon, a 30 m pixel
   grid of one scene drawn over the field outline, and ECOSTRESS daytime water-use (ET) dots at the field centre.
   Every value comes from /api/fields/{id}/hls, /hls/{scene}/grid and /ecostress. Greenness is not yield, residue or
   soil carbon; ET is a daytime model estimate for one 70 m pixel. */
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { scaleLinear, scaleTime } from "d3";
import { Button, DataButton, Skeleton, StatusBanner } from "../design";
import type { Evidence } from "../design";
import type { Report } from "../api";
import { isNotFound } from "../api";
import { useEcostressQ, useHlsGridQ, useHlsQ } from "../apiPlan";
import type { EcostressResult, HlsGrid, HlsResult, HlsScene, SatEvidence } from "../apiPlan";
import { cx, fmt, isNum, nice } from "../lib";
import "../plan.css";

const LP_DAAC = "NASA LP DAAC";

function satEvidence(ev: SatEvidence | undefined, extra: { scale?: string; start?: string; end?: string; qa?: string[] }): Evidence | null {
  if (!ev) return null;
  return {
    source: ev.source ?? LP_DAAC,
    product: ev.product,
    native_res: ev.resolution,
    effective_res: extra.scale,
    observation_start: ev.observation_period?.[0] ?? extra.start,
    observation_end: ev.observation_period?.[1] ?? extra.end,
    footprint: ev.collections,
    qa_flags: [...(ev.qa?.length ? ev.qa : (extra.qa ?? [])), ...(ev.note ? [ev.note] : []), ...(ev.retrieved ? [`Retrieved ${ev.retrieved}`] : [])],
    licence: ev.licence,
    citation: ev.citation,
    url: ev.url,
    is_nasa: true,
  };
}

const dateOf = (s: string) => new Date(s.length <= 10 ? `${s}T12:00:00Z` : s);
const ndviOf = (s: HlsScene) => (isNum(s.ndvi_p50) ? s.ndvi_p50 : s.ndvi_mean);

/** NDVI colour: bare soil brown → full canopy green (sequential, colour-blind safe ends). */
function ndviRgb(v: number): number[] {
  const tt = Math.max(0, Math.min(1, (v - 0.1) / 0.8));
  const a = [176, 141, 99];
  const b = [232, 221, 160];
  const c = [26, 110, 58];
  const mix = (p: number[], q: number[], k: number) => p.map((x, i) => Math.round(x + (q[i] - x) * k));
  return tt < 0.4 ? mix(a, b, tt / 0.4) : mix(b, c, (tt - 0.4) / 0.6);
}

/** WGS84 lon/lat → UTM easting/northing (Snyder's transverse Mercator series; mm-level within a zone). */
function toUtm(lon: number, lat: number, zone: number, south: boolean): [number, number] {
  const a = 6378137;
  const f = 1 / 298.257223563;
  const k0 = 0.9996;
  const e2 = f * (2 - f);
  const ep2 = e2 / (1 - e2);
  const phi = (lat * Math.PI) / 180;
  const lam0 = (((zone - 1) * 6 - 180 + 3) * Math.PI) / 180;
  const N = a / Math.sqrt(1 - e2 * Math.sin(phi) ** 2);
  const T = Math.tan(phi) ** 2;
  const C = ep2 * Math.cos(phi) ** 2;
  const A = Math.cos(phi) * ((lon * Math.PI) / 180 - lam0);
  const M =
    a *
    ((1 - e2 / 4 - (3 * e2 ** 2) / 64 - (5 * e2 ** 3) / 256) * phi -
      ((3 * e2) / 8 + (3 * e2 ** 2) / 32 + (45 * e2 ** 3) / 1024) * Math.sin(2 * phi) +
      ((15 * e2 ** 2) / 256 + (45 * e2 ** 3) / 1024) * Math.sin(4 * phi) -
      ((35 * e2 ** 3) / 3072) * Math.sin(6 * phi));
  const x = k0 * N * (A + ((1 - T + C) * A ** 3) / 6 + ((5 - 18 * T + T ** 2 + 72 * C - 58 * ep2) * A ** 5) / 120) + 500000;
  let y =
    k0 *
    (M + N * Math.tan(phi) * (A ** 2 / 2 + ((5 - T + 9 * C + 4 * C ** 2) * A ** 4) / 24 + ((61 - 58 * T + T ** 2 + 600 * C - 330 * ep2) * A ** 6) / 720));
  if (south) y += 10000000;
  return [x, y];
}

/* ---------------- season curve ---------------- */

function SeasonCurve({ hls, sel, onSel }: { hls: HlsResult; sel: string | null; onSel: (id: string) => void }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const scenes = (hls.scenes ?? []).filter((s) => !s.withheld && isNum(ndviOf(s)));
  const withheld = (hls.scenes ?? []).filter((s) => s.withheld);
  const W = 560;
  const H = 200;
  const pad = { l: 34, r: 10, t: 10, b: 24 };
  const dates = [...(hls.scenes ?? []).map((s) => dateOf(s.date))];
  const start = hls.period ? dateOf(hls.period.start) : new Date(Math.min(...dates.map(Number)));
  const end = hls.period ? dateOf(hls.period.end) : new Date(Math.max(...dates.map(Number)));
  const x = scaleTime().domain([start, end]).range([pad.l, W - pad.r]);
  const lo = Math.min(0, ...scenes.map((s) => s.ndvi_p10 ?? 0));
  const y = scaleLinear().domain([lo, 1]).range([H - pad.b, pad.t]);
  const band = scenes.filter((s) => isNum(s.ndvi_p10) && isNum(s.ndvi_p90));
  const area =
    band.length > 1
      ? `M${band.map((s) => `${x(dateOf(s.date))},${y(s.ndvi_p90!)}`).join("L")}L${[...band]
          .reverse()
          .map((s) => `${x(dateOf(s.date))},${y(s.ndvi_p10!)}`)
          .join("L")}Z`
      : null;
  const line = scenes.length > 1 ? `M${scenes.map((s) => `${x(dateOf(s.date))},${y(ndviOf(s)!)}`).join("L")}` : null;
  const months = x.ticks(7);
  return (
    <figure className="fsat-fig">
      <svg viewBox={`0 0 ${W} ${H}`} className="svg-fluid" role="img" aria-label={t("fsat.curve_aria", { n: scenes.length })}>
        {[0, 0.25, 0.5, 0.75, 1].map((v) => (
          <g key={v}>
            <line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} stroke="var(--line)" />
            <text x={pad.l - 4} y={y(v) + 4} textAnchor="end" className="axis-t">
              {fmt(v, 2, lang)}
            </text>
          </g>
        ))}
        {months.map((m) => (
          <text key={+m} x={x(m)} y={H - 6} textAnchor="middle" className="axis-t">
            {m.toLocaleDateString(lang === "es" ? "es" : "en-US", { month: "short", timeZone: "UTC" })}
          </text>
        ))}
        {area ? <path d={area} fill="var(--field)" opacity={0.14} /> : null}
        {line ? <path d={line} fill="none" stroke="var(--field)" strokeWidth={2} /> : null}
        {withheld.map((s) => (
          <line key={s.id} x1={x(dateOf(s.date))} x2={x(dateOf(s.date))} y1={H - pad.b} y2={H - pad.b - 6} stroke="var(--ink-3)" strokeWidth={1.5} />
        ))}
        {scenes.map((s) => (
          <circle
            key={s.id}
            cx={x(dateOf(s.date))}
            cy={y(ndviOf(s)!)}
            r={s.id === sel ? 6 : 4}
            fill={s.id === sel ? "var(--navy)" : s.sensor === "L30" ? "#fff" : "var(--field)"}
            stroke={s.id === sel ? "#fff" : "var(--field-strong)"}
            strokeWidth={1.5}
            className="fsat-dot"
            onClick={() => onSel(s.id)}
          >
            <title>{`${s.date} · ${s.sensor} · NDVI ${fmt(ndviOf(s), 2, lang)}`}</title>
          </circle>
        ))}
      </svg>
      <figcaption className="legend-row">
        <span>
          <span className="key key--line" style={{ background: "var(--field)" }} /> {t("fsat.leg_median")}
        </span>
        <span>
          <span className="key key--bar" style={{ background: "var(--field)", opacity: 0.25 }} /> {t("fsat.leg_band")}
        </span>
        <span>
          <span className="fsat-key fsat-key--s30" aria-hidden="true" /> Sentinel-2 (S30)
        </span>
        <span>
          <span className="fsat-key fsat-key--l30" aria-hidden="true" /> Landsat 8/9 (L30)
        </span>
        {withheld.length ? (
          <span>
            <span className="key key--line" style={{ background: "var(--ink-3)", width: 2, height: 8 }} /> {t("fsat.leg_withheld", { n: withheld.length })}
          </span>
        ) : null}
      </figcaption>
    </figure>
  );
}

/* ---------------- pixel grid ---------------- */

/** Field outline in grid-cell units. Exact when the grid's UTM CRS and affine transform are given; otherwise a
    lon/lat mapping onto the window's EPSG:4326 extent (slightly skewed, display only). */
function outlinePaths(geom: GeoJSON.Geometry | undefined, grid: HlsGrid): { paths: string[]; exact: boolean } {
  if (!geom) return { paths: [], exact: false };
  const code = grid.crs?.match(/^EPSG:(32[67])(\d{2})$/);
  const tr = grid.transform;
  let px: (p: GeoJSON.Position) => [number, number];
  let exact = false;
  if (code && tr && tr.length >= 6 && tr[1] === 0 && tr[3] === 0) {
    const zone = Number(code[2]);
    const south = code[1] === "327";
    px = (p) => {
      const [x, y] = toUtm(p[0], p[1], zone, south);
      return [(x - tr[2]) / tr[0], (y - tr[5]) / tr[4]];
    };
    exact = true;
  } else {
    const [w, s, e, n] = grid.bbox;
    px = (p) => [((p[0] - w) / (e - w)) * grid.width, ((n - p[1]) / (n - s)) * grid.height];
  }
  const ring = (r: GeoJSON.Position[]) => `M${r.map((p) => px(p).map((v) => v.toFixed(3)).join(",")).join("L")}Z`;
  if (geom.type === "Polygon") return { paths: [geom.coordinates.map(ring).join(" ")], exact };
  if (geom.type === "MultiPolygon") return { paths: geom.coordinates.map((poly) => poly.map(ring).join(" ")), exact };
  return { paths: [], exact };
}

/** Paint the grid into an image (one canvas pixel per 30 m cell): large grids stay fast. */
function useGridImage(grid: HlsGrid): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const cv = document.createElement("canvas");
    cv.width = grid.width;
    cv.height = grid.height;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    const img = ctx.createImageData(grid.width, grid.height);
    for (let r = 0; r < grid.height; r++) {
      for (let c = 0; c < grid.width; c++) {
        const v = grid.values[r]?.[c];
        const inside = !!grid.inside[r]?.[c];
        const k = (r * grid.width + c) * 4;
        // Masked cells: light gray checker (hatched look when scaled up); outside the field: faded.
        const rgb = isNum(v) ? ndviRgb(v) : (r + c) % 2 ? [195, 204, 214] : [246, 248, 250];
        img.data[k] = rgb[0];
        img.data[k + 1] = rgb[1];
        img.data[k + 2] = rgb[2];
        img.data[k + 3] = inside ? 255 : 80;
      }
    }
    ctx.putImageData(img, 0, 0);
    setUrl(cv.toDataURL("image/png"));
  }, [grid]);
  return url;
}

function PixelGrid({ grid, geom }: { grid: HlsGrid; geom?: GeoJSON.Geometry }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const [table, setTable] = useState(false);
  const outline = useMemo(() => outlinePaths(geom, grid), [geom, grid]);
  const img = useGridImage(grid);
  const stats = useMemo(() => {
    const vals: number[] = [];
    let masked = 0;
    let insideN = 0;
    grid.values.forEach((row, r) =>
      row.forEach((v, c) => {
        if (!grid.inside[r]?.[c]) return;
        insideN++;
        if (isNum(v)) vals.push(v);
        else masked++;
      }),
    );
    vals.sort((a, b) => a - b);
    const q = (p: number) => (vals.length ? vals[Math.min(vals.length - 1, Math.floor(p * (vals.length - 1)))] : null);
    return { masked, insideN, p10: q(0.1), p50: q(0.5), p90: q(0.9) };
  }, [grid]);
  const pad = Math.max(grid.width, grid.height) * 0.01;
  return (
    <div className="fsat-grid">
      <div className="h-row">
        <p className="fs-meta">{t("fsat.grid_caption", { d: grid.date, s: grid.sensor, n: stats.insideN, m: stats.masked })}</p>
        <Button variant="ghost" size="sm" onClick={() => setTable((x) => !x)} aria-pressed={table}>
          {table ? t("common.show_chart") : t("common.show_table")}
        </Button>
      </div>
      {table ? (
        <dl className="facts">
          <div className="facts__row">
            <dt>{t("fsat.pixels_inside")}</dt>
            <dd>{fmt(stats.insideN, 0, lang)}</dd>
          </div>
          <div className="facts__row">
            <dt>{t("fsat.pixels_masked")}</dt>
            <dd>{fmt(stats.masked, 0, lang)}</dd>
          </div>
          <div className="facts__row">
            <dt>NDVI P10 · P50 · P90</dt>
            <dd>
              {fmt(stats.p10, 2, lang)} · {fmt(stats.p50, 2, lang)} · {fmt(stats.p90, 2, lang)}
            </dd>
          </div>
        </dl>
      ) : (
        <svg
          viewBox={`${-pad} ${-pad} ${grid.width + 2 * pad} ${grid.height + 2 * pad}`}
          className="svg-fluid fsat-grid__svg"
          role="img"
          aria-label={t("fsat.grid_aria", { d: grid.date, p50: fmt(stats.p50, 2, lang) })}
        >
          {img ? <image href={img} x={0} y={0} width={grid.width} height={grid.height} preserveAspectRatio="none" className="fsat-grid__img" /> : null}
          {outline.paths.map((d, i) => (
            <path key={i} d={d} fill="none" stroke="var(--navy)" strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
          ))}
        </svg>
      )}
      <div className="fsat-legend" aria-hidden={table}>
        <span className="fsat-legend__item">
          NDVI {fmt(0.1, 1, lang)} <span className="fsat-legend__bar" /> {fmt(0.9, 1, lang)}
        </span>
        <span className="fsat-legend__item">
          <span className="fsat-legend__mask" /> {t("fsat.masked")}
        </span>
        <span className="fsat-legend__item">
          <span className="fsat-legend__out" /> {t("fsat.outside")}
        </span>
      </div>
      <p className="fs-meta">
        {t("fsat.grid_note")} {outline.exact ? t("fsat.outline_exact") : t("fsat.outline_approx")}
      </p>
    </div>
  );
}

/* ---------------- ECOSTRESS ---------------- */

function EtChart({ et, period }: { et: EcostressResult; period?: { start: string; end: string } }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const [table, setTable] = useState(false);
  const all = et.observations ?? [];
  const ok = all.filter((o) => !o.cloud && !o.water && isNum(o.et_mm_day));
  const dropped = all.length - ok.length + (et.search?.n_cloudy ?? 0);
  if (!ok.length)
    return (
      <StatusBanner kind="no-observation" title={t("fsat.et_none_title")}>
        {t("fsat.et_none", { n: dropped })}
      </StatusBanner>
    );
  const W = 560;
  const H = 160;
  const pad = { l: 34, r: 10, t: 10, b: 24 };
  const ds = ok.map((o) => dateOf(o.datetime));
  const start = period ? dateOf(period.start) : new Date(Math.min(...ds.map(Number)));
  const end = period ? dateOf(period.end) : new Date(Math.max(...ds.map(Number)));
  const x = scaleTime()
    .domain([new Date(Math.min(+start, ...ds.map(Number))), new Date(Math.max(+end, ...ds.map(Number)))])
    .range([pad.l, W - pad.r]);
  const hi = Math.max(...ok.map((o) => (o.et_mm_day ?? 0) + (o.et_sd_mm_day ?? 0)), 1);
  const y = scaleLinear().domain([0, hi]).nice().range([H - pad.b, pad.t]);
  return (
    <div>
      <div className="h-row">
        <p className="fs-meta">
          {ok.length === 1 ? t("fsat.et_caption_one") : t("fsat.et_caption", { n: ok.length })}
          {dropped ? ` ${t("fsat.et_cloudy", { n: dropped })}` : ""}
        </p>
        <Button variant="ghost" size="sm" onClick={() => setTable((v) => !v)} aria-pressed={table}>
          {table ? t("common.show_chart") : t("common.show_table")}
        </Button>
      </div>
      {table ? (
        <div className="table-scroll" style={{ maxHeight: 260 }}>
          <table className="fs-table compact">
            <thead>
              <tr>
                <th scope="col">{t("fsat.when")}</th>
                <th scope="col">{t("fsat.et")} (mm/day)</th>
                <th scope="col">± SD</th>
              </tr>
            </thead>
            <tbody>
              {ok.map((o) => (
                <tr key={o.datetime}>
                  <th scope="row">{o.datetime.slice(0, 16).replace("T", " ")} UTC</th>
                  <td>{nice(o.et_mm_day, lang)}</td>
                  <td>{nice(o.et_sd_mm_day, lang)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <svg viewBox={`0 0 ${W} ${H}`} className="svg-fluid" role="img" aria-label={t("fsat.et_aria", { n: ok.length })}>
          {y.ticks(4).map((v) => (
            <g key={v}>
              <line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} stroke="var(--line)" />
              <text x={pad.l - 4} y={y(v) + 4} textAnchor="end" className="axis-t">
                {nice(v, lang)}
              </text>
            </g>
          ))}
          {x.ticks(7).map((m) => (
            <text key={+m} x={x(m)} y={H - 6} textAnchor="middle" className="axis-t">
              {m.toLocaleDateString(lang === "es" ? "es" : "en-US", { month: "short", timeZone: "UTC" })}
            </text>
          ))}
          {ok.map((o) => {
            const cx_ = x(dateOf(o.datetime));
            const v = o.et_mm_day!;
            const sd = o.et_sd_mm_day ?? 0;
            return (
              <g key={o.datetime}>
                {sd ? <line x1={cx_} x2={cx_} y1={y(Math.max(0, v - sd))} y2={y(v + sd)} stroke="var(--sky)" strokeWidth={1.5} opacity={0.6} /> : null}
                <circle cx={cx_} cy={y(v)} r={4} fill="var(--sky)" stroke="#fff" strokeWidth={1}>
                  <title>{`${o.datetime.slice(0, 10)} · ${nice(v, lang)} mm/day`}</title>
                </circle>
              </g>
            );
          })}
          <text x={pad.l} y={pad.t + 2} className="axis-t">
            mm/day
          </text>
        </svg>
      )}
    </div>
  );
}

/* ---------------- block ---------------- */

export default function FieldSatellite({ report }: { report: Report }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const fid = report.id;
  const hq = useHlsQ(fid);
  const eq = useEcostressQ(fid);
  const hls = hq.data;
  const usable = (hls?.scenes ?? []).filter((s) => !s.withheld && isNum(ndviOf(s)));
  const [sel, setSel] = useState<string | null>(null);
  const scene = sel ?? hls?.grid_scene_id ?? usable[usable.length - 1]?.id ?? null;
  const gq = useHlsGridQ(hls?.available ? fid : null, scene);
  const hlsEv = satEvidence(hls?.evidence, {
    scale: hls?.scale_note,
    start: hls?.period?.start,
    end: hls?.period?.end,
    qa: [t("fsat.qa_fmask"), t("fsat.qa_withheld")],
  });
  const et = eq.data;
  const etEv = satEvidence(et?.evidence, { scale: et?.scale_note, qa: [t("fsat.qa_et")] });

  return (
    <div className="fsat" data-tour="field-satellite">
      {/* HLS greenness */}
      <div className="h-row">
        <h4 className="h4">{t("fsat.hls_title")}</h4>
        {hlsEv ? <DataButton evidence={hlsEv} describes={t("fsat.hls_title")} /> : null}
      </div>
      {hq.isLoading ? <Skeleton height={180} label={t("fsat.loading")} /> : null}
      {hq.error ? (
        <StatusBanner kind={isNotFound(hq.error) ? "unsupported" : "error"} title={t("fsat.hls_unavail")}>
          {isNotFound(hq.error) ? t("fsat.not_on_server") : (hq.error as Error).message}
        </StatusBanner>
      ) : null}
      {hls && !hls.available ? (
        <StatusBanner kind="no-observation" title={t("fsat.hls_unavail")}>
          {hls.reason ?? t("fsat.no_reason")}
        </StatusBanner>
      ) : null}
      {hls?.available ? (
        <>
          <p className="fs-meta">
            {t("fsat.hls_help", { a: hls.period?.start ?? "—", b: hls.period?.end ?? "—", n: usable.length, m: hls.scenes?.length ?? 0 })}{" "}
            <span className="fs-chip fs-chip--nasa">{hls.scale_note ?? t("fsat.scale_hls")}</span>
          </p>
          {usable.length ? (
            <SeasonCurve hls={hls} sel={scene} onSel={setSel} />
          ) : (
            <StatusBanner kind="no-observation" title={t("fsat.all_withheld_title")}>
              {t("fsat.all_withheld")}
            </StatusBanner>
          )}
          {usable.length ? (
            <label className="field-l fsat-pick">
              <span>{t("fsat.pick_scene")}</span>
              <select value={scene ?? ""} onChange={(e) => setSel(e.target.value)}>
                {usable.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.date} · {s.sensor} · NDVI {fmt(ndviOf(s), 2, lang)} · {t("fsat.usable", { p: fmt(s.usable_pct, 0, lang) })}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {gq.isLoading ? <Skeleton height={200} /> : null}
          {gq.error ? <StatusBanner kind="no-observation">{isNotFound(gq.error) ? t("fsat.grid_unavail") : (gq.error as Error).message}</StatusBanner> : null}
          {gq.data && gq.data.available === false ? (
            <StatusBanner kind="no-observation" title={t("fsat.grid_unavail")}>
              {gq.data.reason ?? t("fsat.no_reason")}
            </StatusBanner>
          ) : null}
          {gq.data && gq.data.available !== false && gq.data.values?.length ? (
            <div className={cx(gq.isFetching && "is-busy")}>
              <PixelGrid grid={gq.data} geom={report.geometry} />
            </div>
          ) : null}
          <p className="fsat-never" role="note">
            {hls.never_claim ?? t("fsat.never_hls")}
          </p>
        </>
      ) : null}

      {/* ECOSTRESS water use */}
      <div className="h-row fsat-et-head">
        <h4 className="h4">{t("fsat.et_title")}</h4>
        {etEv ? <DataButton evidence={etEv} describes={t("fsat.et_title")} /> : null}
      </div>
      {eq.isLoading ? <Skeleton height={140} label={t("fsat.loading")} /> : null}
      {eq.error ? (
        <StatusBanner kind={isNotFound(eq.error) ? "unsupported" : "error"} title={t("fsat.et_unavail")}>
          {isNotFound(eq.error) ? t("fsat.not_on_server") : (eq.error as Error).message}
        </StatusBanner>
      ) : null}
      {et && !et.available ? (
        <StatusBanner kind="no-observation" title={t("fsat.et_unavail")}>
          {et.reason ?? t("fsat.no_reason")}
        </StatusBanner>
      ) : null}
      {et?.available ? (
        <>
          <p className="fs-meta">
            {t("fsat.et_help")} <span className="fs-chip fs-chip--nasa">{et.scale_note ?? t("fsat.scale_et")}</span>
          </p>
          <EtChart et={et} period={hls?.period} />
          <p className="fsat-never" role="note">
            {t("fsat.never_et")}
          </p>
        </>
      ) : null}
    </div>
  );
}
