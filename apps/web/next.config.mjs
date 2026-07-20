/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Gzip when self-hosting via `next start`; on S3+CloudFront the edge
  // compresses instead (enable "Compress objects automatically").
  compress: true,
  poweredByHeader: false,
  productionBrowserSourceMaps: false,
  // The shared package ships raw TypeScript; Next compiles it in-place.
  transpilePackages: ["@vertik12/shared"],
  // Production build for S3 + CloudFront: NEXT_OUTPUT=export produces a
  // fully static site in apps/web/out (all data fetching is client-side).
  // trailingSlash writes each route as <route>/index.html, which maps
  // cleanly onto S3 keys with a small CloudFront URL-rewrite function.
  ...(process.env.NEXT_OUTPUT === "export"
    ? { output: "export", trailingSlash: true, images: { unoptimized: true } }
    : {}),
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1",
  },
};

export default nextConfig;
