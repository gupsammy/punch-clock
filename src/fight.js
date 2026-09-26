import * as THREE from 'three';
import { ATTACKS, FLURRIES, CALLOUTS, ROSTER } from './config.js';
import { rand, pick, weighted, clamp } from './spring.js';

// Combat rules and opponent AI. Visual/audio side effects go through ctx:
// { fighter, player, fx, audio, ui, arena, post, time, feed, clip, capture, isTouch, buzz }
// opts (Daily Shift only): { mod, perk, startHp, run } — see shift.js

const PERFECT_WIN = 0.12;       // dodge started this close to impact = PERFECT
const DODGE_MIN = 0.42, DODGE_MAX = 0.6, DODGE_RECOVER = 0.14;
const PUNCH = { L: { startup: 0.075, recover: 0.15, dmg: 3.4 }, R: { startup: 0.11, recover: 0.2, dmg: 5.6 } };
export const TELL_COLORS = { jab: '#fff4c2', hook: '#ff3b6b', upper: '#ff3b3b', smash: '#ff8a1a', throw: '#7df9ff', special: '#d36bff' };

export class Fight {
  constructor(data, index, ctx, opts = {}) {
    this.d = data;
    this.index = index;
    this.ctx = ctx;
    this.mod = opts.mod || {};
    this.perk = opts.perk || null;
    this.run = opts.run || null;
    this.blackT = 0; this.dark = false;
    this.phase = 'intro';
    this.time = 0;
    this.real = 0;
    this.timers = [];
    this.p = { hp: opts.startHp ?? 100, state: 'idle', st: 0, dodgeDir: null, dodgeStart: 0, side: null, meter: 0, kd: 0, combo: 0, lastHit: -9, buffer: null, taps: 0, need: 0, count: 0 };
    const oppHp = data.hp * (this.mod.oppHp || 1);
    this.o = { hp: oppHp, max: oppHp, state: 'idle', st: 0, idleT: 1.2, atk: null, atkId: null, queue: [], flurry: null, kd: 0, phase: 0,
      openT: 0, openKind: null, hitsInWindow: 0, blockCount: 0, feint: false, lastMoves: [], wind: 0 };
    this.s = { landed: 0, thrown: 0, blocked: 0, perfects: 0, dodges: 0, counters: 0, hitsTaken: 0, dmgTaken: 0, maxCombo: 0, score: 0, disrespect: 0, billed: 0, teeth: 0, haymakers: 0 };
    this.hype = 0.3;
    this.tut = data.tutorial ? { jab: 0, hook: 0, upper: 0, throw: 0, open: 0, meter: 0, first: 3 } : null;
    this.heart = 0;
  }

  // ---------- helpers ----------
  after(sec, fn, real = false) { this.timers.push({ t: sec, fn, real }); }
  say(pool, chance = 1, dur = 1.8) {
    const lines = this.d.lines[pool];
    if (lines && Math.random() < chance) this.ctx.ui.say(pick(lines), dur);
  }
  score(n, label) {
    this.s.score += Math.round(n);
    if (label) this.ctx.ui.popup(`+${Math.round(n)} ${label}`);
  }
  headPos() { return this.ctx.fighter.headWorld(new THREE.Vector3()); }
  toCam(pos) { return new THREE.Vector3().subVectors(this.ctx.player.rig.position, pos).normalize(); }
  // how long this opponent lingers between moves, from their roster idle range (1 = average)
  get tempo() { const i = this.d.idle || [1, 2]; return (i[0] + i[1]) / 3; }
  gainMeter(n) {
    if (this.mod.noMeter) return;
    this.p.meter = Math.min(100, this.p.meter + n * (this.perk === 'podcast' ? 1.5 : 1));
  }
  get speed() { return (this.mod.speed || 1) * (this.d.speed || 1) * (1 - 0.07 * this.o.phase) * (this.tut && this.tut.first > 0 ? 1.3 : 1); }

  // ---------- flow ----------
  intro() {
    const { fighter, audio } = this.ctx;
    fighter.setPose(this.d.taunt === 'nap' ? 'guard' : this.tauntPose(), 90, 12);
    fighter.setExpr('taunt');
    this.tauntProp(true);
    audio.setCrowd(0.4);
  }

  start() {
    const { fighter, audio, ui, arena } = this.ctx;
    this.phase = 'fight';
    fighter.setPose('guard');
    fighter.setExpr('idle');
    this.tauntProp(false);
    this.o.state = 'idle';
    this.o.idleT = 1.4;
    audio.bell(1);
    audio.stinger('fight');
    audio.say('Fight!', { rate: 1.1, pitch: 0.7 });
    ui.callout('FIGHT!', { size: 'xl', color: this.d.theme.a, dur: 0.9 });
    arena.cheer(0.8);
    audio.cheer(0.7);
    this.after(1.2, () => this.ctx.feed.event('start'));
    if (this.tut) ui.hint(this.ctx.isTouch() ? 'TAP LEFT / RIGHT TO PUNCH · SWIPE TO DODGE' : 'J / K PUNCH · A / D DODGE · S DUCK');
    this.after(3.2, () => { if (this.tut) ui.hint(null); });
  }

  // ---------- input ----------
  input(action, down) {
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
    if (!down) {
      if ((action === 'left' || action === 'right' || action === 'duck') && p.state === 'dodge' && p.dodgeDir === action) p.release = true;
      return;
    }
    if (action === 'jabL' || action === 'jabR' || action === 'left' || action === 'right' || action === 'duck' || action === 'haymaker') {
      if (!this.tryAct(action)) p.buffer = { action, t: 0.16 };
    }
  }

  canPunch() {
    const p = this.p;
    return p.state === 'idle' || (p.state === 'punch' && p.phaseP === 'recover' && p.st > 0.07);
  }
  canDodge() {
    const p = this.p;
    return p.state === 'idle' || p.state === 'punch' || p.state === 'dodgeRecover';
  }

  tryAct(action) {
    const p = this.p;
    if (action === 'jabL' || action === 'jabR') {
      if (!this.canPunch()) return false;
      this.startPunch(action === 'jabL' ? 'L' : 'R');
      return true;
    }
    if (action === 'haymaker') {
      if (p.meter < 100) { if (p.state === 'idle') this.ctx.ui.popup(this.mod.noMeter ? 'OVERTIME CANCELLED (BUDGET)' : 'OVERTIME NOT READY'); return true; }
      if (!this.canPunch()) return false;
      this.startHaymaker();
      return true;
    }
    if (!this.canDodge()) return false;
    this.startDodge(action);
    return true;
  }

  startPunch(side) {
    const p = this.p;
    p.state = 'punch'; p.side = side; p.phaseP = 'startup'; p.st = 0;
    this.s.thrown++;
    this.ctx.player.punch(side);
    this.ctx.audio.whiff();
  }

  startDodge(dir) {
    const p = this.p;
    p.state = 'dodge'; p.dodgeDir = dir; p.dodgeStart = this.time; p.st = 0; p.release = false;
    if (dir === 'duck') this.ctx.player.duck(); else this.ctx.player.dodge(dir);
    this.ctx.audio.dodge();
  }

  startHaymaker() {
    const { player, audio, ui, time } = this.ctx;
    const p = this.p;
    p.state = 'haymaker'; p.st = 0; p.meter = 0;
    this.s.thrown++;
    player.haymakerWind();
    player.charge = 1;
    audio.haymakerCharge();
    time.slowmo(0.55, 0.35);
    ui.callout('OVERTIME!', { size: 'l', color: '#ffd23f', dur: 0.5 });
    this.ctx.feed.event('haymaker', 0.7);
  }

  // ---------- update ----------
  update(dt, realDt) {
    this.real += realDt;
    for (let i = this.timers.length - 1; i >= 0; i--) {
      const tm = this.timers[i];
      tm.t -= tm.real ? realDt : dt;
      if (tm.t <= 0) { this.timers.splice(i, 1); tm.fn(); }
    }
    if (this.phase === 'fight') this.time += dt;
    if (this.mod.blackouts) this.updateBlackouts(dt);
    this.hype = Math.max(0.25, this.hype - dt * 0.05);
    this.updatePlayer(dt);
    this.updateOpp(dt);
    if (this.phase === 'playerDown') this.updateDown(dt);
    this.updateMood(dt);
  }

  // LAYOFFS WEEK: the building cuts the lights on a timer
  updateBlackouts(dt) {
    const { arena, post, audio } = this.ctx;
    if (this.dark || this.phase === 'fight') this.blackT += dt;
    if (!this.dark && this.blackT > 14) {
      this.dark = true; this.blackT = 0;
      arena.blackout(true); post.fx.dark = 1; audio.lightsOut();
      this.ctx.ui.popup('POWER SAVING MODE');
    } else if (this.dark && this.blackT > 2.5) {
      this.dark = false; this.blackT = 0;
      if (!this.o.flurry?.dark) { arena.blackout(false); post.fx.dark = 0; }
    }
  }

  updateMood(dt) {
    const { audio, post, ui } = this.ctx;
    const p = this.p, o = this.o;
    const lost = 1 - o.hp / o.max;
    audio.setIntensity(clamp(0.3 + lost * 0.4 + o.phase * 0.15 + (this.hype - 0.3) * 0.5, 0, 1));
    audio.setCrowd(clamp(this.hype, 0.2, 1));
    const low = p.hp < 30 && this.phase === 'fight';
    post.fx.lowHp = low ? 1 : 0;
    if (low) {
      this.heart -= dt;
      if (this.heart <= 0) { this.heart = 0.85; audio.heartbeat(); }
    }
    ui.hud({
      php: p.hp / 100, ohp: o.hp / o.max, meter: p.meter / 100, time: this.time + (this.run?.time || 0), score: this.s.score,
      combo: p.combo, pkd: p.kd, okd: o.kd, maxOkd: this.d.knockdowns,
    });
    if (this.tut && p.meter >= 100 && !this.tut.meter) {
      this.tut.meter = 1;
      ui.hint(this.ctx.isTouch() ? 'OVERTIME READY — SWIPE UP FOR A HAYMAKER' : 'OVERTIME READY — SPACE FOR A HAYMAKER');
      this.after(3, () => ui.hint(null));
    }
  }

  updatePlayer(dt) {
    const p = this.p;
    const { player } = this.ctx;
    p.st += dt;
    if (p.buffer) { p.buffer.t -= dt; if (p.buffer.t <= 0) p.buffer = null; }
    if (this.phase !== 'fight') return;
    if (p.combo > 0 && this.time - p.lastHit > 1.1) p.combo = 0;

    switch (p.state) {
      case 'punch': {
        const P = PUNCH[p.side];
        if (p.phaseP === 'startup' && p.st >= P.startup) {
          p.phaseP = 'recover'; p.st = 0;
          this.resolvePunch(p.side);
          player.guard();
        } else if (p.phaseP === 'recover' && p.st >= P.recover) {
          p.state = 'idle';
        }
        break;
      }
      case 'dodge': {
        const held = this.ctx.inputHeld(p.dodgeDir) && !p.release;
        if ((p.st >= DODGE_MIN && !held) || p.st >= DODGE_MAX) {
          p.state = 'dodgeRecover'; p.st = 0;
          player.center();
        }
        break;
      }
      case 'dodgeRecover':
        if (p.st >= DODGE_RECOVER) p.state = 'idle';
        break;
      case 'hurt':
        if (p.st >= 0.32) { p.state = 'idle'; player.center(); }
        break;
      case 'haymaker':
        if (p.st >= 0.36 && !p.hayDone) {
          p.hayDone = true;
          player.haymakerStrike();
          this.resolveHaymaker();
        }
        if (p.st >= 0.62) { p.state = 'idle'; p.hayDone = false; player.charge = 0; player.center(); }
        break;
    }
    if (p.state === 'idle' && p.buffer) {
      const b = p.buffer; p.buffer = null;
      this.tryAct(b.action);
    }
  }

  // ---------- player punches ----------
  resolvePunch(side) {
    const { fighter, fx, audio, player, ui, time, post } = this.ctx;
    const o = this.o, p = this.p;
    const head = this.headPos();
    const hitPos = head.clone().addScaledVector(this.toCam(head), 0.16);
    if (['down', 'ko', 'getup'].includes(o.state) || this.phase !== 'fight') return;

    let kind = null;
    if (o.openT > 0) kind = o.openKind;
    else if (o.state === 'windup' && o.atk && o.atk.interrupt && !o.flurry && o.st > 0.12) kind = 'interrupt';
    else if (o.state === 'windup' || o.state === 'strike') kind = 'armor';
    else if (Math.random() < (this.d.guardLeak || 0)) kind = 'leak';

    if (!kind) {
      // guarded
      this.s.blocked++;
      o.blockCount++;
      fighter.setPose('block', 400, 26);
      fighter.blocked(side);
      player.rebound(side, 'block');
      audio.block();
      fx.burst(hitPos.clone().add(new THREE.Vector3(0, -0.12, 0.1)), 0.18, '#9fd8ff', 0.1);
      o.state = 'block'; o.st = 0;
      o.hp = Math.max(1, o.hp - 0.4);
      if (o.blockCount >= (this.d.blockCounterAt || 99)) {
        o.blockCount = 0;
        this.after(0.08, () => { if (o.state === 'block') this.beginAttack('counter'); });
      }
      if (this.tut && this.tut.open < 1 && this.s.blocked === 3) {
        ui.hint('HE\'S BLOCKING — DODGE HIS PUNCH, THEN HIT THE OPENING');
        this.after(3, () => ui.hint(null));
      }
      return;
    }

    if (kind === 'armor') {
      fighter.hit(side, 0.15);
      audio.block();
      fx.burst(hitPos, 0.15, '#ffffff', 0.08);
      player.rebound(side, 'block');
      o.hp = Math.max(1, o.hp - 1);
      ui.popup('ARMORED!');
      return;
    }

    // clean hit
    let mult = 1 + p.combo * 0.12 * (this.mod.combo || 1);
    let label = null, big = false;
    const first = o.hitsInWindow === 0;
    if (kind === 'counter' && first) { mult *= 1.6; label = pick(CALLOUTS.counter); this.s.counters++; big = true; this.score(250); }
    if (kind === 'interrupt') { mult *= 1.4; label = pick(CALLOUTS.interrupt); this.s.counters++; big = true; this.cancelAttack(); this.open('counter', 0.55); this.score(300); }
    if (kind === 'taunt' && first) { mult *= 2.2; label = pick(CALLOUTS.disrespect); this.s.disrespect++; big = true; this.score(750); this.open('stun', 1.2); fx.dizzy(true); }
    if (kind === 'nap' && first) { mult *= 2.5; label = 'RUDE!'; this.s.disrespect++; big = true; this.score(1000); this.wakeUp(); }
    if (kind === 'stun') mult *= 1.15;
    if (kind === 'leak') mult *= 0.8;
    const dmg = PUNCH[side].dmg * mult * (this.d.tutorial ? 1.25 : 1);
    // the last knockdown has to be earned: anything but a statement punch leaves them hanging on
    const statement = big || (kind === 'stun' && first);
    if (o.kd === this.d.knockdowns - 1 && o.hp - dmg <= 0 && !statement) {
      o.hp = 1;
      ui.popup('HANGING ON!');
      if (!this.hangHint) {
        this.hangHint = true;
        ui.hint('FINISH WITH A COUNTER, A PERFECT-DODGE PUNISH OR OVERTIME');
        this.after(2.6, () => ui.hint(null));
      }
    } else o.hp -= dmg;
    o.hitsInWindow++;
    p.combo++;
    p.lastHit = this.time;
    this.s.landed++;
    this.s.maxCombo = Math.max(this.s.maxCombo, p.combo);
    this.gainMeter(big ? 9 : 3);
    this.hype = Math.min(1, this.hype + (big ? 0.15 : 0.04));
    this.score(dmg * 12 * (1 + p.combo * 0.1));

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
    if (big) { post.pulse('invert', 1); post.pulse('ca', 0.01); ui.callout(label, { size: 'l', color: this.d.theme.a }); this.ctx.arena.cheer(0.5); audio.cheer(0.5); this.ctx.feed.event('oppHit', 0.8); }
    else if (p.combo >= 4) {
      if (p.combo % 2 === 0) ui.callout(`${p.combo} HIT ${pick(CALLOUTS.combo)}`, { size: 'm', color: '#ffd23f', dur: 0.6 });
      this.ctx.feed.event('oppHit', 0.25);
    }
    if (Math.random() < 0.18) this.say('hit', 1, 1.2);

    if (o.hp <= 0) { o.hp = 0; this.oppDown(side); return; }
    const cap = o.openKind === 'stun' ? (this.d.comboCap || 4) + 1 : (this.d.comboCap || 4);
    if (o.hitsInWindow >= cap || (kind === 'leak')) {
      // guard comes back up
      this.closeWindow();
      o.state = 'block'; o.st = -0.1;
      this.after(0.2, () => { if (o.state === 'block') fighter.setPose('block', 300, 22); });
    } else if (o.openT > 0) {
      o.openT += 0.12;
      this.after(0.22, () => { if (o.openT > 0 && o.state !== 'down') fighter.setPose(o.openKind === 'stun' ? 'dizzy' : 'open', 180, 16); });
    }
  }

  resolveHaymaker() {
    const { fighter, fx, audio, player, ui, time, post, arena } = this.ctx;
    const o = this.o;
    if (['down', 'ko', 'getup'].includes(o.state)) return;
    const head = this.headPos();
    const guarded = o.openT <= 0 && o.state !== 'windup';
    let dmg = guarded ? 14 : 22;
    if (o.hp - dmg < 6) dmg = o.hp;
    this.cancelAttack();
    o.hp -= dmg;
    this.s.haymakers++;
    this.s.landed++;
    this.score(1000, 'HAYMAKER');
    fighter.hit('R', 1.2);
    fighter.setPose('hurtHead', 200, 12);
    fighter.setExpr('hurt', 0.6);
    fx.impact(head.clone().addScaledVector(this.toCam(head), 0.16), 1, this.toCam(head));
    fx.teethOut(head, 3); this.s.teeth += 3;
    audio.punch(1, 'haymaker'); audio.teeth(); audio.duck(0.7, 0.5);
    player.addTrauma(0.8);
    post.pulse('invert', 1); post.pulse('flash', 0.5); post.pulse('ca', 0.02);
    time.hitstop(0.16);
    ui.callout(guarded ? 'GUARD BROKEN!' : pick(CALLOUTS.haymaker), { size: 'xl', color: '#ffd23f' });
    arena.cheer(1); audio.cheer(1);
    this.hype = 1;
    if (o.hp <= 0) { o.hp = 0; this.oppDown('R'); return; }
    this.open('stun', 1.3);
    fx.dizzy(true);
    this.after(0.25, () => { if (o.openKind === 'stun') fighter.setPose('dizzy', 120, 10); fighter.setExpr('dizzy'); });
  }

  open(kind, dur) {
    const o = this.o;
    o.openT = dur;
    o.openKind = kind;
    o.hitsInWindow = 0;
    o.state = kind === 'stun' ? 'stun' : kind === 'taunt' || kind === 'nap' ? o.state : 'recover';
    o.st = 0;
    if (this.tut && !this.tut.open && kind === 'counter') {
      this.tut.open = 1;
      this.ctx.ui.hint('HE MISSED — PUNCH HIM NOW!');
      this.after(1.6, () => this.ctx.ui.hint(null));
    }
  }
  closeWindow() {
    const o = this.o;
    o.openT = 0; o.openKind = null; o.hitsInWindow = 0;
    this.ctx.fx.dizzy(false);
    this.p.combo = Math.min(this.p.combo, 99);
  }

  // ---------- opponent ----------
  tauntPose() {
    return { phone: 'phone', sip: 'sip', flex: 'flex', invoice: 'invoice', nap: 'nap', cash: 'cash' }[this.d.taunt] || 'flex';
  }
  tauntProp(on) {
    const map = { phone: 'phone', sip: 'mug', invoice: 'paper', cash: 'cash' };
    this.ctx.fighter.showProp(on ? map[this.d.taunt] || null : null);
  }

  chooseAction() {
    const o = this.o, d = this.d;
    if (Math.random() < (d.tauntChance || 0) && o.lastMoves[0] !== 'taunt') { this.beginTaunt(); return; }
    const moves = d.moves.filter((m) => (m.minPhase || 0) <= o.phase && !(o.lastMoves[0] === m.id && o.lastMoves[1] === m.id));
    // OPEN PLAN: everyone throws more, and people who never threw things start with the kitchen's coffee
    if (this.mod.throws && !moves.some((x) => x.id === 'throwR')) moves.push({ id: 'throwR', w: 0.4, prop: 'coffee' });
    const m = weighted(this.mod.throws ? moves.map((x) => (x.id === 'throwR' ? { ...x, w: x.w * this.mod.throws } : x)) : moves);
    o.lastMoves.unshift(m.id); o.lastMoves.length = 3;
    if (m.flurry) this.beginFlurry(m.id);
    else this.beginAttack(m.id, m.prop);
  }

  beginFlurry(id) {
    const f = FLURRIES[id];
    const o = this.o;
    o.flurry = { ...f, i: 0 };
    o.queue = [...f.seq];
    if (f.name) {
      this.ctx.ui.banner(f.name, this.d.name);
      this.ctx.audio.tell('special');
    }
    if (f.dark) {
      this.ctx.arena.blackout(true); this.ctx.audio.lightsOut(); this.ctx.post.fx.dark = 1;
      ROSTER.slice(0, this.index).forEach((b, i) => this.after(0.45 + i * 0.4, () => this.ctx.feed.sys(`${b.name.toLowerCase()} has been removed from ${this.d.feed.channel}`)));
    }
    this.nextInFlurry(f.name ? 0.55 : 0);
  }

  nextInFlurry(delay = 0) {
    const o = this.o;
    const id = o.queue.shift();
    if (!id) { this.endFlurry(); return; }
    // bound to this flurry: if it was cancelled during the delay, its next attack never comes
    const fl = o.flurry;
    const go = () => { if (o.flurry === fl) this.beginAttack(id, null, fl.windup); };
    if (delay) { o.state = 'wait'; this.after(delay, go); } else go();
  }

  endFlurry(complete = true) {
    const o = this.o;
    if (o.flurry?.dark) {
      this.ctx.arena.blackout(false); this.ctx.post.fx.dark = 0;
      if (complete) this.ctx.ui.banner('LAYOFFS COMPLETE', this.d.name, '0 EMPLOYEES REMAIN');
    }
    o.flurry = null;
  }

  beginAttack(id, prop, windupOverride) {
    const { fighter, audio, fx, ui } = this.ctx;
    const o = this.o;
    if (this.phase !== 'fight' || ['down', 'getup', 'ko', 'victory'].includes(o.state)) return;
    const a = ATTACKS[id];
    o.atkId = id;
    o.atk = a;
    o.prop = prop || 'coffee';
    o.state = 'windup'; o.st = 0;
    o.wind = windupOverride || a.windup * this.speed * (id === 'counter' ? 1 / this.speed : 1);
    o.feint = !o.flurry && id !== 'counter' && Math.random() < (this.d.feintChance || 0);
    o.hitsInWindow = 0;
    this.closeWindow();
    const poseKey = a.pose ? 'wind' + a.pose[0].toUpperCase() + a.pose.slice(1)
      : a.kind === 'throw' ? 'windThrow' : a.kind === 'smash' ? 'windSmash'
        : 'wind' + a.kind[0].toUpperCase() + a.kind.slice(1) + a.hand;
    // underdamped, so the windup shape lands with overshoot and reads in the first few frames
    const soft = a.pose === 'pivot' ? [12, 7] : o.wind < 0.35 ? [520, 26] : [420, 20];
    fighter.setPose(poseKey, soft[0], soft[1]);
    if (a.kind === 'throw') fighter.showProp(null);
    fighter.setExpr('windup');
    fighter.energy = 0.3;
    const color = TELL_COLORS[a.kind] || '#ffffff';
    fighter.tell(a.hand, 0.2, color);
    audio.tell(a.kind === 'special' ? 'special' : a.kind);
    fx.burst(fighter.gloveWorld(a.hand, new THREE.Vector3()), 0.14, color, 0.1);
    if (this.perk === 'deck') ui.popup('SLIDE: ' + a.avoid.map((d) => ({ left: '⬅', right: '➡', duck: '⬇' })[d]).join(' '));
    if (this.tut && this.tut.first > 0) this.tut.first--;
    if (this.tut && !this.tut[a.kind] && this.tut[a.kind] !== undefined) {
      this.tut[a.kind] = 1;
      const touch = this.ctx.isTouch();
      const txt = {
        jab: touch ? 'JAB! SWIPE ANY WAY TO DODGE' : 'JAB! DODGE ANY WAY (A / D / S)',
        hook: a.hand === 'L' ? (touch ? 'HOOK FROM THE LEFT → SWIPE RIGHT OR DOWN' : 'HOOK FROM THE LEFT → DODGE RIGHT (D) OR DUCK (S)')
          : (touch ? 'HOOK FROM THE RIGHT → SWIPE LEFT OR DOWN' : 'HOOK FROM THE RIGHT → DODGE LEFT (A) OR DUCK (S)'),
        upper: 'UPPERCUT! DON\'T DUCK — DODGE AWAY FROM THE GLOWING GLOVE',
        throw: 'INCOMING! DODGE THE COFFEE',
      }[a.kind];
      if (txt) { ui.hint(txt); this.after(2.2, () => ui.hint(null)); }
    }
  }

  cancelAttack() {
    const o = this.o;
    const { fighter } = this.ctx;
    if (o.atk) { fighter.tell(o.atk.hand, 0); }
    fighter.windup(null);
    o.atk = null;
    if (o.flurry) { o.queue.length = 0; this.endFlurry(false); }
    fighter.energy = 1;
  }

  beginTaunt() {
    const { fighter, audio, fx } = this.ctx;
    const o = this.o;
    o.lastMoves.unshift('taunt'); o.lastMoves.length = 3;
    const nap = this.d.taunt === 'nap';
    o.state = 'taunt'; o.st = 0;
    o.tauntDur = nap ? 3.6 : 1.9;
    fighter.setPose(this.tauntPose(), 110, 12);
    fighter.setExpr(nap ? 'sleep' : 'taunt');
    this.tauntProp(true);
    this.open(nap ? 'nap' : 'taunt', o.tauntDur);
    o.state = 'taunt';
    this.say('taunt', 1, 1.6);
    this.ctx.feed.event('taunt', 0.5);
    if (this.d.taunt === 'cash') { fx.cashRain(fighter.gloveWorld('R', new THREE.Vector3()), 18); audio.cash(); }
    if (this.d.taunt === 'invoice') audio.cash();
    if (this.d.taunt === 'sip') audio.splash();
    if (nap) { this.snoreT = 0.3; }
    if (this.tut && !this.tut.taunt) {
      this.tut.taunt = 1;
      this.ctx.ui.hint('HE\'S DISTRACTED — PUNISH HIM!');
      this.after(1.6, () => this.ctx.ui.hint(null));
    }
  }

  wakeUp() {
    const { fighter, ui } = this.ctx;
    const o = this.o;
    fighter.setExpr('angry', 1);
    this.tauntProp(false);
    o.openT = 0.35; o.openKind = 'stun'; o.state = 'stun';
    ui.say('WHO DARES.', 1.2);
    this.after(0.45, () => { if (o.state !== 'down' && this.phase === 'fight') this.beginFlurry(this.o.phase >= 1 ? 'backInMyDay' : 'doubleJab'); });
  }

  updateOpp(dt) {
    const o = this.o;
    const { fighter, fx, audio } = this.ctx;
    o.st += dt;
    if (this.phase !== 'fight') return;
    if (o.openT > 0) {
      o.openT -= dt;
      if (o.openT <= 0) {
        const wasTaunt = o.openKind === 'taunt' || o.openKind === 'nap';
        this.closeWindow();
        if (o.state === 'recover' || o.state === 'stun' || o.state === 'taunt') {
          o.state = 'idle'; o.idleT = rand(0.25, 0.6) * this.tempo;
          fighter.setPose('guard', 200, 18); fighter.setExpr(wasTaunt ? 'taunt' : 'angry', 0.6);
          fighter.energy = 1;
          this.tauntProp(false);
        }
      }
    }
    switch (o.state) {
      case 'idle': {
        o.idleT -= dt;
        if (fighter.exprHold <= 0 && fighter.expr !== 'idle') fighter.setExpr('idle');
        if (o.idleT <= 0) {
          this.chooseAction();
        } else if (Math.random() < dt * 0.6) {
          fighter.baseX.target = rand(-0.22, 0.22);
        }
        break;
      }
      case 'block':
        if (o.st > 0.32) { o.state = 'idle'; o.idleT = Math.min(o.idleT, rand(0.3, 0.8) * this.tempo); fighter.setPose('guard', 220, 20); }
        break;
      case 'windup': {
        const a = o.atk;
        const k = clamp(o.st / o.wind, 0, 1);
        fighter.tell(a.hand, 0.2 + k * 0.8);
        fighter.windup(a.hand, k);
        if (o.feint && k > 0.62) {
          // fake-out: drop the attack, maybe follow up fast
          o.feint = false;
          this.cancelAttack();
          fighter.setPose('guard', 240, 20);
          fighter.setExpr('taunt', 0.5);
          this.ctx.ui.popup('FEINT!');
          o.state = 'idle'; o.idleT = rand(0.15, 0.4);
          break;
        }
        if (o.st >= o.wind) {
          o.state = 'strike'; o.st = 0;
          o.strikeDur = a.kind === 'throw' ? a.strike * this.speed : a.strike;
          fighter.windup(null);
          // a white pop as it lets go; a thrown prop takes the danger with it, so the glove goes dark
          fighter.tell(a.hand, a.kind === 'throw' ? 0 : 1, '#ffffff');
          if (a.kind === 'throw') {
            const from = fighter.gloveWorld(a.hand, new THREE.Vector3());
            const to = this.ctx.player.rig.position.clone().add(new THREE.Vector3(0, -0.05, -0.25));
            this.proj = fx.projectile(o.prop, from, to, o.strikeDur);
            fighter.setPose('throw', 600, 30);
            audio.whiff();
          } else {
            const poseKey = a.pose || (a.kind === 'smash' ? 'smash' : a.kind + a.hand);
            fighter.strikePose(poseKey, a.kind);
            audio.whiff();
          }
        }
        break;
      }
      case 'strike':
        if (o.atk.kind !== 'throw') fighter.tell(o.atk.hand, Math.max(0, 1 - o.st / 0.08));
        if (o.st >= o.strikeDur) this.resolveAttack();
        break;
      case 'recover':
        break;
      case 'stun':
        break;
      case 'taunt': {
        if (this.d.taunt === 'nap' && o.openKind === 'nap') {
          this.snoreT -= dt;
          if (this.snoreT <= 0) { this.snoreT = 1.3; audio.snore(); fx.snore(this.headPos()); }
        }
        break;
      }
    }
  }

  resolveAttack() {
    const { fighter, audio, player, post, ui, time, fx, arena } = this.ctx;
    const o = this.o, p = this.p, a = o.atk;
    fighter.tell(a.hand, 0);
    fighter.energy = 1;
    if (o.atkId === 'pivot') { const tw = fighter.springs.s.twist; tw.value += Math.PI * 2; tw.target += Math.PI * 2; }

    const avoided = p.state === 'dodge' && a.avoid.includes(p.dodgeDir);
    if (avoided) {
      const perfect = this.time - p.dodgeStart < PERFECT_WIN * (this.d.tutorial ? 1.4 : 1);
      this.s.dodges++;
      if (!this.ctx.inputHeld(p.dodgeDir)) p.st = Math.max(p.st, DODGE_MIN);
      if (this.proj) { this.proj.miss(p.dodgeDir); this.proj = null; }
      if (perfect) {
        this.s.perfects++;
        this.gainMeter(18);
        this.score(500, 'PERFECT');
        time.slowmo(0.35, 0.32);
        audio.perfect();
        this.ctx.buzz(12);
        post.pulse('ca', 0.012);
        ui.callout(pick(CALLOUTS.perfect), { size: 'l', color: this.d.theme.b });
        this.hype = Math.min(1, this.hype + 0.12);
        arena.cheer(0.4);
        audio.ooh();
        this.ctx.feed.event('perfect', 0.7);
      } else {
        this.gainMeter(5);
      }
      if (o.flurry && o.queue.length) {
        fighter.setPose('guard', 300, 24);
        this.nextInFlurry(0.08);
        return;
      }
      const wasFlurry = !!o.flurry;
      this.endFlurry();
      fighter.setExpr(perfect ? 'dizzy' : 'shock', 0.5);
      if (perfect) {
        this.open('stun', 0.95 + (wasFlurry ? 0.35 : 0));
        fighter.setPose('dizzy', 160, 12);
        fx.dizzy(true);
        audio.stars();
      } else {
        this.open('counter', (a.recover + (wasFlurry ? 0.4 : 0)) * Math.max(0.8, this.speed));
        fighter.setPose('open', 160, 14);
      }
      return;
    }

    if (this.perk === 'file' && !this.fileUsed) {
      this.fileUsed = true;
      if (this.proj) { this.proj.remove(); this.proj = null; }
      audio.block(); player.rebound('L', 'block'); player.rebound('R', 'block');
      ui.popup('VOIDED BY HR');
      if (o.flurry && o.queue.length) { this.nextInFlurry(0.12); return; }
      this.endFlurry();
      o.state = 'block'; o.st = -0.1;
      fighter.setPose('guard', 200, 18);
      return;
    }

    // player takes the hit
    let dmg = a.dmg * (this.d.dmgScale || 1) * (this.mod.dmgTaken || 1);
    let note = null;
    if (a.kind === 'upper' && p.state === 'dodge' && p.dodgeDir === 'duck') { dmg *= 1.4; note = 'DUCKED INTO IT'; }
    if (p.state === 'punch' || p.state === 'haymaker') { dmg *= 1.25; note = note || 'COUNTERED'; }
    p.hp -= dmg;
    this.s.hitsTaken++;
    this.s.dmgTaken += dmg;
    p.combo = 0;
    p.state = 'hurt'; p.st = 0; p.hayDone = false; player.charge = 0;
    const strength = clamp(dmg / 25, 0.3, 1);
    player.hurt(strength, a.hand === 'L' ? 'L' : 'R');
    post.pulse('hurt', 0.5 + strength * 0.5);
    post.pulse('ca', 0.015 * strength);
    audio.playerHit(strength);
    this.ctx.buzz(Math.round(25 + strength * 35));
    time.hitstop(0.06 + strength * 0.05);
    this.hype = Math.min(1, this.hype + 0.05);
    if (note) ui.popup(note);
    if (this.proj) {
      this.proj.remove(); this.proj = null;
      ui.splat(o.prop);
      if (o.prop === 'paper') { audio.paper(); fx.paperBurst(player.rig.position.clone().add(new THREE.Vector3(0, 0, -0.5)), 10); }
      else if (o.prop === 'coffee') audio.splash();
      else if (o.prop === 'cash') fx.coinsOut(player.rig.position.clone().add(new THREE.Vector3(0, -0.2, -0.5)), 12);
    }
    if (this.d.bills) {
      this.s.billed += 900;
      audio.cash();
      ui.bill(this.s.billed);
    }
    fighter.setExpr('taunt', 0.6);
    if (Math.random() < 0.35) this.say('land', 1, 1.3);
    this.ctx.feed.event('playerHit', 0.45);
    if (p.hp <= 0) { p.hp = 0; this.endFlurry(); this.playerDown(); return; }
    if (o.flurry && o.queue.length) { this.nextInFlurry(0.12); return; }
    this.endFlurry();
    o.state = 'block'; o.st = -0.1;
    fighter.setPose('guard', 200, 18);
  }

  // ---------- knockdowns ----------
  oppDown(side) {
    const { fighter, audio, ui, arena, time, post, fx, player } = this.ctx;
    const o = this.o;
    this.cancelAttack();
    this.closeWindow();
    o.kd++;
    this.p.state = 'idle';
    player.center();
    const final = o.kd >= this.d.knockdowns;
    this.score(final ? 5000 : 2000);
    if (final) { this.ko(side); return; }
    o.state = 'down'; o.st = 0;
    this.phase = 'oppDown';
    fighter.setPose('down', 70, 9);
    fighter.setExpr('ko');
    time.hitstop(0.18);
    time.slowmo(0.3, 0.7);
    post.pulse('invert', 1); post.pulse('flash', 0.35);
    player.addTrauma(0.5);
    ui.callout('DOWN!', { size: 'xl', color: this.d.theme.a, dur: 1.2 });
    this.after(0.5, () => this.ctx.feed.event('oppDown'), true);
    audio.stinger('knockdown');
    arena.cheer(1); arena.flashes(30); audio.cheer(1);
    this.hype = 1;
    this.after(0.55, () => { audio.knockdown(); player.addTrauma(0.3); fx.teethOut(this.headPos(), 1); arena.ropeHit(0.4); });
    this.say('down', 1, 2);
    const getUpAt = Math.min(8, 3 + o.kd + Math.floor(Math.random() * 2));
    let n = 0;
    const tick = () => {
      n++;
      ui.count(n);
      audio.count(n);
      if (n === 2) fighter.setExpr('dizzy');
      if (n >= getUpAt) {
        this.after(0.5, () => this.oppGetUp());
        return;
      }
      this.after(0.75, tick);
    };
    this.after(1.4, tick);
  }

  oppGetUp() {
    const { fighter, ui, audio } = this.ctx;
    const o = this.o;
    ui.count(null);
    o.phase = o.kd;
    o.hp = o.max * Math.max(0.35, 0.62 - 0.12 * (o.kd - 1));
    o.state = 'getup'; o.st = 0;
    fighter.setPose('guard', 40, 9);
    fighter.setExpr('angry', 2);
    if (this.d.look.acc?.includes('suit')) {
      // phase two: the jacket comes off
      fighter.shirtMat.color.set('#f3f1ec');
      if (fighter.shirtFront) fighter.shirtFront.visible = false;
      this.ctx.fx.cashRain(this.headPos(), 25, 1.5);
      if (o.kd >= 2) fighter.tieParts?.forEach((m) => { m.visible = false; });
    }
    const up = this.d.lines.up;
    this.ctx.ui.say(up[Math.min(o.kd, up.length) - 1], 2.2);
    this.after(1.3, () => {
      this.phase = 'fight';
      o.state = 'idle'; o.idleT = 0.6;
      audio.bell(1);
      ui.callout('FIGHT!', { size: 'l', color: this.d.theme.a, dur: 0.6 });
    });
  }

  ko(side) {
    const { fighter, audio, ui, arena, time, post, fx, player } = this.ctx;
    const o = this.o;
    this.phase = 'ko';
    o.state = 'ko';
    fighter.setExpr('ko');
    // limp, arms out; the flight itself does the rotating
    fighter.setPose('hurtHead', 60, 6);
    fighter.energy = 0;
    fx.dizzy(false);
    const head = this.headPos();
    fx.teethOut(head, 5); this.s.teeth += 5;
    fx.impact(head, 1, this.toCam(head));
    time.hitstop(0.22);
    time.slowmo(0.12, 1.8);
    post.pulse('invert', 1); post.pulse('flash', 0.6); post.pulse('ca', 0.03);
    player.addTrauma(1);
    player.drop();
    audio.ko();
    this.ctx.buzz([70, 50, 140]);
    audio.stinger('ko');
    this.ctx.clip?.keep();
    audio.stopMusic(1.5);
    this.hype = 1;
    const dir = side === 'L' ? 1 : -1;
    fighter.launch(new THREE.Vector3(dir * 0.6, 3.6, -3.8));
    player.lookOverride = new THREE.Vector3();
    this.trackKO = true;
    // after the hit-stop, cut to ringside for the flight (main.js frames it)
    this.after(0.22, () => { this.koCut = { dir }; }, true);
    arena.flashes(60);
    this.after(0.25, () => { ui.callout('K.O.!', { size: 'xxl', color: '#ffd23f', dur: 3 }); audio.say('Knockout!', { rate: 0.9, pitch: 0.6 }); }, true);
    this.after(0.8, () => { this.snapshot = this.ctx.capture(); }, true);
    this.after(0.7, () => { arena.cheer(1); audio.cheer(1); fx.confettiBurst(new THREE.Vector3(0, 4.5, -2.5), 220, [this.d.theme.a, this.d.theme.b, '#ffd23f', '#ffffff']); audio.bell(3); }, true);
    this.say('ko', 1, 2.5);
    // the chat loses its mind
    for (const t of [0.5, 1.1, 1.8, 2.6]) this.after(t, () => this.ctx.feed.event('ko'), true);
    this.after(4.2, () => this.finish(true), true);
  }

  playerDown() {
    const { fighter, audio, ui, player, time, post, arena } = this.ctx;
    const p = this.p, o = this.o;
    this.cancelAttack();
    this.closeWindow();
    p.kd++;
    p.state = 'down';
    this.phase = 'playerDown';
    o.state = 'victory'; o.st = 0;
    time.hitstop(0.2);
    time.slowmo(0.3, 0.8);
    post.pulse('flash', 0.4);
    post.fx.sat = 0.35;
    player.knockedDown();
    audio.knockdown();
    audio.ooh();
    arena.cheer(0.6);
    fighter.setPose('victory', 90, 10);
    fighter.setExpr('taunt');
    // the gloat becomes the quote on the share card if this is the end
    this.winLine = pick(this.d.lines.win);
    ui.say(this.winLine, 2.2);
    this.after(0.5, () => { this.snapshot = this.ctx.capture(); }, true);
    this.after(0.6, () => this.ctx.feed.event('playerDown'), true);
    this.ctx.clip?.mark('down');
    this.ctx.buzz([120, 60, 60]);
    if (p.kd >= 3 && this.perk === 'parachute' && this.run && !this.run.parachuteUsed) {
      // the golden parachute turns one T.K.O. into an ordinary knockdown
      this.run.parachuteUsed = true;
      p.kd = 2;
      ui.popup('GOLDEN PARACHUTE DEPLOYED');
    }
    if (p.kd >= 3) {
      // no mash-to-rise on a T.K.O.; leaving playerDown stops the count and the taps
      this.phase = 'lost';
      this.ctx.clip?.keep();
      ui.callout('T.K.O.', { size: 'xxl', color: '#ff2e55', dur: 2 });
      this.after(2.2, () => this.finish(false), true);
      return;
    }
    p.taps = 0;
    p.need = 9 + p.kd * 5;
    p.count = 0;
    this.downT = 0.6;
    ui.mash(0, this.ctx.isTouch() ? 'TAP TAP TAP TO GET UP!' : 'MASH J / K TO GET UP!');
  }

  updateDown(dt) {
    const p = this.p;
    const { ui, audio, player, post, fighter } = this.ctx;
    this.downT -= dt;
    ui.mash(Math.min(1, p.taps / p.need));
    if (p.taps >= p.need) {
      ui.mash(null); ui.count(null);
      post.fx.sat = 1;
      p.hp = Math.max(25, 60 - 15 * (p.kd - 1));
      p.state = 'idle';
      player.center();
      this.phase = 'fight';
      this.o.state = 'idle'; this.o.idleT = 1.2;
      fighter.setPose('guard', 160, 16);
      fighter.setExpr('shock', 0.8);
      audio.cheer(0.8);
      ui.callout('BACK UP!', { size: 'l', color: '#3dff7a', dur: 0.8 });
      this.ctx.clip?.drop();
      return;
    }
    if (this.downT <= 0) {
      p.count++;
      this.downT = 0.95;
      ui.count(p.count);
      audio.count(p.count);
      if (p.count >= 10) {
        ui.mash(null);
        this.phase = 'lost';
        this.ctx.clip?.keep();
        ui.callout('K.O.', { size: 'xxl', color: '#ff2e55', dur: 2 });
        this.after(1.8, () => this.finish(false), true);
      }
    }
  }

  finish(win) {
    if (this.done) return;
    this.done = true;
    this.phase = 'done';
    this.ctx.ui.count(null);
    this.ctx.ui.mash(null);
    this.ctx.post.fx.sat = 1;
    this.ctx.post.fx.lowHp = 0;
    this.ctx.onEnd({ win, stats: this.s, time: this.time, pkd: this.p.kd, hp: this.p.hp, snapshot: this.snapshot, quote: win ? null : this.winLine });
  }
}
