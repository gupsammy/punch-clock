import { pick } from './spring.js';
import { FEED, ROSTER } from './config.js';

// The company livestream chat reacting to your fight. It gets busier every floor, the
// people you've already beaten join in from their hospital beds, and big moments set off
// a wall of spam and floating reactions like any stream chat.

const COWORKERS = [
  ['gary', 'IT', '#5b8cff'], ['priya', 'FIN', '#3dff7a'], ['dave', 'LEGAL', '#ffd23f'], ['sandra', 'PAY', '#ff9f1a'],
  ['deb', 'FRONT', '#ff5fa2'], ['tom', 'SALES', '#22e5ff'], ['intern #2', 'MAIL', '#b56cff'], ['facilities-bot', 'BOT', '#9aa3b5'],
];
// lurkers who only ever show up to spam
const LURKERS = ['kevin.accounts', 'linda_ops', 'marco (contractor)', 'ceo_alt_acct', 'qa_steve', 'janet.pmo', 'night_security', 'hr_bot_2',
  'raj_devops', 'ashley.brand', 'temp_0419', 'the_auditor', 'pam.payroll', 'lunch_thief', 'mike_warehouse', 'cfo_intern'];
const LURK_COLORS = ['#ff6b6b', '#ffd23f', '#3dff7a', '#22e5ff', '#b56cff', '#ff9f1a', '#ff5fa2', '#7cf5ff'];
// spam kind and floating reactions for each fight event
const SPAM = { oppHit: 'hit', perfect: 'hit', haymaker: 'hit', taunt: 'hit', playerHit: 'hurt', playerDown: 'hurt', oppDown: 'ko', ko: 'ko' };
const BURST = { oppHit: 2, perfect: 3, haymaker: 4, playerDown: 4, oppDown: 6, ko: 9 };
const REACT = { hit: ['🔥', '💥', '😱', '🥊'], hurt: ['💀', '😬', '🚑', '🩹'], ko: ['👑', '🥊', '🎉', '💀', '🔥', '📉'] };
const MAX = 9, LIFE = 11;

export function createFeed() {
  const root = document.getElementById('feed');
  const list = root.querySelector('.msgs');
  const eye = root.querySelector('.online');
  const floats = root.querySelector('.floats');
  let d = null, idx = 0, idleT = 0, gap = 0, viewers = 0, shown = 0, suffix = '';
  const recent = [], queue = [];

  function post(who, text, { ghost = false, sys = false, spam = false } = {}) {
    if (!d || (!spam && recent.some((r) => r.text === text))) return;
    // on the CEO's floor Legal gets to some messages first
    if (d.feed.censor && !sys && !ghost && Math.random() < d.feed.censor) text = null;
    const [name, badge, color] = who;
    const el = document.createElement('div');
    el.className = 'msg' + (ghost ? ' ghost' : '') + (sys ? ' sys' : '') + (text ? '' : ' gone');
    el.innerHTML = `<i></i><b style="color:${color}"></b><p></p>`;
    el.querySelector('i').textContent = badge;
    el.querySelector('b').textContent = name;
    el.querySelector('p').textContent = text || '<message deleted by Legal>';
    list.appendChild(el);
    recent.push({ el, t: LIFE, text });
    while (recent.length > MAX) recent.shift().el.remove();
    if (!spam) gap = 0.55;
  }

  function react(kind, n) {
    for (let i = 0; i < n; i++) {
      const e = document.createElement('span');
      e.textContent = pick(REACT[kind]);
      e.style.setProperty('--x', `${Math.random() * 70}%`);
      e.style.setProperty('--dx', `${(Math.random() - 0.5) * 60}px`);
      e.style.animationDelay = `${i * 0.09}s`;
      floats.appendChild(e);
      setTimeout(() => e.remove(), 2200 + i * 90);
    }
  }

  const fill = (s) => s.replace(/\{opp\}/g, d.name.split(' ')[0].toLowerCase());
  const someone = () => pick(COWORKERS);
  const lurker = () => [pick(LURKERS), '', pick(LURK_COLORS)];
  // someone you already beat, posting from the hospital
  function ghost() {
    const beaten = ROSTER.slice(0, idx);
    if (!beaten.length) return false;
    const g = pick(beaten);
    post([g.name.split(' ')[0].toLowerCase(), 'ICU', g.look.gloves], pick(FEED.ghosts[g.id]), { ghost: true });
    return true;
  }
  const fmt = (n) => Math.round(n).toLocaleString('en-US');

  return {
    start(data, index) {
      d = data; idx = index;
      list.innerHTML = ''; floats.innerHTML = ''; recent.length = 0; queue.length = 0;
      root.querySelector('.chan').textContent = d.feed.channel;
      // "48,002 online · 📈 shareholders watching" → a live count plus the joke after it
      const m = d.feed.online.match(/^([\d,]+) online(.*)$/);
      viewers = shown = m ? +m[1].replace(/,/g, '') : 0;
      suffix = m ? m[2].replace(/^\s*·\s*/, '') : '';
      root.querySelector('.extra').textContent = suffix;
      eye.textContent = fmt(shown);
      root.classList.remove('hidden');
      idleT = 2.5; gap = 0;
      if (d.feed.pinned) post(['CEO\'s office', 'ADMIN', '#ffc233'], d.feed.pinned, { sys: true });
    },
    stop() { root.classList.add('hidden'); d = null; },
    // an announcement from the system itself, never censored
    sys(text) { post(['#all-company', 'MOD', '#ff2244'], text, { sys: true }); },
    // kind: start | oppHit | playerHit | perfect | oppDown | playerDown | taunt | haymaker | ko | lost
    event(kind, chance = 1) {
      if (!d) return;
      const s = SPAM[kind];
      if (s) {
        // big moments pull in lurkers: the count jumps and chat floods regardless of the dice
        viewers *= 1 + (BURST[kind] || 1) * 0.004 * (0.5 + Math.random());
        const n = Math.round((BURST[kind] || 1) * (0.6 + Math.random() * 0.6) * Math.min(1.6, 0.6 + d.feed.every ** -1 * 3));
        for (let i = 0; i < n; i++) queue.push([0.15 + i * (0.11 + Math.random() * 0.12), lurker(), fill(pick(FEED.spam[s]))]);
        react(s, Math.min(8, n + 1));
      }
      if (Math.random() > chance) return;
      if (gap > 0 && kind !== 'ko' && kind !== 'oppDown' && kind !== 'playerDown') return;
      if (kind !== 'start' && kind !== 'ko' && Math.random() < 0.3 && ghost()) return;
      const pool = (kind === 'ko' && d.feed.ko) || FEED[kind];
      if (pool) post(someone(), fill(pick(pool)));
    },
    update(dt) {
      if (!d) return;
      gap -= dt;
      for (let i = queue.length - 1; i >= 0; i--) {
        if ((queue[i][0] -= dt) > 0) continue;
        const [, who, text] = queue[i];
        queue.splice(i, 1);
        post(who, text, { spam: true });
      }
      for (let i = recent.length - 1; i >= 0; i--) {
        const r = recent[i];
        r.t -= dt;
        if (r.t < 0.5) r.el.classList.add('out');
        if (r.t < 0) { r.el.remove(); recent.splice(i, 1); }
      }
      // the viewer count drifts up while people keep tuning in
      viewers += viewers * 0.0015 * dt * Math.random();
      if (Math.abs(viewers - shown) >= 1) { shown += (viewers - shown) * Math.min(1, dt * 3); eye.textContent = fmt(shown); }
      idleT -= dt;
      if (idleT < 0) {
        idleT = d.feed.every * 0.55 * (0.7 + Math.random() * 0.6);
        if (gap > 0) return;
        if (Math.random() < 0.25 && ghost()) return;
        post(someone(), fill(pick(Math.random() < 0.6 ? d.feed.chatter : FEED.idle)));
      }
    },
  };
}
