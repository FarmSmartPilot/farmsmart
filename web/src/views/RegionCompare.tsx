/* Region Compare: two pilot regions side by side (climate normals, soil, current rotation, best alternative,
   data coverage) and a computed "why they differ" list. Every value is read from the two API reports and compares. */
import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button, ConfidenceChip, SIButton, Skeleton, StatusBanner } from "../design";
import { useCompareQ, usePilotsQ, useReportQ } from "../api";
import type { CompareResult, Pilot, Report } from "../api";
import { useApp, DEFAULT_FARM } from "../store";
import type { Farm, Units } from "../store";
import { Ev, QueryState, Reminder } from "../components/common";
import { openPilot } from "../fieldFlow";
import { cardSI, cx, fmtU, isNum, nice, toConfidence } from "../lib";
import type { UnitKind } from "../lib";
import type { TFunction } from "i18next";
import { familyName } from "./Options";

interface Metric {
  key: string;
  group: "climate" | "soil";
  label: string;
  unit: UnitKind | "days_yr" | "pct_plain" | "none";
  get: (r: Report) => number | null | undefined;
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

function metrics(t: (k: string) => string): Metric[] {
  return [
    { key: "tmean", group: "climate", label: t("clim.tmean"), unit: "c", get: (r) => r.climate?.normals.tmean },
    { key: "precip", group: "climate", label: t("clim.precip"), unit: "mm", get: (r) => r.climate?.normals.precip },
    { key: "et0", group: "climate", label: t("clim.et0"), unit: "mm", get: (r) => r.climate?.normals.et0 },
    { key: "water_balance", group: "climate", label: t("clim.water_balance"), unit: "mm", get: (r) => r.climate?.normals.water_balance },
    { key: "gdd10", group: "climate", label: t("clim.gdd10"), unit: "none", get: (r) => r.climate?.normals.gdd10 },
    { key: "frost_free", group: "climate", label: t("ar.frost_free"), unit: "days_yr", get: (r) => r.climate?.frost.frost_free_days_median },
    { key: "hot_days", group: "climate", label: t("clim.hot_days"), unit: "days_yr", get: (r) => r.climate?.normals.hot_days },
    { key: "heavy_rain_days", group: "climate", label: t("clim.heavy_rain_days"), unit: "days_yr", get: (r) => r.climate?.normals.heavy_rain_days },
    { key: "windy_days", group: "climate", label: t("clim.windy_days"), unit: "days_yr", get: (r) => r.climate?.normals.windy_days },
    { key: "om", group: "soil", label: t("region.om"), unit: "pct_plain", get: (r) => num(r.soil?.properties?.om_r) },
    { key: "clay", group: "soil", label: t("region.clay"), unit: "pct_plain", get: (r) => num(r.soil?.properties?.claytotal_r) },
    { key: "sand", group: "soil", label: t("region.sand"), unit: "pct_plain", get: (r) => num(r.soil?.properties?.sandtotal_r) },
    {
      key: "aws",
      group: "soil",
      label: t("region.aws"),
      unit: "mm",
      get: (r) => {
        const v = num(r.soil?.properties?.aws100_cm);
        return v === null ? null : v * 10;
      },
    },
    { key: "ph", group: "soil", label: t("region.ph"), unit: "none", get: (r) => num(r.soil?.properties?.ph1to1h2o_r) },
    { key: "slope", group: "soil", label: t("ar.slope_mean"), unit: "pct_plain", get: (r) => r.terrain?.slope_mean_pct },
  ];
}

function fmtM(v: number | null | undefined, m: Metric, units: Units, lang: string, t: (k: string) => string) {
  if (!isNum(v)) return "—";
  if (m.unit === "days_yr") return `${nice(v, lang)} ${t("units.days_yr")}`;
  if (m.unit === "pct_plain") return `${nice(v, lang)}%`;
  if (m.unit === "none") return nice(v, lang);
  return fmtU(v, m.unit, units, lang);
}

/** Farm body the Field Studio sends for this pilot (so both share the cached compare). */
function pilotBody(p: Pilot | undefined) {
  if (!p?.farm) return {};
  const farm = p.farm as Partial<Farm>;
  return { farm: { ...DEFAULT_FARM, ...farm, ...(farm.water === "irrigated" ? { water: "irrigated" as const } : {}) } };
}

function useSide(p: Pilot | undefined) {
  const id = p?.field_id ?? null;
  const report = useReportQ(id);
  const body = useMemo(() => pilotBody(p), [p]);
  const cmp = useCompareQ(id, body, !!id && p?.supported !== false);
  return { report, cmp };
}

function bestAlt(c: CompareResult | undefined) {
  if (!c?.supported) return undefined;
  return c.cards.find((k) => k.best_for_you && !k.is_baseline) ?? [...c.all_cards].filter((k) => !k.is_baseline).sort((a, b) => a.rank - b.rank)[0];
}

interface Diff {
  group: "climate" | "soil" | "constraint";
  label: string;
  text: string;
  score: number;
}

/** Largest differences, scored by relative size (|a − b| / mean |a|,|b|); categorical differences score 1. */
function whyDiffer(
  a: { p: Pilot; r?: Report; c?: CompareResult },
  b: { p: Pilot; r?: Report; c?: CompareResult },
  ms: Metric[],
  units: Units,
  lang: string,
  t: TFunction,
): Diff[] {
  const out: Diff[] = [];
  const an = a.p.label;
  const bn = b.p.label;
  if (a.r && b.r) {
    for (const m of ms) {
      const va = m.get(a.r);
      const vb = m.get(b.r);
      if (!isNum(va) || !isNum(vb)) continue;
      const den = (Math.abs(va) + Math.abs(vb)) / 2;
      if (den < 1e-9) continue;
      const rel = Math.abs(va - vb) / den;
      if (rel < 0.1) continue;
      out.push({ group: m.group, label: m.label, text: `${an}: ${fmtM(va, m, units, lang, t)} · ${bn}: ${fmtM(vb, m, units, lang, t)}`, score: rel });
    }
    const ta = (a.c?.facts?.texture_class as string | undefined) ?? (a.r.soil?.properties?.texture_class as string | undefined);
    const tb = (b.c?.facts?.texture_class as string | undefined) ?? (b.r.soil?.properties?.texture_class as string | undefined);
    if (ta && tb && ta !== tb) out.push({ group: "soil", label: t("ar.texture"), text: `${an}: ${ta} · ${bn}: ${tb}`, score: 0.5 });
    const da = a.r.soil?.drainage_class ?? (a.r.soil?.properties?.drainagecl as string | undefined);
    const db = b.r.soil?.drainage_class ?? (b.r.soil?.properties?.drainagecl as string | undefined);
    if (da && db && da !== db) out.push({ group: "soil", label: t("ar.drainage"), text: `${an}: ${da} · ${bn}: ${db}`, score: 0.5 });
    const ra = a.r.region?.label;
    const rb = b.r.region?.label;
    if (ra && rb && ra !== rb) out.push({ group: "constraint", label: t("region.calendar"), text: `${an}: ${ra} · ${bn}: ${rb}`, score: 0.6 });
  }
  if (a.c && b.c) {
    const wa = a.c.farm_used?.water;
    const wb = b.c.farm_used?.water;
    if (wa && wb && wa !== wb) {
      const w = (x: string, mm?: number) => (x === "irrigated" ? `${t("myfield.irrigated")}${isNum(mm) && mm > 0 ? ` (${fmtU(mm, "mm", units, lang)})` : ""}` : t("myfield.rainfed"));
      out.push({ group: "constraint", label: t("myfield.water"), text: `${an}: ${w(wa, a.c.farm_used?.irrigation_mm)} · ${bn}: ${w(wb, b.c.farm_used?.irrigation_mm)}`, score: 1 });
    }
    const exA = new Set((a.c.what_fits?.excluded ?? []).map((x) => x.name));
    const exB = new Set((b.c.what_fits?.excluded ?? []).map((x) => x.name));
    const onlyA = [...exA].filter((x) => !exB.has(x));
    const onlyB = [...exB].filter((x) => !exA.has(x));
    if (onlyA.length) out.push({ group: "constraint", label: t("region.excluded_in", { place: an }), text: onlyA.join(", "), score: 0.4 + onlyA.length * 0.05 });
    if (onlyB.length) out.push({ group: "constraint", label: t("region.excluded_in", { place: bn }), text: onlyB.join(", "), score: 0.4 + onlyB.length * 0.05 });
    const fa = a.c.what_fits?.feasible.length;
    const fb = b.c.what_fits?.feasible.length;
    if (isNum(fa) && isNum(fb) && fa !== fb)
      out.push({ group: "constraint", label: t("region.n_fit"), text: `${an}: ${fa} · ${bn}: ${fb}`, score: Math.abs(fa - fb) / Math.max(fa, fb) });
  }
  return out.sort((x, y) => y.score - x.score).slice(0, 10);
}

function Col({ p, side, ms, peer }: { p: Pilot; side: ReturnType<typeof useSide>; ms: Metric[]; peer?: Report }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const units = useApp((s) => s.units);
  const r = side.report.data;
  const c = side.cmp.data;
  const best = bestAlt(c);
  const base = c?.all_cards.find((k) => k.is_baseline);
  const row = (label: ReactNode, value: ReactNode, dot?: ReactNode, hi?: boolean) => (
    <div key={typeof label === "string" ? label : undefined} className={cx("rc-row", hi && "is-hi")}>
      <dt>{label}</dt>
      <dd>
        {value}
        {dot}
      </dd>
    </div>
  );
  const ev = (id?: string) => (id && r?.evidence?.[id] ? <Ev ev={r.evidence[id]} /> : null);
  const big = (m: Metric) => {
    if (!r || !peer) return false;
    const a = m.get(r);
    const b = m.get(peer);
    if (!isNum(a) || !isNum(b)) return false;
    const den = (Math.abs(a) + Math.abs(b)) / 2;
    return den > 0 && Math.abs(a - b) / den >= 0.25;
  };
  return (
    <article className="rc-col card-sec" aria-labelledby={`rc-${p.key}`}>
      <header className="rc-col__head">
        <h2 id={`rc-${p.key}`} className="fs-h2">
          {p.label}
        </h2>
        {r ? (
          <p className="fs-meta">
            {[r.place?.county, r.place?.state, r.place?.country].filter(Boolean).join(", ")}
            {r.region?.label ? ` · ${r.region.label}` : ""} · {fmtU(r.area_ha, "ha", units, lang)}
          </p>
        ) : null}
      </header>
      {side.report.isLoading ? <Skeleton lines={8} /> : null}
      {side.report.error ? <QueryState error={side.report.error} what={p.label} onRetry={() => void side.report.refetch()} /> : null}
      {r ? (
        <>
          <div className="h-row">
            <h3 className="h4">{t("ar.normals", { a: r.climate?.normal_period?.[0] ?? "", b: r.climate?.normal_period?.[1] ?? "" })}</h3>
            {ev(r.climate?.evidence_id)}
          </div>
          {r.climate ? (
            <>
              <dl className="rc-dl">{ms.filter((m) => m.group === "climate").map((m) => row(m.label, fmtM(m.get(r), m, units, lang, t), null, big(m)))}</dl>
              <p className="fs-meta">{t("ar.regional_note")}</p>
            </>
          ) : (
            <StatusBanner kind="no-observation">{t("ar.no_climate")}</StatusBanner>
          )}
          <div className="h-row">
            <h3 className="h4">{t("ar.soil")}</h3>
            {ev(r.soil?.evidence_id)}
          </div>
          {r.soil?.available ? (
            <dl className="rc-dl">
              {row(t("ar.texture"), String((c?.facts?.texture_class as string | undefined) ?? r.soil.properties?.texture_class ?? "—"))}
              {row(t("ar.drainage"), String(r.soil.properties?.drainagecl ?? r.soil.drainage_class ?? "—"))}
              {ms.filter((m) => m.group === "soil").map((m) => row(m.label, fmtM(m.get(r), m, units, lang, t), null, big(m)))}
            </dl>
          ) : (
            <StatusBanner kind="no-observation">{r.soil?.reason ?? t("ar.no_soil")}</StatusBanner>
          )}
        </>
      ) : null}
      <h3 className="h4">{t("region.rotations")}</h3>
      {side.cmp.isLoading ? <Skeleton lines={3} /> : null}
      {side.cmp.error ? <QueryState error={side.cmp.error} what={t("options.overline")} onRetry={() => void side.cmp.refetch()} /> : null}
      {c && !c.supported ? <StatusBanner kind="unsupported">{c.reason}</StatusBanner> : null}
      {c?.supported ? (
        <dl className="rc-dl">
          {row(t("region.baseline"), base?.rotation_label ?? c.baseline_detection?.label ?? "—", ev(r?.crop_history?.evidence_id))}
          {best
            ? row(
                t("region.best_alt"),
                <span className="rc-best">
                  <strong>{best.name}</strong>
                  <span className="fs-chip">{familyName(best, lang)}</span>
                  <span className="fs-meta">{t("region.match", { m: best.match })}</span>
                  <ConfidenceChip confidence={toConfidence(best.confidence)} />
                </span>,
                <SIButton record={cardSI(best, c, t)} describes={best.name} />,
              )
            : row(t("region.best_alt"), t("region.none"))}
          {row(t("region.simulated"), t("region.sim_n", { n: c.candidates_simulated ?? c.all_cards.length, y: c.weather_years?.n ?? "" }))}
        </dl>
      ) : null}
      {r?.coverage?.length ? (
        <>
          <h3 className="h4">{t("ar.coverage")}</h3>
          <ul className="rc-cov">
            {r.coverage.map((cv) => (
              <li key={cv.layer}>
                <span className={cx("fs-chip", cv.status === "supported" ? "fs-chip--field" : cv.status === "partial" ? "fs-chip--wheat" : "fs-chip--alert")}>
                  {cv.status === "supported" ? "●" : cv.status === "partial" ? "◆" : "△"} {t(`region.cov.${cv.status}`, { defaultValue: cv.status })}
                </span>
                <span>
                  <strong>{cv.layer}</strong>
                  {cv.note ? <span className="fs-meta"> · {cv.note}</span> : null}
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      <Button variant="secondary" size="sm" onClick={() => openPilot(p)}>
        {t("region.open")}
      </Button>
    </article>
  );
}

export default function RegionCompare() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const units = useApp((s) => s.units);
  const pilots = usePilotsQ();
  const list = useMemo(() => (pilots.data?.pilots ?? []).filter((p) => p.field_id), [pilots.data]);
  const [aKey, setA] = useState<string | null>(null);
  const [bKey, setB] = useState<string | null>(null);
  const a = list.find((p) => p.key === aKey) ?? list[0];
  const b = list.find((p) => p.key === bKey) ?? list.find((p) => p.key !== a?.key && !p.key?.startsWith(a?.key ?? "\u0000")) ?? list[1];
  const sa = useSide(a);
  const sb = useSide(b);
  const ms = useMemo(() => metrics(t), [t]);
  const diffs = useMemo(
    () => (a && b && a.key !== b.key ? whyDiffer({ p: a, r: sa.report.data, c: sa.cmp.data }, { p: b, r: sb.report.data, c: sb.cmp.data }, ms, units, lang, t) : []),
    [a, b, sa.report.data, sa.cmp.data, sb.report.data, sb.cmp.data, ms, units, lang, t],
  );
  const loading = sa.report.isLoading || sb.report.isLoading || sa.cmp.isLoading || sb.cmp.isLoading;

  const picker = (id: string, label: string, value: Pilot | undefined, onChange: (k: string) => void) => (
    <label className="rc-pick">
      <span className="fs-overline">{label}</span>
      <select id={id} value={value?.key ?? ""} onChange={(e) => onChange(e.target.value)}>
        {list.map((p) => (
          <option key={p.key} value={p.key}>
            {p.label}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <div className="page" data-tour="region">
      <header className="page__head">
        <div>
          <h1 className="fs-h1">{t("region.title")}</h1>
          <p className="fs-meta">{t("region.sub")}</p>
        </div>
      </header>
      {pilots.isLoading ? <Skeleton height={60} /> : null}
      {pilots.error ? <QueryState error={pilots.error} what={t("region.title")} onRetry={() => void pilots.refetch()} /> : null}
      {list.length >= 2 && a && b ? (
        <>
          <div className="rc-picks">
            {picker("rc-a", t("region.pick_a"), a, setA)}
            {picker("rc-b", t("region.pick_b"), b, setB)}
          </div>
          {a.key === b.key ? <StatusBanner kind="partial">{t("region.same")}</StatusBanner> : null}
          <section className="card-sec rc-why" aria-labelledby="rc-why-h">
            <h2 id="rc-why-h" className="fs-h2">
              {t("region.why")}
            </h2>
            <p className="fs-meta">{t("region.why_help")}</p>
            {loading && !diffs.length ? <Skeleton lines={4} /> : null}
            {!loading && !diffs.length && a.key !== b.key ? <p className="fs-meta">{t("region.why_none")}</p> : null}
            {diffs.length ? (
              <ol className="rc-why__list">
                {diffs.map((d) => (
                  <li key={d.label}>
                    <span className={cx("fs-chip", d.group === "climate" ? "fs-chip--nasa" : d.group === "soil" ? "fs-chip--soil" : "fs-chip--outline")}>{t(`region.g_${d.group}`)}</span>
                    <strong>{d.label}</strong>
                    <span>{d.text}</span>
                  </li>
                ))}
              </ol>
            ) : null}
          </section>
          <div className="rc-grid">
            <Col p={a} side={sa} ms={ms} peer={sb.report.data} />
            <Col p={b} side={sb} ms={ms} peer={sa.report.data} />
          </div>
        </>
      ) : !pilots.isLoading && !pilots.error ? (
        <StatusBanner kind="no-observation">{t("region.need_two")}</StatusBanner>
      ) : null}
      <Reminder />
    </div>
  );
}
