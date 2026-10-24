// A stand-in for Supabase Auth, for local testing only: just enough for supabase-js password sign-in
// and for the Worker's token check. Any email signs in with password "password"; the token is the email.
//   npm run auth-stub   (listens on :8799; run wrangler dev with SUPABASE_URL=http://localhost:8799)
// An email starting "unconfirmed" comes back with no confirmation date.
import { createServer } from 'node:http';

const userFor = (email) => ({
  id: 'u-' + Buffer.from(email).toString('hex').slice(0, 24), aud: 'authenticated', role: 'authenticated', email,
  email_confirmed_at: email.startsWith('unconfirmed') ? null : '2026-10-24T00:00:00Z',
  user_metadata: { full_name: '' }, app_metadata: { provider: 'email' }, created_at: '2026-10-24T00:00:00Z',
});
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info, x-supabase-api-version',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
};
const send = (res, status, body) => { res.writeHead(status, { 'Content-Type': 'application/json', ...cors }); res.end(JSON.stringify(body)); };

createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204, {});
  const url = new URL(req.url, 'http://x');
  let body = '';
  for await (const c of req) body += c;
  const b = body ? JSON.parse(body) : {};
  if (url.pathname === '/auth/v1/token') {
    const email = url.searchParams.get('grant_type') === 'refresh_token' ? b.refresh_token : b.email;
    if (url.searchParams.get('grant_type') === 'password' && b.password !== 'password') return send(res, 400, { error: 'invalid_grant', error_description: 'Invalid login credentials' });
    const now = Math.floor(Date.now() / 1000);
    return send(res, 200, { access_token: email, token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, refresh_token: email, user: userFor(email) });
  }
  if (url.pathname === '/auth/v1/user') {
    const token = (req.headers.authorization || '').replace(/^Bearer /, '');
    if (!token.includes('@')) return send(res, 401, { msg: 'invalid token' });
    return send(res, 200, userFor(token));
  }
  if (url.pathname === '/auth/v1/logout') return send(res, 204, {});
  // A fake OpenAI-compatible model server, to test "bring your own model" from the browser.
  if (url.pathname === '/v1/models') return send(res, 200, { data: [{ id: 'stub-small' }, { id: 'stub-large' }] });
  if (url.pathname === '/v1/chat/completions') {
    const sys = b.messages?.[0]?.role === 'system' ? b.messages[0].content : '';
    const last = b.messages?.at(-1)?.content || '';
    return send(res, 200, { choices: [{ message: { role: 'assistant', content: `[${b.model}] got ${b.messages.length} messages; system prompt has athlete data: ${sys.includes('ATHLETE DATA')}. You asked: ${last}` } }] });
  }
  send(res, 404, { msg: 'not in stub' });
}).listen(8799, () => console.log('auth stub on :8799'));
