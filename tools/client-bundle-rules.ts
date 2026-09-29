/**
 * Pure detection rules for the client-bundle secret check. No file or process
 * access lives here so the rules can be unit-tested with synthetic content.
 * Findings never contain the matched text, only the rule, location and the
 * variable or pattern name.
 */

export interface SecretPattern {
  readonly name: string;
  readonly pattern: RegExp;
}

/**
 * High-signal formats of credentials that must never ship to a browser. Each
 * pattern is anchored on a vendor prefix or a PEM header so that ordinary
 * minified code does not trip it.
 */
export const SECRET_PATTERNS: readonly SecretPattern[] = Object.freeze([
  { name: 'private-key-block', pattern: /-----BEGIN (?:[A-Z]+ )*PRIVATE KEY-----/ },
  { name: 'github-token', pattern: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/ },
  { name: 'github-fine-grained-token', pattern: /\bgithub_pat_[A-Za-z0-9_]{22,}\b/ },
  { name: 'aws-access-key-id', pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { name: 'google-api-key', pattern: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { name: 'slack-token', pattern: /\bxox[abprs]-[0-9A-Za-z-]{10,}\b/ },
  { name: 'stripe-live-key', pattern: /\b[sr]k_live_[0-9A-Za-z]{16,}\b/ },
  {
    name: 'json-web-token',
    pattern: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/,
  },
  {
    // Connection strings and other URLs carrying `user:password@`.
    name: 'url-credentials',
    pattern: /\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@"'`]+:[^\s/@"'`]{4,}@/i,
  },
  {
    name: 'secret-assignment',
    pattern:
      /\b(?:secret|password|passwd|api[_-]?key|private[_-]?key|access[_-]?token|refresh[_-]?token|auth[_-]?token|client[_-]?secret)\b\s*["']?\s*[:=]\s*["'`][^"'`\s]{16,}["'`]/i,
  },
]);

/**
 * Environment variable names that conventionally hold credentials. Their
 * values, when present in the build environment, must not appear verbatim in
 * browser-delivered output whatever their declared scope.
 */
export const SECRET_NAME_PATTERN =
  /(?:^|_)(?:SECRET|TOKEN|PASSWORD|PASSWD|PRIVATE_KEY|API_KEY|ACCESS_KEY|SIGNING_KEY|ENCRYPTION_KEY|CREDENTIALS?)(?:_|$)/i;

/** Shorter values are too likely to occur naturally in minified code. */
export const MIN_ENVIRONMENT_VALUE_LENGTH = 8;

export type EnvironmentCandidateReason = 'server-only' | 'secret-name';

export interface EnvironmentCandidate {
  readonly name: string;
  readonly value: string;
  readonly reason: EnvironmentCandidateReason;
}

export type RuleName =
  'secret-pattern' | 'server-only-value' | 'server-only-name' | 'secret-env-value';

export interface Finding {
  readonly rule: RuleName;
  readonly file: string;
  /** Pattern or variable name; never the matched text. */
  readonly subject: string;
  readonly line: number;
  readonly column: number;
  readonly occurrences: number;
}

export interface ScanContext {
  /** Declared server-only variable names (see src/env/server-schema.ts). */
  readonly serverOnlyNames: readonly string[];
  /** Environment at check time, normally `process.env`. */
  readonly environment: Readonly<Partial<Record<string, string>>>;
}

/**
 * Selects the environment values whose presence in client output is a leak:
 * declared server-only variables and anything whose name looks like a
 * credential. Values are compared verbatim and in their JSON-escaped and
 * HTML-escaped forms; encoded or hashed forms are out of scope.
 */
export function environmentCandidates(context: ScanContext): EnvironmentCandidate[] {
  const candidates: EnvironmentCandidate[] = [];
  for (const [name, value] of Object.entries(context.environment)) {
    if (typeof value !== 'string' || value.length < MIN_ENVIRONMENT_VALUE_LENGTH) {
      continue;
    }
    if (context.serverOnlyNames.includes(name)) {
      candidates.push({ name, value, reason: 'server-only' });
    } else if (SECRET_NAME_PATTERN.test(name)) {
      candidates.push({ name, value, reason: 'secret-name' });
    }
  }
  return candidates.sort((left, right) => left.name.localeCompare(right.name));
}

function locate(content: string, index: number): { line: number; column: number } {
  let line = 1;
  let lineStart = 0;
  for (let position = 0; position < index; position += 1) {
    if (content.charCodeAt(position) === 10) {
      line += 1;
      lineStart = position + 1;
    }
  }
  return { line, column: index - lineStart + 1 };
}

function countOccurrences(content: string, needle: string): number {
  let count = 0;
  let index = content.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = content.indexOf(needle, index + needle.length);
  }
  return count;
}

function countMatches(content: string, pattern: RegExp): number {
  const global = new RegExp(
    pattern.source,
    pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`,
  );
  let count = 0;
  while (global.exec(content) !== null) {
    count += 1;
    if (global.lastIndex === 0) {
      break;
    }
  }
  return count;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function htmlEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

/** The value as written into JavaScript strings, JSON payloads and HTML text. */
function verbatimForms(value: string): string[] {
  return [...new Set([value, JSON.stringify(value).slice(1, -1), htmlEscape(value)])];
}

/**
 * Scans one browser-delivered artifact. `file` is only used to label findings.
 */
export function scanArtifact(file: string, content: string, context: ScanContext): Finding[] {
  const findings: Finding[] = [];

  for (const { name, pattern } of SECRET_PATTERNS) {
    const match = pattern.exec(content);
    if (match !== null) {
      findings.push({
        rule: 'secret-pattern',
        file,
        subject: name,
        ...locate(content, match.index),
        occurrences: countMatches(content, pattern),
      });
    }
  }

  for (const candidate of environmentCandidates(context)) {
    for (const form of verbatimForms(candidate.value)) {
      const index = content.indexOf(form);
      if (index !== -1) {
        findings.push({
          rule: candidate.reason === 'server-only' ? 'server-only-value' : 'secret-env-value',
          file,
          subject: candidate.name,
          ...locate(content, index),
          occurrences: countOccurrences(content, form),
        });
        break;
      }
    }
  }

  for (const name of context.serverOnlyNames) {
    const pattern = new RegExp(`\\b${escapeRegExp(name)}\\b`);
    const match = pattern.exec(content);
    if (match !== null) {
      findings.push({
        rule: 'server-only-name',
        file,
        subject: name,
        ...locate(content, match.index),
        occurrences: countMatches(content, pattern),
      });
    }
  }

  return findings;
}

export function formatFinding(finding: Finding): string {
  const plural = finding.occurrences === 1 ? 'occurrence' : 'occurrences';
  return `${finding.rule} [${finding.subject}] ${finding.file}:${finding.line}:${finding.column} (${finding.occurrences} ${plural})`;
}
