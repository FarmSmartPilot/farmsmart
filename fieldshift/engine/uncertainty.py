"""M10 uncertainty engine: High/Medium/Low + plain-language reasons for every output.

Combines (1) data confidence (coverage, resolution mismatch, QA), (2) model spread (P10-P90 width relative to P50),
(3) applicability (is this place/crop inside what the method was built or calibrated for), (4) scenario spread.
Thresholds are checked against held-out county yields by qc/calibrate_m10.py (qc/reports/calibration_m10.md):
"High" M2 ranges held the observed county yield 89% (held-out years) and 85% (held-out states) of the time."""
from __future__ import annotations

import numpy as np

LEVELS = ["low", "medium", "high"]
# Relative width (P90 - P10) / |P50| cut points for the spread component. Checked against held-out county
# yields in qc/calibrate_m10.py (report: qc/reports/calibration_m10.md).
REL_NARROW = 0.35
REL_WIDE = 0.8


def rel_width(p10: float, p50: float, p90: float) -> float:
    return (p90 - p10) / max(abs(p50), 1e-9)


def _spread_from_rel(rel: float, what: str = "weather years") -> tuple[float, str | None]:
    if rel < REL_NARROW:
        return 1.0, None
    if rel < REL_WIDE:
        return 0.6, f"results vary a lot between {what}"
    return 0.3, f"results swing widely between {what}"


def spread_score(samples: np.ndarray | None) -> tuple[float, str | None]:
    if samples is None:
        return 0.0, "no simulated range"
    s = np.asarray(samples, float)
    s = s[~np.isnan(s)]
    if len(s) < 8:
        return 0.0, f"only {len(s)} weather years simulated"
    p10, p50, p90 = np.percentile(s, [10, 50, 90])
    return _spread_from_rel(rel_width(p10, p50, p90))


def assess(*, samples: np.ndarray | None = None, data_flags: list[str] | None = None,
           coarse_inputs: list[str] | None = None, applicability_ok: bool = True,
           applicability_note: str | None = None, method: str = "process", calibrated: bool = False,
           interval: tuple[float, float, float] | None = None) -> dict:
    """`interval` = (P10, P50, P90) of a trained model's (conformalized) range; used instead of `samples`."""
    reasons: list[str] = []
    score = 1.0
    sp, why = _spread_from_rel(rel_width(*interval), "years") if interval is not None else spread_score(samples)
    score = min(score, 0.4 + 0.6 * sp)
    if why:
        reasons.append(why)
    for f in data_flags or []:
        score -= 0.15
        reasons.append(f)
    if coarse_inputs:
        score -= 0.1
        reasons.append("uses regional values (" + ", ".join(coarse_inputs) + "), not field measurements")
    if not applicability_ok:
        score -= 0.35
        reasons.append(applicability_note or "outside the conditions this method was built for")
    if method == "rules":
        reasons.append("based on rules and published ranges, not a trained model")
    if not calibrated and method != "rules":
        score -= 0.05
    level = "high" if score >= 0.8 else "medium" if score >= 0.5 else "low"
    if not reasons:
        reasons.append("complete inputs and a narrow range across weather years")
    return {"level": level, "score": round(float(score), 2), "reasons": reasons}


def quantiles(samples) -> dict:
    s = np.asarray(samples, float)
    s = s[~np.isnan(s)]
    if len(s) == 0:
        return {"p10": None, "p50": None, "p90": None, "n": 0}
    p10, p50, p90 = np.percentile(s, [10, 50, 90])
    return {"p10": float(p10), "p50": float(p50), "p90": float(p90), "n": int(len(s)), "mean": float(s.mean())}
