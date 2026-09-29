/**
 * Runs a command, reports how long it took and forwards its exit status.
 * The duration is printed to stdout and, inside GitHub Actions, appended to
 * the job summary so build and type-check durations are visible per pipeline
 * run.
 *
 *   node tools/timed.ts <label> -- <command> [arguments...]
 */
import { spawnSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';

export function appendStepSummary(
  markdown: string,
  environment: NodeJS.ProcessEnv = process.env,
): void {
  const summaryFile = environment.GITHUB_STEP_SUMMARY;
  if (summaryFile) {
    appendFileSync(summaryFile, `${markdown}\n`, 'utf8');
  }
}

export function formatSeconds(milliseconds: number): string {
  return `${(milliseconds / 1000).toFixed(2)} s`;
}

/**
 * Whether this module is the process entry point. `import.meta.main` exists
 * from Node 24.2; on an older runtime it is `undefined`, which would silently
 * skip every tool while still exiting 0, so that case fails closed.
 */
export function runAsScript(meta: ImportMeta, run: () => number): void {
  if (meta.main === undefined) {
    console.error(
      `${meta.url}: this tool needs Node >= 24.2 (import.meta.main); running on ${process.version}`,
    );
    process.exit(2);
  }
  if (meta.main) {
    process.exitCode = run();
  }
}

/**
 * Quotes one argument for cmd.exe. Package binaries are `.cmd` shims on
 * Windows and can only be started through the shell, which requires a single
 * command line; passing an argument array together with `shell: true` is
 * deprecated because it is concatenated unescaped.
 */
export function quoteForCmd(argument: string): string {
  if (/^[A-Za-z0-9_\-.:/\\=@,+]+$/.test(argument)) {
    return argument;
  }
  return `"${argument.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, '$1$1')}"`;
}

export interface Invocation {
  readonly command: string;
  readonly args: readonly string[];
  readonly shell: boolean;
}

export function planInvocation(
  command: string,
  args: readonly string[],
  platform: NodeJS.Platform = process.platform,
): Invocation {
  if (platform === 'win32') {
    return { command: [command, ...args].map(quoteForCmd).join(' '), args: [], shell: true };
  }
  return { command, args, shell: false };
}

export function parseTimedArguments(
  argv: readonly string[],
): { label: string; command: string; args: string[] } | undefined {
  const label = argv[0];
  const command = argv[2];
  if (label === undefined || argv[1] !== '--' || command === undefined) {
    return undefined;
  }
  return { label, command, args: argv.slice(3) };
}

function main(argv: readonly string[]): number {
  const parsed = parseTimedArguments(argv);
  if (parsed === undefined) {
    console.error('usage: node tools/timed.ts <label> -- <command> [arguments...]');
    return 2;
  }
  const invocation = planInvocation(parsed.command, parsed.args);
  const started = performance.now();
  const result = spawnSync(invocation.command, [...invocation.args], {
    stdio: 'inherit',
    shell: invocation.shell,
  });
  const elapsed = formatSeconds(performance.now() - started);
  const status = result.status ?? 1;
  if (result.error) {
    console.error(`timed: could not start ${parsed.command}: ${result.error.message}`);
  }
  console.log(`${parsed.label} duration: ${elapsed} (exit ${status})`);
  appendStepSummary(`- **${parsed.label} duration:** ${elapsed} (exit ${status})`);
  return status;
}

runAsScript(import.meta, () => main(process.argv.slice(2)));
