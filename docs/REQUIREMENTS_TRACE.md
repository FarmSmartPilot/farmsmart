# Requirements trace

This file maps every objective and "potential consideration" in the official challenge text (*FarmSmart: Adapting Farms with NASA Data*) and every item in the build brief §8 acceptance list to the screen, component and backend module that meets it.

Checked against the repository on 2026-11-14. Status key:
- ✅ done: works in the app and is backed by real data or a real model run.
- ⚠️ partial: the reason is given in the row.
- ❌ not done.

There are no `data/precomputed/nasa_*.json` files yet. SMAP L4, GPM IMERG, GRACE-FO and HLS are being integrated by the data-nasa agent (`fieldshift/ingest/earthdata.py`, `qc/validate_nasa.py`; both are uncommitted work in progress). Every row that depends on them is ⚠️ "in progress".

Paths: views are in `web/src/views/`, map code in `web/src/map/`, and backend modules in `fieldshift/`.

## 1. Challenge objectives

| # | Objective (challenge text) | Screen / component | Backend module | Status |
|---|---|---|---|---|
| O1 | A decision-support tool that combines NASA Earth observations with local soil, crop and farmer-priority data | Globe Home → Field Studio (`GlobeHome.tsx`, `FieldStudio.tsx`, `MyField.tsx`, `Options.tsx`) | `engine/analysis.py` (context + compare), `ingest/power.py`, `ingest/ssurgo.py`, `ingest/cdl.py`, `ingest/fields.py` | ✅ |
| O2 | Help farmers explore rotations that may improve soil health and resilience | Rotation options, Strategy Compare (`Options.tsx`, `StrategyCompare.tsx`) | `engine/strategies.py` (6 families), `engine/sim.py` (M6), `engine/rank.py` (M9) | ✅ |
| O3 | Use NASA data: **NASA POWER** | Area Report, timeline weeks, simulator weather, Drought Replay | `ingest/power.py`, `engine/climate.py` | ✅ Daily data 1991–2025 for every pilot |
| O3 | **SMAP** | Field map "Soil moisture" layer chip (`map/sources.ts`, GIBS `SMAP_L4_Analyzed_Root_Zone_Soil_Moisture`) | `ingest/earthdata.py` | ⚠️ In progress. Today it is a GIBS picture overlay labelled "regional value (≈9 km)". No SMAP number feeds any model yet. |
| O3 | **GPM / IMERG** | Field map "Rain" layer chip (GIBS `IMERG_Precipitation_Rate`) | `ingest/earthdata.py` | ⚠️ In progress. Picture overlay only. Rain numbers come from POWER. |
| O3 | **Landsat / HLS** | none yet | `ingest/earthdata.py` | ⚠️ In progress (HLS NDVI) |
| O3 | **MODIS** | Drought Replay NDVI "ghost"; field map "Heat" chip (GIBS MODIS Terra LST 8-day) | `ingest/modis.py` (MOD13Q1 via ORNL subsets), `engine/replay.py` | ✅ NDVI ghost uses real data. The LST layer is a picture overlay. |
| O3 | **GRACE / GRACE-FO** | none yet. The "Water-storage trend" alert kind is listed in Alerts. | `ingest/earthdata.py` | ⚠️ In progress |
| O3 | **SRTM / NASA elevation** | Area Report terrain: slope, steep share, low spots, relief | `ingest/terrain.py` (Terrarium tiles: USGS 3DEP in the US, SRTM/NASADEM elsewhere) | ✅ The US pilots use 3DEP. SRTM is used outside the US. |
| O3 | **ECOSTRESS** | none | none | ❌ Not integrated. The heat-stress and ET rows use POWER and FAO-56 instead. |
| O3 | NEX-GDDP-CMIP6 (NASA climate projections) | Climate Twins (`ClimateTwins.tsx`) | `engine/twins.py` (M7) | ✅ 6 models, SSP2-4.5 and SSP5-8.5 (`models/model_cards/m07_climate_twins.md`) |
| O4 | Local soil information | Area Report soil section; MY FIELD soil row | `ingest/ssurgo.py` (US), `ingest/soilgrids.py` (global, uncommitted) | ✅ US. ⚠️ Global soil is still being wired. |
| O5 | Crop characteristics | Why-not panel, card "Why suggested" | `engine/rules/crops.yaml` (32 crops), `calendars.yaml` | ✅ |
| O6 | Highlight times when fields are typically bare | Season timeline (red hatching), Season Wheel, option mini-strips "N bare weeks/yr" | `engine/sim.py` (cover < 30% = bare), `analysis.py` timeline | ✅ Bare periods are **modelled** from crop calendars, residue decay and cover growth. They are not detected from satellites, because M4 is not trained. |
| O7 | Seasons when current crops appear more vulnerable | Timeline windy and heavy-rain week columns; Season Wheel frost/heat rim icons; Area Report weekly hazards | `engine/climate.py` (M5 climatology layer) | ✅ Climatology only. The M5 GBM on cause-of-loss data is not trained. |
| O8 | Opportunities to interrupt pest cycles | "Pest-cycle break" family; `pest_break` indicator; rules trace in Strategy Compare | `engine/strategies.py`, `engine/rules_engine.py` (`rules.yaml`) | ✅ |
| O9 | Reduce water demand | "Water-wise swap" family; "Crop water use" indicator; dry-year regret (Next Move) | `engine/sim.py` (FAO-56) | ✅ |
| O10 | Improve infiltration | Area Report drainage and hydrologic group; simulated deep drainage | `ingest/ssurgo.py` (`hydgrp`, `drainagecl`), `sim.py` (`deep_drainage_mm`) | ⚠️ Deep drainage is computed but not shown as a card indicator. There is no direct infiltration metric. SMAP dry-down is in progress. |
| O11 | Add supplemental income | "Market-driven add" family; "Typical net return" and "Bad-year net return" indicators | `ingest/econ.py` (M8: ERS costs and returns, World Bank price ensemble) | ✅ US only. Economics are regional ERS averages. |
| O12 | Compare at least three strategies, including the existing rotation | Rotation options (baseline + 2 alternatives); Strategy Compare | `engine/rank.py` (Pareto, TOPSIS, diversity rule) | ✅ Story County: current rotation + 2 alternatives out of 9 simulated (`data/precomputed/compare_b96d39c7a833.json`) |
| O13 | For each strategy: why, evidence, benefits, gaps, risks needing local review | Strategy card sections: Why suggested · Evidence · Benefits · Trade-offs & risks · Information gaps · Check locally · Try it small | `analysis.py` card builder, `strategies/families.yaml` (sourced text) | ✅ |
| O14 | A supportive tool that does not replace farmer judgment | `Reminder` component on Field Studio, Options, Next Move, Drought Replay, Climate Twins, Alerts; PDF footer; last tour step | `api/pdf.py` | ✅ |

## 2. Potential considerations: understanding conditions and data

| # | Consideration | Screen / component | Backend | Status |
|---|---|---|---|---|
| C1 | How temperature, soil moisture, rain, evaporation and vegetation stress relate to crop vulnerability and soil health | Area Report → cards → timeline | `climate.py`, `sim.py` (Ks water stress, yield Ya/Ym, RUSLE, ICBM carbon) | ⚠️ Temperature, rain and ET use real data. Soil moisture is POWER root-zone wetness (a MERRA-2 model value) plus simulated soil water. Vegetation stress appears only as the MODIS NDVI ghost. SMAP and HLS are in progress. |
| C2 | Explain ET, soil-moisture anomalies, NDVI, frost risk and water balance | Dotted-underline glossary pop-overs (`components/common.tsx` `Term`, `design/Provenance.tsx` `GlossaryTerm`) | `engine/rules/glossary.yaml` (19 terms, EN/ES) via `/api/kb/glossary` | ✅ Includes et, ndvi, soil_moisture_anomaly, frost_risk, water_balance, rusle, p10_p50_p90, gdd and others. |
| C3 | How satellite observations differ from ground measurements | Sources & Methods → "Satellite vs ground" table (`SourcesMethods.tsx`); "regional value" labels; map caption "Pictures show cover, not soil moisture or wind" | `qc/validate_weather.py` → `qc/reports/weather_agreement.md`, `/api/validation/weather` | ⚠️ POWER vs NOAA GHCN is done for 2 pilots. IMERG vs PRISM/CoCoRaHS, SMAP vs SCAN and ET vs OpenET are not done (`qc/validate_nasa.py` is in progress). |

## 3. Potential considerations: SI, modelling and data fusion

| # | Consideration | Screen / component | Backend | Status |
|---|---|---|---|---|
| C4 | Compare different SI or statistical approaches | Next Move "Usual next" with SI button; Sources & Methods → Model cards | `models/m03_sequence.py`; `ingest/econ.py` | ⚠️ M3 Markov vs 2 baselines. M8 ensemble vs seasonal-naive, ETS and LightGBM members. M7 compares RMS-z distance with Mahalanobis (the reason is in its card). M1 suitability and M2 yield quantiles are not trained, so there is no comparison for them. |
| C5 | SI highlights seasonal transitions, bare periods and stress times | Timeline, Season Wheel, Drought Replay | `sim.py`, `climate.py`, `replay.py` | ⚠️ These are done with process models and climatology, labelled "process model" and not SI. The SI detector (M4) is not trained. |
| C6 | How the model interprets uncertainty, and where local expertise is needed | Confidence chip with reasons on every card and indicator; "The ordering is uncertain" banner; "What would change the choice"; Check locally; Information gaps | `engine/uncertainty.py` (M10), `rank.py` (300-run rank stability) | ⚠️ Works in the app. Example: Story County's top option wins 40% of perturbations, so the app says the ordering is uncertain. **There is no calibration report in `qc/` yet**, although `SI_USE_DISCLOSURE.md` names one. |
| C7 | Harmonize datasets to a common analysis grid | none visible (Sources & Methods lists the resolutions) | Per-field fusion: SSURGO area-weighted to the polygon, CDL pixel histogram, terrain zonal stats, nearest POWER cell, NEX-GDDP deltas applied to the POWER baseline, analog search on a 1° cropland grid (`twins.py`) | ⚠️ Every source is reduced to the field polygon with its native scale labelled. There is no shared analysis grid (H3 or similar), and no fused SMAP/ECOSTRESS/GPM/NDVI/GEDI feature stack. GEDI is not used. |

## 4. Potential considerations: rotation strategy exploration

| # | Consideration | Screen / component | Backend | Status |
|---|---|---|---|---|
| C8 | Nutrient cycling | "Nitrogen from legumes" indicator | `sim.py` N balance with legume credits | ✅ |
| C8 | Erosion risk | "Soil lost to water (RUSLE)", "Wind exposure on bare soil", bare + windy / heavy-rain overlap | `sim.py` | ✅ Wind is a relative index, not tonnes. |
| C8 | Organic matter | "Soil carbon trend" | `sim.py` (ICBM two-pool) | ✅ Labelled slow, never quick. |
| C8 | Pest-cycle disruption | `pest_break` indicator, rules trace | `rules_engine.py` | ✅ |
| C8 | Water use | "Crop water use", dry-year regret | `sim.py` | ✅ |
| C8 | Forage potential | "Integrate forage" family; exclusion when there is no livestock or hay buyer | `strategies.py`, rules | ⚠️ No forage-yield indicator |
| C8 | Market considerations | Markets row in MY FIELD (crops ≥0.5% of county cropland); "No buyer … confirmed" exclusions; net return | `analysis.py::what_fits`, `econ.py` | ✅ US only |
| C9 | Map rotation ideas to farmer priorities | MY PRIORITIES drag-to-rank chips → "Match to your priorities" bar and "Best for you" tag | `rank.py` (rank-order weights → TOPSIS) | ✅ Re-ranks live (tour step 7). |
| C10 | Explain how N-fixing, cover, deep-rooting and drought-tolerant crops help soil | Card "Why suggested" / "Benefits" (sourced family text); glossary `cover_crop`, `nitrogen_credit`, `root_zone` | `strategies/families.yaml`, `rules/crops.yaml` | ✅ |

## 5. Potential considerations: geospatial mapping and visualization

| # | Consideration | Screen / component | Backend | Status |
|---|---|---|---|---|
| C11 | Interactive maps of trends over time (soil moisture, heat waves, water storage) | Field map GIBS layer chips (Soil moisture, Rain, Heat) with the actual tile date; Area Report trend sentences and monthly chart | `climate.py` trends (Theil–Sen, Mann–Kendall) | ⚠️ Trends are numbers and charts, not maps. The overlays show one date, with no time scrubber. GRACE storage is in progress. |
| C12 | Field-level vulnerability zones (erosion, water stress, frost pockets) | Field map "Erosion zones" chip: slope zones and low spots (frost-pocket / wet-spot proxy) (`map/FieldMap.tsx`, `mapBridge.tsx`) | `ingest/terrain.py` | ⚠️ Terrain zones only. No water-stress hotspot map, because ECOSTRESS is not integrated. |
| C13 | Timelines | Season timeline (2 years, aligned) + table alternative (`SeasonTimeline.tsx`); Drought Replay week slider | `analysis.py`, `replay.py` | ✅ |
| C13 | Overlays comparing datasets | GIBS overlays on the field map; satellite-vs-ground table | `map/sources.ts` | ⚠️ No split-screen dataset comparison |
| C13 | Scenario sliders that adjust rain or temperature | Scenario switch Normal / Dry / Hot / Wet (top-bar chip, Next Move); Climate Twins SSP switch | `analysis.py::_scenario` | ⚠️ A discrete switch, not continuous sliders |

## 6. Potential considerations: farmer-centred design

| # | Consideration | Screen / component | Backend | Status |
|---|---|---|---|---|
| C14 | Easy to read for farmers with little technical experience | Simple/Expert toggle, Season Wheel (Simple), plain-language strings (`i18n/en.json`), EN/ES, guided Demo tour, table alternative for charts | none | ⚠️ Built. The axe, Playwright and iPhone QC sweep is still pending (`docs/TASKS.md`). |
| C15 | Farmer inputs for priorities and constraints (water, equipment, markets) | MY FIELD: rainfed/irrigated + water per year, equipment, livestock, hay buyer, markets, editable crop history and rotation | `analysis.py::what_fits`, `rules_engine.py` | ✅ ⚠️ There is no "won't grow" list in the UI yet. |
| C16 | Reminders that the tool supports and does not replace expertise | `Reminder` on every decision screen; "Check locally" on cards; PDF; tour step 12 | `api/pdf.py` | ✅ |

## 7. Build brief §8 coverage list

| Item | Where | Status |
|---|---|---|
| Temperature | Area Report normals, trends and this season (Story County: +0.49 °C/decade, likely 0.14 to 0.85, 1991–2025, `context_b96d39c7a833.json`) | ✅ |
| Heat stress | Hot days ≥35 °C (normals, trend, season); weekly P(heat); heat alert; Twins hot days | ✅ ECOSTRESS ❌ |
| Rainfall | Area Report (POWER), season percentile, simulator input | ✅ IMERG ⚠️ in progress |
| Soil moisture | POWER root-zone wetness (MERRA-2) in "This season"; simulated soil water in Drought Replay; SMAP picture overlay | ⚠️ SMAP data in progress |
| Evaporation | FAO-56 Penman–Monteith ET₀ ("Water demand (ET₀)"), water balance, crop water use | ✅ No OpenET or ECOSTRESS check |
| Frost risk | Frost dates (median and 1-in-10), weekly P(frost), frost alert, Season Wheel rim | ✅ |
| Extreme precipitation | Heavy-rain days (normals and trend), heavy-rain weeks, erosivity, heavy-rain-on-bare-soil alert | ⚠️ POWER (≈50 km) catches only 8.3% of gauge heavy-rain days on the same day at Story County (38% within ±1 day; `qc/reports/weather_agreement.md`). IMERG is in progress. |
| Vegetation stress | MODIS NDVI ghost (Drought Replay); simulated water stress | ⚠️ HLS in progress |
| Long-term water trends | Water-balance trend (P − ET₀) in Area Report | ⚠️ GRACE-FO in progress |
| Bare-field periods | Timeline, Season Wheel, bare weeks/yr | ✅ (modelled) |
| Vulnerable seasons | Windy and heavy-rain week columns, hazard climatology | ✅ |
| Pest-cycle opportunity | Pest-cycle break family and indicator | ✅ |
| Water-demand opportunity | Water-wise swap, water use, dry-year regret | ✅ |
| Infiltration opportunity | Soil drainage/hydrologic group; deep drainage (not shown) | ⚠️ |
| Income opportunity | Market-driven add, net return P50/P10 | ✅ US only |
| Explained science terms | Glossary pop-overs (19 terms, EN/ES) | ✅ |
| Satellite vs ground | Sources & Methods table (POWER vs GHCN) | ⚠️ Other pairs pending |
| Compared SI approaches | M3 vs baselines; M8 members; model cards | ⚠️ M1/M2 not trained |
| Harmonization to a common grid | Per-polygon reduction with scale labels | ⚠️ No common grid |
| Interactive trend maps | GIBS overlays + trend charts | ⚠️ No time-scrubbed trend map |
| Field vulnerability zones | Terrain erosion zones and low spots | ⚠️ No water-stress map |
| Timelines | Season timeline, replay slider | ✅ |
| Dataset overlays | GIBS SMAP / IMERG / MODIS LST layers | ⚠️ Pictures only |
| Scenario sliders | Normal/Dry/Hot/Wet switch; SSP switch | ⚠️ Discrete switch |
| Farmer priorities and constraints | MY PRIORITIES, MY FIELD | ✅ |
| Support-not-replace reminders | Every decision screen + PDF | ✅ |

## 8. Build brief §8 judge path

| Step | Screen | Status |
|---|---|---|
| 1. Find "Story County, Iowa" | Globe Home search / pilot list | ✅ |
| 2. Click a field → Field Studio | `FieldStudio.tsx` | ✅ |
| 3. Compare rotations → baseline + 2 alternatives, all 7 card sections | `Options.tsx` | ✅ |
| 4. "Why not others?" | `WhyNotOthers` popover | ✅ |
| 5. Expert mode → Next Move | `NextMove.tsx` | ✅ |
| 6. Replay 2012 | `DroughtReplay.tsx` (computed live, not precomputed) | ✅ |
| 7. Climate Twins | `ClimateTwins.tsx` (precomputed for Story IA and Garden City KS only) | ✅ |
| 8. Subscribe to an alert | `AlertsSettings.tsx` (outbox when SMTP is not set) | ✅ |
| 9. Export PDF | Top bar → `/api/fields/{id}/report.pdf` | ✅ |
| Repeat for Garden City KS | precomputed `compare_b20f28194396.json`, `twins_garden_city_ks.json` | ✅ |
| Repeat for Saskatchewan and Punjab | no precomputed compare; ingest (`aafc.py`, `soilgrids.py`) is uncommitted | ❌ Not yet. Recommendations are switched off outside the US pilots. |
| iPhone 390×844 portrait | Tabbed Field Studio (Map · Options · Timeline · My Field) | ⚠️ Built but not yet tested in WebKit |
| Region Compare view (brief §2) | none | ❌ |
| "Changes since your last visit" (brief §1.6) | none | ❌ |
| Season Wheel drag-a-cover-into-a-gap | `SeasonWheel.tsx` (view only) | ⚠️ No drag interaction |
