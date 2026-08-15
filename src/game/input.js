// input.js — unified free-flight controls: keyboard, mouse-steer, touch stick,
// gamepad, flight stick. steerX turns (yaw+bank), steerY pitches; both are RATE
// demands in -1..1. Buttons/keys are fully rebindable (see binds + captureNext).
export const BINDABLE_ACTIONS = ['fire', 'torpedo', 'boost', 'thrUp', 'thrDn', 'rollLeft', 'rollRight'];

const DEFAULT_BINDS = {
  keys: { fire: [' ', 'l'], torpedo: ['f'], boost: ['shift'], thrUp: ['w'], thrDn: ['s'],
    rollLeft: ['a', 'q'], rollRight: ['d', 'e'] },
  pad:  { fire: [0, 7], torpedo: [2, 3], boost: [6, 1], thrUp: [12], thrDn: [13], rollLeft: [4], rollRight: [5] },
  joy:  { fire: [0], torpedo: [1], boost: [2, 3], thrUp: [], thrDn: [], rollLeft: [], rollRight: [] },
};
const clone = o => JSON.parse(JSON.stringify(o));

export function createInput(canvas) {
  const isTouch = matchMedia('(pointer:coarse)').matches;
  const state = {
    steerX: 0, steerY: 0,      // -1..1 rate demand (steerY + = climb)
    roll: 0,                   // -1..1 manual roll (+ = roll right)
    throttleAxis: 0,           // -1 | 0 | +1 held
    throttleSet: null,         // 0..1 absolute (HOTAS throttle slider), or null
    fire: false, boost: false,
    torpedoEdge: false,
    pausePressed: false,
    isTouch, autofire: isTouch
  };
  const src = { kbFire: false, mouseFire: false, kbBoost: false, torpEdge: false, padTorpPrev: false };
  const keys = {};
  let mouse = null;            // {nx,ny} in -1..1, or null until first move

  // ---------- options (settings screen pushes these) ----------
  const opts = { invertY: false, deadzone: 0.15, curve: 0.55 };
  function setOptions(o) {
    if (o.invertY !== undefined) opts.invertY = !!o.invertY;
    if (o.deadzone !== undefined) opts.deadzone = Math.min(0.35, Math.max(0, o.deadzone));
    if (o.curve !== undefined) opts.curve = Math.min(1, Math.max(0, o.curve));
  }

  // response shaping: linear→cubic blend after the deadzone
  const shape = t => (1 - opts.curve) * t + opts.curve * t * t * t;
  const axis = (v, dz) => {
    const s = Math.sign(v), a = Math.abs(v);
    if (a < dz) return 0;
    return s * shape((a - dz) / (1 - dz));
  };

  // ---------- bindings ----------
  let binds = clone(DEFAULT_BINDS);
  const anyDown = list => list.some(k => keys[k]);
  const anyBtn = (p, list) => list.some(i => p.buttons[i] && p.buttons[i].pressed);
  function setBinds(b) {
    if (!b) return;
    for (const dev of ['keys', 'pad', 'joy']) {
      if (!b[dev]) continue;
      for (const a of BINDABLE_ACTIONS) if (Array.isArray(b[dev][a])) binds[dev][a] = b[dev][a].slice();
    }
  }
  function getBinds() { return clone(binds); }
  function resetBinds() { binds = clone(DEFAULT_BINDS); }
  // rebind: the control replaces the action's list and leaves every other action
  function assignBinding(action, target) {
    const map = binds[target.dev];
    if (!map || !BINDABLE_ACTIONS.includes(action)) return getBinds();
    for (const a of BINDABLE_ACTIONS) map[a] = map[a].filter(id => id !== target.id);
    map[action] = [target.id];
    return getBinds();
  }

  // ---------- live capture (mapping mode) ----------
  let capture = null;          // cb({dev,id,label} | {cancel:true})
  function captureNext(cb) { capture = cb; }
  function cancelCapture() { capture = null; }
  const keyLabel = k => k === ' ' ? 'SPACE' : k.length === 1 ? k.toUpperCase() : k.toUpperCase();

  // ---------- keyboard ----------
  addEventListener('keydown', e => {
    const k = e.key.toLowerCase();
    if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) e.preventDefault();
    if (e.repeat) return;
    if (capture) {
      e.preventDefault();
      const cb = capture; capture = null;
      cb(k === 'escape' ? { cancel: true } : { dev: 'keys', id: k, label: keyLabel(k) });
      return;
    }
    keys[k] = true;
    if (binds.keys.fire.includes(k)) src.kbFire = true;
    if (binds.keys.torpedo.includes(k)) src.torpEdge = true;
    if (binds.keys.boost.includes(k)) src.kbBoost = true;
    if (k === 'p' || k === 'escape') state.pausePressed = true;
  });
  addEventListener('keyup', e => {
    const k = e.key.toLowerCase();
    keys[k] = false;
    if (binds.keys.fire.includes(k)) src.kbFire = false;
    if (binds.keys.boost.includes(k)) src.kbBoost = false;
  });

  // ---------- mouse (desktop steer + fire; not rebindable) ----------
  if (!isTouch) {
    canvas.addEventListener('mousemove', e => {
      const r = canvas.getBoundingClientRect();
      mouse = { nx: (e.clientX - r.left) / r.width * 2 - 1, ny: (e.clientY - r.top) / r.height * 2 - 1 };
    });
    canvas.addEventListener('mousedown', e => {
      if (e.button === 0) src.mouseFire = true;
      else if (e.button === 2) src.torpEdge = true;
    });
    addEventListener('mouseup', e => { if (e.button === 0) src.mouseFire = false; });
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    canvas.addEventListener('mouseleave', () => { mouse = null; });
  }

  // ---------- touch virtual stick ----------
  let stickId = null, stickActive = false, stickCX = 0, stickCY = 0, stickX = 0, stickY = 0;
  const zone = document.getElementById('stick-zone');
  const base = document.getElementById('stick-base');
  const knob = document.getElementById('stick-knob');
  const R = 52;
  if (zone && base && knob) {
    zone.addEventListener('touchstart', e => {
      if (stickId !== null) return;   // a finger already owns the stick; ignore extras
      const t = e.changedTouches[0];
      stickId = t.identifier; stickActive = true; stickCX = t.clientX; stickCY = t.clientY;
      base.style.left = (stickCX - 59) + 'px'; base.style.top = (stickCY - 59) + 'px';
      base.classList.add('active'); knob.style.transform = 'translate(0,0)';
      e.preventDefault();
    }, { passive: false });
    zone.addEventListener('touchmove', e => {
      for (const t of e.changedTouches) {
        if (t.identifier !== stickId) continue;
        let dx = t.clientX - stickCX, dy = t.clientY - stickCY;
        const len = Math.hypot(dx, dy) || 1;
        const cl = Math.min(len, R);
        const kx = dx / len * cl, ky = dy / len * cl;
        knob.style.transform = `translate(${kx}px,${ky}px)`;
        const dz = 0.12, mag = cl / R;
        const out = mag < dz ? 0 : (mag - dz) / (1 - dz);
        stickX = (dx / len) * out; stickY = -(dy / len) * out;   // stick up = climb
      }
      e.preventDefault();
    }, { passive: false });
    const endStick = e => {
      for (const t of e.changedTouches) if (t.identifier === stickId) {
        stickId = null; stickActive = false; stickX = 0; stickY = 0;
        base.classList.remove('active'); knob.style.transform = 'translate(0,0)';
      }
    };
    zone.addEventListener('touchend', endStick);
    zone.addEventListener('touchcancel', endStick);
  }
  // external hooks for the touch buttons (wired in main)
  const touchBtn = {
    boostDown: () => { src.kbBoost = true; },
    boostUp: () => { src.kbBoost = false; },
    torpedo: () => { src.torpEdge = true; },
    thrUpDown: () => { keys['__thrUp'] = true; },
    thrUpUp: () => { keys['__thrUp'] = false; },
    thrDnDown: () => { keys['__thrDn'] = true; },
    thrDnUp: () => { keys['__thrDn'] = false; },
  };

  // ---------- per-frame combine ----------
  let prevButtons = [];
  function update() {
    // keyboard axes (arrows steer; the rest through bindings)
    let kx = 0, ky = 0, kr = 0, kt = 0;
    if (keys['arrowleft']) kx -= 1;
    if (keys['arrowright']) kx += 1;
    if (keys['arrowup']) ky += 1;
    if (keys['arrowdown']) ky -= 1;
    if (anyDown(binds.keys.rollLeft)) kr -= 1;
    if (anyDown(binds.keys.rollRight)) kr += 1;
    if (anyDown(binds.keys.thrUp) || keys['__thrUp']) kt += 1;
    if (anyDown(binds.keys.thrDn) || keys['__thrDn']) kt -= 1;

    // gamepad OR flight stick (HOTAS). Standard-mapped pads use thumbstick
    // conventions; anything else with 3+ axes is treated as a joystick:
    // X = turn, Y = pull-back-to-climb, twist = roll, slider = absolute throttle.
    let gx = 0, gy = 0, gr = 0, padAxis = false, padFire = false, padBoost = false, padTorp = false, gt = 0;
    let throttleSet = null, isJoystick = false;
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) {
      if (!p || !p.connected) continue;
      isJoystick = p.mapping !== 'standard';
      const bmap = isJoystick ? binds.joy : binds.pad;

      // capture: report the first rising-edge button, and swallow it
      if (capture) {
        for (let i = 0; i < p.buttons.length; i++) {
          const pressed = !!(p.buttons[i] && p.buttons[i].pressed);
          if (pressed && !prevButtons[i]) {
            const cb = capture; capture = null;
            cb({ dev: isJoystick ? 'joy' : 'pad', id: i, label: 'BTN ' + i });
            break;
          }
        }
      }
      const capturing = !!capture;

      if (isJoystick) {
        gx = axis(p.axes[0], opts.deadzone);
        gy = axis(p.axes[1], opts.deadzone);                      // pull back (+) = climb
        gr = p.axes.length > 2 ? axis(p.axes[2], opts.deadzone + 0.08) : 0;   // twist drifts more
        if (p.axes.length > 3 && Number.isFinite(p.axes[3])) {
          throttleSet = (1 - p.axes[3]) / 2;                      // slider forward = full
        }
      } else {
        gx = axis(p.axes[0], opts.deadzone);
        gy = -axis(p.axes[1], opts.deadzone);                     // stick up = climb
        gr = p.axes.length > 2 ? axis(p.axes[2], opts.deadzone) : 0;
      }
      if (!capturing) {
        padFire = anyBtn(p, bmap.fire);
        padBoost = anyBtn(p, bmap.boost);
        padTorp = anyBtn(p, bmap.torpedo);
        if (anyBtn(p, bmap.thrUp)) gt += 1;
        if (anyBtn(p, bmap.thrDn)) gt -= 1;
        if (anyBtn(p, bmap.rollLeft)) gr -= 1;
        if (anyBtn(p, bmap.rollRight)) gr += 1;
      }
      prevButtons = p.buttons.map(b => !!(b && b.pressed));
      break;
    }
    state.throttleSet = throttleSet;
    padAxis = !!(gx || gy);

    // priority: keys > touch stick > pad > mouse
    let joyOwnsPitch = false;
    if (kx || ky) { state.steerX = kx; state.steerY = ky; }
    else if (stickActive) { state.steerX = stickX; state.steerY = stickY; }
    else if (padAxis) { state.steerX = gx; state.steerY = gy; joyOwnsPitch = isJoystick; }
    else if (!isTouch && mouse) { state.steerX = axis(mouse.nx, 0.07); state.steerY = axis(-mouse.ny, 0.07); }
    else { state.steerX = 0; state.steerY = 0; }
    // invert-pitch setting: HOTAS sticks are already pull-to-climb, skip them
    if (opts.invertY && !joyOwnsPitch) state.steerY = -state.steerY;

    state.roll = Math.max(-1, Math.min(1, kr + gr));
    state.throttleAxis = kt || gt || 0;

    if (padTorp && !src.padTorpPrev) src.torpEdge = true;
    src.padTorpPrev = padTorp;

    state.fire = src.kbFire || src.mouseFire || padFire || (isTouch && state.autofire);
    state.boost = src.kbBoost || padBoost;
    state.torpedoEdge = src.torpEdge;
  }

  function resetEdges() { src.torpEdge = false; state.torpedoEdge = false; state.pausePressed = false; }
  function clearAll() {
    for (const k in keys) keys[k] = false;
    src.kbFire = src.mouseFire = src.kbBoost = false;
    state.steerX = state.steerY = state.roll = 0; state.throttleAxis = 0;
    state.fire = state.boost = false; mouse = null;
  }
  // debug/test hook: drive the whole control path without real events
  function setMock(m) { mouse = m ? { nx: m.nx || 0, ny: m.ny || 0 } : null;
    if (m && m.fire !== undefined) src.kbFire = !!m.fire;
    if (m && m.boost !== undefined) src.kbBoost = !!m.boost;
    if (m && m.torp) src.torpEdge = true; }

  return { state, update, resetEdges, clearAll, touchBtn, setMock, setOptions,
    setBinds, getBinds, resetBinds, assignBinding, captureNext, cancelCapture,
    get capturing() { return !!capture; } };
}
