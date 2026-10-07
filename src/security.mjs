import crypto from 'node:crypto';

function sha256(content) {
  const browserNormalizedContent = content.replace(/\r\n?/g, '\n');
  return crypto.createHash('sha256').update(browserNormalizedContent, 'utf8').digest('base64');
}

function firstInlineTag(html, tagName) {
  const match = html.match(new RegExp(`<${tagName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tagName}>`, 'i'));
  if (!match) throw new Error(`Missing inline <${tagName}> block in storefront document`);
  return match[1];
}

export function buildContentSecurityPolicy(html, {
  allowSameOriginScripts = false,
  allowSameOriginStyles = false,
  imageSources = [],
  mediaSources = [],
  connectSources = [],
} = {}) {
  const styleHash = sha256(firstInlineTag(html, 'style'));
  const scriptHash = sha256(firstInlineTag(html, 'script'));
  const scriptPolicy = allowSameOriginScripts
    ? `script-src 'self' 'sha256-${scriptHash}'`
    : `script-src 'sha256-${scriptHash}' 'strict-dynamic'`;

  return [
    "default-src 'none'",
    scriptPolicy,
    "script-src-attr 'none'",
    `style-src ${allowSameOriginStyles ? "'self' " : ''}'sha256-${styleHash}'`,
    "style-src-attr 'none'",
    `img-src 'self' data: ${imageSources.join(' ')}`.trim(),
    "font-src 'self'",
    `media-src 'self' ${mediaSources.join(' ')}`.trim(),
    `connect-src 'self' ${connectSources.join(' ')}`.trim(),
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "frame-src 'none'",
    "worker-src 'none'",
    "manifest-src 'none'",
    "require-trusted-types-for 'script'",
    "trusted-types 'none'",
    'upgrade-insecure-requests',
  ].join('; ');
}

export function requireSameOrigin(config) {
  const safeMethods = new Set(['GET', 'HEAD', 'OPTIONS']);

  return (request, response, next) => {
    if (safeMethods.has(request.method)) return next();

    const origin = request.get('origin');
    if (origin === config.appOrigin || (config.nodeEnv !== 'production' && !origin)) {
      return next();
    }

    return response.status(403).json({ error: 'Origen de solicitud no permitido.' });
  };
}
