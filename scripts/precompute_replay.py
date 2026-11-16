"""Precompute Drought Replay (default alternative) for pilot fields and replay years, so the demo is instant."""
import json
import sys

import pandas as pd

from fieldshift.config import PRECOMP
from fieldshift.engine import analysis, replay

pil = json.load(open(PRECOMP / "pilots.json", encoding="utf-8"))["pilots"]
for p in pil:
    fid = p["field_id"]
    cp = PRECOMP / f"compare_{fid}.json"
    if not cp.exists():
        continue
    cmp = json.loads(cp.read_text(encoding="utf-8"))
    if not cmp.get("supported"):
        continue
    ctx = json.loads((PRECOMP / f"context_{fid}.json").read_text(encoding="utf-8"))
    wx = pd.read_parquet(PRECOMP / f"wx_{fid}.parquet")
    for y in (2012, 2017, 2023):
        r = replay.replay(ctx, wx, cmp["all_cards"], y, None)
        r = analysis._jsonable(r)
        (PRECOMP / f"replay_{fid}_{y}.json").write_text(json.dumps(r), encoding="utf-8")
        print(p["key"], y, r.get("available"), (r.get("current") or {}).get("yield", {}).get("pct_of_typical"))
