import type { MetadataRoute } from "next";

// Served at /manifest.webmanifest and linked automatically by Next.js.
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/admin",
    name: "Mirna Admin",
    short_name: "Mirna Admin",
    description: "Mirna Ecommerce Administration",
    // proxy.ts redirects /admin to the user's locale (/en/admin, /ar/admin).
    start_url: "/admin",
    scope: "/",
    display: "standalone",
    orientation: "any",
    // Matches the light --background token.
    background_color: "#faf7f3",
    theme_color: "#291113",
    categories: ["business", "productivity"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
