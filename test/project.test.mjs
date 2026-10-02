import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../src/config.mjs';
import { buildContentSecurityPolicy } from '../src/security.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(root, 'dist', 'index.html'), 'utf8');
const server = fs.readFileSync(path.join(root, 'src', 'server.mjs'), 'utf8');
const configSource = fs.readFileSync(path.join(root, 'src', 'config.mjs'), 'utf8');
const schema = fs.readFileSync(path.join(root, 'supabase', 'migrations', '202610020001_initial_schema.sql'), 'utf8');

test('production configuration requires HTTPS origins and Supabase URL', () => {
  const config = loadConfig({
    NODE_ENV: 'production',
    PORT: '10000',
    APP_ORIGIN: 'https://lorobuy.onrender.com/',
    SUPABASE_URL: 'https://example-ref.supabase.co/',
    SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
  });
  assert.equal(config.appOrigin, 'https://lorobuy.onrender.com');
  assert.equal(config.supabaseUrl, 'https://example-ref.supabase.co');
  assert.equal(config.secureCookies, true);
});

test('CSP allows only the same-origin API and hashed inline code', () => {
  const policy = buildContentSecurityPolicy(html);
  assert.match(policy, /connect-src 'self'/);
  assert.match(policy, /script-src 'sha256-[^']+' 'strict-dynamic'/);
  assert.match(policy, /style-src 'sha256-[^']+'/);
  assert.match(policy, /frame-ancestors 'none'/);
  assert.doesNotMatch(policy, /'unsafe-inline'/);
  assert.doesNotMatch(policy, /https:\/\/(?!placeholder)/);
});

test('catalog and cart are loaded through the API, not local product arrays', () => {
  assert.match(html, /fetch\('\/api\/products'/);
  assert.match(html, /fetch\('\/api\/cart\/items'/);
  assert.doesNotMatch(html, /const packs\s*=/);
  assert.doesNotMatch(html, /const love\s*=/);
  assert.doesNotMatch(html, /const snipe\s*=/);
});

test('server uses only the Supabase publishable key', () => {
  const backendSource = `${server}\n${configSource}`;
  assert.match(backendSource, /SUPABASE_PUBLISHABLE_KEY/);
  assert.doesNotMatch(backendSource, /SUPABASE_SECRET_KEY|service_role|sb_secret_/);
});

test('every application table enables RLS', () => {
  const tables = [
    'profiles', 'categories', 'products', 'product_files', 'carts',
    'cart_items', 'orders', 'order_items', 'downloads', 'newsletter_subscriptions',
  ];
  for (const table of tables) {
    assert.match(schema, new RegExp(`alter table public\\.${table} enable row level security;`));
  }
});

test('all referenced local assets exist', () => {
  const references = [...html.matchAll(/(?:src|href)="(assets\/[^"]+)"/g)].map((match) => match[1]);
  for (const reference of references) {
    assert.equal(fs.existsSync(path.join(root, 'dist', reference)), true, reference);
  }
});
