import { fmtTime } from './ui.js';

// Rolling fight recorder (DESIGN.md "Clips"). Two recorders restart every CYCLE seconds, CYCLE/2 apart,
// so the older one always holds the last 4-8 s. Timing runs off update(dt), so a paused game pauses the clip.
const CYCLE = 8, TAIL = 3.6, CARD = 1;
const TYPES = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
const DISP = '"Anton", Impact, sans-serif', MONO = '"JetBrains Mono", monospace';

export function createClip({ audio, maxSide }) {
  const ok = typeof MediaRecorder !== 'undefined' && !!HTMLCanvasElement.prototype.captureStream;
  const type = ok ? TYPES.find((t) => MediaRecorder.isTypeSupported(t)) : null;
  const cv = document.createElement('canvas');
  const g = cv.getContext('2d');
  let stream = null, fight = null, recs = [], marks = [], latest = null, paused = false;
  let callout = null, quote = null, clock = 0;

  function record() {
    const rec = { mr: new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 4e6 }), chunks: [], age: 0 };
    rec.mr.ondataavailable = (e) => { if (e.data.size) rec.chunks.push(e.data); };
    rec.mr.start(1000);
    if (paused) rec.mr.pause();
    return rec;
  }
  const kill = (rec) => { if (rec && rec.mr.state !== 'inactive') { rec.mr.ondataavailable = null; rec.mr.stop(); } };

  function size(src) {
    const s = Math.min(1, maxSide / Math.max(src.width, src.height));
    cv.width = Math.round(src.width * s / 2) * 2;
    cv.height = Math.round(src.height * s / 2) * 2;
  }

  // ---------- overlay ----------
  function bar(x, y, w, h, frac, color, flip) {
    g.fillStyle = 'rgba(0,0,0,.6)'; g.fillRect(x, y, w, h);
    g.fillStyle = color;
    const fw = w * Math.max(0, Math.min(1, frac));
    g.fillRect(flip ? x + w - fw : x, y, fw, h);
    g.strokeStyle = '#fff'; g.lineWidth = Math.max(1, h * 0.12); g.strokeRect(x, y, w, h);
  }
  function text(str, x, y, font, color, align = 'left', stroke = 0) {
    g.font = font; g.textAlign = align;
    if (stroke) { g.lineWidth = stroke; g.strokeStyle = '#000'; g.lineJoin = 'round'; g.strokeText(str, x, y); }
    g.fillStyle = color; g.fillText(str, x, y);
  }

  function overlay() {
    const W = cv.width, H = cv.height, u = Math.min(W, H) / 60, d = fight.d, t = d.theme;
    const grd = g.createLinearGradient(0, 0, 0, u * 9);
    grd.addColorStop(0, 'rgba(0,0,0,.7)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd; g.fillRect(0, 0, W, u * 9);
    const bw = W * 0.34, pad = u * 1.6;
    text('YOU', pad, pad + u * 1.8, `${u * 2.2}px ${DISP}`, '#fff');
    bar(pad, pad + u * 2.6, bw, u * 1.6, fight.p.hp / 100, '#ffd23f');
    text(d.name, W - pad, pad + u * 1.8, `${u * 2.2}px ${DISP}`, '#fff', 'right');
    bar(W - pad - bw, pad + u * 2.6, bw, u * 1.6, fight.o.hp / fight.o.max, t.a, true);
    text(fmtTime(fight.time + (fight.run?.time || 0)), W / 2, pad + u * 3.6, `800 ${u * 2.4}px ${MONO}`, '#ff5a3d', 'center');
    if (quote && quote.t > 0) {
      g.font = `700 ${u * 2}px ${MONO}`;
      const qw = Math.min(W - pad * 2, g.measureText(quote.text).width + u * 3);
      g.fillStyle = '#fff'; g.fillRect(W / 2 - qw / 2, u * 10, qw, u * 3.6);
      g.fillStyle = t.a; g.fillRect(W / 2 - qw / 2, u * 13.6, qw, u * 0.4);
      text(quote.text, W / 2, u * 12.5, `700 ${u * 2}px ${MONO}`, '#000', 'center');
    }
    if (callout && callout.t > 0) {
      const s = 1 + Math.max(0, callout.t - callout.dur + 0.12) * 4;
      g.save(); g.translate(W / 2, H * 0.62); g.scale(s, s); g.transform(1, 0, -0.18, 1, 0, 0);
      text(callout.text, 0, 0, `${u * 6}px ${DISP}`, callout.color, 'center', u * 0.9);
      g.restore();
    }
    text('#PUNCHCLOCK', pad, H - pad, `700 ${u * 1.7}px ${MONO}`, 'rgba(255,255,255,.8)');
    text(`FLOOR ${d.floor}`, W - pad, H - pad, `${u * 2}px ${DISP}`, t.a, 'right');
  }

  function endCard(m, k) {
    const W = cv.width, H = cv.height, u = Math.min(W, H) / 60, d = m.fight.d, t = d.theme;
    g.fillStyle = `rgba(7,5,10,${0.55 + 0.4 * k})`; g.fillRect(0, 0, W, H);
    g.save(); g.translate(0, H * 0.7); g.rotate(-0.12);
    g.fillStyle = t.b; g.fillRect(-W * 0.1, 0, W * 1.3, u * 1.4);
    g.fillStyle = t.a; g.fillRect(-W * 0.1, u * 2, W * 1.3, u * 0.6);
    g.restore();
    const cx = W / 2, pop = 1 + (1 - Math.min(1, k * 5)) * 0.5;
    const big = m.kind === 'ko' ? 'K.O.!' : 'FIRED';
    const who = m.kind === 'ko' ? `${d.name} · ${d.title}` : `BY ${d.name} · ${d.title}`;
    g.save(); g.translate(cx, H * 0.42); g.scale(pop, pop); g.transform(1, 0, -0.16, 1, 0, 0);
    text(big, 0, 0, `${u * (big.length > 6 ? 7 : 11)}px ${DISP}`, m.kind === 'ko' ? '#fff' : '#ff2e55', 'center', u * 0.6);
    g.restore();
    text(who, cx, H * 0.42 + u * 5, `${u * 2.4}px ${DISP}`, '#ffd23f', 'center');
    text(fmtTime(m.time), cx, H * 0.42 + u * 10, `800 ${u * 4}px ${MONO}`, '#ff5a3d', 'center');
    text('PUNCH CLOCK', cx, H - u * 7, `${u * 3.4}px ${DISP}`, t.a, 'center');
    text('#PUNCHCLOCK', cx, H - u * 3.6, `700 ${u * 1.8}px ${MONO}`, 'rgba(255,255,255,.75)', 'center');
  }

  // ---------- marks ----------
  // A mark takes the older recorder out of the cycle and lets it roll TAIL more seconds. Only a kept clip
  // gets the end card, because every recorder shares this canvas and an undecided card would leak into the next clip.
  const current = () => marks.find((m) => m.fight === fight && !m.dropped);
  const rolling = () => marks.filter((m) => !m.stopped && !m.dropped);
  function mark(kind) {
    if (current()) return current();
    const i = recs.reduce((best, r, j) => (r && (!recs[best] || r.age > recs[best].age) ? j : best), 0);
    const rec = recs[i];
    if (!rec) return null;
    const m = { rec, kind, fight, left: TAIL, keep: false, stopped: false, dropped: false, time: fight.time + (fight.run?.time || 0) };
    m.done = new Promise((res) => { m.resolve = res; });
    marks = marks.filter((x) => x.fight === fight || !x.stopped).concat(m);
    recs[i] = record();
    return m;
  }
  function finish(m) {
    m.stopped = true;
    m.rec.mr.onstop = () => m.resolve(new Blob(m.rec.chunks, { type: m.rec.mr.mimeType || type }));
    m.rec.mr.stop();
  }

  return {
    get supported() { return !!type; },
    get ext() { return type && type.startsWith('video/mp4') ? 'mp4' : 'webm'; },
    // the kept clip of the last fight: a Promise<Blob>, or null
    get latest() { return latest; },

    start(f, src) {
      fight = f; latest = null; callout = null; quote = null;
      if (!type) return;
      try {
        for (const r of recs) kill(r);
        size(src);
        if (!stream) stream = cv.captureStream(30);
        // audio exists only after the first user gesture, so keep trying until it does
        if (!stream.getAudioTracks().length) { const a = audio.stream()?.getAudioTracks()[0]; if (a) stream.addTrack(a); }
        recs = [record(), null];
        clock = 0;
      } catch (e) { console.warn('[clip]', e); recs = []; }
    },

    // stops the rolling buffer; a clip that is still rolling finishes on its own
    stop() { for (const r of recs) kill(r); recs = []; },

    mark(kind) { try { if (type) mark(kind); } catch (e) { console.warn('[clip]', e); } },
    keep() {
      if (!type) return;
      try {
        const m = current() || mark('ko');
        if (!m) return;
        m.keep = true;
        latest = m.done;
      } catch (e) { console.warn('[clip]', e); }
    },
    drop() {
      const m = current();
      if (!m || m.keep) return;
      m.dropped = true;
      kill(m.rec);
    },

    listen(kind, str, opt) {
      if (kind === 'callout') callout = { text: str, color: opt.color, t: opt.dur + 0.3, dur: opt.dur + 0.3 };
      else if (kind === 'say') quote = { text: str, t: opt };
    },

    update(dt, src, isPaused) {
      const live = rolling();
      if (!recs.length && !live.length) return;
      if (isPaused !== paused) {
        paused = isPaused;
        for (const r of [...recs, ...live.map((m) => m.rec)]) if (r && r.mr.state !== 'inactive') { if (paused) r.mr.pause(); else r.mr.resume(); }
      }
      if (paused) return;
      clock += dt;
      if (recs.length && recs[1] === null && clock >= CYCLE / 2) recs[1] = record();
      for (let i = 0; i < recs.length; i++) {
        const r = recs[i];
        if (!r) continue;
        r.age += dt;
        if (r.age >= CYCLE) { kill(r); recs[i] = record(); }
      }
      if (callout) callout.t -= dt;
      if (quote) quote.t -= dt;
      g.drawImage(src, 0, 0, cv.width, cv.height);
      if (fight) overlay();
      for (const m of live) {
        m.left -= dt;
        if (m.left < CARD && m.keep) endCard(m, 1 - m.left / CARD);
        if (m.left <= 0) finish(m);
      }
    },
  };
}
