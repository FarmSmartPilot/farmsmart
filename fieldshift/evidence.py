"""Evidence records: provenance for every displayed number."""
from __future__ import annotations

import hashlib
from datetime import date, datetime, timezone
from typing import Any

from .contracts import EvidenceRecord

# Static catalogue of source metadata (licence, citation). Retrieval-specific fields are added per call.
SOURCES: dict[str, dict[str, Any]] = {
    "power": dict(source="NASA POWER", product="POWER Daily API (AG community)", version="v2.x",
                  is_nasa=True, native_res="0.5° x 0.625° (≈50 km) meteorology; 1° solar",
                  licence="Public domain (NASA); attribution requested",
                  citation="NASA Langley Research Center POWER Project, funded through the NASA Earth Science Directorate Applied Science Program.",
                  url="https://power.larc.nasa.gov/"),
    "power_hourly": dict(source="NASA POWER", product="POWER Hourly API (WS10M, WD10M)", version="v2.x",
                         is_nasa=True, native_res="0.5° x 0.625° (≈50 km), MERRA-2 based",
                         licence="Public domain (NASA)",
                         citation="NASA Langley Research Center POWER Project.", url="https://power.larc.nasa.gov/"),
    "ssurgo": dict(source="USDA NRCS", product="SSURGO via Soil Data Access", version="current",
                   is_nasa=False, native_res="1:12,000–1:24,000 map units",
                   licence="Public domain (USDA)",
                   citation="Soil Survey Staff, NRCS, USDA. Soil Survey Geographic (SSURGO) Database. https://sdmdataaccess.sc.egov.usda.gov",
                   url="https://websoilsurvey.nrcs.usda.gov/"),
    "cdl": dict(source="USDA NASS", product="Cropland Data Layer (CropScape)", version="annual",
                is_nasa=False, native_res="30 m", licence="Public domain (USDA)",
                citation="USDA NASS Cropland Data Layer. https://nassgeodata.gmu.edu/CropScape/",
                url="https://www.nass.usda.gov/Research_and_Science/Cropland/"),
    "terrain": dict(source="AWS Terrain Tiles (Mapzen); USGS 3DEP / SRTM / NASADEM sources", product="Terrarium elevation tiles",
                    version="v1", is_nasa=True, native_res="≈10–30 m (US), ≈30 m global (SRTM)",
                    licence="Open; attribution required (see docs/LICENSES.md)",
                    citation="Terrain Tiles, Amazon Open Data; includes USGS 3DEP, SRTM (NASA/USGS), ETOPO1, others.",
                    url="https://registry.opendata.aws/terrain-tiles/"),
    "modis_ndvi": dict(source="NASA LP DAAC / ORNL DAAC", product="MOD13Q1 v061 NDVI (16-day)", version="061",
                       is_nasa=True, native_res="250 m", licence="Public domain (NASA)",
                       citation="Didan, K. (2021). MOD13Q1 MODIS/Terra Vegetation Indices 16-Day L3 Global 250m SIN Grid V061. NASA EOSDIS LP DAAC. Served by ORNL DAAC MODIS web service.",
                       url="https://modis.ornl.gov/data/modis_webservice.html"),
    "nominatim": dict(source="OpenStreetMap Nominatim", product="Geocoder", version="live", is_nasa=False,
                      native_res="n/a", licence="ODbL 1.0", citation="© OpenStreetMap contributors",
                      url="https://nominatim.openstreetmap.org/"),
    "nass_qs": dict(source="USDA NASS", product="Quick Stats county yields", version="annual", is_nasa=False,
                    native_res="county", licence="Public domain (USDA)",
                    citation="USDA National Agricultural Statistics Service, Quick Stats. https://quickstats.nass.usda.gov/",
                    url="https://quickstats.nass.usda.gov/"),
    "nex_gddp": dict(source="NASA NEX / NCCS", product="NEX-GDDP-CMIP6 daily downscaled projections (tasmax, tasmin, pr)",
                     version="v1.x/v2.0 (per file)", is_nasa=True, native_res="0.25° (≈25 km)",
                     licence="Open (NASA); CMIP6 model terms CC BY 4.0",
                     citation="Thrasher, B., Wang, W., Michaelis, A., Melton, F., Lee, T., Nemani, R. (2022). NASA Global Daily Downscaled Projections, CMIP6. Scientific Data 9, 262. doi:10.1038/s41597-022-01393-4",
                     url="https://www.nccs.nasa.gov/services/data-collections/land-based-products/nex-gddp-cmip6"),
    "power_clim": dict(source="NASA POWER", product="POWER Climatology regional API (T2M, T2M_MAX, T2M_MIN, PRECTOTCORR)",
                       version="v2.x", is_nasa=True, native_res="0.5° x 0.625° (≈50 km), MERRA-2",
                       licence="Public domain (NASA)", citation="NASA Langley Research Center POWER Project.",
                       url="https://power.larc.nasa.gov/"),
    "gaez_lc": dict(source="FAO / IIASA", product="GAEZ v4 land-cover share GLCSv11_02 (cropland %)", version="v4",
                    is_nasa=False, native_res="5 arc-min (≈9 km)", licence="CC BY-NC-SA 3.0 IGO (FAO)",
                    citation="FAO & IIASA (2021). Global Agro-Ecological Zones version 4 (GAEZ v4). https://gaez.fao.org",
                    url="https://gaez.fao.org/"),
    "faostat": dict(source="FAO", product="FAOSTAT Crops and livestock products, Area harvested", version="bulk",
                    is_nasa=False, native_res="country", licence="CC BY 4.0 (FAO)",
                    citation="FAO. FAOSTAT: Crops and livestock products. https://www.fao.org/faostat/en/#data/QCL",
                    url="https://www.fao.org/faostat/en/#data/QCL"),
    "smap_l4": dict(source="NASA NSIDC DAAC (SMAP)", product="SMAP L4 Global 3-hourly 9 km EASE-Grid Surface and Root Zone Soil Moisture Geophysical Data (SPL4SMGP)",
                    version="008", is_nasa=True, native_res="9 km EASE-Grid 2.0, 3-hourly",
                    licence="NASA open data, no restrictions",
                    citation="Reichle, R., De Lannoy, G., Koster, R. D., Crow, W. T., Kimball, J. S., Liu, Q., Bechtold, M. (2025). SMAP L4 Global 3-hourly 9 km EASE-Grid Surface and Root Zone Soil Moisture Geophysical Data, Version 8. NASA NSIDC DAAC. doi:10.5067/T5RUATAQREF8",
                    url="https://nsidc.org/data/spl4smgp/versions/8"),
    "imerg": dict(source="NASA GES DISC (GPM)", product="GPM IMERG Final Precipitation L3 1 day 0.1° x 0.1° (GPM_3IMERGDF)",
                  version="07", is_nasa=True, native_res="0.1° (≈10 km), daily",
                  licence="NASA open data, no restrictions",
                  citation="Huffman, G.J., Stocker, E.F., Bolvin, D.T., Nelkin, E.J., Tan, J. (2023). GPM IMERG Final Precipitation L3 1 day 0.1 degree x 0.1 degree V07. Greenbelt, MD, Goddard Earth Sciences Data and Information Services Center (GES DISC). doi:10.5067/GPM/IMERGDF/DAY/07",
                  url="https://disc.gsfc.nasa.gov/datasets/GPM_3IMERGDF_07/summary"),
    "grace": dict(source="NASA JPL / PO.DAAC (GRACE and GRACE-FO)", product="JPL GRACE/GRACE-FO Mascon Ocean, Ice, and Hydrology Equivalent Water Height, Coastal Resolution Improvement (CRI) filtered",
                  version="RL06.3Mv04", is_nasa=True, native_res="3° equal-area mascons (≈300 km) on a 0.5° grid; monthly",
                  licence="NASA open data, no restrictions",
                  citation="Wiese, D.N., Yuan, D.-N., Boening, C., Landerer, F.W., Watkins, M.M. (2023). JPL GRACE and GRACE-FO Mascon Ocean, Ice, and Hydrology Equivalent Water Height RL06.3Mv04 CRI Filtered. PO.DAAC, CA, USA. doi:10.5067/TEMSC-3JC634. Method: Watkins, M.M. et al. (2015) JGR Solid Earth 120:2648; Wiese, D.N. et al. (2016) WRR 52:7490.",
                  url="https://podaac.jpl.nasa.gov/dataset/TELLUS_GRAC-GRFO_MASCON_CRI_GRID_RL06.3_V4"),
    "hls": dict(source="NASA LP DAAC (HLS)", product="Harmonized Landsat Sentinel-2 surface reflectance HLSL30 + HLSS30",
                version="2.0", is_nasa=True, native_res="30 m, every 2–3 days combined",
                licence="NASA open data; contains modified Copernicus Sentinel data",
                citation="Masek, J., Ju, J., Roger, J., Skakun, S., Vermote, E., Claverie, M., Dungan, J., Yin, Z., Freitag, B., Justice, C. (2021). HLS Operational Land Surface Reflectance and TOA Brightness Daily Global 30m v2.0 (HLSL30 doi:10.5067/HLS/HLSL30.002; HLSS30 doi:10.5067/HLS/HLSS30.002). NASA EOSDIS LP DAAC.",
                url="https://lpdaac.usgs.gov/products/hlsl30v002/"),
    "ecostress": dict(source="NASA LP DAAC (ECOSTRESS)", product="ECOSTRESS Tiled Evapotranspiration (JET ensemble) Instantaneous and Daytime L3 Global 70 m (ECO_L3T_JET)",
                      version="003", is_nasa=True, native_res="70 m tiles, irregular ISS overpass times, about 52° N to 52° S",
                      licence="NASA open data, no restrictions",
                      citation="Hook, S., Cawse-Nicholson, K., Halverson, G. (2026). ECOSTRESS Tiled Evapotranspiration PT-JPL Instantaneous and Daytime L3 Global 70 m v003 [Data set]. NASA Land Processes Distributed Active Archive Center. doi:10.5067/ECOSTRESS/ECO_L3T_JET.003",
                      url="https://doi.org/10.5067/ECOSTRESS/ECO_L3T_JET.003"),
    "soilgrids": dict(source="ISRIC World Soil Information", product="SoilGrids v2.0 (modelled soil map, not a soil survey)",
                      version="2.0", is_nasa=False, native_res="250 m (modelled)", licence="CC BY 4.0",
                      citation="Poggio, L. et al. (2021). SoilGrids 2.0: producing soil information for the globe with quantified spatial uncertainty. SOIL 7, 217-240. doi:10.5194/soil-7-217-2021. Derived: AWC Saxton & Rawls (2006) SSSAJ 70:1569; K Williams (1995) EPIC; OM = SOC x 1.724.",
                      url="https://soilgrids.org/"),
    "aafc": dict(source="Agriculture and Agri-Food Canada", product="Annual Crop Inventory (ACI)", version="annual 2009-2025",
                 is_nasa=False, native_res="30 m (56 m 2009-2010)", licence="Open Government Licence - Canada",
                 citation="AAFC Annual Crop Inventory. https://open.canada.ca/data/en/dataset/ba2645d5-4458-414d-b196-6303ac06c1c9",
                 url="https://www.agr.gc.ca/atlas/aci"),
    "ftw": dict(source="Fields of The World", product="FTW global field boundaries 2025 (PMTiles)", version="2025",
                is_nasa=False, native_res="model-delineated polygons from Sentinel-2 (10 m)", licence="CC BY 4.0",
                citation="Fields of The World global field boundaries 2025, source.coop/ftw (Kerner et al., Fields of The World).",
                url="https://fieldsofthe.world/"),
    "rules": dict(source="FarmSmart agronomy knowledge base", product="engine/rules/*.yaml", version="0.1",
                  is_nasa=False, native_res="n/a", licence="CC BY 4.0 (this project); see per-item references",
                  citation="FAO-56 (Allen et al. 1998), USDA NRCS, SARE, extension sources listed per crop.",
                  url=None),
}


def make(key: str, footprint: str, *, obs: tuple[date | None, date | None] = (None, None),
         effective_res: str | None = None, units: str | None = None, qa: list[str] | None = None,
         transformation: str | None = None, extra: dict[str, Any] | None = None) -> EvidenceRecord:
    meta = dict(SOURCES[key])
    if extra:
        meta.update(extra)
    rid = hashlib.sha1(f"{key}|{footprint}|{obs}|{transformation}".encode()).hexdigest()[:12]
    return EvidenceRecord(
        id=f"{key}-{rid}", retrieval_time=datetime.now(timezone.utc), footprint=footprint,
        observation_start=obs[0], observation_end=obs[1],
        effective_res=effective_res or meta["native_res"], units=units, qa_flags=qa or [],
        transformation=transformation, **meta,
    )


class EvidenceBag:
    """Collects evidence records for one response."""

    def __init__(self) -> None:
        self.items: dict[str, EvidenceRecord] = {}

    def add(self, rec: EvidenceRecord) -> str:
        self.items[rec.id] = rec
        return rec.id

    def dump(self) -> dict[str, Any]:
        return {k: v.model_dump(mode="json") for k, v in self.items.items()}
