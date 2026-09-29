/**
 * Reports what a production build sends to browsers: per-route First Load JS,
 * CSS, prerendered HTML and RSC payload sizes plus totals for every static
 * asset, raw and gzip. Printed to stdout and, inside GitHub Actions, appended
 * to the job summary so build size is visible per pipeline run.
 *
 *   node tools/build-report.ts [--dist <directory>]
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { gzipSync } from 'node:zlib';

import { appendStepSummary, runAsScript } from './timed.ts';

export interface Size {
  readonly raw: number;
  readonly gzip: number;
}

export interface RouteReport {
  readonly route: string;
  readonly entry: string;
  readonly firstLoadJs: Size;
  readonly firstLoadJsFiles: number;
  readonly css: Size;
  readonly html: Size | undefined;
  readonly rsc: Size | undefined;
}

export interface CategoryReport {
  readonly category: string;
  readonly files: number;
  readonly size: Size;
}

export interface BuildReport {
  readonly distDir: string;
  readonly buildId: string;
  readonly routes: readonly RouteReport[];
  readonly categories: readonly CategoryReport[];
  readonly sharedFrameworkJs: CategoryReport;
  readonly polyfills: CategoryReport;
}

const ZERO: Size = { raw: 0, gzip: 0 };

function add(left: Size, right: Size): Size {
  return { raw: left.raw + right.raw, gzip: left.gzip + right.gzip };
}

function sizeOf(file: string): Size {
  const content = readFileSync(file);
  return { raw: content.length, gzip: gzipSync(content).length };
}

function sizeIfExists(file: string): Size | undefined {
  return existsSync(file) && statSync(file).isFile() ? sizeOf(file) : undefined;
}

function sumFiles(distDir: string, files: Iterable<string>): { size: Size; count: number } {
  let size = ZERO;
  let count = 0;
  for (const file of files) {
    const measured = sizeIfExists(path.join(distDir, file));
    if (measured !== undefined) {
      size = add(size, measured);
      count += 1;
    }
  }
  return { size, count };
}

export function formatBytes(bytes: number): string {
  return bytes < 1000 ? `${bytes} B` : `${(bytes / 1000).toFixed(1)} kB`;
}

function readJson(file: string): unknown {
  return JSON.parse(readFileSync(file, 'utf8')) as unknown;
}

function normalizeAsset(asset: string): string {
  return asset.replace(/^\/_next\//, '').replace(/^\//, '');
}

interface ClientReferenceManifest {
  readonly clientModules?: Record<string, { readonly chunks?: readonly unknown[] }>;
  readonly entryCSSFiles?: Record<string, readonly unknown[]>;
  readonly entryJSFiles?: Record<string, readonly unknown[]>;
}

/** Manifest asset entries are either path strings or `{ path, inlined }` records. */
function assetPath(asset: unknown): string | undefined {
  if (typeof asset === 'string') {
    return normalizeAsset(asset);
  }
  if (typeof asset === 'object' && asset !== null && 'path' in asset) {
    const value = (asset as { path?: unknown }).path;
    return typeof value === 'string' ? normalizeAsset(value) : undefined;
  }
  return undefined;
}

/**
 * Turbopack writes each route's client manifest as a script assigning into
 * `globalThis.__RSC_MANIFEST`; it is evaluated in an isolated context so the
 * chunk list can be read without importing build output into this process.
 */
function loadClientReferenceManifest(
  file: string,
  entry: string,
): ClientReferenceManifest | undefined {
  if (!existsSync(file)) {
    return undefined;
  }
  const sandbox: { __RSC_MANIFEST?: Record<string, ClientReferenceManifest> } = {};
  vm.runInNewContext(readFileSync(file, 'utf8'), sandbox, { filename: file, timeout: 5000 });
  return sandbox.__RSC_MANIFEST?.[entry];
}

function routeArtifacts(distDir: string, route: string, extension: string): string {
  const name = route === '/' ? 'index' : route.replace(/^\//, '');
  return path.join(distDir, 'server', 'app', `${name}${extension}`);
}

function collectRoutes(distDir: string, rootMainFiles: readonly string[]): RouteReport[] {
  const routesFile = path.join(distDir, 'app-path-routes-manifest.json');
  if (!existsSync(routesFile)) {
    return [];
  }
  const entries = readJson(routesFile) as Record<string, string>;
  const reports: RouteReport[] = [];
  for (const [entry, route] of Object.entries(entries)) {
    if (!entry.endsWith('/page')) {
      continue;
    }
    const manifestFile = path.join(
      distDir,
      'server',
      'app',
      `${entry.replace(/^\//, '')}_client-reference-manifest.js`,
    );
    const manifest = loadClientReferenceManifest(manifestFile, entry);
    const scripts = new Set(rootMainFiles);
    const styles = new Set<string>();
    const classify = (asset: unknown): void => {
      const file = assetPath(asset);
      if (file === undefined) {
        return;
      }
      if (file.endsWith('.css')) {
        styles.add(file);
      } else if (file.endsWith('.js')) {
        scripts.add(file);
      }
    };
    for (const moduleEntry of Object.values(manifest?.clientModules ?? {})) {
      (moduleEntry.chunks ?? []).forEach(classify);
    }
    for (const assets of Object.values(manifest?.entryJSFiles ?? {})) {
      assets.forEach(classify);
    }
    for (const assets of Object.values(manifest?.entryCSSFiles ?? {})) {
      assets.forEach(classify);
    }
    const js = sumFiles(distDir, scripts);
    reports.push({
      route,
      entry,
      firstLoadJs: js.size,
      firstLoadJsFiles: js.count,
      css: sumFiles(distDir, styles).size,
      html: sizeIfExists(routeArtifacts(distDir, route, '.html')),
      rsc: sizeIfExists(routeArtifacts(distDir, route, '.rsc')),
    });
  }
  return reports.sort((left, right) => left.route.localeCompare(right.route));
}

function categorize(file: string): string {
  const extension = path.extname(file).toLowerCase();
  if (extension === '.js' || extension === '.mjs') {
    return 'JavaScript';
  }
  if (extension === '.css') {
    return 'CSS';
  }
  return 'Other';
}

function collectCategories(distDir: string): CategoryReport[] {
  const staticDir = path.join(distDir, 'static');
  const totals = new Map<string, { files: number; size: Size }>();
  if (existsSync(staticDir)) {
    for (const entry of readdirSync(staticDir, { withFileTypes: true, recursive: true })) {
      if (!entry.isFile()) {
        continue;
      }
      const file = path.join(entry.parentPath, entry.name);
      const category = categorize(file);
      const current = totals.get(category) ?? { files: 0, size: ZERO };
      totals.set(category, { files: current.files + 1, size: add(current.size, sizeOf(file)) });
    }
  }
  const categories = ['JavaScript', 'CSS', 'Other'].map((category) => {
    const current = totals.get(category) ?? { files: 0, size: ZERO };
    return { category, files: current.files, size: current.size };
  });
  const total = categories.reduce(
    (sum, current) => ({ files: sum.files + current.files, size: add(sum.size, current.size) }),
    { files: 0, size: ZERO },
  );
  return [...categories, { category: 'Total', ...total }];
}

export function buildReport(distDir: string): BuildReport {
  const absoluteDist = path.resolve(distDir);
  const buildIdFile = path.join(absoluteDist, 'BUILD_ID');
  if (!existsSync(buildIdFile)) {
    throw new Error(`no production build found under ${distDir}; run "npm run build" first`);
  }
  const buildManifest = readJson(path.join(absoluteDist, 'build-manifest.json')) as {
    readonly rootMainFiles?: readonly string[];
    readonly polyfillFiles?: readonly string[];
  };
  const rootMainFiles = buildManifest.rootMainFiles ?? [];
  const polyfillFiles = buildManifest.polyfillFiles ?? [];
  const shared = sumFiles(absoluteDist, rootMainFiles);
  const polyfills = sumFiles(absoluteDist, polyfillFiles);
  return {
    distDir: absoluteDist,
    buildId: readFileSync(buildIdFile, 'utf8').trim(),
    routes: collectRoutes(absoluteDist, rootMainFiles),
    categories: collectCategories(absoluteDist),
    sharedFrameworkJs: { category: 'Shared framework JS', files: shared.count, size: shared.size },
    polyfills: { category: 'Legacy polyfills', files: polyfills.count, size: polyfills.size },
  };
}

function optional(size: Size | undefined): string {
  return size === undefined ? '—' : formatBytes(size.raw);
}

export function renderMarkdown(report: BuildReport): string {
  const lines: string[] = [
    '## Web build report',
    '',
    `Build ID \`${report.buildId}\`; sizes are bytes on disk (raw) and gzip-compressed.`,
    '',
    '| Route | Entry | First Load JS (gzip) | First Load JS (raw) | JS files | CSS (gzip) | HTML (raw) | RSC (raw) |',
    '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |',
  ];
  for (const route of report.routes) {
    lines.push(
      `| ${route.route} | ${route.entry} | ${formatBytes(route.firstLoadJs.gzip)} | ${formatBytes(route.firstLoadJs.raw)} | ${route.firstLoadJsFiles} | ${formatBytes(route.css.gzip)} | ${optional(route.html)} | ${optional(route.rsc)} |`,
    );
  }
  lines.push(
    '',
    '| Static assets served to browsers | Files | Raw | Gzip |',
    '| --- | ---: | ---: | ---: |',
  );
  for (const category of report.categories) {
    const label = category.category === 'Total' ? '**Total**' : category.category;
    lines.push(
      `| ${label} | ${category.files} | ${formatBytes(category.size.raw)} | ${formatBytes(category.size.gzip)} |`,
    );
  }
  for (const extra of [report.sharedFrameworkJs, report.polyfills]) {
    lines.push(
      `| ${extra.category} | ${extra.files} | ${formatBytes(extra.size.raw)} | ${formatBytes(extra.size.gzip)} |`,
    );
  }
  lines.push('');
  return lines.join('\n');
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

export function main(argv: readonly string[]): number {
  const parsed = parseArguments(argv);
  if ('error' in parsed) {
    console.error(`build-report: ${parsed.error}`);
    console.error('usage: node tools/build-report.ts [--dist <directory>]');
    return 2;
  }
  let report: BuildReport;
  try {
    report = buildReport(parsed.distDir);
  } catch (error) {
    console.error(`build-report: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }
  const markdown = renderMarkdown(report);
  console.log(markdown);
  appendStepSummary(markdown);
  return 0;
}

runAsScript(import.meta, () => main(process.argv.slice(2)));
