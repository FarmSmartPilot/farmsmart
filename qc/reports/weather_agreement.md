# Satellite/reanalysis vs ground: NASA POWER vs NOAA GHCN-Daily

POWER is a ≈50 km grid value; a rain gauge is a point. We expect good agreement for temperature and monthly rain, and weaker agreement for single heavy-rain days (storms are local). This is why FarmSmart labels POWER values as regional.

## Story County, IA vs Ames 8 WSW (GHCN-Daily) (2001-01-01–2024-12-31)

| Variable | n | Bias (POWER − station) | MAE | r |
|---|---|---|---|---|
| Daily Tmax °C | 8733 | 0.416 | 3.648 | 0.929 |
| Daily Tmin °C | 8732 | 1.209 | 2.675 | 0.957 |
| Daily rain mm | 8757 | -0.373 | 3.301 | 0.325 |
| Monthly rain mm | 288 | -11.248 | 18.524 | 0.917 |

Annual rain: POWER 840.2 mm vs station 975.2 mm.
Heavy-rain days (≥25.4 mm at the gauge): 229; POWER caught 0.083 the same day, 0.38 within ±1 day; 87 POWER-only heavy days.

## Garden City, KS vs Garden City Regional Airport (GHCN-Daily) (2001-01-01–2024-12-31)

| Variable | n | Bias (POWER − station) | MAE | r |
|---|---|---|---|---|
| Daily Tmax °C | 8741 | 0.41 | 1.526 | 0.984 |
| Daily Tmin °C | 8743 | 2.265 | 2.523 | 0.978 |
| Daily rain mm | 8750 | 0.289 | 1.088 | 0.7 |
| Monthly rain mm | 288 | 8.793 | 13.877 | 0.904 |

Annual rain: POWER 540.4 mm vs station 434.9 mm.
Heavy-rain days (≥25.4 mm at the gauge): 95; POWER caught 0.295 the same day, 0.4 within ±1 day; 19 POWER-only heavy days.
