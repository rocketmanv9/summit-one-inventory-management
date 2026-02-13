import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // Disable React Compiler for now - it's experimental and causes ESLint errors
  // that block Vercel deployment. Re-enable once code patterns are updated.
  reactCompiler: false,
};

export default nextConfig;
