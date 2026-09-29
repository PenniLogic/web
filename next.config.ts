import type { NextConfig } from 'next';

import { validateEnvironment } from './src/env/validate.ts';

// Runs when Next.js loads this file, so an invalid environment fails
// `next build`, `next dev`, `next start` and `next typegen` before any code runs.
validateEnvironment(process.env);

// tools/planted-secret-check.ts builds a throwaway variant into an isolated
// directory (with its own generated route types) so the real build output is
// never mixed with the planted fixture.
const plantedVariant = process.env.WEB_BUILD_VARIANT === 'planted-secret-check';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  typedRoutes: true,
  distDir: plantedVariant ? '.next/planted' : '.next',
  typescript: {
    tsconfigPath: plantedVariant ? 'tsconfig.planted.json' : 'tsconfig.json',
  },
};

export default nextConfig;
