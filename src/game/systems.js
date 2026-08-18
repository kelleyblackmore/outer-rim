// systems.js — combat & entities: lasers, torpedoes, TIE/probe/turret/generator
// AI, particles, damage, targeting, HUD snapshot (radar + off-screen arrows).
import * as THREE from 'three';
import { buildTIE, buildProbe, buildTurret, buildGenerator, buildTower, buildPort, buildOscillator } from './models.js';

const DIFF = {
  cadet: { dmg: 0.7, fire: 2.2, espeed: 60, aimErr: 5.2, regen: 8 },
  pilot: { dmg: 1.0, fire: 1.6, espeed: 72, aimErr: 3.4, regen: 6 },
  ace:   { dmg: 1.35, fire: 1.1, espeed: 85, aimErr: 2.1, regen: 4 },
};

const LASER_SPEED = 440, ELASER_SPEED = 290, TORP_SPEED = 250;
const SCORE = { tie: 100, probe: 75, turret: 150, generator: 400, port: 2000, oscillator: 2000 };
const TORP_DMG = { generator: 4, oscillator: 4 };          // everything else dies outright
const BIG_BOOM = { generator: true, port: true, oscillator: true };

export function createSystems(ctx) {
  const { scene, camera, engine, audio, input, flight, onLose, onBanner } = ctx;
  const ship = flight.ship;
  let world = null;
  let onKill = null;           // mission hook: (kind) => {}

  // ---- pools ----
  const glowTex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(32, 32, 2, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.35, 'rgba(255,255,255,0.45)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  })();
  const glowMat = color => new THREE.SpriteMaterial({ map: glowTex, color, transparent: true,
    opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending });
  const GLOW_MATS = { 0xff2b2b: glowMat(0xff5a4a), 0x7dff4a: glowMat(0x8aff5a), 0xffd34d: glowMat(0xffe08a) };
  const mkBolt = (color, len = 3.4, w = 0.18) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, w, len),
      new THREE.MeshStandardMaterial({ color: 0x000000, emissive: color, emissiveIntensity: 4.5, roughness: 0.4 }));
    // additive halo makes bolts read like movie blaster fire
    const halo = new THREE.Sprite(GLOW_MATS[color] || glowMat(color));
    halo.scale.setScalar(len * 0.9 + w * 8);
    m.add(halo);
    m.visible = false; scene.add(m); return m;
  };
  const pLasers = Array.from({ length: 64 }, () => ({ mesh: mkBolt(0xff2b2b), active: false, vel: new THREE.Vector3(), prev: new THREE.Vector3(), ttl: 0 }));
  const eLasers = Array.from({ length: 96 }, () => ({ mesh: mkBolt(0x7dff4a), active: false, vel: new THREE.Vector3(), prev: new THREE.Vector3(), ttl: 0 }));
  const torps = Array.from({ length: 4 }, () => ({ mesh: mkBolt(0xffd34d, 2.2, 0.5), active: false, dir: new THREE.Vector3(), target: null, ttl: 0, prev: new THREE.Vector3() }));

  const ties = Array.from({ length: 10 }, () => {
    const g = buildTIE(); g.visible = false; scene.add(g);
    // NB: dir/flee/vel are three separate vectors on purpose — sharing scratch
    // between AI state and HUD math caused the tower-laser bug in trench-run
    return { kind: 'tie', grp: g, active: false, dir: new THREE.Vector3(0, 0, 1), flee: new THREE.Vector3(),
      vel: new THREE.Vector3(), speed: 60, mode: 'attack', modeT: 0, hp: 2, fireCd: 2, phase: Math.random() * 7, r: 3.0 };
  });
  const probes = Array.from({ length: 12 }, () => {
    const g = buildProbe(); g.visible = false; scene.add(g);
    return { kind: 'probe', grp: g, active: false, vel: new THREE.Vector3(), baseY: 0, phase: 0, hp: 2, fireCd: 3, r: 2.6 };
  });
  // turret slots carry both a squat emplacement and a tall turbolaser tower;
  // spawnTurrets picks which silhouette a slot wears
  const turrets = Array.from({ length: 28 }, () => {
    const g = new THREE.Group();
    const turretM = buildTurret(), towerM = buildTower();
    g.add(turretM); g.add(towerM);
    g.visible = false; scene.add(g);
    return { kind: 'turret', grp: g, turretM, towerM, light: turretM.userData.light,
      active: false, vel: new THREE.Vector3(), hp: 3, fireCd: 2, burst: 0, burstT: 0, r: 3.2, aimY: 2.6 };
  });
  const generators = Array.from({ length: 6 }, () => {
    const g = buildGenerator(); g.visible = false; scene.add(g);
    return { kind: 'generator', grp: g, active: false, vel: new THREE.Vector3(), hp: 8, r: 7.5, aimY: 3 };
  });
  const ports = Array.from({ length: 1 }, () => {
    const g = buildPort(); g.visible = false; scene.add(g);
    return { kind: 'port', grp: g, active: false, vel: new THREE.Vector3(), hp: 1, r: 5.5, aimY: 1.5 };
  });
  const oscillators = Array.from({ length: 1 }, () => {
    const g = buildOscillator(); g.visible = false; scene.add(g);
    return { kind: 'oscillator', grp: g, active: false, vel: new THREE.Vector3(), hp: 24, r: 26,
      aimOff: new THREE.Vector3(0, 30, 128), shielded: false };
  });
  const HOSTILE_POOLS = [ties, probes, turrets, generators, ports, oscillators];

  const shardGeo = new THREE.BoxGeometry(0.3, 0.3, 0.3);
  const particles = Array.from({ length: 240 }, () => {
    const m = new THREE.Mesh(shardGeo, new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffa030, emissiveIntensity: 3, roughness: 0.5 }));
    m.visible = false; scene.add(m);
    return { mesh: m, active: false, vel: new THREE.Vector3(), life: 0, max: 1, spin: new THREE.Vector3() };
  });
  // fireball flashes + one shared light so blasts kiss the terrain
  const flashes = Array.from({ length: 10 }, () => {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xffc060,
      transparent: true, opacity: 1, depthWrite: false, blending: THREE.AdditiveBlending }));
    s.visible = false; scene.add(s);
    return { spr: s, active: false, life: 0, max: 0.35, size: 20 };
  });
  const boomLight = new THREE.PointLight(0xffa040, 0, 700, 1.2);
  scene.add(boomLight);

  // smoke puffs — soft dark sprites that swell and drift up
  const smokeTex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(32, 32, 4, 32, 32, 32);
    grad.addColorStop(0, 'rgba(70,64,60,0.85)');
    grad.addColorStop(0.55, 'rgba(48,44,42,0.45)');
    grad.addColorStop(1, 'rgba(30,28,28,0)');
    g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  })();
  const smokes = Array.from({ length: 24 }, () => {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: smokeTex, transparent: true, depthWrite: false }));
    s.visible = false; scene.add(s);
    return { spr: s, active: false, life: 0, max: 1, size: 10, vel: new THREE.Vector3() };
  });
  function spawnSmoke(pos, size, life) {
    const s = smokes.find(x => !x.active);
    if (!s) return;
    s.spr.position.copy(pos);
    s.spr.position.x += (Math.random() - 0.5) * size * 0.5;
    s.spr.position.y += (Math.random() - 0.5) * size * 0.5;
    s.spr.position.z += (Math.random() - 0.5) * size * 0.5;
    s.size = size;
    s.spr.scale.setScalar(size * 0.5);
    s.spr.material.opacity = 0.55;
    s.vel.set((Math.random() - 0.5) * 3, 2.5 + Math.random() * 3, (Math.random() - 0.5) * 3);
    s.life = 0; s.max = life || (0.9 + Math.random() * 0.7);
    s.active = true; s.spr.visible = true;
  }

  // shockwave rings — a thin expanding circle at the blast
  const shockTex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const g = c.getContext('2d');
    g.strokeStyle = 'rgba(255,225,180,0.9)';
    g.lineWidth = 5;
    g.beginPath(); g.arc(64, 64, 56, 0, Math.PI * 2); g.stroke();
    g.strokeStyle = 'rgba(255,200,140,0.35)';
    g.lineWidth = 12;
    g.beginPath(); g.arc(64, 64, 52, 0, Math.PI * 2); g.stroke();
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  })();
  const shocks = Array.from({ length: 6 }, () => {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: shockTex, transparent: true,
      depthWrite: false, blending: THREE.AdditiveBlending }));
    s.visible = false; scene.add(s);
    return { spr: s, active: false, life: 0, max: 0.5, size: 30 };
  });
  function spawnShock(pos, size) {
    const s = shocks.find(x => !x.active);
    if (!s) return;
    s.spr.position.copy(pos);
    s.size = size;
    s.spr.scale.setScalar(size * 0.2);
    s.spr.material.opacity = 0.7;
    s.life = 0; s.max = 0.5;
    s.active = true; s.spr.visible = true;
  }

  // speed dust — near-field particles streaming past the ship
  const DUST_N = 90;
  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(DUST_N * 3), 3));
  const dustMat = new THREE.PointsMaterial({ color: 0xcfe4ff, size: 0.38, sizeAttenuation: true,
    transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
  const dust = new THREE.Points(dustGeo, dustMat);
  dust.frustumCulled = false;
  scene.add(dust);
  let dustSeeded = false;
  let dustLevel = 0.55;        // settings: 1 full · 0.55 subtle · 0 off
  function setDustLevel(v) { dustLevel = v; }
  function updateDust(dt) {
    if (dustLevel <= 0) { dustMat.opacity = 0; dustSeeded = false; return; }
    const speed = flight.state.speed;
    const target = (THREE.MathUtils.clamp((speed - 72) / 130, 0, 0.32) + (flight.state.boosting ? 0.16 : 0)) * dustLevel;
    dustMat.opacity += (target - dustMat.opacity) * Math.min(1, 4 * dt);
    if (dustMat.opacity < 0.02) { dustSeeded = false; return; }
    flight.forward(_fwd);
    const a = dustGeo.attributes.position;
    for (let i = 0; i < DUST_N; i++) {
      let x = a.getX(i), y = a.getY(i), z = a.getZ(i);
      const dx = x - ship.position.x, dy = y - ship.position.y, dz = z - ship.position.z;
      const along = dx * _fwd.x + dy * _fwd.y + dz * _fwd.z;
      if (!dustSeeded || along < -18 || (dx * dx + dy * dy + dz * dz) > 4900) {
        // respawn ahead, scattered off-axis
        const r = 8 + Math.random() * 30, th = Math.random() * Math.PI * 2;
        V3.set(Math.cos(th) * r, Math.sin(th) * r, 0).applyQuaternion(ship.quaternion);
        x = ship.position.x + _fwd.x * (25 + Math.random() * 35) + V3.x;
        y = ship.position.y + _fwd.y * (25 + Math.random() * 35) + V3.y;
        z = ship.position.z + _fwd.z * (25 + Math.random() * 35) + V3.z;
        a.setXYZ(i, x, y, z);
      }
    }
    dustSeeded = true;
    a.needsUpdate = true;
  }

  // ---- run state ----
  const run = {
    diff: DIFF.pilot, hull: 100, shields: 100, score: 0, kills: 0, time: 0,
    torps: 6, hurt: 0, shieldCd: 0, over: false,
    lock: 0, locked: false, lockTarget: null,
  };

  const V = new THREE.Vector3(), V2 = new THREE.Vector3(), V3 = new THREE.Vector3();
  const _fwd = new THREE.Vector3(), _shipVel = new THREE.Vector3();
  const _aim = new THREE.Vector3(), _from = new THREE.Vector3();
  const _muzzle = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];

  function setWorld(w) { world = w; }
  function setOnKill(fn) { onKill = fn; }

  // shipyard loadout: weapons + shields
  const shipStats = { laserDmg: 1, laserCd: 0.115, torpCount: 6, torpTurn: 3.2, shieldCap: 100, shieldRegen: 1 };
  function setShipStats(s) { Object.assign(shipStats, s); }

  function reset(diffName) {
    run.diff = DIFF[diffName] || DIFF.pilot;
    run.hull = 100; run.shields = shipStats.shieldCap; run.shieldCap = shipStats.shieldCap;
    run.score = 0; run.kills = 0; run.time = 0;
    run.torps = shipStats.torpCount; run.hurt = 0; run.shieldCd = 0; run.over = false;
    run.lock = 0; run.locked = false; run.lockTarget = null;
    fireCd = 0; torpCd = 0; turretsSilent = false;
    pLasers.concat(eLasers).forEach(l => { l.active = false; l.mesh.visible = false; });
    torps.forEach(t => { t.active = false; t.mesh.visible = false; t.target = null; });
    clearHostiles();
    particles.forEach(p => { p.active = false; p.mesh.visible = false; });
    flashes.forEach(f => { f.active = false; f.spr.visible = false; });
    smokes.forEach(s => { s.active = false; s.spr.visible = false; });
    shocks.forEach(s => { s.active = false; s.spr.visible = false; });
    dustMat.opacity = 0; dustSeeded = false;
    boomLight.intensity = 0;
    smokeCd = 0;
  }

  function clearHostiles() {
    for (const pool of HOSTILE_POOLS) pool.forEach(e => { e.active = false; e.grp.visible = false; });
  }

  function* hostiles() {
    for (const pool of HOSTILE_POOLS) for (const e of pool) if (e.active) yield e;
  }
  function aliveCount(kind) {
    let n = 0;
    for (const e of hostiles()) if (!kind || e.kind === kind) n++;
    return n;
  }

  // ---------------- spawning (missions call these) ----------------
  function groundY(x, z, min) {
    const f = flight.floorAt(x, z);
    return f === -Infinity ? min : f;
  }
  function spawnTies(n) {
    let spawned = 0;
    for (const e of ties) {
      if (e.active || spawned >= n) continue;
      // ring around the player, well out
      const a = Math.random() * Math.PI * 2;
      const r = 520 + Math.random() * 320;
      const x = ship.position.x + Math.cos(a) * r;
      const z = ship.position.z + Math.sin(a) * r;
      const gy = groundY(x, z, -240);
      let y = Math.min(Math.max(gy + 60 + Math.random() * 160, ship.position.y - 160), 700);
      if (world && world.aiFloor) y = Math.max(y, world.aiFloor + 20);
      e.grp.position.set(x, Math.max(y, gy + 40), z);
      e.dir.copy(ship.position).sub(e.grp.position).normalize();
      e.speed = run.diff.espeed * (0.85 + Math.random() * 0.3);
      e.mode = 'attack'; e.modeT = 0;
      e.hp = 2; e.fireCd = 1.5 + Math.random() * run.diff.fire;
      e.active = true; e.grp.visible = true;
      spawned++;
    }
    return spawned;
  }
  function spawnProbes(positions) {
    let i = 0;
    for (const p of probes) {
      if (p.active || i >= positions.length) continue;
      const pos = positions[i++];
      p.grp.position.set(pos.x, pos.y, pos.z);
      p.baseY = pos.y; p.phase = Math.random() * 7;
      p.hp = 2; p.fireCd = 2 + Math.random() * 2;
      p.active = true; p.grp.visible = true;
    }
  }
  function spawnTurrets(positions, style = 'turret') {
    let i = 0;
    for (const t of turrets) {
      if (t.active || i >= positions.length) continue;
      const pos = positions[i++];
      t.grp.position.set(pos.x, pos.y, pos.z);
      const tower = style === 'tower';
      t.turretM.visible = !tower; t.towerM.visible = tower;
      t.light = (tower ? t.towerM : t.turretM).userData.light;
      t.aimY = tower ? 6.2 : 2.6;
      t.r = tower ? 4.2 : 3.2;
      t.hp = 3; t.fireCd = 1.5 + Math.random() * 2; t.burst = 0;
      t.active = true; t.grp.visible = true;
    }
  }
  function spawnPort(pos) {
    const p = ports[0];
    p.grp.position.set(pos.x, pos.y, pos.z);
    p.hp = 1; p.active = true; p.grp.visible = true;
    return p;
  }
  function spawnOscillator(pos, shielded) {
    const o = oscillators[0];
    o.grp.position.set(pos.x, pos.y, pos.z);
    o.hp = 24; o.shielded = !!shielded; o.active = true; o.grp.visible = true;
    return o;
  }
  function setShielded(kind, on) {
    for (const e of hostiles()) if (e.kind === kind) e.shielded = on;
  }
  // "the guns — they've stopped": turrets hold fire but stay targetable
  let turretsSilent = false;
  function setTurretsSilent(v) { turretsSilent = v; }
  function spawnGenerators(positions) {
    let i = 0;
    for (const g of generators) {
      if (g.active || i >= positions.length) continue;
      const pos = positions[i++];
      g.grp.position.set(pos.x, pos.y, pos.z);
      g.hp = 8;
      g.active = true; g.grp.visible = true;
    }
  }

  // ---------------- player weapons ----------------
  let fireCd = 0;
  function firePlayerLasers() {
    const cannons = ship.userData.wingCannons;
    const count = Math.min(cannons.length, _muzzle.length);
    for (let i = 0; i < count; i++) cannons[i].getWorldPosition(_muzzle[i]);
    flight.forward(_fwd);
    let n = 0;
    for (const l of pLasers) {
      if (l.active) continue;
      l.mesh.position.copy(_muzzle[n]);
      l.vel.copy(_fwd).multiplyScalar(LASER_SPEED + flight.state.speed);
      l.mesh.quaternion.copy(ship.quaternion);
      l.active = true; l.mesh.visible = true; l.ttl = 1.5;
      n++; if (n >= count) break;
    }
    audio.laser();
  }

  let torpCd = 0;
  function fireTorpedo() {
    if (torpCd > 0) return;
    if (run.torps <= 0) { audio.warn(); return; }
    const t = torps.find(x => !x.active);
    if (!t) return;
    torpCd = 0.6;
    run.torps--;
    t.mesh.position.copy(ship.position);
    flight.forward(t.dir);
    t.mesh.quaternion.copy(ship.quaternion);
    t.target = run.locked ? run.lockTarget : null;
    t.ttl = 7; t.active = true; t.mesh.visible = true;
    audio.torpedo();
  }

  // ---------------- enemy fire ----------------
  function fireEnemyLaser(fromPos, speed = ELASER_SPEED, err = null) {
    const l = eLasers.find(x => !x.active); if (!l) return;
    const e = err === null ? run.diff.aimErr : err;
    // lead the player, with difficulty-scaled scatter so bolts are dodgeable
    flight.velocityInto(_shipVel);
    const dist = _aim.copy(ship.position).sub(fromPos).length();
    _aim.copy(ship.position).addScaledVector(_shipVel, Math.min(dist / speed, 2.2) * 0.7);
    _aim.x += (Math.random() * 2 - 1) * e;
    _aim.y += (Math.random() * 2 - 1) * e;
    _aim.z += (Math.random() * 2 - 1) * e;
    l.mesh.position.copy(fromPos);
    l.vel.copy(_aim).sub(fromPos).normalize().multiplyScalar(speed);
    l.mesh.lookAt(V2.copy(fromPos).add(l.vel));
    l.active = true; l.mesh.visible = true; l.ttl = 4;
    audio.enemyLaser();
  }

  // ---------------- enemy AI ----------------
  function updateTies(dt) {
    for (const e of ties) {
      if (!e.active) continue;
      const toP = V.copy(ship.position).sub(e.grp.position);
      const dist = toP.length();

      if (e.mode === 'attack') {
        // intercept course with a bit of lead
        flight.velocityInto(_shipVel);
        V2.copy(ship.position).addScaledVector(_shipVel, Math.min(dist / 300, 2) * 0.6).sub(e.grp.position).normalize();
        e.dir.lerp(V2, Math.min(1, 1.5 * dt)).normalize();
        if (dist < 55) { e.mode = 'extend'; e.modeT = 2.2 + Math.random() * 1.6;
          V3.set(Math.random() - 0.5, Math.random() * 0.4 - 0.1, Math.random() - 0.5).normalize();
          e.flee.copy(toP).multiplyScalar(-1 / Math.max(dist, 1)).add(V3).normalize(); }
      } else {
        e.modeT -= dt;
        e.dir.lerp(e.flee, Math.min(1, 1.8 * dt)).normalize();
        if (e.modeT <= 0) e.mode = 'attack';
      }

      // stay inside the patrol bubble
      const hd = Math.hypot(e.grp.position.x, e.grp.position.z);
      if (world && hd > world.boundsR) {
        V2.set(-e.grp.position.x, 0, -e.grp.position.z).normalize();
        e.dir.lerp(V2, Math.min(1, 2 * dt)).normalize();
      }
      // terrain avoidance; cities also keep fighters above the tower tops
      let floor = flight.floorAt(e.grp.position.x, e.grp.position.z);
      if (world && world.aiFloor) floor = Math.max(floor === -Infinity ? 0 : floor, world.aiFloor - 24);
      if (floor !== -Infinity) {
        const clr = e.grp.position.y - floor;
        if (clr < 24) { e.dir.y = Math.max(e.dir.y, 0.45); e.dir.normalize(); }
        if (clr < 8) e.grp.position.y = floor + 8;
      }
      if (e.grp.position.y > 760) { e.dir.y = Math.min(e.dir.y, -0.05); e.dir.normalize(); }

      const spd = e.speed * (e.mode === 'extend' ? 1.25 : 1);
      e.grp.position.addScaledVector(e.dir, spd * dt);

      // face along travel, with a bit of banked wobble
      V2.copy(e.grp.position).add(e.dir);
      e.grp.lookAt(V2);
      e.grp.rotateZ(Math.sin(run.time * 1.7 + e.phase) * 0.35);
      if (e.grp.userData.ions) {
        const hot = 1.8 + Math.sin(run.time * 22 + e.phase) * 0.4 + (e.mode === 'extend' ? 1.2 : 0);
        for (const ion of e.grp.userData.ions) ion.material.emissiveIntensity = hot;
      }

      // fire when roughly boresighted
      e.fireCd -= dt;
      const facing = e.dir.dot(toP.normalize());     // toP normalized in place (already used)
      if (e.fireCd <= 0 && dist < 430 && dist > 30 && facing > 0.965) {
        e.fireCd = 0.9 + Math.random() * run.diff.fire;
        fireEnemyLaser(e.grp.position);
      }

      // ram / collision with the player
      if (dist < 4.5) {
        hurtPlayer(20);
        explode(e.grp.position, false); audio.explosion(false);
        e.active = false; e.grp.visible = false;
      }
    }
  }

  function updateProbes(dt) {
    for (const p of probes) {
      if (!p.active) continue;
      p.grp.position.y = p.baseY + Math.sin(run.time * 0.9 + p.phase) * 2.5;
      p.grp.rotation.y += dt * 0.5;
      p.fireCd -= dt;
      const d2 = p.grp.position.distanceToSquared(ship.position);
      if (p.fireCd <= 0 && d2 < 380 * 380) {
        p.fireCd = 2.6 + Math.random() * 2;
        _from.copy(p.grp.position); _from.y += 0.5;
        fireEnemyLaser(_from, 230, run.diff.aimErr * 1.6);
      }
      if (p.grp.userData.eye) p.grp.userData.eye.material.emissiveIntensity = 1.6 + Math.sin(run.time * 5 + p.phase) * 0.8;
    }
  }

  function updateTurrets(dt) {
    for (const t of turrets) {
      if (!t.active) continue;
      // yaw the whole turret toward the player
      V.copy(ship.position); V.y = t.grp.position.y;
      t.grp.lookAt(V);
      if (t.light) t.light.material.emissiveIntensity = 2 + Math.sin(run.time * 8) * 1.2;
      if (turretsSilent) continue;
      const dist = t.grp.position.distanceTo(ship.position);
      if (t.burst > 0) {
        t.burstT -= dt;
        if (t.burstT <= 0) {
          t.burst--; t.burstT = 0.16;
          _from.copy(t.grp.position); _from.y += t.aimY;
          fireEnemyLaser(_from, 320);
        }
      } else {
        t.fireCd -= dt;
        if (t.fireCd <= 0 && dist < 500) {
          t.burst = 3; t.burstT = 0;
          t.fireCd = 1.8 + Math.random() * run.diff.fire;
        }
      }
    }
  }

  function updateGenerators(dt) {
    for (const g of generators) {
      if (!g.active) continue;
      if (g.grp.userData.ring) g.grp.userData.ring.material.emissiveIntensity = 2 + Math.sin(run.time * 2.4) * 0.8;
      if (g.grp.userData.tip) g.grp.userData.tip.material.emissiveIntensity = 2 + Math.sin(run.time * 6) * 1.2;
    }
    for (const p of ports) {
      if (!p.active) continue;
      if (p.grp.userData.ring) p.grp.userData.ring.material.emissiveIntensity = 2.4 + Math.sin(run.time * 5) * 1.0;
    }
    for (const o of oscillators) {
      if (!o.active) continue;
      if (o.grp.userData.vent) o.grp.userData.vent.material.emissiveIntensity =
        o.shielded ? 0.8 : 2.4 + Math.sin(run.time * 3) * 0.9;
      if (o.grp.userData.beacon) o.grp.userData.beacon.material.emissiveIntensity = 2 + Math.sin(run.time * 8) * 1.2;
    }
  }

  function killTarget(e) {
    e.active = false; e.grp.visible = false;
    const big = !!BIG_BOOM[e.kind];
    run.score += SCORE[e.kind]; run.kills++;
    explode(targetCenter(e, V), big);
    if (e.kind === 'port' || e.kind === 'oscillator') {
      // finale: chain of secondary blasts
      for (let i = 0; i < 4; i++) {
        targetCenter(e, V);
        V2.set((Math.random() - 0.5) * 50, Math.random() * 26, (Math.random() - 0.5) * 50).add(V);
        explode(V2, true);
      }
    }
    audio.explosion(big);
    if (run.lockTarget === e) { run.lockTarget = null; run.lock = 0; run.locked = false; }
    if (onKill) onKill(e.kind);
  }

  function targetCenter(e, out) {
    out.copy(e.grp.position);
    if (e.aimOff) out.add(e.aimOff);
    else if (e.aimY) out.y += e.aimY;
    return out;
  }

  // ---------------- projectiles ----------------
  // closest approach of segment p0→p1 to point c, against radius r
  function segHit(p0, p1, c, r) {
    const dx = p1.x - p0.x, dy = p1.y - p0.y, dz = p1.z - p0.z;
    const wx = c.x - p0.x, wy = c.y - p0.y, wz = c.z - p0.z;
    const len2 = dx * dx + dy * dy + dz * dz;
    let t = len2 > 0 ? (wx * dx + wy * dy + wz * dz) / len2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const px = wx - dx * t, py = wy - dy * t, pz = wz - dz * t;
    return px * px + py * py + pz * pz < r * r;
  }

  function updatePlayerLasers(dt) {
    for (const l of pLasers) {
      if (!l.active) continue;
      l.prev.copy(l.mesh.position);
      l.mesh.position.addScaledVector(l.vel, dt);
      l.ttl -= dt;
      if (l.ttl <= 0) { l.active = false; l.mesh.visible = false; continue; }
      // terrain / buildings
      if (world && world.getHeight && l.mesh.position.y < flight.floorAt(l.mesh.position.x, l.mesh.position.z)) {
        spark(l.mesh.position); l.active = false; l.mesh.visible = false; continue;
      }
      if (world && world.boxHit && world.boxHit(l.mesh.position)) {
        spark(l.mesh.position); l.active = false; l.mesh.visible = false; continue;
      }
      // hostiles (the exhaust port is ray-shielded — torpedoes only; shielded
      // structures shrug lasers off entirely)
      for (const e of hostiles()) {
        if (e.kind === 'port' || e.shielded) continue;
        targetCenter(e, V3);
        if (segHit(l.prev, l.mesh.position, V3, e.r + 0.6)) {
          e.hp -= shipStats.laserDmg;
          l.active = false; l.mesh.visible = false;
          spark(l.mesh.position);
          if (e.hp <= 0) killTarget(e); else audio.hit();
          break;
        }
      }
      if (!l.active) continue;
      // obstacles (asteroids etc.)
      if (world) {
        for (const c of world.colliders) {
          V3.set(c.x, c.y, c.z);
          if (segHit(l.prev, l.mesh.position, V3, c.r)) {
            spark(l.mesh.position); l.active = false; l.mesh.visible = false; break;
          }
        }
      }
    }
  }

  function updateEnemyLasers(dt) {
    for (const l of eLasers) {
      if (!l.active) continue;
      l.prev.copy(l.mesh.position);
      l.mesh.position.addScaledVector(l.vel, dt);
      l.ttl -= dt;
      if (l.ttl <= 0) { l.active = false; l.mesh.visible = false; continue; }
      if (world && world.getHeight && l.mesh.position.y < flight.floorAt(l.mesh.position.x, l.mesh.position.z)) {
        l.active = false; l.mesh.visible = false; continue;
      }
      if (world && world.boxHit && world.boxHit(l.mesh.position)) {
        l.active = false; l.mesh.visible = false; continue;
      }
      if (segHit(l.prev, l.mesh.position, ship.position, 2.4)) {
        l.active = false; l.mesh.visible = false;
        hurtPlayer(8);
        spark(ship.position);
      }
    }
  }

  function updateTorpedoes(dt) {
    for (const t of torps) {
      if (!t.active) continue;
      t.prev.copy(t.mesh.position);
      if (t.target && t.target.active) {
        targetCenter(t.target, V);
        V2.copy(V).sub(t.mesh.position).normalize();
        t.dir.lerp(V2, Math.min(1, shipStats.torpTurn * dt)).normalize();
      }
      t.mesh.position.addScaledVector(t.dir, TORP_SPEED * dt);
      t.mesh.lookAt(V2.copy(t.mesh.position).add(t.dir));
      t.ttl -= dt;
      let dead = t.ttl <= 0;
      if (world && world.getHeight && t.mesh.position.y < flight.floorAt(t.mesh.position.x, t.mesh.position.z)) dead = true;
      if (world && world.boxHit && world.boxHit(t.mesh.position)) dead = true;
      // proximity fuse on any unshielded hostile
      for (const e of hostiles()) {
        if (e.shielded) continue;
        targetCenter(e, V3);
        if (segHit(t.prev, t.mesh.position, V3, e.r + 2.2)) {
          e.hp -= TORP_DMG[e.kind] || 99;
          if (e.hp <= 0) killTarget(e); else { explode(t.mesh.position, false); audio.explosion(false); }
          dead = true;
          break;
        }
      }
      if (dead) {
        explode(t.mesh.position, false);
        t.active = false; t.mesh.visible = false; t.target = null;
      }
    }
  }

  // ---------------- targeting / lock ----------------
  function updateLock(dt) {
    flight.forward(_fwd);
    let best = null, bestAngle = 0.16;
    for (const e of hostiles()) {
      if (e.shielded) continue;
      targetCenter(e, V);
      V.sub(ship.position);
      const dist = V.length();
      if (dist > 780 || dist < 12) continue;
      const angle = Math.acos(THREE.MathUtils.clamp(V.normalize().dot(_fwd), -1, 1));
      if (angle < bestAngle) { bestAngle = angle; best = e; }
    }
    if (best && best === run.lockTarget) {
      const was = run.locked;
      run.lock = Math.min(1, run.lock + dt / 0.85);
      run.locked = run.lock >= 1;
      if (run.locked && !was) audio.locked();
      else if (!run.locked && Math.random() < 0.2) audio.lockTick();
    } else {
      run.lockTarget = best;
      run.lock = best ? run.lock * 0.5 : 0;
      run.locked = false;
    }
  }

  // ---------------- particles ----------------
  function explode(pos, big) {
    const f = flashes.find(x => !x.active);
    if (f) {
      f.spr.position.copy(pos);
      f.size = big ? 54 : 28;
      f.spr.scale.setScalar(f.size * 0.4);
      f.spr.material.opacity = 0.85;
      f.life = 0; f.max = big ? 0.42 : 0.28;
      f.active = true; f.spr.visible = true;
    }
    boomLight.position.copy(pos);
    boomLight.intensity = big ? 900 : 380;
    spawnShock(pos, big ? 90 : 40);
    for (let i = 0, n = big ? 5 : 2; i < n; i++) spawnSmoke(pos, big ? 26 : 12);
    const count = big ? 30 : 16;
    let made = 0;
    for (const p of particles) {
      if (p.active) continue;
      p.mesh.position.copy(pos);
      p.vel.set((Math.random() * 2 - 1), (Math.random() * 2 - 1), (Math.random() * 2 - 1)).multiplyScalar(big ? 30 : 16);
      p.spin.set(Math.random() * 8, Math.random() * 8, Math.random() * 8);
      p.mesh.material.emissiveIntensity = big ? 4 : 3;
      p.base = big ? 2.2 : 1;
      p.mesh.scale.setScalar(p.base);
      p.life = 0; p.max = 0.5 + Math.random() * 0.5; p.active = true; p.mesh.visible = true;
      if (++made >= count) break;
    }
  }
  function spark(pos) {
    // small impact flash so hits pop
    const f = flashes.find(x => !x.active);
    if (f) {
      f.spr.position.copy(pos);
      f.size = 9;
      f.spr.scale.setScalar(4);
      f.spr.material.opacity = 0.9;
      f.life = 0; f.max = 0.16;
      f.active = true; f.spr.visible = true;
    }
    let made = 0;
    for (const p of particles) {
      if (p.active) continue;
      p.mesh.position.copy(pos);
      p.vel.set((Math.random() * 2 - 1), (Math.random() * 2 - 1), (Math.random() * 2 - 1)).multiplyScalar(9);
      p.spin.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
      p.mesh.material.emissiveIntensity = 3;
      p.base = 0.5; p.mesh.scale.setScalar(0.5);
      p.life = 0; p.max = 0.2 + Math.random() * 0.2; p.active = true; p.mesh.visible = true;
      if (++made >= 5) break;
    }
  }
  function updateParticles(dt) {
    for (const p of particles) {
      if (!p.active) continue;
      p.life += dt;
      p.mesh.position.addScaledVector(p.vel, dt);
      p.vel.multiplyScalar(0.92);
      p.mesh.rotation.x += p.spin.x * dt; p.mesh.rotation.y += p.spin.y * dt;
      const k = 1 - p.life / p.max;
      p.mesh.scale.setScalar(Math.max(0.01, k) * (p.base || 1));
      if (p.life >= p.max) { p.active = false; p.mesh.visible = false; }
    }
    for (const f of flashes) {
      if (!f.active) continue;
      f.life += dt;
      const t = f.life / f.max;
      f.spr.scale.setScalar(f.size * (0.4 + t * 2.0));
      f.spr.material.opacity = Math.max(0, 0.85 * Math.pow(1 - t, 2.0));
      if (f.life >= f.max) { f.active = false; f.spr.visible = false; }
    }
    for (const s of smokes) {
      if (!s.active) continue;
      s.life += dt;
      const t = s.life / s.max;
      s.spr.position.addScaledVector(s.vel, dt);
      s.spr.scale.setScalar(s.size * (0.5 + t * 1.6));
      s.spr.material.opacity = 0.55 * (1 - t);
      if (s.life >= s.max) { s.active = false; s.spr.visible = false; }
    }
    for (const s of shocks) {
      if (!s.active) continue;
      s.life += dt;
      const t = s.life / s.max;
      s.spr.scale.setScalar(s.size * (0.2 + t * 1.1));
      s.spr.material.opacity = 0.85 * Math.pow(1 - t, 1.4);
      if (s.life >= s.max) { s.active = false; s.spr.visible = false; }
    }
    boomLight.intensity *= Math.exp(-8 * dt);
    if (boomLight.intensity < 1) boomLight.intensity = 0;
  }

  // ---------------- damage ----------------
  function hurtPlayer(amount) {
    if (run.over) return;
    amount *= run.diff.dmg;
    run.shieldCd = 2.2;
    if (run.shields > 0) {
      run.shields -= amount;
      if (run.shields < 0) { run.hull += run.shields; run.shields = 0; }
    } else {
      run.hull -= amount;
    }
    run.hurt = 0.4;
    audio.damage();
    if (run.hull <= 0 && !run.over) {
      run.hull = 0; run.over = true;
      explode(ship.position, true); audio.explosion(true);
      onLose();
    }
  }

  // ---------------- main update ----------------
  let smokeCd = 0;
  function update(dt) {
    if (run.over) { updateParticles(dt); return; }
    run.time += dt;

    // flight (movement + its collisions report back through hurtPlayer)
    flight.update(dt, (dmg) => hurtPlayer(dmg));

    // weapons
    fireCd -= dt; torpCd -= dt;
    if (input.state.fire && fireCd <= 0) { firePlayerLasers(); fireCd = shipStats.laserCd; }
    if (input.state.torpedoEdge) fireTorpedo();

    updateLock(dt);
    updateTies(dt);
    updateProbes(dt);
    updateTurrets(dt);
    updateGenerators(dt);
    updatePlayerLasers(dt);
    updateEnemyLasers(dt);
    updateTorpedoes(dt);
    updateParticles(dt);

    // shield regen
    run.shieldCd -= dt;
    if (run.shieldCd <= 0 && run.shields < run.shieldCap) {
      run.shields = Math.min(run.shieldCap, run.shields + run.diff.regen * shipStats.shieldRegen * dt);
    }
    if (run.hurt > 0) run.hurt -= dt;

    // hull damage reads as a smoke trail
    smokeCd -= dt;
    if (run.hull < 40 && smokeCd <= 0) {
      smokeCd = 0.10 + (run.hull / 40) * 0.2;
      V.copy(ship.position);
      flight.forward(_fwd);
      V.addScaledVector(_fwd, -1.6);
      spawnSmoke(V, 2.2 + (40 - run.hull) * 0.05, 0.7);
    }
    updateDust(dt);
  }

  // ---------------- HUD snapshot ----------------
  const size = () => engine.size;
  function toScreen(v, out) {
    V2.copy(v).project(camera);
    const { W, H } = size();
    out.x = (V2.x * 0.5 + 0.5) * W;
    out.y = (-V2.y * 0.5 + 0.5) * H;
    out.behind = V2.z > 1;
    return out;
  }
  const _sp = { x: 0, y: 0, behind: false }, _sp2 = { x: 0, y: 0, behind: false };
  const _camLocal = new THREE.Vector3();

  // objective: {point:Vector3|null, rings:[{pos,passed}]|null, nextRing:idx}
  function hudSnapshot(objective) {
    const { W, H } = size();
    flight.forward(_fwd);

    // reticle: convergence point far ahead
    V.copy(ship.position).addScaledVector(_fwd, 300);
    toScreen(V, _sp);
    const reticle = _sp.behind ? null : { x: _sp.x, y: _sp.y };

    // enemy boxes + lead pip
    const targets = [];
    let lead = null;
    for (const e of hostiles()) {
      targetCenter(e, V);
      toScreen(V, _sp);
      if (_sp.behind) continue;
      if (_sp.x < -60 || _sp.x > W + 60 || _sp.y < -60 || _sp.y > H + 60) continue;
      const dist = V.distanceTo(ship.position);
      const boxSize = THREE.MathUtils.clamp(2800 / (dist + 10), 15, 92);
      const isLock = e === run.lockTarget;
      targets.push({ x: _sp.x, y: _sp.y, size: boxSize, locked: isLock, lockT: isLock ? run.lock : 0, kind: e.kind });
      if (isLock && e.kind === 'tie') {
        // where the bolt will meet it
        e.vel.copy(e.dir).multiplyScalar(e.speed);
        const tHit = dist / (LASER_SPEED + flight.state.speed);
        V3.copy(V).addScaledVector(e.vel, tHit);
        toScreen(V3, _sp2);
        if (!_sp2.behind && Math.hypot(_sp2.x - _sp.x, _sp2.y - _sp.y) > 5) lead = { x: _sp2.x, y: _sp2.y };
      }
    }

    // next ring marker
    let ringMarker = null;
    if (objective && objective.rings && objective.nextRing < objective.rings.length) {
      const rg = objective.rings[objective.nextRing];
      toScreen(rg.pos, _sp);
      if (!_sp.behind) {
        const dist = rg.pos.distanceTo(ship.position);
        ringMarker = { x: _sp.x, y: _sp.y, size: THREE.MathUtils.clamp(5200 / (dist + 10), 20, 200), dist: Math.round(dist) };
      }
    }

    // off-screen arrow toward the objective point
    let arrow = null;
    const pt = objective && objective.point;
    if (pt) {
      toScreen(pt, _sp);
      const onScreen = !_sp.behind && _sp.x > W * 0.08 && _sp.x < W * 0.92 && _sp.y > H * 0.08 && _sp.y < H * 0.92;
      if (!onScreen) {
        _camLocal.copy(pt).applyMatrix4(camera.matrixWorldInverse);
        let ax = _camLocal.x, ay = _camLocal.y;
        if (_camLocal.z > 0) { ax = -ax; ay = -ay; }   // behind: flip
        arrow = { angle: Math.atan2(-ay, ax), dist: Math.round(pt.distanceTo(ship.position)) };
      }
    }

    // radar blips in ship-heading frame (forward = up)
    const blips = [];
    const RANGE = 1000;
    let fx = _fwd.x, fz = _fwd.z;
    const fl = Math.hypot(fx, fz) || 1; fx /= fl; fz /= fl;
    const rx = -fz, rz = fx;                            // right vector in XZ
    for (const e of hostiles()) {
      const dx = e.grp.position.x - ship.position.x, dz = e.grp.position.z - ship.position.z;
      const bx = (dx * rx + dz * rz) / RANGE, by = (dx * fx + dz * fz) / RANGE;
      if (Math.abs(bx) <= 1 && Math.abs(by) <= 1) blips.push({ x: bx, y: by, kind: e.kind });
    }
    if (objective && objective.rings) {
      for (let i = objective.nextRing; i < Math.min(objective.nextRing + 3, objective.rings.length); i++) {
        const rg = objective.rings[i];
        const dx = rg.pos.x - ship.position.x, dz = rg.pos.z - ship.position.z;
        const bx = (dx * rx + dz * rz) / RANGE, by = (dx * fx + dz * fz) / RANGE;
        if (Math.abs(bx) <= 1 && Math.abs(by) <= 1) blips.push({ x: bx, y: by, kind: i === objective.nextRing ? 'ringHot' : 'ring' });
      }
    }

    return {
      reticle, targets, lead, ringMarker, arrow, blips,
      hurt: run.hurt, boosting: flight.state.boosting,
      warning: flight.state.warning, storm: world ? world.deckIsStorm : false,
      lock: { t: run.lock, locked: run.locked, has: !!run.lockTarget },
      W, H,
    };
  }

  return {
    run, reset, update, setWorld, setOnKill, setShipStats, hudSnapshot, hurtPlayer,
    spawnTies, spawnProbes, spawnTurrets, spawnGenerators, spawnPort, spawnOscillator, setShielded, setTurretsSilent,
    setDustLevel,
    clearHostiles, aliveCount,
    explode, ties, probes, turrets, generators, ports, oscillators, pLasers, eLasers, torpPool: torps,
  };
}
