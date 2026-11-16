# Wave U5: borrowed content and UX ideas (contracts and file ownership)

Source of the ideas: a review of a separate prototype (not code to copy). Build everything in this repo's own stack and style.
Project rules in `CLAUDE.md` apply in full: write "SI" never "AI"; every number from real data or a real model run;
coarse values carry their scale; navy satellite button for NASA data, gray for other sources, green SI button for SI
outputs; never-claim list (NDVI is not yield, residue or carbon; sharp imagery never shows soil moisture or wind; etc.);
English and Spanish strings; touch targets ≥44 px on touch; works at 390, 820, 960, 1024 and 1440 px.

## Ground rules for parallel work
- Edit only the files you own (table below). If you need a change in someone else's file, write it in your final report.
- Do **not** commit, do **not** `npm install`/`pip install`, do **not** stop or restart the servers on :8000 and :5173.
- Test on your own ports: API `python -m uvicorn fieldshift.api.main:app --port <yours>` (no `--reload`);
  web `cd web; $env:FS_API="http://127.0.0.1:<api port>"; npx vite --port <yours>`.
- Python: `%USERPROFILE%\miniforge3\envs\fieldshift\python.exe`. Never print `.env` or the Earthdata token.
- Typecheck: `cd web; npx tsc -p tsconfig.app.json --noEmit`.

## Ownership
| Owner | Files |
|---|---|
| A data-nasa | `fieldshift/ingest/hls_ndvi.py`, `fieldshift/ingest/ecostress.py`, `fieldshift/api/routes_fieldsat.py`, `scripts/precompute_fieldsat.py`, `data/precomputed/hls_*.json`, `data/precomputed/ecostress_*.json`, rows in `docs/DATA_SOURCES.md` for HLS and ECOSTRESS |
| B backend | `fieldshift/api/routes_extras.py`, `fieldshift/engine/analysis.py`, `fieldshift/api/main.py` (only `CompareIn`, `forecast_alerts`, `/api/kb/crops`), `fieldshift/api/pdf.py`, `fieldshift/alerts/core.py` |
| C agronomy | `engine/rules/crops.yaml` (new text fields only) |
| D1 frontend (Studio) | `web/src/views/MyField.tsx`, `Options.tsx`, `StrategyCompare.tsx`, `web/src/components/ScenarioPanel.tsx`, `web/src/store.ts`, `web/src/api.ts`, `web/src/lib.ts`, `web/src/i18n/en.json`, `es.json`, `web/src/app.css` |
| D2 frontend (new views) | new `web/src/views/ActionPlan.tsx`, `RotationBuilder.tsx`, `SavedPlans.tsx`, `Validation.tsx`, new `web/src/components/FieldSatellite.tsx`, `StepBar.tsx`, `RainfallYears.tsx`, `ForecastStrip.tsx`, new `web/src/planStore.ts`, `web/src/apiPlan.ts`, `web/src/plan.css`; edits to `App.tsx`, `TopBar.tsx`, `views/AreaReport.tsx`, `views/DroughtReplay.tsx`, `views/AlertsSettings.tsx`, `web/src/i18n/en.plan.json`, `es.plan.json` |

## API contracts

### A: field-scale NASA observations
`GET /api/fields/{fid}/hls` (HLS v2.0 L30/S30, 30 m, NDVI from red + NIR inside the field polygon, Fmask cloud/shadow/snow/water/high-aerosol excluded)
```json
{"available": true, "reason": null, "field_id": "b96d39c7a833",
 "scenes": [{"id": "HLS.S30.T15TVG.2025190T165901.v2.0", "date": "2025-07-09", "sensor": "S30",
             "cloud_pct_scene": 3.0, "n_pixels": 210, "n_usable": 198, "usable_pct": 94.3,
             "ndvi_mean": 0.81, "ndvi_p10": 0.74, "ndvi_p50": 0.82, "ndvi_p90": 0.86,
             "withheld": false, "withheld_reason": null}],
 "grid_scene_id": "HLS.S30....", "period": {"start": "2025-04-01", "end": "2025-10-31"},
 "evidence": {"source_id": "hls", "product": "HLS v2.0 (Landsat 8/9 + Sentinel-2)", "resolution": "30 m", "url": "...", "retrieved": "2026-11-14"},
 "scale_note": "field pixels (30 m)", "never_claim": "Greenness is not yield, residue or soil carbon."}
```
A summary is withheld (`withheld: true`) when fewer than 50 % of the field's pixels are usable.
`GET /api/fields/{fid}/hls/{scene_id}/grid` → `{"date","sensor","width","height","bbox":[w,s,e,n],"values":[[0.81, null, ...]], "inside":[[true,false,...]]}` (EPSG:4326 bbox of the native grid window; `null` = masked).

`GET /api/fields/{fid}/ecostress` (ECOSTRESS L3T JET, 70 m, daytime ET at the field centre)
```json
{"available": true, "reason": null,
 "observations": [{"datetime": "2025-07-12T17:42:10Z", "et_mm_day": 4.6, "et_sd_mm_day": 0.5,
                   "cloud": false, "water": false, "pixel_center": [-93.4689, 42.1112], "scene_id": "..."}],
 "evidence": {"source_id": "ecostress", "product": "ECOSTRESS L3T JET v003", "resolution": "70 m", "url": "...", "retrieved": "..."},
 "scale_note": "one 70 m pixel at the field centre; a daytime model estimate, not a measured field total"}
```
Both endpoints read `data/precomputed/{hls,ecostress}_{fid}.json` first (pilots), else compute live with a 60 s budget and cache to `data/cache/`. `available:false` + `reason` when outside coverage, no scenes, or access fails. Never fake values.

### B: decision APIs
`POST /api/fields/{fid}/compare`: body gains two optional fields.
- `budgets`: `{ "<crop_id>": {"price_usd_bu": 4.1, "cost_usd_ac": 420, "yield_bu_ac": 205} }`, any subset. Profit uses them in place of ERS/M2 for that crop. Each card's `economics` gets `budget_source: {"<crop_id>": "yours" | "ERS"}`.
- `custom`: up to 4 farmer-built options `[{"name": "My oats try", "sequence": [{"cash": "corn"}, {"cash": "soybean", "cover": "cereal_rye"}, {"cash": "oats", "cover": null}]}]` (same step shape as `baseline`). Feasible ones come back as cards with `"is_custom": true, "custom_name": "..."` and are always shown (like the baseline), ranked with the rest. Infeasible ones come back in `custom_rejected: [{"name": "...", "reasons": ["..."]}]`.
- `scenario` also accepts `price=<percent>` in the custom form, e.g. `custom:rain=-20,temp=2,price=-15` (prices scaled by 1 + p/100 in profit only).

`GET /api/fields/{fid}/forecast-alerts`: response gains `"warnings": [{"event","severity","headline","onset","ends","sender","url"}]` from the US National Weather Service active alerts at the field point (`api.weather.gov/alerts/active?point=lat,lon`), and `"warnings_note"` (e.g. "Official warnings are available for US fields only").

`GET /api/fields/{fid}/rainfall-years`
```json
{"years": [{"year": 2012, "season_mm": 301.2, "annual_mm": 612.0, "partial": false}],
 "season": {"label": "Apr–Oct", "start_doy": 91, "end_doy": 304}, "median_season_mm": 512.3,
 "source": "NASA POWER (PRECTOTCORR)", "scale_note": "regional value (≈50 km)"}
```

`GET /api/validation`: real numbers only, from existing reports and model artifacts (no new claims):
```json
{"m2": {"coverage_80": {"corn": 0.86, "soybean": 0.81, "winter_wheat": 0.81}, "test_years": "2018–2024",
        "points": [{"crop": "corn", "state": "IA", "county": "Story", "year": 2021, "p10": 180, "p50": 200, "p90": 215, "actual": 207}],
        "model_card": "models/model_cards/m02_yield.md"},
 "m10": {"levels": [{"level": "High", "coverage": 0.89, "n": 1234}], "report": "qc/reports/calibration_m10.md"},
 "weather": {"pairs": [{"site": "...", "variable": "tmax", "r": 0.97}], "report": "qc/reports/..."},
 "m3": {"top1": 0.752, "top3": 0.976, "baselines": {}}, "generated": "2026-11-14"}
```
Omit a block (with `"<block>_note"`) if its source artifact is missing.

`POST /api/fields/{fid}/report.pdf`: same PDF as the GET, plus an "Action plan" page. Body: the compare body fields plus `plan: {"chosen": "<card id or name>", "checklist": [{"id","label","done"}], "notes": "≤10,000 chars"}`.

`GET /api/kb/crops`: each crop gains `blurb_en`, `blurb_es`, `check_first_en`, `check_first_es` (from C).

### C: crop text (crops.yaml)
Per crop: `blurb_en` / `blurb_es` (one plain sentence, ≤ 20 words, what the crop is and why a farmer might grow it here) and `check_first_en` / `check_first_es` (1–3 short items to confirm locally, e.g. "a buyer that takes food-grade oats"). Plain farmer language, no numbers unless sourced in the crop's existing references.

## UX items
| Item | Owner | Behaviour |
|---|---|---|
| Priority presets | D1 | Above the drag list: Balanced · Soil first · Water wise · Profit first. One click sets the order; a thin coloured bar shows the resulting weight mix (rank-order weights 0.35/0.25/0.18/0.12/0.06/0.04/0.02 from METHODS §6). |
| Best vs current toggle | D1 | Rotation options: "All options" / "Best vs current" (only the top card and the baseline, side by side). |
| Stress-test chips | D1 | In the scenario panel: "Drier & hotter" (`custom:rain=-20,temp=2`) and "Lower prices" (`custom:rain=0,temp=0,price=-20`), plus existing scenarios. |
| Fits / Excluded tabs | D1 | "Why not others?" list gets tabs: Fits my farm (n) · Excluded (n) · All, each crop with its blurb and check-first items. |
| Review ticks | D1 | "I've checked this" ticks for crop history and soil in My Field; unticked shows a gentle "not yet checked by you" note (no blocking). Stored per field. |
| Editable budgets | D1 | "Use my own prices and costs" in My Field: per feasible crop price ($/bu), cost ($/ac), optional yield; sends `budgets`. |
| Action plan | D2 | New view "Plan": chosen option, checklist in three stages (Before committing · Before planting · In the field) with progress "n / N", year-by-year sequence, adviser notes (≤10,000 chars), "Download plan (PDF)" via POST report.pdf. Items are generic agronomy checks plus the chosen card's `check_locally` items. |
| Rotation builder | D2 | New view "Build your own": year columns, a palette of crops that fit (drag or pick from a dropdown; keyboard and touch work), cover crop toggle per year, editable name, up to 4 options; "Test these" sends `custom` and shows the resulting cards (and `custom_rejected` reasons). |
| Saved plans | D2 | Save a snapshot (field, priorities, scenario, farm, budgets, custom options, plan) in localStorage; list, reopen, delete; export the comparison as CSV and the plan as JSON; import JSON. |
| Validation | D2 | New view "How well does it work?": M2 held-out chart (actual vs P10–P90 bars), coverage per crop, M10 levels, weather validation, M3 skill, all from `/api/validation`, each with its SI or data button and links to model cards. |
| Field satellite | D2 | In the Area Report: HLS greenness through the season (curve of non-withheld scenes) + a 30 m pixel grid of one scene over the field outline, and ECOSTRESS daytime water use dots; navy NASA buttons; scale notes and never-claim text. |
| Rainfall by year | D2 | In Drought Replay: bar chart of growing-season rain for every year (from rainfall-years); click a bar to replay that year; the median line drawn. |
| Forecast strip + warnings | D2 | In Alerts: 7-day forecast cards (from forecast-alerts) and any official NWS warnings. |
| Step bar | D2 | A slim "Step n of 5" bar in Field Studio and the views: 1 Find your farm · 2 Check your field · 3 Compare options · 4 Test the weather · 5 Make a plan. Clicking a step goes there. |
