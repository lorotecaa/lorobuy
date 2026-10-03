const trimTrailingSlash = (value) => value.replace(/\/+$/, '');

function requiredEnvironmentValue(name, environment) {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function optionalEnvironmentValue(name, environment) {
  return environment[name]?.trim() || null;
}

function parseBoolean(name, value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`${name} must be either true or false`);
}

function parsePort(value) {
  const port = Number(value ?? 10000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535');
  }
  return port;
}

export function loadConfig(environment = process.env) {
  const nodeEnv = environment.NODE_ENV?.trim() || 'development';
  const supabaseUrl = trimTrailingSlash(requiredEnvironmentValue('SUPABASE_URL', environment));
  const supabasePublishableKey = requiredEnvironmentValue('SUPABASE_PUBLISHABLE_KEY', environment);
  const supabaseSecretKey = optionalEnvironmentValue('SUPABASE_SECRET_KEY', environment);
  const appOrigin = trimTrailingSlash(requiredEnvironmentValue('APP_ORIGIN', environment));
  const lemonSqueezyApiKey = optionalEnvironmentValue('LEMON_SQUEEZY_API_KEY', environment);
  const lemonSqueezyStoreId = optionalEnvironmentValue('LEMON_SQUEEZY_STORE_ID', environment);
  const lemonSqueezyWebhookSecret = optionalEnvironmentValue('LEMON_SQUEEZY_WEBHOOK_SECRET', environment);
  const lemonSqueezyTestMode = parseBoolean(
    'LEMON_SQUEEZY_TEST_MODE',
    optionalEnvironmentValue('LEMON_SQUEEZY_TEST_MODE', environment),
    true,
  );

  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(supabaseUrl) && nodeEnv === 'production') {
    throw new Error('SUPABASE_URL must be an HTTPS Supabase project URL in production');
  }
  if (!/^https:\/\//i.test(appOrigin) && nodeEnv === 'production') {
    throw new Error('APP_ORIGIN must use HTTPS in production');
  }

  return Object.freeze({
    nodeEnv,
    port: parsePort(environment.PORT),
    supabaseUrl,
    supabasePublishableKey,
    supabaseSecretKey,
    appOrigin,
    secureCookies: nodeEnv === 'production',
    lemonSqueezyApiKey,
    lemonSqueezyStoreId,
    lemonSqueezyWebhookSecret,
    lemonSqueezyTestMode,
    paymentsConfigured: Boolean(
      supabaseSecretKey
      && lemonSqueezyApiKey
      && lemonSqueezyStoreId
      && lemonSqueezyWebhookSecret
    ),
  });
}
