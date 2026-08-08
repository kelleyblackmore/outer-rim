// missions.js — mission definitions + the phase runner (ring courses, spawn
// waves, objective tracking). Rings are generated over the live terrain so
// every course hugs the biome it flies through.
import * as THREE from 'three';
import { buildRing } from './models.js';

export const MISSION_ORDER = ['belt', 'dunes', 'glacier', 'clouds', 'ember'];

export const MISSIONS = {
  belt: {
    id: 'belt', name: 'KESSEL VERGE',
    par: 240,
    winMsg: 'The raider wing is dust drifting with the asteroids. The convoy lanes are safe — for now.',
    phases: [
      { type: 'clear', enemy: 'tie', count: 8, waves: 3, banner: 'RAIDERS ON SCOPE — ENGAGE' },
    ],
  },
  dunes: {
    id: 'dunes', name: 'JAKKARA',
    par: 300,
    winMsg: 'Course flown and raiders downed. The Jakkara settlements can breathe again.',
    phases: [
      { type: 'rings', count: 10, banner: 'FOLLOW THE NAV RINGS' },
      { type: 'clear', enemy: 'tie', count: 6, waves: 2, banner: 'RAIDERS INBOUND — ENGAGE' },
    ],
  },
  glacier: {
    id: 'glacier', name: 'VORN',
    par: 300,
    winMsg: 'Every probe silenced before it could phone home. The base stays hidden.',
    phases: [
      { type: 'clear', enemy: 'probe', count: 10, banner: 'PROBE DROIDS DETECTED — HUNT THEM DOWN' },
      { type: 'clear', enemy: 'tie', count: 4, waves: 1, banner: 'THEIR ESCORT FOUND YOU' },
    ],
  },
  clouds: {
    id: 'clouds', name: 'BESHAR',
    par: 330,
    winMsg: 'Slalom complete and the skies swept clean. The harvesters fly free.',
    phases: [
      { type: 'rings', count: 12, banner: 'THREAD THE NAV RINGS' },
      { type: 'clear', enemy: 'tie', count: 6, waves: 2, banner: 'RAIDERS DIVING OUT OF THE SUN' },
    ],
  },
  ember: {
    id: 'ember', name: 'EMBERON',
    par: 360,
    winMsg: 'The shield grid is down and the garrison is blind. The fleet can begin its landing.',
    phases: [
      { type: 'clear', enemy: 'generator', count: 4, turretsEach: 2, banner: 'DESTROY THE SHIELD GENERATORS' },
      { type: 'clear', enemy: 'tie', count: 5, waves: 1, banner: 'GARRISON SCRAMBLED — FINISH THIS' },
    ],
  },
};

export function createMissionRunner(ctx) {
  const { systems, flight, audio, onBanner, onObjective, onComplete } = ctx;
  const ship = flight.ship;

  let def = null, world = null, scene = null;
  let phaseIdx = -1, phase = null;
  let ringMeshes = [];              // {grp, pos, normal, passed}
  let nextRing = 0;
  let toSpawn = 0, waveSize = 0;
  let killTally = 0;
  let done = false;
  const prevShip = new THREE.Vector3();
  const V = new THREE.Vector3(), V2 = new THREE.Vector3();

  systems.setOnKill(kind => {
    if (!phase || phase.type !== 'clear') return;
    if (kind === phase.enemy) { killTally++; refreshObjective(); }
  });

  function start(missionDef, worldRef, sceneRef) {
    def = missionDef; world = worldRef; scene = sceneRef;
    phaseIdx = -1; done = false;
    clearRings();
    prevShip.copy(ship.position);
    nextPhase();
  }

  function clearRings() {
    for (const r of ringMeshes) {
      scene && scene.remove(r.grp);
      r.grp.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
    }
    ringMeshes = [];
    nextRing = 0;
  }

  function stop() { clearRings(); def = null; phase = null; done = true; }

  // ---- ring course: seeded wander ahead of the spawn point, hugging terrain ----
  function buildCourse(count) {
    const pts = [];
    let heading = 0;                           // heading 0 = world -Z, the spawn facing
    const pos = new THREE.Vector3(ship.position.x, ship.position.y, ship.position.z - 300);
    for (let i = 0; i < count; i++) {
      const step = 300 + Math.random() * 90;
      heading += (Math.random() - 0.5) * 0.85;
      // steer the course back toward the core so it never leaves the patrol zone
      const hd = Math.hypot(pos.x, pos.z);
      if (hd > world.boundsR * 0.7) {
        const toCore = Math.atan2(-pos.x, pos.z);   // heading of the core in this convention
        let d = toCore - heading;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        heading += d * 0.45;
      }
      pos.x += Math.sin(heading) * step;
      pos.z += -Math.cos(heading) * step;
      // altitude: hug the terrain at varied heights; free band in space
      let y;
      if (world.getHeight) {
        const floor = flight.floorAt(pos.x, pos.z);
        y = floor + 40 + Math.random() * 90;
      } else {
        y = ship.position.y + (Math.random() - 0.5) * 180;
      }
      pos.y = y;
      pts.push(pos.clone());
    }
    // build meshes oriented along the course
    for (let i = 0; i < pts.length; i++) {
      const grp = buildRing();
      grp.scale.setScalar(1.8);                // pass radius ~16
      grp.position.copy(pts[i]);
      const nxt = pts[i + 1] || V.copy(pts[i]).multiplyScalar(2).sub(pts[i - 1] || ship.position);
      grp.lookAt(nxt.x, nxt.y, nxt.z);
      const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(grp.quaternion);
      grp.userData.setHot(i === 0);
      scene.add(grp);
      ringMeshes.push({ grp, pos: grp.position, normal, passed: false });
    }
  }

  function nextPhase() {
    phaseIdx++;
    if (phaseIdx >= def.phases.length) {
      done = true;
      onComplete();
      return;
    }
    phase = def.phases[phaseIdx];
    killTally = 0;
    if (phase.type === 'rings') {
      clearRings();
      buildCourse(phase.count);
    } else if (phase.type === 'clear') {
      if (phase.enemy === 'tie') {
        const waves = phase.waves || 1;
        waveSize = Math.ceil(phase.count / waves);
        toSpawn = phase.count;
        toSpawn -= systems.spawnTies(Math.min(waveSize, toSpawn));
      } else if (phase.enemy === 'probe') {
        systems.spawnProbes(scatterPositions(phase.count, 25, 90));
        toSpawn = 0;
      } else if (phase.enemy === 'generator') {
        const spots = scatterPositions(phase.count, 0, 0, 700);
        systems.spawnGenerators(spots);
        const tspots = [];
        for (const s of spots) {
          for (let i = 0; i < (phase.turretsEach || 0); i++) {
            const a = Math.random() * Math.PI * 2, r = 35 + Math.random() * 30;
            const x = s.x + Math.cos(a) * r, z = s.z + Math.sin(a) * r;
            tspots.push({ x, y: world.getHeight ? flight.floorAt(x, z) : s.y, z });
          }
        }
        systems.spawnTurrets(tspots);
        toSpawn = 0;
      }
    }
    if (phase.banner) onBanner(phase.banner, false);
    audio.objective();
    refreshObjective();
  }

  // scatter mission targets across the sector, on (or above) the local surface
  function scatterPositions(count, minAlt, altSpan, maxR = 1500) {
    const out = [];
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + Math.random() * 0.6;
      const r = 300 + Math.random() * (maxR - 300);
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      let y;
      if (world.getHeight) y = flight.floorAt(x, z) + minAlt + Math.random() * altSpan;
      else y = (Math.random() - 0.5) * 300;
      out.push({ x, y, z });
    }
    return out;
  }

  function refreshObjective() {
    if (!phase) { onObjective(''); return; }
    if (phase.type === 'rings') onObjective(`NAV RINGS  ${nextRing} / ${phase.count}`);
    else if (phase.enemy === 'tie') onObjective(`RAIDERS DOWN  ${killTally} / ${phase.count}`);
    else if (phase.enemy === 'probe') onObjective(`PROBES DESTROYED  ${killTally} / ${phase.count}`);
    else if (phase.enemy === 'generator') onObjective(`GENERATORS DOWN  ${killTally} / ${phase.count}`);
  }

  function update(dt) {
    if (!phase || done) return;

    if (phase.type === 'rings') {
      // ring pass: ship crossed the ring plane within the ring radius
      const rg = ringMeshes[nextRing];
      if (rg) {
        V.copy(prevShip).sub(rg.pos);
        V2.copy(ship.position).sub(rg.pos);
        const before = V.dot(rg.normal), after = V2.dot(rg.normal);
        if (before !== 0 && Math.sign(before) !== Math.sign(after) && Math.abs(before) < 60) {
          // radial distance at the crossing
          V2.addScaledVector(rg.normal, -after);
          if (V2.length() < 16.5) {
            rg.passed = true;
            rg.grp.userData.setHot(false);
            rg.grp.userData.torus.material.emissive.set(0x2a6a2a);
            systems.run.score += 50;
            audio.ring();
            nextRing++;
            if (ringMeshes[nextRing]) ringMeshes[nextRing].grp.userData.setHot(true);
            refreshObjective();
            if (nextRing >= ringMeshes.length) { onBanner('COURSE COMPLETE', false); nextPhase(); }
          }
        }
      }
      // spin the hot ring's pods gently
      const hot = ringMeshes[nextRing];
      if (hot) hot.grp.rotation.z += dt * 0.4;
    } else if (phase.type === 'clear') {
      if (phase.enemy === 'tie') {
        if (toSpawn > 0 && systems.aliveCount('tie') === 0) {
          toSpawn -= systems.spawnTies(Math.min(waveSize, toSpawn));
          onBanner('NEXT WAVE INBOUND', true);
        }
        if (toSpawn <= 0 && killTally >= phase.count) nextPhase();
      } else if (killTally >= phase.count) {
        // probes/generators fully placed up front
        nextPhase();
      }
    }
    prevShip.copy(ship.position);
  }

  // HUD objective info: guidance point + ring list for radar/markers
  function objectiveInfo() {
    if (!phase || done) return null;
    if (phase.type === 'rings') {
      const rg = ringMeshes[nextRing];
      return { point: rg ? rg.pos : null, rings: ringMeshes, nextRing };
    }
    // nearest alive target of the phase kind
    let best = null, bestD = Infinity;
    const pool = phase.enemy === 'tie' ? systems.ties : phase.enemy === 'probe' ? systems.probes : systems.generators;
    for (const e of pool) {
      if (!e.active) continue;
      const d = e.grp.position.distanceToSquared(ship.position);
      if (d < bestD) { bestD = d; best = e; }
    }
    return { point: best ? best.grp.position : null, rings: null, nextRing: 0 };
  }

  return { start, stop, update, objectiveInfo, refreshObjective,
    get def() { return def; }, get done() { return done; }, get phaseIdx() { return phaseIdx; },
    get ringsPassed() { return nextRing; } };
}
