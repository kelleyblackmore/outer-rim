// input.js — unified free-flight controls: keyboard, mouse-steer, touch stick, gamepad.
// steerX turns (yaw+bank), steerY pitches; both are RATE demands in -1..1.
export function createInput(canvas) {
  const isTouch = matchMedia('(pointer:coarse)').matches;
  const state = {
    steerX: 0, steerY: 0,      // -1..1 rate demand (steerY + = climb)
    roll: 0,                   // -1..1 manual roll (+ = roll right)
    throttleAxis: 0,           // -1 | 0 | +1 held
    fire: false, boost: false,
    torpedoEdge: false,
    pausePressed: false,
    isTouch, autofire: isTouch
  };
  const src = { kbFire: false, mouseFire: false, kbBoost: false, torpEdge: false, padTorpPrev: false };
  const keys = {};
  let mouse = null;            // {nx,ny} in -1..1, or null until first move

  const DEAD = 0.07;
  const expo = v => {
    const s = Math.sign(v), a = Math.abs(v);
    if (a < DEAD) return 0;
    const t = (a - DEAD) / (1 - DEAD);
    return s * (0.45 * t + 0.55 * t * t * t);   // gentle center, strong edges
  };

  // ---------- keyboard ----------
  addEventListener('keydown', e => {
    const k = e.key.toLowerCase();
    if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) e.preventDefault();
    if (e.repeat) return;
    keys[k] = true;
    if (k === ' ' || k === 'l') src.kbFire = true;
    if (k === 'f') src.torpEdge = true;
    if (k === 'shift') src.kbBoost = true;
    if (k === 'p' || k === 'escape') state.pausePressed = true;
  });
  addEventListener('keyup', e => {
    const k = e.key.toLowerCase();
    keys[k] = false;
    if (k === ' ' || k === 'l') src.kbFire = false;
    if (k === 'shift') src.kbBoost = false;
  });

  // ---------- mouse (desktop steer + fire) ----------
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
  function update() {
    // keyboard axes
    let kx = 0, ky = 0, kr = 0, kt = 0;
    if (keys['arrowleft']) kx -= 1;
    if (keys['arrowright']) kx += 1;
    if (keys['arrowup']) ky += 1;
    if (keys['arrowdown']) ky -= 1;
    if (keys['a'] || keys['q']) kr -= 1;   // Q/E spin the ship, same as A/D
    if (keys['d'] || keys['e']) kr += 1;
    if (keys['w'] || keys['__thrUp']) kt += 1;
    if (keys['s'] || keys['__thrDn']) kt -= 1;

    // gamepad
    let gx = 0, gy = 0, gr = 0, padAxis = false, padFire = false, padBoost = false, padTorp = false, gt = 0;
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) {
      if (!p) continue;
      const dz = 0.18;
      gx = Math.abs(p.axes[0]) > dz ? p.axes[0] : 0;
      gy = Math.abs(p.axes[1]) > dz ? -p.axes[1] : 0;             // stick up = climb
      gr = p.axes.length > 2 && Math.abs(p.axes[2]) > dz ? p.axes[2] : 0;
      padAxis = !!(gx || gy);
      padFire = !!((p.buttons[0] && p.buttons[0].pressed) || (p.buttons[7] && p.buttons[7].pressed));
      padBoost = !!((p.buttons[6] && p.buttons[6].pressed) || (p.buttons[1] && p.buttons[1].pressed));
      padTorp = !!((p.buttons[2] && p.buttons[2].pressed) || (p.buttons[3] && p.buttons[3].pressed));
      if (p.buttons[12] && p.buttons[12].pressed) gt += 1;        // dpad up/down = throttle
      if (p.buttons[13] && p.buttons[13].pressed) gt -= 1;
      break;
    }

    // priority: keys > touch stick > pad > mouse
    if (kx || ky) { state.steerX = kx; state.steerY = ky; }
    else if (stickActive) { state.steerX = stickX; state.steerY = stickY; }
    else if (padAxis) { state.steerX = gx; state.steerY = gy; }
    else if (!isTouch && mouse) { state.steerX = expo(mouse.nx); state.steerY = expo(-mouse.ny); }
    else { state.steerX = 0; state.steerY = 0; }

    state.roll = kr || gr || 0;
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

  return { state, update, resetEdges, clearAll, touchBtn, setMock };
}
