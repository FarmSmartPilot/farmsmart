# FarmSmart: Design Digest

NASA Space Apps 2026, "Adapting Farms with NASA Data". A crop-rotation decision-support web app, desktop first and usable on iPhone.
Written by the design agent on 2026-11-14. "SI" means the model-assisted parts of the product. Write "SI" in the product, never "AI".

## Sources studied (top level of `<planning-inputs folder>`)

| Code | File | What it contains |
|---|---|---|
| **CL** | `claude Field_Shift_Main_Page_Concepts.pptx` | 5 slides. Each one is a full-bleed hi-fi mockup PNG (2400x1344, about 1200x672 logical at 2x) with a "Best for / What stands out" panel and a legend for NASA data, other data and SI model. Concepts: A Field Studio (recommended), B Globe Command, C Season Wheel, Idea 1 Next Move, Idea 2 Ask FarmSmart + Climate Twins. |
| **CH** | `chat Field Shift - Five Interface Concepts.pptx` | 5 slides built from native shapes on a 1600x900 canvas. The app frame sits at x40-1560, y113-834, which gives about 1520x721 of app. Images: an aerial Midwest patchwork basemap, a dark-teal Americas globe and the NASA insignia. Concepts: 1 Field Explorer (recommended default), 2 Rotation Studio, 3 Farmer Guide, 4 Season Wheel, 5 Climate Twins. |
| **GR** | `grok field-shift-webapp-screens.pdf` | 10 pages of marketing-style slides on navy, with dark-UI laptop mockups: landing page, globe home, draw/upload field, priorities, conditions, compare, rotation detail, water & climate outlook, data sources, share/export. |

Pixel figures for CL are estimated from the 2x PNGs and given as logical px. Figures for CH are exact shape coordinates, scaled from EMU to px on the 1600x900 canvas. Figures for GR are estimates from the screenshots.

---

## Part 1: Concept-by-concept analysis

### CL-A: Field Studio ("field, season and options on one screen"), RECOMMENDED by its author

**Layout** (1200x672 logical; the body sits below a 52px top bar):

| Region | x / width | y / height | Content |
|---|---|---|---|
| Top bar | full | 0-52 | `FarmSmart` wordmark (bold navy, about 20px), search pill (about 400w, placeholder "Search lat, lon · state · city"), "Saved fields ▾", **Simple / Expert** segmented toggle (Simple selected = filled green), "3D · 2D", outlined "Export report" button |
| MY FIELD (left) | 12-252 (**about 240w**) | 64-658 | Card with field identity and a checklist of facts, then MY PRIORITIES, then the primary CTA |
| Map (center) | 264-780 (**about 516w**) | 64-444 | Oblique 3D patchwork field view |
| ROTATION OPTIONS (right) | 792-1188 (**about 396w**) | 64-444 | 3 stacked option cards |
| SEASON TIMELINE (bottom) | 264-1188 (**about 924w**, spans center + right) | 456-658 | 2-year aligned Gantt lanes |

**Components**
- *MY FIELD*: overline "MY FIELD", then H2 "Field 12 · Story Co., Iowa" and the subline "64 ha · confirmed Nov 2026". Six fact rows follow, each with a green check, a bold label, a one-line value and a NASA/other data badge: Boundary "Confirmed outline"; Crop history as five year chips ('21-'25, wheat/green alternating for corn/soy); Soil "Silty clay loam · drains well"; Slope "2-5% · erosion-prone"; Water "Rainfed (no irrigation)"; Equipment "No-till drill · no baler".
- *MY PRIORITIES*: three drag-to-rank pills with ⋮⋮ grips, each tinted by theme: 1 Stop erosion (soil tint), 2 Build soil (green tint), 3 Save water (sky tint).
- Primary CTA at the bottom: "Compare rotations →", a full-width dark green button about 36px tall.
- *Map*: top-left chip "NAIP imagery · Jul 2024 · 0.6 m" with a data badge. The field outline is yellow (#F5C842-ish) with the label "Field 12". A **wind rose** sits in a top-right circle, labelled "Wind · March–April". A red heat-tint ellipse marks risk. The caption chip reads "Red tint = windy weeks over bare soil (Mar–Apr)". Layer chips along the bottom: Cover / **Wind** (selected = navy fill) / Rain / Soil moisture / Heat / Soils.
- *ROTATION OPTIONS*: the header shows "ROTATION OPTIONS" with the link "3 of 14 feasible · why not others? →" in sky blue. Each card is about 108 tall and holds a **petal glyph** (a radial flower in a 72px circle, one petal per priority/metric, colored by option), a title, an italic subtitle, "match [SI]" with a bar and a %, and a confidence pill (outlined wheat for Med, alert red for Low) with an SI badge. The recommended card has a green tint and a 2px green border plus a "Best for you" pill.
  - Current: Corn → Soybean, "baseline · bare Nov–Apr", 52%, Confidence Med.
  - A · + cereal rye cover, "fills both bare windows", **86%**, Med, Best for you.
  - B · + oats & red clover, "3-year, breaks pest cycle", 81%, Low.
- *SEASON TIMELINE*: the header reads "SEASON TIMELINE · 2 years, aligned [SI]". The legend has "▮ windy weeks" (alert red) and "▮ heavy-rain weeks" (sky), each with a data badge. A **hazard strip** of red and blue bars runs above a 24-month axis (J F M A M J J A S O N D ×2), and vertical translucent bands drop through all lanes. Lanes: Current / A · + rye / B · + oats/clover. Crop blocks are solid (corn wheat-yellow, soy green, rye teal, oats tan, clover magenta), and **bare soil is a red diagonal hatch**. The footer reads "Evidence:" followed by the chips POWER wind, IMERG rain, HLS bare-soil months (sky tint = NASA), CDL history, SSURGO soil (grey = other). The right-aligned alert-red KPI reads **"Bare + windy overlap: 9 weeks → 2 weeks with A"**.

**Hierarchy**: field name, then the map, then the recommended card (tint plus pill), then the timeline KPI in red. The eye path runs left to right and then down, which suits the mental model "here is my field, here is what it could be, here is when it matters".
**Colors**: white cards on a #F6F8FA-ish canvas, navy text, green primary, wheat/teal/magenta crop hues, alert red for risk only.
**Charts**: wind rose, petal glyphs, match bars, Gantt with a hazard overlay and hatching.
**Interactions**: drag-rank priorities, which re-sorts the options; layer chips; "why not others?"; Simple/Expert; 3D/2D; clicking a timeline lane highlights the matching card.
**Strong**: everything that matters is on one screen; the timeline hazard alignment is the best "aha" visual in any deck; there is one clear CTA; the "why not others?" link builds trust; the provenance badges are consistent.
**Weak**: the petal glyphs are decorative and hard to read without a legend. The timeline is cramped at 3 lanes. "Confidence" and "match" both carry SI badges, which is badge noise. The map loses about 40% of its area to the wind rose and chips. Nothing in the page model says what the right card does on mobile.

### CL-B: Globe Command ("from orbit to an outlined field")

**Layout** (dark navy theme): top bar 52; LAYERS panel at left about 230w; map/globe center about 575w with a LAYER TIME MACHINE strip below it about 84 tall; FIELD DOSSIER on the right about 345w, as a light card on the dark page.
**Components**
- LAYERS list: a color dot, a name, the dataset as a grey subline, a data badge and a toggle. Rows: Soil moisture/SMAP, Rain & extremes/GPM IMERG, Heat & water stress/ECOSTRESS, Greenness/Landsat-HLS, Groundwater trend/GRACE-FO, Slope & erosion/SRTM + RUSLE (SI), Crop history/CDL, Field outlines/Fields of The World, Climate 2040s/NEX-GDDP-CMIP6. Below the list: a "⇆ Split-sky compare" button and a BASEMAP segmented control (Open / Google 3D).
- Map: a mini-globe inset at top-left with a yellow location dot; zoom +/−, N and reset controls in a vertical stack on the right; the label chip "Field 12 · 64 ha · selected" in yellow on navy; a dashed state-line overlay.
- LAYER TIME MACHINE: a play button, the title "soil moisture anomaly at this field", a sparkline from 2001 to 2026, a scrubber, and a purple "2040s" end pill for projection.
- FIELD DOSSIER: H2 plus "64 ha · silty clay loam · 2-5% slope · rainfed". Six tabs: Conditions / **Crops that fit** / Rotations / Risks / Profit / Alerts. "Fit score (suitability × yield × reliability) [SI]". Seven crop rows each have a bar colored in the crop hue and a High/Med/Low outlined pill. A Confidence: Medium callout (wheat tint) carries the reason chips "few local yield records", "clouds Jun 2025" and the action link "A soil test would raise confidence →". EVIDENCE chips follow, and the CTA is "Compare rotation strategies →".

**Strong**: an explorer/judge-friendly wow factor; the layer list doubles as a NASA-dataset inventory; the "what would raise confidence" link is excellent; the time machine with a projection tail is great for storytelling.
**Weak**: dark plus light panels together look inconsistent; nine toggles overwhelm farmers; a 7-crop "fit" list is a crop recommender, not a rotation recommender; the globe inset is decorative once you are zoomed in.

### CL-C: Season Wheel ("your year, the way you farm it")

**Layout**: a light-cream page. A guided steps panel sits at left about 250w. The wheel takes the center at about 420px diameter, with the H2 "Your rotation today: Corn → Soybean". ALTERNATIVES (ranked for you) runs down the right at about 240w as 3 cards. Two legend rows sit at the bottom.
**Components**
- Stepper: ✓ Find my farm, ✓ My current rotation, (3) What matters most with "Drag to rank" and 6 tinted pills (Stop erosion, Build organic matter, Save water, Extra income, Feed livestock, Break pest cycles), then (4) My limits greyed out. The CTA "Show my options →" is navy.
- Wheel: concentric rings, **outer = year 1, inner = year 2**. Months sit around the rim, starting at the top (D J F ...). Crop arcs are solid and bare months are red-hatched with "BARE" labels. Hazard icons (frost ✱, heavy rain ///, heat ☀, dry spell ⌒) sit on the rim at their months. The center KPI is **"7 bare months per year"** in red at 36px, with "heavy rain: May–Jun" below. A callout reads: "Bare-soil gap overlaps the heavy-rain window on 2-5% slopes → erosion risk".
- Alternative cards: a mini wheel about 120px, a letter heading (B/C/D), "+ cereal rye cover", "match [SI]" with a bar, "86% of priorities", "Confidence: Med" and a "tap for why →" link.
- Legends: hazard icons with their dataset names (frost; heavy rain (IMERG); heat (ECOSTRESS/POWER); dry spell (SMAP)) and the crop swatches.

**Strong**: the most farmer-native metaphor; the center KPI is instantly legible; hazards on the rim tie NASA data to calendar months; mini wheels make the alternatives visually comparable.
**Weak**: two concentric years are hard to read (the inner ring is compressed); a wheel start at December is unconventional; exact dates are hard; the CH notes say a linear calendar must remain available for accessibility. Better as a tab or view mode than as the main page.

### CL-Idea 1: Next Move (Expert mode)

**Layout**: a header strip "DETECTED HISTORY (CDL 2016–2025)" with 10 year chips (about 64x38 each, corn = wheat, soy = green) ending "→ 2026 ?", and a "✓ Looks right · edit" confirmation button at top right. The center-left has a **branch (Sankey-like) diagram**: a root node "2026: what next? after Soybean 2025" with curved flows to 4 option cards (about 325x75). Flow thickness equals the share of fields. TRADE-OFFS · pinned futures sits on the right (about 420x430). A SCENARIO chip bar runs across the bottom, with "Regret in dry years" bars on the right.
**Components**
- Option card: a left color stripe in the crop hue, a title, an italic intent ("usual next here", "fill the gap", "extend & diversify", "integrate forage"), "71% of fields here" with a grey bar and an SI badge, and **delta chips** ($ ●, soil ▼ red, water ●, risk ●; soil ▲ green; work ▼ red; "$ ?" for unknown). The selected card has a purple 2px border and extends to the follow-on chips "Corn '27" and "Soy '28".
- Trade-off chart: a scatter of Expected profit → (x) against Soil-health score ↑ (y). Points A-D sit in **uncertainty ellipses**, joined by a dashed purple "Pareto frontier", and A is annotated "existing".
- Scenario chips: Normal / **Dry** (selected = navy) / Hot / Wet / 2040s (SSP2-4.5), plus a purple outlined "Stress-test 45 weather years" button.
- "Regret in dry years": 4 mini horizontal bars, A red (high), B wheat, C green (low), D wheat.

**Strong**: the "usual next" share is honest social proof; delta chips compress trade-offs well; uncertainty ellipses are good science communication; scenario switching plus regret makes the risk legible.
**Weak**: dense; the Sankey adds little beyond the % bars; the Pareto plot needs axis units; purple is overloaded (selection, frontier and stress test).

### CL-Idea 2: Ask FarmSmart (copilot + Climate Twins)

**Layout**: a chat panel at left about 360w; a large globe in the center about 480px diameter on a lavender halo; a right stack about 265w: a CLIMATE TWIN · 2040s card (purple border), 3 STRATEGIES, and CHECK LOCALLY (alert-tint card). Top-right language switcher: EN · ES · HI · PT · SW.
**Components**: user bubbles have a lavender fill and are right-aligned. System answers sit in grey cards with dataset chips (GRACE-FO, NWIS, SMAP; POWER, NEX-GDDP). Example answer copy: "Re-ranked: strategies needing a no-till drill moved down. Updated cards are on the right →". The input "Ask anything..." carries a purple mic button. On the globe, an arc runs from "Your farm" to "2040s climate twin (dashed = other models)". The twin card reads "Your climate is projected to resemble today's climate in the highlighted analog region." It shows Model agreement as **10 squares, 7 filled = "7 of 10"**, then "What grows there today:" with bars for Sorghum / Winter wheat / Sunflower. Strategies use petal icons with Conf: Med/Low. CHECK LOCALLY is a checkbox list (Well capacity & water rights; Herbicide carry-over to sorghum; Grazing lease / fencing; Crop insurance practice rules; Local elevator for sorghum).
**Strong**: the twin arc with dashed alternative models is a memorable uncertainty visual; the "7 of 10" agreement squares are simple and honest; CHECK LOCALLY is a superb responsible-SI pattern; multilingual.
**Weak**: chat-first hides structure; the globe is oversized relative to the information it carries; purple dominates.

### CH-1: Field Explorer (main page variation, recommended default)

**Exact layout** (canvas 1600; app frame x40-1560 = 1520 wide, y113-834 = 721 tall):

| Region | x | w | y | h |
|---|---|---|---|---|
| Top nav | 40-1560 | 1520 | 113-179 | **66** (divider at y179) |
| Left sidebar (tinted #F4F7F1) | 40 | **214** | 180 | 654 |
| Center content | 280 | **752** | 198 | about 600 |
| Right options | 1058 | **472** | 202 | about 560 |

- Top nav: wordmark at x64 (225w). Tabs **Explore / Plan / Monitor** at 90w each, with the active one marked by a 64x3 green underline (#237B4B). The search sits at x720 (455x40, radius pill, fill #F5F6F1, border #D9E2D8) with "Search city, state or coordinates". Then "My fields" and a 35px avatar "AS".
- Left sidebar: "MY FARM" overline, "North Field" and "Ames, Iowa". A nav list of 5 items (172x35, 53px pitch) has the active item on a #DFEBDD pill (186x41): Field overview / Compare rotations / Season calendar / Evidence / Saved plans. Pinned to the bottom: "128 acres", "Boundary confirmed" and an outlined "Edit field" button (165x33).
- Center: the H2 "Your field, this season" with "2027 planning" right-aligned. **3 KPI tiles at 240x88** with 16px gaps: Rainfall, last 30 days **2.4 in**; Typical spring wind **12 mph**; Available soil water **Moderate**, plus an (i) button. The map runs y about 360-700 with these elements: the chip "North Field selected" (163x31), a "3D" toggle (40x30) and the field outline in lime #D9FF95 (270x142). Bottom-left of the map holds layer pills Satellite / **Wind** (selected #EAF6D7) / Water / Soils, and bottom-right a "Layers" button. Below the map: "Season preview ... 2027" with 3 rounded bars (Winter cover 190w #BDD2AC, Corn 356w #E4CB8E, Cover 190w), each 31 tall.
- Right: "Three rotation choices", then "Priority: protect soil". **3 cards at 472x123**, 140 pitch (17px gap). Each card has a title, an SI badge (31x25, #237B4B) top-right, the sequence ("Corn / Rye / Soybean"), a benefit line and a caveat line ("Check termination and water use"). The selected card uses fill #F1F7EE with border #6C9C64. Then the primary "Compare full plans" (472x49, #237B4B).

**Strong**: a calm, clean, farmer-friendly look with a clear grid; the KPI tiles anchor the NASA evidence; every option card carries a caveat ("Check..."); the Explore/Plan/Monitor IA is good.
**Weak**: the season preview is too thin (1 year, no hazard overlay); there are no scores, so options are hard to compare; the sidebar nav duplicates the top tabs; the map is small (752x340).

### CH-2: Rotation Studio (planning-first)

- Header: "North Field / 128 acres in Ames, Iowa", then "Add crop" (outlined 140x42) and "Save plan" (green 155x42).
- **Rotation grid card** (x66, 1031x355, fill #FAFBF8): "Your rotation" with a **Timeline | Wheel** toggle (112/91 wide). Year columns 2027 / 2028 / 2029 sit at 250 pitch with a lane label column of 240. Lanes run at 71 pitch: Current (Corn, Soybean, Corn in #EAD8B1), More cover [SI] (Corn + rye ... in #BFD6B1), Forage option (Oats + clover, Corn, Soybean in #D8E6DE). Crop blocks are 230x31 pills. Helper text: "Select a crop to adjust dates and management".
- A compact map sits at right (x1120, about 406 wide), with "Evidence for this plan" and the Spring rainfall / Seasonal history card below it.
- **Comparison strip** (1460x139): "Compared with your current rotation", with columns More cover [SI] / Water demand: "Review spring use" [SI] / Equipment: "Confirm rye termination", an (i) button, and the primary button "View trade-offs".
- **Dark explanation popover** (#103B30, 375x146): "How this estimate works" then "Crop calendar + weather history / Model: regional crop-risk ranking / Uncertainty: residue is unconfirmed".

**Strong**: an editable multi-year plan; the timeline/wheel toggle; the popover pattern "How this estimate works" (input, model, uncertainty) is the best SI-explanation template in all the decks.
**Weak**: year-level granularity loses the within-season bare-soil story; there is no hazard overlay.

### CH-3: Farmer Guide (guided questions)

- H1 "What matters most for North Field?" (48px line) with the sub "Choose a priority. You can refine the details as you go."
- Step card 1 (870x168, #EDF3EC): "1 Your priority" with 4 big choice buttons at **54px tall** (Protect soil selected green / Use less water / Grow feed / Improve margin).
- Step card 2 (870x119): "2 Confirm one detail" and the question "Is this field irrigated?" answered by Rainfed (selected) / Irrigated at 43px.
- The map is on the right (x978-1526) with a field label card.
- "Options to explore" uses the sub "Your current rotation stays in the comparison." Three cards at 470x88 (Keep current / Add winter rye (selected #ECF4E5 / #81A774) / Add forage), plus a trust strip "NASA weather supports these comparisons".

**Strong**: the lowest cognitive load; "confirm one detail" (ask only the highest-value missing input) is a great SI pattern; big touch targets make it mobile-ready.
**Weak**: too sparse for desktop judges; it hides evidence.

### CH-4: Season Wheel (additional)

- Header "North Field / 2027" with Previous year / Next year buttons (154/160 wide).
- Left "Your plan" panel (298x545, #F3F6EF) with label/value pairs: Cash crop: Corn; Cover crop: Winter rye; Irrigation: Rainfed; Priority: Protect soil. CTA "Edit crop dates".
- Center: a single-year doughnut about 470 diameter centered at (679,524), with **Jan at top, clockwise**, month labels outside, and center text "2027 / Corn + winter rye". Legend pills: Cash crop #E8D5A7 / Living cover #CBDEBA / Residue: confirm #E6E9E0.
- Right "Seasonal risks": 3 cards at 512x88 (Spring wind history "Review cover timing"; Modeled soil exposure "Lower with cover" [SI]; Spring water balance "Check termination date" [SI]). A wheat-tinted card (#F5F1E6) reads "One detail would help: Confirm residue after harvest." CTA "Compare with current plan".

**Strong**: a single year with Jan at the top reads better than CL-C's two rings; "Residue: confirm" is an honest unknown state.
**Weak**: no hazard icons on the rim; risks are words, not data.

### CH-5: Climate Twins (additional, dark teal theme)

- A dark page (#0F2A2E-ish) with a teal panel (#16343A, border #355051) at left, 468x602.
- Copy: "Your farm in a changing climate", "North Field, Iowa". Future period selector "2041–2060" and Scenario "SSP2-4.5". "Projected seasonal climate", then "Find today's closest analogs [SI]".
- Callout (#24454A): "Similar climate is a starting point. Compare soils, daylight and water before exploring different crops."
- CTA "Explore candidate regions" (green 420x51), with the caption "Advanced concept".
- Globe on the right with a "Your farm" pin label and a "Candidate region / Check climate match and soils [SI]" card.
- Bottom strip (886x65): "Scenario comparison / Model agreement and mismatches stay visible".

**Strong**: the responsible framing copy is excellent and should be reused verbatim; the period and scenario selectors are the right controls.
**Weak**: no quantitative agreement visual (CL's 7-of-10 squares fill that gap); the dark theme breaks consistency.

### GR-1: Landing page

- Light cream page. Nav: logo with "FarmSmart", How it works / NASA data / For advisors / Open source, Sign in, and the dark CTA "Find your farm ›".
- Hero H1: "Choose your next rotation with **satellite eyes** on your field." The phrase "satellite eyes" is green. Sub: "FarmSmart turns NASA soil moisture, rainfall and crop-health data into plain-language rotation options for your farm, and shows you why each one fits."
- Search bar with the button "Find my farm". Ticks: "Free for farmers · No sensors needed · US first, global next". "POWERED BY OPEN DATA" chips. A 3-step strip: (1) Find your field → (2) Set your priorities → (3) Compare rotations.
- Hero visual: a satellite field photo with floating glass cards. "BEST ROTATION FIT 82/100" with mini bars; "EROSION RISK −34% vs. current corn-soy"; a NASA DATASET card "SMAP L4 Soil Moisture" (measures / resolution / date range / access, plus a "Used to..." line); "ROOT-ZONE SOIL MOISTURE 0.27 m³/m³ · near normal" with a sparkline.

**Strong**: a crisp value proposition; floating evidence cards over imagery are a great hero.
**Weak**: it is a marketing page; judges need the app.

### GR-2: Home "Start on a 3D Earth"

- Dark app shell. A 48px left icon rail (globe, map, sliders, drop, chart, doc, database; help and settings at the bottom). The breadcrumb "Earth > United States > Iowa". Status pills "US: full field data · Global: NASA layers (beta)".
- A floating "Find your farm / Step 1 of 4" panel (about 220w at screenshot scale, about 360 logical) holds the search, typed results (Field / County / City with icons), "Drop a pin" and "Upload KML / SHP", and RECENT FIELDS with a thumbnail and "Open".
- A **zoom-level pill bar** sits at the bottom center: − Globe / Country / **State** / County / Field +.
- A Map layers popover at bottom right has toggles (Satellite imagery, State & county outlines, Cropland types USDA CDL 2025, Soil moisture NASA SMAP · updated today, Drought stress outlook [SI] Next 30 days).
- A **NASA DATASET popover**: title, MEASURES / RESOLUTION / DATE RANGE / MISSION grid, a green "How we use it:" box, and "Open in NASA Earthdata ↗ · Free & open data".
- A hover card on the map: "Farm field near Ames" with crop chips and "Zoom to field ›".

**Strong**: the best globe home; the dataset popover anatomy is the definitive provenance pattern; the zoom-level bar is a great affordance.
**Weak**: dark UI everywhere reduces daylight readability for farmers on phones.

### GR-3 to GR-10: Workflow screens

- **Draw/upload field** (GR-3): a map with a drawing toolbar (select, polygon, rectangle, edit, delete) and "Upload shapefile / KML". The area label reads "118.4 acres / 5 points · 2.1 km edge" with the hint "Drag points to adjust". A right panel "STEP 1 · YOUR FIELD" holds stacked cards: Field boundary (Redraw, .shp/.kml); Soil profile (texture, OM 4.1%, water holding 0.19 in/in, from USDA SSURGO); Slope & erosion risk (2.4% avg, a semicircle gauge "Moderate", SRTM); Past crops (a 10-chip strip with "We think you grow **corn-soybean**. Right? ✓ Yes / Edit"); "Everything here is editable" with Continue. A stepper in the top bar reads Field → Priorities → Conditions → Compare.
- **Priorities** (GR-4): six sliders (Water use, Forage value, Nitrogen fixing, Erosion reduction, Organic matter, Market suitability) labelled Low/Medium/High/Top. Irrigation yes/no, a nitrogen-rate slider, and the live result "Top rotation · live 82 ... ↑ moved up 1". A **"Why #1 changed"** explanation card.
- **Conditions** (GR-5): the banner "Dry Augusts are getting more common / 4 of the last 6 Augusts had less rain than normal". Tiles: Soil moisture now 0.24 / 0.27; Rainfall vs normal as a monthly bar chart (dry month in wheat) with "8 of 10 Julys reliable · 3 extreme-rain days"; Drought risk next 60 days "Rising" [SI] as a band chart; Heat-stress days bar series 2001-2025; Frost window bar (Apr 28 – Oct ..., 164 frost-free days); NDVI 2016-2025 sawtooth with Corn/Soy chips.
- **Compare** (GR-6): "4 rotations for North 120, scored on your priorities". **4 columns**, each with a score (61 / 77 / **82 Best fit** / 74) and 6 metric mini-bars, a NASA badge per metric row, and the banner "Why oats/alfalfa wins here: ...". Detail view: a radar chart of 4 overlaid polygons, a "Why this fits North 120" bullet list with badges, a wheat-tinted "Evidence from Iowa research" card (Marsden Farm, Davis et al. 2012, 80-86% less synthetic N) and "Trade-offs: More labor at hay time; a local hay buyer helps."
- **Rotation detail** (GR-7): a 3x2 card grid (1 Why we suggest it · 2 Evidence · 3 Benefits · 4 Information gaps · 5 Risks to check locally · 6 Next step) with Fit 82 / Confidence Medium-high [SI] and "Talk to your extension agent".
- **Outlook** (GR-8): long-term tiles (Season rain "Steady, August drying"; Root-zone moisture "6 of 11 dry Augusts" as a diverging bar; Frost & heat 1990s vs 2020s; GRACE total water storage with the gap marked). A Season timeline with rotation chips (Oats/alfalfa · Wheat + clover · Rye cover · Corn-soy), 4 lanes with Plant/Harvest/Seed/Cut event pills, and **vertical risk bands "Late frost" and "Dry spell risk"**.
- **Data sources** (GR-9): the table "Where every number on North 120 comes from" with columns DATASET / MEASURES / DETAIL (bar + resolution) / DATES / CONFIDENCE (Regional / Coarse / Field / Trend only / Good). A "Model results (SI)" list and "Notes for your extension agent".
- **Share** (GR-10): Download PDF / Print, a share link with Copy, "Send to" chips (Extension agent, Agronomist, + Add email), include toggles (data sources, SI model notes, notes for advisor), and a one-page report preview. Disclaimer: "FarmSmart supports your judgment. It does not replace it, or local expertise."

**Strong** (GR overall): the most complete end-to-end flow; the dataset popover; the "We think you grow X. Right?" confirmation; "Why #1 changed"; the data-sources confidence table; the share report.
**Weak**: everything is dark navy with small type (about 11-12px in mockups); the radar chart is hard to compare; the stepper wizard adds friction for return visits.

---

## Part 2: Cross-cutting patterns to keep

1. **Provenance badges** on every number: a NASA data badge (navy), other data (grey), SI model (green "SI"). **Do not use the NASA insignia (meatball)** on badges, even though GR and CH do. NASA brand rules restrict the insignia and Space Apps forbids implying endorsement. Use a neutral satellite glyph in navy instead, and put the words "NASA data" in the popover.
2. **Dataset popover** (GR): name, MEASURES / RESOLUTION / DATE RANGE / MISSION, "How we use it:", "Open in NASA Earthdata ↗".
3. **SI explanation popover** (CH-2): "How this estimate works", then Inputs, Model, Uncertainty.
4. **Confidence** as a 3-level pill (High green / Med wheat / Low alert), always with "what would raise confidence →" (CL-B).
5. **Confirm detected facts**: "We think you grow corn-soybean. Right? ✓ Yes / Edit" (GR-3), "✓ Looks right · edit" (CL-Idea1), "One detail would help" (CH-4).
6. **Bare-soil hatch × hazard bands** (CL-A, GR-8): the signature visual. Keep it on Field Studio and the Season Wheel.
7. **Current rotation is always a comparison row** ("Your current rotation stays in the comparison.").
8. **CHECK LOCALLY** checklist and "Talk to your extension agent".
9. **Simple / Expert** toggle; **3D / 2D** toggle.
10. Disclaimer in the footer and the PDF: "FarmSmart supports your judgment. It does not replace it, or local expertise."

### Copy bank (reuse verbatim or near-verbatim)
- "Choose your next rotation with satellite eyes on your field."
- "Field, season and options on one screen."
- "3 of 14 feasible · why not others? →"
- "Best for you" · "fills both bare windows" · "baseline · bare Nov–Apr" · "3-year, breaks pest cycle"
- "Red tint = windy weeks over bare soil (Mar–Apr)"
- "Bare + windy overlap: 9 weeks → 2 weeks with A"
- "7 bare months per year" · "Bare-soil gap overlaps the heavy-rain window on 2-5% slopes → erosion risk"
- "A soil test would raise confidence →"
- "Your current rotation stays in the comparison."
- "One detail would help: Confirm residue after harvest."
- "How this estimate works · Crop calendar + weather history · Model: … · Uncertainty: …"
- "usual next here" · "fill the gap" · "extend & diversify" · "integrate forage" · "71% of fields here"
- "Stress-test 45 weather years" · "Regret in dry years"
- "Your climate is projected to resemble today's climate in the highlighted analog region." · "Model agreement 7 of 10"
- "Similar climate is a starting point. Compare soils, daylight and water before exploring different crops."
- "Dry Augusts are getting more common. 4 of the last 6 Augusts had less rain than normal."
- "We think you grow corn-soybean. Right?" · "Everything here is editable."
- "Why #1 changed" · "Where every number comes from"
- "FarmSmart supports your judgment. It does not replace it, or local expertise."

---

## Part 3: Design tokens for the synthesis

All spacing is on a **4px scale**: 4, 8, 12, 16, 20, 24, 32, 40, 48, 56, 64.

| Token | Hex | Use |
|---|---|---|
| `--navy` | #0E2A47 | Text primary, top bar on Globe, selected chips, NASA badge |
| `--field` | #2E7D4F | Brand primary, CTAs, selected states, "Best for you" |
| `--si` | #1E8E4E | SI badge and SI action buttons only |
| `--wheat` | #C8902A | Corn, Medium confidence, caution |
| `--sky` | #2F7FB5 | Water/rain, links, NASA evidence chip tint |
| `--soil` | #8A5A3B | Soil/erosion priorities, residue, soil metrics |
| `--alert` | #C2483A | Bare-soil hatch, hazard (wind) bands, Low confidence, regret |
| `--purple` | #6B4FA0 | Climate future / projections / Climate Twins **only** |
| `--surface` | #F6F8FA | Page canvas |
| `--card` | #FFFFFF | Cards; border #DDE3EA, radius 12; shadow 0 1px 2px rgba(14,42,71,.06) |
| `--ink-2` | #4A5B6E | Secondary text |
| `--ink-3` | #7A8899 | Tertiary text, axis labels |
| Tints | field 10% #E6F1EA · wheat 12% #F7EEDD · sky 10% #E5EFF7 · alert 10% #F7E6E4 · soil 10% #F1EBE6 · purple 10% #EEEAF5 | Chip/pill fills, selected cards |

**Crop palette** (map, timeline, wheel; derived from the brand palette): Corn #D9A53A (wheat, lighter) · Soybean #5FA36A · Wheat/small grain #C9B37E · Cereal rye cover #2F8C7A (teal) · Oats #B9A270 · Clover #A3568A · Alfalfa #2E6B3E · Sorghum #B4613A · Fallow/bare = alert hatch (45°, 2px stroke #C2483A on #F7E6E4, 6px spacing).

**Type**: Inter (or system UI). Sizes: 12 (meta, chips), 14 (body), 16 (card titles), 20 (panel H2), 24 (page H1), 32/40 (KPI numerals). Overlines are 12px, semibold, +0.06em tracking, uppercase, `--ink-2`.
**Badges**: SI badge 20x20 circle (16px in dense rows), #1E8E4E, white "SI" 10px bold. NASA badge 20x20 navy circle with a white satellite glyph. Other-data badge grey #8A97A6.
**Hit targets**: at least 32px on desktop and at least 44px on mobile.

---

## Part 4: Recommended synthesis

The primary page is **Field Studio**: CL-A's layout and timeline, plus CH-1's calm styling and caveat lines, plus GR's provenance popovers. Everything else sits in tabs of one shell. Light theme throughout. Dark navy appears only on the Globe Home and as the Climate Twins accent, not as a whole theme.

### Global shell (desktop)
- **Top bar 56px**, white, with a 1px bottom border #DDE3EA. Contents from the left:
  - x24: the wordmark FarmSmart, 20px/800, navy.
  - x216: the search pill, **400x36**, radius 18, fill #F6F8FA, 16px search icon, placeholder "Search lat, lon · state · city".
  - Center-right: view tabs **Field Studio · Compare · Next Move · Season · Climate · Drought** (14px/600, 32 tall, 16px horizontal padding, active underline 3px `--field`). Expert-only tabs (Next Move, Drought) appear when Expert is on.
  - Then "Saved fields ▾", the Simple/Expert segmented control (**152x32**, 2 segments of 74, selected = `--field` fill, white text) and the 3D·2D toggle (72x32).
  - x1440-24: "Export report", outlined `--field`, **128x36**.
- Canvas `--surface`, outer padding 12, gutters 12. Card radius 12, card inner padding 16.

### (1) Globe Home (1440x900)
- **Background**: a full-bleed 3D globe (CesiumJS or MapLibre globe) on navy #0E2A47 into #08182A radial. The top bar is 56px, transparent over the globe, with white text.
- **Hero / search card** (first visit): left floating card at x24, y80, **384w**, auto height (about 440), fill rgba(255,255,255,.96), radius 16, padding 24.
  - Overline "NASA SPACE APPS 2026 · OPEN EARTH DATA".
  - H1 32/40 "Choose your next rotation with satellite eyes on your field." ("satellite eyes" in `--field`).
  - Body 14 (2 lines).
  - Search input 336x48 with the button "Find my farm" (120x40 inside, `--field`).
  - Typed result rows 56px tall (icon 32, title 14/600, sub 12): Field / County / City.
  - A row of 2 secondary buttons at 164x40 each, 8 gap: "Drop a pin" and "Upload KML / SHP".
  - RECENT FIELDS: rows 56 with a 40x40 thumbnail and "Open".
  - Ticks in 12px: "Free for farmers · No sensors needed · US first, global next".
  - After the first visit the card collapses to a 384x48 search bar.
- **Zoom-level bar**: bottom center, y = 900-24-40, **392x40**, radius 20, white 96%. Contents: − Globe · Country · State · County · Field + (each segment 64x32; active `--field` fill).
- **Layers panel**: right at x1440-24-296, y80, **296w**, rows 48 (dot 8, name 14/600, dataset 12 `--ink-3`, data badge 20, toggle 36x20). It holds 6 layers by default (Satellite imagery, State & county outlines, Cropland types (CDL), Soil moisture (SMAP), Rain (IMERG), Drought outlook [SI]), with "More layers" for the rest.
- **Dataset popover**: 320w, padding 16. It holds the title, a 2x2 meta grid (MEASURES/RESOLUTION/DATE RANGE/MISSION, 12px labels), a "How we use it:" box (`--field` 10% tint, padding 12) and the link "Open in NASA Earthdata ↗".
- **Map hover card**: 248w, 64x64 thumbnail, crop chips and "Zoom to field ›".
- **Time strip** (optional, Expert): bottom-left, 480x64. Play 32 button, sparkline, year scrubber 2001→2026, purple "2040s" tail pill.
- **Selection**: on field select, fly-to animation (about 2.5s), the field outline draws itself (yellow #F2C230, 3px), then Field Studio slides in from the right.

### (2) Field Studio main page (1440x900)

```
y0    ┌──────────────────────────── TOP BAR 56 ─────────────────────────────┐
y56   ├─12─┬────────┬─12─┬──────────────────────┬─12─┬───────────────┬─12─┤
y68   │    │MY FIELD│    │ MAP 848x568          │    │ROTATION OPTS  │    │
      │    │ 200w   │    │                      │    │ 344w x 568    │    │
y636  │    │ x12    │    ├──────────────────────┴────┴───────────────┤    │
y648  │    │ 820h   │    │ SEASON TIMELINE 1204w x 240 (x224..1428)   │    │
y888  └────┴────────┴────┴───────────────────────────────────────────┴────┘
```

- Columns: x12 left (200w), x224 map (848w), x1084 options (344w), ending at x1428 with a 12 right margin. Rows: body y68-888 (820h). The map and options run y68-636 (568h). The timeline runs y648-888 (240h) and spans x224-1428 (1204w).

**MY FIELD (200x820, card, padding 16 → 168 content width)**
- Overline "MY FIELD" (12).
- H2 16/700 "Field 12 · Story Co., Iowa" (wraps to 2 lines). Sub 12 "64 ha · confirmed Nov 2026".
- 16 gap, then fact rows, each 48 tall with an 8 gap: a check 16 (`--field` 10% circle), label 14/600, value 12 `--ink-2`, data badge 16 right-aligned. Rows: Boundary · Crop history · Soil · Slope · Water · Equipment.
  - Crop history value is 5 year chips at **28x20**, radius 4, 4 gap (5×28 + 4×4 = 156), corn `--wheat` and soy #5FA36A, white 11px text.
- Divider at 16 margin, then "MY PRIORITIES" overline. Three drag pills at **168x36**, 8 gap, radius 8, tinted (soil / field / sky 10%), 14/600 text with the rank number and a ⋮⋮ 16 grip. Then "+ Add priority" as a text button 32.
- Bottom-pinned primary "Compare rotations →" **168x44**, `--field`, radius 10.
- Expert mode adds "Edit field" as an outlined 168x32 button above it.

**MAP (848x568, radius 12, overflow hidden)**
- Top-left chip at 12/12: "NAIP imagery · Jul 2024 · 0.6 m" plus a badge, 28 tall, padding 0 12, white 92%.
- Top-right at x-12: a vertical control stack 36x36 each, 4 gap (+, −, N, reset). Left of it, a wind rose inset at **120x120** (white 90% circle) labelled "Wind · Mar–Apr", shown only when the Wind layer is on.
- Field outline 3px #F2C230 with label chip 28 tall "Field 12".
- Bottom-left: legend caption chip, 28 tall, alert-tinted, e.g. "Red tint = windy weeks over bare soil (Mar–Apr)".
- Bottom row at y-12: layer chips 32 tall, padding 0 14, 8 gap: Cover · Wind · Rain · Soil moisture · Heat · Soils. Selected = navy fill, white text.
- Bottom-right: "Layers" 32 tall.

**ROTATION OPTIONS (344x568, card, padding 12)**
- Header row 40: overline "ROTATION OPTIONS" left; link right "3 of 14 feasible · why not others? →" (12/600 `--sky`, may wrap; alternatively put the link on its own 20 line).
- 8 gap, then 3 option cards at **320x160** with an 8 gap, radius 10, border #DDE3EA, padding 12. Card internals:
  - Row 1 (24): title 16/700 ("A · + cereal rye cover") with the SI badge right.
  - Row 2 (20): italic 13 `--ink-2` intent ("fills both bare windows").
  - Row 3 (20): a **mini 2-year strip** at 296x12 (24 months, crop colors + bare hatch). This replaces the petal glyph and ties the card to the timeline.
  - Row 4 (20): "Match" 12, bar 168x8 radius 4 `--field` on #E6ECF0, % 14/700.
  - Row 5 (24): confidence pill (24 tall, outlined: High field / Med wheat / Low alert) with a "Why?" text link.
  - Row 6 (16): caveat 12 `--ink-3` ("Check termination and water use").
  - Simple-mode height: 12 pad + 24 + 4 + 20 + 8 + 12 + 8 + 20 + 8 + 24 + 12 pad = 152, plus 8 slack = **160** ✓. In Simple mode the caveat lives in the "Why?" popover. Expert mode adds the 16px caveat row (+4 gap), which makes cards 180, and the column scrolls.
  - Recommended card: fill `--field` 10%, border 2px `--field`, and a "Best for you" pill (24 tall, `--field` fill) top-right in place of the SI badge, which moves next to Match.
  - The first card is always "Current: Corn → Soybean · baseline · bare Nov–Apr".
- Clicking a card highlights its lane in the timeline and sets the map "Cover" layer to that option.

**SEASON TIMELINE (1204x240, card, padding 16)**
- Header row 24: "SEASON TIMELINE · 2 years, aligned" with the SI badge. At right, legend chips "▮ windy weeks" (alert) and "▮ heavy-rain weeks" (sky), each with a data badge.
- 8 gap. **Hazard strip** at 8 tall (red and blue bars by week), then the month axis 16 tall (12px `--ink-3`, J…D ×2).
- Lane label column **104w**. Plot width = 1204 − 32 − 104 = 1068, so use **1056 = 24 months × 44px** (12 right slack for a "today" marker label).
- 3 lanes at **32 tall**, 8 gap (112 total). Crop blocks have radius 4. Bare = alert hatch. Hazard weeks are drawn as vertical bands at 8% opacity through all lanes.
- 12 gap, then the footer row at 24: "Evidence:" followed by chips at 24 tall (NASA = sky 10% fill + sky text; other = #EEF1F4 + `--ink-2`): POWER wind · IMERG rain · HLS bare-soil months · CDL history · SSURGO soil. Right-aligned KPI 14/700 `--alert`: "Bare + windy overlap: 9 weeks → 2 weeks with A".
- Height check: 16 + 24 + 8 + 8 + 16 + 4 + 112 + 12 + 24 + 16 = 240 ✓.
- Interactions: hovering a week shows a tooltip with the week's wind/rain values and dataset; a "Wheel" icon toggle (24) at the header right switches to the Season Wheel.

### (3) Strategy Compare (1440x900)
- Shell top bar 56. Page header at y68, 56 tall: H1 24 "4 rotations for Field 12, scored on your priorities" with priority chips beneath (12px). Right: "Edit priorities" (outlined 36) and "Export report".
- **Strategy columns**: 4 cards in a row at y136, **339x412**, 16 gaps (4×339 + 3×16 = 1404 → margins 18; use 336w and 16 gaps = 1392, with 24 margins). Order: Current first, then by score. Column card:
  - Header 64: crop-sequence chips (20 tall) above the title 16/700. The "Best fit" pill sits above the best card, which has a 2px `--field` border.
  - Score row 56: score 40/700 ("82") with "/100 fit" 12 and an SI badge.
  - Mini 2-year strip 304x12.
  - **6 metric rows at 32** (Water use, Forage, N fixing, Erosion, Organic matter, Market): label 12, bar 120x8 (colored by metric family: water `--sky`, soil `--soil`, feed `--field`, market `--wheat`), value 12/700, data/SI badge 16.
  - Confidence pill row 32. Caveat 12.
- Below at y564: **two panels, 16 gap**:
  - "Why Rotation C wins here" (**688x312**): 3 bullets, each with a badge, and the wheat-tint evidence card "Evidence from Iowa research: Marsden Farm (2003-2011) … 80-86% less synthetic N. Davis et al. 2012".
  - "Trade-offs" (**688x312**): the Pareto scatter from Next Move (soil-health vs expected profit, uncertainty ellipses), or for Simple mode a **dot-plot matrix** (metrics × strategies). Use this instead of GR's radar chart, which is hard to compare.
- Bottom sticky bar 56: "Your current rotation stays in the comparison." with the buttons "Pin to plan" and "Share with advisor".

### (4) Next Move, Expert tab (1440x900)
- Header 56: "Next Move · Field 12 · Expert mode".
- **History strip** at y80, 72 tall: overline "DETECTED HISTORY (CDL 2016–2025)" with a data badge. 10 chips at **88x48**, radius 8, 8 gap (10×88 + 9×8 = 952), text "Corn / 2016" 14/700 + 12. Then "→ 2026 ?" 24/700 navy. Right-aligned "✓ Looks right · edit" (outlined `--field`, 184x36).
- **Branch area** y168-748 (580h), x24-952 (928w):
  - Root node **200x72** at the left middle ("2026: what next? / after Soybean 2025").
  - 4 curved flows (stroke width ∝ share, 2-24px, #9AA8B6).
  - 4 option cards at **560x120**, 16 gap, x368. Each has a 6px left stripe in the crop color, title 18/700, italic intent 13, "71% of fields here" with a 200x8 grey bar + SI, and delta chips 24 tall (▲ `--field`, ▼ `--alert`, ● `--ink-3`, "?" = unknown).
  - The selected card has a 2px `--navy` border (not purple), plus follow-on chips "Corn '27 / Soy '28" at 88x32 to its right.
- **Trade-offs panel** x976-1416 (**440x560**), y168: "TRADE-OFFS · pinned futures" [SI]. The scatter has axes "Expected profit ($/ha) →" and "Soil-health score ↑" with units. Points are 24px letter discs with ellipses at 20% tint. The dashed Pareto line is `--navy` 1.5px; the "existing" label sits on A.
- **Scenario bar** y772-820: overline "SCENARIO", then chips 36 tall Normal / Dry / Hot / Wet, plus "2040s (SSP2-4.5)" in a purple outline (the only purple, since it is a projection). The button "Stress-test 45 weather years" is `--si` filled with an SI badge.
- **Regret in dry years**: at the right of the same bar, 4 bars at 96x8 with letters.

### (5) Season Wheel (1440x900)
- Header 56: "Season Wheel · Field 12" with the year switcher ‹ 2027 › (outlined 36), a **Wheel | Timeline** toggle (152x32, for accessibility) and "Print 1-page plan".
- Left panel **296w** (x24, y80-876): "Your plan" with label/value pairs (Cash crop, Cover crop, Irrigation, Priority) at 48 rows, then MY PRIORITIES drag pills (264x36). CTA "Show my options →" 264x44.
- **Wheel** centered in x336-1088 (752w): diameter **560**, center (712, 476).
  - **One year per view** (CH-4 style; Jan at the top, clockwise).
  - Outer ring = this plan (56 thick). Inner ring = current rotation for comparison (40 thick, 60% opacity), with an 8 gap.
  - Months are labelled outside at r+20 (12px).
  - Hazard icons sit on a 28px icon track outside the ring (frost, heavy rain, heat, dry spell; 24px icons in 10% tinted circles).
  - Bare = alert hatch.
  - Center: KPI 40/700 `--alert` "7 bare months" with 14 "per year" and 12 "heavy rain: May–Jun" + badges.
  - Callout card 280w, alert 10% tint, anchored with a 1px dashed leader line: "Bare-soil gap overlaps the heavy-rain window on 2-5% slopes → erosion risk".
- Right **ALTERNATIVES** (x1112-1416, **304w**): 3 cards at 304x232, 12 gap. Each has a 120px mini wheel, letter + title, "86% of priorities" with a bar, a confidence pill, and "tap for why →". The best card is `--field` tinted.
- Legend row at y848: hazard icons with datasets + crop swatches, 12px, 24 tall.

### (6) Climate Twins (1440x900)
- Light page, purple accent only. Header 56: "Climate Twins · Field 12", with a language selector at the right (EN · ES · HI · PT · SW, 12/600).
- **Left controls** (x24, **360w**, y80-876; card with `--purple` 10% header band 56):
  - H2 "Your farm in a changing climate".
  - "Future period" segmented control at 312x36 (2021–2040 / **2041–2060** / 2061–2080).
  - "Scenario" select at 312x36 (SSP2-4.5 / SSP5-8.5).
  - "Projected seasonal climate" mini chart: 12-month temperature and precip, now vs future (312x120, now = `--ink-3` line, future = `--purple` line).
  - Primary "Find today's closest analogs" with SI (312x44, `--si`).
  - Callout (purple 10%): "Similar climate is a starting point. Compare soils, daylight and water before exploring different crops."
- **Center map/globe** (x400-1040, **640x796**): an arc from "Your farm" to the "2040s climate twin". The arc for the model ensemble mean is 3px `--wheat` solid; individual models are 1px dashed endpoints (dots) with the label "dashed = other models". The candidate region is a purple 20% fill.
- **Right stack** (x1064, **352w**):
  - CLIMATE TWIN · 2040s card (2px `--purple` border, 232 tall). Copy: "Your climate is projected to resemble today's climate in the highlighted analog region." Model agreement: **10 squares at 20x20, 4 gap** with 7 filled `--purple`, plus "7 of 10". Then "What grows there today:" with 3 crop bars at 96x8.
  - "Strategies to explore" card (180 tall, 3 rows at 48: name 14/600 + Conf pill).
  - CHECK LOCALLY (alert 10% tint, 5 checkbox rows at 32).

### (7) Drought Replay (1440x900, Expert; new synthesis)
Purpose: "What would each rotation have faced in a real drought year?" It combines CL-B's Layer Time Machine, CL-Idea1's "Dry" scenario and regret, and GR-8's season timeline with risk bands. It tests strategies against **historical observed** weather, not projections.
- Header 56: "Drought Replay · Field 12". Year chips 36 tall: **2012** · 2021 · 2023 · "Pick year ▾". Each chip carries a severity dot (alert / wheat).
- **Data caveat chip**: SMAP starts in 2015, so 2012 uses POWER, IMERG and modelled root-zone moisture. Show this as an info chip in the header (with the label "Data: POWER + IMERG (SMAP from 2015)").
- **Replay map** (x24, y80, **760x480**): the field and surroundings with a weekly soil-moisture anomaly (diverging brown→white→blue, using `--soil` and `--sky`). A top-left date chip reads "Week 27 · Jul 2, 2012". A bottom-center playback bar sits at 712x48: play/pause 32, speed 1x/2x, and a week scrubber with the season's dry weeks pre-marked as alert ticks.
- **Right panel** (x800, **616x480**): "How each rotation would have fared".
  - 4 strategy rows at **616x96**, 12 gap. Each has a name + mini strip, then 3 metrics: "Bare + dry weeks", "Water stress days" and "Yield hit vs. normal (SI)" (bar with an uncertainty whisker). A "Regret" bar 120x8 sits at the right.
  - The best row is `--field` tinted.
- **Bottom: Replay timeline** (x24, y576, **1392x300**):
  - Plot 1: daily root-zone soil-moisture percentile line (sky). It has the "normal" band (grey 20%), dry-spell bands (alert 10%) labelled "Dry spell", and a callout "Driest 3 weeks since 1981".
  - Plot 2: aligned rotation lanes (32 tall ×4) with bare hatch; the cursor syncs with the map scrubber.
  - Footer evidence chips: POWER · IMERG · GLDAS/SMAP · CDL.
- KPI line (14/700): "In 2012, Current had 11 bare + dry weeks; A had 3."

### (8) Mobile tabbed layout (iPhone 390x844)
- **Status/safe area** 47 top. **App bar 56**: wordmark 18/800 left; search icon 44x44 and Simple/Expert as an overflow menu (44x44) right. Below it, a field switcher row 40: "Field 12 · Story Co. ▾" plus a confidence pill.
- **Bottom tab bar 56 + 34 home indicator**. 5 tabs at 78w: **Map · Field · Options · Season · Ask**. Icon 24 plus label 11, active `--field`. Compare, Next Move, Climate and Drought live under "Options ›" sub-nav and "More" in the overflow.
- Content area 844 − 47 − 56 − 40 − 90 = **611 tall**, side padding **16** (358 content width).
- **Map tab**: full-bleed map (390x611) with a draggable bottom sheet (peek 120 / half 360 / full 560) holding the top option summary and the "Compare rotations" CTA. Layer chips scroll horizontally at the top (32 tall, 8 gap). Controls are 44x44.
- **Field tab**: MY FIELD facts as 56-tall rows (358w), year chips at 56x28, then the priorities drag list with 48-tall pills.
- **Options tab**: option cards 358w × about 168, 12 gap (same internals as desktop, with 44-tall touch rows). Sticky footer CTA "Compare full plans" at 358x48, 16 above the tab bar. Compare becomes a **horizontal swipe carousel** of the 4 strategy columns (each 320w with 16 peek) and a page-dot indicator.
- **Season tab**: Timeline by default as a **1-year** horizontal plot (12 months × 26 = 312 + 46 lane label = 358) with lanes 28 tall, plus a toggle to the Wheel (diameter **320**, centered). Hazard strip as on desktop.
- **Ask tab**: chat (bubbles max 300w, input 358x48 with a 40 mic button) with evidence chips. Answer cards deep-link to Options.
- Popovers become **bottom sheets** (dataset and SI explanation) with 24 padding and a 44 close.

---

## Part 5: Priorities, risks and open questions
- **Build order**: Field Studio (2), then Globe Home (1), then Compare (3), then Season Wheel/Timeline (5), then Mobile (8), then Climate Twins (6), then Next Move (4), then Drought Replay (7).
- **Brand risk**: replace every NASA insignia in CH/GR with a generic satellite glyph. Keep "NASA data" as text and include the line "No NASA endorsement is implied" in the footer and PDF.
- **Honesty**: each mockup marks values as illustrative. The app must label model outputs with SI, show confidence, and never show a number without a source (GR-9 "Where every number comes from").
- **Accessibility**: never rely on red/green alone. Bare soil uses hatch plus a label. Confidence pills use text plus color. The wheel always has a Timeline alternative. Body text is at least 14px (GR's mockup text at about 11px is too small).
- **Open questions**:
  - Is the farmer-facing default Simple mode CH-1 calm, or CL-A dense? The recommendation is CL-A's layout with CH-1's spacing and caveat lines.
  - Is "Profit" in scope? CH-3 notes say margin is a future module.
