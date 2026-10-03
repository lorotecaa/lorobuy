import { createClient } from '@supabase/supabase-js';

const authOptions = Object.freeze({
  autoRefreshToken: false,
  detectSessionInUrl: false,
  persistSession: false,
});

export function createPublicSupabase(config) {
  return createClient(config.supabaseUrl, config.supabasePublishableKey, {
    auth: authOptions,
  });
}

export function createUserSupabase(config, accessToken) {
  return createClient(config.supabaseUrl, config.supabasePublishableKey, {
    auth: authOptions,
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  });
}

export function createAdminSupabase(config) {
  if (!config.supabaseSecretKey) return null;
  return createClient(config.supabaseUrl, config.supabaseSecretKey, {
    auth: authOptions,
  });
}
