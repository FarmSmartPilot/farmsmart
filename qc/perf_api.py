"""API performance probe (checker). Writes qc/reports/perf_api.json.

New-field analysis: tries Iowa points (first 42.05,-93.30) until it finds a field the API has not cached,
then POSTs /api/fields and polls the job. Also times the cached report + compare and a compare re-run.
"""
import json, os, time, urllib.request

API = os.environ.get("FS_API", "http://127.0.0.1:8000")
OUT = os.path.join(os.path.dirname(__file__), "reports", "perf_api.json")


def req(method, path, body=None, timeout=300):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(API + path, data=data, method=method, headers={"content-type": "application/json"})
    t = time.perf_counter()
    with urllib.request.urlopen(r, timeout=timeout) as resp:
        out = json.loads(resp.read() or b"null")
    return out, time.perf_counter() - t


res = {}
PILOT = "b96d39c7a833"
_, res["report_cached_s"] = req("GET", f"/api/fields/{PILOT}/report")
_, res["compare_cached_s"] = req("POST", f"/api/fields/{PILOT}/compare", {"scenario": "normal"})
_, res["compare_rerun_new_priorities_s"] = req("POST", f"/api/fields/{PILOT}/compare",
                                               {"scenario": "normal", "priorities": ["profit", "water", "erosion", "soil_cover", "soil_health", "pests", "workload"]})
_, res["compare_rerun_dry_scenario_s"] = req("POST", f"/api/fields/{PILOT}/compare", {"scenario": "dry"})
_, res["compare_rerun_custom_slider_s"] = req("POST", f"/api/fields/{PILOT}/compare", {"scenario": "custom:rain=-17,temp=1.3"})

pts = [(42.05, -93.30), (42.03, -93.36), (41.98, -93.42), (42.16, -93.55), (42.20, -93.25), (41.94, -93.58), (42.22, -93.62)]
for lat, lon in pts:
    at, t_at = req("GET", f"/api/fields/at?lat={lat}&lon={lon}")
    if not at.get("found"):
        continue
    t0 = time.perf_counter()
    j, _ = req("POST", "/api/fields", {"geometry": at["feature"]["geometry"], "name": f"QC perf {lat},{lon}", "meta": at.get("meta")})
    if j.get("status") == "done":
        res.setdefault("skipped_cached_points", []).append([lat, lon])
        continue
    steps = []
    while True:
        s, _ = req("GET", f"/api/jobs/{j['job_id']}")
        steps.append((round(time.perf_counter() - t0, 1), s.get("status"), s.get("step")))
        if s.get("status") in ("done", "error", "failed"):
            break
        if time.perf_counter() - t0 > 300:
            break
        time.sleep(0.5)
    t_ctx = time.perf_counter() - t0
    fid = s.get("field_id") or j["field_id"]
    _, t_cmp = req("POST", f"/api/fields/{fid}/compare", {"scenario": "normal"})
    _, t_cmp2 = req("POST", f"/api/fields/{fid}/compare", {"scenario": "normal"})
    res["new_field"] = {"lat": lat, "lon": lon, "field_id": fid, "fields_at_s": t_at, "context_job_s": t_ctx,
                        "status": s.get("status"), "failures": s.get("failures"), "first_compare_s": t_cmp,
                        "total_to_cards_s": t_at + t_ctx + t_cmp, "second_compare_s": t_cmp2,
                        "job_trace": [x for i, x in enumerate(steps) if i == 0 or x[2] != steps[i - 1][2]]}
    break

os.makedirs(os.path.dirname(OUT), exist_ok=True)
json.dump(res, open(OUT, "w"), indent=2)
print(json.dumps(res, indent=2))
