// models.js — procedural ship & structure geometry (no external assets).
import * as THREE from 'three';

const metal = (c, m = 0.6, r = 0.5) => new THREE.MeshStandardMaterial({ color: c, metalness: m, roughness: r });
const emissive = (c, i = 2.2) => new THREE.MeshStandardMaterial({ color: 0x000000, emissive: c, emissiveIntensity: i, roughness: 0.4 });

// shared materials
const M = {
  hull:    metal(0xd7dde6, 0.55, 0.55),
  hullDk:  metal(0x8b93a1, 0.6, 0.5),
  panel:   metal(0x5b6472, 0.7, 0.45),
  red:     new THREE.MeshStandardMaterial({ color: 0xd23b2f, metalness: 0.3, roughness: 0.6 }),
  glass:   new THREE.MeshStandardMaterial({ color: 0x0a1420, metalness: 0.1, roughness: 0.15, emissive: 0x2a4866, emissiveIntensity: 0.6 }),
  engine:  emissive(0x59d4ff, 3.4),
  tie:     metal(0x2b2f39, 0.5, 0.55),
  tieDk:   metal(0x171a22, 0.5, 0.6),
  tieGlow: emissive(0x7fa8c8, 0.7),
  towerA:  metal(0x3a4250, 0.65, 0.5),
  towerB:  metal(0x232935, 0.6, 0.55),
  warn:    emissive(0xff5a2f, 2.6),
  probeEye: emissive(0xff3b30, 2.2),
  shieldGlow: emissive(0x59a8ff, 2.4),
  ringHot: emissive(0xffd34d, 3.0),
  ringCold: emissive(0x3a7fd0, 1.1),
};

// ---------------- X-WING ----------------
export function buildXWing() {
  const g = new THREE.Group();

  // fuselage
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.42, 3.0, 10), M.hull);
  body.rotation.x = Math.PI / 2;
  g.add(body);

  // nose cone
  const nose = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.34, 1.5, 10), M.hullDk);
  nose.rotation.x = Math.PI / 2;
  nose.position.z = -2.15;
  g.add(nose);

  // cockpit canopy
  const canopy = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), M.glass);
  canopy.scale.set(1, 0.7, 1.5);
  canopy.position.set(0, 0.24, -0.5);
  g.add(canopy);

  // astromech bump
  const r2 = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2), M.panel);
  r2.position.set(0, 0.26, 0.35);
  g.add(r2);

  // engine block + 4 glowing thrusters at the rear
  const eBlock = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.5, 0.8), M.hullDk);
  eBlock.position.z = 1.5;
  g.add(eBlock);
  const thrusterGeo = new THREE.CylinderGeometry(0.16, 0.16, 0.34, 12);
  const glowGeo = new THREE.CircleGeometry(0.15, 14);
  const engineNodes = [];
  for (const [x, y] of [[-0.34, 0.26], [0.34, 0.26], [-0.34, -0.26], [0.34, -0.26]]) {
    const t = new THREE.Mesh(thrusterGeo, M.hullDk);
    t.rotation.x = Math.PI / 2; t.position.set(x, y, 1.85);
    g.add(t);
    const gl = new THREE.Mesh(glowGeo, M.engine.clone());
    gl.position.set(x, y, 2.03); gl.rotation.y = Math.PI;
    g.add(gl); engineNodes.push(gl);
  }

  // 4 S-foil wings in X formation, each with a cannon at the tip
  const wingCannons = [];
  const wingGeo = new THREE.BoxGeometry(2.4, 0.06, 0.9);
  const cannonGeo = new THREE.CylinderGeometry(0.05, 0.05, 1.4, 8);
  const stripeGeo = new THREE.BoxGeometry(2.0, 0.07, 0.12);
  const configs = [
    { side: -1, up: 1 }, { side: 1, up: 1 }, { side: -1, up: -1 }, { side: 1, up: -1 },
  ];
  for (const c of configs) {
    const wing = new THREE.Group();
    const panel = new THREE.Mesh(wingGeo, M.hull);
    panel.position.x = c.side * 1.3;
    wing.add(panel);
    const stripe = new THREE.Mesh(stripeGeo, M.red);
    stripe.position.set(c.side * 1.55, 0.05, 0.2);
    wing.add(stripe);
    const cannon = new THREE.Mesh(cannonGeo, M.hullDk);
    cannon.rotation.x = Math.PI / 2;
    cannon.position.set(c.side * 2.45, 0, -0.55);
    wing.add(cannon);
    // muzzle marker (used to spawn laser origins)
    const muzzle = new THREE.Object3D();
    muzzle.position.set(c.side * 2.45, 0, -1.3);
    wing.add(muzzle);
    wingCannons.push(muzzle);
    wing.position.z = 0.9;
    wing.rotation.z = c.up * (c.side > 0 ? -0.28 : 0.28); // spread into an X
    g.add(wing);
  }

  g.userData.engineNodes = engineNodes;
  g.userData.wingCannons = wingCannons;
  g.scale.setScalar(0.62);
  return g;
}

// ---------------- TIE FIGHTER ----------------
export function buildTIE() {
  const g = new THREE.Group();
  const pod = new THREE.Mesh(new THREE.SphereGeometry(0.62, 16, 12), M.tie);
  g.add(pod);
  const win = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.34, 0.12, 8), M.tieDk);
  win.rotation.x = Math.PI / 2; win.position.z = -0.56;
  g.add(win);
  const eye = new THREE.Mesh(new THREE.CircleGeometry(0.2, 8), M.tieGlow);
  eye.position.z = -0.63;
  g.add(eye);
  const wingGeo = new THREE.CylinderGeometry(1.15, 1.15, 0.08, 6);
  const strutGeo = new THREE.BoxGeometry(0.5, 0.16, 0.16);
  for (const s of [-1, 1]) {
    const wing = new THREE.Mesh(wingGeo, M.tieDk);
    wing.rotation.z = Math.PI / 2; wing.rotation.y = Math.PI / 2;
    wing.position.x = s * 1.15;
    g.add(wing);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(1.05, 0.05, 6, 6), M.tie);
    rim.rotation.y = Math.PI / 2; rim.position.x = s * 1.19;
    g.add(rim);
    const strut = new THREE.Mesh(strutGeo, M.tie);
    strut.position.x = s * 0.6;
    g.add(strut);
  }
  g.userData.eye = eye;
  g.scale.setScalar(1.15);
  return g;
}

// ---------------- PROBE DROID ----------------
export function buildProbe() {
  const g = new THREE.Group();
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.85, 12, 10, 0, Math.PI * 2, 0, Math.PI * 0.62), M.tieDk);
  g.add(head);
  const skirt = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.55, 0.5, 10), M.panel);
  skirt.position.y = -0.35;
  g.add(skirt);
  const eye = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 8), M.probeEye);
  eye.position.set(0, 0.05, -0.78);
  g.add(eye);
  // dangling manipulator arms
  const armGeo = new THREE.CylinderGeometry(0.05, 0.03, 1.5, 6);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const arm = new THREE.Mesh(armGeo, M.tieDk);
    arm.position.set(Math.cos(a) * 0.5, -1.25, Math.sin(a) * 0.5);
    arm.rotation.z = Math.cos(a) * 0.2; arm.rotation.x = -Math.sin(a) * 0.2;
    g.add(arm);
  }
  // antenna
  const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.9, 4), M.panel);
  ant.position.y = 0.85;
  g.add(ant);
  g.userData.eye = eye;
  g.scale.setScalar(1.5);
  return g;
}

// ---------------- SHIELD GENERATOR (ground structure) ----------------
export function buildGenerator() {
  const g = new THREE.Group();
  const base = new THREE.Mesh(new THREE.CylinderGeometry(7, 8.5, 3, 10), M.towerA);
  base.position.y = 1.5;
  g.add(base);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(5.6, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2), M.towerB);
  dome.position.y = 3;
  g.add(dome);
  // glowing equator ring — the "shield feed"
  const ring = new THREE.Mesh(new THREE.TorusGeometry(5.8, 0.35, 8, 28), M.shieldGlow.clone());
  ring.rotation.x = Math.PI / 2; ring.position.y = 3.2;
  g.add(ring);
  const spire = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.5, 6, 8), M.towerB);
  spire.position.y = 10.5;
  g.add(spire);
  const tip = new THREE.Mesh(new THREE.SphereGeometry(0.7, 8, 8), M.shieldGlow.clone());
  tip.position.y = 13.8;
  g.add(tip);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.4;
    const pod = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2, 2.4), M.towerB);
    pod.position.set(Math.cos(a) * 8.4, 1, Math.sin(a) * 8.4);
    g.add(pod);
  }
  g.userData.ring = ring;
  g.userData.tip = tip;
  return g;
}

// ---------------- TURRET ----------------
export function buildTurret() {
  const g = new THREE.Group();
  const base = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 2.1, 2.2, 8), M.towerA);
  base.position.y = 1.1;
  g.add(base);
  const head = new THREE.Mesh(new THREE.SphereGeometry(1.25, 10, 8), M.towerB);
  head.position.y = 2.6;
  g.add(head);
  const barrelGeo = new THREE.CylinderGeometry(0.12, 0.12, 2.6, 6);
  for (const s of [-1, 1]) {
    const b = new THREE.Mesh(barrelGeo, M.towerB);
    b.rotation.x = Math.PI / 2.6;
    b.position.set(s * 0.5, 3.1, -1.1);
    g.add(b);
  }
  const light = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 8), M.warn.clone());
  light.position.set(0, 3.9, 0);
  g.add(light);
  g.userData.light = light;
  return g;
}

// ---------------- TURBOLASER TOWER (Death Star surface gun) ----------------
export function buildTower() {
  const g = new THREE.Group();
  const base = new THREE.Mesh(new THREE.BoxGeometry(2.2, 2.4, 2.2), M.towerA);
  base.position.y = 1.2;
  g.add(base);
  const head = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.1, 1.7), M.towerB);
  head.position.y = 2.9;
  g.add(head);
  const barrelGeo = new THREE.CylinderGeometry(0.14, 0.14, 2.2, 8);
  for (const s of [-1, 1]) {
    const b = new THREE.Mesh(barrelGeo, M.towerB);
    b.rotation.x = Math.PI / 2.4;
    b.position.set(s * 0.4, 3.1, -1.0);
    g.add(b);
  }
  const light = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 8), M.warn.clone());
  light.position.set(0, 3.7, 0);
  g.add(light);
  for (let i = 0; i < 3; i++) {
    const s = new THREE.Mesh(new THREE.BoxGeometry(2.24, 0.14, 0.4), M.towerB);
    s.position.set(0, 0.5 + i * 0.7, 0);
    g.add(s);
  }
  g.userData.light = light;
  g.scale.setScalar(2.0);
  return g;
}

// ---------------- THERMAL EXHAUST PORT ----------------
export function buildPort() {
  const g = new THREE.Group();
  const housing = new THREE.Mesh(new THREE.BoxGeometry(11, 2.4, 11), M.towerA);
  g.add(housing);
  const recess = new THREE.Mesh(new THREE.BoxGeometry(6.8, 1.8, 6.8), M.towerB);
  recess.position.y = 0.7;
  g.add(recess);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(2.3, 0.32, 10, 28), M.ringHot.clone());
  ring.rotation.x = Math.PI / 2; ring.position.y = 1.7;
  g.add(ring);
  const hole = new THREE.Mesh(new THREE.CircleGeometry(2.1, 24),
    new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0x1a0f00, emissiveIntensity: 0.4 }));
  hole.rotation.x = -Math.PI / 2; hole.position.y = 1.72;
  g.add(hole);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(1.4, 3.2, 1.4), M.towerB);
    b.position.set(sx * 4.4, 0.8, sz * 4.4);
    g.add(b);
  }
  g.userData.ring = ring;
  return g;
}

// ---------------- THERMAL OSCILLATOR (Starkiller Base) ----------------
export function buildOscillator() {
  const g = new THREE.Group();
  // hexagonal fortress ring sunk into the crater
  const hull = new THREE.Mesh(new THREE.CylinderGeometry(120, 150, 64, 6), M.towerA);
  hull.position.y = 32;
  g.add(hull);
  const crown = new THREE.Mesh(new THREE.CylinderGeometry(86, 112, 26, 6), M.towerB);
  crown.position.y = 76;
  g.add(crown);
  // glowing thermal vent — the weak point (faces +Z)
  const vent = new THREE.Mesh(new THREE.BoxGeometry(34, 16, 4),
    new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xff3418, emissiveIntensity: 2.6, roughness: 0.4 }));
  vent.position.set(0, 30, 128);
  g.add(vent);
  const ventFrame = new THREE.Mesh(new THREE.BoxGeometry(44, 26, 6), M.towerB);
  ventFrame.position.set(0, 30, 125);
  g.add(ventFrame);
  // antenna spires + hull greebles
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
    const spire = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 2.4, 46, 6), M.towerB);
    spire.position.set(Math.cos(a) * 94, 108, Math.sin(a) * 94);
    g.add(spire);
    const blk = new THREE.Mesh(new THREE.BoxGeometry(26, 18, 26), M.towerB);
    blk.position.set(Math.cos(a) * 132, 14, Math.sin(a) * 132);
    g.add(blk);
  }
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(3, 10, 8), M.warn.clone());
  beacon.position.y = 92;
  g.add(beacon);
  g.userData.vent = vent;
  g.userData.beacon = beacon;
  return g;
}

// ---------------- RING GATE (mission waypoint) ----------------
export function buildRing() {
  const g = new THREE.Group();
  const torus = new THREE.Mesh(new THREE.TorusGeometry(9, 0.65, 10, 36), M.ringCold.clone());
  g.add(torus);
  // 4 marker pods around the rim
  const podGeo = new THREE.BoxGeometry(1.2, 1.2, 1.2);
  const pods = [];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const p = new THREE.Mesh(podGeo, M.towerB);
    p.position.set(Math.cos(a) * 9, Math.sin(a) * 9, 0);
    g.add(p); pods.push(p);
  }
  g.userData.torus = torus;
  g.userData.setHot = hot => {
    torus.material.emissive.set(hot ? 0xffd34d : 0x3a7fd0);
    torus.material.emissiveIntensity = hot ? 3.0 : 1.1;
  };
  g.userData.RADIUS = 9;
  return g;
}

export { M };
