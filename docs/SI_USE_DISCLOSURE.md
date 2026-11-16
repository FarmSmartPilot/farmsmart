# SI-use disclosure

NASA Space Apps asks teams to disclose how they used SI. FarmSmart uses SI in two separate ways: inside the product, and to help build it.

## 1. SI inside the product (what users see)

Every SI or model output in the app has a small green **SI** button. It opens the model name, its top drivers, its confidence with reasons, the information cutoff and a link to the model card. Rules-based and process-model outputs say so; they are not called SI.

| ID | Component | Type | Status |
|---|---|---|---|
| M3 | Rotation sequence ("what usually comes next") | SI: Markov model trained on 6,000–8,000 real field sequences near each field | Trained and validated on held-out 2024 data (top-1 0.75 Iowa / 0.50 Kansas, beating both baselines) |
| M7 | Climate Twins | Statistical: delta method on 6 CMIP6 models (NEX-GDDP-CMIP6) plus nearest-neighbour analog search over 3,467 cropland cells | Validated by present-day self-match (pilots map to their own region) |
| M8 | Price ensemble | SI/statistical: seasonal naive, ETS and LightGBM, with split-conformal intervals | Back-tested over 36 origins; interval coverage below target is disclosed and lowers confidence |
| M9 | Rotation ranking | Optimization: Pareto set, TOPSIS with farmer weights, rank stability by perturbation | Deterministic |
| M2 | County yield and yield risk (P10/P50/P90 in bu/ac, "county statistics, not your field") | SI: LightGBM quantile regression on NASA POWER season weather around the USDA NASS county trend, with conformalized (CQR) 80% ranges | Validated on held-out 2018–2024 county yields. 80% range coverage: corn 0.86, soybean 0.81, winter wheat 0.81. Pinball loss beats both baselines (county 5-year mean, and July-rain + heat-day regression). Anomaly R² is low (0.04–0.10), and the card says so. Sorghum lost to its baseline, so it is not used. Card: `models/model_cards/m02_yield.md` |
| M10 | Uncertainty engine | Rules over spread, data flags and applicability | Calibrated against 10,909 held-out county yields (2018–2024): "High" ranges held the truth 89% of the time, and 85% for states left out of training. Thresholds kept. Report and plot: `qc/reports/calibration_m10.md` / `.png` |
| M6 | Water, erosion, carbon, yield | **Process models**, not SI (FAO-56, FAO-33, RUSLE, ICBM) | Labelled "process model" in the app |
| M11 | SI Narrator | Deterministic templates from model JSON. No language model is called by default. | Every numeral comes from the JSON |
| — | Agronomy rules | **Rules**, not SI (27 published, sourced rules) | Labelled "rules" in the app |

Not yet trained, and not shown as SI: M1 crop suitability, M4 crop/bare detection, M12 downscaling. M2 runs only for US counties with USDA NASS records, and only for corn, soybean and winter wheat. Where these would appear, the app uses the transparent process model or rules and labels it that way.

FarmSmart never generates images or video with SI. The 10-second intro video (`docs/demo/field_shift_intro_10s.mp4`) is a screen recording of the real app, scripted with the coding assistant; it shows no generated imagery and carries a visible "SI-assisted screen recording · real app, real data" mark. Any SI-generated media would carry a visible "SI-generated" watermark.

## 2. SI used to build the project

- **Coding assistant.** The team used Claude (Anthropic) through Claude Code as a coding and research assistant. It wrote and refactored code, read API documentation, verified data endpoints, drafted documentation and summarized published agronomy sources. A coordinated set of task-specific SI agents covered research, agronomy, data, design, frontend and maps.
- **Human checks.** The team reviewed the outputs. Every agronomic parameter in `engine/rules/*.yaml` carries a citation to its published source, and values without a source were left empty rather than guessed.
- **No invented data.** All numbers in the app come from real datasets or model runs on real data; SI was not used to create or "fill in" any data.

## 3. Limits we want users to know
- SI and models here support decisions. They do not replace farmer judgment or local agronomy advice.
- Model outputs describe patterns and ranges, not guarantees.
