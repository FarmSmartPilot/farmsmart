# FarmSmart: methods

FarmSmart is a decision-support tool. It shows patterns, options, evidence, trade-offs and uncertainty. It does not replace farmer judgment or local agronomy advice. This page describes exactly how every number is made. The code that implements each step is named in brackets.

## 1. From a click to a field

| Step | Method | Code |
|---|---|---|
| Find a place | Decimal or DMS coordinates are parsed locally. Text goes to OpenStreetMap Nominatim at no more than 1 request per second, with attribution. | `fieldshift/ingest/geocode.py` |
| Field boundary (US) | USDA NASS Crop Sequence Boundaries 2024 return the polygon that contains the clicked point, with its 2017–2024 CDL crop codes. | `ingest/fields.py` |
| Other places | Draw a polygon or upload GeoJSON or KML. Fields of The World boundaries appear on the map. | `web/src/map` |
| Regional mode | Areas over 50 km² are analysed as a region, not a field. | `engine/analysis.py` |

## 2. Area Report (all real observations)

- **Weather and climate.** NASA POWER daily point data from 1991 to the present (AG community; MERRA-2-based meteorology, CERES/SYN1deg solar). It describes a ≈50 km grid cell, so the UI labels it "regional value".
  - Normals cover 1991–2020.
  - Trends use the Theil–Sen slope per decade with a Mann–Kendall (Kendall τ) p-value.
  - This season is ranked as a percentile against the same calendar window in every prior year.
  - [`engine/climate.py`]
- **Reference ET.** FAO-56 Penman–Monteith (Allen et al. 1998, eq. 6), computed daily from POWER Tmax, Tmin, RH, 2 m wind and solar radiation.
- **Frost.** The last spring and first fall day with Tmin ≤ 0 °C. We report the median and 1-in-10 values.
- **Weekly hazard climatology (M5, climatology layer).**
  - P(frost): Tmin ≤ 0 °C.
  - P(heat): Tmax ≥ 35 °C.
  - P(heavy rain): daily rain ≥ the local 95th percentile of wet days.
  - Windy days: daily max 10 m wind ≥ 8 m/s, an approximate threshold for wind erosion of loose bare soil (Fryrear et al. 1998; Bagnold 1941).
  - P(dry spell): less than 5 mm in 14 days.
  - Erosive-rain share uses the Richardson daily shape (P^1.81 for P ≥ 12.7 mm).
- **Soil.** USDA NRCS SSURGO through Soil Data Access, queried with the field polygon. Map units are weighted by their area inside the field, and major components by their percentage. We use the surface horizon for OM, texture, pH and Kw. Available water storage covers 0–100 cm. [`ingest/ssurgo.py`]
- **Terrain.** Terrarium elevation tiles at ≈10 m in the US (from USGS 3DEP, plus SRTM/NASADEM elsewhere).
  - Slope comes from finite differences.
  - The RUSLE LS factor uses the McCool et al. S equations and the AH-703 L exponent, with an assumed 50 m slope length.
  - Low spots are pixels ≥1.5 m below the field's 75th-percentile elevation, used as a frost-pocket and wet-spot proxy.
  - [`ingest/terrain.py`]
- **Crop history.** The USDA Cropland Data Layer gives a per-year pixel histogram inside the polygon for 2008–2025 (30 m, 10 m from 2024). The farmer confirms or edits it. [`ingest/cdl.py`]
- **Crops common here.** CDL county acreage. Common is not the same as suitable, and the UI says so.
- **Field greenness (NASA HLS v2.0, 30 m).** For the latest complete season (Apr–Oct north, Oct–Mar south), up to 24 Landsat 8/9 (L30) and Sentinel-2 (S30) scenes that cover the field. NDVI from red and near-infrared reflectance (scale 0.0001) for every 30 m pixel inside the polygon. Fmask removes cloud, adjacent cloud, shadow, snow/ice, water and high aerosol. A scene is withheld when fewer than 50% of the field's pixels are usable. Greenness is not yield, residue or soil carbon. [`ingest/hls_ndvi.py`]
- **Daytime water use (NASA ECOSTRESS L3T JET v003, 70 m).** The ETdaily estimate and its uncertainty layer at the pixel under the field centre, from day overpasses between 09:00 and 16:00 local solar time with the product's cloud and water masks clear. It is a model estimate for one pixel, not a measured field total. [`ingest/ecostress.py`]

## 3. What fits (hard constraints)

The agronomy rules engine (`engine/rules/rules.yaml`, 27 sourced rules) runs a safe expression language over each crop: season length (frost-free days, GDD), pH, drainage, equipment, market, livestock, the farmer's "won't grow" list, and legal planting windows. Every excluded crop keeps its reason, shown under "Why not others?". [`engine/rules_engine.py`, `engine/analysis.py::what_fits`]

Where it works: rotation comparison needs a crop calendar. The pilots use hand-checked calendars. Every other US state uses its own state-level usual dates from USDA NASS Agricultural Handbook 628 (2010), which are state averages, not county dates. Fields in Hawaii, and outside the US pilots' countries, get the environmental analysis only, and the app says so.

Defaults that are assumptions, shown to the user and editable:
- Equipment: what the field's own crop history implies.
- Markets: crops covering at least 0.5% of county cropland (USDA CDL).

## 4. Building options (M9 generator)

- **Baseline.** The existing rotation is detected from CDL, and it is always shown.
  - An exactly repeating recent pattern wins.
  - Otherwise we use the 2–4-year cycle that best matches recent crop frequencies.
- **Candidates.** We generate candidates in six strategy families (`engine/strategies/families.yaml`): Fill the gap · Extend & diversify · Water-wise swap · Integrate forage · Market-driven add · Pest-cycle break.
- **Screening.** Candidates using infeasible crops, or failing hard rules, are dropped with a reason. So are those that can't be scheduled, for example when a harvest comes too late to plant the next crop or there is too little time before frost for a cover.

## 5. Simulation (M6 process models)

Each candidate is run day by day over every complete sequence of real past weather years (NASA POWER, 1991 to the present), vectorized across years. [`engine/sim.py`]

| Output | Method |
|---|---|
| Crop calendar | Planting and harvest dates from `calendars.yaml` (NASS AH-628 state dates and sourced regional dates for the pilots) and `calendars_us_states.yaml` (every other US state: NASS AH-628 crop-section tables, built by `scripts/build_state_calendars.py`; Connecticut, Massachusetts, Rhode Island, New Hampshire and Vermont borrow New York's dates and say so). FAO-56 Table 11 stage lengths and Table 12 Kc. After maturity the crop stands dry until harvest. |
| Cover crops | Seeded 3 days after harvest. Ended 14 days before the next planting, or winter-killed at the median date the air first reaches the species' kill temperature. Canopy grows with temperature to full cover at ≈700 °C-days (an assumption, shown on cards). |
| Water balance | FAO-56 single-Kc root-zone bucket. TAW comes from SSURGO water storage 0–100 cm, with p = 0.5 and a Ks stress factor. Soil evaporation off-season uses Kc_bare = 0.3, cut by about 5% per 10% residue cover (FAO-56 ch. 9). Irrigated fields refill when depletion exceeds RAW, and the water pumped is reported. |
| Yield | FAO-33/66 Ya/Ym = 1 − Ky(1 − ETa/ETc) (Doorenbos & Kassam 1979), with a 40% loss if a killing frost hits mid-season. Rotation effects multiply yield using sourced rule effects, for example continuous corn −4.3% (Seifert et al. 2017). The yield index is 100 when there is no water stress and no rotation effect. **County yield in bu/ac (M2, SI):** for US fields with a known county, an SI model gives P10/P50/P90 for corn, soybean and winter wheat. It uses LightGBM quantile regression on NASA POWER season weather around the USDA NASS county trend, with conformalized 80% ranges, run over every weather year on record. Irrigated fields use the county's NASS irrigated series and rainfed fields the non-irrigated series when NASS published them; otherwise the value is labelled as the county average of all practices. It is labelled "county statistics, not your field" and validated in `models/model_cards/m02_yield.md`. |
| Water erosion | RUSLE A = R·K·LS·C·P (Renard et al. 1997, AH-703). R comes from mean annual rain (Renard & Freimund 1994), spread over each year's own erosive-rain days. The daily soil-loss ratio is the canopy subfactor times the surface-cover subfactor (b = 0.035). K is the SSURGO Kw converted to SI. P = 1. |
| Wind exposure | Σ over windy days of (U − 8)·U², weighted by bare fraction and SSURGO wind erodibility. This is a relative index, not tonnes. We also count "windy days on bare soil". |
| Residue and cover | Residue after harvest from ISU PM 1901a. Decay half-life by residue class is an assumption. Bare means soil cover below 30%. |
| Soil carbon | Two-pool ICBM (Andrén & Kätterer 1997). Inputs are stover and roots from yield and harvest index, and cover biomass from water use (≈15 kg DM per mm). The starting stock is SSURGO OM × 0.58 × 1.3 g/cm³ × 30 cm. Gains are slow, and the UI never claims quick organic-matter gains. |
| Nitrogen | Legume N credit to the next crop (sourced ranges). The yield bonus from legumes applies only when the farmer reports low N rates (Cernay et al. 2017). |
| Profit (M8) | USDA ERS Costs and Returns for the farm resource region. Ym is calibrated so the median simulated yield equals the **M2 county P50** (USDA NASS county trend plus weather; irrigated or non-irrigated series where available). For crops or places without M2 (sorghum, cotton, counties with under 8 years of NASS records) it equals the **ERS 5-year regional median**, and `economics.yield_anchor` names the source for each crop. NASS county yields are per harvested acre while ERS costs are per planted acre, so abandoned or grazed-out acres are not counted. Prices are real ERS harvest prices drawn by year, using the same year for all crops so correlation is kept. We subtract ERS operating costs, and $35–37/ac for covers (Plastina et al. 2018). This is net return over operating cost. |

**Your own numbers and options.** A farmer can enter price ($/unit), cost ($/ac) and yield per crop; profit then uses them for that crop and the card says "your prices". The "Lower prices" stress test scales prices by −20% (profit only). Farmer-built rotations (up to 4) go through the same rules, scheduling checks and simulation as generated ones and are ranked with them; ones that cannot work are returned with their reasons.

**Money calculator and risk (`POST /api/fields/{id}/money`).** The calculator reuses the comparison's simulation and recomputes money in the browser. For every option shown (and the farmer's own options) each simulated crop season is a *position* with a yield index per real weather sequence: the simulated yield divided by that crop's median simulated yield over the standard options, the same median the profit indicator calibrates to. So *yield = typical yield × yield index*, with the typical yield from M2 (county P50, SI) or the ERS 5-year regional median. Irrigated options also carry the water pumped in each season, per sequence, from the same water balance. Costs are USDA ERS cost lines per planted acre for the farm resource region, each the 2021–2025 median; prices are the ERS harvest-period prices of 2016–2025, nominal. For option *o*, weather sequence *s* and price year *p*: position net = typical yield × yield index[s] × price[p] − Σ cost lines − cover crop seeding ($36/ac, Plastina et al. 2018) − pumping $/acre-inch × irrigation[s] / 25.4 (− overhead lines if the farmer turns them on); the rotation-average net per acre per year is the sum of position nets divided by the years simulated. With USDA defaults and the comparison's price draw this reproduces the profit indicator to the cent for Story County IA and Finney County KS (irrigated); over all S × P pairs the median differs only by sampling (Story baseline $313 vs $288/ac/yr; Finney irrigated $332 vs $345). Options are compared on the weather sequences they all share. **Not counted:** pumping cost unless the farmer enters it, overhead unless turned on, government payments, crop insurance premiums and indemnities, storage, basis and marketing, taxes; the cost lines are regional averages, not the farm's own. **Risk from what happened here.** (1) Drought, heat, dry spells and in-season killing frost are already in the simulated years (NASA POWER 1991–present, ≈50 km); the response also lists the share of years with each (e.g. driest 10 % / 20 % growing seasons of the main crop, ≥ 5 days ≥ 35 °C in its season, a 14-day spell under 5 mm in July–August, a ≥ 25.4 mm spring rain day). (2) Losses the simulation does not model come from USDA RMA Cause of Loss records for the county, 2006–2025: per crop and cause, the years with a payout, their share, and the payout per insured acre in those years (indemnity ÷ all insured acres of that crop in the county that year, all practices). Payouts cover only losses beyond the deductible, so real losses were larger; price declines and area-plan endorsements are excluded; causes the simulation already covers (drought, heat, in-season freeze) are flagged `in_simulation` so they are not added twice. (3) OpenFEMA disaster declarations for the county or state in the last 20 years, one count per disaster. All three are labelled with their scale (regional ≈50 km, county records); none of them describes this field.

**Your soil test, nitrogen credit, conservation payments and the season outlook (wave U8).** *Soil test:* `compare` and `money` accept `farm.soil_test = {ph, om_pct, year}`. When sent and in range (pH 3–10.5, organic matter 0.1–60 %, year 1950–now), the farmer's pH replaces the mapped pH (SSURGO or SoilGrids) for the rules that use it (crop pH fit, lime needed) and the organic matter replaces the mapped value for the soil-carbon start (t C/ha = OM % × 0.58 × 1.3 g/cm³ × 30 cm ÷ 10). Every card gets an evidence line that names "your soil test (year)" and the mapped values it replaced. The soil-carbon indicator no longer carries the "modelled soil map" confidence penalty; the other indicators keep it, because texture, water-holding and drainage still come from the map. Out-of-range values are listed and ignored, never guessed. Without a soil test the comparison is byte-identical to before (checked on all 8 pilots). A different pH can change which crops pass the rules, which changes the option pool and so the profit calibration median. *Nitrogen credit:* each crop position in the money response carries `n_credit_lb_ac`: the legume credit the rules engine applies to a non-legume crop after a legume (rule `legume_before_high_n_crop`, value from the crop table: soybean 40 lb N/acre, K-State L-778 and UW A3517; pulses 23–31 kg N/ha, Preissel et al. 2015; alfalfa 50–150 lb N/acre, UMN). It is the midpoint of the sourced range in lb N/acre, with the range alongside. Legume covers before corn have no sourced amount, so they add no credit. The fertilizer price is the latest World Bank urea benchmark ($420/t, October 2026), converted to $0.414/lb N (÷ 2,204.62 lb/t ÷ 0.46 N). That is a world price, not a delivered farm price. *Cost-share:* the USDA NRCS EQIP payment schedule for the field's state and county, read from the NRCS payment schedule tool. It gives Cover Crop (340) and Conservation Crop Rotation (328) per-acre rates by scenario, with the historically underserved (HU-), high-priority (PR-) and source-water (WP-) rates where the state publishes them. Iowa, Kansas and California are committed snapshots (federal fiscal year 2027: Iowa 340 "Any Species" $74.75/ac, HU $89.70). Other states are fetched for the field's county and kept for 30 days. These are offered as optional income lines because payment needs an approved contract. *Season outlook:* `GET /api/fields/{id}/outlook` reads NOAA CPC's official outlook polygons (KML of the GIS product) at the field point. That means the latest 1-month outlook (`30day/lead14`) and the next three 3-month seasons (`90day/lead1–3`). For temperature and precipitation it returns the category (above, near or below normal, or equal chances) and the probability band (e.g. 40–50 %), plus the issue date. US only. The note says these are chances for a large region, not a forecast for the field. Files are cached for 12 h.

## 6. Ranking (M9) and uncertainty (M10)

1. **Hard filters**, then a **non-dominated (Pareto) set** over all indicators.
2. **TOPSIS** with weights from the farmer's drag-to-rank priorities (rank-order weights 0.35, 0.25, 0.18, 0.12, 0.06, 0.04, 0.02). An indicator any candidate lacks is dropped from the comparison, never filled in.
3. **Diversity rule.** We show the baseline plus the best two alternatives from different families.
4. **Rank stability.** We run 300 perturbations: Dirichlet weights around the farmer's weights, plus indicators resampled from simulated weather years. If the top choice wins less than 60% of them, the ordering is called uncertain.
5. **"What would change the choice"** names the smallest extra weight that would make the runner-up win.

**Confidence (High / Medium / Low) and its reasons** combine three things:
- **Spread:** P10–P90 width relative to P50 across weather years.
- **Data flags:** missing soil, regional weather, borrowed calendars.
- **Applicability:** whether the region and crop are supported.

## 7. Drought Replay

The field is replayed week by week through a real past year (e.g. 2012) for the current rotation and an alternative:
- **Bands:** soil water-holding capacity ±20%.
- **Comparison:** the yield outcome is set against the median of all simulated years.
- **Ghost:** the real MODIS MOD13Q1 NDVI at the field's 250 m pixel (QA: good or marginal only).

It is labelled a model replay, not an observation. [`engine/replay.py`]

## 8. Alerts

A 7-day Open-Meteo forecast (NOAA and ECMWF models) checks for:
- frost
- heat
- heavy rain on bare soil
- high wind with low cover
- dry-down

Each field's simulated soil cover sets when it is "bare". Delivery features:
- double opt-in
- unsubscribe link
- 48 h cooldown
- de-duplication
- stale-forecast suppression
- quiet hours (urgent alerts still go)

With no email credentials, alerts are written to `alerts/outbox/*.eml`. [`fieldshift/alerts/core.py`]

## 9. What FarmSmart never claims

- Sharp imagery shows field-scale soil moisture or wind.
- NDVI measures yield, residue mass or soil carbon.
- GRACE regional water storage describes a specific well.
- A common crop is a suitable crop.
- Observational patterns prove the gain from switching a particular field to an unfamiliar crop.
- Organic-matter gains are quick.

## 10. Known limitations

- POWER weather is regional (≈50 km). Field microclimate can differ.
- RUSLE uses an assumed slope length and no conservation practices.
- Wind is an exposure index, not a WEPS soil-loss estimate.
- Covers are modelled from temperature, not measured biomass.
- Calendars are state-level dates.
- Economics are regional ERS averages and US-only. ERS operating costs are regional averages over irrigated and dryland farms, so pumping costs on irrigated fields are understated.
- County yields (M2) describe the county, not the field. Weather explains little of next season's county yield anomaly: R² is 0.04–0.10 on held-out 2018–2024 (0.21–0.31 when the trend is known). M2's value is a calibrated range (80% coverage 0.81–0.86), not a sharp forecast. The largest error is extrapolating the county trend.
- NASS stopped most irrigated and non-irrigated county series after 2018. The practice mapping uses the years both were published (for example 2000–2010 for Finney County corn), and may have drifted since.
- NASS yields are per harvested acre and ERS costs are per planted acre, so profit is optimistic in years with abandonment (dryland wheat).
- See each model card in `models/model_cards/` for validation.

## Whole farm (wave U9)

Each field keeps its own simulation and money inputs (the same numbers as its money page). The farm view lines the fields up on the same real weather start years and the same USDA price years, so a dry year or a low-price year hits every field at once, as on a real farm. Farm results are whole-farm dollars a year (Σ acres × $/ac): typical = median, bad year = 10th percentile, good year = 90th percentile; chance of a losing year counts single calendar years with a farm loss. The diversification bonus is the farm's bad year minus the sum of each field's own bad year. Fields within ≈50 km share one NASA POWER weather cell, so the model treats their weather as identical and the bonus there comes mostly from different crops in the same year.

**Scores (1 to 10, `web/src/score.ts`).** Each part comes from the same simulated seasons × price years as the money numbers:
- **Profit:** where the plan's typical $/ac sits between the field's worst and best complete options (best = 10). It is capped at 3 if the plan loses money in a typical year, and is 10 when the options are within $5/ac of each other.
- **Risk safety:** 10 − 9 × min(1, chance of a losing single year ÷ 0.5). The farm score uses the farm's own chance of a losing year, so fields that balance each other raise it.
- **Soil & water:** for days of soil cover, water erosion, crop water use and the soil carbon trend, where the plan sits among the field's options (best = 10). It is the mean of the indicators available, and missing when the compare results are not loaded.
- **Total:** a weighted mean that follows the farmer's goal. Most money weighs profit, risk and soil & water 50/30/20; balanced 35/45/20; safest 20/60/20. Missing parts are dropped and the remaining weights renormalised. The farmer can set their own weights with sliders (0–100 each, normalised to shares); picking a goal under "Find the best plan" returns to that goal's preset. The plan search itself still optimises dollars for the chosen goal, not the score. The farm score uses acre-weighted profit and soil & water.
- **Bands:** ≥ 8.5 excellent, ≥ 7 good, ≥ 5 fair, ≥ 3 risky, < 3 high risk.
- **"Raise your score"** tries every other complete option of each unlocked field, one field at a time, and lists the changes that raise the farm score by at least 0.1.

Scores compare plans on the same simulated years. They are not a forecast or a guarantee.

The portfolio optimizer (SI) is a deterministic coordinate search over each field's ranked options (the current rotation plus the options that passed the rules): it maximises the typical year (most money), the mean of typical and bad year (balanced) or the bad year (safest), keeps locked fields and an optional cap on one crop's share of the farm in any year. Its confidence comes from the number of seasons × price years, the share of paired past years in which the suggested plan beat the current one, and how many inputs are the farmer's own. In past weather and prices a plan would have done this; past patterns do not prove a switch will pay.
