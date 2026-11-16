/* Guided Demo: one farmer's story in 13 steps. Planet → Story County → a real field (Globe Home drill-down), then the
   Story County pilot field: what the data says, the farmer's facts, the best option and why others were left out,
   bare soil vs wind, priorities, the 2012 drought, the 2040s climate and the report. Each step drives the app and
   works at phone, tablet, side-pane and desktop widths (targets switch to the mobile tabs or the menu). */
import { useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Tour } from "../design";
import type { TourStep } from "../design";
import { useApp, PRIORITY_IDS } from "../store";
import { usePlan } from "../planStore";
import type { PriorityId } from "../store";
import { loadDemoField, FARM_HEIGHT } from "../fieldFlow";
import { queryClient } from "../queryClient";
import type { CompareResult } from "../api";
import { globeCommand } from "./GlobeDrill";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const narrow = () => window.matchMedia("(max-width: 767px)").matches;

async function waitFor(sel: string, ms = 12000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (document.querySelector(sel)) return true;
    await sleep(120);
  }
  return false;
}

/** The Story County pilot field (pilot iowa_story, b96d39c7a833) sits at this point. */
const DEMO_PT = { lat: 42.1112, lon: -93.4693 };

/** Show the Globe Home and wait until its map is mounted. */
async function toHome(setView: (v: "home") => void) {
  // The welcome page sits over the home view: close it too, or the globe never shows.
  usePlan.getState().close();
  if (useApp.getState().view !== "home") setView("home");
  await waitFor('[data-tour="zoom-ladder"]');
  await waitFor(".home__globe canvas", 15000);
  await sleep(300);
}

/** Fly the home globe and wait for the flight (instant with reduced motion). */
async function fly(lat: number, lon: number, height: number, seconds = 2.2) {
  const reduced = useApp.getState().reducedMotion || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  globeCommand({ type: "fly", lat, lon, height, duration: reduced ? 0 : seconds });
  await sleep(reduced ? 400 : seconds * 1000 + 300);
}

function latestCompare(): CompareResult | undefined {
  const qs = queryClient.getQueriesData<CompareResult>({ queryKey: ["compare"] });
  return qs.map(([, d]) => d).filter(Boolean).pop();
}

/** Field Studio on the demo field, with the given mobile tab on phones. In guided (Simple) mode the same content is
    split over the step pages: the field and map on step 2, priorities, options and the timeline on step 3. */
async function studio(part: "map" | "options" | "timeline" | "field" | "prio") {
  const st = useApp.getState();
  if (st.mode === "simple") {
    const page = part === "map" || part === "field" ? "studio" : "compare";
    if (page === "compare") st.set({ compareRequested: true });
    if (st.view !== page || usePlan.getState().planView) st.setView(page);
    await waitFor(page === "studio" ? ".guided--s2" : ".guided--s3", 20000);
    return;
  }
  if (st.view !== "studio") st.setView("studio");
  if (narrow()) st.set({ mobileTab: part === "prio" ? "field" : part });
  await waitFor(".studio, .studio-m, .guided", 20000);
}

export default function DemoTour() {
  const { t } = useTranslation();
  const open = useApp((s) => s.tourOpen);
  const set = useApp((s) => s.set);
  const setView = useApp((s) => s.setView);
  // The demo re-ranks priorities live; put the visitor's own order back when it ends.
  const saved = useRef<{ priorities: PriorityId[]; touched: boolean } | null>(null);
  useEffect(() => {
    if (open) {
      const st = useApp.getState();
      saved.current = { priorities: st.priorities, touched: st.prioritiesTouched };
    }
  }, [open]);

  const steps: TourStep[] = useMemo(
    () => [
      {
        target: '[data-tour="drill-hint"]',
        title: t("tour.t1_t"),
        body: t("tour.t1_b"),
        placement: "top",
        onEnter: async () => {
          await toHome(setView);
          globeCommand({ type: "clear" });
          await fly(30, -80, 2.0e7, 1.6);
        },
      },
      {
        target: '[data-tour="drill-hint"]',
        title: t("tour.t2_t"),
        body: t("tour.t2_b"),
        placement: "top",
        onEnter: async () => {
          await toHome(setView);
          globeCommand({ type: "clear" });
          await fly(42.04, -93.47, 5.0e4, 2.8);
        },
      },
      {
        target: '[data-tour="drill-status"]',
        title: t("tour.t3_t"),
        body: t("tour.t3_b"),
        placement: "top",
        onEnter: async () => {
          await toHome(setView);
          globeCommand({ type: "clear" });
          await fly(DEMO_PT.lat, DEMO_PT.lon, FARM_HEIGHT, 1.8);
          await waitFor('[data-tour="drill-status"][data-state="ready"]', 25000);
        },
      },
      {
        target: '[data-tour="field-card"]',
        title: t("tour.t4_t"),
        body: t("tour.t4_b"),
        placement: "left",
        onEnter: async () => {
          await toHome(setView);
          if (!document.querySelector('[data-tour="field-card"]')) {
            globeCommand({ type: "pick", lat: DEMO_PT.lat, lon: DEMO_PT.lon });
            await waitFor('[data-tour="analyze-field"]', 25000);
            await sleep(1300);
          }
        },
      },
      {
        target: '[data-tour="area-report"] .ar-sec',
        title: t("tour.t5_t"),
        body: t("tour.t5_b"),
        placement: "right",
        onEnter: async () => {
          await loadDemoField();
          await waitFor(".studio, .studio-m, .guided", 30000);
          set({ centerTab: "report", whyNotOpen: false, expandedCard: null, ...(narrow() ? { mobileTab: "options" } : {}) });
          setView("studio");
          await waitFor('[data-tour="area-report"] .ar-sec', 20000);
        },
      },
      {
        // NASA HLS greenness, pixel by pixel, inside the field boundary (Area Report).
        target: '[data-tour="field-satellite"]',
        title: t("tour.t5b_t"),
        body: t("tour.t5b_b"),
        placement: "left",
        onEnter: async () => {
          set({ centerTab: "report", ...(narrow() ? { mobileTab: "options" } : {}) });
          setView("studio");
          await waitFor('[data-tour="field-satellite"]', 30000);
          document.querySelector('[data-tour="field-satellite"]')?.scrollIntoView({ block: "start" });
          await sleep(400);
        },
      },
      {
        target: '[data-tour="crop-history"]',
        title: t("tour.t6_t"),
        body: t("tour.t6_b"),
        placement: "right",
        onEnter: async () => {
          set({ centerTab: "map" });
          await studio("field");
          await waitFor('[data-tour="crop-history"]');
        },
      },
      {
        target: '[data-tour="strategy-card"]',
        title: t("tour.t7_t"),
        body: t("tour.t7_b"),
        placement: "left",
        onEnter: async () => {
          set({ centerTab: "map", expandedCard: null, compareRequested: true });
          await studio("options");
          await waitFor('[data-tour="strategy-card"]', 30000);
          const best = latestCompare()?.cards.find((c) => c.best_for_you);
          if (best) set({ selectedCard: best.id });
          // Start the options column at the top so the card is in view.
          document.querySelector('[data-tour="rotation-options"] .panel__scroll')?.scrollTo({ top: 0 });
          await sleep(150);
        },
      },
      {
        target: '[data-tour="why-not-panel"]',
        title: t("tour.t8_t"),
        body: t("tour.t8_b"),
        placement: "left",
        onEnter: async () => {
          await studio("options");
          await waitFor('[data-tour="why-not"]');
          set({ whyNotOpen: true });
          await waitFor('[data-tour="why-not-panel"]');
          await sleep(200);
        },
      },
      {
        target: '[data-tour="overlap"]',
        title: t("tour.t9_t"),
        body: t("tour.t9_b"),
        placement: "top",
        onEnter: async () => {
          set({ whyNotOpen: false });
          await studio("timeline");
          await waitFor('[data-tour="overlap"]');
        },
      },
      {
        target: '[data-tour="priorities"]',
        title: t("tour.t10_t"),
        body: t("tour.t10_b"),
        placement: "right",
        onEnter: async () => {
          await studio("prio");
          await waitFor('[data-tour="priorities"]');
          const cur = useApp.getState().priorities;
          const next: PriorityId[] = ["water", ...cur.filter((p) => p !== "water")];
          useApp.getState().setPriorities(next.join() === cur.join() ? [...PRIORITY_IDS] : next);
        },
      },
      {
        target: ".rp-kpis",
        title: t("tour.t11_t"),
        body: t("tour.t11_b"),
        placement: "bottom",
        onEnter: async () => {
          setView("replay");
          await waitFor(".rp-kpis", 30000);
        },
      },
      {
        target: '[data-tour="twins"] .twin-card',
        title: t("tour.t12_t"),
        body: t("tour.t12_b"),
        placement: "left",
        onEnter: async () => {
          setView("twins");
          await waitFor('[data-tour="twins"] .twin-card', 30000);
        },
      },
      {
        // The action plan: checklist for the adviser, notes and a printable plan.
        target: ".plan-stages",
        title: t("tour.t13_t"),
        body: t("tour.t13_b"),
        placement: "top",
        onEnter: async () => {
          setView("studio");
          await waitFor(".studio, .studio-m, .guided", 30000);
          usePlan.getState().open("plan");
          await waitFor(".plan-stages", 30000);
        },
      },
    ],
    [t, set, setView],
  );

  return (
    <Tour
      steps={steps}
      open={open}
      onClose={() => {
        set({ tourOpen: false, whyNotOpen: false });
        // Leave the app with the visitor's own priority order.
        if (saved.current) set({ priorities: saved.current.priorities, prioritiesTouched: saved.current.touched });
      }}
      label={t("tour.label")}
    />
  );
}
