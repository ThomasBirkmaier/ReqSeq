# ADR-0007: Parsing and writing YAML and Markdown

Status: Proposed · Based on: D-012, D-015, D-056 · SRs: SR-008, SR-009, SR-016, SR-065

## Decision

- **YAML:** the `yaml` package (eemeli/yaml), YAML 1.2 core schema. Reading uses `parseDocument` so errors carry line and column (SR-008 AK1). Writing edits the parsed `Document` in place (set or delete single nodes) and stringifies it, which keeps key order, comments and the style of untouched values (SR-016 AK2, ADR-0004 stable writing). LogReq never re-serialises a whole file from a plain object.
- **Frontmatter split** by our own small function: the file must start with `---` on the first line and have a closing `---` line. No front-matter library.
- **Conflict markers:** before parsing, a file is scanned for lines starting with `<<<<<<< `, `=======`, `>>>>>>> `; if present it is reported as `file.conflict-markers` and not parsed (SR-008 AK2).
- **Markdown** is stored and passed through as a string. It is parsed only to extract inline references and image links (ADR-0004) and to render, with `micromark` plus GFM and math extensions (mdast via `mdast-util-from-markdown`). The editor (ADR-0010) works on the text itself, so files stay plain CommonMark with GitHub extensions (SR-065 AK3).
- **Writing files** is atomic: write to a temporary file in the same folder, then rename. Before writing, LogReq checks that the file on disk still has the content it read (size, mtime and hash); if not, the command fails with a conflict error instead of overwriting (SR-008 AK3, SR-007).
- A file that could not be read is never written by LogReq (SR-008 AK3).

## Rejected

- `gray-matter` or `js-yaml`: lose comments and key order on write.
- remark/unified round-trip for writing Markdown: reformats the user's text.
