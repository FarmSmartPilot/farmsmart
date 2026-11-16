"""Money calculator building blocks (wave U6): per-option yield indices per weather sequence, USDA ERS cost lines,
harvest prices and the historical hazard record, so the browser can recompute revenue, costs and risk instantly.

Consistency with the comparison: for each cash position, yield = typical × yield_index reproduces the profit
indicator of analysis._indicators (typical = the crop's yield anchor, M2 county P50 or ERS 5-year median; yield_index
= simulated yield / the crop's median simulated yield over the standard options, the same median _econ_for uses).
Every number comes from a model run or a public record; missing data is returned as null with a reason."""
from __future__ import annotations

import time
from collections import Counter
from datetime import date

import numpy as np
import pandas as pd

from ..engine import analysis, climate, kb
from ..engine.sim import DAYS, simulate
from ..ingest import budgets_isu, costshare as CS, econ as E, losses, markets as MK, nass, storms

HA_TO_AC = 2.471054
DRY_SPELL_DAYS, DRY_SPELL_MM = 14, 5.0      # same definition as climate.weekly_hazards ("dry": 14-day rain < 5 mm)
HOT_DAYS_N = 5                              # "a hot season": at least 5 days at or above climate.HEAT_C (35 °C)
UNIT_SHORT = {"bushels": "bu", "pounds": "lb", "hundredweight": "cwt"}


# --------------------------------------------------------------------------- weather hazards (NASA POWER)
def main_crop(seq: list[dict]) -> str | None:
    ids = [s["cash"] for s in seq or [] if s.get("cash") and s["cash"] != "fallow"]
    if not ids:
        return None
    cnt = Counter(ids)
    return max(ids, key=lambda c: (cnt[c], -ids.index(c)))


def season_window(ctx: dict, crop: str | None) -> dict:
    """Main crop's season from the regional calendar: planting-window middle to harvest-window middle (0-based DOY);
    else Apr–Oct (north) / Oct–Mar (south). active = FAO-56 stage days (frost/heat windows as in the simulator)."""
    C = kb.crops()
    region = (ctx.get("region") or {}).get("region")
    if crop and crop in C and region:
        c = C[crop]
        w = (kb.calendars().get(region, {}).get("crops") or {}).get(crop) or {}
        if c.get("season") == "perennial":
            p, h = kb.doy("04-01"), kb.doy("10-31")
        else:
            p, h = kb.window_mid(w.get("plant")), kb.window_mid(w.get("harvest"))
        if p is not None and h is not None:
            L = (h - p) % DAYS or DAYS
            sd = c.get("stage_days") or {}
            active = min(sum(sd.values()), L) if sd else L
            return {"crop": crop, "name": c["name"].split(" (")[0], "name_es": (c.get("name_es") or c["name"]).split(" (")[0],
                    "plant_doy": p, "harvest_doy": h, "length": L, "active": active,
                    "frost_kill_c": c.get("frost_kill_c"), "basis": "regional crop calendar"}
    north = ctx["centroid"][1] >= 0
    p, h = (kb.doy("04-01"), kb.doy("10-31")) if north else (kb.doy("10-01"), kb.doy("03-31"))
    L = (h - p) % DAYS
    return {"crop": None, "name": None, "name_es": None, "plant_doy": p, "harvest_doy": h, "length": L, "active": L,
            "frost_kill_c": None, "basis": "Apr–Oct (north) / Oct–Mar (south) default; no crop calendar here"}


def _season_slices(wx: pd.DataFrame, se: dict, years: list[int]) -> dict[int, pd.DataFrame]:
    """Daily rows of the season that ends (is harvested) in year Y, for each Y whose season lies in the record."""
    out = {}
    first, last = wx.index.min(), wx.index.max()
    wraps = se["harvest_doy"] < se["plant_doy"]
    for y in years:
        start = pd.Timestamp(year=y - (1 if wraps else 0), month=1, day=1) + pd.Timedelta(days=se["plant_doy"])
        end = start + pd.Timedelta(days=se["length"])
        if start < first or end > last:
            continue
        out[y] = wx.loc[start:end]
    return out


def weather_hazards(ctx: dict, wx: pd.DataFrame, crop: str | None) -> dict:
    """Share of years with each weather hazard in the field's NASA POWER record (≈50 km regional value)."""
    years = climate.full_years(wx)
    if len(years) < 10:
        return {"available": False, "reason": "NASA POWER record too short at this field"}
    se = season_window(ctx, crop)
    seas = _season_slices(wx, se, years)
    north = ctx["centroid"][1] >= 0
    items = []
    src = {"source": "NASA POWER", "is_nasa": True, "scale": "regional value (≈50 km)"}
    cname, cname_es = (se["name"] or "the crop").lower(), (se["name_es"] or "el cultivo").lower()

    def add(id_, en, es, hit: dict[int, bool], in_sim: bool, **extra):
        ys = sorted(hit)
        h = [y for y in ys if hit[y]]
        items.append({"id": id_, "label_en": en, "label_es": es, "years_hit": len(h), "years": len(ys),
                      "p": round(len(h) / len(ys), 3) if ys else None, "last": h[-1] if h else None,
                      "years_list": h, "in_simulation": in_sim, **src, **extra})

    # killing frost while the main crop is growing (emergence to 90 % of its active season, as the simulator)
    fk = se["frost_kill_c"]
    if fk is not None and seas:
        a0, a1 = int(0.15 * se["active"]), int(0.9 * se["active"])
        hit = {y: bool((d["T2M_MIN"].iloc[a0:a1] <= fk).any()) for y, d in seas.items()}
        add("frost_season", f"Killing frost ({fk:g} °C or colder) while {cname} is growing",
            f"Helada letal ({fk:g} °C o menos) con {cname_es} en el campo", hit, True, threshold_c=fk)
    # hot season: at least N days >= 35 °C in the main crop's active season
    if seas:
        hot = {y: int((d["T2M_MAX"].iloc[:se["active"]] >= climate.HEAT_C).sum()) for y, d in seas.items()}
        add("heat_season", f"{HOT_DAYS_N} or more days at {climate.HEAT_C:g} °C or hotter while {cname} is growing",
            f"{HOT_DAYS_N} o más días a {climate.HEAT_C:g} °C o más con {cname_es} en el campo",
            {y: v >= HOT_DAYS_N for y, v in hot.items()}, True,
            mean_days=round(float(np.mean(list(hot.values()))), 1))
    # very dry growing seasons: driest 10 % / 20 % of the record
    if seas:
        rain = pd.Series({y: float(d["PRECTOTCORR"].sum()) for y, d in seas.items()})
        for q, id_, en, es in ((0.1, "drought_season_10", "Very dry growing season (driest 10 % of years)",
                                "Temporada muy seca (el 10 % de años más secos)"),
                               (0.2, "drought_season_20", "Dry growing season (driest 20 % of years)",
                                "Temporada seca (el 20 % de años más secos)")):
            thr = float(rain.quantile(q))
            add(id_, en, es, {int(y): bool(v <= thr) for y, v in rain.items()}, True,
                threshold_mm=round(thr, 1), median_mm=round(float(rain.median()), 1))
    # 14-day dry spell in Jul–Aug (north) / Jan–Feb (south)
    p = wx["PRECTOTCORR"].fillna(0)
    p14 = p.rolling(DRY_SPELL_DAYS, min_periods=DRY_SPELL_DAYS).sum()
    months = (7, 8) if north else (1, 2)
    end_ok = p14.index.month.isin(months) & ~((p14.index.month == months[0]) & (p14.index.day < DRY_SPELL_DAYS))
    dry = (p14 < DRY_SPELL_MM) & end_ok
    mlabel = ("July–August", "julio–agosto") if north else ("January–February", "enero–febrero")
    add("dry_spell", f"A {DRY_SPELL_DAYS}-day dry spell (under {DRY_SPELL_MM:g} mm) in {mlabel[0]}",
        f"Racha seca de {DRY_SPELL_DAYS} días (menos de {DRY_SPELL_MM:g} mm) en {mlabel[1]}",
        {y: bool(dry[dry.index.year == y].any()) for y in years}, True)
    # heavy rain in spring, when fields are often bare
    sp = (3, 4, 5) if north else (9, 10, 11)
    heavy = (p >= climate.HEAVY_RAIN_MM) & p.index.month.isin(sp)
    hd = {y: int(heavy[heavy.index.year == y].sum()) for y in years}
    slabel = ("March–May", "marzo–mayo") if north else ("September–November", "septiembre–noviembre")
    add("heavy_rain_spring", f"A day with {climate.HEAVY_RAIN_MM:g} mm of rain or more in {slabel[0]} (fields often bare)",
        f"Un día con {climate.HEAVY_RAIN_MM:g} mm de lluvia o más en {slabel[1]} (campos a menudo sin cubierta)",
        {y: v > 0 for y, v in hd.items()}, False, mean_days=round(float(np.mean(list(hd.values()))), 2),
        note="Affects soil loss, not simulated yield (waterlogging is not modelled)")
    return {"available": True, "years": [years[0], years[-1]], "items": items,
            "season": {k: se[k] for k in ("crop", "name", "plant_doy", "harvest_doy", "basis")},
            "note": "Shares of years in the NASA POWER record at the field (≈50 km). Drought, heat, frost and dry "
                    "spells are already in the simulated years (every option runs through every real season).",
            **src, "citation": "NASA Langley Research Center POWER Project (MERRA-2 / GEOS based)",
            "url": "https://power.larc.nasa.gov"}


def season_rain_by_year(ctx: dict, wx: pd.DataFrame, crop: str | None) -> tuple[dict[int, float], dict]:
    se = season_window(ctx, crop)
    seas = _season_slices(wx, se, climate.full_years(wx))
    return {y: round(float(d["PRECTOTCORR"].sum()), 1) for y, d in seas.items()}, se


# --------------------------------------------------------------------------- positions per option
def _event_irrigation(r: dict) -> dict[int, np.ndarray] | None:
    """Irrigation (mm) applied during each timeline event, per weather sequence. Re-runs the same simulation with
    the water-balance trace (identical results) and attributes each day's irrigation to the crop on the field."""
    site = r.get("site")
    if site is None or not (site.auto_irrigate or site.irrigation_mm > 0):
        return None
    tl = r["tl"]
    st = simulate(tl, site, kb.crops(), {cid: 1.0 for cid in kb.crops()}, r.get("mult"), trace=True)
    S, D = st["S"], tl.days
    irr = np.zeros((S, D))
    kinds = np.array([tl.events[i].kind if i >= 0 else "" for i in tl.crop_idx])
    if site.auto_irrigate:
        dr = st["trace_depletion_mm"]
        prev = np.concatenate([np.zeros((S, 1)), dr[:, :-1]], axis=1)
        managed = np.isin(kinds, ["cash", "forage"])
        irr += np.where((prev > 0.5 * st["taw_mm"]) & managed[None, :], prev, 0.0)
    if site.irrigation_mm > 0:
        cash_days = kinds == "cash"
        irr += np.where(cash_days, site.irrigation_mm * (D / DAYS) / max(cash_days.sum(), 1), 0.0)[None, :]
    out = {int(k): irr[:, tl.crop_idx == k].sum(1) for k in np.unique(tl.crop_idx) if k >= 0}
    out[-1] = irr.sum(1)  # total over the window (includes seasons cut at the window edges)
    return out


def _positions(r: dict, med: dict[str, float], keep: np.ndarray) -> tuple[list[dict], np.ndarray | None]:
    seq = r["cand"]["sequence"]
    L = len(seq)
    tl, sim = r["tl"], r["sim"]
    has_double = any(s.get("double") for s in seq)
    irr = _event_irrigation(r)
    C = kb.crops()
    pos = []
    for e in sim["events"]:
        if e["kind"] not in ("cash", "forage"):
            continue
        ev = tl.events[e["event"]]
        cid = e["crop_id"]
        if has_double:
            i = (ev.start // DAYS) % L
            st = seq[i]
            is_second = st.get("double") == cid and (st["cash"] != cid or any(
                p["crop"] == cid and p["step"] == i and p["year"] == ev.start // DAYS for p in pos))
            kind = "double" if is_second else ("forage" if e["kind"] == "forage" else "cash")
            cover = st.get("cover") if (is_second or not st.get("double")) else None
        else:
            i = (ev.end // DAYS) % L
            if seq[i]["cash"] != cid:  # fall back to the nearest step growing this crop
                i = next((j for j in range(L) if seq[j]["cash"] == cid), i)
            st = seq[i]
            kind = "forage" if e["kind"] == "forage" else "cash"
            cover = st.get("cover")
        m = med.get(cid)
        yi = (np.asarray(e["yield"], float) / m) if m and m > 0 else np.full(sim["S"], np.nan)
        pos.append({"crop": cid, "name": C[cid]["name"].split(" (")[0], "kind": kind, "cover": cover, "step": i,
                    "year": int(ev.end // DAYS), "yield_index": [None if not np.isfinite(v) else round(float(v), 4)
                                                                 for v in yi[keep]],
                    "irrigation_mm": [round(float(v), 1) for v in irr[e["event"]][keep]] if irr else None})
    for k in range(sim["years_n"]):  # fallow years: no crop, no revenue; a cover can still be sown
        st = seq[k % L]
        if st["cash"] == "fallow":
            pos.append({"crop": "fallow", "name": "Fallow", "kind": "fallow", "cover": st.get("cover"), "step": k % L,
                        "year": k, "yield_index": None, "irrigation_mm": None})
    pos.sort(key=lambda p: (p["year"], p["kind"] == "double"))
    return pos, (irr[-1][keep] / sim["years_n"] if irr else None)


# --------------------------------------------------------------------------- crops (ERS lines, prices, yields)
def _unit(units: str | None) -> str | None:
    if not units:
        return None
    return UNIT_SHORT.get(units.split(" ")[0], units.split(" per ")[0])


def _is_ers(b: dict) -> bool:
    """True when a crop block's cost lines are USDA ERS (False for state extension budgets, e.g. NDSU sunflower)."""
    return ((b.get("evidence") or {}).get("source_id") or "ers") == "ers"


def _crop_block(cid: str, econ: dict, m2: dict, region: str | None, price_years: list[int], us: bool) -> dict:
    C = kb.crops()
    c = C.get(cid) or {}
    ce = (econ.get("crops") or {}).get(cid) if econ.get("available") else None
    m = (m2 or {}).get(cid) or {}
    out = {"name": c.get("name", cid).split(" (")[0], "name_es": (c.get("name_es") or c.get("name", cid)).split(" (")[0],
           "unit": None, "yield": None, "price": None, "costs": [], "overhead": [], "costs_available": False,
           "cost_years": None, "evidence": None, "notes": []}
    if ce:
        si = (ce.get("yield_source") or "").startswith("M2")
        cev = ce.get("evidence") or {}
        ers = cev.get("source_id", "ers") == "ers" and "price_source_label" not in cev  # else a non-ERS crop (sunflower)
        out["unit"] = _unit(ce.get("yield_unit"))
        out["yield"] = {"typical": ce.get("yield_p50"), "source": ce.get("yield_source"), "si": si,
                        "unit": f"{out['unit']}/ac" if out["unit"] else None,
                        "scale": analysis.YIELD_COUNTY_SCALE if si else
                        ("USDA ERS regional average, not your farm" if ers else cev.get("yield_scale_label"))}
        if si and m.get("available"):
            out["yield"].update({"p10": m.get("p10"), "p90": m.get("p90"), "confidence": ((m.get("si") or {}).get("confidence")),
                                 "model": "M2"})
        pmap = dict(zip(ce["price_years"], ce["prices"]))
        vals = [pmap.get(y) for y in price_years]
        nd = 2 if ers else 4  # non-ERS prices are $/lb (sunflower): 2 decimals would lose up to 3 %
        out["price"] = {"years": price_years, "values": [None if v is None else round(float(v), nd) for v in vals],
                        "typical": round(float(np.nanmedian([v for v in ce["prices"] if v is not None])), nd),
                        "unit": f"USD/{out['unit']}" if out["unit"] else None,
                        "source": (f"USDA ERS harvest-period price, {ce.get('region')} (nominal)" if ers
                                   else cev.get("price_source_label")),
                        "scale": ("USDA regional average, not your farm-gate price" if ers
                                  else cev.get("price_scale_label")),
                        "missing_years": [y for y, v in zip(price_years, vals) if v is None]}
        if not ers:
            out["price"]["evidence"] = {k: cev.get(k) for k in ("source", "is_nasa", "urls", "citation", "licence")}
        li = E.ers_line_items(cid, ce.get("region") or region or "U.S. total")
        if li.get("available"):
            strip = lambda L: [{k: x[k] for k in ("id", "label_en", "label_es", "usd_ac", "ers_items")} for x in L]  # noqa: E731
            out.update({"costs": strip(li["costs"]), "overhead": strip(li["overhead"]), "costs_available": True,
                        "cost_years": li["cost_years"], "cost_region": li["region"],
                        "operating_total_usd_ac": li["operating_total_usd_ac"],
                        "operating_total_used_in_comparison": ce.get("op_cost"),
                        "overhead_total_usd_ac": li["overhead_total_usd_ac"],
                        "evidence": li["evidence"], "notes": li["notes"]})
            gap = round(sum(x["usd_ac"] for x in li["costs"]) - (ce.get("op_cost") or 0), 2)
            if abs(gap) >= 0.5:
                out["notes"].append(f"Each cost line is its own {li['cost_years']}; together they come to "
                                    f"{gap:+.2f} $/ac from the median of "
                                    + ("ERS's" if ers else (li["evidence"].get("source") or "the source") + "'s")
                                    + " yearly totals used in the comparison.")
        else:
            out["notes"].append(li.get("reason"))
    else:
        if m.get("available"):
            out["unit"] = (m.get("unit") or "").split("/")[0] or None
            out["yield"] = {"typical": m.get("p50"), "source": "M2 county yield (USDA NASS county trend + season weather)",
                            "si": True, "unit": m.get("unit"), "scale": analysis.YIELD_COUNTY_SCALE, "model": "M2"}
        out["notes"].append(("USDA ERS has no cost and return survey for this crop: enter your own price and costs."
                             if us else "No public cost and price records connected for this country: enter your own "
                                        "yield, price and costs."))
    return out


# --------------------------------------------------------------------------- wave U9: yield history, benchmarks, cost coverage
NASS_URL = "https://quickstats.nass.usda.gov"
YH_MIN_YEARS = 10      # fewer published county years than this: use the state series
YH_MAX_GAP = 5         # county series ending more than this many years before the state's: use the state series


def _series_block(years: list[int], values: list[float]) -> dict:
    y, v = np.asarray(years, float), np.asarray(values, float)
    slope, icpt = np.polyfit(y, v, 1)
    resid = v - (slope * y + icpt)
    dcv = float(np.std(resid, ddof=2) / np.mean(v)) if len(v) > 2 and np.mean(v) > 0 else None
    return {"years": [int(a) for a in years], "values": [round(float(a), 1) for a in values], "n_years": len(years),
            "trend": {"slope_per_yr": round(float(slope), 3), "intercept": round(float(icpt), 2),
                      "value_last_year": round(float(slope * y[-1] + icpt), 1),
                      "basis": f"least-squares straight line through the {len(years)} published years "
                               f"{int(y[0])}–{int(y[-1])}; value = intercept + slope_per_yr × year"},
            "detrended_cv": None if dcv is None else round(dcv, 3),
            "detrended_cv_definition": "standard deviation of the yields around the trend line ÷ mean yield "
                                       "(year-to-year swing once the long-run trend is taken out)"}


def yield_history(cid: str, ctx: dict, us: bool, irrigated: bool = False) -> dict:
    """USDA NASS published county yields for this crop in the field's county (state series if the county is
    withheld or too short). For realism only: never the field's own yield."""
    if not us:
        return {"available": False, "reason": "USDA NASS county yields cover US counties only."}
    fips = str(ctx.get("county_fips") or "").zfill(5) if ctx.get("county_fips") else None
    if not fips:
        return {"available": False, "reason": "No US county known for this field."}
    if cid not in nass.CROP_COMMODITY:
        return {"available": False, "reason": "USDA NASS county yields are not connected for this crop."}
    last_full = date.today().year - 1  # current-season figures are forecasts until NASS's annual summary
    county_name = (ctx.get("place") or {}).get("county")
    try:
        cy = nass.county_yields(cid)
        cy = cy[(cy["fips"] == fips) & (cy["year"] <= last_full)].dropna(subset=["yield"])
        cyears, cvals = cy["year"].astype(int).tolist(), cy["yield"].astype(float).tolist()
        unit = cy["unit"].iloc[0] if len(cy) else None
        if not cyears and fips[:2] not in _bulk_state_fips() and env_has_key():  # state outside the bulk table
            live = nass.county_yields_live(fips, cid)
            live = live[live["year"] <= last_full]
            cyears, cvals = live["year"].astype(int).tolist(), live["value"].astype(float).tolist()
            unit = live["unit"].iloc[0] if len(live) else unit
    except Exception as e:  # noqa: BLE001 - reported, never filled in
        cyears, cvals, unit = [], [], None
        county_err = type(e).__name__
    else:
        county_err = None
    try:
        sy = nass.state_yields()
        sy = sy[(sy["state_fips"] == fips[:2]) & (sy["crop"] == cid) & (sy["year"] <= last_full)].dropna(subset=["value"])
        sy = sy.sort_values("year")
        syears, svals = sy["year"].astype(int).tolist(), sy["value"].astype(float).tolist()
        sunit, sname = (sy["unit"].iloc[0], sy["state"].iloc[0]) if len(sy) else (None, None)
    except Exception:  # noqa: BLE001
        syears, svals, sunit, sname = [], [], None, None
    use_county = len(cyears) >= YH_MIN_YEARS and (not syears or cyears[-1] >= syears[-1] - YH_MAX_GAP)
    base = {"source": "USDA NASS Quick Stats (survey yields, all production practices)", "url": NASS_URL,
            "citation": nass.CITATION, "is_nasa": False, "crop": cid}
    if use_county:
        out = {"available": True, **base, "level": "county", "county": county_name, "county_fips": fips,
               "unit": unit, **_series_block(cyears, cvals), "scale": "county average, not your field"}
        if syears:
            out["state_reference"] = {"state": sname, "years": syears, "values": [round(v, 1) for v in svals]}
    elif len(syears) >= YH_MIN_YEARS:
        why = (f"NASS county yields could not be read ({county_err})" if county_err else
               "NASS publishes no county yield for this crop here (withheld or not estimated)" if not cyears else
               f"NASS published only {len(cyears)} county years ({cyears[0]}–{cyears[-1]}) for this crop here"
               + (f"; the county series stops in {cyears[-1]}" if syears and cyears[-1] < syears[-1] - YH_MAX_GAP else ""))
        out = {"available": True, **base, "level": "state", "county": county_name, "county_fips": fips,
               "state": sname, "unit": sunit, **_series_block(syears, svals),
               "scale": "state average, not your county or field",
               "fallback_reason": why + "; showing the state average instead."}
        if cyears:
            out["county_partial"] = {"years": cyears, "values": [round(v, 1) for v in cvals]}
    else:
        return {"available": False, "reason": "USDA NASS publishes too few county or state yields for this crop here."}
    if irrigated and cid in ("corn", "soybean", "winter_wheat", "sorghum", "cotton"):
        prac = {}
        for p in ("irrigated", "nonirrigated"):
            try:
                d = nass.practice_yields(cid, p)
                d = d[(d["fips"] == fips) & (d["year"] <= last_full)].sort_values("year")
            except Exception:  # noqa: BLE001
                continue
            if len(d) >= 5:
                prac[p] = {"years": d["year"].astype(int).tolist(), "values": [round(float(v), 1) for v in d["value"]]}
        if prac:
            out["by_practice"] = {**prac, "note": "NASS county yields by practice (published mostly up to 2018)."}
    out["note"] = ("Published averages for real context only: they are not your field's yield and are not used as "
                   "it. All production practices together (irrigated and dryland) unless shown by practice.")
    from ..ingest import ground_econ
    if ground_econ.covers(cid):
        out["note"] += f" NASS series: {ground_econ.CROPS[cid]['nass_yield'].split(' - ')[0].lower()} (as the prices and costs used)."
    return out


def env_has_key() -> bool:
    from ..config import env  # noqa: PLC0415
    return bool(env("NASS_API_KEY"))


_BULK_STATES: set[str] = set()


def _bulk_state_fips() -> set[str]:
    """State FIPS codes held in the bulk NASS county table (nass.STATES)."""
    if not _BULK_STATES:
        _BULK_STATES.update({str(f)[:2] for f in nass.county_table()["fips"].unique()})
    return _BULK_STATES


# USDA ERS item name -> (EN, ES). Labels describe what the ERS item holds (ERS documentation, "Commodity Costs and
# Returns: Documentation", component table and glossary).
ERS_ITEM_LABELS = {
    "Seed": ("Seed (incl. technology fees and seed cleaning)", "Semilla (incl. tarifas de tecnología y limpieza)"),
    "Fertilizer": ("Fertilizer and soil conditioners (and the nutrient value of manure)",
                   "Fertilizantes y enmiendas (y el valor de nutrientes del estiércol)"),
    "Chemicals": ("Chemicals (herbicides, insecticides, fungicides)", "Agroquímicos (herbicidas, insecticidas, fungicidas)"),
    "Custom services": ("Custom services: hired application, soil tests, scouting, field work, harvesting and hauling",
                        "Servicios contratados: aplicación, análisis de suelo, monitoreo, labores, cosecha y acarreo"),
    "Fuel, lube, and electricity": ("Fuel, lube and electricity", "Combustible, lubricantes y electricidad"),
    "Repairs": ("Repairs", "Reparaciones"),
    "Purchased irrigation water": ("Purchased irrigation water", "Agua de riego comprada"),
    "Interest on operating capital": ("Interest on operating capital", "Intereses del capital operativo"),
    "Interest on operating inputs": ("Interest on operating capital", "Intereses del capital operativo"),  # ERS uses either name, by commodity
    "Commercial drying": ("Commercial drying", "Secado comercial"),
    "Ginning": ("Ginning", "Desmotado"),
    "Other variable expenses": ("Other variable expenses", "Otros gastos variables"),
    "Hired labor": ("Hired labour", "Mano de obra contratada"),
    "Opportunity cost of unpaid labor": ("Your own unpaid labour (valued at off-farm wages)",
                                         "Su mano de obra no pagada (valorada a salarios fuera de la finca)"),
    "Capital recovery of machinery and equipment": ("Machinery and equipment ownership (replacement and interest)",
                                                    "Propiedad de maquinaria y equipo (reposición e intereses)"),
    "Opportunity cost of land": ("Land (rent, or what owned land could rent for)", "Tierra (renta o lo que podría rentarse)"),
    "Taxes and insurance": ("Property taxes and farm property insurance", "Impuestos a la propiedad y seguro de bienes"),
    "General farm overhead": ("General farm overhead (supplies, small tools, buildings upkeep, utilities, business costs)",
                              "Gastos generales (suministros, herramientas, mantenimiento de edificios, servicios, gestión)"),
}
ERS_DOC_URL = "https://www.ers.usda.gov/data-products/commodity-costs-and-returns/documentation"
NOT_INCLUDED = [
    ("crop_insurance", "Crop insurance premium", "Prima del seguro agrícola",
     "Taxes include non-real estate property taxes and insurance is farm property insurance, excluding crop insurance."),
    ("storage", "Grain storage after harvest", "Almacenamiento del grano después de la cosecha",
     "The accounts include only costs incurred in the production of each crop commodity, excluding costs for "
     "marketing and storage."),
    ("marketing", "Marketing costs (selling, and delivering stored grain to a buyer)",
     "Costos de comercialización (venta y entrega del grano almacenado al comprador)",
     "Harvest-month price is used to value the production for crops since the cost-of-production accounts do not "
     "include marketing costs."),
]


def cost_coverage(crop_blocks: dict, us: bool) -> dict:
    """Which costs sit in the USDA ERS operating lines, which in allocated overhead, and which ERS does not hold."""
    if not us:
        return {"available": False, "reason": "USDA ERS cost lines are connected for US fields only."}
    ops, ovh = {}, {}
    others = {cid: b for cid, b in crop_blocks.items() if b.get("costs_available") and not _is_ers(b)}
    for b in crop_blocks.values():
        if not b.get("costs_available") or not _is_ers(b):  # non-ERS crops (sunflower) have their own lines
            continue
        for grp, dst in (("costs", ops), ("overhead", ovh)):
            for line in b.get(grp) or []:
                for it in line.get("ers_items") or []:
                    dst.setdefault(it, line["id"])
    if not ops:
        return {"available": False, "reason": "No USDA ERS cost lines for the crops on this field."}

    def det(d):
        out, seen = [], {}
        for k, v in d.items():
            en, es = ERS_ITEM_LABELS.get(k, (k, k))
            if en in seen:  # one label for ERS items that are the same cost (e.g. the two interest names)
                seen[en]["ers_items"].append(k)
                continue
            seen[en] = {"ers_items": [k], "line_id": v, "label_en": en, "label_es": es}
            out.append(seen[en])
        return out
    o, h = det(ops), det(ovh)
    ni = [{"id": i, "label_en": en, "label_es": es, "basis": q, "url": ERS_DOC_URL} for i, en, es, q in NOT_INCLUDED]
    extra = {"other_sources": [{"crop": cid, "source": (b.get("evidence") or {}).get("source"),
                                "product": (b.get("evidence") or {}).get("product"),
                                "url": (b.get("evidence") or {}).get("url"),
                                "operating": [x["label_en"] for x in b.get("costs") or []],
                                "overhead": [x["label_en"] for x in b.get("overhead") or []],
                                "notes": b.get("notes")} for cid, b in others.items()]} if others else {}
    return {"available": True, **extra,
            "operating": [x["label_en"] for x in o], "overhead": [x["label_en"] for x in h],
            "not_included": [x["label_en"] for x in ni],
            "operating_es": [x["label_es"] for x in o], "overhead_es": [x["label_es"] for x in h],
            "not_included_es": [x["label_es"] for x in ni],
            "details": {"operating": o, "overhead": h, "not_included": ni},
            "notes": ["Hauling at harvest is in the USDA lines: hired hauling under custom services, your own trucks "
                      "under fuel, repairs and machinery ownership.",
                      "Returns leave out government payments and marketing-loan benefits; the price is the "
                      "harvest-month price."],
            "notes_es": ["El acarreo en la cosecha está en las líneas del USDA: el contratado en servicios contratados, "
                         "sus propios camiones en combustible, reparaciones y propiedad de maquinaria.",
                         "Los ingresos no incluyen pagos del gobierno ni beneficios de préstamos de comercialización; "
                         "el precio es el del mes de cosecha."],
            "headline": {"operating_only_en": "Profit after operating costs (gross margin)",
                         "operating_only_es": "Ganancia después de costos operativos (margen bruto)",
                         "all_costs_en": "Net profit after all costs",
                         "all_costs_es": "Ganancia neta después de todos los costos"},
            "source": "USDA ERS Commodity Costs and Returns: Documentation", "url": ERS_DOC_URL, "is_nasa": False}


# --------------------------------------------------------------------------- nitrogen credit and fertilizer price
KG_HA_TO_LB_AC = 1 / 1.120851  # crops.yaml converts lb N/acre to kg/ha with × 1.121
LB_PER_MT = 2204.62262
UREA_N = 0.46
N_CREDIT_INFO = {
    "what": "Fertilizer nitrogen you can usually skip on a crop that follows a legume (soybean, pulses, alfalfa, "
            "clover): the rules engine's legume credit for that crop (rule 'legume_before_high_n_crop').",
    "per_position": "n_credit_lb_ac = midpoint of the sourced credit range (lb N/acre, from the crop table's kg N/ha "
                    "÷ 1.121); n_credit_range_lb_ac = [low, high]; 0 where no legume credit applies.",
    "not_counted": "Legume cover crops before corn are flagged by the rules but have no sourced N amount, so they add "
                   "no credit here. A soil nitrate test is the way to confirm the credit on your field.",
    "how_to_value": "N saved ($/acre) = n_credit_lb_ac × fertilizer $/lb N (fertilizer_n_price.usd_lb_n or your own).",
}


def _n_amount(expr, prev_cid: str | None) -> tuple[float | None, float | None] | None:
    """Rules-engine n_rate_delta_kg_ha ([lo, hi], a number, or '-prev.<field>') -> (lo, hi) kg N/ha (signed)."""
    if isinstance(expr, (list, tuple)) and expr:
        lo, hi = expr[0], expr[-1]
    elif isinstance(expr, (int, float)):
        lo = hi = expr
    elif isinstance(expr, str):
        e = expr.strip()
        sign = -1.0 if e.startswith("-") else 1.0
        e = e.lstrip("-").strip()
        if not e.startswith("prev.") or not prev_cid:
            return None
        v = (kb.crops().get(prev_cid) or {}).get(e[5:])
        if v is None:
            return None
        v = v if isinstance(v, (list, tuple)) else [v, v]
        lo, hi = (None if v[0] is None else sign * float(v[0])), (None if v[-1] is None else sign * float(v[-1]))
    else:
        return None
    return lo, hi


def _add_n_credits(r: dict, pos: list[dict]) -> None:
    """Adds n_credit_lb_ac / n_credit_range_lb_ac / n_credit_after to each crop position, from the N credits the
    rules engine applied to that transition (the crop after a legume)."""
    seq = r["cand"]["sequence"]
    seq_r, owner = analysis.expand_doubles(seq)
    n = len(seq_r)
    by_t: dict[int, list] = {}
    for x in (r.get("rules") or {}).get("n_delta") or []:
        t = x["transition"]
        prev = seq_r[(t - 1) % n]["cash"]
        amt = _n_amount(x.get("kg_ha"), prev)
        if amt is not None:
            by_t.setdefault(t, []).append((amt, prev, x.get("rule"), x.get("sources") or []))
    C, S = kb.crops(), kb.sources()
    for p in pos:
        if p["kind"] == "fallow" or p.get("crop") == "fallow":
            p.update(n_credit_lb_ac=None, n_credit_range_lb_ac=None, n_credit_after=None)
            continue
        t = p["step"] if len(seq_r) == len(seq) else next(
            (j for j, (i, cid) in enumerate(owner) if i == p["step"] and cid == p["crop"]), None)
        hits = by_t.get(t) or []
        lo = sum(-a[0][1] if a[0][1] is not None else 0.0 for a in hits)  # credit = − delta; hi delta = smaller cut
        hi = sum(-a[0][0] if a[0][0] is not None else 0.0 for a in hits)
        lo, hi = min(lo, hi), max(lo, hi)
        if not hits:
            p.update(n_credit_lb_ac=0, n_credit_range_lb_ac=None, n_credit_after=None)
            continue
        known = all(a[0][0] is not None and a[0][1] is not None for a in hits)
        p.update(n_credit_lb_ac=round((lo + hi) / 2 * KG_HA_TO_LB_AC) if known else None,
                 n_credit_range_lb_ac=[round(lo * KG_HA_TO_LB_AC), round(hi * KG_HA_TO_LB_AC)],
                 n_credit_after={"crop": hits[0][1], "name": (C.get(hits[0][1]) or {}).get("name", hits[0][1]).split(" (")[0],
                                 "rule": hits[0][2],
                                 "sources": [{"id": s, **S[s]} for s in dict.fromkeys(x for a in hits for x in a[3]) if s in S]})


def fertilizer_n_price() -> dict:
    """Latest World Bank urea benchmark and the derived $/lb N (urea is 46 % N)."""
    try:
        series, unit, why = MK._wb_series("urea")
    except Exception as e:  # noqa: BLE001
        series, unit, why = [], None, f"World Bank prices could not be read ({type(e).__name__})"
    if why or not series:
        return {"available": False, "reason": why or "no urea price"}
    last = series[-1]
    per_lb = last["value"] / LB_PER_MT / UREA_N
    yr = [p["value"] for p in series[-12:]]
    meta = MK._wb_meta()
    return {"available": True, "product": "urea (46 % N)", "month": last["month"], "urea_usd_mt": last["value"],
            "usd_lb_n": round(per_lb, 3), "usd_kg_n": round(last["value"] / 1000 / UREA_N, 3),
            "last_12_months_usd_lb_n": [round(min(yr) / LB_PER_MT / UREA_N, 3), round(max(yr) / LB_PER_MT / UREA_N, 3)],
            "how": "$/lb N = urea $/metric ton ÷ 2,204.62 lb ÷ 0.46",
            "source": "World Bank Pink Sheet (urea, spot FOB Middle East)", "unit": unit,
            "scope": "world benchmark price, not your delivered farm price: enter your own if you know it",
            "url": meta.get("url"), "citation": meta.get("citation"), "retrieved": meta.get("retrieved"),
            "is_nasa": False}


# --------------------------------------------------------------------------- build
def build(ctx: dict, body: dict) -> dict:
    t0 = time.time()
    cap: dict = {}
    cmp = analysis.compare(ctx, body.get("farm"), body.get("priorities"), body.get("baseline"),
                           body.get("scenario") or "normal", body.get("budgets") or None, body.get("custom") or None,
                           _capture=cap)
    us = (ctx["place"].get("country_code") or "").lower() == "us"
    area_ha = float(ctx.get("area_ha") or 0)
    farm = cap.get("farm") or {}
    out: dict = {"available": False, "reason": None, "field_id": ctx["id"],
                 "field": {"acres": round(area_ha * HA_TO_AC, 1), "hectares": round(area_ha, 1),
                           "irrigated": farm.get("water") == "irrigated" or float(farm.get("irrigation_mm") or 0) > 0},
                 "currency": "USD"}
    wx_raw = pd.read_parquet(ctx["_wx_path"]) if ctx.get("_wx_path") else None
    if not cmp.get("supported"):
        out["reason"] = cmp.get("reason")
        base_seq = (ctx.get("default_baseline") or {}).get("sequence") or []
        out["hazards"] = hazards(ctx, wx_raw, main_crop(base_seq), [], us)
        out["cost_coverage"] = {"available": False, "reason": out["reason"]}
        return analysis._jsonable(out)
    results = {r["cand"]["id"]: r for r in cap["results"]}
    cards = cmp["cards"]
    econ, m2 = cap["econ_ers"], cap["m2"] or {}
    # crops in play and their yield-index denominators (same pool as analysis._econ_for)
    shown = [results[c["id"]] for c in cards]
    crops = list(dict.fromkeys(e["crop_id"] for r in shown for e in r["sim"]["events"] if e["kind"] in ("cash", "forage")))
    med = {}
    for cid in crops:
        pool = [r for r in cap["ref_results"] if any(e["crop_id"] == cid for e in r["sim"]["events"])] or cap["results"]
        idx = np.concatenate([e["yield"] for r in pool for e in r["sim"]["events"]
                              if e["crop_id"] == cid and e["kind"] in ("cash", "forage")])
        med[cid] = float(np.nanmedian(idx)) if idx.size else float("nan")
    # weather sequences every shown option shares
    common = sorted(set.intersection(*[set(r["sim"]["start_years"]) for r in shown]))
    base_card = next(c for c in cards if c["is_baseline"])
    mc = main_crop(base_card["sequence"])
    rain, se = season_rain_by_year(ctx, cap["wx"], mc)
    n_max = max(r["sim"]["years_n"] for r in shown)
    season_rain = [round(float(np.nanmean([rain.get(y + i, np.nan) for i in range(n_max)])), 1)
                   if any((y + i) in rain for i in range(n_max)) else None for y in common]
    options = []
    for c in cards:
        r = results[c["id"]]
        sy = r["sim"]["start_years"]
        keep = np.array([sy.index(y) for y in common], int)
        pos, irr_year = _positions(r, med, keep)
        _add_n_credits(r, pos)
        prof = (c.get("indicators") or {}).get("profit_p50") or {}
        options.append({"id": c["id"], "name": c["name"], "rotation_label": c.get("rotation_label"),
                        "family_name": c.get("family_name"), "family_name_es": c.get("family_name_es"),
                        "is_baseline": c["is_baseline"], "is_custom": bool(c.get("is_custom")),
                        "best_for_you": bool(c.get("best_for_you")), "sequence": c["sequence"],
                        "years": r["sim"]["years_n"], "cycle_years": len(c["sequence"]), "positions": pos,
                        "irrigation_mm_per_year": [round(float(v), 1) for v in irr_year] if irr_year is not None else None,
                        "profit_p50_compare": prof.get("p50"),
                        "weather_sequences_all": len(sy)})
    price_years = econ.get("price_years") or [] if econ.get("available") else []
    crop_blocks = {cid: _crop_block(cid, econ, m2, econ.get("region"), price_years, us) for cid in crops}
    # wave U9: published county yields and state extension budgets per crop
    irrigated = out["field"]["irrigated"]
    for cid, b in crop_blocks.items():
        try:
            b["yield_history"] = yield_history(cid, ctx, us, irrigated)
        except Exception as e:  # noqa: BLE001 - reported, never filled in
            b["yield_history"] = {"available": False, "reason": f"USDA NASS yields could not be read ({type(e).__name__})"}
        if not us:
            b["benchmarks"] = {"available": False, "reason": "Published state crop budgets are connected for US fields only."}
        else:
            try:
                b["benchmarks"] = budgets_isu.benchmarks(cid, str(ctx.get("county_fips") or "")[:2] or None)
            except Exception as e:  # noqa: BLE001
                b["benchmarks"] = {"available": False, "reason": f"The ISU budgets could not be read ({type(e).__name__})"}
    costs_ok = bool(crops) and all(b["costs_available"] for b in crop_blocks.values())
    notes = []
    ers_blocks = [b for b in crop_blocks.values() if b["costs_available"] and _is_ers(b)]
    other_ev = [((econ.get("crops") or {}).get(cid) or {}).get("evidence") or {} for cid, b in crop_blocks.items()
                if b["costs_available"] and not _is_ers(b)]
    if ers_blocks:
        cy = ers_blocks[0]["cost_years"]
        notes.append(f"Costs are USDA ERS regional averages per planted acre ({cy}), not your farm's costs.")
        notes.append(f"Prices are USDA ERS harvest-period prices {price_years[0]}–{price_years[-1]} for the "
                     f"{econ.get('region')} region (nominal dollars), not your local price.")
    for ev in other_ev:
        notes += [n for n in (ev.get("cost_note"), ev.get("price_note")) if n]
    if not us:
        notes.append("Cost and price records are connected for US fields only: enter your own yield, price and costs. "
                     "The yield indices still come from every real weather season here.")
    if any(o["irrigation_mm_per_year"] for o in options):
        notes.append("Pumping cost is not in the USDA averages for most regions: enter your cost per acre-inch to count it.")
    if len(common) < max(o["weather_sequences_all"] for o in options):
        notes.append(f"Options are compared on the {len(common)} weather sequences they all share "
                     f"({common[0]}–{common[-1]} starts).")
    if any(p["crop"] == "fallow" for o in options for p in o["positions"]):
        notes.append("Fallow years have no revenue and no cost unless you add one.")
    out.update({
        "available": True, "region": econ.get("region") if econ.get("available") else None,
        "calendar_region": (ctx.get("region") or {}).get("label"),
        "costs_available": costs_ok, "weather_years": common, "season_rain_mm": season_rain,
        "season_rain_definition": f"Mean growing-season rain over the {n_max} years of each sequence; season = "
                                  + (f"{se['name']} planting to harvest ({se['basis']})" if se.get("name") else se["basis"]),
        "season_rain_by_year": {str(k): v for k, v in rain.items()},
        "price_years": price_years, "crops": crop_blocks,
        "cover": {"cost_usd_ac": float(np.mean(analysis.COVER_COST_USD_AC)), "range": list(analysis.COVER_COST_USD_AC),
                  "source": analysis.COVER_COST_SRC},
        "options": options,
        "how_to_combine": {
            "position_net": "typical_yield × yield_index[s] × price[p] − Σ cost lines − cover cost (if cover) "
                            "− pump $/acre-inch × irrigation_mm[s] / 25.4 (− overhead lines if included)",
            "rotation_average": "Σ position nets / option.years (equals the mean over positions when every year "
                                "has exactly one crop or fallow position)",
            "price": "price[p] = typical price × values[p] / median(values); a null value means ERS has no price that "
                     "year (use the median)",
            "consistency": "With USDA defaults and the comparison's paired price draw this reproduces "
                           "profit_p50_compare; over all S × P pairs the median differs by sampling only."},
        "custom_rejected": cmp.get("custom_rejected"),
        "budgets_used": (cmp.get("economics") or {}).get("budgets_used"),
        "notes": notes,
        "reminder": "Supports, never replaces, your own budget and your adviser.",
    })
    out["hazards"] = hazards(ctx, wx_raw, mc, crops, us)
    # wave U9: what the USDA cost lines hold, and how much real evidence sits behind the ranges
    out["cost_coverage"] = cost_coverage(crop_blocks, us)
    n_max_years = max(o["years"] for o in options)
    out["evidence"] = {
        "weather_seasons": len(common), "weather_years": [common[0], common[-1]] if common else None,
        "weather_years_covered": [common[0], common[-1] + n_max_years - 1] if common else None,
        "price_years": len(price_years), "price_range": [price_years[0], price_years[-1]] if price_years else None,
        "combinations": len(common) * max(len(price_years), 1),
        "definition": f"weather_seasons = real weather sequences every option runs through (one per start year "
                      f"{common[0]}–{common[-1]}, each {n_max_years} years long, NASA POWER at the field); "
                      "price_years = USDA ERS harvest-period price years (none outside the US)" if common else None,
        "weather_source": "NASA POWER",
        "price_source": ("USDA ERS" + ("; USDA NASS (" + ", ".join(cid for cid, b in crop_blocks.items()
                                                                   if b["costs_available"] and not _is_ers(b)) + ")"
                                       if other_ev else "")) if price_years else None}
    # wave U8: nitrogen credit pricing, conservation cost-share, the farmer's soil test
    out["n_credit"] = N_CREDIT_INFO
    out["fertilizer_n_price"] = fertilizer_n_price()
    try:
        out["costshare"] = CS.costshare(None, ctx.get("county_fips"), ctx["place"].get("country_code"))
    except Exception as e:  # noqa: BLE001 - reported, never filled in
        out["costshare"] = {"available": False, "reason": f"NRCS payment schedule could not be read ({type(e).__name__})"}
    if "soil_test" in cmp:
        out["soil_test"] = cmp["soil_test"]
    out["elapsed_s"] = round(time.time() - t0, 2)
    return analysis._jsonable(out)


def hazards(ctx: dict, wx: pd.DataFrame | None, crop: str | None, crops: list[str], us: bool) -> dict:
    try:
        w = weather_hazards(ctx, wx, crop) if wx is not None else {"available": False, "reason": "No NASA POWER weather for this field"}
    except Exception as e:  # noqa: BLE001 - reported, never filled in
        w = {"available": False, "reason": f"Weather hazards could not be computed ({type(e).__name__})"}
    if not us:
        why = "USDA crop-insurance and FEMA disaster records cover US counties only."
        return {"weather": w, "insured_losses": {"available": False, "reason": why},
                "declarations": {"available": False, "reason": why},
                "storm_events": {"available": False, "reason": "The NOAA Storm Events Database covers US counties only."}}
    fips = ctx.get("county_fips")
    try:
        il = losses.insured_losses(fips, crops, (ctx.get("place") or {}).get("county"))
    except Exception as e:  # noqa: BLE001
        il = {"available": False, "reason": f"USDA RMA records could not be read ({type(e).__name__})"}
    try:
        de = losses.declarations(fips)
    except Exception as e:  # noqa: BLE001
        de = {"available": False, "reason": f"OpenFEMA could not be read ({type(e).__name__})"}
    try:
        se = storms.county_events(fips)
    except Exception as e:  # noqa: BLE001
        se = {"available": False, "reason": f"NOAA Storm Events summary could not be read ({type(e).__name__})"}
    return {"weather": w, "insured_losses": il, "declarations": de, "storm_events": se}
