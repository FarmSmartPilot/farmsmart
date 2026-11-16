/* Strategy Compare: full cards side by side, quantile dot-plots ("in N of M weather years") and the rules trace. */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { scaleLinear } from "d3";
import { Button, ConfidenceChip, MatchBar, SIButton, Skeleton, StatusBanner, Chip } from "../design";
import type { CardData, CompareResult } from "../api";
import { useApp } from "../store";
import { NeedField, QueryState, Reminder, Term } from "../components/common";
import { INDICATORS, cardSI, conv, cx, isNum, nice, rulesSI, toConfidence } from "../lib";
import type { IndicatorMeta } from "../lib";
import { MiniStrip, MiniStripKey, NoCostsNote, OwnPricesTag, RankNotes, StrategyDetail, WhyNotOthers, familyName, useCompare } from "./Options";

/** One indicator × all cards, P10–P90 whisker with the P50 dot, on a shared axis. */
export function DotPlot({ cards, meta }: { cards: CardData[]; meta: IndicatorMeta }) {
  const { t, i18n } = useTranslation();
  const units = useApp((s) => s.units);
  const lang = i18n.language;
  const rows = cards.map((c) => ({ c, q: c.indicators[meta.key] })).filter((r) => r.q && isNum(r.q.p50));
  if (!rows.length) return null;
  const cv = (v: number) => (meta.unit === "usd_ac" ? v : (conv(v, meta.unit, units)[0] ?? v));
  const lo = Math.min(...rows.map((r) => cv(r.q!.p10)));
  const hi = Math.max(...rows.map((r) => cv(r.q!.p90)));
  const W = 360;
  const rowH = 22;
  const x = scaleLinear().domain(lo === hi ? [lo - 1, hi + 1] : [lo, hi]).nice().range([8, W - 8]);
  const unit = meta.unit === "usd_ac" ? "$/ac" : conv(0, meta.unit, units)[1];
  const better = meta.dir === 1 ? t("dot.higher_better") : t("dot.lower_better");
  return (
    <figure className="dotplot">
      <figcaption>
        <strong>{meta.glossary ? <Term id={meta.glossary}>{t(meta.label)}</Term> : t(meta.label)}</strong>
        <span className="fs-meta">
          {" "}
          {unit ? `(${unit}) · ` : ""}
          {better}
        </span>
      </figcaption>
      <svg viewBox={`0 0 ${W} ${rows.length * rowH + 18}`} className="svg-fluid" role="img" aria-label={t("dot.aria", { name: t(meta.label) })}>
        {rows.map(({ c, q }, i) => {
          const y = i * rowH + 11;
          return (
            <g key={c.id}>
              <line x1={x(cv(q!.p10))} x2={x(cv(q!.p90))} y1={y} y2={y} stroke={c.best_for_you ? "var(--field)" : "var(--ink-3)"} strokeWidth={3} strokeLinecap="round" opacity={0.5} />
              <circle cx={x(cv(q!.p50))} cy={y} r={5.5} fill={c.best_for_you ? "var(--field)" : c.is_baseline ? "var(--navy)" : "var(--sky)"} />
            </g>
          );
        })}
        {x.ticks(4).map((tk) => (
          <text key={tk} x={x(tk)} y={rows.length * rowH + 14} textAnchor="middle" className="axis-t">
            {nice(tk, lang)}
          </text>
        ))}
      </svg>
      <ul className="dot-words">
        {rows.map(({ c, q }) => (
          <li key={c.id}>
            <span className="dot-name">{c.is_baseline ? t("options.current") : c.name}:</span>{" "}
            {t(meta.dir === 1 ? "dot.words_hi" : "dot.words_lo", {
              n: Math.round(q!.n * 0.9),
              m: q!.n,
              v: `${meta.unit === "usd_ac" ? "$" : ""}${nice(cv(meta.dir === 1 ? q!.p10 : q!.p90), lang)}${unit && meta.unit !== "usd_ac" ? ` ${unit}` : ""}`,
              mid: `${meta.unit === "usd_ac" ? "$" : ""}${nice(cv(q!.p50), lang)}`,
            })}
          </li>
        ))}
      </ul>
    </figure>
  );
}

export function RulesTrace({ card }: { card: CardData }) {
  const { t } = useTranslation();
  const uniq = <T,>(xs: T[], key: (x: T) => string) => xs.filter((x, i) => xs.findIndex((y) => key(y) === key(x)) === i);
  const flags = uniq(card.flags, (f) => f.flag + f.message);
  const rules = uniq(card.evidence.filter((e) => e.kind === "rule"), (e) => e.text);
  return (
    <div className="rules-trace">
      <h4 className="sblock__h">
        {t("cmp.rules_trace")} <SIButton record={rulesSI(undefined, flags.map((f) => f.flag))} describes={t("cmp.rules_trace")} />
      </h4>
      {flags.length + rules.length === 0 ? <p className="fs-meta">{t("cmp.no_rules")}</p> : null}
      <ol className="trace">
        {flags.map((f) => (
          <li key={f.flag + f.message}>
            <code>{f.flag}</code> {f.message}
            {f.sources?.length ? <span className="fs-meta"> [{f.sources.map((s) => card.sources[s]?.cite?.split(",")[0] ?? s).join("; ")}]</span> : null}
          </li>
        ))}
        {rules
          .filter((r) => !flags.some((f) => f.message === r.text))
          .map((r) => (
            <li key={r.text}>
              <code>rule</code> {r.text}
              {r.sources.length ? <span className="fs-meta"> [{r.sources.map((s) => card.sources[s]?.cite?.split(",")[0] ?? s).join("; ")}]</span> : null}
            </li>
          ))}
      </ol>
    </div>
  );
}

export default function StrategyCompare() {
  const { t, i18n } = useTranslation();
  const field = useApp((s) => s.field);
  const mode = useApp((s) => s.mode);
  const set = useApp((s) => s.set);
  const setView = useApp((s) => s.setView);
  const [showAll, setShowAll] = useState(false);
  const q = useCompare();
  if (!field) return <NeedField />;
  const cmp = q.data;
  const cards = cmp ? (showAll ? [...cmp.all_cards].sort((a, b) => (a.is_baseline ? -1 : b.is_baseline ? 1 : a.rank - b.rank)) : cmp.cards) : [];

  return (
    <div className="page">
      <header className="page__head">
        <div>
          <h1 className="fs-h1">{cmp ? t("cmp.title", { n: cards.length, name: field.name }) : t("nav.compare")}</h1>
          <p className="fs-meta">{t("cmp.sub")}</p>
        </div>
        <div className="fs-cluster" style={{ ["--gap" as string]: "8px" }}>
          {cmp?.supported ? <WhyNotOthers cmp={cmp} /> : null}
          {mode === "expert" && cmp ? (
            <Button variant="secondary" size="sm" aria-pressed={showAll} onClick={() => setShowAll((x) => !x)}>
              {showAll ? t("cmp.show_top") : t("cmp.show_all", { n: cmp.all_cards.length })}
            </Button>
          ) : null}
          <Button variant="secondary" size="sm" onClick={() => setView("studio")}>
            {t("cmp.edit_priorities")}
          </Button>
        </div>
      </header>
      {q.isLoading ? <Skeleton height={300} /> : null}
      {q.error ? <QueryState error={q.error} what={t("nav.compare")} onRetry={() => void q.refetch()} /> : null}
      {cmp && !cmp.supported ? <StatusBanner kind="unsupported">{cmp.reason}</StatusBanner> : null}
      {cmp?.supported ? (
        <>
          <div className="cmp-cols" role="list">
            {cards.map((c) => (
              <article key={c.id} role="listitem" className={cx("cmp-col", c.best_for_you && "is-best")} aria-labelledby={`cc-${c.id}`}>
                {c.best_for_you ? <span className="best-tag best-tag--top">{t("options.best")}</span> : null}
                <p className="fs-overline">{c.is_baseline ? t("options.current") : familyName(c, i18n.language)}</p>
                <h2 id={`cc-${c.id}`} className="cmp-col__title">
                  {c.is_baseline ? c.rotation_label : c.is_custom && c.custom_name ? c.custom_name : c.name}
                </h2>
                {c.is_custom && c.custom_name ? <p className="fs-meta">{c.name}</p> : null}
                <div className="cmp-col__score">
                  <span className="fs-kpi">{c.match}</span>
                  <span className="fs-meta">{t("cmp.fit")}</span>
                  <SIButton record={cardSI(c, cmp, t)} describes={t("options.match_of", { name: c.name })} />
                </div>
                <MiniStrip card={c} />
                <MiniStripKey card={c} />
                <MatchBar value={c.match} label={t("options.match")} />
                <ConfidenceChip confidence={toConfidence(c.confidence, c.information_gaps[0])} />
                <OwnPricesTag card={c} cmp={cmp} />
                <details className="cmp-col__more" open={c.best_for_you}>
                  <summary>{t("cmp.full_card")}</summary>
                  <StrategyDetail card={c} cmp={cmp} />
                  <RulesTrace card={c} />
                </details>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    set({ selectedCard: c.id, expandedCard: c.id });
                    setView("studio");
                  }}
                >
                  {t("cmp.open_in_studio")}
                </Button>
              </article>
            ))}
          </div>
          <section className="card-sec" aria-labelledby="dp-h">
            <div className="h-row">
              <h2 id="dp-h" className="fs-h2">
                {t("cmp.dots_title", { n: cmp.weather_years?.n ?? "" })}
              </h2>
              {cards[0] ? <SIButton record={cardSI(cards.find((c) => c.best_for_you) ?? cards[0], cmp, t)} describes={t("cmp.dots_title", { n: "" })} /> : null}
            </div>
            <p className="fs-meta">
              {t("cmp.dots_help")} <Term id="p10_p50_p90">P10 / P50 / P90</Term>
            </p>
            <div className="legend-row">
              <Chip tone="field">● {t("options.best")}</Chip>
              <Chip tone="nasa">● {t("options.current")}</Chip>
              <Chip>● {t("cmp.others")}</Chip>
            </div>
            <div className="dot-grid">
              {INDICATORS.map((m) => (
                <DotPlot key={m.key} cards={cards} meta={m} />
              ))}
            </div>
          </section>
          <NoCostsNote cmp={cmp} />
          {cmp.custom_note ? <StatusBanner kind="partial">{cmp.custom_note}</StatusBanner> : null}
          <RankNotes cmp={cmp} />
          {cmp.assumptions?.length ? (
            <details className="card-sec">
              <summary className="fs-title">{t("cmp.assumptions")}</summary>
              <ul className="bul">
                {cmp.assumptions.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
            </details>
          ) : null}
          <div className="sticky-foot">
            <span>{t("cmp.current_stays")}</span>
            <Reminder text={cmp.reminder} />
          </div>
        </>
      ) : null}
    </div>
  );
}

export type { CompareResult };
