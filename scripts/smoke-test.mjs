const baseUrl = (process.env.BASE_URL ?? process.argv[2] ?? '').replace(/\/+$/, '');
if (!/^https?:\/\//i.test(baseUrl)) {
  console.error('Use: BASE_URL=https://your-service.onrender.com npm run smoke');
  process.exit(1);
}

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    redirect: 'error',
    signal: AbortSignal.timeout(10_000),
    ...options,
  });
  return response;
}

const healthResponse = await request('/api/health', { headers: { Accept: 'application/json' } });
if (!healthResponse.ok) throw new Error(`Health check failed with ${healthResponse.status}`);
const health = await healthResponse.json();
if (health.status !== 'ok' || health.database !== 'connected') {
  throw new Error('Render is reachable but Supabase is not connected');
}

const catalogResponse = await request('/api/products', { headers: { Accept: 'application/json' } });
if (!catalogResponse.ok) throw new Error(`Catalog check failed with ${catalogResponse.status}`);
const catalog = await catalogResponse.json();
if (!Array.isArray(catalog.products)) throw new Error('Catalog response is invalid');

const pageResponse = await request('/');
if (!pageResponse.ok) throw new Error(`Storefront check failed with ${pageResponse.status}`);
const page = await pageResponse.text();
if (!page.includes('<title>Lorobuy</title>')) throw new Error('LoroBuy storefront was not served');
if (!pageResponse.headers.get('content-security-policy')) throw new Error('Security headers are missing');

console.log(JSON.stringify({
  status: 'ok',
  render: 'reachable',
  supabase: health.database,
  activeProducts: health.activeProducts,
  catalogProducts: catalog.products.length,
  securityHeaders: 'present',
}, null, 2));
