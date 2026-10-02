import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
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
import { buildContentSecurityPolicy, requireSameOrigin } from './security.mjs';
import { createPublicSupabase } from './supabase.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');
const FRONTEND_BUILD_DIR = path.join(ROOT_DIR, 'dist');
const ASSET_DIR = path.join(FRONTEND_BUILD_DIR, 'assets');
const INDEX_FILE = path.join(FRONTEND_BUILD_DIR, 'index.html');
const ADMIN_FILE = path.join(FRONTEND_BUILD_DIR, 'admin.html');
if (!fs.existsSync(INDEX_FILE) || !fs.existsSync(ADMIN_FILE) || !fs.existsSync(ASSET_DIR)) {
  throw new Error('Frontend build is missing. Run `npm run build` before starting LoroBuy.');
}
const storefrontHtml = fs.readFileSync(INDEX_FILE, 'utf8');
const adminHtml = fs.readFileSync(ADMIN_FILE, 'utf8');
const contentSecurityPolicy = buildContentSecurityPolicy(storefrontHtml);
const adminContentSecurityPolicy = buildContentSecurityPolicy(adminHtml);
const config = loadConfig();
const publicSupabase = createPublicSupabase(config);
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
  response.set({
    'Content-Security-Policy': request.path === '/admin' ? adminContentSecurityPolicy : contentSecurityPolicy,
    'Permissions-Policy': 'accelerometer=(), autoplay=(self), browsing-topics=(), camera=(), clipboard-read=(), clipboard-write=(), fullscreen=(self), gamepad=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), midi=(), payment=(), publickey-credentials-create=(), publickey-credentials-get=(), screen-wake-lock=(), usb=(), xr-spatial-tracking=()',
    'X-DNS-Prefetch-Control': 'off',
    'X-Permitted-Cross-Domain-Policies': 'none',
    'X-Robots-Tag': 'noindex, nofollow, noarchive, nosnippet, noimageindex',
  });
  next();
});
app.use(express.json({ limit: '16kb', strict: true }));
app.use(express.urlencoded({ extended: false, limit: '8kb', parameterLimit: 20 }));
app.use('/api', requireSameOrigin(config));

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const IMAGE_PATTERN = /^assets\/[a-z0-9-]+\.(?:webp|png|jpe?g)$/i;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function asyncRoute(handler) {
  return (request, response, next) => Promise.resolve(handler(request, response, next)).catch(next);
}

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

function publicProduct(row) {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    imagePath: IMAGE_PATTERN.test(row.image_path) ? row.image_path : 'assets/favicon.png',
    priceCents: row.price_cents,
    compareAtPriceCents: row.compare_at_price_cents,
    currency: row.currency,
    category: {
      slug: row.categories.slug,
      name: row.categories.name,
      sortOrder: row.categories.sort_order,
    },
    sortOrder: row.sort_order,
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
  response.set('Cache-Control', 'public, max-age=30, s-maxage=60');
  return response.json({ products: (data ?? []).map(publicProduct) });
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
  if (!displayName || !email || !EMAIL_PATTERN.test(email) || !password || password.length < 12) {
    return response.status(400).json({ error: 'Nombre, correo o contraseña no válidos. La contraseña debe tener al menos 12 caracteres.' });
  }

  const { data, error } = await createPublicSupabase(config).auth.signUp({
    email,
    password,
    options: { data: { full_name: displayName } },
  });
  if (error) return response.status(400).json({ error: 'No fue posible crear la cuenta.' });
  if (data.session) setSessionCookies(response, config, data.session);
  return response.status(data.session ? 201 : 202).json({
    created: true,
    confirmationRequired: !data.session,
  });
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
  if (!session || session.user.is_anonymous) return response.status(401).json({ error: 'Inicia sesión para descargar tu compra.' });

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
    if (!payload.image_path || !IMAGE_PATTERN.test(payload.image_path)) return null;
  }
  if (required || has('currency')) {
    payload.currency = normalizeText(body?.currency ?? 'USD', 3, { required: true })?.toUpperCase();
    if (!/^[A-Z]{3}$/.test(payload.currency ?? '')) return null;
  }
  if (required || has('categoryId')) {
    if (!isUuid(body?.categoryId)) return null;
    payload.category_id = body.categoryId;
  }
  if (required || has('priceCents')) {
    payload.price_cents = integerInRange(body?.priceCents, 0, 100_000_000);
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
  return payload;
}

app.post('/api/admin/products', asyncRoute(async (request, response) => {
  const session = await requireAdmin(request, response, config);
  if (!session) return response.status(403).json({ error: 'Autorización administrativa requerida.' });
  const payload = validatedProductPayload(request.body);
  if (!payload) return response.status(400).json({ error: 'Datos de producto no válidos.' });

  const { data, error } = await session.client.from('products').insert(payload).select().single();
  if (error) return response.status(400).json({ error: 'No fue posible crear el producto.' });
  return response.status(201).json({ product: data });
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
  return response.json({ product: data });
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
