/* Season Wheel (Simple-mode view): one year per ring, crops as arcs, bare weeks hatched, risk icons on the rim. */
import { useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { arc as d3arc } from "d3";
import { Button, SegmentedToggle, SIButton, Skeleton, StatusBanner, MatchBar, ConfidenceChip, Popover, IconLoader } from "../design";
import type { CardData, CompareResult, SeqStep } from "../api";
import { useCompareQ, useReportQ } from "../api";
import { useApp, useCompareBody } from "../store";
import { Ev, NeedField, QueryState, Reminder } from "../components/common";
import { cardSI, cropColor, cx, fmtU, monthShort, nice, toConfidence, weekMonth } from "../lib";
import { useCompare } from "./Options";
import SeasonTimeline from "./SeasonTimeline";

const TAU = Math.PI * 2;
const wA = (w: number) => (w / 52) * TAU;

function Ring({ card, year, r0, r1, faded }: { card: CardData; year: number; r0: number; r1: number; faded?: boolean }) {
  const tl = card.timeline;
  if (!tl) return null;
  const cover = tl.weekly_cover[year] ?? [];
  const arc = d3arc().cornerRadius(0);
  const arcR = d3arc().cornerRadius(3);
  const off = year * 52;
  return (
    <g opacity={faded ? 0.6 : 1}>
      <path d={arc({ innerRadius: r0, outerRadius: r1, startAngle: 0, endAngle: TAU }) ?? ""} fill="var(--track)" />
      {cover.map((v, w) =>
        v < 0.3 ? <path key={w} d={arc({ innerRadius: r0, outerRadius: r1, startAngle: wA(w), endAngle: wA(w + 1) }) ?? ""} fill="url(#wheel-hatch)" /> : null,
      )}
      {tl.bars
        .filter((b) => b.end_week > off && b.start_week < off + 52)
        .map((b, i) => {
          const s = Math.max(0, b.start_week - off);
          const e = Math.min(52, b.end_week - off);
          const cov = b.kind === "cover";
          return (
            <path
              key={i}
              d={arcR({ innerRadius: cov ? r0 : r0 + 3, outerRadius: cov ? r0 + (r1 - r0) * 0.45 : r1 - 3, startAngle: wA(s), endAngle: wA(e) }) ?? ""}
              fill={cropColor(b.crop_id)}
              stroke="#fff"
              strokeWidth={1}
            />
          );
        })}
    </g>
  );
}

/* ---------------- bare gaps → cover crop test ---------------- */

interface Gap {
  key: string;
  year: number;
  start: number;
  end: number;
  /** Rotation step whose cover slot this gap belongs to (cover follows that step's harvest). */
  step: number;
}

/** Contiguous bare runs (cover < 30%) in one ring year. A gap that starts in spring follows last year's harvest. */
function bareGaps(card: CardData | undefined, year: number): Gap[] {
  const cover = card?.timeline?.weekly_cover[year] ?? [];
  const L = card?.sequence.length || 1;
  const out: Gap[] = [];
  let s = -1;
  cover.forEach((v, w) => {
    const bare = v < 0.3;
    if (bare && s < 0) s = w;
    if ((!bare || w === cover.length - 1) && s >= 0) {
      const e = bare ? w + 1 : w;
      if (e - s >= 2) out.push({ key: `${year}-${s}`, year, start: s, end: e, step: (((s < 26 ? year - 1 : year) % L) + L) % L });
      s = -1;
    }
  });
  return out;
}

function CoverTest({
  base,
  cmp,
  test,
  onApply,
  onClear,
}: {
  base: CardData;
  cmp: CompareResult;
  test: { seq: SeqStep[]; cover: string; after: string; step: number };
  onApply: () => void;
  onClear: () => void;
}) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const units = useApp((s) => s.units);
  const field = useApp((s) => s.field);
  const body = useCompareBody();
  const q = useCompareQ(field?.id ?? null, { ...body, baseline: test.seq });
  const res = q.data && !q.isPlaceholderData ? q.data : undefined;
  const nb = res?.all_cards.find((c) => c.is_baseline);
  const coverName = cmp.what_fits?.feasible.find((f) => f.crop_id === test.cover)?.name ?? test.cover;
  const rows: { label: string; old: number | null | undefined; now: number | null | undefined; unit: "days" | "t_ha" | "weeks"; dir: 1 | -1 }[] = nb
    ? [
        { label: t("ind.soil_cover"), old: base.indicators.soil_cover?.p50, now: nb.indicators.soil_cover?.p50, unit: "days", dir: 1 },
        { label: t("ind.erosion_water"), old: base.indicators.erosion_water?.p50, now: nb.indicators.erosion_water?.p50, unit: "t_ha", dir: -1 },
        { label: t("wheel.bare_windy"), old: base.timeline?.bare_windy_overlap_weeks, now: nb.timeline?.bare_windy_overlap_weeks, unit: "weeks", dir: -1 },
        { label: t("wheel.bare_total"), old: base.timeline?.bare_weeks, now: nb.timeline?.bare_weeks, unit: "weeks", dir: -1 },
      ]
    : [];
  return (
    <section className="cover-test" aria-labelledby="cover-test-h" aria-busy={q.isFetching}>
      <div className="h-row">
        <h2 id="cover-test-h" className="h3">
          {t("wheel.test_title", { cover: coverName, after: test.after })}
        </h2>
        {nb ? <SIButton record={cardSI(nb, res, t)} describes={t("wheel.test_title", { cover: coverName, after: test.after })} /> : null}
      </div>
      {q.isFetching ? (
        <p className="scen-busy" role="status">
          <IconLoader size={16} className="fs-spin" /> {t("scen.resim", { n: cmp.weather_years?.n ?? "" })}
        </p>
      ) : null}
      {q.error ? <QueryState error={q.error} what={t("wheel.test_what")} onRetry={() => void q.refetch()} /> : null}
      {res && !res.supported ? <StatusBanner kind="unsupported">{res.reason}</StatusBanner> : null}
      {nb ? (
        <>
          <table className="fs-table cover-test__table">
            <thead>
              <tr>
                <th scope="col">{t("wheel.metric")}</th>
                <th scope="col">{t("wheel.now")}</th>
                <th scope="col">{t("wheel.with_cover")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const better = typeof r.old === "number" && typeof r.now === "number" && (r.now - r.old) * r.dir > 1e-9;
                const worse = typeof r.old === "number" && typeof r.now === "number" && (r.now - r.old) * r.dir < -1e-9;
                const f = (v: number | null | undefined) => (r.unit === "weeks" ? `${nice(v, lang)} ${t("wheel.wk")}` : fmtU(v, r.unit, units, lang));
                return (
                  <tr key={r.label}>
                    <th scope="row">{r.label}</th>
                    <td>{f(r.old)}</td>
                    <td className={cx(better && "is-better", worse && "is-worse")}>
                      {f(r.now)} {better ? <span className="fs-visually-hidden">({t("wheel.better")})</span> : null}
                      {worse ? <span className="fs-visually-hidden">({t("wheel.worse")})</span> : null}
                      <span aria-hidden="true">{better ? " ▲" : worse ? " ▼" : ""}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="fs-meta">{t("wheel.test_note", { n: res?.weather_years?.n ?? "" })}</p>
        </>
      ) : null}
      <div className="fs-cluster" style={{ ["--gap" as string]: "8px" }}>
        {nb ? <Button size="sm" onClick={onApply}>{t("wheel.apply")}</Button> : null}
        <Button size="sm" variant="ghost" onClick={onClear}>
          {t("wheel.clear")}
        </Button>
      </div>
    </section>
  );
}

export default function SeasonWheel() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const field = useApp((s) => s.field);
  const selected = useApp((s) => s.selectedCard);
  const set = useApp((s) => s.set);
  const report = useReportQ(field?.id ?? null);
  const q = useCompare();
  const [year, setYear] = useState(0);
  const [as, setAs] = useState<"wheel" | "timeline">("wheel");
  const [pick, setPick] = useState<Gap | null>(null);
  const [test, setTest] = useState<{ seq: SeqStep[]; cover: string; after: string; step: number } | null>(null);
  const gapAnchor = useRef<HTMLElement | null>(null);
  const cmp = q.data;
  const cards = cmp?.cards ?? [];
  const base = cmp?.all_cards.find((k) => k.is_baseline) ?? cards.find((k) => k.is_baseline);
  const gaps = useMemo(() => bareGaps(base, year), [base, year]);
  const covers = useMemo(() => (cmp?.what_fits?.feasible ?? []).filter((f) => (f.roles ?? []).includes("cover") || f.season === "cover"), [cmp]);
  if (!field) return <NeedField />;
  const cropName = (id: string | null | undefined) =>
    id ? (cmp?.what_fits?.feasible.find((f) => f.crop_id === id)?.name ?? base?.timeline?.bars.find((b) => b.crop_id === id)?.name ?? id) : "";
  const openGap = (g: Gap, el: Element | null) => {
    gapAnchor.current = el as HTMLElement | null;
    setPick(g);
  };
  const gapKey = (e: KeyboardEvent, g: Gap) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openGap(g, e.currentTarget);
    }
  };
  const chooseCover = (cover: string) => {
    if (!pick || !base) return;
    const seq = base.sequence.map((st, i) => (i === pick.step ? { ...st, cover } : st));
    setTest({ seq, cover, after: cropName(base.sequence[pick.step]?.cash), step: pick.step });
    setPick(null);
  };
  const gapLabel = (g: Gap) =>
    t("wheel.gap_label", { from: weekMonth(g.start, lang), to: weekMonth(g.end - 1, lang), n: g.end - g.start, after: cropName(base?.sequence[g.step]?.cash) });
  const plan = cards.find((c) => c.id === selected && !c.is_baseline) ?? cards.find((c) => c.best_for_you) ?? cards.find((c) => !c.is_baseline);
  const hz = report.data?.hazards_weekly;
  const S = 520;
  const c = S / 2;
  const R1 = 200;
  const R0 = 148;
  const B1 = 136;
  const B0 = 100;
  const windy = cmp?.risk_weeks?.windy ?? [];
  const heavy = cmp?.risk_weeks?.heavy_rain ?? [];
  const frost = (hz?.weeks ?? []).filter((w) => w.p_frost >= 0.5).map((w) => w.week);
  const heat = (hz?.weeks ?? []).filter((w) => w.p_heat >= 0.1).map((w) => w.week);
  const icon = (w: number, r: number, color: string, k: string, sym: string) => {
    const a = wA(w + 0.5) - Math.PI / 2;
    return (
      <text key={k} x={c + r * Math.cos(a)} y={c + r * Math.sin(a) + 4} textAnchor="middle" fontSize={11} fill={color} aria-hidden="true">
        {sym}
      </text>
    );
  };
  const bareThisYear = plan?.timeline ? (plan.timeline.weekly_cover[year] ?? []).filter((v) => v < 0.3).length : null;

  return (
    <div className="page">
      <header className="page__head">
        <div>
          <h1 className="fs-h1">{t("wheel.title", { name: field.name })}</h1>
          <p className="fs-meta">{t("wheel.sub")}</p>
        </div>
        <div className="fs-cluster" style={{ ["--gap" as string]: "8px" }}>
          <SegmentedToggle label={t("wheel.year")} value={String(year)} onChange={(v) => setYear(Number(v))} options={[{ value: "0", label: t("wheel.y1") }, { value: "1", label: t("wheel.y2") }]} />
          <SegmentedToggle label={t("wheel.view")} value={as} onChange={setAs} options={[{ value: "wheel", label: t("wheel.wheel") }, { value: "timeline", label: t("wheel.timeline") }]} />
        </div>
      </header>
      {q.isLoading ? <Skeleton height={400} /> : null}
      {q.error ? <QueryState error={q.error} what={t("nav.wheel")} /> : null}
      {cmp && !cmp.supported ? <StatusBanner kind="unsupported">{cmp.reason}</StatusBanner> : null}
      {cmp?.supported && as === "timeline" ? <SeasonTimeline /> : null}
      {cmp?.supported && as === "wheel" && plan ? (
        <div className="wheel-grid">
          <figure className="wheel-fig">
            <svg viewBox={`0 0 ${S} ${S}`} className="svg-fluid wheel-svg" role={covers.length && gaps.length ? "group" : "img"} aria-label={t("wheel.aria", { plan: plan.name })}>
              <defs>
                <pattern id="wheel-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                  <rect width="6" height="6" fill="var(--alert-tint)" />
                  <line x1="0" y1="0" x2="0" y2="6" stroke="var(--alert)" strokeWidth="2" />
                </pattern>
              </defs>
              <g transform={`translate(${c},${c})`}>
                <Ring card={plan} year={year} r0={R0} r1={R1} />
                {base ? <Ring card={base} year={year} r0={B0} r1={B1} faded /> : null}
                {covers.length
                  ? gaps.map((g) => {
                      const a = (wA(g.start) + wA(g.end)) / 2 - Math.PI / 2;
                      const rm = (B0 + B1) / 2;
                      return (
                        <g
                          key={g.key}
                          role="button"
                          tabIndex={0}
                          className={cx("wheel-gap", pick?.key === g.key && "is-on")}
                          aria-label={`${gapLabel(g)}. ${t("wheel.add_cover")}`}
                          aria-haspopup="dialog"
                          onClick={(e) => openGap(g, e.currentTarget)}
                          onKeyDown={(e) => gapKey(e, g)}
                        >
                          <path d={d3arc()({ innerRadius: B0 - 4, outerRadius: B1 + 4, startAngle: wA(g.start), endAngle: wA(g.end) }) ?? ""} className="wheel-gap__hit" />
                          <circle cx={rm * Math.cos(a)} cy={rm * Math.sin(a)} r={10} className="wheel-gap__plus" />
                          <text x={rm * Math.cos(a)} y={rm * Math.sin(a) + 4.5} textAnchor="middle" className="wheel-gap__plus-t" aria-hidden="true">
                            +
                          </text>
                        </g>
                      );
                    })
                  : null}
              </g>
              {Array.from({ length: 12 }, (_, m) => {
                const a = (m / 12) * TAU - Math.PI / 2 + TAU / 24;
                return (
                  <text key={m} x={c + (R1 + 46) * Math.cos(a)} y={c + (R1 + 46) * Math.sin(a) + 4} textAnchor="middle" className="axis-t">
                    {monthShort(m + 1, lang)}
                  </text>
                );
              })}
              {windy.map((w) => icon(w, R1 + 12, "var(--alert)", `w${w}`, "≋"))}
              {heavy.map((w) => icon(w, R1 + 26, "var(--sky)", `h${w}`, "☂"))}
              {frost.map((w) => icon(w, R0 - 8 - (R0 - B1) / 2 + 2, "var(--navy)", `f${w}`, "❄"))}
              {heat.map((w) => icon(w, R1 + 26, "var(--wheat)", `t${w}`, "☀"))}
              <text x={c} y={c - 10} textAnchor="middle" className="wheel-kpi">
                {nice(bareThisYear, lang)}
              </text>
              <text x={c} y={c + 12} textAnchor="middle" className="axis-t strong">
                {t("wheel.bare_weeks")}
              </text>
              <text x={c} y={c + 28} textAnchor="middle" className="axis-t">
                {t("wheel.this_plan")}
              </text>
            </svg>
            <figcaption className="legend-row">
              <span>
                <span style={{ color: "var(--alert)" }}>≋</span> {t("tl.windy")}
              </span>
              <span>
                <span style={{ color: "var(--sky)" }}>☂</span> {t("tl.heavy")}
              </span>
              <span>
                <span style={{ color: "var(--navy)" }}>❄</span> {t("wheel.frost")}
              </span>
              <span>
                <span style={{ color: "var(--wheat)" }}>☀</span> {t("wheel.heat")}
              </span>
              <Ev id={hz?.evidence_id} describes={t("wheel.risk_icons")} />
              <span className="leg__sw fs-hatch-bare" /> {t("tl.bare_label")}
              <span>{t("wheel.rings")}</span>
            </figcaption>
          </figure>
          <aside className="wheel-alts" aria-label={t("wheel.alts")}>
            <section className="wheel-gaps" aria-labelledby="wheel-gaps-h" data-tour="wheel-gaps">
              <h2 id="wheel-gaps-h" className="fs-overline">
                {t("wheel.gaps_h", { y: year + 1 })}
              </h2>
              {!covers.length ? (
                <p className="fs-meta">{t("wheel.no_covers")}</p>
              ) : gaps.length ? (
                <>
                  <p className="fs-meta">{t("wheel.gaps_help")}</p>
                  <ul className="wheel-gaps__list">
                    {gaps.map((g) => (
                      <li key={g.key}>
                        <button type="button" className="wheel-gaps__btn" aria-haspopup="dialog" onClick={(e) => openGap(g, e.currentTarget)}>
                          <span className="leg__sw fs-hatch-bare" aria-hidden="true" />
                          <span>{gapLabel(g)}</span>
                          <span className="wheel-gaps__add">{t("wheel.add_cover")}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <p className="fs-meta">{t("wheel.no_gaps")}</p>
              )}
            </section>
            <Popover open={!!pick} onClose={() => setPick(null)} anchorRef={gapAnchor} title={t("wheel.pick_title")} width={320} placement="right">
              {pick ? (
                <div className="fs-stack" style={{ ["--gap" as string]: "8px" }}>
                  <p className="fs-meta">{gapLabel(pick)}</p>
                  <p className="fs-meta">{t("wheel.pick_help", { after: cropName(base?.sequence[pick.step]?.cash), step: pick.step + 1, n: base?.sequence.length ?? 1 })}</p>
                  <ul className="cover-pick">
                    {covers.map((cv) => (
                      <li key={cv.crop_id}>
                        <button type="button" className="cover-pick__btn" onClick={() => chooseCover(cv.crop_id)}>
                          <span className="leg__sw" style={{ background: cropColor(cv.crop_id) }} aria-hidden="true" />
                          <span>{lang === "es" && cv.name_es ? cv.name_es : cv.name}</span>
                          {base?.sequence[pick.step]?.cover === cv.crop_id ? <span className="fs-meta">{t("wheel.already")}</span> : null}
                        </button>
                      </li>
                    ))}
                  </ul>
                  <p className="fs-meta">{t("wheel.pick_source")}</p>
                </div>
              ) : null}
            </Popover>
            {test && base && cmp ? (
              <CoverTest
                base={base}
                cmp={cmp}
                test={test}
                onClear={() => setTest(null)}
                onApply={() => {
                  set({ baseline: test.seq, historyConfirmed: true, compareRequested: true });
                  setTest(null);
                }}
              />
            ) : null}
            <h2 className="fs-overline">{t("wheel.alts")}</h2>
            {cards.map((k) => (
              <button key={k.id} type="button" className={cx("walt", k.id === plan.id && "is-on", k.best_for_you && "is-best")} onClick={() => set({ selectedCard: k.id })} aria-pressed={k.id === plan.id}>
                <span className="walt__name">{k.is_baseline ? `${t("options.current")}: ${k.rotation_label}` : k.name}</span>
                <MatchBar value={k.match} label={t("options.match")} />
                <span className="fs-meta">{t("options.bare_weeks", { n: nice(k.timeline?.bare_weeks, lang) })}</span>
              </button>
            ))}
            <div className="fs-cluster" style={{ ["--gap" as string]: "8px" }}>
              <ConfidenceChip confidence={toConfidence(plan.confidence)} />
              <SIButton record={cardSI(plan, cmp, t)} describes={plan.name} />
            </div>
            <Button variant="secondary" onClick={() => window.print()}>
              {t("wheel.print")}
            </Button>
          </aside>
        </div>
      ) : null}
      <Reminder text={cmp?.reminder} />
    </div>
  );
}
