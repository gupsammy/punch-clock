// Versus transport (VERSUS.md "Network"). One ordered, reliable message stream to one peer.
// net=local swaps WebRTC for a BroadcastChannel between tabs; lag=MS delays every send by MS/2, so
// with both tabs set the round trip grows by MS.

const APP_ID = 'punch-clock-vs-1';
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export const newCode = () => Array.from({ length: 6 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
// what a friend typed, uppercased and cut down to code characters
export const cleanCode = (t) => t.toUpperCase().replace(/[^A-Z0-9]/g, '').split('').filter((c) => CODE_CHARS.includes(c)).join('').slice(0, 6);

// TURN relay credentials from the Vercel function (api/turn.mjs). When two phones cannot link directly
// (router without hairpin NAT, carrier NAT, client isolation) the traffic goes through Cloudflare instead.
// Missing on the local dev server: then only direct links work.
async function turnServers() {
  try {
    const r = await fetch('/api/turn', { signal: AbortSignal.timeout(4000) });
    return r.ok ? (await r.json()).iceServers : undefined;
  } catch { return undefined; }
}

// handlers: { msg(m), join(), leave(), error(text) }
export async function connect({ code, local = false, lag = 0 }, handlers) {
  let peer = null;
  let closed = false;
  let rawSend;
  let close;
  const net = { rtt: 0, owd: 0, get peer() { return peer; } };

  const receive = (m) => {
    if (closed || !m || typeof m !== 'object') return;
    if (m.k === '_ping') { send({ k: '_pong', t: m.t }); return; }
    if (m.k === '_pong') {
      const rtt = performance.now() - m.t;
      net.rtt = net.rtt ? net.rtt * 0.7 + rtt * 0.3 : rtt;
      net.owd = net.rtt / 2;
      return;
    }
    handlers.msg(m);
  };
  const send = (m) => {
    if (closed || !peer) return;
    if (lag) setTimeout(() => rawSend(m), lag / 2); else rawSend(m);
  };
  const joined = (id) => {
    if (peer || closed) return false;
    peer = id;
    handlers.join();
    return true;
  };
  const left = (id) => {
    if (id !== peer || closed) return;
    peer = null;
    handlers.leave();
  };

  if (local) {
    const self = Math.random().toString(36).slice(2);
    const ch = new BroadcastChannel('pc-vs-' + code);
    rawSend = (m) => ch.postMessage({ from: self, to: peer, m });
    ch.onmessage = (e) => {
      const { from, to, hello, bye, m } = e.data;
      if (from === self || (to && to !== self)) return;
      // answer first: the join handler may send at once, and the peer must know us before that arrives
      if (hello) { if (!peer && !closed) { ch.postMessage({ from: self, hello: true }); joined(from); } return; }
      if (bye) { left(from); return; }
      if (from === peer) receive(m);
    };
    ch.postMessage({ from: self, hello: true });
    const bye = () => ch.postMessage({ from: self, bye: true });
    window.addEventListener('pagehide', bye);
    close = () => { bye(); window.removeEventListener('pagehide', bye); ch.close(); };
  } else {
    const [{ joinRoom }, turnConfig] = await Promise.all([import('../vendor/trystero/trystero-nostr.js'), turnServers()]);
    const room = joinRoom({ appId: APP_ID, turnConfig }, code, {
      onJoinError: (d) => handlers.error(d?.error ? String(d.error) : 'connection failed'),
    });
    const action = room.makeAction('m');
    rawSend = (m) => { if (peer) action.send(m, { target: peer }); };
    action.onMessage = (m, meta) => {
      const from = meta?.peerId ?? meta;
      if (from !== peer) return;
      receive(m);
    };
    room.onPeerJoin = (id) => joined(id);
    room.onPeerLeave = (id) => left(id);
    close = () => room.leave();
  }

  const pinger = setInterval(() => send({ k: '_ping', t: performance.now() }), 2000);
  net.send = send;
  net.pingNow = () => send({ k: '_ping', t: performance.now() });
  net.close = () => {
    if (closed) return;
    closed = true;
    clearInterval(pinger);
    close();
  };
  return net;
}
