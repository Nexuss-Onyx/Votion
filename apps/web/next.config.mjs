import { buildContentSecurityPolicy } from '@votion/types';

function extractOrigin(rawUrl) {
  if (!rawUrl) return null;
  const match = /^(https?|wss?):\/\/([^/?#\s]+)/i.exec(rawUrl.trim());
  return match ? `${match[1].toLowerCase()}://${match[2].toLowerCase()}` : null;
}

function createEdgeSecurityHeaders() {
  const isDev = process.env.NODE_ENV === 'development';
  const isProd = process.env.NODE_ENV === 'production';
  const extraConnectSrc = [
    process.env.NEXT_PUBLIC_API_URL,
    process.env.NEXT_PUBLIC_WS_URL,
    process.env.MEILISEARCH_HOST,
    process.env.S3_ENDPOINT,
  ]
    .map(extractOrigin)
    .filter(Boolean);

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

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  eslint: {
    // The repo lints the whole workspace via `pnpm turbo run lint` (V-03).
    ignoreDuringBuilds: false,
  },
  typescript: {
    ignoreBuildErrors: false,
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: createEdgeSecurityHeaders(),
      },
    ];
  },
};

export default nextConfig;
