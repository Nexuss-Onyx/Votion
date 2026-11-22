import { buildContentSecurityPolicy } from '@votion/types';

export interface SecurityHeaderEntry {
  key: string;
  value: string;
}

function extractOrigin(rawUrl: string | undefined): string | null {
  if (!rawUrl) {
    return null;
  }
  const trimmed = rawUrl.trim();
  const match = /^(https?|wss?):\/\/([^/?#\s]+)/i.exec(trimmed);
  if (!match || !match[1] || !match[2]) {
    return null;
  }
  return `${match[1].toLowerCase()}://${match[2].toLowerCase()}`;
}

/**
 * Builds hardened HTTP response headers (including Content-Security-Policy)
 * for the Votion Next.js edge frontend.
 */
export function buildWebSecurityHeaders(
  env: Readonly<Record<string, string | undefined>> = process.env,
): SecurityHeaderEntry[] {
  const isDev = env.NODE_ENV === 'development';
  const isProd = env.NODE_ENV === 'production';

  const extraConnectSrc: string[] = [];
  for (const key of [
    'NEXT_PUBLIC_API_URL',
    'NEXT_PUBLIC_WS_URL',
    'MEILISEARCH_HOST',
    'S3_ENDPOINT',
  ]) {
    const origin = extractOrigin(env[key]);
    if (origin) {
      extraConnectSrc.push(origin);
    }
  }
  if (isDev) {
    extraConnectSrc.push('http://localhost:*', 'ws://localhost:*');
  }

  const csp = buildContentSecurityPolicy({
    allowInlineScripts: true,
    allowDevEval: isDev,
    extraConnectSrc,
    upgradeInsecureRequests: isProd,
  });

  return [
    { key: 'Content-Security-Policy', value: csp },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    {
      key: 'Permissions-Policy',
      value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
    },
    {
      key: 'Strict-Transport-Security',
      value: 'max-age=63072000; includeSubDomains; preload',
    },
  ];
}
