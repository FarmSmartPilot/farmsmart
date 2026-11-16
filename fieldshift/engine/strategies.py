"""Rotation candidates: detect the existing rotation, generate candidates for the six strategy families,
and turn a rotation spec into a daily simulation timeline using the region's crop calendar."""
from __future__ import annotations

import math
from collections import Counter
from dataclasses import dataclass

import numpy as np

from . import kb
from .sim import DAYS, Event, Timeline, build_timeline

WINTERKILL = {"oats_winterkill", "radish_cover"}
COVER_GDD_FULL = 700.0      # °C-days (base 0) to full cover crop canopy. Assumption (SARE ranges); listed on cards.
COVER_MAX_CANOPY = 0.85
COVER_TERMINATE_BEFORE = 14  # days before next planting (SARE: ≥10 days before corn for rye)


@dataclass
class Clim:
    tmean_doy: np.ndarray       # 365 daily mean temperature climatology
    kill_doy: dict              # frost_kill_c -> median first fall DOY with Tmin <= threshold
    first_frost_doy: int | None


def clim_from(df) -> Clim:
    d = df[~((df.index.month == 2) & (df.index.day == 29))]
    doy = np.array([(t.dayofyear - 1 if not (t.is_leap_year and t.month > 2) else t.dayofyear - 2) for t in d.index])
    tm = np.zeros(365)
    for i in range(365):
        tm[i] = np.nanmean(d["T2M"].values[doy == i])
    kills = {}
    for thr in sorted({c.get("frost_kill_c") for c in kb.crops().values() if c.get("frost_kill_c") is not None} | {0.0}):
        firsts = []
        for y, g in d.groupby(d.index.year):
            fall = g[(g.index.month >= 7) & (g["T2M_MIN"] <= thr)]
            if len(fall):
                t = fall.index[0]
                firsts.append(t.dayofyear - 1)
        kills[thr] = int(np.median(firsts)) if len(firsts) >= 5 else None
    return Clim(tm, kills, kills.get(0.0))


def detect_baseline(history: list[dict]) -> dict:
    """history: [{year, crop_id, share}] (CDL). Returns a cycle that reproduces recent crop frequencies."""
    recent = [h for h in history if h.get("crop_id")][-8:]
    if len(recent) < 3:
        return {"sequence": None, "reason": "fewer than 3 years of crop history"}
    ids = [h["crop_id"] for h in recent]
    cnt = Counter(ids)
    # an exactly repeating recent pattern wins (e.g. corn, soybean, corn, soybean)
    for L in (2, 3, 4):
        tail = ids[-2 * L:]
        if len(tail) == 2 * L and tail[:L] == tail[L:] and len(set(tail)) > 1:
            cyc = tail[:L]
            return {"sequence": [{"cash": c, "cover": None} for c in cyc], "observed": ids,
                    "frequency": {c: n / len(ids) for c, n in cnt.items()},
                    "label": "–".join(kb.crops()[c]["name"].split(" (")[0] for c in cyc), "fit_error": 0.0,
                    "method": f"repeating {L}-year pattern in the last {2 * L} years"}
    best = None
    for L in (2, 3, 4):
        # choose counts per crop for a cycle of length L closest to observed frequencies
        target = {c: n / len(ids) * L for c, n in cnt.items()}
        alloc = {c: int(round(v)) for c, v in target.items()}
        diff = L - sum(alloc.values())
        order = sorted(target, key=lambda c: -(target[c] - alloc[c]))
        i = 0
        while diff != 0 and order:
            c = order[i % len(order)]
            if diff > 0:
                alloc[c] += 1
                diff -= 1
            elif alloc[c] > 0:
                alloc[c] -= 1
                diff += 1
            i += 1
        err = sum(abs(alloc.get(c, 0) / L - n / len(ids)) for c, n in cnt.items())
        cyc = []
        for c, _ in cnt.most_common():
            cyc += [c] * alloc.get(c, 0)
        if best is None or err < best[0] - 0.05:
            best = (err, cyc)
    cyc = [c for c in best[1] if c]
    # interleave so minor crops are spaced (e.g. corn corn corn soybean)
    seq = [{"cash": c, "cover": None} for c in cyc]
    pattern = "–".join(kb.crops()[c]["name"].split(" (")[0] for c in cyc) if all(c in kb.crops() for c in cyc) else None
    return {"sequence": seq, "observed": ids, "frequency": {c: n / len(ids) for c, n in cnt.items()},
            "label": pattern, "fit_error": round(best[0], 3)}


def _cover_profile(cover_id: str, start: int, end: int, clim: Clim) -> tuple[np.ndarray, np.ndarray]:
    L = end - start
    t = np.arange(L)
    doys = (start + t) % DAYS
    gdd = np.cumsum(np.clip(clim.tmean_doy[doys], 0, None))
    canopy = COVER_MAX_CANOPY * np.clip(gdd / COVER_GDD_FULL, 0, 1)
    # winter dormancy: canopy can't exceed what grew before cold, it doesn't vanish (winter-hardy covers)
    kc = 0.3 + 0.7 * canopy
    return kc, canopy


def build_events(sequence: list[dict], region: str, clim: Clim, reps: int | None = None) -> tuple[list[Event], int, list[str]]:
    C = kb.crops()
    cal = kb.calendars()[region]
    L = len(sequence)
    reps = reps or max(2, math.ceil(4 / L))
    n_years = L * reps
    issues: list[str] = []
    events: list[Event] = []
    cash_spans = []  # (k, start, end, crop)
    double_idx: set[int] = set()  # indices in cash_spans that are a year's second (double) crop
    for k in range(-1, n_years + 1):
        s = sequence[k % L]
        cid = s["cash"]
        c = C[cid]
        if c["season"] == "fallow":
            continue  # no crop this year: soil stays bare except for the previous crop's residue
        w = cal["crops"].get(cid) or {}
        if c["season"] == "perennial":
            # perennial forage: active Apr 1 - Oct 31 each stand year; dormant cover over winter
            pstart = k * DAYS + kb.doy("04-01")
            pend = k * DAYS + kb.doy("10-31")
            cash_spans.append((k, pstart, pend, cid))
            continue
        p = kb.window_mid(w.get("plant"))
        h = kb.window_mid(w.get("harvest"))
        if p is None or h is None:
            issues.append(f"No planting/harvest dates for {c['name']} in {region}")
            return [], n_years, issues
        if c["season"] == "winter":
            start, end = (k - 1) * DAYS + p, k * DAYS + h
        else:
            start = k * DAYS + p
            end = k * DAYS + h + (DAYS if h < p else 0)
        cash_spans.append((k, start, end, cid))
        d_id = s.get("double")
        if d_id:
            # second harvested crop in the same season (e.g. rice then wheat; soybean then safrinha corn):
            # planted at its own calendar window, at the first occurrence after the first crop was planted.
            # An overlap with the first crop's harvest is resolved below like any other back-to-back crops.
            wd = cal["crops"].get(d_id) or {}
            p2, h2 = kb.window_mid(wd.get("plant")), kb.window_mid(wd.get("harvest"))
            if p2 is None or h2 is None:
                issues.append(f"No planting/harvest dates for {C[d_id]['name']} (second crop) in {region}")
                return [], n_years, issues
            st2 = (start // DAYS) * DAYS + p2
            if st2 <= start:
                st2 += DAYS
            en2 = st2 + ((h2 - p2) % DAYS or DAYS)
            double_idx.add(len(cash_spans))
            cash_spans.append((k, st2, en2, d_id))
    # resolve overlaps (e.g. winter wheat after a late harvest)
    for i in range(1, len(cash_spans)):
        k, st, en, cid = cash_spans[i]
        pk, pst, pen, pcid = cash_spans[i - 1]
        if st <= pen + 1:
            w = cal["crops"].get(cid) or {}
            plant_end = kb.doy((w.get("plant") or {}).get("end"))
            new_st = pen + 2
            latest = (st // DAYS) * DAYS + plant_end if plant_end is not None else None
            if latest is not None and latest < st:
                latest += DAYS
            if latest is None or new_st > latest:
                issues.append(f"{C[pcid]['name']} is usually harvested too late to plant {C[cid]['name']} on time")
                return [], n_years, issues
            cash_spans[i] = (k, new_st, en, cid)
    # emit cash events (merge consecutive perennial years into one stand with dormant winters)
    for i, (k, st, en, cid) in enumerate(cash_spans):
        c = C[cid]
        if c["season"] == "perennial":
            L_ev = en - st
            kc = np.full(L_ev, c["kc"]["mid"] if c.get("kc") else 0.95)
            can = np.full(L_ev, 0.9)
            ramp = min(45, L_ev)
            prev_same = i > 0 and cash_spans[i - 1][3] == cid
            if not prev_same:  # establishment year
                kc[:ramp] = np.linspace(c["kc"]["ini"] if c.get("kc") else 0.4, kc[0], ramp)
                can[:ramp] = np.linspace(0.05, 0.9, ramp)
            events.append(Event(cid, "forage", st, en, True, (kc, can), c["name"]))
            nxt = cash_spans[i + 1] if i + 1 < len(cash_spans) else None
            if nxt and nxt[3] == cid:  # dormant winter between stand years
                gap = nxt[1] - en
                events.append(Event(cid, "dormant", en, nxt[1], False, (np.full(gap, 0.4), np.full(gap, 0.6)),
                                    c["name"] + " (dormant)"))
            continue
        events.append(Event(cid, "cash", st, en, True, None, c["name"]))
    # covers in the gap after each cash crop
    for i, (k, st, en, cid) in enumerate(cash_spans[:-1]):
        cov = sequence[k % L].get("cover")
        if not cov:
            continue
        if sequence[k % L].get("double") and i not in double_idx:
            continue  # with a double crop, the cover follows the second crop
        nxt_start = cash_spans[i + 1][1]
        cc = C[cov]
        seed = en + 3
        if cov in WINTERKILL:
            kill = clim.kill_doy.get(cc.get("frost_kill_c")) if cc.get("frost_kill_c") is not None else clim.first_frost_doy
            if kill is None:
                issues.append(f"{cc['name']} may not winter-kill here (no killing frost in most years)")
                end = nxt_start - COVER_TERMINATE_BEFORE
            else:
                end = (en // DAYS) * DAYS + kill
                if end <= en:
                    end += DAYS
            if end - seed < 30:
                issues.append(f"Too little time between {C[cid]['name']} harvest and frost to grow {cc['name']}")
                return [], n_years, issues
        else:
            end = nxt_start - COVER_TERMINATE_BEFORE
        if end - seed < 30:
            issues.append(f"Gap after {C[cid]['name']} is too short for {cc['name']}")
            return [], n_years, issues
        kc, can = _cover_profile(cov, seed, end, clim)
        events.append(Event(cov, "cover", seed, end, False, (kc, can), cc["name"]))
    events.sort(key=lambda e: e.start)
    return events, n_years, issues


def timeline(sequence, region, clim, reps: int | None = None) -> tuple[Timeline | None, list[str]]:
    events, n_years, issues = build_events(sequence, region, clim, reps)
    if not events:
        return None, issues
    return build_timeline(events, kb.crops(), n_years), issues


def name_of(seq: list[dict]) -> str:
    C = kb.crops()
    parts = []
    for s in seq:
        n = C[s["cash"]]["name"].split(" (")[0]
        if s.get("double"):
            n = f"{n} then {C[s['double']]['name'].split(' (')[0].lower()}"
        parts.append(n)
    covers = sorted({C[s["cover"]]["name"].split(" (")[0].lower() for s in seq if s.get("cover")})
    if len(set(parts)) == 1 and seq[0].get("double"):
        base = f"{parts[0]}, every year"
    elif len(set(parts)) == 1:
        base = f"Continuous {parts[0].lower()}"
    else:
        base = "–".join(_dedupe_runs(parts))
    return base + (f" + {', '.join(covers)}" if covers else "")


def _dedupe_runs(parts: list[str]) -> list[str]:
    out = []
    for p in parts:
        if out and out[-1].startswith(p):
            n = out[-1].split(" ×")
            k = int(n[1]) if len(n) > 1 else 1
            out[-1] = f"{p} ×{k + 1}"
        else:
            out.append(p)
    return out


def generate(baseline: list[dict], region: str, county_crops: list[str], farm: dict) -> list[dict]:
    """Candidate rotations per family. Every candidate later passes rules + simulation."""
    C = kb.crops()
    cal = kb.calendars()[region]
    cash_ok = [c for c in cal["crops"] if c in C and C[c].get("simulable")]
    covers = [c for c in cal["covers"] if c in C]
    base_ids = [s["cash"] for s in baseline]
    crop_ids = [c for c in base_ids if c != "fallow"] or base_ids
    cands: list[dict] = []

    def canon(seq):
        t = [(s["cash"], s.get("cover") or "", s.get("double") or "") for s in seq]  # "" not None: tuples must compare
        return min(tuple(t[i:] + t[:i]) for i in range(len(t)))  # rotations are cyclic

    base_double = {s.get("double") for s in baseline if s.get("double")}
    D = next(iter(base_double)) if len(base_double) == 1 else None

    def keep_double(seq):
        """Double-crop systems: a candidate keeps the baseline's second crop after each summer crop."""
        if not D:
            return seq
        out = []
        for s in seq:
            s = dict(s)
            if "double" not in s and s["cash"] not in (D, "fallow") and C[s["cash"]]["season"] == "summer":
                s["double"] = D
            out.append(s)
        return out

    def add(fam, seq, note):
        seq = keep_double(seq)
        key = canon(seq)
        if any(canon(c["sequence"]) == key for c in cands) or key == canon(baseline):
            return
        cands.append({"family": fam, "sequence": [dict(s) for s in seq], "note": note})

    def with_covers(seq, pick):
        out = []
        for i, s in enumerate(seq):
            nxt = seq[(i + 1) % len(seq)]["cash"]
            cov = pick(s["cash"], nxt)
            out.append({**s, "cash": s["cash"], "cover": cov})
        return out

    winter_hardy = [c for c in covers if c not in WINTERKILL]
    legume_cov = [c for c in covers if C[c].get("n_fixing")]
    # 1 Fill the gap
    if "cereal_rye" in covers:
        add("fill_the_gap", with_covers(baseline, lambda a, b: "cereal_rye"), "Cereal rye after every harvest")
        add("fill_the_gap", with_covers(baseline, lambda a, b: "cereal_rye" if b != "corn" else
                                        ("oats_winterkill" if "oats_winterkill" in covers else None)),
            "Rye before soybean; winter-killed oats before corn")
    for lc in legume_cov:
        add("fill_the_gap", with_covers(baseline, lambda a, b, lc=lc: lc if b == "corn" else
                                        ("cereal_rye" if "cereal_rye" in covers else None)),
            f"{C[lc]['name']} before corn")
    # 2 Extend & diversify: add a small grain (and a cover after it)
    small = [c for c in ("winter_wheat", "oats", "barley", "spring_wheat", "field_pea") if c in cash_ok]
    core = _core_rotation(baseline, cash_ok)
    for sg in small[:2]:
        seq = core + [{"cash": sg, "cover": None}]
        add("extend_and_diversify", seq, f"Add {C[sg]['name'].lower()} as a third crop")
        if winter_hardy:
            seq2 = [dict(s) for s in seq]
            seq2[-1]["cover"] = legume_cov[0] if legume_cov else winter_hardy[0]
            add("extend_and_diversify", seq2, f"Add {C[sg]['name'].lower()} with a cover after it")
    # 3 Water-wise swap
    thirsty = max(sorted(set(crop_ids)), key=lambda c: (C[c].get("water_need_mm") or [0, 0])[-1] or 0)
    # flex fallow: where the rotation has fallow, try a cover or short crop in that year (water-wise / fill the gap)
    if "fallow" in base_ids:
        for alt in [c for c in ("field_pea", "proso_millet", "sorghum", "sunflower") if c in cash_ok][:2]:
            seq = [{"cash": alt if s["cash"] == "fallow" else s["cash"], "cover": None} for s in baseline]
            add("water_wise_swap" if "drought_tolerant" in (C[alt].get("roles") or []) else "fill_the_gap", seq,
                f"Replace the fallow year with {C[alt]['name'].lower()}")
    for alt in [c for c in cash_ok if "drought_tolerant" in (C[c].get("roles") or []) and C[c]["season"] != "perennial"] + \
               [c for c in cash_ok if c != thirsty and (C[c].get("water_need_mm") or [9e9])[-1] <
                (C[thirsty].get("water_need_mm") or [0])[-1] and C[c]["season"] == "summer"]:
        seq = [{"cash": alt if s["cash"] == thirsty and i % 2 == 0 else s["cash"], "cover": None}
               for i, s in enumerate(baseline)]
        if [s["cash"] for s in seq] != base_ids:
            add("water_wise_swap", seq, f"Swap some {C[thirsty]['name'].lower()} years for {C[alt]['name'].lower()}")
        if len([c for c in cands if c["family"] == "water_wise_swap"]) >= 2:
            break
    # 4 Integrate forage (perennial legume hay)
    if "alfalfa" in cash_ok:
        nurse = "oats" if "oats" in cash_ok else (small[0] if small else None)
        seq = core + ([{"cash": nurse, "cover": None}] if nurse else []) + [{"cash": "alfalfa", "cover": None}] * 2
        add("integrate_forage", seq, "Add two years of alfalfa hay")
    # 5 Market-driven add: a crop grown in this county but not in the rotation
    for c in county_crops:
        if c in cash_ok and c not in base_ids and C[c]["season"] != "perennial":
            seq = core + [{"cash": c, "cover": None}]
            add("market_driven_add", seq, f"Add {C[c]['name'].lower()} (grown nearby)")
            if len([x for x in cands if x["family"] == "market_driven_add"]) >= 2:
                break
    # 6 Pest-cycle break: no same family back to back
    fams = [C[c]["family"] for c in base_ids]
    if any(fams[i] == fams[i - 1] for i in range(len(fams))) or len(set(base_ids)) == 1:
        alts = [c for c in cash_ok if C[c]["family"] != C[base_ids[0]]["family"] and C[c]["season"] == "summer"]
        if alts:
            seq = [{"cash": base_ids[0], "cover": None}, {"cash": alts[0], "cover": None}]
            add("pest_cycle_break", seq, f"Alternate {C[base_ids[0]]['name'].lower()} with {C[alts[0]]['name'].lower()}")
            if "cereal_rye" in covers:
                add("pest_cycle_break", with_covers(seq, lambda a, b: "cereal_rye" if b != "corn" else None),
                    "Alternate crops, rye before the legume")
    # 7 Double-crop systems (two harvests a year): change the second crop, or cover the soil after it
    if D:
        first = [s["cash"] for s in baseline]
        for alt in [c for c in cash_ok if c != D and c not in first and _can_follow(c, first, cal)]:
            add("extend_and_diversify", [{**s, "double": alt} for s in baseline],
                f"Grow {C[alt]['name'].lower()} instead of {C[D]['name'].lower()} as the second crop")
        before_d = set((cal["crops"].get(D) or {}).get("double_after") or [])
        for alt in [c for c in cash_ok if c in before_d and c not in first and C[c]["season"] == "summer"]:
            add("extend_and_diversify", [{**s, "cash": alt} for s in baseline],
                f"Grow {C[alt]['name'].lower()} instead of {C[first[0]]['name'].lower()} before the {C[D]['name'].lower()}")
        for cov in covers:
            add("fill_the_gap", [{**s, "cover": cov} for s in baseline], f"{C[cov]['name']} after the second crop")
    return cands


def _can_follow(cid: str, first: list[str], cal: dict) -> bool:
    """A crop is a second-crop option if the region calendar marks it so (double_after)."""
    w = cal["crops"].get(cid) or {}
    return bool(set(w.get("double_after") or []) & set(first))


def _core_rotation(baseline: list[dict], cash_ok: list[str]) -> list[dict]:
    """The rotation's main crops in alternating order (e.g. corn–soybean), used as the base for extensions."""
    ids = []
    for s in baseline:
        if s["cash"] not in ids:
            ids.append(s["cash"])
    if len(ids) == 1:
        partner = "soybean" if ids[0] != "soybean" and "soybean" in cash_ok else None
        if partner:
            ids.append(partner)
    return [{"cash": c, "cover": None} for c in ids]
