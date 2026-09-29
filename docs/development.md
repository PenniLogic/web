# Web application development

Customer-only web application skeleton for PenniLogic ([web#1](https://github.com/PenniLogic/web/issues/1)).
This document covers the application toolchain. Repository policy, review rules and the
foundation commands remain in [AGENTS.md](../AGENTS.md) and [CONTRIBUTING.md](../CONTRIBUTING.md).

## Toolchain

| Component       | Locked version                    | Where it is declared                         |
| --------------- | --------------------------------- | -------------------------------------------- |
| Node.js         | 24.14.0 (24 LTS line; `>=24 <25`) | `.nvmrc`, `package.json` `engines`, `.npmrc` |
| npm             | 11.9.0 (`>=11`)                   | `package.json` `packageManager`, `engines`   |
| Next.js / React | 16.3.7 / 19.3.0                   | `package.json` (exact pins), lockfile        |
| TypeScript      | 6.0.3                             | `package.json` (exact pins), lockfile        |
| ESLint / Vitest | 9.39.5 / 5.0.2                    | `package.json` (exact pins), lockfile        |

Installs are reproducible: dependencies are pinned exactly (`save-exact`), the lockfile is
committed, `engine-strict` rejects an unsupported Node or npm, and a clean clone installs with
`npm ci`. No paid runtime, hosting, provider or service is used.

## Commands

Run from the repository root after `npm ci`.

| Command                        | Purpose                                                                                     |
| ------------------------------ | ------------------------------------------------------------------------------------------- |
| `npm run dev`                  | Development server (environment validated on start).                                        |
| `npm run build`                | Production build; prints total build duration; fails on invalid environment or type errors. |
| `npm run typecheck`            | `next typegen` then `tsc --noEmit`; prints type-check duration.                             |
| `npm run lint`                 | ESLint (`eslint-config-next` core-web-vitals + TypeScript, Prettier conflicts disabled).    |
| `npm run format:check`         | Prettier check (`npm run format` rewrites).                                                 |
| `npm test`                     | Vitest unit tests in `tests/`.                                                              |
| `npm run check:bundle`         | Fails if a secret-like value reaches browser-delivered build output (needs a build).        |
| `npm run report:build`         | Per-route and total client bundle sizes, raw and gzip (needs a build).                      |
| `npm run check:bundle:planted` | Proves the bundle check works by planting secrets in a throwaway build.                     |
| `npm run verify`               | All of the above in order, as a pipeline would run them.                                    |

`NEXT_TELEMETRY_DISABLED=1` is set by the scripts; no analytics or error reporting is wired up.

Inside GitHub Actions the build report and the build and type-check durations are also appended
to the job summary (`GITHUB_STEP_SUMMARY`).

### Continuous integration status

The generated `CI` workflow currently runs only the repository foundation check
(`python scripts/check_repository.py`). The Node toolchain and the commands above are added to
the workflow through the shared generator in `PenniLogic/infra/governance`; until that change is
merged and regenerated here, the results of these commands are local evidence recorded in the
pull request, not a CI-verified gate.

## Application layout

```text
src/app/layout.tsx              root layout (html/body, metadata, global styles)
src/app/not-found.tsx           404 page
src/app/(customer)/layout.tsx   customer route group layout (single <main id="main">)
src/app/(customer)/page.tsx     customer home page placeholder
src/env/                        typed environment schema (below)
tools/                          build-time checks and reports, run directly by Node
tests/                          Vitest unit tests
```

Every page lives in the `(customer)` route group. There is no administrative route group in this
repository, by design; administration is a separate repository. `tests/routes.test.ts` fails if an
admin-like route group or segment, a middleware/proxy file, a leftover secret fixture or a page
outside the customer group appears.

## Environment

The environment is validated by `src/env/validate.ts` when `next.config.ts` loads, so an invalid
configuration stops `next build`, `next dev`, `next start` and `next typegen` before any
application code runs. Error messages name variables and rules, never values.

| Variable              | Scope   | Allowed values                      | Default       |
| --------------------- | ------- | ----------------------------------- | ------------- |
| `NEXT_PUBLIC_APP_ENV` | browser | `local`, `preview`, `production`    | `local`       |
| `NODE_ENV`            | server  | `development`, `test`, `production` | `development` |

Rules:

- Browser-visible variables carry the `NEXT_PUBLIC_` prefix, are declared in
  `src/env/client-schema.ts` and read through static `process.env.NEXT_PUBLIC_*` expressions in
  `src/env/client.ts` so Next.js inlines them at build time. They must never hold a secret.
- Any `NEXT_PUBLIC_*` variable that is present but not declared fails validation. This stops a
  server value from becoming browser-visible by renaming alone.
- Server variables are declared in `src/env/server-schema.ts` and read through `src/env/server.ts`,
  which imports `server-only`: a Client Component that imports it fails the build.
- Empty values are treated as unset and fall back to the default.
- `.env.example` documents the schema; copy it to `.env` for local overrides (`.env` is ignored).

To add a variable, declare it in the matching schema, extend the table above and add a case to
`tests/env.test.ts`. New server variables are covered by the client-bundle check automatically.

## Client-bundle secret check

`npm run check:bundle` (`tools/client-bundle-check.ts`) scans every browser-delivered artifact of
a production build: everything under `.next/static/` and the prerendered HTML and React Server
Component payloads under `.next/server/app/`. It fails (exit 1) when it finds:

| Rule                | What it detects                                                                                                                 |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `secret-pattern`    | Credential formats: PEM private keys, GitHub, AWS, Google, Slack and Stripe live keys, JWTs, `secret = "…"` assignments.        |
| `server-only-value` | The value of a declared server-only variable from the build environment (verbatim, JSON-escaped or HTML-escaped).               |
| `server-only-name`  | The name of a declared server-only variable.                                                                                    |
| `secret-env-value`  | The value of any environment variable whose name looks like a credential (`*_SECRET`, `*_TOKEN`, `*_PASSWORD`, `*_API_KEY`, …). |

Findings report the rule, file, line, column and the variable or pattern name; matched values are
never printed. Exit 2 means there was no build output or a usage error. `NODE_ENV` is exempt from
the server-only rules because the framework inlines it by design.

`npm run check:bundle:planted` (`tools/planted-secret-check.ts`) proves the check catches real
leaks: it writes a temporary route under `src/app/(customer)/planted-secret-fixture/` containing a
Client Component with synthetic Stripe-, AWS- and JWT-shaped literals and a Server Component that
renders a random `WEB_PLANTED_TOKEN` value, builds that variant into the isolated `.next/planted`
directory, and passes only if the bundle check reports every literal inside a client JavaScript
chunk and the planted value inside prerendered output. The fixture and the planted build are
removed afterwards (`--keep` retains the build output for inspection). Do not run it while
`next dev` is watching `src/app`, because the dev server would briefly pick up the fixture route.

Limits: the check finds verbatim, JSON-escaped and HTML-escaped values, not encoded, hashed or
split ones, and the pattern list is deliberately high-signal rather than exhaustive. It
complements, and does not replace, keeping secrets out of the environment of the build in the
first place.

## Repository hygiene

`next-env.d.ts`, `.next/` and `*.tsbuildinfo` are generated and must not be committed. The
repository `.gitignore` is generated by `PenniLogic/infra/governance`; patterns missing from it
are requested through the generated-setup process rather than edited here.
