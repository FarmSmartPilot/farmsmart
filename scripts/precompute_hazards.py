"""Precompute the money calculator's hazard record and building blocks for the pilot fields.

1. USDA RMA Cause of Loss + Summary of Business files (last 20 commodity years), aggregated to data/cache/rma/
   (downloads ≈ 160 MB once, keeps ≈ 7 MB; the zips are deleted after parsing).
2. Per US pilot county: the county RMA table and the OpenFEMA declarations (data/cache/rma/county/, data/cache/fema/).
3. POST /money default blocks for every pilot (data/cache/money/), so the endpoint answers from disk.

Run: python scripts/precompute_hazards.py [--only-us]
"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from fieldshift import config  # noqa: E402
from fieldshift.api import routes_money  # noqa: E402
from fieldshift.ingest import losses  # noqa: E402

US_PILOTS = ["b96d39c7a833", "fbeaa0ba7fe7", "b20f28194396", "dd12f9cae7ba", "6a41e1befbd9"]


def _ctx(fid: str) -> dict:
    ctx = json.loads((config.PRECOMP / f"context_{fid}.json").read_text(encoding="utf-8"))
    if ctx.get("_wx_path") and not Path(ctx["_wx_path"]).exists():
        ctx["_wx_path"] = str(config.PRECOMP / f"wx_{fid}.parquet")
    return ctx


def main() -> None:
    only_us = "--only-us" in sys.argv
    t0 = time.time()
    meta = losses.build_rma(log=lambda *a: print("  RMA", *a, flush=True))
    bad = {k: v for k, v in meta["status"].items() if not v.startswith(("ok", "cached"))}
    print(f"RMA files: {len(meta['status'])} ({len(bad)} failed{': ' + json.dumps(bad) if bad else ''})")
    # committed per-county summaries (read before data/cache, so a deploy needs no network at build time)
    counties = {}
    for fid in US_PILOTS:
        c = _ctx(fid)
        if c.get("county_fips"):
            counties[str(c["county_fips"]).zfill(5)] = (c.get("place") or {}).get("county")
    for fips, name in counties.items():
        p = losses.write_precomputed(fips, name)
        print(f"{p.relative_to(ROOT).as_posix()}: {p.stat().st_size / 1024:.1f} KB ({name})")
    pilots = US_PILOTS if only_us else US_PILOTS + [p.stem.split("_", 1)[1] for p in sorted(config.PRECOMP.glob("context_*.json"))
                                                    if p.stem.split("_", 1)[1] not in US_PILOTS]
    for fid in pilots:
        t = time.time()
        ctx = _ctx(fid)
        p = config.CACHE / "money" / f"{routes_money.money_key(fid, {})}.json"
        if p.exists():
            p.unlink()  # rebuild
        out = routes_money.compute(fid, {}, ctx)
        hz = out.get("hazards") or {}
        w, il, de = hz.get("weather") or {}, hz.get("insured_losses") or {}, hz.get("declarations") or {}
        print(f"{fid} {ctx['name']}: {time.time() - t:.1f}s  options={len(out.get('options') or [])} "
              f"S={len(out.get('weather_years') or [])} costs={out.get('costs_available')}")
        if w.get("available"):
            print("   weather: " + "; ".join(f"{x['id']} {x['years_hit']}/{x['years']}" for x in w["items"]))
        print("   RMA: " + ("; ".join(f"{x['crop']}/{x['cause_id']} {x['years_hit']}/{x['years']} "
                                     f"${x['avg_loss_usd_ac_when_hit']}/ac" for x in il.get("rows", []) if not x["in_simulation"])
                            if il.get("available") else il.get("reason", "")))
        print("   FEMA: " + (", ".join(f"{x['type']} {x['count']}" for x in de.get("by_type", []))
                             if de.get("available") else de.get("reason", "")))
    print(f"done in {time.time() - t0:.0f}s")


if __name__ == "__main__":
    main()
