/* The money calculator's per-field inputs (acres, edits, toggles), kept on this device. Shared by the money page
   (views/MoneyCalc.tsx) and the whole-farm view, so both work from the same numbers. */
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { safeStorage } from "./store";
import type { CropEdits, Num, Stress } from "./money";

/* ---------------- the farmer's calculator state (per field, kept on this device) ---------------- */

export interface FieldMoney {
  edits: Record<string, CropEdits>;
  acres?: Num;
  coverCost?: Num;
  pumpCost?: Num;
  overhead?: boolean;
  losses?: boolean;
  picks?: string[];
  stress?: Stress;
  /** Count fertilizer N saved after soybeans / legume covers (default off: USDA average costs already partly include it) and the farmer's own $/lb N. */
  nOn?: boolean;
  nPrice?: Num;
  /** Count a conservation payment for cover-crop years (default off), which NRCS item, and the farmer's own rate. */
  payOn?: boolean;
  payItem?: number;
  payRate?: Num;
  /** One-time costs of a switch (whole field $, or $/ac without a field size), by option id. */
  oneTime?: Record<string, Num>;
  /** The farmer's saved budgets (My Field / earlier "Use these numbers") were copied in once. */
  seeded?: boolean;
}

export interface MoneyState {
  byField: Record<string, FieldMoney>;
  patch: (fid: string, p: Partial<FieldMoney>) => void;
}

export const EMPTY: FieldMoney = { edits: {} };

export const useMoneyStore = create<MoneyState>()(
  persist(
    (set, get) => ({
      byField: {},
      patch: (fid, p) => set({ byField: { ...get().byField, [fid]: { ...(get().byField[fid] ?? EMPTY), ...p } } }),
    }),
    { name: "fieldshift-money", storage: createJSONStorage(() => safeStorage), partialize: (s) => ({ byField: s.byField }) },
  ),
);

