# FarmSmart: Planning Digest (reference sources, condensed)

Compiled 2026-11-14 from the reference PDFs at the top level of `<planning-inputs folder>`. This is a digest only. Nothing here was invented. Where a source gives no number, the digest says so.

**Flags** compare each item with the current build brief (CesiumJS globe + MapLibre fallback, React/TS/Vite, FastAPI, DuckDB, models M1–M12, six strategy families, pilots Iowa / Kansas / California / Saskatchewan / Punjab / Mato Grosso):
- **[CONFIRMS]**: the source agrees with the brief.
- **[ADD]**: the source adds something the brief does not specify.
- **[CONFLICT]**: the source disagrees with the brief, or two sources disagree with each other.

**Terminology:** "SI" replaces "AI" throughout. One source uses "AI" in competition-category names such as "AI for social impact". Those are quoted as-is only where they are official names.

## 0. Sources read

| Tag | File | Pages / status |
|---|---|---|
| **BP** | `claude Field_Shift_Comprehensive_Build_Plan.pdf` | 56 PDF pages (55 numbered). Read in full via text extraction; tables cross-checked in raw mode. Images/wireframes not rendered (no pdftoppm), text inside them was extracted. |
| **RP** | `Field Shift - Product and Agent Team Plan - Revised.pdf` (Revision 2, Nov 13 2026) | 36 pages, read in full. Hyperlinks extracted. |
| **G1** | `grok task1-dataset-ranking.pdf` | 3 pages, read in full. Hyperlinks extracted. |
| **G2** | `grok task2-crop-rotation-studies.pdf` | 7 pages, 41 studies, read in full. |
| **G3** | `grok task3-plan-improvement-ideas.pdf` | 6 pages, a critique of BP, read in full. |
| **GPT** | `gpt NASA_Space_Apps_2026_Final_7_Shortlist_Playbook.pdf` | 8 pages, read in full. Only the FarmSmart and general items are kept here. |
| **F7** | `claude NASA_Space_Apps_2026_Final7_Report.pdf` | Skimmed. Only the cover page (rules, judging) and the FarmSmart page are kept. |

**Not read** (not on the assignment list, so not opened): `grok field-shift-webapp-screens.pdf`, `Field Shift - Key Information.md`, `Field Shift Adapting Farms with NASA Data.txt`, both `.pptx` concept decks, `2025 winner sample.txt`, `notes from 2026 field shift youtube video.txt`, and all subfolders.

---

## 1. Competition facts, rules and judging

### 1.1 Event facts
- **Event dates:** NASA Space Apps 2026 runs Sat **Nov 14 – Sun Nov 15, 2026** (BP, F7). Theme: "The Next Frontier" (F7); Team size: 1–6 people (F7); Universal (virtual) track (F7); Judging begins Nov 16 (F7); 10 global awards (F7).
- **Demo format:** either a video of **≤30 s with English subtitles** or a deck of **≤7 slides**, hosted externally (BP). You also need a **public project link** (site or repo) that **requires no login**; F7 lists the expected submission as: "submit a live URL, public repo, video and slides".
- **SI use is allowed but must be disclosed.** SI-generated images and video need a **visible watermark** (BP); F7: "Disclose AI use; no copyrighted music, images or text; **no NASA insignia**."; BP: no NASA logos or branding. Mission names in text chips are fine; mission insignia are not.
- **No building before kickoff.** F7: "No building before kickoff: research, team and data checks only until Nov 14." BP says to confirm the pre-event-work rules in the 2026 Submission and Judging guides, released Nov 13; RP: "rules governing pre-existing work" must be checked on the selected event page.
- **Minors:** no recognizable under-18 names, faces or voices in submissions (F7).
- **English text** in the submission. Data citations and licences must be included (BP QC layer 8).
- **Planned submit time:** about **22:30 Sunday**, leaving a 90-minute buffer. Code freeze at **H35** (BP §10).
- **Official URLs** (RP links): https://www.spaceappschallenge.org/2026/; https://www.spaceappschallenge.org/2026/challenges/farmsmart-adapting-farms-with-nasa-data/; https://www.spaceappschallenge.org/2026/local-events/ajmer/ (the judging-criteria source); spaceappschallenge.org/resources/project-submission-guide (BP); spaceappschallenge.org/resources/participant-faqs (BP).

### 1.2 Judging criteria
There are five criteria: **Impact, Creativity, Validity, Relevance, Presentation** (BP, RP, F7).
- F7 says the criteria have **equal weight**.
- RP says "No numerical judging weights are assumed", citing the 2026 Ajmer event page.

F7 one-liners for each criterion:
- **Impact:** real problem?
- **Creativity:** fresh idea?
- **Validity:** science right?
- **Relevance:** on-brief + NASA data?
- **Presentation:** clear demo?

F7 adds: "Visuals win Presentation and Creativity; the fact registry, go/no-go checks and acceptance tests protect Validity."

### 1.3 What wins, by source
- **BP ("How each judging criterion is won"):**
  - **Impact:** US-first depth with a global path; Low-tech farmer UX; A printable "talk to your agronomist" report; Email alerts; A multilingual global stage; Free open data; *Demo proof:* one farmer journey end to end, then the same tool on a field in Punjab or Mato Grosso.
  - **Creativity:** Climate Twins; The Season Wheel bare-soil gap finder; Field Twin drought replay; Auto-detected rotation history; A soil "x-ray"; *Demo proof:* the analog arc and the drought replay.
  - **Validity:** Spatial and temporal hold-outs; Calibrated probabilities and conformal intervals; Satellite-versus-ground checks; A rules-based agronomy sanity layer; Model cards and a red-team agent; *Demo proof:* a confidence meter and a "how we know" panel with validation scores.
  - **Relevance:** Every objective maps to a feature; "All 26 listed sources used"; Eight NASA mission datasets drive the core; *Demo proof:* a "Data used" ribbon with mission chips.
  - **Presentation:** A 30-second storyboard and a 7-slide backup; A consistent visual language (wheel, petals, dot-plots); A video cut from real app screens.
- **RP ("Judging alignment"):** "Impact is a farmer completing a useful comparison."; "Creativity is the visible connection between wind, exposed soil, and rotation timing."; "Validity comes from scale-aware calculations and honest uncertainty."; "Relevance comes from multi-season rotation decisions."; "Presentation comes from one coherent field story with a reproducible evidence trail."; Core goal: "Make the NASA data visibly change a farmer decision."
- **F7 (FarmSmart page):**
  - Win score **7.6/10**, Rank #5 of 7 on the user's shortlist, verdict **GO**.
  - Target awards: **Galactic Impact · Art & Technology**.
  - The challenge carries an **Arts & Multimedia** tag. "A 2025 farm-data challenge won the Art & Technology award."
  - F7 called FarmSmart the "Best social-impact pick".
  - **Signature feature: "What changes the choice?"**
    - Switch a priority (water ↔ diversity) and the recommendation changes, with the exact reason shown.
    - Judge-demo moment: "Farmer prioritises low water → switches to diversity → the top rotation changes → SI explains why, out loud."
  - **Acceptance test:** "Each recommendation shows inputs and rules; a priority change gives a traceable result."
  - **Go/no-go at kickoff:** "Compatible climate, soil and crop data found for one area; no crop evidence = engine not ready."
  - **Biggest risk:** "agronomy model lacks credibility; integrating 4 data types in 48 hours is a stretch." Mitigation: rule-based, sourced scoring for one region; **Missing data lowers confidence instead of counting as zero.**; **No yield or profit promises.**
  - **Three ideas:**
    - A = "Rotation Compass": pick a field and compare 3 rotations in a scored table where every score shows its inputs and rule.
    - B = "Farm Future Simulator": change one priority or a labelled drier-season scenario.
    - C = "Living Field": a 3D field tile grows crops season by season, soil darkens as organic matter builds, and drought cracks appear in risky plans.
    - "Play: ship Idea A plus the signature feature, then layer Idea C's visuals on top."
  - **Suggested data:** NASA POWER, SMAP, GPM IMERG; ISRIC SoilGrids, with farmer soil-test overrides; FAO crop-water guidance; MODIS/HLS and OpenET.
  - **Suggested stack:** Python (precomputed JSON or FastAPI), React + MapLibre, Three.js field.
  - **Team skills:** GIS/data developer, agriculture domain expert, UX designer, front-end developer.
- **GPT (FarmSmart page):**
  - Interest 6.5 · Data Medium · Visual High.
  - "Clearest direct human-use story, but keep the model simple."
  - **Mitigation:** one pilot region, **four crops**, and a transparent rule-based scoring system.
  - **MVP by H24:** one region, three rotations and a simple scorecard.
  - **Stretch by H40:** scenario simulator, multilingual explanations and 3D field visuals.
  - **Validity check:** "Tie each score to a visible rule or source rather than a black-box recommendation."
  - **Demo idea "Living Field":** two side-by-side fields evolve over four seasons, one thrives and one struggles.
- **F7 48-hour battle plan (generic):** H0–2: go/no-go check; H2–8: data pull, fact registry and agent briefs; H8–24: MVP (Idea A) plus the signature feature, then **H24 freeze with a live URL**; H24–40: visual layer, acceptance test, playtest; H40–45: video and slides; H45–48: submit, plus buffer.

### 1.4 Flags on judging strategy
- **[CONFLICT]** BP scores Relevance on "26 of 26 sources used".
  - G3 (idea 4, HIGH) says to stop: the brief says teams *may* explore the sources, not that they must use all of them.
  - Shallow wiring invites a Validity hit (GRACE ~300 km is not field evidence, GEDI is a weak fit over short crops).
  - G3 says to score Relevance on depth plus mission chips that are actually used.
- **[CONFLICT]** BP's Validity story (conformal intervals, M1 beats baselines at Gate G1, model cards for all models) versus G3 (idea 7).
  - G3: for the weekend, Validity should be:
    1. Transparent, documented scoring: crop-trait rules adjusted by this field's POWER, SMAP, IMERG and SSURGO indicators.
    2. A confidence badge tied to data coverage and native resolution.
    3. A visible "what the app must never claim" guardrail list.
    4. A "how we know / what we don't know" panel per card.
  - Formal cross-validation, conformal prediction and model cards go to a post-event roadmap.
  - RP agrees: "Label any model awaiting calibration as planned."
- **[ADD]** Signature judge moment from F7, GPT, G3 and RP: **re-rank the same three rotations when the top priority changes**, and name the trade-off. BP's alternative shot 4 is the same idea; G3 idea 8 asks for a two-petal graphic: "conserve water" versus "forage for livestock".
- **[ADD]** Show "support, does not replace" farmer judgment **on every card, report and the cover**, not only deep in the docs (G3 idea 8, BP §6.5, RP).
  - G3: soften "award-winning" wording.

---

## 2. Product decisions and concepts

### 2.1 BP: five concepts and the recommended hybrid
| # | Concept | Paradigm | Hero screen | 30-s "wow" | BP score /35 |
|---|---|---|---|---|---|
| 1 | ORBIT (Earth Command Globe) | place-first | 3D globe, outlined states/provinces, capitals + top cities, layer time machine, Field Dossier drawer | fly orbit → Iowa field, field outlines itself, 25-yr pulse plays | 28 (I4 C4 V4 R5 P5 ease3 safety3) |
| 2 | SEASON WHEEL | time-first | circular year-rings; bare-soil gaps hatched red; NASA risk windows on rim | red bare gap meets heavy-rain rim → drag in rye → erosion petal shrinks | 32 (5,4,4,5,4,5,5) |
| 3 | NEXT MOVE | decision tree | CDL history → branching futures + Pareto chart | flip to "Dry 2040s", branches re-sort | 30 (4,5,5,5,4,3,4) |
| 4 | FIELD TWIN | simulation | two 3D twins + sliders + 10-yr time-lapse | replay 2012 drought, current vs diversified | 27 (4,5,4,4,5,3,2) |
| 5 | COPILOT + CLIMATE TWINS | conversation | chat + map canvas + analog arcs | spoken question → arc to 2040s analog | 31 (5,5,3,5,5,5,3) |
| H | **Hybrid: 1 shell + 2 Simple + 3 Expert + Twins finale** | | | | **33** (5,5,5,5,5,5,3) |

- **BP recommendation [CONFIRMS globe-first brief]:** Use ORBIT as the shell; SEASON WHEEL is the default "Simple mode"; NEXT MOVE is the "Expert mode" tab; The demo finishes on Climate Twins.
- **BP safety rules:**
  1. The Season Wheel path must work end to end by **H12** even if the globe slips.
  2. Field Twin and the conversational Copilot are stretch goals with no demo dependency.
  3. The globe has a 2D MapLibre fallback behind one flag.
- **Small team or weak GPUs:** lead with SEASON WHEEL plus a lighter 2.5D map.
- **Common to all five concepts:** Search by lat/lon, state or city; Outlined states/provinces with capitals and the top 5 cities; Draw or click a field to get a full Area Report; The existing rotation plus ≥2 alternatives on strategy cards (why, evidence, benefits, gaps, risks); Evidence chips and confidence on every output; Simple and Expert modes; Email alerts; US first, then global.

### 2.2 RP: alternative framing (Revision 2)
- **[CONFLICT/ADD]** RP's five concepts: 1 Field Explorer, 2 Rotation Studio, 3 Farm Guide, 4 Resilience Planner, 5 Regional Crop Atlas.
- **Recommended combination:** **Field Explorer** is the main experience; **Rotation Studio** is the comparison screen; **Farm Guide** guided questions are the onboarding; **Resilience Planner** supplies the competition story; **Regional Crop Atlas** supplies the "What is grown here?" panel.
- **The distinctive scientific hook is wind plus soil cover:**
  - "A wind-and-soil-cover story gives the submission a memorable scientific focus."
  - Default: "Field Explorer + Rotation Studio with a wind/soil-cover demonstration and **economics in the expanded version**."
- **[CONFLICT]** RP places **Climate Twins in the "Advanced roadmap"**, scheduled after the US decision workflow and supported outcome models.
  - BP uses Climate Twins as the demo finale.
- **Ideas RP adopted from BP:** Suggested field boundaries (core, where data supports it); Season Wheel + timeline (core prototype); Six strategy families (core decision engine); Useful uncertainty prompts (core); Next Move comparisons (expanded US); Mapped soil profile (expanded US); Climate Twins (advanced roadmap).
- **RP concept ratings** (editorial):

| Concept | Farmer ease | Visual demo | Planning depth | Effort |
|---|---|---|---|---|
| Field Explorer | High with guided steps | Very high | High | Medium-high |
| Rotation Studio | High for experienced users | High | Very high | Medium-high |
| Farm Guide | Very high | Medium | High | Medium |
| Resilience Planner | Medium-high | Very high | Very high | High |
| Regional Crop Atlas | High for advisors | High | High | Medium-high |

- **RP "Delivery decision":** "Demonstrate one complete farmer journey before expanding model count or geography."
  - "Model count and source count are not completion criteria; an intelligible, supported farmer decision is."
- **RP time split for the hackathon:** ~15% contracts plus one real field; 40% the complete data/interface/rotation flow; 20% NASA risk evidence; 25% review, explanations, export, deployment and submission.
- **RP fallback if outcome labels are insufficient:** "the submission can still deliver a complete evidence-based rotation comparison with transparent constraints and historical risk calculations."

### 2.3 G3: scope critique of BP (HIGH priority)
- **[CONFLICT with brief breadth]** G3 idea 1: **make Stage 1 the only weekend target.**
  - **One demo farm:** the Story County, Iowa corn–soy field.
  - **Core data:** POWER, SMAP L4, IMERG, SRTM, SSURGO, CDL, plus Landsat/HLS NDVI if the Earth Engine path is ready.
  - **Three rotations** including the existing one.
  - Season Wheel (or a 2.5D map) as the farmer path.
  - Cards with the five required sections and a visible disclaimer.
  - **Move to "After the event":** the Cesium globe, Climate Twins, alerts, conformal models, multilingual UI and non-US pilots.
- **G3 on BP's own schedule:** BP Stage 2 schedules every listed dataset plus Next Move, split-sky compare and alerts between Sat 21:00 and Sun 11:00. G3 calls the result "a still-impossible core".
- **G3 idea 9:** staff for 3–5 people, not 19 agents. Example RACI: **A:** story and scoring (POWER indicators, three-rotation score table, card copy, disclaimer, video); **B:** NASA layers (EE or earthaccess for SMAP, IMERG and HLS NDVI on the Iowa field; evidence chips); **C:** soils, CDL and agronomy (SSURGO extract, CDL history, crop-trait notes, check-locally lists); **D:** front end (Season Wheel or a simple map UI plus the comparison view); Friday setup shrinks to the accounts actually called: **Earthdata Login, Earth Engine, a public repo**.
- **G3 idea 5:**
  - Add a two-page "Saturday operating brief" covering: the chosen concept (locked), the single demo field, the three rotations, the Must datasets and who pulls them, an hour-by-hour plan, the 30-s storyboard, and the submission checklist.
  - Stop presenting five equal concepts.
- **G3 idea 2:** replace BP's arrow-only Iowa table with **three fully filled strategy cards using real numbers**.
  - Includes a live POWER test for central Iowa: **2025 mean temperature 10.3 °C, 914 mm rain**.
  - Each card needs:
    - A "why" tied to a real field condition (bare Nov–Apr, slope, IMERG heavy-rain months, SMAP spring moisture, SSURGO K).
    - Evidence with figures (POWER 2025, CDL 2008–2025).
    - Benefits as ranges.
    - An information-gaps list (no on-farm yield history, insurance/termination rules, local hay/oat buyers, tile drainage).
    - A check-locally list, a confidence badge, and the support-not-replace line.
- **G3 idea 10:** define SI, NDVI, ET and "effective resolution" at first use, not in a late glossary. Separate "illustrative layout" from "figures from the Iowa worked example".
- **G3 idea 6:** BP has a broken font (Type 3 glyphs drop the letter "i", e.g. "Web Sol Survey"). This applies to the BP PDF itself, not the app.

### 2.4 Answers every field result must give (RP)
1. What is grown here?
2. What can fit this field?
3. Which three rotations best fit the farmer's priorities?
4. What changes under dry, windy, hot or wet conditions?
5. What evidence and assumptions caused the ordering?
6. What information would make the decision more reliable?

BP's version: "What is happening on my land? What could come next? What is the trade-off?"

### 2.5 LITE versus PRO (BP §4.4)
| Dimension | LITE (Stage 1) | PRO (Stages 2–3) |
|---|---|---|
| Users | farmers, first-time | Expert mode, agronomists, extension, planners |
| Map | globe or 2.5D, search, boundaries, cities, point click | full 3D, photoreal, auto-outline, uploads, split-sky, time machine, drape, soil x-ray |
| Data | **core six: POWER, SMAP L4, IMERG, SRTM, SSURGO, CDL/NASS** (US); POWER, SMAP, IMERG, SRTM, SoilGrids, CROPGRIDS (global) | all 26 + §5.2 additions |
| SI | crop envelope + GBM suitability; rules-based strategy generator; simple uncertainty badge | full M1–M11 |
| Rotations | existing + 2 alternatives on Season Wheels with petals | existing + up to 5, futures tree, 45-weather-year stress test, sliders, Field Twin |
| Profit | simple budget with regional price/cost defaults | price/cost distributions, Monte-Carlo, CVaR, frontier |
| Alerts | weekly email digest | event-driven alerts; optional SMS |
| Reach | US pilots; CONUS at county or H3 level | CONUS field level, then global |

---

## 3. Screen specifications

### 3.1 Globe home / region / field (BP ORBIT, §3; RP p.10–11) [CONFIRMS Cesium + MapLibre]
- **Screen flow:**
  1. Globe home: search, outlines, capitals.
  2. Region view: layers and the time machine.
  3. Field view: auto-outline, drape, x-ray.
  4. Compare: strategy cards and confidence.
  5. Report & alerts: PDF hand-off and subscribe.
- **Layout:**
  - Left: layer stack. BP's demo stack: Soil moisture (SMAP); Rain & extremes (IMERG); Heat & water stress (ECOSTRESS); Greenness (Landsat/HLS); Groundwater trend (GRACE-FO); Slope & erosion (SRTM + RUSLE); Crop history (CDL); Field outlines (Fields of The World); Climate 2040s (NEX-GDDP-CMIP6).
  - Center: 3D terrain.
  - Bottom: **Layer Time Machine**, 2001→2026 plus a "2040s" frame.
  - Right: **Field Dossier** with six tabs: Conditions · Crops that fit · Rotations · Risks · Profit · Alerts.
  - Top bar: Simple/Expert and 3D/2D toggles.
- **Search box:** Parses decimal coordinates ("41.99, -93.62"); Parses DMS ("41°59′N 93°37′W"); Parses US state names and abbreviations, "City, ST", "Province, Country" and addresses; Geocoding: OSM **Nominatim** (respect its rate limits) or **Photon**, with a commercial fallback.
- **Cascading pickers:** Country → State/Province → County/District → City. Each pick flies to the unit's bounding box and outlines it.
- **Coordinate panel:** lat, lon and altitude fields with "Go". A live cursor read-out. A deep link `?lat=&lon=&alt=&layers=`.
- **Camera controls:** smooth flyTo, reset north, tilt, 2D/3D toggle, "My fields" bookmarks.
- **RP additions:**
  - Show the interpreted location before analysis runs.
  - Offer DMS as an "advanced input".
  - Apply range checks.
  - Pin the chosen field while layers change.
  - **Layer inspection click:** returns value, units, source, date, resolution, valid area fraction and quality flag.
  - Display imagery capture dates and the terrain source.
- **Field selection:**
  - Click-to-field snaps to **Fields of The World** polygons (global 10 m, 2024–2025, CC BY 4.0, PMTiles, with a confidence layer). In the US, CDL-consistent fields are the fallback.
  - Draw a polygon, rectangle or circle, with vertex editing.
  - Pick an admin unit, which switches to "regional mode".
  - Upload GeoJSON, KML or zipped shapefile.
  - **Areas up to ~50 km² run field mode; larger areas switch to regional mode** (BP).
- **RP field-outline rules:** Draw, undo, edit vertices, import, rename, confirm; Check self-intersections and coordinate order; Compute **geodesic area**; Keep the original geometry; Store: source edition, original geometry, farmer edits, confirmation date and final geometry version; Do not infer ownership or access permission from a mapped boundary; Fields of the World polygons are "inferred agricultural boundaries, not cadastral" records.
- **Area Report** ("gather full information", roughly 5–30 s):
  1. Polygon → H3 cells → precomputed cache check.
  2. Zonal stats: Earth Engine `reduceRegion` for heavy 30 m rasters; exactextract/xarray for NASA grids; area weighting for coarse grids.
  3. Sections: Climate · This season · Soil · Terrain · Water · Crop history · Regional crop portfolio · Crops that fit · Rotation strategies · Risks · Markets · Confidence.
  4. The report is cached with a URL and can be exported to PDF or subscribed to alerts.
- **RP default screen:** Narrow search/field panel on the left, map in the center, results drawer on the right; One primary button: "Compare rotations"; On mobile, two tabs (map, comparison), or three tabs (map, plan, evidence); **Open the three cards only after the farm profile is confirmed.**; Start on a dated natural-color image; Keep a visible return-to-field control.
- **RP farmer workflow:**
  1. **Locate**
  2. **Outline**
  3. **Confirm** recent crops, planting dates, irrigation, residue/tillage and soil tests. Inferred values show their sources.
  4. **Set priorities**
  5. **Compare**
  6. **Act & revisit**

### 3.2 Signature globe features (BP ORBIT)
- **Split-sky compare:** a swipe bar between two datasets. Pairs: IMERG vs CoCoRaHS, SMAP vs NLDAS, ECOSTRESS ET vs OpenET. A "Why do these differ?" pop-over explains each pair.
- **Vulnerability drape:** Erosion hotspots: RUSLE from SRTM slope, SSURGO K and IMERG intensity; Water-stress hotspots: ECOSTRESS ESI; Frost pockets: terrain plus POWER/PRISM.
- **Soil x-ray:** a SSURGO horizon cutaway showing AWC and OM by depth.
  - RP "Mapped soil profile" rules: Preserve component proportions; Distinguish map-unit estimates from lab measurements; Let the user choose the dominant component or a range across components; Overlay the crop rooting-depth range; Treat a farmer soil test as a separate dated observation, with sampling depth.
- **Field pulse:** a 25-year sparkline ribbon of NDVI, soil-moisture anomaly and heat days per season since 2001.
- **Wind & cover:** a monthly wind rose that highlights windy hours overlapping bare-soil weeks.

### 3.3 Season Wheel (BP concept 2; RP "Seasonal planning")
- **Wizard:** four guided steps, under 2 minutes.
  1. **Find my farm.** Pre-fills county, soil and recent crops from CDL, then asks: "we think you grew corn, then soybeans; is that right?"
  2. **My current rotation.** Drag crop chips onto the year ring; planting and harvest months default to USDA crop calendars.
  3. **What matters most.** Drag-to-rank priority cards: Save water · Build soil · Stop erosion · Extra income · Feed livestock · Less work · Break pest cycles.
  4. **My limits:**
     - Irrigation: none or an allocation.
     - Equipment: no-till drill, baler, grain only.
     - Nearby markets.
     - Livestock.
     - Organic.
     - Risk tolerance.
- **Result:** your wheel next to 3–4 alternative wheels. The rotation that best matches priorities is ringed in green.
- **Wheel encoding:**
  - Outer ring = year 1, inner ring = year 2.
  - Arcs = crops.
  - **Red hatching = bare soil.**
  - Rim icons = NASA risk windows: Frost: POWER/PRISM; Heavy rain: IMERG; Heat: ECOSTRESS/POWER; Dry spell: SMAP.
  - Example readout: "7 bare months per year · heaviest rain May–Jun".
- **Bare-soil gap finder:** bare periods come from Landsat/HLS NDVI phenology. When bare months overlap the heaviest IMERG months on sloped ground, the gap pulses red.
- **Swap-a-crop:** drag a cover crop into a gap and the petals, water bucket and confidence update instantly (M6 surrogate).
- **Alternatives panel:** each alternative shows "match X% of priorities" and a confidence level.
  - BP's illustrative examples: B "+ cereal rye cover", C "+ oats & red clover", D "+ 3-yr alfalfa".
- **Mobile:** works on a phone in a truck, with a low-bandwidth mode, large tap targets and an offline-cached last report.
- **[ADD] RP rules for the wheel:**
  - Offer a linear timeline and the wheel as **two linked views of one plan**.
  - Edit with buttons and date fields as alternatives to dragging; **recompute only after the edit is confirmed**.
  - **Separate** crop occupancy, living vegetation, residue cover, confirmed bare soil and unknown surface. "A gap between cash crops must not automatically become a bare-soil claim."; "Vegetation greenness alone does not identify bare soil."
  - Risk bands are separated by time basis: historical exposure, issued forecast, projected climate.
  - Keep the timeline as an equally complete accessible view.
- **BP design caution:** wheels need a colorblind-safe palette and text labels.

### 3.4 Next Move (BP concept 3; RP p.24)
- **History:** CDL 2016–2025 crop tiles (BP says 10+ years available; CDL 2008–2025 in the US). Includes "Looks right / edit".
- **Branches:** Bar length = "% of fields here" that usually follow with that crop (M3 Markov); Badges show expected effect on water, soil, profit and risk.
- **Pinning:** up to 4 futures can be pinned. The existing rotation is always pinned.
- **Trade-off view:** Pareto chart, e.g. profit vs soil-health score, with water as dot size; Uncertainty ellipses; Regret meter; P10 yield and CVaR profit.
- **Scenario switch:** Normal · Dry · Hot · Wet · 2040s (SSP2-4.5).
- **Stress-test:** replays every weather year **1981–2025 (45 years)** through each rotation.
- **"Usual next" vs "smart next":** M3 is shown beside the M9 optimizer result.
- **Pest-cycle breaker view:** flags consecutive crops that share hosts.
- **RP rules:**
  - Label the transition-model output as **observed practice**. Historical popularity and recommended action are separate fields.
  - Historical replay: "modeled scenario outcomes, not observed yields of unplanted alternatives". Replay does not assign probabilities to future seasons.
  - Keep temperature, rain and wind relationships within each replay. Show deliberately altered experiments separately.
  - The "Scenario shortfall" (regret) view compares each strategy with the best feasible one under a declared common utility.

### 3.5 Field Twin / Drought Replay (BP concept 4) [CONFIRMS Drought Replay]
- **Layout:** two 3D twins side by side (current vs alternative) on SRTM/3DEP terrain, with flow arrows and erosion hotspots.
- **Sliders:** Rainfall −30%…+30%; Temperature +0…+3 °C; Irrigation allocation: none to full; Crop prices: low to high; Cover-crop adoption: 0–100%.
- **Time-lapse:** 10-year play. Includes soil organic-matter gauge, erosion particles in bare months, a water bucket, and "Year 6 of 10 · dry-year scenario".
- **Replay events:** **2012 drought**, **2019 wet spring**, worst local year.
- **"Ghost of the past":** the field's actual NDVI for that year as a translucent overlay.
- **Rain-on-field:** real IMERG storms animate, with runoff along flow lines.
- **Outcome bands** (current vs twin): Soil organic matter; Erosion (t/ha/yr); Water use (mm); Dry-year yield (P10); Net return (P50).
- **Engine:** RUSLE + FAO-56 water balance + a simple soil-carbon model. **ML surrogates exported to ONNX and run in the browser** (Web Workers).
- **BP watch-out:** "risk of implying false precision": always show bands and "illustrative simulation" labels. BP rates it the most build effort.
- **Demo moment:** "the current-rotation twin browns early; the diversified twin holds."
- **[CONFLICT]** BP's scope-cut list puts **"Field Twin 3D time-lapse" first in line to cut**. The brief includes Drought Replay.
  - Suggested resolution, consistent with BP's own build order: keep the 2.5D replay and outcome bars.

### 3.6 Copilot + Climate Twins (BP concept 5; RP p.29) [CONFIRMS Climate Twins]
- **Copilot:** text or voice chat → geocode → "Is this your field?" → at most one clarifying question → engine tool calls → cards.
  - Example prompt: "300 acres of wheat near Garden City, Kansas; well is dropping."
  - Sample strategies: Wheat–sorghum–fallow; Flex fallow + grazed cover; Limited-irrigation corn → sorghum.
  - Sample check-locally list: well capacity and water rights; herbicide carry-over to sorghum; grazing lease/fencing; crop insurance rules; local elevator for sorghum.
  - Grounding: numbers only from tool calls, a number checker and refusal rules.
  - Languages: EN, ES, HI, PT, SW in the header.
- **Climate Twins (BP M7):** Mahalanobis nearest neighbours on standardized seasonal climate vectors; Data: NEX-GDDP-CMIP6, 2041–2060 deltas, SSP2-4.5 and SSP5-8.5; Searched over present-day cropland worldwide, run per climate model; Output: analog regions, model agreement ("x of 10"), and a "novel climate" flag when no close analog exists; "What grows there" comes from CDL/CROPGRIDS.
- **[ADD] RP Climate Twins method and limits:**
  - Pin model, scenario, version and the historical/future periods.
  - Data is ~0.25° and "modeled climate projections ... not field observations or short-term forecasts".
  - Align growing seasons and hemispheres.
  - Standardize using a stated reference population.
  - Use a **transparent nearest-neighbour distance**; consider regularized Mahalanobis only "when correlations and sample support justify it".
  - Return "no close analog" when a justified threshold is not met.
  - Screen local feasibility before an analog crop becomes a candidate: soils, daylight/latitude, irrigation, elevation, calendars, pests, infrastructure, markets.
  - Approved wording: "Under this scenario, the projected seasonal climate resembles these regions."
  - Confirm on historical analog examples before release.
  - Alternate data path: **NASA POWER future-climate subset** (https://power.larc.nasa.gov/docs/methodology/data/sources_future/).

### 3.7 Strategy Card (BP §7.2; RP p.21) [CONFIRMS ranked cards]
| Section | Content | Source models |
|---|---|---|
| Header | name, mini Season Wheel, "matches your priorities" bar, confidence badge | M9, M10 |
| Why suggested | 1–2 sentences linking field conditions to the family, e.g. "Your field is bare Nov–Apr, when 38% of heavy-rain days fall, on 4–6% slopes" | M4, M5, IMERG, SRTM |
| Evidence | data chips (missions + dates) plus research evidence (trial datasets, extension guides) | feature store, KB |
| Benefits | petals + ranges: erosion ↓, OM ↑, N need ↓, water use, pest break, income | M6, M8 |
| Trade-offs & risks | what gets worse (workload, transition-year cash dip, cover water use), downside years (P10) | M2, M8, M9 |
| Information gaps | local yield history, irrigation rights, pest pressure, termination rules | M10 |
| Check locally | list for the agronomist / extension visit | rules engine |
| Try it small | suggested on-farm strip trial (e.g. **10% of acres**) and what to measure | KB |

- **Comparison contract (BP + RP):**
  - The existing rotation is **always visible** even when it scores poorly.
  - Hard constraints apply first, and each excluded crop or sequence lists its reason.
  - Then the non-dominated set is computed, then the farmer-weighted score, with raw indicators shown beside any combined score.
  - Missing criteria lower "evidence completeness" and **may block an overall rank**.
  - If fewer than two feasible alternatives remain, name the binding constraint and offer user-controlled adjustments (e.g. "allow custom-hire seeding").
  - RP: numeric estimates "with units where supported", qualitative indicators otherwise. Record the reason each family was included or excluded.

### 3.8 Shared visual components (BP §4.2)
- **Season Wheel.**
- **Trade-off petals.** Seven petals: water use, soil carbon, erosion protection, N self-sufficiency, profit, risk (inverted), workload (inverted). Petal length = score; fill strength = confidence.
- **Quantile dot-plot.** 20 dots = 20 plausible seasons, read as "3 of 20 seasons lose money" or "in 15 of 20 seasons…".
- **Confidence meter.** High/Med/Low with reason chips: data gaps, model spread, outside training range, projection spread, satellite and gauge disagree, few local yield records, cloudy imagery.
- **Evidence chips.** Tapping one shows source, date, resolution and confidence. Example: "SMAP L4 · root zone · 9 km · 2015–2026 · 2-day lag".
- **Water bucket.** Water in (rain + irrigation) vs out (ET) vs storage (soil AWC).
- **Field pulse ribbon.**
- **Vulnerability zones.**
- **Timeline / scenario sliders.** Year scrubber 2001→2026→2040s.
- **Profit frontier.** Expected net return vs CVaR 5% downside; dot size = soil-health score. Illustrative points: A existing, B +rye, C oats/clover, D alfalfa, E sorghum, F continuous corn.

### 3.9 UX principles and inputs (BP §4.1, §4.3; RP p.7)
- **BP's ten design principles:**
  1. Place first.
  2. Pictures before numbers.
  3. Plain words at grade-8 level, with glossary pop-overs.
  4. Every claim has an evidence chip.
  5. Uncertainty is always shown, with hatched map areas where data is thin.
  6. Priorities steer everything.
  7. Limits are respected.
  8. Simple ↔ Expert.
  9. "Check locally" flags with a farmer icon.
  10. Works in the field: phone-first, low-bandwidth 2D, metric/imperial and language toggles.
- **Also built in:** Region compare: why two nearby regions differ; "Changes since your last visit."; **Distinct data states:** loading / partial / no observation / unsupported crop / stale; A table alternative for every map and chart; Reduced motion; Keyboard navigation; **WCAG 2.2 AA** contrast; Colorblind simulation.
- **RP typography and units:** use "a readable sans-serif typeface such as **Inter**". Show acres and hectares.
- **Priorities** (drag-to-rank, or sliders in Expert): Conserve water; Build organic matter; Reduce erosion; Fix nitrogen; Supplemental income; Forage for livestock; Break pest/disease cycles; Less labour; Lower risk; Ranks become M9 weights, shown as a bar.
- **Constraints** (hard filters plus soft penalties): Water: rainfed, limited allocation (in or mm per season), or full irrigation; Equipment: no-till drill, baler/forage harvester, grain only, custom hire; Markets: elevator, ethanol, crusher, feedlot/dairy, local/direct, specialty contract; Operation: livestock, organic, insurance requirements, labour; Rotation length **2–6 years** and refused crops.
- **[ADD] RP "Useful uncertainty prompts":** ask first for the input most likely to reverse the decision, then recompute after it is supplied.

| Gap | Helpful next input | How the result changes |
|---|---|---|
| Irrigation status unknown | confirm rainfed/irrigated and usable water supply | re-run feasibility and water balance; expose water assumptions |
| Crop or cover history uncertain | confirm sequence, residue and termination dates | update family-break rules, exposure and baseline |
| Soil constraint could change the choice | soil test with depth/date, or inspect mapped component | update the assumption; show whether rankings change |
| Outcome model lacks local support | local outcome records or matched trials | check comparability before recalibration; keep sourced qualitative comparisons meanwhile |

- RP: "Do not promise that supplying one measurement will automatically turn low confidence into high confidence."
  - **[CONFLICT]** BP's example: "A soil test or 3 years of yield records would raise confidence from Medium to High."

---

## 4. Data sources: endpoints, product IDs, variables, access gotchas

### 4.1 Priority tiers
- **BP LITE "core six" (US):** NASA POWER, SMAP L4, GPM IMERG, SRTM, SSURGO, CDL/NASS.
  - Global variant: POWER, SMAP, IMERG, SRTM, SoilGrids, CROPGRIDS.
- **G3 tiers [ADD]:** **Must (weekend):** POWER, SMAP L4, IMERG, Landsat/HLS (or MODIS for the long record), SRTM, SSURGO, CDL; **Should (if the path is pre-tested):** ECOSTRESS v003, OpenET, PRISM, NASS QuickStats; **Later / context:** GRACE/FO (basin trend only), GEDI, the rest.
- **RP phase tags** (Core / Expanded / Context): Core: IMERG, POWER, WSS, SSURGO, CDL, QuickStats, GAEZ, Sentinel-2/HLS, Landsat; Expanded: SMAP, SRTM, ECOSTRESS, NLDAS/GLDAS, GRACE, PRISM, CoCoRaHS, NWIS, OpenET, ERA5, NAIP, NLCD; Context: GEDI, LANDFIRE; Optional economics: AMS; **[CONFLICT]** RP puts SMAP in "Expanded"; BP and G3 put SMAP L4 in the core.
- **G1 usefulness ranking** for comparing rotations on one US field. Weights: relevance 40%, resolution vs field 25%, access ease 20%, coverage/record 15%.
  1. CDL
  2. SSURGO/STATSGO2
  3. NASA POWER
  4. Landsat/HLS
  5. SMAP
  6. GPM IMERG
  7. ECOSTRESS
  8. Web Soil Survey
  9. PRISM
  10. MODIS/VIIRS
  11. SRTM
  12. OpenET
  13. NASS QuickStats
  14. Sentinel-2
  15. NLDAS/GLDAS
  16. AMS Market News
  17. GRACE/GRACE-FO
  18. NAIP
  19. ERA5
  20. CoCoRaHS
  21. FAO GAEZ
  22. USGS NWIS
  23. NLCD
  24. Ag Data Commons
  25. LANDFIRE
  26. GEDI

### 4.2 NASA sources (specs per BP unless noted)
- **SMAP**
  - L3 at 36 km and enhanced 9 km, 2–3 day revisit.
  - **L4 at 9 km, 3-hourly, surface + root zone.** Freeze/thaw state.
  - Uses: SM climatology and percentile anomalies, dry-spell windows, infiltration proxy from post-rain dry-down, initial state for the seasonal outlook, downscaled to 1 km (M12).
  - Access: NSIDC https://nsidc.org/data/smap; `earthaccess` (github.com/earthaccess-dev/earthaccess); NSIDC tutorials (github.com/nsidc/NSIDC-Data-Tutorials).
  - Measures roughly the top ~5 cm; root zone from L4 combines satellite data with a land model.
  - **[ADD] G1:** SMAP/Sentinel-1 active-passive **SPL2SMAP_S** at 3 km / 1 km (https://nsidc.org/data/spl2smap_s) sharpens SMAP toward field scale.
  - Exact L4 collection short names are **not given in any source**; to be pinned at build.
- **GPM IMERG**
  - 0.1°, 30-min. Early (~4 h), Late (~14 h) and Final runs.
  - Uses: Rain reliability (CV); Seasonal totals; Extreme-rain frequency (95th/99th-percentile days); **RUSLE R-factor (erosivity).**; Heavy-rain alerts; Water-balance input.
  - Access: https://gpm.nasa.gov/data/imerg; github.com/nasa/gesdisc-tutorials.
  - **[CONFLICT]** BP and G1: record "back to 2000". G3: the **IMERG record starts January 1998** (TRMM era).
  - RP: "Select a consistent run/version for historical comparisons."
- **Landsat / HLS**
  - 30 m surface reflectance and thermal; 8-day with two satellites; archive since 1984.
  - HLS (with Sentinel-2) gives a 2–3 day revisit.
  - Uses: NDVI/EVI phenology (green-up, peak, senescence); **BSI** (bare soil) and **NDTI** (residue); Within-field stress; Crop-type features.
  - Access: Landsat Collection 2: https://www.usgs.gov/landsat-missions/landsat-collection-2; HLS: https://hls.gsfc.nasa.gov/; HLS guide: https://www.earthdata.nasa.gov/s3fs-public/2025-01/HLS_revised_Oct2024.pdf; Notebooks: github.com/nasa/HLS-Data-Resources; github.com/stac-utils/pystac-client.
  - QA: Landsat `QA_PIXEL` cloud/shadow mask (BP QC).
- **MODIS / VIIRS**
  - 250 m–1 km NDVI/EVI, LST, ET, land cover; daily to 16-day since 2000. VIIRS for continuity.
  - Product: **MOD13Q1 v061** (https://lpdaac.usgs.gov/products/mod13q1v061/).
  - Tools: AppEEARS (https://appeears.earthdatacloud.nasa.gov/; github.com/nasa/AppEEARS-Data-Resources) for point/polygon time series without raw files.
    - G1: "Fastest path for a hackathon."
  - GIBS WMTS is used for planet-scale imagery.
- **NASA POWER**
  - Daily agroclimatology since 1981: Tmax, Tmin, precipitation, humidity, wind, solar.
  - Grid about 0.5° × 0.625° (solar 1°). Free, no login.
  - Uses: GDD, frost dates and probabilities, heat-stress days, **reference ET (FAO-56 Penman–Monteith)**, radiation. "Primary global climate feed."
  - Endpoints: https://power.larc.nasa.gov/; Hourly API: https://power.larc.nasa.gov/docs/services/api/temporal/hourly/; Methodology: https://power.larc.nasa.gov/docs/methodology/.
  - Clients: github.com/ropensci/nasapower (R, mature); github.com/alekfal/pynasapower (Python, "quiet since 2024; raw API is easy").
  - POWER weather mostly derives from **MERRA-2**, so record the shared lineage when comparing (RP, G1).
- **SRTM / NASADEM**
  - 30 m. Coverage per BP: 60°N–56°S. Per RP: "Most land about 54°S–60°N" (minor conflict).
  - Uses: slope, aspect, **RUSLE LS**, topographic wetness index, flow accumulation, cold-air pooling (frost pockets), 3D terrain.
  - Products:
    - **SRTMGL1 v003**: https://lpdaac.usgs.gov/products/srtmgl1v003/
    - **NASADEM_HGT v001**: https://lpdaac.usgs.gov/products/nasadem_hgtv001/ (void-filled successor; G1 calls it a drop-in improvement)
  - Tools: github.com/bopen/elevation (clip DEM to bbox); tkrajina/srtm.py.
  - For US field zoom, use USGS 3DEP 10 m.
- **ECOSTRESS**
  - 70 m LST, ET, ESI, WUE; ISS orbit with varying overpass times.
  - **[CONFLICT]** BP says "Collection 2 (V1 retired)" and "CONUS and selected regions".
    - **G3** says the current tiled series is **Collection 3 / Version 003: `ECO_L3T_JET.003`, `ECO_L4T_ESI.003`**, with land coverage **~54°S–54°N**.
    - **RP** says "About 52°S–52°N, scene gaps" and links an Earthdata search for ECOSTRESS V002.
  - **G3 gotchas:**
    - AppEEARS still listed ET/ESI as **v002** on Nov 13 2026.
    - **Google Earth Engine has L2 LST but not L3 ET or L4 ESI.** "Planning a GEE pull of ECOSTRESS ET will stall."
    - Recommendation: **use earthaccess with v003**, with AppEEARS v002 as fallback.
  - Repos: github.com/nasa/ECOSTRESS-Data-Resources; github.com/ECOSTRESS-Collection-3/ECOv003-L3T-L4T-JET.
  - BP: mission operations approved through FY2026 (ecostress.jpl.nasa.gov).
- **GRACE / GRACE-FO**
  - Monthly TWS anomalies, mascons on a 0.5° grid, **effective resolution ~300 km**. 2002–2017 and 2018–present.
  - Uses: long-term storage trend gauge, weighting water-saving strategies, irrigation-reliability risk, quarterly alert.
  - Data: JPL mascons https://grace.jpl.nasa.gov/data/get-data/jpl_global_mascons/; https://podaac.jpl.nasa.gov/GRACE-FO; github.com/podaac/tutorials.
  - **Never present as field-level or well-level data.**
  - [ADD] G1: GRACE-based drought indicators from NDMC/UNL (https://nasagrace.unl.edu/), with weekly groundwater and root-zone percentiles.
- **GEDI**: L4A footprints ~25 m; L4B 1 km grid; within ±51.6°; Uses: landscape structure (shelterbelts, riparian buffers) and wind shelter; G1 ranks it last: "very little signal over row crops."; Repos: github.com/nasa/GEDI-Data-Resources; ornldaac/gedi_tutorials.
- **NLDAS / GLDAS**: NLDAS-2: 0.125° hourly CONUS since 1979. GLDAS: 0.25° 3-hourly global; Uses: long pre-SMAP records, drought onset, gap filling; URLs: https://ldas.gsfc.nasa.gov/nldas; https://ldas.gsfc.nasa.gov/gldas.
- **NEX-GDDP-CMIP6 [ADD in BP §5.2]**: Daily, 0.25°, 1950–2100, **35 models, 4 scenarios**, open licence, on AWS; Tech note: https://www.nccs.nasa.gov/sites/default/files/NEX-GDDP-CMIP6-v2-Tech_Note.pdf.

### 4.3 US ground, soil, land and market sources
- **CDL / CropScape**
  - 30 m annual crop map, CONUS, 2008–present (some states earlier).
  - **RP:** "Recent products include **10 m data from 2024** onward"; product covers "Lower 48 + Hawaii".
  - Uses: auto-detected rotation history, transition statistics, regional portfolio, fallow detection.
  - **G3 gotcha:** the CropScape web service expects **USGS Albers coordinates, not lat/lon**. For the weekend, **Earth Engine `USDA/NASS/CDL` is the safer default**.
  - G1: the CropScape viewer now redirects to a **CropSmart sign-in**.
  - URLs: Web service docs: https://nassgeodata.gmu.edu/CropScape/devhelp/cropscapews.html; https://www.nass.usda.gov/Research_and_Science/Cropland/SARS1a.php; Releases: https://www.nass.usda.gov/Research_and_Science/Cropland/Release/index.php.
  - R clients: cbw1243/CropScapeR, jlisic/cdlTools, ropensci/FedData.
  - CDL "cannot see within-year cover crops" (BP, RP). Cover detection needs an NDVI time series plus farmer confirmation.
- **[ADD] USDA Crop Sequence Boundaries (CSB)** (G2 #35)
  - Field boundaries with **8-year crop sequences** derived from CDL.
  - Contiguous US, **2008–2025**, open source on GitHub.
  - "Can auto-detect a field's existing rotation for our tool."
  - https://www.nass.usda.gov/Research_and_Science/Crop-Sequence-Boundaries/index.php
  - **This is a strong US alternative or complement to Fields of The World for click-to-field.** No other source mentions it.
- **SSURGO / STATSGO2 / Web Soil Survey**
  - Attributes: AWC, OM, texture, pH, drainage, hydrologic soil group, **K-factor**, restrictive layer.
  - Uses: RUSLE K, water-balance AWC, infiltration class, soil x-ray.
  - Access: Soil Data Access: https://sdmdataaccess.sc.egov.usda.gov/; https://www.nrcs.usda.gov/resources/data-and-reports/soil-survey-geographic-database-ssurgo; Web Soil Survey: https://websoilsurvey.nrcs.usda.gov/app/; Clients: ncss-tech/soilDB (R, official); ncss-tech/pysda (Python).
  - WSS has no API (G1).
  - **WSS and SSURGO are one evidence family** (BP, RP). WSS appears as a "verify my soil" link.
- **PRISM**: 800 m / 4 km daily and monthly; 1991–2020 normals; frost/freeze dates; Uses: bias-correcting POWER/IMERG, fine-scale GDD and frost; https://prism.oregonstate.edu/ (FAQ https://prism.oregonstate.edu/faq/); github.com/ropensci/prism.
- **NAIP:** 0.6–1 m RGB+NIR, every 2–3 years per state. https://naip-usdaonline.hub.arcgis.com/; Planetary Computer STAC.
- **NLCD (Annual):** 30 m since 1985; farmland mask. https://www.mrlc.gov/; https://www.usgs.gov/centers/eros/science/about-annual-nlcd.
- **CoCoRaHS:** daily volunteer rain gauges; IMERG validation; rain-confidence input. https://www.cocorahs.org/. "No maintained official client" (G1).
- **USGS NWIS:** groundwater, streamflow, quality. https://waterdata.usgs.gov/nwis; Python client github.com/DOI-USGS/dataretrieval-python.
- **USDA AMS Market News:** MyMarketNews API; cash, basis, hay, livestock. https://www.ams.usda.gov/market-news. R client cbw1243/usdamars (2021).
- **NASS QuickStats:** county/state yields, acreage, prices received, Census of Agriculture. https://quickstats.nass.usda.gov/; R client ropensci/rnassqs.
- **OpenET**
  - 30 m ET from an ensemble of six models.
  - **[CONFLICT on coverage]**
    - BP: "now all 48 contiguous states (expanded Dec 2025)", citing https://science.nasa.gov/blogs/science-news/2025/12/16/expanding-crucial-water-tracking/
    - G1: "coverage centered on the western U.S."
    - RP: "Lower 48, separate Brazil initiative".
  - https://etdata.org/; repos Open-ET/openet-ssebop and openet-core (need Earth Engine).
- **LANDFIRE:** 30 m vegetation and fuels; context only. https://landfire.gov/
- **USDA Ag Data Commons:** trials, phenology, management. https://data.nal.usda.gov/. No client.
- **[ADD] BP §5.2 extras:** USDA ERS Costs & Returns plus extension enterprise budgets (M8 costs); **USDA RMA Cause of Loss** (county × crop × cause: drought, excess moisture, frost, hail) as M5 labels; NRCS SCAN, USCRN and AmeriFlux for ground validation; USGS 3DEP 10 m; NOAA GHCN-hourly and NASA MERRA-2 for wind; USDA WEPS; Crop calendars; NWS API, Open-Meteo, ECMWF open data and CPC outlooks.

### 4.4 Global and partner sources
- **Sentinel-2:** 10–20 m with red-edge, ~5-day revisit. https://dataspace.copernicus.eu/data-collections/copernicus-sentinel-data/sentinel-2; sentinel-hub-py (needs an account); Planetary Computer STAC (free).
- **ERA5 / ERA5-Land**
  - Hourly. ERA5 at 0.25° since 1940 (G1: ~31 km). ERA5-Land at 0.1° since 1950.
  - Uses: soil temperature for planting windows, wind, gusts.
  - https://cds.climate.copernicus.eu/datasets/reanalysis-era5-single-levels; client github.com/ecmwf/cdsapi (free account).
- **FAO GAEZ:** global suitability and attainable yield. https://gaez.fao.org/; https://www.fao.org/gaez/en; github.com/un-fao/gaezv5. Used as the M1 prior.
- **SoilGrids (ISRIC):** 250 m. https://isric.org/explore/soilgrids
  - **[CONFLICT/gotcha] G3:** "ISRIC's **REST API v2.0 is temporarily paused**, with no restoration timeline." Working paths: **WCS/WMS, WebDAV/VRT mosaics, or the Earth Engine copy**. Do not plan a live REST call.
  - Alternative: HWSD v2.
- **Fields of The World:** https://source.coop/ftw/global-data; arxiv.org/abs/2605.11055; Microsoft research page https://www.microsoft.com/en-us/research/publication/the-first-global-agricultural-field-boundary-map-at-10m-resolution/
  - RP: "Nominal 10 m input resolution does not establish a cadastral boundary or equal performance everywhere."
- **CROPGRIDS:** 173 crops, 0.05°, ~2020 (Tang et al., 2024, Sci Data, doi.org/10.1038/s41597-024-03247-7). Also **MapSPAM** (10 km) and **ESA WorldCereal** (10 m maize/cereal, esa-worldcereal.org).
- **AlphaEarth Satellite Embeddings:** annual 10 m, 64-dim, 2017–2024. EE `GOOGLE_SATELLITE_EMBEDDING_V1_ANNUAL`.
- **Prithvi-EO-2.0:** NASA/IBM foundation model, 300M/600M parameters, pre-trained on HLS. arxiv.org/abs/2412.02732; Hugging Face ibm-nasa-geospatial.
- **FAOSTAT, World Bank Pink Sheet, FAO FPMA:** global prices and yields.
- **Canada:** AAFC Annual Crop Inventory and Statistics Canada. RP: "The 2025 edition covers all provinces and Yukon."; https://open.canada.ca/data/en/dataset/89073037-d2fc-4a6d-9ce9-f0b1bcb48745; https://www150.statcan.gc.ca/t1/tbl1/en/tv.action?pid=3210035901.
- **Boundaries and places:**
  - Natural Earth Admin-0/1 (public domain).
  - geoBoundaries ADM1/ADM2 (CC BY 4.0).
  - US Census TIGER/Line (https://www.census.gov/programs-surveys/geography/guidance/tiger-data-products-guide.html).
  - GeoNames cities15000 (CC BY 4.0; https://download.geonames.org/export/dump/).
  - **Avoid GADM** (non-commercial licence).
- **[ADD] G1 "other NASA sources worth considering":**
  - **NISAR** (launched 2025; planned soil moisture and crop-area every ~12 days): https://nisar.jpl.nasa.gov/
  - **OPERA DSWx/DIST** (surface water and disturbance; bare/disturbed-field detection): https://www.earthdata.nasa.gov/data/projects/opera
  - **Daymet** (1 km daily US since 1980): https://daymet.ornl.gov/
  - **FLDAS**: https://ldas.gsfc.nasa.gov/fldas
  - **NASA SPoRT-LIS** (~3 km daily US soil moisture used by the US Drought Monitor): https://www.drought.gov/data-maps-tools/nasa-sport-lis-soil-moisture-products
  - **Crop-CASMA** (SMAP + MODIS for US cropland): https://cloud.csiss.gmu.edu/CropCASMA/
  - **OCO-2 SIF** (`OCO2_L2_Lite_SIF_11r`): https://disc.gsfc.nasa.gov/datasets/OCO2_L2_Lite_SIF_11r/summary
  - **NASA Harvest**: https://nasaharvest.org/
  - **Worldview**: https://worldview.earthdata.nasa.gov/
  - **MERRA-2**: https://gmao.gsfc.nasa.gov/reanalysis/MERRA-2/
  - **CHIRPS** (non-NASA, 5 km, 1981–present; IMERG cross-check): https://www.chc.ucsb.edu/data/chirps
  - Black Marble (low relevance).
  - Python access path: earthaccess plus the **NASA Openscapes Earthdata Cloud Cookbook** (github.com/NASA-Openscapes/earthdata-cloud-cookbook).

### 4.5 Harmonization, time and honesty rules (BP §5.4–5.6; RP p.12)
- **Nested H3 grids:**
  - **Field polygon:** 30 m pixels → field mean, median and percentiles via exactextract. Within-field zones by k-means on terrain, soil and NDVI.
  - **H3 res 8 (≈0.74 km²):** downscaled SMAP 1 km, PRISM 800 m, GEDI L4B, MODIS.
  - **H3 res 6 (≈36 km²):** IMERG, NLDAS, ERA5-Land, NEX-GDDP, POWER, SMAP 9 km. Conservative area-weighted remap; coarse values carry an "effective resolution" tag.
  - **H3 res 4 (≈1,770 km²):** GRACE, global CROPGRIDS/SPAM. **Regional context only.**
  - M1 analysis units use **H3 res 7 (~5 km²)** over cropland.
- **Time:** Steps: daily → 10-day → monthly → crop-calendar season windows; Baselines: **1991–2020** (PRISM normals) and **2001–2025** (satellite era); Anomalies are percentiles or z-scores.
- **Feature store:** Zarr (gridded time series), COG (maps), GeoParquet keyed by `h3_index × date`.
  - Each feature carries metadata: source, native resolution, effective resolution, latency, QA mask applied, licence.
- **Honesty rule:** the UI never shows a coarse value as field truth. It shows "regional value (≈25 km)" and lowers confidence.
- **RP rules:** Fields sharing a coarse cell **retain that relationship in training**; Aggregate features to the county/crop/year support of the yield label before fitting; Keep observation, publication, retrieval and forecast-issue times; Missing earlier years stay unavailable rather than silently backfilled; Each time slider uses only the dates the source actually covers; A downscaled grid "does not by itself prove additional local accuracy".
- **Satellite vs ground fusion:** Quantile-map IMERG to PRISM and CoCoRaHS (US) or ERA5-Land (global); Check SMAP against SCAN/USCRN; check ECOSTRESS and OpenET against flux towers; Disagreement lowers confidence.
- **Coverage panel** for every location: imagery, weather, soil, crop history, agronomic rules, outcome models, forecasts and markets, each marked supported / partial / not available. Environmental analysis can launch worldwide before recommendations do; Alaska, Hawaii and the territories get an explicit coverage status.
- **Scientific guardrails** (what the app must never claim; BP §6.5, RP): Sharp imagery does not reveal field-scale soil moisture or wind; NDVI does not measure yield, residue mass or soil carbon; GRACE does not describe a specific well; "Common" reflects markets, infrastructure and policy as well as fit; Observational crop–yield patterns cannot prove the gain from switching a particular field; OM gains need management evidence and time.

### 4.6 Regional Crop Portfolio ("most common crops") (BP §5.3)
- **Table `regional_crop_portfolio`:** `region_id` (H3 | FIPS | ADM1/ADM2); `crop`; `area_ha`, `share_pct`, `rank`; `trend_10y` (% share per year); `yield_mean`, `yield_cv`; `price_ref`, `price_source`; `market_ok` (buyer within X km?); `source`, `vintage`, `confidence`.
- **Storage:** GeoParquet. Served as a treemap plus a "rising / falling" list.
- **US build:** CDL pixel counts per year aggregated to H3, county and state (2008–2025), joined with NASS acres and the Census of Agriculture.
- **Global build:** CROPGRIDS, SPAM, WorldCereal, FAOSTAT.
- **Three tabs:** **Common here** (portfolio) · **Fits here** (M1) · **Pays here** (M8). Disagreement is shown, e.g. "Fits well, but rarely grown: check market access."

---

## 5. SI model designs (M1–M12) [CONFIRMS M1–M12 naming]
BP defines twelve models. RP keeps the methods but adds cautions and simpler first versions.

| ID | Question | Method (BP) | Labels / features | Output |
|---|---|---|---|---|
| M1 Crop Suitability | which crops fit? | per-crop LightGBM + ECOCROP/GAEZ envelope prior (blend α), isotonic calibration; MaxEnt/PU for minor crops; monotone constraints | US: CDL presence; global: CROPGRIDS/SPAM/WorldCereal | probability, top-3 SHAP drivers, confidence |
| M2 Yield & Risk | expected yield, bad years | LightGBM quantile P10/P50/P90 or NGBoost; conformalized quantile regression; rotation-effect priors from trial data | detrended NASS county yields 2000–2025; GDD, heat days at flowering, rain, SMAP RZ anomaly, NDVI peak/integral, ESI, soil | quantiles → within-crop percentile |
| M3 Rotation Sequence | what usually comes next | 1st/2nd-order Markov per region from CDL pixel sequences; small GRU/Transformer (stretch); frequent-pattern mining of 2–4-yr rotations | CDL | next-crop probs; rotation type; validate top-1/top-3 on held-out years |
| M4 Crop-Type & Bare-Field | what's growing / when bare | US: CDL + HLS phenology classifier; global: Prithvi-EO-2.0 fine-tuned + AlphaEarth; NDVI/BSI/NDTI thresholds + harmonic gap-fill | | monthly cover status (crop/residue/bare) per field |
| M5 Stress Windows | risky weeks | weekly hazard probabilities from 20–45 yr: frost, heat, dry spells, intense rain × GDD crop-stage sensitivity; GBM on RMA losses; change-point/trend tests | | risk rim, vulnerability zones, alert thresholds |
| M6 Soil-Health & Water Sim | erosion, OM, N, water per rotation | RUSLE A=R·K·LS·C·P; FAO-56 dual-Kc water balance; ICBM/RothC-style carbon pool; N balance with legume credits; pest-host continuity score; wind-erosion indicator (+WEPS; 10 m→2 m wind conversion); surrogate NN/GBM on ~100k Monte-Carlo runs → ONNX | trials, literature, OpenET | outcome ranges |
| M7 Climate Futures & Twins | climate shift + analogs | 2041–2060 NEX-GDDP deltas (SSP2-4.5, SSP5-8.5) on local baselines; re-score M1; Mahalanobis analogs per model | | analogs, agreement, novel-climate flag; crop rising/steady/falling tags |
| M8 Price & Profit | earnings and risk | price ensemble (seasonal naive + ETS/ARIMA + GBM on lags) with conformal intervals; ERS/extension costs; MC net = yield×price−cost with joint historical draws | | E[return], P10, CVaR 5%, break-even price & yield |
| M9 Multi-Objective Optimizer | which 3–5 strategies | generate 2–5-yr sequences → rules + constraints prune → simulate M2/M6/M8 over weather years → Pareto (NSGA-II pymoo or exhaustive non-dominated sort) → TOPSIS with priority weights → diversity rule (one per family); existing always included | | ranked strategies |
| M10 Uncertainty | how sure & why | 4 parts: data confidence, model spread, applicability domain (Mahalanobis / isolation forest), scenario spread; "High" = intervals held truth ≥80% in validation; rank-stability test | | badge, reason chips, "what would make us more sure" |
| M11 SI Narrator/Copilot | plain words | LLM with function calling; structured JSON in; low temperature; number checker; per-sentence evidence ID; refusal; reading-level control | | 3-line summaries, cards, digests, hand-off report |
| M12 Fusion & Downscaling | field-relevant values from coarse | RF downscaling SMAP 9 km→1 km (NDVI, LST, terrain, texture; validated vs SCAN); IMERG quantile mapping; harmonic/Prithvi NDVI gap-fill; ET fusion ECOSTRESS+OpenET+FAO-56 | | fused layers with effective-res tags |

### 5.1 Fit Score and the "statistically best" recipe (BP §6.2)
- **Formula:** **FitScore_c = S_c^0.5 × Yp_c^0.3 × R_c^0.2**: S = calibrated suitability; Yp = expected-yield percentile; R = reliability = 1 − normalized downside (from P10/P50); The weights can be edited in Expert mode.
- **Three separate lenses:** "Fits here" (M1) and "Performs here" (M2) together make the "statistically best" ranking; "Pays here" (M8) is a separate, optional lens; Commonness is context only and is **never proof of suitability**.
- **Candidates:** US: ~60 field, forage and cover crops; Global: the FAO list (CROPGRIDS 173 crops).
- **Presence label:** the crop occupied **≥5% of the cell's cropland in ≥3 of the last 10 CDL years**.
- **Features:** about 60 environmental-only features.
  - Climate: GDD by season, frost-free days, frost probabilities, **heat days >32 / >35 °C**, chill hours, seasonal rain, rain CV, aridity (P/ET0), VPD, IMERG heavy-rain frequency.
  - Soil: AWC 0–100 cm, OM, pH, texture, drainage, hydrologic group, restrictive depth.
  - Terrain: slope, TWI.
  - Water: SMAP RZ percentiles, dry-spell frequency, GRACE trend, OpenET, irrigated-area maps.
  - Landscape: AlphaEarth embedding (Pro).
- **Validation:** Spatial-block CV: leave-one-state-out or **200 km blocks**; Temporal hold-out: **train 2008–2019, test 2020–2025**; Metrics: PR-AUC, Brier score, reliability curves; Baselines to beat: GAEZ-only and "county frequency"; Specialty crops are flagged "low label support".
- **Look-ahead:** re-score under the 2040s climate to tag each crop rising / steady / falling.
- **Explain:** SHAP drivers become plain-word templates, e.g. "long enough frost-free season", "soil holds enough water for July".
- **[CONFLICT] RP on M1:** "A classifier trained on crop presence must be labeled as **cultivation likelihood**; environmental-only features cannot remove selection bias in those labels."
  - RP's sequence: show common regional crops, then agronomically eligible crops, then model-assisted rotation comparisons.
  - Start with a regional historical mean/trend baseline and a regularized linear model. Fit LightGBM "only after establishing consistent data support".
  - Detrend yields so technology trends are not mistaken for climate effects.
  - Treat suppressed or missing NASS records explicitly.
- **[ADD] RP simpler first-version model table:**

| Component | Proposed method |
|---|---|
| Common crops | area-weighted frequency (CDL + QuickStats) |
| Vegetation timing | smoothed seasonal indices + change-point detection (quality-screened HLS/Sentinel/Landsat), checked against farmer dates |
| Crop yield & risk | LightGBM quantile, separate crop models, at county/crop/year scale |
| Soil water balance | FAO-56 reference ET + crop coefficients + **root-zone bucket** |
| Wind exposure | hourly wind overlap with cover/management calendar (POWER/ERA5 + soil/residue + NOAA checks); full WEPS when inputs suffice |
| Rotation search | **constraint filtering + beam search** over seasonal choices |
| Explanation | deterministic reason templates; optional grounded language model |

- **[CONFLICT] M9 search method:** RP uses beam search; BP uses NSGA-II / exhaustive sort.

### 5.2 Uncertainty and validation details
- **BP M10:** "High" means intervals held truth ≥80% of the time in validation. Rank stability is tested under perturbed weights, weather years and inputs; if the top choice flips, the ordering is labelled uncertain.
- **RP:**
  - Keep evidence completeness, statistical uncertainty and geographic applicability **separate**: "a single confidence percentage hides important differences."
  - Conformal coverage is **marginal** and assumes exchangeability; it is "not a guarantee for each field".
  - Use forward-in-time evaluation with spatially held-out regions. Keep adjacent fields and shared weather cells together.
  - Reserve a final evaluation set before choosing parameters.
  - References: https://mapie.readthedocs.io/en/stable/content/conformal-prediction/theory/; https://scikit-learn.org/stable/modules/generated/sklearn.model_selection.TimeSeriesSplit; https://lightgbm.readthedocs.io/en/stable/Parameters.html.
- **Time basis on every result:** Record horizon and information cutoff; Historical replay, issued forecasts and hypothetical scenarios are labelled separately; **Pre-season estimates never use end-of-season data** (BP, RP).
- **Prediction horizons (BP §6.4):**

| Horizon | Predicts | Models / data |
|---|---|---|
| Days–2 weeks | frost, heat, heavy rain, workability | NWS / Open-Meteo vs POWER/PRISM climatology, current SMAP state |
| Weeks–season | SM outlook, dry-down risk, cover seeding/termination windows, in-season stress | SMAP L4, IMERG, ESI, NDVI anomalies, outlooks; M5 |
| Next season | usual next; yield and profit distributions | M3, M2, M8 |
| 3–10 years | OM, erosion, water-use trajectories; groundwater context | M6, GRACE, NWIS |
| 2030s–2060s | climate shift, suitability shift, twins | M7 with M1 re-scored, NEX-GDDP-CMIP6 |

### 5.3 SI vs statistical approaches (the brief asks for this; BP §6.3)
- Rules/envelope (ECOCROP, GAEZ): M1 prior and the sanity layer.
- Random forest: baseline; SMAP downscaling.
- Gradient boosting: primary for M1, M2 and M5.
- GAMs: response-curve explanations.
- MaxEnt / PU learning: minor crops.
- Quantile / NGBoost / conformal: M2, M8, M10.
- Markov chains: M3.
- Transformers and foundation models: M4.
- Process models + ML surrogates: M6.
- NSGA-II / MILP: M9.
- LLM: M11, with tool-only numbers.

---

## 6. Rotation strategies, agronomy rules and the knowledge base

### 6.1 Six strategy families [CONFIRMS six families]
| BP letter | BP name | RP # / name | Change | Visible trade-off / constraint (RP) |
|---|---|---|---|---|
| A | Fill the gap | 1 Fill a seasonal gap | cover crop into bare periods (cereal rye, oats, crimson clover, radish, mixes) or adjust termination | establishment window, residue, water use, termination equipment, next crop |
| B | Extend & diversify | 2 Extend or diversify | third crop (small grain + underseeded legume) or double crop / different season | thermal/calendar fit, equipment, storage, market, workload, family diversity |
| C | Water-wise swap | 3 Use less water | drought-tolerant crops (sorghum, millet, sunflower, camelina) or flex fallow tied to planting soil moisture | yield variability, irrigation limits, soil storage, Kc, local agronomy |
| D | Integrate forage | 4 Integrate forage or grazing | perennials (alfalfa, grass–legume hay) or grazed covers | feed timing/quality, establishment, animal access, harvest, soil condition |
| E | Market-driven add | 5 Fit a real market | crop with verified nearby buyer (food-grade, pulses, seed, contract) | grade, delivery, buyer verification, costs, price ranges, transition risk |
| F | Pest-cycle break | 6 Break a pest cycle | insert non-host where host continuity is high | host/non-host rules, disease history, weeds, timing |

- **BP M9** builds candidates from each family and shows the best 2–4 from **different families** beside the existing rotation.
- **RP:** "can consider all six families without forcing all six into every field result."
- **RP livestock:** ask the livestock type, forage season, and harvest vs grazing. Grazing intensity and wet-soil traffic need local review.

### 6.2 Agronomy rules engine (BP §7.4)
| Rule | Why | Effect |
|---|---|---|
| Same crop/family back to back | pest/disease carry-over (soybean after soybean raises nematode/disease) | penalty + pest-break flag |
| Wheat following corn | corn residue raises **Fusarium head blight (scab)** risk | risk flag + mitigation note |
| Legume before high-N crop | N credit | bonus; lower N need |
| Residual herbicide programs | carry-over injury | "check locally" flag |
| Season length | GDD and frost-free days must exceed crop needs + margin | exclude or flag "tight" |
| Water budget | seasonal crop ET ≤ effective rain + irrigation, **also checked in a dry year (P20)** | exclude or penalize |
| **Slope > 5% and bare during peak erosivity months** | high erosion risk | require cover or residue |
| Cover-crop termination timing | must fit cash-crop planting and insurance rules | "check locally" |
| Equipment, market, livestock | farmer reality | hard filter |

**Standard "check locally" items** (BP §6.5):
- Herbicide carryover and residual programs.
- Local disease, nematode and weed pressure (e.g. **soybean cyst nematode**, herbicide-resistant weeds).
- Irrigation rights, well capacity and allocations.
- Contracts, buyers, storage and logistics.
- Insurance and conservation-program rules for covers and termination.
- Drainage, compaction and tile issues.
- Equipment and labour realities, and family goals.

### 6.3 Crop Trait Knowledge Base schema (BP §7.3; RP p.21)
- **`crop_traits` fields:** crop, family, season (cool|warm), life_cycle; gdd_to_maturity, min_frost_free_days; frost_tolerance, heat_threshold_C; root_depth_class, water_use_mm (Kc curve); drought_tolerance, waterlogging_tolerance; n_fixing (Y/N), n_demand, residue_C:N; **erosion_cover_value (RUSLE C by month)**; forage_value, grazing_ok; pest_disease_hosts[], allelopathy; herbicide_carryover_sensitivity; market_type, equipment_needs[], seed_availability; sources[].
- **Intended sources:** ECOCROP, FAO-56, USDA PLANTS, cover-crop council tools, SARE, extension.
- **RP adds:** maturity class, local planting/harvest windows, **stage-specific crop coefficients**, soil tolerances, irrigation needs, equipment requirements.
- **Crop-role explainers** (the brief asks for these):
  - **N-fixing:** soybean, peas, clovers, alfalfa, vetch; "N credit".
  - **Cover:** living roots through bare months; cuts erosion, holds nitrate, can be grazed.
  - **Deep-rooting:** alfalfa, radish, sunflower, some grasses; infiltration, nutrient recovery, compaction relief.
  - **Drought-tolerant:** sorghum, millet, sunflower, some pulses.
- **[GAP] Numeric gaps.** None of the seven sources gives numeric values for: **Kc** (crop coefficients) per crop or stage; Per-crop **GDD to maturity**, base temperatures or frost thresholds; Per-crop heat thresholds; **RUSLE C or P** values; **R-factor** formulas; **K-factor** numbers; **Wind-erosion threshold** speeds; Cover-crop seeding rates or costs; Per-crop rooting depths or water use (mm).

  What the sources do give:
  - Method references: FAO-56 chapters https://www.fao.org/4/X0490E/x0490e06.htm and https://www.fao.org/4/X0490E/x0490e07.htm; USDA WEPS https://www.nrcs.usda.gov/resources/tech-tools/wind-erosion-prediction-system.
  - The heat-day feature thresholds **32 °C and 35 °C**.
  - Frost alert **≤ 0 °C**.
  - The **slope > 5%** rule.
  - The SMAP **<20th percentile, falling 10+ days** dry-down trigger.
  - The IMERG **>95th percentile** heavy-rain trigger.

  RP says to "derive erosion thresholds from relevant soil/management science or present user-selected thresholds as assumptions". **These values must be sourced separately (e.g. FAO-56 tables) before use.**

### 6.4 Wind as the distinctive feature (RP p.23) [ADD]
- Show a monthly **wind rose** and the overlap between **windy hours and expected soil exposure**.
- Combine wind with texture, surface moisture, residue, field dimensions and shelterbelts.
- **Keep the wind height and threshold visible.** FAO reference ET uses **2 m** wind; many products report **10 m**. Apply documented conversions (FAO wind-height guidance). BP M6 also lists "10 m → 2 m wind-height conversion".
- Historical exposure uses measured or reanalysis weather; alerts use an issued forecast.
- Show the trade-off: "A rotation that improves cover may also use more water before the next crop."
- Wind data: POWER / ERA5 (gusts); NOAA GHCN-hourly: https://www.ncei.noaa.gov/products/global-historical-climatology-network-hourly; MERRA-2 (same lineage as POWER).
- RP demo: "Two rotations look similar under an average season, then separate when a historical windy period overlaps exposed soil."

### 6.5 Worked illustration: central Iowa corn–soybean (BP §7.5, directions only, "not a result")
| Strategy | Erosion | OM | N self-suff. | Water | Pest break | Profit (median) | Profit risk | Workload |
|---|---|---|---|---|---|---|---|---|
| A Existing corn→soy (bare Nov–Apr) | baseline | baseline | baseline | baseline | baseline | baseline | baseline | baseline |
| B + cereal rye cover after each crop | ▲▲ | ▲ | ● | ●/▼ in dry springs | ● | ●/▼ (seed, seeding cost) | ● | ▼ |
| C corn→soy→oats + red clover | ▲▲ | ▲▲ | ▲▲ | ● | ▲▲ | ● (needs oat & hay market) | ▲ (spread) | ▼ |
| D corn→soy→3-yr alfalfa | ▲▲▲ | ▲▲▲ | ▲▲ | ▼ (perennial ET) | ▲▲ | depends on hay/livestock | ● | ▼▼ |

- **Card evidence chips:** IMERG heavy-rain months, SRTM slope, Landsat/HLS bare months, SMAP spring SM, SSURGO K and AWC, CDL 2008–2025, NASS county yields, AMS hay and oat prices, Ag Data Commons trials.
- **Check-locally examples:** Rye termination timing before corn (insurance rules; N tie-up risk); Oat and hay buyers within hauling distance; Herbicide carry-over to clover and oats; Tile drainage and spring workability; SCN test results.
- **G3:** replace the arrows with real numbers (see §2.3).

### 6.6 Cited studies with numbers (G2; 41 entries) [ADD: evidence library for cards and priors]
**G2 key takeaways for the tool:**
- **Legume before cereal** is the most consistent sequence effect: +20% globally (Zhao 2022); +29% for cereals (Cernay 2017); +0.5–1.6 t/ha in Europe (Preissel 2015); Wheat +1.2 t/ha after pulses vs +0.5 t/ha after oats (Angus 2015).
- **Scale the legume credit to the N rate:** The benefit shrinks with N and is **negligible above ~150 kg N/ha** (Cernay 2017; Zhao 2022); The tool should **ask the N rate**.
- **Monoculture penalties:**
  - **Continuous corn −4.3%** (worse in dry areas) and **continuous soybean −10.3%** across 748k US field-years (Seifert 2017).
  - Rotated corn +10% and first-year corn +15% (Crookston 1991).
  - Flag any "same crop again" choice.
- **Diversity is drought insurance:** Drought-year maize losses cut **14–90%** (Bowles 2020); Losses cut **17%** (Renwick 2021); Up to **~1 t/ha** in hot, dry years (Marini 2020); **Weight diversification more when POWER, SMAP or ECOSTRESS show stress.**
- **Extended rotations hold yield with fewer inputs:** synthetic N **−59–74%** and herbicide **−76–82%** (Marsden: Liebman 2008; Davis 2012).
- **Soil-health gains are modest and slow:** Soil C +3.6%; with a cover crop +8.5% C and +12.8% N; microbial biomass +20–26% (McDaniel 2014); Score OM as a slow, cumulative benefit.
- **Cover type matters:**
  - Legume covers before corn: **+30–33% at low N or under no-till**. Grass covers: neutral (Marcillo & Miguez 2017).
  - Globally, covers average **−4%** yield, but legume/non-legume **mixes +13%** (Abdalla 2019).
- **Functional richness beats species count** (Smith 2023). Varying planting dates suppresses weeds (Weisberger 2019).

**Selected entries** (all links per G2, checked Nov 13 2026):

| # | Study | Region | Numbers | Link |
|---|---|---|---|---|
| 1 | Zhao et al. 2022, Nat Commun | global, 462 expts, 11,768 obs | legume pre-crop +20%; 32% vs 7% low- vs high-yield envs | https://doi.org/10.1038/s41467-022-32464-0 |
| 2 | Cernay et al. 2017, Env Chem Lett | 1,181 yields, 15 countries | cereals after grain legumes +29%; negligible >~150 kg N/ha | https://doi.org/10.1007/s10311-017-0698-z |
| 3 | Angus et al. 2015, Crop Pasture Sci | >900 comparisons | wheat after break +0.5 (oats) to +1.2 t/ha (grain legumes); ranking oats < canola≈mustard≈flax < pea≈faba≈chickpea≈lentil≈lupin; 2nd break adds 0.1–0.3 t/ha | https://doi.org/10.1071/CP14252 |
| 4 | Kirkegaard et al. 2008, FCR | temperate wheat review | mechanisms (rhizosphere, allelopathy, structure) | https://doi.org/10.1016/j.fcr.2008.02.010 |
| 5 | Preissel et al. 2015, FCR | Europe, 29 expts | +0.5–1.6 Mg/ha; next-crop N cut 23–31 kg N/ha; 35/53 legume rotations economically competitive | https://doi.org/10.1016/j.fcr.2015.01.012 |
| 6 | Smith M.E. et al. 2023, Commun Earth Env | 32 LTEs, 10–63 yr | diversity raises small-grain & maize yield; grows over time; largest at low N | https://doi.org/10.1038/s43247-023-00746-0 |
| 7 | Bowles et al. 2020, One Earth | N. America | maize +28.1% avg (+22.6% good yrs); drought losses −14.0–89.9% | https://doi.org/10.1016/j.oneear.2020.02.007 |
| 8 | McDaniel et al. 2014, Ecol Appl | 122 studies | +3.6% C, +5.3% N; w/ cover +8.5% C, +12.8% N; MBC +20.7%, MBN +26.1% | https://doi.org/10.1890/13-0616.1 |
| 9 | Weisberger et al. 2019, PLoS ONE | 54 studies | weed density −49% (not biomass); no-till −65% vs tillage −41% | https://doi.org/10.1371/journal.pone.0219847 |
| 10 | Marcillo & Miguez 2017, JSWC | US & Canada, 65 studies | grass covers ≈0; legume covers +30–33% (low N/no-till); mixtures +30% if terminated 0–6 d before corn | https://doi.org/10.2489/jswc.72.3.226 |
| 11 | Abdalla et al. 2019, GCB | 106 studies, 372 sites | covers cut N leaching, raise SOC; yield −4% avg; mixtures +13% | https://doi.org/10.1111/gcb.14644 |
| 12 | Bennett et al. 2012, Biol Rev | review | short-rotation yield decline; soil microbes implicated | https://doi.org/10.1111/j.1469-185X.2011.00184.x |
| 13 | Davis et al. 2012, PLoS ONE | Marsden Farm IA 2003–2011 | 3-yr (C–S–small grain+red clover) & 4-yr (+alfalfa) match/beat C–S yield & profit; freshwater toxicity 2 orders of magnitude lower | https://doi.org/10.1371/journal.pone.0047149 |
| 14 | Liebman et al. 2008, Agron J | Boone IA | synthetic N −59% / −74%; herbicide −76% / −82% (3-yr / 4-yr) | https://doi.org/10.2134/agronj2007.0222 |
| 15 | Crookston et al. 1991, Agron J | MN, 9 yr | rotated corn +10%, 1st-yr corn after 5 yr soy +15%; rotated soy +8%, 1st-yr soy +17% | https://doi.org/10.2134/agronj1991.00021962008300010026x |
| 16 | Stanger & Lauer 2008, Agron J | WI, 35 yr | 1st-yr corn after alfalfa needs no added N; 2nd/3rd-yr corn needed 224 kg N/ha | https://doi.org/10.2134/agronj2007.0280 |
| 17 | Baldock et al. 2014, Agron J | WICST 1990–2012 | corn after alfalfa +1.47 ± 0.38 Mg/ha vs continuous corn; largest in stress years | https://doi.org/10.2134/agronj14.0004 |
| 18 | Smith R.G. et al. 2008, Ecosystems | KBS MI | corn yield linear with # crops (no inputs); 3 crops + 3 covers >100% more than continuous corn | https://doi.org/10.1007/s10021-008-9124-5 |
| 19 | Tiemann et al. 2015, Ecol Lett | KBS | 1→5 species raises aggregation, SOC, total N, microbial activity | https://doi.org/10.1111/ele.12453 |
| 20 | Morrow Plots (UIUC) | Urbana IL, since 1876 | 1997: unfertilized 54 / 94 / 110 bu/ac (cont. corn / C–S / C–oats–hay); fertilized 151 / 191 / 200 | https://morrow.aces.illinois.edu/the-morrow-plots-a-landmark-for-agriculture/ |
| 21 | Seifert, Roberts & Lobell 2017, Agron J | Midwest, 748,374 field-yrs 2007–2012 | cont. corn −4.3% (levels off after 3 yr; worse dry/low-yield); cont. soy −10.3% (worsens to 5 yr); irrigation reduces corn penalty only | https://doi.org/10.2134/agronj2016.03.0134 |
| 22 | Hendricks et al. 2014, AJAE | IA/IL/IN >8M satellite obs | farmers switch back after price shocks to capture rotation benefit | https://doi.org/10.1093/ajae/aau024 |
| 23 | Stern et al. 2012, JARS | Iowa CDL 2001–2010 | corn area 4.7→5.7 M ha (2001–2007); N/central counties shifted C–S → C–C | https://doi.org/10.1117/1.jrs.6.063590 |
| 24 | Aguilar et al. 2015, PLoS ONE | CONUS 1978–2012 | crop diversity lower in 2012; Heartland lowest | https://doi.org/10.1371/journal.pone.0136580 |
| 25 | Wallander 2013, ERS Amber Waves | US (ARMS) | ~18% of 2010 corn acres continuous corn (3 yr); 82–94% in some rotation; ~1% cropland cover crops | https://www.ers.usda.gov/amber-waves/2013/march/while-crop-rotations-are-common-cover-crops-remain-rare |
| 26 | Wallander et al. 2021, ERS EIB-222 | US | cover crop use +50% 2012–2017 | https://www.ers.usda.gov/publications/100550 |
| 27 | Gaudin et al. 2015, PLoS ONE | Ontario, 31 yr | small grain improves soy yield/stability; corn gains mainly from underseeded red clover/alfalfa; hot-dry yrs corn +7%, soy +22% | https://doi.org/10.1371/journal.pone.0113261 |
| 28 | Renwick et al. 2021, ERL | Ontario, 36 yr + rainout | maize drought loss reduced 17.1 ± 6.1%; no-till no effect | https://doi.org/10.1088/1748-9326/ac1468 |
| 29 | Marini et al. 2020, ERL | Europe, 7 LTEs | +860 kg/ha/yr winter, +390 spring cereals; up to ~1,000 kg/ha in hot-dry years | https://doi.org/10.1088/1748-9326/abc651 |
| 30 | Gan et al. 2015, Sci Rep | **Saskatchewan** 2005–2011 | pulse-based vs summerfallow sequences: grain +35.5%, protein +50.9%, fertilizer-N efficiency +33% | https://doi.org/10.1038/srep14625 |
| 31 | Gan et al. 2014, Nat Commun | semiarid Canadian prairies | legume rotation + soil-test N + less fallow: wheat footprint −256 kg CO2-eq/ha/yr | https://doi.org/10.1038/ncomms6012 |
| 32 | Wang et al. 2025, Crop Sci | N. Great Plains | winter wheat after soybean/lentil ≥ after canola, higher protein, carries to 2nd year; 2nd cereal year = yield drag (spring wheat worst) | https://doi.org/10.1002/csc2.70047 |
| 33 | Yang et al. 2024, Nat Commun | North China Plain, 6 yr | adding sweet potato/peanut/soy to wheat–maize: equivalent yield up to +38%, N2O −39%, SOC +8%; cereal output +32% after these crops | https://doi.org/10.1038/s41467-023-44464-9 |
| 34 | Johnston & Poulton 2018, EJSS | Rothamsted since 1843 | value of long-term experiments | https://doi.org/10.1111/ejss.12521 |
| 35 | USDA NASS Crop Sequence Boundaries | CONUS 2008–2025 | 8-yr sequences + boundaries (see §4.3) | https://www.nass.usda.gov/Research_and_Science/Crop-Sequence-Boundaries/index.php |
| 36 | NASS CropScape/CDL | CONUS 30 m | source for rotation studies | https://www.nass.usda.gov/Research_and_Science/Cropland/SARS1a.php |
| 37 | Mohler & Johnson 2009, SARE | NE US/E Canada | organic rotation planning manual | https://www.sare.org/resources/crop-rotation-on-organic-farms/ |
| 38 | SARE, Managing Cover Crops Profitably 3rd ed. | US | species-by-species cover management | https://www.sare.org/resources/managing-cover-crops-profitably-3rd-edition/ |
| 39 | Midwest Cover Crops Council | US Midwest | cover crop selector tools, state "recipes" | https://www.midwestcovercrops.org/ |
| 40 | Rothamsted e-RA | UK | open long-term data | https://www.era.rothamsted.ac.uk/ |
| 41 | WICST, UW–Madison | WI | 37 yr cash-grain, dairy-forage, organic, grazing data (on request) | https://wicst.wisc.edu/ |

- **Pilot relevance:** **Iowa:** #13, 14, 15, 21, 23; **Saskatchewan:** #3, 30, 31, 32; **Kansas:** wheat–fallow appears in BP's Kansas Copilot example. No Kansas-specific study is in G2; **California, Punjab, Mato Grosso:** none of the G2 studies is specific to these pilots. **[GAP]**.
- **BP on Marsden Farm:** "The card links the study rather than restating numbers."
  - **[CONFLICT, minor]** G3 asks for real numbers on cards.

---

## 7. Profit (optional "Pays here" lens) (BP §7.6; RP p.23)
- **Revenue:** Yield (M2) × price: AMS cash and basis, NASS prices received; FAOSTAT and World Bank globally; Plus by-products: straw, grazing days valued at hay prices; Plus eligible conservation payments.
- **Costs:** ERS Costs & Returns, extension budgets, cover seed and seeding, custom rates. The farmer can override every line.
  - RP adds: seed, fertilizer, irrigation energy, machinery, labour, insurance, transport, storage and transition costs.
- **Simulation:** joint weather-year × price draws, which keep the yield–price natural hedge.
  - Outputs: expected net return, **P10, CVaR 5%, break-even price and yield**.
- **Order:** do a risk-aware margin comparison first (including transition-year and cash-flow costs), and optimize only after that (BP + RP).
- **Optimization:** maximize the expected return subject to a CVaR cap. Multi-field allocation via MILP (OR-Tools/PuLP) in Pro.
- **Disclaimers:** "Information, not financial advice." "Prices are scenarios, not forecasts of certainty."
- **[CONFLICT]**: RP: economics is optional and belongs in the expanded version, not the first submission; F7: "no yield or profit promises"; BP includes the profit tab and frontier.

---

## 8. Alerts (BP §8; RP p.23)
| Alert | Default trigger | Data | Lead |
|---|---|---|---|
| Frost | forecast min **≤ 0 °C** (or crop threshold) in sensitive stage, or before median last-frost for new plantings | NWS/Open-Meteo; POWER/PRISM frost climatology; GDD stage | 1–10 d |
| Heat stress | forecast Tmax > crop threshold during flowering / grain fill | forecast + ECOSTRESS/POWER | 1–7 d |
| Dry-down | **SMAP L4 root-zone < 20th percentile for the week, falling 10+ days** | SMAP L4, IMERG, NLDAS | ongoing |
| Heavy rain / erosion | forecast or IMERG Early accumulation **> local 95th percentile** and field bare per M4 | IMERG Early, QPF, M4, SRTM | 0–3 d |
| Cover-crop window | harvest detected (NDVI drop) and enough GDD before frost; termination reminders | HLS/S2 NDVI, POWER GDD, calendar | days–weeks |
| Wind + low cover | forecast wind > user/agronomist threshold while calendar shows bare/low residue | NWS/Open-Meteo wind, M4, texture, NOAA stations | 1–5 d |
| Water-storage trend | new GRACE-FO month or nearby NWIS well shows continued decline beyond threshold | GRACE-FO, NWIS | monthly/quarterly |
| Market | cash price crosses user level | AMS | daily |
| Season outlook | start-of-season summary | SMAP, outlooks, M5 | pre-season |

- **Pipeline:**
  1. **Subscribe** with double opt-in.
  2. **Ingest:**
     - Forecasts hourly.
     - **IMERG Early every 30 min.**
     - SMAP L4 daily.
     - NDVI per scene.
     - GRACE, NWIS and AMS as released.
  3. **Evaluate** with hysteresis, dedup and cooldowns.
  4. **Compose** via M11 with number checks.
  5. **Send** via **Amazon SES / Postmark / Resend** (Twilio SMS optional).
  6. **Learn:** "Was this useful?" buttons and **backtests on 2001–2025**.
- **Rules:** Suppress superseded forecasts; Keep a viewable history; CAN-SPAM compliance (one-click unsubscribe). GDPR review for the global stage; Field locations are private by default.
- **RP adds:** a seasonal planning reminder and a weekly digest (new imagery, changed conditions, data gaps, ranking changes); local time and quiet hours; delivery receipts; save the forecast issue time.
- **Example email** (BP): "How unusual for late April here? top 10% of storms (IMERG 2001–2025)", then "Why you got this", then "Consider (your call)", then confidence and chips.
- **[CONFLICT on timing]** G3 moves alerts to post-event. BP LITE keeps a weekly digest. RP says "The plan includes email functionality for future implementation."

---

## 9. Architecture and stack

### 9.1 BP stack versus the brief
| Layer | BP choice | vs brief |
|---|---|---|
| Front end | React + TypeScript + Vite; CesiumJS via **Resium**; MapLibre GL (2D fallback, v5 globe projection 2.5D); D3 / Observable Plot / visx; **Zustand**; **i18next**; PWA | [CONFIRMS] + [ADD] Resium/Zustand/i18next/visx |
| API | **FastAPI**, Pydantic, OpenAPI contract, Redis cache, RQ/Celery workers | [CONFIRMS] FastAPI; [ADD] Redis/RQ |
| Storage | **PostgreSQL + PostGIS + h3-pg** for fields, users, alerts; object storage (S3/R2/GCS) for COG, Zarr, GeoParquet, PMTiles | **[CONFLICT]** brief specifies **DuckDB**; neither BP nor RP mention DuckDB (only GPT suggests DuckDB, for a different challenge) |
| Geo | xarray, rioxarray, rasterio, GeoPandas, exactextract, h3-py, earthaccess, Earth Engine API / geemap, Soil Data Access, pystac-client | [ADD] |
| Tiles | **TiTiler** (dynamic COG → XYZ; https://developmentseed.org/titiler/), **PMTiles** vectors via HTTP range, NASA GIBS WMTS, Cesium ion / Google Map Tiles API | [ADD] |
| SI/ML | scikit-learn, LightGBM, XGBoost, PyTorch + TerraTorch (Prithvi), statsmodels, **MAPIE**, SHAP, **pymoo**, OR-Tools/PuLP, **ONNX Runtime Web** | [ADD] |
| Narrator | LLM with function calling + JSON schema; number & citation checker; prompt registry | [ADD] |
| Alerts | Cloud Scheduler or GitHub Actions cron → worker → SES/Postmark/Resend | [ADD] |
| Hosting | front end on Vercel/Netlify; API on Cloud Run / Fly.io / Render | [ADD] |
| Ops | GitHub CI (lint, type-check, contract checks), Sentry, uptime monitor, feature flags | [ADD] |

- **RP stack:** TS/React + CesiumJS; Python/FastAPI; **PostgreSQL/PostGIS**; object storage for immutable raster subsets; TiTiler; a background worker queue with progress reporting.
  - **[CONFLICT with DuckDB]** RP also uses PostGIS.

### 9.2 Globe rendering stack (BP §3.1) [CONFIRMS Cesium + MapLibre]
- **Imagery by zoom:**
  - z0–6: **NASA GIBS WMTS** (Blue Marble, MODIS/VIIRS corrected reflectance, daily; free, no key).
  - z6–13: **Sentinel-2 cloudless 10 m**, falling back to Landsat/HLS composites at 30 m.
  - z13–19: **NAIP 0.6–1 m** (US); globally Esri World Imagery or Bing via Cesium ion, falling back to Google 2D.
- **Terrain:** Cesium World Terrain (ion), falling back to SRTM/NASADEM quantized-mesh; USGS 3DEP 10 m for US field zoom; **Exaggeration toggle ×1–×3** so slope is visible.
- **Photoreal 3D:** Google Photorealistic 3D Tiles (Map Tiles API). Needs an API key, billing and on-screen attribution; "One root-tileset request covers at least 3 hours of tile requests."; Rural meshes are coarse; Docs: developers.google.com/maps/documentation/tile/3d-tiles.
- **[ADD] Licensing guardrail:** Google terms restrict mixing Google content with non-Google basemaps. Use two modes: **Google mode:** Photoreal + Google 2D, with NASA data as overlays; **Open mode:** Cesium World Terrain + NAIP/Sentinel-2/Esri/Bing/GIBS; "Never stitch Google and non-Google base imagery in one view."
- **Science overlays:** our own COG/Zarr via TiTiler with colorblind-safe palettes.
- **Labels:**
  - Rule: per admin-1 unit, keep the capital plus the top 5 cities by population. **About 20k labels** globally, built once into PMTiles.
  - National capitals at globe zoom, state capitals at regional zoom, top 5 at state zoom.
  - Use CesiumJS label distance conditions.
  - RP: "City-proper is the initial population definition"; use a consistent population vintage; handle collisions by zoom.
- **Boundary style:** thin white outlines at global zoom; thicker and labelled at regional zoom; the selected unit glows.
- **RP:** "Start with a legally usable global basemap." Cesium docs: https://cesium.com/learn/cesiumjs-fundamentals/; https://cesium.com/learn/cesiumjs-learn/cesiumjs-imagery/; https://cesium.com/learn/cesiumjs-learn/cesiumjs-terrain/.

### 9.3 Precompute and performance
- **BP precompute:** **CONUS** features and M1/M3/M5 at **H3 res 6 (~220k cells)**, plus res 7 over cropland; Pilot regions get full field-level layers; Global at res 4–5; On-demand: zonal stats for a new polygon (EE for 30 m) and M2/M6/M8/M9 sims, **cached by polygon hash**.
- **BP budgets:** First globe render **< 3 s** on broadband; Low-bandwidth mode **< 1.5 MB**; Area Report **< 30 s** (cached pilot **< 2 s**); Slider response **< 150 ms** (ONNX in a Web Worker); Usable on a mid-range phone.
- **[CONFLICT] RP budgets:** cached comparison within **5 s**; map interaction within **3 s**. RP calls these "design targets pending measurement".
- **RP reliability:** Key analyses by geometry version, time range, indicators and data/model versions; Retry and resume; Publish a manifest only when all outputs exist; A changed field invalidates dependents; Concurrent sessions show conflicts; Source failures return partial results with cached dates; **Public demo fields need permission or clearly labelled public illustrative polygons.**

### 9.4 Shared data objects (frozen before parallel work; BP §9.5 = RP p.25) [ADD]
- **Field profile:** boundary, area, location, region codes, time zone, crop history, water and equipment constraints, farmer-confirmed values, version.
- **Evidence record:** source collection and version; observation, publication and retrieval times; footprint; units; QA flags; valid coverage; transformation; citation; lineage.
- **Crop definition:** canonical crop ID, regional variant and season, traits, constraints, references, geography.
- **Model prediction:** target, spatial support, information cutoff, model version, feature snapshot, estimate and interval, uncertainty method, applicability. RP adds calibration evidence, uncertainty reasons and useful missing inputs.
- **Rotation scenario:** ordered crops and events, baseline ID, assumptions, weights, raw indicators, rank, reasons, exclusion reasons, review items. RP adds the **strategy family** and the scenario definition.
- **Analysis job:** field version, period, source and model versions, progress, recoverable failures, result manifest.

### 9.5 Repo layout (BP §9.4)
- **Folders:** `contracts/` (openapi.yaml, feature_registry.yaml, strategy_card.schema.json, crop_traits.schema.json); `data/` (ingest_nasa, ingest_usda_usgs, ingest_global); `features/` (harmonize); `models/` (m01_suitability … m12_fusion, model_cards); `engine/` (strategies, rules, uncertainty, profit); `api/`; `web/` (globe, panels, components, i18n); `alerts/` (jobs, templates); `narrator/` (prompts, checker); `qc/`; `docs/`.
- **Docs files:** README, **DATA_SOURCES.md**, **SI_USE_DISCLOSURE.md**, LICENSES.md, demo_script.md, ux_checklist.md.
- **RP addition:** a dataset register listing collection and version, owner, coverage, dates, native and effective resolution, units, QA mask, licence, citation, credentials, cadence and fallback. "Verify one real sample for each activated connector."

### 9.6 Quality-control framework (BP §9.6: eight layers, four gates)
1. **Data:**
   - QA masks: SMAP retrieval flags, Landsat `QA_PIXEL`, MODIS QA, IMERG quality index, ECOSTRESS cloud mask.
   - Checks: units and ranges, completeness, CRS and grid alignment, latency, licence.
   - Agreement reports: IMERG vs PRISM/CoCoRaHS; SMAP vs SCAN/USCRN; ECOSTRESS/OpenET vs flux towers.
2. **Features:** no future leakage. Check formulas against references (**FAO-56 ET0, GDD**). Watch drift.
3. **Models:**
   - Spatial and temporal hold-outs.
   - Calibration and interval coverage.
   - Must beat baselines.
   - Subgroups: state, ecoregion, irrigated vs rainfed.
   - Seed stability.
4. **Agronomy:** rules engine plus a red-team "Skeptical Agronomist"; audit surprising top-5 picks; cross-check extension rotation guides.
5. **Narrative:**
   - Number checker and citation checker.
   - **Grade-8** reading level.
   - Banned overclaims ("guaranteed", "will increase yield by…").
   - The disclaimer must be present.
6. **UX:**
   - Five-second test ("where is the bare-soil risk?").
   - First answer in under 2 minutes.
   - WCAG 2.2 AA, colorblind simulation, mobile, low-bandwidth, keyboard, glossary.
7. **Software:** types, contract conformance, a rehearsed demo path, budgets, Sentry, graceful fallback (cached data plus a banner).
8. **Submission:** ≤30 s video or ≤7 slides; public no-login link; SI disclosure; watermark; no NASA logos; English; citations; team confirmed.

- **Gates:**
  - **G1 (end of Stage 1):** a farmer can go from search to three strategy cards on a pilot field in **< 2 min**.
  - **G2:** every brief requirement is visible and uncertainty appears everywhere.
  - **G3:** two non-US pilots work end to end with honest confidence.
  - **G4:** submission checklist 100%.
- **RP high-consequence review items:** same as the guardrails in §4.5. Plus "Known coordinates land in the correct field", and checks for the date line, Alaska/Hawaii, and **units and wind heights match formulas**.

---

## 10. Pilots, stages, agents, demo

### 10.1 Pilot regions [CONFIRMS brief pilots]
- **BP US pilots:**
  - **Central Iowa:** rainfed corn–soybean. Bare-soil and erosion story (IMERG, SRTM, CDL).
  - **Western Kansas:** wheat–fallow and irrigated corn over the High Plains aquifer. Water and wind-erosion story (GRACE-FO, NWIS, SMAP, POWER/ERA5 wind).
  - **San Joaquin Valley, California:** irrigated and hot. Heat and ET story (ECOSTRESS, OpenET, GRACE).
- **BP global pilots** (Canada first, then pick 2):
  - **Saskatchewan:** canola–wheat–pulse; shows provinces.
  - **Punjab, India:** rice–wheat; GRACE groundwater decline; post-harvest bare window.
  - **Mato Grosso, Brazil:** soybean then second-crop maize; IMERG rainfall-onset timing.
  - **[ADD] optional fourth:** Rift Valley, Kenya (smallholder maize) **or** Andalusia, Spain (Mediterranean dryland).
- **Specific demo field:** "Field 12 · Story County, Iowa · 64 ha · silty clay loam · 2–5% slope · rainfed" (BP wireframe, illustrative). Search example "41.99, -93.62" (Ames).
- **RP US rollout:** Corn Belt corn/soy first, then a wind-exposed Great Plains system, an irrigated western system, and a humid/specialty system. "Choose actual fields and crops after data and local agronomic review."
- **[CONFLICT] G3 and GPT:** one pilot only for the weekend (Iowa). F7: one decision, one pilot region.

### 10.2 Build stages (BP §10, Sat 09:00 = H0)
| Stage | Hours | Build | Exit |
|---|---|---|---|
| 0 Pre-flight | Fri Nov 13 | read guides; choose concept; accounts/keys: Earthdata Login, Earth Engine (non-commercial project), Cesium ion, Google Maps (opt.), NASS QuickStats, AMS MyMarketNews, OpenET, email provider, LLM API, hosting, public GitHub; pick pilots; inspect earlier satellite-tile work | keys tested |
| 1 US LITE | H0–H12 (Sat 09–21) | contracts H0–H2; core six at H3 res 6 + 3 US pilots; globe + boundaries + capitals + top-5 + search + click-to-field; M1 v1 (envelope + GBM), M3 Markov, M4 bare months (CDL + NDVI); rule-based strategies (existing + 2); Season Wheel, petals, confidence badge; Area Report v1 | **G1** |
| 2 US PRO | H12–H26 (Sat 21 – Sun 11) | all 26 sources; M2, M5, M6 + surrogate, M8, M9, M10, M11; Next Move, scenario switch, split-sky, drape, time machine; digest + frost/heavy-rain alerts; export | G2 |
| 3 GLOBAL | H26–H33 (Sun 11–18) | Canada (AAFC, StatCan); global swaps; M1 transfer; M7 Climate Twins; 2–3 global pilots; Spanish + 1 language | G3 |
| 4 Harden & story | H33–H39 (Sun 18–23) | freeze H35; QC; rehearsal; video + deck; README; SI disclosure; submit ~22:30 | G4 |

- **BP scope-cut order:**
  1. Field Twin 3D time-lapse
  2. Voice input
  3. SMS
  4. Multi-field MILP
  5. Prithvi fine-tune
  6. Third global pilot
  7. Photoreal 3D Tiles
- **Never cut:** strategy cards with the five elements, the uncertainty display, data chips, and support-not-replace reminders.
- **[CONFLICT]** G3 says Stage 1 only. RP's stage estimates span days to weeks ("The full roadmap spans beyond a single hackathon").
- **Note:** the earlier "satellite-tile work" / "prior satellite-tile implementation" is mentioned in BP and RP as a reuse candidate, but neither inspected it.

### 10.3 Agent teams
- **BP: 19 agents.** A0 Orchestrator; A1 Requirements & Judging; A2 NASA Data; A3 US Ag & Ground; A4 Global Data; A5 Harmonize & Features; A6 Suitability & Yield; A7 Rotation & Soil; A8 Climate & Uncertainty; A9 Economics & Optimizer; A10 Agronomy KB & Rules; A11 Globe & Geospatial; A12 UX/UI; A13 App Front End; A14 API & Platform; A15 Alerts; A16 SI Narrator; A17 QA/QC & Red Team; A18 Story & Submission.
- **BP operating rules:** Contracts frozen at H0–H2; **Stubs before real** (mock JSON by H3); One folder per agent; PRs reviewed by A17 plus the consumer; Hourly heartbeat; Evidence discipline; An SI-use disclosure log; Hard gates; Humans decide the concept, gates, demo cut and submission.
- **RP: 16 roles.**
  1. Delivery lead
  2. Challenge analyst
  3. Agronomy
  4. EO data engineer
  5. Ag/regional data engineer
  6. Globe/tiling
  7. Crop prediction & uncertainty
  8. Rotation optimization
  9. Wind/hydrology/process + Climate Twins processing
  10. Farmer UX
  11. App & notification
  12. Farm economics
  13. Global coverage/localization
  14. Independent scientific reviewer
  15. Usability/accessibility/reliability reviewer
  16. Submission producer
- **Shared rule (BP + RP):** with four concurrent slots, run 1 coordinator plus 3 specialists, in waves: **A Definition:** challenge, agronomy, UX; **B Foundation:** globe, EO data, ag data; **C Intelligence:** models, optimizer, front end; **D Expansion:** wind/water, alerts, global; **E Delivery:** science review, usability, story; A **human farmer/agronomist reviewer** is an explicit dependency before regional recommendations go live.
- **Standard hand-off:** completed work, verified evidence, unresolved issues, changed files, next dependency.

### 10.4 Demo storyboard (BP §12.1: six shots × 5 s, English subtitles)
1. **0–5 s:** orbit → Iowa; the field outlines itself. "Farmers face shifting heat, rain and water. FarmSmart starts from your field." (Relevance, Presentation)
2. **5–10 s:** the 25-year pulse (SMAP · IMERG · ECOSTRESS). "NASA satellites show 25 years of what your land has lived through." (Relevance, Validity)
3. **10–15 s:** Season Wheel; the red gap meets the heavy-rain rim; drag in rye and it turns green. "See when soil sits bare and at risk, and what could cover it." (Impact, Creativity)
4. **15–20 s:** three strategies with petals, dot-plots and confidence. "Compare rotations: trade-offs, risks and how sure we are." (Validity)
   - Alt: switch the top priority from forage to water, show the re-sort, and name the trade-off.
5. **20–25 s:** the Climate Twins arc to the 2040s analog. "See where your climate is heading, and learn from farmers already there." (Creativity, Impact)
6. **25–30 s:** the same flow on Punjab, then the end card. "US first, built for the world. FarmSmart: support for your judgment, not a replacement." (Impact, Presentation)

- **Recording rules:** record real app screens; watermark any SI-generated element; no NASA logos.
- **[CONFLICT] RP demo story:** open with a real decision and priorities → reveal a historical **wind or drought** overlap with exposed soil → compare three rotations and change one priority → show cover-vs-water trade-off and uncertainty → regional crop panel and global coverage view → saved plan.
  - In RP's story, Climate Twins does not appear in the demo.
- **7-slide backup deck:**
  1. Title
  2. Problem
  3. Solution (find → see → compare → act)
  4. NASA data + SI (chips, 12-model diagram, grid)
  5. Validity
  6. Impact & scale
  7. Team & next steps
- **Project page:** What / who / how / why; "NASA data used" with links and roles; A "Space-agency partner data" list (Sentinel-2, ERA5); SI disclosure; README with licences, model cards and limitations; Public, login-free link.
- **SI_USE_DISCLOSURE template (BP):** Code: SI coding agents drafted modules; humans reviewed and merged; Text: the SI Narrator generates summaries from model JSON with machine-checked numbers; Images: SI visuals watermarked "SI-generated"; screenshots are real captures; Data: no synthetic data presented as observations.
- **RP deliverables:** add a reproducible demonstration manifest, a clearly marked version and example data date, and a statement that distinguishes completed features from future work.

---

## 11. Risks (BP §13, plus others)
| Risk | Likelihood | Mitigation |
|---|---|---|
| Data downloads too slow | High | Earth Engine for heavy rasters; precompute pilots first; small subsets; cached fallbacks |
| 3D globe performance on judges' machines | Med | 2D/2.5D flag; request-render mode; record video on a strong machine |
| Tile licensing (Google vs others) | Med | two basemap modes; attribution; re-check terms |
| Model overfits / learns economics | Med | environmental-only features; hold-outs; envelope prior; red team |
| Narrator invents numbers | Med | tool-only numbers, checker, citations, refusal |
| False precision from coarse data | High | effective-res tags, confidence penalties, hatching, honest wording |
| Mission data gaps (ECOSTRESS revisit, GRACE gap, MODIS aging) | Med | OpenET/FAO-56 backups; NLDAS/GLDAS; VIIRS; data-age stamps |
| Sparse global labels | High | GAEZ prior, embeddings, domain-shift confidence, "low label support" |
| Scope creep | High | hard gates; ordered cut list |
| Keys, quotas, billing | Med | test keys in Stage 0; server-side keys; free tiers; cache |
| Rules non-compliance | Low | QC layer 8 (A18 + A1) |
| Farmer mistrust of black box | Med | evidence chips, "how we know", usual-next beside smart-next, strip trials, disclaimer |

- **Additional risks raised by other sources:**
  - **API gotchas (G3):** ECOSTRESS v003 vs AppEEARS v002; no ECOSTRESS ET/ESI in GEE; SoilGrids REST paused; CropScape Albers coordinates; CropScape web viewer behind a CropSmart sign-in (G1).
  - **Credibility (F7):** "agronomy model lacks credibility". Missing data must not count as zero.
  - **Hallucination and scale (RP):** a fine image cannot establish fine-scale wind or soil moisture; "Detailed imagery does not increase the information content of coarse climate products."
  - **Cultivation vs suitability label bias (RP).** A causal-claim limit: switching gains need matched trials or a calibrated process model.

---

## 12. Conflict and addition summary against the build brief
| Brief item | Status | Notes |
|---|---|---|
| CesiumJS globe + MapLibre fallback | CONFIRMS | BP & RP; BP adds Resium, two licensing modes, GIBS/S2/NAIP zoom stack, PMTiles, TiTiler. G3 would defer the globe post-event. |
| React/TS/Vite | CONFIRMS | BP; adds Zustand, i18next, D3/Plot/visx, PWA, ONNX Runtime Web |
| FastAPI | CONFIRMS | BP & RP; adds Pydantic, Redis, RQ/Celery |
| DuckDB | **CONFLICT** | BP and RP specify PostgreSQL + PostGIS (+ h3-pg); GeoParquet/Zarr/COG in object storage. DuckDB is not mentioned for FarmSmart in any source. |
| M1–M12 | CONFIRMS | BP; RP and G3 urge a simpler first package (rules + baselines; LightGBM only with data support; conformal and model cards post-event). Fit Score formula is in BP. |
| Six strategy families | CONFIRMS | BP A–F = RP 1–6 (names in §6.1) |
| Pilots IA/KS/CA/SK/Punjab/Mato Grosso | CONFIRMS | BP exactly; plus an optional Kenya Rift Valley / Andalusia. G3/GPT/F7 say one pilot for the weekend. |
| Climate Twins | CONFIRMS (BP) / CONFLICT (RP) | RP puts it in the advanced roadmap; RP prefers a transparent NN distance over plain Mahalanobis. |
| Drought Replay | CONFIRMS | BP Field Twin (2012 drought, 2019 wet spring); RP Resilience Planner historical replay. BP lists the Field Twin 3D time-lapse first to cut. |
| Ranked strategy cards with uncertainty | CONFIRMS | five required sections + check locally + try-it-small; RP keeps three uncertainty types separate. |
| Wind/soil-cover hook | ADD | RP's central competitive story; BP has "Wind & cover" rose and Wind alert. |
| "What changes the choice?" priority flip | ADD | F7, GPT, G3, RP, BP alt shot 4. |
| Crop Sequence Boundaries (USDA) | ADD | G2 #35: 8-yr sequences + boundaries, 2008–2025. |
| Data-version gotchas | ADD/CONFLICT | ECOSTRESS v003, IMERG 1998, SoilGrids REST paused, CropScape Albers → use GEE CDL. |
| Performance budgets | CONFLICT | BP: cached < 2 s, slider < 150 ms; RP: cached < 5 s. |
| Economics in v1 | CONFLICT | BP includes; RP says expanded version; F7 says no profit promises. |
| Numeric agronomy parameters (Kc, RUSLE C/P, wind thresholds, GDD) | GAP | not in any source; must be sourced (FAO-56, WEPS, extension) |
