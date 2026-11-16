/* Small shared UI pieces used across views. */
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { create } from "zustand";
import { DataButton, GlossaryTerm, SIButton, StatusBanner, Button, IconClose } from "../design";
import type { SIRecord } from "../design";
import type { ApiEvidence } from "../api";
import { isNotFound, useGlossaryQ, useReportQ } from "../api";
import { glossaryMap, toEvidence } from "../lib";
import { useApp } from "../store";

/* ---------------- toasts ---------------- */

interface ToastState {
  msg: string | null;
  kind: "info" | "error";
  /** Auto-hide delay; a "working…" toast stays up to 60 s until the next message replaces it. */
  ms: number;
  show: (msg: string, kind?: "info" | "error", ms?: number) => void;
  hide: () => void;
}
export const useToast = create<ToastState>((set) => ({
  msg: null,
  kind: "info",
  ms: 6000,
  show: (msg, kind = "info", ms = 6000) => set({ msg, kind, ms }),
  hide: () => set({ msg: null }),
}));

export function Toast() {
  const { msg, kind, ms, hide } = useToast();
  const { t } = useTranslation();
  useEffect(() => {
    if (!msg) return;
    const id = setTimeout(hide, ms);
    return () => clearTimeout(id);
  }, [msg, ms, hide]);
  if (!msg) return null;
  return (
    <div className={`toast toast--${kind}`} role={kind === "error" ? "alert" : "status"}>
      <span>{msg}</span>
      <button type="button" className="fs-btn fs-btn--ghost fs-btn--icon fs-btn--sm" aria-label={t("common.close")} onClick={hide}>
        <IconClose size={16} />
      </button>
    </div>
  );
}

/* ---------------- provenance shortcuts ---------------- */

/** DataButton for an evidence id from report.evidence (renders nothing if the record is missing). */
export function Ev({ id, describes, ev }: { id?: string | null; describes?: string; ev?: ApiEvidence | null }) {
  const fieldId = useApp((s) => s.field?.id ?? null);
  const report = useReportQ(fieldId);
  const rec = ev ?? (id ? report.data?.evidence?.[id] : undefined);
  const e = toEvidence(rec);
  if (!e) return null;
  return <DataButton evidence={e} describes={describes} />;
}

export function SI({ record, describes }: { record: SIRecord; describes?: string }) {
  return <SIButton record={record} describes={describes} />;
}

/** Glossary term from /api/kb/glossary in the current language. */
export function Term({ id, children }: { id: string; children?: ReactNode }) {
  const { i18n } = useTranslation();
  const q = useGlossaryQ();
  const defs = useMemo(() => glossaryMap(q.data?.terms, i18n.language), [q.data, i18n.language]);
  return (
    <GlossaryTerm term={id} definitions={defs}>
      {children}
    </GlossaryTerm>
  );
}

/* ---------------- states ---------------- */

/** Honest state for a query that failed: 404 → "not available yet", else a retryable error. */
export function QueryState({ error, onRetry, what }: { error: unknown; onRetry?: () => void; what: string }) {
  const { t } = useTranslation();
  if (isNotFound(error))
    return (
      <StatusBanner kind="unsupported" title={t("state.not_yet_title", { what })}>
        {t("state.not_yet_body")}
      </StatusBanner>
    );
  return (
    <StatusBanner
      kind="error"
      title={t("state.error_title", { what })}
      action={onRetry ? <Button variant="secondary" size="sm" onClick={onRetry}>{t("common.retry")}</Button> : undefined}
    >
      {error instanceof Error ? error.message : String(error)}
    </StatusBanner>
  );
}

export function NeedField() {
  const { t } = useTranslation();
  const setView = useApp((s) => s.setView);
  return (
    <div className="page-narrow">
      <StatusBanner kind="no-observation" title={t("state.need_field_title")} action={<Button onClick={() => setView("home")}>{t("state.find_farm")}</Button>}>
        {t("state.need_field_body")}
      </StatusBanner>
    </div>
  );
}

/** "FarmSmart supports your judgment…" reminder, from compare.reminder when available. */
export function Reminder({ text }: { text?: string }) {
  const { t } = useTranslation();
  return (
    <p className="reminder" role="note">
      <span aria-hidden="true">◆ </span>
      {text ?? t("common.reminder")} <strong>{t("common.check_locally")}</strong>
    </p>
  );
}

/** Progress bar for field lookup and analysis. */
export function PendingBar() {
  const pending = useApp((s) => s.pending);
  const set = useApp((s) => s.set);
  const { t } = useTranslation();
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!pending || pending.error) return;
    const t0 = Date.now();
    const id = setInterval(() => setElapsed(Math.round((Date.now() - t0) / 1000)), 1000);
    return () => clearInterval(id);
  }, [pending?.label, pending?.error, pending]);
  if (!pending) return null;
  if (pending.error)
    return (
      <div className="pending pending--error" role="alert">
        <div className="pending__text">
          <strong>{pending.label}</strong>
          <span>{pending.error}</span>
        </div>
        <Button variant="ghost" size="sm" onClick={() => set({ pending: null })}>
          {t("common.dismiss")}
        </Button>
      </div>
    );
  const pct = Math.round(pending.progress * 100);
  return (
    <div className="pending" role="status" aria-live="polite">
      <div className="pending__text">
        <strong>{pending.label}</strong>
        <span>
          {pending.step} · {t("pending.elapsed", { s: elapsed })}
        </span>
        {pending.note ? <span className="fs-meta">{pending.note}</span> : null}
      </div>
      <div className="pending__track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={t("pending.progress")}>
        <div className="pending__fill" style={{ width: `${Math.max(4, pct)}%` }} />
      </div>
    </div>
  );
}

/** Section heading with provenance dots right after the title. */
export function H({ level = 3, children, dots, id }: { level?: 2 | 3 | 4; children: ReactNode; dots?: ReactNode; id?: string }) {
  const Tag = `h${level}` as "h2";
  return (
    <div className="h-row">
      <Tag id={id} className={level === 2 ? "fs-h2" : "h3"}>
        {children}
      </Tag>
      {dots}
    </div>
  );
}

/** Key/value fact list. */
export function Facts({ rows }: { rows: [ReactNode, ReactNode, ReactNode?][] }) {
  return (
    <dl className="facts">
      {rows.map(([k, v, dot], i) => (
        <div className="facts__row" key={i}>
          <dt>{k}</dt>
          <dd>
            {v}
            {dot}
          </dd>
        </div>
      ))}
    </dl>
  );
}
