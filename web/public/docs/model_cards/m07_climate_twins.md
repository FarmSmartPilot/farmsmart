# M7 · Climate futures & Climate Twins (model card)

**Code:** `fieldshift/engine/twins.py` (`future_deltas`, `apply_deltas`, `climate_twins`, `precompute`)
**Kind:** process / analog search (no trained SI model). **Version:** 0.1.0. **Owner:** ml / data-nasa.
**Builders:** `scripts/build_analog_candidates.py` (reference data), `scripts/smoke_twins.py` (pilots).
**Outputs:** JSON for the Climate Twins view; pilots precomputed in `data/precomputed/twins_story_ia.json` and `twins_garden_city_ks.json`.

## What it answers
1. What will this field's climate be like in **2041–2060** under **SSP2-4.5** and **SSP5-8.5**? We give the median and the range across CMIP6 models.
2. Where on Earth do farmers **already** farm in a climate like that today, and how many models agree?
3. What do farmers grow there (country scale)?
4. Is the future climate **novel**, meaning no good present-day analog exists?

## Data
| Piece | Source | Scale |
|---|---|---|
| Future change | NASA NEX-GDDP-CMIP6 daily `tasmax`, `tasmin` (or `tas`), `pr`, read through the NCCS THREDDS NCSS point CSV. Citation: Thrasher et al. 2022, *Sci Data* 9:262 | 0.25° (≈25 km) cell |
| Field baseline | NASA POWER daily 1991–2020 (`fieldshift.ingest.power.daily`) | ≈50 km regional value |
| Present-day analog climates | NASA POWER climatology/regional monthly normals for its fixed **2001–2025** period. The regional endpoint ignores start/end (tested). | nearest 0.5°×0.625° cell to each 1° cell centre |
| Cropland mask | FAO GAEZ v4 land-cover share `GLCSv11_02` (cropland %, 5′), averaged over 1° cells. We keep cells with **≥15 %** cropland, which gives **3,467 cells**. We checked the values: Iowa 73 %, Punjab 52 %, Sahara 0, Amazon 0. | 1° |
| Places | Natural Earth admin-0 (50m) and admin-1 (10m); GeoNames cities15000 for the nearest town | — |
| Crops at analog | FAOSTAT QCL bulk, "Area harvested", mean of 2020–2024, with aggregate items removed. 233 areas. | **country** |

## Method
- **Models (6, chosen to span ECS 2.6–5.3 K):** ACCESS-CM2, GFDL-ESM4, MIROC6, MPI-ESM1-2-HR, MRI-ESM2-0, UKESM1-0-LL. Members and file versions are resolved from the THREDDS catalogs. When a file exists in several versions, we take the highest one. UKESM uses a 360-day calendar, so its requests end on 12-30.
- **Year sampling.** NCSS costs about 6.5–10 s per model × year × variable file, and the server sustains roughly 0.5–1 file/s with 12 workers.
  - `full` (pilots): 1995, 2000, 2005, 2010, 2014 vs 2041, 2045, 2050, 2055, 2060, with tasmax, tasmin and pr. That is 270 files.
  - `fast` (new point, 80 s budget): 2000, 2010 vs 2045, 2055, with tas and pr. That is 72 files, and the same ΔT is applied to Tmax and Tmin.
  - If the budget runs out, any model with an incomplete sample is dropped. The drop is listed in `problems` and lowers confidence.
- **Deltas.** For each model and month we compute ΔTmax and ΔTmin (°C) and a precipitation ratio. The ratio is (future + 1 mm/month) / (historical + 1 mm/month), clamped to [1/3, 3].
- **Delta method.** We add each model's monthly ΔT to POWER daily Tmax/Tmin/T2M for 1991–2020 and multiply daily precipitation by the monthly ratio. The model baseline (1995–2014) is centred close to the POWER normal (1991–2020).
- **Display indicators** come from the shifted daily series: mean T, mean daily Tmax of the warmest month, mean daily Tmin of the coldest month, annual precipitation, GDD10 (cap 30), days with Tmax ≥ 35 °C, and median frost-free season.
- **Analog features** (6), computed with the same code for the field and for candidates, from monthly mean T2M and precipitation normals:
  - annual mean T;
  - warmest-month T;
  - coldest-month T;
  - log annual precipitation;
  - GDD10 from monthly means;
  - share of precipitation in the 6 warmest months.

  We do **not** use POWER climatology T2M_MAX/T2M_MIN, because those monthly values are period extremes (Iowa: +41.8 / −36.3 °C), not means of daily max/min.
- **Distance.** RMS of z-scored feature differences, with z taken from the spread across the global cropland candidates. We chose this over Mahalanobis because annual T and GDD10 are nearly collinear, and Mahalanobis then amplifies tiny residual differences.
- **Per model:** we find the top-5 distinct analogs, at least 400 km apart. **Consensus analogs** are the top 3 for the ensemble-median feature vector. For each one we count how many models have one of their top-5 analogs within 500 km.
- **Model agreement:** the largest number of models whose top analogs fall within **500 km** of one model's top analog.
- **Novel climate:** we take every present-day cropland cell and find its distance to the nearest cell more than 300 km away. The P95 of those distances is the threshold, **0.234**; the median is 0.104 and P90 is 0.197. If the best consensus distance exceeds it, we flag the climate as novel.
- **Confidence:**
  - *low* if any scenario is novel, if agreement is below 50 %, or if fewer than 3 models are available;
  - *high* if agreement is at least 2/3, at least 5 models are available, and at least 4 years are sampled per period;
  - *medium* otherwise.

  Reasons are always listed.

## Validation
**Present-day self-match.** We match a field's own POWER 2001–2025 climate against the candidates. The nearest cell should be next to the field:

| Field | Nearest cell | Distance | Score |
|---|---|---|---|
| Story Co. IA | Ames IA | 45 km | 0.048 |
| Garden City KS | Garden City KS | 67 km | 0.045 |
| Punjab IN | Rajpura | 80 km | 0.031 |
| Mato Grosso BR | Diamantino | 175 km | 0.036 |
| Saskatchewan | Regina area | 13 km | 0.036 |

### Pilot results (run 2026-11-14)
`full` mode used 6 models and 270 files, with no fetch problems. The future period is 2041–2060.

**Story Co. IA (42.10, −93.39)**
- Baseline: mean T 9.2 °C, 915 mm, GDD10 1830, 3.1 hot days.
- SSP2-4.5: mean T 11.2 °C (range 10.4–12.2), hot days 11.9 (7.8–25.8).
  - Consensus analog: a cell near Bellevue, Missouri, 250 km away, with 6/6 models agreeing.
- SSP5-8.5: mean T 11.5 °C (10.9–14.1).
  - Consensus analog: a cell near Liberty, Missouri, 289 km away, 6/6 models.
- No novel-climate flag. Confidence: high.

**Garden City KS (37.97, −100.87)**
- Baseline: mean T 13.5 °C, 556 mm, 40 hot days.
- SSP2-4.5: mean T 15.1 °C, hot days 65 (50–76).
  - Analog: Texas panhandle, 167 km away, 6/6 models.
  - Secondary analogs: Henan and Shaanxi, China (5/6 models).
- SSP5-8.5: hot days 70 (58–93).
  - Analog: SW Oklahoma near Altus, 301 km away, 6/6 models.
- Confidence: high.

`fast` mode on the same points ran in 42 s and 56 s (72 files). It gave the same leading analogs, with lower agreement for SSP5-8.5 at Garden City (3/6).

## Limitations (say these in the UI)
- **Year sampling.** We sample only 2 (fast) or 5 (full) years per period, so year-to-year weather leaks into the monthly deltas, especially for precipitation. With 2 years, precipitation ratios are noisy.
- **Analog features.** The analogs are climate analogs on 6 indicators. They ignore soils, day length, irrigation and markets. A twin with the same climate can grow different crops because of those factors.
- **Crops are national.** For a US analog, "what farmers grow" is the US national mix. State-level NASS data would be better and is not wired.
- **Coarse baselines.** Baselines are POWER regional values (≈50 km). Candidate climate is 2001–2025, while the field baseline is 1991–2020. This mismatch is deliberate: "present day" for the twins, and the deltas' reference period for the field.
- **Short ensemble.** Six models only. NEX-GDDP bias correction targets GMFD, not POWER, so the delta method avoids mixing their absolute levels.
- **What it is not.** It is not a forecast of what the farmer should plant. It is one input to their judgment.
