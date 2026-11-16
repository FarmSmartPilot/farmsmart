"""Precompute field-scale NASA observations for the pilots: HLS 30 m NDVI per scene (with the grid of the clearest
mid-season scene) and ECOSTRESS 70 m daytime ET at the field centre.

Writes data/precomputed/hls_<fid>.json and data/precomputed/ecostress_<fid>.json.
Run:  python scripts/precompute_fieldsat.py [field_id ...] [--fresh]
"""
from __future__ import annotations

import json
import shutil
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fieldshift import config  # noqa: E402
from fieldshift.api.routes_fieldsat import _centre, _lat  # noqa: E402
from fieldshift.ingest import ecostress as eco  # noqa: E402
from fieldshift.ingest import hls_ndvi as hls  # noqa: E402

BUDGET_S = 600
TRANSIENT = ("failed", "not read", "budget", "HTTP")


def _ctx(fid: str, pilot: dict) -> dict:
    for p in (config.PRECOMP / f"context_{fid}.json", config.CACHE / "fields" / f"{fid}.json"):
        if p.exists():
            return json.loads(p.read_text(encoding="utf-8"))
    return {"geometry": pilot["feature"]["geometry"], "centroid": [pilot["lon"], pilot["lat"]]}


def _write(path: Path, doc: dict) -> None:
    path.write_text(json.dumps(doc, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


def main(argv: list[str]) -> None:
    fresh = "--fresh" in argv
    only = [a for a in argv if not a.startswith("--")]
    pilots = json.loads((config.PRECOMP / "pilots.json").read_text(encoding="utf-8"))["pilots"]
    if only:
        pilots = [p for p in pilots if p["field_id"] in only]
    for p in pilots:
        fid = p["field_id"]
        ctx = _ctx(fid, p)
        lat = _lat(ctx)
        if fresh:
            shutil.rmtree(hls.FS_CACHE / f"hls_{fid}", ignore_errors=True)
            (eco.FS_CACHE / f"eco_{fid}.json").unlink(missing_ok=True)
        t0 = time.time()
        doc, grids = hls.field_hls(ctx["geometry"], lat, key=fid, budget_s=BUDGET_S)
        t_hls = round(time.time() - t0, 1)
        if doc.get("available") or not any(w in (doc.get("reason") or "") for w in TRANSIENT):
            gid = doc.get("grid_scene_id")
            if gid and gid in grids:
                doc["grid"] = grids[gid]
            doc["name"] = p.get("name")
            _write(config.PRECOMP / f"hls_{fid}.json", doc)
        s = doc.get("search", {})
        print(f"{fid} {p.get('name')}: HLS available={doc.get('available')} scenes={len(doc.get('scenes', []))} "
              f"withheld={s.get('n_withheld')} found={s.get('n_found')} errors={s.get('n_errors')} "
              f"grid={doc.get('grid_scene_id')} {t_hls}s reason={doc.get('reason')}", flush=True)

        lon, clat = _centre(ctx)
        start, end, _ = hls.season_period(clat)
        t0 = time.time()
        ed = eco.field_ecostress(lon, clat, start, end, key=fid, budget_s=BUDGET_S)
        t_eco = round(time.time() - t0, 1)
        if ed.get("available") or not any(w in (ed.get("reason") or "") for w in TRANSIENT):
            ed["name"] = p.get("name")
            _write(config.PRECOMP / f"ecostress_{fid}.json", ed)
        s = ed.get("search", {})
        print(f"{fid} {p.get('name')}: ECOSTRESS available={ed.get('available')} obs={len(ed.get('observations', []))} "
              f"overpasses={s.get('n_overpasses')} outside_hours={s.get('n_outside_solar_hours')} cloudy={s.get('n_cloudy')} "
              f"errors={s.get('n_errors')} {t_eco}s reason={ed.get('reason')}", flush=True)


if __name__ == "__main__":
    main(sys.argv[1:])
