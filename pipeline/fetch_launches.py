"""Orbital Retro — Module 3a: upcoming launch directory.

Source: Launch Library 2 (The Space Devs) — keyless, actively maintained.
Deliberate deviation from the context doc's r/SpaceX API, which has been
frozen since ~2022 and serves stale data. LL2 covers SpaceX plus all other
providers. Free tier is rate-limited (~15 req/hr): fine for scheduled runs,
do not poll interactively.

Exit codes: 0 success, 1 network/API failure after retries.
"""

import argparse
import logging
import sys
from datetime import datetime, timezone

import requests

from common import CONNECT_TIMEOUT_S, READ_TIMEOUT_S, build_session, write_atomic

LL2_URL = "https://ll.thespacedevs.com/2.2.0/launch/upcoming/"

log = logging.getLogger("launches")


def flatten_launch(item: dict) -> dict:
    mission = item.get("mission") or {}
    pad = item.get("pad") or {}
    status = item.get("status") or {}
    net_iso = item.get("net")
    net_epoch_ms = None
    if net_iso:
        net_epoch_ms = int(
            datetime.fromisoformat(net_iso.replace("Z", "+00:00")).timestamp() * 1000
        )
    return {
        "id": item.get("id"),
        "name": item.get("name", "").strip(),
        "provider": (item.get("launch_service_provider") or {}).get("name", ""),
        "vehicle": ((item.get("rocket") or {}).get("configuration") or {}).get("name", ""),
        "pad": pad.get("name", ""),
        "location": (pad.get("location") or {}).get("name", ""),
        "net_iso": net_iso,
        "net_epoch_ms": net_epoch_ms,
        "status": status.get("abbrev", ""),
        "status_full": status.get("name", ""),
        "mission_type": mission.get("type", ""),
        "orbit": ((mission.get("orbit") or {}).get("abbrev") or ""),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Launch Library 2 ingestor")
    parser.add_argument("--limit", type=int, default=12)
    parser.add_argument("--output", default="data/launches.json")
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s"
    )

    session = build_session()
    session.headers["User-Agent"] = "OrbitalRetro/1.0 (personal dashboard)"

    try:
        response = session.get(
            LL2_URL,
            params={"limit": args.limit, "mode": "normal"},
            timeout=(CONNECT_TIMEOUT_S, READ_TIMEOUT_S),
        )
        response.raise_for_status()
        payload = response.json()
        results = payload.get("results")
        if not isinstance(results, list):
            raise ValueError(f"Unexpected LL2 payload keys: {sorted(payload)[:5]}")
    except (requests.RequestException, ValueError) as exc:
        log.error("Launch fetch failed: %s", exc)
        return 1

    launches = [flatten_launch(item) for item in results]
    launches.sort(key=lambda l: l["net_epoch_ms"] or 0)

    payload = {
        "generated_at_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "count": len(launches),
        "launches": launches,
    }
    write_atomic(args.output, payload)
    log.info("Wrote %d launches -> %s", len(launches), args.output)
    return 0


if __name__ == "__main__":
    sys.exit(main())
