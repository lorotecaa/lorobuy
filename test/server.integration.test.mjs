import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

function waitForReady(child) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('LoroBuy server did not start')), 8_000);
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.stdout.on('data', (chunk) => {
      if (chunk.toString().includes('LoroBuy is ready')) {
        clearTimeout(timeout);
        resolve();
      }
    });
    child.once('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error(`LoroBuy server exited with ${code}: ${stderr}`));
    });
  });
}

test('Render server serves the unchanged storefront and reads catalog data from Supabase', { timeout: 15_000 }, async (context) => {
  const product = {
    id: '11111111-1111-4111-8111-111111111111',
    slug: 'mock-product',
    name: 'Mock Product',
    description: null,
    image_path: 'assets/genio.webp',
    price_cents: 2499,
    compare_at_price_cents: 3999,
    currency: 'USD',
    sort_order: 10,
    categories: { slug: 'quiereme', name: 'Animaciones Quiéreme', sort_order: 20, is_active: true },
  };
  const adminUser = {
    id: '22222222-2222-4222-8222-222222222222',
    aud: 'authenticated',
    role: 'authenticated',
    email: 'loroteca98@gmail.com',
    email_confirmed_at: '2026-10-02T12:00:00.000Z',
    is_anonymous: false,
    user_metadata: { full_name: 'Loro Admin' },
  };
  const customerUser = {
    ...adminUser,
    id: '33333333-3333-4333-8333-333333333333',
    email: 'cliente@example.com',
    user_metadata: { full_name: 'Cliente' },
  };
  let signupPayload;
  let signupRequestUrl;
  let resendPayload;
  let resendRequestUrl;
  let signinPayload;
  const readJsonBody = async (request) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    return JSON.parse(body);
  };

  const supabaseMock = http.createServer(async (request, response) => {
    assert.equal(request.headers.apikey, 'sb_publishable_mock');
    if (request.method === 'POST' && request.url?.startsWith('/auth/v1/signup')) {
      signupRequestUrl = request.url;
      signupPayload = await readJsonBody(request);
      response.setHeader('Content-Type', 'application/json');
      if (signupPayload.email === 'limited@example.com') {
        response.statusCode = 429;
        return response.end(JSON.stringify({
          code: 'over_email_send_rate_limit',
          msg: 'Email rate limit exceeded',
        }));
      }
      return response.end(JSON.stringify(customerUser));
    }
    if (request.method === 'POST' && request.url?.startsWith('/auth/v1/resend')) {
      resendRequestUrl = request.url;
      resendPayload = await readJsonBody(request);
      response.setHeader('Content-Type', 'application/json');
      return response.end(JSON.stringify({}));
    }
    if (request.method === 'POST' && request.url === '/auth/v1/token?grant_type=password') {
      signinPayload = await readJsonBody(request);
      response.setHeader('Content-Type', 'application/json');
      return response.end(JSON.stringify({
        access_token: 'signed-in-token',
        refresh_token: 'refresh-token',
        expires_in: 3600,
        token_type: 'bearer',
        user: customerUser,
      }));
    }
    if (request.method === 'POST' && request.url === '/auth/v1/token?grant_type=refresh_token') {
      const payload = await readJsonBody(request);
      if (payload.refresh_token !== 'confirmation-refresh-token') {
        response.statusCode = 401;
        response.setHeader('Content-Type', 'application/json');
        return response.end(JSON.stringify({ message: 'invalid refresh token' }));
      }
      response.setHeader('Content-Type', 'application/json');
      return response.end(JSON.stringify({
        access_token: 'confirmed-access-token',
        refresh_token: 'confirmed-refresh-token',
        expires_in: 3600,
        token_type: 'bearer',
        user: customerUser,
      }));
    }
    if (request.url === '/auth/v1/user') {
      response.setHeader('Content-Type', 'application/json');
      if (request.headers.authorization === 'Bearer admin-token') return response.end(JSON.stringify(adminUser));
      if (request.headers.authorization === 'Bearer customer-token') return response.end(JSON.stringify(customerUser));
      if (request.headers.authorization === 'Bearer confirmed-access-token') return response.end(JSON.stringify(customerUser));
      response.statusCode = 401;
      return response.end(JSON.stringify({ message: 'invalid token' }));
    }
    if (request.url?.startsWith('/rest/v1/profiles')) {
      response.setHeader('Content-Type', 'application/json');
      if (request.headers.authorization === 'Bearer admin-token') {
        return response.end(JSON.stringify({ id: adminUser.id, display_name: 'Loro Admin', avatar_url: null, role: 'admin' }));
      }
      if (request.headers.authorization === 'Bearer customer-token') {
        return response.end(JSON.stringify({ id: customerUser.id, display_name: 'Cliente', avatar_url: null, role: 'customer' }));
      }
      if (request.headers.authorization === 'Bearer confirmed-access-token') {
        return response.end(JSON.stringify({ id: customerUser.id, display_name: 'Cliente', avatar_url: null, role: 'customer' }));
      }
      response.statusCode = 401;
      return response.end(JSON.stringify({ message: 'invalid token' }));
    }
    if (request.url?.startsWith('/rest/v1/products')) {
      response.setHeader('Content-Range', '0-0/1');
      if (request.method === 'HEAD') return response.end();
      response.setHeader('Content-Type', 'application/json');
      return response.end(JSON.stringify([product]));
    }
    response.statusCode = 404;
    return response.end();
  });
  const supabasePort = await listen(supabaseMock);
  context.after(() => close(supabaseMock));

  const portProbe = http.createServer();
  const appPort = await listen(portProbe);
  await close(portProbe);
  const appOrigin = `http://127.0.0.1:${appPort}`;
  const child = spawn(process.execPath, ['src/server.mjs'], {
    cwd: root,
    env: {
      ...process.env,
      NODE_ENV: 'development',
      PORT: String(appPort),
      APP_ORIGIN: appOrigin,
      SUPABASE_URL: `http://127.0.0.1:${supabasePort}`,
      SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_mock',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  context.after(() => child.kill('SIGTERM'));
  await waitForReady(child);

  const pageResponse = await fetch(`${appOrigin}/`);
  assert.equal(pageResponse.status, 200);
  assert.match(await pageResponse.text(), /<title>Lorobuy<\/title>/);
  assert.match(pageResponse.headers.get('content-security-policy') ?? '', /connect-src 'self'/);
  assert.equal(pageResponse.headers.get('x-frame-options'), 'DENY');

  const healthResponse = await fetch(`${appOrigin}/api/health`);
  assert.equal(healthResponse.status, 200);
  assert.deepEqual(await healthResponse.json(), { status: 'ok', database: 'connected', activeProducts: 1 });

  const catalogResponse = await fetch(`${appOrigin}/api/products`);
  assert.equal(catalogResponse.status, 200);
  const catalog = await catalogResponse.json();
  assert.equal(catalog.products.length, 1);
  assert.equal(catalog.products[0].name, 'Mock Product');
  assert.equal(catalog.products[0].previewPath, 'assets/hero.mp4');

  const productApiResponse = await fetch(`${appOrigin}/api/products/mock-product`);
  assert.equal(productApiResponse.status, 200);
  const productApi = await productApiResponse.json();
  assert.equal(productApi.product.slug, 'mock-product');
  assert.equal(productApi.product.previewPath, 'assets/hero.mp4');

  const productPageResponse = await fetch(`${appOrigin}/products/mock-product`);
  assert.equal(productPageResponse.status, 200);
  assert.match(await productPageResponse.text(), /Detalle del producto LoroBuy/);
  assert.match(productPageResponse.headers.get('content-security-policy') ?? '', /connect-src 'self'/);

  const invalidProductPageResponse = await fetch(`${appOrigin}/products/INVALID!`);
  assert.equal(invalidProductPageResponse.status, 404);

  const shortPasswordResponse = await fetch(`${appOrigin}/api/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: appOrigin },
    body: JSON.stringify({ displayName: 'Cliente', email: 'cliente@example.com', password: 'abcde' }),
  });
  assert.equal(shortPasswordResponse.status, 400);
  assert.deepEqual(await shortPasswordResponse.json(), {
    error: 'Nombre, correo o contraseña no válidos. La contraseña debe tener al menos 6 caracteres.',
  });

  const signupResponse = await fetch(`${appOrigin}/api/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: appOrigin },
    body: JSON.stringify({ displayName: 'Cliente', email: 'cliente@example.com', password: 'abcdef' }),
  });
  assert.equal(signupResponse.status, 202);
  assert.deepEqual(await signupResponse.json(), { created: true, confirmationRequired: true });
  assert.equal(signupPayload.data.full_name, 'Cliente');
  assert.equal(signupPayload.email, 'cliente@example.com');
  assert.equal(signupPayload.password, 'abcdef');
  assert.equal(new URL(signupRequestUrl, appOrigin).searchParams.get('redirect_to'), `${appOrigin}/auth/confirm`);

  const limitedSignupResponse = await fetch(`${appOrigin}/api/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: appOrigin },
    body: JSON.stringify({ displayName: 'Limited', email: 'limited@example.com', password: 'StrongPass123!' }),
  });
  assert.equal(limitedSignupResponse.status, 429);
  assert.deepEqual(await limitedSignupResponse.json(), {
    error: 'Supabase alcanzó temporalmente el límite de correos. Espera antes de volver a intentarlo.',
  });

  const resendResponse = await fetch(`${appOrigin}/api/auth/resend-confirmation`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: appOrigin },
    body: JSON.stringify({ email: 'cliente@example.com' }),
  });
  assert.equal(resendResponse.status, 202);
  assert.deepEqual(await resendResponse.json(), { accepted: true });
  assert.equal(resendPayload.email, 'cliente@example.com');
  assert.equal(resendPayload.type, 'signup');
  assert.equal(new URL(resendRequestUrl, appOrigin).searchParams.get('redirect_to'), `${appOrigin}/auth/confirm`);

  const confirmationPageResponse = await fetch(`${appOrigin}/auth/confirm`);
  assert.equal(confirmationPageResponse.status, 200);
  assert.match(await confirmationPageResponse.text(), /Confirmando tu correo/);
  assert.match(confirmationPageResponse.headers.get('content-security-policy') ?? '', /connect-src 'self'/);
  assert.equal(confirmationPageResponse.headers.get('cache-control'), 'private, no-store, max-age=0');

  const confirmationResponse = await fetch(`${appOrigin}/api/auth/confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: appOrigin },
    body: JSON.stringify({ refreshToken: 'confirmation-refresh-token' }),
  });
  assert.equal(confirmationResponse.status, 200);
  assert.deepEqual(await confirmationResponse.json(), { authenticated: true, isAdmin: false });
  const confirmationCookies = confirmationResponse.headers.get('set-cookie') ?? '';
  assert.match(confirmationCookies, /lorobuy_access=confirmed-access-token/);
  assert.match(confirmationCookies, /lorobuy_refresh=confirmed-refresh-token/);

  const signinResponse = await fetch(`${appOrigin}/api/auth/signin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: appOrigin },
    body: JSON.stringify({ email: 'cliente@example.com', password: 'StrongPass123!' }),
  });
  assert.equal(signinResponse.status, 200);
  assert.equal(signinPayload.email, 'cliente@example.com');
  const signinCookies = signinResponse.headers.get('set-cookie') ?? '';
  assert.match(signinCookies, /lorobuy_access=/);
  assert.match(signinCookies, /lorobuy_refresh=/);
  assert.match(signinCookies, /HttpOnly/);
  assert.match(signinCookies, /SameSite=Lax/);

  const anonymousAdminResponse = await fetch(`${appOrigin}/admin`, { redirect: 'manual' });
  assert.equal(anonymousAdminResponse.status, 303);
  assert.equal(anonymousAdminResponse.headers.get('location'), '/?auth=signin&next=%2Fadmin');

  const customerAdminResponse = await fetch(`${appOrigin}/admin`, {
    redirect: 'manual',
    headers: { Cookie: 'lorobuy_access=customer-token' },
  });
  assert.equal(customerAdminResponse.status, 303);
  assert.equal(customerAdminResponse.headers.get('location'), '/?notice=admin-required');

  const adminPageResponse = await fetch(`${appOrigin}/admin`, {
    headers: { Cookie: 'lorobuy_access=admin-token' },
  });
  assert.equal(adminPageResponse.status, 200);
  assert.match(await adminPageResponse.text(), /Panel administrativo protegido de LoroBuy/);
  assert.match(adminPageResponse.headers.get('content-security-policy') ?? '', /connect-src 'self'/);
  assert.equal(adminPageResponse.headers.get('cache-control'), 'private, no-store, max-age=0');

  const adminSessionResponse = await fetch(`${appOrigin}/api/auth/session`, {
    headers: { Cookie: 'lorobuy_access=admin-token' },
  });
  assert.equal(adminSessionResponse.status, 200);
  const adminSession = await adminSessionResponse.json();
  assert.equal(adminSession.authenticated, true);
  assert.equal(adminSession.user.email, 'loroteca98@gmail.com');
  assert.equal(adminSession.user.role, 'admin');
  assert.equal(adminSession.user.isAdmin, true);

  const crossOriginResponse = await fetch(`${appOrigin}/api/newsletter`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://attacker.example' },
    body: JSON.stringify({ email: 'person@example.com' }),
  });
  assert.equal(crossOriginResponse.status, 403);
});
