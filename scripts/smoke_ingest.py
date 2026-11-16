import time, json, sys
t0=time.time()
def tick(msg): print(f"[{time.time()-t0:6.1f}s] {msg}", flush=True)
from fieldshift.ingest import power, ssurgo, cdl, terrain, modis, fields
feats = fields.in_bbox(-93.42, 42.08, -93.36, 42.12, limit=200)
tick(f"csb fields {len(feats)}")
f = max((x for x in feats if x['properties']['cdl2024'] in (1,5)), key=lambda x: x['properties']['csbacres'])
p = f['properties']; geom = f['geometry']; tick(f"field {p['csbid']} {p['csbacres']} ac seq {[p[f'cdl{y}'] for y in range(2017,2025)]}")
json.dump(f, open('data/cache/test_field.geojson','w'))
from shapely.geometry import shape
c = shape(geom).centroid; lat, lon = c.y, c.x
df = power.daily(lat, lon); tick(f"power {df.shape} {df.index.min().date()}..{df.index.max().date()} elev {df.attrs.get('elevation_m')}")
print(df.dropna().tail(1).T.round(2).to_dict())
s = ssurgo.query(geom); tick("ssurgo " + json.dumps(s)[:600])
h = cdl.history(geom, range(2008, 2026)); tick("cdl " + str([(x['year'], x.get('dominant',{}).get('name'), round(x.get('dominant',{}).get('share',0),2)) for x in h]))
tr = terrain.analyse(geom); tick("terrain " + str({k:round(v,3) for k,v in tr.items() if k!='zones'}) + f" zones {len(tr['zones'])}")
cs = cdl.county_stats("19169", 2023); tick("county " + str([(x['name'], int(x['acres'])) for x in cs[:6]]))
n = modis.ndvi(lat, lon, 2012); tick(f"ndvi 2012 n={len(n)} max={n.ndvi.max()}")
