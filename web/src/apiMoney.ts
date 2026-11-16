/* API client for the money calculator (wave U6): POST /api/fields/{fid}/money with the same body as /compare.
   The response carries the building blocks (yield indices per weather sequence, price years, USDA ERS cost lines,
   hazards); money.ts does the arithmetic in the browser. Nothing here invents values: a missing endpoint or block
   is reported to the UI as "not available". */
import { useMemo } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ApiError } from "./api";
import type { PlanCompareBody } from "./apiPlan";
import { plainRotation } from "./lib";
import type { Declaration, InsuredLoss, MoneyData, StormItem, WeatherHazard } from "./money";

async function req<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    let msg = res.statusText;
    try {
      const j = await res.json();
      msg = typeof j.detail === "string" ? j.detail : JSON.stringify(j.detail ?? j);
    } catch {
      /* not JSON */
    }
    throw new ApiError(res.status, msg);
  }
  return res.json() as Promise<T>;
}

export const apiMoney = {
  money: (fid: string, body: PlanCompareBody) =>
    req<MoneyData>(`/api/fields/${fid}/money`, { method: "POST", body: JSON.stringify(body) }),
};

/** The money building blocks for this field and compare body. Option names in plain words, as on the Compare page. */
export const useMoneyQ = (fid: string | null, body: PlanCompareBody) => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const select = useMemo(
    () => (d: MoneyData): MoneyData => ({
      ...d,
      options: (d.options ?? []).map((o) => ({
        ...o,
        name: o.is_custom || o.is_baseline ? o.name : plainRotation(o.rotation_label ?? o.name, lang),
        rotation_label: o.rotation_label ? plainRotation(o.rotation_label, lang) : o.rotation_label,
      })),
    }),
    [lang],
  );
  return useQuery({
    queryKey: ["money", fid, body],
    queryFn: () => apiMoney.money(fid!, body),
    select,
    enabled: !!fid,
    staleTime: 5 * 60_000,
    placeholderData: keepPreviousData,
    retry: (n, e) => !(e instanceof ApiError && (e.status === 404 || e.status === 405)) && n < 1,
  });
};

/* ---------------- hazards (defensive readers: each block may be a list, or {available, reason, items…}) ---------------- */

export interface HazardBlock<T> {
  available: boolean;
  reason: string | null;
  items: T[];
  /** Extra context the API may add (county name, years covered, source, url…). */
  meta: Record<string, unknown>;
}

const LIST_KEYS = ["items", "rows", "entries", "causes", "losses", "list", "by_type", "types", "data"];

export function hazardBlock<T>(raw: unknown): HazardBlock<T> | null {
  if (raw === undefined || raw === null) return null;
  if (Array.isArray(raw)) return { available: true, reason: null, items: raw as T[], meta: {} };
  if (typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  let items: T[] = [];
  for (const k of LIST_KEYS) {
    if (Array.isArray(o[k])) {
      items = o[k] as T[];
      break;
    }
  }
  const available = o.available === undefined ? items.length > 0 : !!o.available;
  return { available, reason: typeof o.reason === "string" ? o.reason : null, items, meta: o };
}

export function moneyHazards(d: MoneyData | undefined) {
  const h = (d?.hazards ?? null) as Record<string, unknown> | null;
  return {
    weather: hazardBlock<WeatherHazard>(h?.weather),
    insured: hazardBlock<InsuredLoss>(h?.insured_losses),
    // Declarations: the per-type summary, without non-weather ones (e.g. a pandemic) that say nothing about farming risk.
    declarations: declBlock(h?.declarations),
    // NOAA NCEI Storm Events for the county (wave U9).
    storms: hazardBlock<StormItem>(h?.storm_events),
  };
}

function declBlock(raw: unknown): HazardBlock<Declaration> | null {
  if (raw && typeof raw === "object" && !Array.isArray(raw) && Array.isArray((raw as Record<string, unknown>).by_type)) {
    const o = raw as Record<string, unknown>;
    const b = hazardBlock<Declaration>({ ...o, items: o.by_type });
    if (b) b.items = b.items.filter((d) => d && d.weather_related !== false);
    return b;
  }
  return hazardBlock<Declaration>(raw);
}

/** A string from a block's meta (e.g. county, source, years), or undefined. */
export function metaStr(b: HazardBlock<unknown> | null, ...keys: string[]): string | undefined {
  for (const k of keys) {
    const v = b?.meta?.[k];
    if (typeof v === "string" && v) return v;
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
  }
  return undefined;
}

/* ---------------- market prices (wave U7 API, GET /api/markets) ---------------- */

export interface MarketMonth {
  month: string;
  usd?: number | null;
  value?: number | null;
}

/** Fields shared by every market block; each may be `available: false` with a reason. */
export interface MarketBlockBase {
  available?: boolean;
  reason?: string | null;
  source?: string | null;
  scope?: string | null;
  unit?: string | null;
  /** Multiply this block's price by it to get the crop's planning unit (e.g. $/mt → $/bu). */
  to_crop_unit?: number | null;
  citation?: string | null;
  url?: string | null;
  licence?: string | null;
  retrieved?: string | null;
  notes?: string[] | null;
}

export interface MarketReceived extends MarketBlockBase {
  series?: MarketMonth[] | null;
  latest?: MarketMonth | null;
  location?: string | null;
}

export interface MarketYears extends MarketBlockBase {
  years?: (number | string)[] | null;
  usd?: (number | null)[] | null;
  published?: string | null;
  kind?: string | null;
  region?: string | null;
  history?: { years?: (number | string)[]; usd?: (number | null)[] } | null;
}

export interface MarketWasde extends MarketBlockBase {
  report?: string | null;
  report_date?: string | null;
  report_month?: string | null;
  marketing_year?: string | null;
  season_avg_price?: { low?: number | null; mid?: number | null; high?: number | null } | null;
  previous_year?: number | null;
  previous_year_label?: string | null;
  page?: string | null;
}

export interface MarketGlobal extends MarketBlockBase {
  series?: MarketMonth[] | null;
  latest?: MarketMonth | null;
}

export interface MarketCrop {
  label?: string | null;
  unit?: string | null;
  received?: MarketReceived | null;
  harvest_history?: MarketYears | null;
  wasde?: MarketWasde | null;
  projections?: MarketYears | null;
  projections_early_release?: MarketYears | null;
  global?: MarketGlobal | null;
}

export interface MarketInput {
  id: string;
  label_en?: string | null;
  label_es?: string | null;
  unit?: string | null;
  available?: boolean;
  series?: MarketMonth[] | null;
  latest?: MarketMonth | null;
}

export interface MarketLink {
  label_en: string;
  label_es?: string | null;
  url: string;
  crop?: string | null;
  kind?: string | null;
}

export interface MarketsData {
  retrieved?: string | null;
  us_available?: boolean;
  state?: string | null;
  state_name?: string | null;
  crops?: Record<string, MarketCrop>;
  inputs?: (MarketBlockBase & { items?: MarketInput[] | null }) | null;
  links?: MarketLink[] | null;
  notes?: string[] | null;
}

/** USPS code of a US state from its FIPS code (the field report gives `statefips`). */
const STATE_BY_FIPS: Record<string, string> = {
  "01": "AL", "02": "AK", "04": "AZ", "05": "AR", "06": "CA", "08": "CO", "09": "CT", "10": "DE", "11": "DC", "12": "FL",
  "13": "GA", "15": "HI", "16": "ID", "17": "IL", "18": "IN", "19": "IA", "20": "KS", "21": "KY", "22": "LA", "23": "ME",
  "24": "MD", "25": "MA", "26": "MI", "27": "MN", "28": "MS", "29": "MO", "30": "MT", "31": "NE", "32": "NV", "33": "NH",
  "34": "NJ", "35": "NM", "36": "NY", "37": "NC", "38": "ND", "39": "OH", "40": "OK", "41": "OR", "42": "PA", "44": "RI",
  "45": "SC", "46": "SD", "47": "TN", "48": "TX", "49": "UT", "50": "VT", "51": "VA", "53": "WA", "54": "WV", "55": "WI",
  "56": "WY", "72": "PR",
};

export function stateCode(fips: unknown): string | null {
  if (typeof fips !== "string" && typeof fips !== "number") return null;
  const k = String(fips).padStart(2, "0").slice(0, 2);
  return STATE_BY_FIPS[k] ?? null;
}

export const useMarketsQ = (state: string | null, country: string | null, crops: string[], enabled = true) =>
  useQuery({
    queryKey: ["markets", state, country, [...crops].sort().join(",")],
    queryFn: () => {
      const q = new URLSearchParams();
      if (state) q.set("state", state);
      if (country) q.set("country", country);
      if (crops.length) q.set("crops", crops.slice(0, 20).join(","));
      return req<MarketsData>(`/api/markets?${q.toString()}`);
    },
    enabled: enabled && crops.length > 0,
    staleTime: 60 * 60_000,
    retry: (n, e) => !(e instanceof ApiError && (e.status === 404 || e.status === 405 || e.status === 422)) && n < 1,
  });

/** A market block's price converted to the crop's planning unit (null when missing or unconvertible). */
export function inCropUnit(b: MarketBlockBase | null | undefined, v: number | null | undefined): number | null {
  if (!b || typeof v !== "number" || !Number.isFinite(v)) return null;
  const f = typeof b.to_crop_unit === "number" && Number.isFinite(b.to_crop_unit) && b.to_crop_unit > 0 ? b.to_crop_unit : null;
  return f === null ? null : v * f;
}

/** The latest month's price received (crop unit) and its month, if available. */
export function latestReceived(c: MarketCrop | undefined): { usd: number; month: string; scope: string | null; source: string | null } | null {
  const r = c?.received;
  if (!r || r.available === false) return null;
  const last = r.latest ?? [...(r.series ?? [])].reverse().find((m) => typeof m.usd === "number");
  const v = inCropUnit(r, last?.usd ?? null);
  return v !== null && last ? { usd: v, month: last.month, scope: r.scope ?? null, source: r.source ?? null } : null;
}

/** USDA WASDE season-average price forecast (crop unit): the mid value, or the midpoint of the published range. */
export function wasdePrice(c: MarketCrop | undefined): { usd: number; my: string | null; date: string | null } | null {
  const w = c?.wasde;
  if (!w || w.available === false) return null;
  const s = w.season_avg_price;
  const mid = typeof s?.mid === "number" ? s.mid : typeof s?.low === "number" && typeof s?.high === "number" ? (s.low + s.high) / 2 : null;
  const v = inCropUnit(w, mid);
  return v !== null ? { usd: v, my: w.marketing_year ?? null, date: w.report_date ?? null } : null;
}

/* ---------------- NOAA season outlook (GET /api/fields/{fid}/outlook, wave U8) ---------------- */

export type OutlookCat = "above" | "below" | "near" | "normal" | "equal_chances" | "ec" | string;

export interface OutlookItem {
  season?: string | null;
  label_en?: string | null;
  label_es?: string | null;
  lead?: string | number | null;
  kind?: string | null;
  temp?: { category?: OutlookCat | null; p?: number | null; p_band?: (number | null)[] | null } | null;
  precip?: { category?: OutlookCat | null; p?: number | null; p_band?: (number | null)[] | null } | null;
}

export interface OutlookData {
  available: boolean;
  reason?: string | null;
  issued?: string | null;
  items?: OutlookItem[] | null;
  /** The 1-month outlook. */
  month?: OutlookItem | null;
  source?: string | null;
  url?: string | null;
  note_en?: string | null;
  note_es?: string | null;
  scale?: string | null;
}

export const useOutlookQ = (fid: string | null) =>
  useQuery({
    queryKey: ["outlook", fid],
    queryFn: () => req<OutlookData>(`/api/fields/${fid}/outlook`),
    enabled: !!fid,
    staleTime: 60 * 60_000,
    retry: (n, e) => !(e instanceof ApiError && (e.status === 404 || e.status === 405)) && n < 1,
  });
