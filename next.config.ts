import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ['better-sqlite3', '@anthropic-ai/claude-agent-sdk'],
  experimental: {
    // Allow longer streaming responses for generation
  },
};

export default nextConfig;
