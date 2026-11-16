/* Plan state (Zustand + persist): the Plan / Build your own / Saved plans / How well does it work? views,
   the per-field action plan (chosen option, checklist ticks, adviser notes), farmer-built rotations and saved
   snapshots. Stored in localStorage through the store's never-throwing storage. Nothing here holds numbers:
   every value shown in these views comes from the API. */
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { SeqStep } from "./api";
import { useApp, safeStorage, PRIORITY_IDS } from "./store";
import type { Farm, FieldBudgets, FieldSel, PriorityId, ReviewTicks, Scenario } from "./store";

export type PlanView = "plan" | "builder" | "saved" | "validation" | "money" | "welcome" | "fields" | "farm";
/** "farm": the whole-farm view (wave U9), all the farmer's fields together; it needs no open field. */
export const PLAN_VIEWS: PlanView[] = ["plan", "builder", "saved", "validation", "money", "welcome", "fields", "farm"];
/** Views that need a field (the others work without one). */
export const PLAN_NEEDS_FIELD: PlanView[] = ["plan", "builder", "money"];

export type Stage = "commit" | "plant" | "field";
export const STAGES: Stage[] = ["commit", "plant", "field"];

/** One farmer-built rotation option (same step shape as the compare baseline). */
export interface CustomOption {
  key: string;
  name: string;
  sequence: SeqStep[];
}

export const MAX_CUSTOM = 4;
export const MAX_NOTES = 10_000;

export interface FieldPlan {
  /** Card id of the chosen option (null = the top-ranked one). */
  chosen: string | null;
  /** Display name of the chosen option when it was picked (used when the card is not in the current result). */
  chosenName?: string;
  /** Checklist item id -> done. */
  done: Record<string, boolean>;
  notes: string;
  custom: CustomOption[];
  /** The options as last sent with "Test these" (null = not tested). The Plan view compares with these included. */
  tested: CustomOption[] | null;
  updated?: string;
}

export const EMPTY_PLAN: FieldPlan = { chosen: null, done: {}, notes: "", custom: [], tested: null };

/** A saved snapshot: everything needed to reopen the same comparison and plan. */
export interface SavedPlan {
  kind: "farmsmart-plan";
  version: 1;
  id: string;
  saved_at: string;
  field: { id: string; name: string; lat?: number; lon?: number };
  priorities: string[];
  scenario: string;
  farm: Farm | null;
  budgets: FieldBudgets | null;
  /** "I've checked this" ticks from My Field. */
  reviewed?: ReviewTicks | null;
  baseline: SeqStep[] | null;
  plan: FieldPlan;
}

interface PlanState {
  planView: PlanView | null;
  plans: Record<string, FieldPlan>;
  saved: SavedPlan[];
  open: (v: PlanView) => void;
  close: () => void;
  patchPlan: (fieldId: string, p: Partial<FieldPlan>) => void;
  addSaved: (s: SavedPlan) => void;
  removeSaved: (id: string) => void;
}

const now = () => new Date().toISOString();

export const usePlan = create<PlanState>()(
  persist(
    (set, get) => ({
      planView: null,
      plans: {},
      saved: [],
      open: (v) => {
        set({ planView: v });
        writePlanHash(v, useApp.getState().field?.id ?? null);
      },
      close: () => {
        if (get().planView) set({ planView: null });
      },
      patchPlan: (fieldId, p) => {
        const cur = get().plans[fieldId] ?? EMPTY_PLAN;
        set({ plans: { ...get().plans, [fieldId]: { ...cur, ...p, updated: now() } } });
      },
      addSaved: (s) => set({ saved: [s, ...get().saved.filter((x) => x.id !== s.id)].slice(0, 40) }),
      removeSaved: (id) => set({ saved: get().saved.filter((x) => x.id !== id) }),
    }),
    {
      name: "fieldshift-plan",
      storage: createJSONStorage(() => safeStorage),
      partialize: (s) => ({ plans: s.plans, saved: s.saved }),
    },
  ),
);

/** The current field's plan (stable empty object when none). */
export function useFieldPlan(): [FieldPlan, (p: Partial<FieldPlan>) => void] {
  const fid = useApp((s) => s.field?.id ?? null);
  const plan = usePlan((s) => (fid ? s.plans[fid] : undefined)) ?? EMPTY_PLAN;
  const patch = usePlan((s) => s.patchPlan);
  return [plan, (p) => (fid ? patch(fid, p) : undefined)];
}

/* ---------------- routing ----------------
   The app's View type lives in store.ts; these four views are routed here instead. Any store navigation
   (setView, selectField) closes them, so every existing link, the tour and the footer keep working. */

{
  const base = useApp.getState();
  const origSetView = base.setView;
  const origSelect = base.selectField;
  useApp.setState({
    setView: (v) => {
      usePlan.getState().close();
      origSetView(v);
    },
    selectField: (f: FieldSel) => {
      usePlan.getState().close();
      origSelect(f);
    },
  });
}

function writePlanHash(v: PlanView, fieldId: string | null) {
  const h = `#/${v}${fieldId && PLAN_NEEDS_FIELD.includes(v) ? `/${fieldId}` : ""}`;
  if (window.location.hash !== h) history.replaceState(null, "", h);
}

/** Read "#/plan/<field id>" (or builder, money, saved, validation). */
export function readPlanHash(): { view: PlanView; fieldId: string | null } | null {
  const m = window.location.hash.match(/^#\/(\w+)(?:\/([\w-]+))?/);
  if (!m || !PLAN_VIEWS.includes(m[1] as PlanView)) return null;
  return { view: m[1] as PlanView, fieldId: m[2] ?? null };
}

/* ---------------- snapshots ---------------- */


export function makeSnapshot(): SavedPlan | null {
  const st = useApp.getState();
  if (!st.field) return null;
  const plan = usePlan.getState().plans[st.field.id] ?? EMPTY_PLAN;
  return {
    kind: "farmsmart-plan",
    version: 1,
    id: `${st.field.id}-${Date.now().toString(36)}`,
    saved_at: now(),
    field: { id: st.field.id, name: st.field.name, lat: st.field.lat, lon: st.field.lon },
    priorities: [...st.priorities],
    scenario: st.scenario,
    farm: st.farmTouched ? st.farm : null,
    budgets: st.budgets[st.field.id] ?? null,
    reviewed: st.reviewed[st.field.id] ?? null,
    baseline: st.baseline,
    plan,
  };
}

/** Reopen a snapshot: select its field, restore the settings, then show the plan. */
export function reopenSnapshot(s: SavedPlan) {
  const st = useApp.getState();
  const known = st.savedFields.find((f) => f.id === s.field.id);
  st.selectField(known ?? { id: s.field.id, name: s.field.name, lat: s.field.lat, lon: s.field.lon });
  const pr = s.priorities.filter((p): p is PriorityId => (PRIORITY_IDS as readonly string[]).includes(p));
  const patch: Record<string, unknown> = {
    priorities: pr.length === PRIORITY_IDS.length ? pr : [...PRIORITY_IDS],
    prioritiesTouched: pr.length === PRIORITY_IDS.length && pr.join() !== PRIORITY_IDS.join(),
    scenario: (s.scenario || "normal") as Scenario,
    baseline: s.baseline ?? null,
  };
  if (s.farm) {
    patch.farm = s.farm;
    patch.farmTouched = true;
  }
  useApp.getState().set(patch as Parameters<typeof st.set>[0]);
  const app = useApp.getState();
  app.setBudgets(s.field.id, s.budgets && typeof s.budgets === "object" ? s.budgets : null);
  for (const [part, on] of Object.entries(s.reviewed ?? {})) app.setReviewed(s.field.id, part as keyof ReviewTicks, !!on);
  usePlan.getState().patchPlan(s.field.id, s.plan);
  usePlan.getState().open("plan");
}

/** Validate an imported JSON plan; returns a snapshot or an error key. */
export function parseSnapshot(raw: unknown): SavedPlan | string {
  if (!raw || typeof raw !== "object") return "saved.import_bad";
  const o = raw as Partial<SavedPlan>;
  const kind = o.kind as string | undefined;
  if ((kind !== "farmsmart-plan" && kind !== "field-shift-plan") || o.version !== 1) return "saved.import_bad_kind";
  if (!o.field || typeof o.field.id !== "string" || !/^[\w-]+$/.test(o.field.id)) return "saved.import_bad_field";
  const plan = (o.plan ?? {}) as Partial<FieldPlan>;
  const seqOk = (seq: unknown): seq is SeqStep[] =>
    Array.isArray(seq) && seq.length > 0 && seq.length <= 8 && seq.every((x) => x && typeof x === "object" && "cash" in x);
  const custom = Array.isArray(plan.custom)
    ? plan.custom
        .filter((c) => c && typeof c.name === "string" && seqOk(c.sequence))
        .slice(0, MAX_CUSTOM)
        .map((c, i) => ({ key: String(c.key ?? `imp${i}`), name: c.name.slice(0, 60), sequence: c.sequence }))
    : [];
  return {
    kind: "farmsmart-plan",
    version: 1,
    id: typeof o.id === "string" ? o.id : `${o.field.id}-${Date.now().toString(36)}`,
    saved_at: typeof o.saved_at === "string" ? o.saved_at : now(),
    field: { id: o.field.id, name: String(o.field.name ?? o.field.id).slice(0, 120), lat: num(o.field.lat), lon: num(o.field.lon) },
    priorities: Array.isArray(o.priorities) ? o.priorities.map(String) : [...PRIORITY_IDS],
    scenario: typeof o.scenario === "string" ? o.scenario : "normal",
    farm: o.farm && typeof o.farm === "object" ? (o.farm as Farm) : null,
    budgets: o.budgets && typeof o.budgets === "object" ? (o.budgets as FieldBudgets) : null,
    reviewed: o.reviewed && typeof o.reviewed === "object" ? (o.reviewed as ReviewTicks) : null,
    baseline: seqOk(o.baseline) ? o.baseline : null,
    plan: {
      chosen: typeof plan.chosen === "string" ? plan.chosen : null,
      chosenName: typeof plan.chosenName === "string" ? plan.chosenName : undefined,
      done: plan.done && typeof plan.done === "object" ? (plan.done as Record<string, boolean>) : {},
      notes: typeof plan.notes === "string" ? plan.notes.slice(0, MAX_NOTES) : "",
      custom,
      tested: Array.isArray(plan.tested) && plan.tested.length && custom.length ? custom : null,
    },
  };
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

/** Save a file in the browser. */
export function downloadBlob(data: BlobPart, type: string, filename: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
