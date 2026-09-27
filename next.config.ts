import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["archiver", "esbuild", "pixelmatch", "playwright", "pngjs", "typescript", "typescript-eslint", "eslint", "@axe-core/playwright", "postcss", "tailwindcss"],
  experimental: {
    serverActions: { bodySizeLimit: "16mb" },
  },
  poweredByHeader: false,
};

export default nextConfig;
