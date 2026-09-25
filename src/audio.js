// PUNCH CLOCK — procedural audio. Web Audio only: no files, no libraries.
//
// Bus layout
//   sfx voices ─────► sfxBus (0.9) ──────────────────────────────────────────┐
//   music voices ──► track.out (per-track fade) ─► musicDuck (duck())        │
//   punch accents ─────────────────────────────┐        │                    │
//                                              ▼        ▼                    │
//                                     musicLP (slow-mo lowpass) ─► musicBus (0.35) ─┤
//   any voice ──► send gain ─► reverbIn ─► Convolver (procedural 1.8 s IR) ─► reverbOut ─┤
//                                                                                        ▼
//                                              master (mute) ─► DynamicsCompressor ─► speakers
//
// Music runs on a lookahead scheduler: a 25 ms setInterval schedules every 16th step that
// falls within the next 0.12 s at exact AudioContext times. Two tracks can overlap during
// a crossfade. Every voice disconnects its nodes when its source ends; one shared noise
// buffer feeds all noise voices.

let ctx = null;
let comp, recDest, master, sfxBus, musicBus, musicLP, musicDuck, accentIn, reverbIn, noiseBuf, irBuf;
let muted = false;
try { muted = localStorage.getItem('pc_muted') === '1'; } catch { /* storage blocked */ }

let intensity = 0.5;   // 0..1, read by the fight track at schedule time
let timeScale = 1;
let DT = 0;            // cents added to music voices (slow-mo pitch sag)
let tempoMul = 1;      // slow-mo tempo drag
let lpTarget = 20000;  // last musicLP frequency target sent
let pending = null;    // playMusic() request made before init()
let current = null;    // the track new requests replace
let crowd = null;      // murmur bed nodes
const tracks = [];     // live tracks, including ones fading out

const LOOKAHEAD = 0.12, TICK_MS = 25, MASTER = 0.9;

// ?debug=audio: src/audiodebug.js shows debugSnapshot() live, for chasing on-device dropouts.
export const AUDIO_DEBUG = new URLSearchParams(location.search).get('debug') === 'audio';
const dbg = { log: [], voices: 0, lastTick: 0, an: null, buf: null };
function note(msg) {
  if (!AUDIO_DEBUG) return;
  dbg.log.push(`${(performance.now() / 1000).toFixed(1)}s ${msg}`);
  if (dbg.log.length > 8) dbg.log.shift();
}
const _ = null;

const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, Number.isFinite(+x) ? +x : a));
const rnd = (a, b) => a + Math.random() * (b - a);
const now = () => ctx.currentTime;
const disc = (n) => { try { n.disconnect(); } catch { /* already gone */ } };
const w = (th) => clamp((intensity - th) / 0.15 + 1); // layer weight, fades in over [th-.15, th]

// ───────────────────────────── graph ─────────────────────────────

function gainNode(v, to) {
  const g = ctx.createGain();
  g.gain.value = v;
  if (to) g.connect(to);
  return g;
}

function makeNoise() {
  const len = ctx.sampleRate * 3, buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

// Stereo decaying noise that darkens as it decays, with a short fade-in (no click).
function makeIR(sec = 1.8) {
  const rate = ctx.sampleRate, len = Math.floor(rate * sec), buf = ctx.createBuffer(2, len, rate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const x = i / len;
      lp += (Math.random() * 2 - 1 - lp) * (0.8 - 0.7 * x);
      d[i] = lp * Math.pow(1 - x, 2.4) * Math.min(1, i / (rate * 0.006));
    }
  }
  return buf;
}

function init() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    // iOS plays Web Audio as "ambient", which the silent switch mutes even with SOUND: ON; a video
    // plays through it, and so should a game the player unmuted
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch { /* older Safari */ }
    ctx = new AC({ latencyHint: 'interactive' });
    master = gainNode(muted ? 0 : MASTER);
    comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.knee.value = 10; comp.ratio.value = 3.5;
    comp.attack.value = 0.003; comp.release.value = 0.22;
    master.connect(comp); comp.connect(ctx.destination);
    ctx.onstatechange = () => note(`context ${ctx.state}`);
    if (AUDIO_DEBUG) { dbg.an = ctx.createAnalyser(); dbg.an.fftSize = 1024; dbg.buf = new Float32Array(1024); comp.connect(dbg.an); }

    sfxBus = gainNode(0.9, master);
    musicBus = gainNode(0.35, master);
    musicLP = ctx.createBiquadFilter();
    musicLP.type = 'lowpass'; musicLP.frequency.value = 20000; musicLP.Q.value = 0.9;
    musicLP.connect(musicBus);
    musicDuck = gainNode(1, musicLP);
    accentIn = gainNode(0.8, musicLP);

    noiseBuf = makeNoise();
    irBuf = makeIR(1.8);
    reverbIn = gainNode(1);
    const conv = ctx.createConvolver();
    conv.buffer = irBuf;
    reverbIn.connect(conv); conv.connect(gainNode(0.55, master));

    setInterval(tick, TICK_MS);
  }
  if (ctx.state !== 'running' && !document.hidden) ctx.resume().catch(() => {});
  if (pending) { const p = pending; pending = null; playMusic(...p); }
}

// A backgrounded tab keeps a running AudioContext playing, and with the iOS "playback" session the
// music carries on from the lock screen. Suspending freezes currentTime, so the scheduler resumes on
// the same beat. iOS may leave the context "interrupted" after a switch; the next tap's init() resumes it.
function sleep() {
  try { window.speechSynthesis?.cancel(); } catch { /* no speech */ }
  if (ctx) ctx.suspend().catch(() => {});
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden) sleep();
  else if (ctx) ctx.resume().catch(() => {});
});
window.addEventListener('pagehide', sleep);

function setMuted(b) {
  muted = !!b;
  try { localStorage.setItem('pc_muted', muted ? '1' : '0'); } catch { /* storage blocked */ }
  if (muted) { try { window.speechSynthesis?.cancel(); } catch { /* no speech */ } }
  if (ctx) master.gain.setTargetAtTime(muted ? 0 : MASTER, now(), 0.02);
}

function setTimeScale(s) {
  timeScale = clamp(s, 0.1, 1);
  DT = -(1 - timeScale) * 240;
  tempoMul = 0.8 + 0.2 * timeScale;
  if (!ctx) return;
  // 20 kHz at 1, 600 Hz at 0.25, ~300 Hz at 0.1
  const f = timeScale > 0.999 ? 20000 : 20000 * Math.pow(600 / 20000, (1 - timeScale) / 0.75);
  // Called every frame: queue an automation event only when the target moves (>2%, or the final
  // snap to 20 kHz), so the param's event list doesn't grow at 60 per second.
  if (f === lpTarget || (f !== 20000 && Math.abs(f - lpTarget) < lpTarget * 0.02)) return;
  lpTarget = f;
  musicLP.frequency.setTargetAtTime(f, now(), 0.08);
}

function duck(amount = 0.5, time = 0.4) {
  const g = musicDuck.gain, t = now();
  g.cancelScheduledValues(t);
  g.setValueAtTime(g.value, t);
  g.linearRampToValueAtTime(Math.max(0.02, 1 - clamp(amount)), t + 0.015);
  g.setTargetAtTime(1, t + 0.03, Math.max(0.02, time) / 3);
}

// ───────────────────────────── voices ─────────────────────────────

function done(src, nodes) {
  dbg.voices++;
  src.onended = () => { nodes.forEach(disc); dbg.voices--; };
}

function sendTo(node, amt, nodes) {
  if (!(amt > 0)) return;
  const s = gainNode(amt, reverbIn);
  node.connect(s);
  nodes.push(s);
}

// { type, f, Q, f1, ft }: filter that optionally sweeps f → f1 over ft seconds.
function biquad(s, t, dur) {
  const f = ctx.createBiquadFilter();
  f.type = s.type || 'lowpass';
  f.Q.value = s.Q ?? 0.7;
  if (s.gain) f.gain.value = s.gain;
  f.frequency.setValueAtTime(s.f, t);
  if (s.f1) f.frequency.exponentialRampToValueAtTime(s.f1, t + (s.ft ?? dur));
  return f;
}

// Attack to peak, optional hold, exponential decay to silence at t + dur.
function envelope(param, t, a, peak, hold, dur) {
  param.setValueAtTime(0.0001, t);
  param.linearRampToValueAtTime(Math.max(0.0002, peak), t + a);
  const h = Math.min(hold, dur - a - 0.01);
  if (h > 0) param.setValueAtTime(Math.max(0.0002, peak), t + a + h);
  param.exponentialRampToValueAtTime(0.0001, t + dur);
}

// Shared tail: filters → env gain → optional pan → dest (+ reverb send).
function route(src, g, t, dur, o, nodes) {
  let head = src;
  for (const spec of [].concat(o.filter || [])) {
    const f = biquad(spec, t, dur);
    head.connect(f); head = f; nodes.push(f);
  }
  head.connect(g);
  let out = g;
  if (o.pan) {
    const p = ctx.createStereoPanner();
    p.pan.value = clamp(o.pan, -1, 1);
    g.connect(p); out = p; nodes.push(p);
  }
  out.connect(o.dest || sfxBus);
  sendTo(out, o.send, nodes);
}

// Oscillator voice. o: type, dur, gain, a, hold, f1, glide, detune, filter, pan, dest, send
function tone(freq, t, o = {}) {
  const osc = ctx.createOscillator(), g = ctx.createGain(), dur = o.dur ?? 0.2;
  osc.type = o.type || 'sine';
  osc.frequency.setValueAtTime(freq, t);
  if (o.f1) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.f1), t + (o.glide ?? dur));
  if (o.detune) osc.detune.value = o.detune;
  envelope(g.gain, t, o.a ?? 0.003, o.gain ?? 0.3, o.hold ?? 0, dur);
  const nodes = [osc, g];
  route(osc, g, t, dur, o, nodes);
  osc.start(t);
  osc.stop(t + dur + 0.05);
  done(osc, nodes);
  return osc;
}

// Noise voice from the shared buffer at a random offset. Same options as tone(), plus rate.
function noise(t, o = {}) {
  const src = ctx.createBufferSource(), g = ctx.createGain(), dur = o.dur ?? 0.1;
  src.buffer = noiseBuf;
  src.playbackRate.value = o.rate ?? 1;
  if (dur > 2.5) src.loop = true;
  envelope(g.gain, t, o.a ?? 0.001, o.gain ?? 0.3, o.hold ?? 0, dur);
  const nodes = [src, g];
  route(src, g, t, dur, o, nodes);
  src.start(t, src.loop ? 0 : Math.random() * Math.max(0, 2.9 - dur));
  src.stop(t + dur + 0.05);
  done(src, nodes);
}

// Inharmonic bell: partial ratios with slight detuned twins for beating shimmer.
function bellTone(t, f, o = {}) {
  const ratios = o.ratios || [1, 2.76, 5.4, 8.9], gains = o.gains || [1, 0.55, 0.35, 0.2];
  const decay = o.decay ?? 1.5, peak = o.gain ?? 0.15;
  ratios.forEach((r, k) => {
    const d = decay / (1 + k * 0.6), g = peak * (gains[k] ?? 0.2);
    tone(f * r, t, { dur: d, gain: g, a: 0.002, dest: o.dest, send: o.send, pan: o.pan });
    if (k < 2) tone(f * r * 1.0023, t, { dur: d * 0.8, gain: g * 0.5, a: 0.002, dest: o.dest });
  });
}

// Sawtooth "voices" through parallel bandpass formants. formants: [f, Q, gain, fEnd?]
function vox(t, o) {
  const dur = o.dur, n = o.voices || 1, out = ctx.createGain(), mix = gainNode(1 / Math.sqrt(n));
  const nodes = [out, mix], srcs = [];
  for (let i = 0; i < n; i++) {
    const osc = ctx.createOscillator(), f0 = o.f0 * (1 + (Math.random() * 2 - 1) * (o.spread || 0));
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(f0, t);
    if (o.f1) osc.frequency.exponentialRampToValueAtTime(f0 * o.f1 / o.f0, t + dur);
    osc.connect(mix);
    osc.start(t + (i ? Math.random() * 0.05 : 0));
    osc.stop(t + dur + 0.05);
    srcs.push(osc); nodes.push(osc);
  }
  for (const [f, q, g, f1] of o.formants) {
    const bp = biquad({ type: 'bandpass', f, Q: q }, t, dur), bg = gainNode(g, out);
    if (f1) bp.frequency.linearRampToValueAtTime(f1, t + dur);
    mix.connect(bp); bp.connect(bg); nodes.push(bp, bg);
  }
  envelope(out.gain, t, o.a ?? 0.03, o.gain ?? 0.3, o.hold ?? 0, dur);
  let tail = out;
  if (o.pan) {
    tail = ctx.createStereoPanner();
    tail.pan.value = clamp(o.pan, -1, 1);
    out.connect(tail); nodes.push(tail);
  }
  tail.connect(o.dest || sfxBus);
  sendTo(tail, o.send, nodes);
  done(srcs[0], nodes);
}

function driveCurve(k) {
  const n = 1024, c = new Float32Array(n);
  for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.tanh(k * x) / Math.tanh(k); }
  return c;
}

// ───────────────────────────── instruments ─────────────────────────────

const drum = {
  kick(t, dest, v = 1) {
    tone(150, t, { f1: 44, glide: 0.09, dur: 0.38, gain: 0.95 * v, a: 0.001, dest });
    tone(1100, t, { type: 'triangle', f1: 250, glide: 0.012, dur: 0.022, gain: 0.22 * v, a: 0.0005, dest });
  },
  snare(t, dest, v = 1, send = 0.15) {
    noise(t, { dur: 0.19, gain: 0.5 * v, dest, send, filter: [{ type: 'bandpass', f: 2400, Q: 0.7 }, { type: 'highpass', f: 800 }] });
    tone(185, t, { type: 'triangle', f1: 150, dur: 0.11, gain: 0.35 * v, dest });
  },
  clap(t, dest, v = 1, send = 0.2) {
    for (let i = 0; i < 3; i++) {
      const last = i === 2;
      noise(t + i * 0.011, { dur: last ? 0.17 : 0.02, gain: 0.42 * v, dest, send: last ? send : 0, filter: { type: 'bandpass', f: 1300, Q: 1.3 } });
    }
  },
  hat(t, dest, v = 1, open = false) {
    noise(t, { dur: open ? 0.24 : 0.045, gain: (open ? 0.16 : 0.13) * v, dest, filter: [{ type: 'highpass', f: 7000 }, { type: 'peaking', f: 10000, Q: 1, gain: 6 }] });
  },
  crash(t, dest, v = 1, send = 0.3) {
    noise(t, { dur: 1.8, gain: 0.28 * v, dest, send, filter: { type: 'highpass', f: 5000, f1: 3000 } });
    for (const r of [1, 1.47, 1.83, 2.41]) tone(420 * r, t, { type: 'square', dur: 1.1, gain: 0.02 * v, dest, filter: { type: 'highpass', f: 5000 } });
  },
  rim(t, dest, v = 1) {
    tone(1700, t, { type: 'triangle', dur: 0.03, gain: 0.12 * v, dest });
    noise(t, { dur: 0.02, gain: 0.15 * v, dest, filter: { type: 'bandpass', f: 3000, Q: 3 } });
  },
};

// Sidechain pump: dip then recover — cheap, no real compressor needed.
function pumpAt(g, t, depth, rel) {
  g.gain.setTargetAtTime(1 - depth, t, 0.004);
  g.gain.setTargetAtTime(1, t + 0.03, rel / 3);
}

function bassNote(t, m, dur, dest, o = {}) {
  const f = mtof(m), v = o.v ?? 1;
  tone(f, t, { type: 'sawtooth', dur, gain: 0.2 * v, a: 0.004, detune: DT, dest, filter: { type: 'lowpass', f: o.cut ?? 900, f1: o.cut1 ?? 140, ft: dur * (o.ft ?? 0.8), Q: o.Q ?? 4 } });
  tone(f, t, { dur, gain: 0.32 * v, a: 0.004, detune: DT, dest });
}

function pluck(t, m, dur, dest, o = {}) {
  tone(mtof(m), t, { type: o.type || 'sawtooth', dur, gain: o.v ?? 0.1, a: 0.003, detune: DT + (o.det || 0), dest, send: o.send, pan: o.pan, filter: { type: 'lowpass', f: o.cut ?? 3000, f1: o.cut1 ?? 400, ft: dur * 0.7, Q: o.Q ?? 6 } });
}

// Three detuned saws per note through a lowpass.
function pad(t, notes, dur, dest, o = {}) {
  const a = o.a ?? 0.4, r = o.r ?? 0.5, spread = o.det ?? 9;
  for (const m of notes) {
    for (const d of [-spread, 0, spread]) {
      tone(mtof(m), t, { type: 'sawtooth', dur, a, hold: Math.max(0, dur - a - r), gain: o.v ?? 0.03, detune: DT + d, dest, send: o.send ?? 0.25, filter: { type: 'lowpass', f: o.cut ?? 1400, Q: 0.5 } });
    }
  }
}

// Two-operator FM: rhodes (ratio 1) or vibes (ratio 4). Index decays for the bark.
function fmKey(t, m, dur, dest, o = {}) {
  const f = mtof(m), car = ctx.createOscillator(), mod = ctx.createOscillator();
  const mg = ctx.createGain(), g = ctx.createGain(), nodes = [car, mod, mg, g];
  car.frequency.value = f; mod.frequency.value = f * (o.ratio ?? 1);
  car.detune.value = DT; mod.detune.value = DT;
  mg.gain.setValueAtTime(f * (o.index ?? 2.2), t);
  mg.gain.exponentialRampToValueAtTime(f * 0.15, t + Math.min(dur, 0.5));
  mod.connect(mg); mg.connect(car.frequency);
  envelope(g.gain, t, 0.004, o.v ?? 0.08, 0, dur);
  car.connect(g); g.connect(dest);
  sendTo(g, o.send ?? 0.2, nodes);
  car.start(t); mod.start(t);
  car.stop(t + dur + 0.05); mod.stop(t + dur + 0.05);
  done(car, nodes);
}

// Two detuned oscillators with delayed vibrato through a closing lowpass.
function lead(t, m, dur, dest, o = {}) {
  const f = mtof(m), g = ctx.createGain(), fl = ctx.createBiquadFilter();
  const vib = ctx.createOscillator(), vg = ctx.createGain(), nodes = [g, fl, vib, vg];
  vib.frequency.value = o.vibHz ?? 5.5;
  vg.gain.setValueAtTime(0, t);
  vg.gain.linearRampToValueAtTime(o.vib ?? 18, t + Math.min(dur, 0.3));
  vib.connect(vg);
  const oscs = [-7, 7].map((d) => {
    const x = ctx.createOscillator();
    x.type = o.type || 'square'; x.frequency.value = f; x.detune.value = DT + d;
    vg.connect(x.detune); x.connect(fl); nodes.push(x);
    return x;
  });
  const cut = o.cut ?? 3200;
  fl.type = 'lowpass'; fl.Q.value = 3;
  fl.frequency.setValueAtTime(cut, t);
  fl.frequency.exponentialRampToValueAtTime(cut * 0.4, t + dur + 0.1);
  const v = o.v ?? 0.07;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(v, t + 0.01);
  g.gain.linearRampToValueAtTime(v * 0.75, t + dur);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.1);
  fl.connect(g); g.connect(dest);
  sendTo(g, o.send ?? 0.2, nodes);
  for (const x of [...oscs, vib]) { x.start(t); x.stop(t + dur + 0.15); }
  done(oscs[0], nodes);
}

// Chord stab for stingers: detuned saw pairs through a closing lowpass.
function stab(t, notes, o = {}) {
  const dur = o.dur ?? 0.6;
  for (const m of notes) {
    for (const d of o.spread ?? [-10, 10]) {
      tone(mtof(m), t, { type: o.type || 'sawtooth', dur, a: o.a ?? 0.004, gain: o.v ?? 0.06, detune: d, dest: o.dest, send: o.send ?? 0.3, filter: { type: 'lowpass', f: o.cut ?? 5000, f1: o.cut1 ?? 400, ft: o.ft ?? dur, Q: o.Q ?? 2 } });
    }
  }
}

// ───────────────────────────── music ─────────────────────────────

const chordTone = (ch, i) => ch[i % ch.length] + 12 * Math.floor(i / ch.length);
const degree = (scale, d) => scale[((d % scale.length) + scale.length) % scale.length] + 12 * Math.floor(d / scale.length);

function rng(seed) {
  let s = (seed >>> 0) || 1;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
}

// A seeded 2-bar melody: rhythm templates + a random walk on scale degrees. Map<step, {deg, len}>.
function makeMotif(seed) {
  const r = rng(seed), RH = [[0, 3, 6, 10, 12, 14], [0, 2, 4, 7, 8, 11, 14], [0, 6, 8, 12, 13, 14], [0, 3, 4, 8, 11, 12]];
  const map = new Map();
  let deg = 4 + Math.floor(r() * 3);
  for (let bar = 0; bar < 2; bar++) {
    const on = RH[Math.floor(r() * RH.length)];
    on.forEach((s, k) => {
      deg = clamp(deg + Math.floor(r() * 5) - 2, 0, 9);
      map.set(bar * 16 + s, { deg, len: (on[k + 1] ?? 16) - s });
    });
  }
  return map;
}

const MOODS = {
  drive: { bpm: 128, scale: [0, 3, 5, 7, 10], chords: [[0, 3, 7], [-4, 0, 3], [3, 7, 10], [-2, 2, 5]], bass: 'roll', arp: 'sawtooth' },
  dark:  { bpm: 124, scale: [0, 1, 3, 5, 7, 8, 10], chords: [[0, 3, 7], [1, 5, 8], [0, 3, 7], [-2, 1, 5]], bass: 'gallop', arp: 'square' },
  funk:  { bpm: 112, scale: [0, 2, 3, 5, 7, 9, 10], chords: [[0, 3, 7, 10], [5, 9, 12, 15], [0, 3, 7, 10], [-2, 2, 5, 9]], bass: 'slap', arp: 'square' },
  boss:  { bpm: 146, scale: [0, 2, 3, 5, 7, 8, 11], chords: [[0, 3, 7], [-4, 0, 3], [5, 8, 12], [7, 11, 14]], bass: 'roll', arp: 'sawtooth' },
};
const MOOD_KEYS = Object.keys(MOODS);

const BASS = {
  roll:   [_, 0, 0, 12, _, 0, 0, 12, _, 0, 0, 12, _, 0, 12, 7],
  gallop: [0, _, 0, 0, 0, _, 0, 0, 0, _, 0, 0, 0, _, 12, 0],
  slap:   [0, _, _, 0, _, _, 12, _, _, 0, _, 10, 12, _, 7, _],
};
const FUNK_KICK = [1, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0];
const ARPS = [
  [0, 1, 2, 3, 1, 2, 3, 4, 2, 3, 4, 5, 3, 4, 5, 4],
  [0, 2, 1, 3, 2, 4, 3, 5, 4, 2, 3, 1, 2, 0, 1, -1],
  [0, 0, 3, 0, 2, 0, 4, 0, 0, 0, 3, 0, 5, 4, 3, 2],
  [5, 4, 3, 2, 1, 2, 3, 4, 5, 4, 3, 2, 3, 2, 1, 0],
];

function makeTrack(id, fadeIn) {
  const out = ctx.createGain(), t = now();
  out.gain.setValueAtTime(0.0001, t);
  out.gain.linearRampToValueAtTime(0.7, t + Math.max(0.02, fadeIn));
  out.connect(musicDuck);
  return {
    id, bpm: 120, swing: 0, step: 0, next: t + 0.05, stopAt: 0, out, nodes: [out], play: null,
    bus(v = 1, to = out) { const g = gainNode(v, to); this.nodes.push(g); return g; },
    keep(...n) { this.nodes.push(...n); return n[0]; },
  };
}

// Dotted-8th feedback delay; returns its input.
function delayBus(tr, sixteenths, fb = 0.3, mix = 0.22) {
  const inp = tr.bus(1, null), dl = ctx.createDelay(1), lp = ctx.createBiquadFilter(), fbg = tr.bus(fb, dl);
  dl.delayTime.value = Math.min(0.95, (60 / tr.bpm / 4) * sixteenths);
  lp.type = 'lowpass'; lp.frequency.value = 2600;
  inp.connect(dl); dl.connect(lp); lp.connect(fbg); lp.connect(tr.bus(mix));
  tr.keep(dl, lp);
  return inp;
}

function shaperBus(tr, k, to) {
  const sh = ctx.createWaveShaper();
  sh.curve = driveCurve(k); sh.oversample = '2x';
  sh.connect(to);
  return tr.keep(sh);
}

const TRACKS = {
  // Hotline-style menu: detuned pad, slow arp, gated-reverb snare, sub.
  title(tr) {
    tr.bpm = 100;
    const R = 45, CH = [[0, 3, 7], [-4, 0, 3], [3, 7, 10], [-2, 2, 5]];
    const drums = tr.bus(0.9), pump = tr.bus(1), syn = tr.bus(0.8);
    const echo = delayBus(tr, 3, 0.35, 0.3);
    syn.connect(echo);
    // gated reverb: a private convolver whose return opens only for 200 ms per snare
    const gIn = tr.bus(1, null), conv = ctx.createConvolver(), gate = tr.bus(0);
    conv.buffer = irBuf; gIn.connect(conv); conv.connect(gate); tr.keep(conv);
    return (s, t, six) => {
      const bar = s >> 4, st = s & 15, ch = CH[(bar >> 1) & 3], r = R + ch[0];
      if (st === 0 && !(bar & 1)) pad(t, [...ch.map((x) => R + 12 + x), R + 24 + ch[0]], six * 32, pump, { a: 0.9, r: 1.2, v: 0.028, cut: 1100, send: 0.35 });
      if (st === 0) tone(mtof(r - 12), t, { dur: six * 16, a: 0.03, hold: six * 13, gain: 0.35, detune: DT, dest: pump });
      if (bar >= 1 && (st === 0 || st === 8)) { drum.kick(t, drums, 0.9); pumpAt(pump, t, 0.5, six * 3); }
      if (bar >= 1 && (st === 4 || st === 12)) {
        drum.snare(t, drums, 0.75, 0.05);
        drum.snare(t, gIn, 1.2, 0);
        gate.gain.setValueAtTime(1, t); gate.gain.setValueAtTime(1, t + 0.2); gate.gain.linearRampToValueAtTime(0, t + 0.23);
      }
      if (bar >= 1 && st % 4 === 2) drum.hat(t, drums, 0.45);
      if (st % 4 === 0 && bar >= 2) bassNote(t, r - 12 + (st === 12 ? 12 : 0), six * 3, pump, { cut: 520, v: 0.6 });
      if (st % 2 === 0 && bar >= 2) {
        const i = [0, 1, 2, 3, 4, 3, 2, 1][(st >> 1) & 7];
        pluck(t, R + 24 + chordTone(ch, i), six * 1.8, syn, { type: 'square', v: 0.045, cut: 2200, cut1: 500, Q: 3, send: 0.4 });
      }
    };
  },

  // The fight: four-on-the-floor, pumped bass, arps, fills. Layers follow intensity.
  fight(tr, o) {
    const mood = MOODS[o.mood] ? o.mood : 'drive', M = MOODS[mood], mi = MOOD_KEYS.indexOf(mood);
    tr.bpm = clamp(o.bpm || M.bpm, 70, 200);
    if (mood === 'boss') tr.bpm = Math.max(tr.bpm, 142);
    const R = clamp(Math.round(o.root ?? 45), 33, 57);
    const drums = tr.bus(0.95), pump = tr.bus(1), bassIn = tr.bus(1, pump);
    const driveG = tr.bus(0, pump);
    bassIn.connect(shaperBus(tr, 6, driveG));
    const syn = tr.bus(0.9), echo = delayBus(tr, 3, 0.3, 0.2);
    syn.connect(echo);
    let leadIn = syn;
    let choirIn = null;
    if (mood === 'boss') {
      leadIn = tr.bus(1, null);
      leadIn.connect(shaperBus(tr, 8, tr.bus(0.5, syn)));
      choirIn = tr.bus(1, null);
      const choirOut = tr.bus(1, pump);
      for (const [f, q, g] of [[730, 6, 1.4], [1090, 8, 0.9], [2440, 10, 0.5]]) {
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = q;
        choirIn.connect(bp); bp.connect(tr.bus(g, choirOut)); tr.keep(bp);
      }
    }
    let motif = null, motifSec = -1;

    return (s, t, six) => {
      const bar = s >> 4, st = s & 15, sec = bar >> 3, bis = bar & 7;
      const ch = M.chords[bar & 3], w35 = w(0.35), w70 = w(0.7), wMax = w(0.92);
      const fill = bis === 7 && st >= 8 && w70 > 0;

      // kick + sidechain
      if (mood === 'funk' ? FUNK_KICK[st] || (bar & 1 && st === 14) : st % 4 === 0) {
        drum.kick(t, drums, 1);
        pumpAt(pump, t, mood === 'funk' ? 0.5 : 0.85, six * 2.5);
      }
      if (st === 0) driveG.gain.setTargetAtTime(wMax * 0.6, t, 0.2);

      // backbeat, ghosts, fills
      if (fill) {
        if (st >= 12 || !(st & 1)) drum.snare(t, drums, (0.4 + ((st - 8) / 8) * 0.6) * w70, 0.1);
      } else if ((st === 4 || st === 12) && w35 > 0) {
        drum.snare(t, drums, 0.85 * w35);
        if (mood !== 'funk' || st === 12) drum.clap(t, drums, 0.7 * w35);
      } else if (mood === 'funk' && (st === 7 || st === 9) && w70 > 0) {
        drum.snare(t, drums, 0.2 * w70, 0);
      }
      if (st === 0 && bar > 0 && w35 > 0 && (bis === 0 || wMax > 0)) drum.crash(t, drums, (bis === 0 ? 0.7 : 0.35) * Math.max(w35, wMax));

      // hats: open on off-beats, closed 8ths, 16ths when hot
      if (w35 > 0 && !fill) {
        if (st % 4 === 2) drum.hat(t, drums, 0.9 * w35, true);
        else if (!(st & 1) || w70 > 0) drum.hat(t, drums, ((st & 1) ? 0.3 + 0.3 * wMax : 0.6) * w35);
      }

      // bass
      const bp = BASS[M.bass][st];
      if (bp !== null) {
        const m = R - 12 + ch[0] + bp;
        if (mood === 'funk') bassNote(t, m, six * 1.6, bassIn, { cut: bp === 12 ? 3200 : 2200, cut1: 220, ft: 0.4, Q: 9, v: bp === 12 ? 1.1 : 0.9 });
        else bassNote(t, m, six * (mood === 'dark' ? 0.9 : 1.1), bassIn, { cut: 700 + 900 * intensity, v: 0.9 });
      }

      // pads / choir
      if (st === 0 && w35 > 0) {
        if (choirIn) {
          for (const x of ch) for (const d of [-12, 12]) tone(mtof(R + 12 + x), t, { type: 'sawtooth', dur: six * 16, a: 0.25, hold: six * 12, gain: 0.09 * w35, detune: DT + d, dest: choirIn, send: 0.3 });
        } else {
          pad(t, ch.map((x) => R + 12 + x), six * 16, pump, { a: 0.05, r: 0.3, v: 0.016 * w35, cut: 900 + 900 * intensity, send: 0.2 });
        }
      }

      // arps (funk: muted plucks)
      if (w35 > 0) {
        if (mood === 'funk') {
          if ([2, 5, 10, 13].includes(st)) for (const x of ch.slice(1, 3)) pluck(t, R + 12 + x, six * 0.7, syn, { type: 'square', cut: 1800, cut1: 300, Q: 2, v: 0.05 * w35 });
        } else {
          const i = ARPS[(sec + mi) & 3][st];
          if (i >= 0) pluck(t, R + 24 + chordTone(ch, i), six * 0.9, syn, { type: M.arp, cut: 1200 + 2600 * intensity, cut1: 350, Q: 7, v: 0.065 * w35, pan: st & 1 ? 0.25 : -0.25 });
        }
      }

      // lead: new motif every 8 bars, rests one section in four unless maxed
      if (w70 > 0 && (sec % 4 !== 3 || wMax > 0)) {
        if (sec !== motifSec) { motifSec = sec; motif = makeMotif(sec * 7919 + mi * 131 + R); }
        const n = motif.get((bis & 1) * 16 + st);
        if (n) {
          const lift = bis >= 6 ? 2 : 0;
          lead(t, R + 24 + degree(M.scale, n.deg + lift), n.len * six * 0.9, leadIn, { type: mood === 'boss' ? 'sawtooth' : 'square', v: (mood === 'boss' ? 0.1 : 0.06) * w70, cut: 2400 + 2000 * wMax });
        }
      }
    };
  },

  // Performance review: lo-fi swung groove, FM rhodes, vinyl crackle.
  results(tr) {
    tr.bpm = 88; tr.swing = 0.22;
    const R = 50, CH = [[0, 3, 7, 10, 14], [5, 9, 12, 15, 19], [-2, 2, 5, 9, 12], [7, 11, 14, 17, 20]];
    const lofi = tr.bus(1, null), lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 4200; lofi.connect(lp); lp.connect(tr.out); tr.keep(lp);
    const drums = tr.bus(0.8, lofi), keys = tr.bus(1, lofi), bass = tr.bus(0.9);
    return (s, t, six) => {
      const bar = s >> 4, st = s & 15, ch = CH[bar & 3];
      if (st === 0) ch.forEach((x, k) => fmKey(t + k * 0.014, R + x - (x > 14 ? 12 : 0), six * 14, keys, { v: 0.045, send: 0.25 }));
      if (st === 10 && bar & 1) ch.slice(2).forEach((x) => fmKey(t, R + x - (x > 14 ? 12 : 0), six * 5, keys, { v: 0.03 }));
      if (st === 0 || st === 10) drum.kick(t, drums, 0.75);
      if (st === 7 && bar & 1) drum.kick(t, drums, 0.4);
      if (st === 4 || st === 12) drum.snare(t, drums, 0.55, 0.25);
      drum.hat(t, drums, st & 1 ? 0.18 : 0.38);
      if (st === 0) bassNote(t, R - 12 + ch[0], six * 9, bass, { cut: 400, v: 0.8 });
      if (st === 10) bassNote(t, R - 12 + ch[0] + 7, six * 4, bass, { cut: 400, v: 0.6 });
      if (st === 14) bassNote(t, R - 12 + CH[(bar + 1) & 3][0] - 1, six * 2, bass, { cut: 400, v: 0.5 });
      if (Math.random() < 0.35) noise(t + Math.random() * six, { dur: 0.004, gain: rnd(0.02, 0.07), dest: tr.out, filter: { type: 'highpass', f: 2000 } });
    };
  },

  // Floor select: cheesy bossa muzak. I–vi–ii–V, FM piano comping, brushes, walking bass, flute.
  elevator(tr) {
    tr.bpm = 116;
    const R = 53; // F
    const CH = [[0, 4, 7, 11, 14], [-3, 0, 4, 7, 11], [2, 5, 9, 12, 16], [7, 11, 14, 17, 20]];
    const ROOTS = [0, -3, 2, -5];
    const COMP = [[0, 3, 6, 10, 13], [2, 6, 8, 12]];
    const MEL = [
      [[0, 11, 6], [6, 9, 2], [8, 7, 4], [12, 4, 4]],
      [[0, 7, 6], [6, 5, 2], [8, 4, 8]],
      [[0, 5, 4], [4, 9, 4], [8, 12, 4], [12, 14, 4]],
      [[0, 13, 6], [6, 12, 2], [8, 10, 4], [12, 7, 4]],
      [[0, 16, 6], [6, 14, 2], [8, 12, 4], [12, 11, 4]],
      [[0, 9, 6], [6, 7, 2], [8, 4, 6], [14, 5, 2]],
      [[0, 2, 4], [4, 5, 4], [8, 9, 6], [14, 7, 2]],
      [[0, 10, 4], [4, 7, 4], [8, 4, 4], [12, -1, 4]],
    ];
    const kit = tr.bus(0.7), keys = tr.bus(0.9), bass = tr.bus(1), mel = tr.bus(0.8);
    return (s, t, six) => {
      const bar = s >> 4, st = s & 15, ci = bar & 3, ch = CH[ci], root = R - 12 + ROOTS[ci];
      if (COMP[bar & 1].includes(st)) ch.forEach((x) => fmKey(t, R + x, six * 2.2, keys, { v: 0.03, index: 1.6, send: 0.2 }));
      const walk = { 0: [0, 6], 6: [7, 2], 8: [7, 4], 12: [12, 2], 14: [ROOTS[(ci + 1) & 3] + 1, 2] }[st];
      if (walk) tone(mtof(root + walk[0]), t, { type: 'triangle', dur: six * walk[1] * 0.95, gain: 0.35, detune: DT, dest: bass, filter: { type: 'lowpass', f: 900, f1: 300 } });
      noise(t, { dur: 0.06, gain: st % 4 === 0 ? 0.06 : 0.035, dest: kit, filter: { type: 'bandpass', f: 4000, Q: 0.7 } });
      if (st === 0 || st === 8) noise(t, { dur: six * 6, a: six * 3, gain: 0.04, dest: kit, filter: { type: 'bandpass', f: 2500, f1: 5000, Q: 1 } });
      if (st === 0 || st === 8) drum.kick(t, kit, 0.4);
      if ((bar & 1 ? [4, 10] : [0, 6, 12]).includes(st)) drum.rim(t, kit, 0.8);
      // melody: flute on the first 8 bars, flute + vibes an octave up on the next 8
      const note = MEL[bar & 7].find((n) => n[0] === st);
      if (note) {
        const m = R + 12 + note[1], d = note[2] * six;
        lead(t, m, d * 0.9, mel, { type: 'sine', v: 0.09, vib: 22, vibHz: 5, cut: 3000, send: 0.35 });
        if ((bar >> 3) & 1) fmKey(t, m + 12, d * 1.5, mel, { ratio: 4, index: 1.2, v: 0.04, send: 0.3 });
      }
    };
  },

  // YOU'RE FIRED: slow, sad, detuned, almost nothing.
  fired(tr) {
    tr.bpm = 66;
    const R = 45, CH = [[0, 3, 7], [5, 8, 12], [-4, 0, 3], [-5, -1, 2]];
    const MEL = [[[0, 7, 8], [8, 5, 8]], [[0, 3, 16]], [[0, 5, 8], [8, 3, 8]], [[0, 8, 12], [12, 7, 4]],
      [[0, 3, 8], [8, 0, 8]], [[0, -2, 16]], [[0, 2, 8], [8, -1, 8]], [[0, -5, 16]]];
    const body = tr.bus(1), mel = tr.bus(0.8);
    return (s, t, six) => {
      const bar = s >> 4, st = s & 15, ch = CH[(bar >> 1) & 3];
      if (st === 0 && !(bar & 1)) {
        pad(t, ch.map((x) => R + 12 + x), six * 32, body, { a: 1.2, r: 1.5, v: 0.024, det: 22, cut: 750, send: 0.45 });
        tone(mtof(R - 12 + ch[0]), t, { dur: six * 32, a: 0.3, hold: six * 26, gain: 0.25, detune: DT, dest: body });
      }
      if (st === 0) drum.kick(t, body, 0.45);
      const note = MEL[bar & 7].find((n) => n[0] === st);
      if (note) lead(t, R + 24 + note[1], note[2] * six * 0.95, mel, { type: 'triangle', v: 0.07, vib: 30, vibHz: 4.5, cut: 1600, send: 0.55 });
    };
  },
};

function stopTrack(tr, fade) {
  if (tr.stopAt) return;
  const t = now(), g = tr.out.gain;
  tr.stopAt = t + Math.max(0.02, fade);
  g.cancelScheduledValues(t);
  g.setValueAtTime(Math.max(0.0001, g.value), t);
  g.linearRampToValueAtTime(0.0001, tr.stopAt);
}

function playMusic(id, opts = {}) {
  opts = opts || {};
  if (!ctx) { pending = [id, opts]; return; }
  const make = TRACKS[id];
  if (!make) return;
  if (opts.intensity != null) intensity = clamp(opts.intensity);
  const key = id + JSON.stringify(opts);
  if (current && current.key === key && !current.stopAt) return;
  if (current) stopTrack(current, 0.8);
  const tr = makeTrack(id, opts.fadeIn ?? (id === 'fight' ? 0.03 : current ? 0.6 : 0.3));
  tr.key = key;
  tr.play = make(tr, opts);
  tracks.push(tr);
  current = tr;
}

function stopMusic(fade = 0.6) {
  pending = null;
  if (current) stopTrack(current, fade);
  current = null;
}

function tick() {
  if (!ctx) return;
  const t0 = ctx.currentTime, wall = performance.now();
  if (dbg.lastTick && wall - dbg.lastTick > 150) note(`timer stalled ${Math.round(wall - dbg.lastTick)} ms`);
  dbg.lastTick = wall;
  for (let i = tracks.length - 1; i >= 0; i--) {
    const tr = tracks[i];
    if (tr.stopAt && t0 > tr.stopAt + 3) { tr.nodes.forEach(disc); tracks.splice(i, 1); continue; }
    if (tr.next < t0 - 0.25) { if (!tr.stopAt) note(`${tr.id} music skipped ahead`); tr.next = t0 + 0.02; } // tab was throttled: skip ahead, don't burst
    while (tr.next < t0 + LOOKAHEAD && !(tr.stopAt && tr.next >= tr.stopAt)) {
      const six = 60 / (tr.bpm * tempoMul) / 4;
      const swing = tr.step & 1 ? tr.swing * six : 0;
      try { tr.play(tr.step, tr.next + swing, six); } catch { /* one bad step must not kill the loop */ }
      tr.step++;
      tr.next += six;
    }
  }
}

// Reactive drum hit on the music bus, snapped to the next 16th if it is close.
function musicAccent(big) {
  const tr = current;
  if (!tr || tr.stopAt) return;
  const six = 60 / (tr.bpm * tempoMul) / 4, t0 = now();
  let t = tr.next;
  while (t - six > t0 + 0.005) t -= six;
  if (t - t0 > 0.07 || t < t0) t = t0 + 0.005;
  if (big) { drum.crash(t, accentIn, 1, 0.35); drum.kick(t, accentIn, 0.8); }
  else drum.snare(t, accentIn, 1, 0.25);
}

// ───────────────────────────── stingers ─────────────────────────────

// Sad-trombone note: detuned saws through a lowpass that opens then closes ("wah").
function wah(t, m, dur, wobble) {
  const f = mtof(m), fl = ctx.createBiquadFilter(), g = ctx.createGain(), nodes = [fl, g];
  fl.type = 'lowpass'; fl.Q.value = 6;
  fl.frequency.setValueAtTime(300, t);
  fl.frequency.exponentialRampToValueAtTime(1500, t + Math.min(0.14, dur * 0.3));
  fl.frequency.exponentialRampToValueAtTime(450, t + dur);
  envelope(g.gain, t, 0.03, 0.2, dur * 0.6, dur);
  fl.connect(g); g.connect(sfxBus);
  sendTo(g, 0.2, nodes);
  const srcs = [-8, 8].map((d) => {
    const o = ctx.createOscillator();
    o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = d;
    o.connect(fl); nodes.push(o);
    return o;
  });
  if (wobble) {
    const lfo = ctx.createOscillator(), lg = gainNode(0);
    lfo.frequency.value = 6;
    lg.gain.setValueAtTime(0, t); lg.gain.linearRampToValueAtTime(45, t + 0.4);
    lfo.connect(lg); srcs.forEach((o) => lg.connect(o.detune));
    srcs.push(lfo); nodes.push(lfo, lg);
  }
  for (const o of srcs) { o.start(t); o.stop(t + dur + 0.05); }
  done(srcs[0], nodes);
}

function stinger(kind) {
  const t = now() + 0.005;
  switch (kind) {
    case 'fight':
      tone(90, t, { f1: 32, glide: 0.4, dur: 0.7, gain: 0.9 });
      drum.kick(t, sfxBus, 1); drum.clap(t, sfxBus, 1, 0.4); drum.crash(t, sfxBus, 1, 0.4);
      stab(t, [45, 52, 57, 60, 64], { dur: 0.8, cut: 7000, cut1: 300, v: 0.05, send: 0.45 });
      break;
    case 'ko':
      drum.kick(t, sfxBus, 1.1); drum.crash(t, sfxBus, 1.2, 0.6);
      stab(t, [33, 45, 52, 57, 61, 64, 69], { dur: 2.6, a: 0.01, cut: 6000, cut1: 500, ft: 2.2, v: 0.045, send: 0.7 });
      bellTone(t, 220, { decay: 3.5, gain: 0.12, send: 0.6 });
      tone(55, t, { f1: 30, glide: 1.5, dur: 2.2, gain: 0.7 });
      break;
    case 'knockdown':
      [57, 55, 52].forEach((m, i) => stab(t + i * 0.13, [m - 12, m, m + 3], { dur: i === 2 ? 0.9 : 0.2, cut: 4000, cut1: 300, v: 0.05, send: 0.35 }));
      drum.kick(t, sfxBus, 1); drum.kick(t + 0.26, sfxBus, 1);
      break;
    case 'perfect':
      [84, 88, 91, 96].forEach((m, i) => {
        tone(mtof(m), t + i * 0.045, { type: 'triangle', dur: 0.7, gain: 0.08, send: 0.55, pan: -0.4 + i * 0.27 });
        tone(mtof(m + 12), t + i * 0.045, { dur: 0.5, gain: 0.03, send: 0.55 });
      });
      break;
    case 'levelup':
      [60, 64, 67, 72, 76, 79, 84].forEach((m, i) => tone(mtof(m), t + i * 0.055, { type: 'square', dur: i === 6 ? 0.8 : 0.12, gain: 0.06, send: 0.3, filter: { type: 'lowpass', f: 5000 } }));
      stab(t + 0.39, [48, 60, 64, 67, 71], { dur: 0.9, cut: 6000, cut1: 800, v: 0.04, send: 0.5 });
      break;
    case 'fired':
      [[55, 0.42], [54, 0.42], [53, 0.42], [52, 1.4]].reduce((tt, [m, d], i) => { wah(tt, m, d, i === 3); return tt + d + 0.06; }, t);
      break;
    case 'grade':
      drum.kick(t, sfxBus, 1); drum.clap(t, sfxBus, 0.9, 0.3); drum.crash(t, sfxBus, 0.6, 0.3);
      stab(t, [48, 55, 59, 62, 64], { type: 'square', dur: 0.5, cut: 7000, cut1: 600, v: 0.035, send: 0.35 });
      stab(t, [36], { dur: 0.5, cut: 900, v: 0.12, send: 0 });
      break;
  }
}

// ───────────────────────────── sfx ─────────────────────────────

function punch(strength = 0.5, kind = 'jab') {
  const s = clamp(strength), t = now() + 0.002, amp = 0.45 + 0.55 * s;
  const heavy = kind === 'haymaker' || kind === 'counter';
  const low = (heavy ? 95 : kind === 'cross' ? 125 : 150) + rnd(-10, 10);
  tone(low + 60 * s, t, { f1: 38, glide: 0.07 + 0.05 * s, dur: 0.16 + 0.14 * s, gain: 1.0 * amp, a: 0.001 });        // thump
  noise(t, { dur: 0.07 + 0.05 * s, gain: 0.7 * amp, filter: { type: 'lowpass', f: 1400 + 800 * s, f1: 300 } });       // flesh
  noise(t, { dur: 0.045 + 0.04 * s, gain: 0.7 * amp * (0.6 + 0.4 * s), send: 0.08 + 0.2 * s,                         // crack
    filter: [{ type: 'bandpass', f: rnd(2200, 3200), Q: 0.9 }, { type: 'highpass', f: 900 }] });
  tone(rnd(2500, 3500), t, { type: 'square', f1: 800, glide: 0.006, dur: 0.012, gain: 0.12 * amp, a: 0.0005, filter: { type: 'highpass', f: 1500 } }); // click
  if (heavy) {
    noise(t + 0.004, { dur: 0.15, gain: 0.55 * amp, send: 0.35, filter: { type: 'bandpass', f: 1300, f1: 600, Q: 1.2 } });
    tone(70, t, { f1: 26, glide: 0.4, dur: 0.6, gain: 0.8 * amp });
    tone(rnd(4200, 5200), t, { type: 'square', dur: 0.02, gain: 0.06, filter: { type: 'highpass', f: 3000 } });
  }
  if (s > 0.6) musicAccent(s > 0.85 || heavy);
}

// Leather on leather. The body lives below 1 kHz, which laptop speakers barely play,
// so the slap and squeak up top are what the player actually hears.
function block() {
  const t = now();
  tone(130 + rnd(-10, 10), t, { f1: 70, glide: 0.05, dur: 0.12, gain: 0.6 });                                 // thud
  noise(t, { dur: 0.1, gain: 0.5, filter: { type: 'lowpass', f: 900, f1: 250, Q: 1.5 } });                    // padding
  noise(t, { dur: 0.05, gain: 0.8, send: 0.06, filter: [{ type: 'bandpass', f: rnd(1500, 1900), Q: 1.4 }, { type: 'highpass', f: 700 }] }); // slap
  tone(rnd(620, 720), t, { type: 'triangle', f1: 380, glide: 0.04, dur: 0.06, gain: 0.18, a: 0.001 });       // leather squeak
}

function whiff() {
  noise(now(), { dur: 0.2, a: 0.05, gain: 0.7, pan: rnd(-0.4, 0.4), filter: { type: 'bandpass', f: 500, f1: 2600, Q: 1.8 } });
}

function dodge() {
  const t = now();
  noise(t, { dur: 0.14, a: 0.03, gain: 0.55, filter: { type: 'bandpass', f: 1400, f1: 350, Q: 1.5 } });
  tone(110, t, { f1: 70, dur: 0.1, gain: 0.12 });
}

function playerHit(strength = 0.6) {
  const s = clamp(strength), t = now(), amp = 0.5 + 0.5 * s;
  tone(80 + 30 * s, t, { f1: 32, glide: 0.2, dur: 0.35 + 0.2 * s, gain: 0.9 * amp, a: 0.001 });
  noise(t, { dur: 0.2, gain: 0.6 * amp, filter: { type: 'lowpass', f: 900, f1: 150 } });
  noise(t, { dur: 0.05, gain: 0.25 * amp, filter: { type: 'bandpass', f: 1800, Q: 1 } });
  const f = rnd(3600, 4400), ring = 0.6 + 0.9 * s;   // tinnitus, with a slow beat
  tone(f, t + 0.03, { dur: ring, a: 0.08, gain: 0.02 + 0.05 * s, pan: rnd(-0.3, 0.3) });
  tone(f * 1.004, t + 0.03, { dur: ring * 0.9, a: 0.1, gain: 0.01 + 0.025 * s });
  duck(0.3 + 0.4 * s, 0.4 + 0.6 * s);
}

function perfect() {
  const t = now();
  noise(t, { dur: 0.42, a: 0.36, gain: 0.25, send: 0.5, filter: { type: 'bandpass', f: 1500, f1: 7000, Q: 1.2 } });
  for (const m of [84, 91, 96]) tone(mtof(m), t, { type: 'triangle', dur: 0.4, a: 0.36, gain: 0.04, send: 0.5 });
  bellTone(t + 0.37, 1760, { ratios: [1, 2, 3, 4.16], decay: 1.4, gain: 0.12, send: 0.6 });
}

function tell(kind) {
  const t = now();
  switch (kind) {
    case 'jab':
      tone(1760, t, { type: 'triangle', dur: 0.09, gain: 0.4 });
      tone(3520, t, { dur: 0.05, gain: 0.1 });
      break;
    case 'hook':
      tone(988, t, { type: 'square', dur: 0.08, gain: 0.18, filter: { type: 'lowpass', f: 3000 } });
      tone(1480, t + 0.08, { type: 'square', dur: 0.12, gain: 0.18, filter: { type: 'lowpass', f: 3000 } });
      break;
    case 'upper':
      tone(300, t, { type: 'sawtooth', f1: 1600, glide: 0.22, dur: 0.26, a: 0.02, gain: 0.3, filter: { type: 'lowpass', f: 900, f1: 5000, Q: 5 } });
      break;
    case 'smash':
      for (const d of [-15, 15]) tone(55, t, { type: 'sawtooth', f1: 45, dur: 0.45, a: 0.04, gain: 0.25, detune: d, filter: { type: 'lowpass', f: 700, f1: 180, Q: 8 } });
      tone(27.5, t, { type: 'square', dur: 0.45, a: 0.04, gain: 0.15, filter: { type: 'lowpass', f: 200 } });
      break;
    case 'throw':
      tone(1100, t, { f1: 2300, glide: 0.25, dur: 0.32, a: 0.02, gain: 0.25 });
      tone(2200, t, { f1: 4600, glide: 0.25, dur: 0.3, a: 0.02, gain: 0.04 });
      break;
    case 'flurry':
      for (let i = 0; i < 3; i++) tone(1320 + i * 110, t + i * 0.065, { type: 'triangle', dur: 0.06, gain: 0.2 });
      break;
    case 'special':
      for (let i = 0; i < 4; i++) tone(i & 1 ? 950 : 700, t + i * 0.09, { type: 'square', dur: 0.085, hold: 0.06, gain: 0.08, filter: { type: 'lowpass', f: 2500 } });
      break;
  }
}

function bell(times = 1) {
  const t = now();
  for (let i = 0; i < Math.max(1, Math.min(10, times | 0)); i++) {
    const tt = t + i * 0.32;
    bellTone(tt, 640, { decay: 2.4, gain: 0.22, send: 0.35 });
    noise(tt, { dur: 0.012, gain: 0.3, filter: { type: 'highpass', f: 3000 } });
  }
}

function count(n = 1) {
  const t = now(), k = clamp(n, 1, 10);
  noise(t, { dur: 0.05, gain: 0.5, filter: { type: 'lowpass', f: 1200 } });
  tone(170, t, { f1: 90, dur: 0.08, gain: 0.5 });
  const f0 = 130 + (k === 10 ? 40 : k * 2);
  vox(t + 0.06, { f0, f1: f0 * 0.85, dur: 0.2, gain: 0.35, send: 0.15, formants: [[500, 6, 1.6, 700], [900, 8, 1, 1100], [2400, 10, 0.4]] });
}

function knockdown() {
  const t = now();
  tone(95, t, { f1: 28, glide: 0.35, dur: 0.7, gain: 1, a: 0.001 });
  noise(t, { dur: 0.35, gain: 0.7, send: 0.3, filter: { type: 'lowpass', f: 600, f1: 80 } });
  tone(70, t, { type: 'triangle', f1: 64, dur: 0.6, gain: 0.1 });
  for (let i = 0; i < 7; i++) noise(t + 0.03 + Math.random() * 0.3, { dur: rnd(0.03, 0.07), gain: 0.12 * (1 - i / 8), filter: { type: 'bandpass', f: rnd(2000, 4000), Q: 3 } });
}

// Crowd shouts: [duration range, pitch end ratio, vowel formants]. hey = short "eh", yeah = "eh" opening
// to "ah" as it falls, woo = rounded "oo" that rises.
const SHOUTS = [
  [[0.22, 0.35], 0.85, [[550, 6, 1.4], [1800, 9, 0.5], [2600, 10, 0.15]]],
  [[0.35, 0.6], 0.75, [[450, 6, 1.4, 750], [1900, 9, 0.5, 1200], [2600, 10, 0.15]]],
  [[0.4, 0.75], 1.35, [[320, 6, 1.6], [800, 8, 0.5], [2400, 10, 0.08]]],
];

// Long filtered noise alone reads as static, so the cheer is built from pitched voices: a low and a
// high "ahh" roar that swells over the whole cheer, scattered shouts, and a quiet dark murmur for body.
function cheerAt(t, s, dur) {
  for (const f0 of [rnd(140, 170), rnd(260, 310)]) {
    vox(t, { f0, f1: f0 * 0.85, dur, a: dur * 0.25, hold: dur * 0.2, voices: 6, spread: 0.12, gain: 0.065 + 0.08 * s, send: 0.2,
      formants: [[700, 5, 1.4], [1150, 6, 0.6], [2500, 8, 0.08]] });
  }
  const shouts = Math.round((3 + 7 * s) * Math.min(dur, 3) / 2);
  for (let i = 0; i < shouts; i++) {
    const [[d0, d1], end, formants] = SHOUTS[Math.floor(Math.random() * SHOUTS.length)];
    const f0 = Math.random() < 0.5 ? rnd(170, 260) : rnd(280, 420);
    vox(t + rnd(0, dur * 0.6), { f0, f1: f0 * end, dur: rnd(d0, d1), a: 0.04, voices: 2, spread: 0.03,
      gain: rnd(0.04, 0.08) * (0.6 + 0.6 * s), pan: rnd(-0.8, 0.8), send: 0.15, formants });
  }
  noise(t, { dur, a: dur * 0.2, hold: dur * 0.2, gain: 0.1 + 0.12 * s, filter: [{ type: 'lowpass', f: 900 }, { type: 'highpass', f: 150 }] });
  if (s > 0.5) {
    for (let i = 0; i < 1 + Math.round(s * 2); i++) {
      const f = rnd(1700, 2300);
      tone(f, t + rnd(0.1, 0.7), { f1: f * 1.3, glide: 0.3, dur: 0.5, a: 0.08, gain: 0.025, pan: rnd(-0.7, 0.7) });
    }
  }
}

function cheer(strength = 0.6) {
  const s = clamp(strength);
  cheerAt(now(), s, 1.2 + 1.6 * s);
}

function ooh() {
  vox(now(), { f0: 230, f1: 150, dur: 1.1, a: 0.15, voices: 6, spread: 0.06, gain: 0.35, send: 0.3,
    formants: [[500, 5, 1.8, 330], [900, 6, 1, 750], [2400, 8, 0.25]] });
}

function crowdStart() {
  if (crowd) return;
  const t = now(), src = ctx.createBufferSource(), mix = ctx.createGain(), lvl = gainNode(0);
  const nodes = [src, mix, lvl];
  src.buffer = noiseBuf; src.loop = true;
  for (const [f, q, g] of [[500, 1, 1], [1400, 1.2, 0.7], [2600, 2, 0.35]]) {
    const bp = biquad({ type: 'bandpass', f, Q: q }, t, 1), bg = gainNode(g, mix);
    src.connect(bp); bp.connect(bg); nodes.push(bp, bg);
  }
  mix.gain.value = 0.8;
  const lfos = [[0.17, 0.2], [0.41, 0.12], [1.3, 0.05]].map(([hz, depth]) => {
    const o = ctx.createOscillator(), g = gainNode(depth, mix.gain);
    o.frequency.value = hz * rnd(0.8, 1.2); o.connect(g); o.start(t);
    nodes.push(o, g);
    return o;
  });
  mix.connect(lvl); lvl.connect(sfxBus);
  src.start(t, Math.random() * 2);
  crowd = { src, lvl, lfos, nodes, level: 0.5 };
  lvl.gain.setTargetAtTime(crowd.level * 0.45, t, 0.4);
}

function crowdStop() {
  if (!crowd) return;
  const c = crowd, t = now();
  crowd = null;
  c.lvl.gain.cancelScheduledValues(t);
  c.lvl.gain.setTargetAtTime(0, t, 0.2);
  for (const o of [c.src, ...c.lfos]) o.stop(t + 1.2);
  done(c.src, c.nodes);
}

function setCrowd(level) {
  if (!crowd) return;
  crowd.level = clamp(level);
  crowd.lvl.gain.setTargetAtTime(crowd.level * 0.45, now(), 0.3);
}

function ko() {
  const t = now();
  tone(80, t, { f1: 18, glide: 1.4, dur: 2.2, gain: 1, a: 0.001 });
  tone(160, t, { type: 'triangle', f1: 40, glide: 0.3, dur: 0.5, gain: 0.5 });
  noise(t, { dur: 1.4, gain: 0.8, send: 0.9, filter: { type: 'lowpass', f: 3000, f1: 120 } });
  noise(t, { dur: 0.08, gain: 0.5, filter: { type: 'highpass', f: 2000 } });
  duck(0.8, 1.5);
  cheerAt(t + 0.1, 1, 4);
  cheerAt(t + 0.6, 0.8, 3.2);
}

function teeth() {
  let t = now();
  for (let i = 0; i < 6; i++) {
    tone(rnd(2800, 5200), t, { type: 'square', dur: 0.012, gain: 0.05, pan: rnd(-0.5, 0.5), filter: { type: 'highpass', f: 2000 } });
    noise(t, { dur: 0.008, gain: 0.12, filter: { type: 'highpass', f: 4000 } });
    t += rnd(0.025, 0.05);
  }
}

function paper() {
  const t = now();
  noise(t, { dur: 0.45, a: 0.05, gain: 0.06, filter: { type: 'highpass', f: 3000 } });
  for (let i = 0; i < 14; i++) noise(t + i * 0.028 + Math.random() * 0.02, { dur: rnd(0.02, 0.05), gain: rnd(0.08, 0.18), filter: { type: 'bandpass', f: rnd(2500, 6000), Q: 1.5 } });
}

function cash() {
  const t = now();
  noise(t, { dur: 0.04, gain: 0.4, filter: { type: 'bandpass', f: 1500, Q: 2 } });
  tone(200, t, { f1: 80, dur: 0.06, gain: 0.3 });
  noise(t + 0.08, { dur: 0.15, gain: 0.15, filter: { type: 'bandpass', f: 3000, Q: 4 } });
  bellTone(t + 0.12, 2093, { ratios: [1, 2.4, 3.9, 5.3], decay: 1.1, gain: 0.1, send: 0.3 });
  bellTone(t + 0.16, 2637, { ratios: [1, 2.4, 3.9], decay: 0.9, gain: 0.07, send: 0.3 });
  for (let i = 0; i < 4; i++) tone(rnd(4000, 6500), t + 0.2 + i * rnd(0.03, 0.06), { dur: 0.05, gain: 0.03 });
}

function splash() {
  const t = now();
  noise(t, { dur: 0.5, a: 0.01, gain: 0.45, send: 0.1, filter: [{ type: 'lowpass', f: 5000, f1: 600 }, { type: 'highpass', f: 300 }] });
  for (let i = 0; i < 6; i++) {
    const f = rnd(500, 1400);
    tone(f, t + 0.05 + Math.random() * 0.35, { f1: f * 1.8, glide: 0.04, dur: 0.05, gain: 0.06 });
  }
}

function stars() {
  const t = now(), F = [2349, 2637, 3136, 2637];
  for (let i = 0; i < 10; i++) {
    const f = F[i & 3];
    tone(f, t + i * 0.12, { f1: f * 1.12, glide: 0.05, dur: 0.11, gain: 0.07, pan: Math.sin(i * 1.3) * 0.6, send: 0.3 });
    tone(f / 2, t + i * 0.12, { type: 'triangle', dur: 0.08, gain: 0.025 });
  }
}

function meterFull() {
  const t = now();
  [1568, 2093, 3136].forEach((f, i) => tone(f, t + i * 0.07, { type: 'triangle', dur: 0.5, gain: 0.1, send: 0.4 }));
  bellTone(t + 0.14, 4186, { ratios: [1, 2.76], decay: 0.8, gain: 0.04, send: 0.4 });
  noise(t + 0.14, { dur: 0.3, gain: 0.05, filter: { type: 'highpass', f: 8000 } });
}

function haymakerCharge() {
  const t = now();
  tone(110, t, { type: 'sawtooth', f1: 440, glide: 0.35, dur: 0.38, a: 0.3, gain: 0.16, filter: { type: 'lowpass', f: 300, f1: 4000, ft: 0.35, Q: 6 } });
  tone(55, t, { type: 'square', f1: 220, glide: 0.35, dur: 0.38, a: 0.3, gain: 0.08, filter: { type: 'lowpass', f: 800 } });
  noise(t, { dur: 0.37, a: 0.33, gain: 0.2, filter: { type: 'bandpass', f: 800, f1: 6000, Q: 1.5 } });
}

const blip = (f, t, dur, gain = 0.06) => tone(f, t, { type: 'square', dur, gain, filter: { type: 'lowpass', f: 4000 } });
function uiMove() { blip(1320, now(), 0.03, 0.1); }
function uiSelect() { const t = now(); blip(880, t, 0.05); blip(1760, t + 0.05, 0.09); }
function uiBack() { const t = now(); blip(740, t, 0.05); blip(494, t + 0.05, 0.08); }

function stamp() {
  const t = now();
  tone(150, t, { f1: 45, glide: 0.1, dur: 0.22, gain: 0.9, a: 0.001 });
  noise(t, { dur: 0.12, gain: 0.6, send: 0.15, filter: { type: 'lowpass', f: 900 } });
  noise(t, { dur: 0.015, gain: 0.3, filter: { type: 'highpass', f: 3000 } });
}

function typeTick() {
  const t = now();
  noise(t, { dur: 0.018, gain: rnd(0.3, 0.45), filter: { type: 'bandpass', f: rnd(2500, 4000), Q: 2 } });
  tone(rnd(1800, 2300), t, { type: 'square', dur: 0.01, gain: 0.03, filter: { type: 'highpass', f: 1000 } });
}

function punchClock() {
  const t = now(), tt = t + 0.14;
  noise(t, { dur: 0.03, gain: 0.35, filter: { type: 'bandpass', f: 3000, Q: 3 } });
  tone(900, t, { type: 'square', dur: 0.02, gain: 0.05 });
  tone(120, tt, { f1: 50, glide: 0.08, dur: 0.18, gain: 0.8, a: 0.001 });
  noise(tt, { dur: 0.1, gain: 0.5, filter: { type: 'lowpass', f: 1200 } });
  noise(tt + 0.01, { dur: 0.06, gain: 0.2, filter: { type: 'bandpass', f: 2500, Q: 6 } });
  bellTone(tt, 1180, { ratios: [1, 2.3, 3.7], decay: 0.25, gain: 0.06 });
}

function lightsOut() {
  const t = now();
  tone(90, t, { f1: 40, dur: 0.3, gain: 0.9, a: 0.001 });
  noise(t, { dur: 0.15, gain: 0.6, send: 0.4, filter: { type: 'lowpass', f: 1500 } });
  noise(t, { dur: 0.12, gain: 0.2, filter: { type: 'bandpass', f: 1800, Q: 8 } });
  bellTone(t, 700, { ratios: [1, 1.6, 2.9], decay: 0.3, gain: 0.05 });
  // mains hum spinning down to nothing
  tone(120, t, { type: 'sawtooth', f1: 30, glide: 0.9, dur: 1, gain: 0.12, filter: { type: 'lowpass', f: 600 } });
  tone(60, t, { f1: 20, glide: 0.9, dur: 1, gain: 0.15 });
}

function snore() {
  const t = now(), d = 0.85;
  // inhale: nasal rattle = saw buzz with a 24 Hz flutter
  const o = ctx.createOscillator(), lp = biquad({ type: 'lowpass', f: 800, Q: 2 }, t, d);
  const am = gainNode(0.5), env = ctx.createGain(), lfo = ctx.createOscillator(), lg = gainNode(0.5, am.gain);
  const nodes = [o, lp, am, env, lfo, lg];
  o.type = 'sawtooth';
  o.frequency.setValueAtTime(62, t); o.frequency.linearRampToValueAtTime(78, t + d);
  lfo.type = 'square'; lfo.frequency.value = 24; lfo.connect(lg);
  envelope(env.gain, t, 0.5, 0.35, 0.2, d);
  o.connect(lp); lp.connect(am); am.connect(env); env.connect(sfxBus);
  for (const x of [o, lfo]) { x.start(t); x.stop(t + d + 0.05); }
  done(o, nodes);
  noise(t, { dur: d, a: 0.5, gain: 0.2, filter: { type: 'bandpass', f: 500, f1: 1000, Q: 2 } });
  // exhale: cartoon whistle
  tone(1300, t + 0.95, { f1: 650, glide: 0.5, dur: 0.55, a: 0.05, gain: 0.08 });
  noise(t + 0.95, { dur: 0.5, a: 0.05, gain: 0.1, filter: { type: 'bandpass', f: 1200, Q: 1 } });
}

function heartbeat() {
  const t = now();
  tone(62, t, { f1: 40, dur: 0.16, gain: 0.8, a: 0.002 });
  tone(58, t + 0.2, { f1: 38, dur: 0.2, gain: 0.55, a: 0.002 });
  noise(t, { dur: 0.06, gain: 0.2, filter: { type: 'lowpass', f: 150 } });
}

// ───────────────────────────── announcer ─────────────────────────────

try { window.speechSynthesis?.getVoices(); } catch { /* warm the voice list */ }

function pickVoice(hint) {
  const vs = window.speechSynthesis.getVoices().filter((v) => /^en/i.test(v.lang));
  if (!vs.length) return null;
  if (hint) {
    const h = vs.find((v) => v.name.toLowerCase().includes(String(hint).toLowerCase()));
    if (h) return h;
  }
  const deep = /daniel|fred|alex|george|arthur|male|guy|david|james|ralph|reed|rocko|aaron|tom|oliver/i;
  return vs.find((v) => deep.test(v.name)) || vs.find((v) => v.default) || vs[0];
}

function say(text, opts = {}) {
  const ss = window.speechSynthesis;
  if (!ss || muted || !text) return;
  ss.cancel();
  const u = new SpeechSynthesisUtterance(String(text));
  u.rate = clamp(opts?.rate ?? 1, 0.1, 3);
  u.pitch = clamp(opts?.pitch ?? 0.6, 0, 2);
  u.volume = 1;
  const v = pickVoice(opts?.voiceHint);
  if (v) { u.voice = v; u.lang = v.lang; }
  u.onstart = () => note(`speech start "${text}"`);
  u.onend = () => note(`speech end (context ${ctx?.state})`);
  ss.speak(u);
}

// Live engine state for the ?debug=audio overlay. peak is the loudest output sample in the last ~21 ms.
function debugSnapshot() {
  let peak = 0;
  if (dbg.an) { dbg.an.getFloatTimeDomainData(dbg.buf); for (const x of dbg.buf) peak = Math.max(peak, Math.abs(x)); }
  return {
    state: ctx.state, rate: ctx.sampleRate, time: ctx.currentTime,
    latency: ((ctx.baseLatency || 0) + (ctx.outputLatency || 0)) * 1000,
    track: current?.id ?? null, lead: current ? current.next - ctx.currentTime : null,
    duck: musicDuck.gain.value, lp: musicLP.frequency.value, master: master.gain.value, muted,
    voices: dbg.voices, peak, log: dbg.log,
  };
}

// ───────────────────────────── API ─────────────────────────────

// Every public call is a no-op before init() (unless marked) and never throws.
const guard = (fn, needCtx = true) => (...args) => {
  try {
    if (needCtx && !ctx) return undefined;
    return fn(...args);
  } catch (e) {
    try { console.warn('[audio]', e); } catch { /* no console */ }
    return undefined;
  }
};

export const audio = {
  init: guard(init, false),
  get muted() { return muted; },
  toggleMute: guard(() => { setMuted(!muted); return muted; }, false),
  setMuted: guard(setMuted, false),
  setTimeScale: guard(setTimeScale, false),
  playMusic: guard(playMusic, false),
  stopMusic: guard(stopMusic, false),
  setIntensity: guard((x) => { intensity = clamp(x); }, false),
  duck: guard(duck),
  stinger: guard(stinger),
  punch: guard(punch),
  block: guard(block),
  whiff: guard(whiff),
  playerHit: guard(playerHit),
  dodge: guard(dodge),
  perfect: guard(perfect),
  tell: guard(tell),
  bell: guard(bell),
  count: guard(count),
  knockdown: guard(knockdown),
  ko: guard(ko),
  cheer: guard(cheer),
  ooh: guard(ooh),
  crowdStart: guard(crowdStart),
  crowdStop: guard(crowdStop),
  setCrowd: guard(setCrowd),
  teeth: guard(teeth),
  paper: guard(paper),
  cash: guard(cash),
  splash: guard(splash),
  stars: guard(stars),
  meterFull: guard(meterFull),
  haymakerCharge: guard(haymakerCharge),
  uiMove: guard(uiMove),
  uiSelect: guard(uiSelect),
  uiBack: guard(uiBack),
  stamp: guard(stamp),
  typeTick: guard(typeTick),
  punchClock: guard(punchClock),
  lightsOut: guard(lightsOut),
  // the mixed game audio as a MediaStream, for the clip recorder
  stream: guard(() => { if (!recDest) { recDest = ctx.createMediaStreamDestination(); comp.connect(recDest); } return recDest.stream; }),
  snore: guard(snore),
  heartbeat: guard(heartbeat),
  say: guard(say),
  debugSnapshot: guard(debugSnapshot),
};
