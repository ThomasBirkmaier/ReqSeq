# ADR-0016: Strictest compiler settings, strict lint and 100 % coverage

Status: Accepted · Based on: D-050, D-051, D-054 · Requested by the product owner on 2026-10-24, before coding starts · Amended 2026-10-27 (#537): React components (`.tsx`) are out of the coverage threshold

## Context

Agents write almost all of the code and merge on their own (D-051). Gates that a machine checks are the only review that never gets tired. The product owner set the rule on 2026-10-24: the strictest warnings, a strict linter and full coverage are mandatory.

## Decision

**Compiler.** `tsconfig.base.json` enables every strictness option TypeScript offers: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `noImplicitReturns`, `noFallthroughCasesInSwitch`, `noUnusedLocals`, `noUnusedParameters`, `noPropertyAccessFromIndexSignature`, `allowUnreachableCode: false`, `allowUnusedLabels: false`, `forceConsistentCasingInFileNames`, `erasableSyntaxOnly`, `verbatimModuleSyntax`. TypeScript has no warnings, only errors, so every finding fails `pnpm typecheck`.

**Lint.** ESLint with `typescript-eslint` `strictTypeChecked` and `stylisticTypeChecked` (type information through the project service), plus `switch-exhaustiveness-check`, `strict-boolean-expressions`, `explicit-module-boundary-types`, `consistent-type-imports`, `prefer-readonly`, `eqeqeq`, `curly`, `no-console` (product code), `complexity` 15, `max-depth` 4, no `TODO`/`FIXME` comments. `--max-warnings 0`: a warning fails like an error. `eslint-disable` and `@ts-expect-error` need a written reason in the same comment.

**Coverage.** `pnpm test:coverage` (Vitest, v8 provider) must reach **100 % lines, branches, functions and statements** for all product code (`packages/*/src`) except React components (`.tsx`, see below). CI runs it on Ubuntu for every pull request; ADR-0011 names the nightly and manual runs on the other systems. Below 100 % the job fails. Files that no test loads count as uncovered. The threshold is checked per file, so the error names the file.
- Coverage ignore comments (`/* v8 ignore ... */`) are allowed only for code that cannot run on the current platform (for example a Windows-only branch on Linux) and only with a reason in the comment. The code review rejects any other use.
- Electron code (`packages/app`) counts too. Logic lives in testable modules (`.ts`, 100 %); Playwright tests cover the UI flows. If a part cannot be measured, a spec-free enabler issue documents it before it is excluded, and the product owner is told in the stage epic.
- React components (`.tsx`) are measured and reported, but have no threshold (product owner decision, 2026-10-27, #537). Playwright and the `[SR-xxx/AKn]` tests are the evidence for them; a component test is written where it checks behaviour, never only to reach a coverage number. Logic that a component needs goes into a `.ts` module, which stays at 100 %.
- Repository scripts under `scripts/` (export, trace check, contracts) are tooling, not product code. They are linted and tested but not under the 100 % threshold.

**Gate.** All of this runs in the required check `checks` (its static steps and its unit tests, #566; before, the jobs `static` and `test`). Agents never lower a threshold, disable a rule globally or add an ignore pattern to get green; such a change is an ADR change announced to the product owner.

## Consequences

- Tests grow with the code from the first line; untested branches are visible in every PR.
- Type-aware lint is slower; acceptable at this size, revisit if lint exceeds a few minutes.
- 100 % coverage proves that code ran, not that it is right. The `[SR-xxx/AKn]` tests and the code review stay the main check.
- Review 2026-10-27 (#537): no documented case where a coverage gap alone revealed a real bug; 17 bugs were found in code with 100 % coverage. The gate mostly removed unreachable fallbacks and made edge cases tested. For components it cost about 7k lines of happy-dom mount tests for 3.9k lines of `.tsx`, next to the Playwright tests, so the components left the threshold.

## Rejected

- 90 % or per-package thresholds: leave room for untested code exactly where it hurts. The one exception is the `.tsx` components (#537), which hold no logic of their own.
- Warnings as information only: agents ignore them under time pressure.
