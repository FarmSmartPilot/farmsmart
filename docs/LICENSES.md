# Licences and attribution

Checked 2026-11-14. **UI rule:** every data value's source button (navy for NASA, gray for other sources) opens its attribution string from the table below. A combined "Sources & credits" panel lists every source used on the current screen. No NASA logos or insignia; mission names in plain text only.

## Project

- **Code:** MIT License. See `LICENSE` in the repository root.
- **Project knowledge base:** Creative Commons Attribution 4.0 International (CC BY 4.0). This covers `engine/rules/*.yaml`, `engine/strategies/`, the glossary, `docs/` and the model cards. Attribute it as "FarmSmart team, NASA Space Apps 2026". The published sources cited inside the knowledge base keep their own terms.
- **Data:** each source keeps its own licence, listed below. The FarmSmart licences do not relicense third-party data.

## Data

| Source | Licence | Attribution string to show in the UI |
|---|---|---|
| NASA POWER | NASA open data, no restrictions | Data: NASA Langley Research Center POWER Project, funded through the NASA Earth Science/Applied Science Program. |
| SMAP, IMERG, HLS, MODIS, VIIRS, ECOSTRESS, GRACE/GRACE-FO, GEDI, NASADEM, NLDAS, GLDAS | NASA Earth Science Data and Information Policy: open, no restrictions; citation requested | Data: NASA {mission} {product} {version} via {DAAC} (NSIDC / GES DISC / LP DAAC / PO.DAAC / ORNL DAAC). |
| NASA GIBS imagery | NASA open | Imagery: NASA Global Imagery Browse Services (GIBS), part of NASA ESDIS. |
| ORNL MODIS/VIIRS subsets | NASA open | ORNL DAAC MODIS/VIIRS Global Subsets (doi:10.3334/ORNLDAAC/1379). |
| NEX-GDDP-CMIP6 | Per-model CC BY 4.0 (a few models CC0); NASA distribution | Climate projections: NEX-GDDP-CMIP6, NASA Ames Research Center / NASA Earth Exchange, distributed by NCCS (Thrasher et al. 2022). |
| USDA NASS Cropland Data Layer | Public domain (US Government work) | Crop history: USDA NASS Cropland Data Layer {years}. |
| USDA NASS Crop Sequence Boundaries | Public domain | Field boundaries and sequence: USDA NASS Crop Sequence Boundaries 2017–2024. |
| NASS QuickStats | Public domain; API terms | This product uses the NASS API but is not endorsed or certified by NASS. |
| SSURGO / STATSGO2 / Web Soil Survey | Public domain | Soils: USDA NRCS Soil Survey Geographic Database (SSURGO), Soil Data Access, accessed {date}. |
| USGS 3DEP, EPQS | Public domain | Elevation: U.S. Geological Survey 3D Elevation Program. |
| NAIP (via USGS TNM) | Public domain | Imagery: USDA NAIP, served by USGS The National Map. |
| USGS Water Data / NWIS | Public domain | Groundwater and streams: U.S. Geological Survey Water Data for the Nation. |
| NLCD Annual | Public domain | Land cover: USGS Annual NLCD. |
| USDA ERS Costs & Returns | Public domain | Costs: USDA Economic Research Service, Commodity Costs and Returns. |
| USDA AMS Market News | Public domain | Prices: USDA AMS Market News. |
| NOAA NWS API | Public domain | Forecast: NOAA National Weather Service. |
| PRISM | Free use, citation required | Climate normals: PRISM Group, Oregon State University, prism.oregonstate.edu. |
| CoCoRaHS | Free use with attribution | Rain gauges: CoCoRaHS (cocorahs.org). |
| OpenET | CC BY 4.0 (API terms of service apply) | ET: OpenET (openetdata.org). |
| AWS Terrain Tiles | Mixed open sources; attribution required | Terrain: Terrain Tiles via AWS Open Data. Sources include USGS 3DEP, SRTM, GMTED2010, ETOPO1, EU-DEM (produced using Copernicus data), ArcticDEM, NRCan CDEM, LINZ and data.gov.uk. |
| Fields of The World (global) | CC BY 4.0 | Field boundaries: Fields of The World (fieldsofthe.world), CC BY 4.0. |
| Open-Meteo (ERA5, ERA5-Land, forecast) | Data CC BY 4.0; free API for non-commercial use | Weather data by Open-Meteo.com (CC BY 4.0). Contains modified Copernicus Climate Change Service information {year}. |
| Copernicus Sentinel-2 | Copernicus free and open | Contains modified Copernicus Sentinel data {year}. |
| EOX Sentinel-2 cloudless **2016** | CC BY 4.0 | Sentinel-2 cloudless – s2maps.eu by EOX IT Services GmbH (Contains modified Copernicus Sentinel data 2016 & 2017). |
| EOX Sentinel-2 cloudless 2018–2024 | **CC BY-NC-SA 4.0** (commercial use needs an EOX licence) | Sentinel-2 cloudless – s2maps.eu by EOX IT Services GmbH (Contains modified Copernicus Sentinel data {year}). Only for a non-commercial hackathon demo; share-alike applies to derived tiles. |
| Esri World Imagery | Esri Master Agreement / Terms of Use. Keyless tile URLs answer today, but Esri's terms expect use through an ArcGIS account or Location Platform key. | Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community. **Recommendation:** use NAIP (US), EOX 2016 or GIBS/HLS instead. Use Esri only with a free ArcGIS Location Platform key and its attribution. |
| SoilGrids 2.0 | CC BY 4.0 | Soils (global): SoilGrids 2.0, ISRIC – World Soil Information. |
| FAO GAEZ v4 | FAO terms; publications CC BY-NC-SA 3.0 IGO. Treat data the same way (non-commercial, attribution); verify on the GAEZ portal. | Suitability: FAO & IIASA, GAEZ v4. |
| FAOSTAT | CC BY 4.0 | FAO, FAOSTAT, accessed {date}. |
| ESA WorldCereal 2021 | CC BY 4.0 | ESA WorldCereal 2021 (Van Tricht et al. 2023). |
| World Bank Pink Sheet | CC BY 4.0 | World Bank Commodity Price Data (The Pink Sheet). |
| AAFC Annual Crop Inventory | Open Government Licence – Canada | Contains information licensed under the Open Government Licence – Canada (AAFC Annual Crop Inventory). |
| GeoNames | CC BY 4.0 | Place names: GeoNames.org. |
| Natural Earth | Public domain | Boundaries: Natural Earth. |
| OpenStreetMap (if Nominatim/Photon is used) | ODbL 1.0 | © OpenStreetMap contributors. Nominatim: at most 1 request/s and a valid User-Agent. |
| Manrope and DM Sans fonts (FarmSmart wordmark and tagline), via Google Fonts | SIL Open Font License 1.1 | Loaded from fonts.googleapis.com like Inter; the brand PNGs in `docs/brand/` were rendered with them. |
| OpenStreetMap standard tiles (field map "Map" view) | ODbL 1.0 data; OSM Foundation tile usage policy | © OpenStreetMap contributors (shown on the map). Light, interactive use only; a high-traffic deployment should use its own tile server or a provider. |

Notes:
- **Non-commercial items** (EOX 2018+, GAEZ, Open-Meteo free tier) are fine for a Space Apps demo. Flag them in the README if the app is ever reused commercially.
- **Share-alike:** if EOX 2018+ tiles are re-served or modified, the output inherits CC BY-NC-SA. Prefer EOX 2016 (CC BY) or NAIP/HLS.
- The CC BY sources need their attribution visible wherever their data or tiles appear, not only on an About page.

## Major software

| Package | Licence | Notes |
|---|---|---|
| React, React DOM | MIT | |
| Vite | MIT | |
| TypeScript | Apache-2.0 | |
| CesiumJS | Apache-2.0 | Cesium ion assets need an ion token and "Cesium ion" credit. Do not ship the default ion token: use our own imagery and terrain providers. |
| Resium | MIT | |
| MapLibre GL JS | BSD-3-Clause | |
| PMTiles (protomaps) | BSD-3-Clause | |
| D3 | ISC | |
| Zustand | MIT | |
| TanStack Query | MIT | |
| i18next, react-i18next | MIT | |
| h3-js / h3-py | Apache-2.0 | |
| FastAPI | MIT | |
| Pydantic v2 | MIT | |
| Uvicorn | BSD-3-Clause | |
| DuckDB | MIT | |
| SQLite | Public domain | |
| LightGBM | MIT | |
| scikit-learn | BSD-3-Clause | |
| MAPIE | BSD-3-Clause | |
| ONNX | Apache-2.0 | |
| ONNX Runtime | MIT | |
| xarray | Apache-2.0 | |
| rasterio | BSD-3-Clause | |
| GDAL | MIT | |
| GeoPandas | BSD-3-Clause | |
| Shapely | BSD-3-Clause | |
| pyproj | MIT | |
| earthaccess | MIT | |
| netCDF4-python | MIT | |
| Prithvi-EO-2.0 (NASA/IBM) | Apache-2.0 (model weights on Hugging Face) | |
| AlphaEarth Satellite Embeddings (Google Earth Engine) | CC BY 4.0 | Earth Engine Terms of Service apply; non-commercial use needs a registered project. |
