"""Refresh the committed market snapshots (wave U7).

    python scripts/update_markets.py            # WASDE + baseline projections + NASS monthly prices
    python scripts/update_markets.py --no-nass  # skip NASS (no key needed)

Writes data/reference/markets_wasde.json, markets_projections.json and markets_nass_monthly.json; downloaded source
files are cached under data/cache/markets/. Run after each WASDE release (monthly, about the 10th) and after the
NASS Agricultural Prices report (end of each month). The NASS key is read from .env and never printed.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fieldshift.ingest.markets import write_snapshots  # noqa: E402


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--no-nass", action="store_true", help="do not refresh the NASS monthly price snapshot")
    a = ap.parse_args()
    print(json.dumps(write_snapshots(nass=not a.no_nass), indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
