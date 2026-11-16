import json, time, sys
t0=time.time()
from fieldshift.engine import analysis
f = json.load(open('data/cache/test_field.geojson'))
p = f['properties']
meta = {"statefips": str(p['statefips']).zfill(2), "county_fips": str(p['statefips']).zfill(2)+str(p['cnty']).zfill(3), "country_code":"us"}
ctx = analysis.build_context(f['geometry'], meta=meta)
print("ctx", round(time.time()-t0,1), ctx['name'], ctx['region'], ctx['errors'], [ (c['layer'], c['status']) for c in ctx['coverage']])
t1=time.time()
out = analysis.compare(ctx)
print("compare", round(time.time()-t1,1), out.get('supported'), out.get('reason'))
if out.get('supported'):
    print("baseline", out['baseline_detection'])
    print("fits", [x['crop_id'] for x in out['what_fits']['feasible']], [(x['crop_id'], x['reasons'][0]['reason'][:60]) for x in out['what_fits']['excluded']])
    print("considered", out['candidates_considered'], "simulated", out['candidates_simulated'])
    for e in out['excluded_candidates']: print("  X", e['name'], '|', e['reason'][:90])
    for c in out['all_cards']:
        i=c['indicators']
        print(f"{'*' if c['shown'] else ' '} #{c['rank']} {c['family']:22s} {c['rotation_label'][:48]:48s} match {c['match']:3d} cover {i['soil_cover']['p50']:.0f}d eros {i['erosion_water']['p50']:.2f} wind {i['wind_exposure']['p50']:.0f} water {i['water_use']['p50']:.0f} yidx {i['yield_index']['p50']} soc {i['soc_trend']['p50']} conf {c['confidence']['level']} bw {c['timeline']['bare_windy_overlap_weeks']:.1f}")
    best=[c for c in out['cards'] if c['shown']]
    print(json.dumps({k: best[1][k] for k in ('why','benefits','tradeoffs_risks','information_gaps','check_locally','try_it_small')}, indent=1)[:2500])
    print("stable", out['ranking']['stable'], out['ranking']['flips'][:3])
