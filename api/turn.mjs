// Short-lived Cloudflare TURN credentials for versus (src/net.js). The key stays on the server.
// Env: CF_TURN_KEY_ID, CF_TURN_API_TOKEN (Cloudflare dashboard → Realtime → TURN Server).
export async function GET() {
  const { CF_TURN_KEY_ID: id, CF_TURN_API_TOKEN: token } = process.env;
  if (!id || !token) return new Response('TURN not configured', { status: 503 });
  const r = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${id}/credentials/generate-ice-servers`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ttl: 6 * 3600 }),
  });
  if (!r.ok) return new Response('TURN credentials failed', { status: 502 });
  const { iceServers } = await r.json();
  // browsers block port 53, and a URL that can only time out slows the connection
  for (const s of iceServers) s.urls = [].concat(s.urls).filter((u) => !/:53\b/.test(u));
  return Response.json({ iceServers }, { headers: { 'Cache-Control': 'no-store' } });
}
