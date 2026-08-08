// hud.js — 2D targeting-computer overlay (canvas) + HTML gauge updates.
export function createHud(canvas) {
  const ctx = canvas.getContext('2d');
  let W = 1, H = 1, DPR = 1;

  const el = {
    hull: document.getElementById('hull-fill'),
    shield: document.getElementById('shield-fill'),
    throttle: document.getElementById('throttle-fill'),
    energy: document.getElementById('energy-fill'),
    score: document.getElementById('score'),
    time: document.getElementById('time'),
    torps: document.getElementById('torps'),
    lock: document.getElementById('lock-status'),
    banner: document.getElementById('banner'),
    objective: document.getElementById('objective'),
    warning: document.getElementById('warning'),
  };

  function resize(fw, fh) {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = fw || window.innerWidth; H = fh || window.innerHeight;
    if (!W || !H) return;
    canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }
  window.addEventListener('resize', () => resize());
  resize();

  function bracket(x, y, s, color, lw) {
    const h = s / 2, c = s * 0.32;
    ctx.strokeStyle = color; ctx.lineWidth = lw;
    for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      ctx.beginPath();
      ctx.moveTo(x + sx * h, y + sy * h - sy * c);
      ctx.lineTo(x + sx * h, y + sy * h);
      ctx.lineTo(x + sx * h - sx * c, y + sy * h);
      ctx.stroke();
    }
  }

  const KIND_COLOR = { tie: 'rgba(120,200,255,0.55)', probe: 'rgba(255,170,80,0.6)', turret: 'rgba(255,120,80,0.6)',
    generator: 'rgba(140,150,255,0.65)', port: 'rgba(255,211,77,0.85)', oscillator: 'rgba(255,90,50,0.8)' };

  function render(s) {
    ctx.clearRect(0, 0, W, H);
    if (!s) return;

    // target boxes
    for (const t of s.targets) {
      if (t.locked) {
        bracket(t.x, t.y, t.size, t.lockT >= 1 ? 'rgba(255,60,48,0.95)' : 'rgba(255,180,60,0.9)', 2.2);
        // lock progress ring
        ctx.strokeStyle = t.lockT >= 1 ? 'rgba(255,60,48,0.8)' : 'rgba(255,200,90,0.7)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(t.x, t.y, t.size * 0.66, -Math.PI / 2, -Math.PI / 2 + t.lockT * Math.PI * 2);
        ctx.stroke();
      } else {
        bracket(t.x, t.y, t.size, KIND_COLOR[t.kind] || 'rgba(120,200,255,0.5)', 1.4);
      }
    }

    // lead pip
    if (s.lead) {
      ctx.strokeStyle = 'rgba(255,220,80,0.95)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(s.lead.x, s.lead.y, 7, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(s.lead.x - 12, s.lead.y); ctx.lineTo(s.lead.x - 4, s.lead.y);
      ctx.moveTo(s.lead.x + 4, s.lead.y); ctx.lineTo(s.lead.x + 12, s.lead.y); ctx.stroke();
    }

    // next-ring diamond marker
    if (s.ringMarker) {
      const r = s.ringMarker, sz = Math.min(r.size, 150) / 2;
      ctx.strokeStyle = 'rgba(255,211,77,0.9)'; ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(r.x, r.y - sz); ctx.lineTo(r.x + sz, r.y); ctx.lineTo(r.x, r.y + sz); ctx.lineTo(r.x - sz, r.y);
      ctx.closePath(); ctx.stroke();
      ctx.fillStyle = 'rgba(255,211,77,0.85)';
      ctx.font = '11px Consolas,monospace'; ctx.textAlign = 'center';
      ctx.fillText(`${r.dist}m`, r.x, r.y + sz + 14);
    }

    // central reticle
    if (s.reticle) {
      const r = s.reticle;
      const col = s.lock && s.lock.locked ? '#ff5a3c' : '#ffe81f';
      ctx.strokeStyle = col; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(r.x, r.y, 13, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(r.x - 24, r.y); ctx.lineTo(r.x - 9, r.y);
      ctx.moveTo(r.x + 9, r.y); ctx.lineTo(r.x + 24, r.y);
      ctx.moveTo(r.x, r.y - 24); ctx.lineTo(r.x, r.y - 9);
      ctx.moveTo(r.x, r.y + 9); ctx.lineTo(r.x, r.y + 24);
      ctx.stroke();
      ctx.fillStyle = col; ctx.fillRect(r.x - 1.5, r.y - 1.5, 3, 3);
    }

    // off-screen objective arrow: slides along an ellipse around screen centre
    if (s.arrow) {
      const cx = W / 2, cy = H / 2;
      const rx = W * 0.38, ry = H * 0.36;
      const ax = cx + Math.cos(s.arrow.angle) * rx;
      const ay = cy - Math.sin(s.arrow.angle) * ry;
      const a = Math.atan2(-(Math.sin(s.arrow.angle) * ry), Math.cos(s.arrow.angle) * rx); // ellipse-corrected
      ctx.save();
      ctx.translate(ax, ay); ctx.rotate(a);
      ctx.fillStyle = 'rgba(255,211,77,0.9)';
      ctx.beginPath();
      ctx.moveTo(14, 0); ctx.lineTo(-8, -8); ctx.lineTo(-4, 0); ctx.lineTo(-8, 8);
      ctx.closePath(); ctx.fill();
      ctx.rotate(-a);
      ctx.fillStyle = 'rgba(255,211,77,0.75)';
      ctx.font = '10px Consolas,monospace'; ctx.textAlign = 'center';
      ctx.fillText(`${s.arrow.dist}m`, 0, 22);
      ctx.restore();
    }

    // radar (bottom centre): ship-forward is up
    {
      const R = Math.min(64, H * 0.11);
      const cx = W / 2, cy = H - R - Math.max(14, H * 0.02);
      ctx.save();
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = 'rgba(6,10,18,0.55)';
      ctx.strokeStyle = 'rgba(120,180,240,0.35)';
      ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.arc(cx, cy, R * 0.5, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx, cy - R); ctx.lineTo(cx, cy + R); ctx.moveTo(cx - R, cy); ctx.lineTo(cx + R, cy); ctx.stroke();
      // own ship
      ctx.fillStyle = '#ffe81f';
      ctx.beginPath(); ctx.moveTo(cx, cy - 5); ctx.lineTo(cx + 4, cy + 4); ctx.lineTo(cx - 4, cy + 4); ctx.closePath(); ctx.fill();
      for (const b of s.blips) {
        const bx = cx + b.x * R, by = cy - b.y * R;
        if (b.kind === 'ring' || b.kind === 'ringHot') {
          ctx.fillStyle = b.kind === 'ringHot' ? 'rgba(255,211,77,0.95)' : 'rgba(90,140,220,0.8)';
          ctx.fillRect(bx - 2, by - 2, 4, 4);
        } else {
          ctx.fillStyle = b.kind === 'generator' ? 'rgba(140,150,255,0.95)' : 'rgba(255,80,60,0.95)';
          ctx.beginPath(); ctx.arc(bx, by, 2.4, 0, Math.PI * 2); ctx.fill();
        }
      }
      ctx.restore();
    }

    // damage vignette
    if (s.hurt > 0) {
      const a = Math.min(0.5, s.hurt);
      const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.7);
      g.addColorStop(0, 'rgba(255,0,0,0)');
      g.addColorStop(1, `rgba(255,20,20,${a})`);
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    }

    // boost speed streaks
    if (s.boosting) {
      ctx.strokeStyle = 'rgba(160,210,255,0.35)'; ctx.lineWidth = 2;
      const cx = W / 2, cy = H * 0.5;
      for (let i = 0; i < 14; i++) {
        const ang = i * 0.7;
        const r0 = Math.min(W, H) * 0.35, r1 = r0 + 60;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(ang) * r0, cy + Math.sin(ang) * r0);
        ctx.lineTo(cx + Math.cos(ang) * r1, cy + Math.sin(ang) * r1);
        ctx.stroke();
      }
    }
  }

  let bannerT = 0;
  function banner(text, warn) {
    el.banner.textContent = text;
    el.banner.classList.toggle('warn', !!warn);
    el.banner.classList.add('show');
    bannerT = 2.4;
  }
  function setObjective(text) { el.objective.textContent = text; }

  const fmtTime = t => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

  function updateFrame(run, flightState, snapshot, dt) {
    el.hull.style.transform = `scaleX(${Math.max(0, run.hull) / 100})`;
    el.shield.style.transform = `scaleX(${Math.max(0, run.shields) / 100})`;
    el.score.textContent = run.score;
    el.time.textContent = fmtTime(run.time);
    el.torps.textContent = run.torps;
    el.throttle.style.transform = `scaleX(${Math.max(0.05, flightState.throttle)})`;
    el.energy.style.transform = `scaleX(${Math.max(0, flightState.energy) / 100})`;

    // lock readout
    if (run.lockTarget) {
      el.lock.classList.remove('hidden');
      el.lock.textContent = run.locked ? 'TORPEDO LOCK — FIRE' : 'ACQUIRING LOCK…';
      el.lock.classList.toggle('locked', run.locked);
    } else el.lock.classList.add('hidden');

    // terrain / boundary warnings
    const w = flightState.warning;
    if (w) {
      el.warning.classList.remove('hidden');
      el.warning.textContent = w === 'bounds' ? 'RETURN TO PATROL ZONE'
        : (snapshot && snapshot.storm) ? 'STORM DECK — CLIMB' : 'TERRAIN — PULL UP';
    } else el.warning.classList.add('hidden');

    if (bannerT > 0) { bannerT -= dt; if (bannerT <= 0) el.banner.classList.remove('show'); }
  }

  return { render, updateFrame, banner, setObjective, resize, fmtTime };
}
