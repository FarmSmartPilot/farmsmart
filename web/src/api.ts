/* FarmSmart API client: types for the parts of the API the UI reads, fetchers and TanStack Query hooks.
   Every number the UI shows comes from these responses. Nothing here invents values. */
import { useMemo } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { plainCompare, plainRotation } from "./lib";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

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

/* ---------------- types ---------------- */

export interface ApiEvidence {
  id?: string;
  source: string;
  product: string;
  version?: string | null;
  is_nasa: boolean;
  observation_start?: string | null;
  observation_end?: string | null;
  footprint?: string | null;
  native_res?: string | null;
  effective_res?: string | null;
  units?: string | null;
  qa_flags?: string[];
  transformation?: string | null;
  licence?: string | null;
  citation?: string | null;
  url?: string | null;
  note?: string | null;
}

export interface Trend {
  per_decade: number;
  low: number;
  high: number;
  p_value: number;
  n_years: number;
  first_year: number;
  last_year: number;
}

export interface SeasonMetric {
  value: number;
  normal: number;
  percentile: number;
}

export interface HistoryYear {
  year: number;
  crop_id: string | null;
  name: string | null;
  share: number | null;
  source: string;
  confirmed: boolean;
}

export interface CoverageRow {
  layer: string;
  status: "supported" | "partial" | "unavailable" | "not_available" | string;
  note?: string;
}

export interface CountyCropRow {
  crop_id?: string | null;
  name: string;
  share?: number;
  acres?: number;
}

export interface Report {
  id: string;
  name: string;
  geometry: GeoJSON.Geometry;
  centroid: [number, number];
  area_ha: number;
  mode: string;
  place: Record<string, string | null>;
  region: { region: string | null; label: string | null; exact: boolean; note: string | null };
  errors?: Record<string, string>;
  evidence: Record<string, ApiEvidence>;
  climate?: {
    years: [number, number];
    normal_period: [number, number];
    n_normal_years: number;
    normals: Record<string, number>;
    monthly: { month: number; tmean: number; tmax: number; tmin: number; precip: number; et0: number; wind10_max: number }[];
    frost: {
      last_spring_frost_doy_median: number | null;
      last_spring_frost_doy_p90: number | null;
      first_fall_frost_doy_median: number | null;
      first_fall_frost_doy_p10: number | null;
      frost_free_days_median: number | null;
      frost_free_days_p10: number | null;
      frost_free_years?: number;
    };
    trends: Record<string, Trend>;
    annual: Record<string, number>[];
    elevation_m?: number;
    evidence_id: string;
  };
  season?: {
    available: boolean;
    as_of?: string;
    year?: number;
    n_years_compared?: number;
    metrics?: Record<string, SeasonMetric>;
    evidence_id?: string;
    reason?: string;
  };
  hazards_weekly?: {
    weeks: { week: number; p_frost: number; p_heat: number; p_heavy: number; windy_days: number; p_dry: number; precip: number; wind_max: number; p_windy: number }[];
    heavy_rain_threshold_mm: number;
    wind_threshold_10m: number;
    heat_c: number;
    evidence_id: string;
  };
  r_factor?: number;
  soil?: {
    available: boolean;
    properties?: Record<string, number | string | null>;
    units?: { mukey: string; musym: string; name: string; share: number }[];
    evidence_id?: string;
    drainage_class?: string | null;
    reason?: string;
    /** "ssurgo" (survey) or "soilgrids" (modelled 250 m map). */
    source?: string;
    label?: string;
  };
  terrain?: {
    elev_mean_m: number;
    elev_range_m: number;
    slope_mean_pct: number;
    slope_p90_pct: number;
    share_slope_gt5: number;
    ls_mean: number;
    low_spot_share: number | null;
    pixel_m: number;
    zones?: number[][];
    /** How slope was computed (e.g. plane fit on SRTM outside the US). */
    method?: string;
    evidence_id: string;
  };
  crop_history?: { evidence_id: string; years: { year: number; available: boolean; res_m?: number }[] };
  county_crops?: { rows?: CountyCropRow[]; year?: number; evidence_id?: string } | null;
  coverage?: CoverageRow[];
  history?: HistoryYear[];
  /** Boundary source (e.g. Fields of The World outside the US) with its attribution. */
  boundary?: { source?: string; attribution?: string; licence?: string; confidence_mean?: number } | null;
}

export interface Quant {
  p10: number;
  p50: number;
  p90: number;
  n: number;
  mean?: number;
}

export interface ApiConfidence {
  level: "high" | "medium" | "low";
  score?: number;
  reasons: string[];
}

export interface SeqStep {
  cash: string | null;
  cover: string | null;
  /** Second harvested crop in the same year (e.g. rice then wheat). */
  double?: string | null;
}

export interface TimelineBar {
  crop_id: string;
  name: string;
  kind: "cash" | "cover" | string;
  start_week: number;
  end_week: number;
}

export interface RuleFlag {
  message: string;
  /** Spanish text of the rule message (wave U9). */
  message_es?: string;
  flag: string;
  sources?: string[];
}

/** M2 county yield for one crop of a rotation (county statistics, not the field). */
export interface CountyYield {
  available: boolean;
  unit?: string;
  p10?: number;
  p50?: number;
  p90?: number;
  trend_year?: number;
  county_years?: [number, number];
  n_weather_years?: number;
  worst_weather_year?: { year: number; p50: number; drivers?: string[] };
  scale?: string;
  label?: string;
  note?: string;
  reason?: string;
  si?: {
    model_id?: string;
    name?: string;
    drivers?: string[];
    driver_effects?: { label: string; mean_abs_effect?: number; unit?: string }[];
    confidence?: ApiConfidence;
    information_cutoff?: string;
    card?: string;
  };
  evidence?: { source: string; is_nasa?: boolean; product?: string; years?: [number, number]; footprint?: string; scale?: string; url?: string; licence?: string }[];
}

/** The card's per-crop county yields (M2), or an empty object. */
export function countyYields(card: { indicators: Record<string, unknown> }): Record<string, CountyYield> {
  const y = card.indicators?.yield_county;
  return y && typeof y === "object" ? (y as Record<string, CountyYield>) : {};
}

/** Where a crop's price, cost and yield came from: the farmer's own numbers or the USDA ERS / M2 defaults. */
export type BudgetSource = "yours" | "ERS" | string;

/** Economics block (top level of /compare, and on each card once owner B adds it). */
export interface Economics {
  available?: boolean;
  reason?: string | null;
  region?: string | null;
  missing?: string[];
  yield_anchor?: Record<string, { source?: string; yield_p50?: number; ers_yield_p50?: number }>;
  /* The fields below appear only when `budgets` or a `price=` scenario were sent. */
  /** crop_id -> "yours" | "ERS" */
  budget_source?: Record<string, BudgetSource>;
  /** crop_id -> where each of price, cost and yield came from ("yours" | "ERS" | "M2"). */
  budget_detail?: Record<string, { price?: string; cost?: string; yield?: string }>;
  /** The farmer's numbers the run used, with the crop's yield unit (e.g. "bushels per planted acre"). */
  budgets_used?: Record<string, CropBudget & { unit?: string | null }>;
  /** Crops without regional data whose profit needs all three numbers. */
  budget_incomplete?: { crop_id: string; reason: string }[];
  /** Entries the API could not use (unknown crop, out of range…). */
  budget_ignored?: string[];
  price_scale?: number;
  /** e.g. "Prices scaled by -20% (hypothetical; profit only)" */
  price_note?: string | null;
  profit_available?: boolean;
}

export interface CardData {
  id: string;
  name: string;
  rotation_label: string;
  family: string;
  family_name: string;
  family_name_es?: string;
  is_baseline: boolean;
  /** A farmer-built option sent in `custom` (always shown, like the baseline). Missing = false.
      Custom cards have ids "u1"…, family "custom", family_name "Your own option"; one can be best_for_you. */
  is_custom?: boolean;
  custom_name?: string;
  economics?: Economics;
  sequence: SeqStep[];
  shown: boolean;
  rank: number;
  score: number;
  match: number;
  pareto: boolean;
  win_share: number;
  best_for_you: boolean;
  indicators: Record<string, Quant | undefined>;
  deltas?: Record<string, number>;
  confidence: ApiConfidence;
  confidence_by_indicator?: Record<string, ApiConfidence>;
  why: string[];
  evidence: { text: string; sources: string[]; kind: string }[];
  benefits: string[];
  tradeoffs_risks: string[];
  information_gaps: string[];
  check_locally: { id: string; text: string; text_es?: string }[];
  try_it_small?: { example?: string; example_es?: string; design?: string; measure?: string[]; duration?: string };
  flags: RuleFlag[];
  issues?: string[];
  timeline?: {
    weekly_cover: number[][];
    bars: TimelineBar[];
    bare_weeks: number;
    bare_windy_overlap_weeks: number;
    bare_heavy_rain_overlap_weeks: number;
  };
  sources: Record<string, { cite: string; url?: string }>;
  model: { id: string; name: string; kind: "si" | "rules" | "process"; weather_years?: number };
}

export interface FitCrop {
  crop_id: string;
  name: string;
  name_es?: string;
  season?: string;
  roles?: string[];
  water?: { season_etc_mm: number; dry_year_rain_mm: number; covered_share: number } | null;
  common_here?: boolean | null;
  reasons?: { stage: string; reason: string; rule: string }[];
}

export interface CompareResult {
  supported: boolean;
  reason?: string;
  field_id: string;
  region?: Report["region"];
  scenario: string;
  priorities: string[];
  weights: Record<string, number>;
  baseline_detection?: {
    observed?: string[];
    frequency?: Record<string, number>;
    label: string;
    fit_error?: number;
    /** "typical_regional" when no crop-history map exists here and a documented regional rotation stands in. */
    method?: string;
    source?: string;
    note?: string;
  };
  what_fits?: { supported: boolean; feasible: FitCrop[]; excluded: FitCrop[]; method?: string; note?: string };
  facts?: Record<string, unknown>;
  economics?: Economics;
  /** Farmer-built options that failed the hard rules, with the reasons. */
  custom_rejected?: { name: string; reasons: string[] }[];
  /** Set when a custom option lacks profit (profit then drops out of the ranking for all options). */
  custom_note?: string | null;
  candidates_considered?: number;
  candidates_simulated?: number;
  excluded_candidates?: { id: string; family: string; name: string; note?: string; reason: string }[];
  cards: CardData[];
  all_cards: CardData[];
  ranking?: {
    keys: string[];
    top: string;
    runner_up: string;
    stable: boolean;
    flips: { indicator: string; label: string; extra_weight: number }[];
    win_share: Record<string, number>;
    scores: Record<string, number>;
    rank: Record<string, number>;
    pareto: Record<string, boolean>;
    contributions?: Record<string, { indicator: string; label: string; weight: number; value?: number }[]>;
    dropped_indicators?: (string | { indicator?: string; key?: string; reason?: string })[];
  };
  risk_weeks?: { windy: number[]; heavy_rain: number[]; definition: string };
  binding_constraint?: { constraint?: string; message?: string; adjustments?: (string | { text: string })[] } | string | null;
  weather_years?: { n: number; first: number; last: number };
  assumptions?: string[];
  reminder?: string;
  farm_used?: {
    equipment?: string[];
    equipment_inferred_from?: string[];
    markets?: string[];
    markets_assumed_from?: string;
    livestock?: boolean;
    hay_buyer?: boolean;
    water?: string;
    irrigation_mm?: number;
    wont_grow?: string[];
  };
}

export interface SearchResult {
  label: string;
  lat: number;
  lon: number;
  kind: string;
  bbox?: [number, number, number, number];
  geojson?: GeoJSON.Geometry;
}

export interface FieldAt {
  found: boolean;
  note?: string;
  feature?: GeoJSON.Feature;
  meta?: Record<string, unknown> & { acres?: number; county?: string; cdl_sequence?: Record<string, number> };
}

export interface Job {
  id: string;
  field_id: string;
  status: "queued" | "running" | "done" | "failed";
  progress: number;
  step: string;
  failures: string[];
}

export interface Pilot {
  key?: string;
  label: string;
  name?: string;
  note?: string;
  field_id?: string;
  lat?: number;
  lon?: number;
  feature?: { geometry: GeoJSON.Geometry };
  meta?: Record<string, unknown>;
  farm?: Record<string, unknown>;
  supported?: boolean;
  area_ha?: number;
}

export interface GlossaryResp {
  terms: { id: string; term_en: string; term_es: string; en: string; es: string }[];
}

export interface WindRoseData {
  sectors: number;
  speed_bins_ms: number[];
  freq: number[][];
  hours: number;
  share_above_8ms: number;
  months: number[];
  years: [number, number];
  evidence: ApiEvidence;
}

export interface ReplaySide {
  available: boolean;
  card_id: string;
  name: string;
  phase: string[];
  covers: (string | null)[];
  weeks: {
    week: number;
    soil_water_pct_low: number | null;
    soil_water_pct_mid: number | null;
    soil_water_pct_high: number | null;
    stress_low: number | null;
    stress_mid: number | null;
    stress_high: number | null;
    erosion_t_ha: number;
    soil_cover: number;
    rain_mm: number;
    tmax_c: number;
    eta_mm: number;
  }[];
  yield?: { low: number; mid: number; high: number; typical: number; crop: string; pct_of_typical: number; rank_among_years: number; n_years: number };
  erosion_total_t_ha?: number;
  bare_weeks?: number;
  reason?: string;
}

export interface ReplayResult {
  available: boolean;
  reason?: string;
  year: number;
  label: string;
  actual_crop?: { name: string; share: number };
  current?: ReplaySide;
  alternative?: ReplaySide;
  season_rain_mm?: number;
  season_rain_percentile?: number;
  driest_years?: number[];
  ndvi?: { status: string; points: { week: number; ndvi: number }[] };
  band_method?: string;
  evidence?: { weather?: string; ndvi?: ApiEvidence };
  never_claim?: string;
}

export interface TwinPlace {
  lat: number;
  lon: number;
  country?: string;
  admin1?: string;
  near_town?: string;
  near_town_km?: number;
  cropland_share_pct?: number;
  distance?: number;
  km_from_field?: number;
  n_models_agree?: number;
  models_with_analog_within_km?: string[];
  novel?: boolean;
  crops?: { scale?: string; label?: string; country?: string; years?: number[]; top?: { crop: string; ha?: number; share: number }[] };
}

export interface TwinScenario {
  available: boolean;
  reason?: string;
  n_models: number;
  indicators: Record<string, { median: number; min: number; max: number; n: number }>;
  deltas?: Record<string, { median: number; min: number; max: number; n: number }>;
  analogs: TwinPlace[];
  agreement?: { n_agree: number; n_models: number; radius_km: number; cluster_centre?: TwinPlace };
  novel_climate?: { flag: boolean; best_distance: number; threshold: number; models_novel: number };
}

export interface TwinsResult {
  status: "ready" | "loading" | "failed" | string;
  reason?: string;
  error?: string;
  model_id?: string;
  model_version?: string;
  kind?: "si" | "rules" | "process";
  field?: { lat: number; lon: number };
  periods?: { baseline: number[]; future: number[]; analog_present_day?: string[] };
  baseline?: { indicators: Record<string, number>; scale_label?: string; evidence_id?: string };
  indicator_units?: Record<string, string>;
  analog_method?: { features?: string[]; distance?: string; candidates?: number };
  evidence_ids?: Record<string, string>;
  evidence?: Record<string, ApiEvidence>;
  confidence?: ApiConfidence;
  scenarios?: Record<string, TwinScenario>;
}

export interface NextMoveResult {
  usual_next?: {
    model?: string;
    model_id?: string;
    next?: { crop_id: string; name?: string; probability: number }[];
    validation?: Record<string, unknown>;
    area_rotation_mix?: unknown;
    confidence?: ApiConfidence;
    [k: string]: unknown;
  };
  smart_next?: { card_id?: string; name?: string; [k: string]: unknown };
  history?: unknown;
}

export interface ValidationSite {
  pilot: string;
  station: string;
  station_name: string;
  period: string[];
  tmax_daily?: { n: number; bias: number; mae: number; r: number };
  tmin_daily?: { n: number; bias: number; mae: number; r: number };
  precip_daily?: { n: number; bias: number; mae: number; r: number };
  precip_monthly?: { n: number; bias: number; mae: number; r: number };
  annual_precip_mean_mm?: { power: number; station: number };
  heavy_rain_days?: { station_events: number; hit_rate_same_day: number; hit_rate_within_1_day: number };
}

/** An official warning from the US National Weather Service at the field point. */
export interface NwsWarning {
  event: string;
  severity?: string | null;
  headline?: string | null;
  onset?: string | null;
  ends?: string | null;
  sender?: string | null;
  url?: string | null;
}

export interface ForecastAlerts {
  forecast?: { time: string[]; temperature_2m_max: number[]; temperature_2m_min: number[]; precipitation_sum: number[]; wind_speed_10m_max: number[] };
  retrieved?: string;
  alerts: { type: string; day: string; value: number; key: string; message: string }[];
  source?: string;
  warnings?: NwsWarning[];
  /** e.g. "Official warnings are available for US fields only". */
  warnings_note?: string | null;
}

/** The farmer's own numbers for one crop; any subset. Profit uses them in place of ERS / M2 for that crop. */
export interface CropBudget {
  price_usd_bu?: number;
  cost_usd_ac?: number;
  yield_bu_ac?: number;
}

/** A farmer-built rotation sent in `custom` (same step shape as `baseline`). */
export interface CustomOption {
  name: string;
  sequence: SeqStep[];
}

/** POST /api/fields/{fid}/compare body. Every field is optional; `{}` serves the precomputed pilot result. */
export interface CompareBody {
  farm?: object;
  priorities?: string[];
  baseline?: SeqStep[];
  /** "normal" | "dry" | "hot" | "wet" | "custom:rain=<pct>,temp=<°C>[,price=<pct>]" */
  scenario?: string;
  /** crop_id -> own price/cost/yield. */
  budgets?: Record<string, CropBudget>;
  /** Up to 4 farmer-built options. */
  custom?: CustomOption[];
}

/** /api/kb/crops entry. The text fields come from engine/rules/crops.yaml and may be absent. */
export interface KbCrop {
  id: string;
  name: string;
  name_es?: string;
  family?: string;
  roles?: string[];
  season?: string;
  equipment?: string[];
  blurb_en?: string;
  blurb_es?: string;
  check_first_en?: string[] | string;
  check_first_es?: string[] | string;
}

/** Card ids whose crops priced with the farmer's own numbers ("yours"), from the card or the top-level economics. */
export function ownBudgetCrops(card: CardData, cmp?: CompareResult): string[] {
  const src = card.economics?.budget_source ?? cmp?.economics?.budget_source ?? {};
  const crops = new Set<string>();
  for (const s of card.sequence ?? []) for (const c of [s.cash, s.double]) if (c) crops.add(c);
  return [...crops].filter((c) => src[c] === "yours");
}

/* ---------------- fetchers ---------------- */

export const api = {
  health: () => req<{ ok: boolean; keys: Record<string, boolean> }>("/api/health"),
  search: (q: string) => req<{ results: SearchResult[] }>(`/api/search?q=${encodeURIComponent(q)}`),
  fieldAt: (lat: number, lon: number) => req<FieldAt>(`/api/fields/at?lat=${lat}&lon=${lon}`),
  createField: (body: { geometry: GeoJSON.Geometry; name?: string; meta?: unknown }) =>
    req<{ field_id: string; job_id?: string; status: string }>("/api/fields", { method: "POST", body: JSON.stringify(body) }),
  job: (id: string) => req<Job>(`/api/jobs/${id}`),
  report: (id: string) => req<Report>(`/api/fields/${id}/report`),
  compare: (id: string, body: CompareBody) =>
    req<CompareResult>(`/api/fields/${id}/compare`, { method: "POST", body: JSON.stringify(body) }),
  wind: (id: string) => req<WindRoseData>(`/api/fields/${id}/wind`),
  replay: (id: string, year: number, alt?: string) =>
    req<ReplayResult>(`/api/fields/${id}/replay?year=${year}${alt ? `&alt=${encodeURIComponent(alt)}` : ""}`),
  twins: (id: string) => req<TwinsResult>(`/api/fields/${id}/twins`),
  nextmove: (id: string) => req<NextMoveResult>(`/api/fields/${id}/nextmove`),
  forecastAlerts: (id: string) => req<ForecastAlerts>(`/api/fields/${id}/forecast-alerts`),
  validation: () => req<{ sites: ValidationSite[]; [k: string]: unknown }>(`/api/validation/weather`),
  glossary: () => req<GlossaryResp>("/api/kb/glossary"),
  sources: () => req<Record<string, { cite: string; url?: string }>>("/api/kb/sources"),
  crops: () => req<Record<string, KbCrop>>("/api/kb/crops"),
  pilots: () => req<{ pilots: Pilot[] }>("/api/pilots"),
  alertsHistory: (fieldId?: string) => req<{ items?: AlertItem[] }>(`/api/alerts/history${fieldId ? `?field_id=${fieldId}` : ""}`),
  subscribe: (body: unknown) => req<{ status?: string; channel?: string; path?: string; message?: string }>("/api/alerts/subscribe", { method: "POST", body: JSON.stringify(body) }),
};

export interface AlertItem {
  id?: string;
  kind?: string;
  type?: string;
  title?: string;
  message?: string;
  sent_at?: string;
  date?: string;
  field_id?: string;
}

/* ---------------- hooks ---------------- */

const STATIC = { staleTime: Infinity, gcTime: Infinity, retry: 1 } as const;

export const useGlossaryQ = () => useQuery({ queryKey: ["glossary"], queryFn: api.glossary, ...STATIC });
export const useSourcesQ = () => useQuery({ queryKey: ["sources"], queryFn: api.sources, ...STATIC });
export const useCropsQ = () => useQuery({ queryKey: ["crops"], queryFn: api.crops, ...STATIC });
export const usePilotsQ = () => useQuery({ queryKey: ["pilots"], queryFn: api.pilots, ...STATIC });

export const useReportQ = (id: string | null) =>
  useQuery({ queryKey: ["report", id], queryFn: () => api.report(id!), enabled: !!id, staleTime: 5 * 60_000, retry: 1 });

export const useCompareQ = (id: string | null, body: CompareBody, enabled = true) => {
  // Rotation names are shown in plain words ("corn, corn, then soybean"), not the engine's "Corn ×2–Soybean".
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const select = useMemo(() => (d: CompareResult) => plainCompare(d, lang), [lang]);
  return useQuery({
    queryKey: ["compare", id, body],
    queryFn: () => api.compare(id!, body),
    select,
    enabled: !!id && enabled,
    staleTime: 5 * 60_000,
    placeholderData: keepPreviousData,
    retry: 1,
  });
};

export const useWindQ = (id: string | null) =>
  useQuery({ queryKey: ["wind", id], queryFn: () => api.wind(id!), enabled: !!id, staleTime: Infinity, retry: 1 });

export const useReplayQ = (id: string | null, year: number, alt?: string) => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const select = useMemo(
    () => (d: ReplayResult): ReplayResult => ({
      ...d,
      current: d.current ? { ...d.current, name: plainRotation(d.current.name, lang) } : d.current,
      alternative: d.alternative ? { ...d.alternative, name: plainRotation(d.alternative.name, lang) } : d.alternative,
    }),
    [lang],
  );
  return useQuery({
    queryKey: ["replay", id, year, alt],
    queryFn: () => api.replay(id!, year, alt),
    select,
    enabled: !!id,
    staleTime: 60_000,
    refetchInterval: (q) => (q.state.data?.ndvi?.status === "loading" ? 5000 : false),
    retry: (n, e) => !(e instanceof ApiError && e.status === 404) && n < 1,
  });
};

export const useTwinsQ = (id: string | null) =>
  useQuery({
    queryKey: ["twins", id],
    queryFn: () => api.twins(id!),
    enabled: !!id,
    staleTime: 60_000,
    refetchInterval: (q) => (q.state.data?.status === "loading" ? 5000 : false),
    retry: (n, e) => !(e instanceof ApiError && e.status === 404) && n < 1,
  });

export const useNextMoveQ = (id: string | null) =>
  useQuery({
    queryKey: ["nextmove", id],
    queryFn: () => api.nextmove(id!),
    enabled: !!id,
    staleTime: 5 * 60_000,
    retry: (n, e) => !(e instanceof ApiError && e.status === 404) && n < 1,
  });

export const useForecastAlertsQ = (id: string | null) =>
  useQuery({ queryKey: ["fc-alerts", id], queryFn: () => api.forecastAlerts(id!), enabled: !!id, staleTime: 10 * 60_000, retry: 0 });

export const useValidationQ = () => useQuery({ queryKey: ["validation"], queryFn: api.validation, staleTime: Infinity, retry: 0 });

export const useAlertsHistoryQ = (fieldId?: string) =>
  useQuery({
    queryKey: ["alerts-history", fieldId],
    queryFn: () => api.alertsHistory(fieldId),
    retry: (n, e) => !(e instanceof ApiError && e.status === 404) && n < 1,
  });

export const isNotFound = (e: unknown) => e instanceof ApiError && (e.status === 404 || e.status === 405);

/* ---------------- NASA Earthdata layers (SMAP L4, GRACE-FO, HLS, IMERG) ---------------- */

export interface NasaEvidence extends ApiEvidence {
  available?: boolean;
  reason?: string;
  fix?: string;
}

export interface NasaResult {
  available: boolean;
  reason?: string;
  field_id?: string;
  generated?: string;
  smap?: {
    weekly_climatology: { week: number; p10: number; p25: number; p50: number; p75: number; p90: number; n_years: number }[];
    last_12_months_weekly: { week_ending: string; sm_rootzone: number; percentile: number | null; anomaly_vs_median: number | null; product_pctl?: number | null }[];
    record?: [string, string];
    units?: string;
    percentile_method?: string;
    evidence: NasaEvidence;
  };
  grace?: {
    monthly: [string, number | null][];
    trend?: { cm_per_yr: number; ci95_cm_per_yr: [number, number]; method?: string; period?: [string, string]; n_months?: number; missing_months_in_record?: number };
    units?: string;
    scale_label: string;
    evidence: NasaEvidence;
  };
  hls?: {
    label: string;
    threshold_ndvi?: number;
    monthly: { month: string; status: "green" | "bare_or_residue" | string; ndvi_median: number | null; ndvi_max?: number | null; n_clear_scenes: number }[];
    scenes_usable?: number;
    evidence: NasaEvidence;
  };
  imerg?: { value: unknown; evidence: NasaEvidence };
}

export interface NasaValidation {
  generated?: string;
  smap?: { field_id: string; name: string; available: boolean; reason?: string; period?: string[]; weekly_raw?: { n: number; r: number }; weekly_anomaly?: { n: number; r: number; spearman?: number } }[];
  hls?: { field_id: string; name: string; available: boolean; reason?: string; years?: { year: number; cdl_crop?: string; comparable: boolean; note?: string; months_with_clear_scene: number; agree_months: number; agreement: number }[] }[];
  imerg?: { pilot: string; available: boolean; reason?: string }[];
  grace?: { field_id?: string; name?: string; trend?: { cm_per_yr: number; ci95_cm_per_yr: [number, number] } }[];
}

export const useNasaQ = (id: string | null) =>
  useQuery({ queryKey: ["nasa", id], queryFn: () => req<NasaResult>(`/api/fields/${id}/nasa`), enabled: !!id, staleTime: 10 * 60_000, retry: 1 });

export const useNasaValidationQ = () =>
  useQuery({ queryKey: ["nasa-validation"], queryFn: () => req<NasaValidation>("/api/validation/nasa"), staleTime: Infinity, retry: 0 });
