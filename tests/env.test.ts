import { describe, expect, it } from 'vitest';

import { clientVariableNames, parseClientEnvironment } from '@/env/client-schema';
import {
  parseServerEnvironment,
  serverOnlyVariableNames,
  serverVariableNames,
} from '@/env/server-schema';
import { EnvironmentValidationError, normalizeEnvironment } from '@/env/shared';
import { undeclaredClientVariables, validateEnvironment } from '@/env/validate';

const SECRET_LOOKING_VALUE = 'planted-value-that-must-never-be-echoed-0123456789';

describe('validateEnvironment', () => {
  it('accepts an empty environment with documented defaults', () => {
    const result = validateEnvironment({});
    expect(result.client).toEqual({ NEXT_PUBLIC_APP_ENV: 'local' });
    expect(result.server).toEqual({ NODE_ENV: 'development' });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.client)).toBe(true);
    expect(Object.isFrozen(result.server)).toBe(true);
  });

  it('accepts every declared value', () => {
    for (const appEnv of ['local', 'preview', 'production']) {
      for (const nodeEnv of ['development', 'test', 'production']) {
        const result = validateEnvironment({ NEXT_PUBLIC_APP_ENV: appEnv, NODE_ENV: nodeEnv });
        expect(result.client.NEXT_PUBLIC_APP_ENV).toBe(appEnv);
        expect(result.server.NODE_ENV).toBe(nodeEnv);
      }
    }
  });

  it('rejects an unknown application environment', () => {
    expect(() => validateEnvironment({ NEXT_PUBLIC_APP_ENV: 'staging' })).toThrow(
      EnvironmentValidationError,
    );
  });

  it('rejects an unknown NODE_ENV', () => {
    expect(() => validateEnvironment({ NODE_ENV: 'prod' })).toThrow(EnvironmentValidationError);
  });

  it('rejects undeclared browser-visible variables', () => {
    expect(() => validateEnvironment({ NEXT_PUBLIC_UNDECLARED: 'anything' })).toThrow(
      /NEXT_PUBLIC_UNDECLARED: undeclared NEXT_PUBLIC_ variable/,
    );
  });

  it('reports every problem at once, naming variables but never values', () => {
    let caught: unknown;
    try {
      validateEnvironment({
        NEXT_PUBLIC_APP_ENV: SECRET_LOOKING_VALUE,
        NODE_ENV: SECRET_LOOKING_VALUE,
        NEXT_PUBLIC_LEAK: SECRET_LOOKING_VALUE,
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(EnvironmentValidationError);
    const error = caught as EnvironmentValidationError;
    expect(error.problems).toHaveLength(3);
    expect(error.problems.join('\n')).toMatch(/NEXT_PUBLIC_APP_ENV/);
    expect(error.problems.join('\n')).toMatch(/NODE_ENV/);
    expect(error.problems.join('\n')).toMatch(/NEXT_PUBLIC_LEAK/);
    expect(error.message).not.toContain(SECRET_LOOKING_VALUE);
    expect(error.problems.join('\n')).not.toContain(SECRET_LOOKING_VALUE);
    expect(error.message).toContain('values are withheld');
  });

  it('treats empty strings as unset so defaults apply', () => {
    const result = validateEnvironment({ NEXT_PUBLIC_APP_ENV: '', NODE_ENV: '' });
    expect(result.client.NEXT_PUBLIC_APP_ENV).toBe('local');
    expect(result.server.NODE_ENV).toBe('development');
  });

  it('ignores unrelated variables such as those in a developer shell', () => {
    expect(() => validateEnvironment({ PATH: '/usr/bin', HOME: '/home/dev' })).not.toThrow();
  });
});

describe('client and server schemas', () => {
  it('only declares NEXT_PUBLIC_ variables as browser-visible', () => {
    expect(clientVariableNames.length).toBeGreaterThan(0);
    for (const name of clientVariableNames) {
      expect(name.startsWith('NEXT_PUBLIC_')).toBe(true);
    }
  });

  it('never declares a NEXT_PUBLIC_ variable on the server side', () => {
    expect(serverVariableNames.length).toBeGreaterThan(0);
    for (const name of serverVariableNames) {
      expect(name.startsWith('NEXT_PUBLIC_')).toBe(false);
    }
  });

  it('exempts only NODE_ENV from the server-only leak check', () => {
    expect(serverVariableNames).toContain('NODE_ENV');
    expect(serverOnlyVariableNames).not.toContain('NODE_ENV');
    expect(serverOnlyVariableNames).toEqual(
      serverVariableNames.filter((name) => name !== 'NODE_ENV'),
    );
  });

  it('parses the client environment on its own', () => {
    expect(parseClientEnvironment({ NEXT_PUBLIC_APP_ENV: 'preview' })).toEqual({
      NEXT_PUBLIC_APP_ENV: 'preview',
    });
    expect(() => parseClientEnvironment({ NEXT_PUBLIC_APP_ENV: 'nope' })).toThrow(
      EnvironmentValidationError,
    );
  });

  it('parses the server environment on its own', () => {
    expect(parseServerEnvironment({ NODE_ENV: 'test' })).toEqual({ NODE_ENV: 'test' });
    expect(() => parseServerEnvironment({ NODE_ENV: 'nope' })).toThrow(EnvironmentValidationError);
  });

  it('lists undeclared NEXT_PUBLIC_ variables in sorted order', () => {
    expect(
      undeclaredClientVariables({
        NEXT_PUBLIC_ZETA: '1',
        NEXT_PUBLIC_ALPHA: '1',
        NEXT_PUBLIC_APP_ENV: 'local',
        OTHER: '1',
      }),
    ).toEqual(['NEXT_PUBLIC_ALPHA', 'NEXT_PUBLIC_ZETA']);
  });

  it('normalizes by dropping undefined and empty values', () => {
    expect(normalizeEnvironment({ A: 'x', B: '', C: undefined })).toEqual({ A: 'x' });
  });
});
