"""One-off clean-up of precomputed nasa_*.json: NaN -> null; clamp SMAP week_ending to the record end."""
import json
from fieldshift.config import PRECOMP
from fieldshift.engine.analysis import _jsonable
for p in PRECOMP.glob("nasa_*.json"):
    d = json.loads(p.read_text(encoding="utf-8"))  # Python accepts bare NaN
    smap = d.get("smap") or {}
    end = (smap.get("record") or [None, None])[1]
    for w in smap.get("last_12_months_weekly") or []:
        if end and w.get("week_ending", "") > end:
            w["week_ending"], w["partial_week"] = end, True
    p.write_text(json.dumps(_jsonable(d), allow_nan=False), encoding="utf-8")
    print("cleaned", p.name)
