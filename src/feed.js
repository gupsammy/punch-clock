import { pick } from './spring.js';
import { FEED, ROSTER } from './config.js';

// The company chat reacting to your fight. It gets busier every floor, and the
// people you've already beaten join in from their hospital beds.

const COWORKERS = [
  ['gary', 'IT', '#5b8cff'], ['priya', 'Finance', '#3dff7a'], ['dave', 'Legal', '#ffd23f'], ['sandra', 'Payroll', '#ff9f1a'],
  ['deb', 'Reception', '#ff5fa2'], ['tom', 'Sales', '#22e5ff'], ['intern #2', 'Mailroom', '#b56cff'], ['facilities-bot', 'BOT', '#9aa3b5'],
];
const MAX = 4, LIFE = 7.5;

export function createFeed() {
  const root = document.getElementById('feed');
  const list = root.querySelector('.msgs');
  let d = null, idx = 0, idleT = 0, gap = 0;
  const recent = [];

  function post(who, text, { ghost = false, sys = false } = {}) {
    if (!d || recent.some((r) => r.text === text)) return;
    // on the CEO's floor Legal gets to some messages first
    if (d.feed.censor && !sys && !ghost && Math.random() < d.feed.censor) text = null;
    const el = document.createElement('div');
    el.className = 'msg' + (ghost ? ' ghost' : '') + (sys ? ' sys' : '') + (text ? '' : ' gone');
    const [name, role, color] = who;
    el.innerHTML = `<i style="background:${color}">${name[0].toUpperCase()}</i><div><b></b><em></em><p></p></div>`;
    el.querySelector('b').textContent = name;
    el.querySelector('em').textContent = role;
    el.querySelector('p').textContent = text || 'This message was removed by Legal.';
    list.appendChild(el);
    recent.push({ el, t: LIFE, text });
    while (recent.length > MAX) recent.shift().el.remove();
    gap = 1.1;
  }

  const fill = (s) => s.replace(/\{opp\}/g, d.name.split(' ')[0].toLowerCase());
  const someone = () => pick(COWORKERS);
  // someone you already beat, with the title you took from them
  function ghost() {
    const beaten = ROSTER.slice(0, idx);
    if (!beaten.length) return false;
    const g = pick(beaten);
    post([g.name.split(' ')[0].toLowerCase(), `former ${g.title.toLowerCase()}`, g.look.gloves], pick(FEED.ghosts[g.id]), { ghost: true });
    return true;
  }

  return {
    start(data, index) {
      d = data; idx = index;
      list.innerHTML = ''; recent.length = 0;
      root.querySelector('.chan').textContent = d.feed.channel;
      root.querySelector('.online').textContent = d.feed.online;
      root.classList.remove('hidden');
      idleT = 2.5; gap = 0;
      if (d.feed.pinned) post(['CEO\'s office', 'ADMIN', '#ffc233'], d.feed.pinned, { sys: true });
    },
    stop() { root.classList.add('hidden'); d = null; },
    // an announcement from the system itself, never censored
    sys(text) { post(['#all-company', 'SYSTEM', '#ff2244'], text, { sys: true }); },
    // kind: start | oppHit | playerHit | perfect | oppDown | playerDown | taunt | haymaker | ko | lost
    event(kind, chance = 1) {
      if (!d || Math.random() > chance) return;
      if (gap > 0 && kind !== 'ko' && kind !== 'oppDown' && kind !== 'playerDown') return;
      if (kind !== 'start' && kind !== 'ko' && Math.random() < 0.3 && ghost()) return;
      const pool = (kind === 'ko' && d.feed.ko) || FEED[kind];
      if (pool) post(someone(), fill(pick(pool)));
    },
    update(dt) {
      if (!d) return;
      gap -= dt;
      for (let i = recent.length - 1; i >= 0; i--) {
        const r = recent[i];
        r.t -= dt;
        if (r.t < 0.4) r.el.classList.add('out');
        if (r.t < 0) { r.el.remove(); recent.splice(i, 1); }
      }
      idleT -= dt;
      if (idleT < 0) {
        idleT = d.feed.every * (0.7 + Math.random() * 0.6);
        if (gap > 0) return;
        if (Math.random() < 0.3 && ghost()) return;
        post(someone(), fill(pick(Math.random() < 0.6 ? d.feed.chatter : FEED.idle)));
      }
    },
  };
}
