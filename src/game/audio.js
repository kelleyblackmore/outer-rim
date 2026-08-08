// audio.js — synthesized sound effects + engine drone (Web Audio, no assets).
export function createAudio() {
  let actx = null, master = null, muted = false;
  let engineOsc = null, engineSub = null, engineGain = null, engineFilter = null;

  function ensure() {
    if (actx) return;
    try {
      actx = new (window.AudioContext || window.webkitAudioContext)();
      master = actx.createGain(); master.gain.value = 0.5; master.connect(actx.destination);
    } catch (e) { actx = null; }
  }
  const now = () => actx.currentTime;

  function tone(type, f0, f1, dur, vol, dest) {
    if (!actx || muted) return;
    const o = actx.createOscillator(), g = actx.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, now());
    if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), now() + dur);
    g.gain.setValueAtTime(vol, now());
    g.gain.exponentialRampToValueAtTime(0.0001, now() + dur);
    o.connect(g); g.connect(dest || master);
    o.start(); o.stop(now() + dur);
  }
  function noise(dur, vol, filtType, filtFreq) {
    if (!actx || muted) return;
    const n = Math.floor(actx.sampleRate * dur);
    const buf = actx.createBuffer(1, n, actx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const s = actx.createBufferSource(); s.buffer = buf;
    const f = actx.createBiquadFilter(); f.type = filtType || 'lowpass'; f.frequency.value = filtFreq || 1200;
    const g = actx.createGain(); g.gain.value = vol; g.gain.exponentialRampToValueAtTime(0.0001, now() + dur);
    s.connect(f); f.connect(g); g.connect(master); s.start();
  }

  const api = {
    init() { ensure(); if (actx && actx.state === 'suspended') actx.resume(); },
    get muted() { return muted; },
    setMuted(m) { muted = m; if (engineGain) engineGain.gain.setTargetAtTime(m ? 0 : 0.05, now(), 0.05); },

    laser() { tone('square', 1100, 260, 0.14, 0.14); tone('sawtooth', 2200, 700, 0.08, 0.05); },
    enemyLaser() { tone('sawtooth', 520, 120, 0.18, 0.07); },
    hit() { noise(0.12, 0.18, 'highpass', 1400); tone('square', 400, 180, 0.08, 0.06); },
    explosion(big) { noise(big ? 0.6 : 0.4, big ? 0.5 : 0.32, 'lowpass', big ? 700 : 900); tone('sawtooth', big ? 160 : 220, 40, big ? 0.6 : 0.4, 0.18); },
    damage() { noise(0.3, 0.3, 'lowpass', 500); tone('square', 130, 46, 0.28, 0.2); },
    scrape() { noise(0.25, 0.22, 'bandpass', 900); },
    torpedo() { tone('sine', 340, 70, 0.5, 0.22); noise(0.18, 0.1, 'lowpass', 500); },
    lockTick() { tone('sine', 1400, 1400, 0.05, 0.06); },
    locked() { tone('square', 880, 1320, 0.14, 0.12); },
    ring() { tone('sine', 780, 1180, 0.16, 0.16); tone('sine', 1560, 1560, 0.1, 0.06); },
    objective() { [660, 880].forEach((f, i) => setTimeout(() => tone('square', f, f, 0.16, 0.12), i * 110)); },
    win() { [523, 659, 784, 1046, 1318].forEach((f, i) => setTimeout(() => tone('square', f, f, 0.3, 0.16), i * 130)); },
    warn() { tone('square', 620, 620, 0.09, 0.1); },

    startEngine() {
      if (!actx || engineOsc) return;
      engineOsc = actx.createOscillator(); engineOsc.type = 'sawtooth'; engineOsc.frequency.value = 70;
      engineSub = actx.createOscillator(); engineSub.type = 'sine'; engineSub.frequency.value = 40;
      engineFilter = actx.createBiquadFilter(); engineFilter.type = 'lowpass'; engineFilter.frequency.value = 220;
      engineGain = actx.createGain(); engineGain.gain.value = muted ? 0 : 0.05;
      engineOsc.connect(engineFilter); engineSub.connect(engineFilter);
      engineFilter.connect(engineGain); engineGain.connect(master);
      engineOsc.start(); engineSub.start();
    },
    setThrottle(t) { // 0..1 (boost pushes toward 1)
      if (!engineOsc) return;
      engineOsc.frequency.setTargetAtTime(64 + t * 78, now(), 0.08);
      engineFilter.frequency.setTargetAtTime(200 + t * 520, now(), 0.08);
    },
    stopEngine() {
      if (!engineOsc) return;
      try { engineOsc.stop(); engineSub.stop(); } catch (e) {}
      engineOsc = engineSub = engineGain = engineFilter = null;
    }
  };
  return api;
}
