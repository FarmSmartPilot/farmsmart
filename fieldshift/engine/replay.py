"""Drought Replay: replay a real past year week by week on the field, current rotation vs an alternative.

This is a MODEL REPLAY driven by the real weather of that year (NASA POWER). The ghost NDVI is the real
MODIS observation at the field's 250 m pixel. Bands come from re-running with soil water-holding ±20 %."""
from __future__ import annotations

import threading

import numpy as np
import pandas as pd

from ..config import CACHE, PRECOMP
from ..ingest import modis
from . import climate, kb, strategies
from .sim import DAYS, SiteInputs, simulate, weather_stack

_ndvi_jobs: dict[str, str] = {}


def _phase_for(seq: list[dict], target: str | None) -> list[dict]:
    """Two-year slice [previous year, replay year] with the replay-year crop = target if the rotation grows it."""
    L = len(seq)
    idx = next((i for i, s in enumerate(seq) if s["cash"] == target), None)
    if idx is None:
        # prefer the main summer cash crop
        C = kb.crops()
        idx = next((i for i, s in enumerate(seq) if C[s["cash"]]["season"] == "summer"), 0)
    return [seq[(idx - 1) % L], seq[idx]]


def ndvi_ghost(lat: float, lon: float, year: int) -> dict:
    key = f"{lat:.4f}_{lon:.4f}_{year}"
    pq = CACHE / f"ndvi_MOD13Q1_{lat:.4f}_{lon:.4f}_{year}.parquet"
    pre = PRECOMP / "ndvi" / pq.name  # pilots ship with their NDVI (deployed demo has no warm cache)
    if pre.exists():
        pq = pre
    if pq.exists():
        df = pd.read_parquet(pq)
        pts = [{"doy": int(d.dayofyear), "week": int((d.dayofyear - 1) // 7), "ndvi": (None if pd.isna(v) else round(float(v), 3)),
                "reliability": int(r)} for d, v, r in zip(df["date"], df["ndvi"], df["reliability"])]
        return {"status": "ready", "points": pts}
    st = _ndvi_jobs.get(key)
    if st == "failed":
        return {"status": "failed", "points": []}
    if st != "loading":
        _ndvi_jobs[key] = "loading"

        def run():
            try:
                modis.ndvi(lat, lon, year)
                _ndvi_jobs[key] = "ready"
            except Exception:  # noqa: BLE001
                _ndvi_jobs[key] = "failed"
        threading.Thread(target=run, daemon=True).start()
    return {"status": "loading", "points": []}


def replay(ctx: dict, wx: pd.DataFrame, cards: list[dict], year: int, alt_id: str | None) -> dict:
    region = ctx["region"]["region"]
    years = climate.full_years(wx)
    if year not in years or (year - 1) not in years:
        return {"available": False, "reason": f"NASA POWER weather for {year - 1}–{year} is incomplete"}
    base = next(c for c in cards if c["is_baseline"])
    alt = next((c for c in cards if c["id"] == alt_id), None) or next((c for c in cards if not c["is_baseline"] and c.get("best_for_you")), None) \
        or next(c for c in cards if not c["is_baseline"])
    hist = {h["year"]: h for h in ((ctx.get("crop_history") or {}).get("years") or []) if h.get("available")}
    actual = hist.get(year, {}).get("dominant") if year in hist else None
    target = (actual or {}).get("crop_id") or "corn"
    clim = strategies.clim_from(wx)
    soil = (ctx.get("soil") or {}).get("properties") or {}
    taw = (soil.get("aws100_cm") or 15) * 10
    k_si = soil.get("kwfact") * 0.1317 if soil.get("kwfact") else None
    ls = (ctx.get("terrain") or {}).get("ls_mean") or 0.3
    et0 = climate.et0_pm(wx, ctx["centroid"][1], (ctx.get("climate") or {}).get("elevation_m") or 0)
    W_all, starts_all = weather_stack(wx, et0, 2, years)
    i_year = starts_all.index(year - 1)

    def run(card):
        seq2 = _phase_for(card["sequence"], target)
        tl, issues = strategies.timeline(seq2, region, clim, reps=1)
        if tl is None:
            return {"available": False, "reason": "; ".join(issues)}
        res = {}
        for tag, f in (("low", 0.8), ("mid", 1.0), ("high", 1.2)):
            site = SiteInputs(W_all, starts_all, taw * f, k_si, ls, ctx.get("r_factor") or 0, soil.get("wei"), None,
                              auto_irrigate=(ctx.get("default_farm") or {}).get("water") == "irrigated")
            res[tag] = simulate(tl, site, kb.crops(), {c: 1.0 for c in kb.crops()}, trace=True)
        mid = res["mid"]
        sl = slice(DAYS, 2 * DAYS)
        weeks = []
        for w in range(52):
            a, b = DAYS + w * 7, DAYS + min(w * 7 + 7, DAYS)
            row = {"week": w}
            for tag in ("low", "mid", "high"):
                r = res[tag]
                tw = r["taw_mm"]
                row[f"soil_water_pct_{tag}"] = round(float(100 * (1 - r["trace_depletion_mm"][i_year, a:b].mean() / tw)), 1)
                ks = r["trace_ks"][i_year, a:b]
                row[f"stress_{tag}"] = None if np.all(np.isnan(ks)) else round(float(1 - np.nanmean(ks)), 3)
            # band = envelope of the three runs (% full is not monotonic in capacity, so low/high runs can cross)
            for key in ("soil_water_pct", "stress"):
                vals = [row[f"{key}_{t}"] for t in ("low", "mid", "high") if row[f"{key}_{t}"] is not None]
                if vals:
                    row[f"{key}_low"], row[f"{key}_high"] = min(vals), max(vals)
            row["erosion_t_ha"] = round(float(np.nansum(mid["trace_erosion_t_ha"][i_year, a:b])), 4)
            row["soil_cover"] = round(float(mid["soil_cover_daily"][a:b].mean()), 3)
            row["rain_mm"] = round(float(W_all["P"][i_year, a:b].sum()), 1)
            row["tmax_c"] = round(float(np.nanmax(W_all["TMAX"][i_year, a:b])), 1)
            row["eta_mm"] = round(float(mid["trace_eta"][i_year, a:b].sum()), 1)
            weeks.append(row)
        # yield outcome for the replay-year crop (event ending in year 1)
        ev_i = [k for k, e in enumerate(tl.events) if e.kind in ("cash", "forage") and DAYS <= e.end <= 2 * DAYS]
        out_y = {}
        if ev_i:
            evs = {e["event"]: e for e in mid["events"]}
            k = ev_i[0]
            if k in evs:
                for tag in ("low", "mid", "high"):
                    evx = {e["event"]: e for e in res[tag]["events"]}[k]
                    out_y[tag] = float(evx["rel_yield"][i_year])
                lo_hi = sorted(out_y[t] for t in ("low", "mid", "high"))
                out_y["low"], out_y["high"] = lo_hi[0], lo_hi[-1]  # envelope (runs can cross)
                typical = float(np.nanmedian(evs[k]["rel_yield"]))
                out_y["typical"] = typical
                out_y["crop_id"] = tl.events[k].crop_id
                out_y["crop"] = kb.crops()[tl.events[k].crop_id]["name"]
                out_y["pct_of_typical"] = 100 * out_y["mid"] / typical if typical else None
                out_y["rank_among_years"] = int((evs[k]["rel_yield"] < out_y["mid"]).sum()) + 1
                out_y["n_years"] = int(len(evs[k]["rel_yield"]))
        return {"available": True, "card_id": card["id"], "name": card["name"], "phase": [s["cash"] for s in seq2],
                "covers": [s.get("cover") for s in seq2], "weeks": weeks, "yield": out_y,
                "erosion_total_t_ha": round(sum(w["erosion_t_ha"] for w in weeks), 3),
                "bare_weeks": sum(1 for w in weeks if w["soil_cover"] < 0.3)}

    b, a = run(base), run(alt)
    lon, lat = ctx["centroid"]
    gs = wx[(wx.index.year == year) & wx.index.month.isin([5, 6, 7, 8])]["PRECTOTCORR"].sum()
    allgs = [wx[(wx.index.year == y) & wx.index.month.isin([5, 6, 7, 8])]["PRECTOTCORR"].sum() for y in years]
    worst = sorted(years, key=lambda y: wx[(wx.index.year == y) & wx.index.month.isin([5, 6, 7, 8])]["PRECTOTCORR"].sum())[:3]
    return {
        "available": True, "year": year, "label": "Model replay driven by the real weather of that year. Not an observation of your field.",
        "actual_crop": actual, "current": b, "alternative": a,
        "season_rain_mm": round(float(gs), 1), "season_rain_percentile": round(float((np.array(allgs) < gs).mean() * 100)),
        "driest_years": worst,
        "ndvi": ndvi_ghost(round(lat, 4), round(lon, 4), year),
        "band_method": "Bands: soil water-holding capacity ±20 % (SSURGO uncertainty)",
        "evidence": {"weather": (ctx.get("climate") or {}).get("evidence_id"),
                     "ndvi": {"source": "NASA LP DAAC via ORNL DAAC", "product": "MOD13Q1 v061 NDVI 16-day 250 m",
                              "is_nasa": True, "note": "Greenness, not yield. QA: pixel reliability good/marginal only."}},
        "never_claim": "NDVI shows greenness. It does not measure yield, residue or soil carbon.",
    }
