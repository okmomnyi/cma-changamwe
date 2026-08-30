/**
 * The browser only ever talks to one origin. The /api/* rewrite is what makes
 * that true, and the refresh cookie being SameSite=Strict with no CORS anywhere
 * depends on it.
 *
 * API_ORIGIN is read at build time, not run time: it is baked into the routes
 * manifest. Both processes sit on one host, so the default is what ships.
 */
const API_ORIGIN = process.env.API_ORIGIN ?? 'http://127.0.0.1:3000';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${API_ORIGIN}/api/:path*` }];
  },
};

export default nextConfig;
