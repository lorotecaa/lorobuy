import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../src/config.mjs';
import {
  buildLemonSqueezyCheckoutBody,
  buildLemonSqueezyDiscountBody,
  parseLemonSqueezyWebhook,
  verifyLemonSqueezySignature,
} from '../src/payments.mjs';
import { buildContentSecurityPolicy } from '../src/security.mjs';
import {
  assertHighDefinitionDimensions,
  inspectMp4Delivery,
  MAX_STOREFRONT_VIDEO_BYTES,
  readMp4Dimensions,
} from '../scripts/video-quality.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(root, 'frontend', 'index.html'), 'utf8');
const productHtml = fs.readFileSync(path.join(root, 'frontend', 'product.html'), 'utf8');
const packsCollectionHtml = fs.readFileSync(path.join(root, 'frontend', 'collection-packs.html'), 'utf8');
const packsCollectionScript = fs.readFileSync(path.join(root, 'frontend', 'assets', 'collection-packs.js'), 'utf8');
const adminHtml = fs.readFileSync(path.join(root, 'frontend', 'admin.html'), 'utf8');
const adminScript = fs.readFileSync(path.join(root, 'frontend', 'assets', 'admin.js'), 'utf8');
const authConfirmHtml = fs.readFileSync(path.join(root, 'frontend', 'auth-confirm.html'), 'utf8');
const builtHtml = fs.readFileSync(path.join(root, 'dist', 'index.html'), 'utf8');
const builtProductHtml = fs.readFileSync(path.join(root, 'dist', 'product.html'), 'utf8');
const builtPacksCollectionHtml = fs.readFileSync(path.join(root, 'dist', 'collection-packs.html'), 'utf8');
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
const adminUsersMigration = fs.readFileSync(path.join(root, 'supabase', 'migrations', '202610040003_admin_users.sql'), 'utf8');
const productMediaMigration = fs.readFileSync(path.join(root, 'supabase', 'migrations', '202610050001_product_media_gallery.sql'), 'utf8');
const sharedMediaMigration = fs.readFileSync(path.join(root, 'supabase', 'migrations', '202610060001_shared_product_media.sql'), 'utf8');
const welcomeDiscountMigration = fs.readFileSync(path.join(root, 'supabase', 'migrations', '202610060003_newsletter_welcome_discounts.sql'), 'utf8');
const adminOrderActionsMigration = fs.readFileSync(path.join(root, 'supabase', 'migrations', '202610060002_admin_order_actions.sql'), 'utf8');
const categoryVideosMigration = fs.readFileSync(path.join(root, 'supabase', 'migrations', '202610060004_category_videos.sql'), 'utf8');
const unlimitedMediaMigration = fs.readFileSync(path.join(root, 'supabase', 'migrations', '202610060005_unlimited_direct_media_uploads.sql'), 'utf8');

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
    discountCode: 'LORO10ABC123',
  });
  assert.equal(body.data.attributes.custom_price, 13900);
  assert.equal(body.data.attributes.checkout_options.embed, false);
  assert.equal(body.data.attributes.checkout_options.discount, true);
  assert.equal(body.data.attributes.checkout_data.discount_code, 'LORO10ABC123');
  assert.equal(body.data.relationships.variant.data.id, '9876');
  assert.match(body.data.attributes.product_options.redirect_url, /^https:\/\/lorobuy\.onrender\.com\/products\//);

  const discountBody = buildLemonSqueezyDiscountBody(config, {
    name: 'Bienvenida LoroBuy TEST',
    code: 'LORO10ABC123',
  });
  assert.equal(discountBody.data.attributes.amount, 10);
  assert.equal(discountBody.data.attributes.amount_type, 'percent');
  assert.equal(discountBody.data.attributes.is_limited_redemptions, true);
  assert.equal(discountBody.data.attributes.max_redemptions, 1);
  assert.equal(discountBody.data.attributes.test_mode, true);

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
  assert.match(productHtml, /function renderGallery\(item,imageUrl\)/);
  assert.match(productHtml, /Array\.isArray\(item\.media\)/);
  assert.match(productHtml, /product-media/);
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

test('welcome offer creates a real single-use Lemon Squeezy discount and applies it at checkout', () => {
  assert.match(welcomeDiscountMigration, /add column if not exists discount_code text/);
  assert.match(welcomeDiscountMigration, /newsletter_subscriptions_discount_code_key/);
  assert.match(paymentsSource, /createLemonSqueezyDiscount/);
  assert.match(paymentsSource, /is_limited_redemptions: true/);
  assert.match(server, /issueWelcomeDiscount\(email\)/);
  assert.match(server, /discountCode,/);
  assert.match(html, /data-discount-result/);
  assert.match(html, /lorobuy-welcome-discount-v1/);
  assert.match(productHtml, /discountCode:savedDiscountCode\(\)/);
  assert.match(packsCollectionScript, /discountCode: savedDiscountCode\(\)/);
});

test('packs CTA opens a complete Supabase-backed collection page', () => {
  assert.match(html, /href="\/collections\/packs-completos">Ver packs completos<\/a>/i);
  assert.match(html, /class="view-all" href="\/collections\/packs-completos"/);
  assert.match(server, /app\.get\('\/collections\/packs-completos'/);
  assert.match(packsCollectionHtml, /id="productos"/);
  assert.match(packsCollectionHtml, /data-filter="mega"/);
  assert.match(packsCollectionHtml, /data-filter="battle"/);
  assert.match(packsCollectionHtml, /id="collectionSort"/);
  assert.match(packsCollectionScript, /fetch\('\/api\/products'/);
  assert.match(packsCollectionScript, /product\.category\?\.slug === 'packs-completos'/);
  assert.match(packsCollectionScript, /fetch\('\/api\/cart\/items'/);
  assert.match(packsCollectionScript, /method: 'DELETE'/);
  assert.match(packsCollectionScript, /fetch\('\/api\/checkout'/);
  assert.match(packsCollectionHtml, /class="newest-video"/);
  assert.match(packsCollectionScript, /Array\.isArray\(product\?\.media\)/);
  assert.match(packsCollectionScript, /function createSequentialPlayer/);
  assert.match(packsCollectionScript, /video\.addEventListener\('ended', handleEnded\)/);
  assert.match(packsCollectionScript, /renderNewest\(ordered\[0\]\)/);
  assert.match(packsCollectionScript, /video\.crossOrigin = 'anonymous'/);
  assert.match(packsCollectionScript, /video\.addEventListener\('loadeddata', handleReady\)/);
  assert.doesNotMatch(packsCollectionScript, /\.innerHTML\s*=|insertAdjacentHTML|outerHTML\s*=/);
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
  const heroPath = path.join(root, 'frontend', 'assets', 'hero.mp4');
  const nordicPath = path.join(root, 'frontend', 'assets', 'previews', 'mega-pack-dioses-nordicos.mp4');
  const dimensions = await readMp4Dimensions(heroPath);
  const nordicPreview = await readMp4Dimensions(nordicPath);
  const heroDelivery = await inspectMp4Delivery(heroPath);
  const nordicDelivery = await inspectMp4Delivery(nordicPath);
  assert.deepEqual(dimensions, { width: 1920, height: 1080 });
  assert.deepEqual(nordicPreview, { width: 606, height: 1080 });
  assert.equal(heroDelivery.fastStart, true);
  assert.equal(nordicDelivery.fastStart, true);
  assert.ok(heroDelivery.byteSize <= MAX_STOREFRONT_VIDEO_BYTES);
  assert.ok(nordicDelivery.byteSize <= MAX_STOREFRONT_VIDEO_BYTES);
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
  assert.equal(builtPacksCollectionHtml, packsCollectionHtml);
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
  const browserSource = `${html}\n${productHtml}\n${packsCollectionHtml}\n${packsCollectionScript}\n${adminHtml}\n${adminScript}\n${authConfirmHtml}`;
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
  assert.match(productMediaMigration, /alter table public\.product_media enable row level security;/);
});

test('every product has an administrator-managed image and video gallery', () => {
  assert.match(productMediaMigration, /create table public\.product_media/);
  assert.match(productMediaMigration, /create policy product_media_public_select/);
  assert.match(productMediaMigration, /create policy product_media_admin_all/);
  assert.match(productMediaMigration, /'product-media'/);
  assert.match(productMediaMigration, /file_size_limit = excluded\.file_size_limit/);
  assert.match(sharedMediaMigration, /drop constraint if exists product_media_storage_path_key/);
  assert.match(sharedMediaMigration, /product_media_storage_path_idx/);
  assert.equal(packageJson.dependencies['ffmpeg-static'], undefined);
  assert.match(server, /createSignedUploadUrl/);
  assert.match(server, /verifiedStorageByteSize/);
  assert.match(server, /media\/upload-intent/);
  assert.match(server, /media\/complete/);
  assert.doesNotMatch(server, /MAX_PRODUCT_MEDIA_BYTES|optimizeUploadedVideo/);
  assert.match(unlimitedMediaMigration, /set file_size_limit = null/);
  assert.match(unlimitedMediaMigration, /check \(byte_size is null or byte_size >= 0\)/);
  assert.match(server, /product_media_reference_check_failed/);
  assert.match(server, /app\.get\('\/api\/admin\/products\/:productId\/media'/);
  assert.match(server, /app\.post\('\/api\/admin\/products\/:productId\/media\/upload-intent'/);
  assert.match(server, /app\.post\('\/api\/admin\/products\/:productId\/media\/complete'/);
  assert.match(server, /app\.patch\('\/api\/admin\/products\/:productId\/media\/:mediaId'/);
  assert.match(server, /app\.delete\('\/api\/admin\/products\/:productId\/media\/:mediaId'/);
  assert.match(adminScript, /dataset\.media = product\.id/);
  assert.match(adminScript, /state\.mediaCover = data\.product\.coverMediaId \? null : \{/);
  assert.match(adminScript, /isPublicCover: item\.id === data\.product\.coverMediaId/);
  assert.match(adminScript, /Imagen · portada/);
  assert.match(adminScript, /image\/jpeg,image\/png,image\/webp,image\/gif/);
  assert.match(adminScript, /uploadSelectedMedia/);
  assert.match(adminScript, /uploadMediaDirectly/);
  assert.doesNotMatch(adminScript, /100 \* 1024 \* 1024/);
  assert.match(adminHtml, /assets\/ffmpeg\/ffmpeg\.js\?v=0\.12\.15/);
  assert.match(adminHtml, /admin\.js\?v=20261007-ffmpeg-4/);
  assert.match(server, /path\.basename\(filePath\) === 'admin\.js'/);
  assert.match(adminScript, /SAFE_STORAGE_FILE_BYTES = 46_000_000/);
  assert.match(adminScript, /optimizeLargeVideo/);
  assert.match(adminScript, /window\.FFmpegWASM\.FFmpeg/);
  assert.match(adminScript, /ffmpeg\.ffprobe/);
  assert.match(adminScript, /'libx264'/);
  assert.match(adminScript, /optimizeLargeImage/);
  assert.match(adminScript, /prepareFileForStorage/);
  assert.equal(packageJson.dependencies['@ffmpeg/ffmpeg'], '0.12.15');
  assert.equal(packageJson.dependencies['@ffmpeg/core'], '0.12.10');
  assert.equal(fs.existsSync(path.join(root, 'dist', 'assets', 'ffmpeg', 'ffmpeg-core.wasm')), true);
  assert.match(adminScript, /moveMedia/);
  assert.match(adminScript, /removeMedia/);
  assert.match(server, /const primaryImage = media\.find\(\(item\) => item\.type === 'image'\)/);
  assert.match(server, /imagePath: storefrontImage/);
  assert.equal((server.match(/response\.set\('Cache-Control', 'no-store, max-age=0'\);/g) ?? []).length >= 2, true);
});

test('category videos are administrator-managed and drive public storefront sections', () => {
  assert.match(categoryVideosMigration, /create table public\.category_media/);
  assert.match(categoryVideosMigration, /alter table public\.category_media enable row level security/);
  assert.match(categoryVideosMigration, /create policy category_media_public_select/);
  assert.match(categoryVideosMigration, /create policy category_media_admin_all/);
  assert.match(categoryVideosMigration, /assets\/hero\.mp4/);
  assert.match(server, /app\.get\('\/api\/categories\/:slug\/media'/);
  assert.match(server, /app\.get\('\/api\/admin\/categories\/:categoryId\/media'/);
  assert.match(server, /app\.post\('\/api\/admin\/categories\/:categoryId\/media\/upload-intent'/);
  assert.match(server, /app\.post\('\/api\/admin\/categories\/:categoryId\/media\/complete'/);
  assert.match(adminScript, /dataset\.categoryMedia = category\.id/);
  assert.match(adminScript, /makeCategoryMediaPrimary/);
  assert.match(adminScript, /uploadSelectedCategoryMedia/);
  assert.match(html, /id="homeHeroVideo"/);
  assert.match(html, /loadCategoryHero\(\)/);
  assert.match(packsCollectionScript, /categoryMediaResponse/);
  assert.match(packsCollectionScript, /renderShowcase\(ordered, state\.categoryMedia\)/);
  assert.match(packsCollectionScript, /categoryMedia\[index\] \?\? productVideoSources\(product\)\[0\]/);
  assert.match(html, /id="homeHeroVideo"[^>]+preload="auto"/);
  assert.match(html, /id="homeHeroVideo"[^>]+crossorigin="anonymous"/);
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
  assert.match(adminHtml, /src="\/assets\/admin\.js(?:\?[^\"]+)?"/);
  assert.doesNotMatch(adminScript, /\.innerHTML\s*=|insertAdjacentHTML|outerHTML\s*=/);
  assert.doesNotMatch(`${adminHtml}\n${adminScript}`, /SUPABASE_SECRET_KEY|service_role|sb_secret_/);
});

test('admin categories manage the existing taxonomy without destructive deletion', () => {
  assert.match(server, /app\.post\('\/api\/admin\/categories'/);
  assert.match(server, /app\.patch\('\/api\/admin\/categories\/:categoryId'/);
  assert.match(server, /app\.delete\('\/api\/admin\/categories\/:categoryId'/);
  assert.match(server, /\.from\('categories'\)\s*\n\s*\.update\(\{ is_active: false \}\)/);
  assert.doesNotMatch(server, /\.from\('categories'\)\s*\n\s*\.delete\(\)/);
  assert.match(adminScript, /initializeCategoriesInterface/);
  assert.match(adminScript, /dataset\.categoryProducts/);
  assert.match(adminScript, /dataset\.categoryEdit/);
  assert.match(adminScript, /dataset\.categoryDeactivate/);
  assert.match(adminScript, /dataset\.categoryActivate/);
  assert.match(adminScript, /renderCategories/);
  assert.doesNotMatch(adminScript, /\.innerHTML\s*=|insertAdjacentHTML|outerHTML\s*=/);
});

test('admin users combine Supabase Auth with protected profile role management', () => {
  assert.match(server, /app\.get\('\/api\/admin\/users'/);
  assert.match(server, /app\.patch\('\/api\/admin\/users\/:userId'/);
  assert.match(server, /\/auth\/v1\/admin\/users\?page=/);
  assert.match(server, /Authorization: `Bearer \$\{config\.supabaseSecretKey\}`/);
  assert.match(server, /\.rpc\('admin_update_user_profile'/);
  assert.match(adminUsersMigration, /security definer/);
  assert.match(adminUsersMigration, /not public\.is_admin\(auth\.uid\(\)\)/);
  assert.match(adminUsersMigration, /target_email = 'loroteca98@gmail\.com'/);
  assert.match(adminUsersMigration, /target_confirmed_at is null/);
  assert.match(adminScript, /data\.users/);
  assert.match(adminScript, /data-edit-user/);
});

test('admin orders expose payment history and tightly scoped unpaid-order actions', () => {
  assert.match(server, /app\.get\('\/api\/admin\/orders'/);
  assert.match(server, /\.from\('orders'\)/);
  assert.match(server, /payment_attempts\(id,provider,status/);
  assert.match(server, /payment_events\(id,provider,event_type/);
  assert.match(server, /registeredTotalCents/);
  assert.match(server, /app\.post\('\/api\/admin\/orders\/:orderId\/cancel'/);
  assert.match(server, /app\.delete\('\/api\/admin\/orders\/:orderId'/);
  assert.match(server, /\.rpc\('admin_cancel_order'/);
  assert.match(server, /\.rpc\('admin_delete_test_order'/);
  assert.match(adminOrderActionsMigration, /created_at > now\(\) - interval '35 minutes'/);
  assert.match(adminOrderActionsMigration, /selected_order\.status <> 'cancelled'/);
  assert.match(adminOrderActionsMigration, /test_mode = false or status = 'paid' or external_order_id is not null/);
  assert.match(adminOrderActionsMigration, /not public\.is_admin\(auth\.uid\(\)\)/);
  assert.match(adminScript, /initializeOrdersInterface/);
  assert.match(adminScript, /data-order-detail/);
  assert.match(adminScript, /Webhook validado/);
  assert.match(adminScript, /Modo prueba/);
  assert.match(adminScript, /dataset\.orderCancel/);
  assert.match(adminScript, /dataset\.orderDelete/);
  assert.doesNotMatch(adminScript, /\.innerHTML\s*=|insertAdjacentHTML|outerHTML\s*=/);
});

test('all referenced local assets exist', () => {
  const references = [...`${html}\n${productHtml}\n${packsCollectionHtml}\n${adminHtml}`.matchAll(/(?:src|href)="\/?(assets\/[^"]+)"/g)].map((match) => match[1]);
  for (const reference of references) {
    const assetPath = reference.split(/[?#]/, 1)[0];
    const assetRoot = assetPath.startsWith('assets/ffmpeg/') ? 'dist' : 'frontend';
    assert.equal(fs.existsSync(path.join(root, assetRoot, assetPath)), true, reference);
  }
});
