/* Season outlook (wave U8): NOAA Climate Prediction Center's official outlook at the field point, from
   GET /api/fields/{fid}/outlook. One plain sentence for the next season ("NOAA's outlook for Dec–Feb: 40 % chance
   warmer than normal; equal chances for rain"), the issue date and the regional caveat; later seasons behind
   "Show …". Chances for a large region, never a forecast for the field. US only (NOAA covers the United States). */
import { useId } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { DataButton, Skeleton } from "../design";
import type { Evidence } from "../design";
import { ApiError } from "../api";
import { useOutlookQ } from "../apiMoney";
import type { OutlookData, OutlookItem } from "../apiMoney";
import { cx } from "../lib";
import "../money.css";

const fin = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function cat(c: string | null | undefined): "above" | "below" | "near" | "ec" | null {
  const s = String(c ?? "").toLowerCase();
  if (!s) return null;
  if (s.startsWith("above") || s === "a" || s === "warm" || s === "wet") return "above";
  if (s.startsWith("below") || s === "b" || s === "cold" || s === "dry") return "below";
  if (s.startsWith("near") || s === "normal" || s === "n") return "near";
  if (s.startsWith("equal") || s === "ec") return "ec";
  return null;
}

/** "40 % chance warmer than normal" / "equal chances for rain". */
function part(kind: "temp" | "precip", b: OutlookItem["temp"], t: TFunction, pct: (p: number) => string): string | null {
  const c = cat(b?.category);
  if (!c) return null;
  if (c === "ec" || !fin(b?.p)) return t(`outlook.${kind}_ec`);
  // CPC maps probability classes (e.g. 40–50 %): say the class when the API gives it.
  const band = b?.p_band;
  const p = band && band.length === 2 && fin(band[0]) && fin(band[1]) ? `${pct(band[0])}–${pct(band[1])}` : pct(b!.p!);
  return t(`outlook.${kind}_${c}`, { p });
}

export function outlookSentence(it: OutlookItem, t: TFunction, lang: string): string {
  const pct = (p: number) => String(Math.round((p > 1 ? p / 100 : p) * 100));
  const season = (lang === "es" && it.label_es) || it.label_en || it.season || "—";
  const bits = [part("temp", it.temp, t, pct), part("precip", it.precip, t, pct)].filter(Boolean);
  return bits.length ? t("outlook.line", { season, what: bits.join("; ") }) : t("outlook.line_none", { season });
}

function evidence(d: OutlookData, t: TFunction): Evidence {
  return {
    source: d.source ?? "NOAA Climate Prediction Center",
    product: t("outlook.product"),
    effective_res: d.scale ?? t("outlook.scale"),
    observation_start: d.issued ?? undefined,
    url: d.url ?? undefined,
    qa_flags: [t("outlook.caveat")],
    is_nasa: false,
  };
}

/** `as`: "card" (guided step 4, its own panel) or "group" (inside the money page's "What can go wrong here"). */
export default function Outlook({ fid, as = "card" }: { fid: string | null; as?: "card" | "group" }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const q = useOutlookQ(fid);
  const hId = useId();
  const d = q.data;
  const dateFmt = (s: string | null | undefined) => {
    if (!s) return "—";
    const dt = new Date(`${s.slice(0, 10)}T12:00:00Z`);
    return Number.isNaN(dt.getTime()) ? s : dt.toLocaleDateString(lang === "es" ? "es" : "en-US", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  };
  const H = as === "card" ? "h2" : "h3";
  const items = (d?.items ?? []).filter(Boolean);
  // Later seasons and the 1-month outlook (this month) go behind "Show …".
  const rest = [...(d?.month ? [d.month] : []), ...items.slice(1)];
  const notYet = q.isError && q.error instanceof ApiError && (q.error.status === 404 || q.error.status === 405);
  const body = q.isLoading ? (
    <Skeleton lines={2} />
  ) : q.isError ? (
    <p className="fs-meta">{notYet ? t("outlook.not_yet") : t("outlook.error")}</p>
  ) : !d || !d.available ? (
    <p className="fs-meta">{d?.reason || t("outlook.us_only")}</p>
  ) : !items.length ? (
    <p className="fs-meta">{t("outlook.none")}</p>
  ) : (
    <>
      <p className="outlook__lead" data-k="outlook">
        {outlookSentence(items[0], t, lang)}
      </p>
      <p className="fs-meta">
        {t("outlook.issued", { date: dateFmt(d.issued) })} {(lang === "es" && d.note_es) || d.note_en || t("outlook.caveat")}
      </p>
      {rest.length ? (
        <details className="money-more">
          <summary>{t("outlook.more", { count: rest.length })}</summary>
          <ul className="outlook__list">
            {rest.map((it, i) => (
              <li key={`${it.season ?? i}-${it.lead ?? i}`}>{outlookSentence(it, t, lang)}</li>
            ))}
          </ul>
        </details>
      ) : null}
    </>
  );
  return (
    <section className={cx("outlook", as === "card" ? "panel outlook--card" : "money-haz__group")} aria-labelledby={hId} data-tour="outlook">
      <H id={hId} className={as === "card" ? "guided__h2" : "money-haz__h"}>
        {t("outlook.title")} {d?.available ? <DataButton evidence={evidence(d, t)} describes={t("outlook.title")} /> : null}
      </H>
      {body}
    </section>
  );
}
