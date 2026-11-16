# FarmSmart

**Explore crop rotations that protect soil, save water and adapt to a changing climate, using NASA Earth observations.**

NASA Space Apps Challenge 2026 · Challenge: *Adapting Farms with NASA Data*

FarmSmart takes a farmer from the whole planet down to one field. It shows the field's climate, soil, terrain and crop history, then compares the **current rotation** with alternatives across six strategy families:
- Fill the gap
- Extend & diversify
- Water-wise swap
- Integrate forage
- Market-driven add
- Pest-cycle break

Each option is simulated through 30+ real past weather years. The results cover:
- water use
- water and wind erosion
- soil cover and bare-soil weeks
- soil carbon
- legume nitrogen
- yield risk
- net return
- workload

Every number has its source one tap away, and every model output shows its confidence and reasons.

> FarmSmart supports decisions. It does not replace farmer judgment or local agronomy advice.

## What makes it different
- **The bare-soil gap meets the weather.** The season timeline lines up when each rotation leaves soil bare against the windiest and heaviest-rain weeks of the year, from NASA POWER since 1991. For example, "bare + windy overlap: 6.5 weeks → 0 with rye and vetch".
- **Drought Replay.** Replay 2012 week by week on your field, current rotation against an alternative. The model run has confidence bands, and the real MODIS greenness from that summer is drawn as a ghost behind it.
- **Climate Twins.** The field's 2040s climate is computed from 6 NEX-GDDP-CMIP6 models. An arc flies to the present-day place that already has that climate, with "x of 6 models agree" and a novel-climate flag.
- **Honest by design.** There are no demo numbers. Missing data lowers confidence and is shown in a coverage panel. Coarse data is labelled "regional value". The ranking runs a rank-stability test and says when the order is uncertain.

## Run it (Windows)
```powershell
.\start.ps1 -Setup        # first time: Python env (conda-forge core + pip) and web packages
.\start.ps1               # API on :8000, web on :5173, opens the browser
.\start.ps1 -Precompute   # rebuild pilot caches (Story IA, Finney KS x2, San Joaquin CA)
```
Optional keys go in `.env` (see `.env.example`): Earthdata (SMAP, IMERG, GRACE, HLS), NASS, Cesium ion, SMTP. Without them the app still runs, and the coverage panel says what is unavailable.

CLI: `python -m fieldshift.cli --help`. Tests and validation: `python qc/validate_weather.py`.

## Run it (Mac / Linux, or by hand)
```bash
# API (Python 3.11)
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt geopandas shapely
cp .env.example .env            # then fill in the keys you have
uvicorn fieldshift.api.main:app --port 8000

# Web (Node 22 or newer), in a second terminal
cd web && npm ci && npm run dev  # http://localhost:5173 (calls the API through /api)
```

## Put it online (GitHub + Render + Vercel or Netlify)
FarmSmart has two parts: the **web app** (static React site) and the **API** (Python, FastAPI). Vercel or Netlify hosts the web app. The API needs a host that runs Python with its data, so it goes on Render (Docker). The web host alone shows the pages but no results.

1. **GitHub.** Create an empty repository, then from this folder:
   ```bash
   git init && git add -A && git commit -m "FarmSmart"
   git branch -M main
   git remote add origin https://github.com/<you>/farmsmart.git
   git push -u origin main
   ```
   `.env` is git-ignored, so your keys are never uploaded. Check with `git status` before the first push.
2. **Render (API).** New → Blueprint → pick the repository. Render reads `render.yaml` and builds the `Dockerfile`. In the service's Environment tab add `EARTHDATA_TOKEN` and `NASS_API_KEY` (the others in `.env.example` are optional). When it is live, open `https://<your-service>.onrender.com/api/health`; it should say `"ok": true`.
3. **Vercel (web).** Add New → Project → import the repository. Leave the Root Directory as the repository root; `vercel.json` sets the build (`web/`) and output (`web/dist`). The live API is `https://farmsmart-odo9.onrender.com`; if your Render address differs, change the `/api` rewrite destination in `vercel.json` (and in `web/vercel.json`) to your address, commit and push. Vercel redeploys on every push.

   **Or Netlify (web) instead of Vercel.** Add new site → Import an existing project → GitHub → pick the repository. `netlify.toml` sets everything (base `web`, build `npm run build`, publish `dist`, Node 22), so leave the build settings as Netlify fills them in and click Deploy. If your Render address differs, change the `/api/*` redirect in `netlify.toml`, commit and push.
4. Open the Vercel (or Netlify) address. The pilot fields and the sample farm load instantly from `data/precomputed`; a brand-new field is analysed on the API and takes a few minutes the first time.

Notes:
- Render's free plan sleeps when idle (the first visit then takes about a minute) and has 512 MB of memory; the `starter` plan in `render.yaml` stays awake.
- `web/vercel.json` is the same configuration for a Vercel project whose Root Directory is set to `web`.

## Architecture
```
web/          React + TypeScript + Vite · CesiumJS globe · MapLibre field map · D3 charts · i18n EN/ES
fieldshift/   Python 3.11 · FastAPI
  ingest/     NASA POWER, Earthdata (SMAP, IMERG, GRACE-FO, HLS), MODIS, SSURGO, CDL, Crop Sequence Boundaries,
              terrain, ERS costs, World Bank prices, NEX-GDDP-CMIP6, geocoding
  engine/     climate · rules engine · strategy generator · M6 simulator · M9 ranking · M10 uncertainty ·
              replay · Climate Twins
  models/     M3 rotation-sequence model
  alerts/     subscriptions, forecast triggers, outbox
engine/rules/ crops.yaml · calendars.yaml · rules.yaml · glossary.yaml (all sourced)
docs/         METHODS · DATA_SOURCES · LICENSES · SI_USE_DISCLOSURE · REQUIREMENTS_TRACE · model cards
qc/           validation reports (satellite vs ground)
```

## Data
NASA:
- POWER
- SMAP L4
- GPM IMERG
- MODIS / HLS (Landsat + Sentinel-2)
- GRACE-FO
- NEX-GDDP-CMIP6
- GIBS imagery
- SRTM / NASADEM terrain

USDA:
- SSURGO / Web Soil Survey
- Cropland Data Layer and Crop Sequence Boundaries
- ERS Costs and Returns
- NAIP

Other:
- NOAA GHCN (validation)
- Open-Meteo forecasts
- FAO GAEZ / FAOSTAT
- World Bank commodity prices
- OpenStreetMap / Natural Earth / GeoNames

Full list with versions, licences and citations: [docs/DATA_SOURCES.md](docs/DATA_SOURCES.md). No NASA endorsement is implied.

## Limitations
See [docs/METHODS.md §10](docs/METHODS.md). The main ones:
- Weather is regional (≈50 km).
- Erosion uses RUSLE with assumed slope length.
- Wind is an exposure index, not tonnes of soil.
- Economics are regional and US-only.
- Rotation comparison works in every US state (state crop calendars from USDA NASS, 2010 dates) and at the pilots; Canada, Punjab and Mato Grosso are in progress. Environmental analysis works everywhere.

## SI use
See [docs/SI_USE_DISCLOSURE.md](docs/SI_USE_DISCLOSURE.md).

## Licence
Code: MIT. Project knowledge base: CC BY 4.0. Data: per source, see [docs/LICENSES.md](docs/LICENSES.md).
