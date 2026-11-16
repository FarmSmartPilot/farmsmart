/* Your whole farm (wave U9): every field the farmer added, worked out together. Each field's money comes from the same
   building blocks and inputs as its money page (POST /money, useMoneyStore), its soil and water from /compare, and
   its last crops from the field report. farm.ts lines the fields up on the same real weather and price years, adds
   them up, and searches for the plan that suits the whole farm best. Nothing here invents a value: a field that is
   still being worked out, or lacks numbers, is left out of the totals and said so. */
import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { useQueries } from "@tanstack/react-query";
import { Button, DataButton, SIButton, SegmentedToggle, Skeleton, StatusBanner, IconMap, IconClose, IconCheck, IconSprout, useMediaQuery } from "../design";
import type { Evidence, SIRecord } from "../design";
import { api, ApiError } from "../api";
import type { CompareResult, Report } from "../api";
import { apiMoney, moneyHazards, latestReceived, wasdePrice, stateCode } from "../apiMoney";
import type { MarketsData } from "../apiMoney";
import type { PlanCompareBody } from "../apiPlan";
import { useApp, cleanBudgets, cleanSoilTest, PRIORITY_IDS } from "../store";
import { usePlan } from "../planStore";
import { useMoneyStore, EMPTY } from "../moneyStore";
import { useFarm, MAX_FARM_FIELDS } from "../farmStore";
import type { FarmField } from "../farmStore";
import { coverPayItems, cropsInPlay, finite, nPricePerLb, oddsWords, STRESSES } from "../money";
import type { MoneyData, MoneyOption, Stress } from "../money";
import {
  RISKS,
  SOIL_KEYS,
  currentAssignment,
  farmMetrics,
  fieldCorrelation,
  fieldInputs,
  optimizeFarm,
  planAssignment,
  prepareFarm,
  unitOf,
} from "../farm";
import type { Assignment, FarmCtx, FarmMetrics, FieldModel, FieldPart, FieldRun, OptimizeResult, Risk, SoilKey, SoilWater } from "../farm";
import { loadSampleFarm, SAMPLE_FARM } from "../sampleFarm";
import { band, farmScore, fieldScore, scoreBoosters, WEIGHTS, weightPcts } from "../score";
import type { Score, ScoreBand, Weights } from "../score";
import { useCropName } from "./ActionPlan";
import { Reminder, useToast } from "../components/common";
import { cropColor, cropInk, cx, fmtU, plainRotation } from "../lib";
import type { UnitKind } from "../lib";
import "../plan.css";
import "../farm.css";

/* ---------------- formatting ---------------- */

function useFmt() {
  const { i18n } = useTranslation();
  const loc = i18n.language === "es" ? "es" : "en-US";
  return useMemo(() => {
    const n = (v: number, d = 0) => v.toLocaleString(loc, { maximumFractionDigits: d, minimumFractionDigits: d });
    const usd = (v: number | null | undefined) => (finite(v) ? `${v < 0 ? "−⁠" : ""}$${n(Math.abs(Math.round(v)))}` : "—");
    /** Whole-farm / whole-field money to the nearest $100. */
    const usd100 = (v: number | null | undefined) => {
      if (!finite(v)) return "—";
      const r = Math.round(v / 100) * 100;
      return usd(r === 0 ? 0 : r);
    };
    const signed100 = (v: number | null | undefined) => {
      if (!finite(v)) return "—";
      const r = Math.round(v / 100) * 100;
      return r === 0 ? "$0" : `${r > 0 ? "+⁠" : "−⁠"}$${n(Math.abs(r))}`;
    };
    const signed = (v: number, d = 0) => (Math.abs(v) < 0.5 * 10 ** -d ? n(0, d) : `${v > 0 ? "+⁠" : "−⁠"}${n(Math.abs(v), d)}`);
    const pct = (p: number) => `${n(Math.round(p * 100))} %`;
    const num = (v: number, d = 0) => n(v, d);
    return { usd, usd100, signed100, signed, pct, num, loc };
  }, [loc]);
}

/* ---------------- data ---------------- */

/** The body this field's money and compare runs use: its own farm settings and soil test; `{}` when untouched. */
function useBodies(fields: FarmField[]) {
  const priorities = useApp((s) => s.priorities);
  const cur = useApp((s) => s.field?.id ?? null);
  const curFarm = useApp((s) => s.farm);
  const curTouched = useApp((s) => s.farmTouched);
  const baseline = useApp((s) => s.baseline);
  const records = useApp((s) => s.records);
  const budgets = useApp((s) => s.budgets);
  const plans = usePlan((s) => s.plans);
  return useMemo(() => {
    const money: Record<string, PlanCompareBody> = {};
    const compare: Record<string, PlanCompareBody> = {};
    for (const f of fields) {
      // Same as the money page (usePlanBody without budgets), without a hypothetical weather scenario.
      const b: PlanCompareBody = {};
      if (priorities.join() !== PRIORITY_IDS.join()) b.priorities = priorities;
      const isCur = f.id === cur;
      const farm = isCur ? (curTouched ? curFarm : null) : f.farm && Object.keys(f.farm).length ? f.farm : null;
      if (farm) b.farm = farm;
      const soil = cleanSoilTest(records[f.id]?.soil_test);
      if (soil) b.farm = { ...(farm ?? {}), soil_test: soil };
      if (isCur && baseline) b.baseline = baseline;
      const tested = plans[f.id]?.tested;
      if (tested?.length) b.custom = tested.map((c) => ({ name: c.name, sequence: c.sequence }));
      money[f.id] = b;
      const bud = cleanBudgets(budgets[f.id]);
      compare[f.id] = bud ? { ...b, budgets: bud } : b;
    }
    return { money, compare };
  }, [fields, priorities, cur, curFarm, curTouched, baseline, records, budgets, plans]);
}

const noRetry = (n: number, e: unknown) => !(e instanceof ApiError && (e.status === 404 || e.status === 405 || e.status === 422)) && n < 1;

async function getMarkets(state: string | null, country: string | null, crops: string[]): Promise<MarketsData> {
  const q = new URLSearchParams();
  if (state) q.set("state", state);
  if (country) q.set("country", country);
  if (crops.length) q.set("crops", crops.slice(0, 20).join(","));
  const r = await fetch(`/api/markets?${q.toString()}`);
  if (!r.ok) throw new ApiError(r.status, r.statusText);
  return r.json() as Promise<MarketsData>;
}

type Status = "loading" | "ready" | "error" | "unavailable";

interface FarmData {
  models: FieldModel[];
  status: Record<string, { s: Status; reason?: string | null }>;
  money: Record<string, MoneyData | undefined>;
  reports: Record<string, Report | undefined>;
  retry: (id: string) => void;
}

function useFarmData(fields: FarmField[]): FarmData {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bodies = useBodies(fields);
  const moneyQs = useQueries({
    queries: fields.map((f) => ({
      queryKey: ["money", f.id, bodies.money[f.id]],
      queryFn: () => apiMoney.money(f.id, bodies.money[f.id]),
      staleTime: 5 * 60_000,
      retry: noRetry,
    })),
  });
  const reportQs = useQueries({
    queries: fields.map((f) => ({ queryKey: ["report", f.id], queryFn: () => api.report(f.id), staleTime: 5 * 60_000, retry: 1 })),
  });
  const compareQs = useQueries({
    queries: fields.map((f) => ({ queryKey: ["compare", f.id, bodies.compare[f.id]], queryFn: () => api.compare(f.id, bodies.compare[f.id]), staleTime: 5 * 60_000, retry: 1 })),
  });
  const byField = useMoneyStore((s) => s.byField);
  const budgets = useApp((s) => s.budgets);
  const records = useApp((s) => s.records);
  const curId = useApp((s) => s.field?.id ?? null);
  const histEdits = useApp((s) => s.historyEdits);

  // Market price levels, only for fields whose money page plans with "latest" or "WASDE" prices.
  const marketReqs = fields.map((f, i) => {
    const d = moneyQs[i].data;
    const rep = reportQs[i].data as unknown as Record<string, unknown> | undefined;
    const wants = Object.values(byField[f.id]?.edits ?? {}).some((e) => e?.priceBasis === "latest" || e?.priceBasis === "wasde");
    const country = ((rep?.place as Record<string, string | null> | undefined)?.country_code ?? "").toUpperCase() || null;
    const state = country === "US" ? stateCode(rep?.statefips) : null;
    const crops = d ? cropsInPlay(d.options ?? []) : [];
    return { on: wants && !!rep && crops.length > 0, state, country, crops };
  });
  const marketQs = useQueries({
    queries: marketReqs.map((m) => ({
      queryKey: ["markets", m.state, m.country, [...m.crops].sort().join(",")],
      queryFn: () => getMarkets(m.state, m.country, m.crops),
      enabled: m.on,
      staleTime: 60 * 60_000,
      retry: noRetry,
    })),
  });

  const key = [
    ...moneyQs.map((q) => `${q.dataUpdatedAt}:${q.status}`),
    ...reportQs.map((q) => q.dataUpdatedAt),
    ...compareQs.map((q) => q.dataUpdatedAt),
    ...marketQs.map((q) => q.dataUpdatedAt),
  ].join("|");

  return useMemo(() => {
    const models: FieldModel[] = [];
    const status: FarmData["status"] = {};
    const money: FarmData["money"] = {};
    const reports: FarmData["reports"] = {};
    fields.forEach((f, i) => {
      const mq = moneyQs[i];
      const raw = mq.data;
      reports[f.id] = reportQs[i].data;
      if (mq.isError) {
        status[f.id] = { s: "error", reason: mq.error instanceof Error ? mq.error.message : null };
        return;
      }
      if (!raw) {
        status[f.id] = { s: "loading" };
        return;
      }
      // Option names in plain words, as on the money page.
      const data: MoneyData = {
        ...raw,
        options: (raw.options ?? []).map((o) => ({
          ...o,
          name: o.is_custom || o.is_baseline ? o.name : plainRotation(o.rotation_label ?? o.name, lang),
          rotation_label: o.rotation_label ? plainRotation(o.rotation_label, lang) : o.rotation_label,
        })),
      };
      money[f.id] = data;
      if (!data.available) {
        status[f.id] = { s: "unavailable", reason: data.reason ?? null };
        return;
      }
      status[f.id] = { s: "ready" };
      const st = byField[f.id] ?? EMPTY;
      const mk = marketQs[i].data;
      const basis: Record<string, { latest: number | null; wasde: number | null }> = {};
      for (const cid of cropsInPlay(data.options ?? [])) {
        const c = mk?.crops?.[cid];
        const mu = c?.unit ?? null;
        const cu = unitOf(data.crops?.[cid]?.unit);
        if (!c || (mu && cu && mu !== cu)) continue;
        basis[cid] = { latest: latestReceived(c)?.usd ?? null, wasde: wasdePrice(c)?.usd ?? null };
      }
      const hz = moneyHazards(data);
      const payItems = coverPayItems(data.costshare);
      const payIdx = Math.min(Math.max(0, st.payItem ?? 0), Math.max(0, payItems.length - 1));
      const inputs = fieldInputs({
        data,
        st,
        budgets: budgets[f.id],
        records: records[f.id],
        basis,
        insured: hz.insured ? { available: hz.insured.available, items: hz.insured.items } : null,
        nDefault: nPricePerLb(data.fertilizer_n_price),
        payDefault: payItems[payIdx]?.usd_ac ?? null,
      });
      const rep = reportQs[i].data;
      const hs = [...(rep?.history ?? [])].sort((a, b) => a.year - b.year).map((h) => (f.id === curId ? (histEdits[h.year] ?? h.crop_id) : h.crop_id));
      while (hs.length && !hs[hs.length - 1]) hs.pop();
      const cmp = compareQs[i].data as CompareResult | undefined;
      let soil: Record<string, SoilWater> | undefined;
      if (cmp?.supported) {
        soil = {};
        for (const c of [...(cmp.all_cards ?? []), ...(cmp.cards ?? [])]) {
          soil[c.id] = Object.fromEntries(SOIL_KEYS.map((k) => [k, c.indicators?.[k]?.p50 ?? null]));
        }
      }
      models.push({ id: f.id, name: f.name, data, inputs, recent: hs, soil, plan: f.plan, locked: !!f.locked, oneTime: st.oneTime });
    });
    return { models, status, money, reports, retry: (id: string) => void moneyQs[fields.findIndex((f) => f.id === id)]?.refetch() };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, fields, byField, budgets, records, curId, histEdits, lang]);
}

/* ---------------- provenance ---------------- */

function weatherEvidence(ctx: FarmCtx): Evidence {
  return {
    source: "NASA POWER",
    product: "Daily weather behind the simulated seasons (yield index per real weather year)",
    observation_start: ctx.weatherYears.length ? String(ctx.weatherYears[0]) : undefined,
    observation_end: ctx.weatherYears.length ? String(ctx.weatherYears[ctx.weatherYears.length - 1] + Math.max(0, ctx.nYearsCommon - 1)) : undefined,
    effective_res: "≈50 km regional weather, not measured on your field",
    footprint: "POWER grid cell containing each field",
    url: "https://power.larc.nasa.gov/",
    is_nasa: true,
  };
}

function ersEvidence(notes: string[]): Evidence {
  return {
    source: "USDA Economic Research Service",
    product: "Commodity Costs and Returns: operating costs and harvest-period prices",
    effective_res: "farm resource region, regional average, not your farm",
    url: "https://www.ers.usda.gov/data-products/commodity-costs-and-returns/",
    qa_flags: notes,
    is_nasa: false,
  };
}

/* ---------------- page ---------------- */

export default function FarmDashboard() {
  const { t } = useTranslation();
  const fields = useFarm((s) => s.fields);
  const data = useFarmData(fields);
  const settings = useFarm((s) => s.settings);
  const ctx = useMemo(() => prepareFarm(data.models, settings.stress), [data.models, settings.stress]);
  const loading = fields.filter((f) => data.status[f.id]?.s === "loading");
  return (
    <div className="page farm" data-tour="farm">
      <FarmHead count={fields.length} />
      {fields.length === 0 ? (
        <EmptyFarm />
      ) : (
        <>
          {loading.length ? (
            <p className="farm-busy" role="status">
              <span className="farm-busy__dot" aria-hidden="true" />
              {t("farm.loading_n", { n: loading.length, m: fields.length })}
            </p>
          ) : null}
          {ctx.fields.length ? <FarmBody ctx={ctx} data={data} fields={fields} /> : loading.length ? <LoadingBody /> : <NothingReady ctx={ctx} />}
        </>
      )}
      <Reminder text={t("farm.support")} />
    </div>
  );
}

function FarmHead({ count }: { count: number }) {
  const { t } = useTranslation();
  const saved = useApp((s) => s.savedFields);
  const inFarm = useFarm((s) => s.fields);
  const addSaved = useFarm((s) => s.addSavedFields);
  const toast = useToast((s) => s.show);
  const notIn = saved.filter((f) => !inFarm.some((x) => x.id === f.id)).length;
  return (
    <header className="page__head farm__head">
      <div>
        <p className="fs-overline farm__over">{t("farm.overline")}</p>
        <h1 className="fs-h1">{t("farm.title")}</h1>
        <p className="fs-meta farm__sub">{t("farm.sub")}</p>
      </div>
      {count ? (
        <div className="fs-cluster farm__actions">
          <Button variant="secondary" icon={<IconMap size={16} />} onClick={() => useApp.getState().setView("home")} disabled={count >= MAX_FARM_FIELDS}>
            {t("farm.add_field")}
          </Button>
          {notIn ? (
            <Button
              variant="ghost"
              onClick={() => {
                const n = addSaved();
                toast(t("farm.added_saved", { count: n }));
              }}
            >
              {t("farm.add_saved_n", { n: notIn })}
            </Button>
          ) : null}
        </div>
      ) : null}
    </header>
  );
}

function LoadingBody() {
  return (
    <div className="farm-kpis" aria-busy="true">
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="farm-kpi">
          <Skeleton lines={2} />
        </div>
      ))}
    </div>
  );
}

function NothingReady({ ctx }: { ctx: FarmCtx }) {
  const { t } = useTranslation();
  return (
    <StatusBanner kind="partial" title={t("farm.none_ready_title")}>
      {ctx.left.length ? ctx.left.map((l) => `${l.name}: ${t(`farm.left.${l.why}`)}`).join(" · ") : t("farm.none_ready")}
    </StatusBanner>
  );
}

/* ---------------- empty state & sample farm ---------------- */

function EmptyFarm() {
  const { t } = useTranslation();
  const saved = useApp((s) => s.savedFields);
  const field = useApp((s) => s.field);
  const add = useFarm((s) => s.add);
  const addSaved = useFarm((s) => s.addSavedFields);
  const [busy, setBusy] = useState<{ n: number; m: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const loadSample = async () => {
    setErr(null);
    setBusy({ n: 0, m: SAMPLE_FARM.length });
    const failed = await loadSampleFarm(t("field.unnamed"), (n, m) => setBusy({ n, m }));
    setBusy(null);
    if (failed.length) setErr(t("farm.sample_failed", { list: failed.join(", ") }));
  };
  return (
    <section className="card-sec farm-empty" aria-labelledby="farm-empty-h">
      <span className="farm-empty__icon" aria-hidden="true">
        <IconSprout size={28} />
      </span>
      <h2 id="farm-empty-h" className="fs-h2">
        {t("farm.empty_h")}
      </h2>
      <p className="farm-empty__lead">{t("farm.empty")}</p>
      <div className="fs-cluster farm-empty__actions">
        {field ? <Button onClick={() => add(field)}>{t("farm.add_this", { name: field.name })}</Button> : null}
        {saved.length ? (
          <Button variant={field ? "secondary" : "primary"} onClick={() => addSaved()}>
            {t("farm.add_saved_n", { n: saved.length })}
          </Button>
        ) : null}
        <Button variant="secondary" icon={<IconMap size={16} />} onClick={() => useApp.getState().setView("home")}>
          {t("farm.find_field")}
        </Button>
      </div>
      <div className="farm-sample">
        <div>
          <strong>{t("farm.sample_h")}</strong>
          <p className="fs-meta">{t("farm.sample_help")}</p>
        </div>
        <Button variant="secondary" onClick={() => void loadSample()} disabled={!!busy} data-testid="farm-sample">
          {busy ? t("farm.sample_busy", { n: busy.n, m: busy.m }) : t("farm.sample_btn")}
        </Button>
      </div>
      {err ? <p className="money-note">{err}</p> : null}
    </section>
  );
}

/* ---------------- the dashboard ---------------- */

function FarmBody({ ctx, data, fields }: { ctx: FarmCtx; data: FarmData; fields: FarmField[] }) {
  const { t } = useTranslation();
  const settings = useFarm((s) => s.settings);
  const setSettings = useFarm((s) => s.setSettings);
  const planA = useMemo(() => planAssignment(ctx), [ctx]);
  const curA = useMemo(() => currentAssignment(ctx), [ctx]);
  const plan = useMemo(() => farmMetrics(ctx, planA), [ctx, planA]);
  const cur = useMemo(() => farmMetrics(ctx, curA), [ctx, curA]);
  const changed = ctx.fields.some((f) => planA[f.id] !== f.baselineId);
  const [optOn, setOptOn] = useState(false);
  const opt = useMemo(() => (optOn ? optimizeFarm(ctx, { risk: settings.risk, maxCropShare: settings.maxCropShare }) : null), [optOn, ctx, settings.risk, settings.maxCropShare]);
  const sample = fields.some((f) => f.sample);
  const notes = useMemo(() => {
    const out: string[] = [];
    for (const m of Object.values(data.money)) for (const n of m?.notes ?? []) if (!out.includes(n)) out.push(n);
    return out;
  }, [data.money]);
  const stressLabel = t(`farm.stress.${settings.stress}`);

  return (
    <>
      {sample ? (
        <p className="farm-sample-tag">
          <IconCheck size={14} /> {t("farm.sample_label")}
        </p>
      ) : null}
      {ctx.left.length ? (
        <p className="money-note" role="status">
          {t("farm.left_out", { list: ctx.left.map((l) => `${l.name} (${t(`farm.left.${l.why}`)})`).join("; ") })}
        </p>
      ) : null}
      <div className="farm-stressbar">
        <label className="farm-select">
          <span>{t("farm.stress_label")}</span>
          <select value={settings.stress} onChange={(e) => setSettings({ stress: e.target.value as Stress })}>
            {STRESSES.map((s) => (
              <option key={s} value={s}>
                {t(`farm.stress.${s}`)}
              </option>
            ))}
          </select>
        </label>
        {settings.stress !== "normal" ? (
          <span className="fs-chip fs-chip--wheat" role="status">
            {t("farm.stress_on", { s: stressLabel })}
          </span>
        ) : null}
      </div>
      <Scorecard ctx={ctx} a={planA} m={plan} fields={fields} />
      <Kpis ctx={ctx} m={plan} notes={notes} changed={changed} total={fields.length} />
      <FieldBoard ctx={ctx} a={planA} m={plan} data={data} fields={fields} />
      <Optimizer ctx={ctx} opt={opt} on={optOn} setOn={setOptOn} />
      <div className="farm-grid farm-grid--even">
        <RangeCard ctx={ctx} rows={[{ key: "cur" as const, m: cur }, ...(changed ? [{ key: "plan" as const, m: plan }] : []), ...(opt && !opt.same ? [{ key: "opt" as const, m: opt.metrics }] : [])]} />
        <Diversification ctx={ctx} m={plan} a={planA} />
      </div>
      <MixCard ctx={ctx} m={plan} cap={settings.maxCropShare} />
      <div className="farm-grid farm-grid--even">
        <CashCard m={plan} changed={changed} />
        <SoilCard cur={cur} plan={plan} changed={changed} ctx={ctx} />
      </div>
      <NotesCard ctx={ctx} notes={notes} />
    </>
  );
}

/* ---------------- KPI strip ---------------- */

function farmSI(ctx: FarmCtx, t: TFunction): SIRecord {
  const own = ctx.fields.filter((f) => f.own).length;
  return {
    model_name: t("farm.si_model"),
    kind: "process",
    version: "u9",
    top_drivers: [
      { name: t("farm.si_d_weather", { s: ctx.nW, y0: ctx.weatherYears[0], y1: ctx.weatherYears[ctx.weatherYears.length - 1] }) },
      { name: ctx.priceYears.length ? t("farm.si_d_prices", { p: ctx.priceYears.length }) : t("farm.si_d_noprices") },
      { name: t("farm.si_d_costs") },
    ],
    confidence: {
      level: own * 2 >= ctx.fields.length && ctx.nW >= 15 ? "medium" : "low",
      reasons: [t("farm.si_r_regional"), own ? t("farm.si_r_own", { n: own, m: ctx.fields.length }) : t("farm.si_r_usda"), t("farm.si_r_same")],
      raise: t("farm.si_raise"),
    },
    information_cutoff: ctx.weatherYears.length ? `${ctx.weatherYears[ctx.weatherYears.length - 1] + Math.max(0, ctx.nYearsCommon - 1)}-12-31` : undefined,
    model_card_url: "#/sources",
  };
}

function Kpis({ ctx, m, notes, changed, total }: { ctx: FarmCtx; m: FarmMetrics; notes: string[]; changed: boolean; total: number }) {
  const { t } = useTranslation();
  const f = useFmt();
  const odds = oddsWords(m.pLoss);
  const lossText =
    odds.kind === "none" ? t("farm.loss.none") : odds.kind === "one_in" ? t("farm.loss.one_in", { n: odds.n }) : odds.kind === "k_in_10" ? t("farm.loss.k_in_10", { k: odds.k }) : t(`farm.loss.${odds.kind}`);
  const si = farmSI(ctx, t);
  const nasa = weatherEvidence(ctx);
  const ers = ersEvidence(notes);
  return (
    <section className="farm-kpis" aria-label={t("farm.kpis_label")}>
      <div className="farm-kpi">
        <span className="farm-kpi__lab">{t("farm.k_fields")}</span>
        <strong className="farm-kpi__big" data-k="fields">
          {total}
        </strong>
        <span className="farm-kpi__sub">{total > ctx.fields.length ? t("farm.k_fields_waiting", { n: ctx.fields.length, w: total - ctx.fields.length }) : changed ? t("farm.k_fields_plan", { n: ctx.fields.filter((x) => x.plan !== x.baselineId).length }) : t("farm.k_fields_keep")}</span>
      </div>
      <div className="farm-kpi">
        <span className="farm-kpi__lab">{t("farm.k_acres")}</span>
        <strong className="farm-kpi__big" data-k="acres">
          {f.num(m.acres)}
        </strong>
        <span className="farm-kpi__sub">{t("farm.k_acres_sub", { ha: f.num(m.acres * 0.404686) })}</span>
      </div>
      <div className="farm-kpi farm-kpi--hero">
        <span className="farm-kpi__lab">
          {t("farm.k_typical")} <SIButton record={si} describes={t("farm.k_typical")} />
        </span>
        <strong className={cx("farm-kpi__big", m.typical < 0 && "is-neg")} data-k="typical">
          {f.usd100(m.typical)}
        </strong>
        <span className="farm-kpi__sub">{t("farm.k_per_ac", { v: f.usd(m.typicalAc) })}</span>
      </div>
      <div className="farm-kpi">
        <span className="farm-kpi__lab">
          {t("farm.k_bad")} <DataButton evidence={nasa} describes={t("farm.k_bad")} />
        </span>
        <strong className={cx("farm-kpi__big", m.bad < 0 && "is-neg")} data-k="bad">
          {f.usd100(m.bad)}
        </strong>
        <span className="farm-kpi__sub">{t("farm.k_bad_sub", { v: f.usd(m.badAc) })}</span>
      </div>
      <div className="farm-kpi">
        <span className="farm-kpi__lab">
          {t("farm.k_loss")} <DataButton evidence={ers} describes={t("farm.k_loss")} />
        </span>
        <strong className="farm-kpi__big" data-k="ploss">
          {Number.isFinite(m.pLoss) ? f.pct(m.pLoss) : "—"}
        </strong>
        <span className="farm-kpi__sub">{lossText}</span>
      </div>
      <div className="farm-kpi farm-kpi--div">
        <span className="farm-kpi__lab">{t("farm.k_div")}</span>
        <strong className="farm-kpi__big" data-k="div">
          {ctx.fields.length > 1 ? f.signed100(m.diversification) : "—"}
        </strong>
        <span className="farm-kpi__sub">{ctx.fields.length > 1 ? t("farm.k_div_sub") : t("farm.k_div_one")}</span>
      </div>
    </section>
  );
}

/* ---------------- fields list ---------------- */

function AcresIn({ fid, value, fromBoundary }: { fid: string; value: number | null; fromBoundary: boolean }) {
  const { t } = useTranslation();
  const id = useId();
  const patch = useMoneyStore((s) => s.patch);
  const show = (v: number | null) => (finite(v) ? String(Math.round(v * 10) / 10) : "");
  const [draft, setDraft] = useState(show(value));
  useEffect(() => {
    const cur = draft.trim() === "" ? null : Number(draft);
    if (cur !== value && !(cur !== null && finite(value) && Math.abs(cur - value) < 0.05)) setDraft(show(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <span className="farm-acres">
      <label htmlFor={id} className="fs-visually-hidden">
        {t("farm.acres_label")}
      </label>
      <input
        id={id}
        type="number"
        inputMode="decimal"
        min={0}
        step="any"
        value={draft}
        title={fromBoundary ? t("farm.acres_boundary") : t("farm.acres_yours")}
        onChange={(e) => {
          const s = e.target.value;
          setDraft(s);
          if (s.trim() === "") return patch(fid, { acres: null });
          const v = Number(s);
          if (Number.isFinite(v) && v >= 0) patch(fid, { acres: v });
        }}
      />
    </span>
  );
}

function optionLabel(o: MoneyOption, t: TFunction, es: boolean) {
  if (o.is_baseline) return t("farm.keep_current", { name: o.rotation_label ?? o.name });
  return (es && o.name_es) || o.name;
}

function FieldsList({ ctx, m, data, fields, embedded }: { ctx: FarmCtx; m: FarmMetrics; data: FarmData; fields: FarmField[]; embedded?: boolean }) {
  const { t, i18n } = useTranslation();
  const es = i18n.language === "es";
  const f = useFmt();
  const narrow = useMediaQuery("(max-width: 767px)");
  const setPlan = useFarm((s) => s.setPlan);
  const lock = useFarm((s) => s.lock);
  const remove = useFarm((s) => s.remove);
  const rename = useFarm((s) => s.rename);
  const selectField = useApp((s) => s.selectField);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const crop = useCropName();

  const rows = fields.map((ff) => {
    const run = ctx.fields.find((x) => x.id === ff.id);
    const part = m.fields.find((x) => x.id === ff.id);
    const money = data.money[ff.id];
    const st = data.status[ff.id];
    const rep = data.reports[ff.id];
    const base = money?.options?.find((o) => o.is_baseline);
    const left = ctx.left.find((x) => x.id === ff.id);
    return { ff, run, part, money, st, rep, base, left };
  });

  const open = (ff: FarmField) => {
    selectField({ id: ff.id, name: ff.name, lat: ff.lat, lon: ff.lon, meta: ff.meta ?? null, farm: ff.farm });
  };
  const place = (rep: Report | undefined) => {
    const c = rep?.place?.county;
    const s = rep?.place?.state;
    return [c, s].filter(Boolean).join(", ");
  };
  const lastCrops = (rep: Report | undefined) => {
    const hs = [...(rep?.history ?? [])].filter((h) => h.crop_id).sort((a, b) => a.year - b.year).slice(-3);
    return hs.length ? hs.map((h) => `${h.year} ${crop(h.crop_id)}`).join(" · ") : null;
  };

  const planSelect = (r: (typeof rows)[number]) => {
    if (!r.run || !r.money) return <span className="fs-meta">—</span>;
    const opts = r.money.options ?? [];
    return (
      <label className="farm-plan">
        <span className="fs-visually-hidden">{t("farm.plan_for", { name: r.ff.name })}</span>
        <select
          value={r.run.plan}
          disabled={r.ff.locked}
          onChange={(e) => setPlan(r.ff.id, e.target.value === r.run!.baselineId ? null : e.target.value)}
          data-testid={`farm-plan-${r.ff.id}`}
        >
          {opts.map((o) => (
            <option key={o.id} value={o.id} disabled={!r.run!.options[o.id]}>
              {optionLabel(o, t, es)}
              {!r.run!.options[o.id] ? ` (${t("farm.needs_numbers")})` : ""}
            </option>
          ))}
        </select>
      </label>
    );
  };

  const statusText = (r: (typeof rows)[number]) => {
    if (r.st?.s === "loading" || !r.st) return t("farm.st_loading");
    if (r.st.s === "error") return t("farm.st_error");
    if (r.st.s === "unavailable") return `${t("farm.st_unavailable")}${r.st.reason ? `: ${r.st.reason}` : ""}`;
    if (r.left) return t(`farm.left.${r.left.why}`);
    return null;
  };

  const nameCell = (r: (typeof rows)[number]) =>
    editing === r.ff.id ? (
      <form
        className="farm-rename"
        onSubmit={(e) => {
          e.preventDefault();
          rename(r.ff.id, draft);
          setEditing(null);
        }}
      >
        <label className="fs-visually-hidden" htmlFor={`fr-${r.ff.id}`}>
          {t("farm.rename_label")}
        </label>
        <input id={`fr-${r.ff.id}`} value={draft} onChange={(e) => setDraft(e.target.value)} autoFocus maxLength={60} />
        <Button size="sm" type="submit">
          {t("farm.save")}
        </Button>
      </form>
    ) : (
      <div className="farm-fname">
        <button
          type="button"
          className="farm-fname__name"
          title={t("farm.rename")}
          onClick={() => {
            setDraft(r.ff.name);
            setEditing(r.ff.id);
          }}
        >
          {r.ff.name}
        </button>
        <span className="fs-meta">{[place(r.rep) !== r.ff.name ? place(r.rep) : null, lastCrops(r.rep)].filter(Boolean).join(" · ")}</span>
      </div>
    );

  const money = (r: (typeof rows)[number], k: "typicalField" | "badField") => (r.part ? <span className={cx(r.part[k] < 0 && "is-neg")}>{f.usd100(r.part[k])}</span> : <span className="fs-meta">—</span>);
  const lockBox = (r: (typeof rows)[number]) => (
    <label className="farm-lock" title={t("farm.lock_help")}>
      <input type="checkbox" checked={!!r.ff.locked} onChange={(e) => lock(r.ff.id, e.target.checked)} disabled={!r.run} />
      <span>{t("farm.lock")}</span>
    </label>
  );
  const actions = (r: (typeof rows)[number]) => (
    <span className="farm-row-actions">
      <Button size="sm" variant="secondary" onClick={() => open(r.ff)}>
        {t("farm.open")}
      </Button>
      <Button size="sm" variant="ghost" className="fs-btn--icon" aria-label={t("farm.remove", { name: r.ff.name })} title={t("farm.remove", { name: r.ff.name })} onClick={() => remove(r.ff.id)} icon={<IconClose size={14} />} />
    </span>
  );

  const Wrap = embedded ? "div" : "section";
  return (
    <Wrap className={cx(!embedded && "card-sec", "farm-fields")} aria-labelledby={embedded ? undefined : "farm-fields-h"}>
      {!embedded ? (
        <div className="h-row">
          <h2 id="farm-fields-h" className="fs-h2">
            {t("farm.fields_h")}
          </h2>
          <span className="fs-meta">{t("farm.fields_help")}</span>
        </div>
      ) : (
        <p className="fs-meta">{t("farm.fields_help")}</p>
      )}
      {narrow ? (
        <ul className="farm-fcards">
          {rows.map((r) => {
            const stx = statusText(r);
            return (
              <li key={r.ff.id} className={cx("farm-fcard", stx && "is-pending")} data-field={r.ff.id}>
                {nameCell(r)}
                {stx ? (
                  <p className="farm-status">
                    {r.st?.s === "loading" ? <span className="farm-busy__dot" aria-hidden="true" /> : null}
                    {stx}
                    {r.st?.s === "error" ? (
                      <Button size="sm" variant="ghost" onClick={() => data.retry(r.ff.id)}>
                        {t("farm.retry")}
                      </Button>
                    ) : null}
                  </p>
                ) : null}
                <dl className="farm-fcard__nums">
                  <div>
                    <dt>{t("farm.col_acres")}</dt>
                    <dd>
                      <AcresIn fid={r.ff.id} value={r.run?.acres ?? (finite(r.money?.field?.acres) ? r.money!.field!.acres! : null)} fromBoundary={!useMoneyStore.getState().byField[r.ff.id]?.acres} />
                    </dd>
                  </div>
                  <div>
                    <dt>{t("farm.col_typical")}</dt>
                    <dd>{money(r, "typicalField")}</dd>
                  </div>
                  <div>
                    <dt>{t("farm.col_bad")}</dt>
                    <dd>{money(r, "badField")}</dd>
                  </div>
                </dl>
                <p className="fs-meta farm-fcard__cur">
                  {t("farm.col_current")}: {r.base?.rotation_label ?? "—"}
                </p>
                {planSelect(r)}
                <div className="farm-fcard__foot">
                  {lockBox(r)}
                  {actions(r)}
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="farm-table-wrap">
          <table className="farm-table">
            <thead>
              <tr>
                <th scope="col">{t("farm.col_field")}</th>
                <th scope="col" className="num">
                  {t("farm.col_acres")}
                </th>
                <th scope="col">{t("farm.col_plan")}</th>
                <th scope="col" className="num">
                  {t("farm.col_typical")}
                </th>
                <th scope="col" className="num">
                  {t("farm.col_bad")}
                </th>
                <th scope="col">
                  <span className="fs-visually-hidden">{t("farm.col_actions")}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const stx = statusText(r);
                return (
                  <tr key={r.ff.id} data-field={r.ff.id} className={cx(stx && "is-pending")}>
                    <td>{nameCell(r)}</td>
                    <td className="num">
                      <AcresIn fid={r.ff.id} value={r.run?.acres ?? (finite(r.money?.field?.acres) ? r.money!.field!.acres! : null)} fromBoundary={!useMoneyStore.getState().byField[r.ff.id]?.acres} />
                    </td>
                    {stx ? (
                      <td colSpan={3}>
                        <span className="farm-status">
                          {r.st?.s === "loading" ? <span className="farm-busy__dot" aria-hidden="true" /> : null}
                          {stx}
                          {r.st?.s === "error" ? (
                            <Button size="sm" variant="ghost" onClick={() => data.retry(r.ff.id)}>
                              {t("farm.retry")}
                            </Button>
                          ) : null}
                        </span>
                      </td>
                    ) : (
                      <>
                        <td className="farm-table__plan">
                          {planSelect(r)}
                          <span className="farm-table__under">
                            <span className="fs-meta">
                              {t("farm.col_current")}: {r.base?.rotation_label ?? "—"}
                            </span>
                            {lockBox(r)}
                          </span>
                        </td>
                        <td className="num">{money(r, "typicalField")}</td>
                        <td className="num">{money(r, "badField")}</td>
                      </>
                    )}
                    <td>{actions(r)}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row">{t("farm.total")}</th>
                <td className="num">{f.num(m.acres)}</td>
                <td className="fs-meta">{t("farm.total_note")}</td>
                <td className="num">
                  <strong>{f.usd100(m.typical)}</strong>
                </td>
                <td className="num">
                  <strong>{f.usd100(m.bad)}</strong>
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      <p className="fs-meta">{t("farm.fields_foot")}</p>
    </Wrap>
  );
}

/* ---------------- profit range ---------------- */

function RangeCard({ ctx, rows }: { ctx: FarmCtx; rows: { key: "cur" | "plan" | "opt"; m: FarmMetrics }[] }) {
  const { t } = useTranslation();
  const f = useFmt();
  const lo = Math.min(0, ...rows.map((r) => r.m.bad));
  const hi = Math.max(0, ...rows.map((r) => r.m.good));
  const W = 300;
  const span = hi - lo || 1;
  const x = (v: number) => 10 + ((v - lo) / span) * (W - 20);
  return (
    <section className="card-sec farm-range" aria-labelledby="farm-range-h">
      <h2 id="farm-range-h" className="fs-h2">
        {t("farm.range_h")}
      </h2>
      <p className="fs-meta">{t("farm.range_help", { n: ctx.N })}</p>
      <ul className="farm-range__rows">
        {rows.map((r) => (
          <li key={r.key} className={cx("farm-range__row", `is-${r.key}`)} data-range={r.key}>
            <span className="farm-range__lab">{t(`farm.range_${r.key}`)}</span>
            <svg className="farm-range__svg" viewBox={`0 0 ${W} 30`} preserveAspectRatio="none" role="img" aria-label={t("farm.range_aria", { bad: f.usd100(r.m.bad), typ: f.usd100(r.m.typical), good: f.usd100(r.m.good) })}>
              <rect x={10} y={13} width={W - 20} height={4} rx={2} className="farm-range__track" />
              {lo < 0 && hi > 0 ? <line x1={x(0)} x2={x(0)} y1={3} y2={27} className="farm-range__zero" /> : null}
              <rect x={x(r.m.bad)} y={9} width={Math.max(2, x(r.m.good) - x(r.m.bad))} height={12} rx={6} className="farm-range__bar" />
              <circle cx={x(r.m.typical)} cy={15} r={6.5} className="farm-range__dot" />
            </svg>
            <span className="farm-range__nums">
              <span>
                {t("farm.bad_short")} {f.usd100(r.m.bad)}
              </span>
              <strong>{f.usd100(r.m.typical)}</strong>
              <span>
                {t("farm.good_short")} {f.usd100(r.m.good)}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ---------------- diversification ---------------- */

function Diversification({ ctx, m, a }: { ctx: FarmCtx; m: FarmMetrics; a: Record<string, string> }) {
  const { t } = useTranslation();
  const f = useFmt();
  const corr = useMemo(() => fieldCorrelation(ctx, a), [ctx, a]);
  if (ctx.fields.length < 2)
    return (
      <section className="card-sec farm-div" aria-labelledby="farm-div-h">
        <h2 id="farm-div-h" className="fs-h2">
          {t("farm.div_h")}
        </h2>
        <p>{t("farm.div_one")}</p>
      </section>
    );
  const bonus = m.diversification;
  const short = (name: string) => (name.length > 14 ? `${name.slice(0, 13)}…` : name);
  return (
    <section className="card-sec farm-div" aria-labelledby="farm-div-h">
      <h2 id="farm-div-h" className="fs-h2">
        {t("farm.div_h")}
      </h2>
      <p className="farm-div__lead">
        {Math.round(bonus / 100) > 0 ? t("farm.div_text", { v: f.usd100(bonus) }) : t("farm.div_none")}
      </p>
      <div className="farm-div__bars" aria-hidden="true">
        <div>
          <span className="fs-meta">{t("farm.div_sum")}</span>
          <strong>{f.usd100(m.sumFieldBad)}</strong>
        </div>
        <div>
          <span className="fs-meta">{t("farm.div_farm")}</span>
          <strong>{f.usd100(m.bad)}</strong>
        </div>
      </div>
      {corr.mean !== null ? <p className="fs-meta">{t("farm.div_corr", { r: f.num(corr.mean, 2) })}</p> : null}
      {ctx.fields.length <= 6 ? (
        <details className="farm-corr">
          <summary>{t("farm.corr_show")}</summary>
          <div className="farm-table-wrap">
            <table className="farm-corr__t">
              <thead>
                <tr>
                  <th scope="col">
                    <span className="fs-visually-hidden">{t("farm.col_field")}</span>
                  </th>
                  {ctx.fields.map((x) => (
                    <th key={x.id} scope="col" title={x.name}>
                      {short(x.name)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ctx.fields.map((x, i) => (
                  <tr key={x.id}>
                    <th scope="row" title={x.name}>
                      {short(x.name)}
                    </th>
                    {corr.r[i].map((v, j) => (
                      <td key={j} style={{ background: Number.isFinite(v) ? `color-mix(in srgb, var(--sky) ${Math.round(Math.max(0, v) * 55)}%, transparent)` : undefined }}>
                        {Number.isFinite(v) ? f.num(v, 2) : "—"}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      ) : null}
      <p className="fs-meta">{t("farm.div_weather")}</p>
    </section>
  );
}

/* ---------------- optimizer ---------------- */

const CAPS: (number | null)[] = [null, 0.8, 0.7, 0.6, 0.5];

function Optimizer({ ctx, opt, on, setOn }: { ctx: FarmCtx; opt: OptimizeResult | null; on: boolean; setOn: (v: boolean) => void }) {
  const { t, i18n } = useTranslation();
  const es = i18n.language === "es";
  const f = useFmt();
  const settings = useFarm((s) => s.settings);
  const setSettings = useFarm((s) => s.setSettings);
  const apply = useFarm((s) => s.applyPlans);
  const undo = useFarm((s) => s.undo);
  const undoApply = useFarm((s) => s.undoApply);
  const units = useApp((s) => s.units);
  const name = (fid: string, oid: string) => {
    const fr = ctx.fields.find((x) => x.id === fid);
    const o = fr?.options[oid]?.opt;
    if (!o) return oid;
    return o.is_baseline ? t("farm.opt.now_rot", { name: o.rotation_label ?? o.name }) : (es && o.name_es) || o.name;
  };
  const si: SIRecord | null = opt
    ? {
        model_name: t("farm.opt.model"),
        kind: "process",
        version: "u9",
        top_drivers: [
          { name: t(`farm.opt.goal_${opt.settings.risk}`) },
          ...(opt.settings.maxCropShare !== null ? [{ name: t("farm.opt.d_cap", { pct: Math.round(opt.settings.maxCropShare * 100) }) }] : []),
          ...(ctx.fields.some((x) => x.locked) ? [{ name: t("farm.opt.d_locked", { n: ctx.fields.filter((x) => x.locked).length }) }] : []),
          { name: t("farm.opt.d_search", { n: opt.sweeps }) },
        ],
        confidence: {
          level: opt.confidence.level,
          reasons: [...opt.confidence.why.map((w) => t(`farm.opt.${w.key}`, w.params ?? {})), t("farm.opt.caveat_mgmt")],
          raise: t("farm.opt.raise"),
        },
        information_cutoff: ctx.weatherYears.length ? `${ctx.weatherYears[ctx.weatherYears.length - 1] + Math.max(0, ctx.nYearsCommon - 1)}-12-31` : undefined,
        model_card_url: "#/sources",
      }
    : null;
  const d = (k: SoilKey) => {
    const a = opt?.metrics.soil[k].value;
    const b = opt?.fromMetrics.soil[k].value;
    return finite(a) && finite(b) ? a - b : null;
  };
  const kind: Record<SoilKey, UnitKind> = { soil_cover: "days", erosion_water: "t_ha", water_use: "mm", soc_trend: "t_c_ha" };
  return (
    <section className="card-sec farm-opt" aria-labelledby="farm-opt-h" data-tour="farm-opt">
      <div className="farm-opt__head">
        <div>
          <h2 id="farm-opt-h" className="fs-h2">
            {t("farm.opt.h")}
          </h2>
          <p className="fs-meta">{t("farm.opt.help")}</p>
        </div>
      </div>
      <div className="farm-opt__controls">
        <SegmentedToggle<Risk>
          label={t("farm.opt.risk")}
          value={settings.risk}
          onChange={(v) => setSettings({ risk: v, weights: null })}
          options={RISKS.map((r) => ({ value: r, label: t(`farm.opt.risk_${r}`) }))}
        />
        <label className="farm-select">
          <span>{t("farm.opt.cap")}</span>
          <select value={settings.maxCropShare === null ? "" : String(settings.maxCropShare)} onChange={(e) => setSettings({ maxCropShare: e.target.value ? Number(e.target.value) : null })}>
            {CAPS.map((c) => (
              <option key={String(c)} value={c === null ? "" : String(c)}>
                {c === null ? t("farm.opt.cap_none") : t("farm.opt.cap_pct", { pct: Math.round(c * 100) })}
              </option>
            ))}
          </select>
        </label>
        {on ? (
          <span className="farm-opt__live" role="status">
            {t("farm.opt.live")}
          </span>
        ) : (
          <Button variant="si" onClick={() => setOn(true)} data-testid="farm-optimize">
            {t("farm.opt.go")}
          </Button>
        )}
      </div>
      <p className="fs-meta">{t(`farm.opt.goal_help_${settings.risk}`)}</p>
      {undo ? (
        <p className="farm-applied" role="status">
          <IconCheck size={16} /> {t("farm.opt.applied")}
          <Button size="sm" variant="ghost" onClick={undoApply}>
            {t("farm.opt.undo")}
          </Button>
        </p>
      ) : null}
      {opt && si ? (
        <div className="farm-opt__res" data-testid="farm-opt-result">
          <div className="h-row">
            <h3 className="farm-opt__title">
              {opt.same ? t("farm.opt.same") : t("farm.opt.found", { count: opt.reasons.filter((r) => r.changed).length })}
            </h3>
            <SIButton record={si} describes={t("farm.opt.h")} />
          </div>
          {opt.capMissed ? <p className="money-note">{t("farm.opt.cap_missed")}</p> : null}
          {!opt.same ? (
            <>
              <div className="farm-deltas">
                <ScoreDelta ctx={ctx} opt={opt} />
                <Delta lab={t("farm.k_typical")} v={f.signed100(opt.metrics.typical - opt.fromMetrics.typical)} good={opt.metrics.typical >= opt.fromMetrics.typical} sub={`${f.usd100(opt.fromMetrics.typical)} → ${f.usd100(opt.metrics.typical)}`} />
                <Delta lab={t("farm.k_bad")} v={f.signed100(opt.metrics.bad - opt.fromMetrics.bad)} good={opt.metrics.bad >= opt.fromMetrics.bad} sub={`${f.usd100(opt.fromMetrics.bad)} → ${f.usd100(opt.metrics.bad)}`} />
                <Delta
                  lab={t("farm.k_loss")}
                  v={`${f.pct(opt.fromMetrics.pLoss)} → ${f.pct(opt.metrics.pLoss)}`}
                  good={opt.metrics.pLoss <= opt.fromMetrics.pLoss}
                />
                {SOIL_KEYS.filter((k) => d(k) !== null).map((k) => {
                  const v = d(k)!;
                  const better = k === "erosion_water" || k === "water_use" ? v <= 0 : v >= 0;
                  return <Delta key={k} lab={t(`farm.soil.${k}`)} v={`${v > 0 ? "+" : v < 0 ? "−" : ""}${fmtU(Math.abs(v), kind[k], units, i18n.language)}`} good={better} neutral={k === "water_use"} />;
                })}
              </div>
              {opt.pBeat !== null ? <p className="farm-opt__beat">{t("farm.opt.beat", { k: Math.round(opt.pBeat * 10) })}</p> : null}
            </>
          ) : (
            <p>{t("farm.opt.same_help")}</p>
          )}
          <ul className="farm-reasons">
            {opt.reasons.map((r) => (
              <li key={r.id} className={cx(r.changed && "is-changed")}>
                <strong>{r.name}</strong>
                <span>
                  {r.changed
                    ? t("farm.opt.r_change", { from: name(r.id, r.from), to: name(r.id, r.to), typ: f.signed100(r.dTypical ?? 0), bad: f.signed100(r.dBad ?? 0) }) +
                      (r.forCap ? ` ${t("farm.opt.r_cap")}` : "")
                    : r.locked
                      ? t("farm.opt.r_locked", { name: name(r.id, r.to) })
                      : t("farm.opt.r_keep", { name: name(r.id, r.to) })}
                </span>
              </li>
            ))}
          </ul>
          <div className="fs-cluster">
            {!opt.same ? (
              <Button
                icon={<IconCheck size={16} />}
                onClick={() => apply(opt.assignment, Object.fromEntries(ctx.fields.map((x) => [x.id, x.baselineId])))}
                data-testid="farm-apply"
              >
                {t("farm.opt.apply")}
              </Button>
            ) : null}
            <Button variant="ghost" onClick={() => setOn(false)}>
              {t("farm.opt.hide")}
            </Button>
          </div>
          <p className="fs-meta">{t("farm.opt.caveats")}</p>
        </div>
      ) : null}
    </section>
  );
}

function Delta({ lab, v, good, sub, neutral }: { lab: string; v: string; good: boolean; sub?: string; neutral?: boolean }) {
  return (
    <div className={cx("farm-delta", neutral ? "is-neutral" : good ? "is-good" : "is-bad")}>
      <span className="farm-delta__lab">{lab}</span>
      <strong>{v}</strong>
      {sub ? <span className="fs-meta">{sub}</span> : null}
    </div>
  );
}

/* ---------------- crop mix ---------------- */

function MixCard({ ctx, m, cap }: { ctx: FarmCtx; m: FarmMetrics; cap: number | null }) {
  const { t } = useTranslation();
  const f = useFmt();
  const crop = useCropName();
  const crops = useMemo(() => {
    const out: string[] = [];
    for (const y of m.mix) for (const c of Object.keys(y.acres)) if (!out.includes(c)) out.push(c);
    return out.sort((a, b) => (a === "fallow" ? 1 : b === "fallow" ? -1 : 0));
  }, [m.mix]);
  const label = (c: string) => (c === "fallow" ? t("farm.fallow") : crop(c));
  return (
    <section className="card-sec farm-mix" aria-labelledby="farm-mix-h">
      <div className="h-row">
        <h2 id="farm-mix-h" className="fs-h2">
          {t("farm.mix_h")}
        </h2>
        <ul className="farm-legend" aria-label={t("farm.legend")}>
          {crops.map((c) => (
            <li key={c}>
              <span className={cx("farm-legend__sw", c === "fallow" && "fs-hatch-bare")} style={c === "fallow" ? undefined : { background: cropColor(c) }} aria-hidden="true" />
              {label(c)}
            </li>
          ))}
        </ul>
      </div>
      <p className="fs-meta">{t("farm.mix_help")}</p>
      <ol className="farm-mix__rows">
        {m.mix.map((y) => (
          <li key={y.year} className="farm-mix__row">
            <span className="farm-mix__yr">{t("farm.year_n", { n: y.year })}</span>
            <span className="farm-mix__bar" role="img" aria-label={crops.filter((c) => y.acres[c]).map((c) => `${label(c)} ${f.num(y.acres[c])} ac`).join(", ")}>
              {crops
                .filter((c) => y.acres[c])
                .map((c) => {
                  const share = y.acres[c] / (m.acres || 1);
                  return (
                    <span
                      key={c}
                      className={cx("farm-mix__seg", c === "fallow" && "fs-hatch-bare")}
                      style={{ width: `${share * 100}%`, ...(c === "fallow" ? {} : { background: cropColor(c), color: cropInk(c) }) }}
                      title={`${label(c)}: ${f.num(y.acres[c])} ac (${f.pct(share)})`}
                    >
                      {share >= 0.14 ? `${label(c)} ${f.pct(share)}` : ""}
                    </span>
                  );
                })}
            </span>
            <span className={cx("farm-mix__max", cap !== null && y.maxShare > cap + 1e-9 && "is-over")}>{y.maxCrop ? t("farm.mix_max", { pct: f.pct(y.maxShare), crop: label(y.maxCrop) }) : "—"}</span>
          </li>
        ))}
      </ol>
      {ctx.fields.length ? <p className="fs-meta">{t("farm.mix_foot")}</p> : null}
    </section>
  );
}

/* ---------------- cash flow ---------------- */

function CashCard({ m, changed }: { m: FarmMetrics; changed: boolean }) {
  const { t } = useTranslation();
  const f = useFmt();
  const rows = m.cash;
  return (
    <section className="card-sec farm-cash" aria-labelledby="farm-cash-h">
      <h2 id="farm-cash-h" className="fs-h2">
        {t("farm.cash_h")}
      </h2>
      <p className="fs-meta">{changed ? t("farm.cash_help") : t("farm.cash_help_keep")}</p>
      {rows ? (
        <div className="farm-table-wrap">
          <table className="farm-table farm-table--cash">
            <thead>
              <tr>
                <th scope="col">{t("farm.cash_year")}</th>
                <th scope="col" className="num">
                  {t("farm.cash_plan")}
                </th>
                {changed ? (
                  <>
                    <th scope="col" className="num">
                      {t("farm.cash_base")}
                    </th>
                    <th scope="col" className="num">
                      {t("farm.cash_diff")}
                    </th>
                    <th scope="col" className="num">
                      {t("farm.cash_cum")}
                    </th>
                  </>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.year}>
                  <th scope="row">{t("farm.year_n", { n: r.year })}</th>
                  <td className={cx("num", r.net < 0 && "is-neg")}>{f.usd100(r.net)}</td>
                  {changed ? (
                    <>
                      <td className={cx("num", r.base < 0 && "is-neg")}>{f.usd100(r.base)}</td>
                      <td className={cx("num", r.diff < 0 && "is-neg")}>{f.signed100(r.diff)}</td>
                      <td className={cx("num", r.cum < 0 && "is-neg")}>{f.signed100(r.cum)}</td>
                    </>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="money-note">{t("farm.cash_none")}</p>
      )}
    </section>
  );
}

/* ---------------- soil & water ---------------- */

function SoilCard({ cur, plan, changed, ctx }: { cur: FarmMetrics; plan: FarmMetrics; changed: boolean; ctx: FarmCtx }) {
  const { t, i18n } = useTranslation();
  const units = useApp((s) => s.units);
  const f = useFmt();
  const kind: Record<SoilKey, UnitKind> = { soil_cover: "days", erosion_water: "t_ha", water_use: "mm", soc_trend: "t_c_ha" };
  const covered = plan.soil.soil_cover.acres;
  const si: SIRecord = {
    model_name: t("farm.soil_model"),
    kind: "process",
    top_drivers: [{ name: t("farm.soil_d1") }, { name: t("farm.soil_d2") }],
    confidence: { level: "medium", reasons: [t("farm.soil_r1"), t("farm.soil_r2")] },
    model_card_url: "#/sources",
  };
  return (
    <section className="card-sec farm-soil" aria-labelledby="farm-soil-h">
      <div className="h-row">
        <h2 id="farm-soil-h" className="fs-h2">
          {t("farm.soil_h")}
        </h2>
        <SIButton record={si} describes={t("farm.soil_h")} />
      </div>
      <p className="fs-meta">{covered < plan.acres ? t("farm.soil_partial", { a: f.num(covered), b: f.num(plan.acres) }) : t("farm.soil_help")}</p>
      <dl className="farm-soil__grid">
        {SOIL_KEYS.map((k) => {
          const a = cur.soil[k].value;
          const b = plan.soil[k].value;
          return (
            <div key={k} className="farm-soil__item">
              <dt>{t(`farm.soil.${k}`)}</dt>
              <dd>
                <strong>{fmtU(changed ? b : a, kind[k], units, i18n.language, k === "soc_trend" ? 2 : undefined)}</strong>
                {changed && finite(a) && finite(b) ? (
                  <span className="fs-meta">
                    {t("farm.soil_was", { v: fmtU(a, kind[k], units, i18n.language, k === "soc_trend" ? 2 : undefined) })}
                  </span>
                ) : null}
              </dd>
            </div>
          );
        })}
      </dl>
      {ctx.fields.length ? <p className="fs-meta">{t("farm.soil_foot")}</p> : null}
    </section>
  );
}

/* ---------------- notes & sources ---------------- */

function NotesCard({ ctx, notes }: { ctx: FarmCtx; notes: string[] }) {
  const { t } = useTranslation();
  const y0 = ctx.weatherYears[0];
  const y1 = ctx.weatherYears[ctx.weatherYears.length - 1];
  const p0 = ctx.priceYears[0];
  const p1 = ctx.priceYears[ctx.priceYears.length - 1];
  const items: ReactNode[] = [
    ctx.priceYears.length ? t("farm.n_method", { s: ctx.nW, y0, y1, p: ctx.priceYears.length, p0, p1, n: ctx.N }) : t("farm.n_method_noprice", { s: ctx.nW, y0, y1 }),
    ctx.dryThreshold !== null ? t("farm.n_drought", { mm: Math.round(ctx.dryThreshold) }) : null,
    t("farm.n_align"),
    t("farm.n_bad"),
    t("farm.n_years"),
    t("farm.n_same_inputs"),
    t("farm.n_never"),
  ].filter(Boolean);
  return (
    <section className="card-sec farm-notes" aria-labelledby="farm-notes-h">
      <h2 id="farm-notes-h" className="fs-h2">
        {t("farm.notes_h")}
      </h2>
      <ul className="farm-notes__list">
        {items.map((x, i) => (
          <li key={i}>{x}</li>
        ))}
      </ul>
      <p className="farm-notes__src">
        <span>{t("farm.src_weather")}</span> <DataButton evidence={weatherEvidence(ctx)} describes={t("farm.src_weather")} />
        <span>{t("farm.src_ers")}</span> <DataButton evidence={ersEvidence(notes)} describes={t("farm.src_ers")} />
      </p>
      {notes.length ? (
        <details>
          <summary>{t("farm.notes_api")}</summary>
          <ul className="farm-notes__list">
            {notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}

/* ---------------- portfolio scores (1-10) ---------------- */

const BAND_CLASS: Record<ScoreBand, string> = {
  excellent: "is-excellent",
  good: "is-good",
  fair: "is-fair",
  risky: "is-risky",
  high_risk: "is-high",
};

function ScoreBadge({ s, size = "md", label }: { s: number; size?: "sm" | "md" | "lg"; label?: string }) {
  const { t } = useTranslation();
  if (!Number.isFinite(s)) return <span className="fsc-badge is-na">—</span>;
  const b = band(s);
  return (
    <span className={cx("fsc-badge", `fsc-badge--${size}`, BAND_CLASS[b])} title={label ?? t(`farm.sc.band.${b}`)}>
      <strong>{s.toFixed(1)}</strong>
      {size === "lg" ? <span className="fsc-badge__of">/10</span> : null}
    </span>
  );
}

function SubBar({ lab, v, help }: { lab: string; v: number | null; help?: string }) {
  const { t } = useTranslation();
  const ok = v !== null && Number.isFinite(v);
  return (
    <div className="fsc-sub" title={help}>
      <span className="fsc-sub__lab">{lab}</span>
      <span className="fsc-sub__track" aria-hidden="true">
        {ok ? <span className={cx("fsc-sub__fill", BAND_CLASS[band(v!)])} style={{ width: `${(v! / 10) * 100}%` }} /> : null}
      </span>
      <span className="fsc-sub__v">{ok ? v!.toFixed(1) : t("farm.sc.na")}</span>
    </div>
  );
}

function scoreSI(ctx: FarmCtx, t: TFunction, noSoil: number): SIRecord {
  return {
    model_name: t("farm.sc.si_model"),
    kind: "process",
    version: "u10",
    top_drivers: [{ name: t("farm.sc.si_d1") }, { name: t("farm.sc.si_d2") }, { name: t("farm.sc.si_d3") }],
    confidence: {
      level: ctx.nW >= 15 && !ctx.left.length && !noSoil ? "medium" : "low",
      reasons: [
        t("farm.sc.si_r1"),
        t("farm.si_r_regional"),
        ...(ctx.left.length ? [t("farm.sc.si_r_left", { count: ctx.left.length })] : []),
        ...(noSoil ? [t("farm.sc.si_r_soil", { n: noSoil })] : []),
      ],
      raise: t("farm.sc.si_raise"),
    },
    model_card_url: "#/sources",
  };
}

function Scorecard({ ctx, a, m, fields }: { ctx: FarmCtx; a: Assignment; m: FarmMetrics; fields: FarmField[] }) {
  const { t, i18n } = useTranslation();
  const es = i18n.language === "es";
  const risk = useScoreWeights();
  const setPlan = useFarm((s) => s.setPlan);
  const sc = useMemo(() => farmScore(ctx, a, risk, m.pLoss), [ctx, a, risk, m.pLoss]);
  const boosters = useMemo(() => scoreBoosters(ctx, a, risk), [ctx, a, risk]);
  const scores = useMemo(() => ctx.fields.map((f) => ({ f, s: fieldScore(f, risk, a[f.id] ?? f.baselineId) })), [ctx, a, risk]);
  const noSoil = ctx.fields.filter((f) => !f.soil).length;
  const goal = useFarm((s) => s.settings.risk);
  const custom = !!useFarm((s) => s.settings.weights);
  const W = weightPcts(risk);
  const b = Number.isFinite(sc.total) ? band(sc.total) : "fair";
  const optName = (fid: string, oid: string) => {
    const o = ctx.fields.find((x) => x.id === fid)?.options[oid]?.opt;
    if (!o) return oid;
    return o.is_baseline ? t("farm.opt.now_rot", { name: o.rotation_label ?? o.name }) : (es && o.name_es) || o.name;
  };
  const counts = (["excellent", "good", "fair", "risky", "high_risk"] as ScoreBand[]).map((k) => ({ k, n: scores.filter((x) => Number.isFinite(x.s.total) && band(x.s.total) === k).length }));
  return (
    <section className={cx("card-sec fsc", BAND_CLASS[b])} aria-labelledby="fsc-h" data-testid="farm-score">
      <div className="fsc__main">
        <div className="fsc__dial">
          <p className="fs-overline" id="fsc-h">
            {t("farm.sc.h")}
          </p>
          <ScoreBadge s={sc.total} size="lg" />
          <p className="fsc__band">
            <span data-k="score-band">{t(`farm.sc.band.${b}`)}</span> <SIButton record={scoreSI(ctx, t, noSoil)} describes={t("farm.sc.h")} />
          </p>
          <p className="fs-meta fsc__n">{t("farm.sc.in_score", { n: ctx.fields.length, m: fields.length })}</p>
        </div>
        <div className="fsc__parts">
          <SubBar lab={t("farm.sc.profit")} v={sc.profit} help={t("farm.sc.profit_help")} />
          <SubBar lab={t("farm.sc.risk")} v={sc.risk} help={t("farm.sc.risk_help")} />
          <SubBar lab={t("farm.sc.soil")} v={sc.soil} help={t("farm.sc.soil_help")} />
          <p className="fs-meta" data-k="score-weights">
            {custom ? t("farm.sc.weights_custom", { p: W.profit, r: W.risk, s: W.soil }) : t("farm.sc.weights", { goal: t(`farm.opt.risk_${goal}`), p: W.profit, r: W.risk, s: W.soil })}
          </p>
          <WeightSliders />
          <div className="fsc__dist" aria-label={t("farm.sc.dist_label")}>
            {counts
              .filter((c) => c.n)
              .map((c) => (
                <span key={c.k} className={cx("fsc__chip", BAND_CLASS[c.k])}>
                  {t("farm.sc.dist", { count: c.n, band: t(`farm.sc.band.${c.k}`) })}
                </span>
              ))}
          </div>
        </div>
        <div className="fsc__boost">
          <h3 className="fsc__boost-h">{t("farm.sc.boost_h")}</h3>
          {boosters.length ? (
            <ul className="fsc__boost-list">
              {boosters.map((x) => {
                const fr = ctx.fields.find((f) => f.id === x.fieldId)!;
                return (
                  <li key={x.fieldId}>
                    <span className="fsc__boost-txt">
                      <strong>{fr.name}</strong>
                      <span>{optName(x.fieldId, x.option)}</span>
                    </span>
                    <span className="fsc__gain">+{x.gain.toFixed(1)}</span>
                    <Button size="sm" variant="secondary" onClick={() => setPlan(x.fieldId, x.option === fr.baselineId ? null : x.option)} data-testid="farm-boost">
                      {t("farm.sc.try")}
                    </Button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="fs-meta">{t("farm.sc.boost_none")}</p>
          )}
        </div>
      </div>
    </section>
  );
}

type SortKey = "score_low" | "score_high" | "acres" | "name";

interface TileRow {
  ff: FarmField;
  run?: FieldRun;
  part?: FieldPart;
  s: Score | null;
  st?: { s: Status; reason?: string | null };
  left?: FarmCtx["left"][number];
  rep?: Report;
}

function CropStrip({ crops }: { crops: (string | null)[] }) {
  const { t } = useTranslation();
  const crop = useCropName();
  return (
    <span className="ftile__crops" aria-label={`${t("farm.board.next5")}: ${crops.map((c) => (c ? crop(c) : t("farm.board.fallow"))).join(", ")}`}>
      {crops.map((c, i) => (
        <span key={i} className={cx("ftile__crop", !c && "fs-hatch-bare")} style={c ? { background: cropColor(c), color: cropInk(c) } : undefined} title={c ? crop(c) : t("farm.board.fallow")} aria-hidden="true">
          {c ? crop(c).slice(0, 4) : "—"}
        </span>
      ))}
    </span>
  );
}

function FieldBoard({ ctx, a, m, data, fields }: { ctx: FarmCtx; a: Assignment; m: FarmMetrics; data: FarmData; fields: FarmField[] }) {
  const { t } = useTranslation();
  const f = useFmt();
  const risk = useScoreWeights();
  const [view, setView] = useState<"tiles" | "table">("tiles");
  const [sort, setSort] = useState<SortKey>("score_low");
  const [openId, setOpenId] = useState<string | null>(null);
  const tiles: TileRow[] = useMemo(() => {
    const rows: TileRow[] = fields.map((ff) => {
      const run = ctx.fields.find((x) => x.id === ff.id);
      return {
        ff,
        run,
        part: m.fields.find((x) => x.id === ff.id),
        s: run ? fieldScore(run, risk, a[run.id] ?? run.baselineId) : null,
        st: data.status[ff.id],
        left: ctx.left.find((x) => x.id === ff.id),
        rep: data.reports[ff.id],
      };
    });
    const sc = (r: TileRow) => (r.s && Number.isFinite(r.s.total) ? r.s.total : null);
    rows.sort((x, y) => {
      if (sort === "name") return x.ff.name.localeCompare(y.ff.name);
      if (sort === "acres") return (y.run?.acres ?? -1) - (x.run?.acres ?? -1);
      const sx = sc(x);
      const sy = sc(y);
      if (sx === null || sy === null) return sx === null && sy === null ? 0 : sx === null ? -1 : 1;
      return sort === "score_low" ? sx - sy : sy - sx;
    });
    return rows;
  }, [fields, ctx, m, risk, a, sort, data.status, data.reports]);
  const ranked = useMemo(() => {
    const xs = tiles.filter((r) => r.s && Number.isFinite(r.s.total)).sort((x, y) => y.s!.total - x.s!.total);
    return Object.fromEntries(xs.map((r, i) => [r.ff.id, i + 1]));
  }, [tiles]);
  const openRow = tiles.find((r) => r.ff.id === openId) ?? null;

  return (
    <section className="card-sec fboard" aria-labelledby="fboard-h">
      <div className="fboard__head">
        <div>
          <h2 id="fboard-h" className="fs-h2">
            {t("farm.board.h", { count: fields.length })}
          </h2>
          <p className="fs-meta">{t("farm.board.help")}</p>
        </div>
        <div className="fs-cluster fboard__ctl">
          {view === "tiles" ? (
            <label className="farm-select">
              <span>{t("farm.board.sort")}</span>
              <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} data-testid="farm-sort">
                {(["score_low", "score_high", "acres", "name"] as SortKey[]).map((k) => (
                  <option key={k} value={k}>
                    {t(`farm.board.sort_${k}`)}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <SegmentedToggle<"tiles" | "table">
            label={t("farm.board.view")}
            value={view}
            onChange={setView}
            options={[
              { value: "tiles", label: t("farm.board.tiles") },
              { value: "table", label: t("farm.board.table") },
            ]}
          />
        </div>
      </div>
      {view === "table" ? (
        <FieldsList ctx={ctx} m={m} data={data} fields={fields} embedded />
      ) : (
        <ul className="fboard__grid">
          {tiles.map((r) => {
            const run = r.run;
            const opt = run ? run.options[a[run.id] ?? run.baselineId] : null;
            const why =
              r.st?.s === "loading" || !r.st
                ? t("farm.st_loading")
                : r.st.s === "error"
                  ? t("farm.st_error")
                  : r.st.s === "unavailable"
                    ? t("farm.st_unavailable")
                    : r.left
                      ? t(`farm.left.${r.left.why}`)
                      : null;
            const place = [r.rep?.place?.county, r.rep?.place?.state].filter(Boolean).join(", ");
            return (
              <li key={r.ff.id} className={cx("ftile", !run && "is-pending", r.s && Number.isFinite(r.s.total) && BAND_CLASS[band(r.s.total)])} data-tile={r.ff.id}>
                <button type="button" className="ftile__btn" onClick={() => setOpenId(r.ff.id)} title={t("farm.board.open_label", { name: r.ff.name })}>
                  <span className="ftile__top">
                    {ranked[r.ff.id] ? <span className="ftile__rank">#{ranked[r.ff.id]}</span> : null}
                    <span className="ftile__name">{r.ff.name}</span>
                    {r.s ? <ScoreBadge s={r.s.total} size="sm" /> : <span className="fsc-badge fsc-badge--sm is-na">—</span>}
                  </span>
                  <span className="ftile__meta">
                    {[place && !r.ff.name.includes(place) ? place : null, run ? t("farm.board.acres_n", { v: f.num(run.acres) }) : null].filter(Boolean).join(" · ") || " "}
                  </span>
                  {!run ? (
                    <span className="ftile__why">
                      {r.st?.s === "loading" ? <span className="farm-busy__dot" aria-hidden="true" /> : null}
                      {why}
                    </span>
                  ) : (
                    <>
                      <CropStrip crops={opt?.cropYears ?? []} />
                      <span className="ftile__nums">
                        <span>
                          <small>{t("farm.board.typical")}</small>
                          <b className={cx(r.part && r.part.typicalField < 0 && "is-neg")}>{f.usd100(r.part?.typicalField)}</b>
                        </span>
                        <span>
                          <small>{t("farm.board.bad")}</small>
                          <b className={cx(r.part && r.part.badField < 0 && "is-neg")}>{f.usd100(r.part?.badField)}</b>
                        </span>
                        <span>
                          <small>{t("farm.board.loss")}</small>
                          <b>{r.s && Number.isFinite(r.s.pLoss) ? f.pct(r.s.pLoss) : "—"}</b>
                        </span>
                      </span>
                      {r.s ? (
                        <span className="ftile__bars" aria-hidden="true">
                          {(["profit", "risk", "soil"] as const).map((k) => {
                            const v = r.s![k];
                            return (
                              <span key={k} className="ftile__bar">
                                <small>{t(`farm.sc.${k}_short`)}</small>
                                <span className="ftile__track">
                                  {v !== null && Number.isFinite(v) ? <span className={cx("ftile__barfill", BAND_CLASS[band(v)])} style={{ width: `${(v / 10) * 100}%` }} /> : null}
                                </span>
                              </span>
                            );
                          })}
                        </span>
                      ) : null}
                      {run.plan !== run.baselineId || r.ff.locked ? (
                        <span className="ftile__tags">
                          {run.plan !== run.baselineId ? <span className="fs-chip fs-chip--sky">{t("farm.board.plan_changed")}</span> : null}
                          {r.ff.locked ? <span className="fs-chip">{t("farm.board.locked")}</span> : null}
                        </span>
                      ) : null}
                    </>
                  )}
                </button>
              </li>
            );
          })}
          {fields.length < MAX_FARM_FIELDS ? (
            <li className="ftile ftile--add">
              <button type="button" className="ftile__btn" onClick={() => useApp.getState().setView("home")}>
                <IconMap size={22} />
                <span>{t("farm.add_field")}</span>
              </button>
            </li>
          ) : null}
        </ul>
      )}
      {openRow ? <FieldDrawer ctx={ctx} a={a} row={openRow} data={data} onClose={() => setOpenId(null)} /> : null}
    </section>
  );
}

function FieldDrawer({ ctx, a, row, data, onClose }: { ctx: FarmCtx; a: Assignment; row: TileRow; data: FarmData; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const es = i18n.language === "es";
  const f = useFmt();
  const risk = useScoreWeights();
  const setPlan = useFarm((s) => s.setPlan);
  const lock = useFarm((s) => s.lock);
  const remove = useFarm((s) => s.remove);
  const selectField = useApp((s) => s.selectField);
  const ref = useRef<HTMLDivElement>(null);
  const { ff, run } = row;
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      prev?.focus?.();
    };
  }, []);
  const farmNow = useMemo(() => farmScore(ctx, a, risk), [ctx, a, risk]);
  const opts = useMemo(() => {
    if (!run) return [];
    return run.order
      .filter((id) => run.options[id])
      .map((id) => {
        const r = run.options[id];
        const fs = fieldScore(run, risk, id);
        const farm = id === (a[run.id] ?? run.baselineId) ? farmNow : farmScore(ctx, { ...a, [run.id]: id }, risk);
        return { id, r, fs, farm };
      });
  }, [run, risk, ctx, a, farmNow]);
  const open = (view?: "money") => {
    selectField({ id: ff.id, name: ff.name, lat: ff.lat, lon: ff.lon, meta: ff.meta ?? null, farm: ff.farm });
    if (view) usePlan.getState().open(view);
  };
  const label = (o: MoneyOption) => (o.is_baseline ? t("farm.keep_current", { name: o.rotation_label ?? o.name }) : (es && o.name_es) || o.name);
  const money = data.money[ff.id];
  const acres = run?.acres ?? (finite(money?.field?.acres) ? money!.field!.acres! : null);
  return (
    <div className="fdrawer" data-testid="farm-drawer">
      <div className="fdrawer__scrim" onClick={onClose} aria-hidden="true" />
      <div className="fdrawer__panel" ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="fdrawer-h">
        <div className="fdrawer__head">
          <div>
            <p className="fs-overline">{t("farm.drawer.over")}</p>
            <h2 id="fdrawer-h" className="fs-h2">
              {ff.name}
            </h2>
          </div>
          <Button size="sm" variant="ghost" className="fs-btn--icon" aria-label={t("farm.drawer.close")} onClick={onClose} icon={<IconClose size={16} />} />
        </div>
        {row.s ? (
          <div className="fdrawer__score">
            <ScoreBadge s={row.s.total} size="lg" />
            <div className="fdrawer__parts">
              <SubBar lab={t("farm.sc.profit")} v={row.s.profit} help={t("farm.sc.f_profit_help")} />
              <SubBar lab={t("farm.sc.risk")} v={row.s.risk} help={t("farm.sc.f_risk_help")} />
              <SubBar lab={t("farm.sc.soil")} v={row.s.soil} help={t("farm.sc.soil_help")} />
            </div>
          </div>
        ) : (
          <p className="money-note">{row.left ? t(`farm.left.${row.left.why}`) : t("farm.st_loading")}</p>
        )}
        <div className="fdrawer__row">
          <div className="fdrawer__acres">
            <span aria-hidden="true">{t("farm.col_acres")}</span>
            <AcresIn fid={ff.id} value={acres} fromBoundary={!useMoneyStore.getState().byField[ff.id]?.acres} />
          </div>
          {run ? (
            <label className="farm-lock" title={t("farm.lock_help")}>
              <input type="checkbox" checked={!!ff.locked} onChange={(e) => lock(ff.id, e.target.checked)} />
              <span>{t("farm.lock")}</span>
            </label>
          ) : null}
        </div>
        {run ? (
          <>
            <h3 className="fdrawer__h3">{t("farm.drawer.options_h")}</h3>
            <p className="fs-meta">{t("farm.drawer.options_help")}</p>
            <ul className="fdrawer__opts" role="radiogroup" aria-label={t("farm.drawer.options_h")}>
              {opts.map((o) => {
                const on = o.id === run.plan;
                const d = Math.round((o.farm.total - farmNow.total) * 10) / 10;
                return (
                  <li key={o.id}>
                    <button
                      type="button"
                      role="radio"
                      aria-checked={on}
                      disabled={!!ff.locked && !on}
                      className={cx("fdrawer__opt", on && "is-on")}
                      onClick={() => setPlan(ff.id, o.id === run.baselineId ? null : o.id)}
                      data-testid="farm-drawer-opt"
                    >
                      <span className="fdrawer__opt-top">
                        <span className="fdrawer__opt-name">
                          {label(o.r.opt)}
                          {o.id === run.baselineId ? <span className="fs-chip">{t("farm.drawer.current")}</span> : null}
                        </span>
                        <ScoreBadge s={o.fs.total} size="sm" />
                      </span>
                      <CropStrip crops={o.r.cropYears} />
                      <span className="fdrawer__opt-nums">
                        <span>{t("farm.drawer.typ_ac", { v: f.usd(o.r.typical) })}</span>
                        <span>{t("farm.drawer.bad_ac", { v: f.usd(o.r.bad) })}</span>
                        <span>{t("farm.drawer.loss", { p: Number.isFinite(o.fs.pLoss) ? f.pct(o.fs.pLoss) : "—" })}</span>
                      </span>
                      <span className={cx("fdrawer__farm", d > 0 ? "is-up" : d < 0 ? "is-down" : null)}>
                        {on ? t("farm.drawer.farm_now", { s: o.farm.total.toFixed(1) }) : t("farm.drawer.farm_if", { s: o.farm.total.toFixed(1), d: `${d > 0 ? "+" : d < 0 ? "−" : "±"}${Math.abs(d).toFixed(1)}` })}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </>
        ) : null}
        <div className="fs-cluster fdrawer__acts">
          <Button size="sm" onClick={() => open()}>
            {t("farm.drawer.open_field")}
          </Button>
          <Button size="sm" variant="secondary" onClick={() => open("money")}>
            {t("farm.drawer.open_money")}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              remove(ff.id);
              onClose();
            }}
          >
            {t("farm.drawer.remove")}
          </Button>
        </div>
        <details className="fdrawer__how">
          <summary>{t("farm.drawer.how_h")}</summary>
          <p className="fs-meta">{t("farm.sc.f_profit_help")}</p>
          <p className="fs-meta">{t("farm.sc.f_risk_help")}</p>
          <p className="fs-meta">{t("farm.sc.soil_help")}</p>
          <p className="fs-meta">{t("farm.sc.caveat")}</p>
        </details>
      </div>
    </div>
  );
}

function ScoreDelta({ ctx, opt }: { ctx: FarmCtx; opt: OptimizeResult }) {
  const { t } = useTranslation();
  const risk = useScoreWeights();
  const a = farmScore(ctx, opt.from, risk, opt.fromMetrics.pLoss).total;
  const b = farmScore(ctx, opt.assignment, risk, opt.metrics.pLoss).total;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return <Delta lab={t("farm.sc.h")} v={`${a.toFixed(1)} → ${b.toFixed(1)}`} good={b >= a} />;
}

/** The score weights in use: the farmer's own (sliders) or the goal's preset. */
function useScoreWeights(): Weights {
  const goal = useFarm((s) => s.settings.risk);
  const custom = useFarm((s) => s.settings.weights);
  return useMemo(() => custom ?? WEIGHTS[goal], [custom, goal]);
}

const WEIGHT_KEYS = ["profit", "risk", "soil"] as const;

function WeightSliders() {
  const { t } = useTranslation();
  const goal = useFarm((s) => s.settings.risk);
  const custom = useFarm((s) => s.settings.weights);
  const setSettings = useFarm((s) => s.setSettings);
  const W = custom ?? WEIGHTS[goal];
  // Slider positions are raw importances 0-100 (the presets as percentages); the shares beside them are normalised.
  const raw: Weights = { profit: Math.round(W.profit * (custom ? 1 : 100)), risk: Math.round(W.risk * (custom ? 1 : 100)), soil: Math.round(W.soil * (custom ? 1 : 100)) };
  const pct = weightPcts(raw);
  const id = useId();
  return (
    <details className="fsc__adjust" open={!!custom || undefined}>
      <summary data-testid="score-adjust">{t("farm.sc.adjust")}</summary>
      <p className="fs-meta">{t("farm.sc.adjust_help")}</p>
      <div className="fsc__sliders">
        {WEIGHT_KEYS.map((k) => (
          <div key={k} className="fsc__slider">
            <label htmlFor={`${id}-${k}`}>{t(`farm.sc.${k}`)}</label>
            <input
              id={`${id}-${k}`}
              type="range"
              min={0}
              max={100}
              step={5}
              value={raw[k]}
              aria-valuetext={`${pct[k]} %`}
              data-testid={`score-w-${k}`}
              onChange={(e) => {
                const next = { ...raw, [k]: Number(e.target.value) };
                if (next.profit + next.risk + next.soil <= 0) return; // at least one part must count
                setSettings({ weights: next });
              }}
            />
            <output htmlFor={`${id}-${k}`} className="fsc__pct">
              {pct[k]} %
            </output>
          </div>
        ))}
      </div>
      {custom ? (
        <Button size="sm" variant="ghost" onClick={() => setSettings({ weights: null })} data-testid="score-w-reset">
          {t("farm.sc.reset", { goal: t(`farm.opt.risk_${goal}`) })}
        </Button>
      ) : null}
    </details>
  );
}
