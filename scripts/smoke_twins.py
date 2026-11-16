"""Smoke test for M7 Climate Twins on the two pilot points.

  PYTHONPATH=. python scripts/smoke_twins.py            # fast sampling (new-point budget), prints a summary
  PYTHONPATH=. python scripts/smoke_twins.py --full     # full sampling and writes data/precomputed/twins_<name>.json
"""
import sys
import time

from fieldshift.engine import twins

PILOTS = {"story_ia": (42.10, -93.39), "garden_city_ks": (37.97, -100.87)}


def show(name, out):
    b = out["baseline"]["indicators"]
    print(f"\n=== {name}  runtime {out['runtime_s']} s  files {out['sampling']['n_files']}  NEX cell {out['sampling']['nex_cell']}")
    print(f"baseline 1991-2020: {b}")
    sm = out["present_day_self_match"]
    print(f"self-match: {sm['near_town']}, {sm['admin1']} {sm['country']} {sm['km_from_field']} km, d={sm['distance']}")
    for s, so in out["scenarios"].items():
        if not so.get("available"):
            print(s, "unavailable", so.get("reason"))
            continue
        ind = so["indicators"]
        print(f"-- {s}: n_models={so['n_models']}  dTmax {so['deltas']['annual_d_tmax_c']}  Pratio {so['deltas']['annual_pr_ratio']}")
        for k in ("tmean_c", "tmax_warm_c", "precip_mm", "gdd10", "hot_days_ge35", "frost_free_days"):
            print(f"   {k:16s} {ind[k]}")
        for a in so["analogs"]:
            crops = ", ".join(f"{c['crop']} {c['share']:.0%}" for c in (a["crops"]["top"] or [])[:3])
            print(f"   analog {a['near_town']}, {a['admin1']}, {a['country']} ({a['lat']},{a['lon']}) {a['km_from_field']} km "
                  f"d={a['distance']} agree {a['n_models_agree']}/{so['n_models']}  crops[{crops}]")
        ag = so["agreement"]
        print(f"   agreement {ag['n_agree']}/{ag['n_models']} near {ag['cluster_centre']}; novel {so['novel_climate']}")
        for m, pm in so["per_model"].items():
            t = pm["top_analog"]
            print(f"     {m:14s} dTx {pm['annual_d_tmax_c']:+.2f} Pr x{pm['annual_pr_ratio']:.2f} -> {t['near_town']}, {t['admin1']} ({t['distance']})")
    print("confidence:", out["confidence"]["level"])
    for r in out["confidence"]["reasons"]:
        print("  -", r)
    if out["sampling"]["problems"]:
        print("problems:", out["sampling"]["problems"][:5])


if __name__ == "__main__":
    full = "--full" in sys.argv
    for name, (lat, lon) in PILOTS.items():
        t0 = time.time()
        out = twins.precompute(name, lat, lon, mode="full") if full else twins.climate_twins(lat, lon, mode="fast")
        show(name, out)
        print(f"wall {time.time() - t0:.1f} s")
