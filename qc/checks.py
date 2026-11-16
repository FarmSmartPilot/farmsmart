"""FarmSmart honesty / data checks (checker agent).

Runs over data/precomputed/{compare,context,nasa,replay}_*.json plus UI strings and backend
card texts, and writes qc/reports/data_checks.md with pass / warn / fail per check.

    conda run -n fieldshift python qc/checks.py
"""
from __future__ import annotations

import glob
import json
import os
import re
import sys
from collections import defaultdict
from datetime import date, datetime, timezone

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
PRE = os.path.join(ROOT, "data", "precomputed")
OUT = os.path.join(ROOT, "qc", "reports", "data_checks.md")
TODAY = datetime.now(timezone.utc).date()

# Plausible ranges for card indicators (p10/p50/p90). Units per METHODS.md / engine/sim.py.
RANGES = {
    "soil_cover": (0, 365),            # days a year with cover >= 30 %
    "erosion_water": (0, 100),         # t/ha/yr (RUSLE)
    "wind_exposure": (0, 1e5),         # index (bare-soil wind-hours weighted), only non-negative
    "water_use": (0, 2000),            # mm/yr crop ET
    "dry_year_regret": (-100, 100),    # % yield-index points vs best option in dry years
    "soc_trend": (-3, 3),              # t C/ha/yr
    "n_balance": (-300, 400),          # kg N/ha/yr
    "pest_break": (0, 1),
    "workload": (0, 30),
    "diversity": (1, 12),
    "yield_index": (0, 200),           # % of site potential
    "bare_windy_days": (0, 365),
    "bare_heavy_rain_days": (0, 365),
    "deep_drainage": (0, 3000),        # mm/yr (irrigated rice can be high)
    "irrigation": (0, 3000),           # mm/yr
    "profit_p50": (-3000, 5000),       # $/ac or $/ha net return
    "profit_p10": (-3000, 5000),
}
SEVEN = ["why", "evidence", "benefits", "tradeoffs_risks", "information_gaps", "check_locally", "try_it_small"]
DATE_RE = re.compile(r"^(\d{4})-(\d{2})(?:-(\d{2}))?(?:T.*)?$")


REVIEW: list[str] = []


class Report:
    def __init__(self):
        self.rows: list[tuple[str, str, str, str]] = []  # (area, check, status, detail)

    def add(self, area, check, ok, detail="", warn=False):
        st = "PASS" if ok else ("WARN" if warn else "FAIL")
        self.rows.append((area, check, st, detail))


def load(p):
    with open(p, encoding="utf-8") as f:
        return json.load(f)


def walk(o, path=""):
    if isinstance(o, dict):
        for k, v in o.items():
            yield from walk(v, f"{path}.{k}" if path else k)
    elif isinstance(o, list):
        for i, v in enumerate(o):
            yield from walk(v, f"{path}[{i}]")
    else:
        yield path, o


def fid_of(p):
    b = os.path.basename(p)
    return b.split("_")[1].split(".")[0]


def to_date(s: str):
    m = DATE_RE.match(s)
    if not m:
        return None
    y, mo, d = int(m.group(1)), int(m.group(2)), int(m.group(3) or 1)
    try:
        return date(y, mo, d)
    except ValueError:
        return None


# --------------------------------------------------------------------------- data files
def check_compare(r: Report):
    for p in sorted(glob.glob(os.path.join(PRE, "compare_*.json"))):
        c = load(p)
        fid = fid_of(p)
        name = os.path.basename(p)
        ctx_p = os.path.join(PRE, f"context_{fid}.json")
        ctx = load(ctx_p) if os.path.exists(ctx_p) else {}
        cards = c.get("cards", [])
        allc = c.get("all_cards", cards)
        # ranges + quantile order
        bad_rng, bad_q = [], []
        for card in allc:
            for k, v in (card.get("indicators") or {}).items():
                if not isinstance(v, dict):
                    continue
                q = [v.get("p10"), v.get("p50"), v.get("p90")]
                if all(isinstance(x, (int, float)) for x in q):
                    if not (q[0] <= q[1] + 1e-9 <= q[2] + 2e-9):
                        bad_q.append(f"{card['id']}.{k} {q}")
                    lo, hi = RANGES.get(k, (-1e9, 1e9))
                    for x in q:
                        if not (lo <= x <= hi):
                            bad_rng.append(f"{card['id']}.{k}={x:.3g} not in [{lo},{hi}]")
                            break
        r.add(name, "indicator ranges", not bad_rng, "; ".join(bad_rng[:6]))
        r.add(name, "P10 ≤ P50 ≤ P90", not bad_q, "; ".join(bad_q[:6]))
        # negative regret is suspicious (regret should be >= 0 by definition)
        neg = [f"{cd['id']}={cd['indicators']['dry_year_regret']['p10']:.1f}" for cd in allc
               if isinstance(cd.get("indicators", {}).get("dry_year_regret"), dict)
               and (cd["indicators"]["dry_year_regret"].get("p10") or 0) < 0]
        if neg:
            r.add(name, "dry-year regret ≥ 0", False, "negative regret on " + ", ".join(neg[:5]) + " (definition check needed)", warn=True)
        if not c.get("supported"):
            r.add(name, "supported", True, f"unsupported: {c.get('reason')}")
            continue
        # seven elements
        miss = []
        for card in cards:
            for k in SEVEN:
                v = card.get(k)
                empty = v is None or v == [] or v == "" or (isinstance(v, dict) and not any(v.values()))
                if empty:
                    # baseline legitimately has no 'benefits vs itself'; UI shows a sentence instead
                    if k == "benefits" and card.get("is_baseline"):
                        continue
                    miss.append(f"{card['id']}.{k}")
        r.add(name, "every shown card has 7 non-empty elements", not miss,
              ("missing: " + ", ".join(miss)) if miss else f"{len(cards)} cards (baseline 'benefits' renders the 'yardstick' sentence)")
        base = [cd for cd in cards if cd.get("is_baseline")]
        r.add(name, "baseline present", len(base) == 1, f"{len(base)} baseline card(s)")
        alts = [cd for cd in cards if not cd.get("is_baseline")]
        bc = c.get("binding_constraint")
        if len(alts) >= 2:
            r.add(name, "≥ 2 alternatives", True, f"{len(alts)} alternatives")
        else:
            r.add(name, "≥ 2 alternatives", False,
                  f"only {len(alts)} alternative; binding constraint named: {bool(bc)} ({(bc or {}).get('constraint', '')})", warn=bool(bc))
        fams = {cd.get("family") for cd in alts}
        # brief: different families, OR fewer feasible -> the binding constraint must be named
        named = bool((c.get("binding_constraint") or {}).get("constraint"))
        r.add(name, "alternatives from different families (or binding constraint named)",
              len(fams) >= min(2, len(alts)) or named, ", ".join(sorted(map(str, fams))) + (" · binding constraint named" if named else ""))
        # evidence ids
        dangling = []
        for card in allc:
            srcs = card.get("sources") or {}
            for ev in card.get("evidence", []):
                for s in ev.get("sources", []):
                    if s not in srcs:
                        dangling.append(f"{card['id']}:{s}")
            for fl in card.get("flags", []):
                for s in fl.get("sources", []) or []:
                    if s not in srcs:
                        dangling.append(f"{card['id']}:flag:{s}")
        ctx_ev = set((ctx.get("evidence") or {}).keys())
        for path, v in walk(c):
            if path.endswith("evidence_id") and isinstance(v, str) and ctx_ev and v not in ctx_ev:
                dangling.append(f"{path}={v}")
        r.add(name, "evidence/source ids resolve", not dangling, "; ".join(sorted(set(dangling))[:8]))


def check_context(r: Report):
    for p in sorted(glob.glob(os.path.join(PRE, "context_*.json"))):
        c = load(p)
        name = os.path.basename(p)
        ev = c.get("evidence") or {}
        dangling = [f"{pa}={v}" for pa, v in walk(c) if pa.endswith("evidence_id") and isinstance(v, str) and v not in ev]
        r.add(name, "evidence_id references resolve", not dangling, "; ".join(dangling[:6]))
        n = c.get("climate", {}).get("normals", {})
        probs = []
        if n:
            if not (-30 <= n.get("tmean", 0) <= 35): probs.append(f"tmean {n.get('tmean')}")
            if not (0 <= n.get("precip", 0) <= 5000): probs.append(f"precip {n.get('precip')}")
            if not (0 <= n.get("et0", 0) <= 3000): probs.append(f"et0 {n.get('et0')}")
            if not (0 <= n.get("windy_days", 0) <= 366): probs.append(f"windy_days {n.get('windy_days')}")
        soil = (c.get("soil") or {}).get("properties") or {}
        if soil:
            if soil.get("ph1to1h2o_r") is not None and not (3 <= soil["ph1to1h2o_r"] <= 10): probs.append(f"pH {soil['ph1to1h2o_r']}")
            if soil.get("om_r") is not None and not (0 <= soil["om_r"] <= 30): probs.append(f"OM {soil['om_r']}")
            tex = [soil.get(k) for k in ("claytotal_r", "sandtotal_r", "silttotal_r")]
            if all(isinstance(x, (int, float)) for x in tex) and not (90 <= sum(tex) <= 110): probs.append(f"texture sum {sum(tex):.1f}")
        t = c.get("terrain") or {}
        if t and not (0 <= t.get("slope_mean_pct", 0) <= 100): probs.append(f"slope {t.get('slope_mean_pct')}")
        r.add(name, "climate/soil/terrain ranges", not probs, "; ".join(probs))
        # leakage: POWER end, season as_of
        fut = []
        for e in ev.values():
            d = to_date(str(e.get("observation_end") or ""))
            if d and d > TODAY: fut.append(f"{e['id']} obs_end {d}")
        so = to_date(str((c.get("season") or {}).get("as_of") or ""))
        if so and so > TODAY: fut.append(f"season.as_of {so}")
        r.add(name, "no future data (obs end, season)", not fut, "; ".join(fut) or f"POWER end ≤ {TODAY}")
        cov = c.get("coverage") or []
        r.add(name, "coverage panel present", bool(cov), f"{sum(1 for x in cov if x.get('status') != 'supported')} non-supported layers flagged")


def check_nasa(r: Report):
    for p in sorted(glob.glob(os.path.join(PRE, "nasa_*.json"))):
        c = load(p)
        name = os.path.basename(p)
        probs, fut, nan_months = [], [], set()
        sm = c.get("smap") or {}
        for w in sm.get("last_12_months_weekly", []) or []:
            v = w.get("sm_rootzone")
            if v is not None and not (0 <= v <= 0.7): probs.append(f"SMAP {v}")
            pc = w.get("percentile")
            if pc is not None and not (0 <= pc <= 100): probs.append(f"SMAP pctl {pc}")
            d = to_date(str(w.get("week_ending", "")))
            if d and d > TODAY: fut.append(f"SMAP week_ending {d}")
        for row in sm.get("last_12_months_daily", []) or []:
            d = to_date(str(row.get("date", row.get("day", "")))) if isinstance(row, dict) else None
            if d and d > TODAY: fut.append(f"SMAP daily {d}")
        gr = c.get("grace") or {}
        for m in gr.get("monthly", []) or []:
            v = m[1] if isinstance(m, list) else m.get("cm")
            if v is not None and not (-150 <= v <= 150): probs.append(f"GRACE {v}")
            d = to_date(str(m[0] if isinstance(m, list) else m.get("month", "")))
            if d and d > TODAY: fut.append(f"GRACE {d}")
        if gr and "well" in str(gr.get("scale_label", "")).lower() and "not a well" not in str(gr.get("scale_label", "")).lower():
            probs.append("GRACE scale label mentions a well")
        hl = c.get("hls") or {}
        for m in hl.get("monthly", []) or []:
            for k in ("ndvi_median", "ndvi_max"):
                v = m.get(k)
                if isinstance(v, float) and v != v:
                    nan_months.add(m.get("month"))
                elif v is not None and not (-1 <= v <= 1): probs.append(f"HLS {k} {v}")
            d = to_date(str(m.get("month", "")))
            if d and d > TODAY: fut.append(f"HLS {d}")
        if hl and "residue" in str(hl.get("label", "")).lower() and "not residue" not in str(hl.get("label", "")).lower():
            probs.append("HLS label implies residue amount")
        for blk in (sm, gr, hl, c.get("imerg") or {}):
            e = blk.get("evidence") or {}
            d = to_date(str(e.get("observation_end") or ""))
            if d and d > TODAY: fut.append(f"{e.get('id')} obs_end {d}")
        r.add(name, "value ranges (SMAP m3/m3, GRACE cm, NDVI)", not probs, "; ".join(sorted(set(probs))[:6]))
        if nan_months:
            r.add(name, "no NaN in cached HLS months", False,
                  f"{len(nan_months)} months with NaN NDVI in the cache file (invalid JSON); /api/fields/{{id}}/nasa sanitises to null (commit f453f86)", warn=True)
        r.add(name, "no future-dated records", not fut, "; ".join(sorted(set(fut))[:6]),
              warn=all("week_ending" in f for f in fut))
        im = c.get("imerg") or {}
        if im and not (im.get("evidence") or {}).get("available", True):
            r.add(name, "IMERG available", False, "IMERG not retrieved (Earthdata/GES DISC approval); UI must say so", warn=True)


def check_replay(r: Report):
    for p in sorted(glob.glob(os.path.join(PRE, "replay_*.json"))):
        c = load(p)
        name = os.path.basename(p)
        y = c.get("year")
        r.add(name, "replay year < current year", isinstance(y, int) and y < TODAY.year, f"year {y}")
        probs, small = [], []
        for side in ("current", "alternative"):
            s = c.get(side) or {}
            for w in s.get("weeks", []) or []:
                lo, mid, hi = w.get("soil_water_pct_low"), w.get("soil_water_pct_mid"), w.get("soil_water_pct_high")
                # low/high are the AWC −20 % / +20 % runs, so in "% full" either may be larger: the band is
                # [min, max]. The central run must lie inside it, or the drawn "likely range" excludes the estimate.
                if None not in (lo, mid, hi):
                    dev = max(min(lo, hi) - mid, mid - max(lo, hi), 0)
                    if dev > 1.0:
                        probs.append(f"{side} wk{w['week']} mid {mid} outside band [{min(lo, hi)}, {max(lo, hi)}]")
                    elif dev > 0.05:
                        small.append(dev)
                for k, (a, b) in {"soil_water_pct_mid": (0, 100.5), "erosion_t_ha": (0, 50), "soil_cover": (0, 1), "rain_mm": (0, 600)}.items():
                    v = w.get(k)
                    if v is not None and not (a <= v <= b): probs.append(f"{side} wk{w['week']} {k}={v}")
            yd = s.get("yield") or {}
            if yd and not (yd.get("low", 0) <= yd.get("mid", 0) <= yd.get("high", 0)):
                probs.append(f"{side} yield band order")
            if yd.get("pct_of_typical") is not None and not (0 <= yd["pct_of_typical"] <= 200):
                probs.append(f"{side} pct_of_typical {yd['pct_of_typical']}")
            et = s.get("erosion_total_t_ha")
            if et is not None and not (0 <= et <= 100): probs.append(f"{side} erosion_total {et}")
        r.add(name, "ranges; central run inside the drawn band (>1 pt = fail)", not probs,
              (f"{len(probs)} weeks: " + "; ".join(probs[:4])) if probs else (f"{len(small)} weeks marginally (<1 pt) outside" if small else ""))
        nc = str(c.get("never_claim", ""))
        r.add(name, "labelled as model replay + NDVI never-claim", "model replay" in str(c.get("label", "")).lower() and "not measure yield" in nc.lower(),
              c.get("label", "")[:80])


# --------------------------------------------------------------------------- never-claim
NEG = re.compile(r"\b(not|no|never|isn['’]t|doesn['’]t|does not|do not|cannot|can['’]t|without|rather than|instead of|nor|ni|nunca|sin)\b", re.I)
CLAIMS = {
    "NDVI measures yield/residue/carbon": re.compile(
        r"\b(ndvi|greenness|verdor|verdura)\b[^.;:\n]{0,60}\b(measures?|shows?|tells?|estimates?|reveals?|indicates?|mide|muestra|estima)\b[^.;:\n]{0,40}\b(yield|residue|carbon|rendimiento|rastrojo|residuo|carbono)", re.I),
    "GRACE describes a well": re.compile(r"\bgrace\b[^.;\n]{0,80}\b(your well|the well|well level|pozo)\b", re.I),
    "common means suitable": re.compile(r"\bcommon(ly grown)?\b[^.;\n]{0,40}\b(means?|=|so it is|therefore)\b[^.;\n]{0,20}\b(suitable|fits?|right)\b|\bcom[uú]n\b[^.;\n]{0,30}\b(significa|=)\b[^.;\n]{0,20}\badecuad", re.I),
    "guarantee": re.compile(r"\b(guarantee[sd]?|guaranteed|garantiza\w*|garant[ií]a)\b", re.I),
    "quick organic-matter gains": re.compile(
        r"\b(organic matter|soil carbon|soc|materia org[aá]nica|carbono del suelo)\b[^.;\n]{0,60}\b(quick(ly)?|fast|rapid(ly)?|within (a|one|1) (year|season)|in (a|one) (year|season)|r[aá]pid\w*)\b", re.I),
    "field-scale soil moisture from imagery": re.compile(
        r"\b(imagery|images?|pictures?|photos?|im[aá]genes?)\b[^.;\n]{0,60}\b(shows?|measures?|muestra\w*|mide\w*)\b[^.;\n]{0,40}\b(soil moisture|humedad del suelo|wind|viento)\b", re.I),
    "observed pattern proves a switch gain": re.compile(r"\b(prove[sn]?|proof|demuestra\w*|prueba que)\b[^.;\n]{0,60}\b(gain|better|switch|benefit|ganancia|mejor)", re.I),
}
AI_RE = re.compile(r"(?<![A-Za-z0-9_\-./])AI(?![A-Za-z0-9_\-])")
IA_RE = re.compile(r"(?<![A-Za-z0-9_\-./])IA(?![A-Za-z0-9_\-])")


def ui_strings():
    out = []
    for p in glob.glob(os.path.join(ROOT, "web", "src", "i18n", "*.json")):
        for path, v in walk(load(p)):
            if isinstance(v, str):
                out.append((os.path.relpath(p, ROOT) + ":" + path, v))
    lit = re.compile(r'"((?:[^"\\\n]|\\.){3,})"|\'((?:[^\'\\\n]|\\.){3,})\'|`([^`$]{3,})`|>([^<>{}\n]{3,})<')
    for p in glob.glob(os.path.join(ROOT, "web", "src", "**", "*.tsx"), recursive=True):
        with open(p, encoding="utf-8") as f:
            for i, line in enumerate(f, 1):
                s = line.strip()
                if s.startswith(("//", "/*", "*", "import ")):
                    continue
                for m in lit.finditer(line):
                    t = next(g for g in m.groups() if g)
                    if " " in t or AI_RE.search(t):
                        out.append((f"{os.path.relpath(p, ROOT)}:{i}", t))
    return out


def backend_strings():
    out = []
    for p in sorted(glob.glob(os.path.join(PRE, "compare_*.json"))):
        c = load(p)
        for card in c.get("all_cards", []):
            for k in SEVEN + ["flags", "name"]:
                for path, v in walk(card.get(k)):
                    if isinstance(v, str) and " " in v:
                        out.append((f"{os.path.basename(p)}:{card['id']}.{k}{path}", v))
        for path, v in walk({"reminder": c.get("reminder"), "assumptions": c.get("assumptions"), "binding": c.get("binding_constraint")}):
            if isinstance(v, str) and " " in v:
                out.append((f"{os.path.basename(p)}:{path}", v))
    for pat in ("context_*.json", "nasa_*.json", "replay_*.json", "twins_*.json"):
        for p in sorted(glob.glob(os.path.join(PRE, pat))):
            for path, v in walk(load(p)):
                if isinstance(v, str) and " " in v and len(v) > 12 and not path.endswith(("citation", "url", "_path")):
                    out.append((f"{os.path.basename(p)}:{path}", v))
    for p in glob.glob(os.path.join(ROOT, "engine", "**", "*.yaml"), recursive=True):
        with open(p, encoding="utf-8") as f:
            for i, line in enumerate(f, 1):
                if line.lstrip().startswith("#"):
                    continue
                out.append((f"{os.path.relpath(p, ROOT)}:{i}", line.strip()))
    return out


def check_never_claims(r: Report):
    ui = ui_strings()
    be = backend_strings()
    for label, pat in CLAIMS.items():
        hits, negated = [], []
        for src, txt in ui + be:
            for m in pat.finditer(txt):
                # look at the sentence containing the match for a negation
                start = max(txt.rfind(".", 0, m.start()), txt.rfind(";", 0, m.start())) + 1
                sentence = txt[start: m.end() + 40]
                (negated if NEG.search(sentence) else hits).append(f"`{src}`: “{txt[max(0, m.start()-30): m.end()+30].strip()}”")
        r.add("never-claim", label, not hits,
              ("CLAIM-LIKE: " + " | ".join(sorted(set(hits))[:6])) if hits else f"0 positive claims; {len(set(negated))} negated mentions (disclaimers)")
    # Self-test: each pattern must fire on a planted claim, so a PASS means "searched and none found".
    planted = {
        "NDVI measures yield/residue/carbon": "NDVI measures your yield",
        "GRACE describes a well": "GRACE shows the level of your well",
        "common means suitable": "Corn is common here, so it is suitable",
        "guarantee": "This rotation is guaranteed to pay",
        "quick organic-matter gains": "Organic matter rises quickly within a year",
        "field-scale soil moisture from imagery": "The imagery shows soil moisture on your field",
        "observed pattern proves a switch gain": "Neighbours' fields prove the switch is better",
    }
    dead = [k for k, txt in planted.items() if not CLAIMS[k].search(txt)]
    r.add("never-claim", "pattern self-test (each pattern catches a planted claim)", not dead, ", ".join(dead))
    # Manual-review list: every sentence that mentions NDVI/greenness together with yield, residue or carbon,
    # or GRACE together with a well, whatever the wording.
    review = []
    for src, txt in ui + be:
        for sent in re.split(r"(?<=[.!?])\s+", txt):
            if (re.search(r"\b(ndvi|greenness)\b", sent, re.I) and re.search(r"\b(yield|residue|carbon)\b", sent, re.I)) or                (re.search(r"\bgrace\b", sent, re.I) and re.search(r"\bwell\b", sent, re.I)):
                review.append(f"{sent.strip()[:140]}")
    REVIEW.extend(sorted(set(review)))
    ai = [f"`{s}`: “{t[:80]}”" for s, t in ui if AI_RE.search(t)]
    r.add("never-claim", "no 'AI' word in UI text (use SI)", not ai, " | ".join(ai[:8]) or f"{len(ui)} UI strings scanned")
    es = [f"`{s}`: “{t[:80]}”" for s, t in ui if "es.json" in s and IA_RE.search(t)]
    r.add("never-claim", "no 'IA' word in Spanish UI text", not es, " | ".join(es[:6]), warn=True)
    be_ai = [f"`{s}`" for s, t in be if AI_RE.search(t) and not re.search(r"(country|iso|code)", s, re.I)]
    r.add("never-claim", "no 'AI' word in backend card/context texts", not be_ai, " | ".join(be_ai[:6]))


# --------------------------------------------------------------------------- main
def main():
    r = Report()
    check_compare(r)
    check_context(r)
    check_nasa(r)
    check_replay(r)
    check_never_claims(r)
    cnt = defaultdict(int)
    for row in r.rows:
        cnt[row[2]] += 1
    lines = [
        "# Data and honesty checks",
        "",
        f"Generated by `qc/checks.py` on {datetime.now(timezone.utc):%Y-%m-%d %H:%M} UTC (today = {TODAY}).",
        f"Totals: **{cnt['PASS']} pass · {cnt['WARN']} warn · {cnt['FAIL']} fail**.",
        "",
        "WARN = a real issue the app discloses or that has a documented fallback; FAIL = must fix or justify.",
        "",
        "| Area / file | Check | Result | Detail |",
        "|---|---|---|---|",
    ]
    for a, c, s, d in r.rows:
        d = d.replace("|", "\\|").replace("\n", " ")
        lines.append(f"| {a} | {c} | {'✅' if s == 'PASS' else '⚠️' if s == 'WARN' else '❌'} {s} | {d} |")
    lines += ["", "## Manual review: every sentence pairing NDVI/greenness with yield/residue/carbon, or GRACE with a well", ""]
    lines += [f"- {x}" for x in REVIEW] or ["- (none)"]
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    print(f"{cnt['PASS']} pass, {cnt['WARN']} warn, {cnt['FAIL']} fail -> {OUT}")
    for a, c, s, d in r.rows:
        if s != "PASS":
            print(f"  {s} {a} | {c} | {d[:220]}")
    return 1 if cnt["FAIL"] else 0


if __name__ == "__main__":
    sys.exit(main())
