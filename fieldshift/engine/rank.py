"""M9 ranking: hard filters -> non-dominated (Pareto) set -> TOPSIS with farmer weights -> rank stability.

Indicators are oriented so that higher = better before scoring. Raw indicators are always returned beside the score."""
from __future__ import annotations

import numpy as np

# indicator -> (direction, label). +1 higher is better, -1 lower is better.
INDICATORS = {
    "soil_cover": (+1, "Days with soil covered"),
    "erosion_water": (-1, "Water erosion (RUSLE)"),
    "wind_exposure": (-1, "Wind exposure on bare soil"),
    "water_use": (-1, "Crop water use"),
    "dry_year_regret": (-1, "Dry-year yield loss"),
    "soc_trend": (+1, "Soil carbon trend"),
    "n_balance": (+1, "Nitrogen balance"),
    "pest_break": (+1, "Pest-cycle break"),
    "profit_p50": (+1, "Typical net return"),
    "profit_p10": (+1, "Bad-year net return"),
    "workload": (-1, "Workload"),
    "diversity": (+1, "Crop diversity"),
}

# farmer priority chips -> indicator weights
PRIORITY_MAP = {
    "soil_cover": {"soil_cover": 0.6, "wind_exposure": 0.4},
    "erosion": {"erosion_water": 0.6, "wind_exposure": 0.4},
    "water": {"water_use": 0.5, "dry_year_regret": 0.5},
    "profit": {"profit_p50": 0.6, "profit_p10": 0.4},
    "soil_health": {"soc_trend": 0.6, "n_balance": 0.4},
    "pests": {"pest_break": 0.7, "diversity": 0.3},
    "workload": {"workload": 1.0},
}
RANK_WEIGHTS = [0.35, 0.25, 0.18, 0.12, 0.06, 0.04, 0.02]  # rank-order centroid-like weights for chips 1..7


def weights_from_priorities(priorities: list[str]) -> dict[str, float]:
    w: dict[str, float] = {}
    for i, p in enumerate(priorities):
        rw = RANK_WEIGHTS[i] if i < len(RANK_WEIGHTS) else 0.01
        for ind, share in PRIORITY_MAP.get(p, {}).items():
            w[ind] = w.get(ind, 0) + rw * share
    tot = sum(w.values()) or 1
    return {k: v / tot for k, v in w.items()}


def _matrix(cands: list[dict], keys: list[str]) -> np.ndarray:
    M = np.array([[c["ind"].get(k, np.nan) for k in keys] for c in cands], float)
    for j, k in enumerate(keys):
        col = M[:, j]
        if np.all(np.isnan(col)):
            M[:, j] = 0
        else:
            col[np.isnan(col)] = np.nanmedian(col)
        M[:, j] *= INDICATORS[k][0]
    return M


def pareto_mask(M: np.ndarray) -> np.ndarray:
    n = len(M)
    keep = np.ones(n, bool)
    for i in range(n):
        if not keep[i]:
            continue
        dom = np.all(M >= M[i], axis=1) & np.any(M > M[i], axis=1)
        if dom.any():
            keep[i] = False
    return keep


def topsis(M: np.ndarray, w: np.ndarray) -> np.ndarray:
    span = M.max(0) - M.min(0)
    span[span == 0] = 1
    N = (M - M.min(0)) / span
    V = N * w
    best, worst = V.max(0), V.min(0)
    dp = np.sqrt(((V - best) ** 2).sum(1))
    dn = np.sqrt(((V - worst) ** 2).sum(1))
    return dn / np.maximum(dp + dn, 1e-12)


def rank(cands: list[dict], priorities: list[str], seed: int = 7, n_perturb: int = 300) -> dict:
    """cands: [{id, family, is_baseline, ind: {...}, ind_samples: {k: array}}]. Returns scores, ranks, pareto,
    stability and the 'what changes the choice' explanation."""
    # only indicators every candidate has (never impute a missing value into a comparison)
    keys = [k for k in INDICATORS if all(c["ind"].get(k) is not None and not np.isnan(c["ind"][k]) for c in cands)]
    dropped = [k for k in INDICATORS if any(k in c["ind"] for c in cands) and k not in keys]
    wmap = weights_from_priorities(priorities)
    w = np.array([wmap.get(k, 0.0) for k in keys])
    if w.sum() == 0:
        w = np.ones(len(keys))
    w = w / w.sum()
    M = _matrix(cands, keys)
    par = pareto_mask(M)
    score = topsis(M, w)
    order = np.argsort(-score)

    # stability: perturb weights (Dirichlet around w) and indicators (resample from simulated samples)
    rng = np.random.default_rng(seed)
    wins = np.zeros(len(cands))
    top_counts = {}
    for _ in range(n_perturb):
        wp = rng.dirichlet(w * 40 + 0.5)
        Mp = M.copy()
        for j, k in enumerate(keys):
            for i, c in enumerate(cands):
                s = c.get("ind_samples", {}).get(k)
                if s is not None and len(s):
                    Mp[i, j] = INDICATORS[k][0] * float(s[rng.integers(len(s))])
        sp = topsis(Mp, wp)
        top = int(np.argmax(sp))
        wins[top] += 1
    win_share = wins / n_perturb
    top_id = int(order[0])
    stable = win_share[top_id] >= 0.6
    runner = int(order[1]) if len(order) > 1 else None

    # what changes the choice: for each indicator, the weight increase that makes the runner-up win
    flips = []
    if runner is not None:
        for j, k in enumerate(keys):
            for bump in (0.1, 0.2, 0.35, 0.5):
                wb = w.copy()
                wb[j] += bump
                wb /= wb.sum()
                if np.argmax(topsis(M, wb)) == runner:
                    flips.append({"indicator": k, "label": INDICATORS[k][1], "extra_weight": bump})
                    break

    contrib = {}
    span = M.max(0) - M.min(0)
    span[span == 0] = 1
    N = (M - M.min(0)) / span
    for i, c in enumerate(cands):
        contrib[c["id"]] = sorted(({"indicator": k, "label": INDICATORS[k][1], "weight": float(w[j]),
                                    "normalized": float(N[i, j])} for j, k in enumerate(keys)),
                                   key=lambda x: -x["weight"] * x["normalized"])
    return {
        "keys": keys, "dropped_indicators": dropped, "weights": {k: float(w[j]) for j, k in enumerate(keys)},
        "scores": {c["id"]: float(score[i]) for i, c in enumerate(cands)},
        "rank": {cands[i]["id"]: r + 1 for r, i in enumerate(order)},
        "pareto": {c["id"]: bool(par[i]) for i, c in enumerate(cands)},
        "win_share": {c["id"]: float(win_share[i]) for i, c in enumerate(cands)},
        "top": cands[top_id]["id"], "runner_up": cands[runner]["id"] if runner is not None else None,
        "stable": bool(stable), "flips": flips, "contributions": contrib,
    }


def select_cards(cands: list[dict], ranking: dict, n_alt: int = 2) -> list[str]:
    """Baseline always + best-ranked alternatives from different families (diversity rule)."""
    base = [c["id"] for c in cands if c["is_baseline"]]
    picked, fams = [], set()
    for cid, _ in sorted(ranking["rank"].items(), key=lambda kv: kv[1]):
        c = next(x for x in cands if x["id"] == cid)
        if c["is_baseline"] or c["family"] in fams:
            continue
        if not ranking["pareto"].get(cid, False) and len(picked) < n_alt and any(
                ranking["pareto"].get(x["id"]) and not x["is_baseline"] and x["family"] not in fams for x in cands):
            continue
        picked.append(cid)
        fams.add(c["family"])
        if len(picked) >= n_alt:
            break
    if len(picked) < n_alt:  # still prefer a new family, Pareto or not
        for cid, _ in sorted(ranking["rank"].items(), key=lambda kv: kv[1]):
            c = next(x for x in cands if x["id"] == cid)
            if cid not in picked and not c["is_baseline"] and c["family"] not in fams:
                picked.append(cid)
                fams.add(c["family"])
                if len(picked) >= n_alt:
                    break
    if len(picked) < n_alt:  # only then fill from any family
        for cid, _ in sorted(ranking["rank"].items(), key=lambda kv: kv[1]):
            if cid not in picked and cid not in base:
                picked.append(cid)
                if len(picked) >= n_alt:
                    break
    return base + picked
