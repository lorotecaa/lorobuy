import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import express from 'express';
import ffmpegPath from 'ffmpeg-static';
import helmet from 'helmet';
import {
  clearSessionCookies,
  getRequestSession,
  getSessionProfile,
  requireAdmin,
  revokeRequestSession,
  setSessionCookies,
} from './auth.mjs';
import { loadConfig } from './config.mjs';
import {
  createLemonSqueezyCheckout,
  parseLemonSqueezyWebhook,
  verifyLemonSqueezySignature,
} from './payments.mjs';
import { buildContentSecurityPolicy, requireSameOrigin } from './security.mjs';
import { createAdminSupabase, createPublicSupabase, createUserSupabase } from './supabase.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');
const FRONTEND_BUILD_DIR = path.join(ROOT_DIR, 'dist');
const ASSET_DIR = path.join(FRONTEND_BUILD_DIR, 'assets');
const INDEX_FILE = path.join(FRONTEND_BUILD_DIR, 'index.html');
const PRODUCT_FILE = path.join(FRONTEND_BUILD_DIR, 'product.html');
const ADMIN_FILE = path.join(FRONTEND_BUILD_DIR, 'admin.html');
const AUTH_CONFIRM_FILE = path.join(FRONTEND_BUILD_DIR, 'auth-confirm.html');
if (!fs.existsSync(INDEX_FILE) || !fs.existsSync(PRODUCT_FILE) || !fs.existsSync(ADMIN_FILE) || !fs.existsSync(AUTH_CONFIRM_FILE) || !fs.existsSync(ASSET_DIR)) {
  throw new Error('Frontend build is missing. Run `npm run build` before starting LoroBuy.');
}
const storefrontHtml = fs.readFileSync(INDEX_FILE, 'utf8');
const productHtml = fs.readFileSync(PRODUCT_FILE, 'utf8');
const adminHtml = fs.readFileSync(ADMIN_FILE, 'utf8');
const authConfirmHtml = fs.readFileSync(AUTH_CONFIRM_FILE, 'utf8');
const config = loadConfig();
const contentSecurityPolicy = buildContentSecurityPolicy(storefrontHtml, {
  mediaSources: [config.supabaseUrl],
});
const productContentSecurityPolicy = buildContentSecurityPolicy(productHtml, {
  imageSources: [config.supabaseUrl],
  mediaSources: [config.supabaseUrl],
});
const adminContentSecurityPolicy = buildContentSecurityPolicy(adminHtml, {
  allowSameOriginScripts: true,
  allowSameOriginStyles: true,
  imageSources: [config.supabaseUrl],
  mediaSources: [config.supabaseUrl],
});
const authConfirmContentSecurityPolicy = buildContentSecurityPolicy(authConfirmHtml);
const publicSupabase = createPublicSupabase(config);
const adminSupabase = createAdminSupabase(config);
const app = express();

app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: { policy: 'require-corp' },
  crossOriginOpenerPolicy: { policy: 'same-origin' },
  crossOriginResourcePolicy: { policy: 'same-origin' },
  hsts: config.nodeEnv === 'production' ? { maxAge: 63_072_000, includeSubDomains: true } : false,
  referrerPolicy: { policy: 'no-referrer' },
  xFrameOptions: { action: 'deny' },
}));
app.use((request, response, next) => {
  const pageContentSecurityPolicy = request.path === '/admin'
    ? adminContentSecurityPolicy
    : request.path === '/auth/confirm'
      ? authConfirmContentSecurityPolicy
      : request.path.startsWith('/products/')
        ? productContentSecurityPolicy
        : contentSecurityPolicy;
  response.set({
    'Content-Security-Policy': pageContentSecurityPolicy,
    'Permissions-Policy': 'accelerometer=(), autoplay=(self), browsing-topics=(), camera=(), clipboard-read=(), clipboard-write=(), fullscreen=(self), gamepad=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), midi=(), payment=(), publickey-credentials-create=(), publickey-credentials-get=(), screen-wake-lock=(), usb=(), xr-spatial-tracking=()',
    'X-DNS-Prefetch-Control': 'off',
    'X-Permitted-Cross-Domain-Policies': 'none',
    'X-Robots-Tag': 'noindex, nofollow, noarchive, nosnippet, noimageindex',
  });
  next();
});

app.post('/api/webhooks/lemon-squeezy', express.raw({ type: 'application/json', limit: '64kb' }), asyncRoute(async (request, response) => {
  if (!config.paymentsConfigured || !adminSupabase) {
    return response.status(503).json({ error: 'El sistema de pagos no está configurado.' });
  }

  const signature = request.get('x-signature') ?? '';
  if (!verifyLemonSqueezySignature(request.body, signature, config.lemonSqueezyWebhookSecret)) {
    return response.status(401).json({ error: 'Firma no válida.' });
  }

  let event;
  try {
    event = parseLemonSqueezyWebhook(request.body, request.get('x-event-name') ?? '');
  } catch {
    return response.status(400).json({ error: 'Webhook no válido.' });
  }

  if (event.eventName !== 'order_created') {
    return response.json({ received: true, ignored: true });
  }

  const attributes = event.payload.data.attributes;
  const custom = event.payload.meta?.custom_data;
  const orderId = custom?.order_id;
  const attemptToken = custom?.payment_attempt_token;
  const variantId = attributes.first_order_item?.variant_id;
  const subtotalCents = Number(attributes.subtotal);
  const testMode = attributes.test_mode === true;
  const matchesExpectedOrder = isUuid(orderId)
    && isUuid(attemptToken)
    && String(attributes.store_id) === String(config.lemonSqueezyStoreId)
    && attributes.status === 'paid'
    && typeof attributes.currency === 'string'
    && Number.isInteger(subtotalCents)
    && subtotalCents > 0
    && variantId !== undefined
    && typeof attributes.user_email === 'string'
    && testMode === config.lemonSqueezyTestMode;
  if (!matchesExpectedOrder) {
    return response.status(400).json({ error: 'El pago no coincide con un pedido válido.' });
  }

  const { data, error } = await adminSupabase.rpc('complete_payment_order', {
    p_order_id: orderId,
    p_attempt_token: attemptToken,
    p_event_key: event.eventKey,
    p_event_type: event.eventName,
    p_provider_object_id: String(event.payload.data.id),
    p_external_order_id: String(event.payload.data.id),
    p_payload_sha256: event.payloadSha256,
    p_provider_variant_id: String(variantId),
    p_currency: attributes.currency,
    p_subtotal_cents: subtotalCents,
    p_customer_email: attributes.user_email,
    p_test_mode: testMode,
  });
  if (error) throw new Error(`Unable to complete verified payment: ${error.code ?? 'database_error'}`);

  response.set('Cache-Control', 'no-store');
  return response.json({ received: true, result: data });
}));

app.use(express.json({ limit: '16kb', strict: true }));
app.use(express.urlencoded({ extended: false, limit: '8kb', parameterLimit: 20 }));
app.use('/api', requireSameOrigin(config));

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const IMAGE_PATTERN = /^assets\/[a-z0-9-]+\.(?:webp|png|jpe?g)$/i;
const LOCAL_MEDIA_PATTERN = /^assets\/(?:previews\/)?[a-z0-9-]+\.(?:mp4|webm|webp|png|jpe?g|gif)$/i;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 6;
const PRIMARY_ADMIN_EMAIL = 'loroteca98@gmail.com';
const MEDIA_ASSET_VERSION = '20261005-stream-1';
const MAX_PRODUCT_MEDIA_BYTES = 100 * 1024 * 1024;
const MAX_OPTIMIZED_VIDEO_BYTES = 30 * 1024 * 1024;
const PRODUCT_MEDIA_MIME_TYPES = new Map([
  ['image/jpeg', { type: 'image', extension: 'jpg' }],
  ['image/png', { type: 'image', extension: 'png' }],
  ['image/webp', { type: 'image', extension: 'webp' }],
  ['image/gif', { type: 'image', extension: 'gif' }],
  ['video/mp4', { type: 'video', extension: 'mp4' }],
  ['video/webm', { type: 'video', extension: 'webm' }],
  ['video/quicktime', { type: 'video', extension: 'mov' }],
]);

function asyncRoute(handler) {
  return (request, response, next) => Promise.resolve(handler(request, response, next)).catch(next);
}

const adminOnly = asyncRoute(async (request, response, next) => {
  const session = await requireAdmin(request, response, config);
  if (!session) {
    response.status(403).json({ error: 'Autorización administrativa requerida.' });
    return;
  }
  request.adminSession = session;
  next();
});

function isUuid(value) {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

function integerInRange(value, minimum, maximum) {
  const number = Number(value);
  return Number.isInteger(number) && number >= minimum && number <= maximum ? number : null;
}

function normalizeText(value, maximumLength, { required = false } = {}) {
  if (typeof value !== 'string') return required ? null : '';
  const normalized = value.trim();
  if ((required && !normalized) || normalized.length > maximumLength) return null;
  return normalized;
}

function publicSignupError(error) {
  const code = typeof error?.code === 'string' ? error.code : '';
  const status = Number(error?.status);
  if (status === 429 || code === 'over_email_send_rate_limit' || code === 'over_request_rate_limit') {
    return {
      status: 429,
      message: 'Supabase alcanzó temporalmente el límite de correos. Espera antes de volver a intentarlo.',
    };
  }
  if (code === 'weak_password') {
    return {
      status: 400,
      message: `La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.`,
    };
  }
  if (code === 'signup_disabled') {
    return { status: 403, message: 'El registro de nuevas cuentas está desactivado temporalmente.' };
  }
  if (code === 'email_address_not_authorized') {
    return { status: 503, message: 'El servicio de correo todavía no está configurado para esta dirección.' };
  }
  if (status >= 500 || code === 'unexpected_failure') {
    return { status: 503, message: 'Supabase no pudo preparar la cuenta. Inténtalo nuevamente más tarde.' };
  }
  return { status: 400, message: 'No fue posible crear la cuenta.' };
}

function productMedia(row) {
  const localPath = LOCAL_MEDIA_PATTERN.test(row.source_path ?? '')
    ? `/${row.source_path}?v=${MEDIA_ASSET_VERSION}`
    : null;
  const publicUrl = row.storage_path
    ? publicSupabase.storage.from('product-media').getPublicUrl(row.storage_path).data.publicUrl
    : null;
  return {
    id: row.id,
    type: row.media_type,
    url: localPath ?? publicUrl,
    altText: row.alt_text ?? '',
    sortOrder: row.sort_order,
    byteSize: row.byte_size ?? null,
    mimeType: row.mime_type,
    uploaded: Boolean(row.storage_path),
  };
}

function runFfmpeg(argumentsList) {
  return new Promise((resolve, reject) => {
    if (!ffmpegPath) return reject(new Error('FFmpeg is unavailable.'));
    const process = spawn(ffmpegPath, argumentsList, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    let diagnostics = '';
    const timeout = setTimeout(() => {
      process.kill('SIGKILL');
      reject(new Error('Video optimization timed out.'));
    }, 180_000);
    process.stderr.on('data', (chunk) => {
      diagnostics = `${diagnostics}${chunk}`.slice(-4_000);
    });
    process.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    process.once('close', (code) => {
      clearTimeout(timeout);
      if (code === 0) resolve();
      else reject(new Error(`FFmpeg exited with code ${code}: ${diagnostics}`));
    });
  });
}

async function optimizeUploadedVideo(body, extension) {
  const temporaryDirectory = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'lorobuy-media-'));
  const inputPath = path.join(temporaryDirectory, `input.${extension}`);
  const outputPath = path.join(temporaryDirectory, 'optimized.mp4');
  try {
    await fsPromises.writeFile(inputPath, body, { flag: 'wx' });
    await runFfmpeg([
      '-nostdin', '-hide_banner', '-loglevel', 'error', '-y',
      '-i', inputPath,
      '-map', '0:v:0', '-map', '0:a?',
      '-vf', "scale=w='min(1920,iw)':h='min(1080,ih)':force_original_aspect_ratio=decrease",
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21',
      '-maxrate', '2800k', '-bufsize', '5600k',
      '-g', '60', '-keyint_min', '60', '-sc_threshold', '0',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '96k',
      '-movflags', '+faststart',
      outputPath,
    ]);
    const optimized = await fsPromises.readFile(outputPath);
    if (!optimized.length || optimized.length > MAX_OPTIMIZED_VIDEO_BYTES) {
      throw new Error('Optimized video exceeds the storefront delivery limit.');
    }
    return optimized;
  } finally {
    await fsPromises.rm(temporaryDirectory, { recursive: true, force: true });
  }
}

function publicProduct(row, mediaRows = []) {
  const previewCandidate = `assets/previews/${row.slug}.mp4`;
  const previewThumbnailCandidate = `assets/previews/${row.slug}-thumb.jpg`;
  const previewPath = SLUG_PATTERN.test(row.slug) && fs.existsSync(path.join(FRONTEND_BUILD_DIR, previewCandidate))
    ? previewCandidate
    : 'assets/hero.mp4';
  const imagePath = IMAGE_PATTERN.test(row.image_path) ? row.image_path : 'assets/favicon.png';
  const previewThumbnailPath = SLUG_PATTERN.test(row.slug) && fs.existsSync(path.join(FRONTEND_BUILD_DIR, previewThumbnailCandidate))
    ? previewThumbnailCandidate
    : imagePath;
  const media = mediaRows.map(productMedia).filter((item) => item.url);
  const primaryVideo = media.find((item) => item.type === 'video');
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    imagePath,
    previewPath: primaryVideo?.url ?? `${previewPath}?v=${MEDIA_ASSET_VERSION}`,
    previewThumbnailPath,
    priceCents: row.price_cents,
    compareAtPriceCents: row.compare_at_price_cents,
    currency: row.currency,
    category: {
      slug: row.categories.slug,
      name: row.categories.name,
      sortOrder: row.categories.sort_order,
    },
    sortOrder: row.sort_order,
    media,
  };
}

async function readCart(session) {
  const { data, error } = await session.client
    .from('carts')
    .select('id,status,updated_at,cart_items(quantity,unit_price_cents,currency,products(id,slug,name,image_path,is_active))')
    .eq('user_id', session.user.id)
    .eq('status', 'active')
    .maybeSingle();

  if (error) throw new Error('Unable to read cart from Supabase.');
  if (!data) return { id: null, items: [], itemCount: 0, totalCents: 0, currency: 'USD' };

  const items = (data.cart_items ?? [])
    .filter((item) => item.products?.is_active)
    .map((item) => ({
      productId: item.products.id,
      slug: item.products.slug,
      name: item.products.name,
      imagePath: IMAGE_PATTERN.test(item.products.image_path) ? item.products.image_path : 'assets/favicon.png',
      quantity: item.quantity,
      unitPriceCents: item.unit_price_cents,
      currency: item.currency,
      subtotalCents: item.quantity * item.unit_price_cents,
    }));

  return {
    id: data.id,
    items,
    itemCount: items.reduce((total, item) => total + item.quantity, 0),
    totalCents: items.reduce((total, item) => total + item.subtotalCents, 0),
    currency: items[0]?.currency ?? 'USD',
    updatedAt: data.updated_at,
  };
}

app.get('/api/health', asyncRoute(async (_request, response) => {
  const { count, error } = await publicSupabase
    .from('products')
    .select('id', { count: 'exact', head: true })
    .eq('is_active', true);

  if (error) {
    return response.status(503).json({ status: 'unavailable', database: 'disconnected' });
  }

  response.set('Cache-Control', 'no-store');
  return response.json({ status: 'ok', database: 'connected', activeProducts: count ?? 0 });
}));

app.get('/api/products', asyncRoute(async (_request, response) => {
  const { data, error } = await publicSupabase
    .from('products')
    .select('id,slug,name,description,image_path,price_cents,compare_at_price_cents,currency,sort_order,categories!inner(slug,name,sort_order,is_active)')
    .eq('is_active', true)
    .eq('categories.is_active', true)
    .order('sort_order', { ascending: true });

  if (error) throw new Error('Unable to load products from Supabase.');
  const products = data ?? [];
  const mediaByProduct = new Map();
  const productIds = products.map((product) => product.id);

  if (productIds.length > 0) {
    const { data: mediaRows, error: mediaError } = await publicSupabase
      .from('product_media')
      .select('id,product_id,source_path,storage_path,media_type,mime_type,byte_size,alt_text,sort_order,created_at')
      .in('product_id', productIds)
      .eq('is_active', true)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true });

    if (mediaError) throw new Error('Unable to load product media from Supabase.');
    for (const mediaRow of mediaRows ?? []) {
      const productMedia = mediaByProduct.get(mediaRow.product_id) ?? [];
      productMedia.push(mediaRow);
      mediaByProduct.set(mediaRow.product_id, productMedia);
    }
  }

  response.set('Cache-Control', 'public, max-age=30, s-maxage=60');
  return response.json({
    products: products.map((row) => publicProduct(row, mediaByProduct.get(row.id) ?? [])),
  });
}));

app.get('/api/products/:slug', asyncRoute(async (request, response) => {
  const slug = normalizeText(request.params.slug, 80, { required: true });
  if (!slug || !SLUG_PATTERN.test(slug)) return response.status(404).json({ error: 'Producto no encontrado.' });

  const { data, error } = await publicSupabase
    .from('products')
    .select('id,slug,name,description,image_path,price_cents,compare_at_price_cents,currency,sort_order,categories!inner(slug,name,sort_order,is_active)')
    .eq('slug', slug)
    .eq('is_active', true)
    .eq('categories.is_active', true)
    .limit(1);

  if (error) throw new Error('Unable to load product from Supabase.');
  if (!data?.[0]) return response.status(404).json({ error: 'Producto no encontrado.' });
  const { data: media, error: mediaError } = await publicSupabase
    .from('product_media')
    .select('id,source_path,storage_path,media_type,mime_type,byte_size,alt_text,sort_order')
    .eq('product_id', data[0].id)
    .eq('is_active', true)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });
  if (mediaError) throw new Error('Unable to load product media from Supabase.');
  response.set('Cache-Control', 'public, max-age=30, s-maxage=60');
  return response.json({ product: publicProduct(data[0], media ?? []) });
}));

app.get('/api/auth/session', asyncRoute(async (request, response) => {
  const session = await getRequestSession(request, response, config);
  const signedIn = Boolean(session && !session.user.is_anonymous);
  const profile = signedIn ? await getSessionProfile(session) : null;
  response.set('Cache-Control', 'private, no-store, max-age=0');
  return response.json({
    authenticated: signedIn,
    user: signedIn ? {
      id: session.user.id,
      email: session.user.email ?? null,
      displayName: profile?.display_name ?? null,
      avatarUrl: profile?.avatar_url ?? null,
      role: profile?.role ?? 'customer',
      isAdmin: profile?.role === 'admin' && Boolean(session.user.email_confirmed_at),
    } : null,
  });
}));

app.post('/api/auth/anonymous', asyncRoute(async (request, response) => {
  const session = await getRequestSession(request, response, config, { createAnonymous: true });
  return response.status(201).json({
    authenticated: true,
    user: { id: session.user.id, isAnonymous: Boolean(session.user.is_anonymous) },
  });
}));

app.post('/api/auth/signup', asyncRoute(async (request, response) => {
  const displayName = normalizeText(request.body?.displayName, 100, { required: true });
  const email = normalizeText(request.body?.email, 254, { required: true })?.toLowerCase();
  const password = normalizeText(request.body?.password, 128, { required: true });
  if (!displayName || !email || !EMAIL_PATTERN.test(email) || !password || password.length < MIN_PASSWORD_LENGTH) {
    return response.status(400).json({ error: `Nombre, correo o contraseña no válidos. La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.` });
  }

  const { data, error } = await createPublicSupabase(config).auth.signUp({
    email,
    password,
    options: {
      data: { full_name: displayName },
      emailRedirectTo: `${config.appOrigin}/auth/confirm`,
    },
  });
  if (error) {
    const publicError = publicSignupError(error);
    console.warn(JSON.stringify({
      level: 'warn',
      event: 'auth_signup_failed',
      code: error.code ?? null,
      status: error.status ?? null,
    }));
    return response.status(publicError.status).json({ error: publicError.message });
  }
  if (data.session) setSessionCookies(response, config, data.session);
  return response.status(data.session ? 201 : 202).json({
    created: true,
    confirmationRequired: !data.session,
  });
}));

app.post('/api/auth/resend-confirmation', asyncRoute(async (request, response) => {
  const email = normalizeText(request.body?.email, 254, { required: true })?.toLowerCase();
  if (!email || !EMAIL_PATTERN.test(email)) return response.status(400).json({ error: 'Correo electrónico no válido.' });

  const { error } = await createPublicSupabase(config).auth.resend({
    type: 'signup',
    email,
    options: { emailRedirectTo: `${config.appOrigin}/auth/confirm` },
  });
  if (error && (error.status === 429 || error.code === 'over_email_send_rate_limit' || error.code === 'over_request_rate_limit')) {
    return response.status(429).json({ error: 'Supabase alcanzó temporalmente el límite de correos. Espera antes de solicitar otro.' });
  }
  return response.status(202).json({ accepted: true });
}));

app.post('/api/auth/confirm', asyncRoute(async (request, response) => {
  const refreshToken = normalizeText(request.body?.refreshToken, 4096, { required: true });
  if (!refreshToken) return response.status(400).json({ error: 'El enlace de confirmación no es válido.' });

  const publicClient = createPublicSupabase(config);
  const { data, error } = await publicClient.auth.refreshSession({ refresh_token: refreshToken });
  if (error || !data.session || !data.user?.email_confirmed_at) {
    return response.status(401).json({ error: 'El enlace de confirmación venció o ya no es válido.' });
  }

  const session = {
    user: data.user,
    accessToken: data.session.access_token,
    client: createUserSupabase(config, data.session.access_token),
    session: data.session,
  };
  const profile = await getSessionProfile(session);
  setSessionCookies(response, config, data.session);
  return response.json({ authenticated: true, isAdmin: profile?.role === 'admin' });
}));

app.post('/api/auth/signin', asyncRoute(async (request, response) => {
  const email = normalizeText(request.body?.email, 254, { required: true })?.toLowerCase();
  const password = normalizeText(request.body?.password, 128, { required: true });
  if (!email || !EMAIL_PATTERN.test(email) || !password) {
    return response.status(400).json({ error: 'Credenciales no válidas.' });
  }

  const { data, error } = await createPublicSupabase(config).auth.signInWithPassword({ email, password });
  if (error || !data.session) return response.status(401).json({ error: 'Credenciales no válidas.' });
  setSessionCookies(response, config, data.session);
  return response.json({ authenticated: true });
}));

app.post('/api/auth/signout', asyncRoute(async (request, response) => {
  await revokeRequestSession(request, config);
  clearSessionCookies(response, config);
  return response.status(204).end();
}));

app.patch('/api/profile', asyncRoute(async (request, response) => {
  const session = await getRequestSession(request, response, config);
  if (!session || session.user.is_anonymous) return response.status(401).json({ error: 'Inicia sesión para editar tu perfil.' });

  const displayName = normalizeText(request.body?.displayName, 100, { required: true });
  if (!displayName) return response.status(400).json({ error: 'El nombre debe tener entre 1 y 100 caracteres.' });

  const { data, error } = await session.client
    .from('profiles')
    .update({ display_name: displayName })
    .eq('id', session.user.id)
    .select('id,display_name,avatar_url,role')
    .single();

  if (error) return response.status(400).json({ error: 'No fue posible actualizar el perfil.' });
  response.set('Cache-Control', 'private, no-store, max-age=0');
  return response.json({
    profile: {
      id: data.id,
      displayName: data.display_name,
      avatarUrl: data.avatar_url,
      role: data.role,
      isAdmin: data.role === 'admin' && Boolean(session.user.email_confirmed_at),
    },
  });
}));

app.get('/api/cart', asyncRoute(async (request, response) => {
  const session = await getRequestSession(request, response, config);
  response.set('Cache-Control', 'private, no-store, max-age=0');
  return response.json({ cart: session ? await readCart(session) : { id: null, items: [], itemCount: 0, totalCents: 0, currency: 'USD' } });
}));

app.post('/api/cart/items', asyncRoute(async (request, response) => {
  const productId = request.body?.productId;
  const quantity = integerInRange(request.body?.quantity ?? 1, 1, 10);
  if (!isUuid(productId) || !quantity) return response.status(400).json({ error: 'Producto o cantidad no válidos.' });

  const session = await getRequestSession(request, response, config, { createAnonymous: true });
  const { error } = await session.client.rpc('add_cart_item', {
    p_product_id: productId,
    p_quantity: quantity,
  });
  if (error) return response.status(400).json({ error: 'No fue posible agregar el producto al carrito.' });

  response.set('Cache-Control', 'private, no-store, max-age=0');
  return response.status(201).json({ cart: await readCart(session) });
}));

app.delete('/api/cart/items/:productId', asyncRoute(async (request, response) => {
  if (!isUuid(request.params.productId)) return response.status(400).json({ error: 'Producto no válido.' });
  const session = await getRequestSession(request, response, config);
  if (!session) return response.status(401).json({ error: 'Sesión requerida.' });

  const { error } = await session.client.rpc('remove_cart_item', { p_product_id: request.params.productId });
  if (error) throw new Error('Unable to remove cart item from Supabase.');
  response.set('Cache-Control', 'private, no-store, max-age=0');
  return response.json({ cart: await readCart(session) });
}));

app.post('/api/checkout', asyncRoute(async (request, response) => {
  if (!config.paymentsConfigured || !adminSupabase) {
    return response.status(503).json({ error: 'El pago está temporalmente fuera de servicio.' });
  }

  const productId = request.body?.productId;
  if (!isUuid(productId)) return response.status(400).json({ error: 'Producto no válido.' });

  const session = await getRequestSession(request, response, config, { createAnonymous: true });
  const attemptToken = crypto.randomUUID();
  const { data, error } = await session.client.rpc('create_payment_order', {
    p_product_id: productId,
    p_provider: 'lemon_squeezy',
    p_checkout_token: attemptToken,
    p_test_mode: config.lemonSqueezyTestMode,
  });
  const pendingOrder = Array.isArray(data) ? data[0] : data;
  if (error || !pendingOrder) {
    return response.status(409).json({ error: 'Este producto aún no está disponible para pago.' });
  }

  let profile = null;
  if (!session.user.is_anonymous) profile = await getSessionProfile(session);

  let checkout;
  try {
    checkout = await createLemonSqueezyCheckout(config, {
      orderId: pendingOrder.order_id,
      attemptToken: pendingOrder.attempt_token,
      providerVariantId: pendingOrder.provider_variant_id,
      amountCents: pendingOrder.amount_cents,
      currency: pendingOrder.currency,
      productName: pendingOrder.product_name,
      productSlug: pendingOrder.product_slug,
      email: session.user.is_anonymous ? null : session.user.email,
      name: profile?.display_name ?? null,
    });
  } catch (checkoutError) {
    await adminSupabase
      .from('payment_attempts')
      .update({ status: 'failed' })
      .eq('order_id', pendingOrder.order_id)
      .eq('checkout_token', pendingOrder.attempt_token);
    console.warn(JSON.stringify({
      level: 'warn',
      event: 'checkout_creation_failed',
      orderId: pendingOrder.order_id,
      message: checkoutError?.message ?? 'Unknown checkout error',
    }));
    return response.status(502).json({ error: 'Lemon Squeezy no pudo iniciar el pago. Inténtalo nuevamente.' });
  }

  const { error: registrationError } = await session.client.rpc('register_payment_checkout', {
    p_order_id: pendingOrder.order_id,
    p_checkout_token: pendingOrder.attempt_token,
    p_external_checkout_id: checkout.checkoutId,
  });
  if (registrationError) throw new Error('Unable to register the Lemon Squeezy checkout.');

  response.set('Cache-Control', 'private, no-store, max-age=0');
  return response.status(201).json({
    orderId: pendingOrder.order_id,
    checkoutUrl: checkout.checkoutUrl,
  });
}));

app.get('/api/orders/:orderId', asyncRoute(async (request, response) => {
  if (!isUuid(request.params.orderId)) return response.status(400).json({ error: 'Pedido no válido.' });
  const session = await getRequestSession(request, response, config);
  if (!session) return response.status(401).json({ error: 'La sesión de compra no está disponible.' });

  const { data: order, error } = await session.client
    .from('orders')
    .select('id,status,currency,total_cents,completed_at,order_items(id,product_id,product_name)')
    .eq('id', request.params.orderId)
    .eq('user_id', session.user.id)
    .maybeSingle();
  if (error || !order) return response.status(404).json({ error: 'Pedido no encontrado.' });

  let files = [];
  if (order.status === 'completed') {
    const productIds = [...new Set((order.order_items ?? []).map((item) => item.product_id).filter(Boolean))];
    if (productIds.length > 0) {
      const { data: availableFiles, error: filesError } = await session.client
        .from('product_files')
        .select('id,product_id,download_name,version')
        .in('product_id', productIds)
        .eq('is_active', true)
        .order('version', { ascending: false });
      if (filesError) throw new Error('Unable to load purchased files from Supabase.');
      files = availableFiles ?? [];
    }
  }

  response.set('Cache-Control', 'private, no-store, max-age=0');
  return response.json({
    order: {
      id: order.id,
      status: order.status,
      currency: order.currency,
      totalCents: order.total_cents,
      completedAt: order.completed_at,
      items: order.order_items ?? [],
      files: files.map((file) => ({
        id: file.id,
        productId: file.product_id,
        name: file.download_name,
        version: file.version,
      })),
    },
  });
}));

app.post('/api/newsletter', asyncRoute(async (request, response) => {
  const email = normalizeText(request.body?.email, 254, { required: true })?.toLowerCase();
  if (!email || !EMAIL_PATTERN.test(email)) return response.status(400).json({ error: 'Correo electrónico no válido.' });

  const session = await getRequestSession(request, response, config);
  const client = session?.client ?? publicSupabase;
  const { error } = await client.rpc('subscribe_newsletter', { p_email: email });
  if (error) throw new Error('Unable to save newsletter subscription in Supabase.');
  return response.status(202).json({ accepted: true });
}));

app.post('/api/downloads/:fileId', asyncRoute(async (request, response) => {
  if (!isUuid(request.params.fileId)) return response.status(400).json({ error: 'Archivo no válido.' });
  const session = await getRequestSession(request, response, config);
  if (!session) return response.status(401).json({ error: 'La sesión de compra no está disponible.' });

  const { data: file, error: fileError } = await session.client
    .from('product_files')
    .select('id,product_id,storage_path,download_name,is_active')
    .eq('id', request.params.fileId)
    .eq('is_active', true)
    .maybeSingle();
  if (fileError || !file) return response.status(404).json({ error: 'Archivo no disponible.' });

  const { data: orderItem, error: orderError } = await session.client
    .from('order_items')
    .select('id,orders!inner(user_id,status)')
    .eq('product_id', file.product_id)
    .eq('orders.user_id', session.user.id)
    .eq('orders.status', 'completed')
    .limit(1)
    .maybeSingle();
  if (orderError || !orderItem) return response.status(403).json({ error: 'Esta cuenta no tiene acceso al archivo.' });

  const { data: signed, error: signedError } = await session.client
    .storage
    .from('product-files')
    .createSignedUrl(file.storage_path, 60, { download: file.download_name });
  if (signedError || !signed?.signedUrl) throw new Error('Unable to create a signed download URL.');

  const { error: logError } = await session.client.from('downloads').insert({
    user_id: session.user.id,
    order_item_id: orderItem.id,
    product_file_id: file.id,
  });
  if (logError) throw new Error('Unable to record download in Supabase.');

  response.set('Cache-Control', 'private, no-store, max-age=0');
  return response.json({ url: signed.signedUrl, expiresIn: 60 });
}));

app.post('/api/admin/categories', asyncRoute(async (request, response) => {
  const session = await requireAdmin(request, response, config);
  if (!session) return response.status(403).json({ error: 'Autorización administrativa requerida.' });

  const name = normalizeText(request.body?.name, 100, { required: true });
  const slug = normalizeText(request.body?.slug, 80, { required: true });
  const sortOrder = integerInRange(request.body?.sortOrder ?? 0, 0, 100_000);
  if (!name || !slug || !SLUG_PATTERN.test(slug) || sortOrder === null) {
    return response.status(400).json({ error: 'Datos de categoría no válidos.' });
  }

  const { data, error } = await session.client
    .from('categories')
    .insert({ name, slug, sort_order: sortOrder })
    .select('id,slug,name,sort_order,is_active')
    .single();
  if (error) return response.status(400).json({ error: 'No fue posible crear la categoría.' });
  return response.status(201).json({ category: data });
}));

function adminProduct(row) {
  return {
    id: row.id,
    categoryId: row.category_id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    imagePath: IMAGE_PATTERN.test(row.image_path) ? row.image_path : 'assets/favicon.png',
    priceCents: row.price_cents,
    compareAtPriceCents: row.compare_at_price_cents,
    currency: row.currency,
    sortOrder: row.sort_order,
    isActive: row.is_active,
    updatedAt: row.updated_at,
    category: row.categories ? { id: row.categories.id, name: row.categories.name, slug: row.categories.slug } : null,
  };
}

app.get('/api/admin/catalog', asyncRoute(async (request, response) => {
  const session = await requireAdmin(request, response, config);
  if (!session) return response.status(403).json({ error: 'Autorización administrativa requerida.' });

  const [productsResult, categoriesResult] = await Promise.all([
    session.client
      .from('products')
      .select('id,category_id,slug,name,description,image_path,price_cents,compare_at_price_cents,currency,sort_order,is_active,updated_at,categories(id,slug,name)')
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true }),
    session.client
      .from('categories')
      .select('id,slug,name,sort_order,is_active')
      .order('sort_order', { ascending: true }),
  ]);

  if (productsResult.error || categoriesResult.error) {
    throw new Error('Unable to load the administrative catalog from Supabase.');
  }
  response.set('Cache-Control', 'private, no-store, max-age=0');
  return response.json({
    products: (productsResult.data ?? []).map(adminProduct),
    categories: (categoriesResult.data ?? []).map((category) => ({
      id: category.id,
      slug: category.slug,
      name: category.name,
      sortOrder: category.sort_order,
      isActive: category.is_active,
    })),
  });
}));

function adminOrder(row, authUser) {
  const attempts = [...(Array.isArray(row.payment_attempts) ? row.payment_attempts : [])]
    .sort((left, right) => String(right.created_at ?? '').localeCompare(String(left.created_at ?? '')));
  const events = [...(Array.isArray(row.payment_events) ? row.payment_events : [])]
    .sort((left, right) => String(right.received_at ?? '').localeCompare(String(left.received_at ?? '')));
  const latestAttempt = attempts[0] ?? null;
  const checkoutCreatedAt = latestAttempt?.created_at ? new Date(latestAttempt.created_at).getTime() : Number.NaN;
  const checkoutIsActive = latestAttempt?.status === 'checkout_created'
    && Number.isFinite(checkoutCreatedAt)
    && Date.now() < checkoutCreatedAt + (35 * 60 * 1000);
  const hasPaidAttempt = attempts.some((attempt) => attempt.status === 'paid' || attempt.external_order_id);
  const isUnpaidTestOrder = attempts.length > 0
    && attempts.every((attempt) => attempt.test_mode === true
      && attempt.status !== 'paid' && !attempt.external_order_id);
  const email = row.customer_email ?? authUser?.email?.toLowerCase() ?? null;
  const displayName = authUser?.user_metadata?.full_name ?? authUser?.user_metadata?.name ?? null;
  return {
    id: row.id,
    userId: row.user_id,
    status: row.status,
    currency: row.currency,
    totalCents: row.total_cents,
    customer: {
      email,
      displayName,
      isAnonymous: Boolean(authUser?.is_anonymous),
    },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
    controls: {
      canCancel: ['draft', 'pending'].includes(row.status) && !hasPaidAttempt && !checkoutIsActive,
      canDelete: row.status === 'cancelled' && isUnpaidTestOrder && events.length === 0,
      checkoutActive: checkoutIsActive,
    },
    items: (Array.isArray(row.order_items) ? row.order_items : []).map((item) => ({
      id: item.id,
      productId: item.product_id,
      productName: item.product_name,
      quantity: item.quantity,
      unitPriceCents: item.unit_price_cents,
      subtotalCents: item.subtotal_cents,
      currency: item.currency,
      product: item.products ? {
        slug: item.products.slug,
        imagePath: IMAGE_PATTERN.test(item.products.image_path)
          ? item.products.image_path : 'assets/favicon.png',
      } : null,
    })),
    payment: latestAttempt ? {
      provider: latestAttempt.provider,
      status: latestAttempt.status,
      externalCheckoutId: latestAttempt.external_checkout_id,
      externalOrderId: latestAttempt.external_order_id,
      expectedAmountCents: latestAttempt.expected_amount_cents,
      currency: latestAttempt.currency,
      testMode: latestAttempt.test_mode,
      createdAt: latestAttempt.created_at,
      paidAt: latestAttempt.paid_at,
    } : null,
    events: events.map((event) => ({
      id: event.id,
      provider: event.provider,
      type: event.event_type,
      providerObjectId: event.provider_object_id,
      receivedAt: event.received_at,
      processedAt: event.processed_at,
    })),
  };
}

app.get('/api/admin/orders', asyncRoute(async (request, response) => {
  const session = await requireAdmin(request, response, config);
  if (!session) return response.status(403).json({ error: 'Autorización administrativa requerida.' });
  if (!adminSupabase) return response.status(503).json({ error: 'La gestión de pedidos no está configurada.' });

  const [ordersResult, authUsers] = await Promise.all([
    session.client
      .from('orders')
      .select(`
        id,user_id,status,currency,total_cents,customer_email,created_at,updated_at,completed_at,
        order_items(id,product_id,product_name,quantity,unit_price_cents,subtotal_cents,currency,products(slug,image_path)),
        payment_attempts(id,provider,status,external_checkout_id,external_order_id,expected_amount_cents,currency,test_mode,created_at,updated_at,paid_at),
        payment_events(id,provider,event_type,provider_object_id,received_at,processed_at)
      `)
      .order('created_at', { ascending: false })
      .limit(500),
    readSupabaseAuthUsers(),
  ]);
  if (ordersResult.error) throw new Error('Unable to load orders from Supabase.');

  const users = new Map(authUsers.map((user) => [user.id, user]));
  const orders = (ordersResult.data ?? []).map((order) => adminOrder(order, users.get(order.user_id)));
  const completedOrders = orders.filter((order) => order.status === 'completed');
  const summary = {
    orders: orders.length,
    completed: completedOrders.length,
    pending: orders.filter((order) => order.status === 'pending').length,
    refunded: orders.filter((order) => order.status === 'refunded').length,
    testMode: orders.filter((order) => order.payment?.testMode).length,
    registeredTotalCents: completedOrders.reduce((total, order) => total + Number(order.totalCents || 0), 0),
    currency: completedOrders[0]?.currency ?? 'USD',
  };
  response.set('Cache-Control', 'private, no-store, max-age=0');
  return response.json({ orders, summary, limit: 500 });
}));

app.post('/api/admin/orders/:orderId/cancel', asyncRoute(async (request, response) => {
  if (!isUuid(request.params.orderId)) return response.status(400).json({ error: 'Pedido no válido.' });
  const session = await requireAdmin(request, response, config);
  if (!session) return response.status(403).json({ error: 'Autorización administrativa requerida.' });

  const { data, error } = await session.client.rpc('admin_cancel_order', {
    p_order_id: request.params.orderId,
  });
  if (error) {
    const message = String(error.message ?? '');
    if (message.includes('checkout is still active')) {
      return response.status(409).json({ error: 'El checkout todavía está activo. Podrás cancelarlo 35 minutos después de crearlo.' });
    }
    if (message.includes('paid orders') || message.includes('only unpaid orders')) {
      return response.status(409).json({ error: 'Solo se pueden cancelar pedidos pendientes que no tengan un pago.' });
    }
    return response.status(404).json({ error: 'El pedido no existe o ya no puede cancelarse.' });
  }
  response.set('Cache-Control', 'private, no-store, max-age=0');
  return response.json({ orderId: request.params.orderId, status: data ?? 'cancelled' });
}));

app.delete('/api/admin/orders/:orderId', asyncRoute(async (request, response) => {
  if (!isUuid(request.params.orderId)) return response.status(400).json({ error: 'Pedido no válido.' });
  const session = await requireAdmin(request, response, config);
  if (!session) return response.status(403).json({ error: 'Autorización administrativa requerida.' });

  const { data, error } = await session.client.rpc('admin_delete_test_order', {
    p_order_id: request.params.orderId,
  });
  if (error) {
    const message = String(error.message ?? '');
    if (message.includes('must be cancelled first')) {
      return response.status(409).json({ error: 'Primero debes cancelar el pedido.' });
    }
    if (message.includes('only unpaid test orders') || message.includes('payment events')) {
      return response.status(409).json({ error: 'Solo se pueden eliminar pedidos de prueba cancelados y sin ningún pago.' });
    }
    return response.status(404).json({ error: 'El pedido no existe o no puede eliminarse.' });
  }
  response.set('Cache-Control', 'private, no-store, max-age=0');
  return response.json({ orderId: request.params.orderId, result: data ?? 'deleted' });
}));

function validatedProductPayload(body, { partial = false } = {}) {
  const payload = {};
  const required = !partial;
  const fields = ['name', 'slug', 'description', 'imagePath', 'currency', 'categoryId', 'priceCents', 'compareAtPriceCents', 'sortOrder', 'isActive'];
  const has = (field) => Object.hasOwn(body ?? {}, field);

  if (required || has('name')) {
    payload.name = normalizeText(body?.name, 180, { required: true });
    if (!payload.name) return null;
  }
  if (required || has('slug')) {
    payload.slug = normalizeText(body?.slug, 120, { required: true });
    if (!payload.slug || !SLUG_PATTERN.test(payload.slug)) return null;
  }
  if (has('description')) {
    payload.description = normalizeText(body.description, 2_000) || null;
  }
  if (required || has('imagePath')) {
    payload.image_path = normalizeText(body?.imagePath, 255, { required: true });
    if (!payload.image_path || !IMAGE_PATTERN.test(payload.image_path)
        || !fs.existsSync(path.join(FRONTEND_BUILD_DIR, payload.image_path))) return null;
  }
  if (required || has('currency')) {
    payload.currency = normalizeText(body?.currency ?? 'USD', 3, { required: true })?.toUpperCase();
    if (payload.currency !== 'USD') return null;
  }
  if (required || has('categoryId')) {
    if (!isUuid(body?.categoryId)) return null;
    payload.category_id = body.categoryId;
  }
  if (required || has('priceCents')) {
    payload.price_cents = integerInRange(body?.priceCents, 50, 100_000_000);
    if (payload.price_cents === null) return null;
  }
  if (has('compareAtPriceCents')) {
    payload.compare_at_price_cents = body.compareAtPriceCents === null
      ? null
      : integerInRange(body.compareAtPriceCents, 0, 100_000_000);
    if (payload.compare_at_price_cents === null && body.compareAtPriceCents !== null) return null;
  }
  if (has('sortOrder') || required) {
    payload.sort_order = integerInRange(body?.sortOrder ?? 0, 0, 100_000);
    if (payload.sort_order === null) return null;
  }
  if (has('isActive')) {
    if (typeof body.isActive !== 'boolean') return null;
    payload.is_active = body.isActive;
  }
  if (partial && fields.every((field) => !has(field))) return null;
  if (payload.compare_at_price_cents !== undefined && payload.price_cents !== undefined
      && payload.compare_at_price_cents !== null && payload.compare_at_price_cents < payload.price_cents) return null;
  return payload;
}

app.post('/api/admin/products', asyncRoute(async (request, response) => {
  const session = await requireAdmin(request, response, config);
  if (!session) return response.status(403).json({ error: 'Autorización administrativa requerida.' });
  const payload = validatedProductPayload(request.body);
  if (!payload) return response.status(400).json({ error: 'Datos de producto no válidos.' });

  const { data, error } = await session.client.rpc('admin_create_product', {
    p_category_id: payload.category_id,
    p_slug: payload.slug,
    p_name: payload.name,
    p_description: payload.description ?? null,
    p_image_path: payload.image_path,
    p_price_cents: payload.price_cents,
    p_compare_at_price_cents: payload.compare_at_price_cents ?? null,
    p_currency: payload.currency,
    p_sort_order: payload.sort_order,
    p_is_active: payload.is_active ?? true,
  }).single();
  if (error) return response.status(400).json({ error: 'No fue posible crear el producto.' });
  return response.status(201).json({ product: adminProduct(data) });
}));

app.patch('/api/admin/products/:productId', asyncRoute(async (request, response) => {
  if (!isUuid(request.params.productId)) return response.status(400).json({ error: 'Producto no válido.' });
  const session = await requireAdmin(request, response, config);
  if (!session) return response.status(403).json({ error: 'Autorización administrativa requerida.' });
  const payload = validatedProductPayload(request.body, { partial: true });
  if (!payload) return response.status(400).json({ error: 'No hay cambios de producto válidos.' });

  const { data, error } = await session.client
    .from('products')
    .update(payload)
    .eq('id', request.params.productId)
    .select()
    .maybeSingle();
  if (error || !data) return response.status(404).json({ error: 'Producto no encontrado.' });
  return response.json({ product: adminProduct(data) });
}));

app.delete('/api/admin/products/:productId', asyncRoute(async (request, response) => {
  if (!isUuid(request.params.productId)) return response.status(400).json({ error: 'Producto no válido.' });
  const session = await requireAdmin(request, response, config);
  if (!session) return response.status(403).json({ error: 'Autorización administrativa requerida.' });

  const { data, error } = await session.client
    .from('products')
    .update({ is_active: false })
    .eq('id', request.params.productId)
    .select()
    .maybeSingle();
  if (error || !data) return response.status(404).json({ error: 'Producto no encontrado.' });
  return response.json({ product: adminProduct(data), deactivated: true });
}));

app.get('/api/admin/products/:productId/media', asyncRoute(async (request, response) => {
  if (!isUuid(request.params.productId)) return response.status(400).json({ error: 'Producto no válido.' });
  const session = await requireAdmin(request, response, config);
  if (!session) return response.status(403).json({ error: 'Autorización administrativa requerida.' });

  const [productResult, mediaResult] = await Promise.all([
    session.client
      .from('products')
      .select('id,name,image_path')
      .eq('id', request.params.productId)
      .maybeSingle(),
    session.client
      .from('product_media')
      .select('id,source_path,storage_path,media_type,mime_type,byte_size,alt_text,sort_order,is_active,created_at')
      .eq('product_id', request.params.productId)
      .eq('is_active', true)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true }),
  ]);
  if (productResult.error || !productResult.data) {
    return response.status(404).json({ error: 'Producto no encontrado.' });
  }
  if (mediaResult.error) throw new Error('Unable to load product media from Supabase.');
  response.set('Cache-Control', 'private, no-store, max-age=0');
  return response.json({
    product: {
      id: productResult.data.id,
      name: productResult.data.name,
      coverUrl: IMAGE_PATTERN.test(productResult.data.image_path)
        ? `/${productResult.data.image_path}` : '/assets/favicon.png',
    },
    media: (mediaResult.data ?? []).map(productMedia),
  });
}));

app.post(
  '/api/admin/products/:productId/media',
  adminOnly,
  express.raw({ type: [...PRODUCT_MEDIA_MIME_TYPES.keys()], limit: MAX_PRODUCT_MEDIA_BYTES }),
  asyncRoute(async (request, response) => {
    if (!isUuid(request.params.productId)) return response.status(400).json({ error: 'Producto no válido.' });
    const session = request.adminSession;
    if (!adminSupabase) return response.status(503).json({ error: 'La carga de contenido no está configurada.' });

    const mimeType = request.get('content-type')?.split(';')[0]?.trim().toLowerCase();
    const mediaDefinition = PRODUCT_MEDIA_MIME_TYPES.get(mimeType);
    const body = Buffer.isBuffer(request.body) ? request.body : null;
    if (!mediaDefinition || !body?.length || body.length > MAX_PRODUCT_MEDIA_BYTES) {
      return response.status(400).json({ error: 'Selecciona una imagen o video válido de máximo 100 MB.' });
    }

    let storedBody = body;
    let storedMimeType = mimeType;
    let storedDefinition = mediaDefinition;
    if (mediaDefinition.type === 'video') {
      try {
        storedBody = await optimizeUploadedVideo(body, mediaDefinition.extension);
        storedMimeType = 'video/mp4';
        storedDefinition = PRODUCT_MEDIA_MIME_TYPES.get(storedMimeType);
      } catch (error) {
        console.warn(JSON.stringify({
          level: 'warn',
          event: 'product_media_video_optimization_failed',
          message: error?.message ?? 'Unknown optimization error',
        }));
        return response.status(400).json({
          error: 'No fue posible optimizar el video. Usa un archivo MP4, WebM o MOV válido de hasta 100 MB y duración moderada.',
        });
      }
    }

    let altText = '';
    try {
      altText = normalizeText(decodeURIComponent(request.get('x-media-alt') ?? ''), 180);
    } catch {
      return response.status(400).json({ error: 'El texto alternativo no es válido.' });
    }
    if (altText === null) return response.status(400).json({ error: 'El texto alternativo no es válido.' });

    const { data: product, error: productError } = await session.client
      .from('products')
      .select('id,name')
      .eq('id', request.params.productId)
      .maybeSingle();
    if (productError || !product) return response.status(404).json({ error: 'Producto no encontrado.' });

    const { data: latestMedia, error: latestError } = await session.client
      .from('product_media')
      .select('sort_order')
      .eq('product_id', product.id)
      .eq('is_active', true)
      .order('sort_order', { ascending: false })
      .limit(1);
    if (latestError) throw new Error('Unable to determine product media order.');
    const sortOrder = Math.min(100_000, Number(latestMedia?.[0]?.sort_order ?? -10) + 10);
    const storagePath = `${product.id}/${crypto.randomUUID()}.${storedDefinition.extension}`;
    const { error: uploadError } = await adminSupabase.storage
      .from('product-media')
      .upload(storagePath, storedBody, {
        contentType: storedMimeType,
        cacheControl: '31536000',
        upsert: false,
      });
    if (uploadError) return response.status(502).json({ error: 'No fue posible subir el archivo a Supabase.' });

    const { data: created, error: insertError } = await session.client
      .from('product_media')
      .insert({
        product_id: product.id,
        storage_path: storagePath,
        media_type: storedDefinition.type,
        mime_type: storedMimeType,
        byte_size: storedBody.length,
        alt_text: altText || `Contenido de ${product.name}`,
        sort_order: sortOrder,
      })
      .select('id,source_path,storage_path,media_type,mime_type,byte_size,alt_text,sort_order,is_active,created_at')
      .single();
    if (insertError || !created) {
      await adminSupabase.storage.from('product-media').remove([storagePath]);
      return response.status(400).json({ error: 'No fue posible asociar el archivo al producto.' });
    }
    response.set('Cache-Control', 'private, no-store, max-age=0');
    return response.status(201).json({
      media: productMedia(created),
      optimized: mediaDefinition.type === 'video',
    });
  }),
);

app.patch('/api/admin/products/:productId/media/:mediaId', asyncRoute(async (request, response) => {
  if (!isUuid(request.params.productId) || !isUuid(request.params.mediaId)) {
    return response.status(400).json({ error: 'Contenido no válido.' });
  }
  const session = await requireAdmin(request, response, config);
  if (!session) return response.status(403).json({ error: 'Autorización administrativa requerida.' });
  const payload = {};
  if (Object.hasOwn(request.body ?? {}, 'altText')) {
    if (typeof request.body.altText !== 'string') return response.status(400).json({ error: 'El texto alternativo no es válido.' });
    const altText = normalizeText(request.body.altText, 180);
    if (altText === null) return response.status(400).json({ error: 'El texto alternativo no es válido.' });
    payload.alt_text = altText || null;
  }
  if (Object.hasOwn(request.body ?? {}, 'sortOrder')) {
    payload.sort_order = integerInRange(request.body.sortOrder, 0, 100_000);
    if (payload.sort_order === null) return response.status(400).json({ error: 'El orden no es válido.' });
  }
  if (!Object.keys(payload).length) return response.status(400).json({ error: 'No hay cambios válidos.' });

  const { data, error } = await session.client
    .from('product_media')
    .update(payload)
    .eq('id', request.params.mediaId)
    .eq('product_id', request.params.productId)
    .eq('is_active', true)
    .select('id,source_path,storage_path,media_type,mime_type,byte_size,alt_text,sort_order,is_active,created_at')
    .maybeSingle();
  if (error || !data) return response.status(404).json({ error: 'Contenido no encontrado.' });
  return response.json({ media: productMedia(data) });
}));

app.delete('/api/admin/products/:productId/media/:mediaId', asyncRoute(async (request, response) => {
  if (!isUuid(request.params.productId) || !isUuid(request.params.mediaId)) {
    return response.status(400).json({ error: 'Contenido no válido.' });
  }
  const session = await requireAdmin(request, response, config);
  if (!session) return response.status(403).json({ error: 'Autorización administrativa requerida.' });
  const { data, error } = await session.client
    .from('product_media')
    .update({ is_active: false })
    .eq('id', request.params.mediaId)
    .eq('product_id', request.params.productId)
    .eq('is_active', true)
    .select('id,storage_path')
    .maybeSingle();
  if (error || !data) return response.status(404).json({ error: 'Contenido no encontrado.' });
  if (data.storage_path && adminSupabase) {
    const { data: remainingReferences, error: referenceError } = await adminSupabase
      .from('product_media')
      .select('id')
      .eq('storage_path', data.storage_path)
      .eq('is_active', true)
      .limit(1);
    if (referenceError) {
      console.warn(JSON.stringify({ level: 'warn', event: 'product_media_reference_check_failed', mediaId: data.id }));
    } else if (!remainingReferences?.length) {
      const { error: storageError } = await adminSupabase.storage.from('product-media').remove([data.storage_path]);
      if (storageError) {
        console.warn(JSON.stringify({ level: 'warn', event: 'product_media_storage_cleanup_failed', mediaId: data.id }));
      }
    }
  }
  return response.json({ removed: true });
}));

async function readSupabaseAuthUsers() {
  if (!config.supabaseSecretKey) throw new Error('Supabase administrative access is not configured.');
  const users = [];
  const perPage = 1_000;
  for (let page = 1; page <= 10; page += 1) {
    const response = await fetch(`${config.supabaseUrl}/auth/v1/admin/users?page=${page}&per_page=${perPage}`, {
      headers: {
        apikey: config.supabaseSecretKey,
        Authorization: `Bearer ${config.supabaseSecretKey}`,
      },
    });
    if (!response.ok) throw new Error('Unable to load users from Supabase Auth.');
    const data = await response.json();
    const batch = Array.isArray(data?.users) ? data.users : [];
    users.push(...batch);
    if (batch.length < perPage) break;
  }
  return users;
}

async function readSupabaseAuthUser(userId) {
  if (!config.supabaseSecretKey) throw new Error('Supabase administrative access is not configured.');
  const response = await fetch(`${config.supabaseUrl}/auth/v1/admin/users/${userId}`, {
    headers: {
      apikey: config.supabaseSecretKey,
      Authorization: `Bearer ${config.supabaseSecretKey}`,
    },
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error('Unable to load user from Supabase Auth.');
  const data = await response.json();
  const user = data?.user ?? data;
  return user?.id === userId ? user : null;
}

function adminUser(authUser, profile) {
  const email = typeof authUser.email === 'string' ? authUser.email.toLowerCase() : null;
  return {
    id: authUser.id,
    email,
    displayName: profile?.display_name ?? authUser.user_metadata?.full_name ?? null,
    role: profile?.role ?? 'customer',
    emailConfirmed: Boolean(authUser.email_confirmed_at),
    isAnonymous: Boolean(authUser.is_anonymous),
    provider: authUser.app_metadata?.provider ?? authUser.identities?.[0]?.provider ?? 'email',
    createdAt: authUser.created_at ?? profile?.created_at ?? null,
    lastSignInAt: authUser.last_sign_in_at ?? null,
    isPrimaryAdmin: email === PRIMARY_ADMIN_EMAIL,
  };
}

app.get('/api/admin/users', asyncRoute(async (request, response) => {
  const session = await requireAdmin(request, response, config);
  if (!session) return response.status(403).json({ error: 'Autorización administrativa requerida.' });
  if (!adminSupabase) return response.status(503).json({ error: 'La gestión de usuarios no está configurada.' });

  const [authUsers, profilesResult] = await Promise.all([
    readSupabaseAuthUsers(),
    session.client.from('profiles').select('id,display_name,role,created_at,updated_at'),
  ]);
  if (profilesResult.error) throw new Error('Unable to load user profiles from Supabase.');
  const profiles = new Map((profilesResult.data ?? []).map((profile) => [profile.id, profile]));
  const users = authUsers
    .map((user) => adminUser(user, profiles.get(user.id)))
    .sort((left, right) => String(right.createdAt ?? '').localeCompare(String(left.createdAt ?? '')));
  response.set('Cache-Control', 'private, no-store, max-age=0');
  return response.json({ users });
}));

app.patch('/api/admin/users/:userId', asyncRoute(async (request, response) => {
  if (!isUuid(request.params.userId)) return response.status(400).json({ error: 'Usuario no válido.' });
  const session = await requireAdmin(request, response, config);
  if (!session) return response.status(403).json({ error: 'Autorización administrativa requerida.' });
  if (!adminSupabase) return response.status(503).json({ error: 'La gestión de usuarios no está configurada.' });

  const displayName = normalizeText(request.body?.displayName, 100);
  const role = request.body?.role;
  if (displayName === null || !['customer', 'admin'].includes(role)) {
    return response.status(400).json({ error: 'Datos de usuario no válidos.' });
  }
  const target = await readSupabaseAuthUser(request.params.userId);
  if (!target) return response.status(404).json({ error: 'Usuario no encontrado.' });
  const email = target.email?.toLowerCase() ?? '';
  if (email === PRIMARY_ADMIN_EMAIL && role !== 'admin') {
    return response.status(409).json({ error: 'La cuenta administradora principal no puede perder su rol.' });
  }
  if (request.params.userId === session.user.id && role !== 'admin') {
    return response.status(409).json({ error: 'No puedes quitar tu propio acceso administrativo.' });
  }
  if (role === 'admin' && !target.email_confirmed_at) {
    return response.status(409).json({ error: 'El correo debe estar confirmado antes de asignar el rol administrador.' });
  }

  const { data, error } = await session.client.rpc('admin_update_user_profile', {
    p_user_id: request.params.userId,
    p_display_name: displayName || null,
    p_role: role,
  }).single();
  if (error || !data) return response.status(400).json({ error: 'No fue posible actualizar el usuario.' });
  return response.json({ user: adminUser(target, data) });
}));

app.get('/admin', asyncRoute(async (request, response) => {
  const session = await getRequestSession(request, response, config);
  if (!session || session.user.is_anonymous) {
    return response.redirect(303, '/?auth=signin&next=%2Fadmin');
  }

  const profile = await getSessionProfile(session);
  if (profile?.role !== 'admin' || !session.user.email_confirmed_at) {
    return response.redirect(303, '/?notice=admin-required');
  }

  response.set({
    'Cache-Control': 'private, no-store, max-age=0',
    'Content-Security-Policy': adminContentSecurityPolicy,
  });
  return response.type('html').send(adminHtml);
}));

app.get('/auth/confirm', (_request, response) => {
  response.set({
    'Cache-Control': 'private, no-store, max-age=0',
    'Content-Security-Policy': authConfirmContentSecurityPolicy,
  });
  response.type('html').send(authConfirmHtml);
});

app.use('/assets', express.static(ASSET_DIR, {
  dotfiles: 'deny',
  fallthrough: false,
  immutable: false,
  index: false,
  maxAge: '1d',
  setHeaders(response) {
    response.set('X-Content-Type-Options', 'nosniff');
  },
}));

app.get(['/', '/index.html'], (_request, response) => {
  response.set('Cache-Control', 'private, no-store, max-age=0');
  response.type('html').send(storefrontHtml);
});

app.get('/products/:slug', (request, response) => {
  if (!SLUG_PATTERN.test(request.params.slug)) return response.status(404).type('text').send('Página no encontrada');
  response.set({
    'Cache-Control': 'private, no-store, max-age=0',
    'Content-Security-Policy': productContentSecurityPolicy,
  });
  return response.type('html').send(productHtml);
});

app.use('/api', (_request, response) => response.status(404).json({ error: 'Endpoint no encontrado.' }));
app.use((_request, response) => response.status(404).type('text').send('Página no encontrada'));
app.use((error, request, response, _next) => {
  console.error(JSON.stringify({
    level: 'error',
    message: error?.message ?? 'Unknown server error',
    method: request.method,
    path: request.path,
  }));
  if (response.headersSent) return;
  if (error?.type === 'entity.too.large') {
    response.status(413).json({ error: 'El archivo supera el límite de 100 MB.' });
    return;
  }
  response.status(500).json({ error: 'El servicio no está disponible temporalmente.' });
});

const server = app.listen(config.port, '0.0.0.0', () => {
  console.log(JSON.stringify({ level: 'info', message: 'LoroBuy is ready', port: config.port }));
});

function shutdown(signal) {
  console.log(JSON.stringify({ level: 'info', message: 'Shutting down', signal }));
  server.close((error) => {
    process.exit(error ? 1 : 0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
