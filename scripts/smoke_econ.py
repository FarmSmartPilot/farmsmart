"""Smoke test for M8 economics inputs: Iowa corn and soybean economics + price ensembles."""
import json
import time

from fieldshift.ingest import econ

t0 = time.time()
reg = econ.region_for("19")
print(f"Iowa (19) -> {reg}; Kansas (20) -> {econ.region_for('20')}; California (06) -> {econ.region_for('06')} "
      f"{econ.region_detail('06')['shares']}")
for crop in ("corn", "soybean"):
    e = econ.crop_economics(crop, reg)
    print(f"\n== {crop} / {e['region']} (ERS {e['evidence']['years']}) units: {e['units']['yield']}, {e['units']['price']}")
    for k in ("yield", "price", "gross_value", "operating_cost", "overhead", "net_return_operating", "net_return_total"):
        d5, d10 = e["last5"][k], e["last10"][k]
        print(f"  {k:22s} last5 p50={d5['p50']:>8} [{d5['min']}..{d5['max']}]  last10 p10/p50/p90="
              f"{d10['p10']}/{d10['p50']}/{d10['p90']}  by year {dict(zip(d5['years'], d5['values']))}")
    print("  notes:", e["notes"])
print("\nspring_wheat in Fruitful Rim ->", econ.crop_economics("spring_wheat", "Fruitful Rim")["notes"])
print("canola ->", econ.crop_economics("canola", reg))

for crop in ("corn", "soybean", "winter_wheat", "sorghum"):
    p = econ.price_ensemble(crop)
    if p.get("value", 1) is None:
        print(f"\nprice {crop}: None - {p['reason']}")
        continue
    print(f"\nprice {crop} [{p['series_label']}, {p['units']}] last {p['last_observation']} = {p['last_price']}")
    print(f"  target: {p['target']}")
    print(f"  P10/P50/P90 = {p['p10']} / {p['p50']} / {p['p90']}  per {list(k for k in p if k.startswith('per_'))}:"
          f" {next((p[k] for k in p if k.startswith('per_')), None)}")
    print(f"  members {p['members']}")
    print(f"  backtest {json.dumps(p['backtest']['mape_pct'])} MAE={p['backtest']['mae']} "
          f"coverage80={p['backtest']['coverage_p10_p90']} origins={p['backtest']['test_origins']}  runtime {p['runtime_s']} s")
print(f"\ntotal {time.time() - t0:.1f} s")
