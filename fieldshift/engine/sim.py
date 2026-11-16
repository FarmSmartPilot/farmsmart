"""M6 process simulator: run a rotation over every historical weather sequence at once.

Methods (all documented in docs/METHODS.md):
- Water: FAO-56 single crop coefficient daily soil-water bucket (Allen et al. 1998, ch. 6 & 8). TAW from SSURGO
  available water storage 0-100 cm. Bare/residue soil evaporation via Kc_bare with FAO-56 ch. 9 mulch reduction
  (≈5 % less evaporation per 10 % residue cover).
- Yield: FAO-33/66 water-production function Ya/Ym = 1 - Ky (1 - ETa/ETc) (Doorenbos & Kassam 1979; Steduto et al. 2012),
  Ym calibrated so the simulated median matches detrended NASS county yields where available.
- Water erosion: RUSLE A = R K LS C P (Renard et al. 1997, AH-703). R from Renard & Freimund (1994), distributed over the
  year by daily erosive rain; daily soil-loss ratio = canopy subfactor x surface-cover subfactor (AH-703 eqs. 5-6, 5-8, b=0.035).
- Wind: exposure index = Σ days with WS10M_MAX ≥ threshold, weighted by bare fraction and (U-Ut)U² (RWEQ-style weather
  factor, Fryrear et al. 1998), scaled by SSURGO wind erodibility index. RELATIVE index, not tonnes.
- Soil organic carbon: two-pool ICBM model (Andrén & Kätterer 1997) with residue + root C inputs from yield and harvest index.
- Nitrogen: crop N need minus legume credit carried to the next crop (ranges from crops.yaml).
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import numpy as np
import pandas as pd

from .climate import WIND_THRESHOLD_10M, r_factor

DAYS = 365

# FAO-33 seasonal yield response factors Ky (Doorenbos & Kassam 1979, Table 24; FAO-66 Steduto et al. 2012)
KY = {"corn": 1.25, "soybean": 0.85, "winter_wheat": 1.05, "spring_wheat": 1.15, "durum": 1.15, "barley": 1.0,
      "oats": 1.0, "sorghum": 0.9, "sunflower": 0.95, "canola": 1.0, "field_pea": 1.15, "lentil": 1.15,
      "chickpea": 1.15, "dry_bean": 1.15, "alfalfa": 1.1, "red_clover": 1.1, "cotton": 0.85, "rice": 1.2,
      "proso_millet": 0.9, "safflower": 0.8, "flax": 1.0, "sugar_beet": 1.0, "processing_tomato": 1.05,
      "triticale": 1.05}
# Harvest index (grain / above-ground biomass) for residue C input; Prince et al. 2001, Johnson et al. 2006 (residue-to-grain)
HARVEST_INDEX = {"corn": 0.50, "soybean": 0.42, "winter_wheat": 0.42, "spring_wheat": 0.40, "durum": 0.40,
                 "barley": 0.45, "oats": 0.40, "sorghum": 0.45, "sunflower": 0.30, "canola": 0.30, "field_pea": 0.45,
                 "lentil": 0.40, "chickpea": 0.40, "dry_bean": 0.45, "cotton": 0.35, "rice": 0.45, "proso_millet": 0.35,
                 "safflower": 0.30, "flax": 0.30, "triticale": 0.40}
# Residue cover half-life (days) on the surface under no-till: high-residue cereals persist, low-residue crops fade fast.
# Assumption calibrated to RUSLE2 crop-residue decomposition classes (USDA-ARS RUSLE2 database); shown as an assumption.
RESIDUE_HALF_LIFE = {"high": 220, "medium": 140, "low": 80}
RESIDUE_CLASS = {"corn": "high", "sorghum": "high", "winter_wheat": "high", "spring_wheat": "high", "durum": "high",
                 "barley": "high", "oats": "medium", "triticale": "high", "cereal_rye": "high", "rice": "high",
                 "soybean": "low", "field_pea": "low", "lentil": "low", "chickpea": "low", "dry_bean": "low",
                 "canola": "medium", "sunflower": "low", "cotton": "low", "proso_millet": "medium", "safflower": "low",
                 "flax": "medium", "sugar_beet": "low", "processing_tomato": "low"}
CROP_C_FRACTION = 0.45  # carbon fraction of dry biomass
ICBM = dict(k_young=0.8, k_old=0.006, h_residue=0.125, h_root=0.35)  # Andrén & Kätterer 1997 (per year)


@dataclass
class Event:
    crop_id: str
    kind: str                # cash | cover | forage
    start: int               # absolute day index in the rotation timeline
    end: int                 # harvest / termination day index (exclusive)
    harvest: bool = True
    profile: tuple | None = None   # optional explicit (kc[L], canopy[L]) arrays (covers, perennials)
    label: str = ""
    active_days: int | None = None


@dataclass
class Timeline:
    days: int
    kc: np.ndarray
    canopy: np.ndarray       # canopy cover fraction 0..1
    crop_idx: np.ndarray     # -1 none, else index into events
    events: list[Event] = field(default_factory=list)


def build_timeline(events: list[Event], crops: dict[str, dict], n_years: int) -> Timeline:
    D = n_years * DAYS
    kc = np.full(D, np.nan)
    canopy = np.zeros(D)
    idx = np.full(D, -1)
    for k, ev in enumerate(events):
        c = crops[ev.crop_id]
        if ev.profile is not None:
            pk, pc = ev.profile
            a, b = max(ev.start, 0), min(ev.end, D)
            if b > a:
                kc[a:b] = pk[a - ev.start:b - ev.start]
                canopy[a:b] = pc[a - ev.start:b - ev.start]
                idx[a:b] = k
            continue
        sd = c["stage_days"]
        total = sum(sd.values())
        L = ev.end - ev.start
        if L <= 0:
            continue
        # FAO-56 stages run from planting for their tabulated length (compressed only if the scheduled season is
        # shorter). After physiological maturity the crop stands dry until harvest: Kc_end, canopy senesced.
        active = min(total, L)
        scale = active / total
        ini, dev, mid = sd["ini"] * scale, sd["dev"] * scale, sd["mid"] * scale
        kci, kcm, kce = c["kc"]["ini"], c["kc"]["mid"], c["kc"]["end"]
        t = np.arange(L, dtype=float)
        kcc = np.where(t < ini, kci,
              np.where(t < ini + dev, kci + (kcm - kci) * (t - ini) / max(dev, 1),
              np.where(t < ini + dev + mid, kcm,
              np.where(t < active, kcm + (kce - kcm) * (t - ini - dev - mid) / max(active - ini - dev - mid, 1), kce))))
        ev.active_days = int(active)
        if ev.kind == "cover" and not ev.harvest:
            # cover terminated before maturity: Kc stays in ini/dev range in cold months (FAO-56 ch. 7)
            pass
        maxc = 0.95 if ev.kind != "cover" else 0.85
        cc = np.clip((kcc - 0.15) / max(kcm - 0.15, 0.05), 0, 1) * maxc
        # standing dry crop after maturity still shades the soil (senesced canopy ~ half cover until harvest)
        cc = np.where(t >= active, np.minimum(cc, 0.5), cc)
        a, b = max(ev.start, 0), min(ev.end, D)
        if b > a:
            kc[a:b] = kcc[a - ev.start:b - ev.start]
            canopy[a:b] = cc[a - ev.start:b - ev.start]
            idx[a:b] = k
    return Timeline(D, kc, canopy, idx, events)


def residue_cover(tl: Timeline, crops: dict[str, dict]) -> np.ndarray:
    """Surface residue cover fraction after each harvest/termination, decaying exponentially."""
    D = tl.days
    res = np.zeros(D)
    for ev in tl.events:
        c = crops[ev.crop_id]
        r0 = c.get("residue_cover_after_harvest")
        if r0 is None:
            r0 = 0.5 if ev.kind == "cover" else 0.3  # assumption where no source value (listed in card gaps)
        cls = RESIDUE_CLASS.get(ev.crop_id, "medium")
        hl = RESIDUE_HALF_LIFE[cls]
        if ev.end >= D or ev.end < 0:
            continue
        t = np.arange(D - ev.end)
        decay = r0 * 0.5 ** (t / hl)
        # residue is buried/replaced when the next crop's canopy closes; keep max with existing residue
        res[ev.end:] = np.maximum(res[ev.end:], decay)
    return np.clip(res, 0, 0.98)


@dataclass
class SiteInputs:
    weather: dict[str, np.ndarray]   # each (S, D): P, ET0, TMIN, TMAX, WMAX
    start_years: list[int]
    taw_mm: float
    k_factor_si: float | None        # t ha h / (ha MJ mm)
    ls: float
    r_annual: float                  # MJ mm / ha / h / yr
    wei: float | None                # wind erodibility index (t/ac/yr) from SSURGO
    soc_t_ha: float | None           # topsoil SOC stock (t C/ha, 0-30 cm) from SSURGO OM
    irrigation_mm: float = 0.0
    auto_irrigate: bool = False      # FAO-56 management: refill root zone when depletion exceeds RAW (cash/forage crops)


def weather_stack(df: pd.DataFrame, et0: pd.Series, n_years: int, years: list[int]) -> tuple[dict, list[int]]:
    """Build (S, D) arrays for every start year whose n consecutive years are complete."""
    d = df.copy()
    d["ET0"] = et0
    d = d[~((d.index.month == 2) & (d.index.day == 29))]
    full = set(years)
    starts = [y for y in years if all((y + i) in full for i in range(n_years))]
    out = {k: [] for k in ("P", "ET0", "TMIN", "TMAX", "WMAX")}
    for y in starts:
        sl = d[(d.index.year >= y) & (d.index.year < y + n_years)]
        if len(sl) != n_years * DAYS:
            continue
        out["P"].append(sl["PRECTOTCORR"].fillna(0).values)
        out["ET0"].append(sl["ET0"].fillna(sl["ET0"].mean()).values)
        out["TMIN"].append(sl["T2M_MIN"].values)
        out["TMAX"].append(sl["T2M_MAX"].values)
        out["WMAX"].append(sl["WS10M_MAX"].fillna(0).values)
    used = [y for y in starts if len(d[(d.index.year >= y) & (d.index.year < y + n_years)]) == n_years * DAYS]
    return {k: np.array(v) for k, v in out.items()}, used


def simulate(tl: Timeline, site: SiteInputs, crops: dict[str, dict], ym: dict[str, float],
             rot_mult: dict[int, tuple[float, float]] | None = None, trace: bool = False) -> dict[str, Any]:
    """Returns per-sample arrays for every indicator. rot_mult: event index -> (low, high) yield multiplier
    from the rules engine (rotation effects); the midpoint is used, the range feeds uncertainty."""
    W = site.weather
    S, D = W["P"].shape
    assert D == tl.days, (D, tl.days)
    res = residue_cover(tl, crops)
    soil_cover = np.clip(tl.canopy + (1 - tl.canopy) * res, 0, 1)  # (D,)
    bare = soil_cover < 0.30

    # ---- water balance (vectorized over samples)
    taw = max(site.taw_mm, 30.0)
    raw_frac = 0.5
    Dr = np.zeros(S)  # root-zone depletion (mm), start at field capacity
    eta = np.zeros((S, D))
    etc = np.zeros((S, D))
    drain = np.zeros((S, D))
    kc_bare = 0.30
    kc_day = np.where(np.isnan(tl.kc), kc_bare * (1 - 0.5 * res), tl.kc)  # FAO-56 ch.9 mulch: ~5%/10% cover
    in_crop = tl.crop_idx >= 0
    irr = np.zeros(D)
    if site.irrigation_mm > 0:
        cash_days = np.array([tl.events[i].kind == "cash" if i >= 0 else False for i in tl.crop_idx])
        n_cash = max(cash_days.sum(), 1)
        irr = np.where(cash_days, site.irrigation_mm * (tl.days / DAYS) / n_cash, 0.0)
    dr_tr = np.zeros((S, D)) if trace else None
    ks_tr = np.zeros((S, D)) if trace else None
    irr_applied = np.zeros(S)
    managed = np.array([(tl.events[i].kind in ("cash", "forage")) if i >= 0 else False for i in tl.crop_idx])
    for d in range(D):
        if site.auto_irrigate and managed[d]:
            need = np.where(Dr > raw_frac * taw, Dr, 0.0)
            irr_applied += need
            Dr = Dr - need
        e = W["ET0"][:, d] * kc_day[d]
        Ks = np.where(Dr > raw_frac * taw, (taw - Dr) / ((1 - raw_frac) * taw), 1.0).clip(0, 1)
        if trace:
            ks_tr[:, d] = Ks if in_crop[d] else np.nan
        a = e * (Ks if in_crop[d] else np.minimum(1.0, (taw - Dr) / taw * 2))
        Dr = Dr - W["P"][:, d] - irr[d] + a
        dp = np.where(Dr < 0, -Dr, 0.0)
        Dr = np.maximum(Dr, 0)
        Dr = np.minimum(Dr, taw)
        eta[:, d] = a
        etc[:, d] = e
        drain[:, d] = dp
        if trace:
            dr_tr[:, d] = Dr

    # ---- per-event outcomes
    ev_out = []
    years_n = D // DAYS
    soc_inputs = np.zeros((S, years_n))
    root_inputs = np.zeros((S, years_n))
    n_balance = np.zeros(S)
    for k, ev in enumerate(tl.events):
        c = crops[ev.crop_id]
        if ev.start < 0 or ev.end > D:  # cut by the simulation window: only its days count (cover/water)
            continue
        act = getattr(ev, "active_days", None) or (ev.end - ev.start)
        sl = slice(ev.start, min(ev.start + act, D))  # water-stress and frost windows: active season only
        ratio = eta[:, sl].sum(1) / np.maximum(etc[:, sl].sum(1), 1e-6)
        ky = KY.get(ev.crop_id, 1.0)
        rel = np.clip(1 - ky * (1 - ratio), 0, 1)
        fk = c.get("frost_kill_c")
        frost_hits = np.zeros(S)
        heat_days = np.zeros(S)
        if ev.kind != "cover":
            # frost after emergence (first 15% of season excluded) and before the last 10% of season
            L = sl.stop - sl.start
            a0, a1 = sl.start + int(0.15 * L), sl.start + int(0.9 * L)
            if fk is not None and a1 > a0:
                frost_hits = (W["TMIN"][:, a0:a1] <= fk).sum(1)
            hs = c.get("heat_stress_c")
            m0, m1 = sl.start + int(0.45 * L), sl.start + int(0.75 * L)  # flowering-ish window
            if hs is not None and m1 > m0:
                heat_days = (W["TMAX"][:, m0:m1] >= hs).sum(1)
            rel = rel * np.where(frost_hits > 0, 0.6, 1.0)
        mult = 1.0
        if rot_mult and k in rot_mult:
            lo, hi = rot_mult[k]
            mult = (lo + hi) / 2
        y = rel * ym.get(ev.crop_id, np.nan) * mult if ev.harvest and ev.kind != "cover" else np.full(S, np.nan)
        # carbon inputs: above-ground residue + roots
        yi = (ev.start // DAYS)
        if ev.kind == "cover":
            # cover biomass from water use: transpiration efficiency proxy 15 kg DM / ha / mm ETa (Steduto 2009 normalized WP≈15-20 g/m2)
            biomass = eta[:, sl].sum(1) * 15 / 1000  # t DM/ha
            res_c = biomass * CROP_C_FRACTION
            root_c = biomass * 0.4 * CROP_C_FRACTION
        elif ev.harvest and not np.isnan(ym.get(ev.crop_id, np.nan)):
            hi = HARVEST_INDEX.get(ev.crop_id, 0.4)
            grain_dm = np.nan_to_num(y) * 0.85 / 1000 * (1 if c.get("yield_unit_kg", True) else 1)
            stover = grain_dm * (1 - hi) / hi
            res_c = stover * CROP_C_FRACTION
            root_c = (grain_dm + stover) * 0.25 * CROP_C_FRACTION
        else:
            res_c = np.zeros(S)
            root_c = np.zeros(S)
        if yi < years_n:
            soc_inputs[:, yi] += res_c
            root_inputs[:, yi] += root_c
        need = c.get("n_need_kg_ha") or 0
        credit = c.get("n_credit_next_kg_ha") or [0, 0]
        credit_mid = (credit[0] + credit[1]) / 2 if isinstance(credit, (list, tuple)) else float(credit)
        n_balance += (credit_mid if c.get("n_fixing") else 0) - (need if ev.kind != "cover" else 0)
        ev_out.append({"event": k, "crop_id": ev.crop_id, "kind": ev.kind, "rel_yield": rel, "yield": y,
                       "eta_mm": eta[:, sl].sum(1), "etc_mm": etc[:, sl].sum(1), "frost_hits": frost_hits,
                       "heat_days": heat_days})

    # ---- RUSLE water erosion
    P = W["P"]
    ei_shape = np.where(P >= 12.7, P ** 1.81, 0)
    ei_year = ei_shape.reshape(S, years_n, DAYS).sum(2, keepdims=True)
    ei_daily = np.where(ei_year > 0, ei_shape.reshape(S, years_n, DAYS) / np.maximum(ei_year, 1e-9), 0).reshape(S, D)
    ei_daily = ei_daily * site.r_annual  # R distributed by each year's own erosive-rain timing
    cc = 1 - tl.canopy * np.exp(-0.1 * 0.5)            # canopy subfactor, fall height 0.5 m (AH-703 eq 5-6)
    sc = np.exp(-0.035 * res * 100)                      # surface-cover subfactor (AH-703 eq 5-8)
    slr = cc * sc
    if site.k_factor_si is not None:
        a_water = (ei_daily * slr).sum(1) * site.k_factor_si * site.ls / years_n  # t/ha/yr
    else:
        a_water = np.full(S, np.nan)

    # ---- wind exposure
    U = W["WMAX"]
    ut = WIND_THRESHOLD_10M
    wf = np.where(U > ut, (U - ut) * U ** 2, 0)
    bare_frac = (1 - soil_cover)
    wind_index = (wf * bare_frac ** 1.5).sum(1) / years_n
    if site.wei:
        wind_index = wind_index * (site.wei / 86.0)  # 86 t/ac/yr = WEG 4 reference
    windy_days = (U >= ut)
    bare_windy_days = (windy_days & bare).sum(1) / years_n
    heavy = P >= 25.4
    bare_heavy_days = (heavy & bare).sum(1) / years_n

    # ---- soil organic carbon (ICBM)
    soc_change = np.full(S, np.nan)
    if site.soc_t_ha:
        Y = np.zeros(S)
        O = np.full(S, site.soc_t_ha)
        for yi in range(years_n):
            inp_r = soc_inputs[:, yi]
            inp_root = root_inputs[:, yi]
            Y_new = (Y + inp_r + inp_root) * np.exp(-ICBM["k_young"])
            humified = ICBM["h_residue"] * inp_r + ICBM["h_root"] * inp_root
            O = O * np.exp(-ICBM["k_old"]) + humified
            Y = Y_new
        soc_change = (O + Y - site.soc_t_ha) / years_n  # t C/ha/yr

    extra = {}
    if trace:
        extra = {"trace_depletion_mm": dr_tr, "trace_ks": ks_tr, "trace_eta": eta, "trace_etc": etc,
                 "trace_erosion_t_ha": (ei_daily * slr) * (site.k_factor_si or np.nan) * site.ls, "taw_mm": taw}
    return {
        **extra,
        "S": S, "start_years": site.start_years, "years_n": years_n,
        "events": ev_out,
        "water_use_mm": eta.sum(1) / years_n,
        "irrigation_mm": irr_applied / years_n,
        "deep_drainage_mm": drain.sum(1) / years_n,
        "soil_cover_daily": soil_cover, "residue_daily": res, "canopy_daily": tl.canopy, "bare_daily": bare,
        "bare_days": float(bare.sum() / years_n),
        "erosion_water_t_ha": a_water,
        "wind_index": wind_index, "bare_windy_days": bare_windy_days, "bare_heavy_rain_days": bare_heavy_days,
        "soc_change_t_ha_yr": soc_change,
        "n_balance_kg_ha_yr": n_balance / years_n,
    }
