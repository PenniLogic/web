import { describe, expect, it } from 'vitest';

import {
  environmentCandidates,
  formatFinding,
  MIN_ENVIRONMENT_VALUE_LENGTH,
  scanArtifact,
  SECRET_NAME_PATTERN,
  SECRET_PATTERNS,
  type ScanContext,
} from '../tools/client-bundle-rules.ts';

const EMPTY: ScanContext = { serverOnlyNames: [], environment: {} };

/** Token-shaped fixtures are assembled at runtime so no literal here looks like a credential. */
const fixtures = {
  githubToken: ['ghp', 'A'.repeat(36)].join('_'),
  fineGrainedToken: ['github', 'pat', `${'1'.repeat(22)}_${'x'.repeat(20)}`].join('_'),
  awsKeyId: ['AKIA', 'Q'.repeat(16)].join(''),
  googleKey: ['AIza', 'b'.repeat(35)].join(''),
  slackToken: ['xoxb', '1234567890', 'abcdefghijkl'].join('-'),
  stripeKey: ['sk', 'live', 'z'.repeat(24)].join('_'),
  jwt: ['eyJhbGciOiJub25lIn0', 'eyJzdWIiOiJ0ZXN0In0', 'signature_00'].join('.'),
  pemHeader: ['-----BEGIN', 'RSA PRIVATE KEY-----'].join(' '),
  assignment: `apiKey: "${'k'.repeat(20)}"`,
  connectionString: ['postgres://app_user', 'p4ss-word@db.internal.test:5432/app'].join(':'),
};

describe('SECRET_PATTERNS', () => {
  it.each([
    ['github-token', fixtures.githubToken],
    ['github-fine-grained-token', fixtures.fineGrainedToken],
    ['aws-access-key-id', fixtures.awsKeyId],
    ['google-api-key', fixtures.googleKey],
    ['slack-token', fixtures.slackToken],
    ['stripe-live-key', fixtures.stripeKey],
    ['json-web-token', fixtures.jwt],
    ['private-key-block', fixtures.pemHeader],
    ['secret-assignment', fixtures.assignment],
    ['url-credentials', fixtures.connectionString],
  ])('%s matches its fixture inside minified-looking code', (name, value) => {
    const content = `!function(){var e="${value}";return e}();`;
    const findings = scanArtifact('static/chunks/a.js', content, EMPTY);
    expect(findings.map((finding) => finding.subject)).toContain(name);
    const finding = findings.find((candidate) => candidate.subject === name);
    expect(finding?.rule).toBe('secret-pattern');
    expect(finding?.occurrences).toBe(1);
  });

  it('does not match ordinary framework output', () => {
    const content = [
      'var e={NODE_ENV:"production"},t="sk_test_short",n="AKIAshortlower";',
      'function token(e){return e.split(".")}',
      'const password = getPassword();',
      'const apiKey = process.env.NEXT_PUBLIC_APP_ENV;',
      '"eyJ.not.a.jwt"',
      'gh_not_a_token',
      'fetch("https://api.example.test:8443/v1/items?x=1")',
      'new URL("postgres://db.internal.test:5432/app")',
      '"mailto:someone@example.test"',
      'href="https://user@example.test/profile"',
    ].join('\n');
    expect(scanArtifact('static/chunks/b.js', content, EMPTY)).toEqual([]);
  });

  it('covers every rule name exactly once', () => {
    const names = SECRET_PATTERNS.map((pattern) => pattern.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe('environmentCandidates', () => {
  it('selects server-only values and secret-looking names, skipping short values', () => {
    const context: ScanContext = {
      serverOnlyNames: ['API_BASE_URL', 'SHORT_ONE'],
      environment: {
        API_BASE_URL: 'https://api.example.test',
        SHORT_ONE: 'abc',
        DATABASE_PASSWORD: 'correct-horse-battery',
        SESSION_SIGNING_KEY: 'k'.repeat(MIN_ENVIRONMENT_VALUE_LENGTH),
        HOME: '/home/developer',
        NEXT_PUBLIC_APP_ENV: 'production',
      },
    };
    expect(environmentCandidates(context)).toEqual([
      { name: 'API_BASE_URL', value: 'https://api.example.test', reason: 'server-only' },
      { name: 'DATABASE_PASSWORD', value: 'correct-horse-battery', reason: 'secret-name' },
      {
        name: 'SESSION_SIGNING_KEY',
        value: 'k'.repeat(MIN_ENVIRONMENT_VALUE_LENGTH),
        reason: 'secret-name',
      },
    ]);
  });

  it.each([
    'API_KEY',
    'WEB_API_KEY',
    'SECRET',
    'MY_SECRET_VALUE',
    'ACCESS_TOKEN',
    'DB_PASSWORD',
    'PRIVATE_KEY_PEM',
    'GOOGLE_CREDENTIALS',
    'AWS_ACCESS_KEY',
  ])('%s is treated as a credential name', (name) => {
    expect(SECRET_NAME_PATTERN.test(name)).toBe(true);
  });

  it.each(['PATH', 'HOME', 'NODE_ENV', 'NEXT_PUBLIC_APP_ENV', 'TOKENIZER_MODE', 'SECRETARY'])(
    '%s is not treated as a credential name',
    (name) => {
      expect(SECRET_NAME_PATTERN.test(name)).toBe(false);
    },
  );
});

describe('scanArtifact with environment values', () => {
  const context: ScanContext = {
    serverOnlyNames: ['UPSTREAM_BASE_URL'],
    environment: {
      UPSTREAM_BASE_URL: 'https://upstream.example.test/v1',
      WEB_SIGNING_SECRET: 'quoted "value" with specials',
    },
  };

  it('reports a server-only value verbatim in client output', () => {
    const content = 'fetch("https://upstream.example.test/v1/accounts")';
    const findings = scanArtifact('static/chunks/c.js', content, context);
    expect(findings).toEqual([
      expect.objectContaining({
        rule: 'server-only-value',
        subject: 'UPSTREAM_BASE_URL',
        file: 'static/chunks/c.js',
        line: 1,
        column: 8,
        occurrences: 1,
      }),
    ]);
  });

  it('reports a server-only variable name in client output', () => {
    const content = 'const missing = "UPSTREAM_BASE_URL is required";';
    const findings = scanArtifact('static/chunks/d.js', content, context);
    expect(findings.map((finding) => finding.rule)).toEqual(['server-only-name']);
  });

  it('does not flag a longer identifier that merely contains the name', () => {
    const content = 'const x = "MY_UPSTREAM_BASE_URL_SUFFIX";';
    expect(scanArtifact('static/chunks/e.js', content, context)).toEqual([]);
  });

  it('reports a credential-named value in its JSON-escaped form', () => {
    const content = `self.__next_f.push([1,"quoted \\"value\\" with specials"])`;
    const findings = scanArtifact('server/app/index.html', content, context);
    expect(findings).toEqual([
      expect.objectContaining({ rule: 'secret-env-value', subject: 'WEB_SIGNING_SECRET' }),
    ]);
  });

  it('reports a credential-named value in its HTML-escaped form', () => {
    const content = '<p>quoted &quot;value&quot; with specials</p>';
    const findings = scanArtifact('server/app/index.html', content, context);
    expect(findings).toEqual([
      expect.objectContaining({ rule: 'secret-env-value', subject: 'WEB_SIGNING_SECRET' }),
    ]);
  });

  it('locates findings on later lines', () => {
    const content = 'line one\nline two\n  https://upstream.example.test/v1';
    const [finding] = scanArtifact('server/app/index.rsc', content, context);
    expect(finding?.line).toBe(3);
    expect(finding?.column).toBe(3);
  });

  it('never includes the matched value in findings or their formatted form', () => {
    const content = 'x="https://upstream.example.test/v1"';
    const [finding] = scanArtifact('static/chunks/f.js', content, context);
    const serialized = JSON.stringify(finding) + formatFinding(finding!);
    expect(serialized).not.toContain('upstream.example.test');
    expect(formatFinding(finding!)).toBe(
      'server-only-value [UPSTREAM_BASE_URL] static/chunks/f.js:1:4 (1 occurrence)',
    );
  });
});
