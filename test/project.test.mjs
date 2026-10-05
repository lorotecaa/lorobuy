import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../src/config.mjs';
import {
  buildLemonSqueezyCheckoutBody,
  parseLemonSqueezyWebhook,
  verifyLemonSqueezySignature,
} from '../src/payments.mjs';
import { buildContentSecurityPolicy } from '../src/security.mjs';
import { assertHighDefinitionDimensions, readMp4Dimensions } from '../scripts/video-quality.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(root, 'frontend', 'index.html'), 'utf8');
const productHtml = fs.readFileSync(path.join(root, 'frontend', 'product.html'), 'utf8');
const adminHtml = fs.readFileSync(path.join(root, 'frontend', 'admin.html'), 'utf8');
const adminScript = fs.readFileSync(path.join(root, 'frontend', 'assets', 'admin.js'), 'utf8');
const authConfirmHtml = fs.readFileSync(path.join(root, 'frontend', 'auth-confirm.html'), 'utf8');
const builtHtml = fs.readFileSync(path.join(root, 'dist', 'index.html'), 'utf8');
const builtProductHtml = fs.readFileSync(path.join(root, 'dist', 'product.html'), 'utf8');
const builtAdminHtml = fs.readFileSync(path.join(root, 'dist', 'admin.html'), 'utf8');
const builtAuthConfirmHtml = fs.readFileSync(path.join(root, 'dist', 'auth-confirm.html'), 'utf8');
const server = fs.readFileSync(path.join(root, 'src', 'server.mjs'), 'utf8');
const authSource = fs.readFileSync(path.join(root, 'src', 'auth.mjs'), 'utf8');
const configSource = fs.readFileSync(path.join(root, 'src', 'config.mjs'), 'utf8');
const paymentsSource = fs.readFileSync(path.join(root, 'src', 'payments.mjs'), 'utf8');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const renderConfig = fs.readFileSync(path.join(root, 'render.yaml'), 'utf8');
const schema = fs.readFileSync(path.join(root, 'supabase', 'migrations', '202610020001_initial_schema.sql'), 'utf8');
const adminMigration = fs.readFileSync(path.join(root, 'supabase', 'migrations', '202610020004_admin_role.sql'), 'utf8');
const paymentsMigration = fs.readFileSync(path.join(root, 'supabase', 'migrations', '202610030001_lemon_squeezy_payments.sql'), 'utf8');
const nordicsPaymentMapping = fs.readFileSync(path.join(root, 'supabase', 'migrations', '202610030002_map_nordicos_lemon_test_variant.sql'), 'utf8');
const catalogPaymentMapping = fs.readFileSync(path.join(root, 'supabase', 'migrations', '202610040001_map_catalog_lemon_test_variant.sql'), 'utf8');
const adminCatalogMigration = fs.readFileSync(path.join(root, 'supabase', 'migrations', '202610040002_admin_products_prices.sql'), 'utf8');

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
  assert.equal(config.paymentsConfigured, false);
});

test('payment configuration is backend-only and defaults to safe test mode', () => {
  const config = loadConfig({
    NODE_ENV: 'production',
    APP_ORIGIN: 'https://lorobuy.onrender.com',
    SUPABASE_URL: 'https://example-ref.supabase.co',
    SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
    SUPABASE_SECRET_KEY: 'sb_secret_test',
    LEMON_SQUEEZY_API_KEY: 'lemon_test_key',
    LEMON_SQUEEZY_STORE_ID: '1234',
    LEMON_SQUEEZY_WEBHOOK_SECRET: 'webhook_secret',
  });
  assert.equal(config.paymentsConfigured, true);
  assert.equal(config.lemonSqueezyTestMode, true);
  assert.throws(() => loadConfig({
    NODE_ENV: 'development',
    APP_ORIGIN: 'http://localhost:10000',
    SUPABASE_URL: 'http://localhost:54321',
    SUPABASE_PUBLISHABLE_KEY: 'test',
    LEMON_SQUEEZY_TEST_MODE: 'yes',
  }), /must be either true or false/);
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

test('checkout is external and paid access is granted only by a signed idempotent webhook', () => {
  const config = {
    appOrigin: 'https://lorobuy.onrender.com',
    lemonSqueezyStoreId: '1234',
    lemonSqueezyTestMode: true,
  };
  const body = buildLemonSqueezyCheckoutBody(config, {
    orderId: '11111111-1111-4111-8111-111111111111',
    attemptToken: '22222222-2222-4222-8222-222222222222',
    providerVariantId: '9876',
    amountCents: 13900,
    productName: 'Mega Pack Dioses Nórdicos',
    productSlug: 'mega-pack-dioses-nordicos',
  });
  assert.equal(body.data.attributes.custom_price, 13900);
  assert.equal(body.data.attributes.checkout_options.embed, false);
  assert.equal(body.data.attributes.checkout_options.discount, false);
  assert.equal(body.data.relationships.variant.data.id, '9876');
  assert.match(body.data.attributes.product_options.redirect_url, /^https:\/\/lorobuy\.onrender\.com\/products\//);

  const webhookBody = Buffer.from(JSON.stringify({
    meta: { event_name: 'order_created', custom_data: {} },
    data: { type: 'orders', id: '55', attributes: {} },
  }));
  const secret = 'signed-webhook-secret';
  const signature = crypto.createHmac('sha256', secret).update(webhookBody).digest('hex');
  assert.equal(verifyLemonSqueezySignature(webhookBody, signature, secret), true);
  assert.equal(verifyLemonSqueezySignature(webhookBody, '0'.repeat(64), secret), false);
  const event = parseLemonSqueezyWebhook(webhookBody, 'order_created');
  assert.equal(event.eventKey, 'order_created:orders:55');
  assert.match(event.payloadSha256, /^[a-f0-9]{64}$/);

  assert.match(server, /app\.post\('\/api\/checkout'/);
  assert.match(server, /app\.post\('\/api\/webhooks\/lemon-squeezy'/);
  assert.match(server, /attributes\.status === 'paid'/);
  assert.match(server, /complete_payment_order/);
  assert.match(productHtml, /location\.assign\(result\.checkoutUrl\)/);
  assert.match(paymentsMigration, /unique \(provider, event_key\)/);
  assert.match(paymentsMigration, /grant execute on function public\.complete_payment_order[\s\S]+to service_role;/);
  assert.match(paymentsMigration, /create trigger orders_require_verified_payment/);
  assert.match(paymentsMigration, /orders can only be completed by a verified payment webhook/);
  assert.match(paymentsMigration, /set status = 'completed'/);
});

test('the Nordic mapping is safely expanded to every active catalog product', () => {
  assert.match(nordicsPaymentMapping, /where slug = 'mega-pack-dioses-nordicos'/);
  assert.match(nordicsPaymentMapping, /'lemon_squeezy'/);
  assert.match(nordicsPaymentMapping, /'2202114'/);
  assert.equal((nordicsPaymentMapping.match(/insert into public\.payment_provider_variants/g) ?? []).length, 1);
  assert.match(catalogPaymentMapping, /drop constraint if exists payment_provider_variants_provider_external_variant_id_key/);
  assert.match(catalogPaymentMapping, /where is_active = true/);
  assert.match(catalogPaymentMapping, /mapped_product_count <> active_product_count/);
  assert.match(catalogPaymentMapping, /'lemon_squeezy'/);
  assert.match(catalogPaymentMapping, /'2202114'/);
  assert.doesNotMatch(catalogPaymentMapping, /where slug =/);
});

test('catalog cards preview video on hover and open a dedicated product page', () => {
  assert.match(html, /make\('video','card-preview'\)/);
  assert.match(html, /article\.addEventListener\('pointerenter',play\)/);
  assert.match(html, /\/products\/\$\{encodeURIComponent\(product\.slug\)\}/);
  assert.match(productHtml, /id="productVideo"/);
  assert.match(productHtml, /<video id="videoThumb"/);
  assert.match(productHtml, /videoThumb\.src=videoUrl/);
  assert.match(productHtml, /videoThumb\.poster=videoThumbnailUrl/);
  assert.match(productHtml, /videoThumb\.removeAttribute\('poster'\)/);
  assert.doesNotMatch(productHtml, /videoThumb\.src=imageUrl/);
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

test('storefront videos meet the display quality floor', async () => {
  const dimensions = await readMp4Dimensions(path.join(root, 'frontend', 'assets', 'hero.mp4'));
  const nordicPreview = await readMp4Dimensions(path.join(root, 'frontend', 'assets', 'previews', 'mega-pack-dioses-nordicos.mp4'));
  assert.deepEqual(dimensions, { width: 1920, height: 1080 });
  assert.deepEqual(nordicPreview, { width: 606, height: 1080 });
  assert.doesNotThrow(() => assertHighDefinitionDimensions({ width: 606, height: 1080 }, 'Portrait preview'));
  assert.throws(() => assertHighDefinitionDimensions({ width: 960, height: 540 }, 'Low quality preview'), /requires at least/);
  assert.throws(() => assertHighDefinitionDimensions({ width: 1280, height: 720 }, 'Low quality landscape'), /requires at least/);
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

test('payment secrets stay on the backend and never enter storefront code', () => {
  const backendSource = `${server}\n${configSource}\n${paymentsSource}`;
  const browserSource = `${html}\n${productHtml}\n${adminHtml}\n${adminScript}\n${authConfirmHtml}`;
  assert.match(backendSource, /SUPABASE_PUBLISHABLE_KEY/);
  assert.match(backendSource, /SUPABASE_SECRET_KEY/);
  assert.match(backendSource, /LEMON_SQUEEZY_API_KEY/);
  assert.doesNotMatch(browserSource, /SUPABASE_SECRET_KEY|LEMON_SQUEEZY_API_KEY|LEMON_SQUEEZY_WEBHOOK_SECRET|sb_secret_/);
});

test('every application table enables RLS', () => {
  const tables = [
    'profiles', 'categories', 'products', 'product_files', 'carts',
    'cart_items', 'orders', 'order_items', 'downloads', 'newsletter_subscriptions',
  ];
  for (const table of tables) {
    assert.match(schema, new RegExp(`alter table public\\.${table} enable row level security;`));
  }
  for (const table of ['payment_provider_variants', 'payment_attempts', 'payment_events']) {
    assert.match(paymentsMigration, new RegExp(`alter table public\\.${table} enable row level security;`));
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

test('admin products and prices use the existing catalog with an atomic Lemon mapping', () => {
  assert.match(server, /app\.get\('\/api\/admin\/catalog'/);
  assert.match(server, /app\.post\('\/api\/admin\/products'/);
  assert.match(server, /app\.patch\('\/api\/admin\/products\/:productId'/);
  assert.match(server, /app\.delete\('\/api\/admin\/products\/:productId'/);
  assert.match(server, /integerInRange\(body\?\.priceCents, 50, 100_000_000\)/);
  assert.match(server, /\.rpc\('admin_create_product'/);
  assert.match(adminCatalogMigration, /security definer/);
  assert.match(adminCatalogMigration, /not public\.is_admin\(auth\.uid\(\)\)/);
  assert.match(adminCatalogMigration, /from public\.payment_provider_variants/);
  assert.match(adminCatalogMigration, /insert into public\.payment_provider_variants/);
  assert.match(adminHtml, /data-panel="products"/);
  assert.match(adminHtml, /data-panel="prices"/);
  assert.match(adminHtml, /src="\/assets\/admin\.js"/);
  assert.doesNotMatch(adminScript, /\.innerHTML\s*=|insertAdjacentHTML|outerHTML\s*=/);
  assert.doesNotMatch(`${adminHtml}\n${adminScript}`, /SUPABASE_SECRET_KEY|service_role|sb_secret_/);
});

test('all referenced local assets exist', () => {
  const references = [...`${html}\n${productHtml}\n${adminHtml}`.matchAll(/(?:src|href)="\/?(assets\/[^"]+)"/g)].map((match) => match[1]);
  for (const reference of references) {
    const assetPath = reference.split(/[?#]/, 1)[0];
    assert.equal(fs.existsSync(path.join(root, 'frontend', assetPath)), true, reference);
  }
});
