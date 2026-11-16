# Wave U9: whole farm, and the review notes (contract)

Goal: farmers think about the whole farm. They add fields one at a time and then see and plan them together. The work also brings in the user's review notes on profit, risk, disease, peers, offline use and text alerts.

The answers the app leads with are:
1. How much could I earn?
2. What happens in a bad year?
3. What should I plant?
4. Will it cut pests and disease?

Project rules apply throughout (CLAUDE.md):
- Write "SI", never "AI".
- Numbers come from real data or a real model run. Nothing is synthetic or hard-coded.
- Coarse values carry their scale.
- Data values get a navy (NASA) or gray (other) button; SI outputs get a green SI button with confidence and reasons.
- Respect the never-claim list. In particular, "observed patterns prove a switch gain" must never be implied: say "in past weather and prices, this plan would have…".
- EN and ES for every string.

## Rules for every agent in this wave

- **Commits:** do not commit. The orchestrator commits.
- **Files:** touch only the files you own (below). If you need a change in someone else's file, say so in your report.
- **Servers:** the main API (:8000) and Vite (:5173) belong to the orchestrator.
  - Run your own API on your port: `~/miniforge3/envs/fieldshift/python.exe -m uvicorn fieldshift.api.main:app --port 80xx`, with no `--reload`.
  - Run your own Vite: `FS_API=http://127.0.0.1:80xx FS_VITE_CACHE=<temp dir outside Dropbox> npx vite --port 51xx`.
  - Stop your servers when you finish.
- **Python** is `~/miniforge3/envs/fieldshift/python.exe`. The system python is Python 2.
  - Write scripts with the Write tool, not heredocs with unicode.
  - Never print `.env`.
- **Builds and tests:**
  - Typecheck: `npx tsc -p tsconfig.app.json --noEmit` (in `web/`).
  - Build: `npm run build`.
  - e2e: `FS_BASE=http://localhost:51xx bash qc/e2e/run.sh <your spec> --project=desktop-chromium`.
  - Don't edit source while your tests run (Vite HMR breaks them).
- **Translations:** add text only to your own translation files.
  - Whole-farm UI uses `web/src/i18n/{en,es}.farm.json`, under top-level key `farm`.
  - Other U9 UI uses `web/src/i18n/{en,es}.u9.json`, under the top-level keys `u9money`, `disease`, `peers`, `offline`, `sms`, `welcome9`.
  - These files are merged into the translation bundle already.

## Ports and ownership

| Agent | Port(s) | Owns |
|---|---|---|
| B1 data (money evidence) | API 8011 | `fieldshift/api/money.py` (+ bump `MONEY_VERSION` to `"u9.1"`), new `fieldshift/ingest/storms.py`, `fieldshift/ingest/budgets_isu.py`, small additions in `fieldshift/ingest/nass.py`, `data/reference/*` it creates, `docs/DATA_SOURCES.md` rows |
| B2 agronomy (disease) | API 8012 | `engine/rules/crops.yaml` (pest_host_groups only), new `engine/rules/pathogens.yaml`, `engine/rules/rules.yaml` (new rule only), `fieldshift/engine/rules_engine.py` (only if the DSL needs a helper), `fieldshift/engine/kb.py` (loader for pathogens.yaml), new `fieldshift/engine/disease.py`, new `fieldshift/api/routes_disease.py` |
| B3 data (peers) | API 8013 | new `fieldshift/ingest/peers.py`, new `fieldshift/api/routes_peers.py`, `fieldshift/ingest/cdl.py` (additions only), `scripts/precompute_peers.py` |
| F1 frontend (whole farm) | Vite 5174 (API 8000) | new `web/src/farm.ts`, `web/src/farmStore.ts`, `web/src/views/FarmDashboard.tsx`, `web/src/farm.css`, `web/src/components/AddToFarm.tsx`, `App.tsx`, `planStore.ts`, `components/SideRail.tsx`, `components/TopBar.tsx`, `views/MyFields.tsx`, `views/Options.tsx` (button only), `views/ActionPlan.tsx` (button only), `i18n/*.farm.json`, `qc/e2e/farm.spec.ts`, `qc/e2e/playwright.config.ts` (testMatch only) |
| F2 frontend (notes UI) | Vite 5175 (API 8000) | `views/MoneyCalc.tsx`, `money.css`, `views/Welcome.tsx`, `welcome.css`, `views/AlertsSettings.tsx`, `views/MyField.tsx`, `components/Guided.tsx`, new `components/DiseasePanel.tsx`, `components/PeersPanel.tsx`, `components/OfflineBar.tsx`, `web/public/sw.js`, `web/public/manifest.webmanifest`, `web/index.html`, `web/src/main.tsx` (SW registration), `i18n/*.u9.json`, `qc/e2e/u9.spec.ts` |

`fieldshift/api/main.py` already tries to load `routes_disease` and `routes_peers`, and it skips a module that doesn't exist yet. `web/src/moneyStore.ts` holds the per-field money calculator inputs (`useMoneyStore`, `FieldMoney`); it is shared and read-only for F1.

## B1: money evidence

`POST /api/fields/{fid}/money` keeps its current shape and adds the blocks below. Each block is either `{available: false, reason}` or real data with source, url, scale and `is_nasa: false`.

- **`crops[cid].yield_history`:** USDA NASS Quick Stats county yields for the field's county.
  - Shape: `{available, source, url, county, unit, years: [...], values: [...], n_years, trend: {slope_per_yr, intercept, basis}, detrended_cv, scale: "county average, not your field"}`.
  - Fall back to state level if the county is suppressed, and label it as such.
  - Use the existing nass.py caches or key (`NASS_API_KEY` is set).
  - Use it for realism, and never as the field's own yield.
- **`crops[cid].benchmarks`:** a list of published budgets for this field's state.
  - Iowa (state FIPS 19): Iowa State University Extension, Ag Decision Maker A1-20, "Estimated Costs of Crop Production in Iowa", latest year.
  - Each item: `{source, url, year, label: "Corn following soybeans", yield_assumption, unit, operating_usd_ac, total_usd_ac, items: [{label, usd_ac}], notes}`.
  - Read the real published file. If it can't be read, return `available: false` with the reason; never type numbers from memory.
- **`cost_coverage`:** which costs are in the operating lines and which in the overhead lines, from the ERS item names.
  - Shape: `{operating: [labels], overhead: [labels], not_included: [labels]}`.
  - `not_included` lists costs USDA's lines don't hold, such as crop insurance premium, grain hauling beyond the farm, or storage, but only where that is true for the ERS survey. Check the ERS documentation.
  - The UI uses this to say "gross margin (operating costs only)" vs "net profit (all costs)".
- **`hazards.storm_events`:** NOAA NCEI Storm Events Database for the field's county, 1996 to the latest full year.
  - Use the bulk "details" CSV files.
  - Build a compact all-US county summary in `data/reference/storm_events_county.parquet` (or json) so any US county answers fast.
  - Shape: `{available, source, url, years: [y0, y1], items: [{type, label_en, label_es, years_with_event, years, p, crop_damage_usd_total, crop_damage_years}], note: "reported events; reporting varies by county and decade", scale: "county"}`.
  - Event types: Hail, Thunderstorm Wind, Tornado, Flood, Flash Flood, Heavy Rain, Drought, Frost/Freeze, Excessive Heat, High Wind, Winter Storm.
  - Count events in the county (CZ_TYPE C), plus zone events mapped to the county where possible. Say which in `note`.
- **`evidence`:** `{weather_seasons: n, weather_years: [y0, y1], price_years: n, price_range: [y0, y1]}`, so the UI can say "based on N real seasons × P price years".
- **Caches:**
  - Bump `MONEY_VERSION`.
  - Re-run `scripts/precompute_hazards.py` for the pilots at the end, if that is what fills `data/cache/money`. Otherwise say what does.
  - Don't regenerate `data/precomputed/compare_*`.

## B2: disease (rotation hosts and weather risk)

**1. Pathogen hosts across families.**
- Create `engine/rules/pathogens.yaml` with one entry per pathogen or pest group: `{id, name_en, name_es, kind: disease|nematode|insect, hosts: [crop ids incl. cover crops], survival_years: [lo, hi], break_years: n, notes, sources: [ids]}`.
- Cite every entry from extension or peer-reviewed sources: Crop Protection Network, university extension (ISU, UW, NDSU, Manitoba, Saskatchewan Pulse), APS.
- Groups at least:
  - white mold (*Sclerotinia sclerotiorum*);
  - soybean cyst nematode;
  - Fusarium head blight / Gibberella;
  - corn rootworm;
  - Aphanomyces root rot (pea, lentil, alfalfa);
  - clubroot (canola and brassica covers);
  - tar spot (corn);
  - gray leaf spot (corn residue);
  - take-all / cereal root diseases;
  - Rhizoctonia (only if well sourced).
- Keep `crops.yaml` `pest_host_groups` consistent with these ids.
- Add one rule, `shared_pathogen_host`: the next crop, or its cover, is a host of a group that a crop or cover within the last `break_years` years also hosts.
  - It fires across families, and it is skipped when a crop-specific rule already covers the same pair (continuous_corn, continuous_soybean, sunflower_sclerotinia_spacing, pulses_back_to_back, wheat_after_corn_fhb), so nothing is penalised twice.
  - The message names the pathogen in plain words, in EN and ES.
- Check that existing pilot results still make sense: corn–soy must not get a white-mold warning, because corn isn't a host.

**2. `GET /api/fields/{fid}/disease`: weather-driven risk models.**
- Port the published models from the UW-Madison crop disease forecasting tool (https://github.com/UW-Madison-DSI/crop_disease_forecasting_tool, MIT):
  - tar spot (Tarspotter);
  - gray leaf spot;
  - white mold / Sporecaster (dry-land and irrigated variants).
- Use the exact equations and coefficients from the repo files. Cite file and commit.
- Inputs come from NASA POWER hourly or daily at the field (T2M, RH2M, dew point, wind); state the scale (≈50 km).
- Shape: `{available, reason?, models: [{id, crop, name_en, name_es, source, url, valid_region, inputs, years: [...], share_high_risk_days: [...], typical: x, last_year: x, this_season: {...} | null, thresholds}], note, scale}`.
- Valid region: the models were built for the US Midwest / Great Lakes. For fields outside it, return `available: false` with that reason.
- Wording: "weather that favours the disease", never "the disease is present". It is not a yield-loss number.
- SI record: `{confidence, reasons}`. Confidence is lowered for regional weather instead of an on-farm station.

## B3: peers ("what farms around you do")

`GET /api/fields/{fid}/peers`, from USDA NASS Cropland Data Layer (30 m) in a box of about 10 km around the field (radius ≈5 km), for the latest 6–8 years (CropScape GetCDLFile, or the existing cdl.py approach).

Shape:

```
{available, reason?, source, url, radius_km, years: [...],
 mix: [{year, items: [{crop, label_en, label_es, share}]}],
 transitions: [{from, to, share_of_from, pixels}],
 rotation_types: [{id: continuous_corn|corn_soy|three_plus_crops|with_small_grain|with_hay_pasture|other, share}],
 changes: [{crop, share_recent, share_before, delta}],
 this_field_type: "corn_soy"|…,
 note: "What cropland within ≈5 km did (USDA CDL satellite classification, 30 m). Not proof that a switch pays.",
 scale: "≈5 km around your field"}
```

- `transitions` pools the last 5 year-pairs and covers cropland pixels only.
- `rotation_types` comes from per-pixel sequences over the last 6 years.
- Coverage: US only.
  - For Canada, use AAFC Annual Crop Inventory if `fieldshift/ingest/aafc.py` already supports it; otherwise return `available: false` with a reason.
  - Other countries: `available: false` with a reason.
- Cache to `data/cache/peers/` and precompute the US pilots: Story County IA (b96d39c7a833), Finney County KS, San Joaquin CA.

## F1: whole farm (frontend)

**Store: `farmStore.ts`**, persisted as `fieldshift-farm` via `safeStorage`.
- `fields: FarmField[]`, where FarmField = `{id, name, lat?, lon?, geometry?, meta?, farm?, plan: string | null /* option id; null = keep current rotation */, locked?: boolean, addedAt: string}`.
- `settings: {risk: "money" | "balanced" | "safe", maxCropShare: number | null, stress: Stress}`.
- Actions: add, remove, rename, setPlan, lock, addSavedFields.
- Acres per field live in `useMoneyStore.byField[fid].acres`, so the money page and the farm agree.
- Maximum 30 fields.

**Per-field data.**
- Fetch `/money` with that field's own compare body: its saved farm settings, budgets and soil test, sending `{}` when untouched so cached results are used.
- Fetch `/compare` (or reuse the cached query) for soil and water indicators, and the context endpoint for recent crops (for `startSlot`).
- Use TanStack `useQueries`.
- Resolve crop inputs exactly as MoneyCalc does: the same defaults, edits, records and basis prices. Put that in a pure `fieldInputs()` in `farm.ts`, and leave a comment pointing at MoneyCalc so the two stay in sync. Don't edit MoneyCalc.tsx.

**Farm math (`farm.ts`, pure and unit-testable).**
- **Alignment:** samples are aligned by calendar weather start year and price year across fields, so fields that share regional weather move together.
  - Use the intersection of start years; same for price years.
  - A field with no price history (P=1) pairs with every price year.
- **Plan metrics** (any assignment field→option), in whole-farm dollars (Σ acres × $/ac) and $/ac:
  - typical (median of the farm rotation average), bad year (P10), good year (P90);
  - chance of a losing year (share of single calendar years with farm net < 0);
  - pBeat vs the current plan (paired samples);
  - worst year (weather year + price year);
  - each field's contribution;
  - 5-year cash flow (Σ fields' `cashFlow` rows).
- **Diversification:** farm bad year vs Σ each field's own bad year (× acres). Also pairwise correlation of fields' single-year nets.
  - Say it plainly: "Because your fields don't all have their bad year at the same time, your farm's bad year is $X better than adding up each field's bad year."
  - Note that fields within ≈50 km share weather data.
- **Crop mix:** acres by crop for years 1–5 of the plan (`slotsOf` + `startSlot` from recent crops). Track the largest crop share per year.
- **Soil and water:** acre-weighted soil cover, erosion, water use and soil-carbon trend from the compare cards, current vs plan.
- **Optimizer** (deterministic):
  - Objectives:
    - money: max typical;
    - balanced: max (typical + bad)/2;
    - safe: max bad year.
  - Constraints: locked fields keep their plan; maxCropShare per year; only complete options; respect each field's equipment, markets and won't-grow (the compare cards already pass the rules).
  - Search: coordinate ascent from the current plan and from each field's own best, up to 50 sweeps; keep the best.
  - Output: suggested plan, deltas vs current (typical, bad, chance of loss, soil, water), per-field reasons.
  - SI record:
    - confidence from the seasons × price years count, pBeat and data completeness (USDA defaults vs the farmer's own numbers);
    - reasons: plain sentences;
    - caveats: same management assumed; regional weather; USDA regional prices and costs unless edited.

**UI: `#/farm` (PlanView "farm"), "Your whole farm".**
- **KPI strip:** fields, acres, typical profit per year, bad year, chance of a losing year, diversification bonus.
- **Fields list:** name, acres (editable), current rotation, plan dropdown, typical, bad year, lock, Open.
- **Charts:**
  - crop mix by year, as stacked bars in the crop colours already in use;
  - farm profit range for current vs plan.
- **Optimizer panel:**
  - "Find the best plan for my farm", with risk appetite and max share for one crop;
  - results with Apply and Undo, and an SI button.
- **Other sections:** 5-year farm cash flow, soil and water summary, notes and sources.
- **Empty state:** "Add fields: open a field and press Add to my farm", plus "Add all my saved fields".
- **Sample farm:** "Try a sample farm" adds 4 real cropland fields in central Iowa (Story, Boone, Hamilton, Marshall counties).
  - Pick points that are corn or soybean in CDL; verify each via the API's field creation.
  - Label it "Sample farm (real fields, public data)".
- **"One field | Whole farm" switch:** at the top of the guided left panel and in the expert top bar. Whole farm opens `#/farm`.
- **Add to my farm:** an `AddToFarm` button on Compare (Options.tsx header), Make a plan (ActionPlan) and each My fields row ("In my farm" toggle).
- Works at 390 px wide.

## F2: notes UI (frontend)

**Part 1, now:**
- **Welcome:** lead with the farmer's questions (how much could I earn, what happens in a bad year, what should I plant, pests and disease) and the whole-farm view. Use real live numbers only, as the page already does.
- **Money page:**
  - When overhead is off, the headline result is called "Profit after operating costs (gross margin)"; when on, "Net profit after all costs". Show a "What's counted" list from `cost_coverage`, falling back to the cost line labels.
  - Show an evidence line: "Based on N real growing seasons (Y0–Y1) × P price years (Y0–Y1)".
  - Make it clear that non-modelled losses come from insurance records per cause and that drought, heat and frost are already in the simulated years (no double counting).
- **Alerts:** a "Text message (SMS) alerts: coming soon" placeholder. The phone box is disabled, nothing is stored or sent, and it says so.
- **Offline:**
  - `public/sw.js`, registered only in production builds.
  - Caches the app shell and API responses for the fields a user opens. GET is network-first with a cache fallback; POST `/compare` and `/money` are cached by URL plus a body hash.
  - A "Save this field for offline" button prefetches a field's main endpoints.
  - `OfflineBar` shows "You're offline: showing results saved on {date}".
  - `manifest.webmanifest` for "Add to Home Screen", with PNG icons made from favicon.svg.

**Part 2, after B1–B3 land** (the orchestrator will message you):
- **Money page:** the yield-history panel, the ISU benchmark row with "Use these numbers", and storm events in the risk section.
- **DiseasePanel** on step 2 / My field and on the money risk section.
- **PeersPanel** on step 2 / My field.
