import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { PLANTED_FIXTURE_DIR, PLANTED_ROUTE_SEGMENT } from '../tools/planted-secret-check.ts';

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));
const appDir = path.join(repositoryRoot, 'src', 'app');

/** Directory names, relative to src/app, using forward slashes. */
function routeDirectories(): string[] {
  return readdirSync(appDir, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) =>
      path.relative(appDir, path.join(entry.parentPath, entry.name)).split(path.sep).join('/'),
    )
    .sort();
}

function routeGroups(): string[] {
  return routeDirectories()
    .flatMap((directory) => directory.split('/'))
    .filter((segment) => segment.startsWith('(') && segment.endsWith(')'));
}

const ADMIN_LIKE =
  /admin|administra|backoffice|back-office|staff|internal|operator|ops\b|console|dashboard\/admin/i;

describe('application routes', () => {
  it('has the customer route group and no other group', () => {
    expect(new Set(routeGroups())).toEqual(new Set(['(customer)']));
  });

  it('has no administrative route group or segment', () => {
    for (const directory of routeDirectories()) {
      expect(directory, `unexpected admin-like route directory: ${directory}`).not.toMatch(
        ADMIN_LIKE,
      );
    }
  });

  it('keeps every page inside the customer group', () => {
    const pages = readdirSync(appDir, { withFileTypes: true, recursive: true })
      .filter((entry) => entry.isFile() && /^page\.(tsx|ts|jsx|js|mdx)$/.test(entry.name))
      .map((entry) => path.relative(appDir, entry.parentPath).split(path.sep).join('/'));
    expect(pages.length).toBeGreaterThan(0);
    for (const page of pages) {
      expect(page.startsWith('(customer)'), `page outside customer group: ${page}`).toBe(true);
    }
  });

  it('does not define middleware or proxy files that could hide admin routing', () => {
    for (const name of ['middleware.ts', 'middleware.js', 'proxy.ts', 'proxy.js']) {
      expect(existsSync(path.join(repositoryRoot, 'src', name))).toBe(false);
      expect(existsSync(path.join(repositoryRoot, name))).toBe(false);
    }
  });

  it('carries no leftover planted-secret fixture', () => {
    expect(existsSync(path.join(repositoryRoot, PLANTED_FIXTURE_DIR))).toBe(false);
    expect(routeDirectories().some((directory) => directory.includes(PLANTED_ROUTE_SEGMENT))).toBe(
      false,
    );
  });

  it('does not wire analytics or error reporting into the layout', () => {
    const layout = readFileSync(path.join(appDir, 'layout.tsx'), 'utf8');
    expect(layout).not.toMatch(/<Script|analytics|gtag|sentry|datadog|posthog|segment/i);
  });
});
