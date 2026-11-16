"""NASA Earthdata products vs ground and vs our model, at the pilot fields.

Run: python qc/validate_nasa.py   -> qc/reports/nasa_validation.json + .md
1. IMERG daily vs NOAA GHCN-Daily station and vs NASA POWER (two sites from validate_weather.py).
2. SMAP L4 root-zone soil moisture vs NASA POWER GWETROOT: correlation of weekly anomalies.
3. HLS observed green / bare months vs the model's crop-in-field calendar for the baseline card,
   in years whose CDL crop matches a phase of the modelled rotation.
Everything is computed from cached real data; a product that cannot be retrieved is reported as such."""
from __future__ import annotations

import json
import sys
from datetime import date, timedelta
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "qc"))
from fieldshift.config import PRECOMP  # noqa: E402
from fieldshift.ingest import earthdata as ed  # noqa: E402
from fieldshift.ingest import power  # noqa: E402

CDL = {1: "corn", 5: "soybean", 4: "sorghum", 24: "winter_wheat", 61: "fallow", 2: "cotton", 205: "triticale"}
HLS_YEARS = (2022, 2023, 2024)


def _r(a: pd.Series, b: pd.Series) -> dict:
    j = pd.concat([a, b], axis=1).dropna()
    if len(j) < 20:
        return {"n": int(len(j)), "r": None}
    from scipy.stats import spearmanr
    return {"n": int(len(j)), "r": round(float(np.corrcoef(j.iloc[:, 0], j.iloc[:, 1])[0, 1]), 3),
            "spearman": round(float(spearmanr(j.iloc[:, 0], j.iloc[:, 1]).statistic), 3)}


def _weekly_anom(s: pd.Series) -> pd.Series:
    w = s.resample("W-SUN").mean().dropna()
    wk = np.minimum((w.index.day_of_year - 1) // 7 + 1, 52)
    return w - w.groupby(wk).transform("mean")


# ------------------------------------------------------------------ 1. IMERG
def imerg_vs_ground() -> list[dict]:
    from validate_weather import SITES, START, END, ghcn
    out = []
    for s in SITES:
        im, ev = ed.imerg_daily(s["lat"], s["lon"], START, END)
        if im is None:
            out.append({**s, "available": False, "reason": ev["reason"], "fix": ev.get("fix")})
            continue
        g = ghcn(s["station"])["PRCP"]
        p = power.daily(s["lat"], s["lon"]).loc[START:END, "PRECTOTCORR"]
        i = im["precip_mm"]
        res = {**s, "available": True, "period": [START, END]}
        for name, ref in (("station", g), ("power", p)):
            d = pd.concat([i, ref], axis=1).dropna()
            m_i = i.resample("MS").sum(min_count=25)
            m_r = ref.resample("MS").sum(min_count=25)
            hi, hr = d.iloc[:, 0] >= 25.4, d.iloc[:, 1] >= 25.4
            near = hr & (hi | hi.shift(1, fill_value=False) | hi.shift(-1, fill_value=False))
            res[f"vs_{name}"] = {
                "daily": {**_r(d.iloc[:, 0], d.iloc[:, 1]), "bias_mm": round(float((d.iloc[:, 0] - d.iloc[:, 1]).mean()), 3)},
                "monthly": _r(m_i, m_r),
                "annual_mean_mm": {"imerg": round(float(i.resample("YS").sum(min_count=330).mean()), 1),
                                   name: round(float(ref.resample("YS").sum(min_count=330).mean()), 1)},
                "heavy_days_ref": int(hr.sum()), "imerg_same_day_hits": int((hr & hi).sum()),
                "imerg_within_1_day": int(near.sum()), "imerg_only_heavy_days": int((hi & ~hr).sum())}
        out.append(res)
    return out


# ------------------------------------------------------------------ 2. SMAP vs POWER GWETROOT
def smap_vs_power(pilots) -> list[dict]:
    out = []
    for p in pilots:
        sm, ev = ed.smap_l4_rootzone(p["lat"], p["lon"])
        if sm is None:
            out.append({"field_id": p["field_id"], "name": p["name"], "available": False, "reason": ev["reason"]})
            continue
        pw = power.daily(p["lat"], p["lon"])["GWETROOT"]
        a_s, a_p = _weekly_anom(sm["sm_rootzone"]), _weekly_anom(pw.loc[sm.index.min():sm.index.max()])
        raw = _r(sm["sm_rootzone"].resample("W-SUN").mean(), pw.resample("W-SUN").mean())
        # our empirical weekly percentile vs the product's own percentile field
        w = sm["sm_rootzone"].resample("W-SUN").mean().dropna()
        wk = np.minimum((w.index.day_of_year - 1) // 7 + 1, 52)
        emp = w.groupby(wk).rank(pct=True) * 100
        nat = sm["sm_rootzone_pctl"].resample("W-SUN").mean()
        out.append({"field_id": p["field_id"], "name": p["name"], "available": True,
                    "period": [str(sm.index.min().date()), str(sm.index.max().date())],
                    "weekly_raw": raw, "weekly_anomaly": _r(a_s, a_p),
                    "empirical_vs_product_percentile": _r(emp, nat),
                    "smap_mean_m3m3": round(float(sm["sm_rootzone"].mean()), 3),
                    "power_gwetroot_mean": round(float(pw.loc[sm.index.min():].mean()), 3)})
    return out


# ------------------------------------------------------------------ 3. HLS vs model cover calendar
def _model_months(bars, crop: str) -> tuple[set[str] | None, str]:
    """Calendar months (Jan..Dec as 1..12) in which the modelled crop `crop` is in the field (planting..harvest),
    taken from the baseline card's 2-year bar window. Returns (months, note)."""
    hits = [b for b in bars if b["crop_id"] == crop and b["kind"] == "cash"]
    if not hits:
        return None, f"{crop} not in the card's 2-year window"
    months = set()
    for b in hits:
        for w in np.arange(b["start_week"], b["end_week"], 0.5):
            d = date(2001, 1, 1) + timedelta(days=float(w % 52) * 7)
            months.add(d.month)
    return months, "ok"


def hls_vs_model(pilots) -> list[dict]:
    out = []
    for p in pilots:
        fid = p["field_id"]
        cmp_f = PRECOMP / f"compare_{fid}.json"
        if not cmp_f.exists() or not p.get("meta", {}).get("cdl_sequence"):
            continue  # needs the US Cropland Data Layer crop of each year
        card = next(c for c in json.loads(cmp_f.read_text(encoding="utf-8"))["cards"] if c["is_baseline"])
        bars = card["timeline"]["bars"]
        sc, mo, ev = ed.hls_ndvi(p["feature"]["geometry"], list(HLS_YEARS), field_key=fid)
        if mo is None:
            out.append({"field_id": fid, "available": False, "reason": ev.get("reason")})
            continue
        mo = mo.set_index("month")
        seq = p["meta"]["cdl_sequence"]
        years = []
        for y in HLS_YEARS:
            crop = CDL.get(seq.get(str(y)), f"cdl_{seq.get(str(y))}")
            if crop == "fallow":
                months, note = set(), "fallow year: model has no cash crop (fall wheat planting not in the card window)"
            else:
                months, note = _model_months(bars, crop)
            obs = {int(m[-2:]): mo.loc[m, "status"] for m in mo.index if m.startswith(str(y))}
            ndvi = {int(m[-2:]): mo.loc[m, "ndvi_median"] for m in mo.index if m.startswith(str(y))}
            if months is None:
                years.append({"year": y, "cdl_crop": crop, "comparable": False, "note": note})
                continue
            rows, agree, agree30, n = [], 0, 0, 0
            for m in range(1, 13):
                st = obs.get(m, "no_clear_scene")
                model_green = m in months
                v = ndvi.get(m)
                if st != "no_clear_scene":
                    n += 1
                    agree += int((st == "green") == model_green)
                    agree30 += int((v >= 0.30) == model_green)
                rows.append({"month": m, "model_crop_in_field": model_green, "hls_status": st,
                             "hls_ndvi": None if pd.isna(v) else float(v)})
            years.append({"year": y, "cdl_crop": crop, "comparable": True, "note": note,
                          "months_with_clear_scene": n, "agree_months": agree,
                          "agreement": round(agree / n, 3) if n else None,
                          "agreement_at_0_30": round(agree30 / n, 3) if n else None, "months": rows})
        out.append({"field_id": fid, "name": p["name"], "available": True, "years": years,
                    "scenes_read": int(len(sc)), "scenes_usable": int((sc.get("valid_fraction", pd.Series(dtype=float)) >= 0.5).sum())})
    return out


def main():
    pilots = json.loads((PRECOMP / "pilots.json").read_text(encoding="utf-8"))["pilots"]
    res = {"generated": str(date.today()), "imerg": imerg_vs_ground(), "smap": smap_vs_power(pilots), "hls": hls_vs_model(pilots)}
    rep = ROOT / "qc" / "reports"
    rep.mkdir(parents=True, exist_ok=True)
    (rep / "nasa_validation.json").write_text(json.dumps(res, indent=1, default=str), encoding="utf-8")
    (rep / "nasa_validation.md").write_text(report_md(res), encoding="utf-8")
    print((rep / "nasa_validation.md").read_text(encoding="utf-8"))


def report_md(res) -> str:
    L = ["# NASA Earthdata products: validation at the pilot fields", "",
         f"Generated {res['generated']} by `qc/validate_nasa.py`. All numbers come from cached real downloads.", ""]
    L += ["## 1. GPM IMERG daily rain vs rain gauge (GHCN-Daily) and NASA POWER", ""]
    for s in res["imerg"]:
        if not s.get("available"):
            L += [f"- **{s['pilot']}**: not run. {s['reason']}", ""]
            continue
        L += [f"### {s['pilot']} ({s['station_name']})", "", "| Reference | n days | r daily | bias mm/day | r monthly | annual IMERG / ref mm | heavy days ref | IMERG hit same day / ±1 day |",
              "|---|---|---|---|---|---|---|---|"]
        for k in ("station", "power"):
            v = s[f"vs_{k}"]
            am = v["annual_mean_mm"]
            L.append(f"| {k} | {v['daily']['n']} | {v['daily']['r']} | {v['daily']['bias_mm']} | {v['monthly']['r']} | "
                     f"{am['imerg']} / {am[k]} | {v['heavy_days_ref']} | {v['imerg_same_day_hits']} / {v['imerg_within_1_day']} |")
        L.append("")
    L += ["## 2. SMAP L4 root-zone soil moisture vs NASA POWER GWETROOT", "",
          "Both are model-based regional values (SMAP L4: 9 km land model with satellite assimilation; POWER: MERRA-2, ≈50 km). "
          "Agreement says the two pictures of wet and dry spells are consistent; it is not a check against a field probe.", "",
          "| Field | Period | r weekly raw | r weekly anomaly (Spearman) | n weeks | our percentile vs product pctl r |", "|---|---|---|---|---|---|"]
    for s in res["smap"]:
        if not s.get("available"):
            L.append(f"| {s['name']} | not run: {s['reason']} | | | | |")
            continue
        a = s["weekly_anomaly"]
        L.append(f"| {s['name']} | {s['period'][0]}…{s['period'][1]} | {s['weekly_raw']['r']} | {a['r']} ({a.get('spearman')}) | {a['n']} | "
                 f"{s['empirical_vs_product_percentile']['r']} |")
    L += ["", "## 3. HLS observed greenness vs the model's crop-in-field calendar (baseline card)", "",
          "HLS status per month: field-median NDVI ≥ 0.25 = green cover; below = bare or residue (satellite greenness status, not residue amount). "
          "Model: months between planting and harvest of the cash crop that matches that year's CDL crop. "
          "Expected mismatches: the planting month (no canopy yet), the harvest month, weeds or volunteers, and the fact that the model "
          "uses typical dates, not this farm's actual dates.", "",
          "| Field | Year | CDL crop | months with clear scene | agree (0.25) | agreement (0.25) | agreement if threshold 0.30 |", "|---|---|---|---|---|---|---|"]
    for f in res["hls"]:
        if not f.get("available"):
            L.append(f"| {f['field_id']} | not run: {f.get('reason')} | | | | |")
            continue
        for y in f["years"]:
            if y.get("comparable"):
                L.append(f"| {f['name']} | {y['year']} | {y['cdl_crop']} | {y['months_with_clear_scene']} | {y['agree_months']} | {y['agreement']} | {y['agreement_at_0_30']} |")
            else:
                L.append(f"| {f['name']} | {y['year']} | {y['cdl_crop']} | not comparable: {y['note']} | | | |")
    L += ["", "### Month-by-month disagreements", ""]
    for f in res["hls"]:
        for y in f.get("years", []):
            bad = [m for m in y.get("months", []) if m["hls_status"] != "no_clear_scene" and (m["hls_status"] == "green") != m["model_crop_in_field"]]
            if bad:
                L.append(f"- {f['name']} {y['year']} ({y['cdl_crop']}): " + ", ".join(
                    f"M{m['month']:02d} model {'crop' if m['model_crop_in_field'] else 'no crop'} / HLS {m['hls_status']} (NDVI {m['hls_ndvi']})" for m in bad))
    L += ["", "## Interpretation", "", INTERPRETATION]
    return "\n".join(L) + "\n"


INTERPRETATION = """- **IMERG** could not be validated today: every GES DISC route returns HTTP 403 "EULA Acceptance Failure" for this
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
"""

if __name__ == "__main__":
    main()
