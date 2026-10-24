# ADR-0013: ReqIF import and export

Status: Proposed · Based on: D-022, D-032, D-033, D-059 · SRs: SR-052..SR-059 · Schema: `schemas/reqif-mapping.schema.json`

## Decision

- ReqIF 1.2 read and written with **`fast-xml-parser`** (no native code) into our own small ReqIF model in `core/src/reqif/`. No ReqIF library: the available ones are unmaintained or Java.
- XHTML in `ATTRIBUTE-VALUE-XHTML` to Markdown with `hast-util-from-html` + `hast-util-to-mdast` + `mdast-util-to-markdown` (GFM): headings, lists, tables, emphasis and images survive (SR-053 AK2). Embedded `<object>` images are extracted next to the element file. Everything else that cannot be represented is listed as a loss per element (SR-053 AK3). Export converts Markdown to XHTML with the same libraries.
- Export: `IDENTIFIER` = element UUID (SR-052 AK2); for statements back to the source the source `IDENTIFIER` from the property with meaning `source-identifier` (SR-058). Relations become `SPEC-RELATION`s; relations to elements outside the selection are written with the ID only (SR-059 AK2).
- The mapping file (SR-054) is read before import; unmapped types and attributes stop the import before any file is written (SR-055). Import is two-phase: plan everything in memory, then write all files; cancelling leaves the workspace untouched (SR-055 AK3).
- Repeated import matches by the properties with meanings `source` and `source-identifier` (SR-056). The origin properties are written only by import (SR-057 AK3). Dropped requirements are only marked in the result, never changed (SR-056 AK3).
- Tests validate every export against the official ReqIF 1.2 XSD with `xmllint` (CI tool only, not shipped) and import the public sample files collected in `toolchain/reqif/` (D-054).
