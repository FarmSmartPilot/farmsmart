/* Field selection flow: point → /api/fields/at → POST /api/fields → poll job → Field Studio. */
import { api } from "./api";
import type { FieldAt, Pilot, SearchResult } from "./api";
import { useApp } from "./store";
import type { Farm } from "./store";
import i18n from "./i18n";

const t = (k: string, o?: Record<string, unknown>) => i18n.t(k, o ?? {}) as string;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function fieldName(meta: FieldAt["meta"], fallback: string): string {
  const id = typeof meta?.csbid === "string" ? meta.csbid.slice(-4) : null;
  const county = meta?.county ? `${meta.county} Co.` : null;
  if (id && county) return t("field.name_fmt", { id, county });
  return county ?? fallback;
}

/** Save a geometry and wait for its analysis job (budget 30 s, then keep polling quietly up to 90 s). */
export async function analyseGeometry(geometry: GeoJSON.Geometry, name: string, meta?: unknown, at?: { lat: number; lon: number }) {
  const set = useApp.getState().set;
  set({ pending: { label: name, progress: 0.05, step: t("pending.saving") } });
  try {
    const r = await api.createField({ geometry, name, meta });
    if (r.job_id) {
      const t0 = Date.now();
      for (;;) {
        await sleep(700);
        const j = await api.job(r.job_id);
        if (j.status === "failed") throw new Error(j.failures?.[0] ?? t("pending.failed"));
        set({
          pending: {
            label: name,
            progress: Math.max(0.05, j.progress ?? 0),
            step: j.step === "queued" ? t("pending.queued") : j.step,
            note: Date.now() - t0 > 30_000 ? t("pending.slow") : undefined,
          },
        });
        if (j.status === "done") break;
        if (Date.now() - t0 > 90_000) throw new Error(t("pending.timeout"));
      }
    }
    set({ pending: { label: name, progress: 1, step: t("pending.done") } });
    useApp.getState().selectField({ id: r.field_id, name, geometry, lat: at?.lat, lon: at?.lon, meta: (meta as Record<string, unknown>) ?? null });
    setTimeout(() => useApp.getState().set({ pending: null }), 400);
    return r.field_id;
  } catch (e) {
    set({ pending: { label: name, progress: 0, step: "", error: e instanceof Error ? e.message : String(e) } });
    return null;
  }
}

/** Click on the map/globe → find the mapped field there and open it. */
export async function pickPoint(lat: number, lon: number) {
  const set = useApp.getState().set;
  set({ pending: { label: `${lat.toFixed(4)}, ${lon.toFixed(4)}`, progress: 0.02, step: t("pending.finding") } });
  try {
    const f = await api.fieldAt(lat, lon);
    if (!f.found || !f.feature) {
      set({ pending: { label: `${lat.toFixed(4)}, ${lon.toFixed(4)}`, progress: 0, step: "", error: f.note ?? t("pending.no_field") } });
      return null;
    }
    return analyseGeometry(f.feature.geometry, fieldName(f.meta, t("field.unnamed")), f.meta, { lat, lon });
  } catch (e) {
    set({ pending: { label: `${lat.toFixed(4)}, ${lon.toFixed(4)}`, progress: 0, step: "", error: e instanceof Error ? e.message : String(e) } });
    return null;
  }
}

/** Farm-level camera height (m): field outlines are drawn and clickable. */
export const FARM_HEIGHT = 3500;

/** A search result: fly there. A precise point (coordinates or address) flies to Farm level and shows the field
    there on the globe, so the farmer checks it is theirs before anything is analysed. */
export function goToResult(r: SearchResult) {
  const st = useApp.getState();
  if (st.view !== "home") st.setView("home");
  const point = r.kind === "latlon" || r.kind === "coordinates" || r.kind === "point" || r.kind === "address";
  st.set({
    flyTarget: point ? { lat: r.lat, lon: r.lon, height: FARM_HEIGHT, pick: true, key: Date.now() } : { lat: r.lat, lon: r.lon, bbox: r.bbox, key: Date.now() },
  });
}

/** Typed "lat, lon": same as a coordinate search result. */
export function goToPoint(lat: number, lon: number) {
  goToResult({ kind: "coordinates", lat, lon, label: `${lat}, ${lon}` } as SearchResult);
}

/** Parse "42.10, -93.39" style input without the geocoder. */
export function parseLatLon(q: string): { lat: number; lon: number } | null {
  const m = q.trim().match(/^(-?\d+(?:\.\d+)?)\s*[,\s]\s*(-?\d+(?:\.\d+)?)$/);
  if (!m) return null;
  const lat = Number(m[1]);
  const lon = Number(m[2]);
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon };
}

/** Open a precomputed pilot field from /api/pilots. */
export function openPilot(p: Pilot) {
  if (!p.field_id) return;
  const farm = p.farm as Partial<Farm> | undefined;
  useApp.getState().selectField({
    id: p.field_id,
    name: p.name ?? p.label,
    geometry: p.feature?.geometry,
    lat: p.lat,
    lon: p.lon,
    meta: p.meta ?? null,
    farm: farm?.water === "irrigated" ? { ...farm, water: "irrigated" } : farm,
  });
}

/** The Demo field: the Story County corn–soybean pilot, else the field at 42.10, -93.39. */
export async function loadDemoField() {
  const cur = useApp.getState().field;
  try {
    const r = await api.pilots();
    const p = r.pilots.find((x) => x.key === "iowa_story") ?? r.pilots.find((x) => /story/i.test(x.label));
    if (p?.field_id) {
      if (cur?.id !== p.field_id) openPilot(p);
      return p.field_id;
    }
  } catch {
    /* fall through */
  }
  if (cur) return cur.id;
  return pickPoint(42.1, -93.39);
}
