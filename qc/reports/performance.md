# Performance

Measured on 2026-11-14 on the build PC: Windows 11, headless Chromium (Playwright 1.65) at 1440×900.
- The UI ran against the Vite **dev server** (:5173). It serves unbundled ES modules, so first-visit numbers are pessimistic compared with a production build.
- The API was FastAPI on :8000.
- Headless Chromium renders WebGL in software (SwiftShader), so the globe numbers are an upper bound for a laptop with a GPU.

Sources:
- `qc/e2e/perf.spec.ts` → `qc/reports/perf_browser.json`
- `qc/perf_api.py` → `qc/reports/perf_api.json`

## Budgets

| Measure | Result | Budget | Verdict |
|---|---|---|---|
| First globe render (GlobeView console log `[GlobeView] first globe render N ms`) | **564–583 ms** (3 runs). First contentful paint 300–324 ms; DOMContentLoaded about 210–230 ms | not set in the brief (< 3 s used) | ✅ |
| Cached pilot: report + compare, API | report **28 ms** + compare **35 ms** (cache hit) | < 2 s | ✅ |
| Cached pilot in the UI, click "Story County, Iowa" → Field Studio, warm (chunks loaded) | Studio in **0.1 s**, Area Report in **0.65 s**, 3 option cards in **0.9 s** total | < 2 s | ✅ |
| Same, first visit in a fresh tab | about **3.0–4.0 s** before Field Studio paints. The view chunk and the MapLibre field map load lazily from the dev server while the software-rendered globe keeps the main thread busy. After that, Compare shows cards in 0.24–0.27 s. | < 2 s | ⚠️ over on a cold dev-server tab. Re-measure on the production build (`npm run build && npx vite preview`), where modules are bundled. |
| New-field analysis, Iowa 42.05, -93.30 (`/api/fields/at` → `POST /api/fields` → poll job) | fields/at 0.005 s + context job **3.0 s** + first compare **1.6 s** = **4.7 s** to cards | < 30 s | ✅ |
| New field in a region nothing is cached for (Nebraska 40.92, -98.05) | fields/at 4.7 s + context 3.5 s + compare 1.1 s = **9.3 s** | < 30 s | ✅ |
| Compare re-run, API: new priority order / Dry preset / custom slider (rain −17 %, +1.3 °C) | **1.47 s / 1.37 s / 1.38 s** | < 2 s (same as cached) | ✅ |
| Compare re-run in the UI: move a priority chip → options re-ranked | **0.36–0.40 s** (warm) | < 2 s | ✅ |
| Guided Demo, 12 steps start to finish at machine speed | **13.1 s** (`demo_tour_timing.md`); the slowest steps are Climate Twins at 2.8 s and Alerts at 2.7 s | the judge path must take < 2 min | ✅ |
| Judge path e2e (search, pilot, compare, why-not, Expert/Next Move, replay 2012, twins, alert, PDF) | **9.8 s** | < 2 min | ✅ |

## Notes and risks
- **New fields depend on the network.** The new-field timings rely on live calls (NASA POWER, SSURGO SDA, CDL, terrain tiles). On the Iowa point, the shared ≈50 km POWER cell may already have been in the HTTP cache. The Nebraska point is the better "cold" figure. A slow or failing upstream service goes into the job's `failures` list; both runs here had none.
- **Production bundle size.** Production `vite build` warns that some chunks are over 500 kB (Cesium). The globe is the largest first-load cost. `FlatMap` is imported both statically and dynamically, so the dynamic import does not split it out (a Vite INEFFECTIVE_DYNAMIC_IMPORT warning).
- **Not measured.** iPhone Safari timing was not measured, because WebKit cannot launch on this PC (Smart App Control). Mobile timings come from Chromium emulation only.
