import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The identify route sends a photo to Claude. Give it room and time.
  serverExternalPackages: ["@anthropic-ai/sdk"],
  async rewrites() {
    return [
      // Android looks for Digital Asset Links at this exact path.
      { source: "/.well-known/assetlinks.json", destination: "/api/assetlinks" },
    ];
  },
};

export default nextConfig;
