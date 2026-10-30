---
name: verify
description: How to check a ReqSeq change locally - the commands for typecheck, lint, tests, trace-check, spec and contract checks, and Electron in a cloud container. Use before a push, when CI is red, or at the end of a stage.
---

# Checking a change

CI runs on GitHub's hosted runners on three systems, and a red run costs about ten minutes. So the cheap checks run locally before a push, and CI runs the rest: coverage, build, e2e, the full Electron suite, offline and cross-access tests, the license and security audit, and performance at night.

## First: pnpm 12

The repository pins pnpm 12 (`packageManager`). Corepack 0.34, which Node 22 brings, cannot start it (`Cannot find module .../pnpm/12.x/bin/pnpm.cjs`). If `pnpm --version` fails, run once per container:

```sh
npm install -g pnpm@12.14.0 --force
```

This replaces corepack's `pnpm` shim. pnpm then switches to the version a checkout pins, so an older branch still gets its own pnpm.

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

For a risky change to core, take a local mutation sample of the changed files, never in CI. The repository has no mutation tool yet (#753), so ask of each changed branch: would a wrong result fail a test?

Also run `pnpm schemas:check && pnpm contracts:check` when schemas or the catalog changed, `pnpm spec:check` when `spec/` changed, and the Electron specs a change in `packages/app` touches or could break. If a check is red for a reason outside your change, say so in the PR. Merging still needs green CI.

## Heavy runs in a cloud session

Run coverage, build, e2e and Electron only under `flock /home/user/wt/.gates.lock <command>`, with at most two agents running Electron at the same time, because the container restarted under more. Electron does not start as root, and the CA warning on stderr breaks the SR-080/AK2 JSON compare. From `packages/app`, after `pnpm --filter @reqseq/app build:electron` and `chmod 777 test-results/`:

```sh
sudo -u ubuntu env -u NODE_EXTRA_CA_CERTS -u NODE_OPTIONS xvfb-run -a ./node_modules/.bin/playwright test --config test/playwright.config.ts <specs>
```

## trace-check (D-050)

`pnpm trace-check` (`scripts/trace-check/trace-check.mjs`) reads `spec/` and checks the following: test names `[SR-xxx/AKn]` point to an existing SR and AK, every AK with method Test of a required SR has a test, other methods have `verification/SR-xxx.md`, the PR names an SR, and no spec ID is used twice.

- Before a PR: `pnpm trace-check --require SR-xxx --pr-body <file>` (add `--enabler` for enabler PRs). A PR text must not name an SR ID that is not in `spec/` yet.
- In CI it reads the current PR text. If only that step failed, fix the text or the label; `trace-check (PR text)` then re-runs `static` (see `lead-run`, `merge.md`).
- At the end of a stage: `pnpm trace-check --stage <n> --report trace-stage-<n>.md` (`--stage querschnitt` for the cross-cutting SRs). Errors mean the stage is not ready for acceptance.
- From stage 4 on, also compare with ReqSeq itself (`reqseq evidence coverage --workspace spec` with the JUnit results of CI). A difference is a bug in ReqSeq or in the script and gets a `bug` issue.
