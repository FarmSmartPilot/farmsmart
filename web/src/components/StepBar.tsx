/* Step bar: "Step n of 5" through the farmer's path. 1 Find your farm · 2 Check your field · 3 Compare options ·
   4 Test the weather · 5 Make a plan. Clicking a step goes there. Compact on phones (current step + next). */
import { useTranslation } from "react-i18next";
import { IconChevronRight, useMediaQuery } from "../design";
import { useApp } from "../store";
import type { View } from "../store";
import { usePlan } from "../planStore";
import type { PlanView } from "../planStore";
import { cx } from "../lib";
import "../plan.css";

type StepId = 1 | 2 | 3 | 4 | 5;
const STEPS: { n: StepId; key: string }[] = [
  { n: 1, key: "steps.find" },
  { n: 2, key: "steps.check" },
  { n: 3, key: "steps.compare" },
  { n: 4, key: "steps.weather" },
  { n: 5, key: "steps.plan" },
];

const VIEW_STEP: Partial<Record<View | PlanView, StepId>> = {
  home: 1,
  studio: 2,
  compare: 3,
  nextmove: 3,
  wheel: 3,
  builder: 3,
  money: 3,
  replay: 4,
  twins: 4,
  plan: 5,
  saved: 5,
};

/** The step a view belongs to, or null when the view is outside the path (alerts, sources, region, validation). */
export function stepOf(view: View, planView: PlanView | null): StepId | null {
  return VIEW_STEP[planView ?? view] ?? null;
}

export function goToStep(n: StepId, phone: boolean) {
  const st = useApp.getState();
  if (n === 1) return st.setView("home");
  if (n === 2) {
    st.setView("studio");
    if (phone) st.set({ mobileTab: "field" });
    return;
  }
  if (n === 3) return st.setView("compare");
  if (n === 4) return st.setView("replay");
  usePlan.getState().open("plan");
}

export default function StepBar() {
  const { t } = useTranslation();
  const view = useApp((s) => s.view);
  const hasField = useApp((s) => !!s.field);
  const planView = usePlan((s) => s.planView);
  const phone = useMediaQuery("(max-width: 767px)");
  const cur = stepOf(view, planView);
  if (!cur) return null;
  const label = (n: StepId) => t(STEPS[n - 1].key);

  if (phone) {
    const next = cur < 5 ? ((cur + 1) as StepId) : null;
    return (
      <nav className="stepbar stepbar--compact" aria-label={t("steps.label")}>
        <span className="stepbar__now">
          <span className="stepbar__count">{t("steps.n_of", { n: cur, m: 5 })}</span>
          <strong>{label(cur)}</strong>
        </span>
        {next && (hasField || next === 1) ? (
          <button type="button" className="stepbar__next" onClick={() => goToStep(next, phone)}>
            <span className="fs-visually-hidden">{t("steps.next")}: </span>
            {label(next)}
            <IconChevronRight size={16} />
          </button>
        ) : null}
      </nav>
    );
  }

  return (
    <nav className="stepbar" aria-label={t("steps.label")}>
      <span className="stepbar__count" aria-hidden="true">
        {t("steps.n_of", { n: cur, m: 5 })}
      </span>
      <ol className="stepbar__list">
        {STEPS.map((s) => {
          const disabled = !hasField && s.n > 1;
          return (
            <li key={s.n} className={cx("stepbar__item", s.n === cur && "is-current", s.n < cur && "is-done")}>
              <button
                type="button"
                className="stepbar__btn"
                aria-current={s.n === cur ? "step" : undefined}
                disabled={disabled}
                title={disabled ? t("steps.need_field") : undefined}
                onClick={() => goToStep(s.n, phone)}
              >
                <span className="stepbar__num" aria-hidden="true">
                  {s.n}
                </span>
                <span className="stepbar__label">{t(s.key)}</span>
                {s.n === cur ? <span className="fs-visually-hidden"> ({t("steps.n_of", { n: cur, m: 5 })})</span> : null}
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
