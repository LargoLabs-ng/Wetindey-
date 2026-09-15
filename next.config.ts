import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
