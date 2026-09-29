/**
 * Fails when a secret-like value, a declared server-only variable or a
 * credential from the build environment appears in browser-delivered build
 * output. Run after `next build`:
 *
 *   node tools/client-bundle-check.ts [--dist <directory>]
 *
 * Exit codes: 0 clean, 1 findings, 2 usage error or no completed build
 * (`BUILD_ID` missing, so the residue of a failed build never passes).
 * Findings name the rule, file and variable or pattern, never the value.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { serverOnlyVariableNames } from '../src/env/server-schema.ts';
import {
  environmentCandidates,
  formatFinding,
  scanArtifact,
  type Finding,
  type ScanContext,
} from './client-bundle-rules.ts';
import { runAsScript } from './timed.ts';

/** Everything under `static/` is served to browsers as-is. */
const STATIC_TEXT_EXTENSIONS = new Set([
  '.js',
  '.mjs',
  '.cjs',
  '.css',
  '.json',
  '.txt',
  '.html',
  '.map',
  '.svg',
  '.xml',
  '.webmanifest',
]);

/** Prerendered documents and React Server Component payloads are also delivered to browsers. */
const PRERENDER_EXTENSIONS = new Set(['.html', '.rsc', '.body', '.meta', '.txt']);

export interface ArtifactSet {
  readonly distDir: string;
  /** Paths relative to `distDir`, sorted. */
  readonly files: readonly string[];
}

function walk(directory: string, accept: (file: string) => boolean): string[] {
  if (!existsSync(directory) || !statSync(directory).isDirectory()) {
    return [];
  }
  const found: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile()) {
      continue;
    }
    const absolute = path.join(entry.parentPath, entry.name);
    if (accept(absolute)) {
      found.push(absolute);
    }
  }
  return found;
}

export function collectClientArtifacts(distDir: string): ArtifactSet {
  const absoluteDist = path.resolve(distDir);
  const files = [
    ...walk(path.join(absoluteDist, 'static'), (file) =>
      STATIC_TEXT_EXTENSIONS.has(path.extname(file).toLowerCase()),
    ),
    ...walk(path.join(absoluteDist, 'server', 'app'), (file) =>
      PRERENDER_EXTENSIONS.has(path.extname(file).toLowerCase()),
    ),
    ...walk(path.join(absoluteDist, 'server', 'pages'), (file) =>
      PRERENDER_EXTENSIONS.has(path.extname(file).toLowerCase()),
    ),
  ]
    .map((file) => path.relative(absoluteDist, file).split(path.sep).join('/'))
    .sort();
  return { distDir: absoluteDist, files };
}

export interface CheckResult {
  readonly artifacts: number;
  readonly candidates: number;
  readonly findings: readonly Finding[];
}

/** `next build` writes `BUILD_ID` last; without it the output is a failed build's residue. */
export function hasCompletedBuild(distDir: string): boolean {
  const buildIdFile = path.join(path.resolve(distDir), 'BUILD_ID');
  return existsSync(buildIdFile) && statSync(buildIdFile).isFile();
}

export function checkClientBundle(distDir: string, context: ScanContext): CheckResult {
  if (!hasCompletedBuild(distDir)) {
    throw new Error(`no completed production build under ${distDir}; run "npm run build" first`);
  }
  const artifacts = collectClientArtifacts(distDir);
  const findings: Finding[] = [];
  for (const file of artifacts.files) {
    const content = readFileSync(path.join(artifacts.distDir, file), 'utf8');
    findings.push(...scanArtifact(file, content, context));
  }
  return {
    artifacts: artifacts.files.length,
    candidates: environmentCandidates(context).length,
    findings,
  };
}

function parseArguments(argv: readonly string[]): { distDir: string } | { error: string } {
  let distDir = '.next';
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--dist') {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('--')) {
        return { error: '--dist requires a directory' };
      }
      distDir = value;
      index += 1;
    } else {
      return { error: `unknown argument: ${argument}` };
    }
  }
  return { distDir };
}

export function main(argv: readonly string[], environment: ScanContext['environment']): number {
  const parsed = parseArguments(argv);
  if ('error' in parsed) {
    console.error(`client-bundle-check: ${parsed.error}`);
    console.error('usage: node tools/client-bundle-check.ts [--dist <directory>]');
    return 2;
  }
  const context: ScanContext = {
    serverOnlyNames: serverOnlyVariableNames,
    environment,
  };
  let result: CheckResult;
  try {
    result = checkClientBundle(parsed.distDir, context);
  } catch (error) {
    console.error(`client-bundle-check: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }
  if (result.artifacts === 0) {
    console.error(
      `client-bundle-check: no browser-delivered artifacts found under ${parsed.distDir}; run "npm run build" first`,
    );
    return 2;
  }
  if (result.findings.length > 0) {
    console.error(
      `client-bundle-check: FAILED with ${result.findings.length} finding(s) in ${result.artifacts} artifact(s) (values withheld)`,
    );
    for (const finding of result.findings) {
      console.error(`  ${formatFinding(finding)}`);
    }
    return 1;
  }
  console.log(
    `client-bundle-check: passed; ${result.artifacts} artifact(s) scanned, ${result.candidates} environment value(s) and ${serverOnlyVariableNames.length} server-only name(s) checked, no findings`,
  );
  return 0;
}

runAsScript(import.meta, () => main(process.argv.slice(2), process.env));
