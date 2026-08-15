// main.js — bootstrap, state machine, menu wiring, world switching, render loop.
import { createEngine } from './game/engine.js';
import { createInput } from './game/input.js';
import { createAudio } from './game/audio.js';
import { createHud } from './game/hud.js';
import { createFlight } from './game/flight.js';
import { createSystems } from './game/systems.js';
import { buildWorld } from './game/world.js';
import { buildXWing } from './game/models.js';
import { MISSIONS, MISSION_ORDER, createMissionRunner } from './game/missions.js';

const $ = id => document.getElementById(id);
const sceneCanvas = $('scene');
const hudCanvas = $('hud');

const reduceMotionMQ = matchMedia('(prefers-reduced-motion: reduce)');
let reduceMotion = reduceMotionMQ.matches;
if (reduceMotionMQ.addEventListener) reduceMotionMQ.addEventListener('change', e => { reduceMotion = e.matches; });

let engine;
try {
  engine = createEngine(sceneCanvas);
} catch (e) {
  const l = $('loading');
  if (l) l.innerHTML = '<p class="loading-txt">This game needs WebGL. Try a different browser, or turn on hardware acceleration.</p>';
  throw e;
}

const audio = createAudio();
const input = createInput(sceneCanvas);
const hud = createHud(hudCanvas);

const ship = buildXWing();
engine.scene.add(ship);
const flight = createFlight(ship, input, audio);

let world = buildWorld(engine, 'belt');       // menu backdrop
flight.setWorld(world);

const systems = createSystems({
  scene: engine.scene, camera: engine.camera, engine, audio, input, flight,
  onLose: () => finish(false),
  onBanner: (t, warn) => hud.banner(t, warn),
});
systems.setWorld(world);

const runner = createMissionRunner({
  systems, flight, audio,
  onBanner: (t, warn) => hud.banner(t, warn),
  onObjective: t => hud.setObjective(t),
  onComplete: () => finish(true),
  onFail: msg => finish(false, msg),
});

// ---------------- persisted settings ----------------
const LS_PREFIX = 'orpatrol.';
const bestFor = id => +(localStorage.getItem(LS_PREFIX + 'best.' + id) || 0);
const LS = {
  quality: localStorage.getItem(LS_PREFIX + 'quality'),
  muted: localStorage.getItem(LS_PREFIX + 'muted') === '1',
  diff: localStorage.getItem(LS_PREFIX + 'diff') || 'pilot',
};
const autoDefault = reduceMotion ? 'low'
  : (engine.coarse || (navigator.hardwareConcurrency || 8) <= 4) ? 'medium' : 'high';
let quality = ['low', 'medium', 'high'].includes(LS.quality) ? LS.quality : autoDefault;
if (sessionStorage.getItem('or.gpureset')) quality = 'low';
let difficulty = LS.diff;
engine.setQuality(quality);
$('quality-btn').textContent = quality.toUpperCase();
audio.setMuted(LS.muted);
$('sound-btn').textContent = LS.muted ? '🔇' : '♪';
$('sound-btn').classList.toggle('off', LS.muted);
$('sound-btn').setAttribute('aria-pressed', String(LS.muted));
document.querySelectorAll('.diff-row .diff').forEach(b => b.classList.toggle('sel', b.dataset.diff === difficulty));

function refreshBests() {
  document.querySelectorAll('[data-best]').forEach(el => {
    const b = bestFor(el.dataset.best);
    el.textContent = b > 0 ? b : '—';
  });
}
refreshBests();

// ---------------- player settings ----------------
const SETTING_DEFAULTS = { invertY: 'off', autoLevel: 'on', camBank: 'full',
  sensitivity: 100, throttleResp: 100, deadzone: 15, curve: 55 };
const SLIDER_KEYS = ['sensitivity', 'throttleResp', 'deadzone', 'curve'];
const settings = {};
for (const k of Object.keys(SETTING_DEFAULTS)) {
  let v = localStorage.getItem(LS_PREFIX + 'set.' + k);
  if (v === null) v = SETTING_DEFAULTS[k];
  else if (SLIDER_KEYS.includes(k)) {
    // migrate the old low/normal/high strings to slider percentages
    v = v === 'low' ? 75 : v === 'high' ? 135 : v === 'normal' ? 100 : +v;
    if (!Number.isFinite(v)) v = SETTING_DEFAULTS[k];
  }
  settings[k] = v;
}
function applySettings() {
  input.setOptions({
    invertY: settings.invertY === 'on',
    deadzone: settings.deadzone / 100,
    curve: settings.curve / 100,
  });
  flight.setOptions({
    sensitivity: settings.sensitivity / 100,
    throttleResp: settings.throttleResp / 100,
    autoLevel: settings.autoLevel !== 'off',
    camBank: settings.camBank === 'reduced' ? 0.15 : 0.5,
  });
  document.querySelectorAll('.seg').forEach(seg => {
    const key = seg.dataset.set;
    seg.querySelectorAll('[data-val]').forEach(b => b.classList.toggle('sel', b.dataset.val === settings[key]));
  });
  for (const k of SLIDER_KEYS) {
    const el = $('sl-' + k);
    if (el) { el.value = settings[k]; $('sl-' + k + '-v').textContent = settings[k] + '%'; }
  }
}
document.querySelectorAll('.seg [data-val]').forEach(b => b.addEventListener('click', () => {
  const key = b.closest('.seg').dataset.set;
  settings[key] = b.dataset.val;
  localStorage.setItem(LS_PREFIX + 'set.' + key, b.dataset.val);
  applySettings();
}));
for (const k of SLIDER_KEYS) {
  const el = $('sl-' + k);
  if (el) el.addEventListener('input', () => {
    settings[k] = +el.value;
    localStorage.setItem(LS_PREFIX + 'set.' + k, String(settings[k]));
    applySettings();
  });
}
applySettings();

// ---------------- control bindings ----------------
try {
  const saved = JSON.parse(localStorage.getItem(LS_PREFIX + 'bind') || 'null');
  if (saved) input.setBinds(saved);
} catch (e) { /* corrupted save — defaults stand */ }
function saveBinds() { localStorage.setItem(LS_PREFIX + 'bind', JSON.stringify(input.getBinds())); }
$('binds-reset').addEventListener('click', () => {
  input.resetBinds(); saveBinds();
  $('binds-reset').textContent = 'CONTROLS RESET ✓';
  setTimeout(() => { $('binds-reset').textContent = 'RESET CONTROLS'; }, 1200);
});

// ---------------- live control mapping (map buttons while flying) ----------------
const MAP_ACTIONS = [
  ['fire', 'FIRE LASERS'], ['torpedo', 'FIRE TORPEDO'], ['boost', 'BOOST'],
  ['thrUp', 'THROTTLE UP'], ['thrDn', 'THROTTLE DOWN'],
  ['rollLeft', 'ROLL LEFT'], ['rollRight', 'ROLL RIGHT'],
];
let mapperOn = false, mapIdx = 0;
function startMapper() {
  // mapping happens in flight: resume the paused mission, or launch one
  if (state === 'settings' && settingsReturn === 'pause') {
    state = 'paused'; showScreen('pause'); togglePause(false);
  } else if (state !== 'playing') {
    startMission(currentMission || 'belt');
  }
  mapperOn = true; mapIdx = 0;
  $('mapper').classList.remove('hidden');
  nextCapture();
}
function nextCapture() {
  if (!mapperOn) return;
  if (mapIdx >= MAP_ACTIONS.length) return endMapper(true);
  const [, label] = MAP_ACTIONS[mapIdx];
  $('map-current').textContent = label;
  input.captureNext(res => {
    if (!mapperOn) return;
    if (!res.cancel) {
      input.assignBinding(MAP_ACTIONS[mapIdx][0], res);
      saveBinds();
      $('map-bound').textContent = label + '  →  ' + res.label;
    }
    mapIdx++;
    setTimeout(nextCapture, 500);
  });
}
function endMapper(finished) {
  mapperOn = false;
  input.cancelCapture();
  $('map-current').textContent = 'CONTROLS SAVED';
  $('map-bound').textContent = '';
  setTimeout(() => $('mapper').classList.add('hidden'), 1000);
}
function hideMapper() {
  if (!mapperOn) return;
  mapperOn = false;
  input.cancelCapture();
  $('mapper').classList.add('hidden');
}
$('map-btn').addEventListener('click', startMapper);
$('map-skip').addEventListener('click', () => { if (!mapperOn) return; input.cancelCapture(); mapIdx++; nextCapture(); });
$('map-done').addEventListener('click', () => endMapper(false));

// ---------------- state machine ----------------
let state = 'loading';
let currentMission = null;
const screens = ['loading', 'title', 'howto', 'pause', 'result', 'settings'];
function showScreen(name) {
  $('overlay').classList.toggle('hidden', name === null);
  screens.forEach(s => $(s).classList.toggle('hidden', s !== name));
}
function setPlayingUI(on) {
  $('frame').classList.toggle('hidden', !on);
  $('pause-btn').classList.toggle('hidden', !on);
  if (input.state.isTouch) $('touch').classList.toggle('hidden', !on);
}

function setWorldFor(id) {
  if (world && world.id === id) return;
  if (world) world.dispose();
  world = buildWorld(engine, id);
  flight.setWorld(world);
  systems.setWorld(world);
}

function toTitle() {
  hideMapper();
  warp = 0; engine.setWarp(0);
  state = 'title'; showScreen('title'); setPlayingUI(false);
  runner.stop();
  systems.clearHostiles();
  audio.stopEngine(); input.resetEdges();
  hud.setObjective('');
  refreshBests();
  idleT = 0;
}

function startMission(id) {
  currentMission = id;
  audio.init(); audio.startEngine();
  setWorldFor(id);
  systems.reset(difficulty);
  flight.reset();
  runner.start(MISSIONS[id], world, engine.scene);
  input.resetEdges();
  state = 'playing'; showScreen(null); setPlayingUI(true);
}

function finish(won, failMsg) {
  if (state !== 'playing') return;
  hideMapper();
  state = 'result';
  const def = MISSIONS[currentMission];
  if (won) {
    const bonus = 1000 + Math.max(0, Math.round((def.par - systems.run.time) * 8));
    systems.run.score += bonus;
    audio.win();
  }
  const best = bestFor(currentMission);
  if (won && systems.run.score > best) localStorage.setItem(LS_PREFIX + 'best.' + currentMission, systems.run.score);
  const title = $('result-title');
  title.textContent = won ? (def.winTitle || 'SECTOR CLEAR') : (failMsg ? 'MISSION FAILED' : 'X-WING DOWN');
  title.classList.toggle('fail', !won);
  $('result-msg').textContent = won ? def.winMsg
    : (failMsg || 'Your fighter was lost on patrol. Another pilot will have to finish the job.');
  $('r-score').textContent = systems.run.score;
  $('r-kills').textContent = systems.run.kills;
  $('r-time').textContent = hud.fmtTime(systems.run.time);
  $('r-best').textContent = Math.max(best, won ? systems.run.score : 0) || '—';
  const nextId = MISSION_ORDER[(MISSION_ORDER.indexOf(currentMission) + 1) % MISSION_ORDER.length];
  $('next-btn').textContent = 'NEXT: ' + MISSIONS[nextId].name;
  $('next-btn').dataset.next = nextId;
  setPlayingUI(false);
  audio.stopEngine();
  setTimeout(() => { if (state === 'result') showScreen('result'); }, won ? 700 : 900);
}

function togglePause(force) {
  if (state === 'playing' && force !== false) { state = 'paused'; showScreen('pause'); audio.stopEngine(); input.clearAll(); }
  else if (state === 'paused' && force !== true) { state = 'playing'; showScreen(null); audio.startEngine(); }
}

// ---------------- menu wiring ----------------
document.querySelectorAll('.mcard').forEach(b => b.addEventListener('click', () => startMission(b.dataset.mission)));
$('again-btn').addEventListener('click', () => startMission(currentMission));
$('next-btn').addEventListener('click', e => startMission(e.currentTarget.dataset.next));
$('menu-btn').addEventListener('click', toTitle);
$('how-btn').addEventListener('click', () => { state = 'howto'; showScreen('howto'); });
$('how-back').addEventListener('click', toTitle);
// settings can be opened from the title or mid-mission from pause;
// DONE returns wherever it came from without touching the mission
let settingsReturn = 'title';
function openSettings(from) { settingsReturn = from; state = 'settings'; showScreen('settings'); }
$('set-btn').addEventListener('click', () => openSettings('title'));
$('pause-set-btn').addEventListener('click', () => openSettings('pause'));
$('set-back').addEventListener('click', () => {
  if (settingsReturn === 'pause') { state = 'paused'; showScreen('pause'); }
  else { state = 'title'; showScreen('title'); }
});
$('resume-btn').addEventListener('click', () => togglePause(false));
$('abort-btn').addEventListener('click', toTitle);
$('pause-btn').addEventListener('click', () => togglePause());
document.querySelectorAll('.diff-row .diff').forEach(b => b.addEventListener('click', () => {
  difficulty = b.dataset.diff; localStorage.setItem(LS_PREFIX + 'diff', difficulty);
  document.querySelectorAll('.diff-row .diff').forEach(x => x.classList.toggle('sel', x === b));
}));
$('sound-btn').addEventListener('click', () => {
  const m = !audio.muted; audio.setMuted(m); localStorage.setItem(LS_PREFIX + 'muted', m ? '1' : '0');
  $('sound-btn').textContent = m ? '🔇' : '♪';
  $('sound-btn').classList.toggle('off', m);
  $('sound-btn').setAttribute('aria-pressed', String(m));
  $('sound-btn').setAttribute('aria-label', m ? 'Sound off' : 'Sound on');
});
$('quality-btn').addEventListener('click', () => {
  const order = ['low', 'medium', 'high'];
  quality = order[(order.indexOf(quality) + 1) % 3];
  engine.setQuality(quality); localStorage.setItem(LS_PREFIX + 'quality', quality);
  $('quality-btn').textContent = quality.toUpperCase();
});
// touch buttons
$('boost-btn').addEventListener('touchstart', e => { e.preventDefault(); input.touchBtn.boostDown(); }, { passive: false });
$('boost-btn').addEventListener('touchend', () => input.touchBtn.boostUp());
$('torp-btn').addEventListener('touchstart', e => { e.preventDefault(); audio.init(); input.touchBtn.torpedo(); }, { passive: false });
$('thr-up').addEventListener('touchstart', e => { e.preventDefault(); input.touchBtn.thrUpDown(); }, { passive: false });
$('thr-up').addEventListener('touchend', () => input.touchBtn.thrUpUp());
$('thr-dn').addEventListener('touchstart', e => { e.preventDefault(); input.touchBtn.thrDnDown(); }, { passive: false });
$('thr-dn').addEventListener('touchend', () => input.touchBtn.thrDnUp());

document.addEventListener('visibilitychange', () => { if (document.hidden && state === 'playing') togglePause(true); });
window.addEventListener('blur', () => { if (state === 'playing') togglePause(true); });

// ---------------- idle (menu) animation ----------------
let idleT = 0;
function idle(dt) {
  if (reduceMotion) dt = 0;
  idleT += dt;
  ship.position.set(
    Math.sin(idleT * 0.3) * 30,
    40 + Math.sin(idleT * 0.5) * 8,
    600 - (idleT * 6) % 900
  );
  ship.rotation.set(0, 0, -Math.cos(idleT * 0.3) * 0.22);
  for (const n of ship.userData.engineNodes) n.material.emissiveIntensity = 2.6 + Math.sin(idleT * 30) * 0.3;
  engine.followShadow(ship.position);
  const cam = engine.camera;
  cam.up.set(0, 1, 0);
  cam.position.set(
    ship.position.x + Math.sin(idleT * 0.12) * 26,
    ship.position.y + 8 + Math.sin(idleT * 0.2) * 4,
    ship.position.z + 34
  );
  cam.lookAt(ship.position.x, ship.position.y, ship.position.z - 60);
  if (Math.abs(cam.fov - 62) > 0.01) { cam.fov = 62; cam.updateProjectionMatrix(); }
}

// ---------------- GPU watchdog ----------------
// On Windows a driver reset (TDR) can permanently remove the WebGL device —
// reload once at LOW quality; if it resets again, surface advice instead.
let lostSince = 0, gpuHandled = false;
const bootT = performance.now();
function gpuWatch(now) {
  if (!engine.lost) {
    lostSince = 0;
    if (now - bootT > 60000 && sessionStorage.getItem('or.gpureset')) sessionStorage.removeItem('or.gpureset');
    return;
  }
  if (!lostSince) lostSince = now;
  if (now - lostSince < 2500 || gpuHandled) return;
  gpuHandled = true;
  const again = sessionStorage.getItem('or.gpureset');
  $('loading').innerHTML = '<p class="loading-txt">' + (again
    ? 'GRAPHICS DEVICE KEEPS RESETTING — TRY ANOTHER BROWSER, OR UPDATE YOUR GPU DRIVER.'
    : 'GRAPHICS DEVICE RESET — RESTARTING…') + '</p>';
  state = 'loading'; showScreen('loading'); setPlayingUI(false);
  audio.stopEngine();
  if (!again) {
    sessionStorage.setItem('or.gpureset', '1');
    setTimeout(() => location.reload(), 900);
  }
}

// ---------------- per-frame playing tick (shared by rAF loop + debug step) ----
let warp = 0;
function playTick(dt) {
  systems.update(dt);            // includes flight.update
  runner.update(dt);
  world.update(dt);
  engine.followShadow(ship.position);
  // boost pulls the frame toward the horizon (high quality only, eased)
  warp += ((flight.state.boosting && !reduceMotion ? 0.11 : 0) - warp) * Math.min(1, 3.5 * dt);
  engine.setWarp(warp);
  flight.updateCamera(engine.camera, dt, reduceMotion);
  const snap = systems.hudSnapshot(runner.objectiveInfo());
  hud.updateFrame(systems.run, flight.state, snap, dt);
  hud.render(snap);
}

// ---------------- main loop ----------------
let last = performance.now();
function frame(now) {
  let dt = (now - last) / 1000; last = now;
  if (dt > 0.05) dt = 0.05;
  gpuWatch(now);
  const { W, H } = engine.size;

  try {
    if (W > 0 && H > 0 && !engine.lost) {
      if (state === 'playing') {
        input.update();
        if (input.state.pausePressed) { togglePause(); input.resetEdges(); }
        else {
          playTick(dt);
          input.resetEdges();
        }
      } else if (state === 'paused' || (state === 'settings' && settingsReturn === 'pause')) {
        // frozen; keep last frame
      } else {
        idle(dt);
        world.update(dt);
        hud.render(null);
      }
      engine.render();
    }
  } catch (e) { console.error('OuterRim loop error:', e); if (window.__ORERR !== undefined) window.__ORERR = String(e && e.stack || e); }

  requestAnimationFrame(frame);
}

window.addEventListener('load', () => engine.resize());
requestAnimationFrame(frame);

// reveal title once the module is running
setTimeout(() => { if (state === 'loading') toTitle(); }, 350);

// ---------------- debug hook (?debug) ----------------
if (/[?&]debug\b/.test(location.search)) {
  window.__ORERR = null;
  window.__OR = {
    engine, systems, flight, input, audio, hud, ship,
    get world() { return world; },
    runner,
    info: () => ({
      state, mission: currentMission, phase: runner.phaseIdx, done: runner.done,
      pos: { x: +ship.position.x.toFixed(1), y: +ship.position.y.toFixed(1), z: +ship.position.z.toFixed(1) },
      speed: +flight.state.speed.toFixed(1), throttle: +flight.state.throttle.toFixed(2),
      warning: flight.state.warning,
      run: { hull: Math.round(systems.run.hull), shields: Math.round(systems.run.shields),
        score: systems.run.score, kills: systems.run.kills, time: +systems.run.time.toFixed(1),
        torps: systems.run.torps, lock: +systems.run.lock.toFixed(2), locked: systems.run.locked, over: systems.run.over },
      alive: { tie: systems.aliveCount('tie'), probe: systems.aliveCount('probe'),
        turret: systems.aliveCount('turret'), generator: systems.aliveCount('generator') },
      rings: runner.ringsPassed,
      W: engine.size.W, H: engine.size.H, quality,
      err: window.__ORERR,
    }),
    start: (id, d) => { if (d) difficulty = d; startMission(id || 'belt'); },
    setState: s => { state = s; },
    // run N playing frames deterministically without rAF
    step: (frames, dt = 0.016) => {
      const errs = [];
      for (let i = 0; i < (frames || 1); i++) {
        try {
          input.update();
          playTick(dt);
          input.resetEdges();
          engine.render();
        } catch (e) { errs.push(String(e && e.stack || e)); break; }
      }
      return errs;
    },
    warp: (x, y, z) => { ship.position.set(x, y, z); },
    aim: (tx, ty, tz) => {        // point the nose at a world position
      const m = new engine.THREE.Matrix4();
      m.lookAt(ship.position, new engine.THREE.Vector3(tx, ty, tz), new engine.THREE.Vector3(0, 1, 0));
      ship.quaternion.setFromRotationMatrix(m);
    },
    mock: m => input.setMock(m),
    settings, applySettings,
    render: () => engine.render(),
    // manual sizing for hidden panes where window.innerWidth is 0
    resize: (w, h) => { engine.resize(w, h); hud.resize(w, h); },
    snap: (q = 0.5) => sceneCanvas.toDataURL('image/jpeg', q),
  };
}
