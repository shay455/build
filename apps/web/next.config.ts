import type { NextConfig } from "next";

const API = process.env.API_ORIGIN ?? "http://localhost:4000";

const nextConfig: NextConfig = {
  transpilePackages: ["@bombot/shared"],
  reactStrictMode: true,
  async rewrites() {
    // Same-origin API calls in dev and behind one reverse proxy in prod.
    return [{ source: "/api/:path*", destination: `${API}/api/:path*` }];
  },
};
export default nextConfig;
