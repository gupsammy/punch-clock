import * as THREE from 'three';
import { SpringSet, Spring, clamp } from './spring.js';
import { toonMat, inked, GEO, placeSegment, taperGeo, latheGeo } from './materials.js';

// The opponent: a rig of primitives posed by springs.
// Every channel below is a spring. A pose only sets targets, so transitions,
// overshoot, and hit wobble all come from the same place.
//
// Space: the fighter's root sits on the ring facing +z (toward the player).
// Screen-left of the player is -x. Glove 'L' is the glove on screen-left.

// Default body; each boss overrides parts of it in look.shape. Radii are multipliers on the base
// limb radius at each end (shoulder→elbow, elbow→wrist, hip→knee, knee→ankle); torso is a lathe profile.
const SHAPE = { torso: [0.78, 0.84, 0.93, 1, 0.96, 0.62], sh: 1, hip: 1, arm: [1, 0.85], fore: [0.85, 0.95],
  thigh: [1, 0.8], shin: [0.9, 0.72], leg: 1, glove: 1, neck: 1 };

// `drop`: how far shorter legs lower the hips, so glove targets stay at the same height on the body
function makePoses(hs, drop = 0) {
  const Y = (v) => v * hs - drop;
  const base = { x: 0, y: 0, z: 0, lean: 0.1, twist: 0, tilt: 0, hLean: 0.05, hTwist: 0, hTilt: 0, fall: 0, squash: 0,
    lx: -0.17, ly: Y(1.43), lz: 0.36, rx: 0.17, ry: Y(1.43), rz: 0.36 };
  const P = {
    guard: {},
    open: { lx: -0.3, ly: Y(1.02), lz: 0.25, rx: 0.3, ry: Y(1.02), rz: 0.25, lean: -0.04, hLean: -0.05, y: -0.03 },
    block: { lx: -0.085, ly: Y(1.53), lz: 0.43, rx: 0.085, ry: Y(1.53), rz: 0.43, lean: 0.2, y: -0.05, hLean: 0.3 },
    // Windups read as a whole-body shape: jabs rock back, hooks coil and dip a shoulder, uppercuts
    // crouch (squash > 0), smashes rise tall (squash < 0), throws wind the arm far back.
    windJabL: { twist: 0.3, lean: -0.08, lx: -0.27, ly: Y(1.47), lz: 0.06, y: -0.02, hLean: 0.12, squash: -0.15 },
    jabL: { z: 0.3, twist: -0.32, lean: 0.24, lx: -0.04, ly: Y(1.57), lz: 1.44, hTwist: -0.12, squash: -0.2 },
    windJabR: { twist: -0.3, lean: -0.08, rx: 0.27, ry: Y(1.47), rz: 0.06, y: -0.02, hLean: 0.12, squash: -0.15 },
    jabR: { z: 0.3, twist: 0.32, lean: 0.24, rx: 0.04, ry: Y(1.57), rz: 1.44, hTwist: 0.12, squash: -0.2 },
    windHookL: { twist: 0.85, tilt: -0.24, lx: -0.7, ly: Y(1.46), lz: -0.14, y: -0.08, rx: 0.1, ry: Y(1.46), rz: 0.4, hLean: 0.15, squash: 0.25 },
    hookL: { twist: -0.55, tilt: 0.14, z: 0.24, lean: 0.2, lx: 0.02, ly: Y(1.6), lz: 1.42, squash: -0.15 },
    windHookR: { twist: -0.85, tilt: 0.24, rx: 0.7, ry: Y(1.46), rz: -0.14, y: -0.08, lx: -0.1, ly: Y(1.46), lz: 0.4, hLean: 0.15, squash: 0.25 },
    hookR: { twist: 0.55, tilt: -0.14, z: 0.24, lean: 0.2, rx: -0.02, ry: Y(1.6), rz: 1.42, squash: -0.15 },
    windUpperL: { y: -0.25, lean: 0.4, twist: 0.26, tilt: -0.18, lx: -0.2, ly: Y(0.8), lz: 0.28, hLean: 0.1, squash: 0.7 },
    upperL: { y: 0.1, lean: -0.18, twist: -0.25, z: 0.26, lx: -0.03, ly: Y(1.74), lz: 1.38, hLean: -0.22, squash: -0.55 },
    windUpperR: { y: -0.25, lean: 0.4, twist: -0.26, tilt: 0.18, rx: 0.2, ry: Y(0.8), rz: 0.28, hLean: 0.1, squash: 0.7 },
    upperR: { y: 0.1, lean: -0.18, twist: 0.25, z: 0.26, rx: 0.03, ry: Y(1.74), rz: 1.38, hLean: -0.22, squash: -0.55 },
    windSmash: { lean: -0.42, y: 0.08, twist: -0.4, rx: 0.3, ry: Y(2.15), rz: -0.2, hLean: -0.34, lx: -0.14, ly: Y(1.42), lz: 0.4, squash: -0.6 },
    smash: { lean: 0.55, y: -0.14, z: 0.32, twist: 0.2, rx: 0.02, ry: Y(1.5), rz: 1.44, hLean: 0.1, squash: 0.6 },
    windThrow: { twist: -0.78, rx: 0.56, ry: Y(1.8), rz: -0.6, lean: -0.18, lx: -0.2, ly: Y(1.4), lz: 0.45, hLean: -0.12, squash: -0.25 },
    throw: { twist: 0.42, rx: 0.12, ry: Y(1.58), rz: 0.95, lean: 0.26, squash: 0.1 },
    windPivot: { twist: -5.9, rx: 0.55, ry: Y(1.55), rz: 0.1, lx: -0.35, ly: Y(1.3), lz: 0.1, y: -0.05 },
    pivot: { twist: -6.28 + 0.5, tilt: -0.12, z: 0.25, lean: 0.2, rx: -0.02, ry: Y(1.6), rz: 1.42 },
    windTakeover: { y: -0.26, z: -0.25, lean: 0.38, lx: -0.26, ly: Y(0.7), lz: 0.1, rx: 0.14, ry: Y(1.4), rz: 0.4, hLean: 0.2 },
    takeover: { z: 0.5, y: 0.1, lean: -0.16, lx: -0.02, ly: Y(1.76), lz: 1.46, hLean: -0.2 },
    hurtHead: { hLean: -0.65, lean: -0.26, z: -0.1, lx: -0.36, ly: Y(1.18), lz: 0.12, rx: 0.36, ry: Y(1.18), rz: 0.12, y: -0.02 },
    hurtL: { hTwist: 0.7, hLean: -0.2, twist: 0.34, tilt: 0.1, x: 0.05, lx: -0.4, ly: Y(1.25), lz: 0.1, rx: 0.3, ry: Y(1.3), rz: 0.3 },
    hurtR: { hTwist: -0.7, hLean: -0.2, twist: -0.34, tilt: -0.1, x: -0.05, lx: -0.3, ly: Y(1.3), lz: 0.3, rx: 0.4, ry: Y(1.25), rz: 0.1 },
    hurtBody: { lean: 0.42, y: -0.1, hLean: 0.3, squash: 0.6, lx: -0.2, ly: Y(1.05), lz: 0.3, rx: 0.2, ry: Y(1.05), rz: 0.3 },
    dizzy: { lx: -0.3, ly: Y(0.95), lz: 0.22, rx: 0.3, ry: Y(0.95), rz: 0.22, lean: -0.05, y: -0.06, hLean: 0.1 },
    down: { fall: 1, lx: -0.55, ly: Y(1.1), lz: -0.1, rx: 0.55, ry: Y(1.1), rz: -0.1, hLean: -0.4 },
    victory: { lx: -0.26, ly: Y(2.05), lz: 0.1, rx: 0.26, ry: Y(2.05), rz: 0.1, lean: -0.1, hLean: -0.3 },
    phone: { rx: 0.06, ry: Y(1.5), rz: 0.36, hLean: 0.5, lx: -0.25, ly: Y(1.0), lz: 0.2, lean: 0.02 },
    sip: { rx: 0.04, ry: Y(1.5), rz: 0.28, hLean: -0.2, lx: -0.2, ly: Y(1.15), lz: 0.32 },
    flex: { lx: -0.44, ly: Y(1.74), lz: 0.02, rx: 0.44, ry: Y(1.74), rz: 0.02, lean: -0.12, hLean: -0.12, y: -0.02 },
    invoice: { rx: 0.14, ry: Y(1.42), rz: 0.7, lean: 0.12, lx: -0.2, ly: Y(1.2), lz: 0.3 },
    nap: { y: -0.08, lean: 0.26, hLean: 0.55, hTilt: 0.32, lx: -0.2, ly: Y(1.0), lz: 0.3, rx: 0.2, ry: Y(1.0), rz: 0.3 },
    cash: { rx: 0.22, ry: Y(1.85), rz: 0.2, hLean: -0.22, lx: -0.2, ly: Y(1.35), lz: 0.35, lean: -0.05 },
  };
  const out = {};
  for (const k in P) out[k] = { ...base, ...P[k] };
  return out;
}

// ---------- face ----------
const FACE_W = 512, FACE_H = 256;
// The face texture covers the front hemisphere: 180° wide, theta 0.28π..0.78π tall.
const THETA0 = 0.28 * Math.PI, THETA_L = 0.5 * Math.PI;
const INK = '#1a0c12';

function drawFace(ctx, look, expr) {
  const f = look.face || {};
  ctx.clearRect(0, 0, FACE_W, FACE_H);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const cx = 256, ey = 96, ex = 60, my = 176;

  // cheeks / wrinkles / freckles
  if (f.freckles) {
    ctx.fillStyle = 'rgba(150,70,40,0.55)';
    for (let i = 0; i < 14; i++) {
      const s = i < 7 ? -1 : 1;
      ctx.beginPath();
      ctx.arc(cx + s * (48 + (i % 7) * 7), 128 + ((i * 13) % 17), 2.4, 0, 7);
      ctx.fill();
    }
  }
  if (f.wrinkles) {
    ctx.strokeStyle = 'rgba(90,40,40,0.55)'; ctx.lineWidth = 3;
    for (const s of [-1, 1]) {
      for (let i = 0; i < 3; i++) {
        ctx.beginPath(); ctx.moveTo(cx + s * 96, ey - 6 + i * 9); ctx.lineTo(cx + s * 112, ey - 10 + i * 12); ctx.stroke();
      }
      ctx.beginPath(); ctx.arc(cx + s * 40, 150, 26, s < 0 ? 0.6 : 1.9, s < 0 ? 1.4 : 2.6); ctx.stroke();
    }
    for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.moveTo(cx - 40, 30 + i * 10); ctx.quadraticCurveTo(cx, 24 + i * 10, cx + 40, 30 + i * 10); ctx.stroke(); }
  }
  if (f.stubble || f.jaw) {
    // same seed for every expression, or the stubble would jump each time the face changes
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    ctx.fillStyle = 'rgba(60,35,20,0.35)';
    for (let i = 0; i < 160; i++) {
      const a = rnd() * Math.PI, r = 70 + rnd() * 30;
      const x = cx + Math.cos(a) * r * 1.2, y = 150 + Math.sin(a) * r * 0.9;
      if (y < FACE_H) ctx.fillRect(x, y, 2, 2);
    }
  }
  if (expr === 'hurt' || expr === 'dizzy' || expr === 'ko') {
    ctx.fillStyle = 'rgba(255,60,80,0.35)';
    for (const s of [-1, 1]) { ctx.beginPath(); ctx.ellipse(cx + s * 78, 140, 26, 14, 0, 0, 7); ctx.fill(); }
  }

  // eyes
  ctx.strokeStyle = INK; ctx.fillStyle = INK;
  const eyeR = f.eyes === 'round' ? 22 : f.eyes === 'small' ? 13 : 18;
  const drawOpenEye = (x, pupil = 1, lid = 0, look = 0) => {
    ctx.fillStyle = '#fbf6ee';
    ctx.beginPath(); ctx.ellipse(x, ey, eyeR * 1.1, eyeR, 0, 0, 7); ctx.fill();
    ctx.lineWidth = 5; ctx.stroke();
    ctx.fillStyle = INK;
    ctx.beginPath(); ctx.arc(x + look, ey + 2, eyeR * 0.5 * pupil, 0, 7); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(x + look - 4, ey - 3, eyeR * 0.14, 0, 7); ctx.fill();
    // heavy lid for narrow / smug eyes: skin-coloured band plus a lid line
    if (lid > 0) {
      ctx.fillStyle = f._skin;
      ctx.beginPath(); ctx.rect(x - eyeR * 1.3, ey - eyeR - 4, eyeR * 2.6, eyeR * 2 * lid + 4); ctx.fill();
      ctx.strokeStyle = INK; ctx.lineWidth = 6;
      ctx.beginPath(); ctx.moveTo(x - eyeR * 1.15, ey - eyeR + eyeR * 2 * lid); ctx.lineTo(x + eyeR * 1.15, ey - eyeR + eyeR * 2 * lid); ctx.stroke();
    }
    if (f.lashes) {
      ctx.lineWidth = 4; ctx.strokeStyle = INK;
      const s = Math.sign(x - cx);
      for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.moveTo(x + s * (eyeR * 0.6 + i * 5), ey - eyeR * 0.8 + i * 5); ctx.lineTo(x + s * (eyeR * 1.2 + i * 7), ey - eyeR * 1.2 + i * 6); ctx.stroke(); }
    }
  };
  const closedEye = (x, curve = 1) => {
    ctx.lineWidth = 6; ctx.strokeStyle = INK;
    ctx.beginPath(); ctx.moveTo(x - eyeR, ey); ctx.quadraticCurveTo(x, ey + 12 * curve, x + eyeR, ey); ctx.stroke();
  };
  const baseLid = f.eyes === 'narrow' ? 0.32 : 0;
  switch (expr) {
    case 'blink': case 'sleep': closedEye(cx - ex); closedEye(cx + ex); break;
    case 'hurt':
      ctx.lineWidth = 7;
      for (const s of [-1, 1]) {
        const x = cx + s * ex;
        ctx.beginPath(); ctx.moveTo(x - s * 16, ey - 14); ctx.lineTo(x + s * 12, ey); ctx.lineTo(x - s * 16, ey + 14); ctx.stroke();
      }
      break;
    case 'dizzy':
      ctx.lineWidth = 4;
      for (const s of [-1, 1]) {
        ctx.fillStyle = '#fbf6ee'; ctx.beginPath(); ctx.arc(cx + s * ex, ey, eyeR * 1.1, 0, 7); ctx.fill(); ctx.stroke();
        ctx.beginPath();
        for (let a = 0; a < 16; a += 0.3) { const r = a * 1.25; ctx.lineTo(cx + s * ex + Math.cos(a * s) * r, ey + Math.sin(a * s) * r); }
        ctx.stroke();
      }
      break;
    case 'ko':
      ctx.lineWidth = 8;
      for (const s of [-1, 1]) {
        const x = cx + s * ex;
        ctx.beginPath(); ctx.moveTo(x - 15, ey - 15); ctx.lineTo(x + 15, ey + 15); ctx.moveTo(x + 15, ey - 15); ctx.lineTo(x - 15, ey + 15); ctx.stroke();
      }
      break;
    case 'shock': drawOpenEye(cx - ex, 0.45, 0); drawOpenEye(cx + ex, 0.45, 0); break;
    case 'taunt': drawOpenEye(cx - ex, 1, 0.45); drawOpenEye(cx + ex, 1, 0.3); break;
    case 'angry': case 'windup': drawOpenEye(cx - ex, 0.7, Math.max(baseLid, 0.22)); drawOpenEye(cx + ex, 0.7, Math.max(baseLid, 0.22)); break;
    default: drawOpenEye(cx - ex, 1, baseLid); drawOpenEye(cx + ex, 1, baseLid);
  }

  // brows
  const bw = f.brows === 'thick' ? 13 : f.brows === 'arched' ? 7 : 8;
  ctx.strokeStyle = f.browColor || INK; ctx.lineWidth = bw;
  const brow = (s, inner, outer, arch = 0) => {
    const x = cx + s * ex;
    ctx.beginPath(); ctx.moveTo(x - s * 24, ey - 30 + inner); ctx.quadraticCurveTo(x, ey - 40 + (inner + outer) / 2 - arch, x + s * 26, ey - 30 + outer); ctx.stroke();
  };
  const arch = f.brows === 'arched' ? 10 : 0;
  switch (expr) {
    case 'angry': case 'windup': brow(-1, 14, -8); brow(1, 14, -8); break;
    case 'hurt': case 'shock': brow(-1, -16, -2, arch); brow(1, -16, -2, arch); break;
    case 'dizzy': brow(-1, -10, 4); brow(1, 4, -10); break;
    case 'ko': brow(-1, -12, 6); brow(1, -12, 6); break;
    case 'taunt': brow(-1, 6, 2, arch); brow(1, -18, -10, arch); break;
    case 'sleep': brow(-1, 2, 6); brow(1, 2, 6); break;
    default: brow(-1, 6, -2, arch); brow(1, 6, -2, arch);
  }

  // nose
  ctx.strokeStyle = 'rgba(60,20,20,0.55)'; ctx.lineWidth = 5;
  ctx.beginPath(); ctx.moveTo(cx - 4, 112); ctx.quadraticCurveTo(cx + 12, 140, cx - 6, 145); ctx.stroke();

  // mustache
  if (f.mustache) {
    ctx.fillStyle = look.hairColor || '#333';
    ctx.beginPath();
    ctx.moveTo(cx, 156);
    ctx.bezierCurveTo(cx - 30, 146, cx - 58, 152, cx - 64, 170);
    ctx.bezierCurveTo(cx - 40, 160, cx - 20, 166, cx, 162);
    ctx.bezierCurveTo(cx + 20, 166, cx + 40, 160, cx + 64, 170);
    ctx.bezierCurveTo(cx + 58, 152, cx + 30, 146, cx, 156);
    ctx.fill();
  }

  // mouth
  const lip = f.lipstick || INK;
  const teeth = (x, y, w, h, gold) => {
    ctx.fillStyle = '#fffaf0'; ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = INK; ctx.lineWidth = 2.5;
    const n = 6;
    for (let i = 1; i < n; i++) { ctx.beginPath(); ctx.moveTo(x + (w / n) * i, y); ctx.lineTo(x + (w / n) * i, y + h); ctx.stroke(); }
    if (gold) { ctx.fillStyle = '#ffc233'; ctx.fillRect(x + (w / n) * 4 + 1, y + 1, w / n - 2, h - 2); }
    ctx.lineWidth = 5; ctx.strokeRect(x, y, w, h);
  };
  ctx.strokeStyle = lip; ctx.fillStyle = INK; ctx.lineWidth = 6;
  const mode = expr === 'idle' || expr === 'blink' ? (f.mouth || 'tight') : expr;
  switch (mode) {
    case 'windup': case 'angry': teeth(cx - 38, my - 10, 76, 22, f.goldTooth); break;
    case 'hurt': case 'shock':
      ctx.fillStyle = '#3a0a14'; ctx.beginPath(); ctx.ellipse(cx, my + 4, 26, expr === 'hurt' ? 24 : 18, 0, 0, 7); ctx.fill();
      ctx.strokeStyle = lip; ctx.stroke();
      ctx.fillStyle = '#ff6f8a'; ctx.beginPath(); ctx.ellipse(cx, my + 18, 14, 7, 0, 0, 7); ctx.fill();
      break;
    case 'dizzy': case 'ko':
      ctx.beginPath(); ctx.moveTo(cx - 34, my); for (let i = 0; i <= 8; i++) ctx.lineTo(cx - 34 + i * 8.5, my + (i % 2 ? 7 : -3)); ctx.stroke();
      ctx.fillStyle = '#ff6f8a'; ctx.beginPath(); ctx.ellipse(cx + 12, my + 16, 11, 16, 0.3, 0, 7); ctx.fill();
      ctx.strokeStyle = INK; ctx.lineWidth = 3; ctx.stroke();
      break;
    case 'taunt': case 'grin': case 'smirk':
      if (mode === 'smirk') {
        ctx.beginPath(); ctx.moveTo(cx - 34, my + 2); ctx.quadraticCurveTo(cx + 4, my + 14, cx + 38, my - 10); ctx.stroke();
        if (f.goldTooth) { ctx.fillStyle = '#ffc233'; ctx.fillRect(cx + 10, my + 1, 10, 9); }
      } else {
        ctx.fillStyle = '#3a0a14';
        ctx.beginPath(); ctx.moveTo(cx - 44, my - 8); ctx.quadraticCurveTo(cx, my + 34, cx + 44, my - 8); ctx.closePath(); ctx.fill();
        teeth(cx - 34, my - 6, 68, 12, f.goldTooth);
        ctx.strokeStyle = lip; ctx.lineWidth = 6;
        ctx.beginPath(); ctx.moveTo(cx - 44, my - 8); ctx.quadraticCurveTo(cx, my + 34, cx + 44, my - 8); ctx.closePath(); ctx.stroke();
      }
      break;
    case 'nervous':
      ctx.beginPath(); ctx.moveTo(cx - 30, my); ctx.bezierCurveTo(cx - 15, my - 10, cx - 5, my + 10, cx + 8, my); ctx.bezierCurveTo(cx + 18, my - 8, cx + 24, my + 6, cx + 32, my - 2); ctx.stroke();
      break;
    case 'sleep':
      ctx.fillStyle = '#3a0a14'; ctx.beginPath(); ctx.ellipse(cx, my + 4, 9, 11, 0, 0, 7); ctx.fill();
      break;
    default:
      ctx.beginPath(); ctx.moveTo(cx - 32, my); ctx.quadraticCurveTo(cx, my + 3, cx + 32, my); ctx.stroke();
  }
}

const EXPRS = ['idle', 'blink', 'angry', 'windup', 'hurt', 'dizzy', 'ko', 'taunt', 'sleep', 'shock'];

// ---------- IK ----------
const _n = new THREE.Vector3(), _p = new THREE.Vector3();
// Two-bone IK. Stretches the limb (rubber-hose style) when the target is out of reach,
// so a punch always lands where the pose says it does.
function solveIK(a, target, l1, l2, pole, outElbow) {
  _n.subVectors(target, a);
  let d = _n.length();
  if (d < 1e-5) { outElbow.copy(a); return; }
  _n.multiplyScalar(1 / d);
  const reach = l1 + l2;
  if (d >= reach * 0.999) {
    const s = d / reach;
    outElbow.copy(a).addScaledVector(_n, l1 * s);
    // a hint of bend so a stretched arm never looks like a stick
    _p.copy(pole).addScaledVector(_n, -pole.dot(_n)).normalize();
    outElbow.addScaledVector(_p, 0.02);
    return;
  }
  d = Math.max(d, Math.abs(l1 - l2) + 1e-3);
  const cosA = clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1);
  const sinA = Math.sqrt(1 - cosA * cosA);
  _p.copy(pole).addScaledVector(_n, -pole.dot(_n)).normalize();
  outElbow.copy(a).addScaledVector(_n, l1 * cosA).addScaledVector(_p, l1 * sinA);
}

// ---------- fighter ----------
export class Fighter {
  constructor(data) {
    this.data = data;
    const L = this.look = data.look;
    const hs = L.height || 1, bk = L.bulk || 1, hd = L.head || 1;
    const S = this.shape = { ...SHAPE, ...L.shape };
    this.hs = hs; this.bk = bk;
    this.hipY = 0.92 * hs * S.leg;
    this.legL = 0.46 * hs * S.leg;
    this.poses = makePoses(hs, 0.92 * hs - this.hipY);
    this.springs = new SpringSet(this.poses.guard, 170, 17);
    this.baseX = new Spring(0, 60, 11);
    this.flashU = { value: 0 };
    this.poseName = 'guard';
    this.expr = 'idle';
    this.exprHold = 0;
    this.blinkT = 2;
    this.energy = 1;
    this.flying = null;
    this.twistWrap = false;

    const root = this.root = new THREE.Group();
    root.position.set(0, 0, -0.6);
    const body = this.body = new THREE.Group();
    root.add(body);

    const skin = toonMat(L.skin, { flash: this.flashU });
    const shirt = this.shirtMat = toonMat(L.shirt, { flash: this.flashU });
    const shorts = toonMat(L.shorts, { flash: this.flashU });
    const trim = toonMat(L.trim || '#ffffff', { flash: this.flashU });
    const hair = toonMat(L.hairColor || '#222', { flash: this.flashU });
    const shoe = toonMat('#15121a', { flash: this.flashU });
    this.mats = { skin, shirt, shorts, trim, hair, shoe };

    // hips + shorts
    const hips = this.hips = new THREE.Group();
    body.add(hips);
    const pelvis = inked(GEO.cylTaper, shorts);
    pelvis.scale.set(0.2 * bk * S.hip, 0.26, 0.15 * bk * Math.sqrt(S.hip));
    pelvis.position.y = -0.04;
    hips.add(pelvis);
    const band = inked(GEO.cyl, trim, 0.008);
    band.scale.set(0.205 * bk * S.hip, 0.045, 0.155 * bk * Math.sqrt(S.hip));
    band.position.y = 0.1;
    hips.add(band);

    // torso
    const torso = this.torso = new THREE.Group();
    torso.position.y = 0.08;
    hips.add(torso);
    // the torso's widest ring sets the shoulder line; the profile shapes everything below it
    const tw = Math.max(...S.torso);
    const chest = this.chest = inked(latheGeo(S.torso), shirt, 0.014);
    chest.geometry.userData.unit = 'cyl';
    chest.scale.set(0.24 * bk * tw * S.sh, 0.6 * hs, 0.17 * bk * tw);
    chest.position.y = 0.26 * hs;
    torso.add(chest);
    if (L.belly > 0) {
      const belly = this.belly = inked(GEO.sphere, shirt, 0.012);
      belly.scale.set(0.2 * bk, 0.17, 0.16 * bk + L.belly * 0.12);
      belly.position.set(0, 0.1, 0.03 + L.belly * 0.05);
      belly.userData.base = belly.scale.clone();
      torso.add(belly);
    }
    const neck = inked(GEO.cyl, skin, 0.01);
    neck.scale.set(0.06 * bk * (S.neckW || 1), 0.14 * S.neck, 0.06 * bk * (S.neckW || 1));
    neck.position.y = 0.55 * hs + (S.neck - 1) * 0.06;
    torso.add(neck);
    this.shoulderY = 0.46 * hs;
    this.shoulderX = 0.2 * bk * S.sh + 0.03;
    for (const s of [-1, 1]) {
      const delt = inked(GEO.sphere, shirt, 0.012);
      delt.scale.setScalar(0.085 * bk * Math.sqrt(S.sh) * Math.max(S.arm[0], 0.8));
      delt.position.set(s * this.shoulderX, this.shoulderY, 0);
      torso.add(delt);
    }

    // head
    const R = this.headR = 0.155 * hd;
    const head = this.head = new THREE.Group();
    head.position.set(0, 0.64 * hs + R * 0.4 + (S.neck - 1) * 0.12, 0.02);
    torso.add(head);
    const skull = inked(GEO.sphere, skin, 0.013);
    skull.scale.set(R, R * 1.06, R);
    head.add(skull);
    for (const s of [-1, 1]) {
      const ear = inked(GEO.sphereLo, skin, 0.008);
      ear.scale.set(R * 0.14, R * 0.26, R * 0.2);
      ear.position.set(s * R * 0.98, 0, -R * 0.05);
      head.add(ear);
    }
    if (L.face?.jaw) {
      const jaw = inked(GEO.sphere, skin, 0.012);
      jaw.scale.set(R * 0.95, R * 0.55, R * 0.85);
      jaw.position.set(0, -R * 0.55, R * 0.12);
      head.add(jaw);
    }
    // Face: a canvas per expression, swapped as a texture map on a front shell.
    L.face = L.face || {};
    L.face._skin = L.skin;
    this.faceTex = {};
    for (const e of EXPRS) {
      const c = document.createElement('canvas');
      c.width = FACE_W; c.height = FACE_H;
      drawFace(c.getContext('2d'), L, e);
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 4;
      this.faceTex[e] = t;
    }
    const faceGeo = new THREE.SphereGeometry(1, 40, 24, 0, Math.PI, THETA0, THETA_L);
    this.faceMat = toonMat('#ffffff', { map: this.faceTex.idle, transparent: true, flash: this.flashU });
    this.faceMat.depthWrite = false;
    const face = new THREE.Mesh(faceGeo, this.faceMat);
    face.scale.set(R * 1.012, R * 1.07, R * 1.012);
    face.renderOrder = 2;
    head.add(face);

    this.buildHair(head, R, hair);
    this.buildAccessories(head, torso, R, hs, bk);

    // limbs (root space, placed by IK every frame)
    this.limb = {};
    const limbMesh = (mat, r, t = 0.011) => { const m = inked(taperGeo(r[0], r[1]), mat, t); root.add(m); return m; };
    // thick-end radius of each segment, used by placeSegment every frame
    this.limbR = {
      upper: 0.052 * bk * Math.max(...S.arm), fore: 0.045 * bk * Math.max(...S.fore),
      thigh: 0.078 * Math.max(0.9, bk * 0.9) * Math.max(...S.thigh), shin: 0.062 * Math.max(...S.shin),
    };
    const joint = (mat, r, t = 0.01) => { const m = inked(GEO.sphereLo, mat, t); m.scale.setScalar(r); root.add(m); return m; };
    for (const side of ['L', 'R']) {
      const gm = toonMat(L.gloves, { flash: this.flashU, emissive: 0x000000 });
      if (L.goldGloves) { gm.emissive.set('#2e1d00'); }
      const glove = new THREE.Group();
      const gs = S.glove;
      const g1 = inked(GEO.sphere, gm, 0.014); g1.scale.set(0.115 * gs, 0.105 * gs, 0.135 * gs); glove.add(g1);
      const thumb = inked(GEO.sphereLo, gm, 0.01); thumb.scale.set(0.05 * gs, 0.045 * gs, 0.06 * gs);
      thumb.position.set((side === 'L' ? 0.085 : -0.085) * gs, 0.03 * gs, 0.03 * gs); glove.add(thumb);
      const cuff = inked(GEO.cyl, trim, 0.01); cuff.scale.set(0.078 * gs, 0.09, 0.078 * gs);
      cuff.rotation.x = Math.PI / 2; cuff.position.z = -0.12 * gs; glove.add(cuff);
      root.add(glove);
      const LR = this.limbR, rel = (arr, i) => arr[i] / Math.max(...arr);
      this.limb[side] = {
        upper: limbMesh(shirt, S.arm), fore: limbMesh(skin, S.fore),
        elbow: joint(skin, Math.max(LR.upper * rel(S.arm, 1), LR.fore * rel(S.fore, 0)) * 0.97), glove, gloveMat: gm,
        thigh: limbMesh(shorts, S.thigh), shin: limbMesh(skin, S.shin),
        knee: joint(skin, Math.max(LR.thigh * rel(S.thigh, 1), LR.shin * rel(S.shin, 0)) * 0.95), shoe: (() => {
          const s = inked(GEO.sphere, shoe, 0.01); s.scale.set(0.075, 0.06, 0.14); root.add(s); return s;
        })(),
        tell: 0, tellColor: new THREE.Color('#ffffff'),
      };
    }
    this.props = this.buildProps();

    // soft contact shadow
    const sh = document.createElement('canvas'); sh.width = sh.height = 128;
    const sctx = sh.getContext('2d');
    const grd = sctx.createRadialGradient(64, 64, 4, 64, 64, 62);
    grd.addColorStop(0, 'rgba(0,0,0,0.75)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
    sctx.fillStyle = grd; sctx.fillRect(0, 0, 128, 128);
    this.shadow = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.8), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(sh), transparent: true, depthWrite: false }));
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.position.y = 0.005;
    root.add(this.shadow);

    this.headSquash = 0;
    this._v = { a: new THREE.Vector3(), b: new THREE.Vector3(), c: new THREE.Vector3(), e: new THREE.Vector3(), g: new THREE.Vector3(), pole: new THREE.Vector3() };
    // the player's camera; gloves stay outside a sphere around it (set by main.js)
    this.keepOut = null;
    // solid parts the floor collides with (outline hulls ride on their parent)
    const shape = new Map([[GEO.sphere, 'sphere'], [GEO.sphereLo, 'sphere'], [GEO.cyl, 'cyl'], [GEO.cylTaper, 'cyl'], [GEO.box, 'box']]);
    this.solids = [];
    root.traverse((o) => {
      // instanced meshes keep their size in per-instance matrices, which the support functions can't see
      const kind = o.isMesh && !o.isInstancedMesh && !o.material.isShaderMaterial && (shape.get(o.geometry) || o.geometry.userData.unit);
      if (kind) this.solids.push([o, kind]);
    });
    // secondary motion: things that hang off the body lag behind it
    this.wob = new SpringSet({ tieX: 0, tieZ: 0, hairX: 0, hairZ: 0, belly: 0 }, 90, 6);
    this._prevP = null; this._prevV = new THREE.Vector3(); this._acc = new THREE.Vector3();
    this.windK = null;
    this.setPose('guard');
  }

  buildHair(head, R, mat) {
    const style = this.look.hair;
    // one group pivoting at the crown, so the whole do can bounce
    const grp = this.hair = new THREE.Group();
    grp.position.y = R * 0.6;
    head.add(grp);
    this.hairAmp = { bob: 1, bun: 1, messy: 0.7 }[style] || 0.25;
    const add = (sx, sy, sz, x, y, z, rx = 0) => {
      const m = inked(GEO.sphere, mat, 0.01); m.scale.set(sx, sy, sz); m.position.set(x, y - R * 0.6, z); m.rotation.x = rx; grp.add(m); return m;
    };
    if (style === 'messy') {
      add(R * 1.02, R * 0.6, R * 0.98, 0, R * 0.52, -R * 0.08);
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2;
        add(R * 0.32, R * 0.28, R * 0.32, Math.cos(a) * R * 0.55, R * 0.85, Math.sin(a) * R * 0.5 - R * 0.05);
      }
      add(R * 0.5, R * 0.2, R * 0.3, R * 0.2, R * 0.72, R * 0.6, 0.4);
    } else if (style === 'bob') {
      add(R * 1.14, R * 1.1, R * 1.06, 0, R * 0.06, -R * 0.2);
      add(R * 0.95, R * 0.34, R * 0.5, 0, R * 0.72, R * 0.45, 0.5);
    } else if (style === 'bun') {
      add(R * 1.05, R * 0.72, R * 1.02, 0, R * 0.38, -R * 0.1);
      add(R * 0.48, R * 0.44, R * 0.48, 0, R * 1.08, -R * 0.35);
      for (const s of [-1, 1]) add(R * 0.3, R * 0.3, R * 0.3, s * R * 0.82, R * 0.25, -R * 0.1);
    } else if (style === 'fade') {
      add(R * 1.03, R * 0.55, R * 1.0, 0, R * 0.55, -R * 0.03);
      add(R * 0.7, R * 0.22, R * 0.4, 0, R * 0.95, R * 0.35, 0.3);
    } else if (style === 'slick') {
      add(R * 1.05, R * 0.62, R * 1.03, 0, R * 0.5, -R * 0.06);
      add(R * 0.8, R * 0.3, R * 0.45, R * 0.1, R * 0.88, R * 0.42, 0.2);
    }
  }

  buildAccessories(head, torso, R, hs, bk) {
    const acc = this.look.acc || [];
    const dark = toonMat('#15121a', { flash: this.flashU });
    const eyeY = R * Math.cos(0.46 * Math.PI) * 1.06, eyeZ = R * 0.93, eyeX = R * 0.37;
    if (acc.includes('glasses')) {
      for (const s of [-1, 1]) {
        const ring = new THREE.Mesh(GEO.torus, dark);
        ring.scale.set(R * 0.3, R * 0.27, R * 0.5);
        ring.position.set(s * eyeX, eyeY, eyeZ + R * 0.12);
        head.add(ring);
        const lens = new THREE.Mesh(new THREE.CircleGeometry(1, 20), new THREE.MeshBasicMaterial({ color: '#bfe8ff', transparent: true, opacity: 0.18, depthWrite: false }));
        lens.scale.set(R * 0.29, R * 0.26, 1);
        lens.position.copy(ring.position);
        head.add(lens);
      }
      const bridge = new THREE.Mesh(GEO.box, dark);
      bridge.scale.set(R * 0.2, R * 0.04, R * 0.04);
      bridge.position.set(0, eyeY + R * 0.05, eyeZ + R * 0.12);
      head.add(bridge);
    }
    if (acc.includes('shades')) {
      const lensMat = toonMat('#050507', { flash: this.flashU });
      for (const s of [-1, 1]) {
        const l = inked(GEO.sphere, lensMat, 0.006);
        l.scale.set(R * 0.34, R * 0.2, R * 0.08);
        l.position.set(s * R * 0.36, R * 0.62, R * 0.8);
        l.rotation.x = -0.6;
        head.add(l);
      }
    }
    if (acc.includes('earpiece')) {
      const e = new THREE.Mesh(GEO.box, new THREE.MeshBasicMaterial({ color: '#39d3ff' }));
      e.scale.set(R * 0.14, R * 0.24, R * 0.12);
      e.position.set(-R * 1.05, 0, 0);
      head.add(e);
    }
    if (acc.includes('headset')) {
      const band = new THREE.Mesh(new THREE.TorusGeometry(R * 1.08, R * 0.05, 6, 20, Math.PI), dark);
      band.position.y = R * 0.05;
      head.add(band);
      const boom = new THREE.Mesh(GEO.cyl, dark);
      placeSegment(boom, new THREE.Vector3(R * 1.05, 0, 0), new THREE.Vector3(R * 0.35, -R * 0.62, R * 0.9), R * 0.03);
      head.add(boom);
      const mic = new THREE.Mesh(GEO.sphereLo, dark);
      mic.scale.setScalar(R * 0.1); mic.position.set(R * 0.33, -R * 0.64, R * 0.92);
      head.add(mic);
    }
    const S = this.shape, chestFront = 0.17 * bk * Math.max(S.torso[3], S.torso[4]) * 0.98;
    if (acc.includes('suit') || acc.includes('vest')) {
      const shirtFront = new THREE.Mesh(GEO.sphere, toonMat('#f3f1ec', { flash: this.flashU }));
      shirtFront.scale.set(0.07 * bk, 0.2 * hs, 0.05);
      shirtFront.position.set(0, 0.38 * hs, chestFront - 0.02);
      torso.add(shirtFront);
      this.shirtFront = shirtFront;
    }
    if (acc.includes('tie') && this.look.tie) {
      const tieMat = toonMat(this.look.tie, { flash: this.flashU });
      const knot = inked(GEO.box, tieMat, 0.006);
      knot.scale.set(0.045, 0.04, 0.03);
      knot.position.set(0, 0.5 * hs, chestFront + 0.01);
      torso.add(knot);
      // the blade hangs from a pivot at the knot and swings on its own spring
      const pivot = this.tiePivot = new THREE.Group();
      pivot.position.set(0, 0.49 * hs, chestFront + 0.02);
      torso.add(pivot);
      const tie = inked(GEO.box, tieMat, 0.006);
      tie.scale.set(0.055, 0.3 * hs, 0.02);
      tie.position.set(0, -0.15 * hs, 0.012);
      pivot.add(tie);
      this.tieParts = [knot, tie];
    }
    if (acc.includes('lanyard')) {
      const strap = new THREE.Mesh(new THREE.TorusGeometry(0.1 * bk, 0.008, 5, 18), new THREE.MeshBasicMaterial({ color: this.look.gloves }));
      strap.scale.set(1, 1.5, 1);
      strap.position.set(0, 0.47 * hs, 0.09 * bk);
      strap.rotation.x = -0.35;
      torso.add(strap);
      const card = inked(GEO.box, toonMat('#ffffff', { flash: this.flashU }), 0.006);
      card.scale.set(0.07, 0.095, 0.01);
      card.position.set(0, 0.32 * hs, chestFront + 0.04);
      torso.add(card);
    }
    if (acc.includes('pearls')) {
      const pm = toonMat('#fff8f0', { flash: this.flashU });
      const inst = new THREE.InstancedMesh(GEO.sphereLo, pm, 16);
      const m4 = new THREE.Matrix4();
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2;
        m4.makeScale(0.016, 0.016, 0.016);
        m4.setPosition(Math.sin(a) * 0.085 * bk, 0.52 * hs - Math.max(0, Math.cos(a)) * 0.05, Math.cos(a) * 0.08 * bk + 0.02);
        inst.setMatrixAt(i, m4);
      }
      torso.add(inst);
    }
  }

  buildProps() {
    const props = {};
    const mk = (fn) => { const g = new THREE.Group(); fn(g); g.visible = false; return g; };
    props.phone = mk((g) => {
      const b = inked(GEO.box, toonMat('#101014'), 0.006); b.scale.set(0.075, 0.14, 0.012); g.add(b);
      const s = new THREE.Mesh(GEO.box, new THREE.MeshBasicMaterial({ color: '#8fd8ff' })); s.scale.set(0.064, 0.125, 0.004); s.position.z = -0.008; g.add(s);
      g.position.set(0, 0.11, 0.02); g.rotation.x = 0.3;
    });
    props.mug = mk((g) => {
      const c = inked(GEO.cyl, toonMat('#ffffff'), 0.008); c.scale.set(0.05, 0.1, 0.05); g.add(c);
      const h = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.008, 6, 12), toonMat('#ffffff')); h.position.x = 0.055; g.add(h);
      g.position.set(0, 0.12, 0.03);
    });
    props.paper = mk((g) => {
      const p = inked(GEO.box, toonMat('#f7f4ea'), 0.006); p.scale.set(0.2, 0.26, 0.005); g.add(p);
      const stamp = new THREE.Mesh(GEO.box, new THREE.MeshBasicMaterial({ color: '#ff2244' })); stamp.scale.set(0.12, 0.04, 0.004); stamp.position.set(0, 0.05, 0.004); stamp.rotation.z = 0.2; g.add(stamp);
      g.position.set(0, 0.16, 0.08);
    });
    props.cash = mk((g) => {
      for (let i = 0; i < 3; i++) { const b = inked(GEO.box, toonMat('#57c26b'), 0.005); b.scale.set(0.16, 0.07, 0.008); b.position.set(0, 0.1 + i * 0.012, 0.02 * i); b.rotation.z = i * 0.25; g.add(b); }
    });
    for (const k in props) this.limb.R.glove.add(props[k]);
    return props;
  }

  showProp(name) {
    for (const k in this.props) this.props[k].visible = k === name;
  }

  setPose(name, stiff = 170, damp = 17, overrides) {
    const p = this.poses[name] || this.poses.guard;
    this.poseName = name;
    this.springs.set(overrides ? { ...p, ...overrides } : p, stiff, damp);
  }

  // Strike poses reach fast but the sweep axis lags, so hooks arc instead of sliding.
  strikePose(name, kind) {
    this.setPose(name, 900, 36);
    if (kind === 'hook' || kind === 'special') {
      for (const c of ['lx', 'rx']) { this.springs.s[c].stiffness = 520; this.springs.s[c].damping = 30; }
    }
    if (kind === 'upper') {
      for (const c of ['ly', 'ry']) { this.springs.s[c].stiffness = 600; this.springs.s[c].damping = 30; }
    }
  }

  setExpr(e, hold = 0) {
    if (!this.faceTex[e]) e = 'idle';
    this.expr = e;
    this.exprHold = hold;
    this.faceMat.map = this.faceTex[e];
  }

  // side: which way the head gets knocked ('L' = punched by your left glove).
  hit(side, strength = 0.5, body = false) {
    const s = this.springs;
    const k = strength;
    if (body) {
      s.kick('lean', 6 * k); s.kick('squash', 10 * k); s.kick('y', -1.2 * k);
      s.nudge('squash', 0.6 * k); s.nudge('lean', 0.15 * k);
    } else {
      // contact frame: the head is already snapped back when the hit-stop freezes
      const d0 = side === 'L' ? 1 : side === 'R' ? -1 : 0;
      s.nudge('hLean', -0.38 * k); s.nudge('lean', -0.1 * k); s.nudge('z', -0.05 * k);
      s.nudge('hTwist', d0 * 0.42 * k); s.nudge('hTilt', d0 * 0.16 * k);
      this.headSquash = Math.max(this.headSquash, k);
      s.kick('hLean', -14 * k);
      s.kick('lean', -5 * k);
      s.kick('z', -1.5 * k);
      const dir = side === 'L' ? 1 : side === 'R' ? -1 : 0;
      s.kick('hTwist', dir * 16 * k);
      s.kick('twist', dir * 5 * k);
      s.kick('hTilt', dir * 6 * k);
      s.kick('x', dir * 0.8 * k);
    }
    this.flashU.value = Math.max(this.flashU.value, 0.9 * Math.min(1, 0.4 + k));
  }

  blocked(side) {
    const s = this.springs;
    s.kick('z', -0.8); s.kick('lean', -2);
    const dir = side === 'L' ? 1 : -1;
    s.kick('lx', dir * 0.4); s.kick('rx', dir * 0.4);
    s.kick('lz', -1.2); s.kick('rz', -1.2);
  }

  // k: 0..1 through a windup; the telling glove trembles and swells. null when not winding up.
  windup(hand, k) { this.windK = hand ? { hand, k } : null; }

  tell(hand, level, color) {
    const l = this.limb[hand];
    l.tell = level;
    if (color) l.tellColor.set(color);
  }

  launch(vel) {
    this.flying = { v: vel.clone(), spin: -7 - Math.random() * 3, spinZ: (Math.random() - 0.5) * 4, bounced: 0, hitRopes: false };
  }

  reset() {
    this.flying = null;
    this.root.position.set(0, 0, -0.6);
    this.root.rotation.set(0, 0, 0);
    this.springs.snapAll(this.poses.guard);
    this.baseX.snap(0);
    this.setPose('guard');
    this.setExpr('idle');
    this.showProp(null);
    this.tell('L', 0); this.tell('R', 0);
    this.windK = null;
    this.wob.snapAll({ tieX: 0, tieZ: 0, hairX: 0, hairZ: 0, belly: 0 });
    this._prevP = null;
    // a retry gets the jacket and tie back on
    this.shirtMat.color.set(this.look.shirt);
    if (this.shirtFront) this.shirtFront.visible = true;
    this.tieParts?.forEach((m) => { m.visible = true; });
  }

  // Exact world-space bottom of every unit sphere/cylinder/box under its matrix:
  // for x = M·u, min y over the shape is the translation minus the support of row y.
  lowestY() {
    let min = Infinity;
    for (const [o, kind] of this.solids) {
      let v = o;
      while (v && v.visible && v !== this.root) v = v.parent;
      if (v !== this.root) continue;
      const e = o.matrixWorld.elements, ax = Math.abs(e[1]), ay = Math.abs(e[5]), az = Math.abs(e[9]);
      const r = kind === 'sphere' ? Math.hypot(e[1], e[5], e[9])
        : kind === 'cyl' ? Math.hypot(e[1], e[9]) + 0.5 * ay
        : 0.5 * (ax + ay + az);
      min = Math.min(min, e[13] - r);
    }
    return min;
  }

  headWorld(out) { return this.head.getWorldPosition(out); }
  gloveWorld(side, out) { return this.limb[side].glove.getWorldPosition(out); }

  update(dt, t, onRopes, realDt = dt) {
    const s = this.springs;
    s.update(dt);
    this.baseX.update(dt);
    if (this.exprHold > 0) this.exprHold -= dt;

    // blink when idle
    this.blinkT -= dt;
    if (this.blinkT < 0 && this.expr === 'idle') { this.faceMat.map = this.faceTex.blink; }
    if (this.blinkT < -0.1) { this.blinkT = 2 + Math.random() * 3; if (this.expr === 'idle') this.faceMat.map = this.faceTex.idle; }

    this.flashU.value = Math.max(0, this.flashU.value - realDt * 7);

    const hunch = this.look.hunch || 0;
    const bob = Math.sin(t * 5.2) * 0.018 * this.energy;
    const sway = Math.sin(t * 1.7) * 0.03 * this.energy;
    const gBob = Math.sin(t * 5.2 + 0.8) * 0.02 * this.energy;
    const G = (c) => s.get(c);

    // KO flight: simple ballistic body with a floor and the back ropes.
    if (this.flying) {
      const f = this.flying;
      f.v.y -= 9.8 * dt;
      this.root.position.addScaledVector(f.v, dt);
      this.root.rotation.x += f.spin * dt;
      this.root.rotation.z += f.spinZ * dt;
      if (this.root.position.z < -2.1 && !f.hitRopes) {
        f.hitRopes = true; f.v.z *= -0.25; f.v.y = Math.max(f.v.y, 1.2); f.spin *= 0.4;
        onRopes && onRopes(Math.min(1, Math.abs(f.v.z) + 0.6));
      }
    } else this.root.position.y = 0;

    this.body.position.set(G('x') + this.baseX.value + sway * 0.5, 0, G('z'));
    this.body.rotation.x = -G('fall') * 1.42;
    const sq = G('squash');
    this.body.scale.set(1 + sq * 0.09, 1 - sq * 0.15, 1 + sq * 0.09);
    this.hips.position.y = this.hipY + G('y') + bob + G('fall') * 0.02;
    this.torso.rotation.set(G('lean') + hunch, G('twist'), G('tilt'));
    this.head.rotation.set(G('hLean') - hunch * 0.6, G('hTwist'), G('hTilt'));
    const hq = this.headSquash;
    this.head.scale.set(1 + hq * 0.14, 1 - hq * 0.18, 1 + hq * 0.14);
    this.headSquash = Math.max(0, hq - dt * 7);
    this.shadow.position.x = this.body.position.x;
    this.shadow.position.z = this.body.position.z + 0.05 - G('fall') * 0.6;
    this.shadow.scale.set(1 + G('fall') * 0.5, 1 + G('fall') * 1.6, 1);

    this.root.updateMatrixWorld(true);
    const { a, e, g, pole } = this._v;
    const inv = this._inv || (this._inv = new THREE.Matrix4());
    inv.copy(this.root.matrixWorld).invert();
    const bodyM = this.body.matrix;
    const armL = 0.3 * this.hs, foreL = 0.3 * this.hs;

    for (const side of ['L', 'R']) {
      const sg = side === 'L' ? -1 : 1;
      const l = this.limb[side];
      // shoulder in root space
      a.set(sg * this.shoulderX, this.shoulderY, 0);
      this.torso.localToWorld(a).applyMatrix4(inv);
      // glove target is in body space so KO falls carry the arms
      g.set(G(side === 'L' ? 'lx' : 'rx') + sway * 0.3, G(side === 'L' ? 'ly' : 'ry') + bob + gBob * (side === 'L' ? 1 : -1), G(side === 'L' ? 'lz' : 'rz'));
      g.applyMatrix4(bodyM);
      const wk = this.windK && this.windK.hand === side ? this.windK.k * this.windK.k : 0;
      if (wk) g.add(this._v.b.set(Math.sin(t * 63) + Math.sin(t * 97), Math.sin(t * 71 + 1), Math.sin(t * 83 + 2)).multiplyScalar(0.008 * wk));
      l.glove.scale.setScalar(1 + 0.22 * wk);
      // An arm inside the lens shows the inside of its black outline shell: the screen goes dark.
      // If the shoulder→glove line enters a sphere around the camera, stop the glove where it first
      // touches it; the arm then stays on the boss's side of the glove, whatever the player's dodge.
      if (this.keepOut) {
        const c = this.keepOut.getWorldPosition(this._v.c).applyMatrix4(inv);
        const r = 0.36 * this.shape.glove; // glove, cuff and forearm
        const ux = g.x - a.x, uy = g.y - a.y, uz = g.z - a.z;
        const wx = a.x - c.x, wy = a.y - c.y, wz = a.z - c.z;
        const uu = ux * ux + uy * uy + uz * uz, wu = wx * ux + wy * uy + wz * uz;
        const disc = wu * wu - uu * (wx * wx + wy * wy + wz * wz - r * r);
        if (disc > 0) {
          const t0 = (-wu - Math.sqrt(disc)) / uu;
          if (t0 > 0 && t0 < 1) g.set(a.x + ux * t0, a.y + uy * t0, a.z + uz * t0);
        }
      }
      const raise = clamp((g.y - a.y) / 0.5, -1, 1);
      pole.set(sg * 0.85, -1 + Math.max(0, raise) * 1.4, -0.55).normalize();
      solveIK(a, g, armL, foreL, pole, e);
      placeSegment(l.upper, a, e, this.limbR.upper);
      l.elbow.position.copy(e);
      // forearm stops short of the glove centre so the cuff covers the joint
      this._v.b.subVectors(g, e).multiplyScalar(0.82).add(e);
      placeSegment(l.fore, e, this._v.b, this.limbR.fore);
      l.glove.position.copy(g);
      l.glove.lookAt(this._v.b.subVectors(g, e).normalize().add(g).applyMatrix4(this.root.matrixWorld));
      // tell glow
      const gm = l.gloveMat;
      const pulse = l.tell > 0 ? l.tell * (0.75 + 0.25 * Math.sin(t * 40)) : 0;
      if (this.look.goldGloves) gm.emissive.set('#2e1d00').lerp(l.tellColor, pulse);
      else gm.emissive.copy(l.tellColor).multiplyScalar(pulse * 1.4);

      // legs: hip joint to a planted foot
      a.set(sg * 0.1 * this.bk, this.hipY + G('y') + bob - 0.06, 0).applyMatrix4(bodyM);
      g.set(sg * 0.2, 0.07, sg < 0 ? 0.14 : -0.16).applyMatrix4(bodyM);
      if (G('fall') > 0.05) g.y = Math.max(g.y, 0.07);
      pole.set(sg * 0.35, 0, 1).normalize();
      solveIK(a, g, this.legL, this.legL, pole, e);
      placeSegment(l.thigh, a, e, this.limbR.thigh);
      placeSegment(l.shin, e, g, this.limbR.shin);
      l.knee.position.copy(e);
      l.shoe.position.set(g.x, g.y - 0.02, g.z + 0.05);
      l.shoe.rotation.set(this.body.rotation.x, 0, 0);
    }

    // floor contact: lift the whole body until its lowest part rests on the canvas
    this.root.updateMatrixWorld(true);
    const lift = Math.max(0, -this.lowestY());
    this.root.position.y += lift;
    this.shadow.position.y = 0.005 - (this.flying ? 0 : lift);
    const f = this.flying;
    if (f && lift > 0) {
      if (f.v.y < -1.2 && f.bounced < 2) { f.v.y *= -0.35; f.bounced++; } else f.v.y = Math.max(0, f.v.y);
      f.v.x *= 0.6; f.v.z *= 0.6;
      f.spin *= 0.5; f.spinZ *= 0.5;
      // settle flat on the back, via the nearest turn so it doesn't unwind a full spin
      const flat = -Math.PI / 2 + Math.PI * 2 * Math.round((this.root.rotation.x + Math.PI / 2) / (Math.PI * 2));
      this.root.rotation.x += (flat - this.root.rotation.x) * Math.min(1, dt * 6);
      this.root.rotation.z *= 1 - Math.min(1, dt * 5);
    }
    if (lift > 0) this.root.updateMatrixWorld(true);
    this.updateWobble(dt, G('lean') + hunch, G('tilt'));
  }

  // Ties, hair and bellies lag behind the chest: kick their springs with the chest's acceleration.
  updateWobble(dt, lean, tilt) {
    if (dt <= 0) return;
    const w = this.wob, A = this._acc;
    const p = this.torso.localToWorld(this._v.a.set(0, 0.5 * this.hs, 0));
    if (this._prevP) {
      const v = this._v.g.subVectors(p, this._prevP).divideScalar(dt);
      A.subVectors(v, this._prevV).divideScalar(dt).clampLength(0, 80);
      if (this._settled) {
        w.kick('tieX', A.z * dt * 0.9); w.kick('tieZ', -A.x * dt * 0.9);
        w.kick('hairX', A.z * dt * 0.5); w.kick('hairZ', -A.x * dt * 0.5);
        w.kick('belly', -A.y * dt * 0.25);
      }
      this._settled = true;
      this._prevV.copy(v);
    } else { this._prevP = new THREE.Vector3(); this._settled = false; }
    this._prevP.copy(p);
    w.update(dt);
    if (this.tiePivot) {
      // gravity keeps the blade near vertical as the chest leans; it never swings into the shirt
      this.tiePivot.rotation.x = Math.min(-0.1, -0.18 - lean * 0.8 + clamp(w.get('tieX'), -1.2, 1.2));
      this.tiePivot.rotation.z = clamp(w.get('tieZ'), -1, 1) - tilt * 0.8;
    }
    if (this.hair) {
      this.hair.rotation.x = clamp(w.get('hairX') * this.hairAmp, -0.25, 0.25);
      this.hair.rotation.z = clamp(w.get('hairZ') * this.hairAmp, -0.25, 0.25);
    }
    if (this.belly) {
      const b = clamp(w.get('belly'), -0.5, 0.5), base = this.belly.userData.base;
      this.belly.scale.set(base.x * (1 - b * 0.15), base.y * (1 + b * 0.3), base.z * (1 - b * 0.15));
    }
  }

  dispose() {
    this.root.traverse((o) => { if (o.isMesh && o.geometry && !o.geometry.userData.shared) o.geometry.dispose(); });
    for (const k in this.faceTex) this.faceTex[k].dispose();
  }
}
