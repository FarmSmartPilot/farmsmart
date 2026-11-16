/* Alerts & Settings: units, language, reduced motion, alert subscription with thresholds and quiet hours, alert history. */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, SegmentedToggle, StatusBanner, Skeleton } from "../design";
import { api, useAlertsHistoryQ, useForecastAlertsQ } from "../api";
import { useApp } from "../store";
import type { AlertPrefs } from "../store";
import { QueryState, Reminder } from "../components/common";
import { conv } from "../lib";
import ForecastStrip from "../components/ForecastStrip";
import type { ForecastWithWarnings } from "../apiPlan";

/** "21:30" → 21; falls back when the time input is empty or malformed. */
function hourOf(hhmm: string | undefined, fallback: number): number {
  const h = Number(String(hhmm ?? "").split(":")[0]);
  return Number.isInteger(h) && h >= 0 && h <= 23 ? h : fallback;
}

const KINDS = ["frost", "heat", "dry_down", "heavy_rain_bare", "wind_low_cover", "cover_window", "water_trend", "market", "weekly_digest"];

export default function AlertsSettings() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const s = useApp();
  const field = s.field;
  const hist = useAlertsHistoryQ(field?.id);
  const fc = useForecastAlertsQ(field?.id ?? null);
  const [status, setStatus] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const a = s.alerts;
  const setA = (p: Partial<AlertPrefs>) => s.set({ alerts: { ...a, ...p } });
  const tUnit = conv(0, "c", s.units)[1];

  const submit = async () => {
    if (!field) return;
    setBusy(true);
    setStatus(null);
    try {
      const r = await api.subscribe({
        email: a.email,
        field_id: field.id,
        types: a.kinds,
        thresholds: { frost_c: a.frost_c, heat_c: a.heat_c, wind_ms: a.wind_ms, heavy_rain_mm: a.rain_mm },
        // API contract: quiet = [start_hour, end_hour] (integers, local hours).
        quiet: [hourOf(a.quiet_start, 21), hourOf(a.quiet_end, 6)],
        lang,
        units: s.units,
      });
      setStatus({ kind: "ok", text: r.status === "pending_confirmation" ? t("alerts.pending", { channel: r.channel ?? "" }) : (r.message ?? r.status ?? t("alerts.ok")) });
      void hist.refetch();
    } catch (e) {
      setStatus({ kind: "err", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  const items = hist.data?.items ?? [];
  return (
    <div className="page page--narrowish" data-tour="alerts">
      <header className="page__head">
        <h1 className="fs-h1">{t("alerts.title")}</h1>
      </header>
      <div className="two-col">
        <section className="card-sec" aria-labelledby="set-h">
          <h2 id="set-h" className="fs-h2">
            {t("alerts.settings")}
          </h2>
          <div className="form-grid">
            <span className="form-label">{t("alerts.units")}</span>
            <SegmentedToggle label={t("alerts.units")} value={s.units} onChange={(v) => s.set({ units: v })} options={[{ value: "metric", label: t("alerts.metric") }, { value: "imperial", label: t("alerts.imperial") }]} />
            <span className="form-label">{t("alerts.language")}</span>
            <SegmentedToggle
              label={t("alerts.language")}
              value={s.lang}
              onChange={(v) => {
                s.set({ lang: v });
                void i18n.changeLanguage(v);
              }}
              options={[{ value: "en", label: "English" }, { value: "es", label: "Español" }]}
            />
            <span className="form-label">{t("alerts.motion")}</span>
            <SegmentedToggle
              label={t("alerts.motion")}
              value={s.reducedMotion ? "reduce" : "full"}
              onChange={(v) => s.set({ reducedMotion: v === "reduce" })}
              options={[{ value: "full", label: t("alerts.motion_full") }, { value: "reduce", label: t("alerts.motion_reduce") }]}
            />
            <span className="form-label">{t("top.detail")}</span>
            <SegmentedToggle label={t("top.detail")} value={s.mode} onChange={(v) => s.set({ mode: v })} options={[{ value: "simple", label: t("top.simple") }, { value: "expert", label: t("top.expert") }]} />
          </div>
        </section>
        <section className="card-sec" aria-labelledby="sub-h">
          <h2 id="sub-h" className="fs-h2">
            {t("alerts.subscribe_h")}
          </h2>
          {!field ? <StatusBanner kind="no-observation">{t("alerts.need_field")}</StatusBanner> : <p className="fs-meta">{t("alerts.for_field", { name: field.name })}</p>}
          <form
            className="fs-stack"
            style={{ ["--gap" as string]: "12px" }}
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <label className="field-l">
              <span>{t("alerts.email")}</span>
              <input type="email" required value={a.email} onChange={(e) => setA({ email: e.target.value })} autoComplete="email" />
            </label>
            <fieldset className="checks checks--2">
              <legend>{t("alerts.kinds")}</legend>
              {KINDS.map((k) => (
                <label key={k} className="check">
                  <input type="checkbox" checked={a.kinds.includes(k)} onChange={(e) => setA({ kinds: e.target.checked ? [...a.kinds, k] : a.kinds.filter((x) => x !== k) })} />
                  <span>{t(`alerts.kind.${k}`)}</span>
                </label>
              ))}
            </fieldset>
            <fieldset className="thresholds">
              <legend>{t("alerts.thresholds")}</legend>
              <label className="field-l">
                <span>{t("alerts.frost_below", { u: tUnit })}</span>
                <input type="number" step={0.5} value={a.frost_c} onChange={(e) => setA({ frost_c: Number(e.target.value) })} />
              </label>
              <label className="field-l">
                <span>{t("alerts.heat_above", { u: tUnit })}</span>
                <input type="number" step={0.5} value={a.heat_c} onChange={(e) => setA({ heat_c: Number(e.target.value) })} />
              </label>
              <label className="field-l">
                <span>{t("alerts.wind_above")}</span>
                <input type="number" step={0.5} value={a.wind_ms} onChange={(e) => setA({ wind_ms: Number(e.target.value) })} />
              </label>
              <label className="field-l">
                <span>{t("alerts.rain_above")}</span>
                <input type="number" step={1} value={a.rain_mm} onChange={(e) => setA({ rain_mm: Number(e.target.value) })} />
              </label>
              <p className="fs-meta">{t("alerts.threshold_units")}</p>
            </fieldset>
            <fieldset className="thresholds">
              <legend>{t("alerts.quiet")}</legend>
              <label className="field-l">
                <span>{t("alerts.from")}</span>
                <input type="time" value={a.quiet_start} onChange={(e) => setA({ quiet_start: e.target.value })} />
              </label>
              <label className="field-l">
                <span>{t("alerts.to")}</span>
                <input type="time" value={a.quiet_end} onChange={(e) => setA({ quiet_end: e.target.value })} />
              </label>
            </fieldset>
            <Button type="submit" disabled={!field || busy || !a.email} data-tour="subscribe">
              {busy ? t("alerts.sending") : t("alerts.subscribe")}
            </Button>
            {status ? (
              <StatusBanner kind={status.kind === "ok" ? "stale" : "error"} title={status.kind === "ok" ? t("alerts.done") : t("alerts.failed")}>
                {status.text}
              </StatusBanner>
            ) : null}
          </form>
          {/* Wave U9: text-message alerts are planned, not built. The box is disabled; nothing is stored or sent. */}
          <div className="fs-stack" style={{ ["--gap" as string]: "6px", marginTop: "var(--s4)", paddingTop: "var(--s3)", borderTop: "1px solid var(--line)" }} data-testid="sms-soon">
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>
              {t("sms.h")}
            </h3>
            <p className="fs-meta" style={{ margin: 0 }}>
              {t("sms.p")}
            </p>
            <label className="field-l">
              <span>{t("sms.phone")}</span>
              <input type="tel" disabled value="" placeholder={t("sms.ph")} aria-describedby="sms-note" readOnly autoComplete="off" />
            </label>
            <p id="sms-note" className="fs-meta" style={{ margin: 0 }}>
              {t("sms.note")}
            </p>
          </div>
        </section>
      </div>
      {field ? (
        <section className="card-sec" aria-labelledby="fc-h">
          <h2 id="fc-h" className="fs-h2">
            {t("alerts.forecast_h")}
          </h2>
          {fc.isLoading ? <Skeleton lines={3} /> : null}
          {fc.error ? <QueryState error={fc.error} what={t("alerts.forecast_h")} /> : null}
          {fc.data ? (
            <>
              <p className="fs-meta">
                {fc.data.source} · {t("alerts.retrieved", { d: fc.data.retrieved?.slice(0, 16).replace("T", " ") })}
              </p>
              {fc.data.alerts.length ? (
                <ul className="reasons">
                  {fc.data.alerts.map((x) => (
                    <li key={x.key}>
                      <strong>
                        {t(`alerts.kind.${x.type}`, { defaultValue: x.type })} · {x.day}
                      </strong>
                      <span>{x.message}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p>{t("alerts.none_firing")}</p>
              )}
              <ForecastStrip data={fc.data as ForecastWithWarnings} />
            </>
          ) : null}
        </section>
      ) : null}
      <section className="card-sec" aria-labelledby="hist-h">
        <h2 id="hist-h" className="fs-h2">
          {t("alerts.history")}
        </h2>
        {hist.isLoading ? <Skeleton lines={3} /> : null}
        {hist.error ? <QueryState error={hist.error} what={t("alerts.history")} /> : null}
        {hist.data && !items.length ? <p className="fs-meta">{t("alerts.history_empty")}</p> : null}
        {items.length ? (
          <ul className="reasons">
            {items.map((x, i) => (
              <li key={x.id ?? i}>
                <strong>
                  {x.title ?? x.kind ?? x.type} · {x.sent_at ?? x.date}
                </strong>
                <span>{x.message}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </section>
      <Reminder />
    </div>
  );
}
