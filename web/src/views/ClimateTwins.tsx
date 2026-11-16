/* Climate Twins: where the field's climate is heading (2040s, NEX-GDDP-CMIP6) and the present-day places that already have it. */
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Chip, SegmentedToggle, SIButton, Skeleton, StatusBanner, ConfidenceChip } from "../design";
import type { GlobeArc, MapHandle } from "../mapBridge";
import { GlobeView, FlatMap } from "../mapBridge";
import { useTwinsQ } from "../api";
import type { TwinPlace } from "../api";
import { useApp } from "../store";
import { Ev, NeedField, QueryState, Reminder } from "../components/common";
import { conv, cx, nice, toConfidence } from "../lib";

const IND_UNIT: Record<string, "c" | "mm" | "none"> = { tmean_c: "c", tmax_warm_c: "c", tmin_cold_c: "c", precip_mm: "mm" };

const placeName = (p?: TwinPlace) => (p ? [p.near_town, p.admin1, p.country].filter(Boolean).join(", ") : "");

export default function ClimateTwins() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const field = useApp((s) => s.field);
  const units = useApp((s) => s.units);
  const dim = useApp((s) => s.dim);
  const q = useTwinsQ(field?.id ?? null);
  const [ssp, setSsp] = useState("ssp245");
  const d = q.data;
  const sc = d?.scenarios?.[ssp];
  const mapRef = useRef<MapHandle>(null);
  const flyLat = d?.field?.lat;
  const flyLon = d?.field?.lon;
  useEffect(() => {
    if (flyLat === undefined || flyLon === undefined) return;
    const id = setTimeout(() => mapRef.current?.flyTo({ lat: flyLat, lon: flyLon, height: 4_500_000, duration: 2 }), 600);
    return () => clearTimeout(id);
  }, [flyLat, flyLon]);
  const arcs: GlobeArc[] = useMemo(() => {
    if (!d?.field || !sc?.analogs) return [];
    return sc.analogs.slice(0, 4).map((a, i) => ({
      id: `a${i}`,
      from: { lat: d.field!.lat, lon: d.field!.lon, label: t("twins.your_farm") },
      to: { lat: a.lat, lon: a.lon, label: placeName(a) },
      color: i === 0 ? "#C8902A" : "#6B4FA0",
      dashed: i > 0,
      width: i === 0 ? 3 : 1.5,
    }));
  }, [d, sc, t]);
  if (!field) return <NeedField />;
  const top = sc?.analogs?.[0];
  const agree = sc?.agreement;
  const Map = dim === "2d" ? FlatMap : GlobeView;
  const si = d
    ? {
        model_name: t("twins.model", { id: d.model_id ?? "M7" }),
        kind: (d.kind ?? "process") as "process",
        version: d.model_version,
        top_drivers: (d.analog_method?.features ?? []).slice(0, 4).map((f) => ({ name: f })),
        confidence: toConfidence(d.confidence),
        information_cutoff: d.periods?.analog_present_day?.[1]?.replace(/(\d{4})(\d{2})(\d{2})/, "$1-$2-$3"),
        model_card_url: "#/sources",
      }
    : null;

  return (
    <div className="page twins" data-tour="twins">
      <header className="page__head">
        <div>
          <h1 className="fs-h1">{t("twins.title", { name: field.name })}</h1>
          <p className="fs-meta">{t("twins.sub")}</p>
        </div>
        {d?.scenarios ? (
          <SegmentedToggle
            label={t("twins.scenario")}
            value={ssp}
            onChange={setSsp}
            options={Object.keys(d.scenarios).map((k) => ({ value: k, label: k === "ssp245" ? t("twins.ssp245") : k === "ssp585" ? t("twins.ssp585") : k }))}
          />
        ) : null}
      </header>
      {q.isLoading ? <Skeleton height={360} /> : null}
      {q.error ? <QueryState error={q.error} what={t("nav.twins")} onRetry={() => void q.refetch()} /> : null}
      {d?.status === "loading" ? (
        <StatusBanner kind="loading" title={t("twins.loading_title")}>
          {t("twins.loading")}
        </StatusBanner>
      ) : null}
      {d?.status === "failed" ? <StatusBanner kind="error">{d.error ?? d.reason ?? t("twins.failed")}</StatusBanner> : null}
      {d?.status === "ready" && sc ? (
        <div className="twins-grid">
          <section className="card-sec twins-left" aria-labelledby="tw-now">
            <h2 id="tw-now" className="fs-h2">
              {t("twins.now_vs", { a: d.periods?.future?.[0], b: d.periods?.future?.[1] })}
            </h2>
            <p className="fs-meta">
              {d.baseline?.scale_label} <Ev id={d.evidence_ids?.power} ev={d.evidence?.[d.evidence_ids?.power ?? ""]} describes={t("twins.baseline")} />{" "}
              <Ev ev={d.evidence?.[d.evidence_ids?.nex_gddp ?? ""]} describes={t("twins.future")} />
            </p>
            <table className="fs-table compact">
              <thead>
                <tr>
                  <th scope="col">{t("twins.indicator")}</th>
                  <th scope="col">{t("twins.now", { a: d.periods?.baseline?.[0], b: d.periods?.baseline?.[1] })}</th>
                  <th scope="col" className="purple">
                    {t("twins.future_col")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(sc.indicators)
                  .filter(([k]) => k !== "frost_free_years")
                  .map(([k, v]) => {
                    const u = IND_UNIT[k] ?? "none";
                    const f = (x: number | undefined) => (u === "none" ? nice(x, lang) : nice(conv(x, u, units)[0], lang));
                    const unit = u === "none" ? "" : conv(0, u, units)[1];
                    return (
                      <tr key={k}>
                        <th scope="row">
                          {t(`twins.ind.${k}`, { defaultValue: k })} {unit ? <span className="unit">({unit})</span> : null}
                        </th>
                        <td>{f(d.baseline?.indicators?.[k])}</td>
                        <td className="purple">
                          {f(v.median)} <span className="fs-meta">({f(v.min)}–{f(v.max)})</span>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
            <p className="callout callout--purple">{t("twins.starting_point")}</p>
          </section>
          <section className="twins-map" aria-label={t("twins.map")}>
            <Map ref={mapRef} fieldGeometry={field.geometry ?? null} arcs={arcs} autoRotate={false} ariaLabel={t("twins.map")} />
            <div className="map-caption fs-on-imagery">{t("twins.arc_legend")}</div>
          </section>
          <aside className="twins-right">
            <article className="card-sec twin-card" aria-labelledby="tw-card">
              <div className="h-row">
                <h2 id="tw-card" className="fs-overline purple">
                  {t("twins.card_h", { a: d.periods?.future?.[0], b: d.periods?.future?.[1] })}
                </h2>
                {si ? <SIButton record={si} describes={t("nav.twins")} /> : null}
              </div>
              {sc.novel_climate?.flag ? (
                <StatusBanner kind="unsupported" title={t("twins.novel")}>
                  {t("twins.novel_body")}
                </StatusBanner>
              ) : (
                <p>{t("twins.resemble", { place: placeName(top), km: nice(top?.km_from_field, lang) })}</p>
              )}
              {agree ? (
                <div className="agree">
                  <div className="agree__boxes" aria-hidden="true">
                    {Array.from({ length: agree.n_models }, (_, i) => (
                      <span key={i} className={cx("agree__box", i < agree.n_agree && "is-on")} />
                    ))}
                  </div>
                  <span>{t("twins.agree", { a: agree.n_agree, n: agree.n_models, km: nice(agree.radius_km, lang) })}</span>
                </div>
              ) : null}
              {d.confidence ? <ConfidenceChip confidence={toConfidence(d.confidence)} /> : null}
              {top?.crops?.top?.length ? (
                <>
                  <h3 className="h4">
                    {t("twins.grows_there")} <Ev ev={d.evidence?.[d.evidence_ids?.crops ?? ""]} describes={t("twins.grows_there")} />
                  </h3>
                  <p className="fs-meta">{top.crops.label}</p>
                  <ul className="bars">
                    {top.crops.top.slice(0, 5).map((c) => (
                      <li key={c.crop} className="bars__row">
                        <span className="bars__label">{c.crop}</span>
                        <span className="bars__track">
                          <span className="bars__fill" style={{ width: `${Math.round(c.share * 100)}%`, background: "var(--purple)" }} />
                        </span>
                        <span className="bars__val">{Math.round(c.share * 100)}%</span>
                      </li>
                    ))}
                  </ul>
                  <Chip tone="alert">{t("ar.common_not_suitable")}</Chip>
                </>
              ) : null}
            </article>
            <article className="card-sec">
              <h3 className="h4">{t("twins.other_analogs")}</h3>
              <ul className="reasons">
                {sc.analogs.slice(1, 5).map((a, i) => (
                  <li key={i}>
                    <strong>{placeName(a)}</strong>
                    <span>{t("twins.analog_line", { km: nice(a.km_from_field, lang), n: a.n_models_agree ?? 0, m: sc.n_models })}</span>
                  </li>
                ))}
              </ul>
            </article>
            <article className="card-sec callout--alert">
              <h3 className="h4">{t("card.check_locally")}</h3>
              <ul className="bul">
                <li>{t("twins.check1")}</li>
                <li>{t("twins.check2")}</li>
                <li>{t("twins.check3")}</li>
              </ul>
            </article>
          </aside>
        </div>
      ) : null}
      {d?.status === "ready" && !sc ? <StatusBanner kind="unsupported">{t("twins.no_scenario")}</StatusBanner> : null}
      <Reminder />
    </div>
  );
}
