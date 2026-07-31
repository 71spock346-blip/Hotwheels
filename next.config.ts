import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The identify route sends a photo to Claude. Give it room and time.
  serverExternalPackages: ["@anthropic-ai/sdk"],
};

export default nextConfig;
