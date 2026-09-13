import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  // Production containers run the standalone server output; no dev server
  // ships inside the image (see apps/web/Dockerfile).
  output: "standalone",
  // Workspace packages are consumed as TypeScript source through their
  // package exports; never import another package's internal paths.
  transpilePackages: [
    "@speaking-track/contracts",
    "@speaking-track/db",
    "@speaking-track/queue",
    "@speaking-track/storage",
    "@speaking-track/youtube",
  ],
}

export default nextConfig
