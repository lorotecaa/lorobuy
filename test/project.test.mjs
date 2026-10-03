import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../src/config.mjs';
import { buildContentSecurityPolicy } from '../src/security.mjs';
import { assertFullHdDimensions, MIN_VIDEO_SHORT_EDGE, readMp4Dimensions } from '../scripts/video-quality.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(root, 'frontend', 'index.html'), 'utf8');
const productHtml = fs.readFileSync(path.join(root, 'frontend', 'product.html'), 'utf8');
const adminHtml = fs.readFileSync(path.join(root, 'frontend', 'admin.html'), 'utf8');
const authConfirmHtml = fs.readFileSync(path.join(root, 'frontend', 'auth-confirm.html'), 'utf8');
const builtHtml = fs.readFileSync(path.join(root, 'dist', 'index.html'), 'utf8');
const builtProductHtml = fs.readFileSync(path.join(root, 'dist', 'product.html'), 'utf8');
const builtAdminHtml = fs.readFileSync(path.join(root, 'dist', 'admin.html'), 'utf8');
const builtAuthConfirmHtml = fs.readFileSync(path.join(root, 'dist', 'auth-confirm.html'), 'utf8');
const server = fs.readFileSync(path.join(root, 'src', 'server.mjs'), 'utf8');
const authSource = fs.readFileSync(path.join(root, 'src', 'auth.mjs'), 'utf8');
const configSource = fs.readFileSync(path.join(root, 'src', 'config.mjs'), 'utf8');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const renderConfig = fs.readFileSync(path.join(root, 'render.yaml'), 'utf8');
const schema = fs.readFileSync(path.join(root, 'supabase', 'migrations', '202610020001_initial_schema.sql'), 'utf8');
const adminMigration = fs.readFileSync(path.join(root, 'supabase', 'migrations', '202610020004_admin_role.sql'), 'utf8');

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
  const productPolicy = buildContentSecurityPolicy(productHtml);
  const adminPolicy = buildContentSecurityPolicy(adminHtml);
  const authConfirmPolicy = buildContentSecurityPolicy(authConfirmHtml);
  assert.equal(policy, buildContentSecurityPolicy(html.replace(/\r\n/g, '\n')));
  assert.match(policy, /connect-src 'self'/);
  assert.match(productPolicy, /connect-src 'self'/);
  assert.match(adminPolicy, /connect-src 'self'/);
  assert.match(authConfirmPolicy, /connect-src 'self'/);
  assert.match(policy, /script-src 'sha256-[^']+' 'strict-dynamic'/);
  assert.match(policy, /style-src 'sha256-[^']+'/);
  assert.match(policy, /frame-ancestors 'none'/);
  assert.doesNotMatch(policy, /'unsafe-inline'/);
  assert.doesNotMatch(policy, /https:\/\/(?!placeholder)/);
  assert.doesNotMatch(productPolicy, /'unsafe-inline'/);
  assert.doesNotMatch(adminPolicy, /'unsafe-inline'/);
  assert.doesNotMatch(authConfirmPolicy, /'unsafe-inline'/);
});

test('account interface provides sign-in, registration, profile, and admin entry points', () => {
  assert.match(html, /id="accountDialog"/);
  assert.match(html, /id="signinForm"/);
  assert.match(html, /id="signupForm"/);
  assert.match(html, /id="profileForm"/);
  assert.match(html, /href="\/admin"/);
  assert.match(html, /apiRequest\('\/api\/auth\/session'/);
  assert.match(html, /fetch\(url/);
  assert.match(authConfirmHtml, /fetch\('\/api\/auth\/confirm'/);
  assert.doesNotMatch(authConfirmHtml, /localStorage|sessionStorage/);
  assert.match(html, /minlength="6"/);
  assert.match(html, /Usa al menos 6 caracteres/);
});

test('catalog and cart are loaded through the API, not local product arrays', () => {
  assert.match(html, /fetch\('\/api\/products'/);
  assert.match(html, /fetch\('\/api\/cart\/items'/);
  assert.doesNotMatch(html, /const packs\s*=/);
  assert.doesNotMatch(html, /const love\s*=/);
  assert.doesNotMatch(html, /const snipe\s*=/);
});

test('catalog cards preview video on hover and open a dedicated product page', () => {
  assert.match(html, /make\('video','card-preview'\)/);
  assert.match(html, /article\.addEventListener\('pointerenter',play\)/);
  assert.match(html, /\/products\/\$\{encodeURIComponent\(product\.slug\)\}/);
  assert.match(productHtml, /id="productVideo"/);
  assert.match(productHtml, /controlslist="nodownload noremoteplayback"/);
  assert.match(productHtml, /id="descriptionTitle"/);
  assert.match(productHtml, /function productCopy\(item\)/);
  assert.match(productHtml, /grid-template-columns:minmax\(0,548px\) minmax\(350px,400px\)/);
  assert.match(productHtml, /\.loading\[hidden\]\{display:none\}/);
  assert.match(productHtml, /fetch\(`\/api\/products\/\$\{encodeURIComponent\(slug\)\}`/);
  assert.match(productHtml, /data-add/);
  assert.match(server, /app\.get\('\/api\/products\/:slug'/);
  assert.match(server, /app\.get\('\/products\/:slug'/);
});

test('hero battle animates donations, time, progress, and round result', () => {
  assert.match(html, /id="battleLeftScore"/);
  assert.match(html, /id="battleRightScore"/);
  assert.match(html, /id="battleTimer"/);
  assert.match(html, /id="battleBar" role="progressbar"/);
  assert.match(html, /--battle-share/);
  assert.match(html, /const events=\{/);
  assert.match(html, /requestAnimationFrame\(animateBattle\)/);
  assert.match(html, /battleResult\.classList\.add\('show'\)/);
});

test('storefront video source meets the Full HD quality floor', async () => {
  const dimensions = await readMp4Dimensions(path.join(root, 'frontend', 'assets', 'hero.mp4'));
  assert.ok(Math.min(dimensions.width, dimensions.height) >= MIN_VIDEO_SHORT_EDGE);
  assert.deepEqual(dimensions, { width: 1920, height: 1080 });
  assert.throws(() => assertFullHdDimensions({ width: 960, height: 540 }, 'Low quality preview'), /requires at least 1080px/);
});

test('Render build and start commands produce the directory used by the server', () => {
  assert.equal(packageJson.scripts.build, 'node scripts/build.mjs');
  assert.equal(packageJson.scripts.start, 'node src/server.mjs');
  assert.match(renderConfig, /buildCommand: npm ci && npm run build/);
  assert.match(renderConfig, /startCommand: npm start/);
  assert.match(server, /path\.join\(ROOT_DIR, 'dist'\)/);
  assert.equal(builtHtml, html);
  assert.equal(builtProductHtml, productHtml);
  assert.equal(builtAdminHtml, adminHtml);
  assert.equal(builtAuthConfirmHtml, authConfirmHtml);
});

test('email confirmation uses the configured public origin and a protected callback', () => {
  assert.match(server, /emailRedirectTo: `\$\{config\.appOrigin\}\/auth\/confirm`/);
  assert.match(server, /app\.post\('\/api\/auth\/resend-confirmation'/);
  assert.match(server, /app\.post\('\/api\/auth\/confirm'/);
  assert.match(server, /refreshSession\(\{ refresh_token: refreshToken \}\)/);
  assert.match(server, /app\.get\('\/auth\/confirm'/);
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

test('admin access is enforced by confirmed Supabase identity, backend role checks, and RLS', () => {
  assert.match(server, /app\.get\('\/admin'/);
  assert.match(server, /profile\?\.role !== 'admin'/);
  assert.match(authSource, /profile\?\.role !== 'admin'/);
  assert.match(authSource, /!session\.user\.email_confirmed_at/);
  assert.match(schema, /grant update \(display_name, avatar_url\) on table public\.profiles to authenticated;/);
  assert.doesNotMatch(schema, /grant update \([^)]*role[^)]*\) on table public\.profiles/);
  assert.match(adminMigration, /lower\(coalesce\(new\.email, ''\)\) = 'loroteca98@gmail\.com'/);
  assert.match(adminMigration, /new\.email_confirmed_at is not null/);
  assert.match(adminMigration, /set role = 'admin'/);
  assert.match(adminMigration, /join auth\.users u on u\.id = p\.id/);
});

test('all referenced local assets exist', () => {
  const references = [...`${html}\n${productHtml}\n${adminHtml}`.matchAll(/(?:src|href)="\/?(assets\/[^"]+)"/g)].map((match) => match[1]);
  for (const reference of references) {
    const assetPath = reference.split(/[?#]/, 1)[0];
    assert.equal(fs.existsSync(path.join(root, 'frontend', assetPath)), true, reference);
  }
});
