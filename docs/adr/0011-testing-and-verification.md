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
- *Status untouched:* every write command except setStatus/supersede leaves status unchanged (SR-017).
- *Cross-access:* the same scenario through core, CLI, API and MCP gives equal output (SR-080).
- *Performance:* generated 50,000-element workspace; thresholds from SR-007, SR-015, SR-020, SR-068, SR-082. Runs nightly and on PRs labelled `perf`. GitHub runners are not the reference machine (4 cores, 16 GB): results are recorded in `verification/` as analysis; failing thresholds on CI open an issue, not a red PR.

**Quality gates (required checks)**
`static` (typecheck, lint, format, schemas, generated contracts, licenses, audit), `test (ubuntu-24.04 | macos-14 | windows-2025)` with 100 % coverage (ADR-0016), `trace-check`. Electron tests and the e2e job join the matrix in the stage that brings them (CI comment marks the place).

**Verification records** for Analyse, Inspektion, Demonstration in `verification/SR-xxx.md` (D-050), confirmed by a person at stage acceptance.

## Rejected

- Jest: slower, weaker ESM support.
- Separate test runners per package: harder to produce one JUnit file per run.
