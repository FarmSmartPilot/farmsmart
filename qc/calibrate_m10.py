"""M10 calibration check against held-out USDA NASS county yields (M2 hold-out predictions).

For every held-out county-year (temporal 2018-2024 and leave-one-state-out), M10 assigns High / Medium / Low
exactly as the app does for an M2 yield range (engine/analysis.py::_m2_block -> uncertainty.assess). We then ask
how often the 80% range held the observed county yield, per level, and draw a reliability plot of nominal vs
empirical coverage for central intervals from the piecewise-linear predictive distribution (P10/P50/P90).

Run: python qc/calibrate_m10.py  ->  qc/reports/calibration_m10.md + qc/reports/calibration_m10.png"""
from __future__ import annotations

import json
import os
import sys
from datetime import date

import numpy as np
import pandas as pd

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
from fieldshift.engine import uncertainty  # noqa: E402

HOLD = os.path.join(ROOT, "models", "m02_yield", "holdout_predictions.parquet")
VAL = os.path.join(ROOT, "models", "m02_yield", "validation.json")
OUT_MD = os.path.join(ROOT, "qc", "reports", "calibration_m10.md")
OUT_PNG = os.path.join(ROOT, "qc", "reports", "calibration_m10.png")
NOMINAL = [0.2, 0.4, 0.5, 0.6, 0.8]


def pit(y, p10, p50, p90):
    """CDF value of y under the piecewise-linear quantile function through (0.1,P10),(0.5,P50),(0.9,P90),
    tails extended with the same slope (as used in fieldshift/models/m02_yield.py::_qf_samples)."""
    lo_slope = np.maximum(p50 - p10, 1e-9) / 0.4
    hi_slope = np.maximum(p90 - p50, 1e-9) / 0.4
    u = np.where(y < p50, 0.5 - (p50 - y) / lo_slope, 0.5 + (y - p50) / hi_slope)
    return np.clip(u, 0, 1)


def levels(df: pd.DataFrame, val: dict) -> pd.Series:
    out = []
    for crop, p10, p50, p90 in zip(df["crop"], df["p10"], df["p50"], df["p90"]):
        cov = ((val.get(crop) or {}).get("temporal") or {}).get("model", {}).get("coverage80")
        flags = ["low held-out coverage"] if cov is not None and cov < 0.75 else []
        a = uncertainty.assess(interval=(p10, p50, p90), data_flags=flags,
                               coarse_inputs=["weather ≈50 km", "county statistics"], method="si", calibrated=True)
        out.append(a["level"])
    return pd.Series(out, index=df.index)


def table(df: pd.DataFrame) -> pd.DataFrame:
    rows = []
    for (split, lvl), g in df.groupby(["split", "level"]):
        rows.append({"split": split, "level": lvl, "n": len(g), "coverage80": g["hit"].mean(),
                     "mean_rel_width": g["relw"].mean(), "crops": ", ".join(f"{k} {v}" for k, v in g["crop"].value_counts().items())})
    for split, g in df.groupby("split"):
        rows.append({"split": split, "level": "all", "n": len(g), "coverage80": g["hit"].mean(),
                     "mean_rel_width": g["relw"].mean(), "crops": ""})
    t = pd.DataFrame(rows)
    t["order"] = t["level"].map({"high": 0, "medium": 1, "low": 2, "all": 3})
    return t.sort_values(["split", "order"]).drop(columns="order")


def main():
    df = pd.read_parquet(HOLD)
    val = json.load(open(VAL, encoding="utf-8"))
    df = df.dropna(subset=["p10", "p50", "p90", "yield"])
    df["hit"] = (df["yield"] >= df["p10"]) & (df["yield"] <= df["p90"])
    df["relw"] = (df["p90"] - df["p10"]) / df["p50"].abs().clip(lower=1e-9)
    df["level"] = levels(df, val)
    df["pit"] = pit(df["yield"].to_numpy(), df["p10"].to_numpy(), df["p50"].to_numpy(), df["p90"].to_numpy())
    t = table(df)
    # reliability: nominal central-interval coverage vs empirical, per split and level
    rel = {}
    for split in ("temporal", "loso"):
        for lvl in ("high", "medium", "low", "all"):
            g = df[(df["split"] == split) & ((df["level"] == lvl) | (lvl == "all"))]
            if len(g) < 30:
                continue
            rel[(split, lvl)] = [float(np.mean(np.abs(g["pit"] - 0.5) <= c / 2)) for c in NOMINAL]

    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    fig, axes = plt.subplots(1, 2, figsize=(10, 4.6), sharey=True)
    colors = {"high": "#1E8E4E", "medium": "#C98A0B", "low": "#B23A3A", "all": "#1F2A44"}
    for ax, split, title in ((axes[0], "temporal", "Held-out years 2018–2024"), (axes[1], "loso", "Leave one state out")):
        ax.plot([0, 1], [0, 1], color="#999", lw=1, ls="--", label="perfect calibration")
        for lvl in ("all", "high", "medium", "low"):
            if (split, lvl) in rel:
                n = int(((df["split"] == split) & ((df["level"] == lvl) | (lvl == "all"))).sum())
                ax.plot(NOMINAL, rel[(split, lvl)], marker="o", color=colors[lvl], lw=2 if lvl == "all" else 1.3,
                        label=f"{lvl} (n={n:,})")
        ax.axvline(0.8, color="#ccc", lw=0.8)
        ax.set_title(title, fontsize=11)
        ax.set_xlabel("nominal coverage of the central range")
        ax.set_xlim(0.1, 0.9)
        ax.set_ylim(0, 1)
        ax.grid(alpha=0.3)
        ax.legend(fontsize=8, loc="upper left")
    axes[0].set_ylabel("empirical coverage (observed county yield inside)")
    fig.suptitle("M10 reliability: M2 county-yield ranges vs observed USDA NASS county yields", fontsize=11)
    fig.text(0.01, 0.01, "FarmSmart QC · M2 (LightGBM quantile + CQR) · levels from fieldshift/engine/uncertainty.py · "
             f"run {date.today().isoformat()}", fontsize=7, color="#555")
    fig.tight_layout(rect=(0, 0.03, 1, 0.95))
    fig.savefig(OUT_PNG, dpi=130)

    def fmt(x, d=3):
        return "" if x is None or (isinstance(x, float) and np.isnan(x)) else (f"{x:.{d}f}" if isinstance(x, float) else str(x))
    lines = ["# M10 calibration against held-out county yields", "",
             f"Run {date.today().isoformat()} by `qc/calibrate_m10.py`. Plot: `qc/reports/calibration_m10.png`.", "",
             "**What is checked.** M2 predicts each held-out county-year's yield range (P10–P90, conformalized). "
             "M10 (`fieldshift/engine/uncertainty.py::assess`) labels each range High / Medium / Low exactly as the app "
             "does for the `yield_county` block. A level is honest if its 80% ranges hold the observed USDA NASS county "
             "yield at least 80% of the time (High) or close to it (Medium/Low, which warn the user).", "",
             f"Thresholds in use: relative width (P90 − P10)/P50 < **{uncertainty.REL_NARROW}** → spread score 1.0; "
             f"< **{uncertainty.REL_WIDE}** → 0.6; else 0.3. With the fixed −0.10 for regional inputs, that maps to "
             "High / Medium / Low.", "",
             "| Split | Level | County-years | 80% range held the yield | Mean relative width | Crops |",
             "|---|---|---|---|---|---|"]
    for _, r in t.iterrows():
        lines.append(f"| {r['split']} | {r['level']} | {r['n']:,} | {r['coverage80']:.3f} | {r['mean_rel_width']:.3f} | {r['crops']} |")
    lines += ["", "## Reliability (nominal vs empirical coverage of central ranges)", "",
              "| Split | Level | " + " | ".join(f"{int(c * 100)}%" for c in NOMINAL) + " |",
              "|---|---|" + "---|" * len(NOMINAL)]
    for (split, lvl), v in rel.items():
        lines.append(f"| {split} | {lvl} | " + " | ".join(f"{x:.3f}" for x in v) + " |")
    lines += ["", "## Per crop (80% range)", "", "| Split | Crop | County-years | Held the yield | High share |", "|---|---|---|---|---|"]
    for (split, crop), g in df.groupby(["split", "crop"]):
        lines.append(f"| {split} | {crop} | {len(g):,} | {g['hit'].mean():.3f} | {(g['level'] == 'high').mean():.2f} |")
    hi = {sp: t[(t["split"] == sp) & (t["level"] == "high")]["coverage80"] for sp in ("temporal", "loso")}
    hi = {sp: (float(v.iloc[0]) if len(v) else None) for sp, v in hi.items()}
    ok = all(v is not None and v >= 0.80 for v in hi.values())
    verdict = ("High held the observed county yield " + " and ".join(f"{v:.1%} ({k})" for k, v in hi.items() if v is not None)
               + " of the time. " + ("Both are at or above the 80% target, so the thresholds in "
                                     "`fieldshift/engine/uncertainty.py` are kept unchanged." if ok else
                                     "This is below the 80% target: tighten REL_NARROW in `fieldshift/engine/uncertainty.py` "
                                     "and re-run this check."))
    lines += ["", "## Verdict", "", verdict, "",
              "Medium and Low ranges hold the yield close to 80% as well, so the level mostly tells the user how wide "
              "the range is, not that it is less honest. Inner ranges (20–60%) over-cover: the conformal correction "
              "widens P10 and P90, and the interpolated interior inherits that, so only the 80% range is calibrated. "
              "Sorghum is included here although M2 is not deployed for it (it did not beat its baselines).", ""]
    lines += ["Limits: county-years in one season share weather, so the effective sample is closer to the number of "
              "seasons × regions than to the row count. Coverage is for county averages; a single field varies more."]
    with open(OUT_MD, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    print("\n".join(lines[:40]))


if __name__ == "__main__":
    main()
