# CLAUDE.md

Read `Claude_AstroTrack_Context.md` first — it is the binding spec for
aesthetics (Theme A "Targeting Computer" / Theme B "LCARS", never mixed on
one page) and coding directives (GLSL-first retro looks, geometry/material
disposal, flat data for the frontend, retry + timeout on all ingestors).

Project status (2026-07-09): feature-complete, deployed, user-acceptance
tested (all checks passed incl. 60fps with 1500 sats; the D3 archive page
passed the same day: hover accuracy, resize redraw, nav, data consistency).
Maintenance mode — don't propose features unprompted; sound tuning is
user-approved as-is. Remaining future-work candidates: full-LCARS theme
toggle for the tactical view, pipeline pattern to a new data domain,
quality fallback if low-fps reports ever arrive.

## Deployment & operations

- Live: https://karanrp813.github.io/orbital-retro/ (repo karanrp813/orbital-retro)
- `.github/workflows/deploy.yml`: on push to master, daily cron 03:30 UTC,
  and manual dispatch → runs pipeline on the runner → deploys whole tree to
  Pages. Pipeline failure keeps the last good deploy live. NASA_API_KEY is
  a repo secret.
- Local: Windows scheduled task "Orbital Retro Data Refresh" daily 09:00
  runs `pipeline/refresh_all.py`; logs to `data/refresh.log` (self-trims).
- Staleness is user-visible via the LAST SYNC / DATA SYNC lines on both pages.

## Commands

- Refresh all data: `python pipeline/refresh_all.py`
- Serve: `python -m http.server 8000` from repo root (static JSON fetches)
- No build step, no package.json. Three.js 0.170.0 via jsdelivr import map.
- Windows shells spawned by an older parent may lack NASA_API_KEY: read
  `[Environment]::GetEnvironmentVariable('NASA_API_KEY','User')`.

## Verification pattern

Headless Edge screenshots against localhost:
`msedge --headless=new --user-data-dir=<fresh tmp dir> --window-size=1400,900
--virtual-time-budget=15000 --screenshot=<png> http://localhost:8000/...`
Gotchas: headless Edge enforces ~500px minimum window width (narrow shots
get cropped, not resized — probe with a page dumping innerWidth if unsure);
reused profiles cache CSS. Deep links exist for states needing a click:
`?lock=N` (NEO contact), `?mode=system`, `?body=mars` (body scan),
`launches.html#raw`. Audio is untestable headlessly.

Full acceptance standards (data integrity, fps, interaction, sound, mobile,
cross-browser) are in the 2026-07-09 session; key bars: 60fps sustained,
zero console errors, countdowns tick every second, CPA label LD == panel
MISS DIST LD, radar click selects same object as 3D.

## Pipeline (Python, `pipeline/`)

| Script | Source | Output | Notes |
|---|---|---|---|
| fetch_neo_feed.py | NASA NeoWs (key) | neo_feed.json | 7-day chunking; diameter filter uses MAX estimate; dedup by id keeps soonest approach; exit 2 = valid-but-empty |
| fetch_ephemeris.py | JPL Horizons (keyless) | ephemeris.json | ELEMENTS query (TA given → no Kepler solve for position); orbit polylines sampled uniform-E |
| fetch_launches.py | Launch Library 2 (keyless) | launches.json | r/SpaceX API is frozen since ~2022 — never use it. LL2 free tier ~15 req/hr: scheduled only |
| fetch_apod.py | NASA APOD (key) | apod.json | thumbs=true for video days |
| fetch_satellites.py | CelesTrak GP (keyless) | satellites.json | OPTIONAL in refresh_all (failure never blocks deploy); circular approx from mean elements; max 1 group fetch/hour |
| fetch_history.py | JPL SSD CAD (keyless) | neo_history.json | OPTIONAL; 180d of close approaches; diameter estimated from H (albedo 0.14); CAD has NO fields param — index by response's fields array |
| common.py | — | — | shared Retry session (5 tries, backoff 1.5, respects Retry-After) + atomic write (tmp + os.replace) |
| refresh_all.py | — | — | scheduled-task/CI entry point; paths resolved from own location; OPTIONAL set for enhancement layers |

## Data contracts (frontend depends on these)

- **SoA buffers**: neo_feed.json and satellites.json carry index-aligned flat
  numeric arrays consumed directly as Float32Array shader attributes; one
  draw call per layer. neo buffers are log-normalized 0–1
  (miss_distance_norm, diameter_norm, approach_phase, hazard_flag).
- **Ephemeris frame**: ecliptic AU; frontend maps (x,y,z)→(x,z,−y) and
  log-compresses radii per point (`compressRadius` in systemMap.js).
- **Satellite scale contract**: Earth mesh radius 12 units ↔ 6371 km;
  time_scale 90× real angular velocity. Changing the Earth mesh radius in
  asteroidField.js requires regenerating satellites.json.
- **NEO scene scale**: FIELD_INNER_R=28, SPAN=88 (exported from
  asteroidField.js); radar and moon placement invert the same log mapping.

## Frontend architecture (`js/`)

- `main.js` owns: render loop (ONE rAF + ONE THREE.Clock drives everything,
  including the 2D radar canvas), mode store subscription (all mode
  side-effects live in that one subscriber), dual selection state
  (`selected` = NEO index, `selectedBody` = system body index, each mode
  remembers its own camera framing), picking, deep links, sfx wiring
  (sounds fire only in gesture handlers, never in programmatic selects).
- `asteroidField.js`: asteroid Points + env. Orbit motion runs in the vertex
  shader; CPU mirrors the math only in `field.getPosition` (picking,
  brackets, radar, flyby). Dummy position attribute → `frustumCulled=false`
  is REQUIRED. Env split: neoGroup (earth+rings, NEO-mode only) vs stars
  (always visible).
- `radar.js`: storage-tube PPI — canvas faded (never cleared), echoes
  painted only when the sweep passes; ring labels invert the pipeline's log
  normalization to real lunar distances.
- `systemMap.js`: per-point log radial compression; bodies carry `info`
  (raw Horizons record) for the body-scan panel; also exports createNeoMoon.
- `flyby.js`: dashed tangent trajectory + Earth range line (two 2-vertex
  lines updated in place, zero allocations/frame) + velocity-paced marker.
- `hud.js`: type-out effect with cancellation tokens; `renderPanel(title,
  rows)` generic target panel (NEO lock vs body scan); per-second T-MINUS
  countdown (writes only when displayed second changes).
- `satellites.js`: 1500-sat Points layer, motion in vertex shader from mean
  elements; added to env.neoGroup so mode visibility is automatic.
- `sfx.js`: Web Audio square blips (lock/unlock/mode/toggle), lazy
  AudioContext, SND tab persisted in localStorage key `orbital-retro-sfx`.
- `state.js`: minimal observable store; `labels.js`: projected DOM labels.
- `launches.js` + `theme-b.css`: LCARS page — flat, no shadows/gradients,
  Antonio font, countdowns tick per second, raw-feed toggle panel.
- `history.js` + `history.html`: D3 (d3@7 esm via jsdelivr) scatter timeline,
  Theme A. Log Y in LD with the 1 LD lunar line; red = est diameter >= 140m;
  Delaunay nearest-point hover; ResizeObserver-driven redraws. Third tab
  "ARCHIVE" on index; blue ARCHIVE pill in the LCARS sidebar.

## Hard-won gotchas

- PowerShell: piping a value into `gh secret set` appends CRLF and corrupts
  it (NASA 403s in CI) — use `--body $value`. PS 5.1 mangles embedded double
  quotes in `git commit -m` here-strings — avoid `"` in commit messages.
- Bloom (threshold 0) saturates dense wireframes into blobs — tune line
  opacity down (earth is 0.28) rather than bloom strength first.
- LL2 names read "Vehicle | Mission" — split on `|` for display.
- NeoWs feed caps at 7 inclusive days per request; numbers arrive as strings.
- Headless Edge reports innerHeight ~93px less than --window-size while
  fixed-position elements and the screenshot surface use the full height —
  flow-layout pages look like they have dead space in screenshots when they
  don't. Trust an element-size probe over the screenshot.

## Candidate future work (only if the user asks)

Historical NEO data + D3 timeline (D3 is in the spec, never used yet);
full-LCARS variant of the tactical view (theme toggle); pipeline pattern
ported to a new data domain; quality fallback if low-fps reports arrive.
