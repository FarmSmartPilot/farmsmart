/* Whole-farm scores (1 to 10): one per field and one for the whole farm, so a farmer can see at a glance which
   fields carry the farm and which put it at risk, and try plans that raise the farm's score.

   Every part comes from the same simulated seasons as the money numbers (farm.ts); nothing is invented:
   - Profit (1-10): where the field's chosen plan sits between the worst and the best typical profit ($/ac/yr)
     of that field's own complete options. A plan that loses money in a typical year scores at most 3.
     One option only, or options within $5/ac of each other: the plan scores 10 (nothing better to pick).
   - Risk safety (1-10): 10 with no losing years; 1 when half the single years or more lose money
     (chance of a losing year from the simulated weather × price years, linear in between).
   - Soil & water (1-10): for each indicator (days with soil cover, water erosion, crop water use, soil carbon
     trend), where the plan sits among the field's options (best = 10); the mean of the indicators available.
     Missing when the field's compare results are not loaded.
   The total weighs them by what the farmer said matters (money / balanced / safest presets, or their own weights
   from the sliders); missing parts are left out and the weights renormalised. The farm score uses the farm's own chance of a losing year (so fields that
   balance each other raise it), and the acre-weighted profit and soil & water scores of its fields.
   Scores compare plans on the same simulated years; they are not a forecast and not a guarantee. */
import type { Assignment, FarmCtx, FieldRun, Risk, SoilKey } from "./farm";
import { farmMetrics } from "./farm";

export interface Score {
  total: number;
  profit: number;
  risk: number;
  soil: number | null;
  /** Chance of a losing single year (0..1). */
  pLoss: number;
}

export type ScoreBand = "excellent" | "good" | "fair" | "risky" | "high_risk";

/** How much each part counts. Relative: they are normalised, so they need not add up to 1. */
export interface Weights {
  profit: number;
  risk: number;
  soil: number;
}
/** A goal (its preset weights) or the farmer's own weights. */
export type WeightsIn = Risk | Weights;
export const weightsOf = (w: WeightsIn): Weights => (typeof w === "string" ? WEIGHTS[w] : w);
/** The weights as whole percentages of their sum. */
export function weightPcts(w: WeightsIn): Weights {
  const W = weightsOf(w);
  const sum = W.profit + W.risk + W.soil;
  if (!(sum > 0)) return { profit: 0, risk: 0, soil: 0 };
  return { profit: Math.round((W.profit / sum) * 100), risk: Math.round((W.risk / sum) * 100), soil: Math.round((W.soil / sum) * 100) };
}

export const WEIGHTS: Record<Risk, Weights> = {
  money: { profit: 0.5, risk: 0.3, soil: 0.2 },
  balanced: { profit: 0.35, risk: 0.45, soil: 0.2 },
  safe: { profit: 0.2, risk: 0.6, soil: 0.2 },
};

const SOIL_DIR: Record<SoilKey, 1 | -1> = { soil_cover: 1, erosion_water: -1, water_use: -1, soc_trend: 1 };
const clamp = (x: number, a = 1, b = 10) => Math.min(b, Math.max(a, x));
const r1 = (x: number) => Math.round(x * 10) / 10;

export function band(s: number): ScoreBand {
  return s >= 8.5 ? "excellent" : s >= 7 ? "good" : s >= 5 ? "fair" : s >= 3 ? "risky" : "high_risk";
}

/** 10 with no losing years, 1 at 50 % or more. */
export const riskScore = (pLoss: number) => (Number.isFinite(pLoss) ? clamp(10 - 9 * Math.min(1, pLoss / 0.5)) : NaN);

function combine(profit: number, risk: number, soil: number | null, w: WeightsIn): number {
  const W = weightsOf(w);
  let s = 0;
  let tot = 0;
  for (const [v, k] of [
    [profit, W.profit],
    [risk, W.risk],
    [soil, W.soil],
  ] as [number | null, number][]) {
    if (v === null || !Number.isFinite(v)) continue;
    s += v * k;
    tot += k;
  }
  return tot ? r1(clamp(s / tot)) : NaN;
}

/** Complete option ids of a field (those the farm math could work out). */
const optionIds = (f: FieldRun) => f.order.filter((id) => f.options[id]);

function fieldProfit(f: FieldRun, oid: string): number {
  const ids = optionIds(f);
  const typ = ids.map((id) => f.options[id].typical).filter(Number.isFinite);
  const v = f.options[oid]?.typical;
  if (!Number.isFinite(v) || !typ.length) return NaN;
  const lo = Math.min(...typ);
  const hi = Math.max(...typ);
  const s = hi - lo < 5 ? 10 : 1 + (9 * (v - lo)) / (hi - lo);
  return v < 0 ? Math.min(3, s) : s;
}

function fieldPLoss(f: FieldRun, oid: string): number {
  const r = f.options[oid];
  if (!r) return NaN;
  let n = 0;
  let lose = 0;
  for (const x of r.yearNet)
    if (Number.isFinite(x)) {
      n++;
      if (x < 0) lose++;
    }
  return n ? lose / n : NaN;
}

function fieldSoil(f: FieldRun, oid: string): number | null {
  if (!f.soil) return null;
  const ids = optionIds(f);
  const parts: number[] = [];
  for (const k of Object.keys(SOIL_DIR) as SoilKey[]) {
    const v = f.soil[oid]?.[k];
    if (typeof v !== "number" || !Number.isFinite(v)) continue;
    const all = ids.map((id) => f.soil?.[id]?.[k]).filter((x): x is number => typeof x === "number" && Number.isFinite(x));
    const lo = Math.min(...all);
    const hi = Math.max(...all);
    if (hi - lo < 1e-9) {
      parts.push(10);
      continue;
    }
    const pos = SOIL_DIR[k] > 0 ? (v - lo) / (hi - lo) : (hi - v) / (hi - lo);
    parts.push(1 + 9 * pos);
  }
  return parts.length ? parts.reduce((s, x) => s + x, 0) / parts.length : null;
}

/** One field's score with option `oid` (default: its plan). */
export function fieldScore(f: FieldRun, w: WeightsIn, oid: string = f.plan): Score {
  const profit = fieldProfit(f, oid);
  const pLoss = fieldPLoss(f, oid);
  const risk = riskScore(pLoss);
  const soil = fieldSoil(f, oid);
  return { total: combine(profit, risk, soil, w), profit: r1(profit), risk: r1(risk), soil: soil === null ? null : r1(soil), pLoss };
}

/** The farm's score for an assignment (pass `pLoss` when the farm metrics are already worked out). */
export function farmScore(ctx: FarmCtx, a: Assignment, w: WeightsIn, pLoss?: number): Score {
  const pl = pLoss ?? farmMetrics(ctx, a).pLoss;
  let pw = 0;
  let ps = 0;
  let sw = 0;
  let ss = 0;
  for (const f of ctx.fields) {
    const oid = a[f.id] ?? f.baselineId;
    const p = fieldProfit(f, oid);
    if (Number.isFinite(p)) {
      ps += p * f.acres;
      pw += f.acres;
    }
    const s = fieldSoil(f, oid);
    if (s !== null) {
      ss += s * f.acres;
      sw += f.acres;
    }
  }
  const profit = pw ? ps / pw : NaN;
  const soil = sw ? ss / sw : null;
  const risk = riskScore(pl);
  return { total: combine(profit, risk, soil, w), profit: r1(profit), risk: r1(risk), soil: soil === null ? null : r1(soil), pLoss: pl };
}

export interface Booster {
  fieldId: string;
  option: string;
  from: Score;
  to: Score;
  gain: number;
}

/** Single-field changes that raise the farm score most (unlocked fields only), best first. */
export function scoreBoosters(ctx: FarmCtx, a: Assignment, w: WeightsIn, max = 3): Booster[] {
  const base = farmScore(ctx, a, w);
  const out: Booster[] = [];
  for (const f of ctx.fields) {
    if (f.locked) continue;
    let best: Booster | null = null;
    for (const oid of optionIds(f)) {
      if (oid === (a[f.id] ?? f.baselineId)) continue;
      const to = farmScore(ctx, { ...a, [f.id]: oid }, w);
      const gain = r1(to.total - base.total);
      if (gain >= 0.1 && (!best || gain > best.gain)) best = { fieldId: f.id, option: oid, from: base, to, gain };
    }
    if (best) out.push(best);
  }
  return out.sort((x, y) => y.gain - x.gain).slice(0, max);
}
