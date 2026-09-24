// Arena: ring, ropes, lighting rig, crowd, neon signs and atmosphere.
// Units are meters. Ring canvas top at y = 0, the arena floor at y = -1.1.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { toonMat, inked, GEO, latheGeo } from './materials.js';

const RING = 3.5;
const FLOOR_Y = -1.1;
const ROPE_H = [0.5, 0.9, 1.3];
const ROPE_R = 0.024;
const STAND = { d0: 5.4, row: 0.9, rise: 0.5, rows: 9 };
const WALL = 14.3;
const CEIL = 14;
const TRUSS_Y = 6.4;
const TRUSS_HALF = 3.2;
const FONT = 'Impact, Anton, sans-serif';
const DOWN = new THREE.Vector3(0, -1, 0);
const BASE = { key: 75, rim: 70, fill: 0.5, hemi: 0.45 };
// A floor's `theme.light` overrides any of these (DESIGN.md "Light"). Strengths multiply BASE.
const BASE_LIGHT = { key: '#ffe6c8', keyInt: 1, fill: '#b8c4ff', fillInt: 1, hemi: 1, fog: 0.026, haze: 1, exposure: 1, flicker: false };

const DEFAULT_THEME = {
  a: '#ff2e88', b: '#22e5ff', bg: '#0a0512',
  signs: ['SYNERGY', 'WE ARE FAMILY', 'HUSTLE HARDER'],
  floorLabel: 'B1', floorName: 'MAILROOM', logo: 'PUNCH CLOCK',
};

// ---------------------------------------------------------------- helpers

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')];
}

function canvasTex(c, { srgb = true, aniso = 4, repeat = false } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function hexRGB(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const rgba = (hex, a) => `rgba(${hexRGB(hex).join(',')},${a})`;
function mixHex(hex, to, k) {
  const a = hexRGB(hex), b = hexRGB(to);
  return `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * k)).join(',')})`;
}

const lum = (c) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;

// HDR neon colour: a touch of white core, brightest channel = `peak`, luminance capped. Capping
// the peak (rather than normalising luminance) keeps deep pinks from dumping 5x energy into bloom.
function neon(hex, peak) {
  const c = new THREE.Color(hex).lerp(new THREE.Color(1, 1, 1), 0.12);
  c.multiplyScalar(peak / Math.max(c.r, c.g, c.b));
  return c.multiplyScalar(Math.min(1, (peak * 0.65) / lum(c)));
}

// Gain that evens out perceived brightness across palettes (a yellow is ~3x a pink).
const balance = (hex, target, lo, hi) => THREE.MathUtils.clamp(target / Math.max(lum(new THREE.Color(hex)), 0.01), lo, hi);

function rng(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Concatenate geometries that share attribute names into one non-indexed geometry.
function merge(geos) {
  const parts = geos.map((g) => (g.index ? g.toNonIndexed() : g));
  const out = new THREE.BufferGeometry();
  for (const name of Object.keys(parts[0].attributes)) {
    const size = parts[0].attributes[name].itemSize;
    const arr = new Float32Array(parts.reduce((n, p) => n + p.attributes[name].array.length, 0));
    let o = 0;
    for (const p of parts) {
      arr.set(p.attributes[name].array, o);
      o += p.attributes[name].array.length;
    }
    out.setAttribute(name, new THREE.BufferAttribute(arr, size));
  }
  new Set([...geos, ...parts]).forEach((g) => g.dispose());
  return out;
}

// A plane showing the canvas-pixel rect (x0,y0)-(x1,y1) of a W x H atlas.
function atlasQuad(w, h, [x0, y0, x1, y1], W, H) {
  const g = new THREE.PlaneGeometry(w, h);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, (x0 + uv.getX(i) * (x1 - x0)) / W, 1 - (y1 - uv.getY(i) * (y1 - y0)) / H);
  }
  return g;
}

function place(g, [x, y, z], rotY = 0) {
  return g.rotateY(rotY).translate(x, y, z);
}

function shaderMat(opts) {
  return new THREE.ShaderMaterial(opts);
}

// Output chunks keep ShaderMaterials consistent with built-in materials whether
// rendering straight to the canvas or into a linear composer target.
const OUT = '#include <tonemapping_fragment>\n#include <colorspace_fragment>';

// ---------------------------------------------------------------- canvas art

function drawRingMat(t) {
  const S = 1024, P = S / (RING * 2);
  const [c, g] = makeCanvas(S, S);
  g.fillStyle = '#1d1a24';
  g.fillRect(0, 0, S, S);
  const r = rng(11);
  for (let i = 0; i < 6000; i++) {
    g.fillStyle = r() < 0.5 ? `rgba(255,255,255,${0.012 + r() * 0.02})` : `rgba(0,0,0,${0.05 + r() * 0.06})`;
    g.fillRect(r() * S, r() * S, 1 + r() * 4, 1 + r() * 2);
  }
  // Scuffs and the occasional coffee ring.
  g.lineCap = 'round';
  for (let i = 0; i < 70; i++) {
    g.strokeStyle = r() < 0.6 ? `rgba(0,0,0,${0.12 + r() * 0.12})` : `rgba(255,255,255,${0.03 + r() * 0.04})`;
    g.lineWidth = 2 + r() * 9;
    const x = r() * S, y = r() * S, a = r() * Math.PI * 2;
    g.beginPath();
    g.arc(x, y, 20 + r() * 90, a, a + 0.3 + r() * 0.9);
    g.stroke();
  }
  for (let i = 0; i < 5; i++) {
    g.strokeStyle = `rgba(90,55,25,${0.18 + r() * 0.12})`;
    g.lineWidth = 3 + r() * 3;
    g.beginPath();
    g.arc(120 + r() * (S - 240), 120 + r() * (S - 240), 14 + r() * 8, 0, Math.PI * (1.4 + r() * 0.6));
    g.stroke();
  }
  // Clock emblem around the centre.
  g.save();
  g.translate(S / 2, S / 2);
  g.strokeStyle = rgba(t.b, 0.14);
  g.lineWidth = 16;
  g.beginPath();
  g.arc(0, 0, 1.75 * P, 0, Math.PI * 2);
  g.stroke();
  for (let i = 0; i < 12; i++) {
    g.rotate(Math.PI / 6);
    g.fillStyle = rgba(t.b, i % 3 === 2 ? 0.26 : 0.14);
    g.fillRect(-6, -1.55 * P, 12, i % 3 === 2 ? 44 : 24);
  }
  g.restore();
  // Big slanted logo on the far half, where the player's eye lands behind the opponent.
  const ly = S / 2 - 2.15 * P;
  g.save();
  g.translate(S / 2, ly);
  g.transform(1, 0, -0.24, 1, 0, 0);
  let size = 190;
  g.font = `${size}px ${FONT}`;
  const w = g.measureText(t.logo).width;
  if (w > S * 0.78) size *= (S * 0.78) / w;
  g.font = `${size}px ${FONT}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = rgba(t.a, 0.17);
  g.fillText(t.logo, 0, 0);
  g.lineWidth = 5;
  g.strokeStyle = 'rgba(255,255,255,0.13)';
  g.strokeText(t.logo, 0, 0);
  g.font = `${Math.round(size * 0.28)}px ${FONT}`;
  g.fillStyle = 'rgba(255,255,255,0.16)';
  g.fillText(`FLOOR ${t.floorLabel}  —  ${t.floorName}`, 0, size * 0.72);
  g.restore();
  // Border stripe, then corner wedges in the corner colours.
  const inset = 0.1 * P, band = 0.32 * P;
  g.strokeStyle = '#3a3542';
  g.lineWidth = band;
  g.strokeRect(inset + band / 2, inset + band / 2, S - 2 * inset - band, S - 2 * inset - band);
  g.strokeStyle = rgba(t.a, 0.6);
  g.lineWidth = 5;
  const e = inset + band + 10;
  g.strokeRect(e, e, S - 2 * e, S - 2 * e);
  [[0, 0, t.a], [S, 0, t.b], [S, S, t.a], [0, S, t.b]].forEach(([x, y, col]) => {
    g.fillStyle = rgba(col, 0.45);
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + (x ? -1 : 1) * 1.0 * P, y);
    g.lineTo(x, y + (y ? -1 : 1) * 1.0 * P);
    g.fill();
  });
  const v = g.createRadialGradient(S / 2, S / 2, S * 0.2, S / 2, S / 2, S * 0.75);
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(1, 'rgba(0,0,0,0.4)');
  g.fillStyle = v;
  g.fillRect(0, 0, S, S);
  return canvasTex(c, { aniso: 8 });
}

function drawApron(t) {
  const [c, g] = makeCanvas(2048, 320);
  const bg = g.createLinearGradient(0, 0, 0, 320);
  bg.addColorStop(0, '#15111c');
  bg.addColorStop(1, '#07060a');
  g.fillStyle = bg;
  g.fillRect(0, 0, 2048, 320);
  g.fillStyle = t.b;
  g.fillRect(0, 14, 2048, 8);
  g.fillStyle = t.a;
  g.fillRect(0, 296, 2048, 6);
  const text = `PUNCH CLOCK™  •  FLOOR ${t.floorLabel}  •  ${t.floorName}  •  `;
  g.font = `150px ${FONT}`;
  g.textBaseline = 'middle';
  g.fillStyle = t.a;
  g.shadowColor = t.a;
  g.shadowBlur = 24;
  g.save();
  g.transform(1, 0, -0.2, 1, 30, 0);
  const step = g.measureText(text).width;
  for (let x = 10; x < 2100; x += step) g.fillText(text, x, 165);
  g.restore();
  return canvasTex(c);
}

function drawJumbo(t) {
  const [c, g] = makeCanvas(1024, 576);
  g.fillStyle = '#07060b';
  g.fillRect(0, 0, 1024, 576);
  g.strokeStyle = t.b;
  g.lineWidth = 14;
  g.strokeRect(12, 12, 1000, 552);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `64px ${FONT}`;
  g.fillStyle = 'rgba(255,255,255,0.75)';
  g.fillText('NOW FIGHTING ON', 512, 92);
  g.font = `260px ${FONT}`;
  g.shadowColor = t.a;
  g.shadowBlur = 40;
  g.fillStyle = t.a;
  g.fillText(`FLOOR ${t.floorLabel}`, 512, 280);
  g.shadowBlur = 0;
  g.font = `84px ${FONT}`;
  g.fillStyle = '#fff';
  g.fillText(t.floorName, 512, 460);
  g.fillStyle = '#ff2a2a';
  g.beginPath();
  g.arc(64, 64, 14, 0, Math.PI * 2);
  g.fill();
  g.font = `36px ${FONT}`;
  g.textAlign = 'left';
  g.fillText('LIVE', 88, 66);
  for (let y = 0; y < 576; y += 4) {
    g.fillStyle = 'rgba(0,0,0,0.28)';
    g.fillRect(0, y, 1024, 2);
  }
  return canvasTex(c);
}

// Neon atlas: one 512px row per sign, tube-style stroked text with a canvas glow.
function drawNeon(t) {
  const W = 2048, RH = 512;
  const [c, g] = makeCanvas(W, RH * 4);
  const rows = [[t.signs[0], t.a], [t.signs[1] ?? '', t.b], [t.signs[2] ?? '', t.a], [t.logo, t.b]];
  const rects = rows.map(([text, col], i) => {
    let size = 280;
    g.font = `${size}px ${FONT}`;
    let w = g.measureText(text).width;
    if (w > W - 300) {
      size *= (W - 300) / w;
      g.font = `${size}px ${FONT}`;
      w = g.measureText(text).width;
    }
    g.save();
    g.translate(W / 2, i * RH + RH / 2);
    g.transform(1, 0, -0.16, 1, 0, 0);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineJoin = 'round';
    const k = balance(col, 0.45, 0.35, 1);
    const passes = [
      [40, 20, col, 0.28 * k], [16, 12, col, 0.85 * k], [6, 6, mixHex(col, '#ffffff', 0.75), 1],
    ];
    for (const [blur, lw, stroke, alpha] of passes) {
      g.shadowBlur = blur;
      g.shadowColor = col;
      g.strokeStyle = stroke;
      g.globalAlpha = alpha;
      g.lineWidth = lw;
      g.strokeText(text, 0, 0);
    }
    g.restore();
    const hw = w / 2 + 120;
    return { px: [W / 2 - hw, i * RH, W / 2 + hw, (i + 1) * RH], aspect: (2 * hw) / RH };
  });
  return { tex: canvasTex(c), rects, W, H: RH * 4 };
}

const BANNER_WORDS = ['KPI', 'ALIGN', 'PIVOT', 'LEVERAGE', 'Q4 OR DIE', 'OKR'];

function drawBanners(t) {
  const [c, g] = makeCanvas(2048, 2048);
  // Giant motivational banner.
  const gb = g.createLinearGradient(0, 0, 0, 256);
  gb.addColorStop(0, mixHex(t.a, '#000000', 0.55));
  gb.addColorStop(1, mixHex(t.a, '#000000', 0.8));
  g.fillStyle = gb;
  g.fillRect(0, 0, 2048, 256);
  g.fillStyle = '#f4f0ea';
  g.fillRect(0, 10, 2048, 6);
  g.fillRect(0, 240, 2048, 6);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `170px ${FONT}`;
  g.fillText('MORALE IS MANDATORY', 1024, 132);
  g.font = `40px ${FONT}`;
  g.fillStyle = 'rgba(255,255,255,0.7)';
  g.fillText('Q3 ALL-HANDS', 170, 132);
  g.fillText('ATTENDANCE IS TRACKED', 1840, 132);
  // Vertical corporate banners.
  BANNER_WORDS.forEach((word, i) => {
    const x = 16 + i * 338, y = 300, w = 320, h = 1700;
    const col = i % 2 ? t.b : t.a;
    const vg = g.createLinearGradient(0, y, 0, y + h);
    vg.addColorStop(0, mixHex(col, '#000000', 0.5));
    vg.addColorStop(1, mixHex(col, '#000000', 0.85));
    g.fillStyle = vg;
    g.fillRect(x, y, w, h);
    g.fillStyle = col;
    g.fillRect(x, y, w, 56);
    g.fillStyle = '#f4f0ea';
    g.save();
    g.translate(x + w / 2, y + 820);
    g.rotate(-Math.PI / 2);
    let size = 230;
    g.font = `${size}px ${FONT}`;
    const tw = g.measureText(word).width;
    if (tw > 1250) g.font = `${(size *= 1250 / tw)}px ${FONT}`;
    g.fillText(word, 0, 8);
    g.restore();
    // A chart that only goes up.
    g.strokeStyle = '#f4f0ea';
    g.lineWidth = 12;
    g.lineJoin = 'round';
    g.beginPath();
    g.moveTo(x + 60, y + 1560);
    g.lineTo(x + 130, y + 1500);
    g.lineTo(x + 180, y + 1530);
    g.lineTo(x + 260, y + 1420);
    g.stroke();
    g.font = `30px ${FONT}`;
    g.fillStyle = 'rgba(255,255,255,0.6)';
    g.fillText('PUNCH CLOCK INC.', x + w / 2, y + 1640);
  });
  return canvasTex(c, { aniso: 4 });
}

// Crowd atlas: 8 office-worker types x 2 poses (arms down / arms up), 128 x 384 px cells.
// Channels are data, not colour: R = body detail, G = self-lit (phone screens), B = theme accent, A = coverage.
function drawCrowdAtlas() {
  const CW = 128, CH = 384;
  const [c, g] = makeCanvas(CW * 8, CH * 2);
  for (let type = 0; type < 8; type++) {
    for (let pose = 0; pose < 2; pose++) {
      g.save();
      g.translate(type * CW, pose * CH);
      g.beginPath();
      g.rect(5, 5, CW - 10, CH - 10);
      g.clip();
      drawPerson(g, type, pose);
      g.restore();
    }
  }
  return canvasTex(c, { srgb: false, aniso: 2 });
}

function drawPerson(g, type, pose) {
  const col = (r, gg = 0, b = 0) => `rgb(${r},${gg},${b})`;
  const SKIN = col(72), SUIT = col(38), HAIR = col(14), DARK = col(22);
  const cx = 64, sy = 158, hy = 262, wide = type === 3 ? 12 : 0;
  const up = pose === 1;
  const ellipse = (x, y, rx, ry, fill) => {
    g.fillStyle = fill;
    g.beginPath();
    g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
    g.fill();
  };
  const arm = (side, hx, hyy, ex, ey) => {
    const shx = cx + side * (30 + wide);
    g.strokeStyle = type === 7 ? col(34) : SUIT;
    g.lineWidth = 17;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(shx, sy + 2);
    g.quadraticCurveTo(ex, ey, hx, hyy);
    g.stroke();
    ellipse(hx, hyy, 8, 8, SKIN);
  };
  const phone = (x, y) => {
    g.fillStyle = col(8);
    g.fillRect(x - 8, y - 14, 16, 26);
    g.fillStyle = col(0, 255, 0);
    g.fillRect(x - 6, y - 12, 12, 20);
  };
  const armsDefault = (side) => (up ? arm(side, cx + side * 44, 44, cx + side * 52, 104) : arm(side, cx + side * (36 + wide), hy + 6, cx + side * (46 + wide), 212));

  // Hair or hood that sits behind the head.
  if (type === 1) {
    g.fillStyle = HAIR;
    g.beginPath();
    g.roundRect(cx - 26, 92, 52, 84, 18);
    g.fill();
  }
  if (type === 4) ellipse(cx, 104, 31, 30, HAIR);
  if (type === 7) ellipse(cx, 124, 30, 32, col(34));

  // Legs and torso.
  g.fillStyle = DARK;
  g.fillRect(cx - 22, hy - 4, 19, 384 - hy + 4);
  g.fillRect(cx + 3, hy - 4, 19, 384 - hy + 4);
  g.fillStyle = type === 7 ? col(34) : SUIT;
  g.beginPath();
  g.moveTo(cx - 40 - wide, sy + 8);
  g.quadraticCurveTo(cx - 42 - wide, sy - 6, cx - 24, sy - 8);
  g.lineTo(cx + 24, sy - 8);
  g.quadraticCurveTo(cx + 42 + wide, sy - 6, cx + 40 + wide, sy + 8);
  g.lineTo(cx + 30 + wide * 0.8, hy);
  g.lineTo(cx - 30 - wide * 0.8, hy);
  g.closePath();
  g.fill();
  if (type !== 7) {
    g.fillStyle = col(125);
    g.beginPath();
    g.moveTo(cx - 13, sy - 8);
    g.lineTo(cx + 13, sy - 8);
    g.lineTo(cx, sy + 46);
    g.fill();
  }
  if (type === 0 || type === 2 || type === 3) {
    g.fillStyle = col(18, 0, type === 2 ? 0 : 190);
    g.beginPath();
    g.moveTo(cx - 5, sy - 6);
    g.lineTo(cx + 5, sy - 6);
    g.lineTo(cx + 7, sy + 50);
    g.lineTo(cx, sy + 60);
    g.lineTo(cx - 7, sy + 50);
    g.fill();
  }
  if (type === 1 || type === 7) {
    g.strokeStyle = col(20, 0, 210);
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(cx - 11, sy - 6);
    g.lineTo(cx, sy + 44);
    g.lineTo(cx + 11, sy - 6);
    g.stroke();
    g.fillStyle = col(150, 20, 0);
    g.fillRect(cx - 9, sy + 42, 18, 22);
  }

  // Neck, head, hair.
  g.fillStyle = SKIN;
  g.fillRect(cx - 8, sy - 26, 16, 22);
  ellipse(cx, 112, 20, 25, SKIN);
  if (type === 0) ellipse(cx, 97, 21, 13, HAIR);
  if (type === 1) ellipse(cx, 96, 22, 12, HAIR);
  if (type === 2) {
    g.fillStyle = HAIR;
    g.beginPath();
    g.moveTo(cx - 21, 104);
    for (let i = 0; i <= 6; i++) g.lineTo(cx - 21 + i * 7, i % 2 ? 78 : 94);
    g.lineTo(cx + 21, 104);
    g.fill();
  }
  if (type === 3) {
    g.fillStyle = col(10, 50, 0);
    g.fillRect(cx - 16, 106, 13, 7);
    g.fillRect(cx + 3, 106, 13, 7);
  }
  if (type === 4) ellipse(cx, 94, 22, 12, HAIR);
  if (type === 5) {
    ellipse(cx, 97, 21, 13, HAIR);
    ellipse(cx + 22, 104, 8, 18, HAIR);
  }
  if (type === 6) {
    ellipse(cx, 97, 21, 13, HAIR);
    ellipse(cx, 78, 12, 11, HAIR);
  }
  if (type === 7) {
    ellipse(cx, 96, 22, 12, HAIR);
    g.fillStyle = HAIR;
    g.fillRect(cx - 2, 98, 30, 7);
  }

  // Arms and props.
  if (type === 2) {
    armsDefault(-1);
    const [px, py] = up ? [cx + 36, 36] : [cx + 30, 66];
    arm(1, px, py + 10, cx + 48, up ? 100 : 120);
    phone(px, py);
  } else if (type === 4) {
    const top = up ? 12 : 26;
    arm(-1, cx - 38, top + 56, cx - 50, 130);
    arm(1, cx + 38, top + 56, cx + 50, 130);
    g.fillStyle = col(195);
    g.fillRect(cx - 54, top, 108, 56);
    g.fillStyle = col(0, 0, 255);
    g.font = `bold 46px ${FONT}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('HR', cx, top + 30);
  } else if (type === 5) {
    armsDefault(-1);
    const [hx, hyy] = up ? [cx + 36, 84] : [cx + 34, 118];
    arm(1, hx, hyy, cx + 52, up ? 124 : 150);
    g.fillStyle = col(0, 0, 235);
    g.beginPath();
    g.roundRect(hx - 15, hyy - 34, 30, 38, 8);
    g.roundRect(hx - 7, hyy - 70, 14, 42, 7);
    g.fill();
  } else if (type === 6) {
    const [px, py] = up ? [cx + 6, 38] : [cx + 2, 128];
    arm(-1, px - 8, py + 8, cx - 44, up ? 96 : 190);
    arm(1, px + 8, py + 8, cx + 44, up ? 96 : 190);
    phone(px, py);
  } else if (type === 7 && !up) {
    arm(-1, cx - 22, hy - 10, cx - 44, 214);
    arm(1, cx + 22, hy - 10, cx + 44, 214);
  } else {
    armsDefault(-1);
    armsDefault(1);
  }
}

// ---------------------------------------------------------------- shaders

const ROPE_VS = /* glsl */ `
uniform float uDisp, uTime, uPhase;
varying float vCore;
void main() {
  vec3 p = position;
  float s = p.x / ${RING.toFixed(1)};
  float bend = 1.0 - s * s;
  float ripple = sin(s * 9.42 - uTime * 22.0 + uPhase) * 0.14 * abs(uDisp);
  p.z -= (uDisp + ripple) * bend;
  p.y -= abs(uDisp) * 0.2 * bend;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vCore = abs(dot(normalize(normalMatrix * normal), normalize(-mv.xyz)));
  gl_Position = projectionMatrix * mv;
}`;

// Only the centre of the tube is hot, so the rope reads round and blooms as a thin core.
const ROPE_FS = /* glsl */ `
uniform vec3 uColor;
uniform float uBoost;
varying float vCore;
void main() {
  gl_FragColor = vec4(uColor * uBoost * (0.25 + 0.75 * pow(vCore, 4.0)), 1.0);
  ${OUT}
}`;

const CROWD_VS = /* glsl */ `
attribute vec3 aOffset;
attribute vec4 aData; // type, phase, scale, variant
uniform float uTime, uBeat, uHype, uCheer;
uniform vec4 uSweep[2];
varying vec2 vUv;
varying float vVar, vPhase, vLit, vNear;
#include <fog_pars_vertex>
void main() {
  float ph = aData.y, sc = aData.z;
  vVar = aData.w;
  vPhase = ph;
  // Each person raises their arms on their own slow cycle; hype and cheers make it common.
  float s = 0.5 + 0.5 * sin(uTime * (0.7 + ph * 0.9) + ph * 40.0);
  float pose = step(1.0 - clamp(0.06 + uHype * 0.4 + uCheer * 0.85, 0.0, 0.97), s);
  vUv = vec2((aData.x + uv.x) / 8.0, (1.0 - pose) * 0.5 + uv.y * 0.5);
  float jump = abs(sin(uBeat + ph * 6.2832)) * (0.02 + uHype * 0.08 + uCheer * 0.3 * (0.6 + 0.4 * vVar));
  vec3 foot = (modelMatrix * vec4(aOffset + vec3(0.0, jump, 0.0), 1.0)).xyz;
  // Cylindrical billboard: stays upright, turns about Y to face the camera.
  vec3 toCam = cameraPosition - foot;
  vec3 right = normalize(vec3(toCam.z, 0.0, -toCam.x));
  float sway = sin(uBeat * 0.5 + ph * 12.0) * 0.05 * (0.3 + uHype) * uv.y;
  vec3 pos = foot + right * ((uv.x - 0.5) * 0.653 * sc + sway) + vec3(0.0, uv.y * 1.96 * sc, 0.0);
  vLit = 0.0;
  for (int i = 0; i < 2; i++) vLit += uSweep[i].w * smoothstep(2.8, 0.6, distance(foot.xz, uSweep[i].xz));
  vNear = smoothstep(13.0, 6.0, length(foot.xz));
  vec4 mvPosition = viewMatrix * vec4(pos, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const CROWD_FS = /* glsl */ `
uniform sampler2D uAtlas;
uniform vec3 uColA, uColB;
uniform float uLight, uTime;
varying vec2 vUv;
varying float vVar, vPhase, vLit, vNear;
#include <fog_pars_fragment>
void main() {
  vec4 t = texture2D(uAtlas, vUv);
  if (t.a < 0.5) discard;
  // Rim: coverage missing a few texels to the left/right/top means we're on an edge.
  vec2 px = vec2(2.5 / 1024.0, 2.5 / 768.0);
  float eL = 1.0 - texture2D(uAtlas, vUv - vec2(px.x, 0.0)).a;
  float eR = 1.0 - texture2D(uAtlas, vUv + vec2(px.x, 0.0)).a;
  float eU = 1.0 - texture2D(uAtlas, vUv + vec2(0.0, px.y)).a;
  vec3 tint = mix(vec3(0.55, 0.5, 0.65), mix(uColA, uColB, vVar), 0.4);
  vec3 col = tint * (0.004 + t.r * 0.06) * uLight * (0.7 + 0.9 * vNear);
  vec3 rim = uColA * eL + uColB * eR + mix(uColA, uColB, 0.5) * eU * 0.7;
  col += rim * (0.3 + 0.4 * vNear) * uLight;
  col += vec3(1.0, 0.95, 0.88) * vLit * (0.1 + t.r * 1.2 + (eL + eR + eU) * 0.9);
  col += vec3(0.7, 0.85, 1.0) * t.g * (1.1 + 0.4 * sin(uTime * 7.0 + vPhase * 30.0));
  col += uColA * t.b * (0.08 + 0.14 * uLight);
  gl_FragColor = vec4(col, 1.0);
  ${OUT}
  #include <fog_fragment>
}`;

const FLASH_VS = /* glsl */ `
attribute float aBirth;
attribute float aSize;
uniform float uTime, uPx;
varying float vI;
void main() {
  float age = uTime - aBirth;
  float alive = step(0.0, age) * step(age, 0.45);
  vI = alive * exp(-age * 9.0);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = alive * clamp(aSize * uPx / -mv.z * (0.6 + 0.8 * exp(-age * 20.0)), 0.0, 36.0);
}`;

const FLASH_FS = /* glsl */ `
varying float vI;
void main() {
  vec2 p = gl_PointCoord - 0.5;
  float d2 = dot(p, p);
  float star = max(0.0, 1.0 - abs(p.x) * 20.0) * max(0.0, 1.0 - abs(p.y) * 2.2)
             + max(0.0, 1.0 - abs(p.y) * 20.0) * max(0.0, 1.0 - abs(p.x) * 2.2);
  float a = (exp(-d2 * 90.0) * 1.6 + exp(-d2 * 14.0) * 0.15 + star * 0.8) * vI;
  gl_FragColor = vec4(vec3(0.85, 0.92, 1.0) * a * 1.2, 1.0);
  ${OUT}
}`;

const DUST_VS = /* glsl */ `
attribute float aSeed;
uniform float uTime, uPx;
varying float vA;
void main() {
  vec3 p = position + vec3(sin(uTime * 0.13 + aSeed * 6.2), sin(uTime * 0.09 + aSeed * 9.1) * 1.4, cos(uTime * 0.11 + aSeed * 4.3)) * 0.28;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = clamp(0.022 * uPx / -mv.z, 1.0, 5.0);
  vA = (0.5 + 0.5 * sin(uTime * (0.8 + aSeed) + aSeed * 40.0)) * smoothstep(0.6, 2.5, -mv.z);
}`;

const DUST_FS = /* glsl */ `
uniform float uLevel;
varying float vA;
void main() {
  float d = length(gl_PointCoord - 0.5);
  gl_FragColor = vec4(vec3(1.0, 0.93, 0.8) * smoothstep(0.5, 0.0, d) * vA * uLevel * 0.55, 1.0);
  ${OUT}
}`;

const CONE_VS = /* glsl */ `
attribute vec3 aMix; // weights for colour A, colour B, white
varying float vAlong;
varying vec3 vN, vV, vW, vMix;
void main() {
  vAlong = uv.y; // 1 at the lamp, 0 at the far end
  vMix = aMix;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  vec4 mv = viewMatrix * w;
  vN = normalize(normalMatrix * normal);
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;

const CONE_FS = /* glsl */ `
uniform vec3 uColA, uColB, uWhite;
uniform float uIntensity, uTime;
varying float vAlong;
varying vec3 vN, vV, vW, vMix;
void main() {
  float edge = pow(abs(dot(normalize(vN), normalize(vV))), 2.4);
  float along = clamp(vAlong, 0.0, 1.0);
  float fall = (0.2 + 0.8 * pow(along, 1.5)) * smoothstep(0.0, 0.14, along);
  float dust = 0.78 + 0.22 * sin(vW.y * 2.3 + uTime * 0.7 + sin(vW.x * 1.7 + vW.z * 1.3 + uTime * 0.3) * 2.0);
  vec3 c = uColA * vMix.x + uColB * vMix.y + uWhite * vMix.z;
  gl_FragColor = vec4(c * edge * fall * dust * uIntensity, 1.0);
  ${OUT}
}`;

const HAZE_VS = /* glsl */ `
varying vec3 vW;
varying float vDist;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  vec4 mv = viewMatrix * w;
  vDist = -mv.z;
  gl_Position = projectionMatrix * mv;
}`;

const HAZE_FS = /* glsl */ `
uniform vec3 uColor;
uniform float uTime, uLevel;
varying vec3 vW;
varying float vDist;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; }
  return v;
}
void main() {
  vec2 p = vW.xz;
  float n = smoothstep(0.25, 0.85, fbm(p * 0.32 + vec2(uTime * 0.05, -uTime * 0.03) + vW.y * 4.0));
  float box = max(abs(p.x), abs(p.y));
  float m = vW.y > -0.5
    ? smoothstep(4.0, 1.2, box)
    : smoothstep(17.0, 7.0, length(p)) * smoothstep(3.4, 4.6, box);
  gl_FragColor = vec4(uColor * n * m * smoothstep(0.8, 3.5, vDist) * uLevel, 1.0);
  ${OUT}
}`;

const WALL_VS = /* glsl */ `
varying vec3 vW, vN;
#include <fog_pars_vertex>
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  vN = normal;
  vec4 mvPosition = viewMatrix * w;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const WALL_FS = /* glsl */ `
uniform vec3 uColA, uColB;
uniform float uLight;
varying vec3 vW, vN;
#include <fog_pars_fragment>
void main() {
  float along = abs(vN.x) > 0.5 ? vW.z : vW.x;
  vec3 col = vec3(0.018, 0.016, 0.024);
  vec2 f = abs(fract(vec2(along / 2.4, vW.y / 1.8)) - 0.5);
  col *= 1.0 - 0.55 * smoothstep(0.485, 0.5, max(f.x, f.y));
  // Uplight washes rising from behind the top row of the stands, alternating theme colours.
  float cell = floor(along / 4.0 + 0.5);
  float fx = along / 4.0 - cell;
  float h = vW.y - 3.4;
  float wash = exp(-fx * fx * 40.0 / (1.0 + max(h, 0.0) * 0.4)) * exp(-max(h, 0.0) * 0.3) * smoothstep(-0.3, 0.8, h);
  col += (mod(cell, 2.0) < 1.0 ? uColA : uColB) * wash * 0.09 * uLight;
  if (vN.y < -0.5) col = vec3(0.008, 0.007, 0.012);
  gl_FragColor = vec4(col, 1.0);
  ${OUT}
  #include <fog_fragment>
}`;

const NEON_VS = /* glsl */ `
attribute float aSign;
uniform vec4 uLevels;
varying vec2 vUv;
varying float vI;
void main() {
  vUv = uv;
  vI = dot(uLevels, vec4(equal(vec4(aSign), vec4(0.0, 1.0, 2.0, 3.0))));
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const NEON_FS = /* glsl */ `
uniform sampler2D uMap;
uniform float uBoost;
varying vec2 vUv;
varying float vI;
void main() {
  vec4 t = texture2D(uMap, vUv);
  gl_FragColor = vec4(t.rgb * vI * uBoost, t.a);
  ${OUT}
}`;

// ---------------------------------------------------------------- builders

function buildLights(group) {
  const key = new THREE.SpotLight(0xffe6c8, BASE.key, 0, 0.5, 0.55, 2);
  key.position.set(0, 7.4, 2.6);
  key.target.position.set(0, 1.2, -0.6);
  const rim = (x) => {
    const l = new THREE.SpotLight(0xffffff, BASE.rim, 0, 0.75, 0.5, 2);
    l.position.set(x, 2.8, -3);
    l.target.position.set(0, 1.3, -0.6);
    return l;
  };
  const rimA = rim(-2.5), rimB = rim(2.5);
  const fill = new THREE.DirectionalLight(0xb8c4ff, BASE.fill);
  fill.position.set(0, 2.5, 6);
  fill.target.position.set(0, 1.2, -0.6);
  const hemi = new THREE.HemisphereLight(0x8070a0, 0x000000, BASE.hemi);
  for (const l of [key, rimA, rimB, fill]) group.add(l, l.target);
  group.add(hemi);
  return { key, rimA, rimB, fill, hemi };
}

function buildRing(group) {
  const matMat = new THREE.MeshStandardMaterial({ roughness: 0.82, metalness: 0 });
  const mat = new THREE.Mesh(new THREE.PlaneGeometry(RING * 2, RING * 2), matMat);
  mat.rotation.x = -Math.PI / 2;

  const sides = [], trim = [], lines = [], posts = [];
  for (let i = 0; i < 4; i++) {
    const r = (i * Math.PI) / 2;
    sides.push(new THREE.PlaneGeometry(RING * 2, -FLOOR_Y).translate(0, FLOOR_Y / 2, RING).rotateY(r));
    trim.push(new THREE.BoxGeometry(RING * 2 + 0.1, 0.05, 0.04).translate(0, -0.04, RING + 0.02).rotateY(r));
    lines.push(new THREE.BoxGeometry(9.06, 0.02, 0.06).translate(0, FLOOR_Y + 0.01, 4.5).rotateY(r));
  }
  const skirtMat = new THREE.MeshBasicMaterial();
  const trimMat = new THREE.MeshBasicMaterial({ fog: false });
  const lineMat = new THREE.MeshBasicMaterial();
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(WALL * 2, WALL * 2).rotateX(-Math.PI / 2).translate(0, FLOOR_Y, 0),
    new THREE.MeshStandardMaterial({ color: 0x0c0b10, roughness: 0.4 }),
  );

  const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  corners.forEach(([x, z]) => posts.push(new THREE.CylinderGeometry(0.05, 0.06, 1.64, 10).translate(x * RING, 0.82, z * RING)));
  const pads = new THREE.InstancedMesh(new RoundedBoxGeometry(0.3, 1.12, 0.3, 2, 0.08), new THREE.MeshStandardMaterial({ roughness: 0.5 }), 4);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 4);
  corners.forEach(([x, z], i) => pads.setMatrixAt(i, m.compose(new THREE.Vector3(x * RING, 0.9, z * RING), q, new THREE.Vector3(1, 1, 1))));

  group.add(
    mat, floor, pads,
    new THREE.Mesh(merge(sides), skirtMat),
    new THREE.Mesh(merge(trim), trimMat),
    new THREE.Mesh(merge(lines), lineMat),
    new THREE.Mesh(merge(posts), new THREE.MeshStandardMaterial({ color: 0xb0b0c0, metalness: 0.3, roughness: 0.35 })),
  );

  const padCol = new THREE.Color();
  return {
    applyTheme(t) {
      matMat.map?.dispose();
      matMat.map = drawRingMat(t);
      matMat.needsUpdate = true;
      skirtMat.map?.dispose();
      skirtMat.map = drawApron(t);
      skirtMat.color.setScalar(1.6);
      skirtMat.needsUpdate = true;
      trimMat.color.copy(neon(t.a, 1.6));
      lineMat.color.copy(neon(t.b, 0.9));
      // Diagonal corners share a colour, like red/blue corners.
      corners.forEach((_, i) => pads.setColorAt(i, padCol.set(i % 2 ? t.b : t.a).multiplyScalar(0.85)));
      pads.instanceColor.needsUpdate = true;
    },
    setLevel(k) {
      skirtMat.color.setScalar(1.6 * k);
    },
  };
}

function buildRopes(group, U) {
  const staticMats = [], backMats = [], springs = [];
  const ropeMat = (phase) => shaderMat({
    uniforms: { uColor: { value: new THREE.Color() }, uBoost: { value: 1 }, uDisp: { value: 0 }, uPhase: { value: phase }, uTime: U.uTime },
    vertexShader: ROPE_VS,
    fragmentShader: ROPE_FS,
  });
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const tube = (a, b, segs) => new THREE.TubeGeometry(new THREE.LineCurve3(a, b), segs, ROPE_R, 8, false);
  ROPE_H.forEach((h, i) => {
    const sm = ropeMat(0);
    group.add(new THREE.Mesh(merge([
      tube(V(-RING, h, RING), V(RING, h, RING), 1),
      tube(V(-RING, h, -RING), V(-RING, h, RING), 1),
      tube(V(RING, h, -RING), V(RING, h, RING), 1),
    ]), sm));
    staticMats.push(sm);
    // The back rope is straight in the buffer and bent in the vertex shader, so a hit costs a uniform write.
    const bm = ropeMat(i * 1.7);
    const back = new THREE.Mesh(tube(V(-RING, 0, 0), V(RING, 0, 0), 48), bm);
    back.position.set(0, h, -RING);
    back.frustumCulled = false;
    group.add(back);
    backMats.push(bm);
    springs.push({ x: 0, v: 0, k: 70 + i * 16, c: 4.2, w: [0.75, 1, 0.8][i] });
  });

  let glow = 0;
  const cols = [];
  return {
    applyTheme(t) {
      // Bottom rope B, middle white, top A.
      cols.splice(0, 3, neon(t.b, 1.7), new THREE.Color(1.1, 1.05, 1.15), neon(t.a, 1.7));
      [...backMats, ...staticMats].forEach((m, i) => m.uniforms.uColor.value.copy(cols[i % 3]));
    },
    hit(s) {
      springs.forEach((sp) => (sp.v += s * 3.4 * sp.w));
      glow = Math.min(1.6, glow + s);
    },
    update(dt, level) {
      glow *= Math.exp(-dt * 2.4);
      springs.forEach((sp, i) => {
        for (let n = 0; n < 2; n++) {
          sp.v += (-sp.k * sp.x - sp.c * sp.v) * (dt / 2);
          sp.x += sp.v * (dt / 2);
        }
        backMats[i].uniforms.uDisp.value = sp.x;
        backMats[i].uniforms.uBoost.value = level * (1 + glow * 1.6 + Math.abs(sp.x) * 3);
        staticMats[i].uniforms.uBoost.value = level;
      });
    },
  };
}

function buildStands(group, U) {
  const r = rng(7);
  const blocks = [], strips = [], people = [];
  const density = [1, 0.85, 0.45, 0.85]; // back, left, front (behind the player), right
  const { d0, row: R, rise, rows } = STAND;
  for (let side = 0; side < 4; side++) {
    const ang = (side * Math.PI) / 2, cs = Math.cos(ang), sn = Math.sin(ang);
    for (let row = 0; row < rows; row++) {
      const d = d0 + row * R, top = FLOOR_Y + rise * (row + 1);
      // Rows are pinwheeled (x from -(d+R) to d) so four rotated copies tile the corners without overlap.
      blocks.push(new THREE.BoxGeometry(2 * d + R, top - FLOOR_Y, R).translate(-R / 2, (top + FLOOR_Y) / 2, -(d + R / 2)).rotateY(ang));
      for (let x = -(d + R) + 0.35; x < d - 0.2; x += (0.56 / density[side]) * (0.85 + r() * 0.3)) {
        if (Math.abs(Math.abs(x) - 6.4) < 0.45 || r() < 0.1) continue;
        const lx = x + (r() - 0.5) * 0.12, lz = -(d + R * 0.5 + (r() - 0.5) * 0.25);
        people.push([lx * cs + lz * sn, top, -lx * sn + lz * cs, side]);
      }
    }
    blocks.push(new THREE.BoxGeometry(2 * d0, 1.0, 0.12).translate(0, FLOOR_Y + 0.5, -(d0 - 0.06)).rotateY(ang));
    strips.push(new THREE.BoxGeometry(2 * d0, 0.035, 0.05).translate(0, FLOOR_Y + 1.0, -(d0 - 0.13)).rotateY(ang));
  }
  const stripMat = new THREE.MeshBasicMaterial();
  group.add(
    new THREE.Mesh(merge(blocks), new THREE.MeshStandardMaterial({ color: 0x17141e, roughness: 0.9 })),
    new THREE.Mesh(merge(strips), stripMat),
  );

  // Crowd: one instanced draw of camera-facing quads.
  const N = people.length;
  const base = new THREE.PlaneGeometry(1, 1).translate(0.5, 0.5, 0);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = base.index;
  geo.setAttribute('position', base.attributes.position);
  geo.setAttribute('uv', base.attributes.uv);
  const offsets = new Float32Array(N * 3), data = new Float32Array(N * 4);
  const weights = [3, 3, 2.2, 1.6, 0.6, 0.8, 2.2, 2];
  const wsum = weights.reduce((a, b) => a + b);
  people.forEach(([x, y, z], i) => {
    let pick = r() * wsum, type = 0;
    while ((pick -= weights[type]) > 0) type++;
    offsets.set([x, y, z], i * 3);
    data.set([type, r(), 0.9 + r() * 0.2, r()], i * 4);
  });
  geo.setAttribute('aOffset', new THREE.InstancedBufferAttribute(offsets, 3));
  geo.setAttribute('aData', new THREE.InstancedBufferAttribute(data, 4));
  geo.instanceCount = N;
  const sweep = [new THREE.Vector4(), new THREE.Vector4()];
  const crowdMat = shaderMat({
    uniforms: {
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
      uAtlas: { value: drawCrowdAtlas() },
      uSweep: { value: sweep },
      uTime: U.uTime, uBeat: U.uBeat, uHype: U.uHype, uCheer: U.uCheer, uLight: U.uLight, uColA: U.uColA, uColB: U.uColB,
    },
    vertexShader: CROWD_VS,
    fragmentShader: CROWD_FS,
    fog: true,
  });
  const crowd = new THREE.Mesh(geo, crowdMat);
  crowd.frustumCulled = false;
  group.add(crowd);

  // Phone flashes: a ring buffer of points, each alive for 0.45 s after its birth time.
  const F = 96;
  const fGeo = new THREE.BufferGeometry();
  const fPos = new THREE.BufferAttribute(new Float32Array(F * 3), 3);
  const fBirth = new THREE.BufferAttribute(new Float32Array(F).fill(-100), 1);
  const fSize = new THREE.BufferAttribute(new Float32Array(F), 1);
  fGeo.setAttribute('position', fPos);
  fGeo.setAttribute('aBirth', fBirth);
  fGeo.setAttribute('aSize', fSize);
  const fMat = shaderMat({
    uniforms: { uTime: U.uTime, uPx: U.uPx },
    vertexShader: FLASH_VS,
    fragmentShader: FLASH_FS,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const flashPts = new THREE.Points(fGeo, fMat);
  flashPts.frustumCulled = false;
  group.add(flashPts);
  // Flashes mostly come from the stands the player can see.
  const visible = people.map((p, i) => (p[3] !== 2 ? i : -1)).filter((i) => i >= 0);
  let cursor = 0;

  return {
    sweep,
    applyTheme(t) {
      stripMat.color.copy(neon(t.a, 0.35));
    },
    spawnFlash(birth) {
      const i = Math.random() < 0.9 ? visible[(Math.random() * visible.length) | 0] : (Math.random() * N) | 0;
      const s = data[i * 4 + 2];
      fPos.setXYZ(cursor, offsets[i * 3] + (Math.random() - 0.5) * 0.3, offsets[i * 3 + 1] + 1.75 * s, offsets[i * 3 + 2]);
      fBirth.setX(cursor, birth);
      fSize.setX(cursor, 0.14 + Math.random() * 0.14);
      cursor = (cursor + 1) % F;
      fPos.needsUpdate = fBirth.needsUpdate = fSize.needsUpdate = true;
    },
  };
}

function buildRoom(group, U) {
  const H = CEIL - FLOOR_Y;
  const parts = [];
  for (let i = 0; i < 4; i++) parts.push(new THREE.PlaneGeometry(WALL * 2, H).translate(0, FLOOR_Y + H / 2, -WALL).rotateY((i * Math.PI) / 2));
  parts.push(new THREE.PlaneGeometry(WALL * 2, WALL * 2).rotateX(Math.PI / 2).translate(0, CEIL, 0));
  group.add(new THREE.Mesh(merge(parts), shaderMat({
    uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), uColA: U.uColA, uColB: U.uColB, uLight: U.uLight },
    vertexShader: WALL_VS,
    fragmentShader: WALL_FS,
    fog: true,
  })));

  // Neon signs: one atlas, one draw; per-sign flicker comes in through a vec4 uniform.
  const neonMat = shaderMat({
    uniforms: { uMap: { value: null }, uLevels: { value: new THREE.Vector4(1, 1, 1, 1) }, uBoost: { value: 1.8 } },
    vertexShader: NEON_VS,
    fragmentShader: NEON_FS,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const neonMesh = new THREE.Mesh(new THREE.BufferGeometry(), neonMat);
  const slots = [
    { sign: 0, pos: [0, 7.3, -WALL + 0.06], rot: 0, h: 3.3, maxW: 11.5 },
    { sign: 1, pos: [-9.9, 6.8, -WALL + 0.06], rot: 0, h: 2.1, maxW: 7.2 },
    { sign: 2, pos: [9.9, 6.8, -WALL + 0.06], rot: 0, h: 2.1, maxW: 7.2 },
    { sign: 3, pos: [-WALL + 0.06, 7.2, -2.2], rot: Math.PI / 2, h: 2.6, maxW: 9 },
    { sign: 3, pos: [WALL - 0.06, 7.2, -2.2], rot: -Math.PI / 2, h: 2.6, maxW: 9 },
  ];
  group.add(neonMesh);

  // Banners: giant back-wall banner plus six vertical ones on the side walls.
  const bannerMat = new THREE.MeshBasicMaterial({ color: 0xcccccc });
  const bq = [place(atlasQuad(18, 2.25, [0, 0, 2048, 256], 2048, 2048), [0, 10.7, -WALL + 0.08])];
  [-10.5, -6.6, 4].forEach((z, i) => {
    for (const s of [-1, 1]) {
      const k = (i * 2 + (s > 0 ? 1 : 0)) % 6;
      bq.push(place(atlasQuad(1.1, 5.84, [16 + k * 338, 300, 336 + k * 338, 2000], 2048, 2048), [s * (WALL - 0.08), 8.1, z], -s * Math.PI / 2));
    }
  });
  group.add(new THREE.Mesh(merge(bq), bannerMat));

  const flick = [0, 0, 0, 0], held = [1, 1, 1, 1];
  let hold = 0;
  return {
    applyTheme(t) {
      const n = drawNeon(t);
      neonMat.uniforms.uMap.value?.dispose();
      neonMat.uniforms.uMap.value = n.tex;
      const quads = slots.map(({ sign, pos, rot, h, maxW }) => {
        const { px, aspect } = n.rects[sign];
        const hh = Math.min(h, maxW / aspect);
        const q = place(atlasQuad(hh * aspect, hh, px, n.W, n.H), pos, rot);
        q.setAttribute('aSign', new THREE.BufferAttribute(new Float32Array(q.attributes.position.count).fill(sign), 1));
        return q;
      });
      neonMesh.geometry.dispose();
      neonMesh.geometry = merge(quads);
      bannerMat.map?.dispose();
      bannerMat.map = drawBanners(t);
      bannerMat.needsUpdate = true;
    },
    update(dt, bk) {
      // Random neon hiccups; during a blackout every sign sputters around 15%.
      hold -= dt;
      const resample = hold <= 0;
      if (resample) hold = 0.045;
      for (let i = 0; i < 4; i++) {
        flick[i] -= dt;
        if (flick[i] <= 0 && Math.random() < dt * 0.06) flick[i] = 0.2 + Math.random() * 0.7;
        if (resample) held[i] = flick[i] > 0 ? (Math.random() < 0.5 ? 0.12 : 1) : 1;
        const out = bk > 0.02 ? (resample && Math.random() < 0.12 ? 0.5 : 0.15) : 1;
        neonMat.uniforms.uLevels.value.setComponent(i, held[i] * THREE.MathUtils.lerp(1, out, bk));
      }
      bannerMat.color.setScalar(0.8 * (1 - 0.75 * bk));
    },
  };
}

function coneGeometry(src, dst, half, mix) {
  const dir = dst.clone().sub(src);
  const L = dir.length();
  const g = new THREE.CylinderGeometry(0.13, L * Math.tan(half), L, 32, 1, true).translate(0, -L / 2, 0);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(DOWN, dir.normalize())).translate(src.x, src.y, src.z);
  g.setAttribute('aMix', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 3).map((_, i) => mix[i % 3]), 3));
  return g;
}

function buildRig(group, U) {
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const white = { value: new THREE.Color(1.0, 0.9, 0.78) };
  const lensCol = new THREE.Color(1, 0.9, 0.75);
  const coneMat = () => shaderMat({
    uniforms: { uColA: U.uColA, uColB: U.uColB, uWhite: white, uTime: U.uTime, uIntensity: { value: 0.12 } },
    vertexShader: CONE_VS,
    fragmentShader: CONE_FS,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });

  // Truss: four lattice beams with an alpha-tested texture.
  const [tc, tg] = makeCanvas(128, 128);
  tg.strokeStyle = '#c8c8d0';
  tg.lineWidth = 10;
  tg.strokeRect(5, 5, 118, 118);
  tg.lineWidth = 7;
  tg.beginPath();
  tg.moveTo(0, 124);
  tg.lineTo(64, 4);
  tg.lineTo(128, 124);
  tg.stroke();
  const trussTex = canvasTex(tc, { repeat: true });
  const beams = [];
  for (let i = 0; i < 4; i++) {
    const b = new THREE.BoxGeometry(TRUSS_HALF * 2 + 0.36, 0.36, 0.36);
    const uv = b.attributes.uv;
    for (let k = 0; k < uv.count; k++) uv.setX(k, uv.getX(k) * 18);
    beams.push(b.translate(0, TRUSS_Y, TRUSS_HALF).rotateY((i * Math.PI) / 2));
  }
  group.add(new THREE.Mesh(merge(beams), new THREE.MeshStandardMaterial({
    map: trussTex, color: 0x9a9aa6, metalness: 0.5, roughness: 0.4, alphaTest: 0.5, side: THREE.DoubleSide,
  })));

  // Fixture cans hanging under the truss; four of them feed the visible beams.
  const coneSpecs = [
    { at: V(-2.4, 0, -TRUSS_HALF), to: V(-0.9, 0, -1.9), mix: [1, 0, 0] },
    { at: V(2.4, 0, -TRUSS_HALF), to: V(0.9, 0, -1.9), mix: [0, 1, 0] },
    { at: V(-TRUSS_HALF, 0, -0.8), to: V(-1.3, 0, -0.8), mix: [0, 0, 1] },
    { at: V(TRUSS_HALF, 0, -0.8), to: V(1.3, 0, -0.8), mix: [0, 0, 1] },
  ];
  const cans = [];
  for (const t of [-2.4, -0.8, 0.8, 2.4]) {
    cans.push({ at: V(t, 0, -TRUSS_HALF) }, { at: V(t, 0, TRUSS_HALF) }, { at: V(-TRUSS_HALF, 0, t) }, { at: V(TRUSS_HALF, 0, t) });
  }
  const canGeo = new THREE.CylinderGeometry(0.13, 0.16, 0.34, 10);
  const lensGeo = new THREE.CircleGeometry(0.125, 14).rotateX(Math.PI / 2).translate(0, -0.172, 0);
  const canMesh = new THREE.InstancedMesh(canGeo, new THREE.MeshStandardMaterial({ color: 0x1a1a20, metalness: 0.4, roughness: 0.5 }), cans.length);
  const lensMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.9, 0.75).multiplyScalar(2.2), fog: false });
  const lensMesh = new THREE.InstancedMesh(lensGeo, lensMat, cans.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), one = V(1, 1, 1);
  const cones = [];
  cans.forEach((c, i) => {
    c.at.y = TRUSS_Y - 0.18;
    const spec = coneSpecs.find((s) => s.at.x === c.at.x && s.at.z === c.at.z);
    const target = spec ? spec.to : V(c.at.x * 0.25, 0, c.at.z * 0.25 - 0.4);
    const dir = target.clone().sub(c.at).normalize();
    q.setFromUnitVectors(DOWN, dir);
    m.compose(c.at.clone().addScaledVector(dir, 0.17), q, one);
    canMesh.setMatrixAt(i, m);
    lensMesh.setMatrixAt(i, m);
    if (spec) cones.push(coneGeometry(c.at.clone().addScaledVector(dir, 0.35), target, 0.13, spec.mix));
  });
  const trussConeMat = coneMat();
  group.add(canMesh, lensMesh, new THREE.Mesh(merge(cones), trussConeMat));

  // Moving beams share one unit cone (apex at origin, pointing -Y, length 1) scaled per frame.
  const unit = (half, mix) => {
    const g = new THREE.CylinderGeometry(0.012, Math.tan(half), 1, 32, 1, true).translate(0, -0.5, 0);
    g.setAttribute('aMix', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 3).map((_, i) => mix[i % 3]), 3));
    return g;
  };
  const beam = (half, mix, src) => {
    const mesh = new THREE.Mesh(unit(half, mix), coneMat());
    mesh.frustumCulled = false;
    mesh.userData.src = src;
    group.add(mesh);
    return mesh;
  };
  const wallBeams = [beam(0.07, [0, 1, 0], V(-12.5, 11.5, -13.6)), beam(0.07, [1, 0, 0], V(12.5, 11.5, -13.6))];
  const sweeps = [beam(0.075, [0, 0, 1], V(-TRUSS_HALF, TRUSS_Y - 0.4, -TRUSS_HALF)), beam(0.1, [0, 0, 1], V(TRUSS_HALF, TRUSS_Y - 0.4, -TRUSS_HALF))];
  const aim = (mesh, target, intensity) => {
    const src = mesh.userData.src;
    const dir = target.clone().sub(src);
    mesh.position.copy(src);
    mesh.scale.setScalar(dir.length());
    mesh.quaternion.setFromUnitVectors(DOWN, dir.normalize());
    mesh.material.uniforms.uIntensity.value = intensity;
    mesh.visible = intensity > 0.002;
  };

  // Jumbotron hanging above the truss.
  const JY = 9.4;
  const screens = [], bands = [];
  for (let i = 0; i < 4; i++) screens.push(new THREE.PlaneGeometry(2.9, 1.63).translate(0, JY, 1.61).rotateY((i * Math.PI) / 2));
  for (const y of [JY + 0.97, JY - 0.97]) bands.push(new THREE.BoxGeometry(3.28, 0.07, 3.28).translate(0, y, 0));
  const screenMat = new THREE.MeshBasicMaterial({ fog: false });
  const bandMat = new THREE.MeshBasicMaterial({ fog: false });
  const cable = [];
  for (const [x, z] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    cable.push(x * TRUSS_HALF, TRUSS_Y, z * TRUSS_HALF, x * TRUSS_HALF, CEIL, z * TRUSS_HALF);
    cable.push(x * 1.5, JY + 0.95, z * 1.5, x * 0.6, CEIL, z * 0.6);
  }
  group.add(
    new THREE.Mesh(new THREE.BoxGeometry(3.2, 1.9, 3.2).translate(0, JY, 0), new THREE.MeshStandardMaterial({ color: 0x111116, roughness: 0.6 })),
    new THREE.Mesh(merge(screens), screenMat),
    new THREE.Mesh(merge(bands), bandMat),
    new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(cable, 3)), new THREE.LineBasicMaterial({ color: 0x2c2a34 })),
  );

  const tgt = V(0, 0, 0);
  return {
    sweeps,
    applyTheme(t) {
      screenMat.map?.dispose();
      screenMat.map = drawJumbo(t);
      screenMat.needsUpdate = true;
      bandMat.color.copy(neon(t.a, 1.6));
      // beams and lenses take the floor's key colour
      white.value.set(t.light.key).lerp(new THREE.Color(1, 1, 1), 0.2);
      lensCol.set(t.light.key);
    },
    update(time, hype, bk, intro, introT, sweepOut) {
      const lit = 1 - bk;
      trussConeMat.uniforms.uIntensity.value = 0.1 * lit * (1 + 0.1 * hype * Math.sin(time * 9));
      lensMat.color.copy(lensCol).multiplyScalar(2.2 * (0.03 + 0.97 * lit));
      screenMat.color.setScalar(1.3 * (0.2 + 0.8 * lit));
      const sway = time * (0.25 + hype * 0.5);
      aim(wallBeams[0], tgt.set(1.6 + Math.sin(sway) * 1.8, 0, -2.4 + Math.cos(sway * 0.7) * 1.0), 0.028 * lit);
      aim(wallBeams[1], tgt.set(-1.6 + Math.sin(sway + 2) * 1.8, 0, -2.4 + Math.cos(sway * 0.7 + 1) * 1.0), 0.028 * lit);
      // Title-screen sweep: two white beams scan the stands behind the ring.
      sweeps.forEach((mesh, i) => {
        const phi = -Math.PI / 2 + 1.15 * Math.sin(introT * Math.PI * 2 + i * 2.4);
        tgt.set(Math.cos(phi) * 10, 1.6, Math.sin(phi) * 10);
        aim(mesh, tgt, 0.12 * intro);
        sweepOut[i].set(tgt.x, tgt.y, tgt.z, intro);
      });
    },
  };
}

function buildAtmosphere(group, U) {
  const hazeMat = shaderMat({
    uniforms: { uColor: { value: new THREE.Color() }, uTime: U.uTime, uLevel: { value: 1 } },
    vertexShader: HAZE_VS,
    fragmentShader: HAZE_FS,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const layers = [
    new THREE.PlaneGeometry(9, 9).rotateX(-Math.PI / 2).translate(0, 0.18, 0),
    new THREE.PlaneGeometry(9, 9).rotateX(-Math.PI / 2).translate(0, 0.5, 0),
    new THREE.PlaneGeometry(36, 36).rotateX(-Math.PI / 2).translate(0, -0.75, 0),
  ];
  group.add(new THREE.Mesh(merge(layers), hazeMat));

  // Dust drifting inside the truss beams and the air above the ring.
  const r = rng(5), D = 360;
  const pos = new Float32Array(D * 3), seed = new Float32Array(D);
  for (let i = 0; i < D; i++) {
    const x = (r() - 0.5) * 7, z = (r() - 0.5) * 7 - 0.6;
    pos.set([x, 0.3 + r() * 6, z], i * 3);
    seed[i] = r();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  const dustMat = shaderMat({
    uniforms: { uTime: U.uTime, uPx: U.uPx, uLevel: { value: 1 } },
    vertexShader: DUST_VS,
    fragmentShader: DUST_FS,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const dust = new THREE.Points(g, dustMat);
  dust.frustumCulled = false;
  group.add(dust);
  return {
    dust,
    applyTheme(t) {
      hazeMat.uniforms.uColor.value.set(0xffffff).lerp(new THREE.Color(t.a), 0.35).multiplyScalar(0.06 * t.light.haze);
    },
    update(bk) {
      hazeMat.uniforms.uLevel.value = 1 - 0.6 * bk;
      dustMat.uniforms.uLevel.value = 1 - 0.9 * bk;
    },
  };
}

// ---------------------------------------------------------------- floor props

// One hero prop per floor, outside the far ropes, toon-shaded and inked like the cast. It stands
// between the boss and the corner post, where the key light still reaches and the post can't hide it.
const PROP_AT = { x: 2.45, z: -4.6 };

function drawWhiteboard() {
  const [c, g] = makeCanvas(512, 376);
  g.fillStyle = '#f7f9fb'; g.fillRect(0, 0, 512, 376);
  g.font = `bold 44px ${FONT}`; g.fillStyle = '#1f4fd1'; g.fillText('BILLABLE HOURS', 28, 62);
  g.strokeStyle = '#222'; g.lineWidth = 5;
  g.beginPath(); g.moveTo(40, 90); g.lineTo(40, 330); g.lineTo(480, 330); g.stroke();
  g.strokeStyle = '#e0262f'; g.lineWidth = 9; g.lineJoin = 'round';
  g.beginPath();
  [[50, 310], [140, 290], [210, 300], [290, 230], [350, 245], [420, 140], [470, 70]].forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
  g.stroke();
  g.fillStyle = '#e0262f'; g.beginPath(); g.moveTo(492, 40); g.lineTo(452, 64); g.lineTo(482, 88); g.fill();
  g.font = `28px ${FONT}`; g.fillStyle = '#222';
  ['Q1', 'Q2', 'Q3', 'Q4'].forEach((q, i) => g.fillText(q, 80 + i * 110, 362));
  return canvasTex(c);
}

function buildProps(group) {
  const root = new THREE.Group();
  group.add(root);
  const owned = [];
  let pendulum = null;
  // ringside is outside the key light's full cone, so props carry some light of their own
  const mat = (color, opts) => {
    const m = toonMat(color, { emissive: new THREE.Color(color).multiplyScalar(0.3), ...opts });
    if (m.map) { m.emissiveMap = m.map; m.emissive.setScalar(0.35); }
    owned.push(m);
    return m;
  };
  const part = (geo, color, s, p, r = [0, 0, 0], ink = 0.02, opts) => {
    const m = inked(geo, mat(color, opts), ink);
    m.scale.set(...s); m.position.set(...p); m.rotation.set(...r);
    return m;
  };
  const BUILD = {
    parcels(g) {
      const card = ['#b07a45', '#c4894f', '#a36e3c'];
      [[0.72, 0.5, 0.55, 0.25, 0.06], [0.62, 0.46, 0.5, 0.73, -0.14], [0.5, 0.4, 0.44, 1.16, 0.22]].forEach(([w, h, d, y, r], i) => {
        const box = part(GEO.box, card[i], [w, h, d], [0, y, 0.05], [0, r, 0]);
        box.add(part(GEO.box, '#eadcb2', [0.12 / w, 1.02, 1.02], [0, 0, 0], [0, 0, 0], 0));
        g.add(box);
      });
      for (const s of [-1, 1]) {
        g.add(part(GEO.cyl, '#3a3a44', [0.025, 1.6, 0.025], [s * 0.34, 0.8, -0.3]));
        g.add(part(GEO.cyl, '#161618', [0.14, 0.07, 0.14], [s * 0.38, 0.14, -0.3], [0, 0, Math.PI / 2]));
      }
      g.add(part(GEO.cyl, '#3a3a44', [0.025, 0.68, 0.025], [0, 1.6, -0.3], [0, 0, Math.PI / 2]));
    },
    plant(g) {
      g.add(part(GEO.cylTaper, '#ece6da', [0.28, 0.55, 0.28], [0, 0.275, 0], [Math.PI, 0, 0]));
      g.add(part(GEO.cyl, '#3a2616', [0.24, 0.02, 0.24], [0, 0.55, 0], [0, 0, 0], 0));
      g.add(part(GEO.cyl, '#6b4a2a', [0.03, 1.2, 0.03], [0, 1.1, 0]));
      const greens = ['#3d8f4b', '#2e7a3e', '#4aa35a'];
      for (let i = 0; i < 11; i++) {
        const a = i * 2.4, rad = 0.16 + (i % 3) * 0.06, y = 1.0 + i * 0.1;
        g.add(part(GEO.sphereLo, greens[i % 3], [0.19, 0.27, 0.06], [Math.cos(a) * rad, y, Math.sin(a) * rad], [0.35, -a, Math.cos(a) * 0.5], 0.015));
      }
    },
    barbell(g) {
      g.add(part(GEO.box, '#222228', [1.7, 0.06, 0.6], [0, 0.03, 0]));
      for (const s of [-1, 1]) {
        g.add(part(GEO.box, '#ff7a1a', [0.09, 1.7, 0.09], [s * 0.62, 0.88, -0.05]));
        g.add(part(GEO.cyl, '#d8262e', [0.27, 0.07, 0.27], [s * 0.86, 1.47, 0.06], [0, 0, Math.PI / 2]));
        g.add(part(GEO.cyl, '#2a62e0', [0.22, 0.06, 0.22], [s * 0.93, 1.47, 0.06], [0, 0, Math.PI / 2]));
        g.add(part(GEO.cyl, '#c9c9d2', [0.04, 0.05, 0.04], [s * 1.0, 1.47, 0.06], [0, 0, Math.PI / 2], 0.01));
      }
      g.add(part(GEO.cyl, '#c9c9d2', [0.022, 2.1, 0.022], [0, 1.47, 0.06], [0, 0, Math.PI / 2], 0.01));
      g.add(part(GEO.sphere, '#141418', [0.15, 0.15, 0.15], [0.35, 0.15, 0.45]));
      g.add(part(GEO.torus, '#141418', [0.09, 0.09, 0.09], [0.35, 0.32, 0.45], [0, 0, 0], 0.01));
    },
    whiteboard(g) {
      for (const s of [-1, 1]) g.add(part(GEO.cyl, '#9aa0aa', [0.02, 1.95, 0.02], [s * 0.56, 0.97, -0.05], [-0.06, 0, 0], 0.01));
      g.add(part(GEO.cyl, '#9aa0aa', [0.02, 1.9, 0.02], [0, 0.95, -0.35], [0.28, 0, 0], 0.01));
      g.add(part(GEO.box, '#ffffff', [1.3, 0.95, 0.04], [0, 1.55, 0], [-0.06, 0, 0], 0.02, { map: drawWhiteboard() }));
      g.add(part(GEO.box, '#9aa0aa', [1.3, 0.03, 0.09], [0, 1.06, 0.07], [0, 0, 0], 0.01));
    },
    clock(g) {
      g.add(part(GEO.box, '#7a3a18', [0.62, 0.4, 0.4], [0, 0.2, 0]));
      g.add(part(GEO.box, '#8e4a22', [0.5, 1.22, 0.34], [0, 1.01, 0]));
      g.add(part(GEO.box, '#4a220c', [0.3, 0.84, 0.02], [0, 1.0, 0.17], [0, 0, 0], 0));
      g.add(part(GEO.box, '#7a3a18', [0.6, 0.62, 0.4], [0, 1.93, 0]));
      g.add(part(GEO.box, '#5a2810', [0.68, 0.07, 0.46], [0, 2.27, 0]));
      g.add(part(GEO.cyl, '#f3e8c8', [0.21, 0.02, 0.21], [0, 1.93, 0.205], [Math.PI / 2, 0, 0], 0.012));
      g.add(part(GEO.box, '#111111', [0.018, 0.22, 0.01], [0, 1.93, 0.22], [0, 0, 0.5], 0));
      g.add(part(GEO.box, '#111111', [0.014, 0.32, 0.01], [0, 1.93, 0.225], [0, 0, -1.2], 0));
      pendulum = new THREE.Group();
      pendulum.position.set(0, 1.36, 0.19);
      pendulum.add(part(GEO.cyl, '#d4a93a', [0.008, 0.55, 0.008], [0, -0.275, 0], [0, 0, 0], 0));
      pendulum.add(part(GEO.cyl, '#ffcf4a', [0.08, 0.02, 0.08], [0, -0.56, 0], [Math.PI / 2, 0, 0], 0.01));
      g.add(pendulum);
    },
    trophy(g) {
      const gold = { emissive: 0x6a4600 };
      g.add(part(GEO.box, '#15151c', [0.7, 0.9, 0.7], [0, 0.45, 0]));
      g.add(part(GEO.box, '#ffc233', [0.4, 0.12, 0.02], [0, 0.62, 0.355], [0, 0, 0], 0, gold));
      const cup = part(latheGeo([0.55, 0.3, 0.16, 0.2, 0.55, 0.9, 1]), '#ffc233', [0.42, 1.05, 0.42], [0, 1.43, 0], [0, 0, 0], 0.02, gold);
      cup.geometry.userData.owned = true;
      g.add(cup);
      for (const s of [-1, 1]) g.add(part(GEO.torus, '#ffc233', [0.17, 0.21, 0.17], [s * 0.43, 1.66, 0], [0, 0, 0], 0.012, gold));
    },
  };
  return {
    applyTheme(t) {
      root.traverse((o) => { if (o.geometry?.userData.owned) o.geometry.dispose(); });
      for (const m of owned) { m.map?.dispose(); m.dispose(); }
      owned.length = 0;
      root.clear();
      pendulum = null;
      if (!BUILD[t.prop]) return;
      const g = new THREE.Group();
      BUILD[t.prop](g);
      // floors alternate corners; the prop turns to face the fight camera
      const side = Object.keys(BUILD).indexOf(t.prop) % 2 ? 1 : -1;
      g.position.set(side * PROP_AT.x, FLOOR_Y, PROP_AT.z);
      g.scale.setScalar(1.25);
      g.rotation.y = Math.atan2(-g.position.x, 1.2 - PROP_AT.z);
      root.add(g);
    },
    update(time) {
      if (pendulum) pendulum.rotation.z = Math.sin(time * Math.PI) * 0.22;
    },
  };
}

// ---------------------------------------------------------------- public API

export function createArena(scene) {
  const group = new THREE.Group();
  group.name = 'arena';
  scene.add(group);

  const U = {
    uTime: { value: 0 }, uBeat: { value: 0 }, uHype: { value: 0 }, uCheer: { value: 0 },
    uLight: { value: 1 }, uPx: { value: 800 },
    uColA: { value: new THREE.Color() }, uColB: { value: new THREE.Color() },
  };
  scene.background = new THREE.Color();
  scene.fog = new THREE.FogExp2(0x000000, 0.026);

  const lights = buildLights(group);
  const ring = buildRing(group);
  const ropes = buildRopes(group, U);
  const stands = buildStands(group, U);
  const room = buildRoom(group, U);
  const rig = buildRig(group, U);
  const air = buildAtmosphere(group, U);
  const props = buildProps(group);

  // Point sprites need pixels-per-meter-at-1m for the current camera and canvas.
  const px = new THREE.Vector2();
  air.dust.onBeforeRender = (renderer, _s, camera) => {
    renderer.getDrawingBufferSize(px);
    U.uPx.value = px.y * 0.5 * camera.projectionMatrix.elements[5];
  };

  const st = {
    time: 0, hype: 0, cheer: 0, beat: 0, flashAcc: 0,
    blackout: 0, blackoutTarget: 0, intro: 0, introT: 0, introSeen: false,
    flickNext: 3, flickLeft: 0, flickHold: 0, flickVal: 1,
  };
  let L = BASE_LIGHT;
  let lastInput = {};
  const rimGain = [1, 1];

  function setTheme(input = {}) {
    lastInput = input;
    const t = { ...DEFAULT_THEME, ...input };
    L = t.light = { ...BASE_LIGHT, ...input.light };
    // Shared shader colours (crowd rims, beams, wall washes) are brightness-balanced per palette.
    U.uColA.value.set(t.a).multiplyScalar(balance(t.a, 0.5, 0.55, 1.3));
    U.uColB.value.set(t.b).multiplyScalar(balance(t.b, 0.5, 0.55, 1.3));
    rimGain[0] = balance(t.a, 0.45, 0.6, 1.3);
    rimGain[1] = balance(t.b, 0.45, 0.6, 1.3);
    scene.background = scene.background?.isColor ? scene.background : new THREE.Color();
    scene.background.set(t.bg);
    scene.fog.color.set(t.bg).lerp(new THREE.Color(t.a), 0.05).multiplyScalar(1.5);
    lights.rimA.color.set(t.a);
    lights.rimB.color.set(t.b);
    lights.hemi.color.set(t.a).lerp(new THREE.Color(t.b), 0.5).lerp(new THREE.Color(0xffffff), 0.3).multiplyScalar(0.8);
    lights.key.color.set(L.key);
    lights.fill.color.set(L.fill);
    scene.fog.density = L.fog;
    for (const part of [ring, ropes, stands, room, rig, air, props]) part.applyTheme(t);
  }
  setTheme(DEFAULT_THEME);
  // If the webfont lands after first paint, redraw the text textures with it.
  document.fonts?.ready?.then(() => setTheme(lastInput));

  function flashes(count) {
    for (let i = 0; i < count; i++) stands.spawnFlash(st.time + Math.random() * 0.35);
  }

  function update(dt, time, hype = 0) {
    dt = Math.min(dt, 0.1);
    st.time = time;
    st.hype += (hype - st.hype) * Math.min(1, dt * 3);
    st.cheer = Math.max(0, st.cheer - dt / 1.5);
    st.beat += dt * (2.6 + st.hype * 5.5 + st.cheer * 4);
    const step = dt / 0.25;
    st.blackout += THREE.MathUtils.clamp(st.blackoutTarget - st.blackout, -step, step);
    st.intro += ((st.introSeen ? 1 : 0) - st.intro) * Math.min(1, dt * 3);
    st.introSeen = false;
    const bk = st.blackout;

    U.uTime.value = time;
    U.uBeat.value = st.beat;
    U.uHype.value = st.hype;
    U.uCheer.value = st.cheer;
    U.uLight.value = 1 - 0.65 * bk;

    const pulse = 1 + 0.05 * st.hype * Math.sin(time * 8);
    // strip lights: every few seconds the key stutters for a moment
    let flick = 1;
    if (L.flicker) {
      st.flickNext -= dt;
      if (st.flickNext <= 0) { st.flickNext = 4 + Math.random() * 6; st.flickLeft = 0.25 + Math.random() * 0.3; }
      if (st.flickLeft > 0) {
        st.flickLeft -= dt; st.flickHold -= dt;
        if (st.flickHold <= 0) { st.flickHold = 0.03 + Math.random() * 0.05; st.flickVal = Math.random() < 0.5 ? 0.55 : 1; }
        flick = st.flickVal;
      }
    }
    lights.key.intensity = BASE.key * L.keyInt * (1 - 0.98 * bk) * pulse * flick;
    lights.fill.intensity = BASE.fill * L.fillInt * (1 - 0.95 * bk);
    lights.hemi.intensity = BASE.hemi * L.hemi * (1 - 0.95 * bk);
    lights.rimA.intensity = BASE.rim * rimGain[0] * (1 - 0.35 * bk);
    lights.rimB.intensity = BASE.rim * rimGain[1] * (1 - 0.35 * bk);

    ropes.update(dt, 1 - 0.7 * bk);
    room.update(dt, bk);
    rig.update(time, st.hype, bk, st.intro, st.introT, stands.sweep);
    air.update(bk);
    props.update(time);
    ring.setLevel(1 - 0.7 * bk);

    st.flashAcc += dt * (0.4 + st.hype * 7 + st.cheer * 22) * Math.random() * 2;
    while (st.flashAcc >= 1) {
      stands.spawnFlash(time);
      st.flashAcc -= 1;
    }
  }

  return {
    group,
    lights,
    setTheme,
    update,
    cheer(strength = 1) {
      st.cheer = Math.min(1, Math.max(st.cheer, strength));
      flashes(Math.round(6 + 14 * strength));
    },
    flashes,
    blackout(on) {
      st.blackoutTarget = on ? 1 : 0;
    },
    ropeHit(strength = 1) {
      ropes.hit(strength);
    },
    setIntro(t) {
      st.introSeen = true;
      st.introT = t;
    },
  };
}
