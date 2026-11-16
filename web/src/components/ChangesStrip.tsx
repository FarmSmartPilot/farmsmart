/* "Changes since your last visit": a small per-field snapshot in localStorage (this-season rain and root-zone
   wetness percentiles, forecast alert count, top option) compared with the values the API returns now. */
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, IconClock, IconClose } from "../design";
import { useForecastAlertsQ, useReportQ } from "../api";
import { useApp, safeStorage } from "../store";
import { useCompare } from "../views/Options";
import { isNum, ordinal } from "../lib";

interface Snap {
  t: string;
  season_year?: number | null;
  rain_pct?: number | null;
  wet_pct?: number | null;
  alerts?: number | null;
  top?: string | null;
  top_name?: string | null;
}

/* Session memory: the diff is computed once per field per page load, so switching tabs keeps the strip. */
interface Out {
  id: string;
  since: string;
  items: string[];
}
/** null = first visit to this field (nothing to compare with). */
const sessionOut = new Map<string, Out | null>();
const sessionDismissed = new Set<string>();
/** Fields opened by the Demo tour in this page load: never compared or snapshotted. */
const demoSeen = new Set<string>();

const KEY = (id: string) => `fieldshift-visit:${id}`;

function readSnap(id: string): Snap | null {
  try {
    const raw = safeStorage.getItem(KEY(id));
    if (typeof raw !== "string") return null;
    const s = JSON.parse(raw) as Snap;
    return s && typeof s.t === "string" ? s : null;
  } catch {
    return null;
  }
}

function writeSnap(id: string, s: Snap) {
  try {
    void safeStorage.setItem(KEY(id), JSON.stringify(s));
  } catch {
    /* storage blocked: no memory of this visit */
  }
}

/** Percentile changes smaller than this many points are not reported. */
const PCT_STEP = 5;

export default function ChangesStrip() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const field = useApp((s) => s.field);
  const scenario = useApp((s) => s.scenario);
  const id = field?.id ?? null;
  const report = useReportQ(id);
  const cmp = useCompare();
  const fc = useForecastAlertsQ(id);
  const done = useRef<string | null>(null);
  const [out, setOut] = useState<Out | null>(() => (id ? (sessionOut.get(id) ?? null) : null));
  const [dismissed, setDismissed] = useState<string | null>(() => (id && sessionDismissed.has(id) ? id : null));

  const tourOpen = useApp((s) => s.tourOpen);
  const reportDone = !!id && !report.isLoading;
  const cmpDone = !cmp.isLoading && (!cmp.isFetching || !!cmp.error);
  const fcDone = !fc.isLoading;

  useEffect(() => {
    if (!id || done.current === id || !reportDone || !cmpDone || !fcDone) return;
    // Demo-tour and automated (QC) visits are not "your" visits: no snapshot, no banner.
    if (tourOpen || demoSeen.has(id) || (typeof navigator !== "undefined" && navigator.webdriver)) {
      if (tourOpen) demoSeen.add(id);
      return;
    }
    done.current = id;
    if (sessionOut.has(id)) {
      setOut(sessionOut.get(id) ?? null);
      return;
    }
    const prev = readSnap(id);
    const season = report.data?.season;
    const m = season?.available ? season.metrics : undefined;
    const c = cmp.data?.supported && scenario === "normal" ? cmp.data : undefined;
    const top = c?.cards.find((k) => k.best_for_you) ?? c?.all_cards.find((k) => k.rank === 1);
    const now: Snap = {
      t: new Date().toISOString(),
      season_year: season?.year ?? prev?.season_year ?? null,
      rain_pct: isNum(m?.precip?.percentile) ? m!.precip.percentile : (prev?.rain_pct ?? null),
      wet_pct: isNum(m?.rootzone_wetness?.percentile) ? m!.rootzone_wetness.percentile : (prev?.wet_pct ?? null),
      alerts: fc.data ? fc.data.alerts.length : (prev?.alerts ?? null),
      top: top ? top.id : (prev?.top ?? null),
      top_name: top ? (top.is_baseline ? `${t("options.current")}: ${top.rotation_label}` : top.name) : (prev?.top_name ?? null),
    };
    writeSnap(id, now);
    if (!prev) {
      sessionOut.set(id, null);
      return;
    }
    const items: string[] = [];
    const pct = (a: number) => ordinal(Math.round(a), lang);
    if (isNum(prev.rain_pct) && isNum(now.rain_pct) && Math.abs(now.rain_pct - prev.rain_pct) >= PCT_STEP)
      items.push(t("changes.rain", { a: pct(prev.rain_pct), b: pct(now.rain_pct) }));
    if (isNum(prev.wet_pct) && isNum(now.wet_pct) && Math.abs(now.wet_pct - prev.wet_pct) >= PCT_STEP)
      items.push(t("changes.wet", { a: pct(prev.wet_pct), b: pct(now.wet_pct) }));
    if (isNum(prev.alerts) && isNum(now.alerts) && prev.alerts !== now.alerts) items.push(t("changes.alerts", { a: prev.alerts, b: now.alerts }));
    if (prev.top && now.top && prev.top !== now.top) items.push(t("changes.top", { a: prev.top_name ?? prev.top, b: now.top_name ?? now.top }));
    if (isNum(prev.season_year) && isNum(now.season_year) && prev.season_year !== now.season_year) items.push(t("changes.season", { a: prev.season_year, b: now.season_year }));
    const res = { id, since: prev.t, items };
    sessionOut.set(id, res);
    setOut(res);
  }, [id, reportDone, cmpDone, fcDone, report.data, cmp.data, fc.data, scenario, t, lang, tourOpen]);

  // Only something meaningful is shown: no "nothing changed" banner, and never while the Demo runs.
  if (!id || !out || out.id !== id || !out.items.length || tourOpen || dismissed === id || sessionDismissed.has(id)) return null;
  const since = new Date(out.since);
  const when = Number.isNaN(since.getTime()) ? out.since : since.toLocaleDateString(lang === "es" ? "es" : "en-US", { dateStyle: "medium" });
  return (
    <div className="changes changes--compact" role="status" data-tour="changes">
      <IconClock size={14} />
      <p className="changes__body">
        <strong>{t("changes.title", { when })}</strong> {out.items.join(" · ")}
      </p>
      <Button variant="ghost" size="sm" className="fs-btn--icon tap44" aria-label={t("changes.dismiss")} onClick={() => {
        if (id) sessionDismissed.add(id);
        setDismissed(id);
      }} icon={<IconClose size={14} />} />
    </div>
  );
}
