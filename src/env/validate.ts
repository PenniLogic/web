import {
  clientEnvironmentSchema,
  clientVariableNames,
  type ClientEnvironment,
} from './client-schema.ts';
import { serverEnvironmentSchema, type ServerEnvironment } from './server-schema.ts';
import {
  CLIENT_VARIABLE_PREFIX,
  describeIssues,
  EnvironmentValidationError,
  normalizeEnvironment,
  type RawEnvironment,
} from './shared.ts';

export interface ValidatedEnvironment {
  readonly client: ClientEnvironment;
  readonly server: ServerEnvironment;
}

/**
 * Names of `NEXT_PUBLIC_` variables that are present but not declared in the
 * client schema. Declaring browser-visible variables explicitly is what keeps
 * a stray server value from being inlined into the client bundle by prefix.
 */
export function undeclaredClientVariables(raw: RawEnvironment): string[] {
  return Object.keys(normalizeEnvironment(raw))
    .filter(
      (name) => name.startsWith(CLIENT_VARIABLE_PREFIX) && !clientVariableNames.includes(name),
    )
    .sort();
}

/**
 * Validates the whole environment at once and reports every problem together.
 * Used by `next.config.ts`, so an invalid configuration fails `next build`,
 * `next dev` and `next start` before any code runs. Problems name variables,
 * never values.
 */
export function validateEnvironment(raw: RawEnvironment): ValidatedEnvironment {
  const environment = normalizeEnvironment(raw);
  const client = clientEnvironmentSchema.safeParse(environment);
  const server = serverEnvironmentSchema.safeParse(environment);
  const problems: string[] = [];
  if (!client.success) {
    problems.push(...describeIssues(client.error.issues));
  }
  if (!server.success) {
    problems.push(...describeIssues(server.error.issues));
  }
  for (const name of undeclaredClientVariables(environment)) {
    problems.push(
      `${name}: undeclared ${CLIENT_VARIABLE_PREFIX} variable; browser-visible variables must be declared in src/env/client-schema.ts`,
    );
  }
  if (!client.success || !server.success || problems.length > 0) {
    throw new EnvironmentValidationError(problems);
  }
  return Object.freeze({
    client: Object.freeze(client.data),
    server: Object.freeze(server.data),
  });
}
