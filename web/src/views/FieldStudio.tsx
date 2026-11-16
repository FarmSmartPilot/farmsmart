/* Field Studio: MY FIELD (left), map + Area Report (center), ROTATION OPTIONS (right), SEASON TIMELINE (bottom).
   Below 768 px it collapses to bottom tabs: Map · Options · Timeline · My Field. */
import { useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { SegmentedToggle, StatusBanner, useMediaQuery, IconMap, IconLayers, IconClock, IconSprout, Button } from "../design";
import { FieldMap } from "../mapBridge";
import type { LayerId, TerrainZone, FieldMeta } from "../mapBridge";
import { useReportQ } from "../api";
import { useApp } from "../store";
import { analyseGeometry } from "../fieldFlow";
import { NeedField, Reminder } from "../components/common";
import MyField from "./MyField";
import AreaReport from "./AreaReport";
import RotationOptions, { useCompare } from "./Options";
import SeasonTimeline from "./SeasonTimeline";
import { cx } from "../lib";
import ChangesStrip from "../components/ChangesStrip";

const LAYERS: LayerId[] = ["cover", "wind", "rain", "soil_moisture", "heat", "soils", "erosion_zones"];

export function MapPanel({ compact }: { compact?: boolean }) {
  const { t } = useTranslation();
  const field = useApp((s) => s.field);
  const layers = useApp((s) => s.activeLayers);
  const toggle = useApp((s) => s.toggleLayer);
  const tab = useApp((s) => s.centerTab);
  const set = useApp((s) => s.set);
  const report = useReportQ(field?.id ?? null);
  const r = report.data;
  const zones = (r?.terrain?.zones ?? null) as TerrainZone[] | null;

  return (
    <section className={cx("panel center", compact && "center--compact")} aria-label={t("map.region")}>
      {!compact ? (
        <div className="center__bar">
          <SegmentedToggle
            label={t("map.view")}
            value={tab}
            onChange={(v) => set({ centerTab: v })}
            options={[
              { value: "map", label: t("map.map"), icon: <IconMap size={14} /> },
              { value: "report", label: t("ar.title"), icon: <IconLayers size={14} /> },
            ]}
          />
          <span data-tour="area-report-tab" className="fs-meta center__hint">
            {tab === "map" ? t("map.report_hint") : t("ar.subtitle")}
          </span>
        </div>
      ) : null}
      {tab === "report" && !compact ? (
        <div className="center__report panel__scroll">
          <AreaReport />
        </div>
      ) : (
        <div className="map-wrap">
          <FieldMap
            fieldId={field?.id}
            fieldGeometry={field?.geometry ?? r?.geometry ?? null}
            fieldName={field?.name}
            activeLayers={layers as LayerId[]}
            terrainZones={zones}
            onSelectField={(f: GeoJSON.Feature, meta: FieldMeta) => {
              const name = meta?.csbid ? t("field.name_fmt", { id: String(meta.csbid).slice(-4), county: `${meta.county ?? ""} Co.` }) : t("field.unnamed");
              useApp.getState().set({ fieldMeta: meta });
              void analyseGeometry(f.geometry, name, meta);
            }}
            onGeometryInput={(g, info) => void analyseGeometry(g, info.name ?? t("field.drawn"), { source: info.source })}
            ariaLabel={t("map.aria", { name: field?.name ?? "" })}
            toolbar={
              <>
                <div className="layer-chips" role="group" aria-label={t("map.layers")}>
                  {LAYERS.map((l) => (
                    <button key={l} type="button" className="lchip" aria-pressed={layers.includes(l)} onClick={() => toggle(l)}>
                      {t(`layer.${l}`)}
                    </button>
                  ))}
                </div>
                {layers.includes("wind") ? <p className="map-caption">{t("map.caption_never")}</p> : null}
                {layers.includes("erosion_zones") && r?.terrain && !r.terrain.zones?.length ? (
                  <p className="map-caption" role="status">
                    {t("ar.zones_none")}
                  </p>
                ) : null}
              </>
            }
          />
        </div>
      )}
    </section>
  );
}

export default function FieldStudio() {
  const { t } = useTranslation();
  const field = useApp((s) => s.field);
  const mobile = useMediaQuery("(max-width: 767px)");
  const tab = useApp((s) => s.mobileTab);
  const centerTab = useApp((s) => s.centerTab);
  const set = useApp((s) => s.set);
  const report = useReportQ(field?.id ?? null);
  const cmp = useCompare();
  const reminder = cmp.data?.reminder;
  const warn = useMemo(() => {
    if (report.data?.mode && report.data.mode !== "field") return t("studio.regional");
    return null;
  }, [report.data, t]);
  // A field opened from a shared link has no name yet: take the one the API stored, in the saved list too.
  useEffect(() => {
    const n = report.data?.name;
    if (!field || !n || field.name === n || field.name !== t("field.unnamed")) return;
    const st = useApp.getState();
    st.set({ field: { ...field, name: n }, savedFields: st.savedFields.map((f) => (f.id === field.id ? { ...f, name: n } : f)) });
  }, [report.data?.name, field, t]);
  if (!field) return <NeedField />;

  if (mobile) {
    const tabs = [
      { id: "map" as const, label: t("mtab.map"), icon: <IconMap size={22} /> },
      { id: "options" as const, label: t("mtab.options"), icon: <IconSprout size={22} /> },
      { id: "timeline" as const, label: t("mtab.timeline"), icon: <IconClock size={22} /> },
      { id: "field" as const, label: t("mtab.field"), icon: <IconLayers size={22} /> },
    ];
    return (
      <div className="studio-m">
        <div className="studio-m__body">
          {report.error ? <StatusBanner kind="error">{String((report.error as Error).message)}</StatusBanner> : null}
          <ChangesStrip />
          {tab === "map" ? (
            <div className="studio-m__map">
              <MapPanel compact />
              <div className="studio-m__sheet">
                <Button block onClick={() => set({ mobileTab: "options", compareRequested: true })}>
                  {t("myfield.compare")}
                </Button>
                <Button block variant="secondary" onClick={() => set({ mobileTab: "options", centerTab: "report" })}>
                  {t("ar.title")}
                </Button>
              </div>
            </div>
          ) : null}
          {tab === "options" ? (
            <div className="studio-m__page">
              <details className="m-report" open={centerTab === "report"} data-tour="area-report">
                <summary>{t("ar.title")}</summary>
                <AreaReport />
              </details>
              <RotationOptions />
            </div>
          ) : null}
          {tab === "timeline" ? (
            <div className="studio-m__page">
              <SeasonTimeline oneYear />
              <Reminder text={reminder} />
            </div>
          ) : null}
          {tab === "field" ? (
            <div className="studio-m__page">
              <MyField />
            </div>
          ) : null}
        </div>
        <nav className="mtabs" aria-label={t("mtab.label")}>
          {tabs.map((x) => (
            <button
              key={x.id}
              type="button"
              className={cx("mtabs__tab", tab === x.id && "is-active")}
              aria-current={tab === x.id ? "page" : undefined}
              data-tour={`mtab-${x.id}`}
              onClick={() => set({ mobileTab: x.id })}
            >
              {x.icon}
              <span>{x.label}</span>
            </button>
          ))}
        </nav>
      </div>
    );
  }

  return (
    <div className="studio">
      <div className="studio__warn">
        {warn ? <StatusBanner kind="partial">{warn}</StatusBanner> : null}
        <ChangesStrip />
      </div>
      <div className="studio__left">
        <MyField />
      </div>
      <div className="studio__center">
        <MapPanel />
      </div>
      <div className="studio__right">
        <RotationOptions />
      </div>
      <div className="studio__bottom">
        <SeasonTimeline />
      </div>
    </div>
  );
}
