"""Evaluates engine/rules/rules.yaml (condition DSL v1) over a candidate rotation.

The DSL is a safe subset of Python expressions. We translate the few non-Python tokens (null/true/false/not_in),
turn predicate arguments of years_since/count into lambdas, and evaluate with no builtins."""
from __future__ import annotations

import ast
import re
from typing import Any

from . import kb


LOW_N_ONLY = {"legume_before_high_n_crop", "legume_cover_before_corn"}


class Obj(dict):
    """dict with attribute access; missing keys -> None."""
    def __getattr__(self, k):
        v = self.get(k)
        return Obj(v) if isinstance(v, dict) and not isinstance(v, Obj) else v


def _translate(expr: str) -> str:
    e = re.sub(r"\bnot_in\b", "not in", expr)
    e = re.sub(r"\bnull\b", "None", e)
    e = re.sub(r"\btrue\b", "True", e)
    e = re.sub(r"\bfalse\b", "False", e)
    # predicate args -> lambdas
    e = re.sub(r"years_since\(\s*seq\s*,", "years_since(seq, lambda c:", e)
    e = re.sub(r"count\(\s*seq\s*,", "count(seq, lambda c:", e)
    return e


_ALLOWED = (ast.Expression, ast.BoolOp, ast.And, ast.Or, ast.UnaryOp, ast.Not, ast.USub, ast.Compare, ast.Eq,
            ast.NotEq, ast.Lt, ast.LtE, ast.Gt, ast.GtE, ast.In, ast.NotIn, ast.Is, ast.IsNot, ast.Name, ast.Load,
            ast.Constant, ast.Attribute, ast.Call, ast.List, ast.Tuple, ast.Subscript, ast.BinOp, ast.Add, ast.Sub,
            ast.Mult, ast.Div, ast.Lambda, ast.arguments, ast.arg, ast.keyword, ast.IfExp)
_cache: dict[str, Any] = {}


def _compile(expr: str):
    if expr in _cache:
        return _cache[expr]
    tree = ast.parse(_translate(expr), mode="eval")
    for node in ast.walk(tree):
        if not isinstance(node, _ALLOWED):
            raise ValueError(f"disallowed syntax {type(node).__name__} in rule: {expr}")
        if isinstance(node, ast.Attribute) and node.attr.startswith("_"):
            raise ValueError("private attribute access")
    code = compile(tree, "<rule>", "eval")
    _cache[expr] = code
    return code


def _funcs(field: Obj):
    def has(lst, x):
        return lst is not None and x in lst

    def any_in(a, b):
        return bool(a) and bool(b) and any(x in b for x in a)

    def all_in(a, b):
        return all(x in (b or []) for x in (a or []))

    def years_since(seq, pred):
        # seq: crop records oldest first, excluding `next`
        for i, c in enumerate(reversed(seq)):
            try:
                if pred(Obj(c)):
                    return i + 1
            except TypeError:
                continue
        return 99

    def count(seq, pred, window=99):
        return sum(1 for c in seq[-window:] if _safe(pred, Obj(c)))

    def season_etc_mm(nxt, fld):
        return (fld.get("season_etc") or {}).get(nxt.get("id")) or 0.0

    def overlap(a, b):
        return [x for x in (a or []) if x in (b or [])]

    return dict(has=has, any_in=any_in, all_in=all_in, years_since=years_since, count=count,
                season_etc_mm=season_etc_mm, overlap=overlap, len=len)


def _safe(pred, c):
    try:
        return bool(pred(c))
    except TypeError:
        return False


def evaluate(expr: str, ctx: dict) -> Any:
    try:
        # context as globals so predicate lambdas (years_since/count) can see has(), field, etc.
        return eval(_compile(expr), {"__builtins__": {}, **ctx})  # noqa: S307 - AST-whitelisted
    except (TypeError, AttributeError, KeyError, IndexError):
        # comparisons against None (missing data) -> rule cannot fire
        return None
    except Exception as e:  # noqa: BLE001 - a broken rule must never crash an analysis
        _errors.add(f"{expr[:80]}: {type(e).__name__}: {e}")
        return None


_errors: set[str] = set()


PULSES = ("field_pea", "lentil", "chickpea", "dry_bean")


def _name(rec: dict, cover: bool, es: bool) -> str:
    n = (rec.get("name_es") if es else rec.get("name")) or rec.get("name") or rec["id"]
    if cover and "cover" not in n.lower() and "cobertura" not in n.lower():
        n += " (cobertura)" if es else " (cover)"
    return n


def _in_text(name: str) -> str:
    """Lower-case the first letter for use mid-sentence, unless the name starts with a genus or an acronym."""
    w = name.split(" ")[0]
    if w[:1].isupper() and (w[1:2].isupper() or w in ("Aphanomyces", "Fusarium", "Sclerotinia")):
        return name
    return name[:1].lower() + name[1:]


def shared_pathogens(sequence: list[dict], recs: list[dict], t: int, C: dict, field: dict) -> dict:
    """Pathogen / pest groups (pathogens.yaml) that the crop placed at transition t, or the cover sown just before
    it, shares with a different crop or cover grown within the group's break_years.

    Distance g = number of cash crops strictly between the two plantings (0 = back to back). A pair fires when
    g < break_years (null -> 1: only back-to-back). Pairs that a crop-specific rule already handles are skipped
    (continuous_corn/soybean: same crop; pulses_back_to_back; wheat_after_corn_fhb; sunflower_sclerotinia_spacing;
    canola_frequency). A back-to-back pair of the same plant family is already penalised by same_family_back_to_back,
    so it is returned under `flag_only` (named in the message, no second score).
    Returns {penalised: [...], flag_only: [...], msg: {penalised|flag_only: {en, es, sources}}}."""
    P = kb.pathogens()
    n = len(sequence)
    out = {"penalised": [], "flag_only": [], "msg": {}}
    if not P or n == 0:
        return out
    nxt = recs[t]
    cur_cover_id = sequence[t - 1].get("cover") if n > 1 else None
    cur_cover = C.get(cur_cover_id) if cur_cover_id else None
    # earlier plantings, nearest first: (record, is_cover, g, k) with k = years back of the crop slot
    earlier = []
    for k in range(1, min(n, 6) + 1):
        i = (t - k) % n
        cid = sequence[i].get("cover")
        if cid and cid in C and k >= 2:  # k == 1: that cover is the one placed in this transition
            earlier.append((C[cid], True, k - 1, k))
        earlier.append((recs[i], False, k - 1, k))
    placed = [(nxt, False, earlier if cur_cover is None else [(cur_cover, True, 0, 1)] + earlier)]
    if cur_cover is not None:
        placed.append((cur_cover, True, earlier))
    aph_neg = field.get("aphanomyces_confirmed") is False
    seen = set()
    for prec, p_cover, cands in placed:
        pg = set(prec.get("pest_host_groups") or [])
        for pid in sorted(pg):
            p = P.get(pid)
            if not p or not p.get("in_rule", True) or prec["id"] not in (p.get("hosts") or []):
                continue
            if pid == "pulse_root_rot_aphanomyces" and aph_neg:
                continue
            brk = p.get("break_years") or 1
            hostset = set(p.get("hosts") or []) | set(p.get("inoculum_sources") or [])
            for erec, e_cover, g, k in cands:
                if g >= brk:
                    break
                if erec["id"] == prec["id"] or erec["id"] not in hostset:
                    continue
                is_next = prec is nxt and not p_cover
                bucket = "penalised"
                if is_next and not e_cover:
                    if k == 1 and erec["id"] in PULSES and prec["id"] in PULSES:
                        break  # pulses_back_to_back
                    if k == 1 and erec["id"] == "corn" and pid == "fusarium_head_blight":
                        break  # wheat_after_corn_fhb
                    if prec["id"] == "sunflower" and pid == "sclerotinia" and k < 4:
                        break  # sunflower_sclerotinia_spacing
                    if prec.get("family") == "Brassicaceae" and "cash" in (prec.get("roles") or []) \
                            and erec.get("family") == "Brassicaceae" and k < 3 and pid in ("clubroot", "blackleg"):
                        break  # canola_frequency
                    if k == 1 and erec.get("family") == prec.get("family"):
                        bucket = "flag_only"  # same_family_back_to_back already scored this pair
                key = (pid, frozenset((prec["id"], erec["id"])))  # one mention per pair per transition
                if key in seen:
                    break
                seen.add(key)
                out[bucket].append({"pathogen": pid, "placed": prec["id"], "placed_is_cover": p_cover,
                                    "earlier": erec["id"], "earlier_is_cover": e_cover, "between": g,
                                    "break_years": p.get("break_years"),
                                    "_names": (_name(prec, p_cover, False), _name(erec, e_cover, False),
                                               _name(prec, p_cover, True), _name(erec, e_cover, True))})
                break
    for bucket in ("penalised", "flag_only"):
        for h in out[bucket]:
            p = P[h["pathogen"]]
            pe, ee, ps, es_ = h.pop("_names")
            g = h["between"]
            gap_en = "back to back" if g == 0 else f"only {g} crop{'s' if g > 1 else ''} apart"
            gap_es = "seguidos" if g == 0 else f"con solo {g} cultivo{'s' if g > 1 else ''} en medio"
            h["text_en"] = f"{pe} and {ee} ({gap_en}) are both hosts of {_in_text(p['name_en'])}. {p.get('advice_en', '')}".strip()
            h["text_es"] = f"{ps} y {es_} ({gap_es}) son hospederos de {_in_text(p['name_es'])}. {p.get('advice_es', '')}".strip()
            h["sources"] = list(p.get("sources") or [])
        if out[bucket]:
            out["msg"][bucket] = _shared_msg(out[bucket])
    return out


def _shared_msg(hits: list[dict]) -> dict:
    srcs = []
    for h in hits:
        srcs += [s for s in h["sources"] if s not in srcs]
    return {"en": " ".join(h["text_en"] for h in hits), "es": " ".join(h["text_es"] for h in hits), "sources": srcs}


def _dedupe_shared(out: dict, rid: str = "shared_pathogen_host"):
    """In a cyclic rotation the same pair (e.g. canola and lentil) is met at more than one transition. Say it once
    per option: later transitions keep only pairs not yet named, and drop out when nothing new is left."""
    seen = set()
    keep_t = {}
    for x in sorted((x for x in out["fired"] if x["rule"] == rid), key=lambda x: x["transition"]):
        new = [h for h in x.get("hits") or [] if (h["pathogen"], frozenset((h["placed"], h["earlier"]))) not in seen]
        seen |= {(h["pathogen"], frozenset((h["placed"], h["earlier"]))) for h in new}
        if new:
            m = _shared_msg(new)
            keep_t[x["transition"]] = dict(message=m["en"], message_es=m["es"], sources=m["sources"], hits=new)
    for key in ("fired", "flags", "check_locally"):
        lst = []
        for x in out[key]:
            if x["rule"] == rid:
                if x["transition"] not in keep_t:
                    continue
                x = {**x, **keep_t[x["transition"]]}
            lst.append(x)
        out[key] = lst


def apply_effect(eff: dict, ctx: dict, out: dict, rule: dict, transition: int, as_fired: bool = True):
    if not eff:
        return
    unless = eff.get("unless")
    if unless and evaluate(unless, ctx):
        return
    rid = rule["id"]
    msg = eff.get("message_en") or rule.get("message_en")  # sub-rules may carry their own wording
    hit = {"rule": rid, "transition": transition, "type": rule.get("type"), "message": msg,
           "message_es": eff.get("message_es") or rule.get("message_es"), "sources": rule.get("sources", [])}
    dyn = rule.get("dynamic_message")
    if dyn and eff.get("hits"):
        # wording and sources built per transition (e.g. shared_pathogen_host names the pathogen and the crops)
        m = ((ctx.get(dyn) or {}).get("msg") or {}).get(eff["hits"])
        if m:
            hit.update(message=m["en"], message_es=m["es"], sources=m["sources"] or hit["sources"],
                       hits=list((ctx.get(dyn) or {}).get(eff["hits"]) or []))
    if eff.get("exclude"):
        out["excluded"].append(hit)
    ym = eff.get("yield_mult")
    if rid in LOW_N_ONLY and isinstance(ym, (list, tuple)):
        farm = ctx.get("farm") or {}
        nrate = farm.get("n_rate_kg_ha")
        fade = (ctx.get("constants") or {}).get("legume_credit_fade_n_rate_kg_ha") or 150
        if nrate is None or nrate > fade:
            # Cernay 2017: yield bonus negligible above ~150 kg N/ha; conventional-N farms keep only the N credit
            ym = [1.0, 1.0]
    if isinstance(ym, (list, tuple)) and ym and ym[0] is not None and not (ym[0] == 1.0 and ym[-1] == 1.0):
        out["yield_mult"].setdefault(transition, []).append((float(ym[0]), float(ym[-1]), rid))
    elif isinstance(ym, str):
        # expression multipliers (dry-year water budget) are informational: the M6 simulator already applies
        # water stress year by year, so applying this too would double count.
        v = evaluate(ym, ctx)
        if isinstance(v, (int, float)):
            out.setdefault("info", []).append({"rule": rid, "transition": transition,
                                               "dry_year_yield_ratio": max(0.0, min(1.0, float(v)))})
    if eff.get("n_rate_delta_kg_ha"):
        out["n_delta"].append({**hit, "kg_ha": eff["n_rate_delta_kg_ha"]})
    for k, v in (eff.get("score") or {}).items():
        out["scores"][k] = out["scores"].get(k, 0) + v
    if eff.get("flag"):
        out["flags"].append({**hit, "flag": eff["flag"]})
    if eff.get("check_locally"):
        out["check_locally"].append({**hit, "item": eff["check_locally"]})
    if eff.get("require"):
        out["require"].append({**hit, "practice": eff["require"]})
    if eff.get("confidence"):
        out["confidence_delta"] += eff["confidence"]
    if rule.get("type") in ("credit", "penalty") and not eff.get("exclude") and (as_fired or eff.get("message_en") or (dyn and eff.get("hits"))):
        out["fired"].append(hit)


def run(sequence: list[dict], field: dict, farm: dict, history: list[str] | None = None) -> dict:
    """sequence: [{'cash': crop_id, 'cover': crop_id|None}], cyclic. Each transition t is (seq[t-1] -> seq[t])."""
    C = kb.crops()
    R = kb.rules()
    consts = Obj(R.get("constants", {}))
    out = {"excluded": [], "yield_mult": {}, "scores": {}, "flags": [], "check_locally": [], "require": [],
           "n_delta": [], "fired": [], "confidence_delta": 0}
    fld = Obj(field)
    frm = Obj(farm)
    funcs = _funcs(fld)
    n = len(sequence)
    recs = [Obj(C[s["cash"]]) for s in sequence]
    for t in range(n):
        prev = recs[t - 1]
        nxt = Obj(recs[t])
        cal = (kb.calendars().get(field.get("region") or "", {}).get("crops") or {}).get(nxt["id"]) or {}
        plant = (cal.get("plant") or {}).get("begin") if cal else None
        nxt["plant_date"] = plant
        nxt["growth_months"] = field.get("growth_months", {}).get(nxt["id"], [])
        cover_id = sequence[t - 1].get("cover")
        cover = Obj(C[cover_id]) if cover_id else None
        # seq = the rotation unrolled backwards (cyclic) so years_since sees earlier years
        seq = [recs[(t - k) % n] for k in range(min(n, 6), 0, -1)]
        shp = Obj(shared_pathogens(sequence, recs, t, C, field))
        ctx = dict(prev=prev, next=nxt, cover=cover, seq=seq, history=history or [], field=fld, farm=frm,
                   constants=consts, rules_env=consts, None_=None, shared_hosts=shp, **funcs)
        for rule in R["rules"]:
            cond = rule.get("condition")
            fired = bool(evaluate(cond, ctx)) if cond else False
            if fired:
                apply_effect(rule.get("effect") or {}, ctx, out, rule, t)
            for sr in rule.get("sub_rules") or []:
                if evaluate(sr.get("condition", "False"), ctx):
                    # a sub-rule whose parent did not fire only counts as "fired" (with the parent's message) when it
                    # carries its own wording; otherwise the parent's message would appear on unrelated transitions
                    apply_effect(sr.get("effect") or {}, ctx, out, rule, t, as_fired=fired)
    # combine multipliers per transition (product of lows, product of highs)
    comb = {}
    for t, lst in out["yield_mult"].items():
        lo = hi = 1.0
        for a, b, _ in lst:
            lo *= a
            hi *= b
        comb[t] = (min(lo, hi), max(lo, hi))
    out["yield_mult_combined"] = comb
    _dedupe_shared(out)
    # de-duplicate check_locally / flags by id
    seen = set()
    out["check_locally"] = [x for x in out["check_locally"] if not (x["item"] in seen or seen.add(x["item"]))]
    seen = set()
    out["flags"] = [x for x in out["flags"] if not ((x["flag"], x["transition"]) in seen or seen.add((x["flag"], x["transition"])))]
    return out
