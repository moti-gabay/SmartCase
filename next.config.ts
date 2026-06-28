import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Tell Next.js not to bundle these packages — they contain native bindings
  // that must be resolved by the Node.js runtime on the server, not by webpack.
  serverExternalPackages: ["@prisma/client", "bcryptjs"],

  images: {
    remotePatterns: [
      // Uncomment and fill in when you connect an S3 bucket for document storage:
      // { protocol: "https", hostname: "smartcase-documents.s3.il-central-1.amazonaws.com" },
    ],
  },
};

export default nextConfig;
