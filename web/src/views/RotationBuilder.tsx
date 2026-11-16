/* Rotation builder ("Build your own"): the farmer lays out up to 4 rotations year by year from the crops that fit
   this field, with a cover-crop toggle per year, then "Test these" sends them to the same simulator and ranker as
   the suggested options (compare `custom`). Drag a crop onto a year, or tap a crop then a year, or use the menu in
   each year (keyboard and touch). Results and the reasons for any rejected option come from the API. */
import { useMemo, useState } from "react";
import type { DragEvent } from "react";
import { useTranslation } from "react-i18next";
import { Button, ConfidenceChip, SIButton, Skeleton, StatusBanner, IconClose, IconPlay } from "../design";
import type { CompareResult, FitCrop, SeqStep } from "../api";
import { useApp, useCompareBody } from "../store";
import { usePlanCompareQ } from "../apiPlan";
import type { PlanCard, PlanCompare, PlanCompareBody } from "../apiPlan";
import { useFieldPlan, usePlan, MAX_CUSTOM } from "../planStore";
import type { CustomOption } from "../planStore";
import { NeedField, QueryState, Reminder } from "../components/common";
import { cardSI, cropColor, cropInk, cx, fmtU, nice, toConfidence } from "../lib";
import type { UnitKind } from "../lib";
import { SequenceYears, choiceKey, rankedCount, optionName, useCropName, withCustom } from "./ActionPlan";
import "../plan.css";

const MAX_YEARS = 6;
const RESULT_KEYS: { key: string; unit: UnitKind; label: string }[] = [
  { key: "soil_cover", unit: "days", label: "ind.soil_cover" },
  { key: "erosion_water", unit: "t_ha", label: "ind.erosion_water" },
  { key: "water_use", unit: "mm", label: "ind.water_use" },
  { key: "profit_p50", unit: "usd_ac", label: "ind.profit_p50" },
];

const newKey = () => `o${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
const DRAG_TYPE = "text/x-fieldshift-crop";

function YearSlot({
  step,
  i,
  option,
  cash,
  covers,
  picked,
  onSet,
  onRemove,
  canRemove,
}: {
  step: SeqStep;
  i: number;
  option: string;
  cash: FitCrop[];
  covers: FitCrop[];
  picked: string | null;
  onSet: (s: SeqStep) => void;
  onRemove: () => void;
  canRemove: boolean;
}) {
  const { t } = useTranslation();
  const name = useCropName();
  const [over, setOver] = useState(false);
  const cashId = `${option}-y${i}-cash`;
  const coverId = `${option}-y${i}-cover`;
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    const id = e.dataTransfer.getData(DRAG_TYPE) || e.dataTransfer.getData("text/plain");
    if (cash.some((c) => c.crop_id === id)) onSet({ ...step, cash: id });
  };
  return (
    <li
      className={cx("by-year", over && "is-over", picked && "is-target")}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes(DRAG_TYPE) || e.dataTransfer.types.includes("text/plain")) {
          e.preventDefault();
          setOver(true);
        }
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
    >
      <div className="by-year__head">
        <span className="by-year__n">{t("plan.year_n", { n: i + 1 })}</span>
        {canRemove ? (
          <button type="button" className="by-x" aria-label={t("builder.remove_year", { n: i + 1 })} onClick={onRemove}>
            <IconClose size={14} />
          </button>
        ) : null}
      </div>
      {picked ? (
        <button type="button" className="by-drop" onClick={() => onSet({ ...step, cash: picked })}>
          {t("builder.place_here", { c: name(picked) })}
        </button>
      ) : (
        <span className="by-pill" style={{ background: cropColor(step.cash), color: cropInk(step.cash) }}>
          {step.cash ? name(step.cash) : t("builder.pick_crop")}
        </span>
      )}
      <label className="field-l" htmlFor={cashId}>
        <span>{t("builder.crop_in_year", { n: i + 1 })}</span>
      </label>
      <select id={cashId} value={step.cash ?? ""} onChange={(e) => onSet({ ...step, cash: e.target.value || null })}>
        <option value="" disabled>
          {t("builder.pick_crop")}
        </option>
        {cash.map((c) => (
          <option key={c.crop_id} value={c.crop_id}>
            {name(c.crop_id)}
          </option>
        ))}
      </select>
      <label className="check by-cover">
        <input
          type="checkbox"
          checked={!!step.cover}
          disabled={!covers.length}
          onChange={(e) => onSet({ ...step, cover: e.target.checked ? (covers[0]?.crop_id ?? null) : null })}
        />
        <span>{t("builder.cover_after")}</span>
      </label>
      {step.cover ? (
        <>
          <label className="fs-visually-hidden" htmlFor={coverId}>
            {t("builder.cover_in_year", { n: i + 1 })}
          </label>
          <select id={coverId} value={step.cover} onChange={(e) => onSet({ ...step, cover: e.target.value })}>
            {covers.map((c) => (
              <option key={c.crop_id} value={c.crop_id}>
                {name(c.crop_id)}
              </option>
            ))}
          </select>
        </>
      ) : null}
    </li>
  );
}

function OptionEditor({
  o,
  idx,
  cash,
  covers,
  picked,
  onChange,
  onRemove,
}: {
  o: CustomOption;
  idx: number;
  cash: FitCrop[];
  covers: FitCrop[];
  picked: string | null;
  onChange: (o: CustomOption) => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const setStep = (i: number, s: SeqStep) => onChange({ ...o, sequence: o.sequence.map((x, k) => (k === i ? s : x)) });
  return (
    <section className="card-sec by-opt" aria-label={t("builder.option_n", { n: idx + 1, name: o.name })}>
      <div className="by-opt__head">
        <label className="field-l by-name">
          <span>{t("builder.name")}</span>
          <input type="text" value={o.name} maxLength={60} onChange={(e) => onChange({ ...o, name: e.target.value })} />
        </label>
        <Button variant="ghost" size="sm" onClick={onRemove} aria-label={t("builder.remove_option", { name: o.name })}>
          {t("builder.remove")}
        </Button>
      </div>
      <ol className="by-years">
        {o.sequence.map((s, i) => (
          <YearSlot
            key={i}
            step={s}
            i={i}
            option={o.key}
            cash={cash}
            covers={covers}
            picked={picked}
            onSet={(x) => setStep(i, x)}
            onRemove={() => onChange({ ...o, sequence: o.sequence.filter((_, k) => k !== i) })}
            canRemove={o.sequence.length > 1}
          />
        ))}
      </ol>
      <div className="fs-cluster">
        <Button
          variant="secondary"
          size="sm"
          disabled={o.sequence.length >= MAX_YEARS}
          onClick={() => onChange({ ...o, sequence: [...o.sequence, { cash: o.sequence[o.sequence.length - 1]?.cash ?? cash[0]?.crop_id ?? null, cover: null }] })}
        >
          {t("builder.add_year")}
        </Button>
        <span className="fs-meta">{t("builder.years_help", { n: MAX_YEARS })}</span>
      </div>
    </section>
  );
}

function ResultRow({ c, cmp }: { c: PlanCard; cmp: PlanCompare }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const units = useApp((s) => s.units);
  const setChosen = useFieldPlan()[1];
  const openView = usePlan((s) => s.open);
  const ranked = rankedCount(cmp);
  return (
    <article className={cx("by-res", c.is_custom && "is-custom")}>
      <div className="h-row">
        <h3 className="fs-title">{optionName(c, t)}</h3>
        <span className="fs-cluster" style={{ ["--gap" as string]: "6px" }}>
          {c.is_custom ? <span className="fs-chip fs-chip--soil">{t("builder.yours")}</span> : null}
          {c.best_for_you ? <span className="fs-chip fs-chip--field">{t("plan.top_ranked")}</span> : null}
          <ConfidenceChip confidence={toConfidence(c.confidence, c.information_gaps?.[0])} />
          <SIButton record={cardSI(c, cmp as unknown as CompareResult, t)} describes={optionName(c, t)} />
        </span>
      </div>
      <p className="fs-meta">
        {c.is_baseline ? t("plan.is_current") : `${t("plan.rank", { n: c.rank, m: ranked })} · ${t("plan.match", { p: nice(c.match, lang) })}`}
      </p>
      <SequenceYears sequence={c.sequence} />
      <dl className="by-kpis">
        {RESULT_KEYS.map((k) => {
          const q = c.indicators[k.key];
          return (
            <div key={k.key}>
              <dt>{t(k.label)}</dt>
              <dd>
                {q ? (k.unit === "usd_ac" ? `$${nice(q.p50, lang)}/ac` : k.unit === "days" ? `${nice(q.p50, lang)} ${t("units.days_yr")}` : fmtU(q.p50, k.unit, units, lang)) : "—"}
                {q ? <span className="fs-meta"> {t("builder.typical_year")}</span> : null}
              </dd>
            </div>
          );
        })}
      </dl>
      {c.is_custom && c.flags?.length ? (
        <ul className="bul">
          {[...new Set(c.flags.map((f) => f.message))].slice(0, 3).map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      ) : null}
      {!c.is_baseline ? (
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            setChosen({ chosen: choiceKey(c), chosenName: optionName(c, t) });
            openView("plan");
          }}
        >
          {t("builder.use_in_plan")}
        </Button>
      ) : null}
    </article>
  );
}

export default function RotationBuilder() {
  const { t } = useTranslation();
  const field = useApp((s) => s.field);
  const [plan, patch] = useFieldPlan();
  const base = useCompareBody() as PlanCompareBody;
  const mainQ = usePlanCompareQ(field?.id ?? null, base);
  const testBody = useMemo(() => withCustom(base, plan.tested), [base, plan.tested]);
  const testQ = usePlanCompareQ(field?.id ?? null, testBody, !!plan.tested?.length);
  const name = useCropName();
  const [picked, setPicked] = useState<string | null>(null);
  const d = mainQ.data;
  const feasible = d?.what_fits?.feasible ?? [];
  const cash = feasible.filter((c) => c.roles?.includes("cash"));
  const covers = feasible.filter((c) => c.roles?.includes("cover"));
  const baseline = d?.cards.find((c) => c.is_baseline);
  const opts = plan.custom;

  if (!field) return <NeedField />;

  const setOpts = (next: CustomOption[]) => patch({ custom: next });
  const add = (seq?: SeqStep[]) =>
    setOpts([
      ...opts,
      {
        key: newKey(),
        name: t("builder.default_name", { n: opts.length + 1 }),
        sequence: (seq ?? baseline?.sequence ?? [{ cash: cash[0]?.crop_id ?? null, cover: null }]).map((s) => ({ cash: s.cash, cover: s.cover ?? null })),
      },
    ]);

  const problems = opts.flatMap((o, i) => {
    const out: string[] = [];
    if (!o.name.trim()) out.push(t("builder.err_name", { n: i + 1 }));
    if (o.sequence.some((s) => !s.cash)) out.push(t("builder.err_crop", { name: o.name || i + 1 }));
    return out;
  });
  const dupNames = new Set(opts.map((o) => o.name.trim().toLowerCase())).size !== opts.length;
  if (dupNames) problems.push(t("builder.err_dup"));
  const changed = JSON.stringify(opts) !== JSON.stringify(plan.tested ?? []);
  const res = testQ.data;
  const customCards = res?.cards.filter((c) => c.is_custom) ?? [];
  const refCards = res?.cards.filter((c) => c.is_baseline || c.best_for_you) ?? [];

  return (
    <div className="page page--narrowish" data-tour="builder">
      <header className="page__head">
        <div>
          <h1 className="fs-h1">{t("builder.title")}</h1>
          <p className="fs-meta">{t("builder.sub", { name: field.name })}</p>
        </div>
      </header>

      {mainQ.isLoading ? <Skeleton height={160} /> : null}
      {mainQ.error ? <QueryState error={mainQ.error} what={t("builder.palette")} onRetry={() => void mainQ.refetch()} /> : null}
      {d && !d.supported ? <StatusBanner kind="unsupported">{d.reason}</StatusBanner> : null}

      {d?.supported ? (
        <>
          <section className="card-sec by-palette" aria-labelledby="by-pal-h">
            <h2 id="by-pal-h" className="fs-h2">
              {t("builder.palette")}
            </h2>
            <p className="fs-meta">{t("builder.palette_help")}</p>
            <div className="fs-cluster" role="group" aria-label={t("builder.palette")}>
              {cash.map((c) => (
                <button
                  key={c.crop_id}
                  type="button"
                  className={cx("by-chip", picked === c.crop_id && "is-picked")}
                  style={{ ["--crop" as string]: cropColor(c.crop_id), ["--crop-ink" as string]: cropInk(c.crop_id) }}
                  draggable
                  aria-pressed={picked === c.crop_id}
                  onDragStart={(e) => {
                    e.dataTransfer.setData(DRAG_TYPE, c.crop_id);
                    e.dataTransfer.setData("text/plain", c.crop_id);
                    e.dataTransfer.effectAllowed = "copy";
                  }}
                  onClick={() => setPicked((p) => (p === c.crop_id ? null : c.crop_id))}
                >
                  {name(c.crop_id)}
                </button>
              ))}
            </div>
            {picked ? (
              <p className="fs-meta" role="status">
                {t("builder.picked", { c: name(picked) })}{" "}
                <button type="button" className="fs-link" onClick={() => setPicked(null)}>
                  {t("common.cancel")}
                </button>
              </p>
            ) : null}
            {covers.length ? (
              <p className="fs-meta">
                {t("builder.covers_fit")}: {covers.map((c) => name(c.crop_id)).join(", ")}
              </p>
            ) : (
              <p className="fs-meta">{t("builder.no_covers")}</p>
            )}
            {d.what_fits?.excluded?.length ? (
              <p className="fs-meta">
                {t("builder.excluded")}: {d.what_fits.excluded.map((c) => name(c.crop_id)).join(", ")}
              </p>
            ) : null}
          </section>

          {opts.map((o, i) => (
            <OptionEditor
              key={o.key}
              o={o}
              idx={i}
              cash={cash}
              covers={covers}
              picked={picked}
              onChange={(n) => {
                setOpts(opts.map((x) => (x.key === o.key ? n : x)));
                setPicked(null);
              }}
              onRemove={() => setOpts(opts.filter((x) => x.key !== o.key))}
            />
          ))}

          <div className="fs-cluster">
            <Button variant="secondary" disabled={opts.length >= MAX_CUSTOM} onClick={() => add()}>
              {opts.length ? t("builder.add_option") : t("builder.start_current")}
            </Button>
            <span className="fs-meta">{t("builder.max", { n: MAX_CUSTOM })}</span>
          </div>

          {problems.length ? (
            <ul className="bul by-problems" role="status">
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          ) : null}

          <div className="sticky-foot">
            <span className="fs-meta">{opts.length ? (changed && plan.tested ? t("builder.changed") : t("builder.test_help")) : t("builder.empty")}</span>
            <Button icon={<IconPlay size={14} />} disabled={!opts.length || problems.length > 0 || (!changed && !!plan.tested)} onClick={() => patch({ tested: opts })}>
              {testQ.isFetching ? t("builder.testing") : t("builder.test")}
            </Button>
          </div>
        </>
      ) : null}

      {plan.tested?.length ? (
        <section className="card-sec" aria-labelledby="by-res-h" aria-busy={testQ.isFetching}>
          <h2 id="by-res-h" className="fs-h2">
            {t("builder.results")}
          </h2>
          {testQ.isFetching ? (
            <StatusBanner kind="loading" title={t("builder.testing")}>
              {t("builder.testing_help")}
            </StatusBanner>
          ) : null}
          {testQ.isLoading ? <Skeleton height={200} label={t("builder.testing")} /> : null}
          {testQ.error ? <QueryState error={testQ.error} what={t("builder.results")} onRetry={() => void testQ.refetch()} /> : null}
          {res && !res.supported ? <StatusBanner kind="unsupported">{res.reason}</StatusBanner> : null}
          {res?.supported ? (
            <>
              <p className="fs-meta">{t("builder.results_help", { n: res.weather_years?.n ?? "—" })}</p>
              {res.custom_rejected?.length ? (
                <StatusBanner kind="partial" title={t("builder.rejected_title")}>
                  <ul className="bul">
                    {res.custom_rejected.map((r) => (
                      <li key={r.name}>
                        <strong>{r.name}</strong>: {r.reasons.join(" · ")}
                      </li>
                    ))}
                  </ul>
                  <p className="fs-meta">
                    {t("builder.rejected_help")}{" "}
                    <button
                      type="button"
                      className="fs-link"
                      onClick={() => {
                        const st = useApp.getState();
                        st.setView("studio");
                        st.set({ mobileTab: "field" });
                      }}
                    >
                      {t("builder.go_markets")}
                    </button>
                  </p>
                </StatusBanner>
              ) : null}
              {!customCards.length && !res.custom_rejected?.length ? <StatusBanner kind="partial">{t("builder.no_custom_back")}</StatusBanner> : null}
              <div className="by-results">
                {[...customCards, ...refCards.filter((c) => !c.is_custom)].map((c) => (
                  <ResultRow key={c.id} c={c} cmp={res} />
                ))}
              </div>
            </>
          ) : null}
        </section>
      ) : null}
      <Reminder text={d?.reminder} />
    </div>
  );
}
