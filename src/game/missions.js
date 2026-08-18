// missions.js — mission definitions + the phase runner (ring courses, spawn
// waves, objective tracking). Rings are generated over the live terrain so
// every course hugs the biome it flies through.
import * as THREE from 'three';
import { buildRing } from './models.js';

export const MISSION_ORDER = ['belt', 'dunes', 'glacier', 'clouds', 'ember', 'city', 'deathstar', 'starkiller'];

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
    par: 380,
    winMsg: 'Course flown, raiders downed, and a clean set-down in the bay. The settlement can breathe again.',
    winTitle: 'SAFE IN THE BAY',
    phases: [
      { type: 'rings', count: 10, banner: 'FOLLOW THE NAV RINGS' },
      { type: 'clear', enemy: 'tie', count: 6, waves: 2, banner: 'RAIDERS INBOUND — ENGAGE' },
      { type: 'goto', at: { x: 620, z: -1150 }, alt: 170, radius: 100, text: 'HEAD FOR THE SETTLEMENT',
        banner: 'PATROL DONE — HEAD FOR THE SETTLEMENT' },
      { type: 'land', pad: 0, text: 'LAND IN THE DOCKING BAY · G / X = AUTO-LAND',
        banner: 'DOCKING BAY OPEN — SET DOWN INSIDE, OR HIT AUTO-LAND' },
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
  city: {
    id: 'city', name: 'CORUSCANT',
    par: 420,
    winTitle: 'ROUTE COMPLETE',
    winMsg: 'Cargo delivered, lanes swept clean, and a textbook final touchdown. Coruscant Control logs another perfect run.',
    phases: [
      { type: 'takeoff', pad: 0, text: 'THROTTLE UP — LIFT OFF', banner: 'CLEARANCE GRANTED — THROTTLE UP AND LIFT OFF' },
      { type: 'goto', at: { x: -360, z: -60 }, alt: 260, radius: 90, text: 'FOLLOW THE SKYLANE WEST',
        banner: 'FOLLOW THE SKYLANE — MIND THE TOWERS' },
      { type: 'land', pad: 1, text: 'LAND IN THE FREIGHT BAY · G / X = AUTO-LAND',
        banner: 'FREIGHT BAY OPEN — SET DOWN INSIDE, OR HIT AUTO-LAND' },
      { type: 'takeoff', text: 'THROTTLE UP — LIFT OFF', banner: 'CARGO LOADED — BACK INTO THE LANES' },
      { type: 'clear', enemy: 'tie', count: 4, waves: 1, banner: 'PIRATES IN THE LANES — RUN THEM OFF' },
      { type: 'land', pad: 0, text: 'RETURN HOME · G / X = AUTO-LAND', banner: 'ROUTE COMPLETE — COME HOME AND SET DOWN' },
    ],
  },
  deathstar: {
    id: 'deathstar', name: 'DEATH STAR',
    par: 420, timeLimit: 420,
    winTitle: 'GREAT SHOT, KID',
    winMsg: 'That was one in a million! The torpedoes are in — the Death Star is gone, and Yavin lives to see the dawn.',
    failMsg: 'The Death Star cleared the planet and fired. Yavin base is gone.',
    // full turret grid: turbolaser towers flanking the trench, emplacements inside it
    setup({ systems, flight }) {
      const towers = [], guns = [];
      for (let i = 0; i < 12; i++) {
        const x = (i % 2 ? 1 : -1) * (44 + Math.random() * 170);
        const z = 1100 - i * 200;
        towers.push({ x, y: flight.floorAt(x, z), z });
      }
      for (let i = 0; i < 10; i++) {
        const x = (i % 2 ? 1 : -1) * 13;
        const z = 400 - i * 175;
        guns.push({ x, y: flight.floorAt(x, z), z });
      }
      systems.spawnTurrets(towers, 'tower');
      systems.spawnTurrets(guns, 'turret');
    },
    phases: [
      { type: 'clear', enemy: 'tie', count: 6, waves: 2, banner: 'TIE PATROL INBOUND — CLEAR THE APPROACH' },
      { type: 'goto', at: { x: 0, z: 860 }, alt: 16, radius: 55, text: 'DIVE INTO THE TRENCH',
        banner: 'BEGIN YOUR ATTACK RUN — DIVE INTO THE TRENCH' },
      { type: 'clear', enemy: 'port', count: 1, spawnPort: { x: 0, z: -1400 }, ties: 3, silenceTurrets: true,
        text: 'TORPEDO THE EXHAUST PORT',
        banner: 'THE GUNS HAVE STOPPED — FIGHTERS BEHIND YOU. STAY ON TARGET' },
    ],
  },
  starkiller: {
    id: 'starkiller', name: 'STARKILLER BASE',
    par: 360, timeLimit: 360,
    winTitle: 'OSCILLATOR BREACHED',
    winMsg: 'The oscillator is down and the planet is tearing itself apart. All wings, pull up and jump clear.',
    failMsg: 'The sun is gone — Starkiller has fired on the Resistance base.',
    // oscillator (shielded until phase 2) + its turret ring
    setup({ systems, flight, world }) {
      const site = world.oscSite;
      const oy = flight.floorAt(site.x, site.z);
      systems.spawnOscillator({ x: site.x, y: oy, z: site.z }, true);
      const ring = [];
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        const r = 320 + (i % 3) * 90;
        const x = site.x + Math.cos(a) * r, z = site.z + Math.sin(a) * r;
        ring.push({ x, y: flight.floorAt(x, z), z });
      }
      systems.spawnTurrets(ring, 'turret');
    },
    phases: [
      { type: 'clear', enemy: 'tie', count: 6, waves: 2, banner: 'SPECIAL FORCES TIES INBOUND' },
      { type: 'clear', enemy: 'oscillator', count: 1, unshield: 'oscillator', ties: 3,
        text: 'DESTROY THE THERMAL OSCILLATOR',
        banner: 'SHIELDS DOWN — HIT THE OSCILLATOR VENT, EVERY RUN COUNTS' },
    ],
  },
};

export function createMissionRunner(ctx) {
  const { systems, flight, audio, onBanner, onObjective, onComplete, onFail } = ctx;
  const ship = flight.ship;

  let def = null, world = null, scene = null;
  let phaseIdx = -1, phase = null;
  let ringMeshes = [];              // {grp, pos, normal, passed}
  let nextRing = 0;
  let toSpawn = 0, waveSize = 0;
  let killTally = 0;
  let done = false;
  let gotoPoint = null;
  let landTarget = null;
  let lastObj = null;
  const warned = new Set();
  const prevShip = new THREE.Vector3();
  const V = new THREE.Vector3(), V2 = new THREE.Vector3();

  systems.setOnKill(kind => {
    if (!phase || phase.type !== 'clear') return;
    if (kind === phase.enemy) { killTally++; refreshObjective(); }
  });

  function start(missionDef, worldRef, sceneRef) {
    def = missionDef; world = worldRef; scene = sceneRef;
    phaseIdx = -1; done = false;
    warned.clear(); lastObj = null; gotoPoint = null;
    clearRings();
    prevShip.copy(ship.position);
    if (def.setup) def.setup({ systems, flight, world });
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
      // step forward, retrying at wider headings if a tower blocks the gate
      const px = pos.x, pz = pos.z;
      let tries = 0;
      do {
        pos.x = px + Math.sin(heading) * step;
        pos.z = pz - Math.cos(heading) * step;
        // altitude: fixed band in cities, terrain-hugging elsewhere, free in space
        if (world.ringAlt) {
          const base = world.getHeight ? flight.floorAt(pos.x, pos.z) : 0;
          pos.y = base + world.ringAlt.min + Math.random() * world.ringAlt.span;
        } else if (world.getHeight) {
          pos.y = flight.floorAt(pos.x, pos.z) + 40 + Math.random() * 90;
        } else {
          pos.y = ship.position.y + (Math.random() - 0.5) * 180;
        }
        if (!world.clearOf || world.clearOf(pos.x, pos.z, 26, pos.y)) break;
        heading += 0.55;
      } while (++tries < 10);
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
    } else if (phase.type === 'goto') {
      const y = flight.floorAt(phase.at.x, phase.at.z);
      gotoPoint = new THREE.Vector3(phase.at.x, (y === -Infinity ? 0 : y) + (phase.alt ?? 20), phase.at.z);
    } else if (phase.type === 'takeoff') {
      if (phase.pad != null && world.pads) flight.placeLanded(world.pads[phase.pad]);
    } else if (phase.type === 'land') {
      landTarget = world.pads && world.pads[phase.pad];
    } else if (phase.type === 'clear') {
      if (phase.spawnPort) {
        const p = phase.spawnPort;
        systems.spawnPort({ x: p.x, y: flight.floorAt(p.x, p.z) + 1.4, z: p.z });
      }
      if (phase.unshield) systems.setShielded(phase.unshield, false);
      if (phase.silenceTurrets) systems.setTurretsSilent(true);
      if (phase.ties) systems.spawnTies(phase.ties);
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

  function objectiveText() {
    if (!phase) return '';
    let t = '';
    if (phase.type === 'rings') t = `NAV RINGS  ${nextRing} / ${phase.count}`;
    else if (phase.type === 'goto') t = phase.text || 'REACH THE MARKER';
    else if (phase.type === 'takeoff') t = phase.text || 'THROTTLE UP — LIFT OFF';
    else if (phase.type === 'land') t = phase.text || 'LAND ON THE MARKED PLATFORM';
    else if (phase.enemy === 'tie') t = `RAIDERS DOWN  ${killTally} / ${phase.count}`;
    else if (phase.enemy === 'probe') t = `PROBES DESTROYED  ${killTally} / ${phase.count}`;
    else if (phase.enemy === 'generator') t = `GENERATORS DOWN  ${killTally} / ${phase.count}`;
    else if (phase.enemy === 'port') t = phase.text || 'TORPEDO THE EXHAUST PORT';
    else if (phase.enemy === 'oscillator') {
      const o = systems.oscillators[0];
      t = `OSCILLATOR INTEGRITY  ${Math.max(0, Math.round(o.hp / 24 * 100))}%`;
    }
    if (def && def.timeLimit) {
      const rem = Math.max(0, def.timeLimit - systems.run.time);
      const m = Math.floor(rem / 60), s = String(Math.floor(rem % 60)).padStart(2, '0');
      t += `   ·   ${rem <= 60 ? '⚠ ' : ''}${m}:${s}`;
    }
    return t;
  }
  function refreshObjective() { lastObj = null; }

  function update(dt) {
    if (!phase || done) return;

    // the superweapon countdown — banners at thresholds, mission fail at zero
    if (def.timeLimit) {
      const rem = def.timeLimit - systems.run.time;
      if (world.setCharge) world.setCharge(systems.run.time / def.timeLimit);
      for (const th of [120, 60, 30, 10]) {
        if (rem <= th && !warned.has(th)) {
          warned.add(th);
          onBanner(th >= 60 ? `${th / 60} MINUTE${th > 60 ? 'S' : ''} REMAINING` : `${th} SECONDS`, true);
          audio.warn();
        }
      }
      if (rem <= 0) { done = true; onFail(def.failMsg || 'OUT OF TIME'); return; }
    }

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
    } else if (phase.type === 'goto') {
      if (gotoPoint && ship.position.distanceTo(gotoPoint) < (phase.radius || 50)) nextPhase();
    } else if (phase.type === 'takeoff') {
      if (!flight.state.landed && flight.state.speed > 40) nextPhase();
    } else if (phase.type === 'land') {
      if (landTarget) {
        // the target pad's edge lights pulse; others idle
        if (world.pads) for (const pd of world.pads) {
          if (pd.ringMat) pd.ringMat.emissiveIntensity = pd === landTarget
            ? 2.6 + Math.sin(systems.run.time * 6) * 1.3 : 1.0;
        }
        if (flight.state.landed &&
            Math.hypot(ship.position.x - landTarget.x, ship.position.z - landTarget.z) < landTarget.r + 4) {
          onBanner('TOUCHDOWN CONFIRMED', false);
          audio.ring();
          systems.run.score += 300;
          nextPhase();
        }
      }
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

    const txt = objectiveText();
    if (txt !== lastObj) { lastObj = txt; onObjective(txt); }
  }

  // HUD objective info: guidance point + ring list for radar/markers
  function objectiveInfo() {
    if (!phase || done) return null;
    if (phase.type === 'rings') {
      const rg = ringMeshes[nextRing];
      return { point: rg ? rg.pos : null, rings: ringMeshes, nextRing };
    }
    if (phase.type === 'goto') {
      return gotoPoint ? { point: gotoPoint, rings: [{ pos: gotoPoint }], nextRing: 0 } : null;
    }
    if (phase.type === 'takeoff') return null;
    if (phase.type === 'land') {
      return landTarget ? { point: landTarget.pos, rings: [{ pos: landTarget.pos }], nextRing: 0 } : null;
    }
    // nearest alive target of the phase kind
    let best = null, bestD = Infinity;
    const pool = phase.enemy === 'tie' ? systems.ties : phase.enemy === 'probe' ? systems.probes
      : phase.enemy === 'port' ? systems.ports : phase.enemy === 'oscillator' ? systems.oscillators
      : systems.generators;
    for (const e of pool) {
      if (!e.active) continue;
      const d = e.grp.position.distanceToSquared(ship.position);
      if (d < bestD) { bestD = d; best = e; }
    }
    return { point: best ? best.grp.position : null, rings: null, nextRing: 0 };
  }

  return { start, stop, update, objectiveInfo, refreshObjective,
    get def() { return def; }, get done() { return done; }, get phaseIdx() { return phaseIdx; },
    get ringsPassed() { return nextRing; },
    get landPadTarget() { return phase && phase.type === 'land' ? landTarget : null; } };
}
