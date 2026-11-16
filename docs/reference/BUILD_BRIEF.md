# FarmSmart — Build brief for the coding agent

You are the lead engineer and orchestrator for **FarmSmart**, our team's entry in the NASA Space Apps Challenge 2026, challenge "Adapting Farms with NASA Data" (Nov 14–15, 2026). Build a **complete, working, award-quality web app** on this Windows PC from this brief. Work autonomously. Stop to ask me only for credentials, or before anything destructive or outside the project folder.

---

## 0. Ground rules

- **Project root:** `C:\FieldShift\field-shift` (create it). Everything lives inside it: code, data cache, models, docs. Never write, move or delete outside this folder.
- **Planning inputs (read first if present):** `C:\FieldShift\docs\` may contain `Field_Shift_Comprehensive_Build_Plan.pdf`, `Field_Shift_Main_Page_Concepts.pptx` and the challenge brief. Treat them as the design source of truth wherever this brief is silent. If `C:\FieldShift\` already contains earlier satellite-tile or map code, inspect it and reuse what is sound: source, licence, coordinates, performance.
- **Windows environment:** PowerShell. Python 3.11 via **Miniforge/conda-forge** for the geospatial stack (GDAL, rasterio and pyproj install reliably that way), with pip for the rest. Node 20+ LTS. Git. Use `pathlib` and cross-platform paths. No bash-only scripts; provide `.ps1` scripts and npm scripts. Enable long paths if needed.
- **Version control:** run `git init` at the start and commit after every working step with clear messages. The repo becomes public at submission, so **never commit secrets**. Keys go in `.env` (git-ignored); commit a `.env.example`.
- **Terminology:** use **"SI"** everywhere you would normally write "AI", in UI text, docs, code comments and the submission. For example: "SI model", "SI Narrator", "SI-use disclosure".
- **Honesty rules (non-negotiable):**
  - Every number shown to a user is computed from real data or a real model run.
  - No synthetic data is presented as observation, and no hard-coded "demo numbers".
  - If data is missing, say so in the UI and lower the confidence. Do not invent values.
- **Space Apps rules to respect in the product and repo:**
  - No NASA logos, insignia or branding anywhere. Mission names in plain text are fine.
  - Disclose SI use in `docs/SI_USE_DISCLOSURE.md`.
  - Watermark any SI-generated image or video.
  - The final site must be public and open with no login.
- **Project memory file:** create `CLAUDE.md` (and an identical `AGENTS.md` for other agent tools) at the repo root summarizing this brief, the commands, the folder ownership and the rules above. Keep it updated.

---

## 1. What we are building (the product)

FarmSmart helps a farmer, from the whole planet down to one field, explore crop rotations that protect soil, save water and adapt to changing conditions. It combines NASA Earth observations with soil, crop, market and farmer-priority data. It is a **decision-support tool**: it shows patterns, options, evidence, trade-offs and uncertainty. **It never replaces farmer judgment or local expertise**, and says so wherever a decision is made.

**Platforms:** **desktop browser first** (design at 1440×900 and 1920×1080, minimum 1280 wide). The app must also be **fully usable on iPhone Safari** (390–430 px wide). Desktop is the showcase; mobile must work end to end.

### The core experience: five steps, plus monitoring, plus two signature extras

1. **WHERE: find the field.**
   - Google-Earth-style 3D globe. Zoom in using imagery tiles that sharpen with zoom.
   - Outlines for countries and states/provinces, with capitals and the top 5 cities per state/province as level-of-detail labels.
   - One smart search box accepts decimal lat/lon, degrees-minutes-seconds, state, "City, ST" and addresses. Cascading pickers: Country → State/Province → County → City.
   - Google-Earth-style navigation (drag, tilt, rotate, zoom, reset north) with a 2D/3D toggle.
   - Select a field four ways: click it (snaps to a field-boundary polygon), draw a polygon, pick a county or district, or upload GeoJSON/KML/zipped shapefile. Areas over about 50 km² switch to regional mode.
   - On select, build the **Area Report**: climate normals and trends, this season, soil, terrain, water, crop history, the crops commonly grown in the region, and a **coverage panel**.
2. **WHAT FITS: filter crops.**
   - Hard constraints first: season length, frost, water budget (including a dry year), soil, slope, equipment, markets, livestock, and the farmer's "won't grow" list.
   - Then SI suitability scoring.
   - **Every excluded crop records an exclusion reason**, viewable under "Why not others?".
3. **BUILD OPTIONS: generate rotations.**
   - Build 2–5-year sequences from feasible crops, across six strategy families: Fill the gap (cover crops) · Extend & diversify · Water-wise swap · Integrate forage · Market-driven add · Pest-cycle break.
   - Prune with the agronomy rules engine.
   - **The farmer's existing rotation is always included as the baseline**, even when it scores poorly.
4. **TEST: simulate every candidate across past weather years and scenarios.**
   - Outputs: erosion from **water (RUSLE)** and **wind**, water use, soil organic matter trend, nitrogen balance, pest-cycle break, yield distribution (P10/P50/P90), profit distribution, and workload.
   - Every output carries a confidence level and its reasons.
5. **RANK & EXPLAIN: show the strategies.**
   - Apply hard filters, find the non-dominated (Pareto) set, then rank by the farmer's drag-to-rank priority weights. Raw indicators always appear beside the combined score.
   - Show the **existing rotation plus at least two alternatives** from different families as **Strategy Cards**. Each card has:
     - **Why suggested**
     - **Evidence**
     - **Benefits**
     - **Trade-offs & risks**
     - **Information gaps**
     - **Check locally**
     - **Try it small** (a strip-trial suggestion)
   - Show **rank stability**: if plausible changes in assumptions flip the top choice, say the ordering is uncertain.
   - If fewer than two alternatives are feasible, name the binding constraint and offer adjustments.
6. **ACT & MONITOR: close the loop.**
   - Save the plan, export a printable "talk to your agronomist" PDF report, and subscribe the field to **email alerts**: frost risk, heat stress, dry-down, heavy rain on bare soil, **high wind + low cover**, cover-crop seeding and termination windows, water-storage trend, market price, and a weekly digest.
   - Include a "changes since your last visit" view.

**Signature extra A: CLIMATE TWINS.**
- Show where the field's climate is heading by the 2040s (NEX-GDDP-CMIP6).
- An arc flies across the globe to the present-day place(s) that already have that climate, and shows what farmers grow there today.
- Show model agreement ("x of N models agree") as uncertainty, and flag "novel climate" when no good analog exists.

**Signature extra B: DROUGHT REPLAY.**
- Pick a real past year (for example 2012 in the US Midwest, or the field's worst local year). Replay it week by week on the field: current rotation versus the chosen alternative, side by side.
- Show soil water, crop stress, erosion events and yield outcome from the models.
- Overlay a translucent "ghost" of the actual satellite greenness (NDVI) from that year.
- Label it clearly as a model replay with confidence bands.

---

## 2. Screens & UX

### Main page: "Field Studio" (desktop, the most-used screen)

- **Top bar:** product name, the smart search, "Saved fields", a Simple/Expert toggle, a 3D/2D toggle, and "Export report".
- **Left column (~200 px): MY FIELD.** Confirmed facts as editable rows: boundary, crop history (auto-detected year tiles; farmer confirms or edits), soil, slope, water (rainfed or allocation), equipment. Below that, **MY PRIORITIES** as drag-to-rank chips, and one big primary button: **"Compare rotations →"**.
- **Center: map/globe of the field.**
  - Dated imagery stamp ("NAIP · Jul 2024 · 0.6 m").
  - Layer chips: Cover · Wind · Rain · Soil moisture · Heat · Soils · Erosion zones.
  - A wind-rose inset, and within-field vulnerability zones (erosion, water-stress hotspots, frost pockets).
- **Right column: ROTATION OPTIONS.** The current rotation plus two alternatives as compact cards, each with:
  - a trade-off petal chart;
  - a "match to your priorities" bar;
  - a confidence chip;
  - a "Best for you" tag;
  - a "3 of N feasible · why not others? →" link.
- **Bottom strip: SEASON TIMELINE.** The rotations' calendars aligned across two years. Crops are colored bars; bare soil is hatched red; windy weeks and heavy-rain weeks are shaded columns, so overlaps are obvious. A one-line summary sits at the end of the strip, for example "bare + windy overlap: 9 weeks → 2 with A". That value must be computed, never typed in.

### Other views

- **Globe Home:** the entry point. A rotating Earth with outlines and labels and "Find my farm". It flies smoothly to the selection.
- **Season Wheel (Simple-mode view):** circular year rings, with crops as arcs, bare months hatched, and NASA-derived risk icons (frost, heat, heavy rain, dry spell) on the rim. Drag a cover crop into a gap and the scores update.
- **Next Move (Expert tab):**
  - detected crop history, branching into "usual next" (statistical) versus "smart next" (optimized) options;
  - a Pareto trade-off chart with uncertainty ellipses;
  - a scenario switch (Normal / Dry / Hot / Wet / 2040s);
  - a dry-year "regret" meter;
  - a stress-test over 45 weather years as quantile dot-plots.
- **Strategy Compare:** full cards side by side, with quantile dot-plots ("in 15 of 20 seasons…"), fan charts and the rules trace.
- **Climate Twins** and **Drought Replay** views (above).
- **Region Compare:** two nearby regions side by side, explaining why their recommendations differ.
- **Alerts & Settings:** subscriptions, thresholds, quiet hours, units (metric/imperial), language (English and Spanish minimum), and alert history.
- **Sources & Methods:** every dataset (with version, date, resolution, licence and citation), every model card, the validation results, and the "what this app never claims" list.

### Design system

- **Tone:** calm, professional, earthy.
- **Palette:**
  - deep navy `#0E2A47` for text and headers;
  - field green `#2E7D4F` for primary actions and good outcomes;
  - wheat gold `#C8902A`;
  - sky `#2F7FB5`;
  - soil brown `#8A5A3B`;
  - alert red `#C2483A`;
  - purple `#6B4FA0` for climate futures;
  - light surfaces `#F6F8FA`.
- **Charts and maps:** colorblind-safe palettes (Okabe-Ito for categories, viridis or cividis for continuous).
- **Type:** Inter (or system UI). Body text at least 14 px on desktop and 16 px on mobile. Plain words at grade-8 reading level. Jargon gets a dotted underline that opens a glossary pop-over (ET, NDVI, soil moisture anomaly, GDD, frost risk, water balance, RUSLE, P10/P50/P90…).
- **Spacing:** one 4 px base scale (4/8/12/16/24/32/48), consistent card padding, aligned columns, and no cramped or orphaned elements.
- **Reference everything, quietly:**
  - Wherever data is used, show a **very small round data button** (about 14 px visible on desktop and 16 px on mobile, with a ≥44 px invisible tap area on touch). It is navy with a **white satellite icon** for NASA data, and gray with a satellite icon for other sources.
  - Wherever an SI model produced or ranked something, show a **very small round green button with white "SI" letters** (green `#1E8E4E`).
  - Place the buttons right next to the number, label or chart title they explain. Tapping opens a small pop-over:
    - **data button:** dataset and version, observation date, resolution, quality notes, licence/citation;
    - **SI button:** model name, top drivers, confidence and reasons, information cutoff, and a link to the model card.
  - Also include a small footer credit line ("Data: NASA, USDA, USGS, NOAA, ESA/Copernicus, ECMWF, FAO and others · Sources & Methods").
  - Legally required attributions (map tiles, geocoder) stay small but present.
- **States:** distinct loading, partial-data, no-observation, unsupported-crop and stale-data states. The user can always continue with the evidence available.
- **Accessibility:** WCAG 2.2 AA contrast, full keyboard navigation, a table alternative for every map and chart, a reduced-motion setting, and labels that stay legible over imagery.
- **Mobile (iPhone Safari):**
  - Field Studio collapses into tabs: Map · Options · Timeline · My Field.
  - The globe falls back to MapLibre 2D when WebGL is weak.
  - Bottom sheets replace side panels.
  - No hover-only interactions.
  - It must work in portrait.

---

## 3. The SI layer (several distinct machine-learning sections)

Build each model as its own module in `models/mNN_*`. Each one gets:
- a training script;
- a saved artifact;
- a **model card** (`models/model_cards/*.md`: purpose, data, years, features, validation design and scores, known failure modes, licence);
- a calibrated uncertainty output.

Train on **real data**, at minimum for the pilot regions and CONUS at regional resolution. Where a model cannot be trained in time, ship a transparent rule-based fallback and label it "rules", not "SI".

| ID | Model | What it does | Method (primary → fallback) | Validation |
|---|---|---|---|---|
| M1 | **Crop Suitability** | Which crops statistically fit this place | Per-crop LightGBM on environmental-only features, blended with an ECOCROP/GAEZ envelope prior and calibrated with isotonic regression. PU/MaxEnt for minor crops. Output: **Fit Score = S^0.5 × Yield-percentile^0.3 × Reliability^0.2**, with SHAP top-3 drivers in plain words | Spatial-block CV (leave-one-state-out), temporal hold-out (train 2008–2019, test 2020–2025), PR-AUC, Brier score, reliability curves; must beat GAEZ-only and county-frequency baselines |
| M2 | **Yield & yield risk** | P10/P50/P90 yield per candidate crop | LightGBM quantile regression on stage-specific weather, soil moisture, NDVI and soil features; conformalized intervals (MAPIE). Rotation effects (for example corn after soybean) as priors with ranges | Pinball loss, interval coverage, detrended NASS county yields |
| M3 | **Rotation sequence** ("what usually comes next") | Next-crop probabilities; detect the field's rotation type | Markov transitions (1st/2nd order) from CDL pixel sequences per region → small GRU/Transformer as stretch | Top-1 and top-3 accuracy on held-out years |
| M4 | **Crop & bare-field detection** | Monthly cover status (crop/residue/bare); crop type where CDL does not exist | US: CDL plus an HLS/Landsat phenology classifier; NDVI/BSI/NDTI thresholds with harmonic gap-filling. Global: AlphaEarth embeddings + phenology features; Prithvi-EO-2.0 fine-tune as stretch | Agreement with CDL, NAIP spot checks, WorldCereal |
| M5 | **Stress & vulnerability windows** | Weekly hazard probabilities (frost, heat, dry spell, heavy rain, high wind) × crop-stage sensitivity; shifting-season trends | Climatology from 20–45 years of data + GBM trained on RMA cause-of-loss and yield shortfalls; change-point/trend tests | Hindcast hit rates |
| M6 | **Soil-health & water simulator** | Erosion (RUSLE + wind-erosion index; USDA WEPS/RWEQ where inputs allow), FAO-56 dual-Kc water balance, a simple soil-carbon pool model, N balance with legume credits, pest-host continuity | Process modules → **ML surrogate** (small NN or GBM trained on ~100k simulated runs) exported to **ONNX** so sliders respond in under 150 ms in the browser | Surrogate error within tolerance of the process modules; ET compared with OpenET; outputs within literature ranges |
| M7 | **Climate futures & Climate Twins** | 2041–2060 climate and re-scored suitability; analog regions | NEX-GDDP-CMIP6 deltas (SSP2-4.5 and SSP5-8.5, multi-model) on local baselines; Mahalanobis nearest neighbours over present-day cropland worldwide, run per climate model | Analog distance thresholds; model agreement |
| M8 | **Price & profit** | Net return distribution, P10, CVaR 5%, break-even | Price ensemble (seasonal naive + ETS + GBM) with conformal intervals; ERS and extension costs; Monte Carlo on joint yield–price draws. **Margin comparison first, optimization second** | Back-test on held-out years |
| M9 | **Rotation optimizer** | Generate, prune, simulate and rank strategies | Enumerate sequences → rules engine → simulate with M2/M6/M8 → Pareto (pymoo NSGA-II or exhaustive non-dominated sort) → TOPSIS with farmer weights + a diversity rule; **rank-stability** test under perturbed weights, years and inputs | Rules-clean output; ≥3 distinct strategies per pilot |
| M10 | **Uncertainty engine** | High/Medium/Low + reasons for every output | Combine data confidence (coverage, QA flags, satellite-versus-ground agreement), model spread (quantiles, conformal width), applicability domain (Mahalanobis/isolation-forest distance to training data) and scenario spread. Calibrate so "High" means intervals held the truth ≥80% of the time | Calibration report |
| M11 | **SI Narrator** | Plain-language summaries, card text, email digests, report | Default: deterministic templates from model JSON (works offline). Optional: LLM via API key with JSON-only inputs, a **number checker** (every numeral must match the JSON) and a citation requirement; refuse when data is missing; English and Spanish | Zero unchecked numerals |
| M12 | **Fusion & downscaling** | Field-relevant values from coarse grids, honestly | Random-forest downscaling of SMAP 9 km → 1 km (NDVI, LST, terrain, soil texture; checked against SCAN/USCRN); IMERG quantile-mapped to PRISM/CoCoRaHS; NDVI gap-filling; ET fusion (ECOSTRESS, OpenET, FAO-56) | Agreement reports |

**Rules engine (agronomy, not ML):**
- same family back to back → pest/disease penalty;
- wheat after corn → scab risk flag;
- legume before a high-N crop → N credit;
- residual herbicide carry-over → "check locally";
- season length and frost fit;
- water budget in a dry (P20) year;
- slope > 5% and bare during peak erosivity → require cover;
- cover-crop termination versus planting and insurance rules → "check locally";
- equipment, market and livestock constraints → hard filters.

Store the rules in `engine/rules/rules.yaml` with sources.

**Time basis on every prediction:** record the horizon and the information cutoff (observation, publication, retrieval and forecast-issue times). Keep historical replays, forecasts and hypothetical scenarios visibly separate. Pre-season estimates never use end-of-season data.

**What the app must never claim** (put this list in Sources & Methods and enforce it in narrator checks):
- sharp imagery reveals field-scale soil moisture or wind;
- NDVI measures yield, residue mass or soil carbon;
- GRACE regional storage describes a specific well;
- a common crop is a suitable crop;
- observational patterns prove the gain from switching a particular field to an unfamiliar crop;
- organic-matter gains are quick.

---

## 4. Data: use every listed source, plus the gap-fillers

The **research agent** first verifies each source's current endpoint, access method, licence and attribution, and writes `docs/DATA_SOURCES.md`. Use the fastest reliable access. Use subsetting (AppEEARS, Harmony/OPeNDAP, Earth Engine `reduceRegion`, STAC) instead of bulk downloads, and cache everything under `data/cache/`.

Credentials go in `.env`. If a key is missing, the app still runs on cached data and the coverage panel says what is unavailable.

**NASA (challenge list):**
- **SMAP:** L4 root-zone and surface at 9 km; L3 enhanced.
- **GPM IMERG:** Early/Late/Final runs; Worldview for quick-looks.
- **Landsat / HLS.**
- **MODIS / VIIRS:** NDVI/EVI, LST, ET.
- **NASA POWER:** daily agroclimatology API; also the primary global climate feed and a wind source.
- **SRTM / NASADEM:** slope, LS factor, wetness index, flow paths, frost pockets.
- **ECOSTRESS:** Collection 2 LST, ET and ESI.
- **GRACE / GRACE-FO:** mascons, water-storage trend.
- **GEDI:** L4A/L4B biomass, for landscape structure around fields.
- **NLDAS-2 / GLDAS:** long soil-moisture and ET records before SMAP.
- Also use **NASA GIBS WMTS** for imagery and science layers, **earthaccess** (Earthdata Login), **AppEEARS**, and **NEX-GDDP-CMIP6** (AWS open data) for Climate Twins.

**US ground, soil, land and market (challenge list):**
- **USDA Ag Data Commons:** rotation and cover-crop trial evidence.
- **Web Soil Survey:** "verify my soil" link-out; same data as SSURGO, so count them as one evidence family.
- **Cropland Data Layer:** history, transitions, labels, portfolio. It cannot see within-year cover crops.
- **PRISM:** normals, frost dates, bias correction.
- **SSURGO / STATSGO2** via Soil Data Access.
- **NAIP:** field-zoom imagery and checks.
- **NLCD (Annual):** farmland mask and landscape context.
- **CoCoRaHS:** rain-gauge validation pins.
- **USGS NWIS / Water Data APIs:** well and stream trends.
- **USDA AMS Market News (MyMarketNews):** prices, hay, market viability.
- **NASS QuickStats:** yields, acreage, "common here".
- **OpenET:** now all 48 contiguous states.
- **LANDFIRE:** vegetation and fuels context.

**Global & partner (challenge list):**
- **FAO GAEZ:** suitability prior.
- **Copernicus Sentinel-2:** 10 m imagery and indices.
- **ERA5 / ERA5-Land:** global climate, soil temperature, wind.

**Gap-fillers:**
- **Climate futures and foundation models:** NEX-GDDP-CMIP6; Prithvi-EO-2.0; AlphaEarth Satellite Embeddings (Earth Engine).
- **Field boundaries:** Fields of The World global boundaries (PMTiles).
- **Global crops and soils:**
  - CROPGRIDS
  - MapSPAM
  - ESA WorldCereal
  - SoilGrids
  - FAOSTAT
  - World Bank commodity prices
- **Canada:** AAFC Annual Crop Inventory; Statistics Canada.
- **US costs, losses and crop traits:**
  - USDA ERS Costs & Returns
  - USDA RMA Cause of Loss
  - FAO ECOCROP
  - FAO-56 crop coefficients
  - USDA PLANTS
  - cover-crop council tools
  - crop calendars
- **Ground validation:** NRCS SCAN, USCRN, AmeriFlux.
- **Forecasts and wind:**
  - NOAA NWS API (US forecasts)
  - Open-Meteo (global forecasts)
  - NOAA GHCN-hourly
  - MERRA-2
  - USDA WEPS
- **Terrain:** USGS 3DEP.
- **Boundaries, places and geocoding:**
  - Natural Earth and geoBoundaries (boundaries)
  - US Census TIGER
  - GeoNames (cities: capital plus top 5 per admin-1)
  - Nominatim or Photon geocoding (respect rate limits and attribution).

**Harmonization:**
- Use nested H3 grids: field polygons (30 m statistics), H3 res 8 (local), res 6 (regional), res 4 (basin/continental).
- Use conservative area-weighted remapping.
- Baselines: 1991–2020 and 2001–2025.
- Anomalies as percentiles.
- Every feature carries `source, version, native_res, effective_res, latency, qa_applied, licence`.
- The UI never presents a coarse value as field-level truth; it shows "regional value (≈25 km)".

**Coverage panel:**
- For any location, show availability of imagery, weather, soil, crop history, rules, outcome models, forecasts and markets: supported / partial / not available.
- **Recommendations switch on only where rules and model support exist**; environmental analysis works everywhere.
- Give Alaska, Hawaii and the territories an explicit status.

**Pilot regions** (precompute fully so the demo is instant; everything else is on demand):
- **US:**
  - Central Iowa (rainfed corn–soybean: bare soil and rain erosion);
  - Western Kansas (wheat–fallow and irrigated corn: water and wind);
  - San Joaquin Valley, California (heat, ET, groundwater).
- **Then Canada:** Saskatchewan (canola–wheat–pulses).
- **Then global:** Punjab, India (rice–wheat, groundwater decline) and Mato Grosso, Brazil (soy → second-crop maize).
- **Precompute:** CONUS at H3 res 6 (cropland at res 7); global cropland at res 4–5.

---

## 5. Architecture & stack

```
farmsmart/
  CLAUDE.md  AGENTS.md  README.md  .env.example  start.ps1  environment.yml
  contracts/   openapi.yaml · feature_registry.yaml · *.schema.json  (frozen early)
  data/        ingest_nasa/ ingest_us/ ingest_global/ cache/ (git-ignored)
  features/    harmonize/ (H3, Zarr, COG, GeoParquet)
  models/      m01_suitability … m12_fusion/ · model_cards/ · artifacts/
  engine/      rules/ strategies/ uncertainty/ profit/ replay/ twins/
  api/         FastAPI app
  web/         React + TypeScript (Vite)
  alerts/      scheduler, triggers, templates, outbox/
  qc/          checks, reports, screenshots/
  docs/        DATA_SOURCES.md · SI_USE_DISCLOSURE.md · LICENSES.md · METHODS.md · demo/
```

- **Front end:**
  - React + TypeScript + Vite;
  - **CesiumJS** (via Resium) for the 3D globe, terrain and 3D Tiles;
  - **MapLibre GL** for the 2D/mobile fallback;
  - D3 or visx for the wheel, petals, dot-plots and timelines;
  - Zustand and TanStack Query;
  - i18next (EN/ES);
  - PWA basics;
  - ONNX Runtime Web for the M6 surrogates (in a Web Worker).
- **Tiles:**
  - NASA GIBS (planet scale);
  - Sentinel-2 cloudless (regional);
  - NAIP (US field zoom) or another open imagery source;
  - terrain from Cesium World Terrain (Cesium ion token) or a NASADEM-derived fallback;
  - science overlays via **TiTiler** (dynamic tiles from COGs);
  - vectors via **PMTiles**.
- **Google Photorealistic 3D Tiles (optional):** a separate "Google mode" only, because their terms restrict mixing them with non-Google basemaps.
- **Back end:**
  - Python 3.11, FastAPI, Pydantic v2, uvicorn;
  - **DuckDB (spatial extension) + GeoParquet** for features and results;
  - SQLite for users, fields and alerts (no database server to install on Windows);
  - rasterio, rioxarray, xarray, zarr, exactextract or rasterstats, h3, earthaccess, pystac-client, earthengine-api (optional), requests-cache.
- **ML libraries:** scikit-learn, LightGBM, MAPIE, SHAP, statsmodels, pymoo, skl2onnx/onnxmltools; PyTorch + TerraTorch for the optional Prithvi fine-tune.
- **Alerts:**
  - APScheduler jobs;
  - email via SMTP (Gmail app password) or Resend/Postmark if a key is provided;
  - **with no email credentials, write each alert as an `.eml` file to `alerts/outbox/`** and show it in the in-app alert history, so the feature always works locally;
  - double opt-in, unsubscribe link, cooldowns, de-duplication, stale-alert suppression.
- **One-command run:**
  - `.\start.ps1` starts the API and the web dev server, then opens the browser.
  - `.\start.ps1 -Precompute` builds the pilot caches.
  - Also provide `npm run dev`, `npm run build` and `python -m fieldshift.cli --help`.
- **Shared data objects** (define them in `contracts/` before parallel work starts):
  - **Field profile:** geometry, area, region codes, time zone, crop history, constraints, confirmed values, version.
  - **Evidence record:** source and version; observation, publication and retrieval times; footprint; units; QA flags; transformation; citation; lineage.
  - **Crop definition:** canonical ID, regional variants and seasons, traits, constraints, references.
  - **Model prediction:** target, spatial support, information cutoff, model version, features, estimate and interval, uncertainty method, applicability.
  - **Rotation scenario:** crops and events, baseline ID, assumptions, weights, raw indicators, rank, reasons, exclusion reasons, review items.
  - **Analysis job:** field version, period, source and model versions, progress, failures, result manifest.
  
  Editing a field invalidates its dependent results.
- **Performance budgets:**
  - first globe render under 3 s;
  - cached pilot field report under 2 s; new field under 30 s with a progress bar;
  - slider response under 150 ms;
  - usable on a mid-range iPhone.

---

## 6. The agent team (create these as sub-agents)

Create sub-agent definitions in `.claude/agents/` (one Markdown file per agent, with a name, a description stating when to use it, and its tools). If your environment has no sub-agents, run the same roles as explicit sequential passes.

You are **Orchestrator**:
- you own the plan, the contracts, the task board (`docs/TASKS.md`), the gates and the scope-cut list;
- you integrate the work;
- each agent owns one folder and hands back a standard report: **work done · evidence it works · open issues · files changed · next dependency**.

| Agent | Mission | Owns | Done when |
|---|---|---|---|
| **research** | Verify every data source's endpoint, access, licence and citation; find proven open-source tools before writing new code; research agronomy evidence | `docs/DATA_SOURCES.md`, `docs/LICENSES.md` | Every source has a verified access method and attribution |
| **data-nasa** | Ingest and QA all NASA sources (QA masks applied) | `data/ingest_nasa/` | Pilot and CONUS assets pass data checks |
| **data-ground** | Ingest US, Canada and global ground, soil, market and crop data | `data/ingest_us/`, `data/ingest_global/` | All sources queryable for every pilot |
| **features** | H3 harmonization, climatologies, anomalies, feature store, M12 | `features/` | Features pass leakage, units and coverage checks |
| **ml** | Build, validate and document M1–M10 (calls agronomy for priors) | `models/`, `engine/uncertainty/` | Each model beats its baselines, is calibrated and has a model card |
| **agronomy** | Crop-trait knowledge base, rules engine, strategy families, glossary, "check locally" lists, crop-role explainers | `engine/rules/`, `engine/strategies/` | Every crop in any strategy has traits and sources |
| **globe-map** | Globe, tiles, boundaries, labels, search, field selection, layers, wind rose, zones, Climate Twins arcs, 2D fallback | `web/src/map/` | Performance budgets met; attribution and licence modes respected |
| **design** | Design system, every screen, visual hierarchy, copy, icons (including the satellite and SI buttons), motion | `web/src/design/`, `docs/design/` | Screens match this brief and feel award-quality |
| **spacing** | Layout and visual-rhythm audit at 1280, 1440, 1920 and iPhone 390/430: alignment, spacing scale, overflow, truncation, orphaned labels, tap targets | `qc/screenshots/`, `qc/spacing_report.md` | Zero overflow or clipping, a consistent scale, no overlapping elements |
| **frontend** | Build the React screens and components, Simple/Expert modes, i18n, report export | `web/src/` (except map/design) | The judge path runs smoothly on desktop and iPhone |
| **backend** | FastAPI per the contracts, caching, jobs, TiTiler, start scripts, deployment config | `api/`, `start.ps1` | Contract tests pass; latency budgets met |
| **alerts** | Subscriptions, triggers, scheduler, templates, outbox, backtests | `alerts/` | A real test alert and a weekly digest are delivered (or written to the outbox) |
| **narrator** | M11 templates and optional LLM, number and citation checker, plain-language model cards, Spanish | `engine/narrator/` | Zero unchecked numerals; reading level ≤ grade 8 |
| **checker** | QA/QC and red team (the "skeptical agronomist"): data checks, model validation review, agronomy sanity, never-claim enforcement, accessibility (axe), end-to-end tests (Playwright: Chromium desktop + WebKit iPhone), performance; signs every gate | `qc/` | No open blocker at any gate |
| **story** | README, METHODS, SI-use disclosure, demo script, 30-second video shot list, 7-slide deck outline, submission checklist | `docs/` | The submission package is complete |

**Waves** (at most one orchestrator plus three agents at a time if concurrency is limited):

| Wave | Agents | Checkpoint |
|---|---|---|
| **A · Definition** | research, agronomy, design | Contracts frozen, screen flow approved |
| **B · Foundation** | globe-map, data-nasa, data-ground | A searchable field shows real source summaries |
| **C · Intelligence** | ml, features, frontend | Three real strategies render from engine outputs |
| **D · Expansion** | alerts, narrator, data-ground (Canada/global) | Climate Twins, Drought Replay, coverage panel and alerts work |
| **E · Delivery** | checker, spacing, story | The judge path is polished; the submission is ready |

---

## 7. Build sequence & gates

1. **Setup (first hour):**
   - Create the environment, repo, `CLAUDE.md`/`AGENTS.md`, sub-agents and contracts.
   - Write `.env.example`.
   - **Ask me once** for any keys I have:
     - Earthdata Login (required);
     - Cesium ion;
     - NASS QuickStats;
     - AMS MyMarketNews;
     - OpenET;
     - Copernicus CDS;
     - Earth Engine project (optional);
     - email SMTP or Resend (optional);
     - LLM API (optional);
     - Google Maps (optional).
   - Then continue with whatever is available.
2. **Gate 1, Iowa vertical slice:** search → field → Area Report → what fits → three strategies with all card elements → Season Timeline, on **real data**, with the satellite and SI buttons everywhere. Get this working end to end before anything else.
3. **Gate 2, US complete:**
   - Kansas and California pilots, all US sources, M1–M10, wind erosion, Next Move, Season Wheel, Strategy Compare, Drought Replay, alerts, report export;
   - every challenge requirement visible.
4. **Gate 3, beyond the US:** Canada first, then Punjab and Mato Grosso; Climate Twins; coverage panel; Spanish.
5. **Gate 4, polish & ship:**
   - spacing and design audit, the full checker sweep, an iPhone pass;
   - deployment config (front end on Vercel; Python back end on Render or Fly.io; public GitHub repo; a cached demo fallback);
   - submission package.
   - **Code freeze about 3 hours before the submission deadline.**

**Scope-cut order if time runs short:** Prithvi fine-tune → voice input → Google 3D mode → multi-field optimization → third global pilot. **Never cut:** the real-data strategy cards with all their elements, the uncertainty display, the satellite and SI buttons, the "support, not replace" reminders, the existing-rotation baseline.

---

## 8. Acceptance tests (the checker runs these; all must pass)

- **Judge path (desktop, under 2 minutes):**
  1. Open the app and find "Story County, Iowa".
  2. Click a field. Field Studio loads.
  3. Compare rotations. The existing rotation plus two alternatives appear, each card with why, evidence, benefits, trade-offs and risks, gaps, check locally, and try it small.
  4. Open "Why not others?".
  5. Switch to Expert mode and open Next Move.
  6. Replay 2012.
  7. Open Climate Twins.
  8. Subscribe to an alert.
  9. Export the PDF report.
- **Repeat the path** for Garden City, Kansas; Saskatchewan; and Punjab (honest coverage flags where support is partial).
- **iPhone (WebKit, 390×844):** the same path works in portrait with the tabbed layout.
- **Every displayed number** traces to an evidence record or model prediction through its pop-over. Every SI output shows confidence with reasons.
- **Data checks:** QA masks applied, units and ranges checked, no future-data leakage, satellite-versus-ground agreement reports (IMERG vs PRISM/CoCoRaHS; SMAP vs SCAN; ET vs OpenET).
- **Model checks:** validation reports and model cards complete; calibration plots saved under `qc/`.
- **Requirements coverage:** `docs/REQUIREMENTS_TRACE.md` maps every objective and consideration in the challenge brief to a screen. It must cover:
  - temperature, heat stress, rainfall, soil moisture, evaporation, frost risk, extreme precipitation, vegetation stress, long-term water trends;
  - bare-field periods and vulnerable seasons;
  - pest-cycle, water-demand, infiltration and income opportunities;
  - the explained science terms;
  - satellite versus ground;
  - compared SI approaches;
  - harmonization to a common grid;
  - interactive trend maps;
  - field vulnerability zones;
  - timelines, dataset overlays and scenario sliders;
  - farmer priorities and constraints;
  - support-not-replace reminders.
- **Quality bars:**
  - WCAG 2.2 AA (axe: no serious issues);
  - performance budgets met;
  - the spacing report is clean at all widths;
  - no secrets in git;
  - no NASA logos;
  - "SI" terminology throughout.

---

## 9. Final deliverables

1. **The working app:** `.\start.ps1` runs locally on this PC, plus deployment configs for a public, login-free site.
2. **Docs:** `README.md` (what, who, how to run, architecture, limitations), `docs/DATA_SOURCES.md` (every source with role, version, licence and citation), `docs/METHODS.md`, the model cards, `docs/SI_USE_DISCLOSURE.md`, `docs/LICENSES.md` and `docs/REQUIREMENTS_TRACE.md`.
3. **Demo package (`docs/demo/`):**
   - **A 30-second video shot list with English subtitles**, recorded from the real app:
     1. orbit → field;
     2. the 25-year NASA pulse;
     3. the bare-soil gap meets windy and rainy weeks, and a cover crop fixes it;
     4. three strategies with confidence;
     5. the Climate Twins arc;
     6. the same flow in Punjab, and the end card.
   - An outline for a backup deck of up to 7 slides.
   - A submission checklist.
4. **A final report to me:**
   - what works;
   - what is partial and why;
   - which keys or data were unavailable;
   - validation scores;
   - the remaining risks;
   - exact steps to deploy and submit.

Start now with Setup. Keep `docs/TASKS.md` current so I can see progress at a glance.
