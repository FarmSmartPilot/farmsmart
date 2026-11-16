"""Paths, environment and shared HTTP session."""
from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")

DATA = ROOT / "data"
CACHE = DATA / "cache"
CACHE.mkdir(parents=True, exist_ok=True)
RULES_DIR = ROOT / "engine" / "rules"
STRATEGIES_DIR = ROOT / "engine" / "strategies"
MODELS_DIR = ROOT / "models"
ARTIFACTS = MODELS_DIR / "artifacts"
ARTIFACTS.mkdir(parents=True, exist_ok=True)
OUTBOX = ROOT / "alerts" / "outbox"
OUTBOX.mkdir(parents=True, exist_ok=True)
DB_PATH = DATA / "fieldshift.db"
PRECOMP = DATA / "precomputed"  # committed, small JSON results for pilots (demo fallback)
PRECOMP.mkdir(parents=True, exist_ok=True)

USER_AGENT = os.getenv("FIELDSHIFT_USER_AGENT", "FarmSmart/0.1 (Space Apps 2026)")


def env(name: str) -> str | None:
    v = os.getenv(name)
    return v.strip() if v and v.strip() else None


def keys_status() -> dict[str, bool]:
    return {
        "earthdata": bool(env("EARTHDATA_TOKEN") or (env("EARTHDATA_USERNAME") and env("EARTHDATA_PASSWORD"))),
        "nass": bool(env("NASS_API_KEY")),
        "ams": bool(env("AMS_API_KEY")),
        "openet": bool(env("OPENET_API_KEY")),
        "cds": bool(env("CDS_API_KEY")),
        "cesium": bool(env("VITE_CESIUM_ION_TOKEN")),
        "smtp": bool(env("SMTP_HOST") and env("SMTP_USER")),
        "resend": bool(env("RESEND_API_KEY")),
        "llm": bool(env("ANTHROPIC_API_KEY")),
    }


@lru_cache(maxsize=1)
def http():
    """requests session with an on-disk cache (data/cache/http.sqlite). Responses never expire
    for historical queries; callers pass expire_after for live data."""
    import requests_cache
    s = requests_cache.CachedSession(
        str(CACHE / "http"), backend="sqlite", expire_after=-1,
        allowable_methods=("GET", "POST"), allowable_codes=(200,),
    )
    s.headers["User-Agent"] = USER_AGENT
    return s
