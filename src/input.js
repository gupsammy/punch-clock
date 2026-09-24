// Every device maps onto the same small set of actions:
// jabL, jabR, left, right, duck, haymaker, retry, pause, confirm, back.
// `left`/`right`/`duck` are holdable (a held dodge stays dodged).

const KEYS = {
  KeyJ: 'jabL', KeyZ: 'jabL', KeyK: 'jabR', KeyX: 'jabR',
  KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right',
  KeyS: 'duck', ArrowDown: 'duck', Space: 'haymaker', KeyL: 'haymaker', KeyW: 'haymaker', ArrowUp: 'haymaker',
  KeyR: 'retry', Escape: 'pause', KeyP: 'pause', Enter: 'confirm', KeyM: 'mute',
};

export function createInput(target) {
  const listeners = new Set();
  const held = new Set();
  const emit = (action, down, src) => {
    if (down) held.add(action); else held.delete(action);
    for (const fn of listeners) fn(action, down, src);
  };

  window.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey) return;
    const a = KEYS[e.code];
    if (!a) { if (!e.repeat) emit('any', true, 'key'); return; }
    e.preventDefault();
    if (e.repeat) return;
    emit(a, true, 'key');
    emit('any', true, 'key');
  });
  window.addEventListener('keyup', (e) => {
    const a = KEYS[e.code];
    if (a) emit(a, false, 'key');
  });
  window.addEventListener('blur', () => { for (const a of [...held]) emit(a, false, 'blur'); });

  // mouse on the game canvas only (menus are DOM buttons)
  target.addEventListener('contextmenu', (e) => e.preventDefault());
  target.addEventListener('mousedown', (e) => {
    const a = e.button === 0 ? 'jabL' : e.button === 2 ? 'jabR' : e.button === 1 ? 'haymaker' : null;
    if (a) { e.preventDefault(); emit(a, true, 'mouse'); emit('any', true, 'mouse'); }
  });
  target.addEventListener('mouseup', (e) => {
    const a = e.button === 0 ? 'jabL' : e.button === 2 ? 'jabR' : e.button === 1 ? 'haymaker' : null;
    if (a) emit(a, false, 'mouse');
  });

  // touch: tap left/right half to punch; swipe to dodge/duck; swipe up = haymaker
  const touches = new Map();
  const SWIPE = 34;
  target.addEventListener('touchstart', (e) => {
    e.preventDefault();
    for (const t of e.changedTouches) touches.set(t.identifier, { x: t.clientX, y: t.clientY, t: performance.now(), fired: null });
    emit('any', true, 'touch');
  }, { passive: false });
  target.addEventListener('touchmove', (e) => {
    e.preventDefault();
    for (const t of e.changedTouches) {
      const s = touches.get(t.identifier);
      if (!s || s.fired) continue;
      const dx = t.clientX - s.x, dy = t.clientY - s.y;
      if (Math.hypot(dx, dy) < SWIPE) continue;
      let a;
      if (Math.abs(dx) > Math.abs(dy)) a = dx < 0 ? 'left' : 'right';
      else a = dy > 0 ? 'duck' : 'haymaker';
      s.fired = a;
      emit(a, true, 'touch');
    }
  }, { passive: false });
  const end = (e) => {
    e.preventDefault();
    for (const t of e.changedTouches) {
      const s = touches.get(t.identifier);
      touches.delete(t.identifier);
      if (!s) continue;
      if (s.fired) { emit(s.fired, false, 'touch'); continue; }
      if (performance.now() - s.t < 450) {
        const a = s.x < window.innerWidth / 2 ? 'jabL' : 'jabR';
        emit(a, true, 'touch'); emit(a, false, 'touch');
      }
    }
  };
  target.addEventListener('touchend', end, { passive: false });
  target.addEventListener('touchcancel', end, { passive: false });

  // gamepad (polled)
  const padPrev = {};
  const PAD = { 2: 'jabL', 1: 'jabR', 0: 'jabL', 3: 'haymaker', 9: 'pause', 8: 'retry', 14: 'left', 15: 'right', 13: 'duck', 12: 'haymaker', 4: 'left', 5: 'right' };
  function pollPad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) {
      if (!p) continue;
      const state = {};
      for (const i in PAD) if (p.buttons[i]?.pressed) state[PAD[i]] = true;
      const ax = p.axes[0] || 0, ay = p.axes[1] || 0;
      if (ax < -0.55) state.left = true;
      if (ax > 0.55) state.right = true;
      if (ay > 0.6) state.duck = true;
      for (const a of new Set([...Object.keys(state), ...Object.keys(padPrev)])) {
        if (!!state[a] !== !!padPrev[a]) { emit(a, !!state[a], 'pad'); if (state[a]) emit('any', true, 'pad'); }
      }
      for (const k in padPrev) delete padPrev[k];
      Object.assign(padPrev, state);
      break;
    }
  }

  return {
    on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    held: (a) => held.has(a),
    poll: pollPad,
    touch: () => matchMedia('(pointer: coarse)').matches,
  };
}
