// audio.js — synthesized sound design (Web Audio, no assets).
// Everything runs through a master compressor so layered effects glue together.
export function createAudio() {
  let actx = null, master = null, comp = null, muted = false;
  let engA = null, engB = null, engSub = null, engineGain = null, engineFilter = null;

  function ensure() {
    if (actx) return;
    try {
      actx = new (window.AudioContext || window.webkitAudioContext)();
      comp = actx.createDynamicsCompressor();
      comp.threshold.value = -18;
      comp.knee.value = 22;
      comp.ratio.value = 5;
      comp.attack.value = 0.004;
      comp.release.value = 0.18;
      master = actx.createGain();
      master.gain.value = 0.5;
      master.connect(comp);
      comp.connect(actx.destination);
    } catch (e) { actx = null; }
  }
  const now = () => actx.currentTime;

  function tone(type, f0, f1, dur, vol, opts = {}) {
    if (!actx || muted) return;
    const o = actx.createOscillator(), g = actx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, now() + (opts.delay || 0));
    if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), now() + (opts.delay || 0) + dur);
    g.gain.setValueAtTime(0.0001, now() + (opts.delay || 0));
    g.gain.exponentialRampToValueAtTime(vol, now() + (opts.delay || 0) + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, now() + (opts.delay || 0) + dur);
    o.connect(g); g.connect(master);
    o.start(now() + (opts.delay || 0));
    o.stop(now() + (opts.delay || 0) + dur + 0.02);
  }
  function noise(dur, vol, filtType, f0, f1, delay = 0) {
    if (!actx || muted) return;
    const n = Math.floor(actx.sampleRate * dur);
    const buf = actx.createBuffer(1, n, actx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const s = actx.createBufferSource(); s.buffer = buf;
    const f = actx.createBiquadFilter();
    f.type = filtType || 'lowpass';
    f.frequency.setValueAtTime(f0 || 1200, now() + delay);
    if (f1) f.frequency.exponentialRampToValueAtTime(f1, now() + delay + dur);
    const g = actx.createGain();
    g.gain.setValueAtTime(vol, now() + delay);
    g.gain.exponentialRampToValueAtTime(0.0001, now() + delay + dur);
    s.connect(f); f.connect(g); g.connect(master);
    s.start(now() + delay);
  }

  const api = {
    init() { ensure(); if (actx && actx.state === 'suspended') actx.resume(); },
    get muted() { return muted; },
    setMuted(m) { muted = m; if (engineGain) engineGain.gain.setTargetAtTime(m ? 0 : 0.05, now(), 0.05); },

    // ---- weapons ----
    laser() {
      tone('square', 1500, 260, 0.13, 0.12);
      tone('sawtooth', 1530, 290, 0.11, 0.06);     // detuned layer = fat pew
      noise(0.04, 0.08, 'highpass', 2600);
    },
    enemyLaser() { tone('sawtooth', 560, 110, 0.17, 0.07); tone('square', 545, 120, 0.15, 0.03); },
    torpedo() { tone('sine', 360, 60, 0.55, 0.22); noise(0.4, 0.14, 'bandpass', 400, 900); },
    hit() { noise(0.1, 0.16, 'highpass', 1600); tone('square', 420, 200, 0.07, 0.06); },

    // ---- destruction ----
    explosion(big) {
      noise(big ? 0.7 : 0.45, big ? 0.5 : 0.32, 'lowpass', big ? 1400 : 1100, big ? 120 : 200);
      tone('sine', big ? 95 : 120, 28, big ? 0.7 : 0.45, big ? 0.4 : 0.26);   // sub thump
      tone('sawtooth', big ? 150 : 210, 40, big ? 0.5 : 0.35, 0.12);
      if (big) noise(0.5, 0.16, 'bandpass', 700, 250, 0.12);                   // crackle tail
    },
    damage() { noise(0.28, 0.3, 'lowpass', 520); tone('square', 130, 44, 0.26, 0.2); tone('sine', 70, 35, 0.3, 0.2); },
    scrape() { noise(0.25, 0.22, 'bandpass', 900, 500); },

    // ---- flight ----
    boost() { noise(0.4, 0.2, 'bandpass', 320, 2200); tone('sine', 160, 520, 0.35, 0.1); },
    land() { tone('sine', 90, 40, 0.3, 0.24); noise(0.35, 0.12, 'lowpass', 700, 250); },

    // ---- targeting / mission ----
    lockTick() { tone('sine', 1400, 1400, 0.05, 0.06); },
    locked() { tone('square', 880, 1320, 0.14, 0.12); },
    ring() { tone('sine', 780, 1180, 0.16, 0.16); tone('sine', 1560, 1560, 0.1, 0.06); },
    objective() { tone('square', 660, 660, 0.14, 0.11); tone('square', 880, 880, 0.14, 0.11, { delay: 0.11 }); },
    warn() { tone('square', 620, 620, 0.09, 0.1); },
    win() { [523, 659, 784, 1046, 1318].forEach((f, i) => tone('square', f, f, 0.3, 0.15, { delay: i * 0.13 })); },

    // ---- UI / progression ----
    ui() { tone('sine', 940, 940, 0.045, 0.06); },
    buy() { tone('square', 660, 660, 0.09, 0.12); tone('square', 990, 990, 0.14, 0.12, { delay: 0.09 }); },
    deny() { tone('square', 150, 140, 0.2, 0.14); },
    promote() {
      [392, 523, 659, 784].forEach((f, i) => tone('square', f, f, 0.26, 0.14, { delay: i * 0.11 }));
      tone('sine', 1568, 1568, 0.5, 0.07, { delay: 0.44 });
      noise(0.5, 0.05, 'highpass', 5000, 8000, 0.44);   // shimmer
    },

    // ---- engine drone: detuned saw pair + sub through a swept lowpass ----
    startEngine() {
      if (!actx || engA) return;
      engA = actx.createOscillator(); engA.type = 'sawtooth'; engA.frequency.value = 66;
      engB = actx.createOscillator(); engB.type = 'sawtooth'; engB.frequency.value = 66.55;
      engSub = actx.createOscillator(); engSub.type = 'sine'; engSub.frequency.value = 33;
      engineFilter = actx.createBiquadFilter(); engineFilter.type = 'lowpass'; engineFilter.frequency.value = 230;
      engineGain = actx.createGain(); engineGain.gain.value = muted ? 0 : 0.05;
      engA.connect(engineFilter); engB.connect(engineFilter); engSub.connect(engineFilter);
      engineFilter.connect(engineGain); engineGain.connect(master);
      engA.start(); engB.start(); engSub.start();
    },
    setThrottle(t) { // 0..1 (boost pushes toward 1)
      if (!engA) return;
      engA.frequency.setTargetAtTime(60 + t * 84, now(), 0.09);
      engB.frequency.setTargetAtTime((60 + t * 84) * 1.008, now(), 0.09);
      engSub.frequency.setTargetAtTime(30 + t * 34, now(), 0.09);
      engineFilter.frequency.setTargetAtTime(210 + t * 640, now(), 0.09);
    },
    stopEngine() {
      if (!engA) return;
      try { engA.stop(); engB.stop(); engSub.stop(); } catch (e) {}
      engA = engB = engSub = engineGain = engineFilter = null;
    }
  };
  return api;
}
