/* Next Move (Expert): detected history → usual next vs smart next, Pareto scatter with P10–P90 ellipses,
   scenario switch, dry-year regret meter and a stress-test dot-plot. */
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { scaleLinear } from "d3";
import { Button, SIButton, Skeleton, StatusBanner, ConfidenceChip, Chip } from "../design";
import type { CardData } from "../api";
import { useNextMoveQ, useReportQ } from "../api";
import { useApp } from "../store";
import { Ev, NeedField, QueryState, Reminder, Term } from "../components/common";
import { INDICATORS, cardSI, conv, cropColor, cropInk, cx, isNum, nice, toConfidence } from "../lib";
import { useCompare } from "./Options";
import { DotPlot } from "./StrategyCompare";
import ScenarioPanel from "../components/ScenarioPanel";


function ParetoScatter({ cards, xKey, yKey }: { cards: CardData[]; xKey: string; yKey: string }) {
  const { t, i18n } = useTranslation();
  const units = useApp((s) => s.units);
  const lang = i18n.language;
  const [table, setTable] = useState(false);
  const xm = INDICATORS.find((m) => m.key === xKey)!;
  const ym = INDICATORS.find((m) => m.key === yKey)!;
  const cv = (v: number, m: typeof xm) => (m.unit === "usd_ac" ? v : (conv(v, m.unit, units)[0] ?? v));
  const pts = cards
    .map((c) => ({ c, x: c.indicators[xKey], y: c.indicators[yKey] }))
    .filter((p) => p.x && p.y && isNum(p.x.p50) && isNum(p.y.p50));
  // Pareto on the two chosen axes (oriented so higher is better).
  const front = new Set(
    pts
      .filter((a) => !pts.some((b) => b !== a && xm.dir * b.x!.p50 >= xm.dir * a.x!.p50 && ym.dir * b.y!.p50 >= ym.dir * a.y!.p50 && (xm.dir * b.x!.p50 > xm.dir * a.x!.p50 || ym.dir * b.y!.p50 > ym.dir * a.y!.p50)))
      .map((p) => p.c.id),
  );
  const W = 440;
  const H = 300;
  const pad = 40;
  const xs = pts.flatMap((p) => [cv(p.x!.p10, xm), cv(p.x!.p90, xm)]);
  const ys = pts.flatMap((p) => [cv(p.y!.p10, ym), cv(p.y!.p90, ym)]);
  if (!pts.length) return <p className="fs-meta">{t("nm.no_points")}</p>;
  const x = scaleLinear().domain([Math.min(...xs), Math.max(...xs)]).nice().range([pad, W - 12]);
  const y = scaleLinear().domain([Math.min(...ys), Math.max(...ys)]).nice().range([H - pad, 12]);
  const frontPts = pts.filter((p) => front.has(p.c.id)).sort((a, b) => cv(a.x!.p50, xm) - cv(b.x!.p50, xm));
  const ux = xm.unit === "usd_ac" ? "$/ac" : conv(0, xm.unit, units)[1];
  const uy = ym.unit === "usd_ac" ? "$/ac" : conv(0, ym.unit, units)[1];
  return (
    <div>
      <div className="h-row">
        <p className="fs-meta">{t("nm.pareto_help")}</p>
        <Button variant="ghost" size="sm" aria-pressed={table} onClick={() => setTable((v) => !v)}>
          {table ? t("common.show_chart") : t("common.show_table")}
        </Button>
      </div>
      {table ? (
        <table className="fs-table">
          <thead>
            <tr>
              <th scope="col">{t("tl.option")}</th>
              <th scope="col">{t(xm.label)} P10–P50–P90</th>
              <th scope="col">{t(ym.label)} P10–P50–P90</th>
              <th scope="col">{t("nm.on_front")}</th>
            </tr>
          </thead>
          <tbody>
            {pts.map((p) => (
              <tr key={p.c.id}>
                <th scope="row">{p.c.is_baseline ? t("options.current") : p.c.name}</th>
                <td>{[p.x!.p10, p.x!.p50, p.x!.p90].map((v) => nice(cv(v, xm), lang)).join(" – ")}</td>
                <td>{[p.y!.p10, p.y!.p50, p.y!.p90].map((v) => nice(cv(v, ym), lang)).join(" – ")}</td>
                <td>{front.has(p.c.id) ? t("common.yes") : t("common.no")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <svg viewBox={`0 0 ${W} ${H}`} className="svg-fluid" role="img" aria-label={t("nm.pareto_aria", { x: t(xm.label), y: t(ym.label) })}>
          {x.ticks(5).map((tk) => (
            <g key={`x${tk}`}>
              <line x1={x(tk)} x2={x(tk)} y1={12} y2={H - pad} stroke="var(--line)" />
              <text x={x(tk)} y={H - pad + 14} textAnchor="middle" className="axis-t">
                {nice(tk, lang)}
              </text>
            </g>
          ))}
          {y.ticks(5).map((tk) => (
            <g key={`y${tk}`}>
              <line x1={pad} x2={W - 12} y1={y(tk)} y2={y(tk)} stroke="var(--line)" />
              <text x={pad - 4} y={y(tk) + 4} textAnchor="end" className="axis-t">
                {nice(tk, lang)}
              </text>
            </g>
          ))}
          <text x={(W + pad) / 2} y={H - 6} textAnchor="middle" className="axis-t strong">
            {t(xm.label)} {ux ? `(${ux})` : ""} {xm.dir === 1 ? "→" : "←"} {t("nm.better")}
          </text>
          <text x={12} y={H / 2} textAnchor="middle" className="axis-t strong" transform={`rotate(-90 12 ${H / 2})`}>
            {t(ym.label)} {uy ? `(${uy})` : ""} {ym.dir === 1 ? "↑" : "↓"} {t("nm.better")}
          </text>
          {pts.map((p) => {
            const cx_ = x(cv(p.x!.p50, xm));
            const cy_ = y(cv(p.y!.p50, ym));
            const rx = Math.max(3, Math.abs(x(cv(p.x!.p90, xm)) - x(cv(p.x!.p10, xm))) / 2);
            const ry = Math.max(3, Math.abs(y(cv(p.y!.p90, ym)) - y(cv(p.y!.p10, ym))) / 2);
            const ex = (x(cv(p.x!.p90, xm)) + x(cv(p.x!.p10, xm))) / 2;
            const ey = (y(cv(p.y!.p90, ym)) + y(cv(p.y!.p10, ym))) / 2;
            return <ellipse key={`e${p.c.id}`} cx={ex || cx_} cy={ey || cy_} rx={rx} ry={ry} fill={front.has(p.c.id) ? "var(--field)" : "var(--ink-3)"} opacity={0.12} />;
          })}
          {frontPts.length > 1 ? (
            <path d={frontPts.map((p, i) => `${i ? "L" : "M"}${x(cv(p.x!.p50, xm))},${y(cv(p.y!.p50, ym))}`).join(" ")} fill="none" stroke="var(--navy)" strokeDasharray="5 4" strokeWidth={1.5} />
          ) : null}
          {pts.map((p, i) => {
            const cx_ = x(cv(p.x!.p50, xm));
            const cy_ = y(cv(p.y!.p50, ym));
            const letter = p.c.is_baseline ? "C" : String.fromCharCode(65 + i);
            return (
              <g key={p.c.id}>
                <circle cx={cx_} cy={cy_} r={11} fill={front.has(p.c.id) ? (p.c.best_for_you ? "var(--field)" : "var(--navy)") : "#fff"} stroke={front.has(p.c.id) ? "none" : "var(--ink-3)"} strokeWidth={1.5} />
                <text x={cx_} y={cy_ + 4} textAnchor="middle" className="pt-t" fill={front.has(p.c.id) ? "#fff" : "var(--ink)"}>
                  {letter}
                </text>
              </g>
            );
          })}
        </svg>
      )}
      <ul className="pt-legend">
        {pts.map((p, i) => (
          <li key={p.c.id}>
            <span className={cx("pt-dot", front.has(p.c.id) && "is-front")}>{p.c.is_baseline ? "C" : String.fromCharCode(65 + i)}</span>
            {p.c.is_baseline ? `${t("options.current")}: ${p.c.rotation_label}` : p.c.name}
            {front.has(p.c.id) ? <span className="fs-meta"> · {t("nm.on_front")}</span> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function NextMove() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const field = useApp((s) => s.field);
  const edits = useApp((s) => s.historyEdits);
  const report = useReportQ(field?.id ?? null);
  const nm = useNextMoveQ(field?.id ?? null);
  const q = useCompare();
  const [xKey, setX] = useState("profit_p50");
  const [yKey, setY] = useState("soc_trend");
  const cmp = q.data;
  // No costs and prices outside the US: start the trade-off chart on water use instead of an empty profit axis.
  const hasProfit = !!cmp?.all_cards.some((c) => isNum(c.indicators.profit_p50?.p50));
  if (cmp && !hasProfit && (xKey === "profit_p50" || yKey === "profit_p50")) {
    if (xKey === "profit_p50") setX("water_use");
    if (yKey === "profit_p50") setY("erosion_water");
  }
  const hist = useMemo(() => (report.data?.history ?? []).map((h) => ({ ...h, crop_id: edits[h.year] ?? h.crop_id })), [report.data, edits]);

  /** "Usual next" from this field's own history: what followed the latest crop most often. */
  const usual = useMemo(() => {
    if (hist.length < 3) return null;
    const last = hist[hist.length - 1].crop_id;
    const counts: Record<string, number> = {};
    let total = 0;
    for (let i = 0; i < hist.length - 1; i++) {
      if (hist[i].crop_id === last && hist[i + 1].crop_id) {
        counts[hist[i + 1].crop_id!] = (counts[hist[i + 1].crop_id!] ?? 0) + 1;
        total++;
      }
    }
    const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    if (!best) return null;
    const name = hist.find((h) => h.crop_id === best[0])?.name ?? best[0];
    return { crop: best[0], name, n: best[1], total, after: hist[hist.length - 1].name ?? last };
  }, [hist]);

  if (!field) return <NeedField />;
  const top = cmp?.cards.find((c) => c.best_for_you) ?? cmp?.all_cards.find((c) => c.rank === 1);
  const all = cmp?.all_cards ?? [];
  const regret = [...all].filter((c) => c.indicators.dry_year_regret && isNum(c.indicators.dry_year_regret.p50)).sort((a, b) => a.indicators.dry_year_regret!.p50 - b.indicators.dry_year_regret!.p50);
  const rmax = Math.max(...regret.map((c) => c.indicators.dry_year_regret!.p90), 1);
  const lastYear = hist[hist.length - 1]?.year;
  const histEv = report.data?.crop_history?.evidence_id;

  return (
    <div className="page" data-tour="next-move">
      <header className="page__head">
        <div>
          <h1 className="fs-h1">{t("nm.title", { name: field.name })}</h1>
          <p className="fs-meta">{t("nm.sub")}</p>
        </div>
      </header>
      {/* history strip */}
      <section className="card-sec" aria-labelledby="nm-hist">
        <div className="h-row">
          <h2 id="nm-hist" className="fs-overline">
            {t("nm.detected", { a: hist[0]?.year ?? "", b: lastYear ?? "" })}
          </h2>
          <Ev id={histEv} describes={t("nm.detected", { a: "", b: "" })} />
        </div>
        <div className="nm-hist">
          {hist.slice(-10).map((h) => (
            <span key={h.year} className="nm-chip" style={{ background: h.crop_id ? cropColor(h.crop_id) : undefined, color: cropInk(h.crop_id) }}>
              <strong>{h.name ?? "?"}</strong>
              <span>{h.year}</span>
            </span>
          ))}
          <span className="nm-next">→ {lastYear ? lastYear + 1 : ""} ?</span>
        </div>
      </section>

      <div className="nm-grid">
        <section className="card-sec" aria-labelledby="nm-branch">
          <h2 id="nm-branch" className="fs-h2">
            {t("nm.branch")}
          </h2>
          <div className="branch">
            <div className="branch__root">
              <strong>{t("nm.what_next", { y: lastYear ? lastYear + 1 : "" })}</strong>
              <span className="fs-meta">{usual ? t("nm.after", { crop: usual.after }) : ""}</span>
            </div>
            <div className="branch__opts">
              <div className="branch__opt">
                <span className="fs-overline">{t("nm.usual")}</span>
                {nm.data?.usual_next?.next?.length ? (
                  <>
                    <ul className="usual-list">
                      {nm.data.usual_next.next.slice(0, 3).map((n) => (
                        <li key={n.crop_id}>
                          <span className="branch__title">{n.name ?? n.crop_id}</span>
                          <span className="bars__track" aria-hidden="true">
                            <span className="bars__fill" style={{ width: `${Math.round(n.probability * 100)}%`, background: "var(--ink-3)" }} />
                          </span>
                          <span className="bars__val">{Math.round(n.probability * 100)}%</span>
                        </li>
                      ))}
                    </ul>
                    <p className="fs-meta">{t("nm.usual_model")}</p>
                    <SIButton
                      record={{
                        model_name: nm.data.usual_next.model ?? t("nm.usual_model_name"),
                        kind: "si",
                        version: nm.data.usual_next.model_id,
                        top_drivers: [{ name: t("nm.driver_last") }, { name: t("nm.driver_area") }],
                        confidence: toConfidence(
                          nm.data.usual_next.confidence ?? {
                            level: "medium",
                            reasons: Object.entries(nm.data.usual_next.validation ?? {})
                              .filter(([, v]) => typeof v === "number" || typeof v === "string")
                              .slice(0, 4)
                              .map(([k, v]) => `${k}: ${typeof v === "number" ? nice(v, lang) : v}`),
                          },
                        ),
                        model_card_url: "#/sources",
                      }}
                      describes={t("nm.usual")}
                    />
                  </>
                ) : usual ? (
                  <>
                    <p className="branch__title">{usual.name}</p>
                    <p className="fs-meta">{t("nm.usual_why", { n: usual.n, total: usual.total, after: usual.after })}</p>
                    <Ev id={histEv} describes={t("nm.usual")} />
                  </>
                ) : (
                  <StatusBanner kind="no-observation">{t("nm.usual_none")}</StatusBanner>
                )}
              </div>
              <div className="branch__opt is-smart">
                <span className="fs-overline">{t("nm.smart")}</span>
                {q.isLoading ? <Skeleton height={60} /> : null}
                {top && cmp ? (
                  <>
                    <p className="branch__title">
                      {top.sequence[0]?.cash ? (cmp.what_fits?.feasible.find((f) => f.crop_id === top.sequence[0].cash)?.name ?? top.sequence[0].cash) : ""}
                      {top.sequence[0]?.double ? ` ${t("myfield.then")} ${cmp.what_fits?.feasible.find((f) => f.crop_id === top.sequence[0].double)?.name ?? top.sequence[0].double}` : ""}
                      {top.sequence[0]?.cover ? ` +${cmp.what_fits?.feasible.find((f) => f.crop_id === top.sequence[0].cover)?.name ?? top.sequence[0].cover}` : ""}
                    </p>
                    <p className="fs-meta">{t("nm.smart_why", { name: top.name, match: top.match })}</p>
                    <div className="fs-cluster" style={{ ["--gap" as string]: "8px" }}>
                      <ConfidenceChip confidence={toConfidence(top.confidence)} />
                      <SIButton record={cardSI(top, cmp, t)} describes={t("nm.smart")} />
                    </div>
                  </>
                ) : null}
              </div>
            </div>
          </div>
        </section>

        <section className="card-sec" aria-labelledby="nm-pareto">
          <div className="h-row">
            <h2 id="nm-pareto" className="fs-h2">
              <Term id="pareto_set">{t("nm.tradeoffs")}</Term>
            </h2>
            {top && cmp ? <SIButton record={cardSI(top, cmp, t)} describes={t("nm.tradeoffs")} /> : null}
          </div>
          <div className="fs-cluster axis-pick" style={{ ["--gap" as string]: "8px" }}>
            <label>
              {t("nm.x_axis")}{" "}
              <select value={xKey} onChange={(e) => setX(e.target.value)}>
                {INDICATORS.map((m) => (
                  <option key={m.key} value={m.key}>
                    {t(m.label)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t("nm.y_axis")}{" "}
              <select value={yKey} onChange={(e) => setY(e.target.value)}>
                {INDICATORS.map((m) => (
                  <option key={m.key} value={m.key}>
                    {t(m.label)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {q.error ? <QueryState error={q.error} what={t("nm.tradeoffs")} /> : cmp ? <ParetoScatter cards={all} xKey={xKey} yKey={yKey} /> : <Skeleton height={260} />}
        </section>
      </div>

      <ScenarioPanel />

      <div className="nm-grid">
        <section className="card-sec" aria-labelledby="nm-regret">
          <div className="h-row">
            <h2 id="nm-regret" className="fs-h2">
              {t("nm.regret")}
            </h2>
            {top && cmp ? <SIButton record={cardSI(top, cmp, t)} describes={t("nm.regret")} /> : null}
          </div>
          <p className="fs-meta">{t("nm.regret_help")}</p>
          {regret.length ? (
            <ul className="bars regret">
              {regret.map((c) => {
                const r = c.indicators.dry_year_regret!;
                return (
                  <li key={c.id} className="bars__row">
                    <span className="bars__label">{c.is_baseline ? t("options.current") : c.name}</span>
                    <span className="bars__track" role="meter" aria-valuemin={0} aria-valuemax={rmax} aria-valuenow={r.p50} aria-label={t("nm.regret_of", { name: c.name })}>
                      <span className="bars__fill" style={{ width: `${(r.p50 / rmax) * 100}%`, background: "var(--alert)" }} />
                      <span className="bars__whisk" style={{ left: `${(r.p10 / rmax) * 100}%`, width: `${((r.p90 - r.p10) / rmax) * 100}%` }} />
                    </span>
                    <span className="bars__val">
                      {nice(r.p50, lang)} {t("nm.pts")} <span className="fs-meta">({t("nm.dry_n", { n: r.n })})</span>
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <StatusBanner kind="no-observation">{t("nm.no_regret")}</StatusBanner>
          )}
        </section>
        <section className="card-sec" aria-labelledby="nm-stress">
          <div className="h-row">
            <h2 id="nm-stress" className="fs-h2">
              {t("nm.stress", { n: cmp?.weather_years?.n ?? "" })}
            </h2>
            {top && cmp ? <SIButton record={cardSI(top, cmp, t)} describes={t("nm.stress", { n: "" })} /> : null}
          </div>
          {cmp ? (
            <>
              <DotPlot cards={cmp.cards} meta={INDICATORS.find((m) => m.key === "yield_index")!} />
              {hasProfit ? <DotPlot cards={cmp.cards} meta={INDICATORS.find((m) => m.key === "profit_p50")!} /> : <p className="fs-meta">{t("options.no_costs")}</p>}
            </>
          ) : (
            <Skeleton height={160} />
          )}
          <div className="legend-row">
            <Chip tone="field">● {t("options.best")}</Chip>
            <Chip tone="nasa">● {t("options.current")}</Chip>
          </div>
        </section>
      </div>
      <Reminder text={cmp?.reminder} />
    </div>
  );
}
