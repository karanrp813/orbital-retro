"""Orbital Retro — Module 4: LEO satellite shell (CelesTrak GP elements).

Circular-orbit approximation from mean elements — km-scale accuracy over
hours, plenty for visualization. Satellites render as a shell hugging the
Earth wireframe in the NEO view; the scale contract is Earth mesh radius
(12 scene units) <-> 6371 km, so a 550 km Starlink orbit sits at ~13 units.

CelesTrak asks for at most one group fetch per hour: scheduled runs only.

Exit codes: 0 success, 1 network/API failure, 2 empty output.
"""

import argparse
import logging
import math
import sys
from datetime import datetime, timezone

import requests

from common import CONNECT_TIMEOUT_S, READ_TIMEOUT_S, build_session, write_atomic

GP_URL = "https://celestrak.org/NORAD/elements/gp.php"
MU_KM3_S2 = 398600.4418
EARTH_RADIUS_KM = 6371.0
EARTH_MESH_RADIUS = 12.0  # must match the Earth wireframe in asteroidField.js
TIME_SCALE = 90.0  # scene seconds per real second; ISS laps in ~62 s

log = logging.getLogger("satellites")


def main() -> int:
    parser = argparse.ArgumentParser(description="CelesTrak GP ingestor")
    parser.add_argument("--group", default="starlink")
    parser.add_argument("--limit", type=int, default=1500)
    parser.add_argument("--output", default="data/satellites.json")
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s"
    )

    session = build_session()
    try:
        response = session.get(
            GP_URL,
            params={"GROUP": args.group, "FORMAT": "json"},
            timeout=(CONNECT_TIMEOUT_S, READ_TIMEOUT_S),
        )
        response.raise_for_status()
        sats = response.json()
        if not isinstance(sats, list):
            raise ValueError(f"Unexpected CelesTrak payload: {type(sats).__name__}")
    except (requests.RequestException, ValueError) as exc:
        log.error("Satellite fetch failed: %s", exc)
        return 1

    buffers = {"radius": [], "inc": [], "raan": [], "m0": [], "speed": []}
    kept = 0
    for s in sats:
        try:
            n_rad_s = float(s["MEAN_MOTION"]) * 2 * math.pi / 86400.0
            ecc = float(s["ECCENTRICITY"])
            inc = math.radians(float(s["INCLINATION"]))
            raan = math.radians(float(s["RA_OF_ASC_NODE"]))
            m0 = math.radians(float(s["MEAN_ANOMALY"]))
        except (KeyError, TypeError, ValueError):
            continue
        # circular approximation only holds for near-circular orbits
        if ecc > 0.05 or n_rad_s <= 0:
            continue
        a_km = (MU_KM3_S2 / (n_rad_s**2)) ** (1 / 3)
        buffers["radius"].append(round(EARTH_MESH_RADIUS * a_km / EARTH_RADIUS_KM, 4))
        buffers["inc"].append(round(inc, 5))
        buffers["raan"].append(round(raan, 5))
        buffers["m0"].append(round(m0, 5))
        buffers["speed"].append(round(n_rad_s * TIME_SCALE, 6))
        kept += 1
        if kept >= args.limit:
            break

    payload = {
        "generated_at_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "group": args.group,
        "count": kept,
        "earth_mesh_radius": EARTH_MESH_RADIUS,
        "time_scale": TIME_SCALE,
        "buffers": buffers,
    }
    write_atomic(args.output, payload)
    log.info("Wrote %d/%d %s satellites -> %s", kept, len(sats), args.group, args.output)
    return 0 if kept else 2


if __name__ == "__main__":
    sys.exit(main())
