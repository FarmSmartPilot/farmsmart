# NASA Earthdata products: validation at the pilot fields

Generated 2026-11-14 by `qc/validate_nasa.py`. All numbers come from cached real downloads.

## 1. GPM IMERG daily rain vs rain gauge (GHCN-Daily) and NASA POWER

- **Story County, IA**: not run. IMERG not retrieved. giovanni: Giovanni time series: token not accepted (approve GES DISC / Giovanni in your Earthdata profile) | opendap: HTTP 403 at opendap.earthdata.nasa.gov (token rejected or app not approved)

- **Garden City, KS**: not run. IMERG not retrieved. giovanni: Giovanni time series: token not accepted (approve GES DISC / Giovanni in your Earthdata profile) | opendap: HTTP 403 at opendap.earthdata.nasa.gov (token rejected or app not approved)

## 2. SMAP L4 root-zone soil moisture vs NASA POWER GWETROOT

Both are model-based regional values (SMAP L4: 9 km land model with satellite assimilation; POWER: MERRA-2, ≈50 km). Agreement says the two pictures of wet and dry spells are consistent; it is not a check against a field probe.

| Field | Period | r weekly raw | r weekly anomaly (Spearman) | n weeks | our percentile vs product pctl r |
|---|---|---|---|---|---|
| Story County, Iowa | 2015-04-01…2026-11-10 | 0.818 | 0.867 (0.891) | 607 | 0.935 |
| Story County, Iowa (continuous corn) | 2015-04-01…2026-11-10 | 0.811 | 0.836 (0.858) | 607 | 0.939 |
| Garden City, Kansas (dryland) | 2015-04-01…2026-11-10 | 0.867 | 0.866 (0.854) | 607 | 0.932 |
| Garden City, Kansas (irrigated corn) | 2015-04-01…2026-11-10 | 0.86 | 0.858 (0.854) | 607 | 0.908 |
| San Joaquin Valley, California | 2015-04-01…2026-11-10 | 0.961 | 0.887 (0.832) | 607 | 0.933 |
| Near Regina, Saskatchewan | 2015-04-01…2026-11-10 | 0.583 | 0.627 (0.628) | 607 | 0.907 |
| Near Ludhiana, Punjab (India) | 2015-04-01…2026-11-10 | 0.7 | 0.631 (0.622) | 607 | 0.608 |
| Near Sorriso, Mato Grosso (Brazil) | 2015-04-01…2026-11-10 | 0.788 | 0.537 (0.536) | 607 | 0.9 |

## 3. HLS observed greenness vs the model's crop-in-field calendar (baseline card)

HLS status per month: field-median NDVI ≥ 0.25 = green cover; below = bare or residue (satellite greenness status, not residue amount). Model: months between planting and harvest of the cash crop that matches that year's CDL crop. Expected mismatches: the planting month (no canopy yet), the harvest month, weeds or volunteers, and the fact that the model uses typical dates, not this farm's actual dates.

| Field | Year | CDL crop | months with clear scene | agree (0.25) | agreement (0.25) | agreement if threshold 0.30 |
|---|---|---|---|---|---|---|
| Story County, Iowa | 2022 | corn | 12 | 11 | 0.917 | 0.917 |
| Story County, Iowa | 2023 | soybean | not comparable: soybean not in the card's 2-year window | | | |
| Story County, Iowa | 2024 | corn | 12 | 10 | 0.833 | 0.75 |
| Story County, Iowa (continuous corn) | 2022 | soybean | 12 | 9 | 0.75 | 0.833 |
| Story County, Iowa (continuous corn) | 2023 | corn | 12 | 10 | 0.833 | 0.75 |
| Story County, Iowa (continuous corn) | 2024 | soybean | 12 | 10 | 0.833 | 0.75 |
| Garden City, Kansas (dryland) | 2022 | fallow | 12 | 10 | 0.833 | 0.917 |
| Garden City, Kansas (dryland) | 2023 | winter_wheat | 12 | 5 | 0.417 | 0.5 |
| Garden City, Kansas (dryland) | 2024 | sorghum | 12 | 11 | 0.917 | 0.917 |
| Garden City, Kansas (irrigated corn) | 2022 | corn | 12 | 10 | 0.833 | 0.833 |
| Garden City, Kansas (irrigated corn) | 2023 | corn | 12 | 7 | 0.583 | 0.75 |
| Garden City, Kansas (irrigated corn) | 2024 | triticale | not comparable: triticale not in the card's 2-year window | | | |
| San Joaquin Valley, California | 2022 | cotton | 12 | 10 | 0.833 | 0.833 |
| San Joaquin Valley, California | 2023 | fallow | 10 | 6 | 0.6 | 0.7 |
| San Joaquin Valley, California | 2024 | cotton | 12 | 10 | 0.833 | 0.833 |

### Month-by-month disagreements

- Story County, Iowa 2022 (corn): M02 model no crop / HLS green (NDVI 0.258)
- Story County, Iowa 2024 (corn): M01 model no crop / HLS green (NDVI 0.358), M10 model crop / HLS bare_or_residue (NDVI 0.242)
- Story County, Iowa (continuous corn) 2022 (soybean): M05 model crop / HLS bare_or_residue (NDVI 0.223), M10 model crop / HLS bare_or_residue (NDVI 0.243), M11 model no crop / HLS green (NDVI 0.261)
- Story County, Iowa (continuous corn) 2023 (corn): M02 model no crop / HLS green (NDVI 0.382), M05 model crop / HLS bare_or_residue (NDVI 0.232)
- Story County, Iowa (continuous corn) 2024 (soybean): M01 model no crop / HLS green (NDVI 0.322), M10 model crop / HLS bare_or_residue (NDVI 0.229)
- Garden City, Kansas (dryland) 2022 (fallow): M11 model no crop / HLS green (NDVI 0.304), M12 model no crop / HLS green (NDVI 0.283)
- Garden City, Kansas (dryland) 2023 (winter_wheat): M02 model crop / HLS bare_or_residue (NDVI 0.225), M03 model crop / HLS bare_or_residue (NDVI 0.233), M04 model crop / HLS bare_or_residue (NDVI 0.231), M07 model no crop / HLS green (NDVI 0.334), M08 model no crop / HLS green (NDVI 0.321), M09 model no crop / HLS green (NDVI 0.273), M10 model no crop / HLS green (NDVI 0.263)
- Garden City, Kansas (dryland) 2024 (sorghum): M06 model crop / HLS bare_or_residue (NDVI 0.213)
- Garden City, Kansas (irrigated corn) 2022 (corn): M04 model crop / HLS bare_or_residue (NDVI 0.187), M05 model crop / HLS bare_or_residue (NDVI 0.193)
- Garden City, Kansas (irrigated corn) 2023 (corn): M04 model crop / HLS bare_or_residue (NDVI 0.205), M05 model crop / HLS bare_or_residue (NDVI 0.229), M10 model crop / HLS bare_or_residue (NDVI 0.245), M11 model no crop / HLS green (NDVI 0.25), M12 model no crop / HLS green (NDVI 0.282)
- San Joaquin Valley, California 2022 (cotton): M04 model crop / HLS bare_or_residue (NDVI 0.228), M05 model crop / HLS bare_or_residue (NDVI 0.231)
- San Joaquin Valley, California 2023 (fallow): M03 model no crop / HLS green (NDVI 0.321), M07 model no crop / HLS green (NDVI 0.371), M08 model no crop / HLS green (NDVI 0.277), M09 model no crop / HLS green (NDVI 0.318)
- San Joaquin Valley, California 2024 (cotton): M04 model crop / HLS bare_or_residue (NDVI 0.221), M11 model no crop / HLS green (NDVI 0.33)

## Interpretation

- **IMERG** could not be validated today: every GES DISC route returns HTTP 403 "EULA Acceptance Failure" for this
  Earthdata account. Once the account owner approves the GES DISC application, rerun this script; the comparison code
  (daily r, bias, monthly r, heavy-rain day hits against the gauge and POWER) is in place.
- **SMAP vs POWER GWETROOT**: weekly anomalies agree well at the five US fields (r 0.84 to 0.89) and less well at
  Saskatchewan (0.63), Punjab (0.63) and Mato Grosso (0.54). Both are model-based regional products (SMAP L4
  assimilates satellite brightness temperature into a 9 km land model; POWER is MERRA-2 at about 50 km), so this
  shows consistent wet and dry spells, not field truth. Lower values are expected where snow and frozen soil dominate
  (Saskatchewan), where irrigation wets soil that neither model knows about (Punjab), and where MERRA-2 rain is
  weakest (the tropics). SMAP's own percentile field and our empirical weekly percentile agree (r 0.90 to 0.94),
  except Punjab (0.61).
- **HLS vs the model calendar**: in most comparable years 75 to 92 % of months agree. Mismatches cluster where
  expected: the planting month (crop in the field, no canopy yet), the harvest month (October), and dormant months
  with NDVI within 0.03 of the 0.25 threshold. The largest gap is Kansas dryland 2023 winter wheat (42 %): the
  field stayed brown in February to April, was green only in May and June, then weakly green (NDVI 0.26 to 0.33)
  from July to October after harvest. That fits the 2022-23 southwest Kansas drought (thin, partly failed wheat)
  and summer weeds or volunteers, which the model's typical calendar does not show.
- **Caveats**: the model uses typical state-level planting and harvest dates, not this farm's dates; "crop in field"
  is not the same as "green canopy"; HLS status is greenness only (it cannot see residue amount); a year is compared
  only when its CDL crop is a phase shown in the baseline card's 2-year window; fallow years are compared with
  "no crop", ignoring fall wheat planting. Non-US pilots have no CDL, so they are not in this table.

