# M10 · Uncertainty engine (model card)

## Purpose
Give every output a confidence level (High / Medium / Low) with plain-language reasons. It is a transparent rule set, not a trained model.

Code: `fieldshift/engine/uncertainty.py` (`assess`, `spread_score`, `rel_width`). Calibration check: `qc/calibrate_m10.py`.

## Method
The score starts at 1.0.
- **Spread:** the relative width (P90 − P10) / |P50| of the range.
  - For process models, the range comes from the simulated weather years. For M2, it is the conformalized model range (`interval=`).
  - Width < 0.35 scores 1.0, < 0.8 scores 0.6, and anything wider scores 0.3. The score is capped at 0.4 + 0.6 × that value.
- **Penalties:**
  - −0.15 per data flag (for example missing soil survey, or low held-out coverage for M2);
  - −0.10 for regional inputs (≈50 km weather, county statistics);
  - −0.35 if outside the method's domain;
  - −0.05 if not calibrated.
- **Levels:** High ≥ 0.8, Medium ≥ 0.5, else Low.
- **Reasons:** every penalty adds a reason that the user sees.

## Calibration (run 2026-11-14)
The check uses the M2 hold-out predictions against observed USDA NASS county yields:
- 10,909 county-years in the held-out years 2018–2024;
- 50,505 county-years from leave-one-state-out.

Each prediction is labelled exactly as the app labels the `yield_county` block.

| Split | Level | County-years | 80 % range held the yield |
|---|---|---|---|
| Held-out years | High | 3,775 | **0.890** |
| Held-out years | Medium | 6,520 | 0.785 |
| Held-out years | Low | 614 | 0.806 |
| Held-out states | High | 19,103 | **0.849** |
| Held-out states | Medium | 28,989 | 0.805 |
| Held-out states | Low | 2,413 | 0.794 |

"High" meets the ≥ 80 % target in both splits, so the thresholds were kept. The reliability plot is in `qc/reports/calibration_m10.png` and the full table in `qc/reports/calibration_m10.md`.

The inner ranges (20–60 %) over-cover, so only the 80 % range is calibrated.

## Limits
- Calibrated only where observed truth exists, which is county yields. For process-model outputs (erosion, water use, soil carbon) the same width thresholds are used, but there is no observed truth to check them against, and the app says "process model".
- County-years in one season share weather, so the effective sample is much smaller than the row count.
- Coverage is for county averages. A single field varies more.
