import { createPublicSupabase, createUserSupabase } from './supabase.mjs';

const ACCESS_COOKIE = 'lorobuy_access';
const REFRESH_COOKIE = 'lorobuy_refresh';

function parseCookies(header = '') {
  return header.split(';').reduce((cookies, pair) => {
    const separator = pair.indexOf('=');
    if (separator < 1) return cookies;
    const name = pair.slice(0, separator).trim();
    const value = pair.slice(separator + 1).trim();
    try {
      cookies[name] = decodeURIComponent(value);
    } catch {
      cookies[name] = value;
    }
    return cookies;
  }, {});
}

function serializeCookie(name, value, options = {}) {
  const segments = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
  if (options.secure) segments.push('Secure');
  if (Number.isFinite(options.maxAge)) segments.push(`Max-Age=${Math.max(0, Math.floor(options.maxAge))}`);
  return segments.join('; ');
}

export function setSessionCookies(response, config, session) {
  response.append('Set-Cookie', serializeCookie(ACCESS_COOKIE, session.access_token, {
    secure: config.secureCookies,
    maxAge: session.expires_in ?? 3600,
  }));
  response.append('Set-Cookie', serializeCookie(REFRESH_COOKIE, session.refresh_token, {
    secure: config.secureCookies,
    maxAge: 60 * 60 * 24 * 30,
  }));
  response.set('Cache-Control', 'private, no-store, max-age=0');
}

export function clearSessionCookies(response, config) {
  response.append('Set-Cookie', serializeCookie(ACCESS_COOKIE, '', { secure: config.secureCookies, maxAge: 0 }));
  response.append('Set-Cookie', serializeCookie(REFRESH_COOKIE, '', { secure: config.secureCookies, maxAge: 0 }));
  response.set('Cache-Control', 'private, no-store, max-age=0');
}

async function sessionFromAccessToken(config, accessToken) {
  if (!accessToken) return null;
  const client = createUserSupabase(config, accessToken);
  const { data, error } = await client.auth.getUser(accessToken);
  if (error || !data.user) return null;
  return { user: data.user, accessToken, client, session: null };
}

export async function getSessionProfile(session) {
  if (!session || session.user.is_anonymous) return null;

  const { data, error } = await session.client
    .from('profiles')
    .select('id,display_name,avatar_url,role')
    .eq('id', session.user.id)
    .maybeSingle();

  if (error) throw new Error('Unable to read the authenticated profile from Supabase.');
  return data ?? null;
}

export async function getRequestSession(request, response, config, { createAnonymous = false } = {}) {
  const cookies = parseCookies(request.get('cookie'));
  const existing = await sessionFromAccessToken(config, cookies[ACCESS_COOKIE]);
  if (existing) return existing;

  const publicClient = createPublicSupabase(config);
  if (cookies[REFRESH_COOKIE]) {
    const { data, error } = await publicClient.auth.refreshSession({
      refresh_token: cookies[REFRESH_COOKIE],
    });
    if (!error && data.session && data.user) {
      setSessionCookies(response, config, data.session);
      return {
        user: data.user,
        accessToken: data.session.access_token,
        client: createUserSupabase(config, data.session.access_token),
        session: data.session,
      };
    }
  }

  if (!createAnonymous) return null;

  const { data, error } = await publicClient.auth.signInAnonymously();
  if (error || !data.session || !data.user) {
    const reason = error?.code === 'anonymous_provider_disabled'
      ? 'Anonymous sign-ins are disabled in Supabase.'
      : 'Supabase could not create an anonymous session.';
    throw new Error(reason);
  }

  setSessionCookies(response, config, data.session);
  return {
    user: data.user,
    accessToken: data.session.access_token,
    client: createUserSupabase(config, data.session.access_token),
    session: data.session,
  };
}

export async function revokeRequestSession(request, config) {
  const cookies = parseCookies(request.get('cookie'));
  const accessToken = cookies[ACCESS_COOKIE];
  const refreshToken = cookies[REFRESH_COOKIE];
  if (!accessToken || !refreshToken) return;

  const client = createPublicSupabase(config);
  const { error: sessionError } = await client.auth.setSession({
    access_token: accessToken,
    refresh_token: refreshToken,
  });
  if (!sessionError) await client.auth.signOut({ scope: 'global' });
}

export async function requireAdmin(request, response, config) {
  const session = await getRequestSession(request, response, config);
  if (!session || session.user.is_anonymous || !session.user.email_confirmed_at) return null;
  const profile = await getSessionProfile(session);
  if (profile?.role !== 'admin') return null;
  return { ...session, profile };
}

export const cookieNames = Object.freeze({ access: ACCESS_COOKIE, refresh: REFRESH_COOKIE });
