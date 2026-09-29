import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  checkClientBundle,
  collectClientArtifacts,
  hasCompletedBuild,
  main,
} from '../tools/client-bundle-check.ts';

let distDir: string;

function write(relative: string, content: string): void {
  const file = path.join(distDir, relative);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content, 'utf8');
}

function writeCleanBuild(): void {
  write('BUILD_ID', 'test-build');
  write('export-marker.json', '{"version":1}');
  write('static/chunks/main.js', '!function(){console.log("hello")}();');
  write('static/chunks/app.css', 'body{margin:0}');
  write('static/media/logo.woff2', 'binary-font-content');
  write('server/app/index.html', '<!doctype html><html><body>PenniLogic</body></html>');
  write('server/app/index.rsc', '1:["$","html",null,{}]');
  write('server/app/page.js', 'module.exports = "server bundle, not delivered to browsers";');
  write('server/chunks/ssr/x.js', 'server chunk');
}

/** What `next build` leaves behind when it fails at type-check: chunks, no BUILD_ID. */
function writeFailedBuildResidue(): void {
  write('static/chunks/main.js', '!function(){console.log("partial")}();');
  write('server/app/index.html', '<!doctype html><html><body>partial</body></html>');
}

/**
 * What `next build` leaves behind when it fails while prerendering: BUILD_ID
 * is already written, static generation aborted, export-marker.json absent.
 */
function writePrerenderFailureResidue(): void {
  write('BUILD_ID', 'aborted-build');
  write('build-manifest.json', '{"rootMainFiles":[],"polyfillFiles":[]}');
  write('static/chunks/main.js', '!function(){console.log("partial")}();');
  write('server/app/index.html', '<!doctype html><html><body>partial</body></html>');
}

beforeEach(() => {
  distDir = mkdtempSync(path.join(tmpdir(), 'web-bundle-check-'));
});

afterEach(() => {
  rmSync(distDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('collectClientArtifacts', () => {
  it('selects only browser-delivered files', () => {
    writeCleanBuild();
    expect(collectClientArtifacts(distDir).files).toEqual([
      'server/app/index.html',
      'server/app/index.rsc',
      'static/chunks/app.css',
      'static/chunks/main.js',
    ]);
  });

  it('returns nothing for a missing directory', () => {
    expect(collectClientArtifacts(path.join(distDir, 'missing')).files).toEqual([]);
  });
});

describe('checkClientBundle', () => {
  it('passes a clean build', () => {
    writeCleanBuild();
    const result = checkClientBundle(distDir, { serverOnlyNames: [], environment: {} });
    expect(result.artifacts).toBe(4);
    expect(result.findings).toEqual([]);
  });

  it('refuses the residue of a build that failed at type-check', () => {
    writeFailedBuildResidue();
    expect(hasCompletedBuild(distDir)).toBe(false);
    expect(() => checkClientBundle(distDir, { serverOnlyNames: [], environment: {} })).toThrow(
      /no completed production build/,
    );
  });

  it('refuses the residue of a build that failed while prerendering (BUILD_ID present)', () => {
    writePrerenderFailureResidue();
    expect(hasCompletedBuild(distDir)).toBe(false);
    expect(() => checkClientBundle(distDir, { serverOnlyNames: [], environment: {} })).toThrow(
      /no completed production build/,
    );
  });

  it('fails when a server-only value reaches a client chunk', () => {
    writeCleanBuild();
    write('static/chunks/leak.js', 'const u="https://internal.example.test/api";');
    const result = checkClientBundle(distDir, {
      serverOnlyNames: ['INTERNAL_API_URL'],
      environment: { INTERNAL_API_URL: 'https://internal.example.test/api' },
    });
    expect(result.findings).toEqual([
      expect.objectContaining({
        rule: 'server-only-value',
        subject: 'INTERNAL_API_URL',
        file: 'static/chunks/leak.js',
      }),
    ]);
  });

  it('fails when a credential-shaped literal reaches prerendered HTML', () => {
    writeCleanBuild();
    write('server/app/leak.html', `<p>${['AKIA', 'Z'.repeat(16)].join('')}</p>`);
    const result = checkClientBundle(distDir, { serverOnlyNames: [], environment: {} });
    expect(result.findings).toEqual([
      expect.objectContaining({ rule: 'secret-pattern', subject: 'aws-access-key-id' }),
    ]);
  });

  it('ignores server bundles that browsers never receive', () => {
    writeCleanBuild();
    write('server/app/page.js', `const k = "${['AKIA', 'Z'.repeat(16)].join('')}";`);
    const result = checkClientBundle(distDir, { serverOnlyNames: [], environment: {} });
    expect(result.findings).toEqual([]);
  });
});

describe('main', () => {
  it('returns 0 and a summary for a clean build', () => {
    writeCleanBuild();
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    expect(main(['--dist', distDir], {})).toBe(0);
    expect(log.mock.calls.flat().join('\n')).toMatch(/passed; 4 artifact\(s\) scanned/);
  });

  it('returns 1 and withholds values when a leak is found', () => {
    writeCleanBuild();
    write('static/chunks/leak.js', 'const t="planted-token-value-abcdefgh";');
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(main(['--dist', distDir], { WEB_ACCESS_TOKEN: 'planted-token-value-abcdefgh' })).toBe(1);
    const output = error.mock.calls.flat().join('\n');
    expect(output).toMatch(/FAILED with 1 finding\(s\)/);
    expect(output).toMatch(/secret-env-value \[WEB_ACCESS_TOKEN\] static\/chunks\/leak\.js/);
    expect(output).not.toContain('planted-token-value-abcdefgh');
  });

  it('returns 2 when there is no build output', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(main(['--dist', path.join(distDir, 'missing')], {})).toBe(2);
    expect(error.mock.calls.flat().join('\n')).toMatch(/no completed production build/);
  });

  it('returns 2 for a failed build that left artifacts but no BUILD_ID', () => {
    writeFailedBuildResidue();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    expect(main(['--dist', distDir], {})).toBe(2);
    expect(error.mock.calls.flat().join('\n')).toMatch(/no completed production build/);
    expect(log).not.toHaveBeenCalled();
  });

  it('returns 2 for a build that aborted during prerendering after writing BUILD_ID', () => {
    writePrerenderFailureResidue();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    expect(main(['--dist', distDir], {})).toBe(2);
    expect(error.mock.calls.flat().join('\n')).toMatch(/no completed production build/);
    expect(log).not.toHaveBeenCalled();
  });

  it('returns 2 for a completed build with nothing browser-delivered', () => {
    write('BUILD_ID', 'empty-build');
    write('export-marker.json', '{"version":1}');
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(main(['--dist', distDir], {})).toBe(2);
    expect(error.mock.calls.flat().join('\n')).toMatch(/no browser-delivered artifacts/);
  });

  it('returns 2 for unknown arguments', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(main(['--bogus'], {})).toBe(2);
    expect(main(['--dist'], {})).toBe(2);
  });
});
