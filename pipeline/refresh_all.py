"""Runs every Orbital Retro ingestor in sequence; entry point for the
Windows scheduled task. All paths are resolved from this file's location so
the task needs no working-directory configuration.

Exit codes: 0 all succeeded (empty-after-filter counts as success), 1 otherwise.
"""

import os
import subprocess
import sys
from datetime import datetime, timezone

PIPELINE_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(PIPELINE_DIR)
DATA_DIR = os.path.join(ROOT, "data")
LOG_PATH = os.path.join(DATA_DIR, "refresh.log")
LOG_MAX_BYTES = 512 * 1024

SCRIPTS = [
    ("fetch_neo_feed.py", ["--output", os.path.join(DATA_DIR, "neo_feed.json")]),
    ("fetch_ephemeris.py", ["--output", os.path.join(DATA_DIR, "ephemeris.json")]),
    ("fetch_launches.py", ["--output", os.path.join(DATA_DIR, "launches.json")]),
    ("fetch_apod.py", ["--output", os.path.join(DATA_DIR, "apod.json")]),
    ("fetch_satellites.py", ["--output", os.path.join(DATA_DIR, "satellites.json")]),
    ("fetch_history.py", ["--output", os.path.join(DATA_DIR, "neo_history.json")]),
]

# Enhancement layers: their failure is logged but never blocks a deploy.
OPTIONAL = {"fetch_satellites.py", "fetch_history.py"}


def trim_log() -> None:
    try:
        if os.path.getsize(LOG_PATH) > LOG_MAX_BYTES:
            with open(LOG_PATH, "r", encoding="utf-8", errors="replace") as fh:
                tail = fh.read()[-LOG_MAX_BYTES // 2 :]
            with open(LOG_PATH, "w", encoding="utf-8") as fh:
                fh.write(tail)
    except OSError:
        pass


def main() -> int:
    os.makedirs(DATA_DIR, exist_ok=True)
    trim_log()
    failures = []
    with open(LOG_PATH, "a", encoding="utf-8") as log:
        log.write(
            f"\n=== refresh {datetime.now(timezone.utc).isoformat(timespec='seconds')} ===\n"
        )
        for script, args in SCRIPTS:
            proc = subprocess.run(
                [sys.executable, os.path.join(PIPELINE_DIR, script), *args],
                capture_output=True,
                text=True,
                cwd=PIPELINE_DIR,
                timeout=600,
            )
            log.write(proc.stdout)
            log.write(proc.stderr)
            log.write(f"--- {script} exit {proc.returncode}\n")
            # exit 2 = valid-but-empty output; not a failure
            if proc.returncode not in (0, 2) and script not in OPTIONAL:
                failures.append(script)
        log.write(f"=== done, failures: {failures or 'none'} ===\n")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
