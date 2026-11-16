# Endpoints (tested)

Copy-paste URL templates for the ingest code. All were tested with curl on **2026-11-14** at Story County, Iowa (lat 42.03, lon -93.47) unless noted. Always send `User-Agent: FarmSmart/0.1 (Space Apps 2026)`. Cache every response under `data/cache/`.

Test polygon (about 65 ha), WGS84: `POLYGON((-93.4747 42.0264,-93.4653 42.0264,-93.4653 42.0336,-93.4747 42.0336,-93.4747 42.0264))`
The same box in EPSG:5070 (Albers): `207644,2116624,208395,2117450`. Test point in EPSG:5070: `208019.7,2117037.3`.

Legend: **[open]** needs no key · **[EDL]** needs an Earthdata Login token · **[key]** needs a free API key.

---

## 1. NASA POWER [open]

Daily, AG community (200, about 1.3 s):
```
https://power.larc.nasa.gov/api/temporal/daily/point?parameters=T2M,T2M_MAX,T2M_MIN,PRECTOTCORR,WS2M,WS10M,WD10M,ALLSKY_SFC_SW_DWN,RH2M,GWETTOP,GWETROOT,GWETPROF,EVPTRNS,FROST_DAYS&community=AG&latitude={lat}&longitude={lon}&start={YYYYMMDD}&end={YYYYMMDD}&format=JSON
```
- Response is GeoJSON: `properties.parameter.{PARAM}.{YYYYMMDD}: value`. Fill value is `-999`. `geometry.coordinates[2]` is the grid-cell elevation (m).
- The header reports API `v2.10.3` and sources `MERRA2, SYN1DEG, POWER`. Daily time standard is LST.
- Units: T °C · PRECTOTCORR mm/day · WS m/s · WD10M degrees · ALLSKY_SFC_SW_DWN MJ/m²/day · RH2M % · GWET* 0–1 (wetness fraction, not volumetric) · **EVPTRNS is an energy flux in MJ/m²/day**: divide by 2.45 to get mm/day · FROST_DAYS is a count of days.
- `format=CSV` also works.

Hourly (200, 0.8 s). Keys are `YYYYMMDDHH`. Add `time-standard=UTC` or `LST`:
```
https://power.larc.nasa.gov/api/temporal/hourly/point?parameters=T2M,WS10M,WD10M,PRECTOTCORR&community=AG&latitude={lat}&longitude={lon}&start={YYYYMMDD}&end={YYYYMMDD}&format=JSON&time-standard=UTC
```
Monthly (200). Key `YYYY13` is the annual value:
```
https://power.larc.nasa.gov/api/temporal/monthly/point?parameters=T2M,PRECTOTCORR&community=AG&latitude={lat}&longitude={lon}&start={YYYY}&end={YYYY}&format=JSON
```
Climatology (200, 0.3 s). Without start/end it uses the precomputed 2001–2025 period. With `start=1991&end=2020` it computes a custom 1991–2020 baseline (tested). Keys are `JAN`..`DEC` and `ANN`:
```
https://power.larc.nasa.gov/api/temporal/climatology/point?parameters=T2M,PRECTOTCORR,FROST_DAYS&community=AG&latitude={lat}&longitude={lon}&start=1991&end=2020&format=JSON
```
Regional grid, up to a 10°×10° box (200, 0.2 s). Returns one feature per 0.5°×0.625° cell:
```
https://power.larc.nasa.gov/api/temporal/daily/regional?parameters=T2M&community=AG&latitude-min={s}&latitude-max={n}&longitude-min={w}&longitude-max={e}&start={YYYYMMDD}&end={YYYYMMDD}&format=JSON
```
Parameter metadata (200):
```
https://power.larc.nasa.gov/api/system/manager/parameters?community=AG&parameters=PRECTOTCORR&temporal=daily
https://power.larc.nasa.gov/api/system/manager/parameters/PRECTOTCORR?community=AG&temporal=daily
```
> **PRECTOTCORR source:** the API metadata says *"The average MERRA-2 bias corrected total precipitation"*. It is MERRA-2, not IMERG. For satellite rain, use IMERG (section 9).

## 2. USDA Cropland Data Layer (CDL)

### 2a. Fastest: USDA SCINet CDL ImageServer [open] — all years in one call
Point, all years 1999–2025 (200, 0.5 s). `properties.Values[]` lines up with `catalogItems.features[]` (2025 first: `2025_10m_cdls`, `2024_10m_cdls`, `2023_30m_cdls` … `1999_30m_cdls`):
```
https://pdi.scinet.usda.gov/image/rest/services/CDL_WM/ImageServer/identify?geometry={"x":{lon},"y":{lat},"spatialReference":{"wkid":4326}}&geometryType=esriGeometryPoint&returnGeometry=false&returnCatalogItems=true&f=json
```
Polygon histogram for one year (200, 0.4 s). `counts[i]` is the pixel count for CDL code `i`. URL-encode the JSON:
```
https://pdi.scinet.usda.gov/image/rest/services/CDL_WM/ImageServer/computeHistograms?geometry={"rings":[[[w,s],[e,s],[e,n],[w,n],[w,s]]],"spatialReference":{"wkid":4326}}&geometryType=esriGeometryPolygon&mosaicRule={"where":"Name='2023_30m_cdls'","mosaicMethod":"esriMosaicNone"}&f=json
```
Note: in this service 2024 and 2025 are the new **10 m** CDL. Other services on the same host: `Crop_Mask`, `Cultivated`, `Corn_Frequency_Layer`, and more (`https://pdi.scinet.usda.gov/image/rest/services?f=json`).

### 2b. CropScape CDLService (GMU) [open]
Point value, EPSG:5070 x/y (200, 0.6 s). Returns XML with a JS-object `Result` (not strict JSON):
```
https://nassgeodata.gmu.edu/axis2/services/CDLService/GetCDLValue?year={YYYY}&x={albers_x}&y={albers_y}
```
→ `{x: 208019.7, y: 2117037.3, value: 122, category: "Developed/Low Intensity", color: "#9C9C9C"}`

County statistics by FIPS (200, 0.5 s). Returns XML holding a `returnURL`. Fetch that URL for the table (200; JS-object syntax with **unquoted keys**, so parse it leniently):
```
https://nassgeodata.gmu.edu/axis2/services/CDLService/GetCDLStat?year={YYYY}&fips={5-digit FIPS}&format=json
→ https://nassgeodata.gmu.edu/webservice/nass_data_cache/byfips/CDL_{YYYY}_{FIPS}.json
```
Polygon statistics and bbox clip. **These failed on 2026-11-14** (timeout after 90 s, then 502 Proxy Error after 180 s, tried 3 times):
```
https://nassgeodata.gmu.edu/axis2/services/CDLService/GetCDLStat?year={YYYY}&bbox={xmin},{ymin},{xmax},{ymax}&format=json     (EPSG:5070)
https://nassgeodata.gmu.edu/axis2/services/CDLService/GetCDLFile?year={YYYY}&bbox={xmin},{ymin},{xmax},{ymax}                  (returns XML with a GeoTIFF URL)
```
→ Use 2a for polygons.

## 3. NASS Crop Sequence Boundaries (CSB) [open]
ArcGIS FeatureServer on USDA SCINet. **Layer id is 0** (layer 2 returns 404). Field names are lower case. The 2024 edition covers 2017–2024 (`csbyears` "1724"). Other services: `Crop_Sequence_Boundaries_2016`…`_2020`, `Crop_Sequence_Boundary_2021`, `Crop_Sequence_Boundary_2022` (singular), `Crop_Sequence_Boundaries_2024`.

Fields within 500 m of a point, as GeoJSON in WGS84 (200, 0.3 s):
```
https://pdi.scinet.usda.gov/hosting/rest/services/Hosted/Crop_Sequence_Boundaries_2024/FeatureServer/0/query?geometry={lon},{lat}&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects&distance=500&units=esriSRUnit_Meter&outFields=csbid,csbacres,cdl2017,cdl2018,cdl2019,cdl2020,cdl2021,cdl2022,cdl2023,cdl2024,cnty,statefips&outSR=4326&f=geojson
```
- The field containing the point: drop `distance`. A bbox: `geometry={w},{s},{e},{n}&geometryType=esriGeometryEnvelope`.
- `maxRecordCount` is 2000. Page with `resultOffset`.
- Sample: `csbid 191724001201466, csbacres 46.27, cdl2017..2024 = 1,5,1,1,1,1,5,1` (1 = corn, 5 = soybeans).
- Keyless GeoParquet mirrors: `https://source.coop/fiboa/us-usda-cropland` (fiboa, EPSG:5070, 2023 edition, dissolved) and `https://source.coop/ftw/harmonized-field-data/us_usda_cropland` (2021–2024). Not tested here.

## 4. Fields of The World, global field boundaries (PMTiles) [open]
**Use `ftw/global-data`**, not `kerner-lab/fields-of-the-world`. `kerner-lab` is the 24-country *training benchmark* and does not cover the US.

| File | Layer | Zoom | Bounds | Size note |
|---|---|---|---|---|
| `https://data.source.coop/ftw/global-field-boundaries/pmtiles/ftw-global-fields-2025.pmtiles` | `fields` | 0–14 | global | default 2025 |
| `https://data.source.coop/ftw/global-data/predictions/vectors/alpha/2024_with_confidence.pmtiles` | `2024` | 10–14 | global | 2024 with confidence |

- Tested by reading the PMTiles v3 header and metadata with HTTP range requests (200). Tiles are MVT, gzip.
- Feature properties: `confidence_min, confidence_mean, confidence_median, time, label`.
- Recommended filter: `confidence_mean >= 69` (from the FTW docs).
- GeoParquet by country: `https://data.source.coop/ftw/global-data/predictions/vectors/alpha/results-by-admin-conf/admin:country_code={CC}/…parquet` (see `…/predictions/vectors/collection.json`).
- STAC: `https://data.source.coop/ftw/global-data/catalog.json`.
- Licence: CC-BY-4.0.

## 5. ORNL DAAC MODIS/VIIRS subset web service [open]
It is slow: 15–40 s per call, and one call once timed out at 90 s. Use timeouts of 120 s or more and cache. Ten dates per request at most.
```
https://modis.ornl.gov/rst/api/v1/products
https://modis.ornl.gov/rst/api/v1/{product}/bands
https://modis.ornl.gov/rst/api/v1/{product}/dates?latitude={lat}&longitude={lon}
https://modis.ornl.gov/rst/api/v1/{product}/subset?latitude={lat}&longitude={lon}&band={band}&startDate=A{YYYYDDD}&endDate=A{YYYYDDD}&kmAboveBelow=0&kmLeftRight=0
```
Tested (all 200):
- `MOD13Q1` / `250m_16_days_NDVI`, 2012-06-25..07-27 → `[6776, 6264, 6395]` × 0.0001.
- `VNP13A1` / `500_m_16_days_NDVI` (2023) → `7322` × 0.0001.
- `MOD16A2` / `ET_500m` → `257` × 0.1 = 25.7 kg/m²/8 day.
- `MOD11A2` / `LST_Day_1km` → `15076` × 0.02 = 301.5 K.

Response shape: `{xllcorner, yllcorner, cellsize, nrows, ncols, band, units, scale, latitude, longitude, header, subset:[{modis_date, calendar_date, band, tile, proc_date, data:[...]}]}`. QA bands such as `250m_16_days_pixel_reliability` are on the same endpoint.

Products also on the service: `ECO4ESIPTJPL, ECO4WUE, GEDI03, GEDI04_B, MCD12Q1, MCD15A2H, MOD16A2GF, MOD17A2H(GF), MOD21A2, SPL3SMP_E, SPL4CMDL, VNP15A2H, VNP21A2, VNP22Q2, Daymet` and more.

## 6. Terrain [open]
AWS Terrain Tiles, terrarium PNG (200, 0.4 s). Elevation = `(R*256 + G + B/256) - 32768` m.
```
https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png        (z 0–15; Iowa test tile 12/984/1520)
https://s3.amazonaws.com/elevation-tiles-prod/normal/{z}/{x}/{y}.png
```
(The `v2/terrarium` path also returns 200 with the same bytes.)

USGS EPQS point elevation (200, about 8 s, slow):
```
https://epqs.nationalmap.gov/v1/json?x={lon}&y={lat}&wkid=4326&units=Meters&includeDate=false
```
→ `{"value":"291.050384521","resolution":1,...}` (1 m lidar here).

USGS 3DEP ImageServer (200, about 5–9 s). exportImage returns JSON with an `href` to a GeoTIFF:
```
https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/exportImage?bbox={w},{s},{e},{n}&bboxSR=4326&imageSR={epsg}&size={W},{H}&format=tiff&pixelType=F32&noDataInterpretation=esriNoDataMatchAny&interpolation=RSP_BilinearInterpolation&f=json
https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/identify?geometry={"x":{lon},"y":{lat},"spatialReference":{"wkid":4326}}&geometryType=esriGeometryPoint&returnGeometry=false&returnCatalogItems=false&f=json
```
Note: identify needs the **JSON geometry with spatialReference**. A bare `x,y` with `sr=4326` returned `NoData`. Use a projected `imageSR` (e.g. 5070 or a UTM zone) for slope work so the pixels are square in metres.

## 7. SSURGO via Soil Data Access [open]
POST JSON to `https://sdmdataaccess.sc.egov.usda.gov/Tabular/post.rest` (200, 1.3 s):
```json
{"format":"JSON+COLUMNNAME","query":"<SQL>"}
```
Tested SQL (WKT in EPSG:4326). It returns one row per map unit × component, with surface-horizon properties and the share of the AOI covered by each map unit:
```sql
WITH aoi AS (SELECT geometry::STGeomFromText('POLYGON((-93.4747 42.0264,-93.4653 42.0264,-93.4653 42.0336,-93.4747 42.0336,-93.4747 42.0264))',4326) AS g),
mu AS (SELECT P.mukey, SUM(P.mupolygongeo.STIntersection(aoi.g).STArea()) AS a
       FROM mupolygon P, aoi WHERE P.mupolygongeo.STIntersects(aoi.g)=1 GROUP BY P.mukey)
SELECT mu.mukey, MU2.musym, MU2.muname, ROUND(100*mu.a/(SELECT SUM(a) FROM mu),1) AS aoi_pct,
       C.cokey, C.compname, C.comppct_r, C.majcompflag, C.slope_r, C.hydgrp, C.drainagecl, C.wei, C.weg,
       H.hzdept_r, H.hzdepb_r, H.om_r, H.claytotal_r, H.sandtotal_r, H.awc_r, H.kwfact, H.ph1to1h2o_r
FROM mu JOIN mapunit MU2 ON MU2.mukey=mu.mukey
JOIN component C ON C.mukey=mu.mukey
LEFT JOIN chorizon H ON H.cokey=C.cokey AND H.hzdept_r=0
ORDER BY aoi_pct DESC, C.comppct_r DESC
```
- Area weight for each row = `aoi_pct/100 × comppct_r/100`. Use the weighted mean for numbers and the weighted mode for `hydgrp`, `drainagecl` and `weg`.
- Sample row: `Clarion loam … 2 to 6 percent slopes | aoi_pct 22.8 | Clarion 85% | slope 3 | B | Well drained | wei 48 | weg 6 | om 3.5 | clay 21 | sand 45 | awc 0.21 | kw .24 | pH 6.2`.
- `mupolygon` has no `muname`, so join `mapunit` for the name. Numbers come back as strings.
- For a root-zone value, replace `H.hzdept_r=0` with a depth-weighted aggregation over 0–30 cm.
- Web Soil Survey link-out: `https://websoilsurvey.nrcs.usda.gov/app/WebSoilSurvey.aspx`.

## 8. NEX-GDDP-CMIP6 point time series [open]
**Best: NCCS THREDDS NetcdfSubset (NCSS), grid-as-point, CSV** (200, 0.4 s for 5 days and 6.5 s for a full year):
```
https://ds.nccs.nasa.gov/thredds/ncss/grid/AMES/NEX/GDDP-CMIP6/{model}/{scenario}/{member}/{var}/{var}_day_{model}_{scenario}_{member}_{grid}_{YYYY}{_vN.N}.nc?var={var}&latitude={lat}&longitude={lon}&time_start={YYYY}-01-01T00:00:00Z&time_end={YYYY}-12-31T23:59:59Z&accept=csv
```
- Example: `…/ACCESS-CM2/historical/r1i1p1f1/pr/pr_day_ACCESS-CM2_historical_r1i1p1f1_gn_2014_v2.0.nc`. Use `ssp245`/`ssp585` for the future scenarios.
- CSV columns: `time,station,latitude,longitude,{var}[unit]`. It snaps to the nearest 0.25° cell (42.125, -93.375 here).
- Longitude may be −180..180 or 0..360 (both tested).
- There is **one file per year per variable**. File suffixes differ by model and variable (`_v2.0`, `_v1.1`, none…), so resolve real names from `https://ds.nccs.nasa.gov/thredds/catalog/AMES/NEX/GDDP-CMIP6/{model}/{scenario}/{member}/{var}/catalog.xml`.
- Member ids also differ by model (e.g. `r1i1p1f2`, `r4i1p1f1`). List them from the model catalog.
- Cost for 1991–2014 plus 2041–2060 is 44 requests × variables × models. Run them in parallel, at most 4–6 at once, and cache the results.
- Units: `pr` kg m⁻² s⁻¹ (×86400 → mm/day), `tas/tasmax/tasmin` K. Other variables: `hurs, huss, rlds, rsds, sfcWind`.
- 35 models are listed at `https://ds.nccs.nasa.gov/thredds/catalog/AMES/NEX/GDDP-CMIP6/catalog.html`.

Alternatives:
- AWS `s3://nex-gddp-cmip6/NEX-GDDP-CMIP6/...` (anonymous, us-west-2). Each yearly file is about 244 MB of NetCDF4. Byte-range reads work but cost far more than NCSS.
- Planetary Computer STAC collection `nasa-nex-gddp-cmip6` (200) offers kerchunk/Zarr-style access through Azure.
- Open-Meteo Climate API (below) is **not** NEX-GDDP. It is HighResMIP CMIP6 and **ends in 2050**, so it cannot cover 2041–2060.

## 9. NASA Earthdata (EDL token) and GIBS

CMR collection ids (CMR search is open: `https://cmr.earthdata.nasa.gov/search/collections.umm_json?short_name={SN}`):

| Dataset | Short name / version | Concept id | Point-series route |
|---|---|---|---|
| GRACE/GRACE-FO JPL mascon RL06.3 v04 (CRI) | `TELLUS_GRAC-GRFO_MASCON_CRI_GRID_RL06.3_V4` | C3195527175-POCLOUD | **One 44 MB NetCDF** (2002-04 → 2026-09): `https://archive.podaac.earthdata.nasa.gov/podaac-ops-cumulus-protected/TELLUS_GRAC-GRFO_MASCON_CRI_GRID_RL06.3_V4/GRCTellus.JPL.200204_202609.GLO.RL06.3M.MSCNv04CRI.nc` [EDL]. Download it once and read locally. No Harmony service. The file name changes each month, so resolve it with `granules.umm_json?collection_concept_id=C3195527175-POCLOUD&sort_key=-start_date`. |
| SMAP L4 surface/root-zone SM 9 km | `SPL4SMGP` v008 | C3480440870-NSIDC_CPRD | AppEEARS point (`SPL4SMGP.008`) [EDL], or Harmony `sds/HOSS-regridder-reformatter` (bbox/variable/temporal → NetCDF/GeoTIFF) |
| SMAP L3 enhanced 9 km | `SPL3SMP_E` v006 | C2938664763-NSIDC_CPRD | AppEEARS `SPL3SMP_E.006`; also ORNL web service `SPL3SMP_E` [open] |
| IMERG daily Final / Late / Early V07 | `GPM_3IMERGDF` / `GPM_3IMERGDL` / `GPM_3IMERGDE` 07 | C2723754864 / C2723754859 / C2723754850 -GES_DISC | Harmony `giovanni-time-series-adapter` (CSV area-average time series) [EDL]. Final ends 2025-09-30 in CMR, so use Late after that. |
| ECOSTRESS LST / ET (JET) / ESI | `ECO_L2T_LSTE`, `ECO_L3T_JET`, `ECO_L4T_ESI` **v003 (Collection 3)** and v002 | v003: C3998139651, C4057232489, C4057232495 -LPCLOUD | AppEEARS currently lists **only v002** (`ECO_L2T_LSTE.002`, `ECO_L3T_JET.002`, `ECO_L4T_ESI.002`, plus `ECO_L3T_ET_ALEXI.002`). For C3, read the tiled COGs directly with earthaccess. |
| HLS Landsat / Sentinel 30 m | `HLSL30` / `HLSS30` v2.0 | C2021957657 / C2021957295 -LPCLOUD | AppEEARS `HLSL30.020`, `HLSS30.020`, and **`HLSL30_VI.020` / `HLSS30_VI.020` (ready-made NDVI/EVI)**. Or STAC `https://cmr.earthdata.nasa.gov/stac/LPCLOUD` plus COG range reads [EDL]. |
| GEDI L4B gridded AGBD 1 km | `GEDI_L4B_Gridded_Biomass_V2_1_2299` v2.1 | C2792577683-ORNL_CLOUD | It is a static map (2019-04 → 2023-03). ORNL web service product `GEDI04_B` [open] for points, or download the COG once. |
| GEDI L4A footprints | `GEDI_L4A_AGB_Density_V2_1_2056` | C2237824918-ORNL_CLOUD | Data run to 2025-07. Harmony/earthaccess [EDL]. |
| NLDAS-2 monthly / GLDAS-2.1 monthly | `NLDAS_NOAH0125_M` 2.0 / `GLDAS_NOAH025_M` 2.1 | C1887990023 / C1342986036 -GES_DISC | GES DISC Data Rods (`hydro1.gesdisc.eosdis.nasa.gov/daac-bin/access/timeseries.cgi`) now **redirects to Earthdata Login** [EDL]. Harmony works too. |
| NASADEM | `NASADEM_HGT` 001 | C2763264762-LPCLOUD | AppEEARS `NASADEM_NC.001`; for the US, 3DEP is better |

AppEEARS: the product list is open (`https://appeears.earthdatacloud.nasa.gov/api/product`, 200). A task needs `POST /api/login` with EDL basic auth to get a bearer token, then `POST /api/task` (type `point` or `area`), poll `GET /api/status/{task_id}`, and `GET /api/bundle/{task_id}`. Expect minutes to hours, so run it only in **precompute**.
Harmony: `https://harmony.earthdata.nasa.gov/capabilities?collectionId={concept_id}` is open (200). Data requests need `Authorization: Bearer {EDL token}`.

### GIBS WMTS [open] (map overlays only, not data values)
```
https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/{Layer}/default/{YYYY-MM-DD}/{TileMatrixSet}/{z}/{y}/{x}.{png|jpg}
```
Capabilities: `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/1.0.0/WMTSCapabilities.xml` (5.8 MB). All tile fetches below returned 200.

| Layer id | TileMatrixSet | Fmt | Latest (default) on 2026-11-14 |
|---|---|---|---|
| `SMAP_L4_Analyzed_Root_Zone_Soil_Moisture` | GoogleMapsCompatible_Level6 | png | 2026-11-10 (gap 2025-10-10 → 2025-12-11) |
| `SMAP_L4_Analyzed_Surface_Soil_Moisture` | GoogleMapsCompatible_Level6 | png | 2026-11-10 |
| `SMAP_L3_Passive_Enhanced_Day_Soil_Moisture` | (see caps) | png | — |
| `IMERG_Precipitation_Rate` | GoogleMapsCompatible_Level6 | png | 2026-11-12 |
| `MODIS_Terra_L3_NDVI_16Day` | GoogleMapsCompatible_Level9 | png | 2026-10-16 |
| `VIIRS_SNPP_L3_NDVI_16Day`, `VIIRS_NOAA20_L3_NDVI_16Day` | (see caps) | png | — |
| `MODIS_Terra_L3_Land_Surface_Temp_8Day_Day` | GoogleMapsCompatible_Level7 | png | 2026-11-01 |
| `HLS_S30_Nadir_BRDF_Adjusted_Reflectance`, `HLS_L30_…` | GoogleMapsCompatible_Level12 | png | 2026-11-06 |
| `MODIS_Terra_CorrectedReflectance_TrueColor` | GoogleMapsCompatible_Level9 | jpg | 2026-11-14 |
| `VIIRS_SNPP_CorrectedReflectance_TrueColor` | GoogleMapsCompatible_Level9 | jpg | 2026-11-02 |
| `GRACE_Tellus_Liquid_Water_Equivalent_Thickness_Mascon_CRI` | GoogleMapsCompatible_Level6 | png | **2022-07-01 (stale)** |
| `GLDAS_Underground_Soil_Moisture_Monthly`, `MERRA2_Soil_Water_Root_Zone_Monthly` | (see caps) | png | — |

There are no ECOSTRESS layers in GIBS epsg3857 "best".

## 10. Other sources

| Source | Tested URL template | Result |
|---|---|---|
| Open-Meteo archive (ERA5-Land) [open] | `https://archive-api.open-meteo.com/v1/archive?latitude={lat}&longitude={lon}&start_date={YYYY-MM-DD}&end_date={YYYY-MM-DD}&daily=temperature_2m_max,precipitation_sum,wind_speed_10m_max,et0_fao_evapotranspiration&hourly=soil_moisture_0_to_7cm,soil_temperature_0_to_7cm&models=era5_land&timezone=auto` | 200, 0.7 s |
| Open-Meteo ERA5 only [open] | `https://archive-api.open-meteo.com/v1/era5?latitude={lat}&longitude={lon}&start_date=…&end_date=…&daily=temperature_2m_max,precipitation_sum` | 200 |
| Open-Meteo climate (CMIP6 HighResMIP) [open] | `https://climate-api.open-meteo.com/v1/climate?latitude={lat}&longitude={lon}&start_date=1950-01-01&end_date=2050-12-31&models=EC_Earth3P_HR,MRI_AGCM3_2_S,CMCC_CM2_VHR4,FGOALS_f3_H,HiRAM_SIT_HR,MPI_ESM1_2_XR,NICAM16_8S&daily=temperature_2m_max,precipitation_sum` | 200. **2060 returns 400 "Invalid date"**: the API ends in 2050. |
| Open-Meteo forecast [open] | `https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lon}&daily=temperature_2m_max,precipitation_sum,wind_speed_10m_max&forecast_days=16` | 200 |
| NWS [open, User-Agent required] | `https://api.weather.gov/points/{lat},{lon}`, then follow `properties.forecast` (here `https://api.weather.gov/gridpoints/DMX/78,69/forecast`), `forecastHourly`, `forecastGridData` | 200 |
| USGS Water Data OGC API [open; api.data.gov key raises limits] | Sites: `https://api.waterdata.usgs.gov/ogcapi/v0/collections/monitoring-locations/items?f=json&bbox={w},{s},{e},{n}&site_type_code=GW&limit=100` · Groundwater levels: `https://api.waterdata.usgs.gov/ogcapi/v0/collections/field-measurements/items?f=json&bbox={w},{s},{e},{n}&parameter_code=72019&limit=1000` (72019 = depth to water below land surface, ft) · also `daily`, `continuous`, `latest-daily` | 200 (field-measurements in Iowa took 38 s; in Kansas 0.3 s) |
| USGS NWIS legacy | `https://waterservices.usgs.gov/nwis/site/?format=rdb&bBox=…&siteType=GW` | 200 |
| USGS NWIS legacy gwlevels | `https://waterservices.usgs.gov/nwis/gwlevels/?…` | **403, retired**. Use `field-measurements`. |
| CoCoRaHS [open] | `https://data.cocorahs.org/export/exportreports.aspx?ReportType=Daily&dtf=1&Format=CSV&State={ST}&County={CC}&ReportDateType=reportdate&StartDate={M/D/YYYY}&EndDate={M/D/YYYY}&TimesInGMT=False` (Story County = `IA`/`SR`) | 200 CSV with station lat/lon and TotalPrecipAmt in inches |
| PRISM [open] | Daily/monthly grids: `https://services.nacse.org/prism/data/get/us/{4km|800m}/{ppt|tmin|tmax|tmean|tdmean|vpdmin|vpdmax}/{YYYYMMDD|YYYYMM|YYYY}` (add `?format=nc` or `asc`; default COG in a zip) · Normals 1991–2020: `https://services.nacse.org/prism/data/get/normals/us/{4km|800m}/{var}/{MM|14}` | 200 zip (4 km month about 3 MB; 800 m normals about 58 MB). **No point/time-series API.** Download the CONUS grid and sample it locally. The old `/data/public/` path now returns a notice page. |
| NASS QuickStats [key] | `https://quickstats.nass.usda.gov/api/api_GET/?key={NASS_API_KEY}&source_desc=SURVEY&commodity_desc=CORN&statisticcat_desc=YIELD&agg_level_desc=COUNTY&state_alpha=IA&county_ansi=169&format=JSON` | 401 without a key, as expected. The key is free. |
| AMS MyMarketNews [key] | `https://marsapi.ams.usda.gov/services/v1.2/reports` (HTTP basic auth, key as user name) | 403 without a key, as expected |
| OpenET [key] | `POST https://openet-api.org/raster/timeseries/point` (also `/raster/timeseries/polygon`, `/multipolygon`, `/geodatabase/timeseries`). Header `Authorization: {OPENET_API_KEY}` | 405 on GET. The OpenAPI spec is open at `/openapi.json`. |
| FAOSTAT | API `https://faostatservices.fao.org/api/v1/en/data/QCL?...` → **401 "Missing Authorization Header"** (now needs a token); the old `fenixservices.fao.org` → 521. **Bulk zip is open**: `https://bulks-faostat.fao.org/production/Production_Crops_Livestock_E_All_Data_(Normalized).zip` | zip 200, 34 MB, modified 2025-12-31 |
| World Bank Pink Sheet [open] | `https://thedocs.worldbank.org/en/doc/74e8be41ceb20fa0da750cda2f6b9e4e-0050012026/related/CMO-Historical-Data-Monthly.xlsx` (and `…-Annual.xlsx`) | 200, modified 2026-11-03. The doc id changes each year (2025 id `18675f1d…-0050012025` is frozen at Jan 2026), so scrape `https://www.worldbank.org/en/research/commodity-markets` for the link. |
| USDA ERS costs & returns [open] | `https://www.ers.usda.gov/media/4962/corn.csv`, `/4976/soybeans.csv`, `/4978/wheat.csv`, `/4966/barley.csv`, `/4972/sorghum.csv`, `/4974/oats.csv`, `/4964/cotton.csv`, `/4970/rice.csv`, `/4968/peanuts.csv`; forecasts `/media/4923/cost-of-production-forecasts-for-major-us-field-crops-2026f-2027f.csv` | 200. Columns: Commodity, Category, Item, Units, Size, Region, Country, Year, Value, Survey base year. Media ids can change, so scrape `https://www.ers.usda.gov/data-products/commodity-costs-and-returns`. |
| GeoNames [open] | `https://download.geonames.org/export/dump/cities15000.zip` (plus `admin1CodesASCII.txt`) | 200, 3.4 MB |
| Natural Earth [open] | `https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_countries.geojson` (3 MB), `…/ne_10m_admin_1_states_provinces.geojson` (41 MB; use 50m for the web) | 200 |
| AAFC Annual Crop Inventory [open] | `https://www.agr.gc.ca/imagery-images/rest/services/annual_crop_inventory/{YYYY}/ImageServer/identify?geometry={"x":{lon},"y":{lat},"spatialReference":{"wkid":4326}}&geometryType=esriGeometryPoint&returnGeometry=false&returnCatalogItems=false&f=json` (years 2009–2025; `computeHistograms` for polygons) | 200 → `"value":"34"` (AAFC class code) |
| SoilGrids REST (beta, fair use about 5 calls/min) [open] | `https://rest.isric.org/soilgrids/v2.0/properties/query?lon={lon}&lat={lat}&property=soc&property=clay&property=phh2o&depth=0-5cm&depth=5-15cm&value=mean&value=Q0.05&value=Q0.95` | 200, about 12 s. Values are scaled (`d_factor`). |
| SoilGrids WCS [open] | `https://maps.isric.org/mapserv?map=/map/{prop}.map&SERVICE=WCS&VERSION=2.0.1&REQUEST=GetCoverage&COVERAGEID={prop}_{depth}_mean&FORMAT=image/tiff&SUBSET=X({w},{e})&SUBSET=Y({s},{n})&SUBSETTINGCRS=http://www.opengis.net/def/crs/EPSG/0/4326&OUTPUTCRS=http://www.opengis.net/def/crs/EPSG/0/4326` | 200 GeoTIFF |
| FAO GAEZ v4 [open] | `https://s3.eu-west-1.amazonaws.com/data.gaezdev.aws.fao.org/res05/{climate}/{scenario}/{period}{input}/{var}{input}{water}{co2}_{crop}.tif` e.g. `res05/CRUTS32/Hist/6190H/ycHr0_whe.tif`, `res05/CRUTS32/Hist/8110H/suHr_mze.tif` | 200 GeoTIFF, 1–3 MB, global 5′. Build the paths from the GAEZ portal "download URL" export. |
| ESA WorldCereal 2021 [open] | Zenodo `https://zenodo.org/records/7875105` (per-AEZ GeoTIFF zips) | 200 metadata. The Terrascope WMS did not respond. |
| NAIP (USGS) [open] | `https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPImagery/ImageServer/exportImage?bbox={w},{s},{e},{n}&bboxSR=4326&imageSR=3857&size=512,512&format=jpgpng&f=json` (also `/tile/{z}/{y}/{x}` via the MapServer cache) | 200, about 15 s |
| EOX Sentinel-2 cloudless [open] | `https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-{YYYY}_3857/default/g/{z}/{y}/{x}.jpg` (2016 layer is `s2cloudless_3857`) | 200 (2020, 2024 tested). **Only 2016 is CC BY 4.0.** |
| Esri World Imagery | `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}` | 200 keyless, but see LICENSES.md |
| Planetary Computer STAC [open] | `https://planetarycomputer.microsoft.com/api/stac/v1/collections/{id}` | 200 |
