import { z } from 'zod';

import {
  describeIssues,
  EnvironmentValidationError,
  normalizeEnvironment,
  type RawEnvironment,
} from './shared.ts';

export const APP_ENVIRONMENTS = ['local', 'preview', 'production'] as const;
export type AppEnvironment = (typeof APP_ENVIRONMENTS)[number];

/**
 * Browser-visible configuration. Every variable declared here is inlined into
 * the client bundle at build time, so it must never carry a secret. Adding a
 * variable requires the `NEXT_PUBLIC_` prefix here and a matching static
 * `process.env.NEXT_PUBLIC_*` read in `client.ts`; undeclared `NEXT_PUBLIC_`
 * variables fail the build (see `validate.ts`).
 */
export const clientEnvironmentSchema = z.object({
  NEXT_PUBLIC_APP_ENV: z.enum(APP_ENVIRONMENTS).default('local'),
});

export type ClientEnvironment = Readonly<z.infer<typeof clientEnvironmentSchema>>;

export const clientVariableNames: readonly string[] = Object.freeze(
  Object.keys(clientEnvironmentSchema.shape),
);

export function parseClientEnvironment(raw: RawEnvironment): ClientEnvironment {
  const result = clientEnvironmentSchema.safeParse(normalizeEnvironment(raw));
  if (!result.success) {
    throw new EnvironmentValidationError(describeIssues(result.error.issues));
  }
  return Object.freeze(result.data);
}
