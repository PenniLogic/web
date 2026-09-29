import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  expectations,
  missingExpectations,
  PLANTED_ASSIGNMENT_KEY,
  PLANTED_ASSIGNMENT_VALUE,
  PLANTED_ENVIRONMENT_VARIABLE,
  plantedLiterals,
} from '../tools/planted-secret-check.ts';
import { scanArtifact, SECRET_PATTERNS } from '../tools/client-bundle-rules.ts';
import {
  formatSeconds,
  parseTimedArguments,
  planInvocation,
  quoteForCmd,
  runAsScript,
} from '../tools/timed.ts';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('planted literals', () => {
  it('each trips exactly the detection rule it is named after', () => {
    const literals = plantedLiterals();
    const ruleNames = new Set(SECRET_PATTERNS.map((pattern) => pattern.name));
    for (const [rule, value] of Object.entries(literals)) {
      expect(ruleNames.has(rule), `unknown rule ${rule}`).toBe(true);
      const findings = scanArtifact('static/chunks/x.js', `var v="${value}";`, {
        serverOnlyNames: [],
        environment: {},
      });
      expect(findings.map((finding) => finding.subject)).toEqual([rule]);
    }
  });

  it('cover the credential formats a customer app is most likely to leak', () => {
    expect(Object.keys(plantedLiterals())).toEqual(
      expect.arrayContaining([
        'stripe-live-key',
        'aws-access-key-id',
        'json-web-token',
        'url-credentials',
      ]),
    );
  });

  it('include an object-literal assignment that survives minification', () => {
    const minified = `var s={${PLANTED_ASSIGNMENT_KEY}:"${PLANTED_ASSIGNMENT_VALUE}",label:"planted"};`;
    const findings = scanArtifact('static/chunks/x.js', minified, {
      serverOnlyNames: [],
      environment: {},
    });
    expect(findings.map((finding) => finding.subject)).toEqual(['secret-assignment']);
  });

  it('are obviously synthetic', () => {
    for (const value of [...Object.values(plantedLiterals()), PLANTED_ASSIGNMENT_VALUE]) {
      expect(value.toLowerCase()).toMatch(/planted/);
    }
  });
});

describe('expectations', () => {
  it('require every literal and the assignment in client JS and the server value in prerendered output', () => {
    const literals = plantedLiterals();
    const expected = expectations(literals);
    expect(expected).toHaveLength(Object.keys(literals).length + 2);
    expect(expected).toContainEqual({
      rule: 'secret-pattern',
      subject: 'secret-assignment',
      location: 'static/',
    });
    expect(expected.at(-1)).toEqual({
      rule: 'secret-env-value',
      subject: PLANTED_ENVIRONMENT_VARIABLE,
      location: 'server/',
    });
  });

  it('report what the check missed', () => {
    const expected = expectations({ 'stripe-live-key': 'x' });
    const found = [
      {
        rule: 'secret-pattern' as const,
        subject: 'stripe-live-key',
        file: 'server/app/x.html',
        line: 1,
        column: 1,
        occurrences: 1,
      },
    ];
    // Found in HTML only, not in a client chunk, so the JS expectation is still missing.
    expect(missingExpectations(expected, found).map((item) => item.subject)).toEqual([
      'stripe-live-key',
      'secret-assignment',
      PLANTED_ENVIRONMENT_VARIABLE,
    ]);
    expect(
      missingExpectations(expected, [
        { ...found[0]!, file: 'static/chunks/x.js' },
        { ...found[0]!, subject: 'secret-assignment', file: 'static/chunks/x.js' },
        {
          rule: 'secret-env-value',
          subject: PLANTED_ENVIRONMENT_VARIABLE,
          file: 'server/app/x.rsc',
          line: 1,
          column: 1,
          occurrences: 1,
        },
      ]),
    ).toEqual([]);
  });
});

describe('runAsScript', () => {
  const url = 'file:///repo/tools/example.ts';

  it('runs the tool and forwards its exit status when the module is the entry point', () => {
    const previous = process.exitCode;
    try {
      runAsScript({ url, main: true } as ImportMeta, () => 3);
      expect(process.exitCode).toBe(3);
    } finally {
      process.exitCode = previous;
    }
  });

  it('does nothing when the module is merely imported', () => {
    const run = vi.fn(() => 0);
    runAsScript({ url, main: false } as ImportMeta, run);
    expect(run).not.toHaveBeenCalled();
  });

  it('fails closed on a runtime without import.meta.main instead of silently passing', () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('exit called');
    }) as never);
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const run = vi.fn(() => 0);
    expect(() => runAsScript({ url } as ImportMeta, run)).toThrow('exit called');
    expect(exit).toHaveBeenCalledWith(2);
    expect(run).not.toHaveBeenCalled();
    expect(error.mock.calls.flat().join('\n')).toMatch(/Node >= 24\.2/);
  });
});

describe('timed helpers', () => {
  it('formats durations in seconds', () => {
    expect(formatSeconds(1234)).toBe('1.23 s');
    expect(formatSeconds(0)).toBe('0.00 s');
  });

  it('parses label, separator and command', () => {
    expect(parseTimedArguments(['type-check', '--', 'tsc', '--noEmit'])).toEqual({
      label: 'type-check',
      command: 'tsc',
      args: ['--noEmit'],
    });
    expect(parseTimedArguments(['type-check', 'tsc'])).toBeUndefined();
    expect(parseTimedArguments(['type-check', '--'])).toBeUndefined();
    expect(parseTimedArguments([])).toBeUndefined();
  });

  it('spawns directly on POSIX and through one quoted command line on Windows', () => {
    expect(planInvocation('tsc', ['--noEmit', 'a b'], 'linux')).toEqual({
      command: 'tsc',
      args: ['--noEmit', 'a b'],
      shell: false,
    });
    expect(planInvocation('tsc', ['--noEmit', 'a b'], 'win32')).toEqual({
      command: 'tsc --noEmit "a b"',
      args: [],
      shell: true,
    });
  });

  it('quotes arguments that cmd.exe would otherwise split or interpret', () => {
    expect(quoteForCmd('--noEmit')).toBe('--noEmit');
    expect(quoteForCmd('path\\to\\file.ts')).toBe('path\\to\\file.ts');
    expect(quoteForCmd('has space')).toBe('"has space"');
    expect(quoteForCmd('say "hi"')).toBe('"say \\"hi\\""');
    expect(quoteForCmd('a&b')).toBe('"a&b"');
    expect(quoteForCmd('trailing\\')).toBe('trailing\\');
    expect(quoteForCmd('has space\\')).toBe('"has space\\\\"');
  });
});
