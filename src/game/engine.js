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
  scene.add(key);
  const fill = new THREE.DirectionalLight(0x4a6cff, 0.35);
  fill.position.set(80, -40, -100);
  scene.add(fill);

  // Per-world atmosphere: background, fog, light colors/intensities.
  function setAtmosphere(a) {
    scene.background = new THREE.Color(a.bg);
    scene.fog = a.fog ? new THREE.FogExp2(a.fog, a.fogDensity ?? 0.0008) : null;
    hemi.color.set(a.hemiSky); hemi.groundColor.set(a.hemiGround); hemi.intensity = a.hemiI ?? 0.55;
    key.color.set(a.keyColor); key.intensity = a.keyI ?? 1.15;
    if (a.keyPos) key.position.set(...a.keyPos);
    fill.color.set(a.fillColor ?? 0x4a6cff); fill.intensity = a.fillI ?? 0.35;
    renderer.toneMappingExposure = a.exposure ?? 1.15;
  }

  // ---- post-processing ----
  const composer = new EffectComposer(renderer);
  const renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);

  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.9, 0.5, 0.62);
  composer.addPass(bloom);

  const fxaa = new ShaderPass(FXAAShader);
  composer.addPass(fxaa);

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
    bloom.strength = q === 'high' ? 0.85 : q === 'medium' ? 0.65 : 0;
    resize();
  }

  function render() { composer.render(); }

  window.addEventListener('resize', () => resize());
  setQuality('high');
  resize();

  return { THREE, renderer, scene, camera, composer, bloom, fxaa, render, resize, setQuality, setAtmosphere,
    get quality() { return quality; }, get size() { return { W, H }; },
    get lost() { return contextLost; }, get coarse() { return coarse; } };
}
