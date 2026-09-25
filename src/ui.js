// DOM layer: HUD, callouts, speech bubble, hints, splats, and the share card.
const $ = (s) => document.querySelector(s);

const els = {
  hud: $('#hud'),
  pFill: $('.you .hp .fill'), pTrail: $('.you .hp .trail'), pHp: $('.you .hp'),
  oFill: $('.opp .hp .fill'), oTrail: $('.opp .hp .trail'), oHp: $('.opp .hp'),
  pkd: $('#pkd'), okd: $('#okd'),
  time: $('#hudTime'), score: $('#hudScore'), floor: $('#hudFloor'),
  oppName: $('#oppName'), oppTitle: $('#oppTitle'),
  meter: $('#meter'), meterFill: $('#meter .track i'), meterKey: $('#meterKey'),
  combo: $('#combo'), invoice: $('#invoice'), invAmt: $('#invAmt'),
  callouts: $('#callouts'), popups: $('#popups'),
  bubble: $('#bubble'), bubbleText: $('#bubble span'),
  banner: $('#banner'), count: $('#count'), mash: $('#mash'), hint: $('#hint'), splat: $('#splat'),
};

export const fmtTime = (t) => {
  const m = Math.floor(t / 60), s = Math.floor(t % 60), c = Math.floor((t * 100) % 100);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(c).padStart(2, '0')}`;
};

let last = { php: 1, ohp: 1, combo: 0, pkd: -1, okd: -1, meterFull: false, time: '', score: -1, meter: -1 };
let bubbleT = 0;
let projector = null;

export const ui = {
  setProjector(fn) { projector = fn; },
  listener: null,     // (kind, text, opt) — lets the clip recorder mirror callouts and speech

  setupFight(data, touch) {
    els.oppName.textContent = data.name;
    els.oppTitle.textContent = data.title;
    els.floor.textContent = `FLOOR ${data.floor}`;
    els.invoice.classList.toggle('hidden', !data.bills);
    els.invAmt.textContent = '$0';
    els.meterKey.textContent = touch ? 'SWIPE ↑' : 'SPACE';
    last = { php: 1, ohp: 1, combo: 0, pkd: -1, okd: -1, meterFull: false, time: '', score: -1, meter: -1 };
    els.pTrail.style.transform = els.pFill.style.transform = 'scaleX(1)';
    els.oTrail.style.transform = els.oFill.style.transform = 'scaleX(1)';
    this.clearTransient();
  },

  showHud(on) { els.hud.classList.toggle('hidden', !on); },

  hud(h) {
    if (h.php !== last.php) {
      els.pFill.style.transform = `scaleX(${Math.max(0, h.php)})`;
      els.pTrail.style.transform = `scaleX(${Math.max(0, h.php)})`;
      if (h.php < last.php) { els.pHp.classList.remove('shake'); void els.pHp.offsetWidth; els.pHp.classList.add('shake'); }
      els.pHp.classList.toggle('low', h.php < 0.3);
    }
    if (h.ohp !== last.ohp) {
      els.oFill.style.transform = `scaleX(${Math.max(0, h.ohp)})`;
      els.oTrail.style.transform = `scaleX(${Math.max(0, h.ohp)})`;
      if (h.ohp < last.ohp) { els.oHp.classList.remove('shake'); void els.oHp.offsetWidth; els.oHp.classList.add('shake'); }
    }
    // only touch the DOM on change: each write re-runs style and layout for the frame
    const time = fmtTime(h.time);
    if (time !== last.time) els.time.textContent = time;
    if (h.score !== last.score) els.score.textContent = h.score.toLocaleString('en-US');
    if (h.meter !== last.meter) els.meterFill.style.transform = `scaleX(${h.meter})`;
    const full = h.meter >= 1;
    if (full !== last.meterFull) els.meter.classList.toggle('full', full);
    if (h.combo !== last.combo) {
      if (h.combo >= 2) {
        els.combo.innerHTML = `${h.combo}<small>HIT COMBO</small>`;
        els.combo.classList.add('on');
        els.combo.classList.remove('bump'); void els.combo.offsetWidth; els.combo.classList.add('bump');
      } else els.combo.classList.remove('on');
    }
    if (h.pkd !== last.pkd) els.pkd.innerHTML = Array.from({ length: 3 }, (_, i) => `<i class="${i < h.pkd ? 'on' : ''}"></i>`).join('');
    if (h.okd !== last.okd) els.okd.innerHTML = Array.from({ length: h.maxOkd }, (_, i) => `<i class="${i < h.okd ? 'on' : ''}"></i>`).join('');
    last = { php: h.php, ohp: h.ohp, combo: h.combo, pkd: h.pkd, okd: h.okd, meterFull: full, time, score: h.score, meter: h.meter };
  },

  callout(text, { size = 'l', color = '#ff2e88', dur = 0.8 } = {}) {
    this.listener?.('callout', text, { color, dur });
    const d = document.createElement('div');
    d.className = `callout ${size}`;
    d.textContent = text;
    d.style.setProperty('--dur', dur + 's');
    const depth = size === 'm' ? 3 : size === 'l' ? 5 : 8;
    d.style.textShadow = `${depth}px ${depth}px 0 ${color}, ${depth * 2}px ${depth * 2}px 0 #000`;
    if (size === 'm') { d.style.color = color; d.style.textShadow = `3px 3px 0 #000`; }
    els.callouts.appendChild(d);
    // one big callout at a time reads better than a pile
    if (size !== 'm') for (const c of [...els.callouts.children]) if (c !== d && !c.classList.contains('m')) c.remove();
    setTimeout(() => d.remove(), dur * 1000 + 50);
  },

  popup(text) {
    const d = document.createElement('div');
    d.className = 'popup';
    d.textContent = text;
    d.style.left = `${56 + Math.random() * 14}%`;
    d.style.top = `${48 + Math.random() * 14}%`;
    els.popups.appendChild(d);
    setTimeout(() => d.remove(), 950);
  },

  say(text, dur = 1.8) {
    this.listener?.('say', text, dur);
    els.bubbleText.textContent = text;
    els.bubble.classList.remove('hidden');
    // restart the pop-in animation
    els.bubbleText.style.animation = 'none'; void els.bubbleText.offsetWidth; els.bubbleText.style.animation = '';
    bubbleT = dur;
  },

  banner(name, who, lead = `${who} USES`) {
    els.banner.querySelector('small').textContent = lead;
    els.banner.querySelector('b').textContent = name;
    els.banner.classList.remove('hidden');
    els.banner.style.animation = 'none'; void els.banner.offsetWidth; els.banner.style.animation = '';
    clearTimeout(this._bt);
    this._bt = setTimeout(() => els.banner.classList.add('hidden'), 1300);
  },

  count(n) {
    if (n == null) { els.count.classList.add('hidden'); return; }
    els.count.textContent = n;
    els.count.classList.remove('hidden', 'tick'); void els.count.offsetWidth; els.count.classList.add('tick');
  },

  mash(progress, label) {
    if (progress == null) { els.mash.classList.add('hidden'); return; }
    els.mash.classList.remove('hidden');
    if (label) els.mash.querySelector('b').textContent = label;
    els.mash.querySelector('.track i').style.transform = `scaleX(${progress})`;
  },

  hint(text) {
    if (!text) { els.hint.classList.add('hidden'); return; }
    els.hint.textContent = text;
    els.hint.classList.remove('hidden');
    els.hint.style.animation = 'none'; void els.hint.offsetWidth; els.hint.style.animation = '';
  },

  splat(kind) {
    const d = document.createElement('div');
    d.className = 'splat';
    if (kind === 'coffee') {
      d.style.inset = '0';
      d.innerHTML = coffeeSVG();
    } else {
      const words = { paper: 'WRITTEN UP', card: 'NETWORKED', dentures: 'CHOMP', cash: 'BRIBED' };
      d.innerHTML = `<div class="stamp-splat">${words[kind] || 'OOF'}</div>`;
      d.style.left = `${30 + Math.random() * 20}%`;
      d.style.top = `${30 + Math.random() * 20}%`;
    }
    els.splat.appendChild(d);
    setTimeout(() => d.remove(), 1850);
  },

  bill(total) {
    els.invAmt.textContent = '$' + total.toLocaleString('en-US');
    els.invoice.classList.remove('bump'); void els.invoice.offsetWidth; els.invoice.classList.add('bump');
    this.popup('+$900 BILLED');
  },

  clearTransient() {
    els.callouts.innerHTML = ''; els.popups.innerHTML = ''; els.splat.innerHTML = '';
    els.bubble.classList.add('hidden'); els.banner.classList.add('hidden');
    els.count.classList.add('hidden'); els.mash.classList.add('hidden'); els.hint.classList.add('hidden');
    els.combo.classList.remove('on');
    bubbleT = 0;
  },

  update(dt) {
    if (bubbleT > 0) {
      bubbleT -= dt;
      if (bubbleT <= 0) els.bubble.classList.add('hidden');
      else if (projector) {
        const p = projector();
        if (p) {
          // `translate` moves the bubble on the compositor; left/top would lay out the page again
          els.bubble.style.translate = `${Math.min(window.innerWidth - 220, Math.max(10, p.x + 40))}px ${Math.max(90, p.y - 40)}px`;
        }
      }
    }
  },
};

function coffeeSVG() {
  // brown splash blobs with drips
  let blobs = '';
  // one main splash off to a side, so the fight stays readable
  const cx = Math.random() < 0.5 ? 25 : 75, cy = 25 + Math.random() * 20;
  blobs += `<circle cx="${cx}" cy="${cy}" r="9"/>`;
  for (let i = 0; i < 6; i++) {
    const x = cx + (Math.random() - 0.5) * 30, y = cy + (Math.random() - 0.5) * 24, r = 2 + Math.random() * 5;
    blobs += `<circle cx="${x}" cy="${y}" r="${r}"/>`;
    blobs += `<rect x="${x - r * 0.25}" y="${y}" width="${r * 0.5}" height="${10 + Math.random() * 30}" rx="${r * 0.25}"/>`;
  }
  for (let i = 0; i < 24; i++) blobs += `<circle cx="${cx + (Math.random() - 0.5) * 60}" cy="${cy + (Math.random() - 0.5) * 50}" r="${0.5 + Math.random() * 1.6}"/>`;
  return `<svg viewBox="0 0 100 100" preserveAspectRatio="none" style="width:100%;height:100%;opacity:.7"><g fill="#4a2a14">${blobs}</g><g fill="#7a4a24" opacity=".6" transform="translate(1,-1)">${blobs}</g></svg>`;
}

// ---------- share card ----------
export function makeCard({ snapshot, opp, time, grade, score, stats, win, theme, total, quote, shift }) {
  const W = 1200, H = 675;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  return new Promise((resolve) => {
    const draw = (img) => {
      g.fillStyle = '#07050a'; g.fillRect(0, 0, W, H);
      if (img) {
        const s = Math.max(W / img.width, H / img.height);
        const w = img.width * s, h = img.height * s;
        g.drawImage(img, (W - w) / 2 + 120, (H - h) / 2, w, h);
      }
      const grd = g.createLinearGradient(0, 0, W, 0);
      grd.addColorStop(0, 'rgba(7,5,10,.96)'); grd.addColorStop(0.5, 'rgba(7,5,10,.72)'); grd.addColorStop(1, 'rgba(7,5,10,0)');
      g.fillStyle = grd; g.fillRect(0, 0, W, H);
      // diagonal accent
      g.save(); g.translate(0, H); g.rotate(-0.12);
      g.fillStyle = theme.b; g.fillRect(-40, -150, W * 1.2, 16);
      g.fillStyle = theme.a; g.fillRect(-40, -126, W * 1.2, 6);
      g.restore();
      const disp = '"Anton", Impact, sans-serif';
      g.textBaseline = 'alphabetic';
      g.fillStyle = theme.a; g.font = `44px ${disp}`;
      g.fillText('PUNCH CLOCK', 56, 84);
      g.fillStyle = 'rgba(255,255,255,.6)'; g.font = '700 16px "JetBrains Mono", monospace';
      g.fillText('A CORPORATE BOXING SIMULATOR', 58, 112);

      if (shift) { drawShift(g, shift, disp, theme); resolve(c.toDataURL('image/png')); return; }
      g.save(); g.transform(1, 0, -0.16, 1, 0, 0);
      g.font = `${total ? 64 : 58}px ${disp}`; g.fillStyle = '#fff';
      const headline = total ? 'I BECAME CEO' : win ? 'I KNOCKED OUT' : 'I GOT FIRED BY';
      g.fillText(headline, 110, 210);
      g.font = `${opp.name.length > 12 ? 70 : 110}px ${disp}`;
      g.fillStyle = theme.b; g.fillText(opp.name, 106, 318 + 6);
      g.fillStyle = '#fff'; g.fillText(opp.name, 100, 318);
      g.font = `30px ${disp}`; g.fillStyle = '#ffd23f';
      g.fillText(opp.title, 104, 362);
      g.restore();
      if (quote) {
        g.font = '700 34px "Caveat", cursive'; g.fillStyle = '#fff';
        g.fillText(`“${quote}”`, 60, 412);
      }

      g.font = '800 64px "JetBrains Mono", monospace';
      g.fillStyle = '#ff5a3d'; g.shadowColor = '#ff5a3d'; g.shadowBlur = 20;
      g.fillText(fmtTime(time), 58, 470);
      g.shadowBlur = 0;
      g.font = '700 20px "JetBrains Mono", monospace'; g.fillStyle = 'rgba(255,255,255,.85)';
      g.fillText(`SCORE ${score.toLocaleString('en-US')}   PERFECTS ${stats.perfects}   TEETH ${stats.teeth}`, 60, 510);

      // grade stamp, or the termination stamp
      if (!win && !total) grade = { letter: '✗', label: 'TERMINATED', color: '#ff2e55' };
      if (grade) {
        g.save(); g.translate(W - 190, H - 200); g.rotate(-0.28);
        g.strokeStyle = grade.color; g.lineWidth = 10; g.beginPath(); g.arc(0, 0, 120, 0, 7); g.stroke();
        g.lineWidth = 3; g.beginPath(); g.arc(0, 0, 104, 0, 7); g.stroke();
        g.fillStyle = grade.color; g.textAlign = 'center';
        g.font = `150px ${disp}`; g.fillText(grade.letter, 0, 48);
        g.font = `16px ${disp}`; g.fillText(grade.label, 0, 84);
        g.restore();
        g.textAlign = 'left';
      }
      g.font = '700 18px "JetBrains Mono", monospace'; g.fillStyle = 'rgba(255,255,255,.55)';
      g.fillText('#PUNCHCLOCK', 58, H - 36);
      resolve(c.toDataURL('image/png'));
    };
    if (snapshot) { const img = new Image(); img.onload = () => draw(img); img.onerror = () => draw(null); img.src = snapshot; } else draw(null);
  });
}

// Daily Shift card: the run's squares are the headline, drawn as tiles so they read at thumbnail size
const TILE = { '🟩': '#3dff7a', '🟨': '#ffd23f', '💀': '#ff2e55', '⬛': 'rgba(255,255,255,.14)' };
function drawShift(g, run, disp, theme) {
  const H = 675;
  const won = !run.marks.includes('💀');
  g.save(); g.transform(1, 0, -0.16, 1, 0, 0);
  g.font = `58px ${disp}`; g.fillStyle = '#fff';
  g.fillText(`DAILY SHIFT #${run.n}`, 110, 190);
  g.font = `104px ${disp}`;
  const big = won ? 'MADE CEO' : 'FIRED';
  g.fillStyle = theme.b; g.fillText(big, 106, 292 + 6);
  g.fillStyle = '#fff'; g.fillText(big, 100, 292);
  g.restore();
  const marks = [...run.squares.matchAll(/🟩|🟨|💀|⬛/gu)].map((m) => m[0]);
  marks.forEach((m, i) => {
    const x = 60 + i * 86, y = 322;
    g.fillStyle = TILE[m] || '#444'; g.fillRect(x, y, 72, 72);
    if (m === '💀') { g.fillStyle = '#000'; g.font = `54px ${disp}`; g.textAlign = 'center'; g.fillText('✗', x + 36, y + 56); g.textAlign = 'left'; }
  });
  g.font = '800 64px "JetBrains Mono", monospace';
  g.fillStyle = '#ff5a3d'; g.shadowColor = '#ff5a3d'; g.shadowBlur = 20;
  g.fillText(fmtTime(run.time), 58, 462);
  g.shadowBlur = 0;
  g.font = '700 20px "JetBrains Mono", monospace'; g.fillStyle = 'rgba(255,255,255,.85)';
  const perk = run.perkName ? `🧷 ${run.perkName}` : '✅ NO PERKS';
  g.fillText(`${run.mod.name}   ${perk}`, 60, 502);
  g.font = '700 18px "JetBrains Mono", monospace'; g.fillStyle = 'rgba(255,255,255,.55)';
  g.fillText('#PUNCHCLOCK', 58, H - 36);
}
