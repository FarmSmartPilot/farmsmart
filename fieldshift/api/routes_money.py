"""POST /api/fields/{fid}/money: building blocks for the rotation money calculator (wave U6).

Body: the same as /compare. The result is cached in memory and on disk (data/cache/money/), keyed by field and body,
so pilot fields (precomputed by scripts/precompute_hazards.py) answer from disk."""
from __future__ import annotations

import hashlib
import json
import re
import threading
from typing import Any, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from .. import config
from ..ingest.losses import _cache_off

router = APIRouter()

MONEY_VERSION = "u9.2"  # bump when the output changes, so old disk entries are not served
MONEY_CACHE = config.CACHE / "money"
_FID = re.compile(r"^[0-9a-f]{6,40}$")
_mem: dict[str, Any] = {}
_locks: dict[str, threading.Lock] = {}


class MoneyIn(BaseModel):
    farm: Optional[dict] = None
    priorities: Optional[list[str]] = None
    baseline: Optional[list[dict]] = None
    scenario: str = "normal"
    budgets: Optional[dict] = None
    custom: Optional[list[dict]] = None


def money_key(fid: str, body: dict) -> str:
    b = {k: body.get(k) for k in ("farm", "priorities", "baseline", "scenario", "budgets", "custom")}
    b["budgets"] = b["budgets"] or None  # {} / [] mean "none", as in /compare
    b["custom"] = b["custom"] or None
    b["scenario"] = b["scenario"] or "normal"
    raw = json.dumps([MONEY_VERSION, fid, b], sort_keys=True)
    return f"{fid}_{hashlib.sha1(raw.encode()).hexdigest()[:16]}"


def compute(fid: str, body: dict, ctx: dict | None = None) -> dict:
    """Cached build (memory, then disk, then a fresh run)."""
    from . import money
    key = money_key(fid, body)
    if key in _mem:
        return _mem[key]
    lock = _locks.setdefault(key, threading.Lock())
    with lock:  # one run per key at a time; a second request waits for the first
        if key in _mem:
            return _mem[key]
        p = MONEY_CACHE / f"{key}.json"
        no_disk = _cache_off()  # test flag: build from committed data only, neither read nor write data/cache/money
        if p.exists() and not no_disk:
            out = json.loads(p.read_text(encoding="utf-8"))
        else:
            if ctx is None:
                from .main import _ctx  # lazy: main imports this module at start-up
                ctx = _ctx(fid)
            out = money.build(ctx, body)
            default = (not any(body.get(k) for k in ("farm", "priorities", "baseline", "budgets", "custom"))
                       and (body.get("scenario") or "normal") == "normal")
            if default and not no_disk and (out.get("available") or out.get("reason")):  # disk: default body only (bounded)
                MONEY_CACHE.mkdir(parents=True, exist_ok=True)
                p.write_text(json.dumps(out, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")
        if len(_mem) > 100:
            _mem.clear()
        _mem[key] = out
    _locks.pop(key, None)
    return out


@router.post("/api/fields/{fid}/money")
def money_blocks(fid: str, body: MoneyIn):
    if not _FID.match(fid):
        raise HTTPException(404, "unknown field")
    return compute(fid, body.model_dump())
