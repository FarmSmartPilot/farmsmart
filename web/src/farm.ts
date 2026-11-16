/* Whole farm (wave U9): pure portfolio arithmetic over several fields, and a deterministic plan search.
   No React, no fetches, no runtime imports except money.ts (itself pure), so it can be unit-tested on its own.

   Every number is arithmetic on the same building blocks as the money page (views/MoneyCalc.tsx): /money yield
   indices per real weather sequence (NASA POWER), USDA ERS price years and cost lines, USDA RMA loss history, and
   the farmer's own numbers. Fields are lined up on the calendar: sample (weather start year W, price year P) of one
   field is paired with the same (W, P) of every other field, so fields that share regional weather move together.
   Nothing here invents a value: a field or option without the numbers it needs is left out and said so. */

import {
  cashFlow,
  finite,
  isIncomplete,
  lossCauses,
  median,
  optionSamples,
  quantile,
  quantileSorted,
  recordsAverage,
  resolveCrop,
  slotsOf,
  startSlot,
  cropsInPlay,
} from "./money";
import type { CropEdits, FarmInput, Grid, Incomplete, InsuredLoss, LossCause, MoneyData, MoneyOption, Num, OptionResult, ResolvedCrop, Slot, Stress } from "./money";
import type { FieldMoney } from "./moneyStore";
import type { FieldBudgets, FieldRecords } from "./store";

/* ---------------- inputs per field (kept in step with views/MoneyCalc.tsx) ---------------- */

/** Planning unit of a crop ("bu", "cwt"…), as MoneyCalc's `unitOf` (market prices are used only when units agree). */
export function unitOf(u: string | null | undefined): string | null {
  if (!u) return null;
  if (/bushel|^bu\b/i.test(u)) return "bu";
  if (/cwt|hundredweight/i.test(u)) return "cwt";
  if (/pound|^lbs?\b/i.test(u)) return "lb";
  if (/ton/i.test(u)) return "ton";
  if (/bale/i.test(u)) return "bale";
  return u.length <= 8 ? u : null;
}

export interface FieldInputArgs {
  data: MoneyData;
  /** The money page's saved state for this field (useMoneyStore.byField[fid], or EMPTY). */
  st: FieldMoney;
  /** The farmer's saved budgets for this field (useApp.budgets[fid]). */
  budgets?: FieldBudgets | null;
  /** The farmer's own records for this field (useApp.records[fid]). */
  records?: FieldRecords | null;
  /** Market price levels per crop in the crop's planning unit (from /api/markets; only where units agree). */
  basis?: Record<string, { latest: number | null; wasde: number | null }>;
  /** hazards.insured_losses of /money, read with apiMoney.moneyHazards (null = not available). */
  insured?: { available: boolean; items: InsuredLoss[] } | null;
  /** The cost of fertilizer N the money page would use ($/lb N), worked out by the caller (nPricePerLb). */
  nDefault?: number | null;
  /** NRCS cover-crop payment the money page would use by default ($/ac), worked out by the caller (coverPayItems). */
  payDefault?: number | null;
}

export interface FieldInputs {
  crops: Record<string, ResolvedCrop>;
  farm: FarmInput;
  causes: LossCause[];
  /** The edits in force (the money page's, plus saved budgets it would copy in on first open). */
  edits: Record<string, CropEdits>;
  /** Crops priced with the farmer's own yield, price or costs (not only USDA regional averages). */
  ownCrops: string[];
  /** Field size: the farmer's number, else the boundary's. */
  acres: number | null;
  acresFromBoundary: boolean;
}

/**
 * The money page's inputs for one field, resolved exactly as views/MoneyCalc.tsx does: same defaults (USDA/M2),
 * same edits (useMoneyStore), saved budgets copied in the way the page seeds them, yields from the farmer's records,
 * market price bases, loss causes from crop-insurance records, N credits and cover payments when switched on.
 * KEEP IN SYNC with MoneyCalc.tsx (`Calculator`: seeding effect, `market`, `resolved`, `farm`, `causes`).
 */
export function fieldInputs(a: FieldInputArgs): FieldInputs {
  const { data, st } = a;
  const crops = data.crops ?? {};
  const options = data.options ?? [];
  const nP = data.price_years?.length ?? 0;
  // The money page copies saved budgets in once (st.seeded); until it has, do the same here without writing.
  const edits: Record<string, CropEdits> = { ...st.edits };
  if (!st.seeded) {
    for (const [cid, b] of Object.entries(a.budgets ?? {})) {
      if (!crops[cid] || edits[cid]) continue;
      const e: CropEdits = {};
      const recAvg = recordsAverage(a.records?.yields, cid)?.avg;
      if (finite(b.yield_bu_ac) && !(finite(recAvg) && Math.abs(Math.round(recAvg * 10) / 10 - b.yield_bu_ac) < 0.051)) e.yield = b.yield_bu_ac;
      if (finite(b.price_usd_bu)) e.price = b.price_usd_bu;
      if (finite(b.cost_usd_ac)) e.total = b.cost_usd_ac;
      if (Object.keys(e).length) edits[cid] = e;
    }
  }
  const resolved: Record<string, ResolvedCrop> = {};
  const ownCrops: string[] = [];
  for (const cid of cropsInPlay(options)) {
    const b = edits[cid]?.priceBasis;
    const m = a.basis?.[cid];
    const basisPrice = b === "latest" ? (m?.latest ?? null) : b === "wasde" ? (m?.wasde ?? null) : null;
    const r = resolveCrop(cid, crops[cid], edits[cid], nP, { basisPrice, ownYield: recordsAverage(a.records?.yields, cid)?.avg ?? null });
    resolved[cid] = r;
    if (r.edited.yield || r.edited.price || r.edited.cost || r.edited.overhead) ownCrops.push(cid);
  }
  const insuredOk = !!a.insured?.available && a.insured.items.length > 0;
  const acresDefault = finite(data.field?.acres) ? data.field!.acres! : null;
  const coverDefault = finite(data.cover?.cost_usd_ac) ? data.cover!.cost_usd_ac! : null;
  const nCredits = options.some((o) => o.positions.some((p) => finite(p.n_credit_lb_ac)));
  const nPriceUsed: Num = nCredits && st.nOn === true ? (st.nPrice !== undefined ? st.nPrice : (a.nDefault ?? null)) : null;
  const anyCover = options.some((o) => o.positions.some((x) => !!x.cover));
  const payUsed: Num = st.payOn && anyCover ? (st.payRate !== undefined ? st.payRate : (a.payDefault ?? null)) : null;
  const acres = st.acres !== undefined ? st.acres : acresDefault;
  const farm: FarmInput = {
    acres,
    coverCost: st.coverCost !== undefined ? st.coverCost : coverDefault,
    pumpCost: st.pumpCost ?? null,
    overhead: !!st.overhead,
    losses: st.losses ?? insuredOk,
    nPrice: nPriceUsed,
    coverPay: payUsed,
  };
  return {
    crops: resolved,
    farm,
    causes: insuredOk ? lossCauses(a.insured!.items) : [],
    edits,
    ownCrops,
    acres: finite(acres) && acres > 0 ? acres : null,
    acresFromBoundary: st.acres === undefined && acresDefault !== null,
  };
}

/* ---------------- the farm model ---------------- */

/** Soil and water indicators of one option (P50 of the compare card). */
export interface SoilWater {
  soil_cover?: number | null;
  erosion_water?: number | null;
  water_use?: number | null;
  soc_trend?: number | null;
}
export const SOIL_KEYS = ["soil_cover", "erosion_water", "water_use", "soc_trend"] as const;
export type SoilKey = (typeof SOIL_KEYS)[number];

/** Everything the farm math needs about one field. */
export interface FieldModel {
  id: string;
  name: string;
  data: MoneyData;
  inputs: FieldInputs;
  /** Crops on record, oldest first (for where year 1 of a rotation falls). */
  recent: (string | null | undefined)[];
  /** Soil and water indicators by option id (from /compare), when loaded. */
  soil?: Record<string, SoilWater>;
  /** The option the farmer planned (null = keep the current rotation). */
  plan: string | null;
  locked: boolean;
  /** One-time switch costs by option id (whole field $), from the money page. */
  oneTime?: Record<string, Num>;
}

export interface FieldOptionRun {
  id: string;
  opt: MoneyOption;
  nYears: number;
  /** Rotation-average net $/ac/yr on the aligned farm samples (k = i × nP + j). */
  net: Float64Array;
  /** Single-year nets $/ac, [k × nYears + y]. */
  yearNet: Float64Array;
  typical: number;
  bad: number;
  good: number;
  /** Year by year in a typical run (money.ts's definition, on the aligned samples). */
  yearTypical: number[];
  /** Crops of years 1..5 from where the field's record leaves off: main crop (null = fallow / none). */
  cropYears: (string | null)[];
  slotYears: Slot[];
  start: number;
}

export interface FieldRun {
  id: string;
  name: string;
  acres: number;
  baselineId: string;
  options: Record<string, FieldOptionRun>;
  /** Options in display order (current rotation first). */
  order: string[];
  incomplete: Incomplete[];
  locked: boolean;
  plan: string;
  soil?: Record<string, SoilWater>;
  own: boolean;
  oneTime?: Record<string, Num>;
}

export interface FarmCtx {
  stress: Stress;
  /** Common weather start years (calendar years) used. */
  weatherYears: number[];
  /** Common price years used (empty = no price history anywhere: one virtual price year). */
  priceYears: (number | string)[];
  nW: number;
  nP: number;
  N: number;
  /** Fields that can be worked out. */
  fields: FieldRun[];
  /** Fields left out, and why. */
  left: { id: string; name: string; why: "no_money" | "no_acres" | "no_years" | "incomplete" }[];
  /** Season rain threshold for drought years on the farm (mean over fields), when the drought stress is on. */
  dryThreshold: number | null;
  /** Common single years per sample (shortest simulated sequence among the fields). */
  nYearsCommon: number;
}

const YEARS_AHEAD = 5;

function numYears(xs: (number | string)[] | undefined): number[] {
  return (xs ?? []).map((v) => (typeof v === "number" ? v : Number(v))).filter((v) => Number.isFinite(v));
}

function intersect<T>(lists: T[][]): T[] {
  if (!lists.length) return [];
  let out = [...lists[0]];
  for (const l of lists.slice(1)) {
    const s = new Set(l);
    out = out.filter((x) => s.has(x));
  }
  return out;
}

/**
 * Line the fields up on common weather start years and price years and work out every complete option of every
 * field on those samples. A field with no price history (one virtual price year) pairs with every price year.
 * Drought stress: the farm's driest 20 % of years (acre-weighted mean season rain across the fields).
 */
export function prepareFarm(models: FieldModel[], stress: Stress): FarmCtx {
  const left: FarmCtx["left"] = [];
  const usable = models.filter((m) => {
    if (!m.data?.available) {
      left.push({ id: m.id, name: m.name, why: "no_money" });
      return false;
    }
    if (!m.inputs.acres) {
      left.push({ id: m.id, name: m.name, why: "no_acres" });
      return false;
    }
    if (!numYears(m.data.weather_years).length) {
      left.push({ id: m.id, name: m.name, why: "no_years" });
      return false;
    }
    return true;
  });
  let W = intersect(usable.map((m) => numYears(m.data.weather_years)));
  const withPrices = usable.filter((m) => (m.data.price_years?.length ?? 0) > 0);
  const Pc: (number | string)[] = withPrices.length ? intersect(withPrices.map((m) => (m.data.price_years ?? []).map((y) => String(y)))).map((y) => (Number.isFinite(Number(y)) ? Number(y) : y)) : [];
  let dryThreshold: number | null = null;
  if ((stress === "drought" || stress === "both") && W.length) {
    const rain = W.map((w) => {
      let s = 0;
      let wt = 0;
      for (const m of usable) {
        const i = numYears(m.data.weather_years).indexOf(w);
        const v = m.data.season_rain_mm?.[i];
        if (finite(v)) {
          s += v * (m.inputs.acres ?? 0);
          wt += m.inputs.acres ?? 0;
        }
      }
      return wt > 0 ? s / wt : NaN;
    });
    const thr = quantile(rain, 0.2);
    if (Number.isFinite(thr)) {
      dryThreshold = thr;
      const keep = W.filter((_, i) => Number.isFinite(rain[i]) && rain[i] <= thr);
      if (keep.length) W = keep;
    }
  }
  const nW = W.length;
  const nP = Math.max(1, Pc.length);
  const N = nW * nP;
  const priceFactor = stress === "prices" || stress === "both" ? 0.8 : 1;
  const fields: FieldRun[] = [];
  if (!N) {
    for (const m of usable) left.push({ id: m.id, name: m.name, why: "no_years" });
    return { stress, weatherYears: W, priceYears: Pc, nW, nP, N, fields, left, dryThreshold, nYearsCommon: 0 };
  }
  for (const m of usable) {
    const wy = numYears(m.data.weather_years);
    const Pf = Math.max(1, m.data.price_years?.length ?? 0);
    const pys = (m.data.price_years ?? []).map((y) => String(y));
    const grid: Grid = { s: W.map((w) => wy.indexOf(w)), P: Pf, priceFactor, dryThreshold: null };
    const pmap = Pc.length ? Pc.map((y) => Math.max(0, pys.indexOf(String(y)))) : [0];
    const opts = m.data.options ?? [];
    const base = opts.find((o) => o.is_baseline);
    const runs: Record<string, FieldOptionRun> = {};
    const incomplete: Incomplete[] = [];
    for (const o of opts) {
      const s = optionSamples(o, m.inputs.crops, m.inputs.farm, grid, m.inputs.causes);
      if (isIncomplete(s)) {
        incomplete.push(s);
        continue;
      }
      const net = new Float64Array(N);
      const yearNet = new Float64Array(N * s.nYears);
      for (let i = 0; i < nW; i++)
        for (let j = 0; j < nP; j++) {
          const k = i * nP + j;
          const kf = i * Pf + (pmap[j] ?? 0);
          net[k] = s.net[kf];
          for (let y = 0; y < s.nYears; y++) yearNet[k * s.nYears + y] = s.yearNet[kf * s.nYears + y];
        }
      if (!Array.from(net).some(Number.isFinite)) continue;
      const sorted = Array.from(net).filter(Number.isFinite).sort((x, y) => x - y);
      const start = startSlot(o, m.recent);
      const slots = slotsOf(o.positions);
      const slotYears = Array.from({ length: YEARS_AHEAD }, (_, k) => slots[(start + k) % Math.max(1, slots.length)] ?? { crop: null, double: null, cover: null });
      runs[o.id] = {
        id: o.id,
        opt: o,
        nYears: s.nYears,
        net,
        yearNet,
        typical: quantileSorted(sorted, 0.5),
        bad: quantileSorted(sorted, 0.1),
        good: quantileSorted(sorted, 0.9),
        yearTypical: yearTypicalOf(net, yearNet, s.nYears),
        cropYears: slotYears.map((x) => (x.crop && x.crop !== "fallow" ? x.crop : null)),
        slotYears,
        start,
      };
    }
    if (!base || !runs[base.id]) {
      left.push({ id: m.id, name: m.name, why: "incomplete" });
      continue;
    }
    const order = [base.id, ...opts.filter((o) => !o.is_baseline && runs[o.id]).map((o) => o.id)];
    const plan = m.plan && runs[m.plan] ? m.plan : base.id;
    fields.push({
      id: m.id,
      name: m.name,
      acres: m.inputs.acres!,
      baselineId: base.id,
      options: runs,
      order,
      incomplete,
      locked: m.locked,
      plan,
      soil: m.soil,
      own: m.inputs.ownCrops.length > 0,
      oneTime: m.oneTime,
    });
  }
  const nYearsCommon = fields.length ? Math.min(...fields.flatMap((f) => Object.values(f.options).map((o) => o.nYears))) : 0;
  return { stress, weatherYears: W, priceYears: Pc, nW, nP, N, fields, left, dryThreshold, nYearsCommon };
}

/** Net for each year of the simulated sequence in a typical run: mean of each year over the 40th–60th percentile
    runs (the same definition as money.ts `summarize`, so the money page and the farm agree). */
function yearTypicalOf(net: Float64Array, yearNet: Float64Array, nYears: number): number[] {
  const sorted = Array.from(net).filter(Number.isFinite).sort((a, b) => a - b);
  const lo = quantileSorted(sorted, 0.4);
  const hi = quantileSorted(sorted, 0.6);
  const band: number[] = [];
  for (let k = 0; k < net.length; k++) if (Number.isFinite(net[k]) && net[k] >= lo && net[k] <= hi) band.push(k);
  const out: number[] = [];
  for (let y = 0; y < nYears; y++) {
    let s = 0;
    let n = 0;
    for (const k of band) {
      const v = yearNet[k * nYears + y];
      if (Number.isFinite(v)) {
        s += v;
        n++;
      }
    }
    out.push(n ? s / n : NaN);
  }
  return out;
}

/* ---------------- metrics of one plan (field → option) ---------------- */

export type Assignment = Record<string, string>;

/** The farmer's plan as it stands (null = keep the current rotation). */
export const planAssignment = (ctx: FarmCtx): Assignment => Object.fromEntries(ctx.fields.map((f) => [f.id, f.plan]));
/** Every field keeps its current rotation. */
export const currentAssignment = (ctx: FarmCtx): Assignment => Object.fromEntries(ctx.fields.map((f) => [f.id, f.baselineId]));

export interface FieldPart {
  id: string;
  name: string;
  acres: number;
  option: string;
  /** $/ac/yr on the aligned samples. */
  typical: number;
  bad: number;
  good: number;
  /** Whole field $/yr. */
  typicalField: number;
  badField: number;
  /** Share of the farm's typical profit. */
  share: number | null;
}

export interface CashRow {
  year: number;
  net: number;
  base: number;
  diff: number;
  cum: number;
}

export interface FarmMetrics {
  acres: number;
  /** Whole farm $/yr (rotation average). */
  typical: number;
  bad: number;
  good: number;
  /** $/ac/yr. */
  typicalAc: number;
  badAc: number;
  goodAc: number;
  /** Share of single calendar years with a farm loss. */
  pLoss: number;
  worst: { net: number; weatherYear: number | null; priceYear: number | string | null } | null;
  /** Each field's own bad year × acres, added up; and how much better the farm's bad year is. */
  sumFieldBad: number;
  diversification: number;
  fields: FieldPart[];
  /** Acres by crop for years 1..5 (main crop; "fallow" for none). */
  mix: { year: number; acres: Record<string, number>; maxShare: number; maxCrop: string | null }[];
  /** Acre-weighted soil and water indicators, with the acres they cover. */
  soil: Record<SoilKey, { value: number | null; acres: number }>;
  cash: CashRow[] | null;
  /** Sorted farm nets (for the range chart). */
  nSamples: number;
  /** Farm net per sample, whole farm $ (k = i × nP + j). */
  farmNet: Float64Array;
}

function farmNetOf(ctx: FarmCtx, a: Assignment): Float64Array {
  const out = new Float64Array(ctx.N);
  for (const f of ctx.fields) {
    const r = f.options[a[f.id]] ?? f.options[f.baselineId];
    for (let k = 0; k < ctx.N; k++) out[k] += f.acres * r.net[k];
  }
  return out;
}

export function cropMix(ctx: FarmCtx, a: Assignment): FarmMetrics["mix"] {
  const tot = ctx.fields.reduce((s, f) => s + f.acres, 0);
  return Array.from({ length: YEARS_AHEAD }, (_, y) => {
    const acres: Record<string, number> = {};
    for (const f of ctx.fields) {
      const r = f.options[a[f.id]] ?? f.options[f.baselineId];
      const c = r.cropYears[y] ?? "fallow";
      acres[c] = (acres[c] ?? 0) + f.acres;
    }
    let maxShare = 0;
    let maxCrop: string | null = null;
    for (const [c, v] of Object.entries(acres)) {
      if (c === "fallow") continue;
      const s = tot > 0 ? v / tot : 0;
      if (s > maxShare) {
        maxShare = s;
        maxCrop = c;
      }
    }
    return { year: y + 1, acres, maxShare, maxCrop };
  });
}

export function farmMetrics(ctx: FarmCtx, a: Assignment): FarmMetrics {
  const acres = ctx.fields.reduce((s, f) => s + f.acres, 0);
  const farmNet = farmNetOf(ctx, a);
  const sorted = Array.from(farmNet).filter(Number.isFinite).sort((x, y) => x - y);
  const typical = quantileSorted(sorted, 0.5);
  const bad = quantileSorted(sorted, 0.1);
  const good = quantileSorted(sorted, 0.9);
  // Single calendar years: year y of every field's run that starts in weather year W (shortest sequence shared).
  const Y = ctx.nYearsCommon;
  let losing = 0;
  let years = 0;
  let worst: FarmMetrics["worst"] = null;
  for (let i = 0; i < ctx.nW; i++)
    for (let j = 0; j < ctx.nP; j++) {
      const k = i * ctx.nP + j;
      for (let y = 0; y < Y; y++) {
        let v = 0;
        let ok = true;
        for (const f of ctx.fields) {
          const r = f.options[a[f.id]] ?? f.options[f.baselineId];
          const x = r.yearNet[k * r.nYears + y];
          if (!Number.isFinite(x)) {
            ok = false;
            break;
          }
          v += f.acres * x;
        }
        if (!ok) continue;
        years++;
        if (v < 0) losing++;
        if (!worst || v < worst.net) worst = { net: v, weatherYear: ctx.weatherYears[i] + y, priceYear: ctx.priceYears.length ? ctx.priceYears[j] : null };
      }
    }
  const fields: FieldPart[] = ctx.fields.map((f) => {
    const r = f.options[a[f.id]] ?? f.options[f.baselineId];
    return {
      id: f.id,
      name: f.name,
      acres: f.acres,
      option: r.id,
      typical: r.typical,
      bad: r.bad,
      good: r.good,
      typicalField: r.typical * f.acres,
      badField: r.bad * f.acres,
      share: typical !== 0 && Number.isFinite(typical) ? (r.typical * f.acres) / typical : null,
    };
  });
  const sumFieldBad = fields.reduce((s, x) => s + x.badField, 0);
  // Soil and water: acre-weighted over the fields whose compare cards are loaded.
  const soil = Object.fromEntries(
    SOIL_KEYS.map((key) => {
      let s = 0;
      let w = 0;
      for (const f of ctx.fields) {
        const v = f.soil?.[a[f.id] ?? f.baselineId]?.[key];
        if (finite(v)) {
          s += v * f.acres;
          w += f.acres;
        }
      }
      return [key, { value: w > 0 ? s / w : null, acres: w }];
    }),
  ) as FarmMetrics["soil"];
  return {
    acres,
    typical,
    bad,
    good,
    typicalAc: acres ? typical / acres : NaN,
    badAc: acres ? bad / acres : NaN,
    goodAc: acres ? good / acres : NaN,
    pLoss: years ? losing / years : NaN,
    worst,
    sumFieldBad,
    diversification: bad - sumFieldBad,
    fields,
    mix: cropMix(ctx, a),
    soil,
    cash: farmCash(ctx, a),
    nSamples: sorted.length,
    farmNet,
  };
}

/** Share of paired samples (same weather and price years) where plan `a` beats plan `b` for the whole farm. */
export function pBeat(ctx: FarmCtx, a: Assignment, b: Assignment): number | null {
  const x = farmNetOf(ctx, a);
  const y = farmNetOf(ctx, b);
  let win = 0;
  let n = 0;
  for (let k = 0; k < ctx.N; k++) {
    if (!Number.isFinite(x[k]) || !Number.isFinite(y[k])) continue;
    n++;
    if (x[k] > y[k]) win++;
  }
  return n ? win / n : null;
}

/** Years 1..5 of the plan for the whole farm in a typical year, vs every field keeping its current rotation:
    the sum of each field's money-page cash flow (one-time switch costs in year 1). */
export function farmCash(ctx: FarmCtx, a: Assignment): CashRow[] | null {
  const rows: CashRow[] = Array.from({ length: YEARS_AHEAD }, (_, k) => ({ year: k + 1, net: 0, base: 0, diff: 0, cum: 0 }));
  let oneTotal = 0;
  for (const f of ctx.fields) {
    const o = f.options[a[f.id]] ?? f.options[f.baselineId];
    const b = f.options[f.baselineId];
    const one = o.id !== b.id ? f.oneTime?.[o.id] : null;
    const cf = cashFlow(
      { r: { yearTypical: o.yearTypical } as OptionResult, opt: o.opt, start: o.start },
      { r: { yearTypical: b.yearTypical } as OptionResult, opt: b.opt, start: b.start },
      YEARS_AHEAD,
      f.acres,
      finite(one) ? one : 0,
    );
    if (!cf) return null;
    cf.rows.forEach((r, k) => {
      rows[k].net += r.net;
      rows[k].base += r.base;
      rows[k].diff += r.diff;
    });
    // As on the money page: one-time switch costs are paid in year 1 and count in the running total only.
    if (finite(one) && one > 0) oneTotal += one;
  }
  let cum = -oneTotal;
  for (const r of rows) {
    cum += r.diff;
    r.cum = cum;
  }
  return rows;
}

/** Pairwise correlation of the fields' single-year nets ($/ac) over the shared samples and years. */
export function fieldCorrelation(ctx: FarmCtx, a: Assignment): { ids: string[]; r: number[][]; mean: number | null } {
  const ids = ctx.fields.map((f) => f.id);
  const Y = ctx.nYearsCommon;
  const series = ctx.fields.map((f) => {
    const o = f.options[a[f.id]] ?? f.options[f.baselineId];
    const out: number[] = [];
    for (let k = 0; k < ctx.N; k++) for (let y = 0; y < Y; y++) out.push(o.yearNet[k * o.nYears + y]);
    return out;
  });
  const r = ids.map((_, i) => ids.map((__, j) => (i === j ? 1 : pearson(series[i], series[j]))));
  const offs: number[] = [];
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) if (Number.isFinite(r[i][j])) offs.push(r[i][j]);
  return { ids, r, mean: offs.length ? offs.reduce((s, v) => s + v, 0) / offs.length : null };
}

function pearson(x: number[], y: number[]): number {
  let n = 0;
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < x.length; i++)
    if (Number.isFinite(x[i]) && Number.isFinite(y[i])) {
      n++;
      sx += x[i];
      sy += y[i];
    }
  if (n < 3) return NaN;
  const mx = sx / n;
  const my = sy / n;
  let cxy = 0;
  let cxx = 0;
  let cyy = 0;
  for (let i = 0; i < x.length; i++)
    if (Number.isFinite(x[i]) && Number.isFinite(y[i])) {
      cxy += (x[i] - mx) * (y[i] - my);
      cxx += (x[i] - mx) ** 2;
      cyy += (y[i] - my) ** 2;
    }
  return cxx > 0 && cyy > 0 ? cxy / Math.sqrt(cxx * cyy) : NaN;
}

/* ---------------- optimizer ---------------- */

export type Risk = "money" | "balanced" | "safe";
export const RISKS: Risk[] = ["money", "balanced", "safe"];

export interface OptimizeSettings {
  risk: Risk;
  /** Largest share of the farm's acres one crop may take in any of years 1..5 (null = no limit). */
  maxCropShare: number | null;
}

function objective(sorted: number[], risk: Risk): number {
  const typ = quantileSorted(sorted, 0.5);
  const bad = quantileSorted(sorted, 0.1);
  return risk === "money" ? typ : risk === "safe" ? bad : (typ + bad) / 2;
}

/** How far a plan is over the crop-share limit (0 = within it), summed over years 1..5. */
function violation(ctx: FarmCtx, a: Assignment, cap: number | null): number {
  if (cap === null) return 0;
  return cropMix(ctx, a).reduce((s, y) => s + Math.max(0, y.maxShare - cap - 1e-9), 0);
}

export interface FieldReason {
  id: string;
  name: string;
  from: string;
  to: string;
  changed: boolean;
  locked: boolean;
  /** This field's change alone, with every other field as suggested: whole-farm $ per year. */
  dTypical: number | null;
  dBad: number | null;
  /** Undoing this change alone would break the crop-share limit. */
  forCap: boolean;
}

export interface OptimizeResult {
  settings: OptimizeSettings;
  assignment: Assignment;
  /** The plan it started from (the farmer's plan as it stands). */
  from: Assignment;
  metrics: FarmMetrics;
  fromMetrics: FarmMetrics;
  /** Share of paired samples where the suggestion beats the plan as it stands (null = same plan). */
  pBeat: number | null;
  /** The crop-share limit could not be met (best effort shown). */
  capMissed: boolean;
  /** The suggestion is the plan as it stands. */
  same: boolean;
  reasons: FieldReason[];
  sweeps: number;
  confidence: { level: "high" | "medium" | "low"; why: { key: string; params?: Record<string, unknown> }[] };
}

/**
 * Deterministic plan search: coordinate ascent (each unlocked field in turn tries every complete option; the best
 * for the whole farm is kept), started from the plan as it stands and from each field's own best, up to 50 sweeps
 * each. A plan within the crop-share limit always beats one over it. Locked fields keep their plan.
 */
export function optimizeFarm(ctx: FarmCtx, s: OptimizeSettings): OptimizeResult | null {
  if (!ctx.fields.length || !ctx.N) return null;
  const from = planAssignment(ctx);
  const cap = s.maxCropShare !== null && s.maxCropShare > 0 && s.maxCropShare < 1 ? s.maxCropShare : null;
  const cands = ctx.fields.map((f) => (f.locked ? [from[f.id]] : f.order));
  const score = (a: Assignment, net: Float64Array): [number, number] => {
    const sorted = Array.from(net).filter(Number.isFinite).sort((x, y) => x - y);
    return [violation(ctx, a, cap), objective(sorted, s.risk)];
  };
  const better = (x: [number, number], y: [number, number]) => x[0] < y[0] - 1e-9 || (Math.abs(x[0] - y[0]) <= 1e-9 && x[1] > y[1] + 1e-6);

  const ascend = (start: Assignment): { a: Assignment; sc: [number, number]; sweeps: number } => {
    const a = { ...start };
    const net = farmNetOf(ctx, a);
    let sc = score(a, net);
    let sweeps = 0;
    for (; sweeps < 50; sweeps++) {
      let changed = false;
      ctx.fields.forEach((f, fi) => {
        let bestId = a[f.id];
        let bestSc = sc;
        const cur = f.options[a[f.id]];
        for (const id of cands[fi]) {
          if (id === a[f.id]) continue;
          const o = f.options[id];
          const trial = new Float64Array(ctx.N);
          for (let k = 0; k < ctx.N; k++) trial[k] = net[k] + f.acres * (o.net[k] - cur.net[k]);
          const tsc = score({ ...a, [f.id]: id }, trial);
          if (better(tsc, bestSc)) {
            bestSc = tsc;
            bestId = id;
          }
        }
        if (bestId !== a[f.id]) {
          const o = f.options[bestId];
          for (let k = 0; k < ctx.N; k++) net[k] += f.acres * (o.net[k] - cur.net[k]);
          a[f.id] = bestId;
          sc = bestSc;
          changed = true;
        }
      });
      if (!changed) break;
    }
    return { a, sc, sweeps: sweeps + 1 };
  };

  // Start 2: every unlocked field on its own best by the same measure (per acre).
  const own: Assignment = {};
  ctx.fields.forEach((f, fi) => {
    let best = cands[fi][0];
    let bv = -Infinity;
    for (const id of cands[fi]) {
      const o = f.options[id];
      const v = s.risk === "money" ? o.typical : s.risk === "safe" ? o.bad : (o.typical + o.bad) / 2;
      if (v > bv + 1e-9) {
        bv = v;
        best = id;
      }
    }
    own[f.id] = best;
  });
  const runs = [ascend(from), ascend(own)];
  let best = runs[0];
  for (const r of runs.slice(1)) if (better(r.sc, best.sc)) best = r;
  const assignment = best.a;
  const metrics = farmMetrics(ctx, assignment);
  const fromMetrics = farmMetrics(ctx, from);
  const same = ctx.fields.every((f) => assignment[f.id] === from[f.id]);
  const pb = same ? null : pBeat(ctx, assignment, from);
  const reasons: FieldReason[] = ctx.fields.map((f) => {
    const changed = assignment[f.id] !== from[f.id];
    let dTypical: number | null = null;
    let dBad: number | null = null;
    let forCap = false;
    if (changed) {
      const backA = { ...assignment, [f.id]: from[f.id] };
      const back = farmMetrics(ctx, backA);
      dTypical = metrics.typical - back.typical;
      dBad = metrics.bad - back.bad;
      forCap = violation(ctx, backA, cap) > violation(ctx, assignment, cap) + 1e-9;
    }
    return { id: f.id, name: f.name, from: from[f.id], to: assignment[f.id], changed, locked: f.locked, dTypical, dBad, forCap };
  });
  return {
    settings: s,
    assignment,
    from,
    metrics,
    fromMetrics,
    pBeat: pb,
    capMissed: best.sc[0] > 1e-9,
    same,
    reasons,
    sweeps: best.sweeps,
    confidence: planConfidence(ctx, pb),
  };
}

/** Confidence in a suggested plan: how many real seasons × price years it rests on, how often it beats the plan as
    it stands, and how much of the farm runs on the farmer's own numbers rather than USDA regional averages. */
export function planConfidence(ctx: FarmCtx, pb: number | null): OptimizeResult["confidence"] {
  const why: { key: string; params?: Record<string, unknown> }[] = [];
  let score = 3;
  const n = ctx.nW * ctx.nP;
  const y0 = ctx.weatherYears[0];
  const y1 = ctx.weatherYears[ctx.weatherYears.length - 1];
  why.push({ key: "conf_samples", params: { s: ctx.nW, p: ctx.priceYears.length || 1, y0, y1 } });
  if (ctx.nW < 15 || n < 100) {
    score--;
    why.push({ key: "conf_few" });
  }
  if (!ctx.priceYears.length) {
    score--;
    why.push({ key: "conf_no_prices" });
  }
  if (pb !== null) {
    const k = Math.round(pb * 10);
    why.push({ key: "conf_beat", params: { k } });
    if (pb < 0.6) score--;
  }
  const tot = ctx.fields.reduce((s, f) => s + f.acres, 0);
  const ownAc = ctx.fields.filter((f) => f.own).reduce((s, f) => s + f.acres, 0);
  const ownShare = tot ? ownAc / tot : 0;
  if (ownShare < 0.5) {
    score--;
    why.push({ key: "conf_usda" });
  } else why.push({ key: "conf_own", params: { pct: Math.round(ownShare * 100) } });
  why.push({ key: "conf_regional" });
  // Regional weather and assumed same management: never more than medium without the farmer's own numbers.
  const level = score >= 3 ? "high" : score === 2 ? "medium" : "low";
  return { level, why };
}

/** Median of a farm net array (whole-farm $) and its 10th/90th percentiles. */
export function farmRange(net: Float64Array): { typical: number; bad: number; good: number } {
  return { typical: median(net), bad: quantile(net, 0.1), good: quantile(net, 0.9) };
}
