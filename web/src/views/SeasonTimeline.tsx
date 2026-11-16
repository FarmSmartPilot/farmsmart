/* SEASON TIMELINE: two aligned rotation years per option. Crop bars, bare soil hatched, windy / heavy-rain week columns,
   and an end-of-strip overlap summary computed from timeline.bare_windy_overlap_weeks. Table alternative included. */
import { HlsTimelineNote } from "../components/NasaBlocks";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { scaleLinear } from "d3";
import { Button, Skeleton, SIButton, Hint, StatusBanner } from "../design";
import type { CardData, CompareResult } from "../api";
import { useReportQ } from "../api";
import { useApp } from "../store";
import { Ev, QueryState } from "../components/common";
import { cardSI, cropColor, cropInk, cx, nice, weekMonth } from "../lib";
import type { TFn } from "../lib";
import { useCompare } from "./Options";

const WEEKS = 104;

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(800);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const cs = getComputedStyle(el);
      setW(el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight));
    };
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

/** Overlap summary: baseline → best alternative, numbers from the API only. */
export function overlapSummary(cmp: CompareResult, t: TFn, lang: string): string | null {
  const base = cmp.cards.find((c) => c.is_baseline);
  const alts = cmp.cards.filter((c) => !c.is_baseline && c.timeline);
  if (!base?.timeline || !alts.length) return null;
  const best = [...alts].sort((a, b) => a.timeline!.bare_windy_overlap_weeks - b.timeline!.bare_windy_overlap_weeks)[0];
  return t("tl.summary", {
    a: nice(base.timeline.bare_windy_overlap_weeks, lang),
    b: nice(best.timeline!.bare_windy_overlap_weeks, lang),
    name: best.name,
  });
}

function Lanes({ cards, cmp, width, oneYear }: { cards: CardData[]; cmp: CompareResult; width: number; oneYear?: boolean }) {
  const { t, i18n } = useTranslation();
  const selected = useApp((s) => s.selectedCard);
  const set = useApp((s) => s.set);
  const lang = i18n.language;
  const weeks = oneYear ? 52 : WEEKS;
  const labelW = width < 500 ? 72 : 120;
  const plotW = Math.max(200, width - labelW - 8);
  const laneH = width < 500 ? 26 : 28;
  const gap = 6;
  const top = 30;
  const x = scaleLinear().domain([0, weeks]).range([labelW, labelW + plotW]);
  const H = top + cards.length * (laneH + gap) + 4;
  const windy = cmp.risk_weeks?.windy ?? [];
  const heavy = cmp.risk_weeks?.heavy_rain ?? [];
  const years = oneYear ? [0] : [0, 1];
  const months = Array.from({ length: (oneYear ? 12 : 24) }, (_, i) => i);
  return (
    <svg width={width} height={H} role="img" aria-label={t("tl.aria")} className="tl-svg">
      <defs>
        <pattern id="tl-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="6" height="6" fill="var(--alert-tint)" />
          <line x1="0" y1="0" x2="0" y2="6" stroke="var(--alert)" strokeWidth="2" />
        </pattern>
      </defs>
      {/* hazard strip */}
      {years.map((y) =>
        windy.map((w) => <rect key={`w${y}-${w}`} x={x(y * 52 + w)} y={2} width={Math.max(1, x(1) - x(0))} height={5} fill="var(--alert)" />),
      )}
      {years.map((y) =>
        heavy.map((w) => <rect key={`h${y}-${w}`} x={x(y * 52 + w)} y={8} width={Math.max(1, x(1) - x(0))} height={5} fill="var(--sky)" />),
      )}
      {/* month axis */}
      {months.map((m) => {
        const wk = (m * 52) / 12;
        return (
          <g key={m}>
            <line x1={x(wk)} x2={x(wk)} y1={top - 6} y2={H} stroke="var(--line)" strokeWidth={m % 12 === 0 ? 1.5 : 0.5} />
            <text x={m === 12 ? x(wk) + 3 : x(wk + 2.2)} y={top - 8} className={m === 12 ? "axis-t strong" : "axis-t"} textAnchor={m === 12 ? "start" : "middle"}>
              {m === 12 && width >= 700 ? t("tl.year2") : weekMonth(wk + 2, lang).slice(0, width < 700 ? 1 : 3)}
            </text>
          </g>
        );
      })}

      {/* hazard columns through lanes */}
      {years.map((y) =>
        windy.map((w) => <rect key={`wc${y}-${w}`} x={x(y * 52 + w)} y={top} width={Math.max(1, x(1) - x(0))} height={H - top} fill="var(--alert)" opacity={0.09} />),
      )}
      {years.map((y) =>
        heavy.map((w) => <rect key={`hc${y}-${w}`} x={x(y * 52 + w)} y={top} width={Math.max(1, x(1) - x(0))} height={H - top} fill="var(--sky)" opacity={0.09} />),
      )}
      {cards.map((c, i) => {
        const y0 = top + i * (laneH + gap);
        const tl = c.timeline;
        const cover = [...(tl?.weekly_cover?.[0] ?? []), ...(tl?.weekly_cover?.[1] ?? [])].slice(0, weeks);
        const sel = selected === c.id;
        return (
          <g key={c.id} className={cx("tl-lane", sel && "is-sel")} onClick={() => set({ selectedCard: c.id })}>
            <rect x={0} y={y0 - 2} width={labelW + plotW} height={laneH + 4} fill={sel ? "var(--field-tint)" : "transparent"} rx={4} />
            <text x={4} y={y0 + laneH / 2 + 4} className="tl-label">
              {(c.is_baseline ? t("options.current") : c.name).slice(0, width < 500 ? 10 : 18)}
              {(c.is_baseline ? t("options.current") : c.name).length > (width < 500 ? 10 : 18) ? "…" : ""}
            </text>
            <rect x={x(0)} y={y0} width={plotW} height={laneH} fill="var(--track)" rx={4} />
            {cover.map((v, w) => (v < 0.3 ? <rect key={w} x={x(w)} y={y0} width={x(1) - x(0) + 0.3} height={laneH} fill="url(#tl-hatch)" /> : null))}
            {(tl?.bars ?? [])
              .filter((b) => b.start_week < weeks)
              .map((b, j) => {
                const xa = x(Math.max(0, b.start_week));
                const xb = x(Math.min(weeks, b.end_week));
                const isCover = b.kind === "cover";
                const h = isCover ? laneH * 0.45 : laneH - 6;
                const yy = isCover ? y0 + laneH - h - 2 : y0 + 3;
                return (
                  <g key={j}>
                    <rect x={xa} y={yy} width={Math.max(1, xb - xa)} height={h} rx={3} fill={cropColor(b.crop_id)} stroke={isCover ? "#fff" : "none"} />
                    {xb - xa > 46 ? (
                      <text x={xa + 4} y={yy + h / 2 + 4} className="tl-bar-t" fill={cropInk(b.crop_id)}>
                        {b.name.slice(0, Math.floor((xb - xa) / 7))}
                      </text>
                    ) : null}
                  </g>
                );
              })}
          </g>
        );
      })}
    </svg>
  );
}

export function TimelineTable({ cards, cmp }: { cards: CardData[]; cmp: CompareResult }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const wk = (w: number) => `${t("tl.week")} ${Math.round(w % 52) + 1}${w >= 52 ? ` (${t("tl.year2")})` : ""} · ${weekMonth(w, lang)}`;
  return (
    <div className="table-scroll">
      <table className="fs-table">
        <caption className="cap-left fs-meta">{t("tl.table_caption")}</caption>
        <thead>
          <tr>
            <th scope="col">{t("tl.option")}</th>
            <th scope="col">{t("tl.crops")}</th>
            <th scope="col">{t("tl.bare")}</th>
            <th scope="col">{t("tl.bare_windy")}</th>
            <th scope="col">{t("tl.bare_rain")}</th>
          </tr>
        </thead>
        <tbody>
          {cards.map((c) => (
            <tr key={c.id}>
              <th scope="row">{c.is_baseline ? `${t("options.current")}: ${c.rotation_label}` : c.name}</th>
              <td>
                {(c.timeline?.bars ?? []).map((b, i) => (
                  <div key={i}>
                    {b.name}: {wk(b.start_week)} → {wk(b.end_week)}
                  </div>
                ))}
              </td>
              <td>{nice(c.timeline?.bare_weeks, lang)}</td>
              <td>{nice(c.timeline?.bare_windy_overlap_weeks, lang)}</td>
              <td>{nice(c.timeline?.bare_heavy_rain_overlap_weeks, lang)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="fs-meta">
        {t("tl.windy_weeks")}: {(cmp.risk_weeks?.windy ?? []).map((w) => w + 1).join(", ") || "—"} · {t("tl.heavy_weeks")}: {(cmp.risk_weeks?.heavy_rain ?? []).map((w) => w + 1).join(", ") || "—"}
      </p>
    </div>
  );
}

export default function SeasonTimeline({ oneYear }: { oneYear?: boolean }) {
  const { t, i18n } = useTranslation();
  const field = useApp((s) => s.field);
  const requested = useApp((s) => s.compareRequested);
  const asTable = useApp((s) => s.timelineAsTable);
  const mode = useApp((s) => s.mode);
  const set = useApp((s) => s.set);
  const setView = useApp((s) => s.setView);
  const report = useReportQ(field?.id ?? null);
  const q = useCompare();
  const [ref, width] = useWidth<HTMLDivElement>();
  const cmp = q.data;
  const cards = cmp?.cards ?? [];
  const hzEv = report.data?.hazards_weekly?.evidence_id ?? report.data?.climate?.evidence_id;
  const summary = cmp ? overlapSummary(cmp, t as unknown as TFn, i18n.language) : null;
  const top = cards.find((c) => c.best_for_you) ?? cards[0];

  return (
    <section className="panel timeline" aria-labelledby="tl-h" data-tour="timeline">
      <header className="panel__head tl-head">
        <div className="h-row">
          <h2 id="tl-h" className="fs-overline">
            {oneYear ? t("tl.title_1y") : t("tl.title")}
          </h2>
          {top && cmp ? <SIButton record={cardSI(top, cmp, t)} describes={t("tl.title")} /> : null}
        </div>
        <div className="tl-legend">
          <span className="leg">
            <span className="leg__sw" style={{ background: "var(--alert)" }} /> {t("tl.windy")}
            <Ev id={hzEv} describes={t("tl.windy")} />
          </span>
          <span className="leg">
            <span className="leg__sw" style={{ background: "var(--sky)" }} /> {t("tl.heavy")}
            <Ev id={hzEv} describes={t("tl.heavy")} />
          </span>
          <span className="leg">
            <span className="leg__sw fs-hatch-bare" /> {t("tl.bare_label")}
          </span>
          {cmp?.risk_weeks?.definition ? <Hint label={t("tl.definition")}>{cmp.risk_weeks.definition}</Hint> : null}
          <Button variant="ghost" size="sm" aria-pressed={asTable} onClick={() => set({ timelineAsTable: !asTable })}>
            {asTable ? t("common.show_chart") : t("common.show_table")}
          </Button>
          {mode === "simple" && !oneYear ? (
            <Button variant="ghost" size="sm" onClick={() => setView("wheel")}>
              {t("tl.wheel")}
            </Button>
          ) : null}
        </div>
      </header>
      <div className="tl-body" ref={ref} tabIndex={0} role="region" aria-label={t("tl.aria")}>
        {!requested ? (
          <p className="fs-meta">{t("tl.empty")}</p>
        ) : q.isLoading ? (
          <Skeleton height={120} />
        ) : q.error ? (
          <QueryState error={q.error} what={t("tl.title")} />
        ) : cmp && !cmp.supported ? (
          <StatusBanner kind="unsupported">{cmp.reason}</StatusBanner>
        ) : cmp ? (
          asTable ? (
            <TimelineTable cards={cards} cmp={cmp} />
          ) : (
            <Lanes cards={cards} cmp={cmp} width={width} oneYear={oneYear} />
          )
        ) : null}
      </div>
      {summary && requested ? (
        <p className="tl-summary" data-tour="overlap">
          <strong>{summary}</strong>
        </p>
      ) : null}
      <HlsTimelineNote />
    </section>
  );
}
