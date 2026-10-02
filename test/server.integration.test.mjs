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

  const supabaseMock = http.createServer((request, response) => {
    assert.equal(request.headers.apikey, 'sb_publishable_mock');
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

  const crossOriginResponse = await fetch(`${appOrigin}/api/newsletter`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://attacker.example' },
    body: JSON.stringify({ email: 'person@example.com' }),
  });
  assert.equal(crossOriginResponse.status, 403);
});
