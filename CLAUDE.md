# CLAUDE.md

Read `Claude_AstroTrack_Context.md` first — it is the binding spec for
aesthetics (Theme A "Targeting Computer" / Theme B "LCARS", never mixed on
one page) and coding directives (GLSL-first retro looks, geometry/material
disposal, flat data for the frontend, retry + timeout on all ingestors).

## Commands

- Refresh all data: `python pipeline/refresh_all.py` (also run daily at
  09:00 by the Windows scheduled task "Orbital Retro Data Refresh")
- Serve: `python -m http.server 8000` from repo root (frontend fetches
  `./data/*.json` as static files)
- No build step, no package.json. Three.js 0.170.0 comes from the jsdelivr
  import map in `index.html`.

## Verification pattern

Headless Edge screenshots against the local server:
`msedge --headless=new --user-data-dir=<tmp> --window-size=1400,900
--virtual-time-budget=15000 --screenshot=<png> http://localhost:8000/...`
Deep links exist for states that need a click: `?lock=N`, `?mode=system`,
`launches.html#raw`.

## Architecture notes

- `js/main.js` owns the render loop, mode store subscription, picking, and
  selection (`selectIndex`). One `requestAnimationFrame` + one `THREE.Clock`
  drive everything, including the 2D radar canvas.
- Asteroid motion runs in the vertex shader (`js/asteroidField.js`); CPU
  mirrors the orbit math only for picking/brackets via `field.getPosition`.
  The Points geometry has a dummy position attribute — `frustumCulled=false`
  is required.
- `js/radar.js` is a storage-tube PPI: the canvas is faded, never cleared;
  echoes are painted only when the sweep passes.
- `js/state.js` store is the single source of truth for view mode; all mode
  side-effects live in the one subscriber in main.js.
- `pipeline/common.py` holds the shared session (urllib3 Retry) and atomic
  write; every ingestor imports it. NeoWs exit code 2 = valid-but-empty.
- NASA_API_KEY is a user env var. Shells spawned by an older parent may not
  have it: read `[Environment]::GetEnvironmentVariable('NASA_API_KEY','User')`.
- Launch Library 2 free tier ~15 req/hr — never poll it interactively.
