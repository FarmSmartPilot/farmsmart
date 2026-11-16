# Final gate report: brief §8 acceptance tests

Checker agent, 2026-11-14. Each test is marked **PASS / PARTIAL / FAIL**. The evidence sits under `qc/`.

How to re-run:
- **e2e suite:** `bash qc/e2e/run.sh --project=desktop-chromium --project=iphone-chromium-emulated`.
  - Specs: `judge`, `pilots`, `mobile`, `demo`, `axe`, `perf`, `spacing`.
  - Results: `qc/reports/e2e_results.json` and `e2e_run.log`.
- **Data checks:** `conda run -n fieldshift python qc/checks.py` → `qc/reports/data_checks.md`.
- **API performance:** `python qc/perf_api.py` → `qc/reports/perf_api.json`.

**Final suite run (after all fixes):** 10 of 10 specs pass (axe desktop + mobile, demo, judge 10.0 s, perf, 3 pilots, spacing, iPhone-emulated 10.8 s); see `qc/reports/e2e_run.log`.

**Overall: NOT a clean pass.** The core product works end to end on all four judge regions, accessibility is clean, and nothing breaks the never-claim list. Five items still block a strict sign-off:
1. Real iPhone WebKit was never run.
2. Model cards and calibration plots are missing.
3. The satellite-versus-ground checks are incomplete.
4. Drought Replay draws "likely range" bands that often do not contain the central line.
5. Two pilots show only one alternative, and two show alternatives from the same family.

## Acceptance tests

| # | Test (brief §8) | Verdict | Evidence |
|---|---|---|---|
| 1 | **Judge path, desktop, < 2 min** (Story County IA): search → field → Field Studio → compare (current + 2 alternatives, 7 sections each) → Why not others? → Expert + Next Move → Replay 2012 → Climate Twins → subscribe alert → export PDF | **PASS** | `judge.spec.ts`, Chromium 1440×900. Total 9.8–13.6 s.<br>• Search returns geocoder results, then the pilot quick-pick opens the CSB field.<br>• 3 cards, each with all 7 sections non-empty.<br>• Why-not popover lists rotations left out and crops that do not fit.<br>• Next Move chart renders; replay 2012 KPI sentence appears; Twins shows "x of N models agree".<br>• Subscribe answers "Check your email to confirm (outbox)", and an `.eml` is written to `alerts/outbox/`.<br>• Export downloads `farmsmart-<id>.pdf` (`%PDF-` header). No page errors.<br>Two bugs found and fixed on the way (see Fixes). |
| 2 | **Repeat for Garden City KS, Saskatchewan, Punjab** with honest coverage flags | **PARTIAL** | `pilots.spec.ts`, all 3 pass.<br>• **Coverage flags shown:** KS "Markets & costs: Partial"; SK has 4 flags (SoilGrids soil, outcome models, forecasts, no markets); Punjab has 5 (adds "Crop history: Not available").<br>• **Punjab shows only current + 1 alternative.** The UI names the binding constraint ("Fewer than two alternatives fit: no buyer confirmed") and offers adjustments, which the brief allows. It is still not "two alternatives".<br>• **Same-family alternatives:** both Saskatchewan alternatives are Market-driven add (data check). Brief §1.5 asks for different families.<br>• **Not exercised for these pilots:** Drought Replay and alerts. Replay caches exist for US fields only. |
| 3 | **iPhone (WebKit 390×844) portrait, tabbed layout** | **PARTIAL** | `mobile.spec.ts` passes the full path (tabs Map · Options · Timeline · My Field, cards with 7 sections, why-not sheet, Expert/Next Move, replay, twins, alert, PDF, no horizontal scroll) in 11.3 s, **but in Chromium with iPhone emulation**. Real WebKit cannot launch on this PC: Windows Smart App Control blocks Playwright's WebKit DLLs (exit 0xC0E90002). The `iphone-webkit` project is configured; run it on a Mac or in CI, or test by hand on an iPhone. |
| 4 | **Every displayed number traces to evidence or a model prediction via its pop-over; every SI output shows confidence with reasons** | **PARTIAL (not proven)** | Data and SI dots appear next to the values on every screen captured. Cards carry a confidence chip with reasons, and backend `evidence_id`s all resolve (`data_checks.md`). No automated test opens every number's pop-over, so this is sampled, not proven. |
| 5 | **Data checks:** QA masks, units and ranges, no future-data leakage, satellite-vs-ground reports (IMERG vs PRISM/CoCoRaHS; SMAP vs SCAN; ET vs OpenET) | **PARTIAL** | `data_checks.md`: 139 pass · 23 warn · 11 fail.<br>• Ranges, P10 ≤ P50 ≤ P90, 7 elements, baseline present, evidence ids: pass on every compare/context file.<br>• **Future-data leakage:** POWER ends 2026-11-12 and replay years are before 2026 (pass). SMAP's last week is labelled `week_ending 2026-11-15`, one day after today: a partial week labelled with a future date (warn).<br>• **QA masks:** MODIS reliability and HLS clear-scene masks are documented in the evidence records.<br>• **Satellite vs ground:** only POWER vs GHCN (2 pilots) and SMAP L4 vs POWER (model vs model) exist.<br>• **Missing:** IMERG vs PRISM/CoCoRaHS (IMERG not retrieved: GES DISC approval), SMAP vs SCAN, ET vs OpenET. |
| 6 | **Model checks:** validation reports and model cards complete; calibration plots in `qc/` | **FAIL** | `models/model_cards/` has M3, M7 and M8 only. M1, M2, M4, M5, M6, M9 and M10 have no card. M1, M2, M4 and the M5 GBM are untrained, which REQUIREMENTS_TRACE C4/C5 acknowledge. **No calibration plots are under `qc/`**, although `SI_USE_DISCLOSURE.md` names one. |
| 7 | **Requirements coverage:** `docs/REQUIREMENTS_TRACE.md` maps every objective to a screen | **PARTIAL** | The file exists and covers the list. **It is stale:**<br>• It says "no `nasa_*.json` yet", but 8 exist.<br>• It marks Region Compare, "changes since last visit" and the SK/Punjab repeat ❌, but all three now work (the e2e suite exercises the last).<br>Owner (story/research) must refresh it. |
| 8a | **WCAG 2.2 AA (axe: no serious issues)** | **PASS** | `accessibility.md`: 0 violations of any impact on Field Studio, Compare, Twins, Replay, Alerts and Sources at 1440×900 and 390×844 (wcag2a/aa, 21a/aa, 22aa). Before the fixes: 325 contrast nodes, 26 label-in-name, 2 scrollable-region and 12 target-size. Not scanned: Globe Home canvas and map labels over imagery. |
| 8b | **Performance budgets** | **PASS (one caveat)** | `performance.md`:<br>• Globe first render 564–583 ms.<br>• Cached report + compare 63 ms (API); in the UI the field opens in 0.1 s and the cards appear in 0.9 s.<br>• New field 4.7 s (Iowa) and 9.3 s (Nebraska, cold) against a 30 s budget.<br>• Compare re-run 1.4–1.5 s (API) and 0.4 s (UI).<br>• Caveat: the first visit in a fresh tab on the dev server takes 3–4 s, while lazy chunks load next to the software-rendered globe. Re-measure on the production build. |
| 8c | **Spacing report clean at all widths** | **PASS** | `qc/spacing_report.md`: 0 horizontal scroll, off-screen, clipped or overlap issues at 1280/1440/1920/390/430. Mobile tap targets were fixed. The remaining small targets are inline glossary terms (WCAG inline exception) and a third-party map logo. |
| 8d | **No secrets in git** | **PASS** | `git ls-files` lists no `.env`. A history search finds no `EARTHDATA_TOKEN=` value or token patterns. `.env.example` has empty keys. |
| 8e | **No NASA logos** | **PASS** | No logo or insignia assets are tracked. The footer on every page reads "No NASA endorsement is implied." |
| 8f | **"SI" terminology throughout** | **PASS** | `checks.py` finds 0 "AI" words in 2,247 UI strings (i18n plus TSX literals) and 0 in backend card texts, and no "IA" in Spanish. |
| 9 | **Never-claim list** (part of brief §0 and §8 honesty) | **PASS** | No claim-like text was found for:<br>• NDVI measuring yield, residue or carbon;<br>• GRACE as a well;<br>• common meaning suitable;<br>• "guarantee";<br>• quick organic-matter gains;<br>• imagery showing field soil moisture or wind;<br>• "proves" a switch gain.<br>A self-test confirms each pattern catches a planted claim. Every sentence pairing these terms is listed for review in `data_checks.md`; all are disclaimers. |
| 10 | **Guided Demo** | **PASS** | 12 steps in 13.1 s at machine speed (`demo_tour_timing.md`), no page errors. |

## Fixes made by the checker in `web/src` (not committed)
- **Alert subscription bug:** `views/AlertsSettings.tsx` sent `quiet: {start, end}`, but the API needs `quiet: [start_hour, end_hour]`. Every subscribe failed with 422 "Could not subscribe".
  - Fix: a `hourOf()` helper converts "21:00" to 21.
  - The orchestrator committed this and also fixed the threshold key.
- **Keyboard focus trap:** `design/Popover.tsx` focused the popover while it was still `visibility:hidden`, so focus never entered. Esc did not close "Why not others?" and Tab was not trapped.
  - Fix: the trap now activates once the popover is positioned.
- **Contrast** (`design/tokens.css`, `components.css`, `base.css`, `app.css`): see `qc/reports/accessibility.md`.
  - New `--sky-text` #276B9A for text, and `--ink-3` changed to #5E6D7F.
  - Confidence colours darkened; `--crop-rye` and `--crop-sorghum` darkened.
  - **New `--si-dot` #1A8046 for the SI dot. This needs sign-off**, because the brief says #1E8E4E and white "SI" letters on #1E8E4E are 4.17:1, below AA.
- **Crop labels:** `lib.ts` `cropInk` picks navy or white per crop fill for 4.5:1.
- **Label in name:** `design/Provenance.tsx` (SI button name starts with "SI:") and `views/MyField.tsx` (year-tile name starts with its visible text).
- **Scrollable regions:** `views/SeasonTimeline.tsx` and `components/NasaBlocks.tsx` get focusable, labelled scroll regions.
- **Spacing and tap targets** (`app.css`, appended "QC spacing fixes" block): citation icon inline with a 24 px link, "Best for you" tag moved onto the card border, coarse-pointer 44 px targets.

## Red-team findings for backend or agronomy owners (not fixed: outside the checker's remit)
1. **Drought Replay bands do not contain the central line.**
   - The "likely range" is the AWC −20 % / +20 % runs, plotted in % full. The central run falls outside [min, max] by more than 1 point in 2–53 of 104 week-rows per file. San Joaquin and irrigated Garden City are worst; Story County 2012 has 2 weeks.
   - A judge sees a line escaping its own confidence band.
   - Fix (`engine/replay.py`): build the band as an envelope that includes the mid run, or plot it in mm.
2. **Wrong pH message for suboptimal soils.**
   - The `soil_ph_fit` suboptimal branch reuses the exclusion message "Soil pH is outside the range this crop tolerates."
   - In Story County (pH 6.54) every card, including the farmer's own corn–soybean, carries this trade-off, because soybean's ECOCROP optimum tops out at 6.5. An Iowa agronomist will doubt it.
   - Fix: a separate message for "slightly outside the ideal range", and rethink the 0.04-unit trigger.
3. **Mato Grosso cotton excluded on pH.**
   - Cotton is excluded on pH (SoilGrids, unlimed), yet Mato Grosso is Brazil's largest cotton state, and Cerrado soils are routinely limed.
   - The result is only 1 alternative, with "Soil pH" as the binding constraint. Consider a "with liming" assumption.
4. **Negative dry-year regret.** On irrigated Garden City it reaches −12.5 for c11/c12. Regret should be ≥ 0 by definition; check its definition and sign.
5. **Same-family alternatives.** San Joaquin's two alternatives are both Extend & diversify, and Saskatchewan's are both Market-driven add. The diversity rule in `rank.py` is not enforced when one family dominates.
6. **SMAP future date.** The last weekly row is `week_ending 2026-11-15` with data only to 2026-11-10. Label it with the last data day.
7. **NaN in cache files.** `nasa_{1dd4…,5dac…,6a41…,f085…}.json` contain bare `NaN` in HLS months, which is invalid JSON. The API sanitises them, but other readers will choke. Write `null`.
8. **Forecast coverage note.** For SK, Punjab and MT the "Forecasts: Partial" note reads "NOAA NWS (US) / Open-Meteo". Say "Open-Meteo" outside the US.
9. **New-field timing depends on upstream services.** POWER, SDA, CDL and tiles are live calls; record any failures in the job.

## Remaining risks
- **iPhone Safari untested on real WebKit.** Safari-specific issues (100vh, `position: sticky` in sheets, date and time inputs, WebGL fallback to MapLibre) are unverified.
- **Live-service dependence:** the judge path relies on precomputed caches for the pilots. A judge who picks a new field depends on the live services plus Nominatim, which is rate-limited to 1 request per second.
- **SI evidence is thin.** Many SI outputs are process models or rules, labelled honestly. The trained SI models (M1, M2, M4, M5) do not exist, and the cards and calibration a judge may ask for are missing.
- **Fragile UI selectors.** The tests rely on English text because there are no `data-testid`s, so a copy change breaks them.
- **First visit is slow.** A first visit on a slow laptop (Cesium bundle over 500 kB) may exceed 2 s before Field Studio paints.
