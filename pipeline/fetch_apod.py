"""Orbital Retro — Module 3b: NASA Astronomy Picture of the Day.

Exit codes: 0 success, 1 network/API failure after retries.
"""

import argparse
import logging
import os
import sys
from datetime import datetime, timezone

import requests

from common import CONNECT_TIMEOUT_S, READ_TIMEOUT_S, build_session, write_atomic

APOD_URL = "https://api.nasa.gov/planetary/apod"

log = logging.getLogger("apod")


def main() -> int:
    parser = argparse.ArgumentParser(description="NASA APOD ingestor")
    parser.add_argument("--output", default="data/apod.json")
    parser.add_argument("--api-key", default=None)
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s"
    )

    api_key = args.api_key or os.environ.get("NASA_API_KEY") or "DEMO_KEY"
    if api_key == "DEMO_KEY":
        log.warning("Using DEMO_KEY (30 req/hr, 50/day) - set NASA_API_KEY for production")

    session = build_session()
    try:
        response = session.get(
            APOD_URL,
            params={"api_key": api_key, "thumbs": "true"},
            timeout=(CONNECT_TIMEOUT_S, READ_TIMEOUT_S),
        )
        response.raise_for_status()
        apod = response.json()
        if "title" not in apod:
            raise ValueError(f"Unexpected APOD payload keys: {sorted(apod)[:5]}")
    except (requests.RequestException, ValueError) as exc:
        log.error("APOD fetch failed: %s", exc)
        return 1

    payload = {
        "generated_at_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "date": apod.get("date"),
        "title": apod.get("title"),
        "explanation": apod.get("explanation", ""),
        "media_type": apod.get("media_type"),
        # For videos, thumbnail_url gives a displayable still.
        "url": apod.get("url"),
        "hdurl": apod.get("hdurl"),
        "thumbnail_url": apod.get("thumbnail_url"),
        "copyright": (apod.get("copyright") or "").strip(),
    }
    write_atomic(args.output, payload)
    log.info("Wrote APOD '%s' -> %s", payload["title"], args.output)
    return 0


if __name__ == "__main__":
    sys.exit(main())
