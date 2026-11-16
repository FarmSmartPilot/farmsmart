# Demo script: the guided tour (14 steps, about 2¾ minutes)

The app opens in **Simple** mode, the guided path: one page per step (Check your field → Compare your options → Test it against real weather → Make it your plan) with Back / Next and a step-by-step control panel on the left. The tour walks those pages. **Expert** (top bar) shows the all-in-one Field Studio instead.

**Setup.** Run the real app (`.\start.ps1`, or the public URL once deployed). Any width works: the tour was checked at 390 (phone), 820 (tablet), 960 (desktop side pane), 1024 and 1440 px. Use metric units, English, Simple mode and the default priority order. Click **Demo** (top right) and press **Next** on each step. The tour flies from the planet to one Story County field, then walks the Story County, Iowa pilot field (`b96d39c7a833`). When it ends, the visitor's own priority order is restored.

**Number sources.** Every number below was read on 2026-11-14 from the live API on :8000 (after the M2 county-yield update):
- `POST /api/fields/b96d39c7a833/compare` with the default body (cmp)
- the same with priorities `water, soil_cover, erosion, profit, soil_health, pests, workload` (cmp-water)
- `GET /api/fields/b96d39c7a833/report` (rep): Area Report
- `GET /api/fields/b96d39c7a833/replay?year=2012` (rp)
- `GET /api/fields/b96d39c7a833/twins` (tw)
- `qc/reports/weather_agreement.md` (qc)

If the backend or a precompute is rebuilt, re-read these numbers before presenting. Steps 10 and 11 are computed live: read them off the screen.

**Rules while talking:** say "SI", not "AI". Say "regional value" for weather and "county statistics, not your field" for yields. Never say a number that is not on screen.

| # | Time | Tour step: what is on screen | What to say | Real numbers on screen (source) |
|---|---|---|---|---|
| 0 | 0:00 | Globe Home, then click **Demo** | "FarmSmart takes a farmer from the planet down to one field and compares crop rotations that protect soil and save water. It supports the farmer's judgment; it doesn't replace it." | none |
| 1 | 0:06 | **One farm, from space**: whole Earth, hint "Click anywhere or search to fly closer" | "No GIS needed: type your town, or just click the globe." | none |
| 2 | 0:15 | **Down to the county**: Story County, Iowa, county lines | "One click took us to the county. One more and fields appear." | none |
| 3 | 0:27 | **Real field outlines**: Farm level, status pill "N field boundaries · USDA" | "Every outline is a real field from USDA's Crop Sequence Boundaries. Outside the US we use Fields of The World." | Boundary count in view (read off the pill; it depends on the view) |
| 4 | 0:40 | **Pick your field**: field card with size and 2017–2024 crops | "The farmer checks it's their field before anything is analysed. Wrong field? Pick another or draw your own." | Size in acres and hectares; crop tiles per year (USDA CDL via CSB) |
| 5 | 0:52 | **What the data says here**: Area Report, first section | "Thirty-five years of NASA POWER weather: this spot is warming about half a degree per decade, and that's a clear trend, not noise. This season has been wet. All weather is a regional value, about 50 km." | Normals 1991–2020: 9.4 °C, 880 mm rain, ET₀ 895 mm. Trend 1991–2025: +0.49 °C/decade (likely 0.14–0.85), p = 0.016; GDD +95/decade. Season 2026: 1,041 mm vs 804 mm normal, 94th percentile (rep) |
| 5b | 1:01 | **Your field, pixel by pixel**: Area Report, "Greenness through the season (HLS NDVI)" | "NASA's Harmonized Landsat and Sentinel-2 measured greenness on every 30 m patch of this field all season, with clouds and haze removed. Greenness is not yield, residue or soil carbon." | 2026 Apr–Oct: 24 scenes, 20 usable (4 withheld for cloud or haze); field median greenness 0.23 in spring, peak 0.89 on 12 July (`hls_b96d39c7a833.json`) |
| 6 | 1:03 | **Your field, your facts**: crop history tiles, "We think you grow corn, corn, then soybean. Right?" | "We read the rotation from crop maps and ask the farmer to confirm. Every fact is editable." | Detected rotation: corn, corn, then soybean (cmp `baseline_detection`) |
| 7 | 1:12 | **Your best option**: card "Corn, corn, then soybean, with a cereal rye cover crop", tagged **Best for you**, with county yields | "The options appear on their own; no button to find. Each was run through every weather year since 1991. Same crops, plus a rye cover: soil is covered all year and soil loss to water drops by two thirds. It uses more water and costs money, and we show that. The yield line is county statistics from our SI yield model, not a promise for this field." | Match: current 43 · cereal rye 76 · corn, soybean, then winter wheat with hairy vetch 73 (confidence High · High · Low). Medians over 35 weather years: soil loss 6.9 → 2.3 t/ha/yr; days covered 311 → 365; water use 507 → 564 mm/yr; soil carbon −0.07 → +0.15 t C/ha/yr; typical net return $288 → $238/ac/yr; bare weeks 10.5 → 0. County yield (M2, SI button): corn typically 211 bu/ac (bad year 179, good year 242); soybean 62 (52, 70); winter wheat: "no county yield statistics here" (cmp) |
| 8 | 1:25 | **Why not oats?**: the "Why not others?" panel | "Nothing disappears silently. Oats are out because no buyer is confirmed nearby; alfalfa because there's no hay equipment and no livestock or hay buyer. If that changes, the farmer ticks it in My Field." | "9 of 12 fit your farm". Left out: Corn–Soybean–Oats, + hairy vetch, and the oats–alfalfa rotation (cmp `excluded_candidates`, `what_fits`) |
| 9 | 1:36 | **When bare soil meets wind**: season timeline summary line | "This is where NASA data changes the choice. Today the field is bare through six and a half of the windiest weeks; with the rye cover, none. The line is computed, not typed." | "Bare + windy overlap: 6.5 weeks now → 0 if you switch to Corn, corn, then soybean, with a cereal rye cover crop"; bare + heavy-rain weeks 2 → 0 (cmp timelines, NASA POWER `risk_weeks`) |
| 10 | 1:46 | **Water matters most?**: the tour moves "Save water" to the top | "The farmer puts water first and the options re-rank right away. Rye stays first, but the gap narrows, and a wheat rotation without a cover crop moves up because it uses less water." | Read off the screen (live). On 2026-11-14: current 53, cereal rye 65, corn, soybean, then winter wheat 63; ordering uncertain (top wins in 34% of weightings) (cmp-water) |
| 11 | 1:56 | **Replay the 2012 drought**: KPI row | "Here is 2012 replayed week by week, current rotation against the alternative. It's a model replay with bands, not a record of this farm." | Read off the screen (live). On 2026-11-14: season rain 224 mm, driest year on record (0th percentile); modelled erosion 15.3 → 3.7 t/ha; corn at 49% of a typical year in both (rp) |
| 12 | 2:06 | **Where your climate is heading**: the twin card | "By the 2040s this field's climate is projected to look like today's climate near Bellevue, Missouri, about 250 km away, and all six climate models agree. A place to learn from, not a planting order." | SSP2-4.5, 2041–2060: mean temperature 9.2 → 11.2 °C (models 10.4–12.2); hot days ≥ 35 °C 3.1 → 11.9. Analog near Bellevue MO, 250 km, 6 of 6 models (tw) |
| 13 | 2:20 | **Make it your plan**: Action plan, the checklist (Before committing · Before planting · In the field) | "The farmer turns the choice into a plan: a checklist to work through with their adviser, room for notes, and a printable plan with every number and its source. FarmSmart supports your judgment; it does not replace it." | Checklist items come from the chosen option's check-locally list plus general checks; "Download plan (PDF)" posts to `/api/fields/{id}/report.pdf` |

**Timing.** At machine speed (Next as soon as a step is ready) the tour takes about 70–85 s; the globe flights in steps 1–4 take most of it. At a reading pace (200 words a minute plus a few seconds to look) it runs about 2½ minutes. `qc/reports/demo_tour_timing.md` holds the latest measured run.

**If a judge asks "how do you know?"**, open **Sources & Methods → Satellite vs ground**. At Story County, NASA POWER against the Ames station gives:
- daily high: r 0.929
- monthly rain: r 0.917
- daily rain: r 0.325

Daily storms are local, which is why weather is labelled regional (qc).

**Things to try live after the tour** (all work without the tour):
- Search "Ames, Iowa", click the globe once to reach Farm level, click a field, then **Analyze this field →**.
- Type coordinates such as `42.1112, -93.4693`: the globe flies to Farm level and shows that field's card; nothing is analysed until you press Analyze.
- **Draw my own boundary** at County or Farm level.
- In Field Studio, **My priorities** is the first block in My Field; **Change priorities** (next to the options) jumps to it.
- Before a live demo, run `conda run -n fieldshift python scripts/prewarm_naip.py --pilots iowa_story` so the field imagery is sharp at once.

**Fallback.** If a live service is slow, the pilot results still load from `data/precomputed/`. Say so plainly. Do not skip the reminder line.
