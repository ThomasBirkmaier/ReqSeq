# ADR-0011: Test tools, evidence and quality gates

Status: Proposed · Based on: D-026, D-050, D-051, D-054, D-055 · SRs: SR-019, SR-020, SR-068, SR-076..SR-083

## Decision

**Tools**
- Unit and integration tests: **Vitest**, one root config (`vitest.config.ts`), test files `packages/*/src/**/*.test.ts` and `packages/*/test/**/*.test.ts`.
- CLI end-to-end: Vitest tests that spawn the built `logreq` binary on fixture workspaces (`packages/cli/test/e2e/`).
- App: **Playwright** with its Electron support (`_electron.launch`), under `xvfb-run` on Linux (`packages/app/test/`), from stage 3.
- Test names start with `[SR-xxx/AKn]` for every acceptance criterion with method Test (D-050). JUnit XML (`test-results/junit.xml`) is the evidence record; from stage 4 LogReq reads it itself.

**Fixtures and data**
- Small fixtures per SR in `fixtures/<sr-id>/`, built as temporary Git repositories by a helper (`fixtures/README.md`).
- Generator for large workspaces (50,000 elements, 200,000 relations, mixed types and repositories) with a fixed seed, in `packages/testkit` from stage 1 (D-055).
- Realistic multi-repository scenarios come from `logreq-testdata` (D-055), checked out in CI.

**Product rules as tests**
- *Offline:* every Vitest run loads `scripts/test-support/block-network.mjs`, which fails any connection that is not loopback (SR-077, SR-078). The Electron tests additionally assert that the session blocked all non-local requests. On Linux CI the CLI e2e suite also runs inside `unshare -rn` (no network namespace).
- *Loopback only:* API test asserts the listening address (SR-079).
- *Read-only Git:* `.git` snapshot before and after (ADR-0006, SR-083).
- *Status untouched:* every write command except setStatus/supersede leaves status unchanged (SR-087).
- *Cross-access:* the same scenario through core, CLI, API and MCP gives equal output (SR-080).
- *Performance:* generated 50,000-element workspace; thresholds from SR-007, SR-015, SR-020, SR-068, SR-082. Runs nightly and on PRs labelled `perf`; the perf job is not a required check. Every time is recorded in `verification/performance.md` as analysis, and a time over its threshold opens or updates an issue. A test tagged `[SR-xxx/AKn]` for an acceptance criterion with method Test asserts its threshold, so the perf job fails when it is exceeded. The reference machine of the performance SRs has 4 cores and 16 GB; the job prints the cores and memory of its runner. A pass on a runner at or below the reference machine is evidence for the criterion; a failure on a weaker runner is measured again on the reference machine before code changes (#215, SR-020). Untagged measurements (component times, such as the cold load inside one process) only record. Implementation (#126): tests in `packages/*/test/perf/` (`pnpm test:perf`, `vitest.perf.config.ts`, excluded from the required run) record times with `measure` of the testkit (`measureMedian` records the median of several runs, for a latency such as SR-098 AK1, #110), and tagged tests assert with `thresholdMessage`; `scripts/perf/report.mjs` writes `verification/performance.md`; `.github/workflows/perf.yml` runs the suite inside `unshare -rn` at 02:30 UTC and with label `perf`. It commits the record on the nightly run when the record is complete (no failure except threshold assertions, `report.mjs --junit`) and opens or updates one issue labelled `perf` when a threshold is exceeded. Correctness assertions in perf tests fail the run as usual.

**Quality gates (required checks)**
`static` (typecheck, lint, format, schemas, generated contracts, licenses, audit), `test (ubuntu-24.04 | macos-14 | windows-2025)` with 100 % coverage except React components (ADR-0016), `trace-check`. Pull requests and pushes to `main` run `test` and `e2e` on Ubuntu only; macOS joins in the nightly run (02:00 UTC); Windows runs on manual dispatch only, since the Actions budget ran out on 2026-10-26 (#365), to save Actions minutes (Thomas, 2026-10-24 for macOS, 2026-10-26 for Windows: "Windows nur nachts"). A macOS failure found at night is fixed on `main` the next day like any red build, and a manual run covers all three systems before a stage acceptance (Thomas raises the spending limit for it). Linux and macOS jobs run on self-hosted runners on Thomas's Mac while they are online and fall back to GitHub's runners otherwise; Windows and the reference run on GitHub's runners (macOS 14 and Ubuntu 24.04 x64, a manual run with `github-runners: true` before a stage acceptance) stay on GitHub (Thomas, 2026-10-25; `toolchain/self-hosted-runner/README.md`). Since 2026-10-26 the performance suite runs on the Mac runner too, nightly and with label `perf`; its times there are a guide value, and a manual perf run with `github-runners: true` measures on GitHub's runner before a stage acceptance (Thomas, 2026-10-26, #365). The Electron tests run in the job `electron` (#322): `pnpm --filter @logreq/app test:electron` downloads the Electron binary, builds the app and runs Playwright, under `xvfb-run` on Linux, Linux only on pull requests and all three systems at night. Their JUnit file is `test-results/junit-electron.xml`. A pull request that changes only files no test or build reads (`docs/**`, `.claude/**`, `verification/**`, `toolchain/**/*.md` and Markdown at the root; `.github/scripts/tests-needed.sh`) skips `test`, `e2e`, `electron` and `perf`, which then show as skipped; `static` and `trace-check` always run, and `spec/`, `fixtures/`, `packages/` and every other path, pushes to `main`, nightly and manual runs run everything (#520: three Linux runners only).

**Verification records** for Analyse, Inspektion, Demonstration in `verification/SR-xxx.md` (D-050), confirmed by a person at stage acceptance.

## Rejected

- Jest: slower, weaker ESM support.
- Separate test runners per package: harder to produce one JUnit file per run.
