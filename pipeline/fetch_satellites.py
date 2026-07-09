"""Orbital Retro — Module 4: multi-constellation satellite shell (CelesTrak GP).

Circular-orbit approximation from mean elements — km-scale accuracy over
hours, plenty for visualization. Satellites render as shells around the
Earth wireframe in the NEO view; the scale contract is Earth mesh radius
(12 scene units) <-> 6371 km, so Starlink sits at ~13 units, GNSS ~50,
the GEO belt ~79.

One GET per constellation group per run, with a politeness delay between
groups. CelesTrak asks for at most one fetch of the same group per hour:
scheduled runs only. A group that exceeds its plot cap is subsampled by
uniform stride (never truncated) so the shell stays complete; the real
catalog size is kept alongside for the frontend legend.

Exit codes: 0 success, 1 every group failed, 2 valid-but-empty output.
"""

import argparse
import logging
import math
import sys
import time
from datetime import datetime, timezone

import requests

from common import CONNECT_TIMEOUT_S, READ_TIMEOUT_S, build_session, write_atomic

GP_URL = "https://celestrak.org/NORAD/elements/gp.php"
MU_KM3_S2 = 398600.4418
EARTH_RADIUS_KM = 6371.0
EARTH_MESH_RADIUS = 12.0  # must match the Earth wireframe in asteroidField.js
TIME_SCALE = 90.0  # scene seconds per real second; ISS laps in ~62 s
GROUP_DELAY_S = 2.0

# (CelesTrak group, display label, plot cap). Order fixes the group index
# consumed by the frontend color table.
GROUPS = [
    ("starlink", "STARLINK", 2400),
    ("oneweb", "ONEWEB", 700),
    ("gnss", "GPS/GNSS", 160),
    ("weather", "WEATHER", 80),
    ("geo", "GEO BELT", 600),
    ("stations", "STATIONS", 30),
]

log = logging.getLogger("satellites")


def fetch_group(session, group):
    response = session.get(
        GP_URL,
        params={"GROUP": group, "FORMAT": "json"},
        timeout=(CONNECT_TIMEOUT_S, READ_TIMEOUT_S),
    )
    response.raise_for_status()
    sats = response.json()
    if not isinstance(sats, list):
        raise ValueError(f"Unexpected CelesTrak payload: {type(sats).__name__}")
    return sats


def to_elements(sat):
    """Returns (radius, inc, raan, m0, speed) scene-unit elements, or None
    when fields are missing or the orbit is too eccentric for the circular
    approximation."""
    try:
        n_rad_s = float(sat["MEAN_MOTION"]) * 2 * math.pi / 86400.0
        ecc = float(sat["ECCENTRICITY"])
        inc = math.radians(float(sat["INCLINATION"]))
        raan = math.radians(float(sat["RA_OF_ASC_NODE"]))
        m0 = math.radians(float(sat["MEAN_ANOMALY"]))
    except (KeyError, TypeError, ValueError):
        return None
    if ecc > 0.05 or n_rad_s <= 0:
        return None
    a_km = (MU_KM3_S2 / (n_rad_s**2)) ** (1 / 3)
    return (
        round(EARTH_MESH_RADIUS * a_km / EARTH_RADIUS_KM, 4),
        round(inc, 5),
        round(raan, 5),
        round(m0, 5),
        round(n_rad_s * TIME_SCALE, 6),
    )


def main() -> int:
    parser = argparse.ArgumentParser(description="CelesTrak GP ingestor")
    parser.add_argument("--output", default="data/satellites.json")
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s"
    )

    session = build_session()
    buffers = {"radius": [], "inc": [], "raan": [], "m0": [], "speed": [], "group": []}
    groups_meta = []
    failures = 0

    for gi, (group, label, cap) in enumerate(GROUPS):
        if gi:
            time.sleep(GROUP_DELAY_S)
        try:
            sats = fetch_group(session, group)
        except (requests.RequestException, ValueError) as exc:
            log.warning("Group %s failed: %s", group, exc)
            groups_meta.append({"key": group, "label": label, "catalog": 0, "plotted": 0})
            failures += 1
            continue

        elements = [e for e in (to_elements(s) for s in sats) if e]
        stride = max(1, math.ceil(len(elements) / cap))
        kept = elements[::stride][:cap]
        for radius, inc, raan, m0, speed in kept:
            buffers["radius"].append(radius)
            buffers["inc"].append(inc)
            buffers["raan"].append(raan)
            buffers["m0"].append(m0)
            buffers["speed"].append(speed)
            buffers["group"].append(gi)
        groups_meta.append(
            {"key": group, "label": label, "catalog": len(sats), "plotted": len(kept)}
        )
        log.info("%s: %d catalog -> %d plotted (stride %d)", group, len(sats), len(kept), stride)

    if failures == len(GROUPS):
        log.error("Every constellation group failed")
        return 1

    total = len(buffers["radius"])
    payload = {
        "generated_at_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "count": total,
        "catalog_total": sum(g["catalog"] for g in groups_meta),
        "groups": groups_meta,
        "earth_mesh_radius": EARTH_MESH_RADIUS,
        "time_scale": TIME_SCALE,
        "buffers": buffers,
    }
    write_atomic(args.output, payload)
    log.info("Wrote %d satellites across %d groups -> %s", total, len(GROUPS), args.output)
    return 0 if total else 2


if __name__ == "__main__":
    sys.exit(main())
