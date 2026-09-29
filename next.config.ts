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

  // Mic is used only by the assistant's dictation and the portal's story
  // recorder, both same-origin; deny it to any embedded third-party frame.
  async headers() {
    return [{ source: "/:path*", headers: [{ key: "Permissions-Policy", value: "microphone=(self)" }] }];
  },
};

export default nextConfig;
