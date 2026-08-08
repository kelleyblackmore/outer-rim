// world.js — biome environments: terrain, sky, props, colliders.
// The SAME analytic height function drives the terrain mesh and flight collision,
// so the surface you see is exactly the surface you can hit.
import * as THREE from 'three';
import { makeNoise } from './noise.js';

const TERRAIN_SIZE = 6400;
const TERRAIN_SEG = 150;

// ---------------- shared builders ----------------

function gradientSky(cTop, cMid, cBot) {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {
      cTop: { value: new THREE.Color(cTop) },
      cMid: { value: new THREE.Color(cMid) },
      cBot: { value: new THREE.Color(cBot) },
    },
    vertexShader: `
      varying float vH;
      void main(){
        vH = normalize(position).y;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform vec3 cTop; uniform vec3 cMid; uniform vec3 cBot;
      varying float vH;
      void main(){
        float h = clamp(vH, -0.05, 1.0);
        vec3 c = h < 0.22
          ? mix(cBot, cMid, smoothstep(-0.05, 0.22, h))
          : mix(cMid, cTop, smoothstep(0.22, 0.9, h));
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(4200, 24, 16), mat);
  dome.frustumCulled = false;
  return dome;
}

function radialTexture(inner, outer, stops) {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 4, 64, 64, 64);
  for (const [t, col] of stops) grad.addColorStop(t, col);
  g.fillStyle = grad; g.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeSun(color, haze, scale, pos) {
  const tex = radialTexture(4, 64, [[0, '#ffffff'], [0.18, color], [0.5, haze], [1, 'rgba(0,0,0,0)']]);
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false });
  const s = new THREE.Sprite(mat);
  s.scale.setScalar(scale);
  s.position.copy(pos);
  return s;
}

function makeStars(count, brightness, tint) {
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < count; i++) {
    // full sphere shell — free flight can look anywhere
    const r = 3400 + Math.random() * 500;
    const u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2;
    const s = Math.sqrt(1 - u * u);
    pos[i * 3] = r * s * Math.cos(th);
    pos[i * 3 + 1] = r * u;
    pos[i * 3 + 2] = r * s * Math.sin(th);
    const t = Math.random();
    c.setHSL(tint + t * 0.08, 0.4, (0.55 + Math.random() * 0.4) * brightness);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mat = new THREE.PointsMaterial({ size: 2.2, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0.9, depthWrite: false, fog: false });
  const stars = new THREE.Points(geo, mat);
  stars.frustumCulled = false;
  return stars;
}

// terrain mesh from an analytic height function + per-vertex palette
function makeTerrain(heightFn, colorFn) {
  const geo = new THREE.PlaneGeometry(TERRAIN_SIZE, TERRAIN_SIZE, TERRAIN_SEG, TERRAIN_SEG);
  geo.rotateX(-Math.PI / 2);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    p.setY(i, heightFn(p.getX(i), p.getZ(i)));
  }
  geo.computeVertexNormals();
  const n = geo.attributes.normal;
  const colors = new Float32Array(p.count * 3);
  const col = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    colorFn(col, p.getY(i), n.getY(i), p.getX(i), p.getZ(i));
    colors[i * 3] = col.r; colors[i * 3 + 1] = col.g; colors[i * 3 + 2] = col.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1, metalness: 0 });
  const mesh = new THREE.Mesh(geo, mat);
  return mesh;
}

function scatter(root, geo, mat, count, placeFn, colliders, colliderR) {
  const inst = new THREE.InstancedMesh(geo, mat, count);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), v = new THREE.Vector3(), e = new THREE.Euler();
  for (let i = 0; i < count; i++) {
    const spec = placeFn(i);                    // {x,y,z, ry?, rx?, scale | sx/sy/sz}
    v.set(spec.x, spec.y, spec.z);
    e.set(spec.rx || 0, spec.ry || 0, spec.rz || 0);
    q.setFromEuler(e);
    if (spec.scale !== undefined) s.setScalar(spec.scale);
    else s.set(spec.sx || 1, spec.sy || 1, spec.sz || 1);
    m.compose(v, q, s);
    inst.setMatrixAt(i, m);
    if (colliders && colliderR) {
      const cr = colliderR(spec);
      if (cr) colliders.push({ x: spec.x, y: cr.y !== undefined ? cr.y : spec.y, z: spec.z, r: cr.r });
    }
  }
  inst.instanceMatrix.needsUpdate = true;
  root.add(inst);
  return inst;
}

const rand = (seedObj) => { // tiny LCG so worlds are stable run-to-run
  seedObj.s = (seedObj.s * 1664525 + 1013904223) >>> 0;
  return seedObj.s / 4294967296;
};

// ---------------- biomes ----------------

function buildBelt(root, colliders, rng) {
  // deep space: dense stars, a ringed planet backdrop, nebula glows, asteroid field
  root.add(makeStars(2600, 1.0, 0.55));

  // banded planet
  const c = document.createElement('canvas'); c.width = 8; c.height = 128;
  const g = c.getContext('2d');
  const bands = ['#6b5a4a', '#8a7660', '#5c4f42', '#7d6a54', '#94816a', '#55483c', '#83705a'];
  for (let i = 0; i < 128; i++) {
    g.fillStyle = bands[Math.floor(i / 128 * 34) % bands.length];
    g.fillRect(0, i, 8, 1);
  }
  const ptex = new THREE.CanvasTexture(c);
  ptex.colorSpace = THREE.SRGBColorSpace;
  const planet = new THREE.Mesh(new THREE.SphereGeometry(620, 32, 24),
    new THREE.MeshStandardMaterial({ map: ptex, roughness: 1, fog: false }));
  planet.position.set(-1900, 350, -2900);
  root.add(planet);
  const ring = new THREE.Mesh(new THREE.RingGeometry(760, 1180, 48),
    new THREE.MeshBasicMaterial({ color: 0x9a8a72, transparent: true, opacity: 0.35, side: THREE.DoubleSide, fog: false }));
  ring.position.copy(planet.position);
  ring.rotation.x = Math.PI / 2.4; ring.rotation.y = 0.3;
  root.add(ring);

  // nebula glows
  const nebTex = radialTexture(4, 64, [[0, 'rgba(110,70,160,0.55)'], [0.5, 'rgba(50,40,120,0.25)'], [1, 'rgba(0,0,0,0)']]);
  for (let i = 0; i < 5; i++) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: nebTex, transparent: true, depthWrite: false, fog: false, opacity: 0.7 }));
    sp.scale.setScalar(1400 + rand(rng) * 1200);
    const a = rand(rng) * Math.PI * 2;
    sp.position.set(Math.cos(a) * 2800, (rand(rng) - 0.5) * 1600, Math.sin(a) * 2800);
    root.add(sp);
  }

  // asteroid field — instanced, spheres as colliders
  const rockGeo = new THREE.IcosahedronGeometry(1, 1);
  // lumpy: displace vertices once (shared geometry keeps it cheap)
  const rp = rockGeo.attributes.position;
  const n = makeNoise(77);
  for (let i = 0; i < rp.count; i++) {
    const vx = rp.getX(i), vy = rp.getY(i), vz = rp.getZ(i);
    const d = 1 + (n.fbm(vx * 2 + 5, vy * 2 + vz * 2, 3) - 0.5) * 0.7;
    rp.setXYZ(i, vx * d, vy * d, vz * d);
  }
  rockGeo.computeVertexNormals();
  const rockMat = new THREE.MeshStandardMaterial({ color: 0x8a8478, roughness: 0.95, metalness: 0.05, flatShading: true });
  scatter(root, rockGeo, rockMat, 240, () => {
    const a = rand(rng) * Math.PI * 2;
    const r = 260 + rand(rng) * 1500;
    return {
      x: Math.cos(a) * r, y: (rand(rng) - 0.5) * 480, z: Math.sin(a) * r,
      ry: rand(rng) * Math.PI * 2, rx: rand(rng) * Math.PI,
      scale: 5 + rand(rng) * rand(rng) * 42,
    };
  }, colliders, spec => ({ r: spec.scale * 1.05 }));

  return {
    getHeight: null,
    atmosphere: { bg: 0x030409, fog: null, hemiSky: 0x9fc4ff, hemiGround: 0x0a0e18, hemiI: 0.5,
      keyColor: 0xfff4e0, keyI: 1.2, keyPos: [-800, 500, 600], fillColor: 0x4a6cff, fillI: 0.3, exposure: 1.15 },
    spawn: { x: 0, y: 40, z: 900 },
    update: null,
  };
}

function buildDunes(root, colliders, rng) {
  const n = makeNoise(1201);
  const heightFn = (x, z) => {
    const dune = n.fbm(x * 0.0012 + 3, z * 0.0012, 4) * 52;
    const mesaMask = n.fbm(x * 0.00034 + 13, z * 0.00034 + 5, 3);
    const mesa = THREE.MathUtils.smoothstep(mesaMask, 0.6, 0.74) * 105;
    return dune + mesa;
  };
  const colorFn = (col, h, ny, x, z) => {
    // sand → baked orange → dark mesa rock caps
    if (h > 70) col.setRGB(0.42, 0.27, 0.18);           // mesa rock
    else if (h > 42) col.setRGB(0.62, 0.4, 0.22);       // scree
    else col.setRGB(0.83, 0.65, 0.4);                   // sand
    if (ny < 0.82) col.multiplyScalar(0.78);            // steep faces darker
    col.multiplyScalar(0.92 + n.noise2(x * 0.02, z * 0.02) * 0.16);
  };
  root.add(makeTerrain(heightFn, colorFn));
  root.add(gradientSky(0x4e88cf, 0x9cbde2, 0xffd9a2));
  root.add(makeSun('#fff3c8', 'rgba(255,214,140,0.75)', 900, new THREE.Vector3(2400, 900, -2600)));

  // rock spires (cosmetic; the tall ones get colliders)
  const spireGeo = new THREE.ConeGeometry(6, 30, 6);
  const spireMat = new THREE.MeshStandardMaterial({ color: 0x6e4a2c, roughness: 1, flatShading: true });
  scatter(root, spireGeo, spireMat, 60, () => {
    const a = rand(rng) * Math.PI * 2, r = 150 + rand(rng) * 1700;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const sc = 0.7 + rand(rng) * 1.9;
    return { x, y: heightFn(x, z) + 15 * sc - 2, z, ry: rand(rng) * 3, scale: sc };
  }, colliders, spec => spec.scale > 1.5 ? { r: 9 * spec.scale, y: spec.y } : null);

  return {
    getHeight: heightFn,
    atmosphere: { bg: 0xffd9a2, fog: 0xe8c08a, fogDensity: 0.00042, hemiSky: 0xffe8c0, hemiGround: 0x9a6b3a, hemiI: 0.8,
      keyColor: 0xfff2d8, keyI: 1.5, keyPos: [900, 500, -800], fillColor: 0xff9a50, fillI: 0.25, exposure: 1.08 },
    spawn: { x: 0, y: heightFn(0, 900) + 90, z: 900 },
    update: null,
  };
}

function buildGlacier(root, colliders, rng) {
  const n = makeNoise(3407);
  const heightFn = (x, z) => {
    const field = n.fbm(x * 0.0011, z * 0.0011 + 9, 4) * 30;
    const ridgeMask = n.fbm(x * 0.0004 + 21, z * 0.0004 + 2, 3);
    const crest = ridgeMask > 0.58 ? n.ridge(x * 0.0016, z * 0.0016, 3) * 85 * ((ridgeMask - 0.58) / 0.42) : 0;
    return field + crest;
  };
  const colorFn = (col, h, ny, x, z) => {
    if (h > 60) col.setRGB(0.96, 0.98, 1.0);
    else if (h < 12) col.setRGB(0.5, 0.68, 0.85);        // blue ice pools
    else col.setRGB(0.85, 0.91, 0.97);
    if (ny < 0.8) col.multiplyScalar(0.82).lerp(new THREE.Color(0.45, 0.6, 0.8), 0.25);
    col.multiplyScalar(0.94 + n.noise2(x * 0.03, z * 0.03) * 0.1);
  };
  root.add(makeTerrain(heightFn, colorFn));
  root.add(gradientSky(0x2c4f8c, 0x7ea6d8, 0xdfeefc));
  root.add(makeSun('#ffffff', 'rgba(200,225,255,0.7)', 520, new THREE.Vector3(-2600, 500, 2200)));
  root.add(makeStars(500, 0.5, 0.55));

  // ice crystal spikes
  const spikeGeo = new THREE.ConeGeometry(4, 26, 5);
  const spikeMat = new THREE.MeshStandardMaterial({ color: 0xbfe0ff, roughness: 0.25, metalness: 0.1,
    flatShading: true, emissive: 0x2a5a8a, emissiveIntensity: 0.25 });
  scatter(root, spikeGeo, spikeMat, 80, () => {
    const a = rand(rng) * Math.PI * 2, r = 120 + rand(rng) * 1700;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const sc = 0.6 + rand(rng) * 2.2;
    return { x, y: heightFn(x, z) + 13 * sc - 2, z, ry: rand(rng) * 3, rz: (rand(rng) - 0.5) * 0.35, scale: sc };
  }, colliders, spec => spec.scale > 1.7 ? { r: 7 * spec.scale, y: spec.y } : null);

  // aurora ribbons — big additive gradient planes, undulated in update()
  const auroraTex = (() => {
    const c = document.createElement('canvas'); c.width = 256; c.height = 64;
    const g = c.getContext('2d');
    const grad = g.createLinearGradient(0, 0, 0, 64);
    grad.addColorStop(0, 'rgba(60,255,160,0)');
    grad.addColorStop(0.4, 'rgba(60,255,160,0.5)');
    grad.addColorStop(0.7, 'rgba(80,180,255,0.35)');
    grad.addColorStop(1, 'rgba(80,180,255,0)');
    g.fillStyle = grad; g.fillRect(0, 0, 256, 64);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  })();
  const ribbons = [];
  for (let i = 0; i < 3; i++) {
    const rb = new THREE.Mesh(new THREE.PlaneGeometry(4200, 500, 32, 1),
      new THREE.MeshBasicMaterial({ map: auroraTex, transparent: true, depthWrite: false, side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending, fog: false, opacity: 0.5 }));
    rb.position.set(0, 780 + i * 160, -1200 - i * 700);
    rb.rotation.z = (i - 1) * 0.12;
    root.add(rb); ribbons.push(rb);
  }

  return {
    getHeight: heightFn,
    atmosphere: { bg: 0xdfeefc, fog: 0xcfe4f8, fogDensity: 0.00038, hemiSky: 0xdceeff, hemiGround: 0x8fb2cc, hemiI: 0.85,
      keyColor: 0xffffff, keyI: 1.3, keyPos: [-900, 300, 800], fillColor: 0x5c88ff, fillI: 0.3, exposure: 1.08 },
    spawn: { x: 0, y: heightFn(0, 900) + 90, z: 900 },
    update: (dt, t) => {
      for (let i = 0; i < ribbons.length; i++) {
        const rb = ribbons[i];
        rb.material.opacity = 0.34 + Math.sin(t * 0.35 + i * 2.1) * 0.18;
        rb.position.y = 780 + i * 160 + Math.sin(t * 0.2 + i) * 40;
      }
    },
  };
}

function buildClouds(root, colliders, rng) {
  const n = makeNoise(5011);
  // storm deck: visually lumpy, collision treats y=8 as the hard deck
  const deckFn = (x, z) => n.fbm(x * 0.0016 + 2, z * 0.0016 + 8, 4) * 14 - 6;
  const colorFn = (col, h, ny) => {
    col.setRGB(0.92, 0.66, 0.52).lerp(new THREE.Color(0.55, 0.3, 0.4), THREE.MathUtils.clamp((6 - h) / 16, 0, 1));
    if (ny < 0.9) col.multiplyScalar(0.9);
  };
  const deck = makeTerrain(deckFn, colorFn);
  deck.material.roughness = 1;
  root.add(deck);
  root.add(gradientSky(0x3c2450, 0xc96a58, 0xffb27a));
  root.add(makeSun('#ffd9b0', 'rgba(255,150,90,0.8)', 1300, new THREE.Vector3(-2700, 350, 1800)));

  // drifting cloud puffs
  const puffTex = radialTexture(4, 64, [[0, 'rgba(255,220,200,0.85)'], [0.55, 'rgba(230,150,130,0.4)'], [1, 'rgba(0,0,0,0)']]);
  const puffs = [];
  for (let i = 0; i < 34; i++) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: puffTex, transparent: true, depthWrite: false, opacity: 0.85 }));
    const sc = 120 + rand(rng) * 320;
    sp.scale.set(sc, sc * 0.42, 1);
    sp.position.set((rand(rng) - 0.5) * 3800, 30 + rand(rng) * 380, (rand(rng) - 0.5) * 3800);
    sp.userData.drift = 6 + rand(rng) * 10;
    root.add(sp); puffs.push(sp);
  }

  // floating repulsor platforms — landable-looking discs with colliders
  const platGeo = new THREE.CylinderGeometry(26, 32, 9, 12);
  const platMat = new THREE.MeshStandardMaterial({ color: 0x8a7d88, roughness: 0.7, metalness: 0.35, flatShading: true });
  const plats = [];
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + rand(rng) * 0.5;
    const r = 260 + rand(rng) * 1100;
    const x = Math.cos(a) * r, z = Math.sin(a) * r, y = 120 + rand(rng) * 260;
    const p = new THREE.Mesh(platGeo, platMat);
    p.position.set(x, y, z);
    root.add(p); plats.push(p);
    const spikes = new THREE.Mesh(new THREE.ConeGeometry(9, 40, 8), platMat);
    spikes.position.set(x, y - 24, z); spikes.rotation.x = Math.PI;
    root.add(spikes);
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(1.6, 8, 8),
      new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xff5a2f, emissiveIntensity: 2.6 }));
    beacon.position.set(x, y + 7, z);
    root.add(beacon);
    colliders.push({ x, y, z, r: 34 });
  }

  // tibanna harvester balloons
  const balloonMat = new THREE.MeshStandardMaterial({ color: 0xc9a37a, roughness: 0.6, metalness: 0.1 });
  for (let i = 0; i < 5; i++) {
    const a = rand(rng) * Math.PI * 2, r = 500 + rand(rng) * 1200;
    const x = Math.cos(a) * r, z = Math.sin(a) * r, y = 200 + rand(rng) * 300;
    const b = new THREE.Mesh(new THREE.SphereGeometry(22, 14, 10), balloonMat);
    b.scale.y = 0.8; b.position.set(x, y, z);
    root.add(b);
    const gondola = new THREE.Mesh(new THREE.BoxGeometry(10, 6, 10), platMat);
    gondola.position.set(x, y - 26, z);
    root.add(gondola);
    colliders.push({ x, y, z, r: 26 });
  }

  return {
    getHeight: () => 8,          // hard storm deck — constant, terrain is visual only
    deckIsStorm: true,
    atmosphere: { bg: 0xffb27a, fog: 0xe8a688, fogDensity: 0.00052, hemiSky: 0xffd8c0, hemiGround: 0x9c5a6a, hemiI: 0.85,
      keyColor: 0xffd9b0, keyI: 1.45, keyPos: [-900, 260, 600], fillColor: 0xc05a80, fillI: 0.35, exposure: 1.1 },
    spawn: { x: 0, y: 190, z: 900 },
    update: (dt) => {
      for (const sp of puffs) {
        sp.position.x += sp.userData.drift * dt;
        if (sp.position.x > 2000) sp.position.x = -2000;
      }
    },
  };
}

function buildEmber(root, colliders, rng) {
  const n = makeNoise(9103);
  const heightFn = (x, z) => {
    const base = n.fbm(x * 0.001 + 4, z * 0.001 + 1, 4) * 46;
    const rid = n.ridge(x * 0.0007 + 2, z * 0.0007 + 6, 3) * 34;
    return base + rid - 12;      // sinks below the lava plane in the valleys
  };
  const colorFn = (col, h, ny, x, z) => {
    if (h < 9) col.setRGB(0.16, 0.05, 0.03);            // scorched shoreline
    else if (h > 46) col.setRGB(0.13, 0.12, 0.13);      // ash peaks
    else col.setRGB(0.09, 0.07, 0.08);                  // basalt
    if (ny < 0.8) col.multiplyScalar(1.25);             // cracked faces catch the glow
    col.multiplyScalar(0.9 + n.noise2(x * 0.03, z * 0.03) * 0.2);
  };
  root.add(makeTerrain(heightFn, colorFn));

  // lava sea fills every valley below y=4
  const lava = new THREE.Mesh(new THREE.PlaneGeometry(TERRAIN_SIZE, TERRAIN_SIZE, 1, 1),
    new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xff4a10, emissiveIntensity: 2.3, roughness: 0.6 }));
  lava.rotation.x = -Math.PI / 2;
  lava.position.y = 4;
  root.add(lava);

  root.add(gradientSky(0x070304, 0x2a0a06, 0x57140a));
  root.add(makeStars(700, 0.45, 0.02));

  // drifting embers
  const ecount = 320;
  const epos = new Float32Array(ecount * 3);
  for (let i = 0; i < ecount; i++) {
    epos[i * 3] = (rand(rng) - 0.5) * 2400;
    epos[i * 3 + 1] = rand(rng) * 300;
    epos[i * 3 + 2] = (rand(rng) - 0.5) * 2400;
  }
  const egeo = new THREE.BufferGeometry();
  egeo.setAttribute('position', new THREE.BufferAttribute(epos, 3));
  const embers = new THREE.Points(egeo, new THREE.PointsMaterial({ color: 0xff8a40, size: 3.2, sizeAttenuation: true,
    transparent: true, opacity: 0.8, depthWrite: false }));
  embers.frustumCulled = false;
  root.add(embers);

  // basalt columns
  const colGeo = new THREE.CylinderGeometry(5, 6, 34, 6);
  const colMat = new THREE.MeshStandardMaterial({ color: 0x17131a, roughness: 1, flatShading: true });
  scatter(root, colGeo, colMat, 50, () => {
    const a = rand(rng) * Math.PI * 2, r = 150 + rand(rng) * 1600;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const sc = 0.7 + rand(rng) * 1.8;
    return { x, y: heightFn(x, z) + 15 * sc - 3, z, ry: rand(rng) * 3, scale: sc };
  }, colliders, spec => spec.scale > 1.5 ? { r: 8 * spec.scale, y: spec.y } : null);

  return {
    getHeight: heightFn,
    lavaY: 4,
    atmosphere: { bg: 0x0a0405, fog: 0x220b07, fogDensity: 0.0006, hemiSky: 0x54201a, hemiGround: 0x1c0805, hemiI: 0.75,
      keyColor: 0xff6a3a, keyI: 0.8, keyPos: [-600, 700, 300], fillColor: 0x801f10, fillI: 0.35, exposure: 1.28 },
    spawn: { x: 0, y: heightFn(0, 900) + 90, z: 900 },
    update: (dt, t) => {
      lava.material.emissiveIntensity = 2.2 + Math.sin(t * 1.7) * 0.35;
      const a = egeo.attributes.position;
      for (let i = 0; i < ecount; i++) {
        let y = a.getY(i) + dt * (6 + (i % 5));
        if (y > 320) y = 0;
        a.setY(i, y);
      }
      a.needsUpdate = true;
    },
  };
}

const BUILDERS = { belt: buildBelt, dunes: buildDunes, glacier: buildGlacier, clouds: buildClouds, ember: buildEmber };

// ---------------- public API ----------------

export function buildWorld(engine, id) {
  const root = new THREE.Group();
  const colliders = [];
  const rng = { s: 0xC0FFEE ^ (id.length * 2654435761) };
  const spec = BUILDERS[id](root, colliders, rng);
  engine.scene.add(root);
  engine.setAtmosphere(spec.atmosphere);

  let time = 0;
  return {
    id, root, colliders,
    getHeight: spec.getHeight,
    deckIsStorm: !!spec.deckIsStorm,
    lavaY: spec.lavaY,
    spawn: spec.spawn,
    boundsR: 2100,
    update(dt) { time += dt; if (spec.update) spec.update(dt, time); },
    dispose() {
      engine.scene.remove(root);
      root.traverse(o => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) {
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          for (const m of mats) { if (m.map) m.map.dispose(); m.dispose(); }
        }
      });
    },
  };
}
