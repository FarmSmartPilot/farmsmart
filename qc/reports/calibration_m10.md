# M10 calibration against held-out county yields

Run 2026-11-14 by `qc/calibrate_m10.py`. Plot: `qc/reports/calibration_m10.png`.

**What is checked.** M2 predicts each held-out county-year's yield range (P10–P90, conformalized). M10 (`fieldshift/engine/uncertainty.py::assess`) labels each range High / Medium / Low exactly as the app does for the `yield_county` block. A level is honest if its 80% ranges hold the observed USDA NASS county yield at least 80% of the time (High) or close to it (Medium/Low, which warn the user).

Thresholds in use: relative width (P90 − P10)/P50 < **0.35** → spread score 1.0; < **0.8** → 0.6; else 0.3. With the fixed −0.10 for regional inputs, that maps to High / Medium / Low.

| Split | Level | County-years | 80% range held the yield | Mean relative width | Crops |
|---|---|---|---|---|---|
| loso | high | 19,103 | 0.849 | 0.250 | corn 9905, soybean 9035, winter_wheat 163, sorghum 0 |
| loso | medium | 28,989 | 0.805 | 0.511 | winter_wheat 11956, corn 7117, soybean 5448, sorghum 4468 |
| loso | low | 2,413 | 0.794 | 0.961 | sorghum 936, corn 705, winter_wheat 387, soybean 385 |
| loso | all | 50,505 | 0.821 | 0.434 |  |
| temporal | high | 3,775 | 0.890 | 0.290 | soybean 2164, corn 1611, sorghum 0, winter_wheat 0 |
| temporal | medium | 6,520 | 0.785 | 0.513 | corn 2486, winter_wheat 1993, soybean 1359, sorghum 682 |
| temporal | low | 614 | 0.806 | 0.949 | winter_wheat 359, sorghum 116, corn 108, soybean 31 |
| temporal | all | 10,909 | 0.822 | 0.460 |  |

## Reliability (nominal vs empirical coverage of central ranges)

| Split | Level | 20% | 40% | 50% | 60% | 80% |
|---|---|---|---|---|---|---|
| temporal | high | 0.344 | 0.618 | 0.708 | 0.786 | 0.890 |
| temporal | medium | 0.258 | 0.481 | 0.578 | 0.658 | 0.785 |
| temporal | low | 0.274 | 0.502 | 0.598 | 0.668 | 0.806 |
| temporal | all | 0.289 | 0.530 | 0.624 | 0.703 | 0.822 |
| loso | high | 0.303 | 0.554 | 0.652 | 0.733 | 0.849 |
| loso | medium | 0.280 | 0.513 | 0.606 | 0.686 | 0.805 |
| loso | low | 0.233 | 0.458 | 0.559 | 0.646 | 0.794 |
| loso | all | 0.287 | 0.526 | 0.621 | 0.702 | 0.821 |

## Per crop (80% range)

| Split | Crop | County-years | Held the yield | High share |
|---|---|---|---|---|
| loso | corn | 17,727 | 0.819 | 0.56 |
| loso | sorghum | 5,404 | 0.786 | 0.00 |
| loso | soybean | 14,868 | 0.828 | 0.61 |
| loso | winter_wheat | 12,506 | 0.831 | 0.01 |
| temporal | corn | 4,205 | 0.861 | 0.38 |
| temporal | sorghum | 798 | 0.714 | 0.00 |
| temporal | soybean | 3,554 | 0.809 | 0.61 |
| temporal | winter_wheat | 2,352 | 0.810 | 0.00 |

## Verdict

High held the observed county yield 89.0% (temporal) and 84.9% (loso) of the time. Both are at or above the 80% target, so the thresholds in `fieldshift/engine/uncertainty.py` are kept unchanged.

Medium and Low ranges hold the yield close to 80% as well, so the level mostly tells the user how wide the range is, not that it is less honest. Inner ranges (20–60%) over-cover: the conformal correction widens P10 and P90, and the interpolated interior inherits that, so only the 80% range is calibrated. Sorghum is included here although M2 is not deployed for it (it did not beat its baselines).

Limits: county-years in one season share weather, so the effective sample is closer to the number of seasons × regions than to the row count. Coverage is for county averages; a single field varies more.
