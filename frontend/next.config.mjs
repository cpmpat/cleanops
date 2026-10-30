/**
 * One build id, used in three places: Next's own build id, a value compiled
 * into the client bundle, and the /api/build answer. A tab open across a
 * deploy sees the last two disagree and offers a reload.
 */
const buildId =
  process.env.RAILWAY_GIT_COMMIT_SHA ||
  process.env.VERCEL_GIT_COMMIT_SHA ||
  process.env.NEXT_PUBLIC_BUILD_ID ||
  `local-${Date.now()}`;

/** @type {import('next').NextConfig} */
/**
 * Security headers. frame-ancestors/X-Frame-Options stop the login page (and
 * every page) being framed for clickjacking; nosniff, Referrer-Policy and
 * Permissions-Policy are defence-in-depth. The CSP is intentionally pragmatic:
 * script/style allow 'unsafe-inline' because Next injects inline bootstrap
 * scripts and this app has not been migrated to nonces — so it does NOT yet
 * block injected inline scripts. Tightening script-src to a nonce is the
 * follow-up that turns CSP into real XSS mitigation. connect-src allows https:
 * and wss: for the API proxy and the websocket (NEXT_PUBLIC_WS_URL).
 */
const contentSecurityPolicy = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self' https: wss:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

const securityHeaders = [
  { key: 'Content-Security-Policy', value: contentSecurityPolicy },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=(self), payment=()' },
];

const nextConfig = {
  generateBuildId: () => buildId,
  env: { NEXT_PUBLIC_BUILD_ID: buildId },
  async rewrites() {
    return [{ source: '/api/v1/:path*', destination: `${process.env.NEXT_PUBLIC_API_URL}/api/v1/:path*` }];
  },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};
export default nextConfig;
