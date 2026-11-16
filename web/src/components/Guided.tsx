/* Guided mode (Simple): one step per page, a plain heading saying what the step is for, and Back / Next at the
   bottom. Step 1 is the globe; 2 Check your field; 3 Compare options; 4 Test the weather; 5 Make a plan.
   Expert mode keeps the all-in-one Field Studio. */
import type { ReactNode } from "react";
import { useId } from "react";
import { useTranslation } from "react-i18next";
import { Button, IconChevronRight, useMediaQuery } from "../design";
import { useApp } from "../store";
import { usePlan } from "../planStore";
import { goToStep } from "./StepBar";
import { MapPanel } from "../views/FieldStudio";
import MyField, { Priorities } from "../views/MyField";
import RotationOptions from "../views/Options";
import SeasonTimeline from "../views/SeasonTimeline";
import ChangesStrip from "./ChangesStrip";
import { NeedField } from "./common";
import { SearchBox } from "./TopBar";
import Outlook from "./Outlook";
import OfflineBar from "./OfflineBar";
import "../guided.css";

type Step = 1 | 2 | 3 | 4 | 5;
const KEYS: Record<Step, string> = { 1: "steps.find", 2: "steps.check", 3: "steps.compare", 4: "steps.weather", 5: "steps.plan" };

export const useGuided = () => useApp((s) => s.mode) === "simple";

export function GuidedPage({
  step,
  children,
  title,
  intro,
  backTo,
}: {
  step: Step;
  children: ReactNode;
  title?: string;
  intro?: string;
  /** Override the footer's Back (e.g. the money page goes back to its own step's options). */
  backTo?: { label: string; onClick: () => void };
}) {
  const { t } = useTranslation();
  const phone = useMediaQuery("(max-width: 767px)");
  const prev = step > 1 ? ((step - 1) as Step) : null;
  const next = step < 5 ? ((step + 1) as Step) : null;
  const go = (n: Step) => {
    if (n === 3) useApp.getState().set({ compareRequested: true });
    goToStep(n, phone);
    window.scrollTo({ top: 0 });
    document.querySelector(".app-body__content, .main")?.scrollTo?.({ top: 0 });
  };
  return (
    <div className={`guided guided--s${step}`} data-guided-step={step}>
      <OfflineBar />
      <header className="guided__head">
        <p className="guided__count">{t("steps.n_of", { n: step, m: 5 })}</p>
        <h1 className="guided__title">{title ?? t(`guided.s${step}_title`)}</h1>
        <p className="guided__intro">{intro ?? t(`guided.s${step}_intro`)}</p>
      </header>
      <div className="guided__body">
        {children}
      </div>
      <nav className="guided__foot" aria-label={t("guided.nav")}>
        {backTo ? (
          <Button variant="secondary" size="lg" onClick={backTo.onClick}>
            ← {t("guided.back")}: {backTo.label}
          </Button>
        ) : prev ? (
          <Button variant="secondary" size="lg" onClick={() => go(prev)}>
            ← {t("guided.back")}: {t(KEYS[prev])}
          </Button>
        ) : (
          <span />
        )}
        {next ? (
          <Button size="lg" iconAfter={<IconChevronRight size={18} />} onClick={() => go(next)} data-tour={`guided-next-${next}`}>
            {t("guided.next")}: {t(KEYS[next])}
          </Button>
        ) : (
          <span className="guided__done">{t("guided.done")}</span>
        )}
      </nav>
    </div>
  );
}

/** Step 2: the field's facts and map, with the place search right under the map. Nothing to rank yet. */
export function GuidedField() {
  const { t } = useTranslation();
  const field = useApp((s) => s.field);
  const searchId = useId();
  if (!field) return <NeedField />;
  return (
    <GuidedPage step={2}>
      <ChangesStrip />
      <div className="guided-field">
        <div className="guided-field__map">
          <MapPanel />
          {/* The top-bar search is hidden on guided field pages: it lives here, where a wrong place is noticed. */}
          <div className="guided-search" role="group" aria-labelledby={searchId}>
            <p id={searchId} className="guided-search__label">
              {t("records.search_label")}
            </p>
            <SearchBox />
          </div>
        </div>
        <div className="guided-field__facts">
          <MyField guided />
        </div>
      </div>
    </GuidedPage>
  );
}

/** Step 3: what matters to you, then the options ranked by it, then when the soil is bare. */
export function GuidedCompare() {
  const { t } = useTranslation();
  const field = useApp((s) => s.field);
  if (!field) return <NeedField />;
  return (
    <GuidedPage step={3}>
      <div className="guided-compare">
        <section className="panel guided-prio" aria-labelledby="gprio-h">
          <h2 id="gprio-h" className="guided__h2">
            {t("guided.prio_h")}
          </h2>
          <Priorities />
        </section>
        <div className="guided-compare__options">
          <RotationOptions />
          <GuidedMoneyLink />
        </div>
      </div>
      <section className="guided-timeline" aria-labelledby="gtl-h">
        <h2 id="gtl-h" className="guided__h2">
          {t("guided.timeline_h")}
        </h2>
        <SeasonTimeline />
      </section>
    </GuidedPage>
  );
}

/** Steps 3 and 5: "Work out the money →" opens the money calculator (revenue, costs and risk) for these options. */
export function GuidedMoneyLink() {
  const { t } = useTranslation();
  const open = usePlan((s) => s.open);
  return (
    <section className="panel guided-twins guided-money" aria-labelledby="gmoney-h" style={{ height: "auto", marginTop: "var(--s4)" }}>
      <div>
        <h2 id="gmoney-h" className="guided__h2">
          {t("money.go_h")}
        </h2>
        <p className="guided__intro">{t("money.go_help")}</p>
      </div>
      <Button size="lg" iconAfter={<IconChevronRight size={18} />} onClick={() => open("money")} data-tour="money-go">
        {t("money.go")}
      </Button>
    </section>
  );
}

/** Step 4 extras: NOAA's season outlook for the coming months, then the way to Climate Twins (the 2040s). */
export function GuidedTwinsLink() {
  const { t } = useTranslation();
  const setView = useApp((s) => s.setView);
  const fid = useApp((s) => s.field?.id ?? null);
  return (
    <>
    <Outlook fid={fid} />
    <section className="panel guided-twins" aria-labelledby="gtw-h">
      <div>
        <h2 id="gtw-h" className="guided__h2">
          {t("guided.twins_h")}
        </h2>
        <p className="guided__intro">{t("guided.twins_b")}</p>
      </div>
      <Button variant="secondary" iconAfter={<IconChevronRight size={16} />} onClick={() => setView("twins")}>
        {t("guided.twins_btn")}
      </Button>
    </section>
    </>
  );
}
