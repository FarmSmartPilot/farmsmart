/* ROTATION OPTIONS: compact cards, full Strategy Card, "Why not others?", rank stability and binding constraint. */
import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  Button,
  ConfidenceChip,
  MatchBar,
  PetalChart,
  Popover,
  usePopover,
  StatusBanner,
  SegmentedToggle,
  Skeleton,
  SIButton,
  Tabs,
  DataButton,
  IconChevronDown,
  IconChevronRight,
  IconExternal,
} from "../design";
import type { CardData, CompareResult, CountyYield, FitCrop, KbCrop } from "../api";
import type { SIRecord } from "../design";
import { countyYields, ownBudgetCrops, useCompareQ, useCropsQ } from "../api";
import { useApp, useCompareBody } from "../store";
import ScenarioPanel from "../components/ScenarioPanel";
import AddToFarm from "../components/AddToFarm";
import { QueryState, Reminder, Term, NeedField } from "../components/common";
import { showPriorities } from "./MyField";
import { INDICATORS, PETAL_KEYS, cardSI, conv, cropColor, cx, isNum, nice, normalize, rulesSI, scenarioLabel, toConfidence } from "../lib";

/* ---------------- shared hooks ---------------- */

export function useCompare(enabled = true) {
  const field = useApp((s) => s.field);
  const body = useCompareBody();
  return useCompareQ(field?.id ?? null, body, enabled);
}

export function cardTitle(c: CardData, t: (k: string) => string): string {
  return c.is_baseline ? `${t("options.current")}: ${c.rotation_label}` : c.name;
}

export function familyName(c: CardData, lang: string) {
  return lang === "es" && c.family_name_es ? c.family_name_es : c.family_name;
}

/* ---------------- mini 2-year strip ---------------- */

export function MiniStrip({ card }: { card: CardData }) {
  const { t } = useTranslation();
  const tl = card.timeline;
  if (!tl) return null;
  const cover = [...(tl.weekly_cover[0] ?? []), ...(tl.weekly_cover[1] ?? [])];
  return (
    <svg className="ministrip" viewBox="0 0 104 10" preserveAspectRatio="none" role="img" aria-label={t("options.strip_label", { n: nice(tl.bare_weeks) })}>
      <defs>
        <pattern id="hatch-mini" width="3" height="3" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="3" height="3" fill="var(--alert-tint)" />
          <line x1="0" y1="0" x2="0" y2="3" stroke="var(--alert)" strokeWidth="1.2" />
        </pattern>
      </defs>
      <rect width="104" height="10" fill="var(--track)" />
      {tl.bars.map((b, i) => (
        <rect key={i} x={b.start_week} y={b.kind === "cover" ? 5 : 0} width={Math.max(0.5, Math.min(104, b.end_week) - b.start_week)} height={b.kind === "cover" ? 5 : 10} fill={cropColor(b.crop_id)} />
      ))}
      {cover.map((v, w) => (v < 0.3 ? <rect key={`b${w}`} x={w} y={0} width={1} height={10} fill="url(#hatch-mini)" /> : null))}
    </svg>
  );
}

/** What the strip's colours mean, for this option: two years left to right, crops (full height), cover crops
    (lower half), bare soil (red hatching). */
export function MiniStripKey({ card }: { card: CardData }) {
  const { t, i18n } = useTranslation();
  const kb = useCropsQ();
  const tl = card.timeline;
  if (!tl) return null;
  const crops = [...new Map(tl.bars.map((b) => [b.crop_id, b])).values()];
  const nameOf = (id: string) => {
    const c = kb.data?.[id];
    return (i18n.language === "es" ? c?.name_es : c?.name) ?? id.replace(/_/g, " ");
  };
  return (
    <div className="ministrip-key" aria-hidden="true">
      <div className="ministrip-key__axis">
        <span>{t("options.strip_y1")}</span>
        <span>{t("options.strip_y2")}</span>
      </div>
      <div className="ministrip-key__items">
        {crops.map((b) => (
          <span key={b.crop_id} className="ministrip-key__item">
            <i className={b.kind === "cover" ? "is-cover" : undefined} style={{ background: cropColor(b.crop_id) }} />
            {nameOf(b.crop_id)}
            {b.kind === "cover" && !/cover|cobertura/i.test(nameOf(b.crop_id)) ? ` (${t("options.strip_cover")})` : ""}
          </span>
        ))}
        <span className="ministrip-key__item">
          <i className="is-bare" />
          {t("options.strip_bare")}
        </span>
      </div>
    </div>
  );
}

/* ---------------- county yield (M2) ---------------- */

function yieldSI(y: CountyYield, t: (k: string) => string): SIRecord {
  const eff = y.si?.driver_effects ?? [];
  return {
    model_name: y.si?.name ?? t("yield.model"),
    kind: "si",
    version: y.si?.model_id,
    top_drivers: (eff.length ? eff.map((d) => ({ name: d.label, note: d.mean_abs_effect != null ? `±${d.mean_abs_effect} ${d.unit ?? ""}`.trim() : undefined })) : (y.si?.drivers ?? []).map((n) => ({ name: n }))).slice(0, 4),
    confidence: toConfidence(y.si?.confidence),
    information_cutoff: y.si?.information_cutoff,
    model_card_url: "#/sources",
  };
}

/** "Corn: typically 211 bu/ac (bad year 179, good year 242)": county statistics, with SI and data buttons. */
export function CountyYieldLines({ card }: { card: CardData }) {
  const { t, i18n } = useTranslation();
  const crops = useCropsQ();
  const lang = i18n.language;
  const all = Object.entries(countyYields(card));
  const ys = all.filter(([, y]) => y?.available && isNum(y.p50));
  const none = all.filter(([, y]) => y && !y.available);
  if (!ys.length) return null;
  const nameOf = (id: string) => {
    const c = crops.data?.[id];
    const n = c ? (lang === "es" && c.name_es ? c.name_es : c.name) : id.replace(/_/g, " ");
    return n.split(" (")[0];
  };
  const r = (v: number | undefined) => (isNum(v) ? Math.round(v).toLocaleString(lang === "es" ? "es" : "en-US") : "—");
  const first = ys[0][1];
  const ev = (first.evidence ?? []).map((e) => ({
    source: e.source,
    product: e.product ?? e.source,
    observation_start: e.years ? String(e.years[0]) : undefined,
    observation_end: e.years ? String(e.years[1]) : undefined,
    effective_res: e.scale,
    footprint: e.footprint,
    licence: e.licence,
    url: e.url,
    is_nasa: !!e.is_nasa,
    qa_flags: [],
  }));
  return (
    <div className="cyield" data-tour="county-yield">
      <p className="cyield__h">
        {t("yield.title")} <span className="fs-meta">({first.scale ?? t("yield.scale")})</span>
        <SIButton record={yieldSI(first, t)} describes={t("yield.title")} />
        {ev.map((e) => (
          <DataButton key={e.source} evidence={e} describes={t("yield.title")} />
        ))}
      </p>
      <ul className="cyield__list">
        {ys.map(([id, y]) => (
          <li key={id}>
            {t("yield.line", { crop: nameOf(id), p50: r(y.p50), unit: y.unit ?? "bu/ac", p10: r(y.p10), p90: r(y.p90) })}
          </li>
        ))}
        {none.map(([id]) => (
          <li key={id} className="cyield__none">
            {t("yield.none", { crop: nameOf(id) })}
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ---------------- why not others ---------------- */

type CropTab = "fits" | "excluded" | "all";

/** check_first may come as a list or a single string; absent means nothing to show. */
function asList(v: string[] | string | undefined): string[] {
  if (!v) return [];
  return (Array.isArray(v) ? v : [v]).map((x) => String(x).trim()).filter(Boolean);
}

/** One crop: name, its plain blurb, "Check first" items (from /api/kb/crops), and for excluded crops the reasons. */
function CropRow({ c, kb, excluded }: { c: FitCrop; kb?: KbCrop; excluded?: boolean }) {
  const { t, i18n } = useTranslation();
  const es = i18n.language === "es";
  const blurb = (es ? kb?.blurb_es : kb?.blurb_en) || kb?.blurb_en;
  const check = asList(es ? (kb?.check_first_es ?? kb?.check_first_en) : kb?.check_first_en);
  const reasons = [...new Set((c.reasons ?? []).map((r) => r.reason))];
  return (
    <li className={cx("crop-row", excluded && "crop-row--out")}>
      <strong>{es && c.name_es ? c.name_es : c.name}</strong>
      {blurb ? <span className="crop-row__blurb">{blurb}</span> : null}
      {excluded && reasons.length ? (
        <span className="crop-row__why">
          <span className="crop-row__lab">{t("whynot.why_out")}</span> {reasons.join(" · ")}
        </span>
      ) : null}
      {check.length ? (
        <span className="crop-row__check">
          <span className="crop-row__lab">{t("whynot.check_first")}</span>
          <ul>
            {check.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </span>
      ) : null}
    </li>
  );
}

function CropGroup({ kind, list }: { kind: "fits" | "excluded"; list: FitCrop[] }) {
  const { t } = useTranslation();
  const kb = useCropsQ();
  return (
    <div className="crop-group">
      <h4 className="crop-group__h">{t(kind === "fits" ? "whynot.fits_h" : "whynot.crops")}</h4>
      {list.length ? (
        <ul className="reasons">
          {[...list]
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((c) => (
              <CropRow key={c.crop_id} c={c} kb={kb.data?.[c.crop_id]} excluded={kind === "excluded"} />
            ))}
        </ul>
      ) : (
        <p className="fs-meta">{t(kind === "fits" ? "whynot.none_fit" : "whynot.none_crop")}</p>
      )}
    </div>
  );
}

export function WhyNotOthers({ cmp, children }: { cmp: CompareResult; children?: ReactNode }) {
  const { t } = useTranslation();
  const p = usePopover();
  const open = useApp((s) => s.whyNotOpen);
  const set = useApp((s) => s.set);
  const n = cmp.candidates_simulated ?? cmp.all_cards.length;
  const m = cmp.candidates_considered ?? n;
  const crops = cmp.what_fits?.excluded ?? [];
  const fits = cmp.what_fits?.feasible ?? [];
  const rots = cmp.excluded_candidates ?? [];
  // "Why not others?" opens on the crops that do not fit; the farmer can switch to what fits, or both.
  const [tab, setTab] = useState<CropTab>("excluded");
  const close = () => {
    p.close();
    set({ whyNotOpen: false });
  };
  const uniq = (xs: string[]) => [...new Set(xs)];
  return (
    <>
      <button
        ref={p.anchorRef}
        type="button"
        className="fs-link whynot"
        data-tour="why-not"
        aria-haspopup="dialog"
        aria-expanded={open || p.open}
        onClick={() => set({ whyNotOpen: !open })}
      >
        {children ?? t("options.feasible", { n, m })}
      </button>
      <Popover open={open} onClose={close} anchorRef={p.anchorRef} title={t("whynot.title")} width={440} placement="left">
        <div className="whynot-body" data-tour="why-not-panel">
          <p className="fs-meta">{t("whynot.lead", { n, m, shown: cmp.cards.length })}</p>
          <h3 className="h4">{t("whynot.rotations")}</h3>
          {rots.length ? (
            <ul className="reasons">
              {rots.map((r) => (
                <li key={r.id}>
                  <strong>{r.name}</strong>
                  <span>{r.reason}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="fs-meta">{t("whynot.none_rot")}</p>
          )}
          {cmp.all_cards.filter((c) => !c.shown).length ? (
            <>
              <h3 className="h4">{t("whynot.not_shown")}</h3>
              <ul className="reasons">
                {cmp.all_cards
                  .filter((c) => !c.shown)
                  .sort((a, b) => a.rank - b.rank)
                  .map((c) => (
                    <li key={c.id}>
                      <strong>{c.name}</strong>
                      <span>{t("whynot.ranked", { rank: c.rank, match: c.match })}</span>
                    </li>
                  ))}
              </ul>
            </>
          ) : null}
          <h3 className="h4">
            {t("whynot.crops_h")} <SIButton record={rulesSI(undefined, uniq(crops.flatMap((c) => (c.reasons ?? []).map((r) => r.rule))))} describes={t("whynot.crops_h")} />
          </h3>
          <Tabs
            label={t("whynot.crops_h")}
            value={tab}
            onChange={(id) => setTab(id as CropTab)}
            className="whynot-tabs"
            tabs={[
              { id: "fits", label: t("whynot.tab_fits", { n: fits.length }), content: <CropGroup kind="fits" list={fits} /> },
              { id: "excluded", label: t("whynot.tab_excluded", { n: crops.length }), content: <CropGroup kind="excluded" list={crops} /> },
              {
                id: "all",
                label: t("whynot.tab_all"),
                content: (
                  <>
                    <CropGroup kind="fits" list={fits} />
                    <CropGroup kind="excluded" list={crops} />
                  </>
                ),
              },
            ]}
          />
          {cmp.what_fits?.note ? <p className="fs-meta">{cmp.what_fits.note}</p> : null}
        </div>
      </Popover>
    </>
  );
}

/* ---------------- raw indicators ---------------- */

export function IndicatorTable({ card, cmp }: { card: CardData; cmp: CompareResult }) {
  const { t, i18n } = useTranslation();
  const units = useApp((s) => s.units);
  const lang = i18n.language;
  const n = card.indicators.soil_cover?.n ?? card.model?.weather_years;
  return (
    <table className="fs-table ind-table">
      <caption className="cap-left fs-meta">
        {t("card.raw_caption", { n })} <Term id="p10_p50_p90">P10 / P50 / P90</Term>
      </caption>
      <thead>
        <tr>
          <th scope="col">{t("card.indicator")}</th>
          <th scope="col">P10</th>
          <th scope="col">P50</th>
          <th scope="col">P90</th>
        </tr>
      </thead>
      <tbody>
        {INDICATORS.map((m) => {
          const q = card.indicators[m.key];
          const ci = card.confidence_by_indicator?.[m.key];
          const f = (v: number | undefined) => (m.unit === "usd_ac" ? (isNum(v) ? `$${nice(v, lang)}` : "—") : nice(conv(v, m.unit, units)[0], lang));
          return (
            <tr key={m.key}>
              <th scope="row">
                {m.glossary ? <Term id={m.glossary}>{t(m.label)}</Term> : t(m.label)}
                <span className="unit"> {t(`unit.${m.key}`, { u: conv(0, m.unit, units)[1] })}</span>
                {ci ? <span className={`ci ci--${ci.level}`} title="">{t(`conf.${ci.level}`)}</span> : null}
              </th>
              <td>{q ? f(q.p10) : "—"}</td>
              <td className="p50">{q ? f(q.p50) : "—"}</td>
              <td>{q ? f(q.p90) : "—"}</td>
            </tr>
          );
        })}
        {card.indicators.profit_p50 ? (
          <tr>
            <th scope="row">{t("card.bad_year_return")}</th>
            <td colSpan={3}>${nice(card.indicators.profit_p50.p10, lang)} /ac</td>
          </tr>
        ) : (
          <tr>
            <th scope="row">{t("ind.profit_p50")}</th>
            <td colSpan={3}>{t("card.no_profit")}</td>
          </tr>
        )}
      </tbody>
      {cmp.weather_years ? (
        <tfoot>
          <tr>
            <td colSpan={4} className="fs-meta">
              {t("card.weather_years", { a: cmp.weather_years.first, b: cmp.weather_years.last })}
            </td>
          </tr>
        </tfoot>
      ) : null}
    </table>
  );
}

/* ---------------- full strategy card ---------------- */

function Block({ title, children, tone }: { title: string; children: ReactNode; tone?: string }) {
  return (
    <section className={cx("sblock", tone && `sblock--${tone}`)}>
      <h4 className="sblock__h">{title}</h4>
      {children}
    </section>
  );
}

export function StrategyDetail({ card, cmp }: { card: CardData; cmp: CompareResult }) {
  const { t, i18n } = useTranslation();
  const es = i18n.language === "es";
  const uniq = (xs: string[]) => [...new Set(xs)];
  const srcIds = uniq(card.evidence.flatMap((e) => e.sources));
  return (
    <div className="sdetail" data-tour="strategy-detail">
      <Block title={t("card.why")}>
        <ul className="bul">{card.why.map((x) => <li key={x}>{x}</li>)}</ul>
      </Block>
      <Block title={t("card.evidence")}>
        <ul className="bul">
          {uniq(card.evidence.map((e) => e.text)).map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ul>
        {srcIds.length ? (
          <ol className="cites">
            {srcIds.map((id) => {
              const s = card.sources[id];
              return (
                <li key={id}>
                  {s?.url && /^https?:/.test(s.url) ? (
                    <a href={s.url} target="_blank" rel="noopener noreferrer" className="fs-link">
                      {s.cite} <IconExternal size={12} />
                    </a>
                  ) : (
                    (s?.cite ?? id)
                  )}
                </li>
              );
            })}
          </ol>
        ) : null}
      </Block>
      <Block title={t("card.benefits")} tone="good">
        {card.benefits.length ? <ul className="bul">{card.benefits.map((x) => <li key={x}>{x}</li>)}</ul> : <p className="fs-meta">{t("card.none_vs_current")}</p>}
      </Block>
      <Block title={t("card.tradeoffs")} tone="risk">
        {card.tradeoffs_risks.length ? <ul className="bul">{uniq(card.tradeoffs_risks).map((x) => <li key={x}>{x}</li>)}</ul> : <p className="fs-meta">{t("card.none_flagged")}</p>}
      </Block>
      <Block title={t("card.gaps")}>
        <ul className="bul">{card.information_gaps.map((x) => <li key={x}>{x}</li>)}</ul>
      </Block>
      <Block title={t("card.check_locally")} tone="alert">
        <ul className="checklist">
          {card.check_locally.map((x) => (
            <li key={x.id}>
              <label className="check">
                <input type="checkbox" />
                <span>{es && x.text_es ? x.text_es : x.text}</span>
              </label>
            </li>
          ))}
        </ul>
      </Block>
      {card.try_it_small ? (
        <Block title={t("card.try_small")}>
          <p>{es && card.try_it_small.example_es ? card.try_it_small.example_es : card.try_it_small.example}</p>
          {card.try_it_small.design ? <p className="fs-meta">{card.try_it_small.design}</p> : null}
          {card.try_it_small.measure?.length ? (
            <p className="fs-meta">
              {t("card.measure")}: {card.try_it_small.measure.join(" · ")}
            </p>
          ) : null}
          {card.try_it_small.duration ? <p className="fs-meta">{card.try_it_small.duration}</p> : null}
        </Block>
      ) : null}
      <Block title={t("card.raw")}>
        <IndicatorTable card={card} cmp={cmp} />
      </Block>
    </div>
  );
}

/* ---------------- compact card ---------------- */

/** "Your prices: corn, soybean" when the profit numbers use the farmer's own price/cost/yield for some crops. */
export function OwnPricesTag({ card, cmp }: { card: CardData; cmp?: CompareResult }) {
  const { t, i18n } = useTranslation();
  const crops = useCropsQ();
  const ids = ownBudgetCrops(card, cmp);
  if (!ids.length) return null;
  const nm = (id: string) => {
    const c = crops.data?.[id];
    return (c ? (i18n.language === "es" && c.name_es ? c.name_es : c.name) : id.replace(/_/g, " ")).split(" (")[0];
  };
  return <span className="fs-chip fs-chip--soil own-prices">{t("budget.card_tag", { crops: ids.map(nm).join(", ") })}</span>;
}

export function OptionCard({ card, cmp, all, duo }: { card: CardData; cmp: CompareResult; all: CardData[]; duo?: boolean }) {
  const { t, i18n } = useTranslation();
  const expanded = useApp((s) => s.expandedCard);
  const selected = useApp((s) => s.selectedCard);
  const set = useApp((s) => s.set);
  const mode = useApp((s) => s.mode);
  const isOpen = expanded === card.id;
  const petals = PETAL_KEYS.map((k) => {
    const meta = INDICATORS.find((m) => m.key === k)!;
    return { key: k, label: t(meta.label), value0to1: normalize(all, k, meta.dir, card) };
  });
  const si = cardSI(card, cmp, t);
  const tl = card.timeline;
  return (
    <article
      className={cx("ocard", card.best_for_you && "is-best", selected === card.id && "is-selected", isOpen && "is-open", duo && "ocard--duo")}
      aria-labelledby={`oc-${card.id}`}
      data-tour={card.best_for_you ? "strategy-card" : undefined}
    >
      <div className="ocard__top">
        <PetalChart indicators={petals} size={64} title={t("options.petal_title", { name: card.name })} />
        <div className="ocard__head">
          <div className="ocard__tags">
            <span className="fs-chip fs-chip--outline ocard__fam">{card.is_baseline ? t("options.current") : familyName(card, i18n.language)}</span>
            {card.best_for_you ? <span className="best-tag">{t("options.best")}</span> : null}
          </div>
          <h3 id={`oc-${card.id}`} className="ocard__title">
            <button
              type="button"
              className="ocard__titlebtn"
              aria-expanded={isOpen}
              aria-controls={`ocd-${card.id}`}
              onClick={() => set({ expandedCard: isOpen ? null : card.id, selectedCard: card.id })}
            >
              {card.is_baseline ? card.rotation_label : card.is_custom && card.custom_name ? card.custom_name : card.name}
              {isOpen ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
            </button>
          </h3>
          {card.is_baseline ? <p className="ocard__intent">{t("options.baseline_note")}</p> : null}
          {card.is_custom && card.custom_name ? <p className="ocard__intent">{card.name}</p> : null}
        </div>
      </div>
      <MiniStrip card={card} />
      <MiniStripKey card={card} />
      <MatchBar value={card.match} label={t("options.match")} trailing={<SIButton record={si} describes={t("options.match_of", { name: card.name })} />} />
      <div className="ocard__row">
        <ConfidenceChip confidence={toConfidence(card.confidence, card.information_gaps[0])} />
        {tl ? (
          <span className="fs-meta">
            {t("options.bare_weeks", { n: nice(tl.bare_weeks, i18n.language) })}
          </span>
        ) : null}
      </div>
      {card.confidence.level === "low" && card.confidence.reasons?.length ? (
        // Low confidence: the reasons are shown, not hidden behind the chip.
        <ul className="conf-reasons" aria-label={t("options.conf_reasons")}>
          {card.confidence.reasons.slice(0, 3).map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ul>
      ) : null}
      <OwnPricesTag card={card} cmp={cmp} />
      <CountyYieldLines card={card} />
      {mode === "expert" && !isOpen ? (
        <p className="ocard__caveat">{card.tradeoffs_risks[0] ?? card.information_gaps[0]}</p>
      ) : null}
      {isOpen ? (
        <div id={`ocd-${card.id}`}>
          <StrategyDetail card={card} cmp={cmp} />
        </div>
      ) : null}
    </article>
  );
}

/** True when costs and prices are not connected here (outside the US): profit indicators are dropped from the ranking. */
export function noCosts(cmp: CompareResult | undefined): boolean {
  if (!cmp?.supported) return false;
  const dropped = (cmp.ranking?.dropped_indicators ?? []).map((d) => (typeof d === "string" ? d : (d.indicator ?? d.key ?? "")));
  if (dropped.some((d) => d.startsWith("profit"))) return true;
  return !cmp.all_cards.some((c) => isNum(c.indicators.profit_p50?.p50));
}

export function NoCostsNote({ cmp }: { cmp: CompareResult | undefined }) {
  const { t } = useTranslation();
  if (!noCosts(cmp)) return null;
  return (
    <StatusBanner kind="partial" title={t("options.no_costs")}>
      {t("options.no_costs_body")}
    </StatusBanner>
  );
}

/* ---------------- stability, binding constraint ---------------- */

export function RankNotes({ cmp }: { cmp: CompareResult }) {
  const { t } = useTranslation();
  const rk = cmp.ranking;
  const runner = cmp.all_cards.find((c) => c.id === rk?.runner_up);
  const top = cmp.all_cards.find((c) => c.id === rk?.top);
  const bc = cmp.binding_constraint;
  return (
    <div className="rank-notes">
      {rk && !rk.stable ? (
        <StatusBanner kind="partial" title={t("rank.uncertain")}>
          {t("rank.uncertain_body", { pct: Math.round((rk.win_share?.[rk.top] ?? 0) * 100) })}
        </StatusBanner>
      ) : rk ? (
        <p className="fs-meta">
          {t("rank.stable", { name: top?.name ?? "", pct: Math.round((rk.win_share?.[rk.top] ?? 0) * 100) })}
        </p>
      ) : null}
      {rk?.flips?.length && runner ? (
        <div className="flips">
          <p className="flips__h">{t("rank.what_changes")}</p>
          <ul>
            {rk.flips.map((f) => (
              <li key={f.indicator}>{t("rank.flip", { label: f.label, runner: runner.name })}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {bc ? (
        <StatusBanner kind="unsupported" title={t("rank.binding")}>
          {typeof bc === "string" ? (
            bc
          ) : (
            <>
              <p>{bc.message ?? bc.constraint}</p>
              {bc.adjustments?.length ? (
                <ul className="bul">
                  {bc.adjustments.map((a, i) => (
                    <li key={i}>{typeof a === "string" ? a : a.text}</li>
                  ))}
                </ul>
              ) : null}
            </>
          )}
        </StatusBanner>
      ) : null}
    </div>
  );
}

/* ---------------- "ranked by" line ---------------- */

/** "Ranked by what matters to you: 1 Keep soil covered, 2 Stop erosion · Change": the way to the priorities. */
function RankedBy() {
  const { t } = useTranslation();
  const priorities = useApp((s) => s.priorities);
  return (
    <p className="ranked-by fs-meta" data-tour="ranked-by">
      <span>
        {t("options.ranked_by", { a: t(`prio.${priorities[0]}`), b: t(`prio.${priorities[1]}`) })}
      </span>{" "}
      <button type="button" className="fs-link ranked-by__btn" onClick={showPriorities}>
        {t("options.change_prio")}
      </button>
    </p>
  );
}

/* ---------------- best vs current ---------------- */

const DUO_KEYS = ["soil_cover", "erosion_water", "water_use", "profit_p50", "soc_trend", "workload"];

/** The top-ranked option and the current rotation side by side, with their typical-year (P50) numbers. */
function BestVsCurrent({ cmp, all }: { cmp: CompareResult; all: CardData[] }) {
  const { t, i18n } = useTranslation();
  const units = useApp((s) => s.units);
  const expanded = useApp((s) => s.expandedCard);
  const lang = i18n.language;
  const base = cmp.cards.find((c) => c.is_baseline) ?? all.find((c) => c.is_baseline);
  const ranked = [...cmp.cards].sort((a, b) => Number(b.best_for_you) - Number(a.best_for_you) || a.rank - b.rank);
  const best = ranked[0];
  // When the current rotation itself ranks first, put the best alternative beside it.
  const baseIsBest = !!best && best.is_baseline;
  const other = baseIsBest ? ranked.find((c) => !c.is_baseline) : best;
  const pair = [other, base].filter((c): c is CardData => !!c);
  if (!pair.length) return null;
  const fmtV = (key: string, v: number | undefined) => {
    const meta = INDICATORS.find((m) => m.key === key)!;
    if (!isNum(v)) return "—";
    if (meta.unit === "usd_ac") return `$${nice(v, lang)}`;
    return nice(conv(v, meta.unit, units)[0], lang);
  };
  const rows = DUO_KEYS.map((k) => INDICATORS.find((m) => m.key === k)!).filter((m) => pair.some((c) => isNum(c.indicators[m.key]?.p50)));
  return (
    <div className="duo">
      {baseIsBest ? <p className="fs-meta">{t("options.duo_base_best")}</p> : null}
      <div className="ocards ocards--duo" role="list" aria-label={t("options.view_duo")}>
        {pair.map((c) => (
          <div role="listitem" key={c.id} className={cx("duo__cell", expanded === c.id && "is-wide")}>
            <OptionCard card={c} cmp={cmp} all={all} duo />
          </div>
        ))}
      </div>
      {pair.length === 2 && rows.length ? (
        <table className="fs-table duo-table">
          <caption className="cap-left fs-meta">
            {t("options.duo_caption", { n: cmp.weather_years?.n ?? "" })}{" "}
            <SIButton record={cardSI(pair[0], cmp, t)} describes={t("options.duo_caption", { n: "" })} />
          </caption>
          <thead>
            <tr>
              <th scope="col">{t("card.indicator")}</th>
              {pair.map((c) => (
                <th scope="col" key={c.id}>
                  {c.is_baseline ? t("options.current") : baseIsBest ? t("options.duo_next") : t("options.duo_top")}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((m) => {
              const a = pair[0].indicators[m.key]?.p50;
              const b = pair[1].indicators[m.key]?.p50;
              const win = isNum(a) && isNum(b) && Math.abs(a - b) > 1e-9 ? ((a - b) * m.dir > 0 ? 0 : 1) : -1;
              return (
                <tr key={m.key}>
                  <th scope="row">
                    {t(m.label)} <span className="unit">{t(`unit.${m.key}`, { u: conv(0, m.unit, units)[1] })}</span>
                  </th>
                  {[a, b].map((v, i) => (
                    <td key={i} className={cx(win === i && "is-better")}>
                      {fmtV(m.key, v)}
                      {win === i ? <span className="duo-better">{t("options.duo_better")}</span> : null}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : null}
    </div>
  );
}

/* ---------------- column ---------------- */

export default function RotationOptions() {
  const { t, i18n } = useTranslation();
  const field = useApp((s) => s.field);
  const requested = useApp((s) => s.compareRequested);
  const mode = useApp((s) => s.mode);
  const scenario = useApp((s) => s.scenario);
  const optionsView = useApp((s) => s.optionsView);
  const set = useApp((s) => s.set);
  const q = useCompare();
  const cmp = q.data;
  const all = useMemo(() => cmp?.all_cards ?? [], [cmp]);
  if (!field) return <NeedField />;

  return (
    <section className="panel options" aria-labelledby="opt-h" data-tour="rotation-options">
      <header className="panel__head">
        <h2 id="opt-h" className="fs-overline">
          {t("options.overline")}
        </h2>
        <AddToFarm className="options__farm" />
        {cmp?.supported && requested ? <WhyNotOthers cmp={cmp} /> : null}
      </header>
      {cmp?.supported && requested ? <RankedBy /> : null}
      <div className="panel__scroll" aria-busy={q.isFetching}>
        {mode === "expert" && requested ? (
          <details className="scen-details" open={scenario !== "normal"}>
            <summary>
              {t("scen.title")} <span className="fs-chip fs-chip--wheat">{t("scen.hypothetical")}</span>
            </summary>
            <ScenarioPanel compact />
          </details>
        ) : null}
        {!requested ? (
          <div className="empty-options">
            <p>{t("options.press_compare")}</p>
            <Button variant="secondary" onClick={() => set({ compareRequested: true })} iconAfter={<IconChevronRight size={16} />}>
              {t("myfield.compare")}
            </Button>
          </div>
        ) : q.isLoading ? (
          <div className="fs-stack" style={{ ["--gap" as string]: "8px" }}>
            <p className="fs-meta busy" role="status">
              {t("options.running")}
            </p>
            <Skeleton height={150} />
            <Skeleton height={150} />
            <Skeleton height={150} />
          </div>
        ) : q.error ? (
          <QueryState error={q.error} what={t("options.overline")} onRetry={() => void q.refetch()} />
        ) : cmp && !cmp.supported ? (
          <StatusBanner kind="unsupported" title={t("options.unsupported")}>
            {cmp.reason}
          </StatusBanner>
        ) : cmp ? (
          <>
            {q.isFetching ? (
              <p className="fs-meta busy" role="status">
                {t("options.updating")}
              </p>
            ) : null}
            {cmp.scenario && cmp.scenario !== "normal" ? <p className="fs-chip fs-chip--wheat">{t("scenario.active", { s: scenarioLabel(cmp.scenario, t, i18n.language) })} · {t("scen.hypothetical_short")}</p> : null}
            <SegmentedToggle<"all" | "duo">
              label={t("options.view_label")}
              className="opt-view"
              value={optionsView}
              onChange={(v) => set({ optionsView: v })}
              options={[
                { value: "all", label: t("options.view_all") },
                { value: "duo", label: t("options.view_duo") },
              ]}
            />
            {optionsView === "duo" ? (
              <BestVsCurrent cmp={cmp} all={all} />
            ) : (
              <div className="ocards">
                {/* "Best for you" first, then your current rotation, then the rest: the answer is the first thing seen. */}
                {[...cmp.cards].sort((a, b) => Number(b.best_for_you) - Number(a.best_for_you) || Number(b.is_baseline) - Number(a.is_baseline) || a.rank - b.rank).map((c) => (
                  <OptionCard key={c.id} card={c} cmp={cmp} all={all} />
                ))}
              </div>
            )}
            <NoCostsNote cmp={cmp} />
            {cmp.custom_note ? <StatusBanner kind="partial">{cmp.custom_note}</StatusBanner> : null}
            <RankNotes cmp={cmp} />
            <Reminder text={cmp.reminder} />
          </>
        ) : null}
      </div>
    </section>
  );
}

