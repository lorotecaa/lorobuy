import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
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
    category_id: '66666666-6666-4666-8666-666666666666',
    slug: 'mock-product',
    name: 'Mock Product',
    description: null,
    image_path: 'assets/genio.webp',
    price_cents: 2499,
    compare_at_price_cents: 3999,
    currency: 'USD',
    sort_order: 10,
    is_active: true,
    updated_at: '2026-10-04T12:00:00.000Z',
    categories: { id: '66666666-6666-4666-8666-666666666666', slug: 'quiereme', name: 'Animaciones Quiéreme', sort_order: 20, is_active: true },
  };
  const category = {
    id: '66666666-6666-4666-8666-666666666666',
    slug: 'quiereme',
    name: 'Animaciones Quiéreme',
    sort_order: 20,
    is_active: true,
  };
  const productMedia = {
    id: '77777777-7777-4777-8777-777777777777',
    product_id: product.id,
    source_path: 'assets/hero.mp4',
    storage_path: null,
    media_type: 'video',
    mime_type: 'video/mp4',
    byte_size: null,
    alt_text: 'Vista previa de Mock Product',
    sort_order: 0,
    is_active: true,
    created_at: '2026-10-05T12:00:00.000Z',
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
  const completedOrder = {
    id: '44444444-4444-4444-8444-444444444444',
    user_id: customerUser.id,
    status: 'completed',
    currency: 'USD',
    total_cents: 2499,
    customer_email: 'cliente@example.com',
    created_at: '2026-10-05T12:00:00.000Z',
    updated_at: '2026-10-05T12:02:00.000Z',
    completed_at: '2026-10-05T12:02:00.000Z',
    order_items: [{
      id: '88888888-8888-4888-8888-888888888888',
      product_id: product.id,
      product_name: product.name,
      quantity: 1,
      unit_price_cents: 2499,
      subtotal_cents: 2499,
      currency: 'USD',
      products: { slug: product.slug, image_path: product.image_path },
    }],
    payment_attempts: [{
      id: '99999999-9999-4999-8999-999999999999',
      provider: 'lemon_squeezy',
      status: 'paid',
      external_checkout_id: 'checkout_mock',
      external_order_id: 'order_mock',
      expected_amount_cents: 2499,
      currency: 'USD',
      test_mode: true,
      created_at: '2026-10-05T12:00:00.000Z',
      updated_at: '2026-10-05T12:02:00.000Z',
      paid_at: '2026-10-05T12:02:00.000Z',
    }],
    payment_events: [{
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      provider: 'lemon_squeezy',
      event_type: 'order_created',
      provider_object_id: 'order_mock',
      received_at: '2026-10-05T12:02:00.000Z',
      processed_at: '2026-10-05T12:02:00.000Z',
    }],
  };
  const pendingOrder = {
    ...completedOrder,
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    status: 'pending',
    total_cents: 5900,
    customer_email: null,
    created_at: '2026-10-04T10:00:00.000Z',
    updated_at: '2026-10-04T10:01:00.000Z',
    completed_at: null,
    order_items: [{
      ...completedOrder.order_items[0],
      id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      order_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      unit_price_cents: 5900,
      subtotal_cents: 5900,
    }],
    payment_attempts: [{
      ...completedOrder.payment_attempts[0],
      id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      status: 'checkout_created',
      external_checkout_id: 'checkout_pending',
      external_order_id: null,
      expected_amount_cents: 5900,
      created_at: '2026-10-04T10:00:00.000Z',
      updated_at: '2026-10-04T10:01:00.000Z',
      paid_at: null,
    }],
    payment_events: [],
  };
  let signupPayload;
  let signupRequestUrl;
  let resendPayload;
  let resendRequestUrl;
  let signinPayload;
  let webhookRpcPayload;
  let adminCreatePayload;
  let adminUpdatePayload;
  let adminUserUpdatePayload;
  let adminCancelOrderPayload;
  let adminDeleteOrderPayload;
  const readJsonBody = async (request) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    return JSON.parse(body);
  };

  const supabaseMock = http.createServer(async (request, response) => {
    if (request.url === '/rest/v1/rpc/complete_payment_order') {
      assert.equal(request.headers.apikey, 'sb_secret_mock');
      assert.equal(request.headers.authorization, 'Bearer sb_secret_mock');
      webhookRpcPayload = await readJsonBody(request);
      response.setHeader('Content-Type', 'application/json');
      return response.end(JSON.stringify('completed'));
    }
    if (request.url === '/rest/v1/rpc/admin_create_product') {
      assert.equal(request.headers.apikey, 'sb_publishable_mock');
      assert.equal(request.headers.authorization, 'Bearer admin-token');
      adminCreatePayload = await readJsonBody(request);
      response.setHeader('Content-Type', 'application/json');
      return response.end(JSON.stringify([{ ...product,
        slug: adminCreatePayload.p_slug,
        name: adminCreatePayload.p_name,
        price_cents: adminCreatePayload.p_price_cents,
      }]));
    }
    if (request.url === '/rest/v1/rpc/admin_update_user_profile') {
      assert.equal(request.headers.apikey, 'sb_publishable_mock');
      assert.equal(request.headers.authorization, 'Bearer admin-token');
      adminUserUpdatePayload = await readJsonBody(request);
      response.setHeader('Content-Type', 'application/json');
      return response.end(JSON.stringify({
        id: adminUserUpdatePayload.p_user_id,
        display_name: adminUserUpdatePayload.p_display_name,
        avatar_url: null,
        role: adminUserUpdatePayload.p_role,
        created_at: '2026-10-03T12:00:00.000Z',
        updated_at: '2026-10-04T12:00:00.000Z',
      }));
    }
    if (request.url === '/rest/v1/rpc/admin_cancel_order') {
      adminCancelOrderPayload = await readJsonBody(request);
      response.setHeader('Content-Type', 'application/json');
      return response.end(JSON.stringify('cancelled'));
    }
    if (request.url === '/rest/v1/rpc/admin_delete_test_order') {
      adminDeleteOrderPayload = await readJsonBody(request);
      response.setHeader('Content-Type', 'application/json');
      return response.end(JSON.stringify('deleted'));
    }
    if (!request.url?.startsWith('/auth/v1/admin/users')) {
      assert.equal(request.headers.apikey, 'sb_publishable_mock');
    }
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
    if (request.method === 'GET' && request.url?.startsWith('/auth/v1/admin/users?')) {
      assert.equal(request.headers.apikey, 'sb_secret_mock');
      assert.equal(request.headers.authorization, 'Bearer sb_secret_mock');
      response.setHeader('Content-Type', 'application/json');
      return response.end(JSON.stringify({ users: [adminUser, customerUser], aud: 'authenticated' }));
    }
    if (request.method === 'GET' && request.url === `/auth/v1/admin/users/${adminUser.id}`) {
      assert.equal(request.headers.apikey, 'sb_secret_mock');
      response.setHeader('Content-Type', 'application/json');
      return response.end(JSON.stringify({ user: adminUser }));
    }
    if (request.method === 'GET' && request.url === `/auth/v1/admin/users/${customerUser.id}`) {
      assert.equal(request.headers.apikey, 'sb_secret_mock');
      response.setHeader('Content-Type', 'application/json');
      return response.end(JSON.stringify({ user: customerUser }));
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
        const profile = { id: adminUser.id, display_name: 'Loro Admin', avatar_url: null, role: 'admin', created_at: '2026-10-02T12:00:00.000Z' };
        return response.end(JSON.stringify(request.url.includes('id=eq.') ? profile : [profile]));
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
    if (request.url?.startsWith('/rest/v1/orders')) {
      response.setHeader('Content-Type', 'application/json');
      return response.end(JSON.stringify([completedOrder, pendingOrder]));
    }
    if (request.url?.startsWith('/rest/v1/categories')) {
      response.setHeader('Content-Type', 'application/json');
      return response.end(JSON.stringify([category]));
    }
    if (request.url?.startsWith('/rest/v1/product_media')) {
      response.setHeader('Content-Type', 'application/json');
      return response.end(JSON.stringify([productMedia]));
    }
    if (request.url?.startsWith('/rest/v1/products')) {
      response.setHeader('Content-Range', '0-0/1');
      if (request.method === 'HEAD') return response.end();
      if (request.method === 'PATCH') {
        adminUpdatePayload = await readJsonBody(request);
        response.setHeader('Content-Type', 'application/json');
        return response.end(JSON.stringify([{ ...product, ...adminUpdatePayload }]));
      }
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
      SUPABASE_SECRET_KEY: 'sb_secret_mock',
      LEMON_SQUEEZY_API_KEY: 'lemon_api_mock',
      LEMON_SQUEEZY_STORE_ID: '77',
      LEMON_SQUEEZY_WEBHOOK_SECRET: 'lemon_webhook_secret',
      LEMON_SQUEEZY_TEST_MODE: 'true',
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
  assert.equal(catalog.products[0].previewPath, '/assets/hero.mp4?v=20261005-stream-1');
  assert.equal(catalog.products[0].previewThumbnailPath, 'assets/genio.webp');

  const productApiResponse = await fetch(`${appOrigin}/api/products/mock-product`);
  assert.equal(productApiResponse.status, 200);
  const productApi = await productApiResponse.json();
  assert.equal(productApi.product.slug, 'mock-product');
  assert.equal(productApi.product.previewPath, '/assets/hero.mp4?v=20261005-stream-1');
  assert.equal(productApi.product.previewThumbnailPath, 'assets/genio.webp');
  assert.equal(productApi.product.media.length, 1);
  assert.equal(productApi.product.media[0].url, '/assets/hero.mp4?v=20261005-stream-1');

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

  const forbiddenCatalogResponse = await fetch(`${appOrigin}/api/admin/catalog`, {
    headers: { Cookie: 'lorobuy_access=customer-token' },
  });
  assert.equal(forbiddenCatalogResponse.status, 403);

  const adminCatalogResponse = await fetch(`${appOrigin}/api/admin/catalog`, {
    headers: { Cookie: 'lorobuy_access=admin-token' },
  });
  assert.equal(adminCatalogResponse.status, 200);
  assert.equal(adminCatalogResponse.headers.get('cache-control'), 'private, no-store, max-age=0');
  const adminCatalog = await adminCatalogResponse.json();
  assert.equal(adminCatalog.products[0].priceCents, 2499);
  assert.equal(adminCatalog.products[0].category.name, 'Animaciones Quiéreme');
  assert.equal(adminCatalog.categories[0].id, category.id);

  const invalidPriceResponse = await fetch(`${appOrigin}/api/admin/products/${product.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Origin: appOrigin, Cookie: 'lorobuy_access=admin-token' },
    body: JSON.stringify({ priceCents: 49 }),
  });
  assert.equal(invalidPriceResponse.status, 400);

  const createProductResponse = await fetch(`${appOrigin}/api/admin/products`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: appOrigin, Cookie: 'lorobuy_access=admin-token' },
    body: JSON.stringify({
      categoryId: category.id,
      slug: 'producto-nuevo',
      name: 'Producto nuevo',
      description: 'Descripción segura',
      imagePath: 'assets/favicon.png',
      priceCents: 5000,
      compareAtPriceCents: 6500,
      currency: 'USD',
      sortOrder: 30,
      isActive: true,
    }),
  });
  assert.equal(createProductResponse.status, 201);
  assert.equal(adminCreatePayload.p_price_cents, 5000);
  assert.equal(adminCreatePayload.p_slug, 'producto-nuevo');

  const updatePriceResponse = await fetch(`${appOrigin}/api/admin/products/${product.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Origin: appOrigin, Cookie: 'lorobuy_access=admin-token' },
    body: JSON.stringify({ priceCents: 3200, compareAtPriceCents: 4000 }),
  });
  assert.equal(updatePriceResponse.status, 200);
  assert.equal((await updatePriceResponse.json()).product.priceCents, 3200);
  assert.equal(adminUpdatePayload.price_cents, 3200);

  const deactivateResponse = await fetch(`${appOrigin}/api/admin/products/${product.id}`, {
    method: 'DELETE',
    headers: { Origin: appOrigin, Cookie: 'lorobuy_access=admin-token' },
  });
  assert.equal(deactivateResponse.status, 200);
  assert.equal((await deactivateResponse.json()).deactivated, true);
  assert.equal(adminUpdatePayload.is_active, false);

  const forbiddenUsersResponse = await fetch(`${appOrigin}/api/admin/users`, {
    headers: { Cookie: 'lorobuy_access=customer-token' },
  });
  assert.equal(forbiddenUsersResponse.status, 403);

  const usersResponse = await fetch(`${appOrigin}/api/admin/users`, {
    headers: { Cookie: 'lorobuy_access=admin-token' },
  });
  assert.equal(usersResponse.status, 200);
  const usersPayload = await usersResponse.json();
  assert.equal(usersPayload.users.length, 2);
  assert.equal(usersPayload.users.find((user) => user.email === 'loroteca98@gmail.com').isPrimaryAdmin, true);

  const forbiddenOrdersResponse = await fetch(`${appOrigin}/api/admin/orders`, {
    headers: { Cookie: 'lorobuy_access=customer-token' },
  });
  assert.equal(forbiddenOrdersResponse.status, 403);

  const ordersResponse = await fetch(`${appOrigin}/api/admin/orders`, {
    headers: { Cookie: 'lorobuy_access=admin-token' },
  });
  assert.equal(ordersResponse.status, 200);
  assert.equal(ordersResponse.headers.get('cache-control'), 'private, no-store, max-age=0');
  const ordersPayload = await ordersResponse.json();
  assert.equal(ordersPayload.orders.length, 2);
  assert.equal(ordersPayload.orders[0].customer.email, 'cliente@example.com');
  assert.equal(ordersPayload.orders[0].items[0].productName, 'Mock Product');
  assert.equal(ordersPayload.orders[0].payment.status, 'paid');
  assert.equal(ordersPayload.orders[0].events[0].type, 'order_created');
  assert.equal(ordersPayload.orders[0].controls.canCancel, false);
  assert.equal(ordersPayload.orders[0].controls.canDelete, false);
  assert.equal(ordersPayload.orders[1].controls.canCancel, true);
  assert.equal(ordersPayload.orders[1].controls.canDelete, false);
  assert.equal(ordersPayload.summary.completed, 1);
  assert.equal(ordersPayload.summary.registeredTotalCents, 2499);
  assert.equal(ordersPayload.summary.pending, 1);
  assert.equal(ordersPayload.summary.testMode, 2);

  const forbiddenCancelOrderResponse = await fetch(`${appOrigin}/api/admin/orders/${pendingOrder.id}/cancel`, {
    method: 'POST',
    headers: { Origin: appOrigin, Cookie: 'lorobuy_access=customer-token' },
  });
  assert.equal(forbiddenCancelOrderResponse.status, 403);

  const cancelOrderResponse = await fetch(`${appOrigin}/api/admin/orders/${pendingOrder.id}/cancel`, {
    method: 'POST',
    headers: { Origin: appOrigin, Cookie: 'lorobuy_access=admin-token' },
  });
  assert.equal(cancelOrderResponse.status, 200);
  assert.equal((await cancelOrderResponse.json()).status, 'cancelled');
  assert.equal(adminCancelOrderPayload.p_order_id, pendingOrder.id);

  const deleteOrderResponse = await fetch(`${appOrigin}/api/admin/orders/${pendingOrder.id}`, {
    method: 'DELETE',
    headers: { Origin: appOrigin, Cookie: 'lorobuy_access=admin-token' },
  });
  assert.equal(deleteOrderResponse.status, 200);
  assert.equal((await deleteOrderResponse.json()).result, 'deleted');
  assert.equal(adminDeleteOrderPayload.p_order_id, pendingOrder.id);

  const updateUserResponse = await fetch(`${appOrigin}/api/admin/users/${customerUser.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Origin: appOrigin, Cookie: 'lorobuy_access=admin-token' },
    body: JSON.stringify({ displayName: 'Cliente autorizado', role: 'admin' }),
  });
  assert.equal(updateUserResponse.status, 200);
  assert.equal((await updateUserResponse.json()).user.role, 'admin');
  assert.equal(adminUserUpdatePayload.p_user_id, customerUser.id);
  assert.equal(adminUserUpdatePayload.p_role, 'admin');

  const protectedAdminResponse = await fetch(`${appOrigin}/api/admin/users/${adminUser.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Origin: appOrigin, Cookie: 'lorobuy_access=admin-token' },
    body: JSON.stringify({ displayName: 'Loro Admin', role: 'customer' }),
  });
  assert.equal(protectedAdminResponse.status, 409);

  const crossOriginResponse = await fetch(`${appOrigin}/api/newsletter`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://attacker.example' },
    body: JSON.stringify({ email: 'person@example.com' }),
  });
  assert.equal(crossOriginResponse.status, 403);

  const webhookPayload = {
    meta: {
      event_name: 'order_created',
      custom_data: {
        order_id: '44444444-4444-4444-8444-444444444444',
        payment_attempt_token: '55555555-5555-4555-8555-555555555555',
      },
    },
    data: {
      type: 'orders',
      id: '123456',
      attributes: {
        store_id: 77,
        status: 'paid',
        currency: 'USD',
        subtotal: 13900,
        user_email: 'buyer@example.com',
        test_mode: true,
        first_order_item: { variant_id: 9876 },
      },
    },
  };
  const rawWebhook = JSON.stringify(webhookPayload);
  const invalidWebhookResponse = await fetch(`${appOrigin}/api/webhooks/lemon-squeezy`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Event-Name': 'order_created',
      'X-Signature': '0'.repeat(64),
    },
    body: rawWebhook,
  });
  assert.equal(invalidWebhookResponse.status, 401);

  const signature = crypto.createHmac('sha256', 'lemon_webhook_secret').update(rawWebhook).digest('hex');
  const verifiedWebhookResponse = await fetch(`${appOrigin}/api/webhooks/lemon-squeezy`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Event-Name': 'order_created',
      'X-Signature': signature,
    },
    body: rawWebhook,
  });
  assert.equal(verifiedWebhookResponse.status, 200);
  assert.deepEqual(await verifiedWebhookResponse.json(), { received: true, result: 'completed' });
  assert.equal(webhookRpcPayload.p_order_id, webhookPayload.meta.custom_data.order_id);
  assert.equal(webhookRpcPayload.p_attempt_token, webhookPayload.meta.custom_data.payment_attempt_token);
  assert.equal(webhookRpcPayload.p_provider_variant_id, '9876');
  assert.equal(webhookRpcPayload.p_subtotal_cents, 13900);
});
