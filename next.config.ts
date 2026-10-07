import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

// Catalogue images are public Supabase Storage objects; next/image resizes them
// (thumbnails never download the original). Only this project's public buckets.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const storagePattern = supabaseUrl ? [new URL("/storage/v1/object/public/**", supabaseUrl)] : [];

const nextConfig: NextConfig = {
  cacheComponents: true,
  images: {
    remotePatterns: storagePattern,
  },
  partialPrefetching: true,
  experimental: {
    // Root layout lives under app/[lang]; this renders unmatched URLs.
    globalNotFound: true,
    serverActions: {
      // Catalogue images are uploaded one file per Server Action call and are
      // limited to 5 MB (lib/catalogue/images.ts); leave room for multipart overhead.
      bodySizeLimit: "6mb",
    },
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [
      { source: "/(.*)", headers: securityHeaders },
      {
        // Always fetch the latest service worker; restrict what it can load.
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self'" },
        ],
      },
    ];
  },
};

export default nextConfig;
