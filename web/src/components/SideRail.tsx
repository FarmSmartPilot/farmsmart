/* Left navigation rail (1280 px and wider): the views grouped under the five planning steps, so the path and the
   navigation are one thing. Replaces the tab row and the step bar at these widths; narrower screens keep them. */
import { useTranslation } from "react-i18next";
import { IconBell, IconClose, IconGlobe, IconMap, IconSprout, IconRain, IconCheck, IconExternal } from "../design";
import { BrandName, LogoMark } from "./Logo";
import { useApp } from "../store";
import { usePlan } from "../planStore";
import { cx, scenarioLabel } from "../lib";
import { VIEWS } from "./TopBar";
import type { NavId } from "./TopBar";
import { stepOf } from "./StepBar";
import { FarmSwitch } from "./AddToFarm";
import { useFarm } from "../farmStore";
import "../rail.css";

const GROUPS: { n: 1 | 2 | 3 | 4 | 5; key: string; items: NavId[] }[] = [
  { n: 1, key: "steps.find", items: ["home"] },
  { n: 2, key: "steps.check", items: ["studio"] },
  { n: 3, key: "steps.compare", items: ["compare", "wheel", "builder", "money", "nextmove"] },
  { n: 4, key: "steps.weather", items: ["replay", "twins"] },
  { n: 5, key: "steps.plan", items: ["plan", "saved", "alerts"] },
];
const TOOLS: NavId[] = ["region", "validation", "sources"];
/** Guided (Simple) mode: one page per step; everything else sits under More tools. */
const STEP_PAGE: Record<1 | 2 | 3 | 4 | 5, NavId> = { 1: "home", 2: "studio", 3: "compare", 4: "replay", 5: "plan" };
const GUIDED_TOOLS: NavId[] = ["wheel", "builder", "twins", "saved", "alerts", "region", "validation", "sources"];
const STEP_HINT: Record<1 | 2 | 3 | 4 | 5, string> = { 1: "rail.h1", 2: "rail.h2", 3: "rail.h3", 4: "rail.h4", 5: "rail.h5" };

export default function SideRail() {
  const { t, i18n } = useTranslation();
  const storeView = useApp((s) => s.view);
  const planView = usePlan((s) => s.planView);
  const farmFields = useFarm((s) => s.fields);
  const field = useApp((s) => s.field);
  const scenario = useApp((s) => s.scenario);
  const mode = useApp((s) => s.mode);
  const set = useApp((s) => s.set);
  const setView = useApp((s) => s.setView);
  const openPlan = usePlan((s) => s.open);
  const active: NavId = planView ?? storeView;
  // The money calculator belongs to step 3 (Compare options).
  const cur = planView === "money" ? 3 : stepOf(storeView, planView);

  const meta = (id: NavId) => VIEWS.find((v) => v.id === id);
  const visible = (id: NavId) => id === "home" || (!!meta(id) && (!meta(id)!.expert || mode === "expert"));
  const go = (id: NavId) => {
    const m = meta(id);
    if (m?.plan) openPlan(id as Parameters<typeof openPlan>[0]);
    else setView(id as Parameters<typeof setView>[0]);
  };
  const item = (id: NavId) => {
    if (!visible(id)) return null;
    const needsField = id !== "home" && id !== "sources" && id !== "validation" && id !== "saved";
    const disabled = needsField && !field;
    return (
      <li key={id}>
        <button
          type="button"
          className={cx("rail__item", active === id && "is-active")}
          aria-current={active === id ? "page" : undefined}
          data-tour={meta(id)?.tour}
          disabled={disabled}
          title={disabled ? t("steps.need_field") : undefined}
          onClick={() => go(id)}
        >
          {id === "alerts" ? <IconBell size={14} /> : null}
          {id === "home" ? t("rail.globe") : t(meta(id)!.key)}
        </button>
      </li>
    );
  };

  if (mode === "simple") {
    const ICON = { 1: IconGlobe, 2: IconMap, 3: IconSprout, 4: IconRain, 5: IconClipboard } as const;
    const farmN = farmFields.length;
    const coords = field && typeof field.lat === "number" && typeof field.lon === "number" ? `${field.lat.toFixed(4)}, ${field.lon.toFixed(4)}` : null;
    return (
      <aside className="rail rail--guided" aria-label={t("rail.label")}>
        <RailBrand />
        <FarmSwitch className="rail__farmswitch" />
        <div className="rail__farm">
          <span className="rail__farm-icon" aria-hidden="true">
            <IconMap size={18} />
          </span>
          {planView === "farm" ? (
            <span className="rail__farm-text">
              <strong>{t("farm.title")}</strong>
              <small>{t("farm.rail_n_fields", { count: farmN })}</small>
            </span>
          ) : (
            <span className="rail__farm-text">
              <strong title={field?.name}>{field?.name ?? t("nav.no_field")}</strong>
              <small>{coords ?? t("rail.no_field_hint")}</small>
            </span>
          )}
        </div>
        <RailMyFields />
        <nav aria-label={t("nav.label")} className="rail__nav">
          <button
            type="button"
            className={cx("rail__jbtn rail__welcome", planView === "welcome" && "is-active")}
            aria-current={planView === "welcome" ? "page" : undefined}
            onClick={() => openPlan("welcome")}
          >
            <span className="rail__jicon" aria-hidden="true">
              <IconHome size={18} />
            </span>
            <span className="rail__jlabel">{t("rail.intro")}</span>
          </button>
          <p className="rail__head">{t("rail.path")}</p>
          <ol className="rail__jsteps">
            {GROUPS.map((g) => {
              const id = STEP_PAGE[g.n];
              const disabled = g.n > 1 && !field;
              const here = g.n === cur && planView !== "money";
              const done = cur !== null && g.n < cur;
              const Icon = ICON[g.n];
              return (
                <li key={g.n} className={cx("rail__jstep", g.n === cur && "is-current", done && "is-done")}>
                  <button
                    type="button"
                    className={cx("rail__jbtn", here && "is-active")}
                    aria-current={g.n === cur ? "step" : undefined}
                    disabled={disabled}
                    title={disabled ? t("steps.need_field") : t(STEP_HINT[g.n])}
                    onClick={() => {
                      if (g.n === 3) set({ compareRequested: true });
                      go(id);
                    }}
                  >
                    <span className="rail__jicon" aria-hidden="true">
                      {done ? <IconCheck size={18} /> : <Icon size={18} />}
                    </span>
                    <span className="rail__jlabel">{t(g.key)}</span>
                    <span className="rail__jnum" aria-hidden="true">
                      {String(g.n).padStart(2, "0")}
                    </span>
                    {g.n === cur ? <span className="fs-visually-hidden"> ({t("steps.n_of", { n: g.n, m: 5 })})</span> : null}
                  </button>
                  {g.n === 3 ? (
                    // Sub-item of step 3: the money calculator (revenue, costs and risk of these options).
                    <button
                      type="button"
                      className={cx("rail__jbtn rail__jsub", planView === "money" && "is-active")}
                      aria-current={planView === "money" ? "page" : undefined}
                      disabled={!field}
                      title={!field ? t("steps.need_field") : undefined}
                      onClick={() => openPlan("money")}
                      data-tour="rail-money"
                    >
                      <span className="rail__jicon rail__jdollar" aria-hidden="true">
                        $
                      </span>
                      <span className="rail__jlabel">{t("money.go")}</span>
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ol>
          <details className="rail__more" open={cur === null && planView !== "welcome"}>
            <summary className="rail__head rail__summary">{t("guided.more")}</summary>
            <ul className="rail__items rail__items--tools">{GUIDED_TOOLS.map(item)}</ul>
          </details>
        </nav>
        <RailFoot />
      </aside>
    );
  }

  return (
    <aside className="rail" aria-label={t("rail.label")}>
      <RailBrand />
      <div className="rail__field">
        <span className="fs-overline">{t("nav.field")}</span>
        <strong title={field?.name}>{field?.name ?? t("nav.no_field")}</strong>
        {scenario !== "normal" ? (
          <span className="fs-chip fs-chip--wheat rail__scen">
            {t("scenario.active", { s: scenarioLabel(scenario, t, i18n.language) })}
            <button type="button" className="chip-x" aria-label={t("scenario.reset")} onClick={() => set({ scenario: "normal" })}>
              <IconClose size={12} />
            </button>
          </span>
        ) : null}
      </div>
      <nav aria-label={t("nav.label")} className="rail__nav">
        <p className="rail__head">{t("rail.path")}</p>
        <ol className="rail__steps">
          {GROUPS.map((g) => (
            <li key={g.n} className={cx("rail__step", g.n === cur && "is-current", cur !== null && g.n < cur && "is-done")}>
              <span className="rail__steplabel">
                <span className="rail__num" aria-hidden="true">
                  {g.n}
                </span>
                {t(g.key)}
                {g.n === cur ? <span className="fs-visually-hidden"> ({t("steps.n_of", { n: cur, m: 5 })})</span> : null}
              </span>
              <ul className="rail__items">{g.items.map(item)}</ul>
            </li>
          ))}
        </ol>
        <p className="rail__head">{t("rail.tools")}</p>
        <ul className="rail__items rail__items--tools">{TOOLS.map(item)}</ul>
      </nav>
      <RailFoot />
    </aside>
  );
}

/** The brand at the head of the panel (the top bar hides its own when the panel is shown). */
function RailBrand() {
  const { t } = useTranslation();
  const setView = useApp((s) => s.setView);
  const simple = useApp((s) => s.mode) === "simple";
  return (
    <button
      type="button"
      className="rail__brand"
      onClick={() => (simple ? usePlan.getState().open("welcome") : setView("home"))}
      title={t("top.home")}
    >
      <LogoMark size={46} />
      <span className="rail__brand-text">
        <BrandName className="rail__brand-name" />
        <span className="rail__brand-tag">{t("rail.tag")}</span>
      </span>
    </button>
  );
}

/** Foot of the panel: what the tool is for, and the guided tour. */
function RailFoot({ hint }: { hint?: string }) {
  const { t } = useTranslation();
  const set = useApp((s) => s.set);
  return (
    <div className="rail__foot">
      {hint ? <p className="rail__hint">{hint}</p> : null}
      <button type="button" className="rail__how" onClick={() => set({ tourOpen: true })}>
        {t("rail.how")} <IconExternal size={14} />
      </button>
      <p className="rail__built">{t("rail.built")}</p>
    </div>
  );
}

/** Clipboard (the plan step); same stroke style as the design icons. */
function IconClipboard({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="5" y="4" width="14" height="17" rx="2" />
      <path d="M9 4.5V3.5h6v1M9 11l2 2 4-4M9 17h6" />
    </svg>
  );
}

/** House (the welcome page); same stroke style as the design icons. */
function IconHome({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 11l9-7 9 7" />
      <path d="M5 10v10h14V10M10 20v-6h4v6" />
    </svg>
  );
}

/** Signed in (demo): the farmer's fields, for quick switching, and the way to manage them. */
function RailMyFields() {
  const { t } = useTranslation();
  const user = useApp((s) => s.user);
  const saved = useApp((s) => s.savedFields);
  const current = useApp((s) => s.field?.id);
  const selectField = useApp((s) => s.selectField);
  const planView = usePlan((s) => s.planView);
  if (!user) return null;
  return (
    <section className="rail__myfields" aria-labelledby="rail-mf-h">
      <p className="rail__head" id="rail-mf-h">
        {t("myfields.rail_h")}
      </p>
      <ul className="rail__items">
        {saved.slice(0, 4).map((f) => (
          <li key={f.id}>
            <button
              type="button"
              className={cx("rail__mf", f.id === current && "is-active")}
              aria-current={f.id === current ? "true" : undefined}
              title={f.name}
              onClick={() => {
                selectField(f);
                useApp.getState().setView("studio");
              }}
            >
              <span className="rail__mf-dot" aria-hidden="true" />
              {f.name}
            </button>
          </li>
        ))}
      </ul>
      <button type="button" className={cx("rail__mf rail__mf--all", planView === "fields" && "is-active")} onClick={() => usePlan.getState().open("fields")}>
        {saved.length ? t("myfields.manage_n", { n: saved.length }) : t("myfields.add")}
      </button>
    </section>
  );
}
