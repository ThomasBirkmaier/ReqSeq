# ADR-0017: User documentation site

Status: Proposed · Based on: D-067, N-081 · SRs: SR-139, SR-140, SR-141 · Issue #344

## Context

D-067: ReqSeq has documentation for its users, in Get started, How-to, Reference and Concepts; what can be generated from the tool's sources is generated, never written by hand; online is only the version of the latest release, and each delivery brings its own version. SR-139 asks for a reference generated from the descriptions the tool itself uses, SR-140 for examples that run against the version, SR-141 for documentation that is readable and searchable without network and opens from the app. Architecture and developer docs stay in the repository.

## Decision

**Generator.** Astro with Starlight: Markdown pages, sidebar, light and dark mode, and a local search index (Pagefind, Ctrl K) that needs no server.

**Sources and layout.**

- Hand-written pages: `docs/guide/` (Markdown, English, SR-074).
- `packages/docs` (`@reqseq/docs`, private, never shipped): the generator in `src/` (TypeScript, 100 % coverage, ADR-0016). It depends on `core`, `cli`, `app`, `api` and `mcp`, whose exports it reads. `pnpm docs:generate` copies `docs/guide/` into the one content folder Starlight reads, `packages/docs/site/src/content/docs/` (git-ignored, a copy rather than a link so every system reads the same files), and writes the generated reference next to it. Hand-written pages live in `index.md` or the section folders `start/`, `how-to/` and `concepts/`, which the sidebar lists; the generator refuses a page elsewhere.
- `packages/docs/site/`: the Starlight site, `.mjs` config and CSS only. It is not a workspace member (`packages/*` matches direct children only) and has its own lockfile, installed with `--ignore-workspace --ignore-scripts` only by the docs steps of CI and by `docs-pages.yml` (precedent: `toolchain/packaging/`, ADR-0014). So the about 290 packages of Astro never reach other jobs or agent installs.
- `pnpm docs:build` generates, installs the site and builds it into `packages/docs/site/dist/`.

**Generated.** The reference of SR-139, plain Markdown (no MDX), never written by hand. Commands (in place): `reference/commands/`, an index by catalog group and one page per catalog command with title, summary, effect, inputs and outputs from its schemas (a `$ref` named by its definition, with its description), and its call in each access, each taken from the adapter itself: the app's command prompt entry (`appCommandEntry` of `@reqseq/app`: the covering action or the catalog title, with its key), the exact `--help` of the CLI (`runCli` in-process), the API path and the MCP tool, both checked against `schemas/generated/`. Internal references in the texts (SR, D, ADR, #nnn) stay as the tool shows them. Planned: problem codes with cause and remedy, file formats and the standard model. Links between pages carry the base path, so the generator reads `REQSEQ_DOCS_BASE` too.

**No network.** No web fonts, CDN or analytics; system font stacks. `packages/docs/site/run.mjs` starts Astro with telemetry and the update check off (`ASTRO_TELEMETRY_DISABLED`, `ASTRO_DISABLE_UPDATE_CHECK`). CI builds the site under `unshare -rn`, so a download during the build fails it.

**Base path.** `site` is `https://thomasbirkmaier.github.io`, `base` comes from `REQSEQ_DOCS_BASE` (default `/ReqSeq` for Pages, `/` for the offline build).

**Offline build (SR-141, later).** The delivery ships the site built with base `/`, and the app serves it through its own protocol (ADR-0010), not `file://`: Pagefind loads its index with `fetch`, which `file://` blocks, and Starlight's links point to folders. Users without the app, such as CLI-only users on a stock Ubuntu 24.04 where the app needs the admin step (ADR-0014), need another way to open it, for example a loopback server of the CLI; this is decided with SR-141.

**Pages.** `.github/workflows/docs-pages.yml` builds the docs of a tag and deploys them with `actions/upload-pages-artifact` and `actions/deploy-pages`. `release.yml` calls it after its `release` job published a release; a run by hand takes a tag. Only the deploy job has `pages: write`, `id-token: write` and the environment `github-pages`, and it deploys only when the tag is the latest release. `main` is built only as a check of pull requests. Once, the product owner sets the Pages source to "GitHub Actions" and allows the tags `v*` in the environment `github-pages`.

**Checks.** Linux-only steps of the required job `checks` generate the content, install the site, audit it (`pnpm audit --audit-level high` on the site lockfile; `pnpm audit --prod` and `licenses:check` of the workspace do not see it) and build it offline. `starlight-links-validator` fails the build on a dead internal link. `tests-needed.sh` counts `docs/guide/` as a change that needs these steps.

## Consequences

- A docs change runs the full `checks` job. The site adds about a minute to it.
- The site's packages are dev tools in their own lockfile; the audit step blocks a pull request on a high finding.

## Rejected

- The site as a workspace package: about 290 packages in every install and job on three systems, and Astro's `.ts` and `.astro` files under the coverage and lint gates.
- A separate CI job with a path filter: the required checks would not gate it, and the pages depend on core and the CLI too.
- `on: release: published` for Pages: a release published with `github.token` starts no workflow.
- Docusaurus, VitePress, MkDocs: heavier (React), no plain-Markdown sidebar with built-in offline search, or a Python toolchain.
