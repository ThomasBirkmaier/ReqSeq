# ADR-0008: In-memory model, search index, cache and file watching

Status: Proposed · Based on: D-002, D-014 · SRs: SR-003, SR-007, SR-015, SR-020, SR-068, SR-081, SR-082

## Context

Targets at 50,000 elements and 200,000 relations on 4 cores and 16 GB: start ≤ 3 s with cache, ≤ 30 s without; open element ≤ 200 ms; filter or chain ≤ 500 ms; search ≤ 300 ms; full check ≤ 60 s; external change visible ≤ 2 s; pull with 1,000 files ≤ 10 s.

## Decision

The ADR states the decisions; the implementation details of most of them are in the parts under [`0008/`](0008/), one file per topic. Read only the part you work on.

- **The files are the database.** `core` keeps an in-memory model per workspace: per element the parsed frontmatter, version, file location and outgoing relations (also the targets of the inline references in its text: UUID, version, repository and line, `ElementRecord.references`, #240); an inverted relation index (incoming), indexes by type, status, package and validity. Text bodies are loaded lazily and kept in an LRU.
- **Search:** MiniSearch (in-memory full-text index, fuzzy and prefix search, case-insensitive) over title, text, property values and IDs (SR-068 AK1, AK2). Search within a view or filter intersects with the selection (SR-068 AK3). Details: [search](0008/search.md).
- **Queries** (filters, chains, coverage) run on the in-memory indexes; no SQL engine. Chains and coverage are graph walks with cycle detection (SR-022 AK4). Details: [queries](0008/queries.md).
- **Cache** per path of a working copy in the OS cache folder (`<cache>/logreq/<sha256 of the canonical workspace path>/`), never in the repository; copies at different paths never share a cache folder (SR-081 AK2). Details: [cache](0008/cache.md).
- **Cold start:** files are parsed by a pool of worker threads (`node:worker_threads`, one per core minus one, at least one; `model/read-pool.ts`, #148). Details: [cold-start](0008/cold-start.md).
- **Current versions** (#259; `model/current-versions.ts`): the current version of every element (ADR-0005), which SR-025 compares the stored versions of relations and inline references with; a workspace state built on first use. The part also covers the sort and derivation tree of `element.list` and the single-element paths. Details: [current-versions](0008/current-versions.md).
- **Outdated relations** (SR-025, #37; `hints/outdated.ts`): a workspace state over the current versions (above) and the incoming index: one pass over the relation items and inline references of the store in slices of 20 ms (SR-082), a map lookup per target. Lines of items come from a scan of the frontmatter text (`model/item-lines.ts`: LogReq writes one flow mapping per relation item under a top-level key), read again only for sources with a finding and only while the file still has the SHA-256 of the store's snapshot (a changed file gives no line); the YAML is parsed only for another layout. Parsing the YAML of every source again cost about 28 s in the worst case below; the scan brought the findings with lines to 9.3 s. Carried over a store change (`carryStoreUpdate`): the changed files and the sources of relations and links to a changed UUID (from the incoming index of the store before the change, which the state depends on so that it is carried first) are looked at again, the rest is kept; a new or deleted element or a missing index builds it again. The dates of the versions (D-013, ADR-0005) are not kept: `datedProblems` asks `versionDates` on every check. Worst case at N-036 (every relation and link outdated, 300,009 findings, local runs on a shared 4-core container): the CLI check without Git 36.6 s (SR-020 AK1: 60 s, asserted); with Git the dates add about 32 s (one walk per target file, every element a target), which puts a CLI check above 60 s. Capping the dates (at 10,000 targets) is spec question #287; the usual case (500 changed targets) takes 8.7 s in process with dates.
- **File watching** (SR-007; `model/watch.ts`, `model/watch-tree.ts`): no dependency (`chokidar` was planned) and no process; the watcher writes nothing. It runs only where a workspace stays open: `watchWorkspace(workspace)` is a workspace state that the CLI starts for `logreq serve api` and `logreq mcp` (later the app), and closing the workspace stops it; a one-shot CLI command reads a fresh workspace and needs none. Details: [file-watching](0008/file-watching.md).
- **Performance tests** (ADR-0011) with generated workspaces of 50,000 elements run nightly and on PRs labelled `perf`, against the thresholds above.

## Consequences

- Memory: roughly 1–2 KB per element without text, so well under 500 MB at 50,000 elements; the current versions add one small entry per element (the version and what the lookup of each embedded image found, and for a file changed since the store read it the element it holds now until the store is updated).
- Memory of the search index: about 200 MB at N-036 for the generated workspace and about 355 MB for texts of 150 words, each with the indexed text of every document, which the engine keeps so that a carry can remove it exactly (about 30 and 45 MB of it); held by a server from about a second after its start; a one-shot command builds or loads it only when it searches. Disk: `search.json` takes about 27 MB per copy and holds the words of every title, text and property, so the privacy note on the model cache applies to the texts too.
- Several instances on separate copies never share state (SR-081 AK1).
- Disk: the model cache takes about 75 MB per copy at 50,000 elements, in the OS cache folder of the user. Folders of moved or deleted copies are not collected in stage 1; removing `<cache>/logreq/` is always safe.
- Privacy: the model cache holds a copy of every element's frontmatter (titles, properties, relations; not the text, only the UUID, version, repository and line of each inline reference in it) in the user's cache folder, readable only by that user (mode 0600, folder 0700). Backups or roaming profiles that include the cache folder take that copy along. `activity.json` holds no element content (no title, text or path), only the UUID and repository of the element an agent accessed last, with the command, time and file hash.
- The watcher and file listings ignore LogReq's own temporary files `.<file name>.<8 hex>.logreq-tmp` (`isTempFile` in `files`, ADR-0007). Parsed files carry plain, frozen snapshots (path, size, mtime, SHA-256), so they can be cached and sent to worker threads; the kept YAML `Document` is for the write path only and the model may drop it to save memory.

## Rejected

- SQLite as primary store: a second source of truth next to the files; native module per Electron version.
- An external search engine: network service, violates N-047.
