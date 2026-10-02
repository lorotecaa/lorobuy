const trimTrailingSlash = (value) => value.replace(/\/+$/, '');

function requiredEnvironmentValue(name, environment) {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
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
  const appOrigin = trimTrailingSlash(requiredEnvironmentValue('APP_ORIGIN', environment));

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
    appOrigin,
    secureCookies: nodeEnv === 'production',
  });
}
