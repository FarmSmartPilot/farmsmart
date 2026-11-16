/* Money calculator (wave U6): pure functions from the /money building blocks plus the farmer's inputs to revenue,
   costs and risk per rotation option. No React, no fetches, no runtime imports, so it can be unit-tested on its own.
   Every number it returns is arithmetic on API values (simulated yield indices from real NASA POWER weather, USDA ERS
   prices and costs, USDA RMA loss history) or on the farmer's own numbers. Nothing is invented here: a missing input
   makes the option "incomplete" rather than filled with a guess.

   Method (one line, shown in the UI): every option runs through every real weather sequence (S) and every recent
   price year (P); for each pair, net per acre = yield × price − costs, averaged over the rotation's years. Typical =
   median, bad year = 10th percentile, good year = 90th percentile. */

export type Num = number | null;

/* ---------------- API shapes (POST /api/fields/{fid}/money, docs/reference/WAVE_U6_MONEY.md) ---------------- */

export interface MoneyCostLine {
  id: string;
  label_en: string;
  label_es?: string | null;
  usd_ac: number | null;
}

export interface MoneyCrop {
  name: string;
  name_es?: string | null;
  unit?: string | null;
  yield?: {
    typical: number | null;
    source?: string | null;
    si?: boolean;
    unit?: string | null;
    scale?: string | null;
    p10?: number | null;
    p90?: number | null;
    model?: string | null;
    confidence?: { level: "high" | "medium" | "low"; score?: number; reasons: string[] } | null;
  } | null;
  price?: { values: (number | null)[]; typical: number | null; source?: string | null } | null;
  costs?: MoneyCostLine[] | null;
  overhead?: MoneyCostLine[] | null;
  cost_years?: string | null;
  costs_available?: boolean;
  /** USDA's yearly operating total (median) the comparison's profit uses; the lines are each their own median. */
  operating_total_used_in_comparison?: number | null;
  notes?: string[] | null;
  evidence?: Record<string, unknown> | null;
  /** USDA NASS published yields for the field's county (or state when the county is withheld), wave U9. */
  yield_history?: YieldHistory | null;
  /** Published budgets for the field's state (Iowa: ISU Ag Decision Maker A1-20), wave U9. */
  benchmarks?: Benchmarks | null;
}

/** USDA NASS Quick Stats yields (county average, or state with fallback_reason): context, never the field's yield. */
export interface YieldHistory {
  available: boolean;
  reason?: string | null;
  source?: string;
  url?: string;
  citation?: string;
  level?: "county" | "state" | string;
  fallback_reason?: string | null;
  county?: string | null;
  state?: string | null;
  unit?: string | null;
  years?: number[];
  values?: (number | null)[];
  n_years?: number;
  trend?: { slope_per_yr: number; intercept: number; value_last_year?: number | null; basis?: string } | null;
  detrended_cv?: number | null;
  scale?: string;
  note?: string | null;
}

/** One cost line of a published budget regrouped onto the calculator's line ids (USDA ERS ids, plus crop_insurance). */
export interface BenchLine {
  id: string;
  usd_ac: number;
  from?: string[];
  group: "operating" | "overhead" | string;
  note?: string | null;
}
export interface BenchItem {
  id: string;
  label: string;
  label_es?: string | null;
  url?: string;
  year?: number;
  yield_assumption?: number | null;
  unit?: string | null;
  operating_usd_ac?: number | null;
  fixed_usd_ac?: number | null;
  total_usd_ac?: number | null;
  calculator_lines?: BenchLine[];
  source?: string;
  pdf_url?: string;
  notes?: string | null;
  notes_es?: string | null;
}
export interface Benchmarks {
  available: boolean;
  reason?: string | null;
  items?: BenchItem[];
  source?: string;
  product?: string;
  url?: string;
  year?: number;
  citation?: string;
  operating_definition?: string;
  fixed_definition?: string;
  scale?: string;
  scale_es?: string;
}

/** What the headline counts (wave U9): USDA ERS cost items in the operating and overhead lines, and what they leave out. */
export interface CostCoverage {
  available?: boolean;
  operating?: string[];
  overhead?: string[];
  not_included?: string[];
  operating_es?: string[];
  overhead_es?: string[];
  not_included_es?: string[];
  notes?: string[];
  notes_es?: string[];
  headline?: { operating_only_en?: string; operating_only_es?: string; all_costs_en?: string; all_costs_es?: string } | null;
  source?: string;
  url?: string;
}

/** How many real seasons and price years the samples rest on (wave U9). */
export interface MoneyEvidence {
  weather_seasons?: number | null;
  weather_years?: (number | string)[] | null;
  weather_years_covered?: (number | string)[] | null;
  price_years?: number | null;
  price_range?: (number | string)[] | null;
  combinations?: number | null;
  definition?: string | null;
  weather_source?: string | null;
  price_source?: string | null;
}

/** NOAA NCEI Storm Events for the county (wave U9). */
export interface StormItem {
  type: string;
  event_type?: string;
  label_en: string;
  label_es?: string | null;
  years_with_event: number | null;
  years: number | null;
  p?: number | null;
  last?: number | null;
  events?: number | null;
  events_county?: number | null;
  events_zone?: number | null;
  crop_damage_usd_total?: number | null;
  crop_damage_years?: number | null;
  crop_damage_max_year?: number | null;
}

export interface MoneyPosition {
  crop: string | null;
  /** "cash" | "double" | "forage" | "fallow"; a double crop shares its year with the position before it. */
  kind?: string | null;
  cover?: string | null;
  yield_index?: (number | null)[] | null;
  irrigation_mm?: (number | null)[] | null;
  /** Legume nitrogen credit this crop gets from the crop or cover before it (rules engine midpoint), lb N/ac. */
  n_credit_lb_ac?: number | null;
  n_credit_range_lb_ac?: (number | null)[] | null;
}

export interface MoneyOption {
  id: string;
  name: string;
  name_es?: string | null;
  rotation_label?: string | null;
  family_name?: string | null;
  family_name_es?: string | null;
  is_baseline?: boolean;
  is_custom?: boolean;
  best_for_you?: boolean;
  rank?: number | null;
  /** Years in the simulated sequence (the rotation average divides by this). */
  years?: number | null;
  /** Years in one cycle of the rotation (the simulated sequence repeats it). */
  cycle_years?: number | null;
  /** The comparison's own typical profit ($/ac/yr), for checking the calculator against it. */
  profit_p50_compare?: number | null;
  positions: MoneyPosition[];
}

export interface WeatherHazard {
  id: string;
  label_en: string;
  label_es?: string | null;
  years_hit: number | null;
  years: number | null;
  p: number | null;
  last?: number | null;
  source?: string | null;
  scale?: string | null;
}

export interface InsuredLoss {
  crop: string;
  cause: string;
  cause_es?: string | null;
  years_hit: number | null;
  years: number | null;
  p: number | null;
  avg_loss_usd_ac_when_hit: number | null;
  mean_loss_usd_ac?: number | null;
  /** Last year with a payout, when the API gives it. */
  last?: number | string | null;
  /** true = weather the simulation already covers (drought, heat, in-season freeze): never added again. */
  in_simulation?: boolean;
}

export interface Declaration {
  type?: string | null;
  weather_related?: boolean | null;
  incident_type?: string | null;
  label_en?: string | null;
  label_es?: string | null;
  count?: number | null;
  n?: number | null;
  years_hit?: number | null;
  /** Number of years covered, or the list of years with a declaration (OpenFEMA by-type summary). */
  years?: number | null | number[];
  last?: number | string | null;
}

export interface MoneyData {
  available: boolean;
  reason?: string | null;
  field?: { acres?: number | null; hectares?: number | null; irrigated?: boolean | null } | null;
  region?: string | null;
  currency?: string | null;
  costs_available?: boolean;
  weather_years?: (number | string)[];
  season_rain_mm?: (number | null)[];
  price_years?: (number | string)[];
  crops?: Record<string, MoneyCrop>;
  cover?: { cost_usd_ac?: number | null; range?: number[] | null; source?: string | null } | null;
  options?: MoneyOption[];
  notes?: string[];
  hazards?: Record<string, unknown> | null;
  /** USDA NRCS EQIP payment rates for the field's state (wave U8). */
  costshare?: CostShare | null;
  /** Latest World Bank urea price and the derived $/lb N (wave U8). */
  fertilizer_n_price?: FertNPrice | null;
  /** How the legume N credit is worked out, and what is not counted. */
  n_credit?: { what?: string | null; not_counted?: string | null } | null;
  /** Wave U9: seasons × price years behind the samples, and what the cost lines cover. */
  evidence?: MoneyEvidence | null;
  cost_coverage?: CostCoverage | null;
}

export interface CostShareItem {
  practice?: string | null;
  name_en?: string | null;
  name_es?: string | null;
  usd_ac?: number | null;
  /** Rate for historically underserved producers, where published. */
  usd_ac_hu?: number | null;
  is_default_cover?: boolean | null;
  scenario?: string | null;
  unit?: string | null;
  notes?: string | null;
}

export interface CostShare {
  available: boolean;
  reason?: string | null;
  state?: string | null;
  fiscal_year?: number | string | null;
  items?: CostShareItem[] | null;
  source?: string | null;
  url?: string | null;
  caveat_en?: string | null;
  caveat_es?: string | null;
  hu_note_en?: string | null;
  hu_note_es?: string | null;
}

export interface FertNPrice {
  available?: boolean;
  reason?: string | null;
  urea_usd_mt?: number | null;
  usd_lb_n?: number | null;
  usd_per_lb_n?: number | null;
  month?: string | null;
  source?: string | null;
  url?: string | null;
  note?: string | null;
  scope?: string | null;
}

/** $/lb N from the API block: given directly, or derived from urea $/mt (urea is 46 % N; 2204.62 lb per metric ton). */
export function nPricePerLb(f: FertNPrice | null | undefined): number | null {
  if (!f || f.available === false) return null;
  const direct = finite(f.usd_lb_n) ? f.usd_lb_n : finite(f.usd_per_lb_n) ? f.usd_per_lb_n : null;
  if (direct !== null && direct > 0) return direct;
  if (finite(f.urea_usd_mt) && f.urea_usd_mt > 0) return f.urea_usd_mt / 2204.62 / 0.46;
  return null;
}

/** Cover-crop (NRCS practice 340) rates of the cost-share block, each followed by its historically underserved rate
    where published (`hu: true`); the state's default cover scenario first. */
export function coverPayItems(cs: CostShare | null | undefined): (CostShareItem & { hu?: boolean })[] {
  if (!cs?.available) return [];
  const base = (cs.items ?? [])
    .filter((x) => x && finite(x.usd_ac) && x.usd_ac > 0 && (String(x.practice ?? "").startsWith("340") || /cover/i.test(x.name_en ?? "")))
    .sort((a, b) => Number(!!b.is_default_cover) - Number(!!a.is_default_cover));
  const out: (CostShareItem & { hu?: boolean })[] = [];
  for (const x of base) {
    out.push(x);
    if (finite(x.usd_ac_hu) && x.usd_ac_hu > 0 && x.usd_ac_hu !== x.usd_ac) out.push({ ...x, usd_ac: x.usd_ac_hu, hu: true });
  }
  return out;
}

/** Legume N credit per acre a year for an option: Σ credits over its positions ÷ its years (0 when none). */
export function nCreditPerYear(o: MoneyOption): number {
  const yp = yearOfPositions(o.positions);
  const nYears = finite(o.years) && o.years > 0 ? Math.round(o.years) : yp.nYears;
  let lb = 0;
  for (const p of o.positions) if (finite(p.n_credit_lb_ac) && p.n_credit_lb_ac > 0) lb += p.n_credit_lb_ac;
  return lb / nYears;
}

/** The API sent N credits (any option, any position, even 0). */
export const hasNCredits = (opts: MoneyOption[]) => opts.some((o) => o.positions.some((p) => finite(p.n_credit_lb_ac)));

/* ---------------- the farmer's inputs ---------------- */

/** Edits over the USDA/M2 defaults for one crop. `undefined` = use the default, `null` = the box was cleared. */
export type PriceBasis = "usda" | "latest" | "wasde" | "own";

export interface CropEdits {
  yield?: Num;
  price?: Num;
  /** Which price level to plan with (default "usda"); the year-to-year shape is kept and scaled to it. */
  priceBasis?: PriceBasis;
  /** A typed total operating cost ($/ac). When set it replaces the sum of the cost lines. */
  total?: Num;
  lines?: Record<string, Num>;
  overhead?: Record<string, Num>;
}

export interface ResolvedLine {
  id: string;
  label_en: string;
  label_es?: string | null;
  usda: number | null;
  value: number | null;
  edited: boolean;
}

/** One crop's effective numbers (defaults with the farmer's edits applied). */
export interface ResolvedCrop {
  id: string;
  yield: Num;
  price: Num;
  /** Operating cost $/ac (typed total, or the sum of the lines). null = unknown (no USDA lines, nothing typed). */
  opCost: Num;
  lines: ResolvedLine[];
  overheadLines: ResolvedLine[];
  overhead: number;
  land: number | null;
  /** Price shape: values[p] / median(values), one per price year (1 when the crop has no price history). */
  priceRatio: number[];
  usda: { yield: Num; price: Num; opCost: Num };
  edited: { yield: boolean; price: boolean; cost: boolean; overhead: boolean };
  /** The price level in use. */
  priceBasis: PriceBasis;
  /** The yield comes from the farmer's own records (no typed yield). */
  yieldFromRecords: boolean;
  /** Has USDA cost lines for this crop (else the farmer types a total). */
  hasLines: boolean;
}

export interface FarmInput {
  acres: Num;
  /** Cover crop seed and planting, $/ac per cover. */
  coverCost: Num;
  /** Irrigation pumping $/acre-inch (null = not counted). */
  pumpCost: Num;
  /** Include fixed costs (land, machinery, labour, general overhead). */
  overhead: boolean;
  /** Draw the losses the weather model does not cover (hail, flood, wind…) from crop-insurance history. */
  losses: boolean;
  /** Fertilizer price $/lb N: legume N credits are taken off costs. null/undefined = not counted. */
  nPrice?: Num;
  /** Conservation payment $/ac for each cover-crop year (e.g. NRCS EQIP 340). null/undefined = not counted. */
  coverPay?: Num;
}

export type Stress = "normal" | "prices" | "drought" | "both";
export const STRESSES: Stress[] = ["normal", "prices", "drought", "both"];

/** One non-modelled cause of loss for one crop: chance per year and the average loss per acre when it hit. */
export interface LossCause {
  crop: string;
  cause: string;
  p: number;
  loss: number;
}

/* ---------------- small numeric helpers ---------------- */

export const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Linear-interpolated quantile of an ascending-sorted array (numpy's default). NaN when empty. */
export function quantileSorted(sorted: ArrayLike<number>, q: number): number {
  const n = sorted.length;
  if (!n) return NaN;
  if (n === 1) return sorted[0];
  const h = (n - 1) * q;
  const lo = Math.floor(h);
  const hi = Math.min(n - 1, lo + 1);
  return sorted[lo] + (h - lo) * (sorted[hi] - sorted[lo]);
}

/** Quantile of the finite values (NaN when there are none). */
export function quantile(values: ArrayLike<number>, q: number): number {
  const a: number[] = [];
  for (let i = 0; i < values.length; i++) if (Number.isFinite(values[i])) a.push(values[i]);
  a.sort((x, y) => x - y);
  return quantileSorted(a, q);
}

export const median = (values: ArrayLike<number>) => quantile(values, 0.5);

function nums(xs: (number | null | undefined)[] | null | undefined): number[] {
  return (xs ?? []).map((v) => (finite(v) ? v : NaN));
}

/** Deterministic uniform in [0, 1) from integers (seeded, reproducible; the same draw for every option). */
export function hashUniform(seed: number, a: number, b: number, c: number, d: number): number {
  let h = (seed ^ 0x9e3779b9) >>> 0;
  for (const x of [a, b, c, d]) {
    h = Math.imul(h ^ (x >>> 0), 0x85ebca6b);
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
  }
  return (h >>> 0) / 4294967296;
}

/** Stable small integer for a string (so "Hail" uses the same random stream for every crop and option). */
export function strHash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export const LOSS_SEED = 20261115;

/* ---------------- inputs ---------------- */

function resolveLines(lines: MoneyCostLine[] | null | undefined, edits: Record<string, Num> | undefined): ResolvedLine[] {
  return (lines ?? []).map((l) => {
    const e = edits?.[l.id];
    const usda = finite(l.usd_ac) ? l.usd_ac : null;
    return { id: l.id, label_en: l.label_en, label_es: l.label_es, usda, value: e !== undefined ? e : usda, edited: e !== undefined && e !== usda };
  });
}

const sumLines = (ls: ResolvedLine[]) => ls.reduce((a, l) => a + (finite(l.value) ? l.value : 0), 0);

/** The crop's effective numbers: USDA/M2 defaults with the farmer's edits applied.
    `extra.basisPrice`: the market price for the chosen basis ("latest" / "wasde"), already in the crop's unit.
    `extra.ownYield`: the farmer's own average yield from their records (used when no yield is typed). */
export function resolveCrop(
  id: string,
  crop: MoneyCrop | undefined,
  edits: CropEdits | undefined,
  nPriceYears: number,
  extra?: { basisPrice?: number | null; ownYield?: number | null },
): ResolvedCrop {
  const e = edits ?? {};
  const lines = resolveLines(crop?.costs, e.lines);
  const overheadLines = resolveLines(crop?.overhead, e.overhead);
  const hasLines = lines.length > 0;
  const usdaCost = hasLines ? lines.reduce((a, l) => a + (finite(l.usda) ? l.usda : 0), 0) : null;
  const lineSum = hasLines ? sumLines(lines) : null;
  const opCost = e.total !== undefined ? e.total : lineSum;
  const uy = finite(crop?.yield?.typical) ? crop!.yield!.typical : null;
  const up = finite(crop?.price?.typical) ? crop!.price!.typical : null;
  const vals = nums(crop?.price?.values);
  const med = median(vals);
  const priceRatio = Array.from({ length: Math.max(1, nPriceYears) }, (_, p) => (finite(vals[p]) && med > 0 ? vals[p] / med : 1));
  const landLine = overheadLines.find((l) => l.id === "land");
  const own = finite(extra?.ownYield) && extra.ownYield > 0 ? extra.ownYield : null;
  const yieldFromRecords = e.yield === undefined && own !== null;
  const y: Num = e.yield !== undefined ? e.yield : (own ?? uy);
  // Price level: a market basis (when its value exists), the farmer's own number, or USDA's typical.
  // Edits saved before the basis existed (a typed price, no basis) count as "own".
  let basis: PriceBasis = e.priceBasis ?? (e.price !== undefined ? "own" : "usda");
  let price: Num = up;
  if (basis === "latest" || basis === "wasde") {
    if (finite(extra?.basisPrice) && extra.basisPrice > 0) price = extra.basisPrice;
    else basis = "usda";
  } else if (basis === "own") price = e.price !== undefined ? e.price : up;
  return {
    id,
    yield: y,
    price,
    opCost: finite(opCost) ? opCost : null,
    lines,
    overheadLines,
    overhead: sumLines(overheadLines),
    land: landLine && finite(landLine.value) ? landLine.value : null,
    priceRatio,
    usda: { yield: uy, price: up, opCost: usdaCost },
    priceBasis: basis,
    yieldFromRecords,
    edited: {
      yield: (e.yield !== undefined || yieldFromRecords) && y !== uy,
      price: basis !== "usda" && price !== up,
      cost: (e.total !== undefined && e.total !== usdaCost) || lines.some((l) => l.edited),
      overhead: overheadLines.some((l) => l.edited),
    },
    hasLines,
  };
}

/** Crops in play across the given options (fallow left out), in first-seen order. */
export function cropsInPlay(options: MoneyOption[]): string[] {
  const out: string[] = [];
  for (const o of options) for (const p of o.positions) if (p.crop && p.crop !== "fallow" && !out.includes(p.crop)) out.push(p.crop);
  return out;
}

/** What a crop still needs before profit can be worked out (empty = ready). */
export function cropMissing(c: ResolvedCrop): ("yield" | "price" | "cost")[] {
  const m: ("yield" | "price" | "cost")[] = [];
  if (!finite(c.yield) || c.yield <= 0) m.push("yield");
  if (!finite(c.price) || c.price <= 0) m.push("price");
  if (!finite(c.opCost) || c.opCost < 0) m.push("cost");
  return m;
}

/** Non-modelled causes of loss from hazards.insured_losses (weather the simulation covers is never added twice). */
export function lossCauses(rows: InsuredLoss[] | null | undefined): LossCause[] {
  const out: LossCause[] = [];
  for (const r of rows ?? []) {
    if (!r || typeof r !== "object") continue;
    // The API flags causes the simulation already covers; without the flag, drought and heat are left out by name.
    const inSim = r.in_simulation ?? /drought|heat|hot wind/i.test(r.cause ?? "");
    if (inSim) continue;
    if (!finite(r.p) || r.p <= 0 || !finite(r.avg_loss_usd_ac_when_hit) || r.avg_loss_usd_ac_when_hit <= 0) continue;
    out.push({ crop: r.crop, cause: r.cause, p: Math.min(1, r.p), loss: r.avg_loss_usd_ac_when_hit });
  }
  return out;
}

/* ---------------- the sample grid ---------------- */

export interface Grid {
  /** Weather-sequence indices used (all, or the driest 20 %). */
  s: number[];
  /** Price-year indices (always all; 1 virtual year when there is no price history). */
  P: number;
  priceFactor: number;
  /** Season rain threshold for "drought years" (20th percentile), when used. */
  dryThreshold: number | null;
}

/** Driest 20 % of the weather sequences (season rain at or below the 20th percentile). */
export function droughtSequences(rain: (number | null)[] | null | undefined): { idx: number[]; threshold: number | null } {
  const r = nums(rain);
  const thr = quantile(r, 0.2);
  if (!Number.isFinite(thr)) return { idx: [], threshold: null };
  const idx = r.map((v, i) => (Number.isFinite(v) && v <= thr ? i : -1)).filter((i) => i >= 0);
  return { idx, threshold: thr };
}

export function makeGrid(data: MoneyData, stress: Stress): Grid {
  const S = data.weather_years?.length ?? 0;
  const all = Array.from({ length: S }, (_, i) => i);
  const P = Math.max(1, data.price_years?.length ?? 0);
  const dry = stress === "drought" || stress === "both";
  const d = dry ? droughtSequences(data.season_rain_mm) : null;
  return {
    s: dry && d && d.idx.length ? d.idx : all,
    P,
    priceFactor: stress === "prices" || stress === "both" ? 0.8 : 1,
    dryThreshold: d?.threshold ?? null,
  };
}

/* ---------------- one option ---------------- */

/** Per-sample arrays for one option (sample k = s-index × P + p over the grid). */
export interface OptionSamples {
  id: string;
  nYears: number;
  /** Rotation-average revenue, costs (operating + cover + pumping + overhead − fertilizer N saved), non-modelled
      losses and conservation payments, $/ac/yr. net = rev + pay − cost − loss. */
  rev: Float64Array;
  cost: Float64Array;
  loss: Float64Array;
  pay: Float64Array;
  net: Float64Array;
  /** Single-year nets: nYears values per sample, flattened [k * nYears + y]. */
  yearNet: Float64Array;
  /** Weather sequence and price year of each sample. */
  sOf: Int32Array;
  pOf: Int32Array;
}

export interface Incomplete {
  id: string;
  missing: { crop: string; what: ("yield" | "price" | "cost")[] }[];
}

/** Year index of each position: a double crop shares the year of the position before it. */
export function yearOfPositions(pos: MoneyPosition[]): { yearOf: number[]; nYears: number } {
  const yearOf: number[] = [];
  let y = -1;
  pos.forEach((p, j) => {
    if (!(p.kind === "double" && j > 0)) y += 1;
    yearOf.push(y);
  });
  return { yearOf, nYears: Math.max(1, y + 1) };
}

export function optionSamples(
  opt: MoneyOption,
  crops: Record<string, ResolvedCrop>,
  farm: FarmInput,
  grid: Grid,
  causes: LossCause[],
): OptionSamples | Incomplete {
  // Every crop in the option needs a yield, a price and an operating cost.
  const missing: Incomplete["missing"] = [];
  for (const p of opt.positions) {
    if (!p.crop || p.crop === "fallow") continue;
    const c = crops[p.crop];
    const what = c ? cropMissing(c) : (["yield", "price", "cost"] as ("yield" | "price" | "cost")[]);
    if (what.length && !missing.some((m) => m.crop === p.crop)) missing.push({ crop: p.crop, what });
  }
  if (missing.length) return { id: opt.id, missing };

  const yp = yearOfPositions(opt.positions);
  const yearOf = yp.yearOf;
  // The API gives the years in the sequence; positions are one per crop event, so this equals the count of year slots.
  const nYears = finite(opt.years) && opt.years > 0 ? Math.round(opt.years) : yp.nYears;
  const nS = grid.s.length;
  const N = nS * grid.P;
  const rev = new Float64Array(N);
  const cost = new Float64Array(N);
  const loss = new Float64Array(N);
  const pay = new Float64Array(N);
  const yearNet = new Float64Array(N * nYears);
  const sOf = new Int32Array(N);
  const pOf = new Int32Array(N);
  const cover = finite(farm.coverCost) ? farm.coverCost : 0;
  const pump = finite(farm.pumpCost) ? farm.pumpCost : 0;
  const nPrice = finite(farm.nPrice) && farm.nPrice > 0 ? farm.nPrice : 0;
  const coverPay = finite(farm.coverPay) && farm.coverPay > 0 ? farm.coverPay : 0;
  // Fixed costs in a fallow year: land is paid every year, so a fallow year carries the mean land line of the option's crops.
  const lands = opt.positions.map((p) => (p.crop ? crops[p.crop]?.land : null)).filter(finite);
  const fallowLand = lands.length ? lands.reduce((a, b) => a + b, 0) / lands.length : 0;
  const posCauses = opt.positions.map((p) => (farm.losses && p.crop ? causes.filter((c) => c.crop === p.crop) : []));

  for (let si = 0; si < nS; si++) {
    const s = grid.s[si];
    for (let p = 0; p < grid.P; p++) {
      const k = si * grid.P + p;
      sOf[k] = s;
      pOf[k] = p;
      let r = 0;
      let c = 0;
      let l = 0;
      let g = 0;
      let bad = false;
      opt.positions.forEach((pos, j) => {
        const y = yearOf[j];
        let pr = 0;
        let pc = 0;
        let pl = 0;
        let pg = 0;
        const fallow = !pos.crop || pos.crop === "fallow";
        if (!fallow) {
          const cr = crops[pos.crop!];
          const yi = pos.yield_index?.[s];
          if (!finite(yi)) {
            bad = true;
            return;
          }
          pr = cr.yield! * yi * cr.price! * cr.priceRatio[Math.min(p, cr.priceRatio.length - 1)] * grid.priceFactor;
          pc = cr.opCost!;
          if (farm.overhead) pc += cr.overhead;
          for (const lc of posCauses[j]) if (hashUniform(LOSS_SEED, s, p, j, strHash(lc.cause)) < lc.p) pl += lc.loss;
        } else if (farm.overhead) {
          pc += fallowLand;
        }
        if (pos.cover) {
          pc += cover;
          pg += coverPay;
        }
        // Fertilizer N the crop does not need after soybeans or a legume cover (a negative cost).
        if (nPrice && !fallow && finite(pos.n_credit_lb_ac) && pos.n_credit_lb_ac > 0) pc -= pos.n_credit_lb_ac * nPrice;
        const irr = pos.irrigation_mm?.[s];
        if (pump && finite(irr) && irr > 0) pc += (pump * irr) / 25.4;
        r += pr;
        c += pc;
        l += pl;
        g += pg;
        if (y < nYears) yearNet[k * nYears + y] += pr + pg - pc - pl;
      });
      if (bad) {
        rev[k] = cost[k] = loss[k] = pay[k] = NaN;
        for (let y = 0; y < nYears; y++) yearNet[k * nYears + y] = NaN;
      } else {
        rev[k] = r / nYears;
        cost[k] = c / nYears;
        loss[k] = l / nYears;
        pay[k] = g / nYears;
      }
    }
  }
  const net = new Float64Array(N);
  for (let k = 0; k < N; k++) net[k] = rev[k] + pay[k] - cost[k] - loss[k];
  return { id: opt.id, nYears, rev, cost, loss, pay, net, yearNet, sOf, pOf };
}

export const isIncomplete = <T extends object>(x: T | Incomplete): x is Incomplete => "missing" in x;

/* ---------------- results ---------------- */

export interface BreakEven {
  /** Price change (%, all crops, both rotations) at which this option's typical net equals the current rotation's. */
  pct: number | null;
  /** When there is no crossing between −80 % and +100 %: is this option ahead or behind over the whole range? */
  always: "ahead" | "behind" | null;
}

export interface OptionResult {
  id: string;
  typical: number;
  bad: number;
  good: number;
  revenue: number;
  cost: number;
  losses: number;
  /** Whole field per year (× acres), null without acres. */
  field: { typical: number; bad: number; good: number } | null;
  /** Typical difference from the current rotation ($/ac/yr), null for the current rotation itself. */
  diff: number | null;
  diffField: number | null;
  /** Share of single years (all samples × rotation years) below zero. */
  pLoss: number;
  /** Share of paired (weather, price) samples where this option's rotation average beats the current one's. */
  pBeat: number | null;
  breakEven: BreakEven | null;
  worst: { net: number; weatherYear: number | string | null; priceYear: number | string | null } | null;
  nSamples: number;
  nYears: number;
  /** Payments for practices, $/ac/yr (rotation average; 0 when off). */
  pay: number;
  /** Net for each year of the simulated sequence in a typical run (mean over the 40th–60th percentile runs), $/ac. */
  yearTypical: number[];
}

/** Ascending copy of the finite values. */
function sortedFinite(a: Float64Array): Float64Array {
  let n = 0;
  for (let i = 0; i < a.length; i++) if (Number.isFinite(a[i])) n++;
  const out = new Float64Array(n);
  let j = 0;
  for (let i = 0; i < a.length; i++) if (Number.isFinite(a[i])) out[j++] = a[i];
  return out.sort();
}

function medianOf(rev: Float64Array, costPlusLoss: Float64Array, x: number, buf: Float64Array): number {
  let n = 0;
  for (let k = 0; k < rev.length; k++) {
    const v = rev[k] * (1 + x) - costPlusLoss[k];
    if (Number.isFinite(v)) buf[n++] = v;
  }
  return quantileSorted(buf.subarray(0, n).sort(), 0.5);
}

/** Bisection for the price change x (fraction) where typical(o) − typical(base) = 0; the root nearest no change. */
export function breakEven(o: OptionSamples, base: OptionSamples, lo = -0.8, hi = 1.0): BreakEven {
  const oc = new Float64Array(o.rev.length);
  const bc = new Float64Array(base.rev.length);
  // Payments for practices do not move with crop prices: they sit with the costs (as a negative).
  for (let k = 0; k < oc.length; k++) oc[k] = o.cost[k] + o.loss[k] - o.pay[k];
  for (let k = 0; k < bc.length; k++) bc[k] = base.cost[k] + base.loss[k] - base.pay[k];
  const buf = new Float64Array(Math.max(oc.length, bc.length));
  const f = (x: number) => medianOf(o.rev, oc, x, buf) - medianOf(base.rev, bc, x, buf);
  // Scan in 5 % steps for sign changes, then bisect the crossing nearest 0.
  const xs: number[] = [];
  for (let x = lo; x <= hi + 1e-9; x += 0.05) xs.push(Math.round(x * 100) / 100);
  const fs = xs.map(f);
  if (fs.some((v) => !Number.isFinite(v))) return { pct: null, always: null };
  const brackets: [number, number, number, number][] = [];
  for (let i = 0; i + 1 < xs.length; i++) {
    if (fs[i] === 0) brackets.push([xs[i], xs[i], fs[i], fs[i]]);
    else if (fs[i] * fs[i + 1] < 0) brackets.push([xs[i], xs[i + 1], fs[i], fs[i + 1]]);
  }
  if (fs[fs.length - 1] === 0) brackets.push([xs[xs.length - 1], xs[xs.length - 1], 0, 0]);
  if (!brackets.length) return { pct: null, always: fs[0] > 0 ? "ahead" : "behind" };
  brackets.sort((a, b) => Math.min(Math.abs(a[0]), Math.abs(a[1])) - Math.min(Math.abs(b[0]), Math.abs(b[1])));
  let [a, b, fa] = brackets[0];
  for (let it = 0; it < 40 && b - a > 1e-4; it++) {
    const m = (a + b) / 2;
    const fm = f(m);
    if (fm === 0) {
      a = b = m;
      break;
    }
    if (fa * fm < 0) b = m;
    else {
      a = m;
      fa = fm;
    }
  }
  return { pct: Math.round(((a + b) / 2) * 1000) / 10, always: null };
}

function summarize(o: OptionSamples, base: OptionSamples | null, data: MoneyData, acres: Num): OptionResult {
  const sorted = sortedFinite(o.net);
  const typical = quantileSorted(sorted, 0.5);
  const bad = quantileSorted(sorted, 0.1);
  const good = quantileSorted(sorted, 0.9);
  let losing = 0;
  let years = 0;
  let worst: OptionResult["worst"] = null;
  for (let i = 0; i < o.yearNet.length; i++) {
    const v = o.yearNet[i];
    if (!Number.isFinite(v)) continue;
    years++;
    if (v < 0) losing++;
    if (!worst || v < worst.net) {
      const k = Math.floor(i / o.nYears);
      const y = i % o.nYears;
      const w = data.weather_years?.[o.sOf[k]];
      worst = {
        net: v,
        weatherYear: typeof w === "number" ? w + y : (w ?? null),
        priceYear: data.price_years?.length ? (data.price_years[o.pOf[k]] ?? null) : null,
      };
    }
  }
  const isBase = !base || base.id === o.id;
  let pBeat: number | null = null;
  let diff: number | null = null;
  let be: BreakEven | null = null;
  if (!isBase && base) {
    let win = 0;
    let n = 0;
    for (let k = 0; k < o.net.length && k < base.net.length; k++) {
      if (!Number.isFinite(o.net[k]) || !Number.isFinite(base.net[k])) continue;
      n++;
      if (o.net[k] > base.net[k]) win++;
    }
    pBeat = n ? win / n : null;
    diff = typical - median(base.net);
    be = breakEven(o, base);
  }
  const ac = finite(acres) && acres > 0 ? acres : null;
  // Year by year in a typical run: the mean of each year over the middle band of simulated sequences (rotation result
  // between its 40th and 60th percentile). Per-year medians would not add up to the typical result: a run of years
  // nearly always holds a dry year, which a single-year median leaves out.
  const yearTypical: number[] = [];
  const lo40 = quantileSorted(sorted, 0.4);
  const hi60 = quantileSorted(sorted, 0.6);
  const band: number[] = [];
  for (let k = 0; k < o.net.length; k++) if (Number.isFinite(o.net[k]) && o.net[k] >= lo40 && o.net[k] <= hi60) band.push(k);
  for (let y = 0; y < o.nYears; y++) {
    let s = 0;
    let n = 0;
    for (const k of band) {
      const v = o.yearNet[k * o.nYears + y];
      if (Number.isFinite(v)) {
        s += v;
        n++;
      }
    }
    yearTypical.push(n ? s / n : NaN);
  }
  return {
    id: o.id,
    pay: median(o.pay),
    yearTypical,
    typical,
    bad,
    good,
    revenue: median(o.rev),
    cost: median(o.cost),
    losses: mean(o.loss),
    field: ac ? { typical: typical * ac, bad: bad * ac, good: good * ac } : null,
    diff,
    diffField: diff !== null && ac ? diff * ac : null,
    pLoss: years ? losing / years : NaN,
    pBeat,
    breakEven: be,
    worst,
    nSamples: sorted.length,
    nYears: o.nYears,
  };
}

function mean(a: Float64Array): number {
  let s = 0;
  let n = 0;
  for (let i = 0; i < a.length; i++)
    if (Number.isFinite(a[i])) {
      s += a[i];
      n++;
    }
  return n ? s / n : NaN;
}

export interface MoneyRun {
  grid: Grid;
  baselineId: string | null;
  /** Results per option id; incomplete options list what is missing. */
  results: Record<string, OptionResult | Incomplete>;
  /** True when the current rotation itself could not be worked out (no comparison then). */
  baselineIncomplete: boolean;
}

/**
 * Work out the money for the chosen options (and always the current rotation, for the comparison).
 * Fast: a few thousand samples per option; well under 50 ms for the pilots.
 */
export function runMoney(
  data: MoneyData,
  crops: Record<string, ResolvedCrop>,
  farm: FarmInput,
  stress: Stress,
  causes: LossCause[],
  optionIds: string[],
): MoneyRun {
  const grid = makeGrid(data, stress);
  const opts = data.options ?? [];
  const baseOpt = opts.find((o) => o.is_baseline) ?? null;
  const ids = [...new Set([...(baseOpt ? [baseOpt.id] : []), ...optionIds])];
  const samples: Record<string, OptionSamples | Incomplete> = {};
  for (const id of ids) {
    const o = opts.find((x) => x.id === id);
    if (o) samples[id] = optionSamples(o, crops, farm, grid, causes);
  }
  const bs = baseOpt ? samples[baseOpt.id] : undefined;
  const base = bs && !isIncomplete(bs) ? bs : null;
  const results: MoneyRun["results"] = {};
  for (const id of ids) {
    const x = samples[id];
    if (!x) continue;
    results[id] = isIncomplete(x) ? x : summarize(x, base, data, farm.acres);
  }
  return { grid, baselineId: baseOpt?.id ?? null, results, baselineIncomplete: !!baseOpt && !base };
}

/* ---------------- the switch, year by year ---------------- */

export interface Slot {
  crop: string | null;
  double: string | null;
  cover: string | null;
}

/** One entry per year of the simulated sequence: the main crop, a double crop sharing the year, and the cover. */
export function slotsOf(pos: MoneyPosition[]): Slot[] {
  const { yearOf, nYears } = yearOfPositions(pos);
  const out: Slot[] = Array.from({ length: nYears }, () => ({ crop: null, double: null, cover: null }));
  pos.forEach((p, j) => {
    const s = out[yearOf[j]];
    if (!s) return;
    if (p.kind === "double" && j > 0) s.double = p.crop;
    else s.crop = p.crop;
    if (p.cover) s.cover = p.cover;
  });
  return out;
}

/** Years in one cycle of the option's rotation (the simulated sequence repeats it). */
export function cycleOf(o: MoneyOption): number {
  const n = slotsOf(o.positions).length;
  const c = finite(o.cycle_years) && o.cycle_years > 0 ? Math.round(o.cycle_years) : n;
  return c <= n && n % c === 0 ? c : n;
}

/**
 * Where an option's year 1 sits in its cycle so that it follows the farmer's last crops on record (oldest first):
 * the year whose preceding years match the longest run of recent crops. 0 when nothing matches.
 */
export function startSlot(o: MoneyOption, recent: (string | null | undefined)[]): number {
  const slots = slotsOf(o.positions);
  const L = cycleOf(o);
  let best = 0;
  let bestScore = 0;
  for (let j = 0; j < L; j++) {
    let score = 0;
    for (let k = 1; k <= Math.min(recent.length, 2 * L); k++) {
      const c = recent[recent.length - k];
      if (!c || slots[(((j - k) % L) + L) % L]?.crop !== c) break;
      score++;
    }
    if (score > bestScore) {
      best = j;
      bestScore = score;
    }
  }
  return best;
}

export interface CashYear {
  /** 1-based year of the switch. */
  year: number;
  slot: Slot;
  /** Typical net this year (× scale). */
  net: number;
  /** Typical net of staying put this year (× scale). */
  base: number;
  diff: number;
  /** Running difference from staying put, after the one-time costs. */
  cum: number;
}

export interface CashFlow {
  rows: CashYear[];
  /** First year from which the running difference stays at or above zero; null = not within the years shown. */
  payback: number | null;
}

/**
 * Years 1..n of a switch in a typical year: each year's typical net for the option and for staying put, the
 * difference, and the running total after one-time costs paid in year 1. `scale` turns $/ac into whole-field $.
 */
export function cashFlow(
  o: { r: OptionResult; opt: MoneyOption; start: number },
  base: { r: OptionResult; opt: MoneyOption; start: number },
  years = 5,
  scale = 1,
  oneTime = 0,
): CashFlow | null {
  const n = o.r.yearTypical.length;
  const nb = base.r.yearTypical.length;
  if (!n || !nb) return null;
  const slots = slotsOf(o.opt.positions);
  const rows: CashYear[] = [];
  let cum = -Math.max(0, oneTime);
  let payback: number | null = null;
  for (let k = 0; k < years; k++) {
    const net = o.r.yearTypical[(o.start + k) % n] * scale;
    const b = base.r.yearTypical[(base.start + k) % nb] * scale;
    if (!Number.isFinite(net) || !Number.isFinite(b)) return null;
    const diff = net - b;
    cum += diff;
    rows.push({ year: k + 1, slot: slots[(o.start + k) % slots.length] ?? { crop: null, double: null, cover: null }, net, base: b, diff, cum });
  }
  // Paid back = the running total is at or above zero from that year to the last year shown.
  for (let k = rows.length - 1; k >= 0 && rows[k].cum >= 0; k--) payback = k + 1;
  return { rows, payback };
}

/** The farmer's average yield for a crop from their records: the latest `n` years with a value. */
export function recordsAverage(yields: Record<string, { crop?: string | null; value?: number | null }> | null | undefined, crop: string, n = 5) {
  const ys = Object.entries(yields ?? {})
    .filter(([, v]) => v && v.crop === crop && finite(v.value) && v.value > 0)
    .map(([y, v]) => ({ y: Number(y), v: v.value as number }))
    .filter((x) => Number.isFinite(x.y))
    .sort((a, b) => b.y - a.y)
    .slice(0, n);
  if (!ys.length) return null;
  return { avg: ys.reduce((a, x) => a + x.v, 0) / ys.length, n: ys.length, y0: ys[ys.length - 1].y, y1: ys[0].y };
}

/* ---------------- defaults & words ---------------- */

/** Default picks: the current rotation, the best match for you, then the next ranked option. */
export function defaultPicks(options: MoneyOption[], max = 3): string[] {
  const base = options.find((o) => o.is_baseline);
  const best = options.find((o) => o.best_for_you && !o.is_baseline);
  const rest = options
    .filter((o) => !o.is_baseline && o !== best)
    .map((o, i) => ({ o, r: finite(o.rank) ? o.rank : 1000 + i }))
    .sort((a, b) => a.r - b.r)
    .map((x) => x.o);
  return [base, best, ...rest]
    .filter((o): o is MoneyOption => !!o)
    .map((o) => o.id)
    .filter((id, i, a) => a.indexOf(id) === i)
    .slice(0, max);
}

/** "1 year in 10" style odds: { n } for "1 in n", or { k } for "k in 10". */
export function oddsWords(p: number): { kind: "none" | "rare" | "one_in" | "k_in_10" | "most"; n?: number; k?: number } {
  if (!Number.isFinite(p) || p <= 0) return { kind: "none" };
  if (p < 0.025) return { kind: "rare", n: 40 };
  if (p < 0.15) return { kind: "one_in", n: Math.max(2, Math.round(1 / p)) };
  const k = Math.round(p * 10);
  if (k >= 10) return { kind: "most" };
  return { kind: "k_in_10", k: Math.max(1, k) };
}

/* ---------------- CSV ---------------- */

export function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return Number.isFinite(v) ? String(Math.round(v * 100) / 100) : "";
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCSV(rows: unknown[][]): string {
  return rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
