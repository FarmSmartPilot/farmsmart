# Ground data outside the US (data-ground, Gate 3)

| Layer | Module | Source | Scale | Notes |
|---|---|---|---|---|
| Soil | `fieldshift/ingest/soilgrids.py` | ISRIC SoilGrids v2.0 REST (WCS fallback), field centroid | 250 m modelled grid cell | Always labelled "modelled soil map (SoilGrids 250 m), not a soil survey". 0–30 cm thickness-weighted surface values. OM = SOC × 1.724 (van Bemmelen; true ratio about 1.4–2.5, Pribyl 2010). AWC: Saxton & Rawls (2006) SSSAJ 70:1569, with a coarse-fragment correction. K: Williams (1995) EPIC, in US units like SSURGO kwfact. Drainage class, WEI and hydrologic group are None, with a reason given. |
| Crop history (Canada) | `fieldshift/ingest/aafc.py` | AAFC Annual Crop Inventory 2009–2025, `computeHistograms` over the field polygon | 30 m (56 m in 2009–2010) | Same shape as `cdl.history`. Generic classes (Wheat, Cereals, Pulses, Oilseeds) map to no crop id. There is no durum class. `regional_crops()` builds a 20 km box crop-area table that stands in for the US county table (markets assumption). |
| Crop history (India, Brazil) | none | No field-level service | n/a | Pilots use a cited typical regional rotation, labelled "typical regional rotation (enter your own)". |
| Field boundaries | `fieldshift/ingest/fields.py::ftw_at` | Fields of The World global 2025 PMTiles (`fields` layer, z14), HTTP range reads | Model-delineated polygons | CC BY 4.0, with attribution. Pieces clipped at tile edges are merged from the 8 neighbouring tiles (matched on identical confidence values). In the 2025 file `confidence_mean` runs 0–1 (we saw about 0.35–0.56), so the documented `>= 69` filter (2024 alpha file, percent scale) does not apply and no low-confidence flag is set. |

Calendars added in `engine/rules/calendars.yaml`:
- Saskatchewan Crop Report 2026, 5-year averages (all crops, province);
- PAU Package of Practices Kharif 2026 and Rabi 2025-26;
- Conab safra 2025/26 n.5 stage tables (Norte Mato-grossense).

Where a harvest window was derived (sowing window plus the published maturity days), the YAML labels it DERIVED.
