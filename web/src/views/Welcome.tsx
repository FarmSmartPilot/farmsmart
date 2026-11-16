/* Welcome: the front page in guided (Simple) mode. What FarmSmart is, why a farmer would use it, a real example,
   the open data behind it and how well it has been checked, then "Step 1: Find your farm". Every number on this page
   is fetched from the API (pilot comparison, validation reports): nothing is typed in.
   Wave U9: the page leads with the farmer's four questions (earn, bad year, what to plant, pests and disease), each
   answered live for the Story County example field, then the whole-farm view. */
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { ReactNode } from "react";
import { Button, DataButton, IconPlay, IconChevronRight, IconSprout, IconRain, IconDrought, IconGlobe, IconCheck, IconAlert, IconLayers } from "../design";
import { api } from "../api";
import type { CardData, CompareResult } from "../api";
import type { Evidence } from "../design";
import { useValidationAllQ } from "../apiPlan";
import { useApp } from "../store";
import { usePlan, PLAN_VIEWS } from "../planStore";
import { apiMoney } from "../apiMoney";
import { cropsInPlay } from "../money";
import type { PlanView } from "../planStore";
import { openDemoMenu } from "../components/DemoMenu";
import { cardTitle } from "./Options";
import { quant, nice, plainCompare } from "../lib";
import "../welcome.css";

/** The Story County, Iowa pilot field: the real example on this page. */
const EXAMPLE_FIELD = "b96d39c7a833";

function goStep1() {
  useApp.getState().setView("home");
  window.scrollTo({ top: 0 });
}

/** The live comparison for the example field (shared by the questions and the example table). */
function useExample() {
  const { i18n } = useTranslation();
  const q = useQuery({ queryKey: ["welcome-example"], queryFn: () => api.compare(EXAMPLE_FIELD, {}), staleTime: Infinity, retry: 1 });
  return q.data ? plainCompare(q.data as CompareResult, i18n.language) : undefined;
}

/** The whole-farm view (#/farm) comes with the whole-farm work; its button shows only once that view exists. */
const FARM_VIEW = (PLAN_VIEWS as string[]).includes("farm") ? ("farm" as PlanView) : null;

const fin = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Survey sources for the one line on farmers' top worries (docs/research/FARMER_PRIORITIES.md). They support "input
    costs and profit, then weather and price risk"; they do not rank the four questions, so the page claims no ranking. */
const WORRY_SOURCES: Evidence[] = [
  {
    source: "Purdue University / CME Group",
    product: "Ag Economy Barometer, September 2026 report (400 US farmers)",
    observation_start: "2026-09-14",
    observation_end: "2026-09-18",
    url: "https://ag.purdue.edu/commercialag/ageconomybarometer/wp-content/uploads/2026/10/AEB-Report-September-2026.pdf",
    is_nasa: false,
  },
  {
    source: "McKinsey & Company",
    product: "Global Farmer Insights 2024 (about 4,400 farmers in 9 countries)",
    url: "https://www.mckinsey.com/industries/agriculture/our-insights/global-farmer-insights-2024",
    is_nasa: false,
  },
];

/** The four questions a farmer asks, each with a live answer for the Story County example field: money and the bad
    year side by side first, then the comparison that answers them, then pests and disease as a rotation benefit. */
function Questions() {
  const { t, i18n } = useTranslation();
  const d = useExample();
  const loc = i18n.language === "es" ? "es" : "en-US";
  const usd = (v: number) => `$${Math.round(Math.abs(v)).toLocaleString(loc)}`;
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  const base = d?.cards?.find((c) => c.is_baseline);
  const best = d?.cards?.find((c) => c.best_for_you && !c.is_baseline) ?? d?.cards?.find((c) => !c.is_baseline);
  const name = best ? cardTitle(best, t) : "";
  const typ = best ? quant(best, "profit_p50")?.p50 : undefined;
  // Bad year = 10th percentile of the rotation-average net over the simulated weather years.
  const bad = best ? quant(best, "profit_p50")?.p10 : undefined;
  const pbA = base ? quant(base, "pest_break")?.p50 : undefined;
  const pbB = best ? quant(best, "pest_break")?.p50 : undefined;
  const dd = d as unknown as { candidates_simulated?: number; all_cards?: unknown[] } | undefined;
  const nTested = dd?.candidates_simulated ?? dd?.all_cards?.length ?? d?.cards?.length;
  // Input costs next to the return: the operating costs (USDA ERS) the money page uses for the same option's crops.
  const mq = useQuery({ queryKey: ["welcome-example-money"], queryFn: () => apiMoney.money(EXAMPLE_FIELD, {}), staleTime: Infinity, retry: 1 });
  const es = i18n.language === "es";
  const mOpt = best ? mq.data?.options?.find((o) => o.id === best.id) : undefined;
  const costParts = mOpt
    ? cropsInPlay([mOpt])
        .map((cid) => {
          const c = mq.data?.crops?.[cid];
          const v = c?.operating_total_used_in_comparison;
          return c && fin(v) ? `${((es && c.name_es) || c.name).split(" (")[0].toLowerCase()} ${usd(v)}` : null;
        })
        .filter((x): x is string => !!x)
    : [];
  const coverCost = mq.data?.cover?.cost_usd_ac;
  if (costParts.length && mOpt?.positions.some((x) => !!x.cover) && fin(coverCost)) costParts.push(t("welcome9.q1_cover", { v: usd(coverCost) }));
  const costLine = costParts.length ? t("welcome9.q1_cost", { list: costParts.join(", "), region: mq.data?.region ?? "" }) : null;
  const qs: { id: string; icon: ReactNode; h: string; p: string; ex: string | null; ex2?: string | null }[] = [
    { id: "earn", icon: <span className="wel-dollar">$</span>, h: t("welcome9.q1"), p: t("welcome9.q1_p"), ex: best && fin(typ) ? t("welcome9.q1_ex", { name, v: usd(typ) }) : null, ex2: costLine },
    {
      id: "bad",
      icon: <IconDrought size={22} />,
      h: t("welcome9.q2"),
      p: t("welcome9.q2_p"),
      ex: best && fin(bad) ? t(bad < 0 ? "welcome9.q2_ex_neg" : "welcome9.q2_ex", { name, v: usd(bad) }) : null,
    },
    { id: "plant", icon: <IconSprout size={22} />, h: t("welcome9.q3"), p: t("welcome9.q3_p"), ex: best && fin(nTested) ? t("welcome9.q3_ex", { n: nTested, name }) : null },
    {
      id: "pests",
      icon: <IconAlert size={22} />,
      h: t("welcome9.q4"),
      p: t("welcome9.q4_p"),
      ex: best && fin(pbA) && fin(pbB) ? t("welcome9.q4_ex", { best: name, a: pct(pbA), b: pct(pbB) }) : null,
    },
  ];
  return (
    <section className="wel-questions" aria-labelledby="wel-q-h" data-testid="welcome-questions">
      <p className="wel-kicker">{t("welcome9.q_kicker")}</p>
      <h2 id="wel-q-h">{t("welcome9.q_h")}</h2>
      <p className="wel-data__p">{t("welcome9.q_p")}</p>
      <div className="wel-questions__grid">
        {qs.map((q) => (
          <article key={q.id} className="wel-question" data-q={q.id}>
            <span className="wel-benefit__icon" aria-hidden="true">
              {q.icon}
            </span>
            <h3>{q.h}</h3>
            <p>{q.p}</p>
            {q.ex ? (
              <p className="wel-question__ex">
                {q.ex}
                {q.ex2 ? <span className="wel-question__ex2">{q.ex2}</span> : null}
              </p>
            ) : null}
          </article>
        ))}
      </div>
      {d ? <p className="wel-note">{t("welcome9.q_ex_live")}</p> : null}
      <p className="wel-note wel-worries">
        {t("welcome9.worries")}{" "}
        {WORRY_SOURCES.map((e) => (
          <DataButton key={e.source} evidence={e} describes={t("welcome9.worries")} />
        ))}
      </p>
    </section>
  );
}

/** The whole-farm view: add fields one at a time, then see and plan them together. */
function WholeFarm() {
  const { t } = useTranslation();
  return (
    <section className="wel-farm" aria-labelledby="wel-farm-h" data-testid="welcome-farm">
      <span className="wel-farm__icon" aria-hidden="true">
        <IconLayers size={26} />
      </span>
      <div className="wel-farm__text">
        <p className="wel-kicker">{t("welcome9.farm_kicker")}</p>
        <h2 id="wel-farm-h">{t("welcome9.farm_h")}</h2>
        <p>{t("welcome9.farm_p")}</p>
      </div>
      {FARM_VIEW ? (
        <Button size="lg" variant="secondary" iconAfter={<IconChevronRight size={18} />} onClick={() => usePlan.getState().open(FARM_VIEW)} data-testid="welcome-farm-open">
          {t("welcome9.farm_open")}
        </Button>
      ) : (
        <Button size="lg" variant="secondary" iconAfter={<IconChevronRight size={18} />} onClick={goStep1}>
          {t("welcome9.farm_start")}
        </Button>
      )}
    </section>
  );
}

function RealExample() {
  const { t, i18n } = useTranslation();
  const d = useExample();
  if (!d?.cards?.length) return null;
  const base = d.cards.find((c) => c.is_baseline);
  const best = d.cards.find((c) => c.best_for_you && !c.is_baseline) ?? d.cards.find((c) => !c.is_baseline);
  if (!base || !best) return null;
  const row = (label: string, key: string, unit: string, better: "lower" | "higher") => {
    const a = quant(base, key)?.p50;
    const b = quant(best, key)?.p50;
    if (a == null || b == null) return null;
    const good = better === "lower" ? b < a : b > a;
    return (
      <tr>
        <th scope="row">{label}</th>
        <td>
          {nice(a, i18n.language)} {unit}
        </td>
        <td className={good ? "is-good" : undefined}>
          {nice(b, i18n.language)} {unit}
        </td>
      </tr>
    );
  };
  const bare = (c: CardData) => c.timeline?.bare_weeks;
  return (
    <section className="wel-example" aria-labelledby="wel-ex-h">
      <div className="wel-example__text">
        <p className="wel-kicker">{t("welcome.ex_kicker")}</p>
        <h2 id="wel-ex-h">{t("welcome.ex_h")}</h2>
        <p>{t("welcome.ex_p")}</p>
        <Button variant="secondary" onClick={openDemoMenu}>
          {t("welcome.ex_open")}
        </Button>
      </div>
      <div className="wel-example__card">
        <table className="wel-table">
          <caption className="fs-visually-hidden">{t("welcome.ex_caption")}</caption>
          <thead>
            <tr>
              <th scope="col" />
              <th scope="col">
                <span className="wel-tag">{t("welcome.ex_today")}</span>
                <span className="wel-rot">{cardTitle(base, t)}</span>
              </th>
              <th scope="col">
                <span className="wel-tag wel-tag--best">{t("welcome.ex_best")}</span>
                <span className="wel-rot">{cardTitle(best, t)}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {row(t("welcome.ex_soil"), "erosion_water", "t/ha", "lower")}
            {bare(base) != null && bare(best) != null ? (
              <tr>
                <th scope="row">{t("welcome.ex_bare")}</th>
                <td>{nice(bare(base), i18n.language)}</td>
                <td className={(bare(best) ?? 0) < (bare(base) ?? 0) ? "is-good" : undefined}>{nice(bare(best), i18n.language)}</td>
              </tr>
            ) : null}
            {row(t("welcome.ex_cover"), "soil_cover", t("welcome.days"), "higher")}
            {row(t("welcome.ex_profit"), "profit_p50", "$/ac", "higher")}
          </tbody>
        </table>
        <p className="wel-note">{t("welcome.ex_note")}</p>
      </div>
    </section>
  );
}

function Proof() {
  const { t } = useTranslation();
  const v = useValidationAllQ();
  const d = v.data;
  if (!d) return null;
  const cov = d.m2?.coverage_80 ? Object.values(d.m2.coverage_80) : [];
  const high = d.m10?.levels?.find((l) => l.level === "High");
  const rs = (d.weather?.pairs ?? []).filter((p) => p.variable === "tmax" || p.variable === "tmin").map((p) => p.r);
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  const tiles: { big: string; text: string }[] = [];
  if (rs.length) tiles.push({ big: `r ${Math.min(...rs).toFixed(2)}–${Math.max(...rs).toFixed(2)}`, text: t("welcome.proof_weather") });
  if (cov.length) tiles.push({ big: `${pct(Math.min(...cov))}–${pct(Math.max(...cov))}`, text: t("welcome.proof_yield") });
  if (high) tiles.push({ big: pct(high.coverage), text: t("welcome.proof_conf", { n: high.n.toLocaleString() }) });
  if (!tiles.length) return null;
  return (
    <section className="wel-proof" aria-labelledby="wel-proof-h">
      <p className="wel-kicker">{t("welcome.proof_kicker")}</p>
      <h2 id="wel-proof-h">{t("welcome.proof_h")}</h2>
      <div className="wel-proof__tiles">
        {tiles.map((x) => (
          <div key={x.big} className="wel-proof__tile">
            <strong>{x.big}</strong>
            <span>{x.text}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

const DATA: { group: string; items: string[] }[] = [
  { group: "NASA", items: ["POWER weather (1991–today)", "SMAP soil moisture", "GRACE-FO water storage", "HLS 30 m greenness", "ECOSTRESS water use", "MODIS", "NEX-GDDP-CMIP6 climate projections"] },
  { group: "USDA", items: ["Cropland Data Layer", "Crop Sequence Boundaries", "SSURGO soils", "NASS yields and prices", "ERS costs and returns", "RMA crop-insurance losses", "NRCS EQIP payments", "NAIP aerial photos"] },
  { group: "NOAA", items: ["Climate Prediction Center outlooks", "National Weather Service warnings"] },
  { group: "Other open data", items: ["FEMA disaster declarations", "World Bank commodity prices", "Fields of The World", "SoilGrids", "OpenStreetMap"] },
];

export default function Welcome() {
  const { t } = useTranslation();
  const set = useApp((s) => s.set);
  const benefits = [
    { icon: <IconSprout size={22} />, h: "welcome.b1_h", p: "welcome.b1_p" },
    { icon: <IconRain size={22} />, h: "welcome.b2_h", p: "welcome.b2_p" },
    { icon: <IconDrought size={22} />, h: "welcome.b4_h", p: "welcome.b4_p" },
  ];
  return (
    <div className="welcome">
      <section className="wel-hero" aria-labelledby="wel-h1">
        <img className="wel-hero__img" src="/welcome_naip_story_ia.jpg" alt="" />
        <div className="wel-hero__shade" />
        <div className="wel-hero__inner">
          <p className="wel-hero__kicker">{t("welcome.kicker")}</p>
          <h1 id="wel-h1" className="wel-hero__h1">
            <span>{t("welcome.h1a")}</span> <span>{t("welcome.h1b")}</span>
          </h1>
          <p className="wel-hero__lead">{t("welcome.lead")}</p>
          <div className="wel-hero__ctas">
            <Button size="lg" iconAfter={<IconChevronRight size={18} />} onClick={goStep1} data-tour="welcome-start">
              {t("welcome.start")}
            </Button>
            <Button size="lg" variant="secondary" icon={<IconPlay size={16} />} onClick={() => set({ tourOpen: true })}>
              {t("welcome.tour")}
            </Button>
          </div>
          <ul className="wel-hero__trust">
            <li>
              <IconCheck size={14} /> {t("welcome.trust1")}
            </li>
            <li>
              <IconCheck size={14} /> {t("welcome.trust2")}
            </li>
            <li>
              <IconCheck size={14} /> {t("welcome.trust3")}
            </li>
          </ul>
        </div>
        <p className="wel-hero__credit">{t("welcome.photo_credit")}</p>
      </section>

      <Questions />

      <WholeFarm />

      <RealExample />

      <section className="wel-benefits" aria-labelledby="wel-ben-h">
        <p className="wel-kicker">{t("welcome9.more_kicker")}</p>
        <h2 id="wel-ben-h">{t("welcome9.more_h")}</h2>
        <div className="wel-benefits__grid">
          {benefits.map((b) => (
            <article key={b.h} className="wel-benefit">
              <span className="wel-benefit__icon" aria-hidden="true">
                {b.icon}
              </span>
              <h3>{t(b.h)}</h3>
              <p>{t(b.p)}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="wel-data" aria-labelledby="wel-data-h">
        <p className="wel-kicker">{t("welcome.data_kicker")}</p>
        <h2 id="wel-data-h">{t("welcome.data_h")}</h2>
        <p className="wel-data__p">{t("welcome.data_p")}</p>
        <div className="wel-data__groups">
          {DATA.map((g) => (
            <div key={g.group} className="wel-data__group">
              <h3>
                {g.group === "NASA" ? <IconGlobe size={16} /> : null} {g.group}
              </h3>
              <ul>
                {g.items.map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      <Proof />

      <section className="wel-cta" aria-labelledby="wel-cta-h">
        <h2 id="wel-cta-h">{t("welcome.cta_h")}</h2>
        <p>{t("welcome.cta_p")}</p>
        <Button size="lg" iconAfter={<IconChevronRight size={18} />} onClick={goStep1}>
          {t("welcome.start")}
        </Button>
      </section>
    </div>
  );
}
