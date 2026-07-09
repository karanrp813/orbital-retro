"""Orbital Retro — Module 2: JPL Horizons ephemeris ingestor.

Fetches current osculating orbital elements for the planets (heliocentric)
and the Moon (geocentric) from the keyless Horizons API, then computes each
body's current position and a closed orbit polyline in Python so the frontend
does zero ephemeris math.

Output frame: ecliptic, distances in AU. Three.js consumers map ecliptic
(x, y, z) -> scene (x, z_ecl, -y_ecl) to get Y-up.

Exit codes: 0 success, 1 network/API failure after retries.
"""

import argparse
import logging
import math
import sys
from datetime import datetime, timedelta, timezone

import requests

from common import CONNECT_TIMEOUT_S, READ_TIMEOUT_S, build_session, write_atomic

HORIZONS_URL = "https://ssd.jpl.nasa.gov/api/horizons.api"

# (name, Horizons body id, orbit center)
BODIES = [
    ("mercury", "199", "sun"),
    ("venus", "299", "sun"),
    ("earth", "399", "sun"),
    ("mars", "499", "sun"),
    ("jupiter", "599", "sun"),
    ("saturn", "699", "sun"),
    ("uranus", "799", "sun"),
    ("neptune", "899", "sun"),
    ("moon", "301", "earth"),
]

CENTERS = {"sun": "500@10", "earth": "500@399"}

# IAU mean radii; Horizons only exposes these inside free-text OBJ_DATA.
RADIUS_KM = {
    "sun": 695700.0,
    "mercury": 2439.7,
    "venus": 6051.8,
    "earth": 6371.0,
    "moon": 1737.4,
    "mars": 3389.5,
    "jupiter": 69911.0,
    "saturn": 58232.0,
    "uranus": 25362.0,
    "neptune": 24622.0,
}

log = logging.getLogger("horizons")


def fetch_elements(session: requests.Session, body_id: str, center: str) -> dict:
    """One osculating-element record for `body_id` at today's epoch."""
    today = datetime.now(timezone.utc).date()
    params = {
        "format": "json",
        "COMMAND": f"'{body_id}'",
        "OBJ_DATA": "'NO'",
        "MAKE_EPHEM": "'YES'",
        "EPHEM_TYPE": "'ELEMENTS'",
        "CENTER": f"'{CENTERS[center]}'",
        "START_TIME": f"'{today.isoformat()}'",
        "STOP_TIME": f"'{(today + timedelta(days=1)).isoformat()}'",
        "STEP_SIZE": "'1 d'",
        "OUT_UNITS": "'AU-D'",
        "REF_PLANE": "'ECLIPTIC'",
        "CSV_FORMAT": "'YES'",
    }
    response = session.get(
        HORIZONS_URL, params=params, timeout=(CONNECT_TIMEOUT_S, READ_TIMEOUT_S)
    )
    response.raise_for_status()
    result = response.json().get("result", "")
    if "$$SOE" not in result:
        raise ValueError(
            f"Horizons returned no ephemeris for body {body_id}: {result[:200]!r}"
        )
    first_line = result.split("$$SOE")[1].split("$$EOE")[0].strip().splitlines()[0]
    cols = [c.strip() for c in first_line.split(",")]
    # CSV columns: JDTDB, Calendar, EC, QR, IN, OM, W, Tp, N, MA, TA, A, AD, PR
    if len(cols) < 14:
        raise ValueError(f"Unexpected Horizons CSV for body {body_id}: {first_line!r}")
    return {
        "jd": float(cols[0]),
        "e": float(cols[2]),
        "inc": math.radians(float(cols[4])),
        "raan": math.radians(float(cols[5])),
        "argp": math.radians(float(cols[6])),
        "ta": math.radians(float(cols[10])),
        "a_au": float(cols[11]),
        "period_days": float(cols[13]),
        "inc_deg": float(cols[4]),
    }


def perifocal_to_ecliptic(xp, yp, inc, raan, argp):
    """Rotate a point in the orbital (perifocal) plane into ecliptic coords."""
    cw, sw = math.cos(argp), math.sin(argp)
    co, so = math.cos(raan), math.sin(raan)
    ci, si = math.cos(inc), math.sin(inc)
    x = xp * (cw * co - sw * so * ci) - yp * (sw * co + cw * so * ci)
    y = xp * (cw * so + sw * co * ci) + yp * (cw * co * ci - sw * so)
    z = xp * (sw * si) + yp * (cw * si)
    return x, y, z


def position_from_elements(el: dict):
    """Current position: Horizons hands us true anomaly directly."""
    nu, a, e = el["ta"], el["a_au"], el["e"]
    r = a * (1 - e * e) / (1 + e * math.cos(nu))
    return perifocal_to_ecliptic(
        r * math.cos(nu), r * math.sin(nu), el["inc"], el["raan"], el["argp"]
    )


def orbit_polyline(el: dict, samples: int):
    """Closed orbit path, sampled uniformly in eccentric anomaly for even
    spacing. Flat [x0,y0,z0, x1,...] for direct Float32Array/LineLoop use."""
    a, e = el["a_au"], el["e"]
    flat = []
    for k in range(samples):
        ecc_anom = (k / samples) * 2 * math.pi
        nu = 2 * math.atan2(
            math.sqrt(1 + e) * math.sin(ecc_anom / 2),
            math.sqrt(1 - e) * math.cos(ecc_anom / 2),
        )
        r = a * (1 - e * math.cos(ecc_anom))
        x, y, z = perifocal_to_ecliptic(
            r * math.cos(nu), r * math.sin(nu), el["inc"], el["raan"], el["argp"]
        )
        flat.extend((round(x, 6), round(y, 6), round(z, 6)))
    return flat


def main() -> int:
    parser = argparse.ArgumentParser(description="JPL Horizons ephemeris ingestor")
    parser.add_argument("--output", default="data/ephemeris.json")
    parser.add_argument("--orbit-samples", type=int, default=128)
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s"
    )

    session = build_session()
    bodies = [
        {
            "name": "sun",
            "label": "[ SOL ]",
            "center": None,
            "radius_km": RADIUS_KM["sun"],
            "pos": [0.0, 0.0, 0.0],
        }
    ]
    orbits = {}
    epoch_jd = None

    try:
        for name, body_id, center in BODIES:
            el = fetch_elements(session, body_id, center)
            pos = position_from_elements(el)
            bodies.append(
                {
                    "name": name,
                    "label": f"[ {name.upper()} ]",
                    "center": center,
                    "a_au": el["a_au"],
                    "e": round(el["e"], 6),
                    "inc_deg": round(el["inc_deg"], 3),
                    "period_days": round(el["period_days"], 2),
                    "radius_km": RADIUS_KM[name],
                    "pos": [round(v, 8) for v in pos],
                }
            )
            orbits[name] = orbit_polyline(el, args.orbit_samples)
            epoch_jd = epoch_jd or el["jd"]
            log.info(
                "%-8s a=%.4f AU  e=%.4f  |r|=%.4f AU", name, el["a_au"], el["e"],
                math.dist(pos, (0, 0, 0)),
            )
    except (requests.RequestException, ValueError) as exc:
        log.error("Horizons fetch failed: %s", exc)
        return 1

    payload = {
        "generated_at_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "epoch_jd": epoch_jd,
        "units": {"distance": "au", "frame": "ecliptic"},
        "orbit_samples": args.orbit_samples,
        "bodies": bodies,
        "orbits": orbits,
    }
    write_atomic(args.output, payload)
    log.info("Wrote %d bodies -> %s", len(bodies), args.output)
    return 0


if __name__ == "__main__":
    sys.exit(main())
