# FarmSmart: project memory

NASA Space Apps Challenge 2026, "Adapting Farms with NASA Data" (Nov 14–15, 2026). A decision-support web app that helps a farmer, from the globe down to one field, explore crop rotations that protect soil, save water and adapt to changing conditions. **It supports and never replaces farmer judgment.**

Formerly **Field Shift** (renamed 15 Nov 2026, v1.6.0). The product name is **FarmSmart**, one word; brand files are in `docs/brand/`. The Python package/env stay `fieldshift` and browser storage keys keep the `fieldshift-` prefix (saved data survives).

Full brief: `docs/reference/BUILD_BRIEF.md`. Planning digest: `docs/reference/PLANNING_DIGEST.md`. Design digest: `docs/design/DESIGN_DIGEST.md`. Task board: `docs/TASKS.md`.

## Location
- Project root is **`<project folder>`**. The user chose this over the brief's `C:\FieldShift\field-shift`.
- Reference inputs are read-only, in the top level of `<planning-inputs folder>` only. Never use other subfolders there.
- The folder is inside Dropbox. Heavy folders (`node_modules`, `data/cache`, `models/artifacts`) carry the `com.dropbox.ignored` stream so they don't sync.
- The Python env `fieldshift` (conda-forge, 3.11) lives at `%USERPROFILE%\miniforge3\envs\fieldshift`.

## Machine gotchas (learned)
- **Windows Application Control (Smart App Control)** blocks many conda-forge DLLs, including numpy's BLAS, so any matmul silently kills Python. Its exit codes look like -1066598273 or 127. Fix: use pip wheels (`pip install --force-reinstall --no-deps <pkg>`). numpy, scipy, pyproj, rasterio, h5py, netCDF4, pillow and matplotlib are already pip wheels. Never use the `shap` package; use LightGBM `pred_contrib`.
- Run the API **without `--reload`**: Dropbox file events jam the reloader. Restart it manually after backend edits.
- `.env` holds the user's Earthdata token. Never print it or commit it.

## Rules (non-negotiable)
- Write **"SI"** wherever you would write "AI": UI, docs, comments.
- Every displayed number comes from real data or a real model run. No synthetic data shown as observation, and no hard-coded demo numbers. Missing data is said in the UI and lowers confidence.
- Coarse values are labelled with their scale (e.g. "regional value (≈50 km)"), never as field truth.
- No NASA logos or insignia. Mission names in plain text are fine.
- SI use is disclosed in `docs/SI_USE_DISCLOSURE.md`. Watermark SI-generated media.
- Public site, no login. Never commit secrets: keys go in `.env` (git-ignored) and `.env.example` is committed.
- Every data value gets a navy satellite button (NASA) or a gray one (other source). Every SI output gets a green `SI` button (#1E8E4E) with its confidence and reasons.
- Never-claim list:
  - sharp imagery shows field soil moisture or wind;
  - NDVI measures yield, residue or carbon;
  - GRACE describes a well;
  - common = suitable;
  - observed patterns prove a switch gain;
  - organic-matter gains are quick.
- Commit after every working step.

## Commands
- `.\start.ps1` runs the API (:8000) and the web dev server (:5173) and opens the browser.
- `.\start.ps1 -Precompute` builds the pilot caches.
- `conda run -n fieldshift python -m fieldshift.cli --help`
- `cd web; npm run dev` / `npm run build`
- `conda run -n fieldshift pytest`

## Layout and ownership
| Folder | Owner agent |
|---|---|
| `contracts/` | orchestrator (frozen after Wave A) |
| `fieldshift/` (python package: ingest, features, models, engine, api) | backend / data / ml |
| `data/ingest_*` notes + `data/cache/` (ignored) | data-nasa, data-ground |
| `models/` cards + artifacts | ml |
| `engine/rules/rules.yaml`, `engine/strategies/` | agronomy |
| `engine/narrator/` | narrator |
| `web/src/map/` | globe-map |
| `web/src/design/` | design |
| `web/src/` (rest) | frontend |
| `alerts/` | alerts |
| `qc/` | checker, spacing |
| `docs/` | story, research |

Python code lives in the importable package `fieldshift/` (`fieldshift/ingest`, `fieldshift/engine`, `fieldshift/models`, `fieldshift/api`). The top-level `engine/`, `models/` and `alerts/` folders hold data and config (rules.yaml, model cards, artifacts, templates, outbox).

## Stack
React + TS + Vite, CesiumJS (Resium) with a MapLibre fallback, D3, Zustand, TanStack Query, i18next (EN/ES). FastAPI, Pydantic v2, DuckDB, SQLite, LightGBM, scikit-learn, MAPIE, ONNX.

## Pilots
Story County IA (corn–soy) · Finney County KS (wheat–fallow / irrigated corn) · San Joaquin CA · Saskatchewan · Punjab IN · Mato Grosso BR.
