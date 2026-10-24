# ADR-0008: In-memory model, search index, cache and file watching

Status: Proposed · Based on: D-002, D-014 · SRs: SR-003, SR-007, SR-015, SR-020, SR-068, SR-081, SR-082

## Context

Targets at 50,000 elements and 200,000 relations on 4 cores and 16 GB: start ≤ 3 s with cache, ≤ 30 s without; open element ≤ 200 ms; filter or chain ≤ 500 ms; search ≤ 300 ms; full check ≤ 60 s; external change visible ≤ 2 s; pull with 1,000 files ≤ 10 s.

## Decision

- **The files are the database.** `core` keeps an in-memory model per workspace: per element the parsed frontmatter, version, file location and outgoing relations; an inverted relation index (incoming), indexes by type, status, package and validity. Text bodies are loaded lazily and kept in an LRU.
- **Search:** MiniSearch (in-memory full-text index, fuzzy and prefix search, case-insensitive) over title, text, property values and IDs (SR-068 AK1, AK2). Search within a view or filter intersects with the selection (SR-068 AK3).
- **Queries** (filters, chains, coverage) run on the in-memory indexes; no SQL engine. Chains and coverage are graph walks with cycle detection (SR-022 AK4).
- **Cache** per working copy in the OS cache folder (`<cache>/logreq/<sha256 of absolute workspace path>/`), never in the repository and never shared between copies (SR-081 AK2). It holds, per file, size, mtime, content hash, parsed frontmatter and version, plus the serialised search index. Start: list and `stat` all files, reuse cache entries whose size and mtime match, parse the rest. A corrupt or old-format cache is discarded.
- **Cold start:** files are parsed by a pool of worker threads (`node:worker_threads`, one per core minus one).
- **File watching:** `chokidar` (v4) on all repository folders of the workspace, ignoring `.git`, `node_modules` and the workspace `ignore` patterns. Events are debounced (100 ms) and processed in batches, so a pull with 1,000 changed files is one update (SR-007). A changed metamodel file triggers a rebuild of the metamodel and of derived hints, without rewriting any element (SR-015).
- **Performance tests** (ADR-0011) with generated workspaces of 50,000 elements run nightly and on PRs labelled `perf`, against the thresholds above.

## Consequences

- Memory: roughly 1–2 KB per element without text, so well under 500 MB at 50,000 elements.
- Several instances on separate copies never share state (SR-081 AK1).
- The watcher and file listings ignore LogReq's own temporary files `.<file name>.<8 hex>.logreq-tmp` (`isTempFile` in `files`, ADR-0007). Parsed files carry plain, frozen snapshots (path, size, mtime, SHA-256), so they can be cached and sent to worker threads; the kept YAML `Document` is for the write path only and the model may drop it to save memory.

## Rejected

- SQLite as primary store: a second source of truth next to the files; native module per Electron version.
- An external search engine: network service, violates N-047.
