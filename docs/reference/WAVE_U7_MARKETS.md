# Wave U7: market prices for the farmer's reference (current, history, official outlook, inputs)

Goal: show what crops sell for now, how prices moved, what USDA expects, and what fertilizer costs, and let the money
calculator plan with any of those prices. Project rules in `CLAUDE.md` apply: real published numbers only; forecasts are
labelled as forecasts with their publisher and date; gray data buttons (non-NASA sources); EN + ES; SI never AI.
Futures quotes are not freely redistributable: link out to them, never copy numbers.

## Ground rules
No commits, no installs, never stop/restart :8000 or :5173. Test on your own port (API 8041, no --reload). Python:
`%USERPROFILE%\miniforge3\envs\fieldshift\python.exe`. Never print `.env` (NASS_API_KEY is there; use `fieldshift.config.env()`).

## Ownership
| Owner | Files |
|---|---|
| K-back (data) | new `fieldshift/ingest/markets.py`, new `fieldshift/api/routes_markets.py` (`router = APIRouter()`; already listed in main.py's router tuple), new `data/reference/markets_*.json` (small committed snapshots), new `scripts/update_markets.py`, rows in `docs/DATA_SOURCES.md` |
| K-front (later, after the money calculator lands) | Markets panel in the money calculator, price-basis selector |

## API: `GET /api/markets?state=IA&crops=corn,soybean,winter_wheat`
(`state` = 2-letter US state; `crops` = FarmSmart crop ids; non-US → `us_available: false`, World Bank still returned.)
```json
{
  "retrieved": "2026-11-15", "us_available": true, "state": "IA",
  "crops": {
    "corn": {
      "unit": "bu",
      "received": {"source": "USDA NASS Quick Stats, price received, monthly, Iowa", "series": [{"month": "2024-11", "usd": 4.05}, "..."],
                    "latest": {"month": "2026-10", "usd": 4.11}, "scope": "state average", "available": true},
      "harvest_history": {"source": "USDA ERS harvest price (farm resource region)", "years": [2016, "..."], "usd": [3.36, "..."]},
      "wasde": {"source": "USDA WASDE", "report_date": "2026-11-10", "marketing_year": "2026/27",
                 "season_avg_price": {"low": null, "mid": 4.10, "high": null}, "previous_year": 4.24, "unit": "$/bu",
                 "scope": "US season-average farm price (forecast)", "available": true},
      "projections": {"source": "USDA Agricultural Projections to 2035 (baseline)", "published": "2026-02",
                       "years": ["2026/27", "..."], "usd": [4.2, "..."], "scope": "US season-average farm price (projection)", "available": true},
      "global": {"source": "World Bank Pink Sheet (maize, US Gulf)", "unit": "$/mt", "series": [{"month": "2024-11", "value": 190.5}, "..."]}
    }
  },
  "inputs": {"source": "World Bank Pink Sheet", "items": [{"id": "urea", "label_en": "Urea", "unit": "$/mt", "series": ["..."]}, {"id": "dap"}, {"id": "potash"}]},
  "links": [{"label_en": "Corn futures (CME, delayed quotes)", "url": "https://www.cmegroup.com/markets/agriculture/grains/corn.html"}],
  "notes": ["Forecasts are USDA's published expectations, not guarantees."]
}
```
- NASS: `PRICE RECEIVED, MEASURED IN $ / BU` (or the crop's unit), `freq_desc=MONTHLY`, state level (fall back to US if the
  state series is missing; say so in `scope`), last 24 months.
- WASDE: the latest report's US season-average farm price for corn, soybeans, wheat (all), sorghum, barley, oats, cotton
  (upland, ¢/lb → keep units), rice; usda.gov/oce/commodity/wasde publishes machine-readable files (find the current
  format; cache the latest under `data/cache/markets/` and keep a small committed snapshot `data/reference/markets_wasde.json`
  with its report date).
- Projections: USDA Agricultural Projections (OCE/ERS baseline) price tables for the same crops, 10 years; committed snapshot
  with the publication date.
- World Bank: reuse `data/reference/wb_prices_monthly.json` (+ fertilizer series urea, DAP, potassium chloride).
- Each block `available: false` + reason when it cannot be fetched; never invent or interpolate values.
