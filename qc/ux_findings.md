# UX findings (first-time-user walkthrough)

Goal: a farmer with no GIS experience can, without help, (1) find their farm from the globe, (2) select or draw their field, (3) see options, and (4) understand why one option is suggested.

## Round 1 (orchestrator walkthrough, Nov 14)
| # | Where | Friction | Proposed fix | Status |
|---|---|---|---|---|
| 1 | Globe Home | "Or click any field on the globe" is misleading: from space, a click immediately analyses a random point. | Zoom-aware drill-down: ladder, hints, field boundaries at farm scale, pick/draw card | in progress (globe agent) |
| 2 | Globe Home | Search placeholder is truncated ("Search lat, lon · state · cit") | Shorter placeholder: "Town, county or lat, lon" | done (globe agent); phones use "Town or county" (round U1) |
| 3 | Globe Home | No sense of the steps ahead | 3-step strip: 1 Find your farm · 2 Pick your field · 3 Compare rotations | done (globe agent) |
| 4 | Field Studio | Rotation options start empty: "Rank your priorities on the left, then compare rotations". A first-timer may not know to press "Compare rotations →" at the bottom of the left column. | Auto-run compare with default priorities on load (pilots are instant). The button becomes "Update with my priorities"; changing a priority re-ranks live. | done (U1-F1) |
| 5 | Field Studio | "We think you grow Corn ×2–Soybean" (the ×2 notation is jargon) | Plain words: "corn, corn, then soybean" | done (U1-F2) |
| 6 | Field Studio | The "Changes since your last visit" banner appears on the first real visit after the Demo or QC runs, and pushes content down; long entries are cut off | Show only when something meaningful changed. Make it one compact dismissible line. Exclude Demo-tour visits. | done (U1-F3) |
| 7 | All | Layout tested at 390/430/1280/1440/1920 only. Tablet and side-panel widths (800–1200 px) are untested, which is how the desktop app's browser pane shows it. | Add 820, 960 and 1024 px to the spacing and usability runs | done: probe and spacing spec now run 820/960/1024 (U1-F4) |
| 8 | Field Studio | Many tabs in the view nav (Field Studio, Compare, Season, Drought Replay, Climate Twins, Alerts, Sources…) scroll sideways at ~950 px and some are hidden | Group: primary tabs visible; the rest under "More ▾" at narrow widths | done (U1-F5) |

## Usability rounds U1–U3 (timed first-time-user tasks, Nov 14)

Method: a Playwright probe (Chromium, fresh profile) runs the ten tasks at 390×844, 820×1180, 960×900 (the desktop app's side pane), 1024×768 and 1440×900 against the dev server. It records steps, waits, whether each target is in the viewport, overlapping text and every Demo-tour step (target found, card covering the target, time to ready). WebGL is not in screenshots, so globe state is read from the DOM (ladder level, status pill, field card). U1 ran at 390/960/1440 before any fix; 820 and 1024 share the 768–1099 px layout rules with 960 and were measured in U2/U3.

### Round U1: before fixes
| # | Task / width | Friction | Sev | Fix | Status |
|---|---|---|---|---|---|
| F1 | T4, all | Rotation options start empty ("Rank your priorities on the left…", even on phones where there is no left) | high | Compare runs on load (`selectField` sets `compareRequested`); empty prompt replaced by a "Testing your rotation… a new field takes a little while" status | fixed |
| F2 | T4, all | "Corn ×2–Soybean" jargon in every card, timeline, why-not list and replay | high | `plainRotation()`: "Corn, corn, then soybean, with a cereal rye cover crop", applied in the compare and replay queries (display only) | fixed |
| F3 | Field Studio | "Changes since your last visit" box: a "nothing changed" variant, bullet list, written during Demo/QC visits | med | One compact line, only when something changed; no snapshot or banner while the tour runs, for fields the tour opened, or under automation (`navigator.webdriver`) | fixed |
| F4 | T7/T8, 960 | Sub-nav overflows by 162 px: Alerts and Sources & Methods hidden | high | Below 1280 px: Field Studio, Compare, Season, Drought Replay, Climate Twins + "More ▾" (Next Move, Region Compare, Alerts, Sources) | fixed |
| F5 | T1, 960 | Zoom ladder sits on the centre of the globe (x 440–540): the first click lands on the ladder | high | 640–1099 px with the card open: ladder parks on the right under the map buttons | fixed |
| F6 | T1, 390 | Home card covers the globe's centre; the zoom click hits the heading | high | Card folds once the user reaches State level below 900 px (was County) | fixed |
| F7 | T1, 960/390 | Home card runs under the footer credits | low | Card max-height stops above the footer (≥ 768 px) | fixed |
| F8 | T2b, all | Typing "42.11, -93.47" analysed a field at once (no chance to check it) | high | Coordinates/addresses fly to Farm level and open that field's card; Analyze stays the user's click | fixed |
| F9 | T4, 960 | Options start below a 520 px map (best card at y 892) | high | 768–1099 px: options sit beside My Field, map and Area Report below | fixed |
| F10 | T6, all | Priorities are 1,500–1,700 px down the My Field column; nothing points to them | med | "Ranked by what matters to you: 1 …, 2 … · Change priorities" under the options heading; jumps to (and on phones switches to) the list | fixed |
| F11 | T9, all | Export: 4–11 s with no feedback | med | "Preparing your printable report…" note until the download, then "Report downloaded" | fixed |
| F12 | T10, 390 | Tour step 6 card covers 59 % of the field sheet | high | Phone tour card goes to the top when the target sits low | fixed |
| F13 | T10, 960/390 | Export step has no target below 1100 px (button is in the menu) | med | Step targets Export or the Menu button that holds it | fixed |
| F14 | T10, all | 18 steps, ~3.4 min at reading pace; Next Move (expert) spotlight is the whole page; jargon ("Expert: Next Move", "feasible") | med | New 13-step story in plain words (below); "9 of 12 fit your farm" | fixed |
| F15 | Globe, Punjab | Dense Fields of The World outlines look busy at Farm level | low | FTW outlines thinner (2 px vs 3.2) and drawn only below 6 km; a click on a hidden FTW field flies closer first | fixed |
| F16 | T5, all | "Why not others?" is findable (in view at all widths) and names oats' reason | – | none needed | ok |
| F17 | T3, all | Draw-your-own works at County level, help text clear; area shown in acres and ha | – | none needed | ok |

### Round U2: after fixes (390/820/960)
| # | Friction | Sev | Fix | Status |
|---|---|---|---|---|
| G1 | 820: home card (400 px) still covers the globe centre | high | Fold-at-State rule widened from phones to < 900 px | fixed |
| G2 | New (non-pilot) field: compare takes 5–15 s showing only skeletons | med | Status line "Testing your rotation and the alternatives in every past weather year…" | fixed |
| G3 | Tour step 1 card covered 55 % of its target at 960 (card measured before its width was set, so it was placed too low) | med | Tour measures the card at its final width before placing it | fixed |
| G4 | Tour text 384 words (~3.3 min) | med | Trimmed to 317 words | fixed |
| G5 | Winter wheat county yield missing, silently | low | "Winter wheat: no county yield statistics here" | fixed |

### Round U3: re-test (390/1024/1440)
| # | Friction | Sev | Fix | Status |
|---|---|---|---|---|
| H1 | 1440: taller cards (county yield lines) pushed "Best for you" below the fold; the current rotation came first | high | Cards ordered Best for you → current → rest | fixed |
| H2 | "→ 0 with Corn, corn, then soybean, with a cereal rye…" reads badly | low | "… weeks now → 0 if you switch to …" | fixed |
| H3 | Tour: every step finds its target at all five widths; desktop card covers 0–8 % of a target; phones 10–27 % on tall targets (Area Report, twin card) | low | The card goes to whichever end hides less; U4 made the phone card slimmer | fixed in U4 (J3) |
| H4 | Priorities still sit low in My Field | low | Moved to the top of My Field in U4 | fixed in U4 (J1) |
| H5 | New-field analysis 7–9 s, boundary load 6–15 s (progress bar and spinner shown) | low | Server-side speed-ups in U4 | fixed in U4 (J4, J5) |

**Task completion and steps (first-time user, mouse).** All ten tasks complete at all five widths in U3.
| Task | U1 steps | U3 steps | Notes |
|---|---|---|---|
| 1 Globe zoom → field | 3 clicks + Analyze; blocked at 960/390 (ladder/card on the globe centre) | 3 clicks + Analyze at every width | planet → state → farm → field |
| 2 Search "Ames, Iowa" → field | type + pick + 1 click + field click + Analyze (5) | same (5) | city lands at County level |
| 2b Coordinates | 1 (Enter) but analysed a field unasked | Enter + Analyze (2); field card shown first | |
| 3 Draw boundary | 1 link + corners + Finish + Analyze | same | |
| 4 Options, best for you | +1 click ("Compare rotations"), best card below the fold at 960 and 1440 | 0 clicks; best card first and in view (scroll on phones) | |
| 5 Why oats excluded | 1 click | 1 click | |
| 6 Water first | scroll ~1,600 px + 2 clicks | "Change priorities" + 2 clicks | |
| 7 Replay 2012 | 1 tab (hidden at 960) | 1 tab | 2012 preselected |
| 8 Climate heading | 1 tab | 1 tab | |
| 9 Export | 1 click (+ Menu below 1100 px), no feedback | same, with feedback | |
| 10 Demo | 18 steps, 1 without target below 1100 px | 13 steps, all with targets | |

**Re-test (U3, against a dev server on :5182, API :8000).** `npx tsc -p tsconfig.app.json --noEmit` clean. Playwright: judge, pilots, demo, axe (desktop + mobile, 0 serious/critical), perf, spacing (now 8 sizes incl. 820/960/1024: no horizontal scroll, off-screen, clipped or overlapping items; the new "Change priorities" link got a 44 px target on touch) and the iPhone (Chromium-emulated) core path all pass. Demo tour: 13 steps, every target found, 73.6 s at machine speed (`qc/reports/demo_tour_timing.md`), about 2½–3 min at a reading pace.

### Round U4: remaining items (Nov 14)
| # | Friction | Sev | Fix | Status |
|---|---|---|---|---|
| J1 | Priorities sat at the bottom of My Field (1,500 px down) | low | "My priorities" is now the first block in My Field (compact chips, 32 px; 48 px on touch). "Change priorities" still jumps to it. | fixed |
| J2 | "Markets assumed" listed CDL land covers (pasture, grass hay) with raw ids | low | Assumed markets keep only crops in the knowledge base. The 8 pilot comparisons were recomputed: only the markets list changed (cards and ranks identical). Ids show with spaces. | fixed |
| J3 | Phone tour card hid 10–27 % of tall targets | low | Slimmer phone card: less padding, no step dots (the "n of 13" counter stays), body capped at 24 % of the screen with its own scroll | fixed |
| J4 | New field: 7–9 s from Analyze to options | low | Measured: data fetch 2.6–3.3 s (SSURGO 1–5 s, all sources in parallel), first compare 4 s, half of it parsing YAML. Fix: the C YAML parser, the knowledge base loads at API start-up, and the default comparison starts on the server as soon as the field's data arrive (/compare waits for it instead of running it twice). | fixed: 3.5–3.8 s end to end (two new Iowa fields) |
| J5 | Field outlines 6–15 s on the globe | low | CSB queries take 0.2–0.7 s; the wait was the queue behind slow NAIP tiles (USGS exportImage, 6–40 s each) on the browser's ~6 connections to the API. Cesium's NAIP requests are now capped at 3 (was 4) so outline and analysis calls get through. `scripts/prewarm_naip.py` fills the NAIP cache around the US pilot fields (zoom 12–18) before a demo. | fixed (pre-warm reruns when USGS is busy) |

Re-test: Playwright judge, pilots, demo, axe, perf, spacing (8 widths, no new small or overlapping items) and the iPhone core path pass (10/10). Data checks: 0 FAIL.

### Round U5: ideas borrowed from a second prototype (Nov 15)
A review of a separate prototype (the `Chat` folder next to this project, ideas only, no code copied) gave 16 items. Contracts and ownership: `docs/reference/WAVE_U5_CONTRACTS.md`.

| Item | Where | Status |
|---|---|---|
| HLS 30 m greenness inside the field (Fmask-filtered, withheld < 50 % usable) + ECOSTRESS 70 m daytime ET | Area Report → field satellite; `/api/fields/{fid}/hls`, `/ecostress` | done, precomputed for 8 pilots |
| "How well does it work?" (M2 held-out, M10 levels, weather, M3) | new view; `/api/validation` | done |
| Crop descriptions and check-first items (32 crops, EN/ES) | Why not others? tabs | done |
| Your own prices, costs, yields | My Field; compare `budgets` | done |
| Rainfall by year, click to replay | Drought Replay; `/rainfall-years` | done |
| 7-day forecast + NWS official warnings | Alerts | done |
| Action plan (3 stages, adviser notes, plan PDF) | new view; POST report.pdf | done |
| Priority presets + weight-mix bar | My Field | done |
| Build your own rotation (ranked with the rest) | new view; compare `custom` | done |
| Best vs current toggle | Rotation options | done |
| Saved plans, CSV / JSON export, import | new view | done |
| Drier & hotter, Lower prices stress tests | Scenario panel | done |
| Fits / Excluded tabs | Why not others? | done |
| "I've checked this" ticks (history, soil) | My Field | done |
| Step n of 5 bar | all field views | done |

Also fixed: the Aphanomyces soil test showed on every option (sub-rule fired without its parent); family check items now only when they concern a crop in the option; the equipment exclusion no longer says "you told us". Pilot comparisons recomputed (ranks and indicators unchanged).

Open: Drought Replay's season-rain KPI uses May–Aug while rainfall-by-year uses the crop season (May–Oct for Story), so the two "season rain" numbers differ (a note explains it). Your own options appear in Build your own and Plan, not in the main Compare view.

Re-test: Playwright judge, pilots, demo (14 steps, every target found), axe (desktop + mobile), perf, spacing (40 page × width combinations: no horizontal scroll, off-screen, clipped or overlapping items) and the iPhone core path pass (10/10). `tsc` clean.
