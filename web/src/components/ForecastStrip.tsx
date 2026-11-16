/* Forecast strip (Alerts): one card per forecast day (high / low, rain, wind) from /forecast-alerts, days with a
   would-fire alert marked, and any official US National Weather Service warnings at the field point. */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, DataButton, StatusBanner, IconAlert, IconExternal } from "../design";
import type { Evidence } from "../design";
import type { ForecastWithWarnings, NwsWarning } from "../apiPlan";
import { useApp } from "../store";
import { cx, fmtU } from "../lib";
import "../plan.css";

const dayDate = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00Z`);

function when(iso: string | null | undefined, lang: string) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(lang === "es" ? "es" : "en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

const SEV_TONE: Record<string, string> = { extreme: "alert", severe: "alert", moderate: "wheat", minor: "nasa" };

export function Warnings({ warnings, note, source, retrieved }: { warnings?: NwsWarning[]; note?: string | null; source?: string | null; retrieved?: string | null }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const ev: Evidence = {
    source: "US National Weather Service",
    product: source ?? "api.weather.gov active alerts at the field point",
    qa_flags: retrieved ? [`Retrieved ${retrieved}`] : [],
    footprint: "NWS forecast zone / county containing the field centre",
    is_nasa: false,
    url: "https://www.weather.gov/alerts",
  };
  return (
    <div className="fc-warn">
      <div className="h-row">
        <h3 className="h4">{t("fc.warnings")}</h3>
        {warnings ? <DataButton evidence={ev} describes={t("fc.warnings")} /> : null}
      </div>
      {!warnings ? (
        <p className="fs-meta">{note ?? t("fc.warnings_unavail")}</p>
      ) : warnings.length === 0 ? (
        <p className="fs-meta">{note ?? t("fc.no_warnings")}</p>
      ) : (
        <ul className="fc-warn__list">
          {warnings.map((w, i) => (
            <li key={`${w.event}-${i}`} className={cx("fc-warn__item", `is-${(w.severity ?? "").toLowerCase()}`)}>
              <div className="fc-warn__head">
                <IconAlert size={16} />
                <strong>{w.event}</strong>
                {w.severity ? <span className={`fs-chip fs-chip--${SEV_TONE[w.severity.toLowerCase()] ?? "outline"}`}>{w.severity}</span> : null}
              </div>
              {w.headline ? <p>{w.headline}</p> : null}
              <p className="fs-meta">
                {[when(w.onset, lang) && `${t("fc.from")} ${when(w.onset, lang)}`, when(w.ends, lang) && `${t("fc.until")} ${when(w.ends, lang)}`, w.sender].filter(Boolean).join(" · ")}
              </p>
              {w.url && /^https?:/.test(w.url) ? (
                <a className="fs-link" href={w.url} target="_blank" rel="noopener noreferrer">
                  {t("fc.read_warning")} <IconExternal size={12} />
                </a>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <p className="fs-meta">{t("fc.warnings_help")}</p>
    </div>
  );
}

export default function ForecastStrip({ data }: { data: ForecastWithWarnings }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const units = useApp((s) => s.units);
  const [table, setTable] = useState(false);
  // The API also returns the past days (used for dry-spell alerts); the strip shows today and the days ahead.
  const all = data.forecast;
  const today = (data.retrieved ?? new Date().toISOString()).slice(0, 10);
  const keep = (all?.time ?? []).map((d, i) => [d, i] as const).filter(([d]) => d.slice(0, 10) >= today).slice(0, 7).map(([, i]) => i);
  const f = all
    ? {
        time: keep.map((i) => all.time[i]),
        temperature_2m_max: keep.map((i) => all.temperature_2m_max[i]),
        temperature_2m_min: keep.map((i) => all.temperature_2m_min[i]),
        precipitation_sum: keep.map((i) => all.precipitation_sum[i]),
        wind_speed_10m_max: keep.map((i) => all.wind_speed_10m_max[i]),
      }
    : undefined;
  const ev: Evidence = {
    source: "Open-Meteo",
    product: data.source ?? "Open-Meteo forecast API",
    observation_start: f?.time?.[0],
    observation_end: f?.time?.[f.time.length - 1],
    effective_res: t("fc.scale"),
    qa_flags: data.retrieved ? [`Retrieved ${data.retrieved}`] : [],
    is_nasa: false,
    url: "https://open-meteo.com/",
  };
  const byDay = new Map<string, string[]>();
  for (const a of data.alerts ?? []) byDay.set(a.day, [...(byDay.get(a.day) ?? []), t(`alerts.kind.${a.type}`, { defaultValue: a.type })]);
  return (
    <div className="fc">
      {f?.time?.length ? (
        <>
          <div className="h-row">
            <h3 className="h4">
              {t("fc.title", { n: f.time.length })} <DataButton evidence={ev} describes={t("fc.title", { n: f.time.length })} />
            </h3>
            <Button variant="ghost" size="sm" onClick={() => setTable((v) => !v)} aria-pressed={table}>
              {table ? t("fc.show_cards") : t("common.show_table")}
            </Button>
          </div>
          {table ? (
            <div className="table-scroll">
              <table className="fs-table compact">
                <thead>
                  <tr>
                    <th scope="col">{t("alerts.day")}</th>
                    <th scope="col">{t("alerts.tmin")}</th>
                    <th scope="col">{t("alerts.tmax")}</th>
                    <th scope="col">{t("clim.precip")}</th>
                    <th scope="col">{t("alerts.wind")}</th>
                  </tr>
                </thead>
                <tbody>
                  {f.time.map((d, i) => (
                    <tr key={d}>
                      <th scope="row">{d}</th>
                      <td>{fmtU(f.temperature_2m_min[i], "c", units, lang)}</td>
                      <td>{fmtU(f.temperature_2m_max[i], "c", units, lang)}</td>
                      <td>{fmtU(f.precipitation_sum[i], "mm", units, lang)}</td>
                      <td>{fmtU(f.wind_speed_10m_max[i], "ms", units, lang)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <ol className="fc-strip">
              {f.time.map((d, i) => {
                const flags = byDay.get(d) ?? [];
                const dt = dayDate(d);
                return (
                  <li key={d} className={cx("fc-day", flags.length > 0 && "is-flagged")}>
                    <span className="fc-day__name">{dt.toLocaleDateString(lang === "es" ? "es" : "en-US", { weekday: "short", timeZone: "UTC" })}</span>
                    <span className="fc-day__date">{dt.toLocaleDateString(lang === "es" ? "es" : "en-US", { month: "short", day: "numeric", timeZone: "UTC" })}</span>
                    <span className="fc-day__t">
                      <strong>{fmtU(f.temperature_2m_max[i], "c", units, lang, 0)}</strong>
                      <span className="fs-meta"> / {fmtU(f.temperature_2m_min[i], "c", units, lang, 0)}</span>
                    </span>
                    <span className="fc-day__v">
                      <span className="fs-visually-hidden">{t("clim.precip")}: </span>
                      {fmtU(f.precipitation_sum[i], "mm", units, lang)}
                    </span>
                    <span className="fc-day__v">
                      <span className="fs-visually-hidden">{t("alerts.wind")}: </span>
                      {fmtU(f.wind_speed_10m_max[i], "ms", units, lang)}
                    </span>
                    {flags.length ? (
                      <span className="fc-day__flag">
                        <IconAlert size={12} /> {flags.join(", ")}
                      </span>
                    ) : null}
                  </li>
                );
              })}
            </ol>
          )}
          <p className="fs-meta">{t("fc.legend")}</p>
        </>
      ) : (
        <StatusBanner kind="no-observation">{t("fc.none")}</StatusBanner>
      )}
      <Warnings warnings={data.warnings} note={data.warnings_note} source={data.warnings_source} retrieved={data.warnings_retrieved} />
    </div>
  );
}
