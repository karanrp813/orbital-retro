"""Orbital Retro — Module 1: NASA NeoWs ingestor.

Pulls the next N days of near-Earth objects from the NeoWs feed endpoint,
filters to objects whose estimated diameter can exceed a threshold, and emits
a flattened JSON file shaped for zero-transform consumption by the Three.js
frontend (flat record array + index-aligned structure-of-arrays buffers).

Exit codes: 0 success, 1 network/API failure after retries, 2 empty-after-filter.
"""

import argparse
import logging
import math
import os
import sys
from datetime import date, datetime, timedelta, timezone

import requests

from common import CONNECT_TIMEOUT_S, READ_TIMEOUT_S, build_session, write_atomic

FEED_URL = "https://api.nasa.gov/neo/rest/v1/feed"
# NeoWs feed rejects spans wider than 7 days (inclusive), i.e. start + 6.
MAX_SPAN_DAYS = 7

log = logging.getLogger("neows")


def chunk_date_range(start: date, days: int):
    """Yield (chunk_start, chunk_end) pairs, each spanning <= MAX_SPAN_DAYS inclusive."""
    remaining = days
    cursor = start
    while remaining > 0:
        span = min(remaining, MAX_SPAN_DAYS)
        yield cursor, cursor + timedelta(days=span - 1)
        cursor += timedelta(days=span)
        remaining -= span


def fetch_feed(session: requests.Session, api_key: str, start: date, days: int) -> dict:
    """Fetch the feed across chunks; returns {date_str: [neo, ...]} merged."""
    merged: dict = {}
    for chunk_start, chunk_end in chunk_date_range(start, days):
        params = {
            "start_date": chunk_start.isoformat(),
            "end_date": chunk_end.isoformat(),
            "api_key": api_key,
        }
        log.info("Fetching %s -> %s", params["start_date"], params["end_date"])
        response = session.get(
            FEED_URL, params=params, timeout=(CONNECT_TIMEOUT_S, READ_TIMEOUT_S)
        )
        response.raise_for_status()
        payload = response.json()
        by_date = payload.get("near_earth_objects")
        if not isinstance(by_date, dict):
            raise ValueError(
                f"Unexpected NeoWs payload for {params['start_date']}: "
                f"missing 'near_earth_objects' (keys: {sorted(payload)[:5]})"
            )
        merged.update(by_date)
        log.info(
            "  %d dates, %d objects",
            len(by_date),
            sum(len(v) for v in by_date.values()),
        )
    return merged


def flatten_neo(neo: dict, approach: dict) -> dict:
    """One NEO + its soonest close approach → flat record, numerics pre-parsed."""
    diameter = neo["estimated_diameter"]["meters"]
    d_min = float(diameter["estimated_diameter_min"])
    d_max = float(diameter["estimated_diameter_max"])
    name = neo.get("name", "").strip("() ")
    return {
        "id": neo["id"],
        "name": name,
        "designation_label": f"[ {name.upper()} ]",
        "absolute_magnitude_h": neo.get("absolute_magnitude_h"),
        "diameter_min_m": round(d_min, 1),
        "diameter_max_m": round(d_max, 1),
        "diameter_mid_m": round((d_min + d_max) / 2, 1),
        "is_hazardous": bool(neo.get("is_potentially_hazardous_asteroid")),
        "approach_epoch_ms": int(approach["epoch_date_close_approach"]),
        "approach_date": approach["close_approach_date"],
        "velocity_kps": round(
            float(approach["relative_velocity"]["kilometers_per_second"]), 3
        ),
        "miss_distance_km": round(float(approach["miss_distance"]["kilometers"]), 1),
        "miss_distance_lunar": round(float(approach["miss_distance"]["lunar"]), 2),
        "orbiting_body": approach.get("orbiting_body", "Earth"),
        "nasa_jpl_url": neo.get("nasa_jpl_url", ""),
    }


def filter_and_flatten(by_date: dict, min_diameter_m: float) -> list:
    """Filter by diameter, dedup by id keeping the soonest approach, flatten."""
    kept: dict = {}
    total = 0
    for neos in by_date.values():
        for neo in neos:
            total += 1
            d_max = float(
                neo["estimated_diameter"]["meters"]["estimated_diameter_max"]
            )
            if d_max <= min_diameter_m:
                continue
            approaches = neo.get("close_approach_data") or []
            if not approaches:
                continue
            approach = min(
                approaches, key=lambda a: int(a["epoch_date_close_approach"])
            )
            record = flatten_neo(neo, approach)
            existing = kept.get(record["id"])
            if existing is None or record["approach_epoch_ms"] < existing["approach_epoch_ms"]:
                kept[record["id"]] = record
    records = sorted(kept.values(), key=lambda r: r["approach_epoch_ms"])
    log.info("Filter: fetched %d, kept %d (> %.0f m)", total, len(records), min_diameter_m)
    return records


def log_norm(values: list) -> list:
    """Log-normalize positive values to 0–1; constant input maps to 0.5."""
    logs = [math.log10(max(v, 1e-9)) for v in values]
    lo, hi = min(logs), max(logs)
    if hi - lo < 1e-12:
        return [0.5] * len(values)
    return [round((v - lo) / (hi - lo), 4) for v in logs]


def build_buffers(records: list, window_start: date, days: int) -> dict:
    """Index-aligned SoA arrays for direct Float32Array/BufferAttribute upload."""
    if not records:
        return {
            "miss_distance_norm": [],
            "diameter_norm": [],
            "velocity_kps": [],
            "approach_phase": [],
            "hazard_flag": [],
        }
    window_start_ms = datetime(
        window_start.year, window_start.month, window_start.day, tzinfo=timezone.utc
    ).timestamp() * 1000
    window_ms = days * 86400 * 1000
    return {
        "miss_distance_norm": log_norm([r["miss_distance_km"] for r in records]),
        "diameter_norm": log_norm([r["diameter_mid_m"] for r in records]),
        "velocity_kps": [r["velocity_kps"] for r in records],
        "approach_phase": [
            round(
                min(max((r["approach_epoch_ms"] - window_start_ms) / window_ms, 0.0), 1.0),
                4,
            )
            for r in records
        ],
        "hazard_flag": [1 if r["is_hazardous"] else 0 for r in records],
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="NeoWs feed ingestor (Orbital Retro)")
    parser.add_argument("--days", type=int, default=7, help="window size in days")
    parser.add_argument("--min-diameter", type=float, default=50.0, help="meters")
    parser.add_argument("--output", default="data/neo_feed.json")
    parser.add_argument("--api-key", default=None)
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s"
    )

    api_key = args.api_key or os.environ.get("NASA_API_KEY") or "DEMO_KEY"
    if api_key == "DEMO_KEY":
        log.warning("Using DEMO_KEY (30 req/hr, 50/day) - set NASA_API_KEY for production")

    window_start = datetime.now(timezone.utc).date()

    try:
        by_date = fetch_feed(build_session(), api_key, window_start, args.days)
    except (requests.RequestException, ValueError) as exc:
        log.error("Feed fetch failed: %s", exc)
        return 1

    records = filter_and_flatten(by_date, args.min_diameter)
    payload = {
        "generated_at_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "window_start": window_start.isoformat(),
        "window_end": (window_start + timedelta(days=args.days - 1)).isoformat(),
        "min_diameter_m": args.min_diameter,
        "count": len(records),
        "objects": records,
        "buffers": build_buffers(records, window_start, args.days),
    }
    write_atomic(args.output, payload)
    log.info("Wrote %d objects -> %s", len(records), args.output)

    if not records:
        log.warning("Zero objects after filter — check threshold or API window")
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
