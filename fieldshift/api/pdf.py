"""'Talk to your agronomist' PDF report (ReportLab). Every number comes from the report/compare JSON."""
from __future__ import annotations

import re
from datetime import date
from io import BytesIO
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import KeepTogether, PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

NAVY = colors.HexColor("#0E2A47")
GREEN = colors.HexColor("#2E7D4F")
SURF = colors.HexColor("#F6F8FA")
NOTES_MAX = 10_000
_CTRL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")


def _f(v, d=0, unit=""):
    if v is None:
        return "n/a"
    return f"{v:,.{d}f}{unit}"


def _e(v) -> str:
    """Text from data or the user, made safe for ReportLab's mini-markup (escaped, control characters removed)."""
    return escape(_CTRL.sub("", "" if v is None else str(v)))


def build(report: dict, cmp: dict, plan: dict | None = None) -> bytes:
    buf = BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=letter, leftMargin=0.7 * inch, rightMargin=0.7 * inch,
                            topMargin=0.7 * inch, bottomMargin=0.7 * inch,
                            title=f"FarmSmart report: {_CTRL.sub('', str(report.get('name')))}", author="FarmSmart")
    ss = getSampleStyleSheet()
    h1 = ParagraphStyle("h1", parent=ss["Heading1"], textColor=NAVY, fontSize=18)
    h2 = ParagraphStyle("h2", parent=ss["Heading2"], textColor=NAVY, fontSize=13, spaceBefore=10)
    body = ParagraphStyle("b", parent=ss["BodyText"], fontSize=9.5, leading=13)
    small = ParagraphStyle("s", parent=body, fontSize=8, textColor=colors.HexColor("#4A5A6A"))
    el = []
    el.append(Paragraph("FarmSmart: talk-to-your-agronomist report", h1))
    el.append(Paragraph(f"<b>{_e(report.get('name'))}</b> · {_f(report.get('area_ha'), 1)} ha · generated {date.today():%B %d, %Y}", body))
    el.append(Paragraph(_e(cmp.get("reminder")), small))
    el.append(Spacer(1, 8))
    # area facts
    cl = report.get("climate") or {}
    n = cl.get("normals") or {}
    fr = cl.get("frost") or {}
    sp = ((report.get("soil") or {}).get("properties") or {})
    tr = report.get("terrain") or {}
    rows = [["Climate normal (1991–2020)", f"{_f(n.get('tmean'), 1, ' °C')} mean · {_f(n.get('precip'), 0, ' mm')} rain · {_f(n.get('et0'), 0, ' mm')} reference ET", "NASA POWER (≈50 km)"],
            ["Frost-free season", f"median {_f(fr.get('frost_free_days_median'))} days (1 year in 10: {_f(fr.get('frost_free_days_p10'))})", "NASA POWER"],
            ["Soil", f"{sp.get('texture_class') or 'n/a'} · OM {_f(sp.get('om_r'), 1, '%')} · {sp.get('drainagecl') or 'n/a'} · water 0–100 cm {_f(sp.get('aws100_cm'), 1, ' cm')}", "USDA SSURGO"],
            ["Terrain", f"mean slope {_f(tr.get('slope_mean_pct'), 1, '%')} · {_f((tr.get('share_slope_gt5') or 0) * 100, 0, '%')} of field over 5%", "Terrain tiles (3DEP/SRTM)"]]
    t = Table([["Area fact", "Value", "Source"]] + rows, colWidths=[1.6 * inch, 3.9 * inch, 1.5 * inch])
    t.setStyle(TableStyle([("FONTSIZE", (0, 0), (-1, -1), 8.5), ("BACKGROUND", (0, 0), (-1, 0), NAVY),
                           ("TEXTCOLOR", (0, 0), (-1, 0), colors.white), ("GRID", (0, 0), (-1, -1), 0.25, colors.lightgrey),
                           ("VALIGN", (0, 0), (-1, -1), "TOP")]))
    el += [Paragraph("Your field", h2), t]
    # cards
    el.append(Paragraph("Rotation options compared", h2))
    el.append(Paragraph(f"Simulated over {cmp.get('weather_years', {}).get('n')} real weather years "
                        f"({cmp.get('weather_years', {}).get('first')}–{cmp.get('weather_years', {}).get('last')}). "
                        f"Ranked by your priorities: {_e(', '.join(cmp.get('priorities') or []))}. "
                        + ("The ordering is stable when assumptions change." if cmp.get("ranking", {}).get("stable") else
                           "The ordering is uncertain: small changes in assumptions can change the top choice."), body))
    hdr = ["Indicator (median, P10–P90)"] + [_e(c["name"]) for c in cmp["cards"]]
    def cell(c, k, d=0, unit=""):
        i = (c.get("indicators") or {}).get(k) or {}
        if i.get("p50") is None:
            return "n/a"
        return f"{_f(i['p50'], d, unit)} ({_f(i.get('p10'), d)}–{_f(i.get('p90'), d)})"
    spec = [("Days soil covered / yr", "soil_cover", 0, ""), ("Water erosion t/ha/yr (RUSLE)", "erosion_water", 2, ""),
            ("Windy days on bare soil / yr", "bare_windy_days", 1, ""), ("Water use mm/yr", "water_use", 0, ""),
            ("Yield index (100 = no water stress)", "yield_index", 0, ""), ("Net return $/ac/yr over operating cost", "profit_p50", 0, ""),
            ("Soil carbon trend t C/ha/yr", "soc_trend", 2, ""), ("Legume N kg/ha/yr", "n_balance", 0, ""),
            ("Field passes / yr", "workload", 1, "")]
    data = [hdr] + [[lbl] + [cell(c, k, d, u) for c in cmp["cards"]] for lbl, k, d, u in spec]
    data.append(["Confidence"] + [c["confidence"]["level"].title() for c in cmp["cards"]])
    w = (7.0 * inch - 2.0 * inch) / max(len(cmp["cards"]), 1)
    t2 = Table([[Paragraph(str(x), small) for x in row] for row in data], colWidths=[2.0 * inch] + [w] * len(cmp["cards"]))
    t2.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, 0), SURF), ("GRID", (0, 0), (-1, -1), 0.25, colors.lightgrey),
                            ("VALIGN", (0, 0), (-1, -1), "TOP")]))
    el.append(t2)
    econ = cmp.get("economics") or {}
    if econ.get("budget_source") or econ.get("price_note"):
        from ..engine import kb
        yours = sorted((kb.crops().get(k) or {}).get("name", k).split(" (")[0]
                       for k, v in (econ.get("budget_source") or {}).items() if v == "yours")
        txt = []
        if yours:
            txt.append("Net return uses your own prices, costs or yields for: " + ", ".join(yours) + ".")
        if econ.get("price_note"):
            txt.append(econ["price_note"] + ".")
        el.append(Paragraph(_e(" ".join(txt)), small))
    for c in cmp["cards"]:
        block = [Paragraph(f"{_e(c['name'])} <font color='#2E7D4F'>({_e(c.get('family_name'))})</font>", h2)]
        for title, items in (("Why suggested", c.get("why")), ("Benefits", c.get("benefits")),
                             ("Trade-offs & risks", c.get("tradeoffs_risks")), ("Information gaps", c.get("information_gaps")),
                             ("Check locally", [x["text"] for x in c.get("check_locally") or []])):
            if items:
                block.append(Paragraph(f"<b>{title}</b>", body))
                for it in items[:8]:
                    block.append(Paragraph(f"• {_e(it)}", body))
        tis = c.get("try_it_small") or {}
        if tis.get("example"):
            block.append(Paragraph(f"<b>Try it small:</b> {_e(tis['example'])}", body))
        el.append(KeepTogether(block[:3]))
        el += block[3:]
    el.append(Paragraph("Questions to ask your agronomist", h2))
    for q in ["Do these planting and termination dates match local practice and my insurance rules?",
              "Which herbicide programs limit these crop sequences on my field?",
              "Is there a buyer within hauling distance for every crop listed?",
              "How would my tile drainage and spring workability change these options?"]:
        el.append(Paragraph(f"• {q}", body))
    el.append(Spacer(1, 8))
    el.append(Paragraph("Data: NASA POWER, USDA NRCS SSURGO, USDA NASS Cropland Data Layer, USDA ERS Costs and Returns, "
                        "terrain tiles (USGS 3DEP/SRTM). Methods: FAO-56 water balance, FAO-33 yield response, RUSLE, ICBM "
                        "soil carbon, agronomy rules with published sources. SI and models support, never replace, local judgment. "
                        "No NASA endorsement is implied.", small))
    if plan is not None:
        el += _action_plan(plan, cmp, h1, h2, body, small)
    doc.build(el)
    return buf.getvalue()


def _find_card(cmp: dict, chosen: str) -> dict | None:
    if not chosen:
        return None
    shown = cmp.get("cards") or []
    cards = list(shown) + [c for c in cmp.get("all_cards") or [] if c.get("id") not in {x.get("id") for x in shown}]
    for key in ("id", "custom_name", "name", "rotation_label"):
        for c in cards:
            if c.get(key) and str(c[key]) == chosen:
                return c
    return None


def _action_plan(plan: dict, cmp: dict, h1, h2, body, small) -> list:
    """'Action plan' page: the chosen option, its years, the checklist (done / not done) and adviser notes."""
    from ..engine import kb
    C = kb.crops()

    def nm(cid):
        return (C.get(cid) or {}).get("name", cid).split(" (")[0] if cid else ""
    el = [PageBreak(), Paragraph("Action plan", h1)]
    chosen = plan.get("chosen") or ""
    card = _find_card(cmp, chosen)
    if card:
        lbl = card.get("rotation_label")
        el.append(Paragraph(f"<b>Chosen option:</b> {_e(card['name'])}"
                            + (f" ({_e(lbl)})" if lbl and lbl != card["name"] else "")
                            + f" · <font color='#2E7D4F'>{_e(card.get('family_name'))}</font>", body))
        rows = [["Year", "Crop", "Second crop", "Cover crop after it"]]
        for i, st in enumerate(card.get("sequence") or [], start=1):
            rows.append([str(i), _e(nm(st.get("cash"))), _e(nm(st.get("double"))) or "–", _e(nm(st.get("cover"))) or "none"])
        t = Table(rows, colWidths=[0.6 * inch, 2.1 * inch, 2.1 * inch, 2.2 * inch])
        t.setStyle(TableStyle([("FONTSIZE", (0, 0), (-1, -1), 8.5), ("BACKGROUND", (0, 0), (-1, 0), NAVY),
                               ("TEXTCOLOR", (0, 0), (-1, 0), colors.white), ("GRID", (0, 0), (-1, -1), 0.25, colors.lightgrey)]))
        el += [Spacer(1, 4), t]
        ind = card.get("indicators") or {}
        facts = []
        for lbl_, k, d in (("days soil covered / yr", "soil_cover", 0), ("water erosion t/ha/yr", "erosion_water", 2),
                           ("water use mm/yr", "water_use", 0), ("net return $/ac/yr over operating cost", "profit_p50", 0)):
            v = (ind.get(k) or {}).get("p50")
            if v is not None:
                facts.append(f"{lbl_} {_f(v, d)}")
        if facts:
            el.append(Paragraph("Simulated medians for this option: " + " · ".join(facts) +
                                f" · confidence {_e((card.get('confidence') or {}).get('level', 'n/a'))}", small))
    elif chosen:
        el.append(Paragraph(f"<b>Chosen option:</b> {_e(chosen)} (not found in this comparison: it may need the same "
                            "settings you used in the app)", body))
    else:
        el.append(Paragraph("<b>Chosen option:</b> not chosen yet", body))
    items = plan.get("checklist") or []
    if items:
        done = sum(1 for x in items if x.get("done"))
        el.append(Paragraph(f"Checklist ({done} / {len(items)} done)", h2))
        rows = [[Paragraph("<b>Status</b>", small), Paragraph("<b>Item</b>", small)]]
        for x in items:
            rows.append([Paragraph("[x] Done" if x.get("done") else "[ ] Not done", small), Paragraph(_e(x.get("label")), body)])
        t = Table(rows, colWidths=[1.0 * inch, 6.0 * inch], repeatRows=1)
        t.setStyle(TableStyle([("GRID", (0, 0), (-1, -1), 0.25, colors.lightgrey), ("BACKGROUND", (0, 0), (-1, 0), SURF),
                               ("VALIGN", (0, 0), (-1, -1), "TOP")]))
        el.append(t)
    if card and card.get("check_locally"):
        el.append(Paragraph("Check locally for this option", h2))
        for x in card["check_locally"][:10]:
            el.append(Paragraph(f"• {_e(x.get('text'))}", body))
    notes = (plan.get("notes") or "").replace("\r\n", "\n").strip()[:NOTES_MAX]
    el.append(Paragraph("Adviser notes", h2))
    if notes:
        for para in notes.split("\n\n"):
            if para.strip():
                el.append(Paragraph(_e(para).replace("\n", "<br/>"), body))
    else:
        el.append(Paragraph("No notes added.", small))
    el.append(Spacer(1, 8))
    el.append(Paragraph("This plan is yours. FarmSmart shows patterns and trade-offs from models and data; it does not "
                        "replace your judgment or local agronomy advice.", small))
    return el
