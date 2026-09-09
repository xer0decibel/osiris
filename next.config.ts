import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    rules: {
      'maplibre-gl.mjs': {
        loaders: [`${__dirname}/tools/maplibre-url-loader.cjs`],
        as: '*.js',
      },
    },
  },
  output: 'standalone',
  // The development-tools button Next draws at the bottom-left of every page
  // sat on top of the layer rail's Ghost Protocol button, and its only other
  // homes are the three corners we already use. Off, then. Build errors still
  // surface as the full overlay; only the button goes.
  devIndicators: false,
  serverExternalPackages: ['ws'],
  transpilePackages: ['react-map-gl', 'mapbox-gl', 'maplibre-gl'],
  // Type errors block the build again. They were suppressed while 17 stood
  // unfixed; those are cleared, so the gate can do its job — the AstraPanel
  // crash (createPortal used without an import) shipped precisely because
  // nothing stopped it.
  typescript: {
    ignoreBuildErrors: false,
  },
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**' },
    ],
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'Content-Security-Policy', value: "default-src 'self' 'unsafe-inline' 'unsafe-eval' https: wss: data: blob:;" },
          { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'X-XSS-Protection', value: '1; mode=block' },
        ],
      },
    ];
  },
};

export default nextConfig;
