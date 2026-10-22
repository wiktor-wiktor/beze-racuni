import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Vinext applies this request limit before dispatching multipart route handlers.
  // The photo endpoint enforces its own 10 MB file limit while reading the body.
  experimental: { serverActions: { bodySizeLimit: "11mb" } },
};

export default nextConfig;
