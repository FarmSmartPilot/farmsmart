/* Whole farm sample: three real cropland fields in central Iowa, used by "Try a sample farm" (whole-farm page)
   and by the Demo menu's "Sample whole farm". */
import { api, ApiError } from "./api";
import type { FieldSel } from "./store";
import { useFarm } from "./farmStore";
import { fieldName } from "./fieldFlow";

/* ---------------- sample farm: three real cropland fields in central Iowa ----------------
   Points checked on 2026-11-15 with the API: each is a mapped field boundary (USDA Crop Sequence Boundaries) that
   USDA's Cropland Data Layer shows as corn or soybean in 2017–2024. The ids are what POST /api/fields returns for
   those boundaries; when a server has not analysed one yet it is looked up and analysed again. */
export const SAMPLE_FARM: { id: string; lat: number; lon: number; county: string }[] = [
  { id: "b96d39c7a833", lat: 42.11119, lon: -93.46928, county: "Story" },
  { id: "c5f3a2a4942b", lat: 42.12, lon: -94.05, county: "Boone" },
  { id: "d2abd5f9a2ad", lat: 42.4, lon: -93.7, county: "Hamilton" },
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function sampleField(s: (typeof SAMPLE_FARM)[number], unnamed: string): Promise<FieldSel> {
  try {
    const r = await api.report(s.id);
    return { id: r.id, name: r.name || `${s.county} Co.`, lat: r.centroid?.[1] ?? s.lat, lon: r.centroid?.[0] ?? s.lon };
  } catch (e) {
    if (!(e instanceof ApiError) || e.status !== 404) throw e;
  }
  // Not analysed on this server yet: find the mapped field at the point and analyse it (the first time takes a while).
  const at = await api.fieldAt(s.lat, s.lon);
  if (!at.found || !at.feature) throw new Error(at.note ?? "no field");
  const name = fieldName(at.meta, unnamed);
  const c = await api.createField({ geometry: at.feature.geometry, name, meta: at.meta });
  if (c.job_id) {
    const t0 = Date.now();
    for (;;) {
      await sleep(1500);
      const j = await api.job(c.job_id);
      if (j.status === "failed") throw new Error(j.failures?.[0] ?? "failed");
      if (j.status === "done") break;
      if (Date.now() - t0 > 600_000) throw new Error("timeout");
    }
  }
  return { id: c.field_id, name, lat: s.lat, lon: s.lon, meta: (at.meta as Record<string, unknown>) ?? null };
}

/** Add the sample fields to the farm (marked as samples; fields already in the farm are kept once).
 *  Returns the counties that could not be added. */
export async function loadSampleFarm(unnamed: string, progress?: (n: number, m: number) => void): Promise<string[]> {
  const failed: string[] = [];
  const add = useFarm.getState().add;
  for (const [i, s] of SAMPLE_FARM.entries()) {
    try {
      add(await sampleField(s, unnamed), null, true);
    } catch {
      failed.push(s.county);
    }
    progress?.(i + 1, SAMPLE_FARM.length);
  }
  return failed;
}
