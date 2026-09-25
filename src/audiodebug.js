// ?debug=audio overlay: live audio engine state, for catching on-device dropouts and crackle.
// Loaded only in debug mode (see main.js). Screenshot it when the sound goes wrong.
import { audio } from './audio.js';

const el = document.createElement('pre');
el.style.cssText = 'position:fixed;left:max(8px,env(safe-area-inset-left));bottom:max(8px,env(safe-area-inset-bottom));'
  + 'z-index:99;margin:0;padding:6px 8px;max-width:calc(100vw - 16px);overflow:hidden;pointer-events:none;'
  + 'font:10px/1.35 ui-monospace,Menlo,monospace;color:#e8ffe8;background:rgba(0,0,0,.72);border-radius:6px;white-space:pre-wrap';
document.body.appendChild(el);

let hold = 0, clips = 0, lastRender = 0, clock = 1, clockAt = null;

function frame(now) {
  requestAnimationFrame(frame);
  const s = audio.debugSnapshot();
  if (!s) { el.textContent = 'AUDIO not started: tap to start'; return; }
  if (s.peak >= 0.99) clips++;
  hold = Math.max(hold * 0.97, s.peak);
  if (!clockAt) clockAt = { wall: now, time: s.time };
  else if (now - clockAt.wall > 1000) {   // audio seconds per real second: ~1 when healthy, 0 when frozen
    clock = (s.time - clockAt.time) / ((now - clockAt.wall) / 1000);
    clockAt = { wall: now, time: s.time };
  }
  if (now - lastRender < 250) return;
  lastRender = now;
  const warn = (bad, txt) => (bad ? `!! ${txt}` : txt);
  el.textContent = [
    warn(s.state !== 'running', `AUDIO ${s.state}`) + `  ${s.rate} Hz  latency ${s.latency.toFixed(0)} ms`,
    warn(Math.abs(clock - 1) > 0.05, `clock ${clock.toFixed(2)}x`),
    `music ${s.track ?? 'none'}` + (s.lead == null ? '' : warn(s.lead < 0, `  lead ${s.lead.toFixed(2)} s`)),
    `duck ${s.duck.toFixed(2)}  lowpass ${s.lp.toFixed(0)} Hz  master ${s.master.toFixed(2)}${s.muted ? '  MUTED' : ''}`,
    `voices ${s.voices}  peak ${hold.toFixed(2)}  ` + warn(clips > 0, `clipped ${clips}`),
    ...s.log,
  ].join('\n');
}
requestAnimationFrame(frame);
