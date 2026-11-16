# Backup deck outline (7 slides)

**Brand:** FarmSmart (one word, capital F and S). Use `docs/brand/farmsmart-logo-transparent.png` on light slides and the same lockup on a white panel on dark slides (`farmsmart-logo-white.png`); `docs/brand/farmsmart-logo.svg` is the vector. Colors: tile #214D35, sprout #DDF3AA, wordmark #243B30, tagline #81947F. Tagline: "Smarter choices. Better seasons." Fonts: Manrope (wordmark), DM Sans (tagline), Inter (body, as in the app).

This deck is the backup if the video cannot be used. Rules:
- Every screenshot is a real capture from the app.
- No NASA logos or insignia.
- English text.
- Every number comes from the file cited in its slide note.
- Say "SI", never "AI".

## Slide 1: The problem
- **Headline:** Farmers are choosing rotations in a climate that no longer behaves like the one they learned.
- **Body:**
  - Shifting heat, unreliable rain, water limits and eroding soil make the next rotation a harder bet.
  - A crop that builds soil in one place can use too much water, carry disease, or lack a market somewhere else.
- **Proof point:** the Story County, Iowa pilot field warmed +0.49 °C per decade over 1991–2025 (likely 0.14–0.85; NASA POWER, regional value).
- **Source:** `data/precomputed/context_b96d39c7a833.json`

## Slide 2: The farmer's question
- **Headline:** "What should come next on *this* field, and what would I give up?"
- **Body:** the six questions every result answers:
  - What is grown here?
  - What fits this field?
  - Which three rotations fit my priorities?
  - What changes in a dry, windy, hot or wet year?
  - What evidence drove the order?
  - What should I check locally?
- **Visual:** Field Studio screenshot showing MY FIELD, the map and three option cards.

## Slide 3: How it works (data → models → options)
- **Data:**
  - NASA POWER daily weather since 1991, MODIS NDVI, NEX-GDDP-CMIP6, GIBS imagery, SRTM/3DEP terrain.
  - USDA SSURGO soils, CDL crop history and Crop Sequence Boundaries, and ERS costs and returns.
  - SMAP, IMERG, GRACE-FO and HLS are being integrated (label them "in progress" on the slide).
- **Models:**
  - Rules engine (27 sourced rules).
  - Strategy generator (6 families).
  - M6 process simulator (FAO-56 water, RUSLE, wind exposure, ICBM carbon, N).
  - M9 Pareto + TOPSIS ranking with a rank-stability test.
  - M10 confidence with reasons.
  - SI models: M3 rotation sequence, M8 price ensemble, M7 Climate Twins analog search.
- **Options:** the current rotation, always kept, plus the best two alternatives from different families. Each card has 7 sections: why, evidence, benefits, trade-offs, gaps, check locally, try it small.
- **Source:** `docs/METHODS.md`

## Slide 4: Signature moments
Three panels, each a real screenshot:
1. **Bare + windy overlap.** "Bare + windy overlap: 6.5 weeks → 0 with Corn ×2–Soybean + cereal rye, hairy vetch". The value is computed, not typed (`compare_b96d39c7a833.json`).
2. **Drought Replay 2012.** Week by week, current rotation vs the alternative, with model bands and the real MODIS NDVI ghost. Take the numbers from the live screen on capture day; the replay is not cached.
3. **Climate Twins.** The 2040s climate (SSP2-4.5) resembles today's near Bellevue, Missouri, 250 km away, with 6 of 6 models agreeing (`twins_story_ia.json`).

## Slide 5: Validation and honesty
- **M3 rotation-sequence model**, held-out 2024 (`models/model_cards/m03_rotation_sequence.md`):

  | Area | Top-1 | Top-3 | Same as last year | Most common crop |
  |---|---|---|---|---|
  | Story Co. IA (6,272 fields) | 0.752 | 0.976 | 0.278 | 0.493 |
  | Finney Co. KS (7,972 fields) | 0.495 | 0.738 | 0.218 | 0.267 |

- **POWER vs NOAA station, 2001–2024** (`qc/reports/weather_agreement.md`):
  - Story/Ames: daily Tmax r 0.929, monthly rain r 0.917, daily rain r 0.325.
  - Garden City: daily Tmax r 0.984, monthly rain r 0.904, daily rain r 0.70.
  - Single-day storms are local, so weather is labelled "regional value (≈50 km)".
- **Confidence and rank stability:**
  - Story County: the top option wins 40% of 300 perturbations, so the app says "The ordering is uncertain" and names what would flip it.
  - Garden City dryland: the top option wins 95%, so the order is stable, but every card is Low confidence because "results vary a lot between weather years" (`compare_b96d39c7a833.json`, `compare_b20f28194396.json`).
- **M8 prices:** P10–P90 coverage of 0.36–0.86 against a 0.80 target. This is disclosed, and it lowers confidence (`m08_price_profit.md`).
- **What it never claims** (6-item list): NDVI ≠ yield or carbon; GRACE ≠ your well; common ≠ suitable; organic-matter gains are slow.

## Slide 6: Impact and next steps
- **Impact:**
  - Free.
  - No login.
  - No sensors.
  - English and Spanish.
  - Works on a phone.
  - A printable "talk to your agronomist" report.
  - Email alerts for frost, heat, heavy rain on bare soil, and wind on low cover.
- **Next (be specific):**
  - Finish SMAP / IMERG / GRACE-FO / HLS ingest and their ground checks (SMAP vs SCAN, IMERG vs PRISM/CoCoRaHS).
  - Saskatchewan, Punjab and Mato Grosso recommendations (soils, crop history, calendars).
  - Train M1 suitability and M2 yield quantiles (needs NASS county yields).
  - A calibration report for M10.
  - A Region Compare view.

## Slide 7: Team and SI disclosure
- **Team:** names and roles. Confirm before submission, and include no minors' names or faces.
- **SI disclosure (short form):**
  - The team built the code with Claude (Anthropic) through Claude Code as a coding and research assistant, and reviewed its outputs.
  - Inside the app, SI outputs carry a green SI button with confidence and reasons.
  - Process models and rules are labelled as such, not as SI.
  - No data was generated by SI.
  - No SI-generated images or video; any that are added carry an "SI-generated" watermark.
  - Full text: `docs/SI_USE_DISCLOSURE.md`.
- **Footer:**
  - Code MIT · knowledge base CC BY 4.0 · data per source (`docs/LICENSES.md`).
  - No NASA endorsement is implied.
