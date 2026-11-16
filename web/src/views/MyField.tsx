/* MY FIELD: confirmed facts as editable rows, crop-history confirmation, farm constraints and MY PRIORITIES. */
import { useId, useMemo, useRef, useState } from "react";
import type { DragEvent, KeyboardEvent, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button, DataButton, Popover, usePopover, IconCheck, IconChevronRight, SIButton, Skeleton } from "../design";
import type { Evidence } from "../design";
import { countyYields, useCompareQ, useCropsQ, useReportQ } from "../api";
import type { CompareResult, CropBudget, FitCrop, HistoryYear, Report, SeqStep } from "../api";
import { useApp, useCompareBody, cleanBudgets, cleanSoilTest, EQUIPMENT_IDS, PRIORITY_PRESETS, RANK_WEIGHTS } from "../store";
import type { Farm, FieldBudgets, PriorityId, ReviewTicks } from "../store";
import { recordsAverage } from "../money";
import { Ev, Term } from "../components/common";
import OfflineBar, { SaveOffline } from "../components/OfflineBar";
import PeersPanel from "../components/PeersPanel";
import DiseasePanel from "../components/DiseasePanel";
import { cropColor, cropInk, fmtU, isNum, nice, rulesSI, cx } from "../lib";

const CSB_EVIDENCE: Evidence = {
  source: "USDA NASS",
  product: "Crop Sequence Boundaries (CSB)",
  native_res: "field polygons",
  licence: "Public domain (USDA)",
  citation: "USDA NASS Crop Sequence Boundaries 2017–2024.",
  url: "https://www.nass.usda.gov/Research_and_Science/Crop-Sequence-Boundaries/",
  is_nasa: false,
};

/** Fields of The World boundary (outside the US): gray "other source" button with its attribution. */
function ftwEvidence(meta: Record<string, unknown>): Evidence {
  const c0 = meta.ftw_confidence_mean ?? meta.confidence_mean;
  const conf = typeof c0 === "number" ? c0 : null;
  return {
    source: "Fields of The World",
    product: "FTW global field boundaries 2025",
    native_res: "field polygons",
    licence: typeof meta.licence === "string" ? meta.licence : "CC BY 4.0",
    citation: typeof meta.attribution === "string" ? meta.attribution : "Fields of The World (FTW) global 2025, CC BY 4.0",
    url: "https://source.coop/ftw",
    qa_flags: conf !== null ? [`Boundary model confidence (polygon mean): ${Math.round(conf * 100)}%`] : undefined,
    is_nasa: false,
  };
}

function FactRow({ label, children, dot, tour }: { label: string; children: ReactNode; dot?: ReactNode; tour?: string }) {
  return (
    <div className="fact" data-tour={tour}>
      <span className="fact__check" aria-hidden="true">
        <IconCheck size={12} />
      </span>
      <div className="fact__body">
        <div className="fact__label">
          {label}
          {dot}
        </div>
        <div className="fact__value">{children}</div>
      </div>
    </div>
  );
}

/* ---------------- "I've checked this" ---------------- */

/** A gentle self-check tick per field (stored in the browser). Unticked never blocks anything. */
function ReviewTick({ part, what }: { part: keyof ReviewTicks; what: string }) {
  const { t } = useTranslation();
  const fid = useApp((s) => s.field?.id ?? null);
  const on = useApp((s) => (fid ? !!s.reviewed[fid]?.[part] : false));
  const setReviewed = useApp((s) => s.setReviewed);
  const noteId = useId();
  if (!fid) return null;
  return (
    <div className="review-tick">
      <label className="check">
        <input type="checkbox" checked={on} aria-describedby={on ? undefined : noteId} onChange={(e) => setReviewed(fid, part, e.target.checked)} />
        <span>
          {t("review.checked")}
          <span className="fs-visually-hidden"> ({what})</span>
        </span>
      </label>
      {on ? null : (
        <span id={noteId} className="review-tick__note">
          {t("review.not_yet")}
        </span>
      )}
    </div>
  );
}

/* ---------------- crop history ---------------- */

function YearTile({ h, edited, onEdit, options }: { h: HistoryYear; edited?: string; onEdit: (crop: string) => void; options: { id: string; name: string }[] }) {
  const { t } = useTranslation();
  const p = usePopover();
  const crop = edited ?? h.crop_id;
  const name = edited ? (options.find((o) => o.id === edited)?.name ?? edited) : (h.name ?? t("myfield.unknown"));
  return (
    <>
      <button
        ref={p.anchorRef}
        type="button"
        className={cx("ytile", edited && "is-edited", !crop && "fs-hatch-bare")}
        style={{ background: crop ? cropColor(crop) : undefined, color: cropInk(crop) }}
        // Visible text first (WCAG 2.5.3 label-in-name), then the full description.
        aria-label={`${name.slice(0, 4)} ’${String(h.year).slice(2)}. ${t("myfield.year_tile", { year: h.year, crop: name, share: isNum(h.share) ? Math.round(h.share * 100) : "—" })}`}
        aria-haspopup="dialog"
        aria-expanded={p.open}
        onClick={p.toggle}
      >
        <span className="ytile__crop">{name.slice(0, 4)}</span>
        <span className="ytile__yr">’{String(h.year).slice(2)}</span>
      </button>
      <Popover open={p.open} onClose={p.close} anchorRef={p.anchorRef} title={t("myfield.edit_year", { year: h.year })} width={260}>
        <p className="fs-meta">
          {t("myfield.detected", { crop: h.name ?? t("myfield.unknown"), share: isNum(h.share) ? Math.round(h.share * 100) : "—", src: h.source })}
        </p>
        <div className="fs-stack" style={{ ["--gap" as string]: "4px" }}>
          {options.map((o) => (
            <button
              key={o.id}
              type="button"
              className={cx("pick", crop === o.id && "is-on")}
              onClick={() => {
                onEdit(o.id);
                p.close();
              }}
            >
              <span className="swatch" style={{ background: cropColor(o.id) }} aria-hidden="true" />
              {o.name}
            </button>
          ))}
        </div>
      </Popover>
    </>
  );
}

function RotationEditor({ initial, onApply, onCancel }: { initial: SeqStep[]; onApply: (s: SeqStep[]) => void; onCancel: () => void }) {
  const { t, i18n } = useTranslation();
  const crops = useCropsQ();
  const [steps, setSteps] = useState<SeqStep[]>(initial.length ? initial : [{ cash: null, cover: null }, { cash: null, cover: null }]);
  const all = Object.values(crops.data ?? {});
  const cash = all.filter((c) => !(c.roles ?? []).every((r) => r === "cover") && c.season !== "cover");
  const covers = all.filter((c) => (c.roles ?? []).includes("cover") || c.season === "cover");
  const nm = (c: { name: string; name_es?: string }) => (i18n.language === "es" && c.name_es ? c.name_es : c.name);
  return (
    <div className="roted" role="group" aria-label={t("myfield.rot_editor")}>
      {steps.map((s, i) => (
        <div key={i} className="roted__row">
          <span className="roted__n">{t("myfield.year_n", { n: i + 1 })}</span>
          <label className="fs-visually-hidden" htmlFor={`cash-${i}`}>
            {t("myfield.cash_crop")}
          </label>
          <select id={`cash-${i}`} value={s.cash ?? ""} onChange={(e) => setSteps(steps.map((x, j) => (j === i ? { ...x, cash: e.target.value || null } : x)))}>
            <option value="">{t("myfield.choose")}</option>
            {cash.map((c) => (
              <option key={c.id} value={c.id}>
                {nm(c)}
              </option>
            ))}
          </select>
          <label className="fs-visually-hidden" htmlFor={`double-${i}`}>
            {t("myfield.double_crop")}
          </label>
          <select id={`double-${i}`} value={s.double ?? ""} onChange={(e) => setSteps(steps.map((x, j) => (j === i ? { ...x, double: e.target.value || null } : x)))}>
            <option value="">{t("myfield.no_double")}</option>
            {cash.map((c) => (
              <option key={c.id} value={c.id}>
                {t("myfield.then")} {nm(c)}
              </option>
            ))}
          </select>
          <label className="fs-visually-hidden" htmlFor={`cover-${i}`}>
            {t("myfield.cover_crop")}
          </label>
          <select id={`cover-${i}`} value={s.cover ?? ""} onChange={(e) => setSteps(steps.map((x, j) => (j === i ? { ...x, cover: e.target.value || null } : x)))}>
            <option value="">{t("myfield.no_cover")}</option>
            {covers.map((c) => (
              <option key={c.id} value={c.id}>
                {nm(c)}
              </option>
            ))}
          </select>
        </div>
      ))}
      <div className="fs-cluster" style={{ ["--gap" as string]: "8px" }}>
        {steps.length < 5 ? (
          <Button variant="ghost" size="sm" onClick={() => setSteps([...steps, { cash: null, cover: null }])}>
            {t("myfield.add_year")}
          </Button>
        ) : null}
        {steps.length > 1 ? (
          <Button variant="ghost" size="sm" onClick={() => setSteps(steps.slice(0, -1))}>
            {t("myfield.remove_year")}
          </Button>
        ) : null}
      </div>
      <div className="fs-cluster" style={{ ["--gap" as string]: "8px" }}>
        <Button size="sm" disabled={steps.some((s) => !s.cash)} onClick={() => onApply(steps)}>
          {t("myfield.use_rotation")}
        </Button>
        <Button variant="secondary" size="sm" onClick={onCancel}>
          {t("common.cancel")}
        </Button>
      </div>
    </div>
  );
}

function CropHistory({ report }: { report: Report }) {
  const { t, i18n } = useTranslation();
  const field = useApp((s) => s.field);
  const body = useCompareBody();
  const cmp = useCompareQ(field?.id ?? null, body);
  const edits = useApp((s) => s.historyEdits);
  const confirmed = useApp((s) => s.historyConfirmed);
  const baseline = useApp((s) => s.baseline);
  const mode = useApp((s) => s.mode);
  const set = useApp((s) => s.set);
  const setReviewed = useApp((s) => s.setReviewed);
  const tickHistory = () => field && setReviewed(field.id, "history", true);
  const crops = useCropsQ();
  const [editing, setEditing] = useState(false);
  const hist = report.history ?? [];
  const shown = hist.slice(mode === "expert" ? -10 : -5);
  const options = useMemo(() => {
    const ids = new Set<string>();
    hist.forEach((h) => h.crop_id && ids.add(h.crop_id));
    (cmp.data?.what_fits?.feasible ?? []).forEach((c) => c.season !== "cover" && ids.add(c.crop_id));
    return [...ids].map((id) => {
      const c = crops.data?.[id];
      return { id, name: c ? (i18n.language === "es" && c.name_es ? c.name_es : c.name) : (hist.find((h) => h.crop_id === id)?.name ?? id) };
    });
  }, [hist, cmp.data, crops.data, i18n.language]);

  const det = cmp.data?.baseline_detection;
  const baseCard = cmp.data?.all_cards?.find((c) => c.is_baseline);
  const cropNm = (id: string | null | undefined) => {
    if (!id) return "?";
    const c = crops.data?.[id];
    return c ? (i18n.language === "es" && c.name_es ? c.name_es : c.name) : id.replace(/_/g, " ");
  };
  // One rotation year: "Rice then Winter wheat + Cereal rye" (double crop = second harvest in the same year).
  const stepLabel = (s: SeqStep) => cropNm(s.cash) + (s.double ? ` ${t("myfield.then")} ${cropNm(s.double)}` : "") + (s.cover ? ` + ${cropNm(s.cover)}` : "");
  const label = baseline ? baseline.map(stepLabel).join(" → ") : (baseCard?.rotation_label ?? det?.label);
  const typical = !baseline && det?.method === "typical_regional";

  /** Suggested editor start: the edited last-N years if the user edited tiles, else the detected sequence. */
  const initial: SeqStep[] = useMemo(() => {
    if (baseline) return baseline;
    if (Object.keys(edits).length) {
      const last = hist.slice(-2).map((h) => ({ cash: edits[h.year] ?? h.crop_id, cover: null }));
      return last;
    }
    return baseCard?.sequence ?? [];
  }, [baseline, edits, hist, baseCard]);

  const detSI = rulesSI(
    det && isNum(det.fit_error)
      ? {
          level: det.fit_error <= 0.15 ? "high" : det.fit_error <= 0.35 ? "medium" : "low",
          reasons: [t("myfield.det_reason", { pct: Math.round((1 - det.fit_error) * 100), n: det.observed?.length ?? 0 })],
        }
      : typical
        ? { level: "low", reasons: [t("myfield.typical_reason"), ...(det?.source ? [det.source] : [])] }
        : undefined,
    det?.frequency ? Object.entries(det.frequency).map(([k, v]) => `${k}: ${Math.round(v * 100)}%`) : det?.source ? [det.source] : [],
    t("myfield.det_model"),
  );

  return (
    <div className="fs-stack" style={{ ["--gap" as string]: "8px" }}>
      {shown.length ? (
        <div className="ytiles" role="list" aria-label={t("myfield.history")}>
          {shown.map((h) => (
            <div role="listitem" key={h.year}>
              <YearTile h={h} edited={edits[h.year]} options={options} onEdit={(c) => set({ historyEdits: { ...edits, [h.year]: c }, historyConfirmed: true })} />
            </div>
          ))}
        </div>
      ) : report.crop_history ? null : (
        <p className="fs-meta">{t("myfield.no_history_map")}</p>
      )}
      {cmp.isLoading ? (
        <Skeleton height={32} />
      ) : label ? (
        <div className={cx("confirm", typical && "typical-rot")}>
          {typical ? <p className="fs-overline">{t("myfield.typical_h")}</p> : null}
          <p className="confirm__q">
            {typical ? <strong>{label}</strong> : confirmed || baseline ? t("myfield.you_grow", { label }) : t("myfield.we_think", { label: lower1(label) })}
            <SIButton record={detSI} describes={t("myfield.history")} />
          </p>
          {typical ? (
            <>
              {det?.note ? <p className="fs-meta">{det.note}</p> : null}
              {det?.source ? <p className="fs-meta">{t("myfield.typical_src", { src: det.source })}</p> : null}
              <p className="fs-meta">
                <strong>{t("myfield.typical_ask")}</strong>
              </p>
            </>
          ) : null}
          {!editing ? (
            <div className="fs-cluster" style={{ ["--gap" as string]: "8px" }}>
              {!confirmed ? (
                <Button
                  size="sm"
                  variant="secondary"
                  icon={<IconCheck size={14} />}
                  onClick={() => {
                    set({ historyConfirmed: true });
                    tickHistory();
                  }}
                >
                  {t("myfield.yes")}
                </Button>
              ) : null}
              <Button size="sm" variant={typical ? "primary" : "ghost"} onClick={() => setEditing(true)}>
                {typical ? t("myfield.enter_mine") : t("myfield.edit")}
              </Button>
              {baseline ? (
                <Button size="sm" variant="ghost" onClick={() => set({ baseline: null })}>
                  {t("myfield.reset_detected")}
                </Button>
              ) : null}
            </div>
          ) : (
            <RotationEditor
              initial={initial}
              onCancel={() => setEditing(false)}
              onApply={(s) => {
                set({ baseline: s, historyConfirmed: true });
                tickHistory();
                setEditing(false);
              }}
            />
          )}
        </div>
      ) : cmp.data ? (
        // No crop map and no typical rotation: ask for the rotation so the comparison can run.
        <div className="confirm typical-rot">
          <p className="confirm__q">{t("myfield.need_rotation")}</p>
          {editing ? (
            <RotationEditor
              initial={[]}
              onCancel={() => setEditing(false)}
              onApply={(s) => {
                set({ baseline: s, historyConfirmed: true, compareRequested: true });
                tickHistory();
                setEditing(false);
              }}
            />
          ) : (
            <Button size="sm" onClick={() => setEditing(true)}>
              {t("myfield.enter_mine")}
            </Button>
          )}
        </div>
      ) : null}
    </div>
  );
}

/* ---------------- priorities ---------------- */

/** Each priority keeps its own colour as it moves, so the weight-mix bar shows the change. */
const PRIO_TONE: Record<PriorityId, string> = {
  soil_cover: "field",
  erosion: "soil",
  water: "sky",
  profit: "wheat",
  soil_health: "purple",
  pests: "alert",
  workload: "navy",
};

export function Priorities({ compact }: { compact?: boolean }) {
  const { t } = useTranslation();
  const priorities = useApp((s) => s.priorities);
  const setPriorities = useApp((s) => s.setPriorities);
  const [drag, setDrag] = useState<number | null>(null);
  const [live, setLive] = useState("");
  const refs = useRef<(HTMLLIElement | null)[]>([]);

  const move = (from: number, to: number) => {
    if (to < 0 || to >= priorities.length || from === to) return;
    const next = [...priorities];
    const [x] = next.splice(from, 1);
    next.splice(to, 0, x);
    setPriorities(next as PriorityId[]);
    setLive(t("prio.moved", { name: t(`prio.${x}`), n: to + 1 }));
    requestAnimationFrame(() => refs.current[to]?.focus());
  };
  const onKey = (e: KeyboardEvent<HTMLLIElement>, i: number) => {
    if (e.key === "ArrowUp" && (e.altKey || e.ctrlKey || e.shiftKey)) {
      e.preventDefault();
      move(i, i - 1);
    } else if (e.key === "ArrowDown" && (e.altKey || e.ctrlKey || e.shiftKey)) {
      e.preventDefault();
      move(i, i + 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      refs.current[i - 1]?.focus();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      refs.current[i + 1]?.focus();
    }
  };
  const active = PRIORITY_PRESETS.find((x) => x.order.join() === priorities.join())?.id ?? null;
  const total = RANK_WEIGHTS.reduce((a, b) => a + b, 0);
  const pct = (i: number) => Math.round((RANK_WEIGHTS[i] ?? 0) * 100);
  return (
    <div className="prio" data-tour="priorities">
      <div className="prio-presets" role="group" aria-label={t("prio.presets")}>
        {PRIORITY_PRESETS.map((x) => (
          <button
            key={x.id}
            type="button"
            className={cx("prio-preset", active === x.id && "is-on")}
            aria-pressed={active === x.id}
            onClick={() => {
              setPriorities([...x.order]);
              setLive(t("prio.preset_set", { name: t(`prio.preset_${x.id}`), first: t(`prio.${x.order[0]}`) }));
            }}
          >
            {t(`prio.preset_${x.id}`)}
          </button>
        ))}
      </div>
      <div
        className="prio-mix"
        role="img"
        aria-label={t("prio.mix_label", { list: priorities.map((p, i) => `${t(`prio.${p}`)} ${pct(i)}%`).join(", ") })}
      >
        {priorities.map((p, i) => (
          <span key={p} className={`prio-mix__seg prio-mix__seg--${PRIO_TONE[p]}`} style={{ flexGrow: (RANK_WEIGHTS[i] ?? 0) / total }} />
        ))}
      </div>
      <p id="prio-help" className="fs-meta">
        {t("prio.help")}
      </p>
      <ol className="prio__list" aria-describedby="prio-help">
        {priorities.map((p, i) => (
          <li
            key={p}
            ref={(el) => {
              refs.current[i] = el;
            }}
            tabIndex={0}
            className={cx("prio__chip", `prio__chip--${PRIO_TONE[p] ?? "navy"}`, drag === i && "is-drag", compact && "is-compact")}
            draggable
            aria-label={t("prio.chip_label", { n: i + 1, name: t(`prio.${p}`), pct: pct(i) })}
            onDragStart={(e: DragEvent) => {
              setDrag(i);
              e.dataTransfer.effectAllowed = "move";
            }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              if (drag !== null) move(drag, i);
              setDrag(null);
            }}
            onDragEnd={() => setDrag(null)}
            onKeyDown={(e) => onKey(e, i)}
          >
            <span className="prio__grip" aria-hidden="true">
              ⋮⋮
            </span>
            <span className="prio__n">{i + 1}</span>
            <span className="prio__name">{t(`prio.${p}`)}</span>
            <span className="prio__pct" aria-hidden="true">
              {pct(i)}%
            </span>
            <span className="prio__btns">
              <button type="button" className="prio__btn" aria-label={t("prio.up", { name: t(`prio.${p}`) })} disabled={i === 0} onClick={() => move(i, i - 1)}>
                ▲
              </button>
              <button
                type="button"
                className="prio__btn"
                aria-label={t("prio.down", { name: t(`prio.${p}`) })}
                disabled={i === priorities.length - 1}
                onClick={() => move(i, i + 1)}
              >
                ▼
              </button>
            </span>
          </li>
        ))}
      </ol>
      <div className="fs-visually-hidden" aria-live="polite">
        {live}
      </div>
    </div>
  );
}

/* ---------------- won't grow · buyers · low N ---------------- */

function FarmCrops({
  farm,
  setFarm,
  fits,
  assumedFrom,
}: {
  farm: Farm;
  setFarm: (p: Partial<Farm>) => void;
  fits: CompareResult["what_fits"];
  assumedFrom?: string | null;
}) {
  const { t, i18n } = useTranslation();
  const es = i18n.language === "es";
  const crops = useMemo(() => {
    const seen = new Map<string, FitCrop>();
    for (const c of [...(fits?.feasible ?? []), ...(fits?.excluded ?? [])]) if (!seen.has(c.crop_id)) seen.set(c.crop_id, c);
    return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [fits]);
  const name = (c: FitCrop) => (es && c.name_es ? c.name_es : c.name);
  const cashCrops = crops.filter((c) => c.season !== "cover" && !((c.roles ?? []).includes("cover") && !(c.roles ?? []).includes("cash")));
  const wont = farm.wont_grow ?? [];
  const markets = farm.markets ?? [];
  const lowN = farm.n_rate_kg_ha === 100;
  const toggle = (xs: string[], id: string, on: boolean) => (on ? [...new Set([...xs, id])] : xs.filter((x) => x !== id));

  if (!crops.length)
    return (
      <FactRow label={t("myfield.wont_grow")}>
        <span className="fs-meta">{t("myfield.crops_after_compare")}</span>
      </FactRow>
    );
  return (
    <>
      <FactRow label={t("myfield.wont_grow")} tour="wont-grow">
        <details className="pick-details" open={wont.length > 0}>
          <summary>{wont.length ? t("myfield.n_selected", { n: wont.length }) : t("myfield.wont_grow_none")}</summary>
          <fieldset className="checks checks--grid">
            <legend className="fs-visually-hidden">{t("myfield.wont_grow")}</legend>
            {crops.map((c) => (
              <label key={c.crop_id} className="check">
                <input type="checkbox" checked={wont.includes(c.crop_id)} onChange={(e) => setFarm({ wont_grow: toggle(wont, c.crop_id, e.target.checked) })} />
                <span>{name(c)}</span>
              </label>
            ))}
          </fieldset>
        </details>
      </FactRow>
      <FactRow label={t("myfield.buyer")}>
        <details className="pick-details" open={!!farm.markets_confirmed}>
          <summary>
            {markets.length ? markets.map((m) => { const c = crops.find((x) => x.crop_id === m); return c ? name(c) : m.replace(/_/g, " "); }).join(", ") : t("myfield.buyer_none")}
          </summary>
          <fieldset className="checks checks--grid">
            <legend className="fs-visually-hidden">{t("myfield.buyer")}</legend>
            {cashCrops.map((c) => (
              <label key={c.crop_id} className="check">
                <input
                  type="checkbox"
                  checked={markets.includes(c.crop_id)}
                  onChange={(e) => setFarm({ markets: toggle(markets, c.crop_id, e.target.checked), markets_confirmed: true })}
                />
                <span>{name(c)}</span>
              </label>
            ))}
          </fieldset>
        </details>
        <p className="fs-meta">{farm.markets_confirmed ? t("myfield.buyer_confirmed") : assumedFrom ? t("myfield.buyer_assumed", { src: assumedFrom }) : null}</p>
      </FactRow>
      <FactRow label={t("myfield.n_rate")}>
        <label className="check">
          <input
            type="checkbox"
            checked={lowN}
            onChange={(e) => setFarm({ n_rate_kg_ha: e.target.checked ? 100 : undefined })}
          />
          <span>{t("myfield.low_n")}</span>
        </label>
        <p className="fs-meta">{t("myfield.low_n_help")}</p>
      </FactRow>
    </>
  );
}

/* ---------------- own prices and costs ---------------- */

type Draft = Record<string, { price: string; cost: string; yld: string }>;
/** Same bounds as the API (fieldshift/engine/analysis.py BUDGET_KEYS): price and yield above 0, cost may be 0. */
const LIMITS = { price: 1e4, cost: 2e4, yld: 1e5 } as const;

const toDraft = (b: FieldBudgets | undefined): Draft =>
  Object.fromEntries(
    Object.entries(b ?? {}).map(([k, v]) => [
      k,
      { price: v.price_usd_bu != null ? String(v.price_usd_bu) : "", cost: v.cost_usd_ac != null ? String(v.cost_usd_ac) : "", yld: v.yield_bu_ac != null ? String(v.yield_bu_ac) : "" },
    ]),
  );

/** "" → undefined; otherwise a finite number in range, else NaN (invalid). */
function parseNum(v: string, max: number, zeroOk: boolean): number | undefined {
  const s = v.trim().replace(",", ".");
  if (!s) return undefined;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 && n <= max && (zeroOk || n > 0) ? n : NaN;
}

/** "bushels per planted acre" → "bu", "bu/ac" → "bu"; null when the unit is not known. */
function shortUnit(u: string | null | undefined): string | null {
  if (!u) return null;
  if (/bushel|^bu\b/i.test(u)) return "bu";
  if (/cwt|hundredweight/i.test(u)) return "cwt";
  if (/pound|^lb/i.test(u)) return "lb";
  if (/ton/i.test(u)) return "ton";
  if (/bale/i.test(u)) return "bale";
  return null;
}

/** "Use my own prices and costs": per feasible crop price, cost ($/ac) and yield, in the crop's own yield unit.
    Sent as `budgets` in the compare body only once applied; blank boxes keep the regional figures. */
function OwnBudgets({ cmp }: { cmp: CompareResult | undefined }) {
  const { t, i18n } = useTranslation();
  const es = i18n.language === "es";
  const fid = useApp((s) => s.field?.id ?? null);
  const saved = useApp((s) => (fid ? s.budgets[fid] : undefined));
  const setBudgets = useApp((s) => s.setBudgets);
  const [draft, setDraft] = useState<Draft>(() => toDraft(saved));
  const [msg, setMsg] = useState("");
  const fits = cmp?.what_fits;
  const crops = useMemo(
    () =>
      (fits?.feasible ?? [])
        .filter((c) => c.season !== "cover" && !((c.roles ?? []).includes("cover") && !(c.roles ?? []).includes("cash")))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [fits],
  );
  /** Yield unit per crop: from the API's budgets_used (after a run with budgets), else the county-yield unit on the cards. */
  const units = useMemo(() => {
    const u: Record<string, string> = {};
    for (const c of cmp?.all_cards ?? []) {
      for (const [cid, y] of Object.entries(countyYields(c))) {
        const s = shortUnit(y?.unit);
        if (s) u[cid] = s;
      }
    }
    for (const [cid, b] of Object.entries(cmp?.economics?.budgets_used ?? {})) {
      const s = shortUnit(b?.unit);
      if (s) u[cid] = s;
    }
    return u;
  }, [cmp]);
  if (!fid || !crops.length) return null;
  const econ = cmp?.economics;
  const nm = (c: FitCrop) => (es && c.name_es ? c.name_es : c.name).split(" (")[0];
  const nmId = (id: string) => {
    const c = crops.find((x) => x.crop_id === id);
    return c ? nm(c) : id.replace(/_/g, " ");
  };
  const nSaved = Object.keys(cleanBudgets(saved) ?? {}).length;
  // No regional cost data for this crop here (outside the US, or a crop USDA ERS does not cover): profit needs all three.
  const needAll = (id: string) => !econ?.available || !econ?.yield_anchor?.[id];
  const parsed = crops.map((c) => {
    const d = draft[c.crop_id] ?? { price: "", cost: "", yld: "" };
    return { c, d, price: parseNum(d.price, LIMITS.price, false), cost: parseNum(d.cost, LIMITS.cost, true), yld: parseNum(d.yld, LIMITS.yld, false) };
  });
  const invalid = parsed.some((x) => [x.price, x.cost, x.yld].some((v) => Number.isNaN(v)));
  const edit = (id: string, k: "price" | "cost" | "yld", v: string) => {
    setMsg("");
    setDraft({ ...draft, [id]: { ...(draft[id] ?? { price: "", cost: "", yld: "" }), [k]: v } });
  };
  const apply = () => {
    if (invalid) return;
    const out: FieldBudgets = {};
    for (const x of parsed) {
      const e: CropBudget = {};
      if (x.price !== undefined) e.price_usd_bu = x.price;
      if (x.cost !== undefined) e.cost_usd_ac = x.cost;
      if (x.yld !== undefined) e.yield_bu_ac = x.yld;
      if (Object.keys(e).length) out[x.c.crop_id] = e;
    }
    const clean = cleanBudgets(out);
    setBudgets(fid, clean);
    const names = parsed.filter((x) => clean?.[x.c.crop_id]).map((x) => nm(x.c));
    setMsg(names.length ? t("budget.applied", { crops: names.join(", ") }) : t("budget.cleared"));
  };
  const clear = () => {
    setDraft({});
    setBudgets(fid, null);
    setMsg(t("budget.cleared"));
  };
  // What the last run said about the numbers sent (present only when budgets were sent).
  const missingOf = (id: string) => {
    const b = saved?.[id] ?? {};
    return [b.price_usd_bu == null && t("budget.w_price"), b.cost_usd_ac == null && t("budget.w_cost"), b.yield_bu_ac == null && t("budget.w_yield")]
      .filter(Boolean)
      .join(", ");
  };
  const incomplete = nSaved ? (econ?.budget_incomplete ?? []) : [];
  const ignored = nSaved ? (econ?.budget_ignored ?? []) : [];
  return (
    <FactRow label={t("budget.title")} tour="own-budgets">
      <details className="pick-details budget-details" open={nSaved > 0}>
        <summary>{nSaved ? t("budget.n_set", { n: nSaved }) : t("budget.summary")}</summary>
        <p className="fs-meta">{t("budget.help")}</p>
        <div className="budget-list">
          {parsed.map(({ c, d, price, cost, yld }) => {
            const u = units[c.crop_id] ?? t("budget.unit");
            const all = needAll(c.crop_id);
            const box = (k: "price" | "cost" | "yld", label: string, val: string, bad: boolean, step: string) => (
              <label className="budget-in">
                <span>{label}</span>
                <input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  max={LIMITS[k]}
                  step={step}
                  value={val}
                  placeholder={t("budget.ph")}
                  aria-invalid={bad || undefined}
                  onChange={(e) => edit(c.crop_id, k, e.target.value)}
                />
              </label>
            );
            return (
              <fieldset key={c.crop_id} className="budget-crop">
                <legend>{nm(c)}</legend>
                <div className="budget-crop__row">
                  {box("price", t("budget.price", { u }), d.price, Number.isNaN(price), "0.01")}
                  {box("cost", t("budget.cost"), d.cost, Number.isNaN(cost), "1")}
                  {box("yld", t(all ? "budget.yield_req" : "budget.yield", { u }), d.yld, Number.isNaN(yld), "1")}
                </div>
                {all ? <span className="fs-meta">{t("budget.need_all")}</span> : null}
                {!units[c.crop_id] ? <span className="fs-meta">{t("budget.same_unit")}</span> : null}
              </fieldset>
            );
          })}
        </div>
        {invalid ? (
          <p className="fs-meta budget-err" role="alert">
            {t("budget.invalid")}
          </p>
        ) : null}
        <div className="fs-cluster" style={{ ["--gap" as string]: "8px" }}>
          <Button size="sm" onClick={apply} disabled={invalid}>
            {t("budget.apply")}
          </Button>
          {nSaved || Object.keys(draft).length ? (
            <Button size="sm" variant="ghost" onClick={clear}>
              {t("budget.clear")}
            </Button>
          ) : null}
        </div>
        <p className="fs-meta" role="status">
          {msg}
        </p>
        {incomplete.length ? (
          <ul className="budget-warn" aria-label={t("budget.incomplete_h")}>
            {incomplete.map((x) => (
              <li key={x.crop_id}>{t("budget.incomplete", { crop: nmId(x.crop_id), missing: missingOf(x.crop_id) || t("budget.w_some") })}</li>
            ))}
          </ul>
        ) : null}
        {ignored.length ? (
          <ul className="budget-warn" aria-label={t("budget.ignored_h")}>
            {ignored.map((x) => (
              <li key={x}>{t("budget.ignored", { what: x })}</li>
            ))}
          </ul>
        ) : null}
      </details>
    </FactRow>
  );
}

/* ---------------- your own records (wave U8) ---------------- */

/** Harvest years offered for yields: the last 10 finished seasons (this year counts from September). */
function recordYears(): number[] {
  const now = new Date();
  const last = now.getMonth() >= 8 ? now.getFullYear() : now.getFullYear() - 1;
  return Array.from({ length: 10 }, (_, i) => last - i);
}

const SOIL_LIMITS = { ph: [3, 10], om: [0, 30] } as const;

interface SoilTestUsed {
  used?: { ph?: number; om_pct?: number; year?: number } | null;
  ignored?: string[] | null;
  label?: string | null;
  label_es?: string | null;
  replaces?: { ph?: number | null; om_pct?: number | null; source?: string | null } | null;
}

/** "Your own records (optional)": yields by year per crop (feed the money calculator's typical yield and, on request,
    the ranking's `budgets.yield_bu_ac`) and the latest soil test (sent as `farm.soil_test` once the farmer uses it). */
function OwnRecords({ report, cmp, onUsed }: { report: Report; cmp: CompareResult | undefined; onUsed: () => void }) {
  const { t, i18n } = useTranslation();
  const es = i18n.language === "es";
  const fid = useApp((s) => s.field?.id ?? null);
  const rec = useApp((s) => (fid ? s.records[fid] : undefined));
  const setRecords = useApp((s) => s.setRecords);
  const histEdits = useApp((s) => s.historyEdits);
  const setBudgets = useApp((s) => s.setBudgets);
  const years = useMemo(recordYears, []);
  const yields = useMemo(() => rec?.yields ?? {}, [rec?.yields]);
  const [draft, setDraft] = useState<Record<number, string>>(() =>
    Object.fromEntries(Object.entries(rec?.yields ?? {}).map(([y, v]) => [Number(y), v?.value != null ? String(v.value) : ""])),
  );
  const st = rec?.soil_test ?? null;
  const [soil, setSoil] = useState({ ph: st?.ph != null ? String(st.ph) : "", om: st?.om_pct != null ? String(st.om_pct) : "", year: st?.year != null ? String(st.year) : "" });
  const [msg, setMsg] = useState("");
  const [soilMsg, setSoilMsg] = useState("");
  // What the last comparison says it used from the soil test (present only when one was sent).
  const used = (cmp as unknown as { soil_test?: SoilTestUsed } | undefined)?.soil_test;

  // Crops to choose from: the cash crops that fit here plus anything in the crop history.
  const crops = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of cmp?.what_fits?.feasible ?? []) {
      if (c.season === "cover" || ((c.roles ?? []).includes("cover") && !(c.roles ?? []).includes("cash"))) continue;
      m.set(c.crop_id, ((es && c.name_es) || c.name).split(" (")[0]);
    }
    for (const h of report.history ?? []) if (h.crop_id && !m.has(h.crop_id) && h.crop_id !== "fallow") m.set(h.crop_id, h.name ?? h.crop_id.replace(/_/g, " "));
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [cmp, report.history, es]);
  const nameOf = (id: string) => crops.find(([c]) => c === id)?.[1] ?? id.replace(/_/g, " ");
  const units = useMemo(() => {
    const u: Record<string, string> = {};
    for (const c of cmp?.all_cards ?? [])
      for (const [cid, y] of Object.entries(countyYields(c))) {
        const s = shortUnit(y?.unit);
        if (s) u[cid] = s;
      }
    return u;
  }, [cmp]);

  if (!fid) return null;
  const histCrop = (y: number) => histEdits[y] ?? report.history?.find((h) => h.year === y)?.crop_id ?? "";
  const cropOf = (y: number) => yields[String(y)]?.crop ?? histCrop(y) ?? "";
  const put = (y: number, p: { crop?: string; value?: number | null }) => {
    const cur = { ...(useApp.getState().records[fid]?.yields ?? {}) };
    const old = cur[String(y)];
    const next = { crop: p.crop !== undefined ? p.crop || null : (old?.crop ?? (histCrop(y) || null)), value: p.value !== undefined ? p.value : (old?.value ?? null) };
    if (!next.crop && next.value == null) delete cur[String(y)];
    else cur[String(y)] = next;
    setRecords(fid, { yields: cur });
    setMsg("");
  };
  const avgs = [...new Set(Object.values(yields).map((v) => v?.crop).filter((c): c is string => !!c))]
    .map((c) => ({ c, a: recordsAverage(yields, c) }))
    .filter((x): x is { c: string; a: NonNullable<ReturnType<typeof recordsAverage>> } => !!x.a);
  const nYields = Object.values(yields).filter((v) => v?.crop && typeof v.value === "number").length;

  const useInRanking = () => {
    const cur: FieldBudgets = { ...(useApp.getState().budgets[fid] ?? {}) };
    for (const { c, a } of avgs) cur[c] = { ...(cur[c] ?? {}), yield_bu_ac: Math.round(a.avg * 10) / 10 };
    setBudgets(fid, cleanBudgets(cur));
    onUsed();
    setMsg(t("records.used", { crops: avgs.map((x) => nameOf(x.c).toLowerCase()).join(", ") }));
  };

  const num = (v: string) => {
    const s = v.trim().replace(",", ".");
    return s ? Number(s) : undefined;
  };
  const ph = num(soil.ph);
  const om = num(soil.om);
  const yr = num(soil.year);
  const badPh = ph !== undefined && !(Number.isFinite(ph) && ph >= SOIL_LIMITS.ph[0] && ph <= SOIL_LIMITS.ph[1]);
  const badOm = om !== undefined && !(Number.isFinite(om) && om >= SOIL_LIMITS.om[0] && om <= SOIL_LIMITS.om[1]);
  const badYr = yr !== undefined && !(Number.isInteger(yr) && yr >= 1980 && yr <= years[0] + 1);
  const soilOk = !badPh && !badOm && !badYr && (ph !== undefined || om !== undefined);
  const applySoil = () => {
    const clean = cleanSoilTest({ ph, om_pct: om, year: yr });
    if (!clean) return;
    setRecords(fid, { soil_test: clean });
    setSoilMsg(t("records.soil_used"));
  };
  const removeSoil = () => {
    setRecords(fid, { soil_test: null });
    setSoil({ ph: "", om: "", year: "" });
    setSoilMsg(t("records.soil_removed"));
  };
  const summary = [nYields ? t("records.n_yields", { count: nYields }) : null, st ? t("records.soil_set", { y: st.year ?? "—" }) : null].filter(Boolean).join(" · ");

  return (
    <FactRow label={t("records.title")} tour="own-records">
      <details className="pick-details records" open={nYields > 0 || !!st}>
        <summary>{summary || t("records.summary")}</summary>
        <p className="fs-meta">{t("records.help")}</p>
        <fieldset className="records__set">
          <legend className="records__h">{t("records.yields_h")}</legend>
          <p className="fs-meta">{t("records.yields_help")}</p>
          <div className="records__rows">
            {years.map((y) => {
              const c = cropOf(y);
              const u = (c && units[c]) || t("budget.unit");
              const d = draft[y] ?? "";
              const v = num(d);
              const bad = v !== undefined && !(Number.isFinite(v) && v > 0 && v <= 1e5);
              return (
                <div key={y} className="records__row">
                  <span className="records__y">{y}</span>
                  <select className="records__crop" aria-label={t("records.crop_aria", { y })} value={c} onChange={(e) => put(y, { crop: e.target.value })}>
                    <option value="">{t("records.crop_pick")}</option>
                    {crops.map(([id, nm]) => (
                      <option key={id} value={id}>
                        {nm}
                      </option>
                    ))}
                  </select>
                  <input
                    className="records__val"
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step="any"
                    value={d}
                    placeholder={t("budget.ph")}
                    aria-label={t("records.yield_aria", { y, u })}
                    aria-invalid={bad || undefined}
                    onChange={(e) => {
                      const s = e.target.value;
                      setDraft({ ...draft, [y]: s });
                      const n = num(s);
                      if (n === undefined) put(y, { value: null, crop: c || undefined });
                      else if (Number.isFinite(n) && n > 0 && n <= 1e5) put(y, { value: n, crop: c || undefined });
                    }}
                  />
                  <span className="records__u" aria-hidden="true">
                    {t("records.per_ac", { u })}
                  </span>
                </div>
              );
            })}
          </div>
          {avgs.length ? (
            <ul className="records__avgs" aria-label={t("records.avgs_h")}>
              {avgs.map(({ c, a }) => (
                <li key={c}>
                  {t("records.avg", {
                    crop: nameOf(c),
                    v: nice(a.avg, i18n.language),
                    u: units[c] ?? t("budget.unit"),
                    count: a.n,
                    span: a.y0 === a.y1 ? String(a.y0) : `${a.y0}–${a.y1}`,
                  })}
                </li>
              ))}
            </ul>
          ) : null}
          <div className="fs-cluster" style={{ ["--gap" as string]: "8px" }}>
            <Button size="sm" onClick={useInRanking} disabled={!avgs.length}>
              {t("records.use")}
            </Button>
          </div>
          <p className="fs-meta">{t("records.money_note")}</p>
          <p className="fs-meta" role="status">
            {msg}
          </p>
        </fieldset>
        <fieldset className="records__set">
          <legend className="records__h">{t("records.soil_h")}</legend>
          <p className="fs-meta">{t("records.soil_help")}</p>
          <div className="budget-crop__row">
            <label className="budget-in">
              <span>{t("records.ph")}</span>
              <input type="number" inputMode="decimal" min={3} max={10} step="0.1" value={soil.ph} aria-invalid={badPh || undefined} onChange={(e) => setSoil({ ...soil, ph: e.target.value })} />
            </label>
            <label className="budget-in">
              <span>{t("records.om")}</span>
              <input type="number" inputMode="decimal" min={0} max={30} step="0.1" value={soil.om} aria-invalid={badOm || undefined} onChange={(e) => setSoil({ ...soil, om: e.target.value })} />
            </label>
            <label className="budget-in">
              <span>{t("records.year")}</span>
              <input type="number" inputMode="numeric" min={1980} max={years[0] + 1} step="1" value={soil.year} aria-invalid={badYr || undefined} onChange={(e) => setSoil({ ...soil, year: e.target.value })} />
            </label>
          </div>
          {badPh || badOm || badYr ? (
            <p className="fs-meta budget-err" role="alert">
              {t("records.soil_invalid")}
            </p>
          ) : null}
          <div className="fs-cluster" style={{ ["--gap" as string]: "8px" }}>
            <Button size="sm" onClick={applySoil} disabled={!soilOk}>
              {t("records.soil_use")}
            </Button>
            {st ? (
              <Button size="sm" variant="ghost" onClick={removeSoil}>
                {t("records.soil_remove")}
              </Button>
            ) : null}
          </div>
          {st && !used?.used ? <p className="fs-meta">{t("records.soil_now", { ph: st.ph ?? "—", om: st.om_pct ?? "—", y: st.year ?? "—" })}</p> : null}
          {st && used?.used ? (
            <p className="fs-meta" data-k="soil-confirm">
              {t("records.soil_confirm", {
                label: (es && used.label_es) || used.label || "",
                ph: used.used.ph ?? "—",
                ph0: typeof used.replaces?.ph === "number" ? nice(used.replaces.ph, i18n.language) : "—",
                om: used.used.om_pct ?? "—",
                om0: typeof used.replaces?.om_pct === "number" ? nice(used.replaces.om_pct, i18n.language) : "—",
                src: used.replaces?.source ?? "—",
              })}
            </p>
          ) : null}
          {st && used?.ignored?.length ? <p className="fs-meta">{t("records.soil_ignored", { what: used.ignored.join(", ") })}</p> : null}
          <p className="fs-meta" role="status">
            {soilMsg}
          </p>
        </fieldset>
      </details>
    </FactRow>
  );
}

/** "Corn, corn, then soybean" mid-sentence → "corn, corn, then soybean". */
const lower1 = (s: string | undefined) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s);

/** Bring the ROTATION OPTIONS column into view and move focus to its heading. */
export function showOptions() {
  requestAnimationFrame(() => {
    const h = document.getElementById("opt-h");
    h?.closest("section")?.scrollIntoView({ block: "start", behavior: "smooth" });
    h?.closest("section")?.querySelector<HTMLElement>(".panel__scroll")?.scrollTo({ top: 0 });
  });
}

/** Bring MY PRIORITIES into view (switching to the My Field tab on phones) and focus the first chip. */
export function showPriorities() {
  const st = useApp.getState();
  if (window.matchMedia("(max-width: 767px)").matches) st.set({ mobileTab: "field" });
  setTimeout(() => {
    const el = document.querySelector<HTMLElement>('[data-tour="priorities"]');
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
    el?.querySelector<HTMLElement>(".prio__chip")?.focus({ preventScroll: true });
  }, 60);
}

/* ---------------- MY FIELD panel ---------------- */

/** `guided`: Simple mode step 2 (priorities live on step 3; the Next button replaces the footer button). */
export default function MyField({ guided }: { guided?: boolean } = {}) {
  const { t, i18n } = useTranslation();
  const field = useApp((s) => s.field);
  const fieldMeta = useApp((s) => s.fieldMeta);
  const units = useApp((s) => s.units);
  const storeFarm = useApp((s) => s.farm);
  const farmTouched = useApp((s) => s.farmTouched);
  const setFarmRaw = useApp((s) => s.setFarm);
  const set = useApp((s) => s.set);
  const report = useReportQ(field?.id ?? null);
  const body = useCompareBody();
  const cmp = useCompareQ(field?.id ?? null, body);
  const used = cmp.data?.farm_used;
  /** Until the user edits, show what the engine assumed (equipment from crop history, markets from county acreage). */
  const farm = farmTouched || !used
    ? storeFarm
    : {
        ...storeFarm,
        equipment: used.equipment ?? storeFarm.equipment,
        livestock: used.livestock ?? storeFarm.livestock,
        hay_buyer: used.hay_buyer ?? storeFarm.hay_buyer,
        irrigation_mm: used.irrigation_mm ?? storeFarm.irrigation_mm,
        water: (used.water === "irrigated" ? "irrigated" : "rainfed") as "rainfed" | "irrigated",
        markets: used.markets ?? storeFarm.markets,
      };
  const setFarm = (p: Partial<typeof farm>) => {
    if (!farmTouched) set({ farm: { ...farm, ...p }, farmTouched: true });
    else setFarmRaw(p);
  };
  const r = report.data;
  const lang = i18n.language;
  // Bumped when "Your own records" writes yields into the farmer's numbers, so that panel re-reads them.
  const [recVer, setRecVer] = useState(0);
  const props = r?.soil?.properties ?? {};
  const texture = (cmp.data?.facts?.texture_class as string | undefined) ?? null;
  const irrigated = farm.water === "irrigated" || farm.irrigation_mm > 0;
  // Boundary source: from the map click, else from the saved report (a field opened from a link has no click meta).
  const bnd: Record<string, unknown> | null = fieldMeta?.source ? fieldMeta : ((r?.boundary as Record<string, unknown> | null | undefined) ?? null);

  return (
    <section className="panel myfield" aria-labelledby="myfield-h" data-tour="my-field">
      <OfflineBar />
      <div className="panel__scroll">
        <p className="fs-overline">{t("myfield.overline")}</p>
        <h2 id="myfield-h" className="myfield__name">
          {field?.name}
        </h2>
        {r ? (
          <p className="fs-meta">
            {[r.place?.county, r.place?.state, r.place?.country].filter(Boolean).join(", ")}
            {r.region?.label ? ` · ${r.region.label}` : ""}
          </p>
        ) : null}
        {guided ? null : (
          <>
            <div className="myfield__prio">
              <p className="fs-overline">{t("prio.overline")}</p>
              <Priorities compact />
            </div>
            <hr className="rule" />
          </>
        )}
        {report.isLoading ? <Skeleton lines={6} /> : null}
        {r ? (
          <div className="facts-list">
            <FactRow
              label={t("myfield.boundary")}
              dot={
                fieldMeta?.csbid ? (
                  <DataButton evidence={CSB_EVIDENCE} describes={t("myfield.boundary")} />
                ) : bnd?.source === "ftw" ? (
                  <DataButton evidence={ftwEvidence(bnd)} describes={t("myfield.boundary")} />
                ) : null
              }
            >
              {fmtU(r.area_ha, "ha", units, lang)}
              {bnd?.source === "ftw" && typeof bnd.attribution === "string" ? <span className="fs-meta attrib">{bnd.attribution}</span> : null}
              {r.mode !== "field" ? <span className="fs-chip fs-chip--wheat">{t("myfield.regional")}</span> : null}
            </FactRow>
            <FactRow label={t("myfield.history")} dot={<Ev id={r.crop_history?.evidence_id} describes={t("myfield.history")} />} tour="crop-history">
              <CropHistory report={r} />
              <ReviewTick part="history" what={t("myfield.history")} />
            </FactRow>
            {field ? <PeersPanel fid={field.id} /> : null}
            {field ? <DiseasePanel fid={field.id} irrigated={irrigated} /> : null}
            <FactRow label={t("myfield.soil")} dot={<Ev id={r.soil?.evidence_id} describes={t("myfield.soil")} />}>
              {r.soil?.available ? (
                <ul className="mini-list">
                  {r.soil.source === "soilgrids" ? <li className="fs-meta">{r.soil.label ?? t("ar.soilgrids_label")}</li> : null}
                  {texture ? <li>{texture}</li> : null}
                  <li>
                    {t("myfield.om")} {nice(props.om_r as number, lang)}%
                  </li>
                  <li>{props.drainagecl || r.soil.drainage_class ? String(props.drainagecl ?? r.soil.drainage_class) : t("ar.drainage_unknown")}</li>
                  <li>
                    <Term id="root_zone">{t("myfield.awc")}</Term> {fmtU(isNum(props.aws100_cm) ? props.aws100_cm * 10 : null, "mm", units, lang)}
                  </li>
                </ul>
              ) : (
                <span className="state-inline">{t("state.no_data")}</span>
              )}
              <ReviewTick part="soil" what={t("myfield.soil")} />
            </FactRow>
            <FactRow label={t("myfield.slope")} dot={<Ev id={r.terrain?.evidence_id} describes={t("myfield.slope")} />}>
              {r.terrain ? t("myfield.slope_val", { mean: nice(r.terrain.slope_mean_pct, lang), p90: nice(r.terrain.slope_p90_pct, lang) }) : t("state.no_data")}
            </FactRow>
            <FactRow label={t("myfield.water")}>
              <div className="seg-mini" role="radiogroup" aria-label={t("myfield.water")}>
                <button type="button" role="radio" aria-checked={!irrigated} onClick={() => setFarm({ irrigation_mm: 0, water: "rainfed" })}>
                  {t("myfield.rainfed")}
                </button>
                <button type="button" role="radio" aria-checked={irrigated} onClick={() => setFarm({ water: "irrigated" })}>
                  {t("myfield.irrigated")}
                </button>
              </div>
              {irrigated ? (
                <label className="num-field">
                  <span>{t("myfield.irr_mm")}</span>
                  <input
                    type="number"
                    min={0}
                    max={1500}
                    step={25}
                    placeholder={t("myfield.irr_unknown")}
                    value={farm.irrigation_mm || ""}
                    onChange={(e) => setFarm({ irrigation_mm: Math.max(0, Number(e.target.value) || 0) })}
                  />
                </label>
              ) : null}
            </FactRow>
            <FactRow label={t("myfield.equipment")}>
              <fieldset className="checks">
                <legend className="fs-visually-hidden">{t("myfield.equipment")}</legend>
                {EQUIPMENT_IDS.map((id) => (
                  <label key={id} className="check">
                    <input
                      type="checkbox"
                      checked={farm.equipment.includes(id)}
                      onChange={(e) =>
                        setFarm({ equipment: e.target.checked ? [...farm.equipment, id] : farm.equipment.filter((x) => x !== id) })
                      }
                    />
                    <span>{t(`equip.${id}`)}</span>
                  </label>
                ))}
                <label className="check">
                  <input type="checkbox" checked={farm.livestock} onChange={(e) => setFarm({ livestock: e.target.checked })} />
                  <span>{t("myfield.livestock")}</span>
                </label>
                <label className="check">
                  <input type="checkbox" checked={farm.hay_buyer} onChange={(e) => setFarm({ hay_buyer: e.target.checked })} />
                  <span>{t("myfield.hay_buyer")}</span>
                </label>
              </fieldset>
              {used && !farmTouched ? (
                <p className="fs-meta assumed">
                  {used.equipment_inferred_from?.length ? t("myfield.equip_assumed", { crops: used.equipment_inferred_from.map((x) => x.replace(/_/g, " ")).join(", ") }) : null}{" "}
                  {used.markets?.length ? t("myfield.markets_assumed", { m: used.markets.map((x) => x.replace(/_/g, " ")).join(", "), src: used.markets_assumed_from ?? "" }) : null}
                </p>
              ) : null}
            </FactRow>
            <FarmCrops farm={farm} setFarm={setFarm} fits={cmp.data?.what_fits} assumedFrom={!farm.markets_confirmed ? used?.markets_assumed_from : undefined} />
            <OwnRecords key={`rec-${field?.id}`} report={r} cmp={cmp.data} onUsed={() => setRecVer((v) => v + 1)} />
            <OwnBudgets key={`${field?.id}-${recVer}`} cmp={cmp.data} />
            {field ? <SaveOffline fid={field.id} /> : null}
          </div>
        ) : null}
      </div>
      {guided ? null : (
      <div className="panel__foot">
        <Button
          size="lg"
          block
          iconAfter={<IconChevronRight size={18} />}
          data-tour="compare-btn"
          onClick={() => {
            set({ compareRequested: true, mobileTab: "options" });
            showOptions();
          }}
          aria-describedby={cmp.isFetching ? "cmp-busy" : undefined}
        >
          {t("myfield.compare")}
        </Button>
        {cmp.isFetching ? (
          <p id="cmp-busy" className="fs-meta busy" role="status">
            {t("options.updating")}
          </p>
        ) : null}
      </div>
      )}
    </section>
  );
}
