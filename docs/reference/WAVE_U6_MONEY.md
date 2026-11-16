# Wave U6: rotation money calculator (revenue, costs, risk), contract and ownership

The farmer's question: "If I switch rotations, what will I earn, what will it cost, and how risky is it?" The answer is a
calculator built on the rotation plan that compares up to three options side by side and shows risk. Project rules in
`CLAUDE.md` apply in full: real data or the farmer's own numbers only; regional/county values labelled as such ("USDA
regional average, not your farm"); gray data buttons for USDA, green SI button for M2 yields; EN + ES strings; ≥44 px touch
targets; works at 390, 960, 1440 px; SI never AI. Supports, never replaces, the farmer's own budget and their adviser.

## Ground rules
- Edit only your files. No commits, no `npm install`/`pip install`, never stop/restart :8000 or :5173.
- Test on your own ports: API `%USERPROFILE%\miniforge3\envs\fieldshift\python.exe -m uvicorn fieldshift.api.main:app --port <8031|8032>` (no `--reload`);
  web `cd web; $env:FS_VITE_CACHE="node_modules/.vite-<you>"; $env:FS_API="http://127.0.0.1:<api>"; npx vite --port <5191|5192>`.
  Always give Vite its own `FS_VITE_CACHE`.
- Simple mode is the guided path (`web/src/components/Guided.tsx`); Expert is the all-in-one Field Studio.

## Ownership
| Owner | Files |
|---|---|
| M-back (backend) | new `fieldshift/api/routes_money.py` (`router = APIRouter()`), add `"routes_money"` to the router tuple at the end of `fieldshift/api/main.py`; `fieldshift/ingest/econ.py` (ERS line items); a small exported helper in `fieldshift/engine/analysis.py` if needed (no behaviour change to compare: verify the 8 pilot comparisons are identical); new `data/reference/ers_items_summary.json` |
| M-front (frontend) | new `web/src/views/MoneyCalc.tsx`, `web/src/money.ts` (pure calculation functions, unit-testable), `web/src/money.css`, `web/src/apiMoney.ts`; edits to `web/src/planStore.ts` (add plan view `"money"`), `web/src/components/TopBar.tsx` (VIEWS), `web/src/components/SideRail.tsx`, `web/src/components/Guided.tsx` (entry buttons on steps 3 and 5), `web/src/App.tsx` (route), `web/src/i18n/en.plan.json` / `es.plan.json` (new top-level key `money` only) |

## API: `POST /api/fields/{fid}/money`
Body: the same as `/compare` (`farm`, `priorities`, `baseline`, `scenario`, `budgets`, `custom`). Runs (or reuses the cached)
comparison and returns the building blocks, so the browser can recompute instantly when the farmer edits numbers.

```json
{
  "available": true, "reason": null,
  "field": {"acres": 193.5, "hectares": 78.3, "irrigated": false},
  "region": "Heartland", "currency": "USD", "costs_available": true,
  "weather_years": [1991, 1992, "... one per simulated weather sequence (sequence start year), length S"],
  "season_rain_mm": [512.3, "... length S, growing-season rain of each sequence, to pick drought years"],
  "price_years": [2016, "...", 2025],
  "crops": {
    "corn": {
      "name": "Corn", "name_es": "Maíz", "unit": "bu",
      "yield": {"typical": 211.0, "source": "M2 county yield (USDA NASS county trend + season weather)", "si": true},
      "price": {"values": [3.36, "... one per price year"], "typical": 4.42, "source": "USDA ERS harvest price, Heartland"},
      "costs": [{"id": "seed", "label_en": "Seed", "label_es": "Semilla", "usd_ac": 118.5},
                {"id": "fertilizer", "label_en": "Fertilizer", "label_es": "Fertilizante", "usd_ac": 160.2},
                {"id": "chemicals", "...": "..."}, {"id": "custom", "...": "custom services"}, {"id": "fuel", "...": "fuel, lube, electricity"},
                {"id": "repairs", "...": "..."}, {"id": "irrigation_water", "...": "purchased irrigation water (if any)"}, {"id": "interest", "...": "interest on operating capital"}],
      "overhead": [{"id": "land", "label_en": "Land (rent or what it could rent for)", "usd_ac": 250.0},
                   {"id": "machinery", "label_en": "Machinery and equipment ownership", "usd_ac": 130.0},
                   {"id": "labor", "label_en": "Your own and hired labour", "usd_ac": 30.0},
                   {"id": "general", "label_en": "General overhead, taxes and insurance", "usd_ac": 35.0}],
      "cost_years": "2021–2025 median", "evidence": {"source_id": "ers", "...": "..."}
    }
  },
  "cover": {"cost_usd_ac": 36.0, "range": [35, 37], "source": "Plastina et al. 2018 (cover crop seed and planting)"},
  "options": [{
    "id": "baseline", "name": "Corn, corn, then soybean", "is_baseline": true, "is_custom": false, "best_for_you": false,
    "positions": [
      {"crop": "corn", "kind": "cash", "cover": null, "yield_index": ["S values; 1.0 = this crop's typical simulated year"],
       "irrigation_mm": null},
      {"crop": "soybean", "kind": "cash", "cover": "cereal_rye", "yield_index": ["..."], "irrigation_mm": ["S values or null"]}
    ]
  }],
  "notes": ["Costs are USDA ERS regional averages per planted acre (2021–2025 median), not your farm's costs."]
}
```
- `positions`: one per crop event in the rotation cycle (a double crop is its own position with `kind: "double"`); a year with
  only fallow has `crop: "fallow"` (no revenue, no cost unless the farmer adds one).
- `yield_index[s]` = the simulated yield of that position in weather sequence `s` divided by the crop's typical simulated yield
  (the same median the profit indicator calibrates to), so `yield = typical × yield_index` reproduces the app's profit numbers.
- `costs`/`overhead` from USDA ERS Commodity Costs and Returns line items for the field's farm resource region (5-year median),
  per planted acre. Crops ERS does not cover (and non-US fields): `costs: []`, `price: null`, `yield.typical` from M2 if any,
  else null, and `costs_available` false for that crop: the farmer enters their own.
- All shown cards of the comparison plus any custom options. Non-US fields still return options and yield indices (so the
  calculator works with the farmer's own prices and costs).

## Calculator (computed in the browser, `web/src/money.ts`)
Inputs per crop (shared by every option): typical yield, typical price, cost lines (each editable, "reset to USDA").
Farm inputs: field acres (default from the field), cover crop cost/ac (default 36), irrigation pumping cost $/acre-inch
(irrigated fields; default empty → not counted, with a note), include fixed costs (off by default; land rent editable).
Stress: Normal · Prices −20 % · Drought years (the driest 20 % of `season_rain_mm`) · Both.

For option o, weather sequence s and price year p (all S × P pairs; prices keep their year-to-year shape: the farmer's
typical price × values[p]/median(values)):
- position net = typical_yield × yield_index[s] × price_p − Σ cost lines − cover cost (if a cover) − pump $/acre-inch × irrigation_mm[s]/25.4 (− overhead if on)
- rotation-average net/ac/yr = mean over positions.
Results per option: typical (median), bad year (10th percentile), good year (90th percentile) of the rotation-average; revenue
and cost per acre (typical); whole field per year (× acres); difference from the current rotation; **chance of a losing year**
(share of single-position samples below 0); **chance it beats the current rotation** (share of (s,p) where its rotation-average
exceeds the current one's for the same s and p); **break-even price** (the price change at which its typical net equals the
current rotation's); worst simulated year. Show the method in one plain line and link METHODS.

UI: a page "Money: revenue, costs and risk" with the option picker (up to 3; default current + best for you + next), the crop
inputs table (expandable cost lines), the farm inputs, the stress buttons, and the comparison (columns on desktop, stacked on
phones) with a small range chart per option (bad–typical–good) and plain-language risk sentences ("In about 1 year in 10 this
rotation loses money on this field"). "Use these numbers in the ranking" writes price/cost/yield into the existing `budgets`
(store.ts `setBudgets`) so the comparison uses them. CSV export of inputs and results. Guided mode: a button "Work out the money →"
on step 3 under the options and on step 5; also in More tools / Expert nav as "Money".

## Risk from historical probabilities (the farmer asked for realistic estimates)
The risk numbers must come from what actually happened here, not assumptions. Three real sources, each with its scale label:

1. **Weather, already in the simulation** (NASA POWER 1991–present, ≈50 km): every option is run through every real weather
   sequence, so drought, heat and mid-season killing frost already lower yields in the years they happened. The calculator's
   distribution therefore already carries those odds.
2. **Weather hazard odds per year** (M-back adds to the response as `hazards.weather`): from the field's POWER record, the share
   of years with: a killing frost during the main crop's season; ≥ N days ≥ 35 °C in summer; a growing season in the driest
   10 % / 20 % of the record; a 14-day dry spell in July–August; heavy-rain days on bare soil (spring). Reuse
   `fieldshift/engine/climate.py` (frost, weekly hazards) where possible. Shape:
   `{"id": "drought_season", "label_en": "Very dry growing season", "label_es": "...", "years_hit": 4, "years": 35, "p": 0.114, "last": 2012, "source": "NASA POWER", "scale": "regional value (≈50 km)"}`.
3. **Losses that the simulation does not model: hail, flood/excess water, wind, freeze, insects, disease** (`hazards.insured_losses`):
   USDA RMA "Cause of Loss" historical data (county × crop × cause × year: indemnities, insured acres) if it can be fetched
   reliably (public files at rma.usda.gov, no key); summarise the field's county for the crops in play over the last 20 years:
   per crop and cause, years with a payout, the share of years, and the average loss per insured acre in those years
   (`{"crop": "corn", "cause": "Hail", "years_hit": 9, "years": 20, "p": 0.45, "avg_loss_usd_ac_when_hit": 38.2, "mean_loss_usd_ac": 17.2}`).
   Also **declared disasters** from OpenFEMA (`DisasterDeclarationsSummaries`, public, no key) for the county over the last
   20 years by type (flood, severe storm, drought, fire, …): `hazards.declarations`.
   If a source cannot be fetched, return it with `available: false` and a reason; never invent values. Cache results under
   `data/cache/` and precompute for the US pilots.

How the calculator uses them (M-front):
- A **"What can go wrong here"** panel with plain sentences from the real counts ("Very dry growing season: 4 of the last 35
  years (last in 2012)"; "Hail insurance payouts for corn in Story County: 9 of the last 20 years, about $38/acre when it hit").
- A toggle **"Include losses the weather model does not cover (hail, flood, wind…)"**, on by default when RMA data are
  available: each simulated year draws whether each non-modelled cause hits, with its historical yearly probability, and
  subtracts that cause's historical average loss per acre when it does (seeded random, reproducible). Label it
  "from USDA crop-insurance records for this county; real losses on your field can differ". Causes that are weather the
  simulation already covers (drought, heat, freeze during the season) are not added again, to avoid double counting.
- Risk outputs then include these losses: bad year, chance of a losing year, chance it beats the current rotation.
