/* Scenario sliders: presets, rain −40…+40 % and temperature −2…+4 °C, and a "2040s" preset built from the
   Climate Twins (NEX-GDDP-CMIP6) response. Every scenario is hypothetical weather applied to the past weather years. */
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, SegmentedToggle, StatusBanner, IconLoader } from "../design";
import { useTwinsQ } from "../api";
import type { TwinsResult } from "../api";
import { useApp, customScenario, parseCustom, SCENARIO_PRESETS, STRESS_TESTS } from "../store";
import type { Scenario, ScenarioPreset } from "../store";
import { Ev } from "./common";
import { cx, isNum, scenarioLabel } from "../lib";
import { noCosts, useCompare } from "../views/Options";

const RAIN = { min: -40, max: 40, step: 5 };
const TEMP = { min: -2, max: 4, step: 0.5 };
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** SSP2-4.5 2040s shift from the twins response: median future − baseline mean temperature, and the median rain ratio. */
export function shift2040(tw: TwinsResult | undefined): { temp: number; rain: number; n: number; period: string } | null {
  const s = tw?.scenarios?.ssp245;
  const base = tw?.baseline?.indicators?.tmean_c;
  const fut = s?.indicators?.tmean_c?.median;
  const ratio = s?.deltas?.annual_pr_ratio?.median;
  if (!s?.available && s?.available !== undefined) return null;
  if (!isNum(base) || !isNum(fut) || !isNum(ratio)) return null;
  const f = tw?.periods?.future;
  return { temp: fut - base, rain: (ratio - 1) * 100, n: s?.n_models ?? 0, period: f ? `${f[0]}–${f[f.length - 1]}` : "" };
}

export default function ScenarioPanel({ compact }: { compact?: boolean }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const field = useApp((s) => s.field);
  const scenario = useApp((s) => s.scenario);
  const set = useApp((s) => s.set);
  const q = useCompare();
  const twins = useTwinsQ(field?.id ?? null);
  const cur = parseCustom(scenario);
  const [rain, setRain] = useState(cur?.rain ?? 0);
  const [temp, setTemp] = useState(cur?.temp ?? 0);
  const [is2040, setIs2040] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  // Keep the sliders in step when the scenario changes elsewhere (top-bar reset, presets).
  useEffect(() => {
    const c = parseCustom(scenario);
    setRain(c?.rain ?? 0);
    setTemp(c?.temp ?? 0);
    if (!c) setIs2040(false);
  }, [scenario]);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const commit = (r: number, tc: number, debounce = true) => {
    window.clearTimeout(timer.current);
    // A price change set by the "Lower prices" stress test stays while the weather sliders move (the label shows it).
    const price = parseCustom(useApp.getState().scenario)?.price ?? 0;
    const go = () => set({ scenario: customScenario(r, tc, price), compareRequested: true });
    if (debounce) timer.current = window.setTimeout(go, 600);
    else go();
  };

  const sh = shift2040(twins.data);
  const n = q.data?.weather_years?.n;
  const busy = q.isFetching && scenario !== "normal";
  const preset: ScenarioPreset | "custom" = cur ? "custom" : (scenario as ScenarioPreset);
  const fmtPct = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toLocaleString(lang)} %`;
  const fmtC = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toLocaleString(lang, { maximumFractionDigits: 1 })} °C`;

  return (
    <section className={cx("card-sec scen-panel", compact && "scen-panel--compact")} aria-labelledby="scen-h" data-tour="scenario">
      <div className="h-row">
        <h2 id="scen-h" className="fs-overline">
          {t("scen.title")}
        </h2>
        <span className="fs-chip fs-chip--wheat">{t("scen.hypothetical")}</span>
      </div>
      <p className="fs-meta">{t("scen.help", { n: n ?? "" })}</p>
      <SegmentedToggle<ScenarioPreset | "custom">
        label={t("nm.scenario")}
        value={preset}
        onChange={(v) => {
          if (v === "custom") commit(rain || -20, temp, false);
          else set({ scenario: v as Scenario, compareRequested: true });
          setIs2040(false);
        }}
        options={[...SCENARIO_PRESETS.map((s) => ({ value: s as ScenarioPreset | "custom", label: t(`scenario.${s}`) })), { value: "custom", label: t("scen.custom") }]}
      />
      <div className="scen-stress" role="group" aria-labelledby="scen-stress-h">
        <span id="scen-stress-h" className="scen-stress__h">
          {t("scen.stress_h")}
        </span>
        {STRESS_TESTS.map((st) => {
          const on = scenario === st.scenario;
          const off = st.id === "lower_prices" && noCosts(q.data);
          return (
            <button
              key={st.id}
              type="button"
              className={cx("fs-chip fs-chip--alert scen-stress__btn", on && "is-on")}
              aria-pressed={on}
              disabled={off}
              onClick={() => {
                window.clearTimeout(timer.current);
                setIs2040(false);
                set({ scenario: on ? "normal" : st.scenario, compareRequested: true });
              }}
            >
              <span className="scen-stress__name">{t(`scen.st_${st.id}`)}</span>
              <span className="scen-stress__what">
                {off ? t("scen.st_no_prices") : scenarioLabel(st.scenario, t, lang)}
              </span>
            </button>
          );
        })}
      </div>
      <div className="scen-sliders">
        <label className="scen-slider">
          <span className="scen-slider__lab">
            {t("scen.rain")} <strong>{fmtPct(rain)}</strong>
          </span>
          <input
            type="range"
            min={RAIN.min}
            max={RAIN.max}
            step={RAIN.step}
            value={rain}
            aria-valuetext={fmtPct(rain)}
            onChange={(e) => {
              const v = Number(e.target.value);
              setRain(v);
              setIs2040(false);
              commit(v, temp);
            }}
          />
          <span className="scen-slider__ends" aria-hidden="true">
            <span>{fmtPct(RAIN.min)}</span>
            <span>{fmtPct(RAIN.max)}</span>
          </span>
        </label>
        <label className="scen-slider">
          <span className="scen-slider__lab">
            {t("scen.temp")} <strong>{fmtC(temp)}</strong>
          </span>
          <input
            type="range"
            min={TEMP.min}
            max={TEMP.max}
            step={TEMP.step}
            value={temp}
            aria-valuetext={fmtC(temp)}
            onChange={(e) => {
              const v = Number(e.target.value);
              setTemp(v);
              setIs2040(false);
              commit(rain, v);
            }}
          />
          <span className="scen-slider__ends" aria-hidden="true">
            <span>{fmtC(TEMP.min)}</span>
            <span>{fmtC(TEMP.max)}</span>
          </span>
        </label>
      </div>
      <div className="scen-2040">
        <button
          type="button"
          className={cx("fs-chip fs-chip--purple scen-2040__btn", is2040 && "is-on")}
          aria-pressed={is2040}
          disabled={!sh}
          onClick={() => {
            if (!sh) return;
            // Rounded to the slider steps shown (whole percent, 0.1 °C) and clamped to the slider range.
            const r = clamp(Math.round(sh.rain), RAIN.min, RAIN.max);
            const tc = clamp(Math.round(sh.temp * 10) / 10, TEMP.min, TEMP.max);
            setRain(r);
            setTemp(tc);
            setIs2040(true);
            commit(r, tc, false);
          }}
        >
          {t("scen.s2040", { n: sh?.n || "" })}
        </button>
        {sh ? (
          <span className="fs-meta">
            {t("scen.s2040_vals", { temp: fmtC(Math.round(sh.temp * 10) / 10), rain: fmtPct(Math.round(sh.rain)), period: sh.period })}
            <Ev ev={twins.data?.evidence?.[twins.data?.evidence_ids?.nex_gddp ?? ""]} describes={t("scen.s2040", { n: sh.n })} />
          </span>
        ) : twins.isLoading || twins.data?.status === "loading" ? (
          <span className="fs-meta busy">
            <IconLoader size={14} className="fs-spin" /> {t("scen.s2040_loading")}
          </span>
        ) : (
          <span className="fs-meta">{t("scen.s2040_none", { reason: twins.data?.reason ?? (twins.error instanceof Error ? twins.error.message : "") })}</span>
        )}
      </div>
      {is2040 ? <p className="fs-meta">{t("scen.s2040_caveat")}</p> : null}
      {cur?.price ? <p className="fs-meta">{t("scen.price_caveat")}</p> : null}
      <div className="scen-foot">
        {busy ? (
          <p className="scen-busy" role="status">
            <IconLoader size={16} className="fs-spin" /> {t("scen.resim", { n: n ?? "" })}
          </p>
        ) : scenario !== "normal" && q.data?.scenario === scenario ? (
          <p className="fs-meta" role="status">
            {t("scen.showing", { s: scenarioLabel(scenario, t, lang) })}
          </p>
        ) : null}
        {scenario !== "normal" ? (
          <Button variant="ghost" size="sm" onClick={() => set({ scenario: "normal" })}>
            {t("scenario.reset")}
          </Button>
        ) : null}
      </div>
      {q.data && !q.data.supported && scenario !== "normal" ? <StatusBanner kind="unsupported">{q.data.reason}</StatusBanner> : null}
    </section>
  );
}
