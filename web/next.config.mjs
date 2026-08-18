/**
 * Every deployment keeps the browser on ONE origin, and the /api/* rewrite is
 * what makes that true:
 *
 *   local   -> http://127.0.0.1:3000   (the Express server)
 *   Docker  -> http://app:3000         (Caddy does the same routing in front)
 *   Vercel  -> the API project's URL   (a server-side proxy, so the browser
 *                                       still only ever sees the web domain)
 *
 * This is not a convenience. The refresh cookie is SameSite=Strict and the API
 * has no CORS configuration at all; both depend on the browser never making a
 * cross-origin request.
 */
const API_ORIGIN = process.env.API_ORIGIN ?? 'http://127.0.0.1:3000';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Standalone output is for the Docker image, which runs `node server.js`.
  // Vercel builds its own output and setting this there only confuses it.
  ...(process.env.VERCEL ? {} : { output: 'standalone' }),
  poweredByHeader: false,
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${API_ORIGIN}/api/:path*` }];
  },
};

export default nextConfig;
