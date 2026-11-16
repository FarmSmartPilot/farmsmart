# FarmSmart: task board

Legend: ✅ done · 🔄 in progress · ⏳ pending · ⚠️ partial

## Done ✅
- Setup:
  - repo, contracts, `CLAUDE.md`/`AGENTS.md`, 15 agent definitions;
  - digests, `DATA_SOURCES.md`, `LICENSES.md`, `ENDPOINTS.md`.
- Agronomy knowledge base: 32+ crops, cited calendars for 6 regions, 27 rules, 6 strategy families, EN/ES glossary.
- Data:
  - NASA POWER, SMAP L4, GRACE-FO, HLS 30 m, MODIS NDVI, NEX-GDDP-CMIP6, GIBS;
  - SSURGO / SoilGrids, CDL / CSB / AAFC, Fields of The World;
  - ERS costs, World Bank prices, terrain.
- Engine:
  - climate engine; M6 simulator; rules engine;
  - strategy generator (double crops, fallow); M9 ranking + stability; M10 confidence;
  - M8 profit; Drought Replay; M7 Climate Twins; M3 sequence model (validated).
- Alerts (double opt-in, outbox, scheduler); PDF report.
- Scenario sliders and the 2040s preset.
- Eight pilots precomputed: IA ×2, KS ×2, CA, SK, Punjab, Mato Grosso.
- Validation reports: POWER vs NOAA stations; SMAP vs POWER; HLS vs model.
- Web:
  - globe, field map, every screen, Demo tour, EN/ES, mobile tabs;
  - Region Compare, Season Wheel cover picker, NASA panels.
- Submission docs: requirements trace, demo script, video shot list, deck outline, checklist, SI disclosure, METHODS, README.
- Deployment config: Docker/Render API, Vercel web.

## In progress 🔄
- Final QC sweep: e2e (Chromium + WebKit iPhone), axe, data/honesty checks, performance, spacing → `qc/GATE_REPORT.md`.

## Waiting on the user ⏳
- **IMERG:** approve the GES DISC app once in Earthdata
  (https://urs.earthdata.nasa.gov/approve_app?client_id=e2WVk8Pw6weeLUKZYOxvTQ). Then re-run `python -m fieldshift.ingest.earthdata` and `qc/validate_nasa.py`.
- **Optional keys:** NASS (county yields → M2 yield model and M10 calibration), Cesium ion (world terrain), SMTP (real emails).
- **Deploy:**
  - create the Render service from `render.yaml` (set `EARTHDATA_TOKEN` there);
  - update the `/api` rewrite in `web/vercel.json` to the Render URL;
  - deploy `web/` on Vercel;
  - make the GitHub repo public.

## Known gaps ⚠️
- M1 suitability, M2 yield quantiles, M4 detection and M12 downscaling are not trained. Process models and rules stand in, labelled as such.
- Slider response is about 0.3–2 s (budget 150 ms; the ONNX surrogate is not built).
- Wind is an exposure index, not WEPS tonnes. Rice paddy water is not modelled. Economics are US-only.
- Canola stage lengths are derived (flagged for agronomy review).

## Scope-cut list
Prithvi fine-tune → voice input → Google 3D mode → multi-field optimization (all cut).
