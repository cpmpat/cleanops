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
const nextConfig = {
  generateBuildId: () => buildId,
  env: { NEXT_PUBLIC_BUILD_ID: buildId },
  async rewrites() {
    return [{ source: '/api/v1/:path*', destination: `${process.env.NEXT_PUBLIC_API_URL}/api/v1/:path*` }];
  },
};
export default nextConfig;
