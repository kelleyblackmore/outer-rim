# OUTER RIM PATROL

A Star Wars-inspired free-flight starfighter game that runs entirely in the
browser. Full 3D flight -- pitch, turn, roll, throttle, boost -- across eight
sectors, from open patrol biomes to full-scale recreations of the saga's two
famous superweapon assaults.

**Play it:** https://kelleyblackmore.github.io/outer-rim/

A sibling project to [trench-run](https://github.com/kelleyblackmore/trench-run):
the same engine philosophy, but free flight instead of rails.

## Sectors

| Sector | Setting | Mission |
| --- | --- | --- |
| KESSEL VERGE | Asteroid belt | Destroy the raider wing among the rocks |
| JAKKARA | Desert world | Canyon nav-ring run, raiders, then fly home and land in the settlement's docking bay |
| VORN | Ice world | Hunt the probe droids before they report in |
| BESHAR | Gas giant | Ring slalom over the storm deck, then raiders |
| EMBERON | Volcanic world | Take down the turret-guarded shield grid at night |
| CORUSCANT | City planet | Take off from your hangar bay, run cargo through the tower canyons, land in docking bays |
| DEATH STAR | Battle of Yavin | Fight through the turbolaser grid, dive into the trench, torpedo the exhaust port before the station clears Yavin |
| STARKILLER BASE | Snow-forest world | Break the turret ring and breach the thermal oscillator while the weapon drains the sun |

Timed missions show a countdown; the Death Star clears Yavin in seven minutes,
and Starkiller's sun visibly drains as its weapon charges. On Coruscant and
Jakkara you land for real: approach a docking bay slow and shallow to touch
down, throttle up to lift off, or engage auto-land and let the ship bring
itself in.

## Pilot progression

Every mission pays experience (your full score on a win, a quarter on a loss)
and credits, with a first-clear bonus per sector. Ranks follow the Rebel
Starfighter Corps ladder: Flight Cadet, Flight Officer, Lieutenant, Captain,
Commander, Wing Commander, Red Leader, and finally Rogue Leader. The title
screen shows your service record: rank plaque, level, credits, and progress to
the next promotion. Everything persists in localStorage; there is no server
and no account.

## Shipyard

Customize your fighter on a live turntable. Paint is free: squadron stripe
(also colors your astromech), engine glow, and hull tone. Performance parts
are bought with mission credits:

| Airframe | Cost | Character |
| --- | --- | --- |
| X-WING | free | The all-rounder: four cannons, balanced stats |
| Y-WING | 800 | Bomber: slow and heavy, 130 shields, double torpedo rack |
| A-WING | 800 | Interceptor: fastest and most agile, light shields, two cannons |
| B-WING | 1500 | Assault gunship: slowest, toughest, three cannons, big rack |

Parts stack with the airframe: engines (balanced, interceptor, heavy),
shields (standard, reinforced, fast-recharge), cannons (quad, twin heavy,
rapid), and torpedo racks (standard, extended, seeker).

## Controls

- Mouse steers; the cursor pointer-locks during flight and Esc releases it to
  the pause menu. Arrow keys also steer.
- Q / E (or A / D) spin the ship; W / S throttle; Shift boosts.
- Space, click, or L fires lasers; F or right-click fires a proton torpedo
  (hold a target in the reticle to lock).
- G or X (or the on-screen button) engages auto-land when a docking bay is
  marked; hard stick input takes control back.
- Flight stick / HOTAS: the stick steers (pull back to climb), twist rolls,
  the throttle lever is absolute, trigger fires, thumb button fires torpedoes.
  Separate throttle quadrants are supported.
- Gamepad: left stick steers, dpad trims throttle, face buttons fire, boost,
  and launch torpedoes.
- Touch: virtual stick, auto-fire, and on-screen boost, torpedo, and throttle
  buttons.
- MAP CONTROLS in settings rebinds everything in flight: the game launches a
  mission and captures the next key, button, or throttle-axis push for each
  action in sequence.

## Settings

Invert pitch (flight-stick style on mouse, keys, and gamepad), steering
sensitivity, throttle response, stick deadzone, stick response curve,
auto-level assist (off by default -- you fly the ship), camera banking, and
speed-dust density. All persisted locally.

## Tech

- Three.js r160, vendored under `vendor/three/`: ES modules plus an import
  map, no build step, no CDN, works offline.
- Procedural everything: terrain heightfields (value-noise FBM shared by the
  mesh and the collision), gradient-shader skies, instanced props and cities,
  procedural ship models, canvas-generated textures, and fully synthesized
  Web Audio sound through a master compressor. No external assets.
- Rendering: quality-tiered soft shadow maps that follow the ship, per-world
  image-based lighting baked from the sky, UnrealBloom, FXAA, ACES tone
  mapping, radial warp blur on boost, and a vignette. Three quality tiers,
  auto-detected.
- Missions are data (`src/game/missions.js`): phase runners for rings,
  waypoint, clear, take-off, landing, and timed-countdown objectives, with
  ring courses generated over the live terrain.

## Development

Serve the folder with any static server and open the URL:

```bash
python -m http.server 8080
```

Append `?debug` to expose `window.__OR`, a deterministic harness used to test
the game headlessly: `step(frames)`, `start(id)`, `warp`, `aim`, `mock`,
`snap`, and manual `resize` for hidden panes.

Deployed to GitHub Pages by `.github/workflows/deploy.yml` on every push to
`main`.
