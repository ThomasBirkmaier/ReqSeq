---
name: verify
description: How to check a ReqSeq change locally - the commands for typecheck, lint, tests, trace-check, spec and contract checks, and Electron in a cloud container. Use before a push or when CI is red.
---

# Checking a change

CI runs on GitHub's hosted runners on three systems, and a red run costs about ten minutes. So the cheap checks run locally before a push, and CI runs the rest: coverage, build, e2e, the full Electron suite, offline and cross-access tests, the license and security audit, and performance at night.

## First: pnpm 12

The repository pins pnpm 12 (`packageManager`). Corepack 0.34, which Node 22 brings, cannot start it (`Cannot find module .../pnpm/12.x/bin/pnpm.cjs`). In a cloud session the environment's setup script installs it when the container is built, and the SessionStart hook (`scripts/hooks/session-start.mjs`) in a session that starts in this checkout. Otherwise, if `pnpm --version` fails, run once per container:

```sh
npm install -g pnpm@12.14.0 --force
```

This replaces corepack's `pnpm` shim. pnpm then switches to the version a checkout pins, so an older branch still gets its own pnpm.

A cloud session that resumes a cached container does not run the setup script again and keeps the `node_modules` of the container's build, while its checkout is updated. So run `pnpm install --frozen-lockfile` once before the first check; it takes seconds when the lockfile did not change.

## While you work

Run single test files: `pnpm vitest run <path> --reporter=dot`. Keep output short (`| tail`) instead of pasting whole logs.

## Before a push

```sh
F=$(git diff --name-only --diff-filter=d origin/main...HEAD)   # changed files without deleted ones
pnpm typecheck && pnpm format:check
node --max-old-space-size=4096 node_modules/eslint/bin/eslint.js --max-warnings 0 <the .ts .tsx .js .mjs files of $F>
pnpm vitest related --run --passWithNoTests $F
pnpm trace-check
```

Optional, for a risky change to core: a local mutation run of the changed source files, never in CI (#1335). It prints the score per file and the surviving mutants without the static ones, and writes `test-results/mutation/mutation.json`:

```sh
pnpm mutate packages/core/src/baselines/counting.ts [more files] [--tests '<glob>'] [--concurrency <n>]
```

It runs the unit tests of the files' packages in a Stryker sandbox (`.stryker-tmp/`), without the tests that fail under instrumentation although the code is right (listed with their reason in `scripts/mutate/mutate.mjs`); files of `cli`, `api`, `mcp` or `app` need `pnpm build` first. The dry run alone takes minutes (7 min for core on 4 cores), and each mutant about 5 s, so keep a run under about 1,500 mutants; `--tests` narrows the tests (`'packages/core/src/baselines/**/*.test.ts'`), at the price of mutants that only other tests kill. Run it under `flock /home/user/wt/.gates.lock` in a cloud session (create the folder once with `mkdir -p /home/user/wt`). For each survivor, ask: would a wrong result fail a test?

Also run `pnpm schemas:check && pnpm contracts:check` when schemas or the catalog changed, `pnpm spec:check` when `spec/` changed, and the Electron specs a change in `packages/app` touches or could break. If a check is red for a reason outside your change, say so in the PR. Merging still needs green CI.

## Heavy runs in a cloud session

Run coverage, build, e2e and Electron only under `flock /home/user/wt/.gates.lock <command>` (create the folder once with `mkdir -p /home/user/wt`), with at most two agents running Electron at the same time, because the container restarted under more. Electron does not start as root, and the CA warning on stderr breaks the SR-080/AK2 JSON compare. From `packages/app`, after `pnpm --filter @reqseq/app build:electron` and `chmod 777 test-results/`:

```sh
sudo -u ubuntu env -u NODE_EXTRA_CA_CERTS -u NODE_OPTIONS xvfb-run -a ./node_modules/.bin/playwright test --config test/playwright.config.ts <specs>
```

## trace-check

`pnpm trace-check` (`scripts/trace-check/trace-check.mjs`) reads `spec/` and checks the following: test names `[SR-xxx/AKn]` point to an existing SR and AK (only the names of active `it`/`test` calls and the `tag:` of cross-access scenarios count, not comments or `.skip`/`.todo`/`.fails`/`.only` tests or a skipped `describe`, #689), every AK with method Test of a required SR has a test, other methods have `verification/SR-xxx.md`, and no spec ID is used twice. It reads no PR text (product owner decision, 2026-11-06): CI runs it without `--require`, so there it checks only the test names and the spec IDs.

- Before a PR that completes an SR (its title starts with the SR ID): `pnpm trace-check --require SR-xxx`. A PR text must not name an SR ID that is not in `spec/` yet.
- `--report <file>` writes the report the `merge` skill needs for a release x.y; `--stage <package>` checks all SRs of one package (`--stage Editor`).
- For a release x.y (step 1 in `merge`), also compare with ReqSeq itself (`reqseq evidence coverage --workspace spec` with the JUnit results of CI). A difference is a bug in ReqSeq or in the script and gets a `bug` issue.
