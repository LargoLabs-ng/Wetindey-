import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // The backend is a sibling package. Turbopack must treat their common
  // parent as its workspace root to resolve the server-side imports.
  turbopack: {
    root: path.join(import.meta.dirname, ".."),
  },
  images: {
    // Only our own blob storage is optimisable. Allowing arbitrary hosts here
    // would turn the image optimizer into an open proxy that anyone could
    // point at any URL on the internet at our expense; cover images from
    // other hosts (legacy pasted URLs) render through a plain <img> instead —
    // see isOptimizable() in lib/storage.ts.
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**.public.blob.vercel-storage.com",
      },
    ],
  },
};

export default nextConfig;
