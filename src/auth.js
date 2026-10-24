// Sign-in is Supabase's (Google, or email + password with a confirmation email). The browser sends its
// Supabase access token; the Worker asks Supabase who it belongs to and keeps the answer for a minute.
// Identity only ever comes from here, never from a user id in a request body.

export class AuthError extends Error {}

const TTL_MS = 60 * 1000;
const cache = new Map();

export async function authUser(request, env) {
  const h = request.headers.get('Authorization') || '';
  const token = h.startsWith('Bearer ') ? h.slice(7).trim() : '';
  if (!token) throw new AuthError('Sign in first.');
  if (!env.SUPABASE_URL || !env.SUPABASE_KEY) throw new AuthError('Sign-in is not set up on this server yet.');
  const hit = cache.get(token);
  if (hit && hit.exp > Date.now()) return hit.user;
  const res = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, { headers: { Authorization: `Bearer ${token}`, apikey: env.SUPABASE_KEY } });
  if (!res.ok) throw new AuthError('Your session has ended. Sign in again.');
  const u = await res.json();
  if (!u?.id) throw new AuthError('Sign in first.');
  // Email sign-ups must confirm their address; Google accounts arrive confirmed.
  if (!u.email_confirmed_at && !u.confirmed_at) throw new AuthError('Confirm your email address first (check your inbox).');
  const user = { id: u.id, email: u.email || '', name: u.user_metadata?.full_name || u.user_metadata?.name || '' };
  if (cache.size > 5000) cache.clear();
  cache.set(token, { user, exp: Date.now() + TTL_MS });
  return user;
}
