/* Globe Home drill-down UI: zoom ladder (Planet → Farm), one plain-language hint, field-boundary status,
   the field selection card (USDA CSB / Fields of The World / drawn by you) and the draw-your-own toolbar.
   The map (GlobeView or FlatMap with `drillDown`) reports levels, picks and drawing; this file owns the UI state. */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import { useTranslation } from "react-i18next";
import { Button, DataButton, IconClose, IconPolygon } from "../design";
import type { Evidence } from "../design";
import type { MapHandle } from "../mapBridge";
import type { DrawStatus, DrillLevel, FieldPick, FieldsStatus } from "../map/types";
import { CSB_ATTRIBUTION, cropHistory, csbMeta, DRILL_LEVELS, FTW_ATTRIBUTION, ftwMeta } from "../map/drill";
import { areaHa, bboxOf } from "../map/geo";
import { analyseGeometry, fieldName } from "../fieldFlow";
import "./globeDrill.css";

const HA_PER_ACRE = 0.40468564224;
/** Above this a field is analysed in regional mode (backend rule: > 50 km²). */
const REGIONAL_HA = 5000;

export interface DrillSelection {
  source: "csb" | "ftw" | "drawn";
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon;
  props: Record<string, unknown>;
  areaHa: number;
  lat: number;
  lon: number;
}

/** Commands for the globe from outside GlobeHome (the Demo tour). */
export type GlobeCommand =
  | { type: "fly"; lat: number; lon: number; height: number; duration?: number }
  | { type: "pick"; lat: number; lon: number }
  | { type: "clear" };
const CMD_EVENT = "fs:globe-command";
export function globeCommand(cmd: GlobeCommand) {
  window.dispatchEvent(new CustomEvent<GlobeCommand>(CMD_EVENT, { detail: cmd }));
}

const fmt = (n: number, d = 1) => (n >= 100 ? Math.round(n).toLocaleString() : n.toFixed(d));

/** State + map props + overlay for the Globe Home drill-down. */
export function useGlobeDrill(mapRef: RefObject<MapHandle | null>) {
  const [level, setLevel] = useState<DrillLevel>("planet");
  const [fields, setFields] = useState<FieldsStatus | null>(null);
  const [sel, setSel] = useState<DrillSelection | null>(null);
  const [miss, setMiss] = useState<{ loading: boolean } | null>(null);
  const [draw, setDraw] = useState<DrawStatus | null>(null);
  const reduced = useRef(false);

  const select = useCallback(
    (s: DrillSelection) => {
      setMiss(null);
      setSel(s);
      const b = bboxOf(s.geometry);
      if (b) mapRef.current?.flyTo({ lat: s.lat, lon: s.lon, bbox: b, duration: 1.2 });
    },
    [mapRef],
  );

  const onFieldPick = useCallback(
    (p: FieldPick) => {
      if (p.kind === "field" && p.field) {
        const g = p.field.feature.geometry;
        select({ source: p.field.source, geometry: g, props: (p.field.feature.properties ?? {}) as Record<string, unknown>, areaHa: areaHa(g), lat: p.lat, lon: p.lon });
      } else {
        setSel(null);
        setMiss({ loading: !!p.loading });
      }
    },
    [select],
  );

  const onDrawChange = useCallback(
    (d: DrawStatus) => {
      if (d.geometry) {
        setDraw(null);
        const b = bboxOf(d.geometry);
        select({
          source: "drawn",
          geometry: d.geometry,
          props: {},
          areaHa: d.areaHa ?? areaHa(d.geometry),
          lat: b ? (b[1] + b[3]) / 2 : 0,
          lon: b ? (b[0] + b[2]) / 2 : 0,
        });
      } else setDraw(d.active ? d : null);
    },
    [select],
  );

  const onLevelChange = useCallback((lv: DrillLevel) => {
    setLevel(lv);
    if (lv !== "farm") setMiss(null);
    if (lv === "planet" || lv === "country" || lv === "state") setSel(null);
  }, []);

  // Esc cancels drawing wherever focus is.
  useEffect(() => {
    if (!draw?.active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        mapRef.current?.cancelDraw?.();
        e.preventDefault();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [draw?.active, mapRef]);

  // Commands from the Demo tour.
  useEffect(() => {
    reduced.current = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const on = (e: Event) => {
      const c = (e as CustomEvent<GlobeCommand>).detail;
      const m = mapRef.current;
      if (!m || !c) return;
      if (c.type === "fly") m.flyTo({ lat: c.lat, lon: c.lon, height: c.height, duration: c.duration });
      else if (c.type === "pick") void m.pickAt?.(c.lat, c.lon);
      else if (c.type === "clear") {
        setSel(null);
        setMiss(null);
        m.cancelDraw?.();
      }
    };
    window.addEventListener(CMD_EVENT, on);
    return () => window.removeEventListener(CMD_EVENT, on);
  }, [mapRef]);

  const startDraw = useCallback(() => {
    setSel(null);
    setMiss(null);
    mapRef.current?.startDraw?.();
  }, [mapRef]);

  const mapProps = useMemo(
    () => ({ drillDown: true, onLevelChange, onFieldsStatus: setFields, onFieldPick, onDrawChange }),
    [onLevelChange, onFieldPick, onDrawChange],
  );

  const overlay = (
    <GlobeDrillOverlay
      mapRef={mapRef}
      level={level}
      fields={fields}
      sel={sel}
      miss={miss}
      draw={draw}
      onClear={() => {
        setSel(null);
        setMiss(null);
      }}
      onStartDraw={startDraw}
    />
  );
  return { level, selection: sel, drawing: !!draw?.active, mapProps, overlay };
}

interface OverlayProps {
  mapRef: RefObject<MapHandle | null>;
  level: DrillLevel;
  fields: FieldsStatus | null;
  sel: DrillSelection | null;
  miss: { loading: boolean } | null;
  draw: DrawStatus | null;
  onClear: () => void;
  onStartDraw: () => void;
}

function GlobeDrillOverlay({ mapRef, level, fields, sel, miss, draw, onClear, onStartDraw }: OverlayProps) {
  const { t } = useTranslation();
  const hint =
    level === "planet" || level === "country"
      ? t("drill.hint_planet")
      : level === "state"
        ? t("drill.hint_state")
        : level === "county"
          ? t("drill.hint_county")
          : t("drill.hint_farm");
  const farm = level === "farm";
  const fieldsState = !farm || !fields ? "idle" : fields.count ? "ready" : fields.loading ? "loading" : "empty";

  return (
    <>
      <div className="drill-ladder" role="group" aria-label={t("drill.ladder_label")} data-tour="zoom-ladder">
        {DRILL_LEVELS.map((lv) => (
          <button
            key={lv}
            type="button"
            className={`drill-ladder__rung${lv === level ? " is-current" : ""}`}
            aria-current={lv === level ? "true" : undefined}
            aria-label={t("drill.ladder_go", { level: t(`drill.level_${lv}`) })}
            title={t("drill.ladder_go", { level: t(`drill.level_${lv}`) })}
            onClick={() => mapRef.current?.zoomToLevel?.(lv)}
          >
            <span className="drill-ladder__dot" aria-hidden="true" />
            <span className="drill-ladder__label">{t(`drill.level_${lv}`)}</span>
          </button>
        ))}
      </div>

      <div className="drill-bottom">
        {farm && !draw ? (
          <div className="drill-status" role="status" data-tour="drill-status" data-state={fieldsState}>
            {fieldsState === "loading" ? (
              <>
                <span className="drill-spinner" aria-hidden="true" />
                {t("drill.loading")}
              </>
            ) : fieldsState === "ready" && fields ? (
              <>
                {fields.loading ? <span className="drill-spinner" aria-label={t("drill.loading")} /> : null}
                {t("drill.n_fields", { count: fields.count })} ·{" "}
                {fields.sources.map((s) => (s === "csb" ? t("drill.src_csb_short") : t("drill.src_ftw_short"))).join(", ")}
                {fields.sources.map((s) => (
                  <DataButton key={s} evidence={sourceEvidence(s)} describes={t("drill.boundaries")} />
                ))}
              </>
            ) : fieldsState === "empty" && fields?.note ? (
              <>{capital(fields.note)}</>
            ) : null}
          </div>
        ) : null}
        {miss && !sel && !draw ? (
          <div className="drill-miss" role="alert">
            <span>{miss.loading ? t("drill.still_loading") : t("drill.no_field")}</span>
            <Button variant="secondary" size="sm" onClick={onStartDraw} icon={<IconPolygon size={14} />}>
              {t("drill.draw_own")}
            </Button>
            <button type="button" className="drill-x" aria-label={t("common.close")} onClick={onClear}>
              <IconClose size={14} />
            </button>
          </div>
        ) : null}
        {draw ? (
          <DrawBar mapRef={mapRef} draw={draw} />
        ) : !sel ? (
          <p className="drill-hint" aria-live="polite" data-tour="drill-hint">
            {hint}
            {level === "county" || level === "farm" ? (
              <button type="button" className="drill-hint__link" onClick={onStartDraw}>
                {t("drill.draw_own")}
              </button>
            ) : null}
          </p>
        ) : null}
      </div>

      {sel ? <SelectionCard sel={sel} onClear={onClear} onStartDraw={onStartDraw} /> : null}
    </>
  );
}

function DrawBar({ mapRef, draw }: { mapRef: RefObject<MapHandle | null>; draw: DrawStatus }) {
  const { t } = useTranslation();
  const ha = draw.areaHa;
  return (
    <div className="drill-draw" role="region" aria-label={t("drill.draw_own")} data-tour="draw-bar">
      <p className="drill-draw__help">{t("drill.draw_help")}</p>
      <p className="drill-draw__read" aria-live="polite">
        {t("drill.draw_points", { count: draw.points })}
        {ha != null ? ` · ${t("drill.size", { ac: fmt(ha / HA_PER_ACRE), ha: fmt(ha) })}` : ""}
      </p>
      {ha != null && ha > REGIONAL_HA ? <p className="drill-warn">{t("drill.regional_warn")}</p> : null}
      <div className="drill-draw__btns">
        <Button variant="secondary" size="sm" disabled={!draw.points} onClick={() => mapRef.current?.undoDrawPoint?.()}>
          {t("drill.undo")}
        </Button>
        <Button variant="primary" size="sm" disabled={draw.points < 3} onClick={() => mapRef.current?.finishDraw?.()}>
          {t("drill.finish")}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => mapRef.current?.cancelDraw?.()}>
          {t("drill.cancel")}
        </Button>
      </div>
    </div>
  );
}

function SelectionCard({ sel, onClear, onStartDraw }: { sel: DrillSelection; onClear: () => void; onStartDraw: () => void }) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const history = sel.source === "csb" ? cropHistory(sel.props) : [];
  const county = sel.source === "csb" && sel.props.cnty ? String(sel.props.cnty) : null;
  const title = county ? t("drill.title_county", { county }) : sel.source === "drawn" ? t("drill.title_drawn") : t("drill.title");
  const srcText = sel.source === "csb" ? t("drill.src_csb") : sel.source === "ftw" ? t("drill.src_ftw") : t("drill.src_drawn");

  const analyse = async () => {
    setBusy(true);
    try {
      if (sel.source === "csb") {
        const meta = csbMeta(sel.props);
        await analyseGeometry(sel.geometry, fieldName(meta, t("field.unnamed")), meta, { lat: sel.lat, lon: sel.lon });
      } else if (sel.source === "ftw") {
        const meta = ftwMeta(sel.props);
        await analyseGeometry(sel.geometry, t("field.unnamed"), meta, { lat: sel.lat, lon: sel.lon });
      } else {
        await analyseGeometry(sel.geometry, t("field.unnamed"), {}, { lat: sel.lat, lon: sel.lon });
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="drill-card" aria-labelledby="drill-card-h" data-tour="field-card">
      <div className="drill-card__head">
        <h2 id="drill-card-h" className="drill-card__title">
          {title}
        </h2>
        <button type="button" className="drill-x" aria-label={t("drill.pick_another")} onClick={onClear}>
          <IconClose size={16} />
        </button>
      </div>
      <dl className="drill-card__facts">
        <div>
          <dt>{t("drill.size_label")}</dt>
          <dd>{t("drill.size", { ac: fmt(sel.areaHa / HA_PER_ACRE), ha: fmt(sel.areaHa) })}</dd>
        </div>
        <div>
          <dt>{t("drill.source_label")}</dt>
          <dd>
            {srcText} {sel.source !== "drawn" ? <DataButton evidence={sourceEvidence(sel.source)} describes={t("drill.boundary")} /> : null}
          </dd>
        </div>
      </dl>
      {sel.areaHa > REGIONAL_HA ? <p className="drill-warn">{t("drill.regional_warn")}</p> : null}
      {history.length ? (
        <div className="drill-card__hist">
          <div className="fs-overline">
            {t("drill.history")} <DataButton evidence={cdlEvidence()} describes={t("drill.history")} />
          </div>
          <ol className="drill-hist">
            {history.map((h) => (
              <li key={h.year}>
                <span className="drill-hist__y">{h.year}</span>
                <span className={`drill-hist__c drill-hist__c--${cropClass(h.code)}`}>{h.name}</span>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
      <div className="drill-card__btns">
        <Button variant="primary" block onClick={() => void analyse()} disabled={busy} data-tour="analyze-field">
          {t("drill.analyze")}
        </Button>
        <div className="drill-card__row">
          <Button variant="secondary" size="sm" onClick={onClear}>
            {t("drill.pick_another")}
          </Button>
          <Button variant="ghost" size="sm" onClick={onStartDraw} icon={<IconPolygon size={14} />}>
            {t("drill.draw_own")}
          </Button>
        </div>
      </div>
    </section>
  );
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function cropClass(code: number): string {
  if (code === 1 || code === 12) return "corn";
  if (code === 5) return "soy";
  if ([21, 22, 23, 24, 25, 27, 28, 205].includes(code)) return "grain";
  if ([36, 37, 58, 59, 176].includes(code)) return "forage";
  if (code === 61) return "fallow";
  return "other";
}

function sourceEvidence(s: "csb" | "ftw"): Evidence {
  return s === "csb"
    ? { source: "USDA NASS", product: "Crop Sequence Boundaries 2017–2024", licence: "Public domain", citation: CSB_ATTRIBUTION, is_nasa: false }
    : {
        source: "Fields of The World (Kerner et al.)",
        product: "FTW global field boundaries 2025",
        native_res: "10 m (Sentinel-2)",
        qa_flags: ["model-drawn from satellite imagery: check it against the imagery and redraw if needed"],
        licence: "CC BY 4.0",
        citation: FTW_ATTRIBUTION,
        url: "https://source.coop/ftw/global-field-boundaries",
        is_nasa: false,
      };
}

function cdlEvidence(): Evidence {
  return {
    source: "USDA NASS",
    product: "Cropland Data Layer, via Crop Sequence Boundaries (cdl2017–cdl2024)",
    native_res: "30 m (2017–2023), 10 m (2024)",
    effective_res: "majority class per field",
    licence: "Public domain",
    citation: CSB_ATTRIBUTION,
    is_nasa: false,
  };
}
