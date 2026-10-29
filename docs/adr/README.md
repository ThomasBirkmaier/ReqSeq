# Architecture decision records

ADRs say **how** ReqSeq is built. Product decisions (**what**) are the decisions in `spec/`, maintained with ReqSeq itself (D-064). An ADR never contradicts a decision; if it would have to, the conflict becomes a `spec-frage` issue (D-052).

Format: context, decision, consequences, rejected alternatives. Status `Proposed` until the stage 0 pull request is merged, then `Accepted`. A later change is a new ADR that supersedes the old one, in its own pull request announced to the product owner in the stage epic (D-051).

| ADR | Title | Based on |
|---|---|---|
| [0001](0001-monorepo-and-toolchain.md) | Monorepo with pnpm, TypeScript and Node 22 | D-004, D-046 |
| [0002](0002-command-catalog.md) | Command catalog as the only program logic | D-025, D-029, D-052, SR-080 |
| [0003](0003-contracts-first.md) | JSON Schema files are the contracts | D-056, D-052, SR-009 |
| [0004](0004-element-file-format.md) | Element file format | D-015, D-017, D-040, D-043, D-056, D-058, D-059 |
| [0005](0005-version-hash.md) | Version (Fassung) as content hash | D-013, D-027, D-057, D-060 |
| [0006](0006-read-only-git.md) | Read Git through the git program, read-only | D-036, SR-083 |
| [0007](0007-parsing-and-writing-files.md) | Parsing and writing YAML and Markdown | D-012, D-056, SR-008, SR-016, SR-065 |
| [0008](0008-in-memory-model-and-index.md) | In-memory model, search index, cache and file watching (details in [`0008/`](0008/)) | N-036, SR-007, SR-068, SR-081, SR-082 |
| [0009](0009-access-adapters.md) | CLI, local API and MCP server | D-025, D-029, SR-079, SR-080 |
| [0010](0010-electron-app.md) | Electron app: process model and security | D-003, D-004, SR-073, SR-077, SR-078 |
| [0011](0011-testing-and-verification.md) | Test tools, evidence and quality gates | D-050, D-051, SR-076..SR-082 |
| [0012](0012-evidence-records.md) | Evidence records and the JUnit convention | D-007, D-026, SR-028, SR-029 |
| [0013](0013-reqif.md) | ReqIF import and export | D-022, D-032, SR-052..SR-059 |
| [0014](0014-packaging.md) | Packaging and delivery | D-003, SR-076, SR-078 |
| [0015](0015-dependencies-and-licenses.md) | Dependency policy | N-047, D-051 |
| [0016](0016-strict-quality-gates.md) | Strictest compiler settings, strict lint and coverage thresholds | D-050, D-051 |
