// engine.js — renderer, scene, camera, cinematic post-processing, quality tiers.
// Same architecture as trench-run's engine, plus per-world atmosphere hooks.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';

export const QUALITY = ['low', 'medium', 'high'];

export function createEngine(canvas) {
  const renderer = new THREE.WebGLRenderer({
    canvas, antialias: false, alpha: false, powerPreference: 'high-performance', stencil: false
  });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const coarse = matchMedia('(pointer:coarse)').matches;
  let contextLost = false;
  canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); contextLost = true; }, false);
  canvas.addEventListener('webglcontextrestored', () => { contextLost = false; resize(); }, false);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x03040a);

  const camera = new THREE.PerspectiveCamera(62, 1, 0.8, 5200);
  camera.position.set(0, 4, 14);
  camera.lookAt(0, 2, -20);

  // ---- lighting: worlds retune these via setAtmosphere ----
  const hemi = new THREE.HemisphereLight(0x9fc4ff, 0x0a0e18, 0.55);
  scene.add(hemi);
  const key = new THREE.DirectionalLight(0xbfd4ff, 1.15);
  key.position.set(-60, 120, 60);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -300; key.shadow.camera.right = 300;
  key.shadow.camera.top = 300; key.shadow.camera.bottom = -300;
  key.shadow.camera.near = 10; key.shadow.camera.far = 1400;
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 1.4;
  scene.add(key);
  scene.add(key.target);
  const fill = new THREE.DirectionalLight(0x4a6cff, 0.35);
  fill.position.set(80, -40, -100);
  scene.add(fill);

  // shadow camera tracks the ship so the (huge) worlds stay inside the map
  const keyDir = new THREE.Vector3(-0.4, 0.8, 0.4).normalize();
  function followShadow(pos) {
    key.position.copy(pos).addScaledVector(keyDir, 520);
    key.target.position.copy(pos);
  }

  // ---- image-based lighting: a PMREM env baked from the world's sky colors ----
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    uniforms: { cTop: { value: new THREE.Color() }, cMid: { value: new THREE.Color() }, cBot: { value: new THREE.Color() } },
    vertexShader: `varying float vH; void main(){ vH = normalize(position).y;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform vec3 cTop; uniform vec3 cMid; uniform vec3 cBot; varying float vH;
      void main(){ float h = clamp(vH, -1.0, 1.0);
        vec3 c = h < 0.0 ? mix(cMid, cBot, -h) : mix(cMid, cTop, h);
        gl_FragColor = vec4(c, 1.0); }`,
  });
  const envScene = new THREE.Scene();
  envScene.add(new THREE.Mesh(new THREE.SphereGeometry(60, 16, 12), envMat));
  let envRT = null;
  const ENV_LEVEL = 0.38;   // reflections only — the direct lights carry the scene
  function bakeEnvironment(top, mid, bot) {
    envMat.uniforms.cTop.value.set(top).multiplyScalar(ENV_LEVEL);
    envMat.uniforms.cMid.value.set(mid).multiplyScalar(ENV_LEVEL);
    envMat.uniforms.cBot.value.set(bot).multiplyScalar(ENV_LEVEL);
    const rt = pmrem.fromScene(envScene, 0.05);
    scene.environment = rt.texture;
    if (envRT) envRT.dispose();
    envRT = rt;
  }

  // Per-world atmosphere: background, fog, light colors/intensities.
  function setAtmosphere(a) {
    scene.background = new THREE.Color(a.bg);
    scene.fog = a.fog ? new THREE.FogExp2(a.fog, a.fogDensity ?? 0.0008) : null;
    hemi.color.set(a.hemiSky); hemi.groundColor.set(a.hemiGround); hemi.intensity = a.hemiI ?? 0.55;
    key.color.set(a.keyColor); key.intensity = a.keyI ?? 1.15;
    if (a.keyPos) keyDir.set(...a.keyPos).normalize();
    key.position.copy(keyDir).multiplyScalar(520);
    fill.color.set(a.fillColor ?? 0x4a6cff); fill.intensity = a.fillI ?? 0.35;
    renderer.toneMappingExposure = a.exposure ?? 1.15;
    // reflections: sky above, fog at the horizon, ground tone below
    bakeEnvironment(a.hemiSky, a.fog ?? a.bg, a.hemiGround);
  }

  // ---- post-processing ----
  const composer = new EffectComposer(renderer);
  const renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);

  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.9, 0.5, 0.62);
  composer.addPass(bloom);

  const fxaa = new ShaderPass(FXAAShader);
  composer.addPass(fxaa);

  // subtle vignette pulls the eye to the reticle
  const vignette = new ShaderPass({
    uniforms: { tDiffuse: { value: null }, darkness: { value: 0.32 }, offset: { value: 1.28 } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform sampler2D tDiffuse; uniform float darkness; uniform float offset;
      varying vec2 vUv;
      void main(){ vec4 c = texture2D(tDiffuse, vUv);
        vec2 d = (vUv - 0.5) * vec2(offset);
        c.rgb *= 1.0 - darkness * smoothstep(0.15, 0.9, dot(d, d));
        gl_FragColor = c; }`,
  });
  composer.addPass(vignette);

  const output = new OutputPass();
  composer.addPass(output);

  let quality = 'high';
  let W = 1, H = 1;

  function dprFor(q) {
    const cap = coarse
      ? (q === 'high' ? 1.5 : q === 'medium' ? 1.25 : 1)   // phones: keep the backing store sane
      : (q === 'high' ? 2 : q === 'medium' ? 1.4 : 1);
    return Math.min(window.devicePixelRatio || 1, cap);
  }

  function resize(fw, fh) {
    W = fw || window.innerWidth; H = fh || window.innerHeight;
    if (!W || !H) return;
    const dpr = dprFor(quality);
    renderer.setPixelRatio(dpr);
    renderer.setSize(W, H, false);
    composer.setPixelRatio(dpr);
    composer.setSize(W, H);
    camera.aspect = W / H;
    camera.updateProjectionMatrix();
    const px = 1 / (W * dpr), py = 1 / (H * dpr);
    fxaa.material.uniforms['resolution'].value.set(px, py);
    // bloom is low-frequency — render it at half res to cut fillrate ~4x
    bloom.setSize(Math.max(1, Math.round(W * 0.5)), Math.max(1, Math.round(H * 0.5)));
  }

  function setQuality(q) {
    quality = q;
    bloom.enabled = q !== 'low';
    fxaa.enabled = q !== 'low';
    vignette.enabled = q !== 'low';
    bloom.strength = q === 'high' ? 0.85 : q === 'medium' ? 0.65 : 0;
    // shadows: full soft on high, smaller map on medium, off on low
    const wantShadows = q !== 'low';
    if (renderer.shadowMap.enabled !== wantShadows) {
      renderer.shadowMap.enabled = wantShadows;
      scene.traverse(o => { if (o.material && o.material.isMeshStandardMaterial) o.material.needsUpdate = true; });
    }
    key.castShadow = wantShadows;
    const size = q === 'high' ? 2048 : 1024;
    if (key.shadow.mapSize.x !== size) {
      key.shadow.mapSize.set(size, size);
      if (key.shadow.map) { key.shadow.map.dispose(); key.shadow.map = null; }
    }
    resize();
  }

  function render() { composer.render(); }

  window.addEventListener('resize', () => resize());
  setQuality('high');
  resize();

  return { THREE, renderer, scene, camera, composer, bloom, fxaa, render, resize, setQuality, setAtmosphere,
    followShadow,
    get quality() { return quality; }, get size() { return { W, H }; },
    get lost() { return contextLost; }, get coarse() { return coarse; } };
}
