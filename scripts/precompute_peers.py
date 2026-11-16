"""Precompute "what cropland around you did" (GET /api/fields/{fid}/peers) for the pilot fields.

Reads USDA CDL (US) / AAFC ACI (Canada) rasters in a 10 km box around each pilot field and writes
data/precomputed/peers_{fid}.json (committed demo fallback) and data/cache/peers/{fid}.json.

Usage: python scripts/precompute_peers.py [field_id ...]   (default: every US and Canada pilot in pilots.json)
"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fieldshift import config  # noqa: E402
from fieldshift.ingest import peers  # noqa: E402


def _ctx(fid: str) -> dict | None:
    for p in (config.PRECOMP / f"context_{fid}.json", config.CACHE / "fields" / f"{fid}.json"):
        if p.exists():
            return json.loads(p.read_text(encoding="utf-8"))
    return None


def main(argv: list[str]) -> int:
    if argv:
        fids = argv
    else:
        pl = json.loads((config.PRECOMP / "pilots.json").read_text(encoding="utf-8"))["pilots"]
        fids = [p["field_id"] for p in pl if p.get("field_id")]
    bad = 0
    for fid in fids:
        ctx = _ctx(fid)
        if ctx is None:
            print(f"{fid}: no field context (analyse the field first)")
            bad += 1
            continue
        if peers.country_of(ctx) not in peers.SCHEMES:
            print(f"{fid}: skipped ({(ctx.get('place') or {}).get('country')}: not covered)")
            continue
        t = time.time()
        out = peers.get(fid, ctx, refresh=True)
        if not out.get("available"):
            print(f"{fid}: NOT available: {out.get('reason')}")
            bad += 1
            continue
        (config.PRECOMP / f"peers_{fid}.json").write_text(json.dumps(out, ensure_ascii=False), encoding="utf-8")
        top = max(out["rotation_types"], key=lambda r: r["share"]) if out["rotation_types"] else {}
        print(f"{fid}: {out['source_short'] if 'source_short' in out else out['source']} {out['years'][0]}-"
              f"{out['years'][-1]}, {len(out['transitions'])} transitions, top type {top.get('id')} "
              f"{top.get('share', 0):.0%}, this field {out['this_field_type']} ({time.time() - t:.1f} s)")
    return 1 if bad else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
