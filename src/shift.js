import { ROSTER } from './config.js';
import { fmtTime } from './ui.js';

// Daily Shift: all six floors back to back on one clock, with a modifier everyone shares that day.

// One per day, in this order, so everyone gets the same one on the same date.
export const MODIFIERS = [
  { id: 'casual', name: 'CASUAL FRIDAY', desc: 'Everyone dressed down. Everyone is 15% faster.', speed: 0.85 },
  { id: 'budget', name: 'BUDGET CUTS', desc: 'OVERTIME has been cancelled. No haymakers today.', noMeter: true },
  { id: 'synergy', name: 'SYNERGY SUMMIT', desc: 'Combos hit 50% harder. Management brought 25% more HP.', combo: 1.5, oppHp: 1.25 },
  { id: 'rto', name: 'RETURN TO OFFICE', desc: 'The commute has weakened you. Every hit hurts 25% more.', dmgTaken: 1.25 },
  { id: 'openplan', name: 'OPEN PLAN OFFICE', desc: 'No walls, no privacy. Things get thrown three times as often.', throws: 3 },
  { id: 'layoffs', name: 'LAYOFFS WEEK', desc: 'The lights go out every 14 seconds. Budget reasons.', blackouts: true },
];

// One perk per floor, unlocked by an A or S on that floor in the ladder.
export const PERKS = [
  { id: 'lanyard', floor: 0, name: 'KYLE\'S LANYARD', desc: '+1 sick day. It still says KYLE.' },
  { id: 'file', floor: 1, name: 'BRENDA\'S FILE', desc: 'The first hit you take on each floor is voided by HR.' },
  { id: 'podcast', floor: 2, name: 'CHAD\'S PODCAST', desc: 'OVERTIME fills 50% faster. Hype is a resource.' },
  { id: 'deck', floor: 3, name: 'DEREK\'S DECK', desc: 'Every attack comes with a slide telling you where to dodge.' },
  { id: 'seat', floor: 4, name: 'MARGARET\'S SEAT', desc: 'Start every floor at full HP. It is always warm.' },
  { id: 'parachute', floor: 5, name: 'GOLDEN PARACHUTE', desc: 'Survive one T.K.O. per shift. Executives always land softly.' },
];

const EPOCH = Date.UTC(2026, 8, 1);
// days since launch, counted on the player's own calendar date
export function shiftNumber(now = new Date()) {
  return Math.floor((Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) - EPOCH) / 864e5) + 1;
}
export const modifierFor = (n) => MODIFIERS[((n % MODIFIERS.length) + MODIFIERS.length) % MODIFIERS.length];

export const perkUnlocked = (perk, save) => 'SA'.includes(save.best[ROSTER[perk.floor].id]?.grade || '-');

export function newRun(n, perkId) {
  return {
    n, mod: modifierFor(n), perk: perkId || null,
    floor: 0, sick: 3 + (perkId === 'lanyard' ? 1 : 0), fails: 0,
    hp: 100, time: 0, marks: [], parachuteUsed: false, done: false,
  };
}

// what a finished fight does to the run; returns 'next' | 'retry' | 'over'
export function recordFight(run, r) {
  run.time += r.time;
  if (r.win) {
    run.marks[run.floor] = run.fails ? '🟨' : '🟩';
    run.hp = run.perk === 'seat' ? 100 : Math.min(100, Math.max(0, r.hp) + 40);
    run.floor++; run.fails = 0;
    if (run.floor >= ROSTER.length) { run.done = true; return 'over'; }
    return 'next';
  }
  if (run.sick > 0) { run.sick--; run.fails++; return 'retry'; }
  run.marks[run.floor] = '💀';
  run.done = true;
  return 'over';
}

export const squares = (run) => ROSTER.map((_, i) => run.marks[i] || '⬛').join('');
export const perkOf = (run) => PERKS.find((p) => p.id === run.perk) || null;
export const cleared = (run) => run.floor >= ROSTER.length;

export function shareLine(run) {
  const where = cleared(run) ? `CEO in ${fmtTime(run.time)}` : `FIRED on FLOOR ${ROSTER[run.floor].floor} · ${fmtTime(run.time)}`;
  const perk = perkOf(run);
  return `PUNCH CLOCK SHIFT #${run.n} · ${where}\n${squares(run)} · ${run.mod.name} · ${perk ? '🧷 ' + perk.name : '✅ NO PERKS'}`;
}
