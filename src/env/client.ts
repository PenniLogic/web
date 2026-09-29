import { parseClientEnvironment, type ClientEnvironment } from './client-schema.ts';

/**
 * Browser-safe configuration. Each variable is read through a static
 * `process.env.NEXT_PUBLIC_*` expression so Next.js inlines it at build time;
 * a dynamic lookup would not be inlined and would be undefined in the browser.
 * Never add a non-`NEXT_PUBLIC_` variable here.
 */
export const clientEnv: ClientEnvironment = parseClientEnvironment({
  NEXT_PUBLIC_APP_ENV: process.env.NEXT_PUBLIC_APP_ENV,
});
