import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        // Tell browsers not to cache page HTML — ensures users always get the latest deployment.
        // Static assets under /_next/static/ use content-hashed filenames and stay cached by default.
        source: '/((?!_next|api|.*\\.[a-z]{2,4}$).*)',
        headers: [
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          { key: 'Pragma', value: 'no-cache' },
        ],
      },
    ]
  },
}

export default nextConfig;
