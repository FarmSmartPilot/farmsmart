"""Satellite/reanalysis vs ground: NASA POWER vs NOAA GHCN-Daily stations at the pilot fields.

Run: python qc/validate_weather.py   -> qc/reports/weather_agreement.json + .md
Metrics: bias, MAE, correlation (daily, monthly), heavy-rain day detection (hit rate / false alarms)."""
from __future__ import annotations

import json
import sys
from io import StringIO
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from fieldshift.config import http  # noqa: E402
from fieldshift.ingest import power  # noqa: E402

SITES = [
    {"pilot": "Story County, IA", "station": "USC00130203", "station_name": "Ames 8 WSW (GHCN-Daily)", "lat": 42.11119, "lon": -93.46928},
    {"pilot": "Garden City, KS", "station": "USW00023064", "station_name": "Garden City Regional Airport (GHCN-Daily)", "lat": 37.92785, "lon": -100.69216},
]
START, END = "2001-01-01", "2024-12-31"


def ghcn(station: str) -> pd.DataFrame:
    r = http().get("https://www.ncei.noaa.gov/access/services/data/v1", params={
        "dataset": "daily-summaries", "stations": station, "startDate": START, "endDate": END,
        "dataTypes": "PRCP,TMAX,TMIN", "units": "metric", "format": "csv", "includeAttributes": "false"}, timeout=300)
    r.raise_for_status()
    df = pd.read_csv(StringIO(r.text), parse_dates=["DATE"]).set_index("DATE")
    return df[["PRCP", "TMAX", "TMIN"]].astype(float)


def metrics(a: pd.Series, b: pd.Series) -> dict:
    j = pd.concat([a, b], axis=1).dropna()
    if len(j) < 30:
        return {"n": int(len(j))}
    x, y = j.iloc[:, 0], j.iloc[:, 1]
    return {"n": int(len(j)), "bias": round(float((x - y).mean()), 3), "mae": round(float((x - y).abs().mean()), 3),
            "r": round(float(np.corrcoef(x, y)[0, 1]), 3)}


def main():
    out = []
    for s in SITES:
        g = ghcn(s["station"])
        p = power.daily(s["lat"], s["lon"])
        p = p.loc[START:END]
        m_g = g["PRCP"].resample("MS").sum(min_count=25)
        m_p = p["PRCRCORR" if "PRCRCORR" in p else "PRECTOTCORR"].resample("MS").sum(min_count=25)
        heavy_g = g["PRCP"] >= 25.4
        heavy_p = p["PRECTOTCORR"] >= 25.4
        j = pd.concat([heavy_g, heavy_p], axis=1).dropna()
        hits = int((j.iloc[:, 0] & j.iloc[:, 1]).sum())
        events = int(j.iloc[:, 0].sum())
        false = int((~j.iloc[:, 0].astype(bool) & j.iloc[:, 1].astype(bool)).sum())
        # same-or-next-day hits (timing offsets between 24 h windows)
        g1 = j.iloc[:, 0].astype(bool)
        p1 = j.iloc[:, 1].astype(bool)
        near = int((g1 & (p1 | p1.shift(1, fill_value=False) | p1.shift(-1, fill_value=False))).sum())
        res = {
            **s, "period": [START, END],
            "tmax_daily": metrics(p["T2M_MAX"], g["TMAX"]), "tmin_daily": metrics(p["T2M_MIN"], g["TMIN"]),
            "precip_daily": metrics(p["PRECTOTCORR"], g["PRCP"]), "precip_monthly": metrics(m_p, m_g),
            "annual_precip_mean_mm": {"power": round(float(p["PRECTOTCORR"].resample("YS").sum().mean()), 1),
                                      "station": round(float(g["PRCP"].resample("YS").sum(min_count=330).mean()), 1)},
            "heavy_rain_days": {"station_events": events, "power_same_day_hits": hits, "power_within_1_day": near,
                                "power_false_alarms": false,
                                "hit_rate_same_day": round(hits / events, 3) if events else None,
                                "hit_rate_within_1_day": round(near / events, 3) if events else None},
        }
        out.append(res)
        print(json.dumps(res, indent=1))
    rep = ROOT / "qc" / "reports"
    rep.mkdir(parents=True, exist_ok=True)
    (rep / "weather_agreement.json").write_text(json.dumps(out, indent=1), encoding="utf-8")
    lines = ["# Satellite/reanalysis vs ground: NASA POWER vs NOAA GHCN-Daily", "",
             "POWER is a ≈50 km grid value; a rain gauge is a point. We expect good agreement for temperature and monthly rain, "
             "and weaker agreement for single heavy-rain days (storms are local). This is why FarmSmart labels POWER values as regional.", ""]
    for r in out:
        lines += [f"## {r['pilot']} vs {r['station_name']} ({r['period'][0]}–{r['period'][1]})", "",
                  "| Variable | n | Bias (POWER − station) | MAE | r |", "|---|---|---|---|---|"]
        for k, lab in (("tmax_daily", "Daily Tmax °C"), ("tmin_daily", "Daily Tmin °C"), ("precip_daily", "Daily rain mm"),
                       ("precip_monthly", "Monthly rain mm")):
            m = r[k]
            lines.append(f"| {lab} | {m.get('n')} | {m.get('bias')} | {m.get('mae')} | {m.get('r')} |")
        h = r["heavy_rain_days"]
        lines += ["", f"Annual rain: POWER {r['annual_precip_mean_mm']['power']} mm vs station {r['annual_precip_mean_mm']['station']} mm.",
                  f"Heavy-rain days (≥25.4 mm at the gauge): {h['station_events']}; POWER caught {h['hit_rate_same_day']} the same day, "
                  f"{h['hit_rate_within_1_day']} within ±1 day; {h['power_false_alarms']} POWER-only heavy days.", ""]
    (rep / "weather_agreement.md").write_text("\n".join(lines), encoding="utf-8")


if __name__ == "__main__":
    main()
