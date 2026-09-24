import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["archiver", "esbuild", "pixelmatch", "playwright", "pngjs"],
  experimental: {
    serverActions: { bodySizeLimit: "16mb" },
  },
  poweredByHeader: false,
};

export default nextConfig;
