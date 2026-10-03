import crypto from 'node:crypto';

const LEMON_SQUEEZY_API = 'https://api.lemonsqueezy.com/v1';
const SIGNATURE_PATTERN = /^[a-f0-9]{64}$/i;

function checkoutHostAllowed(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:'
      && (url.hostname === 'lemonsqueezy.com' || url.hostname.endsWith('.lemonsqueezy.com'));
  } catch {
    return false;
  }
}

export function verifyLemonSqueezySignature(rawBody, signature, secret) {
  if (!Buffer.isBuffer(rawBody) || !SIGNATURE_PATTERN.test(signature ?? '') || !secret) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(expected, 'utf8'), Buffer.from(signature, 'utf8'));
}

export function parseLemonSqueezyWebhook(rawBody, eventHeader) {
  let payload;
  try {
    payload = JSON.parse(rawBody.toString('utf8'));
  } catch {
    throw new Error('Invalid Lemon Squeezy webhook JSON.');
  }

  const eventName = payload?.meta?.event_name;
  if (typeof eventName !== 'string' || eventName !== eventHeader) {
    throw new Error('Lemon Squeezy event headers do not match the payload.');
  }
  if (payload?.data?.type !== 'orders' || !payload.data.id || !payload.data.attributes) {
    throw new Error('Lemon Squeezy webhook does not contain an order.');
  }

  return {
    payload,
    eventName,
    eventKey: `${eventName}:orders:${payload.data.id}`,
    payloadSha256: crypto.createHash('sha256').update(rawBody).digest('hex'),
  };
}

export function buildLemonSqueezyCheckoutBody(config, order) {
  const numericVariantId = Number(order.providerVariantId);
  if (!/^\d+$/.test(String(order.providerVariantId)) || !Number.isSafeInteger(numericVariantId) || numericVariantId < 1) {
    throw new Error('The Lemon Squeezy variant ID is invalid.');
  }
  const attributes = {
    custom_price: order.amountCents,
    product_options: {
      name: order.productName,
      description: 'Producto digital LoroBuy',
      redirect_url: `${config.appOrigin}/products/${encodeURIComponent(order.productSlug)}?checkout=success&order=${encodeURIComponent(order.orderId)}`,
      receipt_button_text: 'Volver a LoroBuy',
      receipt_link_url: `${config.appOrigin}/products/${encodeURIComponent(order.productSlug)}?checkout=success&order=${encodeURIComponent(order.orderId)}`,
      enabled_variants: [numericVariantId],
    },
    checkout_options: {
      embed: false,
      media: false,
      logo: true,
      desc: false,
      discount: false,
      locale: 'es',
      background_color: '#0b0a12',
      headings_color: '#ffffff',
      primary_text_color: '#ffffff',
      secondary_text_color: '#aaa7b7',
      links_color: '#12eda7',
      borders_color: '#34303e',
      checkbox_color: '#12eda7',
      active_state_color: '#12eda7',
      button_color: '#12eda7',
      button_text_color: '#07110d',
      terms_privacy_color: '#aaa7b7',
    },
    checkout_data: {
      custom: {
        order_id: order.orderId,
        payment_attempt_token: order.attemptToken,
      },
    },
    test_mode: config.lemonSqueezyTestMode,
    expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
  };

  if (order.email) attributes.checkout_data.email = order.email;
  if (order.name) attributes.checkout_data.name = order.name;

  return {
    data: {
      type: 'checkouts',
      attributes,
      relationships: {
        store: { data: { type: 'stores', id: String(config.lemonSqueezyStoreId) } },
        variant: { data: { type: 'variants', id: String(order.providerVariantId) } },
      },
    },
  };
}

export async function createLemonSqueezyCheckout(config, order) {
  const response = await fetch(`${LEMON_SQUEEZY_API}/checkouts`, {
    method: 'POST',
    headers: {
      Accept: 'application/vnd.api+json',
      'Content-Type': 'application/vnd.api+json',
      Authorization: `Bearer ${config.lemonSqueezyApiKey}`,
    },
    body: JSON.stringify(buildLemonSqueezyCheckoutBody(config, order)),
    signal: AbortSignal.timeout(12_000),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) {
    const providerCode = result?.errors?.[0]?.code ?? `http_${response.status}`;
    throw new Error(`Lemon Squeezy checkout failed: ${providerCode}`);
  }

  const checkoutId = result?.data?.id;
  const checkoutUrl = result?.data?.attributes?.url;
  if (!checkoutId || !checkoutHostAllowed(checkoutUrl)) {
    throw new Error('Lemon Squeezy returned an invalid checkout.');
  }
  return { checkoutId: String(checkoutId), checkoutUrl };
}
