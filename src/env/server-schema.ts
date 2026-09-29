import { z } from 'zod';

import {
  describeIssues,
  EnvironmentValidationError,
  normalizeEnvironment,
  type RawEnvironment,
} from './shared.ts';

export const NODE_ENVIRONMENTS = ['development', 'test', 'production'] as const;

/**
 * Server-side configuration. Nothing declared here may reach the browser:
 * `server.ts` is guarded by the `server-only` package and the client-bundle
 * check (`npm run check:bundle`) fails when a server-only variable name or
 * value appears in browser-delivered output. New server variables belong
 * here; they are covered by that check automatically.
 */
export const serverEnvironmentSchema = z.object({
  NODE_ENV: z.enum(NODE_ENVIRONMENTS).default('development'),
});

export type ServerEnvironment = Readonly<z.infer<typeof serverEnvironmentSchema>>;

export const serverVariableNames: readonly string[] = Object.freeze(
  Object.keys(serverEnvironmentSchema.shape),
);

/**
 * `NODE_ENV` is defined by the framework and inlined into client code by
 * design, so it is the only server variable exempt from the leak check.
 */
export const serverOnlyVariableNames: readonly string[] = Object.freeze(
  serverVariableNames.filter((name) => name !== 'NODE_ENV'),
);

export function parseServerEnvironment(raw: RawEnvironment): ServerEnvironment {
  const result = serverEnvironmentSchema.safeParse(normalizeEnvironment(raw));
  if (!result.success) {
    throw new EnvironmentValidationError(describeIssues(result.error.issues));
  }
  return Object.freeze(result.data);
}
