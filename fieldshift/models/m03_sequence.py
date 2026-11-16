"""M3 rotation-sequence model: 'what usually comes next' from real field crop sequences.

Data: USDA NASS Crop Sequence Boundaries 2024 edition (CDL codes 2017-2024 per field) for all fields in a
~0.4° x 0.4° window around the target field. Model: 1st- and 2nd-order Markov transitions with add-one smoothing,
backing off to 1st order when a 2nd-order context is rare. Validation: train on 2017-2023 transitions, predict 2024
(top-1 / top-3 accuracy) and compare with a 'same as last year' and a 'most common crop' baseline."""
from __future__ import annotations

from collections import Counter, defaultdict

from ..ingest import fields
from ..ingest.cdl import CDL_NAMES, CDL_TO_CROP

YEARS = list(range(2017, 2025))
MIN_CTX2 = 20


def _sequences(lat: float, lon: float, half: float = 0.2) -> list[list[int]]:
    seqs = []
    step = half  # 4 tiles of half x half to stay under the 2000-record page limit
    for dy in (-half, 0):
        for dx in (-half, 0):
            feats = fields.in_bbox(lon + dx, lat + dy, lon + dx + step, lat + dy + step)
            for f in feats:
                p = f["properties"]
                s = [int(p.get(f"cdl{y}") or 0) for y in YEARS]
                if sum(1 for c in s if c in CDL_TO_CROP) >= 6:
                    seqs.append(s)
    return seqs


def fit(seqs: list[list[int]], last_year_index: int):
    t1: dict[int, Counter] = defaultdict(Counter)
    t2: dict[tuple, Counter] = defaultdict(Counter)
    marg = Counter()
    for s in seqs:
        for i in range(1, last_year_index + 1):
            t1[s[i - 1]][s[i]] += 1
            marg[s[i]] += 1
            if i >= 2:
                t2[(s[i - 2], s[i - 1])][s[i]] += 1
    return t1, t2, marg


def predict(t1, t2, marg, prev2: int | None, prev1: int, k: int = 5) -> list[tuple[int, float, str]]:
    ctx2 = t2.get((prev2, prev1)) if prev2 is not None else None
    if ctx2 and sum(ctx2.values()) >= MIN_CTX2:
        c, order = ctx2, "2nd-order"
    elif t1.get(prev1):
        c, order = t1[prev1], "1st-order"
    else:
        c, order = marg, "marginal"
    tot = sum(c.values())
    return [(code, n / tot, order) for code, n in c.most_common(k)]


def run(lat: float, lon: float, history_codes: list[int]) -> dict:
    seqs = _sequences(lat, lon)
    if len(seqs) < 50:
        return {"available": False, "reason": f"only {len(seqs)} mapped field sequences nearby"}
    # validation: train on transitions up to 2023, predict 2024
    t1, t2, marg = fit(seqs, len(YEARS) - 2)
    top1 = top3 = same = common = 0
    most_common = marg.most_common(1)[0][0]
    for s in seqs:
        pred = predict(t1, t2, marg, s[-3], s[-2], 3)
        codes = [p[0] for p in pred]
        top1 += codes[0] == s[-1]
        top3 += s[-1] in codes
        same += s[-2] == s[-1]
        common += most_common == s[-1]
    n = len(seqs)
    # refit on all years for the live prediction
    t1, t2, marg = fit(seqs, len(YEARS) - 1)
    h = [c for c in history_codes if c]
    preds = predict(t1, t2, marg, h[-2] if len(h) >= 2 else None, h[-1], 5) if h else []
    # rotation type of the area
    pat = Counter()
    for s in seqs:
        cs = [CDL_TO_CROP.get(c) for c in s[-4:]]
        pat["–".join(sorted(set(x for x in cs if x)))] += 1
    return {
        "available": True, "model_id": "M3", "model_name": "Rotation sequence (Markov)", "kind": "si",
        "n_fields": n, "window_deg": 0.4,
        "next": [{"code": c, "name": CDL_NAMES.get(c, str(c)), "crop_id": CDL_TO_CROP.get(c), "probability": round(p, 3),
                  "order": o} for c, p, o in preds],
        "validation": {"held_out_year": 2024, "n": n, "top1_accuracy": round(top1 / n, 3), "top3_accuracy": round(top3 / n, 3),
                       "baseline_same_as_last_year": round(same / n, 3), "baseline_most_common_crop": round(common / n, 3)},
        "area_rotation_mix": [{"crops": k, "share": round(v / n, 3)} for k, v in pat.most_common(6)],
        "evidence": {"source": "USDA NASS", "product": "Crop Sequence Boundaries 2024 (CDL 2017-2024)", "is_nasa": False,
                     "citation": "USDA NASS Crop Sequence Boundaries, https://www.nass.usda.gov/Research_and_Science/Crop-Sequence-Boundaries/"},
    }
