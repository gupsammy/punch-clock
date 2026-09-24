// Springs drive almost every motion in the game: poses, hit wobble, camera.
// A spring toward a moving target gives overshoot and settle for free, which
// is what makes a punch read as heavy instead of tweened.

export class Spring {
  constructor(value = 0, stiffness = 180, damping = 18) {
    this.value = value;
    this.target = value;
    this.velocity = 0;
    this.stiffness = stiffness;
    this.damping = damping;
  }
  update(dt) {
    // Semi-implicit Euler, sub-stepped so stiff springs stay stable at low fps.
    const steps = Math.max(1, Math.ceil(dt / (1 / 240)));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      const a = (this.target - this.value) * this.stiffness - this.velocity * this.damping;
      this.velocity += a * h;
      this.value += this.velocity * h;
    }
    return this.value;
  }
  kick(v) { this.velocity += v; }
  snap(v) { this.value = this.target = v; this.velocity = 0; }
}

// A bag of named springs sharing a stiffness that can change per transition.
export class SpringSet {
  constructor(values, stiffness = 180, damping = 18) {
    this.s = {};
    for (const k in values) this.s[k] = new Spring(values[k], stiffness, damping);
  }
  get(k) { return this.s[k].value; }
  set(targets, stiffness, damping) {
    for (const k in targets) {
      const sp = this.s[k];
      if (!sp) continue;
      sp.target = targets[k];
      if (stiffness) sp.stiffness = stiffness;
      if (damping) sp.damping = damping;
    }
  }
  kick(k, v) { if (this.s[k]) this.s[k].kick(v); }
  // move the value itself, so a hit-stop freezes on the reaction instead of before it
  nudge(k, v) { if (this.s[k]) this.s[k].value += v; }
  update(dt) { for (const k in this.s) this.s[k].update(dt); }
  snapAll(values) { for (const k in values) if (this.s[k]) this.s[k].snap(values[k]); }
}

export const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
export const lerp = (a, b, t) => a + (b - a) * t;
export const rand = (a, b) => a + Math.random() * (b - a);
export const pick = (arr) => arr[(Math.random() * arr.length) | 0];
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));
export const easeOutBack = (t) => { const c = 1.9; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };
export const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

// Weighted random pick: items = [{w, ...}]
export function weighted(items) {
  let total = 0;
  for (const it of items) total += it.w;
  let r = Math.random() * total;
  for (const it of items) { if ((r -= it.w) <= 0) return it; }
  return items[items.length - 1];
}
