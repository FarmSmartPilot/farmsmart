# FarmSmart releases

## Version 1.6.0 (15 November 2026)

- **New name: FarmSmart** (formerly Field Shift). The new logo (a sprout on a leaf-shaped tile), the wordmark ("Farm" heavy, "Smart" medium, Manrope) and the tagline "Smarter choices. Better seasons." (DM Sans) are used across the app, the browser tab, the favicon, the home-screen icons, exported file names (`farmsmart-*.pdf/.csv/.json`), the API title, the docs and the deck outline. Brand files: `docs/brand/`.
- Plan files saved under the old name (`field-shift-plan`) still import.
- The side panel no longer scrolls sideways; in narrower panels (Expert mode) the logo shrinks and the tagline wraps onto two lines.
- Unchanged on purpose: the Python package and environment are still called `fieldshift`, and browser storage keys keep their `fieldshift-` prefix so saved fields and farms survive the rename. The 10-second intro video was recorded before the rename and still shows the old name.

## Version 1.5.1 (15 November 2026)

- **Your own score weights:** "Adjust the weights" under the farm score has three sliders (profit, risk safety, soil & water). The farm score, every field's score, the drill-in and "Raise your score" update as you drag. "Back to {goal}" returns to the preset, and picking a goal under "Find the best plan" also resets the sliders. Example: on the sample farm, soil & water first with profit at 0 moves the score from 8.4 to 5.2.

## Version 1.5.0 (15 November 2026)

- **Whole farm becomes a portfolio dashboard** (built for 1 to 20 fields and more):
  - **Farm score from 1 (high risk) to 10 (excellent)** with three parts: profit, risk safety and soil & water. It is weighted by the goal the farmer picks (most money, balanced or safest). There is a green SI button with confidence and reasons, and a count of fields by score band.
  - **A score for every field**, shown as tiles in a grid. Each tile has its rank, acres, the crops for the next 5 years, typical and bad-year dollars, the chance of a losing year and three small score bars. Tiles can be sorted riskiest first, best first, largest first or by name; the table view is still there.
  - **Drill into any field:** each plan's field score and what the farm score would become ("Farm score 8.3 (−0.1)"). Pick a plan and the whole dashboard updates. Acres, lock, open the field or its money page, remove.
  - **Raise your score:** the single-field changes that raise the farm score most, each with a "Try it" button. "Find the best plan" now also shows the farm score before → after.
  - Fields still waiting for numbers stay on the board and say why. The Fields box counts every field ("2 in the totals, 1 waiting for numbers").
- **Sunflower has profit numbers:** costs from NDSU projected crop budgets (2022–2026, 9 North Dakota regions); prices and yields from USDA NASS. Fields with sunflower in the rotation (e.g. the Dakotas) are no longer left out.
- **Rotation comparison works in every US state.** It used to need one of the pilot regions, so fields in states like South Dakota said "not supported yet". Every state now has its own planting and harvest dates from USDA's handbook (AH-628, state-level usual dates). New England states without dates borrow New York's and say so. Compare, Test the weather and Make a plan all work there. Hawaii still gets the environmental analysis only.
- **Satellite | Map** switch on the field map: a street map with roads and place names (OpenStreetMap).
- **"What next?" on step 5:** keep this plan (what Save, Download and Save a copy each do), add your other fields, see the whole farm.
- **Add another field** opens Find your farm at your current field, close enough to see its neighbours.
- **Demo → Sample whole farm (3 fields):** three real central-Iowa fields (Story, Boone and Hamilton) in the whole-farm view. The sample farm is now these three fields, and they are precomputed, so it loads quickly on a fresh install.
- Fix: building options no longer fails when a rotation has a single crop and some candidates carry cover crops.

## Version 1.4.0 (15 November 2026)

Git tag `v1.4.0`.
- **Whole farm** (`#/farm`; "One field | Whole farm" switch in the left panel, top bar and phone menu):
  - **Dashboard:** every field in one place, lined up on the same real weather years and price years. It shows typical profit, bad year (1 in 10), the chance of a losing year and the diversification bonus (farm bad year vs every field's bad year added up), with field-to-field correlation.
  - **Plans over time:** crop mix by year, acre-weighted soil and water, and a 5-year farm cash flow.
  - **Portfolio optimizer:** most money / balanced / safest, a cap on one crop's share, and locked fields. Apply and Undo, with an SI confidence record. "Add to my farm" is on Compare, Make a plan and My fields.
  - **Sample farm:** 4 real Iowa fields.
- **What farmers ask first** (docs/research/FARMER_PRIORITIES.md): the Welcome page leads with "How much could I earn, after costs?", "What happens in a bad year?", "So what should I plant?" and "Will it cut pests and disease?", each answered with live numbers.
- **Money evidence:**
  - "Gross margin" vs "net profit" named by what is counted, with a "What's counted" list from the USDA ERS documentation;
  - "based on N real seasons × P price years";
  - county yield history (USDA NASS) with trend;
  - Iowa State 2026 budgets (A1-20) with "Use these numbers";
  - NOAA storm events per county (1996–2025);
  - a note that insurance losses are per cause and never double-count the simulated drought, heat and frost.
- **Disease and pests:**
  - a cited pathogen host table across plant families, including cover crops (white mold, SCN, FHB, rootworm, Aphanomyces, clubroot, blackleg, tar spot, gray leaf spot, take-all, nematodes…), with a rule that never double-penalises;
  - a disease-weather panel using the UW-Madison tar spot, gray leaf spot and white mold models on NASA POWER weather (Midwest only, SI confidence).
- **What farms around you grow:** USDA CDL (AAFC in Canada) within about 5 km: rotation types, what followed each crop, and recent changes. It is not proof that a switch pays.
- **Offline and alerts:**
  - "Save this field for offline", an offline bar, and installation to the home screen;
  - text-message alerts placeholder (nothing stored or sent).
- **Fixes:**
  - rule sub-messages no longer appear on unrelated years;
  - Spanish rule messages on the cards;
  - a failed place lookup is retried and no longer cached.

## Version 1.3.0 (15 November 2026)

Git tag `v1.3.0`.
- **Welcome page** (front page in Simple mode): a USDA NAIP aerial photo of Story County, what FarmSmart does, a live real example, the open data behind it and live validation numbers; "Step 1: Find your farm".
- **Left panel**: brand ("A smart rotation"), your field, Welcome, the five steps (one line each with a number and the current step highlighted), "Work out the money" under step 3, More tools; "My fields" when signed in.
- **Demo sign-in** (placeholder) and **My fields** (open, rename, remove; quick list in the panel).
- **Money calculator**: compare up to 3 rotations on revenue, itemised USDA costs and net for the whole field; risk from every weather year since 1991 × 10 years of prices, county crop-insurance losses (USDA RMA) and declared disasters (FEMA); prices panel (NASS, WASDE, USDA projections, fertilizer) with a choice of price; EQIP cover-crop payments; year-by-year cash flow; fertilizer savings (off by default); your own yields and soil test.
- **NOAA season outlook**, any-year Drought Replay, Demo menu with sample farms, search under the map, map controls below the map, strip keys, consistent page titles, Spanish crop names in rotation names, iPhone fixes.
- **10-second intro video**: `docs/demo/field_shift_intro_10s.mp4` (screen recording of the real app; `qc/video/make_intro.sh`).
- Checks: Playwright 14/14 (judge, pilots, Demo, guided at 960/1440/390, money, axe desktop + mobile, performance, spacing at 8 widths, iPhone path).

## Version 1.2.0 (15 November 2026)

Git tag `v1.2.0`.
- **Guided mode (Simple, the default).** A step-by-step path for people who are new to tools like this, inspired by the clarity of a second prototype:
  - one page per step, each with a plain heading and one sentence saying what it is for;
  - Back / Next buttons at the bottom of every page;
  - a left control panel listing the five steps with a short hint each, ticks on finished steps, and the current step highlighted (900 px and wider; phones get the compact step bar).
  - The steps: 1 Find your farm (globe) · 2 Check your field (map and the field's facts) · 3 Compare your options (what matters most, then the ranked options and when the soil is bare) · 4 Test it against real weather (Drought Replay, with a way to Climate Twins) · 5 Make it your plan (checklist, notes, plan PDF).
  - Every other view is one click away under More tools.
- **Expert mode** keeps the all-in-one Field Studio and the full navigation.
- The Demo tour follows the guided pages. New Playwright test `guided.spec.ts` walks steps 2–5 at 960, 1440 and 390 px with axe on every page.

## Version 1.1.0 (15 November 2026)

Git tag `v1.1.0`.
- **Logo and intent line.** A new FarmSmart mark: a leaf-shaped tile with a sprout inside a rotation arrow that reaches toward a small satellite (no agency insignia). It sits next to the name, with "NASA Earth data for rotations that protect soil and save water" on wide screens. The browser-tab icon matches.
- **Left navigation rail (1280 px and wider).** Every view, grouped under the five planning steps (Find your farm → Make a plan), plus More tools. It replaces the tab row and step bar at these widths; narrower screens keep them.
- **My Field on the right.** Field Studio is now Rotation options | map | My Field, with the season timeline under the options and map, at every width.
- Checks: Playwright judge, pilots, Demo, iPhone path, axe (desktop and mobile, 0 serious or critical) and spacing at 8 widths all pass.

## Version 1.0.0 (15 November 2026)

The first complete version, for NASA Space Apps 2026 ("Adapting Farms with NASA Data"). Git tag `v1.0.0`.

**From the globe to one field**
- Drill-down from planet to country, state, county and farm. Real field outlines come from USDA Crop Sequence Boundaries in the US and Fields of The World elsewhere. You can also draw your own boundary or upload one.
- Search by town or by coordinates. 8 pilot fields: Story County IA (two), Finney County KS (dryland and irrigated), San Joaquin CA, Saskatchewan, Punjab and Mato Grosso.

**What the data says about the field**
- NASA POWER weather since 1991: normals, trends, frost dates and weekly hazards (regional value, ≈50 km).
- SSURGO soil (SoilGrids outside the US), terrain, and USDA crop history.
- NASA HLS greenness at 30 m inside the field, and ECOSTRESS daytime water use at 70 m.
- SMAP soil moisture, GRACE-FO water storage and MODIS NDVI. Every value has a navy NASA or gray data button.

**Comparing rotations**
- Six strategy families are screened by 27 sourced agronomy rules, then simulated through every past weather year. The simulation covers water balance, yield response, RUSLE erosion, wind exposure, soil carbon, residue and cover.
- Options are ranked by your priorities and kept diverse. Each gets a confidence level with reasons, rank stability, and "what would change the choice".
- County yields come from the M2 SI model (P10/P50/P90). Profit uses USDA ERS costs, or your own prices, costs and yields.
- Priority presets, Best vs current, stress tests (normal, dry, drier and hotter, lower prices, custom), and "Why not others?" with each crop's description and what to check first.
- Build your own rotation: your options are ranked alongside the app's own, and any that can't work come back with reasons.

**Testing the weather**
- Drought Replay of any past year, with rainfall by year.
- Climate Twins for the 2040s (6 CMIP6 models): where your future climate exists today.

**Acting on it**
- Action plan: a checklist in three stages, notes for your adviser, and a plan PDF.
- Saved plans with CSV and JSON export and import.
- Forecast alerts with double opt-in, plus official NWS warnings for US fields.
- Printable report. English and Spanish. Phone, tablet and desktop layouts. A 14-step guided Demo.

**Quality**
- Playwright end-to-end tests: judge path, all pilots, Demo, iPhone path.
- Axe accessibility checks with 0 serious or critical issues.
- Performance budgets; spacing checked at 8 screen widths.
- Data checks: 0 failures.
- Validation reports for weather, SMAP, M2, M3 and M10.

**Known limits** (also in the app and in `docs/METHODS.md`)
- Weather is regional.
- RUSLE uses an assumed slope length.
- Profit on irrigated fields leaves out pumping costs.
- IMERG is waiting on GES DISC approval.
- M1, M4 and M12 are not trained.
- Not yet tested on a real iPhone (WebKit).
- Drought Replay's season rain (May–Aug) differs from the crop-season rainfall chart.
- Your own rotations are not yet shown in the main Compare view.
