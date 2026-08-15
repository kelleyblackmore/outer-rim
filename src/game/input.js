// input.js — unified free-flight controls: keyboard, mouse-steer, touch stick,
// gamepad, flight stick. steerX turns (yaw+bank), steerY pitches; both are RATE
// demands in -1..1. Buttons/keys are fully rebindable (see binds + captureNext).
export const BINDABLE_ACTIONS = ['fire', 'torpedo', 'boost', 'thrUp', 'thrDn', 'rollLeft', 'rollRight'];

const DEFAULT_BINDS = {
  keys: { fire: [' ', 'l'], torpedo: ['f'], boost: ['shift'], thrUp: ['w'], thrDn: ['s'],
    rollLeft: ['a', 'q'], rollRight: ['d', 'e'] },
  pad:  { fire: [0, 7], torpedo: [2, 3], boost: [6, 1], thrUp: [12], thrDn: [13], rollLeft: [4], rollRight: [5] },
  joy:  { fire: [0], torpedo: [1], boost: [2, 3], thrUp: [], thrDn: [], rollLeft: [], rollRight: [] },
  // {padId, axis, sf} — which device axis is the throttle lever and which way
  // is forward. null = the classic HOTAS slider default (primary stick axis 3).
  throttleAxis: null,
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
    if ('throttleAxis' in b) binds.throttleAxis = b.throttleAxis ? { ...b.throttleAxis } : null;
  }
  function getBinds() { return clone(binds); }
  function resetBinds() { binds = clone(DEFAULT_BINDS); }
  function assignThrottleAxis(t) {
    binds.throttleAxis = t ? { padId: t.padId || '', axis: t.axis ?? t.id, sf: t.sf || -1 } : null;
  }
  // rebind: the control replaces the action's list and leaves every other action
  function assignBinding(action, target) {
    const map = binds[target.dev];
    if (!map || !BINDABLE_ACTIONS.includes(action)) return getBinds();
    for (const a of BINDABLE_ACTIONS) map[a] = map[a].filter(id => id !== target.id);
    map[action] = [target.id];
    return getBinds();
  }

  // ---------- live capture (mapping mode) ----------
  // cb({dev:'keys'|'pad'|'joy', id, label} | {dev:'axis', axis, sf, padId, label} | {cancel:true})
  let capture = null;
  let axisBase = null, axisCand = null;
  function captureNext(cb, o) {
    capture = { cb, wantAxes: !!(o && o.axes) };
    axisBase = null; axisCand = null;
  }
  function cancelCapture() { capture = null; axisBase = null; axisCand = null; }
  const keyLabel = k => k === ' ' ? 'SPACE' : k.toUpperCase();

  // axis capture: baseline every device's axes, then wait for one axis to hold
  // a big deviation — that axis is the throttle, its push direction = forward
  function scanAxisCapture(connected, primary) {
    if (!axisBase) {
      axisBase = {};
      for (const p of connected) axisBase[p.index] = p.axes.slice();
      return;
    }
    for (const p of connected) {
      const base = axisBase[p.index] || (axisBase[p.index] = p.axes.slice());
      for (let i = 0; i < p.axes.length; i++) {
        if (p === primary && i < 3) continue;          // stick X/Y/twist keep steering
        if (!Number.isFinite(p.axes[i])) continue;
        const d = p.axes[i] - base[i];
        if (Math.abs(d) > 0.45) {
          if (axisCand && axisCand.pad === p.index && axisCand.axis === i) {
            if (++axisCand.n >= 10) {                  // ~1/6s of sustained push
              const cb = capture.cb;
              capture = null; axisBase = null; axisCand = null;
              cb({ dev: 'axis', axis: i, id: i, sf: Math.sign(d), padId: p.id,
                label: `AXIS ${i}${p.id ? ' · ' + p.id.slice(0, 18) : ''}` });
            }
          } else axisCand = { pad: p.index, axis: i, n: 1 };
          return;
        }
      }
    }
  }

  // ---------- keyboard ----------
  addEventListener('keydown', e => {
    const k = e.key.toLowerCase();
    if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) e.preventDefault();
    if (e.repeat) return;
    if (capture) {
      e.preventDefault();
      const cb = capture.cb; capture = null; axisBase = null; axisCand = null;
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
  const prevButtonsByPad = {};
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

    // gamepads: the FIRST flight stick (non-standard mapping) steers; buttons
    // and the throttle axis are read across EVERY connected device, so a
    // separate throttle quadrant works. Standard pads use thumbstick
    // conventions; joysticks are X = turn, Y = pull-back-to-climb, twist = roll.
    let gx = 0, gy = 0, gr = 0, padAxis = false, padFire = false, padBoost = false, padTorp = false, gt = 0;
    let throttleSet = null, isJoystick = false;
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const connected = [];
    for (const p of pads) if (p && p.connected) connected.push(p);
    let primary = connected.find(p => p.mapping !== 'standard') || connected[0] || null;

    // capture: first rising-edge button on ANY device; axes when requested
    if (capture) {
      outer: for (const p of connected) {
        const prev = prevButtonsByPad[p.index] || [];
        for (let i = 0; i < p.buttons.length; i++) {
          if (p.buttons[i] && p.buttons[i].pressed && !prev[i]) {
            const cb = capture.cb; capture = null; axisBase = null; axisCand = null;
            cb({ dev: p.mapping === 'standard' ? 'pad' : 'joy', id: i, label: 'BTN ' + i, padId: p.id });
            break outer;
          }
        }
      }
      if (capture && capture.wantAxes) scanAxisCapture(connected, primary);
    }
    const capturing = !!capture;

    for (const p of connected) {
      const bmap = p.mapping === 'standard' ? binds.pad : binds.joy;
      if (!capturing) {
        if (anyBtn(p, bmap.fire)) padFire = true;
        if (anyBtn(p, bmap.boost)) padBoost = true;
        if (anyBtn(p, bmap.torpedo)) padTorp = true;
        if (anyBtn(p, bmap.thrUp)) gt += 1;
        if (anyBtn(p, bmap.thrDn)) gt -= 1;
        if (anyBtn(p, bmap.rollLeft)) gr -= 1;
        if (anyBtn(p, bmap.rollRight)) gr += 1;
      }
      prevButtonsByPad[p.index] = p.buttons.map(b => !!(b && b.pressed));
    }

    if (primary) {
      isJoystick = primary.mapping !== 'standard';
      if (isJoystick) {
        gx = axis(primary.axes[0], opts.deadzone);
        gy = axis(primary.axes[1], opts.deadzone);                // pull back (+) = climb
        gr += primary.axes.length > 2 ? axis(primary.axes[2], opts.deadzone + 0.08) : 0;
      } else {
        gx = axis(primary.axes[0], opts.deadzone);
        gy = -axis(primary.axes[1], opts.deadzone);               // stick up = climb
        gr += primary.axes.length > 2 ? axis(primary.axes[2], opts.deadzone) : 0;
      }
    }

    // throttle lever: an explicit mapped axis wins; otherwise the classic
    // HOTAS slider default (primary stick axis 3, forward = -1)
    if (binds.throttleAxis) {
      const b = binds.throttleAxis;
      const tp = connected.find(p => p.id === b.padId) || primary;
      if (tp && tp.axes.length > b.axis && Number.isFinite(tp.axes[b.axis])) {
        let v = (1 + b.sf * tp.axes[b.axis]) / 2;
        if (v < 0.03) v = 0; else if (v > 0.97) v = 1;
        throttleSet = Math.min(1, Math.max(0, v));
      }
    } else if (primary && isJoystick && primary.axes.length > 3 && Number.isFinite(primary.axes[3])) {
      throttleSet = (1 - primary.axes[3]) / 2;
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
    setBinds, getBinds, resetBinds, assignBinding, assignThrottleAxis, captureNext, cancelCapture,
    get capturing() { return !!capture; } };
}
