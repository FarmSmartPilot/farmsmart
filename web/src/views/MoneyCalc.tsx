/* Money: revenue, costs and risk (wave U6). Up to three rotation options side by side on this field, built on the same
   simulation as the options: /money returns yield indices per real weather sequence, USDA ERS price years and cost
   lines, and hazard history; money.ts does the arithmetic in the browser so every edit recomputes at once.
   Defaults are USDA regional averages (labelled as such); the farmer can replace any number. Fields without USDA data
   (outside the US) work with the farmer's own yield, price and costs. Nothing here invents a value.
   Wave U9: the headline names what is counted (gross margin vs net profit), a "What's counted" list, the evidence
   line (seasons × price years) and how insurance-record losses avoid counting drought, heat and frost twice. */
import { useEffect, useId, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button, DataButton, SIButton, Skeleton, StatusBanner, IconDownload } from "../design";
import type { Evidence, SIRecord } from "../design";
import type { CropBudget } from "../api";
import { useReportQ } from "../api";
import { useApp, cleanBudgets } from "../store";
import { useMoneyStore, EMPTY } from "../moneyStore";
import type { FieldMoney } from "../moneyStore";
import type { FieldBudgets } from "../store";
import type { PlanCompareBody } from "../apiPlan";
import { downloadBlob } from "../planStore";
import { usePlanBody } from "./ActionPlan";
import { useMoneyQ, moneyHazards, metaStr, useMarketsQ, latestReceived, wasdePrice, stateCode } from "../apiMoney";
import type { HazardBlock, MarketsData } from "../apiMoney";
import MarketsPanel, { marketEvidence, monthLabel } from "../components/MarketsPanel";
import Outlook from "../components/Outlook";
import {
  STRESSES,
  cashFlow,
  coverPayItems,
  cropMissing,
  cropsInPlay,
  defaultPicks,
  droughtSequences,
  finite,
  hasNCredits,
  isIncomplete,
  lossCauses,
  nCreditPerYear,
  nPricePerLb,
  oddsWords,
  recordsAverage,
  resolveCrop,
  runMoney,
  startSlot,
  toCSV,
} from "../money";
import type {
  BenchItem,
  BenchLine,
  Benchmarks,
  CostCoverage,
  StormItem,
  YieldHistory,
  CropEdits,
  Declaration,
  FarmInput,
  Incomplete,
  InsuredLoss,
  MoneyCrop,
  MoneyData,
  MoneyOption,
  Num,
  OptionResult,
  PriceBasis,
  ResolvedCrop,
  ResolvedLine,
  Slot,
  CashFlow,
  CostShareItem,
  Stress,
  WeatherHazard,
} from "../money";
import { NeedField, QueryState, Reminder } from "../components/common";
import OfflineBar, { SaveOffline } from "../components/OfflineBar";
import DiseasePanel from "../components/DiseasePanel";
import { cx, toConfidence } from "../lib";
import "../plan.css";
import "../money.css";

const MAX_PICK = 3;

/* ---------------- formatting ---------------- */

function useFmt() {
  const { i18n } = useTranslation();
  const loc = i18n.language === "es" ? "es" : "en-US";
  return useMemo(() => {
    const n = (v: number, d = 0) => v.toLocaleString(loc, { maximumFractionDigits: d, minimumFractionDigits: d });
    /** "$1,234" / "−$56" (whole dollars). */
    const usd = (v: number | null | undefined, d = 0) => (finite(v) ? `${v < 0 ? "−\u2060" : ""}$${n(Math.abs(v), d)}` : "—");
    /** "+$32" / "−$12". */
    const signed = (v: number) => `${v > 0 ? "+\u2060" : v < 0 ? "−\u2060" : ""}$${n(Math.abs(v))}`;
    const pct = (p: number) => n(Math.round(p * 100));
    const num = (v: number | null | undefined, d = 0) => (finite(v) ? n(v, d) : "—");
    /** Whole-field money, to the nearest $100. */
    const r100 = (v: number) => Math.round(v / 100) * 100;
    const usd100 = (v: number | null | undefined) => (finite(v) ? usd(r100(v) === 0 ? 0 : r100(v)) : "—");
    const signed100 = (v: number) => signed(r100(v));
    return { usd, signed, pct, num, usd100, signed100, loc };
  }, [loc]);
}

const unitOf = (u: string | null | undefined) => {
  if (!u) return null;
  if (/bushel|^bu\b/i.test(u)) return "bu";
  if (/cwt|hundredweight/i.test(u)) return "cwt";
  if (/pound|^lbs?\b/i.test(u)) return "lb";
  if (/ton/i.test(u)) return "ton";
  if (/bale/i.test(u)) return "bale";
  return u.length <= 8 ? u : null;
};

/* ---------------- number input with a visible label and unit ---------------- */

function NumIn({
  label,
  value,
  onChange,
  step = "any",
  max,
  hint,
  edited,
  placeholder,
  after,
  className,
}: {
  label: string;
  value: Num;
  onChange: (v: Num) => void;
  step?: string;
  max?: number;
  hint?: ReactNode;
  edited?: boolean;
  placeholder?: string;
  after?: ReactNode;
  className?: string;
}) {
  const id = useId();
  const show = (v: Num) => (finite(v) ? String(Math.round(v * 100) / 100) : "");
  const [draft, setDraft] = useState(show(value));
  // Follow outside changes (reset, seeding) without fighting the farmer's typing.
  useEffect(() => {
    const cur = draft.trim() === "" ? null : Number(draft);
    if (cur !== value && !(cur !== null && finite(value) && Math.abs(cur - value) < 0.005)) setDraft(show(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  const bad = draft.trim() !== "" && (!Number.isFinite(Number(draft)) || Number(draft) < 0 || (max !== undefined && Number(draft) > max));
  return (
    <div className={cx("money-in", edited && "is-edited", className)}>
      <label htmlFor={id} className="money-in__label">
        {label}
      </label>
      <div className="money-in__row">
        <input
          id={id}
          type="number"
          inputMode="decimal"
          min={0}
          max={max}
          step={step}
          value={draft}
          placeholder={placeholder}
          aria-invalid={bad || undefined}
          aria-describedby={hint ? `${id}-h` : undefined}
          onChange={(e) => {
            const s = e.target.value;
            setDraft(s);
            if (s.trim() === "") return onChange(null);
            const v = Number(s);
            if (Number.isFinite(v) && v >= 0 && (max === undefined || v <= max)) onChange(v);
          }}
        />
        {after}
      </div>
      {hint ? (
        <span id={`${id}-h`} className="money-in__hint">
          {hint}
        </span>
      ) : null}
    </div>
  );
}

function Check({ label, checked, onChange, hint, disabled }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: ReactNode; disabled?: boolean }) {
  const id = useId();
  return (
    <div className="money-check">
      <input id={id} type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} aria-describedby={hint ? `${id}-h` : undefined} />
      <label htmlFor={id}>{label}</label>
      {hint ? (
        <span id={`${id}-h`} className="money-in__hint">
          {hint}
        </span>
      ) : null}
    </div>
  );
}

/* ---------------- provenance ---------------- */

function ersEvidence(crop: MoneyCrop | undefined, region: string | null | undefined, what: string): Evidence {
  const ev = (crop?.evidence ?? {}) as Record<string, unknown>;
  const s = (k: string) => (typeof ev[k] === "string" && ev[k] ? (ev[k] as string) : undefined);
  return {
    source: s("source") ?? "USDA Economic Research Service",
    product: s("product") ?? `Commodity Costs and Returns: ${what}`,
    version: s("version"),
    effective_res: s("scale") ?? (region ? `farm resource region (${region}), regional average, not your farm` : "regional average, not your farm"),
    footprint: region ? `USDA ERS farm resource region: ${region}` : undefined,
    observation_start: Array.isArray(ev.years) ? String(ev.years[0]) : undefined,
    observation_end: Array.isArray(ev.years) ? String(ev.years[ev.years.length - 1]) : undefined,
    licence: s("licence"),
    citation: s("citation"),
    url: s("url"),
    qa_flags: [
      ...(crop?.cost_years ? [`Costs: ${crop.cost_years}`] : []),
      ...(what.includes("price") && crop?.price?.source ? [`Price: ${crop.price.source}`] : []),
      ...(s("note") ? [s("note")!] : []),
    ],
    is_nasa: false,
  };
}

function plainEvidence(source: string | null | undefined, product: string, scale: string | null | undefined, extra?: Record<string, unknown>): Evidence {
  const s = (k: string) => (typeof extra?.[k] === "string" && extra[k] ? (extra[k] as string) : undefined);
  const src = source || "—";
  return {
    source: src,
    product,
    effective_res: scale ?? undefined,
    url: s("url"),
    licence: s("licence"),
    citation: s("citation"),
    is_nasa: /\bNASA\b/.test(src),
  };
}

/** SI record for the M2 county yield behind a crop's default yield (model, confidence and reasons from /money). */
function yieldSI(y: MoneyCrop["yield"], t: (k: string) => string): SIRecord {
  const src = y?.source ?? "";
  // "M2 county yield (USDA NASS county trend + season weather; all practices)" -> the inputs it names.
  const inner = src.match(/\(([^)]*)\)/)?.[1]?.split(";")[0] ?? "";
  const drivers = inner
    .split(" + ")
    .map((s) => s.trim())
    .filter(Boolean);
  const range = finite(y?.p10) && finite(y?.p90) ? `${Math.round(y!.p10!)}–${Math.round(y!.p90!)} ${y?.unit ?? ""}`.trim() : undefined;
  return {
    model_name: src.split(" (")[0] || t("yield.model"),
    kind: "si",
    version: y?.model ?? undefined,
    top_drivers: drivers.map((n, i) => ({ name: n, note: i === 0 && range ? `county range ${range}` : undefined })),
    confidence: toConfidence(y?.confidence ?? undefined),
    model_card_url: "#/sources",
  };
}

/* ---------------- range chart ---------------- */

function RangeChart({ r, lo, hi, label }: { r: OptionResult; lo: number; hi: number; label: string }) {
  const W = 240;
  const span = hi - lo || 1;
  const x = (v: number) => 8 + ((v - lo) / span) * (W - 16);
  const zero = lo < 0 && hi > 0 ? x(0) : null;
  return (
    <svg className="money-range" viewBox={`0 0 ${W} 28`} role="img" aria-label={label} preserveAspectRatio="none">
      <rect x={8} y={12} width={W - 16} height={4} rx={2} className="money-range__track" />
      {zero !== null ? <line x1={zero} x2={zero} y1={3} y2={25} className="money-range__zero" /> : null}
      <rect x={x(r.bad)} y={9} width={Math.max(2, x(r.good) - x(r.bad))} height={10} rx={5} className={cx("money-range__bar", r.typical < 0 && "is-neg")} />
      <circle cx={x(r.typical)} cy={14} r={6} className="money-range__dot" />
    </svg>
  );
}

/* ---------------- page ---------------- */

export default function MoneyCalc() {
  const { t } = useTranslation();
  const field = useApp((s) => s.field);
  const setView = useApp((s) => s.setView);
  const set = useApp((s) => s.set);
  const fid = field?.id ?? null;
  // Same body as the Compare page, without `budgets`: the defaults here stay USDA (so "Reset to USDA" is honest) and
  // the farmer's own numbers are applied by the calculator itself. Options and yield indices do not depend on budgets.
  const planBody = usePlanBody();
  const body = useMemo((): PlanCompareBody => {
    const rest: PlanCompareBody = { ...planBody };
    delete rest.budgets;
    return rest;
  }, [planBody]);
  const q = useMoneyQ(fid, body);
  const back = () => {
    set({ compareRequested: true });
    setView("compare");
  };

  if (!field) return <NeedField />;
  return (
    <div className="page page--narrowish money" data-tour="money">
      <OfflineBar />
      <header className="page__head money__head">
        <div>
          <button type="button" className="fs-link money__back" onClick={back}>
            ← {t("money.back")}
          </button>
          <h1 className="fs-h1">{t("money.title")}</h1>
          <p className="fs-meta money__sub">{t("money.sub")}</p>
        </div>
      </header>
      {q.isLoading ? (
        <section className="card-sec" aria-busy="true">
          <p className="fs-meta">{t("money.loading")}</p>
          <Skeleton lines={6} />
        </section>
      ) : q.isError ? (
        <QueryState error={q.error} onRetry={() => void q.refetch()} what={t("money.what")} />
      ) : q.data && !q.data.available ? (
        <StatusBanner kind="unsupported" title={t("money.unavailable_title")}>
          {q.data.reason ?? ""}
        </StatusBanner>
      ) : q.data ? (
        <Calculator data={q.data} fid={field.id} fieldName={field.name} fetching={q.isFetching} body={body} />
      ) : null}
      <Reminder text={t("money.support")} />
    </div>
  );
}

function Calculator({ data, fid, fieldName, fetching, body }: { data: MoneyData; fid: string; fieldName: string; fetching: boolean; body: PlanCompareBody }) {
  const { t, i18n } = useTranslation();
  const es = i18n.language === "es";
  const f = useFmt();
  const setView = useApp((s) => s.setView);
  const budgets = useApp((s) => s.budgets[fid]);
  const setBudgets = useApp((s) => s.setBudgets);
  const st = useMoneyStore((s) => s.byField[fid]) ?? EMPTY;
  const patch = useMoneyStore((s) => s.patch);
  const p = (x: Partial<FieldMoney>) => patch(fid, x);
  const options = useMemo(() => data.options ?? [], [data.options]);
  const crops = useMemo(() => data.crops ?? {}, [data.crops]);
  const nP = data.price_years?.length ?? 0;
  const hz = useMemo(() => moneyHazards(data), [data]);
  const insuredOk = !!hz.insured?.available && hz.insured.items.length > 0;
  const [msg, setMsg] = useState<string>("");

  void body; // the query key lives in the parent; kept in props so the page and its query agree on the body

  // Copy the farmer's saved numbers (My Field "own prices", or an earlier "Use these numbers") in once.
  useEffect(() => {
    if (st.seeded) return;
    const edits: Record<string, CropEdits> = { ...st.edits };
    for (const [cid, b] of Object.entries(budgets ?? {})) {
      if (!crops[cid] || edits[cid]) continue;
      const e: CropEdits = {};
      // A yield that is just the farmer's records average (My Field "Use in the ranking") stays linked to the records.
      const recAvg = recordsAverage(useApp.getState().records[fid]?.yields, cid)?.avg;
      if (finite(b.yield_bu_ac) && !(finite(recAvg) && Math.abs(Math.round(recAvg * 10) / 10 - b.yield_bu_ac) < 0.051)) e.yield = b.yield_bu_ac;
      if (finite(b.price_usd_bu)) e.price = b.price_usd_bu;
      if (finite(b.cost_usd_ac)) e.total = b.cost_usd_ac;
      if (Object.keys(e).length) edits[cid] = e;
    }
    patch(fid, { edits, seeded: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fid, st.seeded, crops]);

  const picks = useMemo(() => {
    const ok = (st.picks ?? []).filter((id) => options.some((o) => o.id === id)).slice(0, MAX_PICK);
    return ok.length ? ok : defaultPicks(options, MAX_PICK);
  }, [st.picks, options]);
  const picked = picks.map((id) => options.find((o) => o.id === id)).filter((o): o is MoneyOption => !!o);
  const baseline = options.find((o) => o.is_baseline) ?? null;
  // Crops of the picked options and the current rotation: the inputs list only these.
  const inPlay = useMemo(() => cropsInPlay([...(baseline ? [baseline] : []), ...picked]), [baseline, picked]);

  // Where the field is (for state market prices and NRCS rates) and its last crops on record (for the switch years).
  const rep = useReportQ(fid);
  const repAny = rep.data as unknown as Record<string, unknown> | undefined;
  const country = (rep.data?.place?.country_code ?? "").toUpperCase() || null;
  const usState = country === "US" ? stateCode(repAny?.statefips) : null;
  const histEdits = useApp((s) => s.historyEdits);
  const recentRec = useMemo(() => {
    const hs = [...(rep.data?.history ?? [])].sort((a, b) => a.year - b.year).map((h) => ({ year: h.year, crop: histEdits[h.year] ?? h.crop_id }));
    while (hs.length && !hs[hs.length - 1].crop) hs.pop();
    return hs;
  }, [rep.data?.history, histEdits]);
  const recent = useMemo(() => recentRec.map((h) => h.crop), [recentRec]);
  const lastRec = recentRec[recentRec.length - 1] ?? null;
  const allCrops = useMemo(() => cropsInPlay(options), [options]);
  const mk = useMarketsQ(usState, country, allCrops, !!rep.data);
  const records = useApp((s) => s.records[fid]);

  /** Market price levels per crop in the crop's planning unit (only when the units agree). */
  const market = useMemo(() => {
    const out: Record<string, { latest: ReturnType<typeof latestReceived>; wasde: ReturnType<typeof wasdePrice> }> = {};
    const d: MarketsData | undefined = mk.data;
    for (const cid of allCrops) {
      const c = d?.crops?.[cid];
      const mu = c?.unit ?? null;
      const cu = unitOf(crops[cid]?.unit);
      if (!c || (mu && cu && mu !== cu)) continue;
      out[cid] = { latest: latestReceived(c), wasde: wasdePrice(c) };
    }
    return out;
  }, [mk.data, allCrops, crops]);

  const resolved = useMemo(() => {
    const out: Record<string, ResolvedCrop> = {};
    for (const cid of allCrops) {
      const b = st.edits[cid]?.priceBasis;
      const basisPrice = b === "latest" ? (market[cid]?.latest?.usd ?? null) : b === "wasde" ? (market[cid]?.wasde?.usd ?? null) : null;
      out[cid] = resolveCrop(cid, crops[cid], st.edits[cid], nP, { basisPrice, ownYield: recordsAverage(records?.yields, cid)?.avg ?? null });
    }
    return out;
  }, [allCrops, crops, st.edits, nP, market, records?.yields]);

  const acresDefault = finite(data.field?.acres) ? data.field!.acres! : null;
  const coverDefault = finite(data.cover?.cost_usd_ac) ? data.cover!.cost_usd_ac! : null;
  const irrigated = !!data.field?.irrigated || options.some((o) => o.positions.some((x) => (x.irrigation_mm ?? []).some((v) => finite(v) && v > 0)));
  // Fertilizer N saved (legume credits × $/lb N; on by default when the API sends credits) and cover-crop payments
  // (NRCS EQIP rate for the state; off by default).
  const nCredits = hasNCredits(options);
  const nDefault = nPricePerLb(data.fertilizer_n_price);
  const nPriceUsed: Num = nCredits && st.nOn === true ? (st.nPrice !== undefined ? st.nPrice : nDefault) : null;
  const payItems = coverPayItems(data.costshare);
  const payIdx = Math.min(Math.max(0, st.payItem ?? 0), Math.max(0, payItems.length - 1));
  const payDefault = payItems[payIdx]?.usd_ac ?? null;
  const anyCover = options.some((o) => o.positions.some((x) => !!x.cover));
  const payUsed: Num = st.payOn && anyCover ? (st.payRate !== undefined ? st.payRate : payDefault) : null;
  const farm: FarmInput = {
    acres: st.acres !== undefined ? st.acres : acresDefault,
    coverCost: st.coverCost !== undefined ? st.coverCost : coverDefault,
    pumpCost: st.pumpCost ?? null,
    overhead: !!st.overhead,
    losses: st.losses ?? insuredOk,
    nPrice: nPriceUsed,
    coverPay: payUsed,
  };
  const stress: Stress = st.stress ?? "normal";
  const causes = useMemo(() => (insuredOk ? lossCauses(hz.insured!.items) : []), [insuredOk, hz.insured]);

  const run = useMemo(
    () => runMoney(data, resolved, farm, stress, causes, picks),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, resolved, farm.acres, farm.coverCost, farm.pumpCost, farm.overhead, farm.losses, farm.nPrice, farm.coverPay, stress, causes, picks.join()],
  );

  /* ---- the switch year by year (typical year), vs staying put ---- */
  const acresOk = finite(farm.acres) && farm.acres > 0 ? farm.acres : null;
  const flows = useMemo(() => {
    const out: Record<string, { cf: ReturnType<typeof cashFlow>; start: number }> = {};
    const br = baseline ? run.results[baseline.id] : undefined;
    if (!baseline || !br || isIncomplete(br)) return out;
    const bStart = startSlot(baseline, recent);
    for (const o of picked) {
      if (o.is_baseline) continue;
      const r = run.results[o.id];
      if (!r || isIncomplete(r)) continue;
      const start = startSlot(o, recent);
      const one = st.oneTime?.[o.id];
      out[o.id] = { start, cf: cashFlow({ r, opt: o, start }, { r: br, opt: baseline, start: bStart }, 5, acresOk ?? 1, finite(one) ? one : 0) };
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run, baseline, picked.map((o) => o.id).join(), recent.join(), acresOk, JSON.stringify(st.oneTime ?? {})]);

  const cropName = (cid: string) => {
    const c = crops[cid];
    return ((es && c?.name_es) || c?.name || cid.replace(/_/g, " ")).split(" (")[0];
  };
  const unit = (cid: string) => unitOf(crops[cid]?.unit) ?? (es ? "unidad" : "unit");
  // Names in plain words ("Corn, corn, then soybean, with a cereal rye cover crop"); the strategy family underneath.
  const optLabel = (o: MoneyOption) => {
    if (o.is_baseline) return t("money.current_of", { name: o.rotation_label ?? o.name });
    return (es && o.name_es) || o.name;
  };
  const optSub = (o: MoneyOption) => {
    if (o.is_baseline || o.is_custom) return null;
    return (es && o.family_name_es) || o.family_name || null;
  };

  /** "Soybean + cereal rye cover" / "Winter wheat, then soybean" for one year of a rotation. */
  const slotText = (s: Slot) => {
    const main = s.crop && s.crop !== "fallow" ? cropName(s.crop) : t("cashflow.fallow");
    const dbl = s.double ? ` ${t("cashflow.then", { c: cropName(s.double).toLowerCase() })}` : "";
    const cov = s.cover ? ` ${t("cashflow.cover", { c: cropName(s.cover).toLowerCase() })}` : "";
    return main + dbl + cov;
  };
  /** One plain sentence about paying back, in a typical year. */
  const paybackLine = (cf: CashFlow, hasOneTime: boolean) => {
    const n = cf.rows.length;
    if (cf.payback === null) return hasOneTime ? t("cashflow.never", { n }) : t("cashflow.behind", { n });
    if (cf.payback === 1 && !hasOneTime) return t("cashflow.ahead_y1");
    return t("cashflow.payback", { n: cf.payback });
  };

  const editCrop = (cid: string, e: Partial<CropEdits>) => p({ edits: { ...st.edits, [cid]: { ...(st.edits[cid] ?? {}), ...e } } });
  const resetCrop = (cid: string) => {
    const next = { ...st.edits };
    delete next[cid];
    p({ edits: next });
  };
  const hasEdits = (cid: string) => !!st.edits[cid] && Object.values(st.edits[cid]).some((v) => v !== undefined);

  /* ---- "Use these numbers in the ranking" ---- */
  const useInRanking = () => {
    const cur: FieldBudgets = { ...(useApp.getState().budgets[fid] ?? {}) };
    const used: string[] = [];
    const skipped: string[] = [];
    for (const cid of cropsInPlay(options)) {
      const c = resolved[cid];
      if (!c) continue;
      if (cropMissing(c).length) {
        if (hasEdits(cid)) skipped.push(cropName(cid));
        continue;
      }
      const usdaFull = finite(c.usda.yield) && finite(c.usda.price) && finite(c.usda.opCost);
      const e: CropBudget = {};
      // Only what differs from USDA, so untouched crops keep the year-to-year USDA prices in the ranking.
      if (!usdaFull || c.edited.yield) e.yield_bu_ac = c.yield!;
      if (!usdaFull || c.edited.price) e.price_usd_bu = c.price!;
      if (!usdaFull || c.edited.cost) e.cost_usd_ac = c.opCost!;
      if (Object.keys(e).length) {
        cur[cid] = e;
        used.push(cropName(cid));
      } else delete cur[cid];
    }
    setBudgets(fid, cleanBudgets(cur));
    setMsg(
      [used.length ? t("money.use_done", { crops: used.join(", ") }) : t("money.use_cleared"), skipped.length ? t("money.use_skipped", { crops: skipped.join(", ") }) : ""]
        .filter(Boolean)
        .join(" "),
    );
  };

  /* ---- CSV ---- */
  const csv = () => {
    const h = (k: string) => t(`money.csv_head.${k}`);
    const rows: unknown[][] = [[h("title")], [fieldName, new Date().toISOString().slice(0, 10)], [], [h("inputs")]];
    rows.push([h("crop"), h("unit"), h("yield"), h("price"), h("opcost"), h("overhead"), h("source"), ...(crops[inPlay[0]]?.costs ?? []).map((l) => l.label_en)]);
    for (const cid of inPlay) {
      const c = resolved[cid];
      const src = c.edited.yield || c.edited.price || c.edited.cost ? h("yours") : h("usda");
      rows.push([cropName(cid), unit(cid), c.yield, c.price, c.opCost, c.overhead, src, ...c.lines.map((l) => l.value)]);
    }
    rows.push([], [h("farm")]);
    rows.push([h("acres"), farm.acres], [h("cover"), farm.coverCost], [h("pump"), farm.pumpCost], [h("fixed"), farm.overhead ? 1 : 0]);
    rows.push([h("losses_on"), farm.losses ? 1 : 0], [h("stress"), t(`money.stress.${stress}`)]);
    rows.push([h("n_price"), farm.nPrice ?? null], [h("cover_pay"), farm.coverPay ?? null]);
    for (const cid of inPlay) rows.push([`${h("basis")}: ${cropName(cid)}`, t(`money.basis_short.${resolved[cid].priceBasis}`)]);
    rows.push([], [h("results")]);
    rows.push([h("option"), h("typical"), h("bad"), h("good"), h("revenue"), h("costs"), h("losses"), h("field_typical"), h("diff"), h("p_loss"), h("p_beat"), h("break_even"), h("worst")]);
    for (const o of picked) {
      const r = run.results[o.id];
      if (!r || isIncomplete(r)) {
        rows.push([optLabel(o), h("incomplete")]);
        continue;
      }
      rows.push([
        optLabel(o),
        r.typical,
        r.bad,
        r.good,
        r.revenue,
        r.cost,
        farm.losses ? r.losses : null,
        r.field?.typical ?? null,
        r.diff,
        r.pLoss,
        r.pBeat,
        r.breakEven?.pct ?? null,
        r.worst?.net ?? null,
      ]);
    }
    rows.push([], [h("cashflow"), acresOk ? h("whole_field") : h("per_acre")]);
    rows.push([h("option"), h("year"), h("crops"), h("cf_net"), h("cf_base"), h("cf_diff"), h("cf_cum")]);
    for (const o of picked) {
      const cf = flows[o.id]?.cf;
      if (!cf) continue;
      for (const y of cf.rows) rows.push([optLabel(o), y.year, slotText(y.slot), y.net, y.base, y.diff, y.cum]);
      rows.push([optLabel(o), h("payback"), cf.payback ?? h("no_payback")]);
    }
    rows.push([], [t("money.method")]);
    for (const n of data.notes ?? []) rows.push([n]);
    downloadBlob("﻿" + toCSV(rows), "text/csv;charset=utf-8", `farmsmart-money-${fid}.csv`);
  };

  /* ---- scale shared by the range charts ---- */
  const done = picked.map((o) => run.results[o.id]).filter((r): r is OptionResult => !!r && !isIncomplete(r));
  const lo = Math.min(0, ...done.map((r) => r.bad));
  const hi = Math.max(0, ...done.map((r) => r.good));

  const S = data.weather_years?.length ?? 0;
  const wy = data.weather_years ?? [];
  const dry = droughtSequences(data.season_rain_mm);
  const anyNoUsda = inPlay.some((cid) => !resolved[cid]?.hasLines);

  return (
    <>
      {fetching ? (
        <p className="fs-meta money__busy" role="status">
          {t("money.refreshing")}
        </p>
      ) : null}

      {/* 1. the answer first: one plain sentence per option */}
      <section className="card-sec money-results" aria-labelledby="money-res-h">
        <h2 id="money-res-h" className="fs-h2" data-testid="money-headline">
          {headline(data.cost_coverage, farm.overhead, es) ?? (farm.overhead ? t("u9money.head_net") : t("u9money.head_gm"))}
        </h2>
        <p className="money-lead-help">{farm.overhead ? t("u9money.head_sub_net") : t("u9money.head_sub_gm")}</p>
        <EvidenceLine data={data} />
        <Counted
          data={data}
          inPlay={inPlay}
          resolved={resolved}
          farm={farm}
          lossesOn={farm.losses && causes.length > 0}
          coverInPlay={[...(baseline ? [baseline] : []), ...picked].some((o) => o.positions.some((x) => !!x.cover))}
          cropName={cropName}
        />
        <LossNote s={S} county={metaStr(hz.insured, "county", "county_name") ?? null} on={farm.losses && causes.length > 0} insuredOk={insuredOk} />
        {stress !== "normal" ? (
          <p className="money-stress-on" role="status">
            <span>{t("money.stress_on", { s: t(`money.stress.${stress}`) })}</span>
            <Button size="sm" variant="secondary" onClick={() => p({ stress: "normal" })}>
              {t("money.stress_off")}
            </Button>
          </p>
        ) : null}
        {run.baselineIncomplete ? <p className="money-note">{t("money.base_incomplete")}</p> : null}
        {data.field?.irrigated ? <p className="money-lead-help">{t("money.irrigated_note")}</p> : null}
        {irrigated && !finite(farm.pumpCost) ? <p className="money-note">{t("money.pump_off")}</p> : null}
        <div className="money-cols" data-n={picked.length}>
          {picked.map((o) => (
            <OptionCol
              key={o.id}
              o={o}
              label={optLabel(o)}
              sub={optSub(o)}
              r={run.results[o.id]}
              lo={lo}
              hi={hi}
              acres={farm.acres}
              lossesOn={farm.losses && causes.length > 0}
              cropName={cropName}
              nSave={finite(nPriceUsed) ? nCreditPerYear(o) * nPriceUsed : 0}
              payback={flows[o.id]?.cf ? paybackLine(flows[o.id].cf!, finite(st.oneTime?.[o.id]) && st.oneTime![o.id]! > 0) : null}
            />
          ))}
        </div>
        <details className="money-more">
          <summary>{t("money.pick_show", { n: picked.length })}</summary>
          <p className="fs-meta">{t("money.pick_help")}</p>
          <fieldset className="money-pick">
            <legend className="fs-visually-hidden">{t("money.pick_h")}</legend>
            {options.map((o) => {
              const on = picks.includes(o.id);
              const full = !on && picks.length >= MAX_PICK;
              const sub = optSub(o);
              return (
                <label key={o.id} className={cx("money-pick__opt", on && "is-on", full && "is-full")}>
                  <input
                    type="checkbox"
                    checked={on}
                    disabled={full || (on && picks.length === 1)}
                    onChange={() => p({ picks: on ? picks.filter((x) => x !== o.id) : [...picks, o.id] })}
                  />
                  <span className="money-pick__text">
                    <span className="money-pick__name">{optLabel(o)}</span>
                    {sub ? <span className="fs-meta">{sub}</span> : null}
                    <Tags o={o} />
                  </span>
                </label>
              );
            })}
          </fieldset>
          {picks.length >= MAX_PICK ? <p className="fs-meta">{t("money.pick_max")}</p> : null}
        </details>
        <details className="money-more">
          <summary>{t("money.table_show")}</summary>
          <ResultsTable picked={picked} run={run} label={optLabel} />
        </details>
      </section>

      {/* 1b. the switch year by year */}
      {baseline && picked.some((o) => !o.is_baseline) ? (
        <details className="card-sec money-sec" data-tour="cashflow">
          <summary className="money-sec__sum">
            <span className="money-sec__title">{t("cashflow.title")}</span>
            <span className="money-sec__hint">{t("cashflow.hint")}</span>
          </summary>
          <div className="money-sec__body">
            <p className="money-lead-help">
              {lastRec?.crop ? t("cashflow.help", { crop: cropName(lastRec.crop).toLowerCase(), y: lastRec.year }) : t("cashflow.help_nohist")} {t("cashflow.help2")}
            </p>
            {picked
              .filter((o) => !o.is_baseline)
              .map((o) => (
                <CashFlowBlock
                  key={o.id}
                  label={optLabel(o)}
                  cf={flows[o.id]?.cf ?? null}
                  acres={acresOk}
                  oneTime={st.oneTime?.[o.id] ?? null}
                  setOneTime={(v) => p({ oneTime: { ...(st.oneTime ?? {}), [o.id]: v } })}
                  slotText={slotText}
                  sentence={flows[o.id]?.cf ? paybackLine(flows[o.id].cf!, finite(st.oneTime?.[o.id]) && st.oneTime![o.id]! > 0) : null}
                />
              ))}
          </div>
        </details>
      ) : null}

      {/* 2. test bad years */}
      <details className="card-sec money-sec">
        <summary className="money-sec__sum">
          <span className="money-sec__title">{t("money.stress_h")}</span>
          <span className="money-sec__hint">{t("money.stress_hint")}</span>
        </summary>
        <div className="money-sec__body">
          <div className="money-stress__btns" role="group" aria-label={t("money.stress_label")}>
            {STRESSES.map((s) => (
              <button key={s} type="button" className={cx("money-stress__btn", stress === s && "is-on")} aria-pressed={stress === s} onClick={() => p({ stress: s })}>
                {t(`money.stress.${s}`)}
              </button>
            ))}
          </div>
          <p className="fs-meta money-stress__note" role="status">
            {t(`money.stress_note.${stress}`, { n: dry.idx.length, s: S, mm: f.num(dry.threshold) })}
          </p>
          {insuredOk ? (
            <Check label={t("money.losses")} checked={farm.losses} onChange={(v) => p({ losses: v })} hint={t("money.losses_help")} />
          ) : (
            <p className="money-note">{t("money.losses_none")}</p>
          )}
        </div>
      </details>

      {/* 3. your numbers: field size, and per crop just yield and price */}
      <section className="card-sec" aria-labelledby="money-crops-h">
        <h2 id="money-crops-h" className="fs-h2">
          {t("money.crops_h")}
        </h2>
        <p className="money-lead-help">{t("money.crops_help")}</p>
        <div className="money-farm">
          <NumIn
            label={t("money.acres")}
            value={farm.acres}
            onChange={(v) => p({ acres: v })}
            step="1"
            max={1e6}
            edited={st.acres !== undefined && st.acres !== acresDefault}
            hint={acresDefault !== null ? t("money.acres_help", { ac: f.num(acresDefault, acresDefault < 20 ? 1 : 0), ha: f.num(data.field?.hectares, (data.field?.hectares ?? 0) < 20 ? 1 : 0) }) : t("money.acres_help_none")}
          />
        </div>
        {anyNoUsda ? <p className="money-note">{t("money.no_usda_any")}</p> : null}
        <div className="money-crops">
          {inPlay.map((cid) => (
            <CropSimple
              key={cid}
              name={cropName(cid)}
              unit={unit(cid)}
              crop={crops[cid]}
              c={resolved[cid]}
              region={data.region}
              priceYears={data.price_years ?? []}
              edit={(e) => editCrop(cid, e)}
              reset={() => resetCrop(cid)}
              hasEdits={hasEdits(cid)}
              mkt={market[cid]}
              mktData={mk.data}
              basis={st.edits[cid]?.priceBasis ?? (st.edits[cid]?.price !== undefined ? "own" : "usda")}
              rec={recordsAverage(records?.yields, cid)}
            />
          ))}
        </div>
      </section>

      {/* 3b. prices: what crops sell for now, how prices moved, what USDA expects, fertilizer */}
      <MarketsPanel state={usState} country={country} crops={allCrops} cropName={cropName} units={Object.fromEntries(allCrops.map((c) => [c, unit(c)]))} />

      {/* 4. cost details */}
      <details className="card-sec money-sec">
        <summary className="money-sec__sum">
          <span className="money-sec__title">{t("money.costs_h")}</span>
          <span className="money-sec__hint">{t("money.costs_hint")}</span>
        </summary>
        <div className="money-sec__body">
          <div className="money-crops">
            {inPlay.map((cid) => (
              <CropCosts key={cid} name={cropName(cid)} crop={crops[cid]} c={resolved[cid]} region={data.region} overheadOn={farm.overhead} edit={(e) => editCrop(cid, e)} />
            ))}
          </div>
          <div className="money-farm">
            <NumIn
              label={t("money.cover")}
              value={farm.coverCost}
              onChange={(v) => p({ coverCost: v })}
              step="1"
              max={1000}
              edited={st.coverCost !== undefined && st.coverCost !== coverDefault}
              hint={coverDefault !== null && data.cover?.source ? t("money.cover_help", { v: f.usd(coverDefault), src: data.cover.source }) : undefined}
              after={data.cover?.source ? <DataButton evidence={plainEvidence(data.cover.source.split(" (")[0], t("money.cover"), null)} describes={t("money.cover")} /> : null}
            />
            {irrigated ? (
              <NumIn label={t("money.pump")} value={farm.pumpCost} onChange={(v) => p({ pumpCost: v })} step="0.5" max={500} placeholder={t("money.ph")} hint={t("money.pump_help")} />
            ) : null}
          </div>
          <Check label={t("money.overhead")} checked={farm.overhead} onChange={(v) => p({ overhead: v })} hint={t("money.overhead_help")} />
          {nCredits ? (
            <div className="money-nsave">
              <Check label={t("money.n_on")} checked={st.nOn === true} onChange={(v) => p({ nOn: v })} hint={t("money.n_help")} />
              {!es && data.n_credit?.not_counted ? <p className="fs-meta">{data.n_credit.not_counted}</p> : null}
              {st.nOn === true ? (
                <NumIn
                  label={t("money.n_price")}
                  value={nPriceUsed}
                  onChange={(v) => p({ nPrice: v })}
                  step="0.01"
                  max={20}
                  placeholder={t("money.ph")}
                  edited={st.nPrice !== undefined && st.nPrice !== nDefault}
                  hint={
                    nDefault !== null
                      ? t("money.n_default", {
                          v: f.usd(nDefault, 2),
                          urea: finite(data.fertilizer_n_price?.urea_usd_mt) ? f.usd(data.fertilizer_n_price!.urea_usd_mt, 0) : "—",
                          month: monthLabel(data.fertilizer_n_price?.month ?? null, i18n.language),
                        })
                      : t("money.n_nodefault")
                  }
                  after={
                    nDefault !== null ? (
                      <DataButton
                        evidence={plainEvidence(data.fertilizer_n_price?.source ?? "World Bank Pink Sheet", t("money.n_product"), t("money.n_scale"), data.fertilizer_n_price as Record<string, unknown>)}
                        describes={t("money.n_price")}
                      />
                    ) : null
                  }
                />
              ) : null}
            </div>
          ) : (
            <p className="fs-meta">{t("money.n_unavail")}</p>
          )}
        </div>
      </details>

      {/* 4b. payments for practices (optional, off by default) */}
      {anyCover ? (
        <details className="card-sec money-sec" data-tour="payments">
          <summary className="money-sec__sum">
            <span className="money-sec__title">{t("money.pay_h")}</span>
            <span className="money-sec__hint">{st.payOn && finite(payUsed) ? t("money.pay_hint_on", { v: f.usd(payUsed, 2) }) : t("money.pay_hint")}</span>
          </summary>
          <div className="money-sec__body">
            <p className="money-lead-help">{t("money.pay_help")}</p>
            {payItems.length ? null : (
              <p className="money-note">
                {data.costshare && !data.costshare.available && data.costshare.reason ? t("money.pay_unavail_r", { reason: data.costshare.reason }) : t("money.pay_unavail")}
              </p>
            )}
            <Check
              label={payItems.length ? t("money.pay_on", { state: data.costshare?.state ?? "", fy: data.costshare?.fiscal_year ?? "" }) : t("money.pay_on_own")}
              checked={!!st.payOn}
              onChange={(v) => p({ payOn: v })}
              hint={(es && data.costshare?.caveat_es) || data.costshare?.caveat_en || t("money.pay_caveat")}
            />
            {st.payOn ? (
              <div className="money-farm">
                {payItems.length > 1 ? <PaySelect items={payItems} value={payIdx} onChange={(i) => p({ payItem: i, payRate: undefined })} fmt={(v) => f.usd(v, 2)} /> : null}
                {payItems.some((x) => x.hu) && (data.costshare?.hu_note_en || data.costshare?.hu_note_es) ? (
                  <p className="fs-meta">{(es && data.costshare?.hu_note_es) || data.costshare?.hu_note_en}</p>
                ) : null}
                <NumIn
                  label={t("money.pay_rate")}
                  value={payUsed}
                  onChange={(v) => p({ payRate: v })}
                  step="0.01"
                  max={1000}
                  placeholder={t("money.ph")}
                  edited={st.payRate !== undefined && st.payRate !== payDefault}
                  hint={
                    payDefault !== null
                      ? t("money.pay_default", { v: f.usd(payDefault, 2), name: `${(es && payItems[payIdx]?.name_es) || payItems[payIdx]?.name_en || ""}${payItems[payIdx]?.hu ? t("money.pay_hu") : ""}`, src: data.costshare?.source ?? "USDA NRCS" })
                      : t("money.enter_yours")
                  }
                  after={
                    payDefault !== null ? (
                      <DataButton
                        evidence={plainEvidence(
                          data.costshare?.source ?? "USDA NRCS",
                          t("money.pay_product", { state: data.costshare?.state ?? "", fy: data.costshare?.fiscal_year ?? "" }),
                          t("money.pay_scale"),
                          data.costshare as unknown as Record<string, unknown>,
                        )}
                        describes={t("money.pay_rate")}
                      />
                    ) : null
                  }
                />
              </div>
            ) : null}
          </div>
        </details>
      ) : null}

      {/* 5. what can go wrong here */}
      <Hazards hz={hz} cropName={cropName} inPlay={inPlay} fid={fid} irrigated={irrigated} />

      {/* 6. use / export */}
      <section className="card-sec" aria-labelledby="money-use-h">
        <h2 id="money-use-h" className="fs-h2">
          {t("money.use_h")}
        </h2>
        <p className="money-lead-help">{t("money.use_help")}</p>
        <div className="money-actions">
          <Button size="lg" onClick={useInRanking}>
            {t("money.use")}
          </Button>
          <Button size="lg" variant="secondary" icon={<IconDownload size={16} />} onClick={csv}>
            {t("money.csv")}
          </Button>
        </div>
        <SaveOffline fid={fid} />
        <p className="fs-meta" role="status">
          {msg}
        </p>
      </section>

      {/* 7. how it is worked out */}
      <details className="card-sec money-sec">
        <summary className="money-sec__sum">
          <span className="money-sec__title">{t("money.how_h")}</span>
        </summary>
        <div className="money-sec__body">
          <p className="fs-meta">
            {nP
              ? t("money.grid_note", { s: S, y0: wy[0] ?? "—", y1: wy[S - 1] ?? "—", p: nP, n: S * nP })
              : t("money.grid_note_noprice", { s: S, y0: wy[0] ?? "—", y1: wy[S - 1] ?? "—" })}
          </p>
          <p className="fs-meta money-method">
            {t("money.method")}{" "}
            <button type="button" className="fs-link" onClick={() => setView("sources")}>
              {t("money.method_link")}
            </button>
          </p>
          {data.notes?.length ? (
            <ul className="money-notes" aria-label={t("money.notes_h")}>
              {data.notes.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          ) : null}
        </div>
      </details>
    </>
  );
}

function Tags({ o }: { o: MoneyOption }) {
  const { t } = useTranslation();
  if (!o.is_baseline && !o.best_for_you && !o.is_custom) return null;
  return (
    <span className="money-tags">
      {o.is_baseline ? <span className="fs-chip money-tag">{t("money.tag_current")}</span> : null}
      {o.best_for_you ? <span className="fs-chip fs-chip--field money-tag">{t("money.tag_best")}</span> : null}
      {o.is_custom ? <span className="fs-chip money-tag">{t("money.tag_custom")}</span> : null}
    </span>
  );
}

/* ---------------- results as a table (on request) ---------------- */

function ResultsTable({ picked, run, label }: { picked: MoneyOption[]; run: ReturnType<typeof runMoney>; label: (o: MoneyOption) => string }) {
  const { t } = useTranslation();
  const f = useFmt();
  return (
    <div className="money-table-wrap" tabIndex={0} role="region" aria-label={t("money.table_show")}>
      <table className="fs-table money-table">
        <thead>
          <tr>
            <th scope="col">{t("money.csv_head.option")}</th>
            <th scope="col">{t("money.t_typical")}</th>
            <th scope="col">{t("money.t_bad")}</th>
            <th scope="col">{t("money.t_good")}</th>
            <th scope="col">{t("money.t_field")}</th>
            <th scope="col">{t("money.t_loss")}</th>
            <th scope="col">{t("money.t_beat")}</th>
          </tr>
        </thead>
        <tbody>
          {picked.map((o) => {
            const r = run.results[o.id];
            if (!r || isIncomplete(r))
              return (
                <tr key={o.id}>
                  <th scope="row">{label(o)}</th>
                  <td colSpan={6}>{t("money.csv_head.incomplete")}</td>
                </tr>
              );
            return (
              <tr key={o.id}>
                <th scope="row">{label(o)}</th>
                <td>{f.usd(r.typical)}</td>
                <td>{f.usd(r.bad)}</td>
                <td>{f.usd(r.good)}</td>
                <td>{r.field ? f.usd100(r.field.typical) : "—"}</td>
                <td>{Number.isFinite(r.pLoss) ? `${f.pct(r.pLoss)} %` : "—"}</td>
                <td>{r.pBeat !== null ? `${f.pct(r.pBeat)} %` : "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ---------------- one crop: yield and price (simple view) ---------------- */

function CropSimple({
  name,
  unit,
  crop,
  c,
  region,
  priceYears,
  edit,
  reset,
  hasEdits,
  mkt,
  mktData,
  basis,
  rec,
}: {
  name: string;
  unit: string;
  crop: MoneyCrop | undefined;
  c: ResolvedCrop;
  region: string | null | undefined;
  priceYears: (number | string)[];
  edit: (e: Partial<CropEdits>) => void;
  reset: () => void;
  hasEdits: boolean;
  /** Market price levels for this crop (latest month, USDA forecast), in its unit. */
  mkt?: { latest: ReturnType<typeof latestReceived>; wasde: ReturnType<typeof wasdePrice> };
  mktData?: MarketsData;
  /** The price level the farmer chose. */
  basis: PriceBasis;
  /** The farmer's own average yield from their records. */
  rec: ReturnType<typeof recordsAverage>;
}) {
  const { t, i18n } = useTranslation();
  const f = useFmt();
  const basisId = useId();
  const hasUsda = c.hasLines || finite(c.usda.price);
  const prices = (crop?.price?.values ?? []).filter(finite);
  const yrs = priceYears.filter((y) => y !== null && y !== undefined);
  const ev = (what: string) => ersEvidence(crop, region, what);
  const latest = mkt?.latest ?? null;
  const wasde = mkt?.wasde ?? null;
  const mc = mktData?.crops?.[c.id];
  const where = latest && /state average/i.test(latest.scope ?? "") ? (mktData?.state_name ?? mktData?.state ?? "") : t("markets.us");
  const yieldHint = c.yieldFromRecords && rec
    ? t("money.yield_records", { count: rec.n, span: rec.y0 === rec.y1 ? String(rec.y0) : `${rec.y0}–${rec.y1}`, was: finite(c.usda.yield) ? t(crop?.yield?.si ? "money.m2_was" : "money.usda_was", { v: f.num(c.usda.yield) }) : "" })
    : c.edited.yield
      ? finite(c.usda.yield)
        ? t(crop?.yield?.si ? "money.m2_was" : "money.usda_was", { v: f.num(c.usda.yield) })
        : undefined
      : finite(c.usda.yield)
        ? t(crop?.yield?.si ? "money.yield_default_si" : "money.yield_default")
        : t("money.enter_yours");
  const usdaRange = prices.length > 1 ? ` ${t("money.price_range", { y0: yrs[0], y1: yrs[yrs.length - 1], lo: f.usd(Math.min(...prices), 2), hi: f.usd(Math.max(...prices), 2) })}` : "";
  const priceHint =
    c.priceBasis === "latest" && latest
      ? t("money.basis_hint_latest", { month: monthLabel(latest.month, i18n.language), where })
      : c.priceBasis === "wasde" && wasde
        ? t("money.basis_hint_wasde", { my: wasde.my ?? "", date: wasde.date ?? "—" })
        : c.edited.price
          ? finite(c.usda.price)
            ? t("money.usda_was", { v: f.usd(c.usda.price, 2) })
            : undefined
          : finite(c.usda.price)
            ? t("money.price_default") + usdaRange
            : t("money.enter_yours");
  const priceButton =
    c.priceBasis === "latest" && latest ? (
      <DataButton evidence={marketEvidence(mc?.received, t("markets.ev_received"))} describes={`${name} price`} />
    ) : c.priceBasis === "wasde" && wasde ? (
      <DataButton evidence={marketEvidence(mc?.wasde, `${mc?.wasde?.report ?? "WASDE"}: ${mc?.wasde?.scope ?? ""}`)} describes={`${name} price`} />
    ) : finite(c.usda.price) && c.priceBasis === "usda" ? (
      <DataButton evidence={ev("harvest price")} describes={`${name} price`} />
    ) : null;
  const showBasis = finite(c.usda.price) || !!latest || !!wasde;
  const yr = (y: unknown) => (y === undefined || y === null ? "" : String(y));
  return (
    <fieldset className="money-crop">
      <legend className="money-crop__name">{name}</legend>
      <div className="money-crop__grid">
        <NumIn
          label={`${name}: ${t("money.yield", { u: unit })}`}
          value={c.yield}
          onChange={(v) => edit({ yield: v })}
          step="1"
          max={1e5}
          edited={c.edited.yield}
          placeholder={t("money.ph")}
          hint={yieldHint}
          after={
            c.yieldFromRecords ? null : crop?.yield?.si ? (
              <SIButton record={yieldSI(crop.yield, t)} describes={`${name} ${t("money.yield", { u: unit })}`} />
            ) : finite(c.usda.yield) ? (
              <DataButton evidence={ev("yield")} describes={`${name} yield`} />
            ) : null
          }
        />
        <NumIn
          label={`${name}: ${t("money.price", { u: unit })}`}
          value={c.price}
          onChange={(v) => edit({ price: v, priceBasis: "own" })}
          step="0.01"
          max={1e4}
          edited={c.edited.price}
          placeholder={t("money.ph")}
          hint={priceHint}
          after={priceButton}
        />
        {!c.hasLines ? (
          // No USDA cost lines for this crop here: the farmer's own operating costs are needed, so ask in the simple view.
          <NumIn
            label={`${name}: ${t("money.opcost")}`}
            value={c.opCost}
            onChange={(v) => edit({ total: v })}
            step="1"
            max={2e4}
            edited={c.edited.cost}
            placeholder={t("money.ph")}
            hint={t("money.enter_yours")}
          />
        ) : null}
      </div>
      {showBasis ? (
        <div className="money-basis">
          <label htmlFor={basisId} className="money-in__label">
            {t("money.basis_label", { crop: name })}
          </label>
          <select
            id={basisId}
            className="money-basis__sel"
            value={basis}
            onChange={(e) => {
              const b = e.target.value as PriceBasis;
              if (b === "usda") edit({ priceBasis: undefined, price: undefined });
              else if (b === "own") edit({ priceBasis: "own", price: finite(c.price) ? Math.round(c.price * 100) / 100 : null });
              else edit({ priceBasis: b });
            }}
          >
            {finite(c.usda.price) ? <option value="usda">{t("money.basis.usda", { v: f.usd(c.usda.price, 2), y0: yr(yrs[0]), y1: yr(yrs[yrs.length - 1]) })}</option> : null}
            {latest ? <option value="latest">{t("money.basis.latest", { v: f.usd(latest.usd, 2), month: monthLabel(latest.month, i18n.language, true) })}</option> : null}
            {wasde ? <option value="wasde">{t("money.basis.wasde", { v: f.usd(wasde.usd, 2), my: wasde.my ?? "" })}</option> : null}
            <option value="own">{t("money.basis.own")}</option>
          </select>
          {basis !== "usda" && basis !== "own" && c.priceBasis === "usda" ? <span className="money-in__hint">{t("money.basis_loading")}</span> : null}
          {prices.length > 1 ? <span className="money-in__hint">{t("money.basis_shape")}</span> : null}
        </div>
      ) : null}
      <YieldHistoryPanel yh={crop?.yield_history} inUse={c.yield} unit={unit} name={name} />
      {hasEdits ? (
        <div>
          <Button size="sm" variant="ghost" className="money-reset" onClick={reset} aria-label={hasUsda ? t("money.reset_aria", { crop: name }) : t("money.clear_aria", { crop: name })}>
            {hasUsda ? t("money.reset") : t("money.clear")}
          </Button>
        </div>
      ) : null}
    </fieldset>
  );
}

/* ---------------- one crop: cost details ---------------- */

function CropCosts({
  name,
  crop,
  c,
  region,
  overheadOn,
  edit,
}: {
  name: string;
  crop: MoneyCrop | undefined;
  c: ResolvedCrop;
  region: string | null | undefined;
  overheadOn: boolean;
  edit: (e: Partial<CropEdits>) => void;
}) {
  const { t, i18n } = useTranslation();
  const es = i18n.language === "es";
  const f = useFmt();
  const lineLabel = (l: ResolvedLine) => (es && l.label_es) || l.label_en;
  const setLine = (kind: "lines" | "overhead", id: string, v: Num) => {
    const cur = kind === "lines" ? c.lines : c.overheadLines;
    const map: Record<string, Num> = {};
    for (const l of cur) if (l.edited) map[l.id] = l.value;
    map[id] = v;
    // Editing a line goes back to line-by-line costs (drops a typed total).
    edit(kind === "lines" ? { lines: map, total: undefined } : { overhead: map });
  };
  const typedTotal = c.hasLines && c.edited.cost && !c.lines.some((l) => l.edited);
  return (
    <fieldset className="money-crop">
      <legend className="money-crop__name">{name}</legend>
      <p className="money-crop__scale fs-meta">
        {c.hasLines ? (region ? t("money.usda_label", { region }) : t("money.usda_label_noregion")) : t("money.no_usda", { crop: name })}
        {crop?.cost_years ? ` · ${t("money.cost_years", { y: crop.cost_years })}` : ""}
      </p>
      <NumIn
        label={`${name}: ${t("money.opcost")}`}
        value={c.opCost}
        onChange={(v) => edit({ total: v })}
        step="1"
        max={2e4}
        edited={c.edited.cost}
        placeholder={t("money.ph")}
        hint={c.edited.cost && finite(c.usda.opCost) ? t("money.usda_was", { v: f.usd(c.usda.opCost) }) : undefined}
        after={c.hasLines ? <DataButton evidence={ersEvidence(crop, region, "operating costs")} describes={`${name} costs`} /> : null}
      />
      {typedTotal ? <p className="money-note">{t("money.total_typed")}</p> : null}
      {c.hasLines && !c.edited.cost && finite(crop?.operating_total_used_in_comparison) && finite(c.usda.opCost) && Math.abs(crop!.operating_total_used_in_comparison! - c.usda.opCost) >= 0.5 ? (
        <p className="fs-meta">{t("money.lines_vs_total", { sum: f.usd(c.usda.opCost), total: f.usd(crop!.operating_total_used_in_comparison) })}</p>
      ) : null}
      {c.lines.length ? (
        <details className="money-lines">
          <summary>{t("money.lines_show", { n: c.lines.length })}</summary>
          <div className="money-lines__grid">
            {c.lines.map((l) => (
              <NumIn
                key={l.id}
                label={`${name}: ${lineLabel(l)}`}
                value={l.value}
                onChange={(v) => setLine("lines", l.id, v)}
                step="1"
                max={2e4}
                edited={l.edited}
                placeholder="0"
                hint={l.edited && finite(l.usda) ? t("money.usda_was", { v: f.usd(l.usda) }) : undefined}
              />
            ))}
          </div>
        </details>
      ) : null}
      <BenchmarkRows b={crop?.benchmarks} crop={crop} name={name} edit={edit} />
      {overheadOn && c.overheadLines.length ? (
        <details className="money-lines" open>
          <summary>{t("money.overhead_show", { n: c.overheadLines.length })}</summary>
          <div className="money-lines__grid">
            {c.overheadLines.map((l) => (
              <NumIn
                key={l.id}
                label={`${name}: ${lineLabel(l)}`}
                value={l.value}
                onChange={(v) => setLine("overhead", l.id, v)}
                step="1"
                max={2e4}
                edited={l.edited}
                placeholder="0"
                hint={l.edited && finite(l.usda) ? t("money.usda_was", { v: f.usd(l.usda) }) : undefined}
              />
            ))}
          </div>
        </details>
      ) : null}
    </fieldset>
  );
}

/* ---------------- wave U9: evidence, what's counted, losses ---------------- */

/** The headline's name from the API's cost_coverage (gross margin vs net profit), in the page language. */
function headline(cov: CostCoverage | null | undefined, overhead: boolean, es: boolean): string | null {
  const h = cov?.headline;
  if (!h) return null;
  return (overhead ? (es ? h.all_costs_es : h.all_costs_en) : es ? h.operating_only_es : h.operating_only_en) ?? null;
}
type CoverageLabel = string | { label_en?: string | null; label_es?: string | null; label?: string | null };

/** "Based on N real growing seasons (Y0–Y1) × P price years (Y0–Y1)", from the API's evidence block, else from the
    weather sequences and price years in the same response. */
function EvidenceLine({ data }: { data: MoneyData }) {
  const { t } = useTranslation();
  const ev = data.evidence ?? null;
  const wy = data.weather_years ?? [];
  const py = data.price_years ?? [];
  let text: string | null = null;
  if (ev && finite(ev.weather_seasons) && ev.weather_years?.length) {
    const nP = finite(ev.price_years) ? ev.price_years : py.length;
    const pr = ev.price_range?.length ? ev.price_range : py;
    const cv = ev.weather_years_covered?.length ? ev.weather_years_covered : ev.weather_years;
    text =
      nP > 0 && pr.length
        ? t(finite(ev.combinations) ? "u9money.evidence_full" : "u9money.evidence", {
            s: ev.weather_seasons,
            y0: ev.weather_years[0],
            y1: ev.weather_years[ev.weather_years.length - 1],
            c0: cv[0],
            c1: cv[cv.length - 1],
            p: nP,
            p0: pr[0],
            p1: pr[pr.length - 1],
            n: ev.combinations,
          })
        : t("u9money.evidence_noprice", { s: ev.weather_seasons, y0: ev.weather_years[0], y1: ev.weather_years[ev.weather_years.length - 1] });
  } else if (wy.length) {
    // Without the evidence block: the weather sequences (each starts in a real year) and the price years.
    text = py.length
      ? t("u9money.evidence_seq", { s: wy.length, y0: wy[0], y1: wy[wy.length - 1], p: py.length, p0: py[0], p1: py[py.length - 1] })
      : t("u9money.evidence_noprice", { s: wy.length, y0: wy[0], y1: wy[wy.length - 1] });
  }
  if (!text) return null;
  return (
    <p className="money-evidence" data-testid="money-evidence">
      {text}
    </p>
  );
}

/** The cost items behind the headline: operating lines, fixed costs when on, the farm extras, and what USDA's lines
    leave out (cost_coverage from /money when present, else the cost line labels of the crops in play). */
function Counted({
  data,
  inPlay,
  resolved,
  farm,
  lossesOn,
  coverInPlay,
  cropName,
}: {
  data: MoneyData;
  inPlay: string[];
  resolved: Record<string, ResolvedCrop>;
  farm: FarmInput;
  lossesOn: boolean;
  coverInPlay: boolean;
  cropName: (c: string) => string;
}) {
  const { t, i18n } = useTranslation();
  const es = i18n.language === "es";
  const f = useFmt();
  const cov = data.cost_coverage ?? null;
  const lab = (x: CoverageLabel) => (typeof x === "string" ? x : (es && x.label_es) || x.label_en || x.label || "");
  const fromCov = (xs: CoverageLabel[] | null | undefined) => (xs ?? []).map(lab).filter(Boolean);
  /** Labels of the lines that carry a cost in at least one crop in play (first-seen order). */
  const fromLines = (kind: "lines" | "overheadLines") => {
    const out: string[] = [];
    for (const cid of inPlay) {
      for (const l of resolved[cid]?.[kind] ?? []) {
        const name = (es && l.label_es) || l.label_en;
        if (finite(l.value) && l.value > 0 && name && !out.includes(name)) out.push(name);
      }
    }
    return out;
  };
  const anyLines = inPlay.some((cid) => resolved[cid]?.hasLines);
  const ownTotals = inPlay.filter((cid) => !resolved[cid]?.hasLines || (resolved[cid]?.edited.cost && !resolved[cid]?.lines.some((l) => l.edited))).map(cropName);
  const covList = (en?: string[], esl?: string[]) => (es && esl?.length ? esl : en) ?? [];
  const covOp = covList(cov?.operating, cov?.operating_es);
  const covOh = covList(cov?.overhead, cov?.overhead_es);
  const op = covOp.length ? fromCov(covOp) : anyLines ? fromLines("lines") : [];
  const oh = farm.overhead ? (covOh.length ? fromCov(covOh) : fromLines("overheadLines")) : [];
  const covNotes = covList(cov?.notes, cov?.notes_es);
  const extra: string[] = [];
  if (coverInPlay && finite(farm.coverCost) && farm.coverCost > 0) extra.push(t("u9money.counted_cover", { v: f.usd(farm.coverCost) }));
  if (finite(farm.pumpCost) && farm.pumpCost > 0) extra.push(t("u9money.counted_pump", { v: f.usd(farm.pumpCost, 2) }));
  if (finite(farm.nPrice) && farm.nPrice > 0) extra.push(t("u9money.counted_n"));
  if (finite(farm.coverPay) && farm.coverPay > 0) extra.push(t("u9money.counted_pay", { v: f.usd(farm.coverPay, 2) }));
  if (lossesOn) extra.push(t("u9money.counted_loss"));
  const notIn = fromCov(covList(cov?.not_included, cov?.not_included_es));
  const n = op.length + oh.length + extra.length + (ownTotals.length ? 1 : 0);
  if (!n && !notIn.length) return null;
  return (
    <details className="money-more money-counted" data-testid="money-counted">
      <summary>{t("u9money.counted_sum", { n })}</summary>
      <div className="money-counted__cols">
        {op.length || ownTotals.length ? (
          <div>
            <h3 className="money-counted__h">{t("u9money.counted_op")}</h3>
            <ul>
              {op.map((x) => (
                <li key={x}>{x}</li>
              ))}
              {ownTotals.length ? (
                <li>
                  {ownTotals.join(", ")}: {t("u9money.counted_your")}
                </li>
              ) : null}
            </ul>
          </div>
        ) : null}
        <div>
          <h3 className="money-counted__h">{t("u9money.counted_oh")}</h3>
          {farm.overhead ? (
            <ul>
              {oh.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          ) : (
            <p className="fs-meta">{t("u9money.counted_oh_off")}</p>
          )}
        </div>
        {extra.length ? (
          <div>
            <h3 className="money-counted__h">{t("u9money.counted_extra")}</h3>
            <ul>
              {extra.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          </div>
        ) : null}
        {notIn.length ? (
          <div>
            <h3 className="money-counted__h">{t("u9money.counted_not")}</h3>
            <ul>
              {notIn.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
      {covNotes.map((x) => (
        <p key={x} className="fs-meta">
          {x}
        </p>
      ))}
      {anyLines ? <p className="fs-meta">{t("u9money.counted_src")}</p> : null}
    </details>
  );
}

/** How losses are counted: drought, heat and in-season frost are in the simulated years (the yield model runs through
    them, and money.ts lossCauses() drops those insurance causes); the other causes come from insurance records, each
    drawn on its own with its chance per year. */
function LossNote({ s, county, on, insuredOk }: { s: number; county: string | null; on: boolean; insuredOk: boolean }) {
  const { t } = useTranslation();
  return (
    <details className="money-more money-lossnote" data-testid="money-lossnote">
      <summary>{t("u9money.loss_h")}</summary>
      <p className="fs-meta">{t("u9money.loss_p1", { s })}</p>
      {insuredOk ? (
        <>
          <p className="fs-meta">{t("u9money.loss_p2", { county: county ?? t("u9money.this_county") })}</p>
          <p className="fs-meta">{t("u9money.loss_p3")}</p>
          {!on ? <p className="fs-meta">{t("u9money.loss_off")}</p> : null}
        </>
      ) : (
        <p className="fs-meta">{t("u9money.loss_none")}</p>
      )}
    </details>
  );
}

/* ---------------- one option's column ---------------- */

function OptionCol({
  o,
  label,
  sub,
  r,
  lo,
  hi,
  acres,
  lossesOn,
  cropName,
  nSave,
  payback,
}: {
  o: MoneyOption;
  label: string;
  sub: string | null;
  r: OptionResult | Incomplete | undefined;
  lo: number;
  hi: number;
  acres: Num;
  lossesOn: boolean;
  cropName: (c: string) => string;
  /** Fertilizer N saved, $/ac a year (0 = none or not counted). */
  nSave: number;
  /** "Pays back by year 3 in a typical year" (null for the current rotation or when it cannot be worked out). */
  payback: string | null;
}) {
  const { t } = useTranslation();
  const f = useFmt();
  const head = (
    <header className="money-col__head">
      <h3 className="money-col__name">{label}</h3>
      {sub ? <p className="fs-meta">{sub}</p> : null}
      <Tags o={o} />
    </header>
  );
  if (!r) return null;
  if (isIncomplete(r)) {
    const list = r.missing.map((m) => `${cropName(m.crop)} (${m.what.map((w) => t(`money.miss.${w}`)).join(", ")})`).join("; ");
    return (
      <article className="money-col is-incomplete" data-option={o.id}>
        {head}
        <p className="money-note">{t("money.incomplete", { list })}</p>
      </article>
    );
  }
  const ac = finite(acres) && acres > 0 ? acres : null;
  const odds = oddsWords(r.pLoss);
  const lossLine =
    odds.kind === "none"
      ? t("money.loss.none", { n: r.nSamples * r.nYears })
      : odds.kind === "one_in"
        ? t("money.loss.one_in", { n: odds.n })
        : odds.kind === "k_in_10"
          ? t("money.loss.k_in_10", { k: odds.k })
          : t(`money.loss.${odds.kind}`);
  let beatLine: string | null = null;
  if (r.pBeat !== null) {
    const k = Math.round(r.pBeat * 10);
    beatLine = k <= 0 ? t("money.beat_never") : k >= 10 ? t("money.beat_always") : t("money.beat", { k });
  }
  // Difference from today: whole field when the size is known, else per acre.
  let diff: string | null = null;
  if (r.diff !== null) {
    const v = ac && r.diffField !== null ? r.diffField : r.diff;
    const tiny = ac ? Math.abs(Math.round(v / 100)) === 0 : Math.abs(Math.round(v)) === 0;
    diff = tiny ? t("money.vs_same") : t("money.vs_today", { v: ac ? f.signed100(v) : f.signed(Math.round(v)) });
  }
  let beLine: string | null = null;
  if (r.breakEven) {
    const be = r.breakEven;
    if (be.pct !== null) beLine = Math.abs(be.pct) < 0.5 ? t("money.be_zero") : be.pct > 0 ? t("money.be_up", { pct: f.num(be.pct) }) : t("money.be_down", { pct: f.num(-be.pct) });
    else if (be.always) beLine = t(`money.be_${be.always}`);
  }
  return (
    <article className="money-col" data-option={o.id}>
      {head}
      <p className="money-lead">
        <span className="money-lead__lab">{t("money.typical")}:</span>{" "}
        <strong className={cx("money-lead__big", r.typical < 0 && "is-neg")} data-k="typical">
          {t("money.about", { v: ac && r.field ? f.usd100(r.field.typical) : f.usd(r.typical) })}
        </strong>{" "}
        <span className="money-lead__on">{ac ? t("money.on_acres", { ac: f.num(ac, ac < 20 ? 1 : 0) }) : t("money.per_ac_yr")}</span>
        {diff ? (
          <>
            {" "}
            <span className={cx("money-lead__diff", r.diff! > 0 && "is-pos", r.diff! < 0 && "is-neg")}>({diff})</span>
          </>
        ) : null}
      </p>
      <p className="money-lead2">
        {t("money.bad_line")}:{" "}
        <strong className={cx(r.bad < 0 && "is-neg")} data-k="bad">
          {t("money.about", { v: ac && r.field ? f.usd100(r.field.bad) : f.usd(r.bad) })}
        </strong>
      </p>
      {ac ? <p className="fs-meta money-perac">{t("money.per_acre_line", { typ: f.usd(r.typical), bad: f.usd(r.bad) })}</p> : null}
      {payback ? (
        <p className="money-payback" data-k="payback">
          {payback}
        </p>
      ) : null}
      <RangeChart r={r} lo={lo} hi={hi} label={t("money.range_aria", { bad: f.usd(r.bad), typ: f.usd(r.typical), good: f.usd(r.good) })} />
      <ul className="money-risk" aria-label={t("money.risk_h")}>
        <li>{lossLine}</li>
        {beatLine ? <li>{beatLine}</li> : null}
        {r.worst ? <li>{t("money.worst", { y: r.worst.weatherYear ?? "—", v: f.usd(r.worst.net) })}</li> : null}
      </ul>
      {nSave >= 0.5 ? (
        <p className="fs-meta money-nline" data-k="nsave">
          {t("money.n_saved", { v: f.usd(nSave) })}
        </p>
      ) : null}
      {r.pay >= 0.5 ? (
        <p className="fs-meta money-nline" data-k="pay">
          {t("money.pay_line", { v: f.usd(r.pay) })}
        </p>
      ) : null}
      <details className="money-col__more">
        <summary>{t("money.more_numbers")}</summary>
        <dl className="money-col__bg">
          <div>
            <dt>{t("money.good_line")}</dt>
            <dd data-k="good">{f.usd(r.good)}</dd>
          </div>
          <div>
            <dt>{t("money.revenue")}</dt>
            <dd>{f.usd(r.revenue)}</dd>
          </div>
          <div>
            <dt>{t("money.costs")}</dt>
            <dd>{f.usd(r.cost)}</dd>
          </div>
          {lossesOn ? (
            <div>
              <dt>{t("money.losses_line")}</dt>
              <dd>{f.usd(r.losses)}</dd>
            </div>
          ) : null}
        </dl>
        <p className="fs-meta">{t("money.per_acre_note")}</p>
        {r.field ? <p className="fs-meta">{t("money.field_good", { v: f.usd100(r.field.good) })}</p> : null}
        {beLine ? <p className="fs-meta">{beLine}</p> : null}
        {r.worst && r.worst.priceYear !== null ? <p className="fs-meta">{t("money.worst_detail", { wy: r.worst.weatherYear ?? "—", py: r.worst.priceYear })}</p> : null}
        <p className="fs-meta">{t("money.pctl_note", { n: r.nSamples })}</p>
      </details>
    </article>
  );
}

/* ---------------- "What can go wrong here" ---------------- */

function Hazards({ hz, cropName, inPlay, fid, irrigated }: { hz: ReturnType<typeof moneyHazards>; cropName: (c: string) => string; inPlay: string[]; fid: string; irrigated: boolean }) {
  const { t, i18n } = useTranslation();
  const es = i18n.language === "es";
  const f = useFmt();
  const head = (
    <h2 id="money-haz-h" className="fs-h2">
      {t("money.haz_h")}
    </h2>
  );
  if (!hz.weather && !hz.insured && !hz.declarations && !hz.storms) {
    return (
      <section className="card-sec" aria-labelledby="money-haz-h">
        {head}
        <Outlook fid={fid} as="group" />
        <DiseasePanel fid={fid} variant="money" irrigated={irrigated} crops={inPlay} />
        <p className="money-note">{t("money.haz_missing")}</p>
      </section>
    );
  }
  const county = metaStr(hz.insured, "county", "county_name") ?? metaStr(hz.declarations, "county", "county_name") ?? t("money.this_county");
  const status = (b: HazardBlock<unknown> | null) =>
    b && !b.available ? <p className="money-note">{t("money.haz_unavail", { reason: b.reason ?? "—" })}</p> : b && !b.items.length ? <p className="fs-meta">{t("money.haz_none")}</p> : null;
  const last = (y: unknown) => (y !== null && y !== undefined && y !== "" ? ` ${t("money.haz_last", { y: String(y).slice(0, 4) })}` : "");
  const insured = (hz.insured?.items ?? [])
    .filter((x: InsuredLoss) => x && finite(x.years_hit) && (x.years_hit ?? 0) > 0 && (!inPlay.length || inPlay.includes(x.crop)))
    // Biggest average yearly loss first (chance × loss when it hit).
    .sort((a, b) => (b.mean_loss_usd_ac ?? (b.p ?? 0) * (b.avg_loss_usd_ac_when_hit ?? 0)) - (a.mean_loss_usd_ac ?? (a.p ?? 0) * (a.avg_loss_usd_ac_when_hit ?? 0)));
  const TOP = 5;
  const usdLoss = (v: number | null | undefined) => (finite(v) && Math.abs(v) < 10 ? f.usd(v, 2) : f.usd(v));
  const insuredLi = (x: InsuredLoss, i: number) => (
    <li key={`${x.crop}-${x.cause}-${i}`}>
      <span>
        {t("money.haz_insured_line", {
          cause: (es && x.cause_es) || x.cause,
          crop: cropName(x.crop).toLowerCase(),
          hit: f.num(x.years_hit),
          n: f.num(x.years),
          v: usdLoss(x.avg_loss_usd_ac_when_hit),
        })}
        {last(x.last)}.{x.in_simulation ? <span className="fs-meta"> {t("money.haz_insured_sim")}</span> : null}
      </span>
    </li>
  );
  const nYearsDecl = Number(metaStr(hz.declarations, "n_years"));
  const rmaEv = plainEvidence(metaStr(hz.insured, "source") ?? "USDA Risk Management Agency", metaStr(hz.insured, "product") ?? "Cause of Loss historical data", t("money.scale_county"), hz.insured?.meta);
  const femaEv = plainEvidence(metaStr(hz.declarations, "source") ?? "FEMA", metaStr(hz.declarations, "product") ?? "OpenFEMA Disaster Declarations Summaries", t("money.scale_county"), hz.declarations?.meta);
  return (
    <section className="card-sec money-haz" aria-labelledby="money-haz-h">
      {head}
      <p className="money-lead-help">{t("money.haz_intro")}</p>
      <Outlook fid={fid} as="group" />

      {hz.weather ? (
        <div className="money-haz__group">
          <h3 className="money-haz__h">{t("money.haz_weather_h")}</h3>
          {status(hz.weather)}
          <ul className="money-haz__list">
            {hz.weather.items
              .filter((w: WeatherHazard) => w && finite(w.years_hit))
              .map((w: WeatherHazard) => (
                <li key={w.id}>
                  <span>
                    {t("money.haz_weather_line", { label: (es && w.label_es) || w.label_en, hit: f.num(w.years_hit), n: f.num(w.years) })}
                    {last(w.last)}.{w.scale ? <span className="fs-meta"> {w.scale}</span> : null}
                  </span>
                  <DataButton evidence={plainEvidence(w.source ?? "NASA POWER", (es && w.label_es) || w.label_en, w.scale)} describes={w.label_en} />
                </li>
              ))}
          </ul>
        </div>
      ) : null}

      {hz.insured ? (
        <div className="money-haz__group">
          <h3 className="money-haz__h">
            {t("money.haz_insured_h", { county })} <DataButton evidence={rmaEv} describes={t("money.haz_insured_h", { county })} />
          </h3>
          {status(hz.insured)}
          <ul className="money-haz__list">{insured.slice(0, TOP).map(insuredLi)}</ul>
          {insured.length > TOP ? (
            <details className="money-more">
              <summary>{t("money.haz_more", { n: insured.length - TOP })}</summary>
              <ul className="money-haz__list">{insured.slice(TOP).map((x, i) => insuredLi(x, i + TOP))}</ul>
            </details>
          ) : null}
        </div>
      ) : null}

      {hz.storms ? <Storms b={hz.storms} county={county} /> : null}

      <DiseasePanel fid={fid} variant="money" irrigated={irrigated} crops={inPlay} />

      {hz.declarations ? (
        <div className="money-haz__group">
          <h3 className="money-haz__h">
            {t("money.haz_decl_h", { county })} <DataButton evidence={femaEv} describes={t("money.haz_decl_h", { county })} />
          </h3>
          {status(hz.declarations)}
          <ul className="money-haz__list">
            {hz.declarations.items.map((d: Declaration, i) => {
              const type = (es && d.label_es) || d.label_en || d.type || d.incident_type || "—";
              const n = d.count ?? d.n ?? d.years_hit ?? null;
              const yrs = typeof d.years === "number" ? d.years : finite(nYearsDecl) ? nYearsDecl : null;
              return (
                <li key={`${type}-${i}`}>
                  <span>
                    {t("money.haz_decl_line", { type, n: f.num(n) })}
                    {finite(yrs) ? ` ${t("money.haz_decl_years", { years: yrs })}` : ""}
                    {last(d.last)}.
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

/* ---------------- wave U9: real yields, published budgets, storms ---------------- */

/** USDA NASS yields for the county (or the state when the county is withheld), with the straight-line trend and the
    yield in use for comparison. Context only: a county average is never the field's yield. */
function YieldHistoryPanel({ yh, inUse, unit, name }: { yh: YieldHistory | null | undefined; inUse: Num; unit: string; name: string }) {
  const { t, i18n } = useTranslation();
  const es = i18n.language === "es";
  const f = useFmt();
  if (!yh) return null;
  if (!yh.available) return yh.reason ? <p className="fs-meta">{t("u9money.yh_unavail", { crop: name, reason: yh.reason })}</p> : null;
  const ys = yh.years ?? [];
  const vs = yh.values ?? [];
  const pts = ys.map((y, i) => ({ y, v: vs[i] })).filter((p): p is { y: number; v: number } => finite(p.v));
  if (pts.length < 2) return null;
  const tr = yh.trend;
  const y1 = pts[pts.length - 1].y;
  const trendLast = tr ? (finite(tr.value_last_year) ? tr.value_last_year : tr.intercept + tr.slope_per_yr * y1) : null;
  const where = yh.level === "state" ? (yh.state ?? t("u9money.yh_state")) : (yh.county ?? t("u9money.this_county"));
  const u = yh.unit ?? unit;
  // Chart: bars for the published years, a line for the trend, a dashed line for the yield in use.
  const W = 300;
  const H = 90;
  const top = Math.max(...pts.map((p) => p.v), finite(inUse) ? inUse : 0, finite(trendLast) ? trendLast : 0) * 1.08;
  const x = (y: number) => ((y - pts[0].y) / Math.max(1, y1 - pts[0].y)) * (W - 8) + 4;
  const yv = (v: number) => H - (v / top) * H;
  const bw = Math.max(2, (W - 8) / pts.length - 2);
  const ev: Evidence = {
    source: "USDA NASS",
    product: `Quick Stats ${yh.level === "state" ? "state" : "county"} yields (${name})`,
    observation_start: String(pts[0].y),
    observation_end: String(y1),
    effective_res: yh.scale ?? "county average, not your field",
    citation: yh.citation,
    url: yh.url,
    qa_flags: [yh.note ?? "", tr?.basis ?? ""].filter(Boolean),
    is_nasa: false,
  };
  const diff = finite(inUse) && finite(trendLast) && trendLast > 0 ? (inUse - trendLast) / trendLast : null;
  return (
    <details className="money-yh" data-testid="money-yh">
      <summary>
        {t(yh.level === "state" ? "u9money.yh_sum_state" : "u9money.yh_sum", { where, y0: pts[0].y, y1 })}
        {finite(trendLast) ? ` · ${t("u9money.yh_trend_short", { v: f.num(trendLast, 1), u, y: y1 })}` : ""}
      </summary>
      <div className="money-yh__body">
        {yh.level === "state" && yh.fallback_reason ? <p className="money-note">{yh.fallback_reason}</p> : null}
        <svg className="money-yh__chart" viewBox={`0 0 ${W} ${H + 2}`} role="img" aria-label={t("u9money.yh_aria", { crop: name, where, y0: pts[0].y, y1 })} preserveAspectRatio="none">
          {pts.map((p) => (
            <rect key={p.y} x={x(p.y) - bw / 2} y={yv(p.v)} width={bw} height={H - yv(p.v)} className="money-yh__bar">
              <title>{`${p.y}: ${f.num(p.v, 1)} ${u}`}</title>
            </rect>
          ))}
          {tr ? <line x1={x(pts[0].y)} x2={x(y1)} y1={yv(tr.intercept + tr.slope_per_yr * pts[0].y)} y2={yv(tr.intercept + tr.slope_per_yr * y1)} className="money-yh__trend" /> : null}
          {finite(inUse) ? <line x1={0} x2={W} y1={yv(inUse)} y2={yv(inUse)} className="money-yh__use" /> : null}
        </svg>
        <p className="fs-meta money-yh__legend">
          <span className="money-yh__key money-yh__key--bar" /> {t("u9money.yh_key_bars", { where })} <span className="money-yh__key money-yh__key--trend" /> {t("u9money.yh_key_trend")}{" "}
          {finite(inUse) ? (
            <>
              <span className="money-yh__key money-yh__key--use" /> {t("u9money.yh_key_use")}
            </>
          ) : null}
          <DataButton evidence={ev} describes={t("u9money.yh_aria", { crop: name, where, y0: pts[0].y, y1 })} />
        </p>
        {tr && finite(trendLast) ? (
          <p className="fs-meta">{t("u9money.yh_trend", { v: f.num(trendLast, 1), u, y: y1, slope: f.num(tr.slope_per_yr, 1) })}</p>
        ) : null}
        {diff !== null ? (
          <p className="fs-meta" data-k="yh-compare">
            {Math.abs(diff) < 0.02
              ? t("u9money.yh_use_same", { v: f.num(inUse, 1), u })
              : t(diff > 0 ? "u9money.yh_use_above" : "u9money.yh_use_below", { v: f.num(inUse, 1), u, pct: f.pct(Math.abs(diff)), y: y1 })}
          </p>
        ) : null}
        {finite(yh.detrended_cv) ? <p className="fs-meta">{t("u9money.yh_cv", { pct: f.pct(yh.detrended_cv) })}</p> : null}
        <p className="fs-meta">{es ? t("u9money.yh_scale") : yh.scale ? `${yh.scale[0].toUpperCase()}${yh.scale.slice(1)}.` : t("u9money.yh_scale")}</p>
      </div>
    </details>
  );
}

/** Published budgets for the field's state (Iowa: ISU A1-20). "Use these numbers" fills this crop's cost lines by id.
    Lines ISU does not have are set to 0 (ISU's machinery fuel-and-repairs line holds both of USDA's); ISU lines with no
    calculator line of their own (crop insurance, and "other" where the crop has no such line) are kept in a typed
    operating total, so the total equals ISU's operating cost. The yield assumption is shown, not applied. */
function BenchmarkRows({ b, crop, name, edit }: { b: Benchmarks | null | undefined; crop: MoneyCrop | undefined; name: string; edit: (e: Partial<CropEdits>) => void }) {
  const { t, i18n } = useTranslation();
  const es = i18n.language === "es";
  const f = useFmt();
  const [msg, setMsg] = useState("");
  if (!b) return null;
  if (!b.available || !b.items?.length) return b.reason ? <p className="fs-meta">{b.reason}</p> : null;
  const opIds = new Set((crop?.costs ?? []).map((l) => l.id));
  const ohIds = new Set((crop?.overhead ?? []).map((l) => l.id));
  const lineName = (id: string) => {
    const l = [...(crop?.costs ?? []), ...(crop?.overhead ?? [])].find((x) => x.id === id);
    return l ? ((es && l.label_es) || l.label_en).split(" (")[0].toLowerCase() : id === "crop_insurance" ? t("u9money.bm_crop_ins") : id.replace(/_/g, " ");
  };
  const apply = (it: BenchItem) => {
    const lines: Record<string, Num> = {};
    const overhead: Record<string, Num> = {};
    const extraOp: BenchLine[] = [];
    let opTotal = 0;
    for (const l of it.calculator_lines ?? []) {
      if (!finite(l.usd_ac)) continue;
      if (l.group === "overhead") {
        const id = ohIds.has(l.id) ? l.id : ohIds.has("general") ? "general" : null;
        if (id) overhead[id] = Math.round(((overhead[id] ?? 0) + l.usd_ac) * 100) / 100;
      } else {
        opTotal += l.usd_ac;
        if (opIds.has(l.id)) lines[l.id] = Math.round(((lines[l.id] ?? 0) + l.usd_ac) * 100) / 100;
        else extraOp.push(l);
      }
    }
    for (const id of opIds) if (lines[id] === undefined) lines[id] = 0;
    for (const id of ohIds) if (overhead[id] === undefined) overhead[id] = 0;
    // ISU's own operating total when the regrouped lines add up to it (they differ only by rounding).
    const total = finite(it.operating_usd_ac) && Math.abs(it.operating_usd_ac - opTotal) < 0.05 ? it.operating_usd_ac : Math.round(opTotal * 100) / 100;
    edit({ lines, overhead, total: extraOp.length ? total : undefined });
    const label = (es && it.label_es) || it.label;
    setMsg(
      [
        t("u9money.bm_done", { label, op: f.usd(total, 2), fixed: f.usd(it.fixed_usd_ac, 2) }),
        extraOp.length ? t("u9money.bm_extra", { list: extraOp.map((l) => `${lineName(l.id)}${l.from?.length && l.id !== "crop_insurance" ? ` (${l.from.join(", ").toLowerCase()})` : ""} ${f.usd(l.usd_ac, 2)}`).join(", ") }) : "",
        t("u9money.bm_yield", { v: f.num(it.yield_assumption, 0), u: it.unit ?? "" }),
      ]
        .filter(Boolean)
        .join(" "),
    );
  };
  const ev: Evidence = {
    source: b.source ?? "Iowa State University Extension and Outreach",
    product: b.product ?? "Estimated Costs of Crop Production in Iowa",
    url: b.url,
    citation: b.citation,
    effective_res: (es && b.scale_es) || b.scale,
    qa_flags: [b.operating_definition ?? "", b.fixed_definition ?? ""].filter(Boolean),
    is_nasa: false,
  };
  return (
    <div className="money-bm" data-testid="money-bm">
      <p className="money-counted__h">
        {t("u9money.bm_h", { crop: name, year: b.year ?? "" })} <DataButton evidence={ev} describes={t("u9money.bm_h", { crop: name, year: b.year ?? "" })} />
      </p>
      <div className="money-bm__wrap">
        <table className="money-bm__table">
          <thead>
            <tr>
              <th scope="col">{t("u9money.bm_budget")}</th>
              <th scope="col">{t("u9money.bm_yield_col")}</th>
              <th scope="col">{t("u9money.bm_op")}</th>
              <th scope="col">{t("u9money.bm_total")}</th>
              <th scope="col">
                <span className="fs-visually-hidden">{t("u9money.bm_use")}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {b.items.map((it) => (
              <tr key={it.id}>
                <th scope="row">{(es && it.label_es) || it.label}</th>
                <td>
                  {f.num(it.yield_assumption, 0)} {it.unit ?? ""}
                </td>
                <td>{f.usd(it.operating_usd_ac, 2)}</td>
                <td>{f.usd(it.total_usd_ac, 2)}</td>
                <td>
                  <Button size="sm" variant="secondary" onClick={() => apply(it)} aria-label={t("u9money.bm_use_aria", { label: (es && it.label_es) || it.label })}>
                    {t("u9money.bm_use")}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="fs-meta">{(es && b.items[0]?.notes_es) || b.items[0]?.notes}</p>
      <p className="fs-meta">{t("u9money.bm_how")}</p>
      {msg ? (
        <p className="money-note" role="status" data-k="bm-msg">
          {msg}
        </p>
      ) : null}
    </div>
  );
}

/** NOAA NCEI Storm Events for the county: years with a reported event and reported crop damage. Reported events, not
    the field's losses; drought, heat and frost are already in the simulated weather years. */
function Storms({ b, county }: { b: HazardBlock<StormItem>; county: string }) {
  const { t, i18n } = useTranslation();
  const es = i18n.language === "es";
  const f = useFmt();
  const m = b.meta as Record<string, unknown>;
  const yrs = Array.isArray(m.years) ? (m.years as number[]) : [];
  const head = t("u9money.storm_h", { county, y0: yrs[0] ?? "—", y1: yrs[yrs.length - 1] ?? "—" });
  if (!b.available) {
    return (
      <div className="money-haz__group">
        <h3 className="money-haz__h">{head}</h3>
        <p className="money-note">{t("money.haz_unavail", { reason: b.reason ?? "—" })}</p>
      </div>
    );
  }
  const SIM = /drought|frost|freeze|heat/i;
  const items = [...b.items].filter((x) => finite(x.years_with_event) && x.years_with_event! > 0).sort((a, c) => (c.years_with_event ?? 0) - (a.years_with_event ?? 0));
  const ev: Evidence = {
    source: typeof m.source === "string" ? m.source : "NOAA NCEI Storm Events Database",
    product: t("u9money.storm_product"),
    observation_start: yrs[0] ? String(yrs[0]) : undefined,
    observation_end: yrs[1] ? String(yrs[yrs.length - 1]) : undefined,
    effective_res: t("money.scale_county"),
    url: typeof m.url === "string" ? m.url : undefined,
    citation: typeof m.citation === "string" ? m.citation : undefined,
    licence: typeof m.licence === "string" ? m.licence : undefined,
    qa_flags: [typeof m.note === "string" ? m.note : ""].filter(Boolean),
    is_nasa: false,
  };
  const li = (x: StormItem) => (
    <li key={x.type}>
      <span>
        {t("u9money.storm_line", { label: (es && x.label_es) || x.label_en, hit: x.years_with_event, n: x.years ?? "—" })}
        {finite(x.last) ? ` ${t("money.haz_last", { y: x.last })}` : ""}.{" "}
        {finite(x.crop_damage_usd_total) && x.crop_damage_usd_total > 0
          ? t("u9money.storm_damage", { v: f.usd(x.crop_damage_usd_total), n: x.crop_damage_years ?? "—" })
          : t("u9money.storm_nodamage")}
        {SIM.test(x.type) ? <span className="fs-meta"> {t("money.haz_insured_sim")}</span> : null}
      </span>
    </li>
  );
  const TOP = 6;
  return (
    <div className="money-haz__group" data-testid="money-storms">
      <h3 className="money-haz__h">
        {head} <DataButton evidence={ev} describes={head} />
      </h3>
      {items.length ? <ul className="money-haz__list">{items.slice(0, TOP).map(li)}</ul> : <p className="fs-meta">{t("money.haz_none")}</p>}
      {items.length > TOP ? (
        <details className="money-more">
          <summary>{t("money.haz_more", { n: items.length - TOP })}</summary>
          <ul className="money-haz__list">{items.slice(TOP).map(li)}</ul>
        </details>
      ) : null}
      <p className="fs-meta">{t("u9money.storm_note")}</p>
    </div>
  );
}

/* ---------------- the switch, year by year ---------------- */

function CashFlowBlock({
  label,
  cf,
  acres,
  oneTime,
  setOneTime,
  slotText,
  sentence,
}: {
  label: string;
  cf: CashFlow | null;
  acres: number | null;
  oneTime: Num;
  setOneTime: (v: Num) => void;
  slotText: (s: Slot) => string;
  sentence: string | null;
}) {
  const { t } = useTranslation();
  const f = useFmt();
  const hId = useId();
  const money = (v: number) => (acres ? f.usd100(v) : f.usd(v));
  const signed = (v: number) => (acres ? f.signed100(v) : f.signed(Math.round(v)));
  return (
    <section className="cf" aria-labelledby={hId}>
      <h3 id={hId} className="cf__h">
        {label}
      </h3>
      {cf ? (
        <>
          <p className="money-payback" data-k="cf-sentence">
            {sentence}
          </p>
          <NumIn
            className="cf__one"
            label={acres ? t("cashflow.one_time") : t("cashflow.one_time_ac")}
            value={oneTime}
            onChange={setOneTime}
            step="1"
            max={1e8}
            placeholder={t("money.ph")}
            hint={t("cashflow.one_time_help")}
          />
          <div className="money-table-wrap" tabIndex={0} role="region" aria-label={t("cashflow.table_aria", { name: label })}>
            <table className="fs-table money-table cf__table">
              <caption className="fs-visually-hidden">{t("cashflow.table_aria", { name: label })}</caption>
              <thead>
                <tr>
                  <th scope="col">{t("cashflow.c_year")}</th>
                  <th scope="col">{t("cashflow.c_crops")}</th>
                  <th scope="col">{t("cashflow.c_net")}</th>
                  <th scope="col">{t("cashflow.c_base")}</th>
                  <th scope="col">{t("cashflow.c_diff")}</th>
                  <th scope="col">{t("cashflow.c_cum")}</th>
                </tr>
              </thead>
              <tbody>
                {cf.rows.map((y) => (
                  <tr key={y.year}>
                    <th scope="row">{t("cashflow.year_n", { n: y.year })}</th>
                    <td data-label={t("cashflow.c_crops")}>{slotText(y.slot)}</td>
                    <td data-label={t("cashflow.c_net")}>{money(y.net)}</td>
                    <td data-label={t("cashflow.c_base")}>{money(y.base)}</td>
                    <td data-label={t("cashflow.c_diff")} className={cx(y.diff > 0 && "is-pos", y.diff < 0 && "is-neg")}>
                      {signed(y.diff)}
                    </td>
                    <td data-label={t("cashflow.c_cum")} className={cx(y.cum < 0 && "is-neg")}>
                      {signed(y.cum)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="fs-meta">{acres ? t("cashflow.note_field", { ac: f.num(acres, acres < 20 ? 1 : 0) }) : t("cashflow.note_acre")}</p>
        </>
      ) : (
        <p className="money-note">{t("cashflow.none")}</p>
      )}
    </section>
  );
}

/* ---------------- which NRCS cover-crop rate ---------------- */

function PaySelect({ items, value, onChange, fmt }: { items: (CostShareItem & { hu?: boolean })[]; value: number; onChange: (i: number) => void; fmt: (v: number) => string }) {
  const { t, i18n } = useTranslation();
  const id = useId();
  const es = i18n.language === "es";
  return (
    <div className="money-in">
      <label htmlFor={id} className="money-in__label">
        {t("money.pay_which")}
      </label>
      <select id={id} className="money-basis__sel" value={value} onChange={(e) => onChange(Number(e.target.value))}>
        {items.map((x, i) => (
          <option key={i} value={i}>
            {`${(es && x.name_es) || x.name_en || x.practice || "—"}${x.hu ? t("money.pay_hu") : ""}: ${finite(x.usd_ac) ? fmt(x.usd_ac) : "—"}/ac`}
          </option>
        ))}
      </select>
    </div>
  );
}
