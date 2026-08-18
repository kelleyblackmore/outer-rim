// models.js — procedural ship & structure geometry (no external assets).
import * as THREE from 'three';

const metal = (c, m = 0.6, r = 0.5) => new THREE.MeshStandardMaterial({ color: c, metalness: m, roughness: r });
const emissive = (c, i = 2.2) => new THREE.MeshStandardMaterial({ color: 0x000000, emissive: c, emissiveIntensity: i, roughness: 0.4 });
// every model throws shadows; glow-only meshes are skipped by the emissive test
const cast = g => {
  g.traverse(o => {
    if (!o.isMesh) return;
    const m = o.material;
    const glowOnly = m && ((m.emissive && m.color && m.color.getHex() === 0x000000) || m.transparent);
    o.castShadow = !glowOnly;
    o.receiveShadow = !glowOnly;
  });
  return g;
};

// procedural panel-line hull plating — detail without any external assets
const hullTex = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#d7dde6'; g.fillRect(0, 0, 256, 256);
  // panel patches in slightly varied tones
  for (let i = 0; i < 60; i++) {
    const x = Math.random() * 256, y = Math.random() * 256;
    const w = 14 + Math.random() * 48, h = 10 + Math.random() * 34;
    g.fillStyle = `rgba(${168 + Math.random() * 40 | 0},${175 + Math.random() * 40 | 0},${190 + Math.random() * 40 | 0},0.5)`;
    g.fillRect(x, y, w, h);
  }
  // panel lines
  g.strokeStyle = 'rgba(105,112,126,0.75)'; g.lineWidth = 1;
  for (let i = 0; i < 26; i++) {
    const v = Math.random() < 0.5;
    const p = Math.random() * 256, q = Math.random() * 256, len = 30 + Math.random() * 120;
    g.beginPath();
    if (v) { g.moveTo(p, q); g.lineTo(p, q + len); } else { g.moveTo(p, q); g.lineTo(p + len, q); }
    g.stroke();
  }
  // rivets + scorch flecks
  for (let i = 0; i < 140; i++) {
    g.fillStyle = Math.random() < 0.8 ? 'rgba(120,128,142,0.6)' : 'rgba(150,110,80,0.45)';
    g.fillRect(Math.random() * 256, Math.random() * 256, 1.5, 1.5);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
})();

// shared materials
const M = {
  hull:    new THREE.MeshStandardMaterial({ map: hullTex, metalness: 0.55, roughness: 0.55 }),
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

// ---------------- X-WING (shipyard-configurable) ----------------
const HULL_TONES = { light: 0xd7dde6, grey: 0x9aa2ae, dark: 0x565e6a };

// Rebuild the ship's contents inside the SAME Group, so every module holding a
// reference (flight, systems, main) keeps working across a refit.
export function refitXWing(g, cfg = {}) {
  const stripeCol = new THREE.Color(cfg.stripe || '#d23b2f');
  const glowCol = new THREE.Color(cfg.glow || '#59d4ff');
  const hullTone = HULL_TONES[cfg.hull] || HULL_TONES.light;
  const cannons = cfg.cannons || 'quad';

  // clear the previous fit
  while (g.children.length) {
    const c = g.children[g.children.length - 1];
    g.remove(c);
    c.traverse(o => { if (o.geometry) o.geometry.dispose(); });
  }

  // per-ship materials (shared M stays untouched for other models)
  const hullMat = new THREE.MeshStandardMaterial({ map: hullTex, color: hullTone, metalness: 0.55, roughness: 0.55 });
  const stripeMat = new THREE.MeshStandardMaterial({ color: stripeCol, metalness: 0.3, roughness: 0.6 });
  const glowMatEngine = () => new THREE.MeshStandardMaterial({ color: 0x000000, emissive: glowCol, emissiveIntensity: 3.4, roughness: 0.4 });

  // fuselage + nose
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.42, 3.0, 10), hullMat);
  body.rotation.x = Math.PI / 2;
  g.add(body);
  const nose = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.34, 1.5, 10), M.hullDk);
  nose.rotation.x = Math.PI / 2;
  nose.position.z = -2.15;
  g.add(nose);

  // canopy + frame spine
  const canopy = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), M.glass);
  canopy.scale.set(1, 0.7, 1.5);
  canopy.position.set(0, 0.24, -0.5);
  g.add(canopy);
  const spine = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.02, 0.86), M.hullDk);
  spine.position.set(0, 0.445, -0.5);
  g.add(spine);

  // squadron band on the nose
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.295, 0.315, 0.14, 10), stripeMat);
  band.rotation.x = Math.PI / 2;
  band.position.set(0, 0, -1.72);
  g.add(band);

  // astromech — dome takes the squadron colour
  const r2 = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: stripeCol, metalness: 0.4, roughness: 0.5 }));
  r2.position.set(0, 0.26, 0.35);
  g.add(r2);
  const r2eye = new THREE.Mesh(new THREE.SphereGeometry(0.035, 6, 6), M.tieDk);
  r2eye.position.set(0, 0.36, 0.24);
  g.add(r2eye);

  // dorsal spine + flank greeble strips + tail cap (the engines live on the
  // wings where a real T-65 keeps them)
  const dorsal = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.1, 1.5), M.panel);
  dorsal.position.set(0, 0.36, 0.75);
  g.add(dorsal);
  for (const s of [-1, 1]) {
    const strip = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.14, 1.9), M.panel);
    strip.position.set(s * 0.38, 0.05, 0.4);
    g.add(strip);
  }
  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.4, 0.5), M.hullDk);
  tail.position.z = 1.62;
  g.add(tail);

  const glowGeo = new THREE.CircleGeometry(0.16, 14);
  const trailGeo = new THREE.ConeGeometry(0.13, 1, 8, 1, true);
  trailGeo.rotateX(Math.PI / 2);          // apex toward +Z (astern)
  trailGeo.translate(0, 0, 0.5);          // base at origin, tail at +1
  const engineNodes = [];
  const trails = [];

  // S-foils with wing-root engine nacelles (intake ring forward, glow + trail
  // astern). Cannon fit varies: quad/rapid arm all four tips, twin-heavy runs
  // two fatter barrels on the upper foils.
  const wingCannons = [];
  const wingGeo = new THREE.BoxGeometry(2.4, 0.06, 0.9);
  const barrelR = cannons === 'twin' ? 0.085 : cannons === 'rapid' ? 0.04 : 0.05;
  const cannonGeo = new THREE.CylinderGeometry(barrelR, barrelR, cannons === 'twin' ? 1.7 : 1.4, 8);
  const tipGeo = new THREE.CylinderGeometry(barrelR * 1.7, barrelR * 1.7, 0.2, 8);
  const stripeGeo = new THREE.BoxGeometry(2.0, 0.07, 0.12);
  const nacGeo = new THREE.CylinderGeometry(0.17, 0.17, 1.9, 10);
  const intakeGeo = new THREE.TorusGeometry(0.17, 0.05, 8, 12);
  const configs = [
    { side: -1, up: 1 }, { side: 1, up: 1 }, { side: -1, up: -1 }, { side: 1, up: -1 },
  ];
  for (const c of configs) {
    const wing = new THREE.Group();
    const panel = new THREE.Mesh(wingGeo, hullMat);
    panel.position.x = c.side * 1.3;
    wing.add(panel);
    const stripe = new THREE.Mesh(stripeGeo, stripeMat);
    stripe.position.set(c.side * 1.55, 0.05, 0.2);
    wing.add(stripe);
    // engine nacelle at the wing root
    const nac = new THREE.Mesh(nacGeo, M.hullDk);
    nac.rotation.x = Math.PI / 2;
    nac.position.set(c.side * 0.62, 0.04, 0.45);
    wing.add(nac);
    const intake = new THREE.Mesh(intakeGeo, M.tieDk);
    intake.position.set(c.side * 0.62, 0.04, -0.52);
    wing.add(intake);
    const gl = new THREE.Mesh(glowGeo, glowMatEngine());
    gl.position.set(c.side * 0.62, 0.04, 1.42);
    gl.rotation.y = Math.PI;
    wing.add(gl); engineNodes.push(gl);
    const tr = new THREE.Mesh(trailGeo, new THREE.MeshBasicMaterial({
      color: glowCol, transparent: true, opacity: 0.55, depthWrite: false,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
    tr.position.set(c.side * 0.62, 0.04, 1.46);
    tr.scale.z = 1.6;
    wing.add(tr); trails.push(tr);
    const armed = cannons === 'twin' ? c.up === 1 : true;
    if (armed) {
      const cannon = new THREE.Mesh(cannonGeo, M.hullDk);
      cannon.rotation.x = Math.PI / 2;
      cannon.position.set(c.side * 2.45, 0, -0.55);
      wing.add(cannon);
      const tip = new THREE.Mesh(tipGeo, M.tieDk);
      tip.rotation.x = Math.PI / 2;
      tip.position.set(c.side * 2.45, 0, cannons === 'twin' ? -1.32 : -1.18);
      wing.add(tip);
      const muzzle = new THREE.Object3D();
      muzzle.position.set(c.side * 2.45, 0, cannons === 'twin' ? -1.45 : -1.3);
      wing.add(muzzle);
      wingCannons.push(muzzle);
    }
    wing.position.z = 0.9;
    wing.rotation.z = c.up * (c.side > 0 ? -0.28 : 0.28); // spread into an X
    g.add(wing);
  }

  g.userData.engineNodes = engineNodes;
  g.userData.wingCannons = wingCannons;
  g.userData.trails = trails;
  return cast(g);
}

// ---------------- Y-WING (BTL bomber) ----------------
function refitYWing(g, cfg, mats) {
  const { hullMat, stripeMat, glowMatEngine, glowCol } = mats;

  // cockpit / nose section
  const nose = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.42, 1.6), hullMat);
  nose.position.set(0, 0, -1.55);
  g.add(nose);
  const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.24, 0.8, 8), M.hullDk);
  tip.rotation.x = Math.PI / 2;
  tip.position.set(0, 0, -2.7);
  g.add(tip);
  const canopy = new THREE.Mesh(new THREE.SphereGeometry(0.26, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), M.glass);
  canopy.scale.set(1, 0.72, 1.4);
  canopy.position.set(0, 0.2, -1.45);
  g.add(canopy);
  const band = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.44, 0.16), stripeMat);
  band.position.set(0, 0, -2.15);
  g.add(band);

  // astromech
  const r2 = new THREE.Mesh(new THREE.SphereGeometry(0.15, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: new THREE.Color(cfg.stripe || '#d23b2f'), metalness: 0.4, roughness: 0.5 }));
  r2.position.set(0, 0.24, -0.62);
  g.add(r2);

  // exposed central spar (the stripped-down Y-wing look)
  const spar = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.28, 2.4), M.panel);
  spar.position.set(0, 0, 0.45);
  g.add(spar);
  for (let i = 0; i < 3; i++) {
    const grb = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.34, 0.18), M.hullDk);
    grb.position.set(0, 0, -0.3 + i * 0.75);
    g.add(grb);
  }
  const cross = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.09, 0.55), hullMat);
  cross.position.set(0, 0, 0.9);
  g.add(cross);

  const engineNodes = [], trails = [], wingCannons = [];
  const trailGeo = new THREE.ConeGeometry(0.15, 1, 8, 1, true);
  trailGeo.rotateX(Math.PI / 2);
  trailGeo.translate(0, 0, 0.5);
  // outboard engine nacelles
  for (const s of [-1, 1]) {
    const nac = new THREE.Mesh(new THREE.CylinderGeometry(0.21, 0.21, 2.6, 10), M.hullDk);
    nac.rotation.x = Math.PI / 2;
    nac.position.set(s * 1.18, 0, 0.75);
    g.add(nac);
    const domeCap = new THREE.Mesh(new THREE.SphereGeometry(0.24, 10, 8), hullMat);
    domeCap.position.set(s * 1.18, 0, -0.6);
    g.add(domeCap);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.05, 8, 12), stripeMat);
    ring.position.set(s * 1.18, 0, -0.42);
    g.add(ring);
    for (let i = 0; i < 2; i++) {
      const grb = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.3, 0.5), M.panel);
      grb.position.set(s * 1.18, 0.16, 0.2 + i * 0.9);
      g.add(grb);
    }
    const gl = new THREE.Mesh(new THREE.CircleGeometry(0.19, 14), glowMatEngine());
    gl.position.set(s * 1.18, 0, 2.06);
    gl.rotation.y = Math.PI;
    g.add(gl); engineNodes.push(gl);
    const tr = new THREE.Mesh(trailGeo, new THREE.MeshBasicMaterial({
      color: glowCol, transparent: true, opacity: 0.55, depthWrite: false,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
    tr.position.set(s * 1.18, 0, 2.1);
    tr.scale.z = 1.6;
    g.add(tr); trails.push(tr);
    // twin nose cannons
    const gun = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 1.1, 8), M.tieDk);
    gun.rotation.x = Math.PI / 2;
    gun.position.set(s * 0.14, -0.1, -2.35);
    g.add(gun);
    const muzzle = new THREE.Object3D();
    muzzle.position.set(s * 0.14, -0.1, -2.95);
    g.add(muzzle);
    wingCannons.push(muzzle);
  }

  g.userData.engineNodes = engineNodes;
  g.userData.wingCannons = wingCannons;
  g.userData.trails = trails;
}

// ---------------- A-WING (RZ-1 interceptor) ----------------
function refitAWing(g, cfg, mats) {
  const { hullMat, stripeMat, glowMatEngine, glowCol } = mats;

  // wedge body
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.3, 2.1), hullMat);
  body.position.set(0, 0, 0.15);
  g.add(body);
  const noseGeo = new THREE.CylinderGeometry(0.06, 0.78, 1.7, 4);
  const noseMesh = new THREE.Mesh(noseGeo, hullMat);
  noseMesh.rotation.x = Math.PI / 2;
  noseMesh.rotation.y = Math.PI / 4;
  noseMesh.scale.set(1.35, 1, 0.26);
  noseMesh.position.set(0, 0, -1.65);
  g.add(noseMesh);

  // canopy bubble
  const canopy = new THREE.Mesh(new THREE.SphereGeometry(0.26, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), M.glass);
  canopy.scale.set(0.85, 0.75, 1.5);
  canopy.position.set(0, 0.16, -0.35);
  g.add(canopy);

  // the famous painted top stripes
  for (const s of [-1, 1]) {
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.03, 2.0), stripeMat);
    stripe.position.set(s * 0.45, 0.165, 0.1);
    g.add(stripe);
  }
  const noseStripe = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.03, 1.1), stripeMat);
  noseStripe.position.set(0, 0.13, -1.6);
  g.add(noseStripe);

  const engineNodes = [], trails = [], wingCannons = [];
  const trailGeo = new THREE.ConeGeometry(0.14, 1, 8, 1, true);
  trailGeo.rotateX(Math.PI / 2);
  trailGeo.translate(0, 0, 0.5);
  for (const s of [-1, 1]) {
    // big twin engines
    const eng = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.26, 0.9, 10), M.hullDk);
    eng.rotation.x = Math.PI / 2;
    eng.position.set(s * 0.5, 0, 1.25);
    g.add(eng);
    const gl = new THREE.Mesh(new THREE.CircleGeometry(0.21, 14), glowMatEngine());
    gl.position.set(s * 0.5, 0, 1.72);
    gl.rotation.y = Math.PI;
    g.add(gl); engineNodes.push(gl);
    const tr = new THREE.Mesh(trailGeo, new THREE.MeshBasicMaterial({
      color: glowCol, transparent: true, opacity: 0.55, depthWrite: false,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
    tr.position.set(s * 0.5, 0, 1.76);
    tr.scale.z = 1.7;
    g.add(tr); trails.push(tr);
    // canted stabilizer fins
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.6, 0.55), M.hullDk);
    fin.position.set(s * 0.78, 0.34, 1.05);
    fin.rotation.z = s * -0.3;
    g.add(fin);
    // side-mounted cannon pods
    const pod = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.9, 8), M.tieDk);
    pod.rotation.x = Math.PI / 2;
    pod.position.set(s * 0.88, 0, -0.15);
    g.add(pod);
    const muzzle = new THREE.Object3D();
    muzzle.position.set(s * 0.88, 0, -0.75);
    g.add(muzzle);
    wingCannons.push(muzzle);
  }

  g.userData.engineNodes = engineNodes;
  g.userData.wingCannons = wingCannons;
  g.userData.trails = trails;
}

// ---------------- frame dispatcher ----------------
export function refitShip(g, cfg = {}) {
  const frame = cfg.frame || 'xwing';
  if (frame === 'xwing') return refitXWing(g, cfg);

  // shared paint materials for the other frames
  const stripeCol = new THREE.Color(cfg.stripe || '#d23b2f');
  const glowCol = new THREE.Color(cfg.glow || '#59d4ff');
  const hullTone = HULL_TONES[cfg.hull] || HULL_TONES.light;
  while (g.children.length) {
    const c = g.children[g.children.length - 1];
    g.remove(c);
    c.traverse(o => { if (o.geometry) o.geometry.dispose(); });
  }
  const mats = {
    hullMat: new THREE.MeshStandardMaterial({ map: hullTex, color: hullTone, metalness: 0.55, roughness: 0.55 }),
    stripeMat: new THREE.MeshStandardMaterial({ color: stripeCol, metalness: 0.3, roughness: 0.6 }),
    glowMatEngine: () => new THREE.MeshStandardMaterial({ color: 0x000000, emissive: glowCol, emissiveIntensity: 3.4, roughness: 0.4 }),
    glowCol,
  };
  if (frame === 'ywing') refitYWing(g, cfg, mats);
  else refitAWing(g, cfg, mats);
  return cast(g);
}

export function buildShip(cfg) {
  const g = new THREE.Group();
  refitShip(g, cfg);
  g.scale.setScalar(0.62);
  return g;
}

export function buildXWing(cfg) {
  return buildShip({ ...(cfg || {}), frame: 'xwing' });
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
  // top hatch + twin chin guns
  const hatch = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.24, 0.1, 8), M.tieDk);
  hatch.position.y = 0.6;
  g.add(hatch);
  for (const s of [-1, 1]) {
    const gun = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.5, 6), M.tieDk);
    gun.rotation.x = Math.PI / 2;
    gun.position.set(s * 0.1, -0.3, -0.62);
    g.add(gun);
  }
  const wingGeo = new THREE.CylinderGeometry(1.15, 1.15, 0.08, 6);
  const strutGeo = new THREE.BoxGeometry(0.5, 0.16, 0.16);
  const spokeGeo = new THREE.BoxGeometry(0.05, 2.08, 0.05);
  for (const s of [-1, 1]) {
    const wing = new THREE.Mesh(wingGeo, M.tieDk);
    wing.rotation.z = Math.PI / 2; wing.rotation.y = Math.PI / 2;
    wing.position.x = s * 1.15;
    g.add(wing);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(1.05, 0.05, 6, 6), M.tie);
    rim.rotation.y = Math.PI / 2; rim.position.x = s * 1.19;
    g.add(rim);
    // radial panel ribs + hub — the solar-array look
    for (let k = 0; k < 3; k++) {
      const spoke = new THREE.Mesh(spokeGeo, M.tie);
      spoke.position.x = s * 1.21;
      spoke.rotation.x = k * Math.PI / 3 + Math.PI / 6;
      g.add(spoke);
    }
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.12, 8), M.tie);
    hub.rotation.z = Math.PI / 2;
    hub.position.x = s * 1.21;
    g.add(hub);
    const strut = new THREE.Mesh(strutGeo, M.tie);
    strut.position.x = s * 0.6;
    g.add(strut);
  }
  // twin ion engines — the green-white glow TIEs show from behind
  const ions = [];
  for (const s of [-1, 1]) {
    const ion = new THREE.Mesh(new THREE.CircleGeometry(0.15, 10),
      new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xa8ffc0, emissiveIntensity: 2.0, roughness: 0.4 }));
    ion.position.set(s * 0.2, -0.04, 0.57);
    g.add(ion); ions.push(ion);
  }
  g.userData.ions = ions;
  g.userData.eye = eye;
  g.scale.setScalar(1.15);
  return cast(g);
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
  return cast(g);
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
  return cast(g);
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
  return cast(g);
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
  return cast(g);
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
  return cast(g);
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
  return cast(g);
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
