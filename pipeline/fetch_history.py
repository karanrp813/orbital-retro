"""Orbital Retro — Module 5: historical close-approach archive.

Source: JPL SSD CAD API (keyless) — one request covers months of Earth
close approaches. Diameter is estimated from absolute magnitude H with the
standard assumed albedo 0.14: d_km = (1329/sqrt(0.14)) * 10^(-0.2*H).

Exit codes: 0 success, 1 network/API failure, 2 empty result.
"""

import argparse
import logging
import math
import sys
from datetime import datetime, timedelta, timezone

import requests

from common import CONNECT_TIMEOUT_S, READ_TIMEOUT_S, build_session, write_atomic

CAD_URL = "https://ssd-api.jpl.nasa.gov/cad.api"
AU_KM = 149597870.7
LUNAR_KM = 384400.0
ALBEDO = 0.14

log = logging.getLogger("history")


def est_diameter_m(h_mag):
    if h_mag is None:
        return None
    d_km = (1329.0 / math.sqrt(ALBEDO)) * (10 ** (-0.2 * h_mag))
    return round(d_km * 1000, 1)


def main() -> int:
    parser = argparse.ArgumentParser(description="JPL CAD close-approach archive")
    parser.add_argument("--days", type=int, default=180)
    parser.add_argument("--dist-max-ld", type=float, default=20.0)
    parser.add_argument("--output", default="data/neo_history.json")
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s"
    )

    today = datetime.now(timezone.utc).date()
    # CAD has no field-selection param; it returns a fixed column set that we
    # index by the `fields` array in the response.
    params = {
        "date-min": (today - timedelta(days=args.days)).isoformat(),
        "date-max": today.isoformat(),
        "dist-max": f"{args.dist_max_ld:g}LD",
    }

    session = build_session()
    try:
        response = session.get(
            CAD_URL, params=params, timeout=(CONNECT_TIMEOUT_S, READ_TIMEOUT_S)
        )
        response.raise_for_status()
        payload = response.json()
        fields = payload.get("fields")
        if not isinstance(fields, list):
            raise ValueError(f"Unexpected CAD payload keys: {sorted(payload)[:5]}")
    except (requests.RequestException, ValueError) as exc:
        log.error("CAD fetch failed: %s", exc)
        return 1

    idx = {name: i for i, name in enumerate(fields)}
    records = []
    for row in payload.get("data") or []:
        try:
            when = datetime.strptime(row[idx["cd"]], "%Y-%b-%d %H:%M").replace(
                tzinfo=timezone.utc
            )
            dist_ld = float(row[idx["dist"]]) * AU_KM / LUNAR_KM
            v_kps = float(row[idx["v_rel"]])
        except (KeyError, TypeError, ValueError):
            continue
        h_raw = row[idx["h"]] if "h" in idx else None
        h_mag = float(h_raw) if h_raw not in (None, "") else None
        records.append(
            {
                "des": row[idx["des"]],
                "epoch_ms": int(when.timestamp() * 1000),
                "date": when.date().isoformat(),
                "dist_ld": round(dist_ld, 3),
                "v_kps": round(v_kps, 2),
                "h_mag": h_mag,
                "est_diameter_m": est_diameter_m(h_mag),
            }
        )

    records.sort(key=lambda r: r["epoch_ms"])
    out = {
        "generated_at_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "days": args.days,
        "dist_max_ld": args.dist_max_ld,
        "count": len(records),
        "records": records,
    }
    write_atomic(args.output, out)
    inside_lunar = sum(1 for r in records if r["dist_ld"] < 1)
    log.info(
        "Wrote %d approaches (%d inside lunar orbit) -> %s",
        len(records), inside_lunar, args.output,
    )
    return 0 if records else 2


if __name__ == "__main__":
    sys.exit(main())
