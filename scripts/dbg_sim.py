import json, numpy as np, pandas as pd
from fieldshift.engine import analysis, strategies, climate, kb
from fieldshift.engine.sim import weather_stack, SiteInputs, simulate, DAYS
f = json.load(open('data/cache/test_field.geojson'))
ctx = analysis.build_context(f['geometry'])
print({k: round(v,1) for k,v in ctx["climate"]["normals"].items()})
wx = pd.read_parquet(ctx['_wx_path'])
clim = strategies.clim_from(wx)
seq=[{"cash":"corn","cover":None},{"cash":"soybean","cover":None}]
tl, iss = strategies.timeline(seq, "iowa_central", clim)
for e in tl.events: print(e.crop_id, e.kind, e.start, e.end, e.active_days)
et0 = climate.et0_pm(wx, ctx['centroid'][1], 300)
W, starts = weather_stack(wx, et0, tl.days//DAYS, climate.full_years(wx))
soil=ctx['soil']['properties']; print("taw", soil['aws100_cm']*10)
site = SiteInputs(W, starts, soil['aws100_cm']*10, 0.03, 0.26, 2800, None, 100)
sim = simulate(tl, site, kb.crops(), {c:1.0 for c in kb.crops()})
for e in sim['events']:
    if e['kind']=='cash': print(e['crop_id'], 'ETa', np.median(e['eta_mm']).round(), 'ETc', np.median(e['etc_mm']).round(), 'rel', np.median(e['rel_yield']).round(2), 'frost', (e['frost_hits']>0).mean().round(2), 'heat', np.median(e['heat_days']))
