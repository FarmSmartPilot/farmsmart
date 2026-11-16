/* "Weather that favours crop disease" (wave U9): GET /api/fields/{fid}/disease. The published UW-Madison models (tar
   spot, gray leaf spot, white mold) re-run on NASA POWER hourly weather at the field (≈50 km): for each past summer,
   the share of days from July 1 to August 15 whose weather the model puts in its high-risk class. It never says the
   disease is present and is not a yield-loss number. When a model saturates (every year high), the API says so and the
   panel compares years by the model's mean score instead. Also lists the pathogen groups the field's recent crops
   carry (rotation hosts). An SI button carries the API's confidence and reasons; the weather has a NASA button. */
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { DataButton, IconCheck, SIButton, Skeleton } from "../design";
import type { Evidence, SIRecord } from "../design";
import { ApiError, useCropsQ } from "../api";
import { cx } from "../lib";
import "../money.css";

interface DiseaseModel {
  id: string;
  crop: string;
  name_en: string;
  name_es?: string | null;
  pathogen?: string;
  primary?: boolean;
  source?: string;
  url?: string;
  paper?: string | null;
  valid_region?: string;
  stages?: string;
  window?: { from?: string; to?: string; note?: string | null } | null;
  inputs?: string[];
  years: number[];
  share_high_risk_days: (number | null)[];
  share_moderate_days?: (number | null)[];
  mean_prob?: (number | null)[];
  typical?: number | null;
  p90_year?: number | null;
  last_year?: number | null;
  last_year_label?: number | null;
  this_season?: { year: number; through?: string; complete?: boolean; share_high_risk_days?: number | null; days_so_far?: number } | null;
  note?: string | null;
  note_es?: string | null;
}
interface HostGroup {
  id: string;
  name_en: string;
  name_es?: string;
  kind?: string;
  in_recent_crops?: string[];
  advice_en?: string | null;
  advice_es?: string | null;
}
export interface DiseaseData {
  available: boolean;
  reason?: string | null;
  reason_es?: string | null;
  models?: DiseaseModel[];
  weather?: { source?: string; product?: string; url?: string; footprint?: string; missing_share?: number } | null;
  note?: string;
  note_es?: string;
  scale?: string;
  si?: { confidence?: "high" | "medium" | "low"; score?: number; reasons?: string[]; method?: string } | null;
  rotation_hosts?: { recent_crops?: { year: number; crop: string }[]; groups?: HostGroup[]; source?: string } | null;
}

async function getDisease(fid: string): Promise<DiseaseData | null> {
  const res = await fetch(`/api/fields/${fid}/disease`);
  if (res.status === 404 || res.status === 405) return null; // an API without this route: nothing to show
  if (!res.ok) throw new ApiError(res.status, res.statusText);
  return res.json() as Promise<DiseaseData>;
}

export const useDiseaseQ = (fid: string | null) =>
  useQuery({ queryKey: ["disease", fid], queryFn: () => getDisease(fid!), enabled: !!fid, staleTime: 60 * 60_000, retry: 1 });

const fin = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const med = (xs: (number | null)[]) => {
  const v = xs.filter(fin).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
};

/** Which models to show: the primary ones, and for an irrigated field the irrigated white-mold variants instead of the
    dryland one. `crops` limits them to the crops in play (money page). */
function pick(models: DiseaseModel[], irrigated: boolean, crops?: string[]) {
  const irrPath = new Set(models.filter((m) => m.primary === false && /irrigated/.test(m.id)).map((m) => m.pathogen));
  return models.filter((m) => {
    if (crops && !crops.includes(m.crop)) return false;
    if (irrigated) return m.primary === false ? /irrigated/.test(m.id) : !irrPath.has(m.pathogen);
    return m.primary !== false;
  });
}

function Bars({ years, values, label, scaleMax = 1 }: { years: number[]; values: (number | null)[]; label: string; scaleMax?: number }) {
  return (
    <div className="dz-bars" role="img" aria-label={label}>
      {years.map((y, i) => {
        const v = values[i];
        const h = fin(v) ? Math.max(2, Math.round((v / scaleMax) * 100)) : 0;
        return (
          <span key={y} className="dz-bar" title={fin(v) ? `${y}: ${Math.round(v * 100)}%` : `${y}: —`}>
            <span className={cx("dz-bar__fill", !fin(v) && "is-none")} style={{ height: `${h}%` }} />
          </span>
        );
      })}
      <span className="dz-bars__y0 fs-meta">{years[0]}</span>
      <span className="dz-bars__y1 fs-meta">{years[years.length - 1]}</span>
    </div>
  );
}

export default function DiseasePanel({
  fid,
  irrigated = false,
  crops,
  variant = "field",
}: {
  fid: string;
  irrigated?: boolean;
  /** Only models for these crops (money page: the crops in play). */
  crops?: string[];
  /** "field": a fact row on My field (with the rotation hosts); "money": a group in "What can go wrong here". */
  variant?: "field" | "money";
}) {
  const { t, i18n } = useTranslation();
  const es = i18n.language === "es";
  const q = useDiseaseQ(fid);
  const kb = useCropsQ();
  const pctF = new Intl.NumberFormat(es ? "es" : "en-US", { style: "percent", maximumFractionDigits: 0 });
  const pct = (v: number | null | undefined) => (fin(v) ? pctF.format(v) : "—");
  const cropName = (id: string) => {
    const c = kb.data?.[id];
    return ((es && c?.name_es) || c?.name || id.replace(/_/g, " ")).split(" (")[0].toLowerCase();
  };
  const d = q.data;
  if (d === null) return null;

  const si: SIRecord | null = d?.available && d.si
    ? {
        model_name: t("disease.si_name"),
        kind: "si",
        top_drivers: [{ name: t("disease.driver_weather") }, { name: t("disease.driver_window") }],
        confidence: { level: d.si.confidence ?? "low", reasons: d.si.reasons ?? [] },
        model_card_url: "#/sources",
      }
    : null;
  const wEv: Evidence | null = d?.weather
    ? {
        source: d.weather.source ?? "NASA POWER",
        product: d.weather.product ?? "hourly weather",
        url: d.weather.url,
        footprint: d.weather.footprint,
        effective_res: d.scale,
        native_res: "≈50 km",
        is_nasa: true,
      }
    : null;

  let body;
  if (q.isLoading) {
    body = (
      <>
        <p className="fs-meta">{t("disease.loading")}</p>
        <Skeleton lines={3} />
      </>
    );
  } else if (q.isError || !d) {
    body = <p className="fs-meta">{t("disease.failed")}</p>;
  } else {
    const models = d.available ? pick(d.models ?? [], irrigated, crops) : [];
    const groups = variant === "field" ? (d.rotation_hosts?.groups ?? []) : [];
    body = (
      <>
        {!d.available ? <p className="fs-meta">{t("disease.unavail", { reason: (es && d.reason_es) || d.reason || "—" })}</p> : null}
        {d.available && !models.length ? <p className="fs-meta">{t("disease.none_for_crops")}</p> : null}
        {models.length ? (
          <ul className="dz-models">
            {models.map((m) => {
              const name = (es && m.name_es) || m.name_en;
              const sat = !!(m.note || m.note_es);
              const mp = m.mean_prob ?? [];
              const ly = m.last_year_label;
              const lastMp = ly != null ? mp[m.years.indexOf(ly)] : null;
              const season = m.this_season && ly != null && m.this_season.year > ly ? m.this_season : null;
              return (
                <li key={m.id} className="dz-model" data-model={m.id}>
                  <p className="dz-model__name">
                    {name} <span className="fs-meta">({cropName(m.crop)})</span>
                  </p>
                  {sat ? (
                    <>
                      <p className="money-note" data-k="saturated">
                        {/* The API's note names its field ("mean_prob"); say it in plain words. */}
                        {((es && m.note_es) || m.note || "").replace(/mean_prob/g, t("disease.mean_word"))}
                      </p>
                      <p className="dz-model__line">{t("disease.mean_line", { typ: pct(med(mp)), y: ly ?? "—", last: pct(lastMp) })}</p>
                      <Bars years={m.years} values={mp} label={t("disease.bars_mean", { name })} />
                    </>
                  ) : (
                    <>
                      <p className="dz-model__line" data-k="typical">
                        {t("disease.typ_line", { name: name.split(" (")[0].toLowerCase(), typ: pct(m.typical), y: ly ?? "—", last: pct(m.last_year), p90: pct(m.p90_year) })}
                      </p>
                      <Bars years={m.years} values={m.share_high_risk_days} label={t("disease.bars_high", { name })} />
                    </>
                  )}
                  {season && !sat && fin(season.share_high_risk_days) ? (
                    <p className="fs-meta">
                      {season.complete
                        ? t("disease.season_done", { y: season.year, v: pct(season.share_high_risk_days) })
                        : t("disease.season_sofar", { y: season.year, v: pct(season.share_high_risk_days), n: season.days_so_far ?? "—" })}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : null}
        {d.available ? (
          <p className="money-note" data-testid="disease-note">
            {(es && d.note_es) || d.note}
          </p>
        ) : null}
        {groups.length ? (
          <div className="peers__block" data-testid="disease-hosts">
            <p className="peers__h">{t("disease.hosts_h")}</p>
            <ul className="mini-list">
              {groups.map((g) => (
                <li key={g.id}>
                  <strong>{(es && g.name_es) || g.name_en}</strong>
                  {g.in_recent_crops?.length ? ` ${t("disease.hosts_on", { crops: g.in_recent_crops.map(cropName).join(", ") })}` : ""}
                  {(es && g.advice_es) || g.advice_en ? <span className="fs-meta"> {(es && g.advice_es) || g.advice_en}</span> : null}
                </li>
              ))}
            </ul>
            {d.rotation_hosts?.source ? <p className="fs-meta">{d.rotation_hosts.source}</p> : null}
          </div>
        ) : null}
        {d.available && models.length ? (
          <details className="peers__more">
            <summary>{t("disease.more")}</summary>
            <ul className="mini-list">
              {models.map((m) => (
                <li key={m.id} className="fs-meta">
                  {(es && m.name_es) || m.name_en}: {m.window?.note ?? ""} {m.inputs?.length ? `${t("disease.inputs")}: ${m.inputs.join("; ")}.` : ""}{" "}
                  {m.valid_region ? `${t("disease.region")}: ${m.valid_region}.` : ""} {m.paper ?? ""}
                </li>
              ))}
            </ul>
            <p className="fs-meta">
              {models[0]?.source}
              {models[0]?.url ? ` · ${models[0].url}` : ""}
            </p>
            {d.scale ? <p className="fs-meta">{d.scale}</p> : null}
          </details>
        ) : null}
      </>
    );
  }

  const head = (
    <>
      {t("disease.h")}
      {wEv ? <DataButton evidence={wEv} describes={t("disease.h")} /> : null}
      {si ? <SIButton record={si} describes={t("disease.h")} /> : null}
    </>
  );
  if (variant === "money") {
    return (
      <div className="money-haz__group dz" data-testid="disease">
        <h3 className="money-haz__h">{head}</h3>
        <div className="peers__body">{body}</div>
      </div>
    );
  }
  return (
    <div className="fact dz" data-testid="disease">
      <span className="fact__check" aria-hidden="true">
        <IconCheck size={12} />
      </span>
      <div className="fact__body">
        <div className="fact__label">{head}</div>
        <div className="fact__value peers__body">{body}</div>
      </div>
    </div>
  );
}
