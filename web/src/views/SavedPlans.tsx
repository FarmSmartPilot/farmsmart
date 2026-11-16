/* Saved plans: snapshots of a field's settings and plan (field, priorities, scenario, farm, own prices, built
   options, plan) kept in this browser; reopen, delete, export the comparison as CSV and the plan as JSON, import JSON.
   The CSV holds the compare run exactly as the API returned it (P10/P50/P90 across weather years, metric units). */
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, StatusBanner, IconDownload, IconUpload, IconMap } from "../design";
import type { CardData } from "../api";
import { useApp } from "../store";
import { apiPlan } from "../apiPlan";
import type { PlanCard, PlanCompare } from "../apiPlan";
import { usePlan, makeSnapshot, reopenSnapshot, parseSnapshot, downloadBlob } from "../planStore";
import type { SavedPlan } from "../planStore";
import { Reminder, useToast } from "../components/common";
import { INDICATORS, isNum, scenarioLabel, unitLabel } from "../lib";
import { optionName, usePlanBody } from "./ActionPlan";
import "../plan.css";

const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** CSV of a compare run: one row per option, P10/P50/P90 per indicator, as returned by the API. */
export function compareCsv(d: PlanCompare, fieldName: string, t: (k: string, o?: Record<string, unknown>) => string): string {
  const head = ["option", "kind", "rank", "match", "score", "confidence", "sequence"];
  for (const m of INDICATORS) {
    const u = unitLabel(m.unit, "metric");
    for (const q of ["p10", "p50", "p90"]) head.push(`${m.key}${u ? ` (${u})` : ""} ${q}`);
  }
  const rows: unknown[][] = [];
  const cards: PlanCard[] = [...d.cards.filter((c) => c.is_baseline), ...d.cards.filter((c) => !c.is_baseline)];
  for (const c of cards) {
    const r: unknown[] = [
      optionName(c, t),
      c.is_baseline ? "current" : c.is_custom ? "yours" : "suggested",
      c.is_baseline ? "" : c.rank,
      isNum(c.match) ? c.match : "",
      isNum(c.score) ? c.score : "",
      c.confidence?.level ?? "",
      c.sequence.map((s) => `${s.cash ?? "fallow"}${s.cover ? `+${s.cover}` : ""}`).join(" > "),
    ];
    for (const m of INDICATORS) {
      const q = (c as CardData).indicators[m.key];
      r.push(q?.p10 ?? "", q?.p50 ?? "", q?.p90 ?? "");
    }
    rows.push(r);
  }
  const meta = [
    ["FarmSmart comparison"],
    ["field", fieldName, d.field_id],
    ["scenario", d.scenario],
    ["weather years", d.weather_years ? `${d.weather_years.first}-${d.weather_years.last} (n=${d.weather_years.n})` : ""],
    ["note", "Model runs: P10/P50/P90 across weather years, metric units. Supports, never replaces, your judgment."],
    ["exported", new Date().toISOString()],
    [],
  ];
  return [...meta, head, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n");
}

function SnapshotRow({ s }: { s: SavedPlan }) {
  const { t, i18n } = useTranslation();
  const remove = usePlan((st) => st.removeSaved);
  const [confirm, setConfirm] = useState(false);
  const done = Object.values(s.plan.done ?? {}).filter(Boolean).length;
  const when = new Date(s.saved_at);
  return (
    <li className="sp-row">
      <div className="sp-row__main">
        <strong className="sp-row__field">
          <IconMap size={14} /> {s.field.name}
        </strong>
        <span className="fs-meta">
          {t("saved.saved_on", { d: Number.isNaN(when.getTime()) ? s.saved_at : when.toLocaleString(i18n.language === "es" ? "es" : "en-US") })}
        </span>
        <span>{s.plan.chosenName ? t("saved.chosen", { name: s.plan.chosenName }) : t("saved.no_choice")}</span>
        <span className="fs-meta">
          {t("saved.summary", {
            s: scenarioLabel(s.scenario, t as never, i18n.language),
            n: done,
            c: s.plan.custom?.length ?? 0,
            notes: s.plan.notes?.length ?? 0,
          })}
        </span>
      </div>
      <div className="sp-row__act fs-cluster">
        <Button size="sm" onClick={() => reopenSnapshot(s)}>
          {t("saved.open")}
        </Button>
        <Button size="sm" variant="secondary" onClick={() => downloadBlob(JSON.stringify(s, null, 2), "application/json", `farmsmart-plan-${s.field.id}.json`)}>
          {t("saved.export_json")}
        </Button>
        {confirm ? (
          <span className="fs-cluster" role="group" aria-label={t("saved.delete_q")}>
            <span className="fs-meta">{t("saved.delete_q")}</span>
            <Button size="sm" variant="secondary" onClick={() => remove(s.id)}>
              {t("common.yes")}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirm(false)}>
              {t("common.no")}
            </Button>
          </span>
        ) : (
          <Button size="sm" variant="ghost" onClick={() => setConfirm(true)} aria-label={t("saved.delete_aria", { name: s.field.name })}>
            {t("saved.delete")}
          </Button>
        )}
      </div>
    </li>
  );
}

export default function SavedPlans() {
  const { t } = useTranslation();
  const field = useApp((s) => s.field);
  const saved = usePlan((s) => s.saved);
  const addSaved = usePlan((s) => s.addSaved);
  const toast = useToast((s) => s.show);
  const body = usePlanBody();
  const fileRef = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [csvBusy, setCsvBusy] = useState(false);

  const save = () => {
    const s = makeSnapshot();
    if (!s) return;
    addSaved(s);
    setMsg({ kind: "ok", text: t("saved.saved_ok", { name: s.field.name }) });
  };

  const csv = async () => {
    if (!field) return;
    setCsvBusy(true);
    try {
      const d = await apiPlan.compare(field.id, body);
      if (!d.supported) throw new Error(d.reason ?? t("saved.csv_unsupported"));
      downloadBlob("﻿" + compareCsv(d, field.name, t as never), "text/csv;charset=utf-8", `farmsmart-comparison-${field.id}.csv`);
      toast(t("saved.csv_done"));
    } catch (e) {
      toast(`${t("saved.csv_failed")} ${e instanceof Error ? e.message : ""}`, "error");
    } finally {
      setCsvBusy(false);
    }
  };

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    setMsg(null);
    try {
      if (f.size > 2_000_000) throw new Error(t("saved.import_big"));
      const parsed = parseSnapshot(JSON.parse(await f.text()));
      if (typeof parsed === "string") throw new Error(t(parsed));
      addSaved(parsed);
      setMsg({ kind: "ok", text: t("saved.import_ok", { name: parsed.field.name }) });
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof SyntaxError ? t("saved.import_bad") : e instanceof Error ? e.message : String(e) });
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <div className="page page--narrowish" data-tour="saved">
      <header className="page__head">
        <div>
          <h1 className="fs-h1">{t("saved.title")}</h1>
          <p className="fs-meta">{t("saved.sub")}</p>
        </div>
      </header>

      <section className="card-sec" aria-labelledby="sp-now-h">
        <h2 id="sp-now-h" className="fs-h2">
          {field ? t("saved.this_field", { name: field.name }) : t("saved.no_field")}
        </h2>
        {field ? (
          <div className="fs-cluster">
            <Button onClick={save}>{t("saved.save_now")}</Button>
            <Button variant="secondary" icon={<IconDownload size={16} />} onClick={() => void csv()} disabled={csvBusy}>
              {csvBusy ? t("saved.csv_busy") : t("saved.export_csv")}
            </Button>
          </div>
        ) : (
          <p className="fs-meta">{t("saved.no_field_help")}</p>
        )}
        <div className="fs-cluster">
          <input ref={fileRef} type="file" accept="application/json,.json" className="fs-visually-hidden" id="sp-import" onChange={(e) => void onFile(e.target.files?.[0])} tabIndex={-1} />
          <Button variant="secondary" icon={<IconUpload size={16} />} onClick={() => fileRef.current?.click()}>
            {t("saved.import")}
          </Button>
          <span className="fs-meta">{t("saved.import_help")}</span>
        </div>
        {msg ? (
          <StatusBanner kind={msg.kind === "ok" ? "stale" : "error"} title={msg.kind === "ok" ? t("saved.done") : t("saved.problem")}>
            {msg.text}
          </StatusBanner>
        ) : null}
      </section>

      <section className="card-sec" aria-labelledby="sp-list-h">
        <h2 id="sp-list-h" className="fs-h2">
          {t("saved.list", { n: saved.length })}
        </h2>
        {saved.length ? (
          <ul className="sp-list">
            {saved.map((s) => (
              <SnapshotRow key={s.id} s={s} />
            ))}
          </ul>
        ) : (
          <p className="fs-meta">{t("saved.empty")}</p>
        )}
        <p className="fs-meta">{t("saved.local_note")}</p>
      </section>
      <Reminder />
    </div>
  );
}
