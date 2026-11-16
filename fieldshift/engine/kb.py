"""Agronomy knowledge base: crops, calendars, rules, families, glossary (engine/rules/*.yaml)."""
from __future__ import annotations

from datetime import date
from functools import lru_cache
from typing import Any

import yaml

from ..config import RULES_DIR, STRATEGIES_DIR
from .sim import KY

ALIASES = {"wheat": "winter_wheat"}


def _mean(v):
    if isinstance(v, (list, tuple)):
        vals = [x for x in v if x is not None]
        return sum(vals) / len(vals) if vals else None
    return v


def _load(path):
    with open(path, encoding="utf-8") as f:
        # the C loader is ~10x faster than the pure-Python one (cold start of the first compare)
        return yaml.load(f, Loader=getattr(yaml, "CSafeLoader", yaml.SafeLoader))


@lru_cache(maxsize=1)
def crops() -> dict[str, dict]:
    raw = _load(RULES_DIR / "crops.yaml")
    out = {}
    for c in raw["crops"]:
        c = dict(c)
        if c.get("kc"):
            c["kc"] = {k: _mean(v) for k, v in c["kc"].items()}
        c["residue_cover_after_harvest"] = _mean(c.get("residue_cover_after_harvest"))
        nc = c.get("n_credit_next_kg_ha")
        if isinstance(nc, (list, tuple)):
            lo = nc[0] if nc[0] is not None else 0
            hi = nc[1] if nc[1] is not None else lo
            c["n_credit_next_kg_ha"] = [lo, hi]
        c["ky"] = KY.get(c["id"])
        eq = list(c.get("equipment") or [])
        if "combine" in eq and "cash" in (c.get("roles") or []):
            # grain crops: a baler/forage harvester is only needed for the optional straw/forage use
            c["equipment_optional"] = [e for e in eq if e in ("baler", "forage_harvester")]
            c["equipment"] = [e for e in eq if e not in ("baler", "forage_harvester")]
        c["simulable"] = bool(c.get("kc") and c.get("stage_days")) or c.get("season") == "cover"
        out[c["id"]] = c
    # Fallow: a deliberate no-crop year (summer fallow stores soil water). Not a crop: no yield, no parameters.
    out["fallow"] = {"id": "fallow", "name": "Fallow", "name_es": "Barbecho", "family": "none", "roles": ["fallow"],
                     "season": "fallow", "simulable": True, "equipment": [], "pest_host_groups": [], "n_fixing": False,
                     "kc": None, "stage_days": None, "residue_cover_after_harvest": None, "references": []}
    return out


@lru_cache(maxsize=1)
def sources() -> dict[str, dict]:
    s = {}
    for p in [RULES_DIR / "crops.yaml", RULES_DIR / "calendars.yaml", RULES_DIR / "rules.yaml",
              RULES_DIR / "pathogens.yaml", STRATEGIES_DIR / "families.yaml"]:
        s.update(_load(p).get("sources", {}) or {})
    return s


def doy(mmdd: str | None) -> int | None:
    if not mmdd:
        return None
    m, d = (int(x) for x in mmdd.split("-"))
    return (date(2001, m, d) - date(2001, 1, 1)).days  # 0-based, non-leap


@lru_cache(maxsize=1)
def calendars() -> dict[str, Any]:
    raw = dict(_load(RULES_DIR / "calendars.yaml")["regions"])
    states = RULES_DIR / "calendars_us_states.yaml"  # generated from NASS AH-628 by scripts/build_state_calendars.py
    if states.exists():
        for rid, r in (_load(states).get("regions") or {}).items():
            raw.setdefault(rid, r)  # hand-curated pilot regions win
    out = {}
    for rid, r in raw.items():
        cr = {}
        for cid, w in (r.get("crops") or {}).items():
            cid = ALIASES.get(cid, cid)
            cr[cid] = w
        covers = r.get("covers") or (raw.get(r.get("covers_from") or "", {}).get("covers")) or {}
        out[rid] = {**r, "crops": cr, "covers": covers}
    return out


def state_region(statefips: str | None) -> str | None:
    """Calendar region id for a US state's own NASS AH-628 calendar (us_sd...), or None."""
    if not statefips:
        return None
    for rid, r in calendars().items():
        if rid.startswith("us_") and r.get("statefips") == statefips:
            return rid
    return None


def window_mid(w: dict | None) -> int | None:
    """Middle of the 'most active' window (or begin..end) as 0-based DOY, handling year wrap."""
    if not w:
        return None
    a, b = (w.get("most_active") or [w.get("begin"), w.get("end")])
    a, b = doy(a), doy(b)
    if a is None or b is None:
        return a if a is not None else b
    if b < a:
        b += 365
    return int((a + b) / 2) % 365


@lru_cache(maxsize=1)
def rules() -> dict:
    return _load(RULES_DIR / "rules.yaml")


@lru_cache(maxsize=1)
def pathogens() -> dict[str, dict]:
    """engine/rules/pathogens.yaml: pathogen / pest host groups keyed by the crops.yaml pest_host_groups id."""
    p = RULES_DIR / "pathogens.yaml"
    if not p.exists():
        return {}
    return {x["id"]: x for x in _load(p).get("pathogens") or []}


def pathogen_consistency() -> list[str]:
    """Problems between crops.yaml pest_host_groups and pathogens.yaml (empty list = consistent)."""
    C, P = crops(), pathogens()
    S = sources()
    probs = []
    group_to_pathogen = {}
    for pid, p in P.items():
        group_to_pathogen[pid] = (pid, "hosts")
        if p.get("inoculum_group"):
            group_to_pathogen[p["inoculum_group"]] = (pid, "inoculum_sources")
        for s in p.get("sources") or []:
            if s not in S:
                probs.append(f"{pid}: source '{s}' not defined")
        for key in ("hosts", "inoculum_sources"):
            for cid in p.get(key) or []:
                if cid not in C:
                    probs.append(f"{pid}: {key} has unknown crop '{cid}'")
                    continue
                gid = pid if key == "hosts" else p["inoculum_group"]
                if gid not in (C[cid].get("pest_host_groups") or []):
                    probs.append(f"{pid}: {cid} listed in {key} but crops.yaml lacks '{gid}'")
    for cid, c in C.items():
        for g in c.get("pest_host_groups") or []:
            if g not in group_to_pathogen:
                probs.append(f"{cid}: pest_host_group '{g}' has no pathogens.yaml entry")
            else:
                pid, key = group_to_pathogen[g]
                if cid not in (P[pid].get(key) or []):
                    probs.append(f"{cid}: has '{g}' but is not in pathogens.yaml {pid}.{key}")
    return probs


@lru_cache(maxsize=1)
def families() -> dict[str, dict]:
    return {f["id"]: f for f in _load(STRATEGIES_DIR / "families.yaml")["families"]}


@lru_cache(maxsize=1)
def family_defaults() -> dict:
    return _load(STRATEGIES_DIR / "families.yaml").get("strip_trial_default", {})


@lru_cache(maxsize=1)
def glossary() -> dict:
    return _load(RULES_DIR / "glossary.yaml")


# ---- region support (recommendations switch on only where calendars + rules exist)
PILOTS = {
    "iowa_central": dict(label="Central Iowa", states={"19", "17", "18", "27", "29", "31", "39", "55"}),
    "kansas_west": dict(label="Western Kansas", states={"20", "08", "40", "48", "35"}),
    "california_sjv": dict(label="San Joaquin Valley", states={"06", "04", "32"}),
    "saskatchewan": dict(label="Saskatchewan", states=set()),
    "punjab_in": dict(label="Punjab, India", states=set()),
    "mato_grosso_br": dict(label="Mato Grosso, Brazil", states=set()),
}
HOME_STATE = {"iowa_central": "19", "kansas_west": "20", "california_sjv": "06"}
# States with no field-crop rows in AH-628 borrow a neighbour's state calendar.
STATE_BORROW = {"09": "36", "25": "36", "44": "36", "33": "36", "50": "36"}  # CT, MA, RI, NH, VT -> New York


def region_for(country_code: str | None, statefips: str | None, admin1: str | None, lat: float, lon: float) -> dict:
    cc = (country_code or "").lower()
    a1 = (admin1 or "").lower()
    if cc == "us" and statefips:
        # 1) pilot home states keep their hand-checked calendars
        for rid, home in HOME_STATE.items():
            if home == statefips and not (rid == "kansas_west" and lon > -98.5 and state_region(statefips)):
                exact = not (rid == "kansas_west" and lon > -98.5)
                p = PILOTS[rid]
                return {"region": rid, "label": p["label"], "exact": exact,
                        "note": None if exact else f"Planting calendar borrowed from {p['label']} (nearest supported region). Check local dates."}
        # 2) every other state: its own state-level calendar (USDA NASS AH-628), or a neighbour's
        own = state_region(statefips)
        if own:
            return {"region": own, "label": calendars()[own]["label"], "exact": True, "scale": "state",
                    "note": None}
        borrowed = state_region(STATE_BORROW.get(statefips))
        if borrowed:
            lab = calendars()[borrowed]["label"]
            return {"region": borrowed, "label": lab, "exact": False, "scale": "state",
                    "note": f"Planting calendar borrowed from {lab} (no state dates in USDA's handbook). Check local dates."}
        for rid, p in PILOTS.items():
            if statefips in p["states"]:
                return {"region": rid, "label": p["label"], "exact": False,
                        "note": f"Planting calendar borrowed from {p['label']} (nearest supported region). Check local dates."}
        return {"region": None, "label": None, "exact": False,
                "note": "No crop calendar and rules for this state yet. Environmental analysis only."}
    if cc == "ca" and ("saskatchewan" in a1 or "alberta" in a1 or "manitoba" in a1):
        return {"region": "saskatchewan", "label": "Saskatchewan", "exact": "saskatchewan" in a1,
                "note": None if "saskatchewan" in a1 else "Calendar borrowed from Saskatchewan."}
    if cc == "in" and ("punjab" in a1 or "haryana" in a1):
        return {"region": "punjab_in", "label": "Punjab, India", "exact": "punjab" in a1, "note": None}
    if cc == "br" and ("mato grosso" in a1):
        exact = "do sul" not in a1  # Mato Grosso do Sul borrows the Mato Grosso calendar
        return {"region": "mato_grosso_br", "label": "Mato Grosso, Brazil", "exact": exact,
                "note": None if exact else "Calendar borrowed from Mato Grosso. Check local dates."}
    return {"region": None, "label": None, "exact": False,
            "note": "Rotation recommendations are not supported here yet. Environmental analysis works everywhere."}
