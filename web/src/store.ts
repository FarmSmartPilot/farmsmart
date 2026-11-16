/* App state (Zustand). Settings and saved fields persist in localStorage; everything else is per session. */
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { StateStorage } from "zustand/middleware";
import type { CompareBody, CropBudget, SeqStep } from "./api";

export type View = "home" | "studio" | "compare" | "nextmove" | "wheel" | "replay" | "twins" | "region" | "alerts" | "sources";
export type Mode = "simple" | "expert";
export type Dim = "3d" | "2d";
export type Lang = "en" | "es";
export type Units = "metric" | "imperial";
export type ScenarioPreset = "normal" | "dry" | "hot" | "wet";
/** A preset, or a slider scenario "custom:rain=<pct>,temp=<deltaC>" (hypothetical weather, re-simulated by the backend). */
export type Scenario = ScenarioPreset | `custom:${string}`;

export const SCENARIO_PRESETS: ScenarioPreset[] = ["normal", "dry", "hot", "wet"];

/** Build the slider scenario string; zero change is "normal" so the cached result is used.
    `pricePct` scales crop prices in the profit indicators only (e.g. −20 = prices 20 % lower). */
export function customScenario(rainPct: number, tempC: number, pricePct = 0): Scenario {
  const r = Math.round(rainPct);
  const tc = Math.round(tempC * 10) / 10;
  const p = Math.round(pricePct);
  if (r === 0 && tc === 0 && p === 0) return "normal";
  return p ? `custom:rain=${r},temp=${tc},price=${p}` : `custom:rain=${r},temp=${tc}`;
}

/** Stress tests offered beside the presets: hypothetical weather or prices, re-run on the past weather years. */
export const STRESS_TESTS = [
  { id: "drier_hotter", scenario: "custom:rain=-20,temp=2" as Scenario },
  { id: "lower_prices", scenario: "custom:rain=0,temp=0,price=-20" as Scenario },
] as const;

/** Parse a slider scenario; null for presets. */
export function parseCustom(s: string | null | undefined): { rain: number; temp: number; price: number } | null {
  if (!s || !s.startsWith("custom:")) return null;
  const kv = Object.fromEntries(
    s
      .slice(7)
      .split(",")
      .map((x) => x.split("="))
      .filter((x) => x.length === 2),
  );
  const num = (v: unknown) => {
    const n = Number(v ?? 0);
    return Number.isFinite(n) ? n : 0;
  };
  return { rain: num(kv.rain), temp: num(kv.temp), price: num(kv.price) };
}

/** localStorage that never throws (private mode, quota, blocked storage). */
export const safeStorage: StateStorage = {
  getItem: (k) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  setItem: (k, v) => {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* storage full or blocked: settings stay for this session only */
    }
  },
  removeItem: (k) => {
    try {
      localStorage.removeItem(k);
    } catch {
      /* blocked */
    }
  },
};

export const PRIORITY_IDS = ["soil_cover", "erosion", "water", "profit", "soil_health", "pests", "workload"] as const;
export type PriorityId = (typeof PRIORITY_IDS)[number];

/** Rank-order weights for chips 1..7 (METHODS §6; fieldshift/engine/rank.py RANK_WEIGHTS). */
export const RANK_WEIGHTS = [0.35, 0.25, 0.18, 0.12, 0.06, 0.04, 0.02] as const;

/** One-click priority orders. "balanced" is the default order, so it keeps the precomputed comparison. */
export const PRIORITY_PRESETS: { id: "balanced" | "soil" | "water" | "profit"; order: PriorityId[] }[] = [
  { id: "balanced", order: [...PRIORITY_IDS] },
  { id: "soil", order: ["soil_health", "erosion", "soil_cover", "water", "pests", "profit", "workload"] },
  { id: "water", order: ["water", "soil_cover", "soil_health", "erosion", "profit", "pests", "workload"] },
  { id: "profit", order: ["profit", "workload", "water", "erosion", "soil_cover", "pests", "soil_health"] },
];

/** The farmer's own price, cost and yield per crop, by field id. */
export type FieldBudgets = Record<string, CropBudget>;

/** "I've checked this" ticks per field id. */
export interface ReviewTicks {
  history?: boolean;
  soil?: boolean;
}

/** The farmer's latest soil test (sent as `farm.soil_test` only when entered). */
export interface SoilTest {
  ph?: number;
  om_pct?: number;
  year?: number;
}

/** "Your own records" per field: harvested yields by year (crop + amount per acre) and the latest soil test. */
export interface FieldRecords {
  yields?: Record<string, { crop?: string | null; value?: number | null }>;
  soil_test?: SoilTest | null;
}

/** A soil test worth sending: pH and/or organic matter in range (year optional). */
export function cleanSoilTest(s: SoilTest | null | undefined): SoilTest | null {
  if (!s) return null;
  const out: SoilTest = {};
  if (typeof s.ph === "number" && Number.isFinite(s.ph) && s.ph >= 3 && s.ph <= 10) out.ph = s.ph;
  if (typeof s.om_pct === "number" && Number.isFinite(s.om_pct) && s.om_pct >= 0 && s.om_pct <= 30) out.om_pct = s.om_pct;
  if (out.ph === undefined && out.om_pct === undefined) return null;
  if (typeof s.year === "number" && Number.isInteger(s.year) && s.year >= 1980 && s.year <= 2100) out.year = s.year;
  return out;
}

export const EQUIPMENT_IDS =["row_crop_planter", "grain_drill", "combine", "baler", "forage_harvester", "irrigation"] as const;

export interface Farm {
  equipment: string[];
  livestock: boolean;
  hay_buyer: boolean;
  irrigation_mm: number;
  water: "rainfed" | "irrigated";
  markets?: string[];
  /** True once the user ticked "I have a buyer for…": the backend then uses only these markets. */
  markets_confirmed?: boolean;
  wont_grow: string[];
  /** "I apply low N (≤150 kg/ha)" → 100; omitted otherwise. */
  n_rate_kg_ha?: number;
}

export const DEFAULT_FARM: Farm = {
  equipment: ["row_crop_planter", "grain_drill", "combine"],
  livestock: false,
  hay_buyer: false,
  irrigation_mm: 0,
  water: "rainfed",
  wont_grow: [],
};

export interface FieldSel {
  id: string;
  name: string;
  geometry?: GeoJSON.Geometry;
  lat?: number;
  lon?: number;
  meta?: Record<string, unknown> | null;
  farm?: Partial<Farm>;
}

export interface AlertPrefs {
  email: string;
  kinds: string[];
  frost_c: number;
  heat_c: number;
  wind_ms: number;
  rain_mm: number;
  quiet_start: string;
  quiet_end: string;
}

interface State {
  view: View;
  mode: Mode;
  /** Demo sign-in: display name only (no password, nothing sent). null = not signed in. */
  user: { name: string } | null;
  dim: Dim;
  lang: Lang;
  units: Units;
  reducedMotion: boolean;
  field: FieldSel | null;
  /** Boundary source of the current field, for its provenance button. */
  fieldMeta: Record<string, unknown> | null;
  savedFields: FieldSel[];
  priorities: PriorityId[];
  /** True once the user has touched priorities; only then do we send them (keeps the cached default compare). */
  prioritiesTouched: boolean;
  farm: Farm;
  farmTouched: boolean;
  /** Edited crop history: year -> crop_id. */
  historyEdits: Record<number, string>;
  historyConfirmed: boolean;
  /** Explicit baseline rotation sent to compare (null = use the detected one). */
  baseline: SeqStep[] | null;
  scenario: Scenario;
  selectedCard: string | null;
  compareRequested: boolean;
  activeLayers: string[];
  alerts: AlertPrefs;
  tourOpen: boolean;
  /** Field being looked up / analysed (progress bar). */
  pending: { label: string; progress: number; step: string; error?: string; note?: string } | null;
  /** Map fly target requested by search or the tour. */
  flyTarget: { lat: number; lon: number; bbox?: [number, number, number, number]; height?: number; pick?: boolean; key: number } | null;
  centerTab: "map" | "report";
  whyNotOpen: boolean;
  expandedCard: string | null;
  timelineAsTable: boolean;
  /** Mobile Field Studio tab. */
  mobileTab: "map" | "options" | "timeline" | "field";
  /** Rotation options: every shown card, or only the top card beside the current rotation. */
  optionsView: "all" | "duo";
  /** Own prices/costs/yields, by field id then crop id (persisted). Sent as `budgets` only when set. */
  budgets: Record<string, FieldBudgets>;
  /** "I've checked this" ticks, by field id (persisted). */
  reviewed: Record<string, ReviewTicks>;
  /** "Your own records" (yields by year, soil test), by field id (persisted). */
  records: Record<string, FieldRecords>;
  setRecords: (fieldId: string, p: Partial<FieldRecords>) => void;
  set: (p: Partial<State>) => void;
  setBudgets: (fieldId: string, b: FieldBudgets | null) => void;
  setReviewed: (fieldId: string, part: keyof ReviewTicks, on: boolean) => void;
  setView: (v: View) => void;
  selectField: (f: FieldSel) => void;
  setPriorities: (p: PriorityId[]) => void;
  setFarm: (p: Partial<Farm>) => void;
  toggleLayer: (id: string) => void;
}

export const useApp = create<State>()(
  persist(
    (set, get) => ({
      view: "home",
      mode: "simple",
      user: null,
      dim: "3d",
      lang: "en",
      units: "metric",
      reducedMotion: false,
      field: null,
      fieldMeta: null,
      savedFields: [],
      priorities: [...PRIORITY_IDS],
      prioritiesTouched: false,
      farm: DEFAULT_FARM,
      farmTouched: false,
      historyEdits: {},
      historyConfirmed: false,
      baseline: null,
      scenario: "normal",
      selectedCard: null,
      compareRequested: false,
      activeLayers: [],
      alerts: {
        email: "",
        kinds: ["frost", "heat", "heavy_rain_bare", "wind_low_cover", "cover_window", "weekly_digest"],
        frost_c: 0,
        heat_c: 35,
        wind_ms: 8,
        rain_mm: 25,
        quiet_start: "21:00",
        quiet_end: "06:00",
      },
      tourOpen: false,
      pending: null,
      flyTarget: null,
      mobileTab: "map",
      centerTab: "map",
      whyNotOpen: false,
      expandedCard: null,
      timelineAsTable: false,
      optionsView: "all",
      budgets: {},
      reviewed: {},
      records: {},
      setRecords: (fieldId, p) => {
        const cur = get().records;
        set({ records: { ...cur, [fieldId]: { ...(cur[fieldId] ?? {}), ...p } } });
      },
      set: (p) => set(p),
      setBudgets: (fieldId, b) => {
        const next = { ...get().budgets };
        if (b && Object.keys(b).length) next[fieldId] = b;
        else delete next[fieldId];
        set({ budgets: next });
      },
      setReviewed: (fieldId, part, on) => {
        const cur = get().reviewed;
        set({ reviewed: { ...cur, [fieldId]: { ...(cur[fieldId] ?? {}), [part]: on } } });
      },
      setView: (view) => {
        set({ view });
        syncHash(view, get().field?.id ?? null);
      },
      selectField: (f) => {
        const saved = get().savedFields.filter((s) => s.id !== f.id);
        set({
          field: f,
          savedFields: [f, ...saved].slice(0, 12),
          historyEdits: {},
          historyConfirmed: false,
          farm: { ...DEFAULT_FARM, ...(f.farm ?? {}) },
          farmTouched: !!f.farm,
          fieldMeta: f.meta ?? null,
          baseline: null,
          selectedCard: null,
          // Rotation options run straight away with the default priorities (pilot results are cached).
          compareRequested: true,
          scenario: "normal",
          view: "studio",
          mobileTab: "map",
        });
        syncHash("studio", f.id);
      },
      setPriorities: (priorities) => set({ priorities, prioritiesTouched: true }),
      setFarm: (p) => set({ farm: { ...get().farm, ...p }, farmTouched: true }),
      toggleLayer: (id) => {
        const cur = get().activeLayers;
        set({ activeLayers: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] });
      },
    }),
    {
      name: "fieldshift-app",
      storage: createJSONStorage(() => safeStorage),
      partialize: (s) => ({
        mode: s.mode,
        user: s.user,
        dim: s.dim,
        lang: s.lang,
        units: s.units,
        reducedMotion: s.reducedMotion,
        // Small entries only (id, name, centroid, farm); geometry is re-read from the API report.
        savedFields: s.savedFields.map((f) => ({ id: f.id, name: f.name, lat: f.lat, lon: f.lon, meta: f.meta, farm: f.farm })),
        alerts: s.alerts,
        priorities: s.priorities,
        budgets: s.budgets,
        reviewed: s.reviewed,
        records: s.records,
      }),
    },
  ),
);

function syncHash(view: View, fieldId: string | null) {
  const h = view === "home" ? "#/" : `#/${view}${fieldId ? `/${fieldId}` : ""}`;
  if (window.location.hash !== h) history.replaceState(null, "", h);
}

/** Read "#/studio/<id>" on load. */
export function readHash(): { view: View; fieldId: string | null } | null {
  const m = window.location.hash.match(/^#\/(\w+)(?:\/([\w-]+))?/);
  if (!m) return null;
  const views: View[] = ["home", "studio", "compare", "nextmove", "wheel", "replay", "twins", "region", "alerts", "sources"];
  const v = views.includes(m[1] as View) ? (m[1] as View) : null;
  return v ? { view: v, fieldId: m[2] ?? null } : null;
}

/** Only the filled-in numbers of each crop; crops with nothing set are left out. */
export function cleanBudgets(b: FieldBudgets | null | undefined): FieldBudgets | null {
  if (!b) return null;
  const out: FieldBudgets = {};
  for (const [crop, v] of Object.entries(b)) {
    const e: CropBudget = {};
    if (typeof v?.price_usd_bu === "number" && Number.isFinite(v.price_usd_bu)) e.price_usd_bu = v.price_usd_bu;
    if (typeof v?.cost_usd_ac === "number" && Number.isFinite(v.cost_usd_ac)) e.cost_usd_ac = v.cost_usd_ac;
    if (typeof v?.yield_bu_ac === "number" && Number.isFinite(v.yield_bu_ac)) e.yield_bu_ac = v.yield_bu_ac;
    if (Object.keys(e).length) out[crop] = e;
  }
  return Object.keys(out).length ? out : null;
}

/** Body sent to /compare. Only edited parts are sent, so the default call can use the precomputed result
    (an untouched field sends `{}`). Own prices and costs go as `budgets` only when the farmer has set some. */
export function useCompareBody(): CompareBody {
  const priorities = useApp((s) => s.priorities);
  const farm = useApp((s) => s.farm);
  const farmTouched = useApp((s) => s.farmTouched);
  const baseline = useApp((s) => s.baseline);
  const scenario = useApp((s) => s.scenario);
  const fieldId = useApp((s) => s.field?.id ?? null);
  const fieldBudgets = useApp((s) => (fieldId ? s.budgets[fieldId] : undefined));
  const soilTest = cleanSoilTest(useApp((s) => (fieldId ? s.records[fieldId]?.soil_test : undefined)));
  const body: CompareBody = {};
  if (priorities.join() !== PRIORITY_IDS.join()) body.priorities = priorities;
  if (farmTouched) body.farm = farm;
  // The farmer's soil test overrides the mapped pH and organic matter; sent only when entered (else `{}` stays cached).
  if (soilTest) body.farm = { ...(farmTouched ? farm : {}), soil_test: soilTest };
  if (baseline) body.baseline = baseline;
  if (scenario !== "normal") body.scenario = scenario;
  const budgets = cleanBudgets(fieldBudgets);
  if (budgets) body.budgets = budgets;
  return body;
}
