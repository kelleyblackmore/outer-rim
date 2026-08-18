// flight.js — free-flight model: full pitch/turn/roll, throttle, boost,
// auto-bank into turns, terrain + obstacle collision, patrol boundary.
import * as THREE from 'three';

const SPEED_MIN = 26, SPEED_SPAN = 79;      // throttle 0..1 → 26..105
const BOOST_MULT = 1.55;
const PITCH_MAX = 1.35;                     // rad/s
const TURN_MAX = 1.05;
const ROLL_MAX = 2.6;
const CEILING = 1500;

export function createFlight(ship, input, audio) {
  const state = {
    speed: 60, throttle: 0.62, energy: 100, boosting: false,
    warning: null,               // 'terrain' | 'bounds' | null
    invuln: 0,
    landed: false,               // parked on a landing pad
  };
  let world = null;
  let landPad = null;
  let liftT = 0;               // lift-off grace: no pad recapture while climbing away
  let auto = null;             // auto-land autopilot: {pad, mode:'over'|'drop'}
  let pitchRate = 0, yawRate = 0, rollRate = 0;
  let camRollUp = new THREE.Vector3(0, 1, 0);
  let fovKick = 0;
  // settings (main.js pushes these): rate multiplier, assists, camera roll share,
  // throttle ramp speed
  const opts = { sensitivity: 1, autoLevel: true, camBank: 0.5, throttleResp: 1 };
  function setOptions(o) { Object.assign(opts, o); }
  // shipyard loadout: engine tuning
  const stats = { speedMult: 1, boostMax: 100, boostDrain: 1, agility: 1 };
  function setShipStats(s) {
    Object.assign(stats, s);
    state.energyMax = stats.boostMax;
    state.energy = Math.min(state.energy, stats.boostMax);
  }
  state.energyMax = 100;

  const F = new THREE.Vector3(), R = new THREE.Vector3(), U = new THREE.Vector3();
  const V = new THREE.Vector3(), V2 = new THREE.Vector3();
  const dq = new THREE.Quaternion(), eul = new THREE.Euler();
  const WORLD_UP = new THREE.Vector3(0, 1, 0);
  const prevPos = new THREE.Vector3();

  function vectors() {
    F.set(0, 0, -1).applyQuaternion(ship.quaternion);
    R.set(1, 0, 0).applyQuaternion(ship.quaternion);
    U.set(0, 1, 0).applyQuaternion(ship.quaternion);
  }

  function setWorld(w) { world = w; }

  function reset() {
    const s = world.spawn;
    ship.position.set(s.x, s.y, s.z);
    ship.quaternion.identity();              // facing -Z, toward the sector core
    ship.rotation.set(0, 0, 0);
    state.speed = 60; state.throttle = 0.62; state.energy = stats.boostMax;
    state.warning = null; state.invuln = 0;
    state.landed = false; landPad = null; liftT = 0; auto = null;
    pitchRate = yawRate = rollRate = 0;
    prevPos.copy(ship.position);
  }

  // ---- auto-land: climb clear, cruise above the skyline, drop into the bay ----
  function startAutoLand(pad) { if (pad && !state.landed) auto = { pad, mode: 'over' }; }
  function cancelAutoLand() { auto = null; }
  const _m = new THREE.Matrix4(), _qt = new THREE.Quaternion(), _tgt = new THREE.Vector3();
  function autoPilot(dt, s) {
    const pad = auto.pad;
    const appAlt = pad.approachAlt ?? pad.y + 70;
    const hd = Math.hypot(ship.position.x - pad.x, ship.position.z - pad.z);
    let thr;
    if (auto.mode === 'over') {
      if (ship.position.y < appAlt - 25 && hd > 60) {
        // climb out mostly vertically before crossing the skyline
        _tgt.set(ship.position.x + (pad.x - ship.position.x) * 0.1, appAlt + 50,
          ship.position.z + (pad.z - ship.position.z) * 0.1);
        thr = 0.8;
      } else {
        _tgt.set(pad.x, appAlt, pad.z);
        thr = hd > 320 ? 0.55 : 0.3;
      }
      if (hd < 24 && Math.abs(ship.position.y - appAlt) < 45) auto.mode = 'drop';
    } else {
      _tgt.set(pad.x, pad.y + 1, pad.z);
      thr = 0.05;
      if (hd > 100) auto.mode = 'over';
    }
    _m.lookAt(ship.position, _tgt, WORLD_UP);
    _qt.setFromRotationMatrix(_m);
    ship.quaternion.rotateTowards(_qt, 1.7 * dt);
    state.throttle += (thr - state.throttle) * Math.min(1, 3.5 * dt);
    pitchRate = yawRate = rollRate = 0;
    // hard stick input hands control back to the pilot
    if (Math.abs(s.steerX) > 0.65 || Math.abs(s.steerY) > 0.65 || s.boost) auto = null;
  }

  // park the ship on a pad (mission start / after touchdown)
  function placeLanded(pad) {
    ship.position.set(pad.x, pad.y + 2.1, pad.z);
    ship.quaternion.identity();
    if (pad.yaw) ship.rotateY(pad.yaw);
    state.speed = 0; state.throttle = 0;
    state.landed = true; landPad = pad;
    pitchRate = yawRate = rollRate = 0;
    prevPos.copy(ship.position);
  }

  function floorAt(x, z) {
    if (!world || !world.getHeight) return -Infinity;
    const h = world.getHeight(x, z);
    return world.lavaY !== undefined ? Math.max(h, world.lavaY) : h;
  }

  const _q = new THREE.Quaternion();
  function update(dt, onHurt) {
    const s = input.state;
    prevPos.copy(ship.position);

    // ---- throttle & speed ----
    if (s.throttleSet != null) {
      // HOTAS slider: absolute, lightly smoothed
      state.throttle += (THREE.MathUtils.clamp(s.throttleSet, 0, 1) - state.throttle) * Math.min(1, 12 * opts.throttleResp * dt);
    } else {
      state.throttle = THREE.MathUtils.clamp(state.throttle + s.throttleAxis * 0.55 * opts.throttleResp * dt, 0, 1);
    }

    // ---- parked on a pad: hold flat, recharge, wait for throttle ----
    if (state.landed) {
      state.speed = 0; state.boosting = false;
      state.energy = Math.min(stats.boostMax, state.energy + 22 * dt);
      state.warning = null;
      pitchRate = yawRate = rollRate = 0;
      vectors();
      const yaw = Math.atan2(-F.x, -F.z);
      eul.set(0, yaw, 0, 'XYZ');
      _q.setFromEuler(eul);
      ship.quaternion.slerp(_q, Math.min(1, 6 * dt));   // settle level, keep heading
      if (landPad) ship.position.y = landPad.y + 2.1;
      audio.setThrottle(state.throttle * 0.4);
      if (state.throttle > 0.25) {                      // throttle up → lift off
        state.landed = false; landPad = null;
        state.speed = 20;
        pitchRate = 0.5;
        liftT = 1.5;                                    // repulsors carry you clear
      }
      const gIdle = 1.6 + state.throttle * 2 + Math.sin(performance.now() * 0.02) * 0.2;
      for (const n of ship.userData.engineNodes) n.material.emissiveIntensity = gIdle;
      if (ship.userData.trails) for (const t of ship.userData.trails) { t.scale.z = 0.5; t.material.opacity = 0.15; }
      return;
    }

    state.boosting = s.boost && state.energy > 0 && !auto;
    if (state.boosting) state.energy = Math.max(0, state.energy - 30 * stats.boostDrain * dt);
    else state.energy = Math.min(stats.boostMax, state.energy + 14 * dt);
    // hover-capable worlds (city repulsors) can throttle all the way to zero
    const minS = world && world.canLand ? 0 : SPEED_MIN;
    const targetSpeed = (minS + state.throttle * (SPEED_MIN + SPEED_SPAN - minS)) * stats.speedMult * (state.boosting ? BOOST_MULT : 1);
    state.speed += (targetSpeed - state.speed) * Math.min(1, 1.9 * dt);
    audio.setThrottle(state.throttle * 0.7 + (state.boosting ? 0.3 : 0));

    if (auto) {
      autoPilot(dt, s);
    } else {
      // ---- rotation rates (smoothed toward demand) ----
      const k = 1 - Math.exp(-9 * dt);
      pitchRate += (s.steerY * PITCH_MAX * opts.sensitivity * stats.agility - pitchRate) * k;
      yawRate += (-s.steerX * TURN_MAX * opts.sensitivity * stats.agility - yawRate) * k;

      vectors();
      // auto-bank into turns / auto-level, unless the pilot is rolling manually
      // (or has switched the assist off)
      let rollDemand = -s.roll * ROLL_MAX;
      if (!s.roll && opts.autoLevel && Math.abs(F.y) < 0.93) {
        // bank angle: how far the right wing is from level, signed
        const bank = Math.atan2(R.y, Math.hypot(R.x, R.z));
        const bankTarget = -s.steerX * 0.85;
        rollDemand = THREE.MathUtils.clamp((bankTarget - bank) * 2.4, -2.0, 2.0);
      }
      rollRate += (rollDemand - rollRate) * k;

      // apply local-space rotation (positive rollRate = roll left; demands are
      // authored with that convention, see bank math above)
      eul.set(pitchRate * dt, yawRate * dt, rollRate * dt, 'XYZ');
      dq.setFromEuler(eul);
      ship.quaternion.multiply(dq).normalize();
    }

    // ---- translate ----
    vectors();
    ship.position.addScaledVector(F, state.speed * dt);
    if (liftT > 0) { liftT -= dt; ship.position.y += 9 * dt; }   // repulsor climb-out

    // ---- warnings + collisions ----
    state.warning = null;
    if (state.invuln > 0) state.invuln -= dt;

    // terrain + landing pads. A pad top acts as local ground; touching it
    // slow and shallow is a landing, anything else is a crash.
    if (world && (world.getHeight || world.pads)) {
      let floor = world.getHeight ? floorAt(ship.position.x, ship.position.z) : -Infinity;
      let pad = null;
      if (world.pads) {
        for (const pd of world.pads) {
          const dx = ship.position.x - pd.x, dz = ship.position.z - pd.z;
          if (dx * dx + dz * dz < (pd.r + 1.5) * (pd.r + 1.5) && ship.position.y > pd.y - 2) {
            // >= with slack: a bay floor flush with the local terrain still lands
            if (pd.y >= floor - 0.5) { floor = Math.max(floor, pd.y); pad = pd; }
          }
        }
      }
      const clearance = ship.position.y - floor;
      const descent = -F.y * state.speed;      // >0 when descending
      if (clearance < 20 && descent > 6 && !pad) state.warning = 'terrain';
      if (clearance < 2.4 && floor > -Infinity) {
        if (pad && liftT > 0) {
          // climbing off the pad — keep clear of the deck, no recapture
          ship.position.y = floor + 2.4;
        } else if (pad && state.speed < 16 && descent < 15) {
          // gentle touchdown
          state.landed = true; landPad = pad; auto = null;
          ship.position.y = pad.y + 2.1;
          state.speed = 0; state.throttle = 0;
          pitchRate = yawRate = rollRate = 0;
          if (audio.land) audio.land(); else audio.scrape();
          return;
        }
        ship.position.y = floor + 2.4;
        if (state.invuln <= 0) {
          state.invuln = 1.0;
          const dmg = THREE.MathUtils.clamp(10 + Math.max(0, descent) * 0.4, 10, 45);
          onHurt(dmg, world.deckIsStorm ? 'storm' : 'terrain');
          audio.scrape();
        }
        // deflect the nose up so a graze doesn't become a plough
        eul.set(0.9 * dt + 0.12, 0, 0, 'XYZ');
        dq.setFromEuler(eul);
        ship.quaternion.multiply(dq).normalize();
        pitchRate = Math.max(pitchRate, 0.8);
      }
    }

    // obstacle spheres (asteroids, spires, platforms…)
    if (world) {
      for (const c of world.colliders) {
        const dx = ship.position.x - c.x, dy = ship.position.y - c.y, dz = ship.position.z - c.z;
        const rr = c.r + 2.0;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < rr * rr) {
          const d = Math.sqrt(d2) || 1;
          ship.position.set(c.x + dx / d * rr, c.y + dy / d * rr, c.z + dz / d * rr);
          if (state.invuln <= 0) { state.invuln = 0.8; onHurt(16, 'impact'); audio.scrape(); }
          break;
        }
      }
    }

    // skyscraper boxes: push out along the shallow axis, take a scrape
    if (world && world.boxes) {
      for (const b of world.boxes) {
        const dx = ship.position.x - b.x, dz = ship.position.z - b.z;
        if (Math.abs(dx) < b.hw + 2 && Math.abs(dz) < b.hd + 2 && ship.position.y < b.top + 2) {
          const penX = b.hw + 2 - Math.abs(dx), penZ = b.hd + 2 - Math.abs(dz);
          if (penX < penZ) ship.position.x = b.x + Math.sign(dx || 1) * (b.hw + 2);
          else ship.position.z = b.z + Math.sign(dz || 1) * (b.hd + 2);
          if (state.invuln <= 0) { state.invuln = 0.8; onHurt(14, 'building'); audio.scrape(); }
          break;
        }
      }
    }

    // ceiling: ease the nose down, no damage
    if (ship.position.y > CEILING) {
      ship.position.y = CEILING;
      if (F.y > 0) { eul.set(-1.2 * dt, 0, 0, 'XYZ'); dq.setFromEuler(eul); ship.quaternion.multiply(dq).normalize(); }
    }

    // patrol boundary: warn, then gently steer the ship back toward the core
    if (world) {
      const hd = Math.hypot(ship.position.x, ship.position.z);
      if (hd > world.boundsR) {
        state.warning = 'bounds';
        // yaw toward the origin
        V.set(-ship.position.x, 0, -ship.position.z).normalize();
        V2.copy(F); V2.y = 0; V2.normalize();
        const cross = V2.x * V.z - V2.z * V.x;      // sign of turn needed
        const strength = Math.min(1, (hd - world.boundsR) / 300);
        eul.set(0, (cross > 0 ? -1 : 1) * 0.7 * strength * dt, 0, 'XYZ');
        dq.setFromEuler(eul);
        ship.quaternion.multiply(dq).normalize();
        if (hd > world.boundsR * 1.25) {            // hard wall
          const sc = (world.boundsR * 1.25) / hd;
          ship.position.x *= sc; ship.position.z *= sc;
        }
      }
    }

    // engine glow + exhaust trails
    const glow = 2.4 + state.throttle * 1.4 + (state.boosting ? 1.8 : 0) + Math.sin(performance.now() * 0.04) * 0.3;
    for (const n of ship.userData.engineNodes) n.material.emissiveIntensity = glow;
    if (ship.userData.trails) {
      const L = 1.0 + state.throttle * 2.4 + (state.boosting ? 3.6 : 0);
      const flick = 0.9 + Math.sin(performance.now() * 0.045) * 0.1;
      const op = 0.28 + state.throttle * 0.24 + (state.boosting ? 0.28 : 0);
      for (const t of ship.userData.trails) {
        t.scale.z = L * flick;
        t.material.opacity = op;
      }
    }
  }

  // chase camera: sits behind/above in ship space, partially shares the ship's roll
  function updateCamera(camera, dt, reduceMotion) {
    vectors();
    const kp = 1 - Math.exp(-7 * dt);
    V.set(0, 3.1, 11.0).applyQuaternion(ship.quaternion).add(ship.position);
    camera.position.lerp(V, kp);
    // blended up vector: mostly world-up, partly ship-up → readable banking
    const mix = reduceMotion ? 0.12 : opts.camBank;
    V2.copy(WORLD_UP).lerp(U, mix);
    if (V2.lengthSq() < 0.05) V2.copy(U);    // inverted flight: follow the ship
    camRollUp.lerp(V2.normalize(), kp);
    camera.up.copy(camRollUp);
    V2.copy(ship.position).addScaledVector(F, 40);
    camera.lookAt(V2);
    // boost FOV kick
    const targetKick = state.boosting && !reduceMotion ? 7 : 0;
    fovKick += (targetKick - fovKick) * Math.min(1, 4 * dt);
    const fov = 62 + fovKick;
    if (Math.abs(camera.fov - fov) > 0.01) { camera.fov = fov; camera.updateProjectionMatrix(); }
  }

  // shared read access for combat/HUD (fresh each call)
  function forward(out) { return out.set(0, 0, -1).applyQuaternion(ship.quaternion); }
  function right(out) { return out.set(1, 0, 0).applyQuaternion(ship.quaternion); }
  function velocityInto(out) { return forward(out).multiplyScalar(state.speed); }

  return { state, ship, setWorld, reset, update, updateCamera, forward, right, velocityInto, floorAt, setOptions, setShipStats, placeLanded,
    startAutoLand, cancelAutoLand, get autoLanding() { return !!auto; } };
}
