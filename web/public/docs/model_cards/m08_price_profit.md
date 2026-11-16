# M8 · Price and profit inputs (model card)

## Purpose
Give the economics view two things: (1) what a crop has actually earned per planted acre in the farm's ERS region over the last 5 and 10 years, and (2) a simple next-season price range (P10/P50/P90) from world reference prices. It is context for the farmer's own numbers, never a price or profit promise. It is not investment or marketing advice.

Code: `fieldshift/ingest/econ.py` (`crop_economics`, `price_ensemble`, `region_for`). Smoke test: `scripts/smoke_econ.py`.

## Data
| Input | Source | Years used | Scale |
|---|---|---|---|
| Yield, harvest-period price, gross value, operating cost, allocated overhead (per planted acre) | USDA ERS Commodity Costs and Returns, 2025 release (CSV per commodity) | 1995/2005 → 2025; app shows last 5 and last 10 (2016–2025) | ERS farm resource region average |
| State/county → ERS Farm Resource Region | ERS `reglink.xls` | static | county |
| Monthly nominal USD prices | World Bank Pink Sheet, CMO Historical Data Monthly (updated 2026-11-03) | 2000-01 → 2026-10 | world reference (export/FOB) |

Offline copies (committed): `data/reference/ers_costs_summary.json`, `data/reference/wb_prices_monthly.json`, `data/reference/ers_regions_state.json`.

## Method
- **Profit history:** net return = gross value − operating − allocated overhead (matches ERS "value of production less total costs listed", e.g. Heartland corn 2025 = −124.19 $/ac), plus gross − operating. Reported as year-by-year values with mean, min/max, P10/P50/P90.
- **Region:** `region_for(state)` returns the region holding most counties (Iowa → Heartland, Kansas → Prairie Gateway, California → Fruitful Rim 66 % / Basin and Range 34 %). If ERS does not report the crop in that region, U.S. total is used and the note says so.
- **Price target:** mean nominal price over the next harvest window (Oct–Dec), 12–14 months after the last observation (Oct 2026 → Oct–Dec 2027).
- **Members (log price, equal-weight geometric mean):** seasonal naive; ETS(A,Ad,A) damped Holt-Winters fitted by grid search on a 15-year window (numpy; statsmodels/scipy optimisers are blocked by Windows Application Control on the build machine); LightGBM (150 trees, depth 2) on lagged log returns, direct target (sklearn's GBM is blocked the same way).
- **Intervals:** split conformal on log residuals (finite-sample quantiles). Back-test: model parameters fitted before 2017-09; 60 monthly calibration origins; 36 test origins 2022-09 … 2025-08 (targets in the last 3 years). The final forecast uses all 96 out-of-sample residuals. Runtime < 1 s per crop.

## Validation (back-test on the last 3 held-out years, run 2026-11-14)
| Crop | Series | MAPE ensemble % | seasonal naive % | ETS % | LightGBM % | MAE | P10–P90 coverage (nominal 0.80) |
|---|---|---|---|---|---|---|---|
| corn | Maize | 24.35 | 28.38 | 33.52 | 25.49 | 48.26 $/mt | 0.61 |
| soybean | Soybeans | 25.76 | 27.91 | 33.34 | 21.42 | 117.93 $/mt | 0.39 |
| winter_wheat | Wheat, US HRW | 32.02 | 32.03 | 40.89 | 27.01 | 87.71 $/mt | 0.36 |
| cotton | Cotton, A Index | 16.30 | 23.67 | 18.36 | 20.44 | 0.31 $/kg | 0.86 |
| rice | Rice, Thai 5% | 26.61 | 29.22 | 33.76 | 25.06 | 121.95 $/mt | 0.56 |

The ensemble beats seasonal naive for every crop but wheat (tie). Intervals **under-cover** because the calibration years (2017–2022) were calmer than the 2022 price spike and 2023–25 fall in the test window. The 36 test origins overlap, so they hold about 3 independent seasons. Show the range as "wide and still probably too narrow", and lower confidence.

## Failure modes
- Price shocks (war, export bans, drought) are not predictable from past prices; intervals miss them.
- World reference prices ≠ local farm-gate price (basis, transport, quality). Converted $/bu values use standard test weights only.
- No series: oats, canola seed; **sorghum and barley Pink Sheet series ended 2020-08**, so `price_ensemble` returns None and the app should use ERS harvest-price history. Spring wheat and durum use HRW as a proxy (flagged).
- ERS reports all wheat classes together; regional averages are not field truth; ERS has no corn for Fruitful Rim (falls back to U.S. total).
- A state spanning several regions gets one dominant region (by county count, not cropland area), e.g. Montana → Basin and Range though most cropland is Northern Great Plains. Use `region_for_county` when the county is known.

## Licence and citation
USDA ERS data: public domain. "USDA Economic Research Service, Commodity Costs and Returns." World Bank Pink Sheet: CC BY 4.0, "World Bank Commodity Price Data (The Pink Sheet)." Code: project licence.
