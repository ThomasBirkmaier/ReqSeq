# ADR-0016: Strictest compiler settings, strict lint and coverage thresholds

Status: Accepted · Based on: D-050, D-051, D-054 · Requested by the product owner on 2026-10-24, before coding starts · Amended 2026-10-27 (#537): React components (`.tsx`) are out of the coverage threshold · Amended 2026-10-28 (#752): 80 % per adapter package, core stays 100 %

## Context

Agents write almost all of the code and merge on their own (D-051). Gates that a machine checks are the only review that never gets tired. The product owner set the rule on 2026-10-24: the strictest warnings, a strict linter and full coverage are mandatory.

## Decision

**Compiler.** `tsconfig.base.json` enables every strictness option TypeScript offers: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `noImplicitReturns`, `noFallthroughCasesInSwitch`, `noUnusedLocals`, `noUnusedParameters`, `noPropertyAccessFromIndexSignature`, `allowUnreachableCode: false`, `allowUnusedLabels: false`, `forceConsistentCasingInFileNames`, `erasableSyntaxOnly`, `verbatimModuleSyntax`. TypeScript has no warnings, only errors, so every finding fails `pnpm typecheck`.

**Lint.** ESLint with `typescript-eslint` `strictTypeChecked` and `stylisticTypeChecked` (type information through the project service), plus `switch-exhaustiveness-check`, `strict-boolean-expressions`, `explicit-module-boundary-types`, `consistent-type-imports`, `prefer-readonly`, `eqeqeq`, `curly`, `no-console` (product code), `complexity` 15, `max-depth` 4, no `TODO`/`FIXME` comments. `--max-warnings 0`: a warning fails like an error. `eslint-disable` and `@ts-expect-error` need a written reason in the same comment.

**Coverage.** `pnpm test:coverage` (Vitest, v8 provider) must reach **100 % lines, branches, functions and statements per file** in every package except the adapters (`packages/core`, where logic and risk live, `packages/testkit` and any new package), and **80 % aggregated per package** for the adapters `packages/cli`, `packages/api`, `packages/mcp` and the `.ts` modules of `packages/app` (product owner decision, 2026-10-28, #752). Core holds the logic and the risk (ADR-0002); in the thin adapters 100 % mostly produced tests for the number without insight. The product owner weighs quality highly, but not above every cost, and does not want tests written only to reach a number. trace-check stays the hard gate: every acceptance criterion with method Test has a test. CI measures coverage and its thresholds on Ubuntu on every push to a pull request, and on macOS in the platform lane (ADR-0011); on Windows the unit tests run without coverage, because tests of symbolic links, special files and execute bits are skipped there and the per-file 100 % cannot be reached on that system (#304, product owner informed 2026-10-29). Below a threshold the job fails. Files that no test loads count as uncovered. The 100 % globs are written as "every package except the four adapters", so a new package is under 100 % without a config change; Vitest skips files that no glob matches.
- Mutation samples are an occasional local check on changed core files when a change is risky, never part of CI (#753).
- Coverage ignore comments (`/* v8 ignore ... */`) are allowed only for code that cannot run on the current platform (for example a Windows-only branch on Linux) and only with a reason in the comment. The code review rejects any other use.
- Electron code (`packages/app`) counts too. Logic lives in testable modules (`.ts`, 80 % for the package, logic that belongs to core moves there); Playwright tests cover the UI flows. If a part cannot be measured, a spec-free enabler issue documents it before it is excluded, and the product owner is told in the stage epic.
- React components (`.tsx`) are measured and reported, but have no threshold (product owner decision, 2026-10-27, #537). Playwright and the `[SR-xxx/AKn]` tests are the evidence for them; a component test is written where it checks behaviour, never only to reach a coverage number. Logic that a component needs goes into a `.ts` module, which is under the threshold of its package.
- Repository scripts under `scripts/` (export, trace check, contracts) are tooling, not product code. They are linted and tested but not under the 100 % threshold.

**Gate.** All of this runs in the required checks `static` (typecheck, lint, format) and `checks` (unit tests with coverage) of ADR-0011 (#303; from #566 to #303 both in `checks`). Agents never lower a threshold, disable a rule globally or add an ignore pattern to get green; such a change is an ADR change announced to the product owner.

## Consequences

- Tests grow with the code from the first line; untested branches are visible in every PR.
- Type-aware lint is slower; acceptable at this size, revisit if lint exceeds a few minutes.
- 100 % coverage proves that code ran, not that it is right. The `[SR-xxx/AKn]` tests and the code review stay the main check.
- Review 2026-10-27 (#537): no documented case where a coverage gap alone revealed a real bug; 17 bugs were found in code with 100 % coverage. The gate mostly removed unreachable fallbacks and made edge cases tested. For components it cost about 7k lines of happy-dom mount tests for 3.9k lines of `.tsx`, next to the Playwright tests, so the components left the threshold.

## Rejected

- 90 % or per-package thresholds for core: leave room for untested code exactly where it hurts. Since #752 the adapters have a per-package threshold, because they hold no logic of their own (ADR-0002); the `.tsx` components (#537) have none.
- Warnings as information only: agents ignore them under time pressure.
