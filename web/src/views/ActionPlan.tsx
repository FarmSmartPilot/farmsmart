/* Action plan ("Plan"): the option the farmer chose, a checklist in three stages with progress, the year-by-year
   sequence, adviser notes and "Download plan (PDF)". Checklist items are generic agronomy checks plus the chosen
   card's own check-locally items. The ranking and numbers come from the compare run; nothing is invented here. */
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, ConfidenceChip, SIButton, Skeleton, StatusBanner, IconDownload, IconCheck } from "../design";
import { isNotFound, useCropsQ } from "../api";
import type { CompareResult, SeqStep } from "../api";
import { useApp, useCompareBody } from "../store";
import { usePlanCompareQ, apiPlan } from "../apiPlan";
import type { PlanCard, PlanCompare, PlanCompareBody } from "../apiPlan";
import { useFieldPlan, usePlan, makeSnapshot, downloadBlob, MAX_NOTES, STAGES } from "../planStore";
import type { CustomOption, FieldPlan, Stage } from "../planStore";
import { NeedField, QueryState, Reminder, useToast } from "../components/common";
import AddToFarm, { FarmNextSteps } from "../components/AddToFarm";
import { cardSI, cropColor, cropInk, cx, nice, toConfidence } from "../lib";
import "../plan.css";

/* ---------------- shared helpers (also used by the builder and saved plans) ---------------- */

export function useCropName() {
  const { i18n } = useTranslation();
  const crops = useCropsQ();
  return (id: string | null | undefined) => {
    if (!id) return "";
    const c = crops.data?.[id];
    return (c ? (i18n.language === "es" && c.name_es ? c.name_es : c.name) : id.replace(/_/g, " ")).split(" (")[0];
  };
}

/** Stable key for the chosen option: farmer-built cards are renumbered by the API, so they are matched by name. */
export function choiceKey(c: PlanCard): string {
  return c.is_custom ? `custom:${c.custom_name ?? c.name}` : c.id;
}

export function findChoice(cards: PlanCard[], key: string | null): PlanCard | undefined {
  if (!key) return undefined;
  if (key.startsWith("custom:")) return cards.find((c) => c.is_custom && (c.custom_name ?? c.name) === key.slice(7));
  return cards.find((c) => c.id === key && !c.is_custom);
}

/** How many options were ranked (ranks run over every simulated option, not only the ones shown). */
export function rankedCount(d: PlanCompare): number {
  const all = (d.all_cards?.length ? d.all_cards : d.cards).filter((c) => !c.is_baseline);
  return Math.max(all.length, ...all.map((c) => c.rank ?? 0));
}

export function optionName(c: PlanCard, t: (k: string) => string): string {
  if (c.is_custom) return c.custom_name ?? c.name;
  return c.is_baseline ? `${t("options.current")}: ${c.rotation_label}` : c.name;
}

/** The compare body used by the plan views: the app's body plus the farmer-built options once tested. */
export function usePlanBody(): PlanCompareBody {
  const base = useCompareBody() as PlanCompareBody;
  const [plan] = useFieldPlan();
  return useMemo(() => {
    return withCustom(base, plan.tested);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(base), JSON.stringify(plan.tested)]);
}

export function withCustom(base: PlanCompareBody, opts: CustomOption[] | null): PlanCompareBody {
  if (!opts?.length) return base;
  return { ...base, custom: opts.map((c) => ({ name: c.name, sequence: c.sequence })) };
}

/** Year-by-year sequence: one tile per year with the cash crop and its cover crop. */
export function SequenceYears({ sequence, label }: { sequence: SeqStep[]; label?: string }) {
  const { t } = useTranslation();
  const name = useCropName();
  return (
    <ol className="seq-years" aria-label={label ?? t("plan.sequence")}>
      {sequence.map((s, i) => (
        <li key={i} className="seq-years__yr">
          <span className="seq-years__n">{t("plan.year_n", { n: i + 1 })}</span>
          <span className="seq-years__cash" style={{ background: cropColor(s.cash), color: cropInk(s.cash) }}>
            {s.cash ? name(s.cash) : t("plan.fallow")}
          </span>
          {s.double ? <span className="seq-years__cover">{t("plan.then_double", { c: name(s.double).toLowerCase() })}</span> : null}
          <span className={cx("seq-years__cover", !s.cover && "is-none")}>
            {s.cover ? t("plan.cover_of", { c: name(s.cover).toLowerCase() }) : t("plan.no_cover")}
          </span>
        </li>
      ))}
    </ol>
  );
}

/* ---------------- checklist ---------------- */

interface Item {
  id: string;
  stage: Stage;
  label: string;
  fromCard?: boolean;
}

const GENERIC: Record<Stage, string[]> = {
  commit: ["adviser", "buyer", "insurance", "budget"],
  plant: ["soil_test", "herbicide", "seed", "equipment", "dates"],
  field: ["strip", "stand", "cover_end", "records", "review"],
};

function useChecklist(card: PlanCard | undefined): Item[] {
  const { t, i18n } = useTranslation();
  const es = i18n.language === "es";
  return useMemo(() => {
    const out: Item[] = [];
    // A generic check the option already lists in its own words is not repeated.
    const ownIds = (card?.check_locally ?? []).map((x) => x.id).join(" ");
    for (const st of STAGES)
      for (const k of GENERIC[st]) if (!(k === "herbicide" && ownIds.includes("herbicide")) && !(k === "strip" && card?.try_it_small?.example)) out.push({ id: `g_${k}`, stage: st, label: t(`plan.check.${k}`) });
    // The chosen option's own items go first in "Before committing" (they come from the rules engine).
    const own = (card?.check_locally ?? []).map((x) => ({ id: `c_${x.id}`, stage: "commit" as Stage, label: es && x.text_es ? x.text_es : x.text, fromCard: true }));
    const tryIt = card?.try_it_small?.example ? [{ id: "c_try_small", stage: "field" as Stage, label: es && card.try_it_small.example_es ? card.try_it_small.example_es : card.try_it_small.example, fromCard: true }] : [];
    return [...own, ...out.filter((x) => x.stage === "commit"), ...out.filter((x) => x.stage === "plant"), ...tryIt, ...out.filter((x) => x.stage === "field")];
  }, [card, t, es]);
}

function Checklist({ items, plan, patch }: { items: Item[]; plan: FieldPlan; patch: (p: Partial<FieldPlan>) => void }) {
  const { t } = useTranslation();
  const done = items.filter((x) => plan.done[x.id]).length;
  const pct = items.length ? Math.round((done / items.length) * 100) : 0;
  return (
    <section className="card-sec" aria-labelledby="pl-check-h">
      <div className="h-row">
        <h2 id="pl-check-h" className="fs-h2">
          {t("plan.checklist")}
        </h2>
        <span className="plan-progress">
          <strong>{t("plan.progress", { n: done, m: items.length })}</strong>
          <span className="plan-progress__track" role="progressbar" aria-valuemin={0} aria-valuemax={items.length} aria-valuenow={done} aria-label={t("plan.progress_label")}>
            <span className="plan-progress__fill" style={{ width: `${pct}%` }} />
          </span>
        </span>
      </div>
      <p className="fs-meta">{t("plan.checklist_help")}</p>
      <div className="plan-stages">
        {STAGES.map((st) => {
          const its = items.filter((x) => x.stage === st);
          const n = its.filter((x) => plan.done[x.id]).length;
          return (
            <fieldset key={st} className="plan-stage">
              <legend>
                {t(`plan.stage.${st}`)} <span className="fs-meta">· {t("plan.progress", { n, m: its.length })}</span>
              </legend>
              <ul className="plan-items">
                {its.map((x) => (
                  <li key={x.id}>
                    <label className={cx("plan-item", plan.done[x.id] && "is-done")}>
                      <input type="checkbox" checked={!!plan.done[x.id]} onChange={(e) => patch({ done: { ...plan.done, [x.id]: e.target.checked } })} />
                      <span>
                        {x.label}
                        {x.fromCard ? <span className="fs-chip fs-chip--wheat plan-item__tag">{t("plan.from_option")}</span> : null}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </fieldset>
          );
        })}
      </div>
    </section>
  );
}

/* ---------------- view ---------------- */

export default function ActionPlan() {
  const { t } = useTranslation();
  const field = useApp((s) => s.field);
  const openView = usePlan((s) => s.open);
  const addSaved = usePlan((s) => s.addSaved);
  const toast = useToast((s) => s.show);
  const [plan, patch] = useFieldPlan();
  const body = usePlanBody();
  const q = usePlanCompareQ(field?.id ?? null, body);
  const d = q.data as PlanCompare | undefined;
  const cards = useMemo(() => {
    const cs = d?.cards ?? [];
    // Baseline first, then the ranked options and the farmer's own.
    return [...cs.filter((c) => c.is_baseline), ...cs.filter((c) => !c.is_baseline)];
  }, [d]);
  const top = cards.find((c) => c.best_for_you) ?? cards.find((c) => !c.is_baseline) ?? cards[0];
  const chosen = findChoice(cards, plan.chosen) ?? (plan.chosen ? undefined : top);
  const missingChoice = !!plan.chosen && !chosen && !!d;
  const items = useChecklist(chosen);
  const [busy, setBusy] = useState(false);

  if (!field) return <NeedField />;

  const pdf = async () => {
    if (!chosen) return;
    setBusy(true);
    toast(t("export.preparing"), "info", 60_000);
    try {
      const blob = await apiPlan.planPdf(field.id, {
        ...body,
        plan: {
          chosen: chosen.id,
          checklist: items.map((x) => ({ id: x.id, label: x.label, done: !!plan.done[x.id] })),
          notes: plan.notes.slice(0, MAX_NOTES),
        },
      });
      downloadBlob(blob, "application/pdf", `farmsmart-plan-${field.id}.pdf`);
      toast(t("export.done"));
    } catch (e) {
      if (isNotFound(e) || (e as { status?: number }).status === 422) toast(t("plan.pdf_not_yet"), "error");
      else toast(`${t("export.failed")} ${e instanceof Error ? e.message : ""}`, "error");
    } finally {
      setBusy(false);
    }
  };

  const save = () => {
    const s = makeSnapshot();
    if (!s) return;
    if (chosen) s.plan = { ...s.plan, chosen: choiceKey(chosen), chosenName: optionName(chosen, t) };
    addSaved(s);
    toast(t("saved.saved_ok", { name: field.name }));
  };

  const exportJson = () => {
    const s = makeSnapshot();
    if (!s) return;
    if (chosen) s.plan = { ...s.plan, chosen: choiceKey(chosen), chosenName: optionName(chosen, t) };
    downloadBlob(JSON.stringify(s, null, 2), "application/json", `farmsmart-plan-${field.id}.json`);
  };

  return (
    <div className="page page--narrowish plan-page" data-tour="plan">
      <header className="page__head">
        <div>
          <h1 className="fs-h1">{t("plan.title", { name: field.name })}</h1>
          <p className="fs-meta">{t("plan.sub")}</p>
        </div>
        <div className="fs-cluster plan-actions">
          <Button icon={<IconDownload size={16} />} onClick={() => void pdf()} disabled={!chosen || busy}>
            {busy ? t("plan.pdf_busy") : t("plan.pdf")}
          </Button>
          <Button variant="secondary" icon={<IconCheck size={16} />} onClick={save} disabled={!d}>
            {t("saved.save_now")}
          </Button>
          <Button variant="ghost" onClick={exportJson}>
            {t("saved.export_json")}
          </Button>
          <AddToFarm size="md" plan={chosen && !chosen.is_baseline && !chosen.is_custom ? chosen.id : null} />
        </div>
      </header>

      <FarmNextSteps plan={chosen && !chosen.is_baseline && !chosen.is_custom ? chosen.id : null} />

      {q.isLoading ? <Skeleton height={200} /> : null}
      {q.error ? <QueryState error={q.error} what={t("plan.chosen")} onRetry={() => void q.refetch()} /> : null}
      {d && !d.supported ? <StatusBanner kind="unsupported">{d.reason}</StatusBanner> : null}

      {d?.supported ? (
        <section className="card-sec" aria-labelledby="pl-choice-h">
          <div className="h-row">
            <h2 id="pl-choice-h" className="fs-h2">
              {t("plan.chosen")}
            </h2>
            {chosen ? <SIButton record={cardSI(chosen, d as unknown as CompareResult, t)} describes={t("plan.chosen")} /> : null}
          </div>
          <label className="field-l plan-choose">
            <span>{t("plan.pick")}</span>
            <select
              value={chosen ? choiceKey(chosen) : ""}
              onChange={(e) => {
                const c = findChoice(cards, e.target.value);
                patch({ chosen: e.target.value, chosenName: c ? optionName(c, t) : undefined });
              }}
            >
              {missingChoice ? <option value="">{t("plan.missing_choice", { name: plan.chosenName ?? plan.chosen })}</option> : null}
              {cards.map((c) => (
                <option key={choiceKey(c)} value={choiceKey(c)}>
                  {optionName(c, t)}
                  {c.best_for_you ? ` · ${t("plan.top_ranked")}` : ""}
                  {c.is_custom ? ` · ${t("builder.yours")}` : ""}
                </option>
              ))}
            </select>
          </label>
          {missingChoice ? <StatusBanner kind="partial">{t("plan.missing_body", { name: plan.chosenName ?? plan.chosen })}</StatusBanner> : null}
          {chosen ? (
            <>
              <div className="fs-cluster">
                <ConfidenceChip confidence={toConfidence(chosen.confidence, chosen.information_gaps?.[0])} />
                {!chosen.is_baseline ? (
                  <span className="fs-meta">
                    {t("plan.rank", { n: chosen.rank, m: rankedCount(d) })} · {t("plan.match", { p: nice(chosen.match) })}
                  </span>
                ) : (
                  <span className="fs-meta">{t("plan.is_current")}</span>
                )}
                {chosen.is_custom ? <span className="fs-chip fs-chip--soil">{t("builder.yours")}</span> : null}
              </div>
              <h3 className="h4">{t("plan.sequence")}</h3>
              <SequenceYears sequence={chosen.sequence} />
              <p className="fs-meta">{t("plan.sequence_help")}</p>
              {chosen.why?.length ? (
                <ul className="bul">
                  {chosen.why.slice(0, 3).map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              ) : null}
            </>
          ) : null}
          <p className="fs-meta">
            {t("plan.not_your_own")}{" "}
            <button type="button" className="fs-link" onClick={() => openView("builder")}>
              {t("plan.go_builder")}
            </button>
          </p>
        </section>
      ) : null}

      {d?.supported ? <Checklist items={items} plan={plan} patch={patch} /> : null}

      <section className="card-sec" aria-labelledby="pl-notes-h">
        <h2 id="pl-notes-h" className="fs-h2">
          {t("plan.notes")}
        </h2>
        <label className="field-l">
          <span>{t("plan.notes_help")}</span>
          <textarea
            className="plan-notes"
            rows={6}
            maxLength={MAX_NOTES}
            value={plan.notes}
            onChange={(e) => patch({ notes: e.target.value.slice(0, MAX_NOTES) })}
            aria-describedby="pl-notes-count"
          />
        </label>
        <p id="pl-notes-count" className="fs-meta" aria-live="polite">
          {t("plan.notes_count", { n: plan.notes.length.toLocaleString(), m: MAX_NOTES.toLocaleString() })} · {t("plan.notes_local")}
        </p>
      </section>
      <Reminder text={d?.reminder} />
    </div>
  );
}
