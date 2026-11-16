/* App shell: top bar, sub-nav, current view, footer, guided demo, toasts and the field-analysis progress bar. */
import { Suspense, lazy, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useMediaQuery } from "./design";
import { useApp, readHash } from "./store";
import { TopBar, SubNav, Footer } from "./components/TopBar";
import { PendingBar, Toast } from "./components/common";
import DemoTour from "./components/DemoTour";
import StepBar, { stepOf } from "./components/StepBar";
import SideRail from "./components/SideRail";
import { GuidedPage, GuidedField, GuidedCompare, GuidedTwinsLink } from "./components/Guided";
import { usePlan, readPlanHash, PLAN_NEEDS_FIELD } from "./planStore";
import GlobeHome from "./views/GlobeHome";
import FieldStudio from "./views/FieldStudio";

const StrategyCompare = lazy(() => import("./views/StrategyCompare"));
const NextMove = lazy(() => import("./views/NextMove"));
const SeasonWheel = lazy(() => import("./views/SeasonWheel"));
const DroughtReplay = lazy(() => import("./views/DroughtReplay"));
const ClimateTwins = lazy(() => import("./views/ClimateTwins"));
const AlertsSettings = lazy(() => import("./views/AlertsSettings"));
const SourcesMethods = lazy(() => import("./views/SourcesMethods"));
const RegionCompare = lazy(() => import("./views/RegionCompare"));
const ActionPlan = lazy(() => import("./views/ActionPlan"));
const RotationBuilder = lazy(() => import("./views/RotationBuilder"));
const SavedPlans = lazy(() => import("./views/SavedPlans"));
const Validation = lazy(() => import("./views/Validation"));
const Welcome = lazy(() => import("./views/Welcome"));
const MyFields = lazy(() => import("./views/MyFields"));
const MoneyCalc = lazy(() => import("./views/MoneyCalc"));
const FarmDashboard = lazy(() => import("./views/FarmDashboard"));

export default function App() {
  const { t, i18n } = useTranslation();
  const view = useApp((s) => s.view);
  const lang = useApp((s) => s.lang);
  const reduced = useApp((s) => s.reducedMotion);
  const field = useApp((s) => s.field);
  const set = useApp((s) => s.set);
  const planView = usePlan((s) => s.planView);
  const mobile = useMediaQuery("(max-width: 767px)");
  // 1280 px and wider: views and steps live in a left rail instead of the tab row and step bar.
  const wide = useMediaQuery("(min-width: 1280px)");
  const mid = useMediaQuery("(min-width: 900px)");
  // Simple mode is the guided path: one step per page with Back / Next, and the left control panel from 900 px.
  const guided = useApp((s) => s.mode) === "simple";

  // Restore "#/view/fieldId" on first load.
  useEffect(() => {
    // Plan views ("#/plan/<id>", "#/builder/<id>", "#/saved", "#/validation") are routed by planStore.
    const ph = readPlanHash();
    if (ph) {
      const st = useApp.getState();
      if (ph.fieldId) {
        const saved = st.savedFields.find((f) => f.id === ph.fieldId);
        st.selectField(saved ?? { id: ph.fieldId, name: t("field.unnamed") });
      }
      if (ph.fieldId || !PLAN_NEEDS_FIELD.includes(ph.view)) usePlan.getState().open(ph.view);
      return;
    }
    const h = readHash();
    // Guided (Simple) mode opens on the welcome page; Step 1 in the left panel leads to the globe.
    if (!h || (h.view === "home" && !h.fieldId)) {
      if (useApp.getState().mode === "simple") usePlan.getState().open("welcome");
      return;
    }
    const st = useApp.getState();
    if (h.fieldId) {
      const saved = st.savedFields.find((f) => f.id === h.fieldId);
      st.selectField(saved ?? { id: h.fieldId, name: t("field.unnamed") });
    }
    st.setView(h.view === "home" || h.fieldId || ["alerts", "sources", "region"].includes(h.view) ? h.view : "home");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Follow back/forward and typed hash changes.
  useEffect(() => {
    const onHash = () => {
      const ph = readPlanHash();
      if (ph) {
        const st = useApp.getState();
        if (ph.fieldId && st.field?.id !== ph.fieldId) {
          const saved = st.savedFields.find((f) => f.id === ph.fieldId);
          st.selectField(saved ?? { id: ph.fieldId, name: t("field.unnamed") });
        }
        if (usePlan.getState().planView !== ph.view) usePlan.getState().open(ph.view);
        return;
      }
      usePlan.getState().close();
      const h = readHash();
      const st = useApp.getState();
      if (!h || h.view === st.view) return;
      if (h.fieldId && st.field?.id !== h.fieldId) {
        const saved = st.savedFields.find((f) => f.id === h.fieldId);
        st.selectField(saved ?? { id: h.fieldId, name: t("field.unnamed") });
      }
      st.setView(h.view);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [t]);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [view, planView]);

  useEffect(() => {
    document.documentElement.lang = lang;
    if (i18n.language !== lang) void i18n.changeLanguage(lang);
  }, [lang, i18n]);

  useEffect(() => {
    if (reduced) document.documentElement.dataset.motion = "reduce";
    else delete document.documentElement.dataset.motion;
  }, [reduced]);

  useEffect(() => {
    document.title = field && (view !== "home" || planView) ? `${field.name} · FarmSmart` : "FarmSmart · Smarter choices. Better seasons.";
  }, [field, view, planView]);

  // The step bar sits under the sub-nav in Field Studio and the path views (not on the globe home).
  const inField = view !== "home" || !!planView;
  // Guided mode shows the step panel on every page from 900 px, the globe home included (step 1).
  const rail = guided ? mid && (inField || view === "home") : wide && inField;
  const hasSteps = !rail && inField && stepOf(view, planView) !== null;

  const body = (() => {
    switch (planView) {
      case "plan":
        return guided ? (
          <GuidedPage step={5}>
            <ActionPlan />
          </GuidedPage>
        ) : (
          <ActionPlan />
        );
      case "builder":
        return <RotationBuilder />;
      case "saved":
        return <SavedPlans />;
      case "validation":
        return <Validation />;
      case "welcome":
        return <Welcome />;
      case "fields":
        return <MyFields />;
      case "farm":
        return <FarmDashboard />;
      case "money":
        // Guided mode: part of step 3, with the same step heading as the other pages.
        return guided ? (
          <GuidedPage
            step={3}
            title={t("guided.money_title")}
            intro={t("guided.money_intro")}
            backTo={{ label: t("steps.compare"), onClick: () => useApp.getState().setView("compare") }}
          >
            <MoneyCalc />
          </GuidedPage>
        ) : (
          <MoneyCalc />
        );
    }
    switch (view) {
      case "home":
        return <GlobeHome />;
      case "studio":
        return guided ? <GuidedField /> : <FieldStudio />;
      case "compare":
        return guided ? <GuidedCompare /> : <StrategyCompare />;
      case "nextmove":
        return <NextMove />;
      case "wheel":
        return <SeasonWheel />;
      case "replay":
        return guided ? (
          <GuidedPage step={4}>
            <DroughtReplay />
            <GuidedTwinsLink />
          </GuidedPage>
        ) : (
          <DroughtReplay />
        );
      case "twins":
        return <ClimateTwins />;
      case "region":
        return <RegionCompare />;
      case "alerts":
        return <AlertsSettings />;
      case "sources":
        return <SourcesMethods />;
    }
  })();

  return (
    <div className={`app app--${planView ? `plan app--plan-${planView}` : view}${mobile ? " app--mobile" : ""}${hasSteps ? " app--steps" : ""}${rail ? " app--rail" : ""}${guided ? " app--guided" : ""}`}>
      <a href="#main" className="skip-link">
        {t("common.skip")}
      </a>
      {rail ? (
        // Panel on the left from the very top (it carries the brand); top bar, page and footer to its right.
        <div className="app-body">
          <SideRail />
          <div className="app-body__content">
            <TopBar onDemo={() => set({ tourOpen: true })} />
            <main id="main" className="main" tabIndex={-1}>
              <Suspense fallback={<div className="page" aria-busy="true" />}>{body}</Suspense>
            </main>
            <Footer />
          </div>
        </div>
      ) : (
        <>
          <TopBar onDemo={() => set({ tourOpen: true })} />
          {inField && !mobile && !guided ? <SubNav /> : null}
          {hasSteps ? <StepBar /> : null}
          <main id="main" className="main" tabIndex={-1}>
            <Suspense fallback={<div className="page" aria-busy="true" />}>{body}</Suspense>
          </main>
          {view === "studio" && !planView && mobile && !guided ? null : <Footer />}
        </>
      )}
      <PendingBar />
      <Toast />
      <DemoTour />
    </div>
  );
}
