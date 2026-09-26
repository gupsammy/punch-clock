import * as THREE from 'three';
import { ATTACKS, CALLOUTS, VS, VS_PUNCH } from './config.js';
import { TELL_COLORS } from './fight.js';
import { pick, clamp, rand } from './spring.js';

// 1v1 over the network (VERSUS.md). Plays the role of Fight for main.js.
// `p` is your body: you own it and broadcast it. `o` is the opponent as last reported, `inc` the
// attack they are throwing at you right now. The clock is real time on both sides; hit-stop only
// freezes the picture.

const PERFECT_WIN = 0.12;
const DODGE_MIN = 0.42, DODGE_MAX = 0.6, DODGE_RECOVER = 0.14;
const HOLD = 0.2;                 // a punch held this long becomes the heavy for that hand
const FEINT_UNTIL = 0.6;          // a dodge in the first 60% of your own wind-up cancels it
const GUARD_WAIT = 0.8, GUARD_REGEN = 25, GUARD_BREAK_STUN = 1;
const FLURRY_SCALE = 0.7;
const RES_TIMEOUT = 1;            // an attack with no verdict after this long counts as dodged
export const ROUND = 120;
export const MAX_KD = 3;

const flip = (h) => (h === 'L' ? 'R' : 'L');
const flipDir = (d) => (d === 'left' ? 'right' : d === 'right' ? 'left' : d);
const cap = (s) => s[0].toUpperCase() + s.slice(1);
// an attack as the defender sees it: the other hand, the other side to dodge to
const mirrored = (id) => { const a = ATTACKS[id]; return { ...a, hand: flip(a.hand), avoid: a.avoid.map(flipDir) }; };
// one-handed attacks keep their own pose, mirrored ('M'); the rest pick the pose for the mirrored hand
const windKey = (a) => (a.pose ? 'wind' + cap(a.pose) + 'M' : a.kind === 'throw' ? 'windThrowM' : a.kind === 'smash' ? 'windSmashM' : 'wind' + cap(a.kind) + a.hand);
const strikeKey = (a) => (a.pose ? a.pose + 'M' : a.kind === 'smash' ? 'smashM' : a.kind === 'throw' ? 'throwM' : a.kind + a.hand);
const SPECIAL_NAMES = { pivot: 'THE PIVOT', takeover: 'HOSTILE TAKEOVER' };
const OPEN = ['recover', 'stun', 'hurt', 'taunt'];
// Traits (VERSUS.md "Characters"): each fighter bends one rule their way and one against them,
// the way they do on their floor. Everything below keyed by roster id lives in this file.
const PHONE_AFTER = 3, NAP_EVERY = [18, 28], NAP_DUR = 2.6, NAP_WAKE_TAPS = 5, FURY_DUR = 5;
const TAUNT = { phone: { pose: 'phone', prop: 'phone', dur: 1.2, text: 'CHECKING PHONE…' }, sip: { pose: 'sip', prop: 'mug', dur: 1.2, text: 'SIP BREAK' },
  flex: { pose: 'flex', prop: null, dur: 0.8, text: 'FLEXING' }, nap: { pose: 'nap', prop: null, dur: NAP_DUR, text: 'ZZZ… MASH TO WAKE UP' } };

export class Versus {
  // me, them: ROSTER entries. net: from net.js. host: owns the round clock.
  constructor(me, them, ctx, net, host) {
    this.me = me; this.d = them; this.ctx = ctx; this.net = net; this.host = host;
    this.vme = VS[me.id]; this.vthem = VS[them.id];
    this.gmax = this.vme.guard || 100;
    this.phase = 'intro';
    this.time = 0; this.real = 0;
    this.timers = [];
    this.seq = 0;
    this.p = { hp: this.vme.hp, max: this.vme.hp, state: 'idle', st: 0, side: null, phaseP: null, dodgeDir: null, dodgeStart: -9, release: false,
      meter: 0, guard: this.gmax, guardT: 9, kd: 0, tk: null, idleT: 0, napT: rand(...NAP_EVERY), fury: 0, jacket: false, blockRun: 0, blockRunT: 0, combo: 0, lastHit: -9, openT: 0, atk: null, flurry: null, buffer: null,
      press: { L: null, R: null }, taps: 0, need: 0, count: 0 };
    this.o = { s: 'idle', state: 'idle', hp: this.vthem.hp, max: this.vthem.hp, kd: 0, meter: 0, guard: this.vthem.guard || 100, gm: this.vthem.guard || 100,
      dir: null, side: null, tk: null, fu: false, jk: false };
    this.snoreT = 0;
    this.inc = null;
    this.hitsInWindow = 0;
    this.lastSide = 'R';
    this.dirty = false; this.softDirty = false; this.sentAt = 0;
    this.s = { landed: 0, thrown: 0, perfects: 0, dodges: 0, counters: 0, specials: 0, dmgDealt: 0, dmgTaken: 0, hitsTaken: 0, teeth: 0, maxCombo: 0 };
    this.hype = 0.3;
    this.heart = 0;
  }

  // ---------- helpers ----------
  after(sec, fn) { this.timers.push({ t: sec, fn }); }
  headPos() { return this.ctx.fighter.headWorld(new THREE.Vector3()); }
  toCam(pos) { return new THREE.Vector3().subVectors(this.ctx.player.rig.position, pos).normalize(); }
  gainMeter(n) { this.p.meter = Math.min(100, this.p.meter + n * (this.desperate() ? 1.5 : 1)); this.softDirty = true; }
  desperate() { return this.me.id === 'kyle' && this.p.hp / this.p.max < 0.3; }
  // your damage multiplier right now: base power plus whatever your trait has switched on
  power() {
    const p = this.p;
    return this.vme.power * (this.desperate() ? 1.35 : 1) * (p.fury > 0 ? 1.25 : 1) * (p.jacket ? 1.15 : 1);
  }
  setState(s) { this.p.state = s; this.p.st = 0; this.dirty = true; }
  sendState() {
    const p = this.p;
    this.net.send({ k: 'st', hp: Math.round(p.hp * 10) / 10, max: p.max, kd: p.kd, meter: Math.round(p.meter), guard: Math.round(p.guard),
      s: p.state, dir: p.dodgeDir, side: p.side, tk: p.tk, gm: this.gmax, fu: p.fury > 0, jk: p.jacket });
    this.dirty = this.softDirty = false;
    this.sentAt = this.real;
  }

  // ---------- flow ----------
  intro() {
    const { fighter } = this.ctx;
    fighter.setPose({ phone: 'phone', sip: 'sip', flex: 'flex', invoice: 'invoice', nap: 'nap', cash: 'cash' }[this.d.taunt] || 'flex', 90, 12);
    fighter.setExpr('taunt');
  }

  start() {
    const { fighter, audio, ui, arena, player } = this.ctx;
    this.phase = 'fight';
    fighter.setPose('guard'); fighter.setExpr('idle'); fighter.showProp(null);
    player.setGloveColor(this.me.look.gloves);
    audio.bell(1);
    audio.stinger('fight');
    audio.say('Fight!', { rate: 1.1, pitch: 0.7 });
    ui.callout('FIGHT!', { size: 'xl', color: this.d.theme.a, dur: 0.9 });
    arena.cheer(0.8);
    audio.cheer(0.7);
    this.sendState();
  }

  // ---------- network in ----------
  onMsg(m) {
    switch (m.k) {
      case 'st': this.onState(m); break;
      case 'atk': this.onAtk(m); break;
      case 'cx': if (this.inc && this.inc.n === m.n) this.cancelIncoming('FEINT!'); break;
      case 'res': if (this.p.atk && this.p.atk.n === m.n) this.p.atk.res = m; break;
      case 'pun': this.onPunch(m); break;
      case 'count': this.ctx.ui.count(m.n); this.ctx.audio.count(m.n); break;
      case 'ko': this.koWin(); break;
      case 'end': this.decision(m.win); break;
    }
  }

  onState(m) {
    const o = this.o, prev = o.s;
    const { fighter, fx, ui, audio } = this.ctx;
    if (m.fu && !o.fu) { ui.popup(`${this.d.name.split(' ')[0]} IS FURIOUS`); fighter.setExpr('angry', FURY_DUR); }
    if (m.jk && !o.jk) {
      // the jacket comes off, as on the penthouse floor
      fighter.shirtMat.color.set('#f3f1ec');
      if (fighter.shirtFront) fighter.shirtFront.visible = false;
      fx.cashRain(this.headPos(), 25, 1.5);
    }
    Object.assign(o, { hp: m.hp, max: m.max, kd: m.kd, meter: m.meter, guard: m.guard, gm: m.gm, s: m.s, dir: m.dir, side: m.side, tk: m.tk, fu: m.fu, jk: m.jk });
    if (m.s === prev) return;
    if (prev === 'stun') fx.dizzy(false);
    if (prev === 'taunt') fighter.showProp(null);
    if (m.s === 'recover' || m.s === 'stun' || m.s === 'taunt') this.hitsInWindow = 0;
    if (m.s === 'down') { this.oppDown(); return; }
    if (prev === 'down') {
      ui.count(null);
      if (this.phase === 'oppDown') {
        this.phase = 'fight';
        fighter.setPose('guard', 40, 9); fighter.setExpr('angry', 2);
        audio.bell(1);
        ui.callout('FIGHT!', { size: 'l', color: this.d.theme.a, dur: 0.6 });
      }
      return;
    }
    if (this.inc || ['ko', 'lost', 'done'].includes(this.phase)) return;   // the incoming attack owns the pose
    switch (m.s) {
      case 'idle': case 'dodgeRecover': case 'wait':
        fighter.setPose('guard', 220, 20); fighter.energy = 1;
        if (fighter.expr !== 'idle' && fighter.exprHold <= 0) fighter.setExpr('idle');
        break;
      case 'dodge': fighter.setPose(m.dir === 'duck' ? 'duck' : m.dir === 'left' ? 'slipR' : 'slipL', 420, 30); break;
      case 'punch': fighter.strikePose('jab' + flip(m.side), 'jab'); break;
      case 'recover': fighter.setPose('open', 160, 14); fighter.setExpr('shock', 0.5); break;
      case 'stun': fighter.setPose('dizzy', 160, 12); fighter.setExpr('dizzy'); fx.dizzy(true); break;
      case 'hurt': fighter.setPose('hurtHead', 200, 14); break;
      case 'taunt': {
        const tt = TAUNT[m.tk] || TAUNT.flex;
        fighter.setPose(tt.pose, 110, 12);
        fighter.showProp(tt.prop);
        fighter.setExpr(m.tk === 'nap' ? 'sleep' : 'taunt');
        if (m.tk === 'sip') audio.splash();
        this.snoreT = 0.3;
        break;
      }
    }
  }

  onAtk(m) {
    if (this.phase !== 'fight' || this.p.state === 'down') return;
    const { fighter, audio, fx, ui, arena, post } = this.ctx;
    if (this.inc) this.cancelIncoming();
    const a = mirrored(m.id);
    // play the wind-up short by the one-way delay, so both screens strike at about the same moment
    const wind = Math.max(m.wind * 0.5, m.wind - this.net.owd / 1000);
    this.inc = { n: m.n, id: m.id, a, wind, st: 0, phase: 'windup', prop: m.prop || 'coffee', fl: m.fl || null, pw: m.pw || this.vthem.power,
      strikeDur: a.kind === 'throw' ? a.strike * this.vthem.wind : a.strike };
    fighter.setPose(windKey(a), wind < 0.35 ? 520 : a.pose === 'pivot' ? 12 : 420, wind < 0.35 ? 26 : a.pose === 'pivot' ? 7 : 20);
    if (a.kind === 'throw') fighter.showProp(null);
    fighter.setExpr('windup');
    fighter.energy = 0.3;
    const color = TELL_COLORS[a.kind] || '#ffffff';
    fighter.tell(a.hand, 0.2, color);
    audio.tell(a.kind === 'special' ? 'special' : a.kind);
    fx.burst(fighter.gloveWorld(a.hand, new THREE.Vector3()), 0.14, color, 0.1);
    if (m.fl?.name) { ui.banner(m.fl.name, this.d.name); audio.tell('special'); }
    if (m.fl?.dark && !this.dark) { this.dark = true; arena.blackout(true); audio.lightsOut(); post.fx.dark = 1; }
  }

  cancelIncoming(label) {
    const { fighter, ui } = this.ctx;
    const inc = this.inc;
    if (!inc) return;
    fighter.tell(inc.a.hand, 0);
    fighter.windup(null);
    fighter.energy = 1;
    if (inc.proj) inc.proj.remove();
    this.inc = null;
    this.lightsOn();
    if (label) { ui.popup(label); fighter.setPose('guard', 240, 20); }
  }

  lightsOn() {
    if (!this.dark) return;
    this.dark = false;
    this.ctx.arena.blackout(false); this.ctx.post.fx.dark = 0;
  }

  // their punch, already judged on their screen; only the numbers are ours to apply
  onPunch(m) {
    const p = this.p;
    if (this.phase !== 'fight' || p.state === 'down') return;
    const { player, audio, post, ui } = this.ctx;
    const from = flip(m.side);
    if (m.kind === 'block') {
      p.guard = Math.max(0, p.guard - m.g);
      p.guardT = 0;
      if (this.me.id === 'brenda' && ++p.blockRun >= 4 && p.guard > 0) {
        // PAPER TRAIL: four blocks in a row and the guard answers by itself
        p.blockRun = 0;
        this.after(0.08, () => { if (this.canAct() && this.phase === 'fight') { this.ctx.ui.popup('PAPER TRAIL'); this.startAttack('counter'); } });
      }
      p.blockRunT = 0;
      player.rebound(from, 'block');
      audio.block();
      this.softDirty = true;
      if (p.guard <= 0) {
        this.cancelMine();
        this.open('stun', GUARD_BREAK_STUN);
        p.guardBroken = true;
        ui.callout('GUARD BROKEN!', { size: 'l', color: '#ff2e55', dur: 0.7 });
        player.addTrauma(0.3);
        audio.stars();
      }
      return;
    }
    const dmg = m.dmg;
    p.hp -= dmg;
    this.s.dmgTaken += dmg;
    this.softDirty = true;
    if (m.kind === 'armor') { audio.block(); player.addTrauma(0.08); return; }
    this.gainMeter(dmg * 0.5);
    p.combo = 0;
    const strength = clamp(dmg / 14, 0.2, 0.8);
    player.hurt(strength, from);
    post.pulse('hurt', 0.35 + strength * 0.4);
    audio.playerHit(strength);
    this.ctx.buzz(Math.round(15 + strength * 25));
    if (p.state === 'taunt') {
      // caught mid-taunt. A napping chairwoman wakes up FURIOUS instead
      if (p.tk === 'nap') this.wakeFurious(); else this.open('stun', 0.8);
    } else if (m.kind === 'interrupt') { this.cancelMine(); ui.popup('INTERRUPTED'); this.open('recover', 0.55); }
    else if (m.cap && (p.state === 'recover' || p.state === 'stun')) this.closeOpen();
    else if (!OPEN.includes(p.state)) { this.cancelMine(); this.setState('hurt'); }
    if (p.hp <= 0) { p.hp = 0; this.goDown(); }
  }

  // ---------- input ----------
  input(action, down, src) {
    const p = this.p;
    if (this.phase === 'playerDown') {
      if (down && (action === 'jabL' || action === 'jabR' || action === 'haymaker')) {
        p.taps++;
        this.ctx.player.cam.kick('y', 0.6);
        this.ctx.player.cam.kick('roll', (Math.random() - 0.5) * 2);
        this.ctx.audio.uiMove();
      }
      return;
    }
    if (this.phase !== 'fight') return;
    p.idleT = 0;
    if (p.state === 'taunt' && p.tk === 'nap' && down && (action === 'jabL' || action === 'jabR' || action === 'haymaker')) {
      p.taps++;
      this.ctx.player.cam.kick('y', 0.4);
      if (p.taps >= NAP_WAKE_TAPS) { this.ctx.ui.popup('AWAKE'); this.closeOpen(); }
      return;
    }
    if (action === 'jabL' || action === 'jabR') {
      const side = action === 'jabL' ? 'L' : 'R';
      if (down) { p.press[side] = { t: this.real, fired: false }; return; }
      const pr = p.press[side];
      p.press[side] = null;
      if (!pr || pr.fired || src === 'cancel') return;
      if (!this.tryAct('tap' + side)) p.buffer = { action: 'tap' + side, t: 0.16 };
      return;
    }
    if (!down) {
      if ((action === 'left' || action === 'right' || action === 'duck') && p.state === 'dodge' && p.dodgeDir === action) p.release = true;
      return;
    }
    if (action === 'left' || action === 'right' || action === 'duck' || action === 'haymaker') {
      if (!this.tryAct(action)) p.buffer = { action, t: 0.16 };
    }
  }

  canAct() {
    const p = this.p;
    return p.state === 'idle' || p.state === 'dodgeRecover' || (p.state === 'punch' && p.phaseP === 'recover' && p.st > 0.07);
  }
  canDodge() {
    const p = this.p;
    if (p.state === 'windup') return !p.flurry && p.st / p.atk.wind < (this.vme.feint || FEINT_UNTIL);
    return p.state === 'idle' || p.state === 'punch' || p.state === 'dodgeRecover';
  }

  tryAct(action) {
    const p = this.p;
    if (action === 'tapL' || action === 'tapR') {
      if (!this.canAct()) return false;
      this.startPunch(action === 'tapL' ? 'L' : 'R');
      return true;
    }
    if (action === 'haymaker') {
      if (p.meter < 100) { if (p.state === 'idle') this.ctx.ui.popup('SPECIAL NOT READY'); return true; }
      if (!this.canAct()) return false;
      this.startSpecial();
      return true;
    }
    if (!this.canDodge()) return false;
    if (p.state === 'windup') this.feint();
    this.startDodge(action);
    return true;
  }

  startPunch(side) {
    const p = this.p;
    this.setState('punch');
    p.side = side; p.phaseP = 'startup';
    this.s.thrown++;
    this.ctx.player.punch(side);
    this.ctx.audio.whiff();
  }

  startDodge(dir) {
    const p = this.p;
    this.setState('dodge');
    p.dodgeDir = dir; p.dodgeStart = this.real; p.release = false;
    if (dir === 'duck') this.ctx.player.duck(); else this.ctx.player.dodge(dir);
    this.ctx.audio.dodge();
  }

  feint() {
    const p = this.p;
    this.net.send({ k: 'cx', n: p.atk.n });
    this.ctx.player.tell(p.atk.a.hand, 0);
    p.atk = null;
  }

  startHeavy(side) {
    const m = this.vme[side === 'L' ? 'holdL' : 'holdR'];
    this.startAttack(m.id, { prop: m.prop });
  }

  startSpecial() {
    const p = this.p, sp = this.vme.special;
    const { ui, audio } = this.ctx;
    p.meter = 0;
    this.s.specials++;
    const name = sp.name || SPECIAL_NAMES[sp.id] || sp.id.toUpperCase();
    ui.banner(name, 'YOU', 'YOU USE');
    audio.tell('special');
    if (sp.seq) {
      p.flurry = { name, seq: [...sp.seq], windup: sp.windup, dark: !!sp.dark, prop: sp.prop, first: true };
      this.nextInFlurry(0.3);
    } else this.startAttack(sp.id, { name, special: true });
  }

  nextInFlurry(delay) {
    const p = this.p, f = p.flurry;
    const id = f.seq.shift();
    const go = () => {
      if (p.flurry !== f || this.phase !== 'fight') return;
      this.startAttack(id, { windup: f.windup, prop: id === 'throwR' ? f.prop : null });
    };
    this.setState('wait');
    this.after(delay, go);
  }

  startAttack(id, { windup, prop, name, special } = {}) {
    const p = this.p;
    const { player, audio } = this.ctx;
    const a = ATTACKS[id];
    const n = ++this.seq;
    const wind = (windup || a.windup) * this.vme.wind;
    p.atk = { n, id, a, wind, prop: prop || 'coffee', res: null, special: !!special, strikeDur: a.kind === 'throw' ? a.strike * this.vme.wind : a.strike };
    this.setState('windup');
    player.windup(a.hand, a.kind);
    player.tell(a.hand, 0.2, TELL_COLORS[a.kind] || '#ffffff');
    audio.tell(a.kind === 'special' ? 'special' : a.kind);
    const f = p.flurry;
    const fl = f ? { name: f.first ? f.name : null, dark: f.dark, last: f.seq.length === 0 } : name ? { name, last: true } : null;
    // combo scaling: after a flurry's opener each hit is worth 70%, so an undodged special hurts but doesn't end the fight
    const pw = this.power() * (f && !f.first ? FLURRY_SCALE : 1);
    if (f) f.first = false;
    this.net.send({ k: 'atk', n, id, wind, prop: p.atk.prop, fl, pw });
    this.s.thrown++;
  }

  // drop whatever you were throwing (you got hit, interrupted, or knocked down)
  cancelMine() {
    const p = this.p;
    // a wind-up still in the air on their screen has to be called off there too
    if (p.atk && p.state === 'windup') this.net.send({ k: 'cx', n: p.atk.n });
    if (p.atk) { this.ctx.player.tell(p.atk.a.hand, 0); if (p.atk.proj) p.atk.proj.remove(); }
    p.atk = null;
    p.flurry = null;
    this.ctx.player.charge = 0;
  }

  open(kind, dur) {
    const p = this.p;
    this.setState(kind);
    p.openT = dur;
    const g = this.ctx.player.g;
    // gloves sag: you can feel the opening
    g.set({ ly: -0.42, ry: -0.42, lz: -0.5, rz: -0.5, lx: -0.26, rx: 0.26 }, 160, 14);
  }
  closeOpen() {
    const p = this.p;
    p.openT = 0;
    if (p.tk === 'nap') this.ctx.ui.hint(null);
    p.tk = null;
    this.setState('idle');
    this.ctx.player.center();
    if (p.guardBroken) { p.guardBroken = false; p.guard = this.gmax; }
  }

  // a trait flaw: you stop and do your thing, wide open
  taunt(kind) {
    const p = this.p, tt = TAUNT[kind];
    this.cancelMine();
    this.open('taunt', tt.dur);
    p.tk = kind;
    p.taps = 0;
    if (kind === 'nap') { this.ctx.ui.hint(tt.text); this.ctx.audio.snore(); } else this.ctx.ui.popup(tt.text);
  }

  wakeFurious() {
    const p = this.p;
    const { ui, audio, player } = this.ctx;
    p.tk = null;
    ui.hint(null);
    p.meter = 100; p.fury = FURY_DUR;
    this.open('stun', 0.35);
    ui.callout('WHO DARES.', { size: 'l', color: '#ff2e55', dur: 0.9 });
    audio.stinger('knockdown');
    player.addTrauma(0.4);
  }

  // ---------- update ----------
  update(dt, realDt) {
    const r = realDt;
    this.real += r;
    for (let i = this.timers.length - 1; i >= 0; i--) {
      const tm = this.timers[i];
      tm.t -= r;
      if (tm.t <= 0) { this.timers.splice(i, 1); tm.fn(); }
    }
    if (this.phase === 'fight' || this.phase === 'playerDown' || this.phase === 'oppDown') {
      this.time += r;
      if (this.time >= ROUND && !this.timeUp) this.roundOver();
    }
    this.hype = Math.max(0.25, this.hype - r * 0.05);
    this.updateMe(r);
    this.updateIncoming(r);
    if (this.phase === 'playerDown') this.updateDown(r);
    this.o.state = this.inc ? this.inc.phase : this.o.s;
    if (this.o.s === 'taunt' && this.o.tk === 'nap' && (this.snoreT -= r) <= 0) { this.snoreT = 1.3; this.ctx.audio.snore(); this.ctx.fx.snore(this.headPos()); }
    this.updateMood(r);
    if (this.dirty || (this.softDirty && this.real - this.sentAt > 0.2)) this.sendState();
  }

  updateMe(r) {
    const p = this.p;
    const { player } = this.ctx;
    p.st += r;
    if (p.buffer) { p.buffer.t -= r; if (p.buffer.t <= 0) p.buffer = null; }
    p.guardT += r;
    if (p.guardT > GUARD_WAIT && p.guard < this.gmax && !p.guardBroken) { p.guard = Math.min(this.gmax, p.guard + GUARD_REGEN * r); this.softDirty = true; }
    if (p.fury > 0 && (p.fury -= r) <= 0) this.softDirty = true;
    if ((p.blockRunT += r) > 1.2) p.blockRun = 0;
    if (this.phase !== 'fight') return;
    // flaws that trigger on their own: Kyle's phone when you stand around, Margaret's nap on a timer
    if (p.state === 'idle') p.idleT += r; else p.idleT = 0;
    if (this.me.id === 'kyle' && p.idleT >= PHONE_AFTER) { p.idleT = 0; this.taunt('phone'); }
    if (this.me.id === 'margaret' && (p.napT -= r) <= 0 && p.state === 'idle') { p.napT = rand(...NAP_EVERY); this.taunt('nap'); }
    if (p.combo > 0 && this.real - p.lastHit > 1.1) p.combo = 0;

    // a held punch turns into the heavy as soon as you are free to throw it
    for (const side of ['L', 'R']) {
      const pr = p.press[side];
      if (pr && !pr.fired && this.real - pr.t >= HOLD && this.canAct()) { pr.fired = true; this.startHeavy(side); }
    }

    switch (p.state) {
      case 'punch': {
        const P = VS_PUNCH[this.vme.punch][p.side];
        if (p.phaseP === 'startup' && p.st >= P.startup) {
          p.phaseP = 'recover'; p.st = 0;
          this.resolvePunch(p.side);
          player.guard();
        } else if (p.phaseP === 'recover' && p.st >= P.recover) this.setState('idle');
        break;
      }
      case 'dodge': {
        const held = this.ctx.inputHeld(p.dodgeDir) && !p.release;
        if ((p.st >= DODGE_MIN && !held) || p.st >= DODGE_MAX) { this.setState('dodgeRecover'); player.center(); }
        break;
      }
      case 'dodgeRecover':
        if (p.st >= DODGE_RECOVER) this.setState('idle');
        break;
      case 'hurt':
        if (p.st >= 0.32) { this.setState('idle'); player.center(); }
        break;
      case 'recover': case 'stun': case 'taunt':
        p.openT -= r;
        if (p.openT <= 0) this.closeOpen();
        break;
      case 'windup': {
        const a = p.atk.a;
        const k = clamp(p.st / p.atk.wind, 0, 1);
        player.tell(a.hand, 0.2 + k * 0.8);
        if (p.st >= p.atk.wind) this.strikeMine();
        break;
      }
      case 'strike': {
        const atk = p.atk;
        if (atk.a.kind !== 'throw') player.tell(atk.a.hand, Math.max(0, 1 - p.st / 0.08));
        if (p.st >= atk.strikeDur && atk.res) this.resolveMine(atk.res);
        else if (p.st >= atk.strikeDur + RES_TIMEOUT) this.resolveMine({ r: 'dodge' });
        break;
      }
    }
    if (p.buffer && this.canAct()) {
      const b = p.buffer; p.buffer = null;
      this.tryAct(b.action);
    }
  }

  strikeMine() {
    const p = this.p, atk = p.atk, a = atk.a;
    const { player, audio, fx } = this.ctx;
    this.setState('strike');
    player.strike(a.hand, a.kind);
    player.tell(a.hand, a.kind === 'throw' ? 0 : 1, '#ffffff');
    audio.whiff();
    if (a.kind === 'throw') {
      const from = player.gloves[a.hand].grp.getWorldPosition(new THREE.Vector3());
      atk.proj = fx.projectile(atk.prop, from, this.headPos(), atk.strikeDur);
    }
  }

  // the defender's verdict on your attack
  resolveMine(m) {
    const p = this.p, atk = p.atk, a = atk.a;
    const { fighter, fx, audio, player, ui, time, post, arena } = this.ctx;
    player.tell(a.hand, 0);
    const more = p.flurry && p.flurry.seq.length > 0;
    if (m.r === 'hit') {
      const head = this.headPos();
      const strength = clamp(m.dmg / 22, 0.35, 1);
      if (atk.proj) atk.proj.remove();
      fighter.hit(a.hand, strength);
      fighter.setExpr('hurt', 0.4);
      fx.impact(head.clone().addScaledVector(this.toCam(head), 0.16), strength, this.toCam(head));
      audio.punch(strength, a.kind === 'jab' ? 'cross' : 'counter');
      player.addTrauma(0.15 + strength * 0.25);
      time.hitstop(0.05 + strength * 0.05);
      this.gainMeter(12);
      this.s.landed++; this.s.dmgDealt += m.dmg;
      this.hype = Math.min(1, this.hype + 0.1);
      this.lastSide = a.hand;
      if (m.dmg >= 20) { ui.callout(pick(CALLOUTS.haymaker), { size: 'l', color: this.me.theme.a }); arena.cheer(0.6); audio.cheer(0.5); post.pulse('invert', 1); }
    } else {
      if (atk.proj) atk.proj.miss(flipDir(m.dir));
      ui.popup(m.r === 'perfect' ? 'PERFECT DODGED' : 'WHIFFED');
    }
    p.atk = null;
    if (more) { player.center(); this.nextInFlurry(m.r === 'hit' ? 0.12 : 0.08); return; }
    const wasFlurry = !!p.flurry;
    p.flurry = null;
    if (m.r === 'hit') {
      if (this.me.id === 'chad') this.taunt('flex');
      else if (this.me.id === 'brenda' && (wasFlurry || atk.special)) this.taunt('sip');
      else { this.setState('idle'); player.center(); }
      return;
    }
    if (m.r === 'perfect') this.open('stun', 0.95 + (wasFlurry ? 0.35 : 0));
    else this.open('recover', a.recover + (wasFlurry ? 0.4 : 0));
  }

  // your punch, judged here against what their last report says
  resolvePunch(side) {
    const { fighter, fx, audio, player, ui, time, post } = this.ctx;
    const o = this.o, inc = this.inc, p = this.p;
    if (this.phase !== 'fight' || o.s === 'down') return;
    const head = this.headPos();
    const hitPos = head.clone().addScaledVector(this.toCam(head), 0.16);
    const prof = VS_PUNCH[this.vme.punch][side];

    let kind;
    if (o.s === 'dodge') kind = 'whiff';
    else if (OPEN.includes(o.s)) kind = o.s === 'recover' ? 'counter' : o.s === 'taunt' ? 'taunt' : 'stun';
    // Derek's flaw: nothing he throws is armored
    else if (inc && inc.phase === 'windup' && (this.d.id === 'derek' ? inc.st > 0.04 : inc.st > 0.12 && inc.a.interrupt && !inc.fl)) kind = 'interrupt';
    else if (inc || o.s === 'windup' || o.s === 'strike') kind = 'armor';
    else kind = 'block';

    if (kind === 'whiff') { ui.popup('SLIPPED'); return; }
    if (kind === 'block') {
      fighter.setPose('block', 400, 26);
      fighter.blocked(side);
      player.rebound(side, 'block');
      audio.block();
      fx.burst(hitPos.clone().add(new THREE.Vector3(0, -0.12, 0.1)), 0.18, '#9fd8ff', 0.1);
      this.net.send({ k: 'pun', side, kind, g: (side === 'R' ? 18 : 14) * this.power() });
      this.after(0.3, () => { if (!this.inc && (this.o.s === 'idle' || this.o.s === 'wait')) fighter.setPose('guard', 220, 20); });
      return;
    }
    if (kind === 'armor') {
      fighter.hit(side, 0.15);
      audio.block();
      fx.burst(hitPos, 0.15, '#ffffff', 0.08);
      player.rebound(side, 'block');
      ui.popup('ARMORED!');
      this.net.send({ k: 'pun', side, kind, dmg: 1 });
      return;
    }

    // clean hit
    const first = this.hitsInWindow === 0;
    let mult = 1 + p.combo * 0.12, label = null, big = false;
    if (kind === 'counter' && first) { mult *= 1.6; label = pick(CALLOUTS.counter); big = true; this.s.counters++; }
    if (kind === 'interrupt') { mult *= 1.4; label = pick(CALLOUTS.interrupt); big = true; this.s.counters++; }
    if (kind === 'stun') mult *= 1.15;
    if (kind === 'taunt' && first) {
      const nap = o.tk === 'nap';
      mult *= nap ? 2.5 : 2.2; label = nap ? 'RUDE!' : pick(CALLOUTS.disrespect); big = true;
      this.gainMeter(20);
    }
    const dmg = prof.dmg * this.power() * mult;
    this.hitsInWindow++;
    const capAt = o.s === 'stun' ? 5 : 4;
    const capped = kind !== 'interrupt' && this.hitsInWindow >= capAt;
    this.net.send({ k: 'pun', side, kind, dmg, cap: capped });
    o.hp = Math.max(0, o.hp - dmg);
    p.combo++; p.lastHit = this.real;
    this.s.landed++; this.s.dmgDealt += dmg;
    this.s.maxCombo = Math.max(this.s.maxCombo, p.combo);
    this.gainMeter(big ? 10 : 3);
    this.hype = Math.min(1, this.hype + (big ? 0.15 : 0.04));
    this.lastSide = side;

    const strength = clamp((big ? 0.75 : 0.35) + (side === 'R' ? 0.15 : 0) + p.combo * 0.03, 0, 1);
    fighter.hit(side, strength);
    fighter.setPose(side === 'L' ? 'hurtL' : 'hurtR', 260, 16);
    fighter.setExpr('hurt', 0.35);
    player.rebound(side, 'hit');
    player.addTrauma(0.12 + strength * 0.2);
    fx.impact(hitPos, strength, this.toCam(head));
    if (side === 'R' && (big || Math.random() < 0.18)) { fx.teethOut(head, big ? 2 : 1); audio.teeth(); this.s.teeth += big ? 2 : 1; }
    audio.punch(strength, big ? 'counter' : side === 'L' ? 'jab' : 'cross');
    time.hitstop(big ? 0.1 : 0.045);
    if (big) { post.pulse('invert', 1); post.pulse('ca', 0.01); ui.callout(label, { size: 'l', color: this.me.theme.a }); this.ctx.arena.cheer(0.5); audio.cheer(0.5); }
    else if (p.combo >= 4 && p.combo % 2 === 0) ui.callout(`${p.combo} HIT ${pick(CALLOUTS.combo)}`, { size: 'm', color: '#ffd23f', dur: 0.6 });

    if (kind === 'interrupt') {
      // their wind-up dies here; their own report will confirm the opening
      this.cancelIncoming();
      o.s = 'recover';
      this.hitsInWindow = 0;
      this.after(0.22, () => { if (this.o.s === 'recover') fighter.setPose('open', 180, 16); });
    } else if (kind === 'taunt') {
      // they drop the pose: a nap wakes up (briefly dazed), anything else is stunned
      o.s = 'stun';
      this.after(0.22, () => { if (this.o.s === 'stun') fighter.setPose('dizzy', 160, 12); });
    } else if (capped) {
      o.s = 'idle';
      fx.dizzy(false);
      this.after(0.2, () => { if (!this.inc) fighter.setPose('block', 300, 22); });
    } else {
      this.after(0.22, () => { if (OPEN.includes(this.o.s) && !this.inc) fighter.setPose(this.o.s === 'stun' ? 'dizzy' : 'open', 180, 16); });
    }
  }

  // ---------- their attack at you ----------
  updateIncoming(r) {
    const inc = this.inc;
    if (!inc) return;
    const { fighter, fx, audio, player } = this.ctx;
    const a = inc.a;
    inc.st += r;
    if (inc.phase === 'windup') {
      const k = clamp(inc.st / inc.wind, 0, 1);
      fighter.tell(a.hand, 0.2 + k * 0.8);
      fighter.windup(a.hand, k);
      if (inc.st >= inc.wind) {
        inc.phase = 'strike'; inc.st = 0;
        fighter.windup(null);
        fighter.tell(a.hand, a.kind === 'throw' ? 0 : 1, '#ffffff');
        if (a.kind === 'throw') {
          const from = fighter.gloveWorld(a.hand, new THREE.Vector3());
          const to = player.rig.position.clone().add(new THREE.Vector3(0, -0.05, -0.25));
          inc.proj = fx.projectile(inc.prop, from, to, inc.strikeDur);
          fighter.setPose('throwM', 600, 30);
        } else fighter.strikePose(strikeKey(a), a.kind);
        audio.whiff();
      }
    } else {
      if (a.kind !== 'throw') fighter.tell(a.hand, Math.max(0, 1 - inc.st / 0.08));
      if (inc.st >= inc.strikeDur) this.resolveIncoming();
    }
  }

  resolveIncoming() {
    const inc = this.inc, a = inc.a, p = this.p;
    const { fighter, audio, player, post, ui, fx, arena, time } = this.ctx;
    this.inc = null;
    fighter.tell(a.hand, 0);
    fighter.energy = 1;
    if (a.pose === 'pivot') { const tw = fighter.springs.s.twist; tw.value -= Math.PI * 2; tw.target -= Math.PI * 2; }
    const more = inc.fl && !inc.fl.last;
    if (!more) this.lightsOn();

    if (p.state === 'dodge' && a.avoid.includes(p.dodgeDir)) {
      const perfect = this.real - p.dodgeStart < PERFECT_WIN;
      this.net.send({ k: 'res', n: inc.n, r: perfect ? 'perfect' : 'dodge', dir: p.dodgeDir });
      this.s.dodges++;
      if (!this.ctx.inputHeld(p.dodgeDir)) p.st = Math.max(p.st, DODGE_MIN);
      if (inc.proj) inc.proj.miss(p.dodgeDir);
      if (perfect) {
        this.s.perfects++;
        this.gainMeter(30);
        audio.perfect();
        this.ctx.buzz(12);
        post.pulse('ca', 0.012);
        ui.callout(pick(CALLOUTS.perfect), { size: 'l', color: this.d.theme.b });
        this.hype = Math.min(1, this.hype + 0.12);
        arena.cheer(0.4);
        audio.ooh();
      } else this.gainMeter(8);
      if (more) { fighter.setPose('guard', 300, 24); return; }
      // predict their opening now; their own report follows a moment later
      this.o.s = perfect ? 'stun' : 'recover';
      this.hitsInWindow = 0;
      fighter.setExpr(perfect ? 'dizzy' : 'shock', 0.5);
      fighter.setPose(perfect ? 'dizzy' : 'open', 160, perfect ? 12 : 14);
      if (perfect) { fx.dizzy(true); audio.stars(); }
      return;
    }

    let dmg = ATTACKS[inc.id].dmg * inc.pw;
    let note = null;
    if (a.kind === 'upper' && p.state === 'dodge' && p.dodgeDir === 'duck') { dmg *= 1.4; note = 'DUCKED INTO IT'; }
    if (p.state === 'punch' || p.state === 'windup') { dmg *= 1.25; note = note || 'COUNTERED'; }
    dmg = Math.round(dmg * 10) / 10;
    this.net.send({ k: 'res', n: inc.n, r: 'hit', dmg });
    p.hp -= dmg;
    this.s.hitsTaken++;
    this.s.dmgTaken += dmg;
    this.gainMeter(dmg * 0.5);
    p.combo = 0;
    this.cancelMine();
    this.setState('hurt');
    const strength = clamp(dmg / 25, 0.3, 1);
    player.hurt(strength, a.hand);
    post.pulse('hurt', 0.5 + strength * 0.5);
    post.pulse('ca', 0.015 * strength);
    audio.playerHit(strength);
    this.ctx.buzz(Math.round(25 + strength * 35));
    time.hitstop(0.06 + strength * 0.05);
    this.hype = Math.min(1, this.hype + 0.05);
    if (note) ui.popup(note);
    if (this.d.id === 'derek' && p.meter > 0) {
      // BILLABLE HOURS
      p.meter = Math.max(0, p.meter - 20);
      ui.popup('INVOICED: −20 METER');
      audio.cash();
    }
    if (inc.proj) {
      inc.proj.remove();
      ui.splat(inc.prop);
      if (inc.prop === 'paper') { audio.paper(); fx.paperBurst(player.rig.position.clone().add(new THREE.Vector3(0, 0, -0.5)), 10); }
      else if (inc.prop === 'coffee') audio.splash();
      else if (inc.prop === 'cash') fx.coinsOut(player.rig.position.clone().add(new THREE.Vector3(0, -0.2, -0.5)), 12);
    }
    fighter.setExpr('taunt', 0.6);
    fighter.setPose('guard', 200, 18);
    if (p.hp <= 0) { p.hp = 0; this.goDown(); }
  }

  // ---------- knockdowns ----------
  goDown() {
    const { audio, ui, player, time, post, arena, fighter } = this.ctx;
    const p = this.p;
    this.cancelMine();
    this.cancelIncoming();
    p.kd++;
    p.press.L = p.press.R = null;
    this.setState('down');
    this.phase = 'playerDown';
    time.hitstop(0.2);
    post.pulse('flash', 0.4);
    post.fx.sat = 0.35;
    player.knockedDown();
    audio.knockdown(); audio.ooh();
    arena.cheer(0.6);
    fighter.setPose('victory', 90, 10);
    fighter.setExpr('taunt');
    this.ctx.buzz([120, 60, 60]);
    this.sendState();
    if (p.kd >= MAX_KD) { this.lose('T.K.O.'); return; }
    if (this.me.id === 'roland' && !p.jacket) {
      // GOLDEN PARACHUTE: straight back up, and the jacket comes off
      p.jacket = true;
      this.downT = 99;
      ui.callout('GOLDEN PARACHUTE', { size: 'l', color: '#ffc233', dur: 1.2 });
      this.after(1.4, () => { if (this.phase === 'playerDown') this.getUp(0.5); });
      return;
    }
    p.taps = 0; p.need = 9 + p.kd * 5; p.count = 0;
    this.downT = 0.6;
    ui.mash(0, this.ctx.isTouch() ? 'TAP TAP TAP TO GET UP!' : 'MASH J / K TO GET UP!');
  }

  updateDown(r) {
    const p = this.p;
    const { ui, audio, player, post, fighter } = this.ctx;
    this.downT -= r;
    if (p.need) ui.mash(Math.min(1, p.taps / p.need));
    if (p.need && p.taps >= p.need) { this.getUp(Math.max(0.25, 0.6 - 0.15 * (p.kd - 1))); return; }
    if (this.downT <= 0) {
      p.count++;
      this.downT = 0.95;
      ui.count(p.count);
      audio.count(p.count);
      this.net.send({ k: 'count', n: p.count });
      if (p.count >= 10) { ui.mash(null); this.lose('K.O.'); }
    }
  }

  // a verdict that arrived with the knockdown still counts, so the finishing blow lands on screen
  settlePending() { if (this.p.atk?.res) this.resolveMine(this.p.atk.res); }

  getUp(frac) {
    const p = this.p;
    const { ui, audio, player, post, fighter } = this.ctx;
    ui.mash(null); ui.count(null);
    post.fx.sat = 1;
    p.hp = p.max * frac;
    p.need = 0;
    this.phase = 'fight';
    this.setState('idle');
    player.center();
    fighter.setPose('guard', 160, 16);
    fighter.setExpr('shock', 0.8);
    audio.cheer(0.8);
    ui.callout(p.jacket && this.me.id === 'roland' ? 'THE JACKET COMES OFF' : 'BACK UP!', { size: 'l', color: '#3dff7a', dur: 0.8 });
  }

  oppDown() {
    const { fighter, audio, ui, arena, time, post, fx, player } = this.ctx;
    this.settlePending();
    this.cancelIncoming();
    this.p.press.L = this.p.press.R = null;
    if (this.p.state !== 'idle') { this.cancelMine(); this.setState('idle'); player.center(); }
    this.phase = 'oppDown';
    fighter.setPose('down', 70, 9);
    fighter.setExpr('ko');
    fx.dizzy(false);
    time.hitstop(0.18);
    post.pulse('invert', 1); post.pulse('flash', 0.35);
    player.addTrauma(0.5);
    ui.callout('DOWN!', { size: 'xl', color: this.me.theme.a, dur: 1.2 });
    audio.stinger('knockdown');
    arena.cheer(1); arena.flashes(30); audio.cheer(1);
    this.hype = 1;
    this.after(0.55, () => { audio.knockdown(); player.addTrauma(0.3); arena.ropeHit(0.4); });
  }

  lose(label) {
    const { ui, audio } = this.ctx;
    if (this.phase === 'lost' || this.phase === 'done') return;
    this.phase = 'lost';
    this.net.send({ k: 'ko' });
    ui.callout(label, { size: 'xxl', color: '#ff2e55', dur: 2 });
    audio.stopMusic(1.5);
    this.after(0.5, () => { this.snapshot = this.ctx.capture(); });
    this.after(2.4, () => this.finish(false, 'ko'));
  }

  koWin() {
    const { fighter, audio, ui, arena, time, post, fx, player } = this.ctx;
    if (this.phase === 'ko' || this.phase === 'done') return;
    this.settlePending();
    this.cancelIncoming();
    this.cancelMine();
    this.phase = 'ko';
    ui.count(null);
    fighter.setExpr('ko');
    fighter.setPose('hurtHead', 60, 6);
    fighter.energy = 0;
    fx.dizzy(false);
    const head = this.headPos();
    fx.teethOut(head, 5); this.s.teeth += 5;
    fx.impact(head, 1, this.toCam(head));
    time.hitstop(0.22);
    post.pulse('invert', 1); post.pulse('flash', 0.6); post.pulse('ca', 0.03);
    player.addTrauma(1);
    player.drop();
    audio.ko();
    this.ctx.buzz([70, 50, 140]);
    audio.stinger('ko');
    audio.stopMusic(1.5);
    this.hype = 1;
    const dir = this.lastSide === 'L' ? 1 : -1;
    fighter.launch(new THREE.Vector3(dir * 0.6, 3.6, -3.8));
    player.lookOverride = new THREE.Vector3();
    this.trackKO = true;
    this.after(0.22, () => { this.koCut = { dir }; });
    arena.flashes(60);
    this.after(0.25, () => { ui.callout('K.O.!', { size: 'xxl', color: '#ffd23f', dur: 3 }); audio.say('Knockout!', { rate: 0.9, pitch: 0.6 }); });
    this.after(0.8, () => { this.snapshot = this.ctx.capture(); });
    this.after(0.7, () => { arena.cheer(1); audio.cheer(1); fx.confettiBurst(new THREE.Vector3(0, 4.5, -2.5), 220, [this.me.theme.a, this.me.theme.b, '#ffd23f', '#ffffff']); audio.bell(3); });
    this.after(4.2, () => this.finish(true, 'ko'));
  }

  // the host's clock runs out: fewer knockdowns wins, then more HP left
  roundOver() {
    this.timeUp = true;
    if (!this.host || this.phase === 'ko' || this.phase === 'lost') return;
    const p = this.p, o = this.o;
    const win = p.kd < o.kd || (p.kd === o.kd && p.hp / p.max >= o.hp / o.max);
    this.net.send({ k: 'end', win: !win });
    this.decision(win);
  }

  decision(win) {
    const { ui, audio } = this.ctx;
    if (['ko', 'lost', 'done', 'decision'].includes(this.phase)) return;
    this.cancelIncoming();
    this.cancelMine();
    this.phase = 'decision';
    ui.mash(null); ui.count(null);
    audio.bell(3);
    audio.stopMusic(1.5);
    ui.callout('TIME!', { size: 'xxl', color: '#ffd23f', dur: 1.6 });
    this.after(1.7, () => ui.callout(win ? 'YOU WIN ON POINTS' : 'LOST ON POINTS', { size: 'l', color: win ? '#3dff7a' : '#ff2e55', dur: 1.6 }));
    this.after(0.4, () => { this.snapshot = this.ctx.capture(); });
    this.after(3.6, () => this.finish(win, 'decision'));
  }

  forfeit() {
    if (['ko', 'lost', 'done'].includes(this.phase)) return;
    this.cancelIncoming();
    this.phase = 'decision';
    this.ctx.ui.mash(null); this.ctx.ui.count(null);
    this.ctx.ui.callout('OPPONENT CLOCKED OUT', { size: 'l', color: '#ffd23f', dur: 1.8 });
    this.after(2, () => this.finish(true, 'forfeit'));
  }

  updateMood(r) {
    const { audio, post, ui } = this.ctx;
    const p = this.p, o = this.o;
    audio.setIntensity(clamp(0.35 + (1 - o.hp / o.max) * 0.25 + (1 - p.hp / p.max) * 0.25 + (this.hype - 0.3) * 0.5, 0, 1));
    audio.setCrowd(clamp(this.hype, 0.2, 1));
    const low = p.hp / p.max < 0.3 && this.phase === 'fight';
    post.fx.lowHp = low ? 1 : 0;
    if (low) {
      this.heart -= r;
      if (this.heart <= 0) { this.heart = 0.85; audio.heartbeat(); }
    }
    ui.hud({
      php: p.hp / p.max, ohp: o.hp / o.max, meter: p.meter / 100, time: Math.max(0, ROUND - this.time), score: 0,
      combo: p.combo, pkd: p.kd, okd: o.kd, maxOkd: MAX_KD, pguard: p.guard / this.gmax, oguard: o.guard / o.gm,
    });
  }

  finish(win, why) {
    if (this.done) return;
    this.done = true;
    this.phase = 'done';
    const { ui, post } = this.ctx;
    ui.count(null); ui.mash(null);
    post.fx.sat = 1; post.fx.lowHp = 0; post.fx.dark = 0;
    this.ctx.arena.blackout(false);
    this.ctx.onEnd({ win, why, stats: this.s, time: this.time, pkd: this.p.kd, okd: this.o.kd, snapshot: this.snapshot });
  }
}
