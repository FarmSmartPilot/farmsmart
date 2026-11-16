"""Field alerts: subscriptions (double opt-in), forecast triggers, cooldowns, de-duplication, stale suppression,
email via SMTP/Resend when configured, otherwise .eml files in alerts/outbox/ (always works locally)."""
from __future__ import annotations

import json
import secrets
import smtplib
import sqlite3
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage
from typing import Any

from ..config import DB_PATH, OUTBOX, env, http

ALERT_TYPES = ["frost", "heat", "dry_down", "heavy_rain_bare", "wind_low_cover", "cover_seeding", "cover_termination",
               "water_storage", "market_price", "weekly_digest"]
DEFAULTS = {"frost_c": 0.0, "heat_c": 35.0, "heavy_rain_mm": 25.0, "wind_ms": 8.0, "dry_days": 14, "dry_mm": 5.0,
            "low_cover": 0.30, "cooldown_h": 48}
TEXT = {
    "en": {"frost": "Frost risk: low of {v:.1f} °C forecast on {d}.",
           "heat": "Heat stress: high of {v:.1f} °C forecast on {d}.",
           "heavy_rain_bare": "Heavy rain ({v:.0f} mm) forecast on {d} while your soil is mostly bare. Erosion risk.",
           "wind_low_cover": "High wind ({v:.1f} m/s at 10 m) forecast on {d} while ground cover is low. Wind erosion risk.",
           "dry_down": "Dry spell: only {v:.1f} mm of rain in the last 7 days plus the next 7 days.",
           "cover_seeding": "Cover-crop seeding window opens around {d}.",
           "cover_termination": "Cover-crop termination window: around {d}. Check your insurance termination rules.",
           "subject": "FarmSmart alert for {field}", "digest_subject": "FarmSmart weekly digest: {field}",
           "confirm_subject": "Confirm your FarmSmart alerts", "footer":
           "FarmSmart supports your decisions; it does not replace your judgment or local advice. Forecast: Open-Meteo (NOAA and ECMWF models)."},
    "es": {"frost": "Riesgo de helada: mínima de {v:.1f} °C prevista el {d}.",
           "heat": "Estrés por calor: máxima de {v:.1f} °C prevista el {d}.",
           "heavy_rain_bare": "Lluvia fuerte ({v:.0f} mm) prevista el {d} con el suelo casi desnudo. Riesgo de erosión.",
           "wind_low_cover": "Viento fuerte ({v:.1f} m/s a 10 m) previsto el {d} con poca cobertura. Riesgo de erosión por viento.",
           "dry_down": "Periodo seco: solo {v:.1f} mm de lluvia en los últimos 7 días más los próximos 7.",
           "cover_seeding": "La ventana de siembra de cobertura se abre cerca del {d}.",
           "cover_termination": "Ventana para terminar la cobertura: cerca del {d}. Revise las reglas de su seguro.",
           "subject": "Alerta de FarmSmart para {field}", "digest_subject": "Resumen semanal de FarmSmart: {field}",
           "confirm_subject": "Confirme sus alertas de FarmSmart", "footer":
           "FarmSmart apoya sus decisiones; no reemplaza su criterio ni el consejo local. Pronóstico: Open-Meteo (modelos NOAA y ECMWF)."},
}


def db() -> sqlite3.Connection:
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    con.executescript("""
    CREATE TABLE IF NOT EXISTS subscriptions (id TEXT PRIMARY KEY, email TEXT, field_id TEXT, field_name TEXT,
      lat REAL, lon REAL, types TEXT, thresholds TEXT, quiet_start INT, quiet_end INT, lang TEXT, units TEXT,
      confirmed INT DEFAULT 0, token TEXT, created TEXT, active INT DEFAULT 1, cover_weeks TEXT);
    CREATE TABLE IF NOT EXISTS alert_log (id INTEGER PRIMARY KEY AUTOINCREMENT, sub_id TEXT, field_id TEXT, type TEXT,
      key TEXT, message TEXT, created TEXT, channel TEXT, path TEXT);
    """)
    return con


def _send(to: str, subject: str, body: str) -> dict:
    msg = EmailMessage()
    msg["From"] = env("ALERT_FROM") or "FarmSmart <alerts@fieldshift.local>"
    msg["To"] = to
    msg["Subject"] = subject
    msg["Date"] = datetime.now(timezone.utc).strftime("%a, %d %b %Y %H:%M:%S +0000")
    msg.set_content(body)
    if env("RESEND_API_KEY"):
        r = http().post("https://api.resend.com/emails", headers={"Authorization": f"Bearer {env('RESEND_API_KEY')}"},
                        json={"from": msg["From"], "to": [to], "subject": subject, "text": body}, timeout=30)
        if r.status_code < 300:
            return {"channel": "resend", "path": None}
    if env("SMTP_HOST") and env("SMTP_USER"):
        with smtplib.SMTP(env("SMTP_HOST"), int(env("SMTP_PORT") or 587), timeout=30) as s:
            s.starttls()
            s.login(env("SMTP_USER"), env("SMTP_PASSWORD") or "")
            s.send_message(msg)
        return {"channel": "smtp", "path": None}
    name = f"{datetime.now():%Y%m%d-%H%M%S}-{secrets.token_hex(3)}.eml"
    (OUTBOX / name).write_bytes(bytes(msg))
    return {"channel": "outbox", "path": f"alerts/outbox/{name}"}


def subscribe(email: str, field: dict, types: list[str], thresholds: dict | None, quiet: tuple[int, int] | None,
              lang: str, units: str, base_url: str, cover_weeks: list[float] | None = None) -> dict:
    con = db()
    sid = secrets.token_hex(6)
    tok = secrets.token_urlsafe(16)
    th = {**DEFAULTS, **(thresholds or {})}
    con.execute("INSERT INTO subscriptions VALUES (?,?,?,?,?,?,?,?,?,?,?,?,0,?,?,1,?)",
                (sid, email, field["id"], field["name"], field["lat"], field["lon"], json.dumps(types), json.dumps(th),
                 (quiet or (21, 6))[0], (quiet or (21, 6))[1], lang, units, tok, datetime.now(timezone.utc).isoformat(),
                 json.dumps(cover_weeks or [])))
    con.commit()
    t = TEXT.get(lang, TEXT["en"])
    body = (f"Please confirm alerts for {field['name']}.\n\nConfirm: {base_url}/api/alerts/confirm?token={tok}\n"
            f"Unsubscribe at any time: {base_url}/api/alerts/unsubscribe?token={tok}\n\n{t['footer']}")
    sent = _send(email, t["confirm_subject"], body)
    con.execute("INSERT INTO alert_log (sub_id, field_id, type, key, message, created, channel, path) VALUES (?,?,?,?,?,?,?,?)",
                (sid, field["id"], "confirm", f"confirm-{sid}", "Confirmation email", datetime.now(timezone.utc).isoformat(),
                 sent["channel"], sent["path"]))
    con.commit()
    # the token is never returned to the browser: confirmation must come from the mailbox (double opt-in)
    return {"subscription_id": sid, "status": "pending_confirmation", **sent}


def confirm(token: str) -> bool:
    con = db()
    cur = con.execute("UPDATE subscriptions SET confirmed=1 WHERE token=?", (token,))
    con.commit()
    return cur.rowcount > 0


def unsubscribe(token: str) -> bool:
    con = db()
    cur = con.execute("UPDATE subscriptions SET active=0 WHERE token=?", (token,))
    con.commit()
    return cur.rowcount > 0


def forecast(lat: float, lon: float) -> dict:
    with http().cache_disabled():
        r = http().get("https://api.open-meteo.com/v1/forecast", params={
            "latitude": lat, "longitude": lon, "timezone": "auto", "forecast_days": 7, "past_days": 7,
            "daily": "temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max,wind_gusts_10m_max",
            "wind_speed_unit": "ms"}, timeout=30)
    r.raise_for_status()
    js = r.json()
    js["_retrieved"] = datetime.now(timezone.utc).isoformat()
    return js


NWS_ALERTS_URL = "https://api.weather.gov/alerts/active"
NWS_TTL_S = 600
_nws_cache: dict[tuple, tuple[float, dict]] = {}


def nws_warnings(lat: float, lon: float, country_code: str | None, timeout: float = 6.0) -> dict:
    """Official US National Weather Service warnings, watches and advisories active at the field point.
    US only. Failures return an empty list with a note; nothing is ever made up. Cached 10 minutes."""
    import time as _time

    import requests

    from ..config import USER_AGENT
    if (country_code or "").lower() != "us":
        return {"warnings": [], "note": "Official warnings are available for US fields only (US National Weather Service).",
                "source": None}
    key = (round(lat, 4), round(lon, 4))
    hit = _nws_cache.get(key)
    if hit and _time.time() - hit[0] < NWS_TTL_S:
        return hit[1]
    src = "US National Weather Service (api.weather.gov), active alerts at the field point"
    try:
        r = requests.get(NWS_ALERTS_URL, params={"point": f"{key[0]},{key[1]}"}, timeout=timeout,
                         headers={"User-Agent": USER_AGENT, "Accept": "application/geo+json"})
        r.raise_for_status()
        feats = r.json().get("features") or []
    except Exception as e:  # noqa: BLE001 - reported, never filled in
        return {"warnings": [], "source": src,
                "note": f"Official warnings could not be fetched just now ({type(e).__name__}). Check weather.gov directly."}
    out = []
    for f in feats:
        p = f.get("properties") or {}
        out.append({"event": p.get("event"), "severity": p.get("severity"), "headline": p.get("headline"),
                    "onset": p.get("onset") or p.get("effective"), "ends": p.get("ends") or p.get("expires"),
                    "sender": p.get("senderName"), "url": p.get("@id") or f.get("id"),
                    "urgency": p.get("urgency"), "certainty": p.get("certainty")})
    res = {"warnings": out, "source": src, "retrieved": datetime.now(timezone.utc).isoformat(),
           "note": (f"{len(out)} official warning{'s' if len(out) != 1 else ''} active at your field point." if out else
                    "No official warnings are active at your field point right now.")
                   + " Source: US National Weather Service."}
    _nws_cache[key] = (_time.time(), res)
    return res


def evaluate(sub: sqlite3.Row, fc: dict, now: datetime | None = None) -> list[dict]:
    now = now or datetime.now(timezone.utc)
    th = json.loads(sub["thresholds"])
    types = set(json.loads(sub["types"]))
    cover_weeks = json.loads(sub["cover_weeks"] or "[]")
    d = fc["daily"]
    days = d["time"]
    today = now.date().isoformat()
    out = []
    lang = sub["lang"] or "en"
    t = TEXT.get(lang, TEXT["en"])

    def cover_on(day: str) -> float | None:
        if not cover_weeks:
            return None
        doy = datetime.fromisoformat(day).timetuple().tm_yday
        return cover_weeks[min((doy - 1) // 7, len(cover_weeks) - 1)]

    for i, day in enumerate(days):
        if day < today:
            continue
        tmin, tmax = d["temperature_2m_min"][i], d["temperature_2m_max"][i]
        p, w = d["precipitation_sum"][i], d["wind_speed_10m_max"][i]
        cov = cover_on(day)
        if "frost" in types and tmin is not None and tmin <= th["frost_c"]:
            out.append(("frost", day, tmin))
        if "heat" in types and tmax is not None and tmax >= th["heat_c"]:
            out.append(("heat", day, tmax))
        if "heavy_rain_bare" in types and p is not None and p >= th["heavy_rain_mm"] and (cov is None or cov < th["low_cover"]):
            out.append(("heavy_rain_bare", day, p))
        if "wind_low_cover" in types and w is not None and w >= th["wind_ms"] and (cov is None or cov < th["low_cover"]):
            out.append(("wind_low_cover", day, w))
    if "dry_down" in types:
        tot = sum(x or 0 for x in d["precipitation_sum"])
        if tot < th["dry_mm"] * 2:
            out.append(("dry_down", today, tot))
    res = []
    for typ, day, v in out:
        res.append({"type": typ, "day": day, "value": v, "key": f"{sub['field_id']}|{typ}|{day}",
                    "message": t[typ].format(v=v, d=day)})
    return res


def run_once(now: datetime | None = None) -> dict:
    """Evaluate every confirmed, active subscription. Returns what was sent/suppressed."""
    con = db()
    now = now or datetime.now(timezone.utc)
    report = {"evaluated": 0, "sent": [], "suppressed": []}
    for sub in con.execute("SELECT * FROM subscriptions WHERE confirmed=1 AND active=1").fetchall():
        report["evaluated"] += 1
        try:
            fc = forecast(sub["lat"], sub["lon"])
        except Exception as e:  # noqa: BLE001
            report["suppressed"].append({"sub": sub["id"], "reason": f"forecast unavailable: {e}"})
            continue
        if datetime.fromisoformat(fc["_retrieved"]) < now - timedelta(hours=12):
            report["suppressed"].append({"sub": sub["id"], "reason": "stale forecast"})
            continue
        th = json.loads(sub["thresholds"])
        hits = evaluate(sub, fc, now)
        fresh = []
        for h in hits:
            dup = con.execute("SELECT 1 FROM alert_log WHERE key=?", (h["key"],)).fetchone()
            recent = con.execute("SELECT created FROM alert_log WHERE field_id=? AND type=? ORDER BY id DESC LIMIT 1",
                                 (sub["field_id"], h["type"])).fetchone()
            if dup:
                report["suppressed"].append({**h, "reason": "duplicate"})
                continue
            if recent and datetime.fromisoformat(recent["created"]) > now - timedelta(hours=th.get("cooldown_h", 48)):
                report["suppressed"].append({**h, "reason": "cooldown"})
                continue
            fresh.append(h)
        hour = datetime.now().hour
        qs, qe = sub["quiet_start"], sub["quiet_end"]
        quiet = (qs <= hour or hour < qe) if qs > qe else (qs <= hour < qe)
        if fresh and quiet and not any(h["type"] in ("frost", "heavy_rain_bare") for h in fresh):
            report["suppressed"].append({"sub": sub["id"], "reason": "quiet hours (non-urgent)"})
            continue
        if fresh:
            t = TEXT.get(sub["lang"] or "en", TEXT["en"])
            body = "\n".join(f"• {h['message']}" for h in fresh) + \
                   f"\n\nField: {sub['field_name']}\nUnsubscribe: /api/alerts/unsubscribe?token={sub['token']}\n\n{t['footer']}"
            sent = _send(sub["email"], t["subject"].format(field=sub["field_name"]), body)
            for h in fresh:
                con.execute("INSERT INTO alert_log (sub_id, field_id, type, key, message, created, channel, path) VALUES (?,?,?,?,?,?,?,?)",
                            (sub["id"], sub["field_id"], h["type"], h["key"], h["message"], now.isoformat(), sent["channel"], sent["path"]))
            con.commit()
            report["sent"] += [{**h, **sent} for h in fresh]
    return report


def digest(sub_id: str, summary_lines: list[str]) -> dict:
    con = db()
    sub = con.execute("SELECT * FROM subscriptions WHERE id=?", (sub_id,)).fetchone()
    if not sub:
        return {"error": "unknown subscription"}
    t = TEXT.get(sub["lang"] or "en", TEXT["en"])
    body = "\n".join(summary_lines) + f"\n\nUnsubscribe: /api/alerts/unsubscribe?token={sub['token']}\n\n{t['footer']}"
    sent = _send(sub["email"], t["digest_subject"].format(field=sub["field_name"]), body)
    con.execute("INSERT INTO alert_log (sub_id, field_id, type, key, message, created, channel, path) VALUES (?,?,?,?,?,?,?,?)",
                (sub_id, sub["field_id"], "weekly_digest", f"digest-{sub_id}-{datetime.now():%Y%W}", "Weekly digest",
                 datetime.now(timezone.utc).isoformat(), sent["channel"], sent["path"]))
    con.commit()
    return sent


def history(field_id: str | None = None, limit: int = 100) -> list[dict]:
    con = db()
    q = "SELECT * FROM alert_log " + ("WHERE field_id=? " if field_id else "") + "ORDER BY id DESC LIMIT ?"
    rows = con.execute(q, ((field_id, limit) if field_id else (limit,))).fetchall()
    return [dict(r) for r in rows]
