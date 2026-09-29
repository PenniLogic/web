import type { z } from 'zod';

/**
 * Raw process environment as seen at build or start time. Values are always
 * strings when set; an empty string is treated as "not set" so that
 * `NAME=` in a shell or `.env` file falls back to the documented default.
 */
export type RawEnvironment = Readonly<Partial<Record<string, string>>>;

export const CLIENT_VARIABLE_PREFIX = 'NEXT_PUBLIC_';

export function normalizeEnvironment(raw: RawEnvironment): Record<string, string> {
  const normalized: Record<string, string> = {};
  for (const [name, value] of Object.entries(raw)) {
    if (typeof value === 'string' && value !== '') {
      normalized[name] = value;
    }
  }
  return normalized;
}

/**
 * A validation failure. The message names the offending variables and the
 * rule they broke, never the values, so it is safe to print in build logs.
 */
export class EnvironmentValidationError extends Error {
  readonly problems: readonly string[];

  constructor(problems: readonly string[]) {
    super(
      [
        'Invalid environment configuration (values are withheld):',
        ...problems.map((problem) => `  - ${problem}`),
        'See docs/development.md#environment for the published schema.',
      ].join('\n'),
    );
    this.name = 'EnvironmentValidationError';
    this.problems = problems;
  }
}

export function describeIssues(issues: readonly z.core.$ZodIssue[]): string[] {
  return issues.map((issue) => {
    const name = issue.path.length > 0 ? issue.path.map(String).join('.') : '(root)';
    return `${name}: ${issue.message}`;
  });
}
