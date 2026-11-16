/* Whole farm (wave U9): the farmer's fields as one farm, kept on this device (localStorage "fieldshift-farm").
   Each field keeps its plan (an option id from that field's comparison, or null = keep the current rotation) and a
   lock. Acres live in the money calculator's store (useMoneyStore.byField[fid].acres) so the money page and the farm
   agree. Nothing here holds results: every number on the farm page is worked out from the API by farm.ts. */
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { safeStorage, useApp } from "./store";
import type { Farm, FieldSel } from "./store";
import type { Stress } from "./money";
import type { Assignment, Risk } from "./farm";
import type { Weights } from "./score";

export const MAX_FARM_FIELDS = 30;

export interface FarmField {
  id: string;
  name: string;
  lat?: number;
  lon?: number;
  geometry?: GeoJSON.Geometry;
  meta?: Record<string, unknown> | null;
  farm?: Partial<Farm>;
  /** Option id from the field's comparison; null = keep the current rotation. */
  plan: string | null;
  locked?: boolean;
  addedAt: string;
  /** Added by "Try a sample farm". */
  sample?: boolean;
}

export interface FarmSettings {
  risk: Risk;
  /** Largest share of the farm one crop may take in a year (0–1), or null for no limit. */
  maxCropShare: number | null;
  stress: Stress;
  /** The farmer's own score weights (sliders); null or missing = the goal's preset weights. */
  weights?: Weights | null;
}

interface FarmState {
  fields: FarmField[];
  settings: FarmSettings;
  /** The plans before the last "Apply" (this session only), for Undo. */
  undo: Record<string, string | null> | null;
  add: (f: FieldSel | FarmField, plan?: string | null, sample?: boolean) => boolean;
  remove: (id: string) => void;
  rename: (id: string, name: string) => void;
  setPlan: (id: string, plan: string | null) => void;
  lock: (id: string, on: boolean) => void;
  addSavedFields: () => number;
  setSettings: (p: Partial<FarmSettings>) => void;
  /** Apply a suggested plan (baseline ids become null), keeping the previous plans for Undo. */
  applyPlans: (a: Assignment, baselines: Record<string, string>) => void;
  undoApply: () => void;
  clear: () => void;
}

const now = () => new Date().toISOString();

/** Farm settings to carry with a field: the live ones for the open field (if changed), else the saved ones. */
function farmOf(f: FieldSel | FarmField): Partial<Farm> | undefined {
  const st = useApp.getState();
  if (st.field?.id === f.id && st.farmTouched) return st.farm;
  return f.farm;
}

export const useFarm = create<FarmState>()(
  persist(
    (set, get) => ({
      fields: [],
      settings: { risk: "balanced", maxCropShare: null, stress: "normal" },
      undo: null,
      add: (f, plan = null, sample = false) => {
        const cur = get().fields;
        if (cur.some((x) => x.id === f.id)) return false;
        if (cur.length >= MAX_FARM_FIELDS) return false;
        const entry: FarmField = {
          id: f.id,
          name: f.name,
          lat: f.lat,
          lon: f.lon,
          meta: f.meta ?? null,
          farm: farmOf(f),
          plan,
          locked: false,
          addedAt: now(),
          ...(sample ? { sample: true } : {}),
        };
        set({ fields: [...cur, entry] });
        return true;
      },
      remove: (id) => set({ fields: get().fields.filter((x) => x.id !== id) }),
      rename: (id, name) => {
        const n = name.trim().slice(0, 60);
        if (!n) return;
        set({ fields: get().fields.map((x) => (x.id === id ? { ...x, name: n } : x)) });
        // The same field in "My fields" and the open field keep the same name.
        const st = useApp.getState();
        if (st.savedFields.some((x) => x.id === id) || st.field?.id === id)
          st.set({
            savedFields: st.savedFields.map((x) => (x.id === id ? { ...x, name: n } : x)),
            ...(st.field?.id === id && st.field ? { field: { ...st.field, name: n } } : {}),
          });
      },
      setPlan: (id, plan) => set({ fields: get().fields.map((x) => (x.id === id ? { ...x, plan } : x)) }),
      lock: (id, on) => set({ fields: get().fields.map((x) => (x.id === id ? { ...x, locked: on } : x)) }),
      addSavedFields: () => {
        let n = 0;
        for (const f of useApp.getState().savedFields) if (get().add(f)) n++;
        return n;
      },
      setSettings: (p) => set({ settings: { ...get().settings, ...p } }),
      applyPlans: (a, baselines) => {
        const prev = Object.fromEntries(get().fields.map((x) => [x.id, x.plan]));
        set({
          undo: prev,
          fields: get().fields.map((x) => (x.id in a ? { ...x, plan: a[x.id] === baselines[x.id] ? null : a[x.id] } : x)),
        });
      },
      undoApply: () => {
        const u = get().undo;
        if (!u) return;
        set({ undo: null, fields: get().fields.map((x) => (x.id in u ? { ...x, plan: u[x.id] } : x)) });
      },
      clear: () => set({ fields: [], undo: null }),
    }),
    {
      name: "fieldshift-farm",
      storage: createJSONStorage(() => safeStorage),
      // Small entries only: geometry is re-read from the API report when needed.
      partialize: (s) => ({ fields: s.fields.map((f) => ({ ...f, geometry: undefined })), settings: s.settings }),
    },
  ),
);

export const useInFarm = (id: string | null | undefined) => useFarm((s) => !!id && s.fields.some((f) => f.id === id));
