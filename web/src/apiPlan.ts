/* API client for the plan, builder, validation, field-satellite, rainfall-by-year and warnings features (wave U5).
   Same style as api.ts: typed fetchers + TanStack Query hooks. Nothing here invents values; a missing endpoint
   or block is reported to the UI as "not available". */
import { useMemo } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ApiError } from "./api";
import type { CardData, CompareBody, CompareResult, ForecastAlerts, SeqStep } from "./api";
import { plainCompare } from "./lib";

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

const noRetry404 = (n: number, e: unknown) => !(e instanceof ApiError && (e.status === 404 || e.status === 405)) && n < 1;

/* ---------------- field satellite (HLS greenness, ECOSTRESS water use) ---------------- */

/** Evidence block of the field-satellite endpoints (contract shape, plus any ApiEvidence fields the API adds). */
export interface SatEvidence {
  source_id?: string;
  source?: string;
  product: string;
  resolution?: string;
  url?: string;
  retrieved?: string;
  licence?: string;
  citation?: string;
  note?: string;
  collections?: string;
  observation_period?: [string, string];
  qa?: string[];
}

export interface HlsScene {
  id: string;
  date: string;
  sensor: string;
  cloud_pct_scene: number | null;
  n_pixels: number;
  n_usable: number;
  usable_pct: number;
  ndvi_mean: number | null;
  ndvi_p10: number | null;
  ndvi_p50: number | null;
  ndvi_p90: number | null;
  withheld: boolean;
  withheld_reason: string | null;
}

export interface HlsResult {
  available: boolean;
  reason: string | null;
  field_id?: string;
  scenes?: HlsScene[];
  grid_scene_id?: string | null;
  period?: { start: string; end: string };
  evidence?: SatEvidence;
  scale_note?: string;
  never_claim?: string;
}

export interface HlsGrid {
  /** false (HTTP 200) when the grid could not be read; then there are no values. */
  available?: boolean;
  reason?: string | null;
  scene_id?: string;
  /** e.g. "EPSG:32615": the native UTM grid. */
  crs?: string;
  /** Affine [a, b, c, d, e, f] in UTM metres: x = a*col + b*row + c, y = d*col + e*row + f. */
  transform?: number[];
  note?: string;
  date: string;
  sensor: string;
  width: number;
  height: number;
  /** [west, south, east, north], EPSG:4326, of the native 30 m grid window. */
  bbox: [number, number, number, number];
  values: (number | null)[][];
  inside: boolean[][];
}

export interface EtObservation {
  datetime: string;
  et_mm_day: number | null;
  et_sd_mm_day: number | null;
  cloud: boolean;
  water: boolean;
  pixel_center?: [number, number];
  scene_id?: string;
}

export interface EcostressResult {
  available: boolean;
  reason: string | null;
  observations?: EtObservation[];
  period?: { start: string; end: string };
  search?: { n_overpasses?: number; n_cloudy?: number; n_returned?: number; n_outside_solar_hours?: number };
  evidence?: SatEvidence;
  scale_note?: string;
}

/* ---------------- rainfall by year ---------------- */

export interface RainYear {
  year: number;
  season_mm: number | null;
  annual_mm: number | null;
  partial: boolean;
}

export interface RainfallYears {
  years: RainYear[];
  season?: { label: string; start_doy: number; end_doy: number; basis?: string; crop_id?: string };
  partial_note?: string;
  median_years?: [number, number];
  period?: [string, string];
  evidence?: { source?: string; product?: string; url?: string; citation?: string; scale?: string };
  median_season_mm?: number | null;
  source?: string;
  scale_note?: string;
  available?: boolean;
  reason?: string;
}

/* ---------------- validation ---------------- */

export interface M2Point {
  crop: string;
  state?: string;
  county?: string;
  year: number;
  p10: number;
  p50: number;
  p90: number;
  actual: number;
}

export interface ValidationAll {
  m2?: {
    coverage_80?: Record<string, number>;
    test_years?: string;
    points?: M2Point[];
    points_unit?: string;
    points_note?: string;
    model_card?: string;
    unit?: string;
    note?: string;
    source?: string;
    scale?: string;
    detail?: Record<string, { deployed?: boolean; not_deployed_reason?: string | null; n?: number; coverage_80?: number }>;
  };
  m2_note?: string;
  m10?: { levels?: { level: string; coverage: number; n: number; target?: number }[]; target_coverage?: number; what?: string; report?: string; note?: string };
  m10_note?: string;
  weather?: { pairs?: { site: string; station?: string; variable: string; label?: string; r: number; n?: number; bias?: number; mae?: number }[]; report?: string; note?: string };
  weather_note?: string;
  m3?: {
    top1?: number;
    top3?: number;
    baselines?: Record<string, number | Record<string, number>>;
    area?: string;
    areas?: { area: string; n_fields?: number; held_out_year?: number; top1?: number; top3?: number; baselines?: Record<string, number> }[];
    what?: string;
    model_card?: string;
    n?: number;
    note?: string;
  };
  m3_note?: string;
  generated?: string;
  note?: string;
}

/* ---------------- forecast warnings (extends api.ts ForecastAlerts) ---------------- */

export interface NwsWarning {
  event: string;
  severity?: string | null;
  headline?: string | null;
  onset?: string | null;
  ends?: string | null;
  sender?: string | null;
  url?: string | null;
}

export type ForecastWithWarnings = ForecastAlerts & { warnings?: NwsWarning[]; warnings_note?: string | null; warnings_source?: string | null; warnings_retrieved?: string | null };

/* ---------------- compare with farmer-built options ---------------- */

export type PlanCard = CardData & { is_custom?: boolean; custom_name?: string };
export type PlanCompare = Omit<CompareResult, "cards" | "all_cards"> & {
  cards: PlanCard[];
  all_cards: PlanCard[];
  custom_rejected?: { name: string; reasons: string[] }[];
};

export interface CustomIn {
  name: string;
  sequence: SeqStep[];
}

export type PlanCompareBody = CompareBody & { custom?: CustomIn[]; budgets?: unknown };

export interface PlanChecklistItem {
  id: string;
  label: string;
  done: boolean;
}

export interface PlanPdfBody extends PlanCompareBody {
  plan: { chosen: string; checklist: PlanChecklistItem[]; notes: string };
}

/* ---------------- fetchers ---------------- */

export const apiPlan = {
  hls: (fid: string) => req<HlsResult>(`/api/fields/${fid}/hls`),
  hlsGrid: (fid: string, sceneId: string) => req<HlsGrid>(`/api/fields/${fid}/hls/${encodeURIComponent(sceneId)}/grid`),
  ecostress: (fid: string) => req<EcostressResult>(`/api/fields/${fid}/ecostress`),
  rainfallYears: (fid: string) => req<RainfallYears>(`/api/fields/${fid}/rainfall-years`),
  validation: () => req<ValidationAll>("/api/validation"),
  compare: (fid: string, body: PlanCompareBody) =>
    req<PlanCompare>(`/api/fields/${fid}/compare`, { method: "POST", body: JSON.stringify(body) }),
  /** POST report.pdf with the action plan page. Returns the PDF blob. */
  planPdf: async (fid: string, body: PlanPdfBody): Promise<Blob> => {
    const res = await fetch(`/api/fields/${fid}/report.pdf`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
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
    return res.blob();
  },
};

/* ---------------- hooks ---------------- */

export const useHlsQ = (fid: string | null) =>
  useQuery({ queryKey: ["hls", fid], queryFn: () => apiPlan.hls(fid!), enabled: !!fid, staleTime: 30 * 60_000, retry: noRetry404 });

export const useHlsGridQ = (fid: string | null, sceneId: string | null) =>
  useQuery({
    queryKey: ["hls-grid", fid, sceneId],
    queryFn: () => apiPlan.hlsGrid(fid!, sceneId!),
    enabled: !!fid && !!sceneId,
    staleTime: Infinity,
    placeholderData: keepPreviousData,
    retry: noRetry404,
  });

export const useEcostressQ = (fid: string | null) =>
  useQuery({ queryKey: ["ecostress", fid], queryFn: () => apiPlan.ecostress(fid!), enabled: !!fid, staleTime: 30 * 60_000, retry: noRetry404 });

export const useRainfallYearsQ = (fid: string | null) =>
  useQuery({ queryKey: ["rain-years", fid], queryFn: () => apiPlan.rainfallYears(fid!), enabled: !!fid, staleTime: Infinity, retry: noRetry404 });

export const useValidationAllQ = () => useQuery({ queryKey: ["validation-all"], queryFn: apiPlan.validation, staleTime: Infinity, retry: noRetry404 });

/** Compare with farmer-built options; rotation names in plain words like the main compare. */
export const usePlanCompareQ = (fid: string | null, body: PlanCompareBody, enabled = true) => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const select = useMemo(() => (d: PlanCompare) => plainCompare(d as unknown as CompareResult, lang) as unknown as PlanCompare, [lang]);
  return useQuery({
    queryKey: ["compare", fid, body],
    queryFn: () => apiPlan.compare(fid!, body),
    select,
    enabled: !!fid && enabled,
    staleTime: 5 * 60_000,
    placeholderData: keepPreviousData,
    retry: 1,
  });
};
