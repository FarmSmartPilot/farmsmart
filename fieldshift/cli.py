"""FarmSmart command line. python -m fieldshift.cli --help"""
from __future__ import annotations

import argparse
import json
import shutil
import time
from pathlib import Path

from .config import PRECOMP
from .contracts import ALL_CONTRACTS

# Pilot fields: real field boundaries picked by point (USDA Crop Sequence Boundaries in the US).
PILOTS = [
    {"key": "iowa_story", "label": "Story County, Iowa", "lat": 42.11119, "lon": -93.46928,
     "note": "Rainfed corn–soybean; bare soil and spring rain erosion"},
    {"key": "iowa_story_cc", "label": "Story County, Iowa (continuous corn)", "lat": 42.10, "lon": -93.39,
     "note": "Mostly continuous corn"},
    {"key": "kansas_finney", "label": "Garden City, Kansas (dryland)", "lat": 37.92785, "lon": -100.69216,
     "note": "Wheat–sorghum–fallow; water and wind"},
    {"key": "kansas_finney_irr", "label": "Garden City, Kansas (irrigated corn)", "lat": 38.05123, "lon": -100.86125,
     "note": "Irrigated continuous corn; groundwater", "farm": {"water": "irrigated"}},
    {"key": "california_sjv", "label": "San Joaquin Valley, California", "lat": 36.7964, "lon": -120.37344,
     "note": "Irrigated cotton–wheat with fallow; heat, ET and groundwater", "farm": {"water": "irrigated"}},
    # Outside the US: field boundaries from Fields of The World (FTW 2025, CC BY 4.0). Points chosen inside FTW polygons.
    # Saskatchewan: AAFC Annual Crop Inventory 2015-2025 at this field reads spring wheat, lentil, canola in a 3-year cycle.
    {"key": "saskatchewan_regina", "label": "Near Regina, Saskatchewan", "lat": 50.42102, "lon": -104.95137,
     "country_code": "ca", "note": "Canola–spring wheat–lentil (AAFC crop maps); short season, dry springs, wind"},
    # Punjab and Mato Grosso: no field crop-history service, so the documented typical regional system is the baseline.
    {"key": "punjab_ludhiana", "label": "Near Ludhiana, Punjab (India)", "lat": 30.79011, "lon": 75.70142,
     "country_code": "in", "note": "Rice–wheat double crop; groundwater decline, residue burning",
     "farm": {"water": "irrigated"},
     "baseline": {"sequence": [{"cash": "rice", "cover": None, "double": "winter_wheat"}],
                  "label": "typical regional rotation (enter your own)",
                  "source": "Punjab Agricultural University, Package of Practices for Crops of Punjab, Kharif 2026 "
                            "(rice section, recommended rotations: Rice-Wheat) and Rabi 2025-26",
                  "note": "Rice transplanted June-July, wheat sown in November after the rice harvest. Assumed irrigated "
                          "(canal/tubewell), as Punjab rice-wheat is; change it if your field is rainfed."}},
    {"key": "mato_grosso_sorriso", "label": "Near Sorriso, Mato Grosso (Brazil)", "lat": -12.50098, "lon": -55.95973,
     "country_code": "br", "note": "Soybean then safrinha (second-crop) corn; rainy-season timing, heat",
     "baseline": {"sequence": [{"cash": "soybean", "cover": None, "double": "corn"}],
                  "label": "typical regional rotation (enter your own)",
                  "source": "Conab, Acompanhamento da Safra Brasileira de Graos 2025/26 n.5 (soybean and second-crop corn "
                            "calendars, Norte Mato-grossense)",
                  "note": "Soybean sown September-October; second-crop corn sown January-February right after the soybean harvest."}},
]


def export_contracts():
    out = PRECOMP.parent.parent / "contracts"
    out.mkdir(exist_ok=True)
    for m in ALL_CONTRACTS:
        (out / f"{m.__name__}.schema.json").write_text(json.dumps(m.model_json_schema(), indent=2), encoding="utf-8")
    print(f"wrote {len(ALL_CONTRACTS)} schemas to {out}")


def precompute(keys: list[str] | None = None):
    from .engine import analysis
    from .ingest import fields
    pilots_out = []
    for p in PILOTS:
        if keys and p["key"] not in keys:
            continue
        t0 = time.time()
        if p.get("country_code", "us") == "us":
            feat = fields.at_point(p["lat"], p["lon"])
            meta = fields.meta_of(feat) if feat else None
        else:
            feat = fields.ftw_at(p["lat"], p["lon"])
            meta = fields.ftw_meta(feat, p["country_code"]) if feat else None
        if not feat:
            print(f"[{p['key']}] no field boundary at point; skipped")
            continue
        ctx = analysis.build_context(feat["geometry"], p["label"], meta)
        fid = ctx["id"]
        dst = PRECOMP / f"wx_{fid}.parquet"
        if Path(ctx["_wx_path"]).resolve() != dst.resolve():
            shutil.copy(ctx["_wx_path"], dst)
        ctx_pre = {**ctx, "_wx_path": str(PRECOMP / f"wx_{fid}.parquet"), "default_farm": p.get("farm") or {}}
        if p.get("baseline"):
            ctx_pre["default_baseline"] = p["baseline"]
        if meta and meta.get("source") == "ftw":
            ctx_pre["boundary"] = {"source": "ftw", "attribution": meta.get("attribution"), "licence": meta.get("licence"),
                                   "confidence_mean": meta.get("ftw_confidence_mean")}
        (PRECOMP / f"context_{fid}.json").write_text(json.dumps(ctx_pre), encoding="utf-8")
        cmp = analysis.compare(ctx_pre)
        (PRECOMP / f"compare_{fid}.json").write_text(json.dumps(cmp), encoding="utf-8")
        from .models import m03_sequence
        hsrc = (ctx.get("crop_history") or {}).get("source", "cdl")
        codes = [h["dominant"]["code"] for h in ((ctx.get("crop_history") or {}).get("years") or []) if h.get("available")]
        if hsrc != "cdl" or not codes:
            m3 = {"available": False, "reason": "The next-crop model (M3) is trained on USDA CDL sequences; "
                                                "it does not apply to this field's crop history"}
        else:
            try:
                m3 = m03_sequence.run(p["lat"], p["lon"], codes[-8:])
            except Exception as e:  # noqa: BLE001
                m3 = {"available": False, "reason": str(e)[:200]}
        (PRECOMP / f"m3_{fid}.json").write_text(json.dumps(m3), encoding="utf-8")
        pilots_out.append({**p, "field_id": fid, "feature": feat, "meta": meta, "name": ctx["name"],
                           "supported": cmp.get("supported"), "area_ha": ctx["area_ha"]})
        print(f"[{p['key']}] {fid} {ctx['name']} cards={len(cmp.get('cards', []))} {time.time() - t0:.1f}s")
    old = {}
    pj = PRECOMP / "pilots.json"
    if pj.exists():
        old = {x["key"]: x for x in json.loads(pj.read_text(encoding="utf-8")).get("pilots", [])}
    for x in pilots_out:
        old[x["key"]] = x
    pj.write_text(json.dumps({"pilots": list(old.values())}), encoding="utf-8")


def main():
    ap = argparse.ArgumentParser(prog="fieldshift", description="FarmSmart tools")
    sub = ap.add_subparsers(dest="cmd")
    sub.add_parser("export-contracts", help="write contracts/*.schema.json from fieldshift/contracts.py")
    pc = sub.add_parser("precompute", help="build pilot caches in data/precomputed")
    pc.add_argument("keys", nargs="*")
    sub.add_parser("alerts-run", help="evaluate alert subscriptions once")
    a = ap.parse_args()
    if a.cmd == "export-contracts":
        export_contracts()
    elif a.cmd == "precompute":
        precompute(a.keys or None)
    elif a.cmd == "alerts-run":
        from .alerts import core
        print(json.dumps(core.run_once(), indent=1, default=str))
    else:
        ap.print_help()


if __name__ == "__main__":
    main()
