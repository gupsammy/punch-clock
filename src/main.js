import * as THREE from 'three';
import { ROSTER, GRADES, REVIEW_NOTES, FIRED_LINES, START_TITLE } from './config.js';
import { createFeed } from './feed.js';
import { createClip } from './clip.js';
import { createArena } from './arena.js';
import { Fighter } from './fighter.js';
import { Player, CAM_BASE, LOOK_AT } from './player.js';
import { FX } from './fx.js';
import { createPost } from './post.js';
import { createInput } from './input.js';
import { Fight } from './fight.js';
import { ui, makeCard, fmtTime } from './ui.js';
import { audio } from './audio.js';
import { setRim } from './materials.js';
import { clamp, pick } from './spring.js';
import { PERKS, shiftNumber, modifierFor, perkUnlocked, newRun, recordFight, squares, perkOf, cleared, shareLine } from './shift.js';

const $ = (s) => document.querySelector(s);

// ---------- renderer / scene ----------
const canvas = $('#stage');
let renderer;
try {
  // antialiasing happens in the post-processing target; the canvas only receives the final pass
  renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
} catch (e) {
  $('#fallback').classList.remove('hidden');
  throw e;
}
const isCoarse = matchMedia('(pointer: coarse)').matches;
document.body.classList.toggle('touch', isCoarse);
let PR = Math.min(window.devicePixelRatio || 1, isCoarse ? 1.5 : 1.75);
renderer.setPixelRatio(PR);
// Neutral keeps each floor's hues; ACES pulled neon toward orange (DESIGN.md "Light")
renderer.toneMapping = THREE.NeutralToneMapping;
const EXPOSURE = 1.05;
renderer.toneMappingExposure = EXPOSURE;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(58, 1, 0.03, 200);
const arena = createArena(scene);
const player = new Player(camera);
scene.add(player.rig);
const fx = new FX(scene);
fx.cam = camera;
const post = createPost(renderer, scene, camera, isCoarse ? 2 : 4);
const input = createInput($('#touchpad'));

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setPixelRatio(PR);
  renderer.setSize(w, h, false);
  canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
  camera.aspect = w / h;
  // keep the opponent framed in portrait by widening the vertical FOV
  const hfov = 76 * Math.PI / 180;
  player.baseFov = camera.aspect >= 1.25 ? 58 : clamp(2 * Math.atan(Math.tan(hfov / 2) / camera.aspect) * 180 / Math.PI, 58, 100);
  camera.fov = player.baseFov;
  camera.updateProjectionMatrix();
  post.setSize(w, h, PR);
}
window.addEventListener('resize', resize);
resize();

// Slow device: drop resolution a step at a time rather than the frame rate. Only fights count,
// because menus idle and a hidden tab reports huge gaps.
const perf = { t: 0, n: 0 };
function watchFrames(realDt) {
  if (screen !== 'fight' || paused || PR <= 1) return;
  perf.t += realDt; perf.n++;
  if (perf.t < 2) return;
  if (perf.n / perf.t < 45) { PR = Math.max(1, PR - 0.25); resize(); }
  perf.t = 0; perf.n = 0;
}

// ---------- save ----------
const SAVE_KEY = 'pc_save_v1';
let save = { unlocked: 0, best: {} };
try { const s = JSON.parse(localStorage.getItem(SAVE_KEY)); if (s && typeof s.unlocked === 'number') save = { best: {}, ...s }; } catch { /* private mode */ }
const persist = () => { try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch { /* ignore */ } };

// ---------- time control ----------
const time = {
  scale: 1, stop: 0, slow: 1, slowT: 0,
  hitstop(d) { this.stop = Math.max(this.stop, d); },
  slowmo(s, d) { this.slow = Math.min(this.slowT > 0 ? this.slow : 1, s); this.slowT = Math.max(this.slowT, d); },
  reset() { this.scale = 1; this.stop = 0; this.slow = 1; this.slowT = 0; },
};

// ---------- state ----------
let screen = 'title';
let fighter = null;
let fight = null;
let current = 0;          // roster index being fought / previewed
let paused = false;
let captureReq = false;
let lastResult = null;
let introT = 0;
let run = null;           // Daily Shift in progress, or null on the ladder
let perkPick = null;

function setFighter(i) {
  if (fighter && fighter.data === ROSTER[i]) return;
  if (fighter) { scene.remove(fighter.root); fighter.dispose(); }
  fighter = new Fighter(ROSTER[i]);
  fighter.keepOut = camera;
  scene.add(fighter.root);
}

function applyTheme(data) {
  const t = data.theme;
  arena.setTheme(t);
  renderer.toneMappingExposure = EXPOSURE * (t.light?.exposure ?? 1);
  setRim(t.a, t.b);
  document.documentElement.style.setProperty('--a', t.a);
  document.documentElement.style.setProperty('--b', t.b);
}

const feed = createFeed();
const clip = createClip({ audio, maxSide: isCoarse ? 720 : 1280 });
ui.listener = clip.listen;
// you take the job of whoever you beat on the floor below
const careerTitle = (i) => (i ? ROSTER[i - 1].promo.title : START_TITLE);
const ctx = {
  get fighter() { return fighter; },
  player, fx, audio, ui, arena, post, time, feed, clip,
  capture: () => { captureReq = true; return null; },
  isTouch: () => isCoarse,
  buzz: (p) => { if (isCoarse && navigator.vibrate) try { navigator.vibrate(p); } catch { /* blocked */ } },
  inputHeld: (a) => input.held(a),
  onEnd: (r) => endFight(r),
};

ui.setProjector(() => {
  if (!fighter) return null;
  const v = fighter.headWorld(new THREE.Vector3()).add(new THREE.Vector3(0, 0.12, 0)).project(camera);
  if (v.z > 1) return null;
  return { x: (v.x * 0.5 + 0.5) * window.innerWidth, y: (-v.y * 0.5 + 0.5) * window.innerHeight };
});

function show(id) {
  for (const s of document.querySelectorAll('.screen')) s.classList.toggle('hidden', s.id !== id);
  const btn = document.querySelector(`#${id} .btn.big`);
  if (btn && !isCoarse) setTimeout(() => btn.focus({ preventScroll: true }), 50);
}
function overlay(id, on) { $('#' + id).classList.toggle('hidden', !on); }

// ---------- title ----------
function toTitle() {
  clip.stop();
  screen = 'title';
  fight = null;
  run = null;
  document.body.classList.remove('in-run');
  paused = false; overlay('pause', false);
  $('#shiftBtn').textContent = `DAILY SHIFT #${shiftNumber()}`;
  ui.showHud(false);
  ui.clearTransient();
  current = Math.min(save.unlocked, ROSTER.length - 1);
  setFighter(current);
  applyTheme(ROSTER[current]);
  fighter.reset();
  fighter.setPose(tauntPoseOf(ROSTER[current]), 80, 10);
  fighter.setExpr('taunt');
  player.reset();
  player.setMenu(new THREE.Vector3(2.4, 2.1, 2.6), new THREE.Vector3(0, 1.3, -0.6), true);
  show('title');
  audio.playMusic('title');
  audio.setCrowd(0.3);
}
function tauntPoseOf(d) { return { phone: 'phone', sip: 'sip', flex: 'flex', invoice: 'invoice', nap: 'nap', cash: 'cash' }[d.taunt] || 'flex'; }

// ---------- elevator ----------
function toElevator(sel = Math.min(save.unlocked, ROSTER.length - 1)) {
  clip.stop();
  screen = 'elevator';
  fight = null;
  run = null;
  document.body.classList.remove('in-run');
  paused = false; overlay('pause', false);
  ui.showHud(false);
  ui.clearTransient();
  time.reset();
  post.fx.dark = 0; post.fx.sat = 1; post.fx.lowHp = 0;
  arena.blackout(false);
  fx.clear();
  player.reset();
  show('elevator');
  buildFloorButtons();
  selectFloor(sel);
  audio.playMusic('elevator');
  audio.setCrowd(0.15);
}

function buildFloorButtons() {
  const wrap = $('#floorBtns');
  wrap.innerHTML = '';
  // top floor first, like a real panel
  [...ROSTER].map((d, i) => ({ d, i })).reverse().forEach(({ d, i }) => {
    const b = document.createElement('button');
    b.className = 'fbtn';
    b.textContent = d.floor;
    b.dataset.i = i;
    const best = save.best[d.id];
    if (i > save.unlocked) b.classList.add('locked');
    if (best) { b.classList.add('done'); b.dataset.grade = best.grade; }
    b.addEventListener('click', () => { audio.init(); if (i <= save.unlocked) { if (current === i) startIntro(i); else selectFloor(i); } else { audio.uiBack(); b.animate([{ transform: 'translateX(-4px)' }, { transform: 'translateX(4px)' }, { transform: 'none' }], { duration: 160 }); } });
    wrap.appendChild(b);
  });
}

function selectFloor(i) {
  current = i;
  const d = ROSTER[i];
  for (const b of document.querySelectorAll('.fbtn')) b.classList.toggle('sel', +b.dataset.i === i);
  $('#elevFloor').textContent = d.floor;
  $('#dFloor').textContent = `FLOOR ${d.floor} — ${d.theme.floorName}`;
  $('#dName').textContent = d.name;
  $('#dTitle').textContent = d.title;
  $('#dTag').textContent = d.tagline;
  $('#dStats').innerHTML = d.stats.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
  $('#dMemo').textContent = d.memo;
  const best = save.best[d.id];
  $('#dBest').textContent = best ? `BEST: ${fmtTime(best.time)} · GRADE ${best.grade} · ${best.score.toLocaleString('en-US')} PTS` : '';
  setFighter(i);
  applyTheme(d);
  fighter.reset();
  fighter.setPose(tauntPoseOf(d), 80, 10);
  fighter.setExpr('taunt');
  fighter.showProp({ phone: 'phone', sip: 'mug', invoice: 'paper', cash: 'cash' }[d.taunt] || null);
  // wide: the boss stands to the right of the dossier; narrow: the dossier sits on top, so frame the boss low
  const wide = window.innerWidth > 760 && window.innerWidth > window.innerHeight;
  if (wide) player.setMenu(new THREE.Vector3(-1.05, 1.55, 0.95), new THREE.Vector3(-0.55, 1.35, -0.6));
  else {
    // tilt up until the boss's head clears the bottom of the dossier
    const f = clamp($('.dossier').getBoundingClientRect().bottom / window.innerHeight, 0.4, 0.85);
    player.setMenu(new THREE.Vector3(0, 1.3, 2.0), new THREE.Vector3(0, 4.4 + (f - 0.73) * 8, -0.6));
  }
  audio.uiMove();
}

// ---------- intro + fight ----------
function startIntro(i) {
  audio.uiSelect();
  audio.punchClock();
  current = i;
  const d = ROSTER[i];
  setFighter(i);
  applyTheme(d);
  fighter.reset();
  fx.clear();
  time.reset();
  post.fx.dark = 0; post.fx.sat = 1; post.fx.lowHp = 0;
  arena.blackout(false);
  player.reset();
  ui.clearTransient();
  ui.showHud(false);
  feed.stop();
  ui.setupFight(d, isCoarse);
  $('#youTitle').textContent = careerTitle(i);
  fight = new Fight(d, i, ctx, run ? { mod: run.mod, perk: run.perk, startHp: run.hp, run } : {});
  fight.intro();
  screen = 'intro';
  introT = 0;
  document.body.classList.toggle('in-run', !!run);
  if (run) $('#hudFloor').textContent = `SHIFT #${run.n} · ${d.floor} · ${'🤒'.repeat(run.sick)}`;
  $('#iFloor').textContent = run ? `SHIFT #${run.n} · FLOOR ${d.floor} · ${run.mod.name}` : `FLOOR ${d.floor} · ${d.theme.floorName}`;
  $('#iName').textContent = d.name;
  $('#iTitle').textContent = d.title;
  $('#iTag').textContent = d.tagline;
  $('#iStats').innerHTML = d.stats.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
  $('#iName').style.fontSize = d.name.length > 12 ? 'clamp(44px, 8vw, 110px)' : '';
  show('intro');
  player.setMenu(new THREE.Vector3(0.75, 1.45, 0.55), new THREE.Vector3(0, 1.5, -0.6), true);
  setTimeout(() => player.menu && player.setMenu(new THREE.Vector3(0.35, 1.55, 0.95), new THREE.Vector3(0, 1.5, -0.6)), 30);
  audio.stopMusic(0.4);
  audio.setCrowd(0.5);
  audio.cheer(0.5);
  audio.say(`${d.name}. ${d.title}.`, { rate: 0.95, pitch: 0.6 });
  setTimeout(() => { if (screen === 'intro' && fight) ui.say(pick(d.lines.intro), 2.4); }, 700);
}

function beginFight() {
  if (screen !== 'intro') return;
  screen = 'fight';
  show(null);
  ui.showHud(true);
  player.setMenu(null);
  player.reset();
  const d = ROSTER[current];
  audio.playMusic('fight', { bpm: d.music.bpm, root: d.music.root, mood: d.music.mood, intensity: 0.3 });
  feed.start(d, current);
  fight.start();
  clip.start(fight, canvas);
}

function retry() {
  // a shift only replays a floor by spending a sick day, which endFight has already done
  if (run && !(screen === 'fired' && !run.done)) return;
  if (screen === 'fight' || screen === 'results' || screen === 'fired' || paused) {
    paused = false; overlay('pause', false);
    startIntro(current);
    // Hotline Miami rule: a retry skips straight back into the fight
    introT = 99;
    beginFight();
  }
}

function endFight(r) {
  clip.stop();
  r.clip = clip.latest;
  lastResult = r;
  feed.stop();
  ui.showHud(false);
  ui.clearTransient();
  fx.dizzy(false);
  const d = ROSTER[current];
  const outcome = run && recordFight(run, r);
  if (!r.win) {
    lastResult = { ...r, d };
    screen = 'fired';
    $('#firedLine').textContent = pick(FIRED_LINES);
    $('#firedBy').textContent = `TERMINATED BY ${d.name}, ${d.title} · ${fmtTime(r.time)}`;
    $('#firedSick').textContent = !run ? '' : outcome === 'retry'
      ? `SICK DAY USED · ${run.sick} LEFT ${'🤒'.repeat(run.sick)}` : 'NO SICK DAYS LEFT. THE SHIFT IS OVER.';
    $('#reapplyBtn').innerHTML = !run ? 'REAPPLY<span class="key"> (R)</span>' : outcome === 'retry' ? 'CALL IN SICK, TRY AGAIN' : 'SHIFT REPORT ▶';
    show('fired');
    audio.playMusic('fired');
    audio.stinger('fired');
    fighter.setPose('victory', 80, 10);
    return;
  }
  showResults(r, d);
}

function computeGrade(r, idx) {
  const s = r.stats;
  const par = 38 + idx * 14;
  const acc = s.thrown ? s.landed / s.thrown : 0;
  const rating = 0.35 * clamp(par / Math.max(1, r.time), 0, 1)
    + 0.35 * (1 - clamp(s.dmgTaken / 120, 0, 1))
    + 0.15 * clamp(s.perfects / 5, 0, 1)
    + 0.15 * clamp(acc / 0.7, 0, 1)
    - 0.12 * r.pkd;
  return GRADES.find((g) => rating >= g.min);
}

function showResults(r, d) {
  screen = 'results';
  const s = r.stats;
  const par = 38 + current * 14;
  const timeBonus = Math.max(0, Math.round((par * 2 - r.time) * 40));
  const flawless = s.dmgTaken === 0 ? 5000 : 0;
  const total = s.score + timeBonus + flawless;
  const grade = computeGrade(r, current);
  const prev = save.best[d.id];
  const pb = !run && (!prev || r.time < prev.time);
  if (!run) {
    save.best[d.id] = {
      time: pb ? r.time : prev.time,
      score: Math.max(total, prev?.score || 0),
      grade: prev && 'SABCD'.indexOf(prev.grade) < 'SABCD'.indexOf(grade.letter) ? prev.grade : grade.letter,
    };
    save.unlocked = Math.max(save.unlocked, Math.min(current + 1, ROSTER.length - 1));
    if (current === ROSTER.length - 1) save.cleared = true;
    persist();
  }
  lastResult = { ...r, grade, total, d };

  const acc = s.thrown ? Math.round((s.landed / s.thrown) * 100) : 0;
  const rows = [
    ['TIME TO K.O.', fmtTime(r.time)],
    ['PUNCHES LANDED', `${s.landed} / ${s.thrown} (${acc}%)`],
    ['PERFECT DODGES', s.perfects],
    ['COUNTERS', s.counters],
    ['DAMAGE TAKEN', `${Math.round(s.dmgTaken)} HP`],
    ['KNOCKDOWNS SUFFERED', r.pkd],
    ['TEETH REMOVED', s.teeth],
  ];
  if (s.disrespect) rows.push(['ACTS OF DISRESPECT', s.disrespect]);
  if (d.bills) rows.push(['CONSULTING FEES', '$' + s.billed.toLocaleString('en-US')]);
  if (timeBonus) rows.push(['PUNCTUALITY BONUS', '+' + timeBonus.toLocaleString('en-US')]);
  if (flawless) rows.push(['FLAWLESS BONUS', '+5,000']);
  if (run) rows.push(['SHIFT CLOCK', fmtTime(run.time)], ['NEXT FLOOR STARTS AT', cleared(run) ? '—' : `${Math.round(run.hp)} HP`]);
  $('#rOpp').textContent = `${d.name}, ${d.title}`;
  $('#rEmp').textContent = `YOU, ${careerTitle(current)}`;
  $('#rPromo').classList.add('hidden');
  $('#rPromo b').textContent = d.promo.title;
  $('#rPromo em').textContent = 'Perk: ' + d.promo.perk;
  $('#rQuarter').textContent = `FLOOR ${d.floor} · CONFIDENTIAL`;
  const table = $('#rRows');
  table.innerHTML = '';
  $('#rNote').textContent = '';
  $('#rStamp').classList.add('hidden');
  $('#rPB').classList.add('hidden');
  const isLast = current === ROSTER.length - 1;
  $('#nextBtn').textContent = run && isLast ? 'SHIFT REPORT ▶' : isLast ? 'CLAIM THE CORNER OFFICE ▶' : 'NEXT FLOOR ▶';
  show('results');
  audio.playMusic('results');
  let i = 0;
  const addRow = () => {
    if (screen !== 'results') return;
    if (i < rows.length) {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${rows[i][0]}</td><td>${rows[i][1]}</td>`;
      table.appendChild(tr);
      audio.typeTick();
      i++;
      setTimeout(addRow, 110);
      return;
    }
    const tr = document.createElement('tr');
    tr.className = 'total';
    tr.innerHTML = `<td>TOTAL SCORE</td><td>${total.toLocaleString('en-US')}</td>`;
    table.appendChild(tr);
    $('#rNote').textContent = pick(REVIEW_NOTES[grade.letter]);
    setTimeout(() => {
      if (screen !== 'results') return;
      const st = $('#rStamp');
      st.style.setProperty('--c', grade.color);
      st.querySelector('b').textContent = grade.letter;
      st.querySelector('span').textContent = grade.label;
      st.classList.remove('hidden');
      audio.stamp();
      audio.stinger('grade');
      if (pb && prev) $('#rPB').classList.remove('hidden');
    }, 350);
    setTimeout(() => { if (screen === 'results') { $('#rPromo').classList.remove('hidden'); audio.stinger('levelup'); } }, 1300);
  };
  setTimeout(addRow, 450);
}

function next() {
  if (run) { if (run.done) toShiftEnd(); else startIntro(run.floor); return; }
  if (current === ROSTER.length - 1) { toEnding(); return; }
  toElevator(Math.min(current + 1, ROSTER.length - 1));
}

function toEnding() {
  screen = 'ending';
  const total = ROSTER.reduce((acc, d) => acc + (save.best[d.id]?.time || 0), 0);
  $('#endTotal').textContent = `CAREER TIME (BEST SPLITS): ${fmtTime(total)}`;
  show('ending');
  audio.stinger('levelup');
  fx.confettiBurst(new THREE.Vector3(0, 4, -1), 300, ['#ffc233', '#ff2244', '#ffffff']);
  lastResult = { ...lastResult, careerTotal: total };
}

// ---------- daily shift ----------
const SHIFT_RULES = [
  'Six floors, back to back. One clock. It never stops.',
  'Three sick days. Getting fired spends one and you retry the floor.',
  'You carry your HP up. Each promotion restores 40.',
  'Everyone gets the same policy today. Compare notes.',
];

function toShift() {
  clip.stop();
  screen = 'shift';
  fight = null; run = null;
  document.body.classList.remove('in-run');
  paused = false; overlay('pause', false);
  time.reset(); fx.clear(); arena.blackout(false);
  post.fx.dark = 0; post.fx.sat = 1; post.fx.lowHp = 0;
  ui.showHud(false); ui.clearTransient();
  const n = shiftNumber(), mod = modifierFor(n);
  $('#sNum').textContent = `DAILY SHIFT #${n}`;
  $('#sDate').textContent = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }).toUpperCase();
  $('#sMod b').textContent = mod.name;
  $('#sMod em').textContent = mod.desc;
  $('#sRules').innerHTML = SHIFT_RULES.map((t) => `<li>${t}</li>`).join('');
  const best = save.shift?.n === n ? save.shift : null;
  $('#sBest').textContent = best ? `TODAY'S BEST: ${best.squares} ${best.cleared ? 'CEO' : 'FIRED'} · ${fmtTime(best.time)}` : 'NO SHIFT LOGGED TODAY';
  const wrap = $('#sPerks');
  wrap.innerHTML = '';
  const none = document.createElement('button');
  none.className = 'perk'; none.dataset.act = 'perk'; none.dataset.id = '';
  none.innerHTML = '<b>NO PERK</b><em>Nothing to hide. Your share line gets a ✅.</em>';
  wrap.appendChild(none);
  for (const p of PERKS) {
    const b = document.createElement('button');
    const open = perkUnlocked(p, save);
    b.className = 'perk' + (open ? '' : ' locked');
    b.dataset.act = 'perk'; b.dataset.id = p.id;
    b.disabled = !open;
    b.innerHTML = `<b>${p.name}</b><em>${open ? p.desc : `LOCKED · GET AN A ON FLOOR ${ROSTER[p.floor].floor}`}</em>`;
    wrap.appendChild(b);
  }
  if (perkPick && !PERKS.some((p) => p.id === perkPick && perkUnlocked(p, save))) perkPick = null;
  pickPerk(perkPick, true);
  const d = ROSTER[0];
  setFighter(0); applyTheme(d); fighter.reset();
  fighter.setPose(tauntPoseOf(d), 80, 10); fighter.setExpr('taunt');
  player.reset();
  player.setMenu(new THREE.Vector3(1.2, 1.7, 1.6), new THREE.Vector3(0.4, 1.3, -0.6), true);
  show('shift');
  audio.playMusic('elevator');
}

function pickPerk(id, quiet) {
  perkPick = id || null;
  for (const b of document.querySelectorAll('#sPerks .perk')) b.classList.toggle('sel', (b.dataset.id || null) === perkPick);
  if (!quiet) audio.uiMove();
}

function startShift() {
  run = newRun(shiftNumber(), perkPick);
  startIntro(0);
}

function toShiftEnd() {
  screen = 'shiftEnd';
  ui.showHud(false); ui.clearTransient();
  document.body.classList.remove('in-run');
  const win = cleared(run);
  const perk = perkOf(run);
  const sq = squares(run);
  const prev = save.shift?.n === run.n ? save.shift : null;
  const better = !prev || (win && !prev.cleared) || (win === prev.cleared && (run.floor > prev.floor || (run.floor === prev.floor && run.time < prev.time)));
  if (better) { save.shift = { n: run.n, cleared: win, floor: run.floor, time: run.time, squares: sq }; persist(); }
  $('#eNum').textContent = `SHIFT REPORT #${run.n}`;
  $('#eSquares').textContent = sq;
  $('#eHead').textContent = win ? 'CEO BY CLOSE OF BUSINESS' : `FIRED ON FLOOR ${ROSTER[run.floor].floor}`;
  $('#eRows').innerHTML = [
    ['SHIFT CLOCK', fmtTime(run.time)],
    ['FLOORS CLEARED', `${Math.min(run.floor, ROSTER.length)} / ${ROSTER.length}`],
    ['SICK DAYS LEFT', run.sick],
    ['COMPANY POLICY', run.mod.name],
    ['PERK', perk ? perk.name : 'NONE ✅'],
  ].map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('');
  $('#eBest').classList.toggle('new', !!(better && prev));
  $('#eBest').textContent = better && prev ? 'NEW BEST SHIFT TODAY' : prev ? `TODAY'S BEST: ${prev.squares} · ${fmtTime(prev.time)}` : '';
  $('#eLine').textContent = shareLine(run);
  const last = ROSTER[Math.min(run.floor, ROSTER.length - 1)];
  lastResult = { ...lastResult, d: lastResult?.d || last, shift: { ...run, squares: sq, perkName: perk?.name }, careerTotal: 0 };
  show('shiftEnd');
  audio.playMusic(win ? 'results' : 'fired');
  audio.stinger(win ? 'levelup' : 'grade');
  if (win) fx.confettiBurst(new THREE.Vector3(0, 4, -1), 200, ['#ffc233', '#ff2244', '#ffffff']);
}

async function copyShift(b) {
  try { await navigator.clipboard.writeText(`${shareLine(run)}\n#PUNCHCLOCK`); b.textContent = 'COPIED'; }
  catch { b.textContent = 'COPY FAILED'; }
  setTimeout(() => { b.textContent = 'COPY RESULT'; }, 1400);
}

// ---------- share ----------
async function openShare() {
  const r = lastResult;
  if (!r) return;
  const d = r.d || ROSTER[current];
  const url = await makeCard({
    snapshot: r.snapshot, opp: d, time: r.shift ? r.shift.time : r.careerTotal || r.time, grade: r.grade, score: r.total || r.stats.score,
    stats: r.stats, win: r.win !== false, theme: d.theme, total: !!r.careerTotal, quote: r.quote, shift: r.shift,
  });
  $('#shareImg').src = url;
  $('#shareImg').dataset.url = url;
  clipBlob = null;
  $('#shareTabs').classList.add('hidden');
  setShareTab('card');
  overlay('share', true);
  if (r.clip) {
    // a firing's clip can still be rolling when the card is ready
    const blob = await Promise.race([r.clip, new Promise((res) => setTimeout(() => res(null), 5000))]);
    if (blob && lastResult === r && !$('#share').classList.contains('hidden')) {
      clipBlob = blob;
      const v = $('#shareVid');
      if (v.src) URL.revokeObjectURL(v.src);
      v.src = URL.createObjectURL(blob);
      $('#shareTabs').classList.remove('hidden');
      setShareTab('clip');
    }
  }
  $('[data-act="post"]').textContent = canShare ? 'SHARE' : 'POST ON X';
}

let clipBlob = null, shareTab = 'card';
const canShare = isCoarse && !!navigator.canShare;
function setShareTab(tab) {
  shareTab = tab;
  for (const b of document.querySelectorAll('#shareTabs button')) b.classList.toggle('on', b.dataset.tab === tab);
  $('#shareVid').classList.toggle('hidden', tab !== 'clip');
  $('#shareImg').classList.toggle('hidden', tab !== 'card');
  const v = $('#shareVid');
  if (tab === 'clip') { v.currentTime = 0; v.play().catch(() => {}); } else v.pause();
  $('#saveBtn').textContent = tab === 'clip' ? 'SAVE CLIP' : 'SAVE IMAGE';
  $('#shareNote').textContent = canShare ? `Tap SHARE to send the ${tab} straight to X or anywhere else.` : `Save the ${tab}, then attach it to your post.`;
}
const clipName = () => `punch-clock.${clip.ext}`;

function shareText() {
  const r = lastResult;
  const d = r.d || ROSTER[current];
  if (r.shift) return `${shareLine(r.shift)}\n#PUNCHCLOCK`;
  if (r.careerTotal) return `I punched my way from the mailroom to CEO in ${fmtTime(r.careerTotal)}. My performance review is Monday. Kyle is conducting it. 🥊💼 #PUNCHCLOCK`;
  if (r.win === false) return `${d.name} (${d.title}) just fired me. "${r.quote}" 🥊 #PUNCHCLOCK`;
  return `I knocked out ${d.name}, ${d.title}, in ${fmtTime(r.time)} — grade ${r.grade.letter}: "${r.grade.label}" 🥊 #PUNCHCLOCK`;
}

async function postShare() {
  const text = shareText();
  const link = location.protocol.startsWith('http') && !/localhost|127\.0\.0\.1/.test(location.hostname) ? location.href.split('#')[0] : '';
  const dataUrl = $('#shareImg').dataset.url;
  if (canShare && dataUrl) {
    try {
      const isClip = shareTab === 'clip' && clipBlob;
      const blob = isClip ? clipBlob : await (await fetch(dataUrl)).blob();
      const file = isClip ? new File([blob], clipName(), { type: blob.type }) : new File([blob], 'punch-clock.png', { type: 'image/png' });
      if (navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], text: link ? `${text} ${link}` : text }); return; }
    } catch { /* fall through to the intent link */ }
  }
  const q = new URLSearchParams({ text });
  if (link) q.set('url', link);
  window.open(`https://x.com/intent/post?${q}`, '_blank', 'noopener');
}

function saveImage() {
  const a = document.createElement('a');
  const isClip = shareTab === 'clip' && clipBlob;
  a.href = isClip ? $('#shareVid').src : $('#shareImg').dataset.url;
  a.download = isClip ? clipName() : 'punch-clock.png';
  a.click();
}

// ---------- pause ----------
function setPause(on) {
  if (screen !== 'fight') return;
  paused = on;
  overlay('pause', on);
  $('#quitBtn').textContent = run ? 'CLOCK OUT (ENDS SHIFT)' : 'QUIT TO ELEVATOR';
  audio.setTimeScale(on ? 0.25 : 1);
  if (on) setTimeout(() => $('#pause .btn.big').focus(), 30);
}
document.addEventListener('visibilitychange', () => { if (document.hidden && screen === 'fight' && !paused) setPause(true); });

// ---------- buttons ----------
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  audio.init();
  const act = b.dataset.act;
  audio.uiSelect();
  switch (act) {
    case 'start': toElevator(); break;
    case 'shift': toShift(); break;
    case 'startShift': startShift(); break;
    case 'perk': pickPerk(b.dataset.id || null); break;
    case 'copyShift': copyShift(b); break;
    case 'quit': if (run) toTitle(); else toElevator(); break;
    case 'howto': overlay('howto', true); break;
    case 'closeHowto': overlay('howto', false); break;
    case 'mute': { const m = audio.toggleMute(); $('#muteBtn').textContent = `SOUND: ${m ? 'OFF' : 'ON'}`; break; }
    case 'fight': startIntro(current); break;
    case 'back': toTitle(); break;
    case 'next': next(); break;
    case 'retry': if (run?.done) toShiftEnd(); else retry(); break;
    case 'elevator': toElevator(); break;
    case 'share': openShare(); break;
    case 'post': postShare(); break;
    case 'save': saveImage(); break;
    case 'closeShare': overlay('share', false); $('#shareVid').pause(); break;
    case 'shareTab': setShareTab(b.dataset.tab); break;
    case 'resume': setPause(false); break;
    case 'pause': setPause(true); break;
  }
});
$('#title').addEventListener('click', (e) => { if (!e.target.closest('button')) { audio.init(); toElevator(); } });
$('#intro').addEventListener('click', () => { introT = 99; beginFight(); });
$('#muteBtn').textContent = `SOUND: ${audio.muted ? 'OFF' : 'ON'}`;

// ---------- input routing ----------
input.on((action, down) => {
  if (down) audio.init();
  if (!down) { if (screen === 'fight' && fight && !paused) fight.input(action, false); return; }
  if (action === 'mute') { const m = audio.toggleMute(); $('#muteBtn').textContent = `SOUND: ${m ? 'OFF' : 'ON'}`; return; }
  const howto = !$('#howto').classList.contains('hidden');
  const share = !$('#share').classList.contains('hidden');
  if (howto) { if (action === 'confirm' || action === 'pause' || action === 'jabL') overlay('howto', false); return; }
  if (share) { if (action === 'pause') overlay('share', false); return; }
  switch (screen) {
    case 'title':
      if (action === 'any' || action === 'confirm') toElevator();
      break;
    case 'elevator': {
      if (action === 'left' || action === 'duck') selectFloor(Math.max(0, current - 1));
      else if (action === 'right' || action === 'haymaker') selectFloor(Math.min(save.unlocked, current + 1));
      else if (action === 'confirm' || action === 'jabL' || action === 'jabR') startIntro(current);
      else if (action === 'pause') toTitle();
      break;
    }
    case 'shift': {
      const ids = [null, ...PERKS.filter((p) => perkUnlocked(p, save)).map((p) => p.id)];
      const k = ids.indexOf(perkPick);
      if (action === 'left' || action === 'duck') pickPerk(ids[(k - 1 + ids.length) % ids.length]);
      else if (action === 'right' || action === 'haymaker') pickPerk(ids[(k + 1) % ids.length]);
      else if (action === 'confirm' || action === 'jabL' || action === 'jabR') startShift();
      else if (action === 'pause') toTitle();
      break;
    }
    case 'shiftEnd':
      if (action === 'confirm') toShift();
      else if (action === 'pause') toTitle();
      break;
    case 'intro':
      if (action !== 'any' && introT > 0.5) { introT = 99; beginFight(); }
      break;
    case 'fight':
      if (action === 'pause') { setPause(!paused); return; }
      if (action === 'retry') { retry(); return; }
      if (paused) { if (action === 'confirm') setPause(false); return; }
      if (fight) fight.input(action, true);
      break;
    case 'results':
      if (action === 'confirm') next();
      else if (action === 'retry') retry();
      else if (action === 'pause' && !run) toElevator();
      break;
    case 'fired':
      if (run?.done) { if (action === 'confirm') toShiftEnd(); break; }
      if (action === 'retry' || action === 'confirm') retry();
      else if (action === 'pause' && !run) toElevator();
      break;
    case 'ending':
      if (action === 'confirm' || action === 'pause') toElevator();
      break;
  }
});

// ---------- loop ----------
const clock = new THREE.Clock();
let t = 0;
const headTmp = new THREE.Vector3();
const gloveTmp = new THREE.Vector3();
const koCam = new THREE.Vector3();

function frame() {
  requestAnimationFrame(frame);
  step();
}
// one frame of everything; split from frame() so automated checks can drive it while the page is hidden
function step() {
  const raw = clock.getDelta();
  const realDt = Math.min(raw, 1 / 20);
  t += realDt;
  watchFrames(Math.min(raw, 0.25));
  input.poll();

  // time scale: hit-stop freezes the world, slow-mo eases back to 1
  let dt;
  if (paused) dt = 0;
  else if (time.stop > 0) { time.stop -= realDt; dt = 0; }
  else {
    if (time.slowT > 0) { time.slowT -= realDt; time.scale += (time.slow - time.scale) * Math.min(1, realDt * 20); }
    else time.scale += (1 - time.scale) * Math.min(1, realDt * 5);
    dt = realDt * time.scale;
  }
  if (!paused) audio.setTimeScale(time.stop > 0 ? 0.6 : time.scale);

  if (screen === 'intro') {
    introT += realDt;
    if (introT > 3.4) beginFight();
  }
  if (fight && (screen === 'fight' || screen === 'intro')) fight.update(dt, paused ? 0 : realDt);
  if (fight && fight.trackKO && fighter) {
    fighter.headWorld(headTmp);
    const cut = fight.koCut;
    if (cut && !cut.on) {
      // hard cut to a low ringside angle on the side the body flies toward; held until the results screen
      cut.on = true;
      player.setMenu(koCam.set(cut.dir * 2.3, 0.5, -1.5), headTmp, true);
      player.cam.snapAll({ fov: -8 });
    }
    if (cut) player.menu.look.copy(player.look.lerp(headTmp, 1 - Math.exp(-12 * realDt)));
    else {
      player.lookOverride.lerp(headTmp, 1 - Math.exp(-10 * realDt));
      player.cam.set({ fov: -18 }, 30, 10);
    }
  }

  if (fighter) {
    fighter.update(dt, t, (s) => { arena.ropeHit(s); audio.knockdown(); player.addTrauma(0.3); }, realDt);
    fighter.headWorld(headTmp);
    const telling = fight && screen === 'fight' && (fight.o.state === 'windup' || fight.o.state === 'strike');
    for (const h of ['L', 'R']) {
      const l = fighter.limb[h];
      fx.setTell(h, telling ? l.tell : 0, l.tellColor, fighter.gloveWorld(h, gloveTmp), t);
    }
  }
  // title camera drifts around the ring
  if (screen === 'title') arena.setIntro(1);
  if (screen === 'title' && player.menu) {
    const a = t * 0.12;
    player.menu.pos.set(Math.sin(a) * 2.8, 2.0 + Math.sin(t * 0.3) * 0.2, Math.cos(a) * 2.8 - 0.6);
  }
  player.update((screen === 'fight' || screen === 'intro') && !(fight && fight.phase === 'ko') ? dt : realDt, t);
  arena.update(realDt, t, fight ? fight.hype : 0.35);
  fx.update(dt, t, fighter ? headTmp : null, realDt);
  ui.update(realDt);
  if (screen === 'fight' && !paused) feed.update(realDt);
  post.render(realDt, t);
  clip.update(realDt, canvas, paused);
  if (window.__pc?.onFrame) window.__pc.onFrame(canvas);
  if (captureReq) {
    captureReq = false;
    try { if (fight) fight.snapshot = canvas.toDataURL('image/jpeg', 0.86); } catch { /* tainted or lost context */ }
  }
}

toTitle();
frame();

// ?fight=N jumps straight into floor N (handy for testing a specific opponent)
const qFight = new URLSearchParams(location.search).get('fight');
if (qFight !== null && ROSTER[+qFight]) { startIntro(+qFight); introT = 99; beginFight(); }

// debugging hook for automated checks
window.__pc = { get screen() { return screen; }, get fight() { return fight; }, get fighter() { return fighter; }, scene, camera, player, arena, post, startIntro, beginFight, toElevator, save, renderer,
  get run() { return run; }, clip, step, toShift, startShift, pickPerk, next, retry, toShiftEnd, openShare };
