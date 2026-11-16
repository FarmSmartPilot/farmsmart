# M2 · County yield and yield risk (model card)

## Purpose
Give each US field a **county** yield range in the crop's own unit (bu/ac): P10 / P50 / P90 for a typical year, built from the county's USDA NASS yield trend and the season weather of every year on record. It anchors the profit numbers (M8) and shows how much yield swings with weather. It describes the county average, **not the farmer's field**, and the app labels it "county statistics, not your field". It never claims that a switch would raise yield.

Code: `fieldshift/models/m02_yield.py` (`run_all`, `county_outlook`); NASS ingest `fieldshift/ingest/nass.py`; app wiring `fieldshift/engine/analysis.py::_yield_county`. Re-run: `python -m fieldshift.models.m02_yield` (about 7 minutes with cached inputs).

## Data
| Input | Source | Years | Scale |
|---|---|---|---|
| County yield (survey, all production practices, per harvested acre), planted and harvested acres | USDA NASS Quick Stats API | 2000–2025 (2025 used only as a new-season check) | county |
| Daily Tmax, Tmin, rain (PRECTOTCORR), root-zone wetness (GWETROOT), RH, 2 m wind, solar | NASA POWER daily point API, AG community | Sep 1999 – Dec 2025 | ≈50 km grid cell (0.5° × 0.625°), at the Census 2023 county internal point |
| County internal points | US Census 2023 Gazetteer (counties) | static | county |

States: IA, IL, MN, NE, MO, KS, CO, OK, TX, CA, ND, SD. Counties need at least 8 yield years.

| Crop | County-years (≤ 2024) | Counties | States |
|---|---|---|---|
| Corn (grain) | 17,727 | 853 | 12 |
| Soybean | 14,868 | 694 | 10 |
| Winter wheat | 12,549 | 704 | 12 |
| Sorghum (grain) | 5,404 | 350 | 8 |

Committed copies: `data/reference/nass_county_yields.parquet` (all NASS rows above, 0.5 MB), `models/m02_yield/m02_yield.json.gz` (boosters and metadata, 0.7 MB), `models/m02_yield/validation.json`, `models/m02_yield/holdout_predictions.parquet`. Full artifact (git-ignored): `models/artifacts/m02_yield.pkl`.

## Method
- **Target.** Relative yield anomaly = yield / trend − 1. The trend for each county keeps the county's own level (median of yield − slope·t) with the **state technology slope**: the median of the county Theil–Sen slopes in that state (pooled median if a state has fewer than 5 counties). Pure county slopes extrapolated badly. In Oklahoma corn, a few volatile years tilted the lines so far that the 2018–2024 anomalies averaged +76 %. The trend is added back for every prediction. For the app it is evaluated at the next season, at most 3 years past the cutoff (2027 today).
- **Features** (stage-specific, per harvest year):
  - **Corn, soybean, sorghum:** rain and FAO-56 ET0 − rain deficit for each month May–Sep, raw and as anomalies from the location's 2001–2017 normal. Root-zone wetness and its anomaly for Jun–Aug. Days ≥ 35 °C in the flowering window (corn Jul 1–Aug 15; soybean and sorghum Jul 15–Aug 31) and days ≥ 32 °C Jun–Aug. GDD May–Sep (10/30 °C). July Tmax, July and August night temperature, April–May rain, frost-free days.
  - **Winter wheat (Sep–Jun season):** rain, deficit and their anomalies for Mar–Jun. Wetness anomalies for Mar–May and the previous fall. Fall and winter rain, days ≤ −18 °C, spring freeze days (≤ −2 °C, Apr 1–May 15), heat days ≥ 32 / 35 °C in May 15–Jun 20, GDD Mar–Jun, May Tmax.
  - **All crops:** log of the county trend yield (productivity level).
  - No soil inputs: SSURGO-free proxies were skipped.
- **Model.** LightGBM quantile regression, α = 0.1 / 0.5 / 0.9, 300 trees, 7 leaves, ≥ 100 rows per leaf. A small sweep on the temporal split picked this setting over 15 or 4 leaves. Quantiles are sorted to prevent crossing.
- **Conformal calibration (CQR, Romano et al. 2019),** implemented in numpy. MAPIE 1.6 imports, but our rolling-origin score scheme is not one of its options.
  - Scores come from rolling origins: the trend and models are fitted up to season *o* and scored on *o*+1…*o*+3, so the scores include trend extrapolation, as in use. Production origins are 2012, 2015, 2018 and 2021, giving 7,450 corn scores.
  - P10 is lowered and P90 raised by the conformal quantile *q̂* (relative units). Production *q̂*: corn 0.066, soybean 0.055, winter wheat 0.123.
- **Typical year for a field.** The model runs on the field's own POWER series for every complete season, 1991–2025 (35 for summer crops). Each year's P10/P50/P90 defines a piecewise-linear distribution. The app reports P10/P50/P90 of the mixture, plus the per-year P50 and the worst weather year.
- **Drivers.** LightGBM `pred_contrib` on the P50 model, converted to bu/ac. The top 3 weather features by mean absolute effect across weather years, and the 2 most negative in the worst year. Trend level is excluded because it is not weather. The `shap` package is not used.
- **Applicability flag.** This is the share of feature values outside the training 1–99 % range. Above 5 %, confidence is lowered.

## Validation (run 2026-11-14)
Metrics are in bu/ac after adding the trend back:
- **Pinball:** mean pinball loss over α = 0.1/0.5/0.9 (lower is better).
- **Coverage / width:** of the conformalized 80 % range.
- **R²:** R² of the relative anomaly from the P50.

The baselines are:
- **B1:** the county's last 5-year mean anomaly as P50, with the county's own training-anomaly P10/P90 (climatology).
- **B2:** OLS of the anomaly on July rain and flowering heat days (May rain for wheat), with residual quantiles.

**Temporal hold-out: trend and models fitted 2000–2017, tested on 2018–2024** (the trend is extrapolated 1–7 years).

| Crop | n | Pinball M2 | B1 | B2 | Coverage 80 % (raw → CQR) | Width bu/ac | R² anom M2 | B1 | B2 |
|---|---|---|---|---|---|---|---|---|---|
| Corn | 4,205 | **5.68** | 5.98 | 5.95 | 0.61 → **0.86** | 64.2 | **0.10** | −0.11 | 0.06 |
| Soybean | 3,554 | **1.78** | 1.90 | 1.81 | 0.60 → **0.81** | 16.7 | 0.05 | −0.26 | **0.09** |
| Winter wheat | 2,352 | **2.86** | 2.93 | 2.94 | 0.58 → **0.81** | 28.7 | **0.04** | −0.07 | −0.09 |
| Sorghum | 798 | 5.70 | 5.47 | **5.22** | 0.52 → 0.71 | 42.4 | −0.23 | −0.67 | −0.24 |

**Coverage by test year:**

| Crop | 2018 | 2019 | 2020 | 2021 | 2022 | 2023 | 2024 |
|---|---|---|---|---|---|---|---|
| Corn | 0.92 | 0.92 | 0.88 | 0.85 | 0.80 | 0.83 | 0.82 |
| Soybean | 0.83 | 0.88 | 0.89 | 0.80 | 0.78 | 0.74 | 0.74 |
| Winter wheat | 0.89 | 0.75 | 0.87 | 0.77 | 0.87 | 0.68 | 0.87 |
| Sorghum | 0.82 | 0.85 | 0.86 | 0.78 | 0.43 | 0.48 | 0.73 |

**Spatial hold-out: leave one state out, all years 2000–2024.** County trends here come from each county's own record. CQR uses year-grouped out-of-fold scores.

| Crop | n | Pinball | Coverage 80 % | Width | R² anom | Worst state (coverage) |
|---|---|---|---|---|---|---|
| Corn | 17,727 | 4.50 | 0.82 | 47.3 | 0.25 | OK 0.75 |
| Soybean | 14,868 | 1.29 | 0.83 | 13.5 | 0.31 | TX 0.70 |
| Winter wheat | 12,506 | 2.01 | 0.83 | 22.3 | 0.21 | CA 0.77 |
| Sorghum | 5,404 | 3.68 | 0.79 | 35.3 | 0.15 | CO 0.67 |

**One new season (2025, not used for training; production model):**

| Crop | n | Coverage | R² |
|---|---|---|---|
| Corn | 493 | 0.88 | 0.03 |
| Soybean | 420 | 0.86 | 0.19 |
| Winter wheat | 307 | 0.78 | −0.55 (2025 wheat beat the trend widely) |
| Sorghum | 73 | 0.85 | n/a (not deployed) |

**Deployment decision.** M2 is used in the app for **corn, soybean and winter wheat**, which beat both baselines on temporal pinball loss with ≥ 80 % coverage. **Sorghum is not deployed.** It lost to B2 and covered only 0.43–0.48 in the 2022–2023 Plains drought. Sorghum cards keep the USDA ERS regional yield for profit and say why.

**Honest reading.**
- Weather explains little of the *year-ahead* county anomaly in 2018–2024 (R² 0.04–0.10). Much of the error is trend extrapolation and local events the weather cannot see: the 2020 derecho, hail, prevented planting and abandonment.
- With the trend known (leave-one-state-out), weather explains 21–31 %.
- The value of M2 is a calibrated **range** around a county-specific trend, not a sharp point forecast.

## Irrigated and dryland fields (practice mapping)
M2 is trained on NASS "all production practices" county yields. Where NASS also published the county's IRRIGATED or NON-IRRIGATED yields, `practice_factors` maps the M2 range to the farm's practice using the years both series exist. NASS ended most practice series after 2018: it is mainly NE, KS, SD, CO, ND and TX, plus CA wheat to 2007. The mapping is:
- **Level:** the median ratio of practice yield to all-practices yield, *r*.
- **Swing:** the ratio of detrended log-yield SDs, *s*, floored at 1, so the range never gets narrower than M2's own. The farm's water setting picks the series: irrigated, or non-irrigated for rainfed.
- **Result:** yield = *r* · trend · (1 + *s* · anomaly).

With fewer than 5 paired years, the card shows the all-practices value with a note.

**Check on the leave-one-state-out ranges**, with *r* and *s* from each county's other years:

| Series | County-years | 80% coverage: mapped | 80% coverage: all-practices unchanged | Pinball: mapped / unchanged |
|---|---|---|---|---|
| Corn irrigated | 2,642 | 0.895 | 0.329 | 5.49 / 14.21 |
| Corn non-irrigated | 2,769 | 0.876 | 0.354 | 5.63 / 18.36 |
| Soybean irrigated | 1,268 | 0.861 | 0.426 | 1.65 / 3.48 |
| Soybean non-irrigated | 1,241 | 0.893 | 0.450 | 1.78 / 3.99 |
| Winter wheat irrigated | 1,807 | 0.822 | 0.324 | 2.92 / 5.85 |
| Winter wheat non-irrigated | 3,343 | 0.831 | 0.718 | 2.09 / 2.69 |

Letting *s* shrink below 1 for irrigated series under-covered (0.67–0.75), which is why it is floored.

**Pilot examples:**
- Finney County KS irrigated corn: *r* = 1.05 from 2000–2010, giving P50 189 bu/ac against 180 for all practices.
- Finney dryland winter wheat: P50 37 against 43 bu/ac.
- Fresno CA irrigated wheat: *r* = 1.18 from 2000–2007, giving P50 81 bu/ac.

## Calibration and M10
`qc/calibrate_m10.py` produces `qc/reports/calibration_m10.md` and `.png`. M2 ranges labelled **High** by M10 held the observed county yield 89.0 % of the time on held-out years and 84.9 % on held-out states. M10 thresholds were therefore kept.

## How the app uses it
- **Card indicators.** `indicators.yield_county[crop]` carries:
  - unit, P10/P50/P90, the trend yield and year;
  - county record years, weather years, the worst weather year, and the harvested share of planted acres;
  - `si` provenance: model id M2, drivers, M10 confidence with reasons, information cutoff "2024 season", and this card.
- **Profit (M8).** Ym is calibrated so the median simulated yield equals the M2 P50. Otherwise it falls back to the ERS 5-year regional median (`economics.yield_anchor` says which). ERS prices and costs are unchanged.

## Failure modes and limits
- **County, not field.** A field can sit far above or below the county average.
- **Practice mix.** Practice-specific ratios come from years up to 2018 or earlier (2000–2010 for Finney corn) and may have drifted. Counties without practice series (all of Iowa, for example) get the all-practices county average, labelled as such. ERS operating costs average irrigated and dryland farms, so irrigated profit leaves out part of the pumping cost.
- **Harvested vs planted.** NASS yields are per harvested acre and ERS costs are per planted acre. Abandoned or grazed-out wheat acres are not counted, so dryland profit is optimistic in failure years.
- **Weather and events.** POWER weather is ≈50 km, with a warm Tmax bias in some cells (absorbed by training, but the heat-day counts are not station counts). Hail, wind (the 2020 derecho), floods, pests and prevented planting are not in the features.
- **Missing records.** NASS county estimates are missing for some county-years (disclosure, discontinued series), and counties need 8 years. Story County has no winter wheat record, so wheat there uses ERS.
- **Trend extrapolation.** This is the largest error source. The state slope is robust but cannot see a sudden level shift.

## Licence and citation
- USDA NASS Quick Stats: public domain. "USDA National Agricultural Statistics Service, Quick Stats."
- NASA POWER: "These data were obtained from the NASA Langley Research Center (LaRC) POWER Project funded through the NASA Earth Science/Applied Science Program."
- US Census Gazetteer: public domain.
- Method references: Romano, Patterson & Candès (2019), Conformalized Quantile Regression; Allen et al. (1998), FAO-56.
