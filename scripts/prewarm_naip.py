"""Pre-fill the NAIP tile cache (data/cache/naip) around the US pilot fields, so the Demo flight and the
field map show sharp imagery at once instead of waiting 6-40 s per tile on the USGS exportImage service.

Tiles are the standard Web Mercator XYZ grid that both Cesium (WebMercatorTilingScheme) and MapLibre
({bbox-epsg-3857}) request; the cache key matches /api/tiles/naip (bbox rounded to 0.1 m, size 512).

    conda run -n fieldshift python scripts/prewarm_naip.py [--levels 12-18] [--margin-km 1.5] [--workers 2] [--dry]
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from fieldshift import config  # noqa: E402

R = 20037508.342789244
SERVICE = "https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPImagery/ImageServer/exportImage"
CACHE = config.CACHE / "naip"


def xy(lat: float, lon: float, z: int) -> tuple[int, int]:
    n = 2 ** z
    x = (lon + 180.0) / 360.0 * n
    y = (1.0 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2.0 * n
    return int(x), int(y)


def tile_bbox(x: int, y: int, z: int) -> list[float]:
    w = 2 * R / 2 ** z
    return [-R + x * w, R - (y + 1) * w, -R + (x + 1) * w, R - y * w]


def key_of(parts: list[float], size: int = 512) -> str:
    return hashlib.sha1(f"{[round(float(v), 1) for v in parts]}{size}".encode()).hexdigest()


def tiles_for(lat: float, lon: float, levels: range, margin_km: float):
    dlat = margin_km / 111.0
    dlon = margin_km / (111.0 * math.cos(math.radians(lat)))
    for z in levels:
        x0, y0 = xy(lat + dlat, lon - dlon, z)
        x1, y1 = xy(lat - dlat, lon + dlon, z)
        for x in range(x0, x1 + 1):
            for y in range(y0, y1 + 1):
                yield z, x, y


def fetch(parts: list[float]) -> str:
    rounded = [round(float(v), 1) for v in parts]
    p = CACHE / f"{key_of(parts)}.img"
    if p.exists():
        return "hit"
    try:
        r = requests.get(SERVICE, params={"bbox": ",".join(map(str, rounded)), "bboxSR": 3857, "imageSR": 3857,
                                          "size": "512,512", "format": "jpgpng", "f": "image"},
                         timeout=90, headers={"User-Agent": config.USER_AGENT})
        if r.status_code == 200 and r.headers.get("content-type", "").startswith("image"):
            p.write_bytes(r.content)
            return "fetched"
        return f"http {r.status_code}"
    except Exception as e:  # noqa: BLE001
        return f"error {type(e).__name__}"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--levels", default="12-18")
    ap.add_argument("--margin-km", type=float, default=1.5)
    ap.add_argument("--pilots", default="iowa_story,kansas_finney,kansas_finney_irr,california_sjv")
    ap.add_argument("--dry", action="store_true", help="only count tiles and cache hits")
    ap.add_argument("--workers", type=int, default=2, help="parallel requests (USGS refuses bursts above ~4)")
    a = ap.parse_args()
    lo, hi = (int(v) for v in a.levels.split("-"))
    CACHE.mkdir(parents=True, exist_ok=True)
    pilots = json.loads((config.PRECOMP / "pilots.json").read_text(encoding="utf-8"))["pilots"]
    want = set(a.pilots.split(","))
    jobs: dict[str, list[float]] = {}
    for p in pilots:
        if p["key"] not in want:
            continue
        for z, x, y in tiles_for(p["lat"], p["lon"], range(lo, hi + 1), a.margin_km):
            # tighter ring at the sharpest levels: they are only seen right over the field
            if z >= 17 and not near(p, z, x, y, 0.6):
                continue
            parts = tile_bbox(x, y, z)
            jobs[key_of(parts)] = parts
    hits = sum((CACHE / f"{k}.img").exists() for k in jobs)
    print(f"{len(jobs)} tiles, {hits} already cached", flush=True)
    if a.dry:
        return
    todo = [v for k, v in jobs.items() if not (CACHE / f"{k}.img").exists()]
    done = errors = 0
    with ThreadPoolExecutor(a.workers) as ex:
        for res in ex.map(fetch, todo):
            done += 1
            errors = errors + 1 if res.startswith(("error", "http")) else 0
            if errors:
                time.sleep(min(30, 2 * errors))  # back off while the service refuses
            if errors >= 20:
                print(f"stopping: {errors} failures in a row ({res}); run again later", flush=True)
                ex.shutdown(cancel_futures=True)
                break
            if done % 25 == 0 or done == len(todo):
                print(f"{done}/{len(todo)} ({res})", flush=True)


def near(p: dict, z: int, x: int, y: int, km: float) -> bool:
    cx, cy = xy(p["lat"], p["lon"], z)
    tile_km = 40075.0 * math.cos(math.radians(p["lat"])) / 2 ** z
    return abs(x - cx) * tile_km <= km + tile_km and abs(y - cy) * tile_km <= km + tile_km


if __name__ == "__main__":
    main()
