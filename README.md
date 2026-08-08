# OUTER RIM PATROL — X-Wing Free Flight

A Star Wars–inspired **free-flight X-wing combat game** that runs entirely in the
browser. Full 3D flight — pitch, turn, roll, throttle, boost — across five patrol
sectors, each a different biome with its own missions:

| Sector | Biome | Mission |
| --- | --- | --- |
| **KESSEL VERGE** | Asteroid belt | Destroy the raider wing among the rocks |
| **JAKKARA** | Desert world | Nav-ring canyon run, then raiders |
| **VORN** | Ice world | Hunt the probe droids before they report in |
| **BESHAR** | Gas giant | Ring slalom over the cloud deck, then raiders |
| **EMBERON** | Volcanic world | Take down the turret-guarded shield grid |

**Play it:** https://kelleyblackmore.github.io/outer-rim/

A sibling project to [trench-run](https://github.com/kelleyblackmore/trench-run) —
same engine philosophy, but free flight instead of rails.

## Controls

- **Mouse / arrow keys** — pitch & turn (the ship banks into turns)
- **Q / E** (or **A / D**) — spin/roll · **W / S** — throttle · **Shift** — boost
- **Space / click / L** — quad lasers
- **F / right-click** — proton torpedo (hold an enemy in the reticle to lock)
- **P / Esc** — pause
- **Touch** — left virtual stick, auto-fire, BOOST / TORP / throttle buttons
- **Gamepad** — left stick steers, dpad throttle, face buttons fire/boost/torpedo

## Tech

- **Three.js r160, vendored** under `vendor/three/` — ES modules + import map,
  no build step, no CDN, works offline.
- Procedural everything: terrain heightfields (value-noise FBM shared by the
  mesh **and** collision), gradient-shader skies, instanced props, synthesized
  Web Audio sound. No external assets.
- Post-processing: UnrealBloom + FXAA + ACES tone mapping, with three quality
  tiers (auto-detected, cycles via the HIGH/MED/LOW button).
- Missions are data (`src/game/missions.js`): ring courses generated over the
  live terrain, spawn waves, per-sector best scores in `localStorage`.

## Development

Serve the folder with any static server and open the URL:

```bash
python -m http.server 8080
```

Append `?debug` to expose `window.__OR` (deterministic `step(frames)`, `start(id)`,
`warp`, `aim`, `mock`, `snap`, `resize` for headless testing).

Deployed to GitHub Pages by `.github/workflows/deploy.yml` on every push to `main`.
