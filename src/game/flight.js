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
  };
  let world = null;
  let pitchRate = 0, yawRate = 0, rollRate = 0;
  let camRollUp = new THREE.Vector3(0, 1, 0);
  let fovKick = 0;

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
    state.speed = 60; state.throttle = 0.62; state.energy = 100;
    state.warning = null; state.invuln = 0;
    pitchRate = yawRate = rollRate = 0;
    prevPos.copy(ship.position);
  }

  function floorAt(x, z) {
    if (!world || !world.getHeight) return -Infinity;
    const h = world.getHeight(x, z);
    return world.lavaY !== undefined ? Math.max(h, world.lavaY) : h;
  }

  function update(dt, onHurt) {
    const s = input.state;
    prevPos.copy(ship.position);

    // ---- throttle & speed ----
    state.throttle = THREE.MathUtils.clamp(state.throttle + s.throttleAxis * 0.55 * dt, 0, 1);
    state.boosting = s.boost && state.energy > 0;
    if (state.boosting) state.energy = Math.max(0, state.energy - 30 * dt);
    else state.energy = Math.min(100, state.energy + 14 * dt);
    const targetSpeed = (SPEED_MIN + state.throttle * SPEED_SPAN) * (state.boosting ? BOOST_MULT : 1);
    state.speed += (targetSpeed - state.speed) * Math.min(1, 1.9 * dt);
    audio.setThrottle(state.throttle * 0.7 + (state.boosting ? 0.3 : 0));

    // ---- rotation rates (smoothed toward demand) ----
    const k = 1 - Math.exp(-9 * dt);
    pitchRate += (s.steerY * PITCH_MAX - pitchRate) * k;
    yawRate += (-s.steerX * TURN_MAX - yawRate) * k;

    vectors();
    // auto-bank into turns / auto-level, unless the pilot is rolling manually
    let rollDemand = -s.roll * ROLL_MAX;
    if (!s.roll && Math.abs(F.y) < 0.93) {
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

    // ---- translate ----
    vectors();
    ship.position.addScaledVector(F, state.speed * dt);

    // ---- warnings + collisions ----
    state.warning = null;
    if (state.invuln > 0) state.invuln -= dt;

    // terrain
    if (world && world.getHeight) {
      const floor = floorAt(ship.position.x, ship.position.z);
      const clearance = ship.position.y - floor;
      const descent = -F.y * state.speed;      // >0 when descending
      if (clearance < 20 && descent > 6) state.warning = 'terrain';
      if (clearance < 2.4) {
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

    // engine glow
    const glow = 2.4 + state.throttle * 1.4 + (state.boosting ? 1.8 : 0) + Math.sin(performance.now() * 0.04) * 0.3;
    for (const n of ship.userData.engineNodes) n.material.emissiveIntensity = glow;
  }

  // chase camera: sits behind/above in ship space, partially shares the ship's roll
  function updateCamera(camera, dt, reduceMotion) {
    vectors();
    const kp = 1 - Math.exp(-7 * dt);
    V.set(0, 3.1, 11.0).applyQuaternion(ship.quaternion).add(ship.position);
    camera.position.lerp(V, kp);
    // blended up vector: mostly world-up, partly ship-up → readable banking
    const mix = reduceMotion ? 0.12 : 0.5;
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

  return { state, ship, setWorld, reset, update, updateCamera, forward, right, velocityInto, floorAt };
}
