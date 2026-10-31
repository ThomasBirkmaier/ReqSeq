# ADR-0013: ReqIF import and export

Status: Proposed · Based on: D-022, D-030, D-032, D-033, D-045, D-056, D-057, D-058, D-059 · SRs: SR-052..SR-059, SR-095 · Schema: `schemas/reqif-mapping.schema.json`, catalog `reqif.*` · Needs: #357 (origin on every type of the standard model, `import-version`)

## Decision

### Block, parser, conversion

- Block `core/src/reqif/` in the layer of `data` (architecture README §5): it may use every lower block. Parsing, planning and conversion are pure functions; files are written only through `model/write.ts` and `files`.
- ReqIF 1.2 is read with core's own XML scanner `files/xml-scan.ts` (ADR-0012), extended by ordered child nodes (text segments between elements) so that XHTML mixed content keeps its order. The scanner reads UTF-8 only, refuses `<!DOCTYPE` and every entity except the five predefined ones and numeric references, refuses malformed input and is iterative and linear: no entity expansion, no external reference, no network (SR-077). An input size guard refuses larger files with `reqif.invalid`. `fast-xml-parser` was rejected: it accepts truncated input and two roots without a second validator pass and needs its own entity handling. No ReqIF library: the available ones are unmaintained or Java. `.reqifz` is not in the base scope (SR-053).
- Into our own small ReqIF model; XHTML values stay the scanned node tree. The writer `reqif/write.ts` writes UTF-8 with LF in a fixed order and has no dependency.
- XHTML to Markdown (SR-095): our mapping from the node tree to hast, then `hast-util-to-mdast`, `mdast-util-to-markdown` and `mdast-util-gfm`, set to the editor's style. Markdown to XHTML: `mdast-util-from-markdown` with `micromark-extension-gfm`, `mdast-util-to-hast`, then our serializer limited to the XHTML modules of the ReqIF driver schema. `THE-VALUE` is one `div`. The driver has no image module, so images are written as `<xhtml:object data type>`; `img` is read on import only. What has no Markdown form is a loss with a stable code (below); its text is kept.

### Export (SR-052, SR-058, SR-059)

- Every IDENTIFIER starts with `_` (`xs:ID` cannot start with a digit) and has a category, because IDs are unique per file. Parts are joined with `.`, which keys never contain (`common.schema.json#/$defs/key`) and NCName allows, so no two IDs collide and each can be read back:

  | Category | IDENTIFIER |
  |---|---|
  | element (SR-052 AK2) | `_<uuid>` |
  | datatype | `_dt-string`, `_dt-xhtml`, `_dt-real`, `_dt-date`, `_dt-enum.<property>` |
  | enumeration value | `_ev-<property>.<choice>` |
  | object type | `_ot-<type>`; `_ot.missing` for a target whose type is unknown |
  | attribute of a property | `_ad-<type>.<property>`; `_ad-<type>.title`, `_ad-<type>.text` |
  | round-trip attributes | `_rq-<type>.markdown`, `_rq-<type>.values` |
  | relation type, relation | `_rt-<kind>`, `_sr-<hash of source, kind, target>` |
  | specification, hierarchy, header | `_sp-<hash>`, `_sh-<uuid>`, `_hd-<uuid>` |

  All but the header ID are derived from the content, so one model gives the same bytes.
- `REQ-IF-TOOL-ID` is `reqseq`, `TITLE` the workspace name. `CREATION-TIME` and every `LAST-CHANGE` take one export time (no per-element Git date, ADR-0005). The elements are in one flat SPECIFICATION in the order of the list (SR-052 AK1).
- Kinds, each with a readable attribute for other tools and, for the round trip into ReqSeq (SR-052 AK3), two STRING attributes per object: `reqseq-markdown` (`_rq-<type>.markdown`, the text byte for byte) and `reqseq-values` (`_rq-<type>.values`, a JSON object of the exported properties and relations as stored, targets as UUID with their stored version):

  | Own kind | Readable attribute | Read back from a ReqSeq file |
  |---|---|---|
  | title | `LONG-NAME`, STRING `_ad-<type>.title` | `reqseq-values` |
  | text | XHTML `_ad-<type>.text` | `reqseq-markdown`, image links rewritten (below) |
  | text property (`many`: XHTML list; `markdown`: raw) | STRING or XHTML | `reqseq-values` |
  | number | REAL | `reqseq-values` |
  | date | DATE, `T00:00:00Z` | `reqseq-values` |
  | choice (`many`) | ENUMERATION (`MULTI-VALUED`) | `reqseq-values` |
  | relation-valued property (validity, packages) | STRING of short IDs | `reqseq-values`, targets as for relations |
  | relation kind | SPEC-RELATION of type `_rt-<kind>` | `reqseq-values`, targets resolved as below |
  | status | ENUMERATION, for information | never read (D-030, SR-087) |

- Images: the export copies each image the text embeds to `<output stem>-images/<element file stem>/<file>` next to the output, confined like `output`, and writes `data` relative to the output file; `files[]` lists the copies.
- A target outside the export is a stub: a SPEC-OBJECT with IDENTIFIER and type only and without values, so in a ReqSeq file without `reqseq-values` (SR-059 AK2). A target whose file is missing or whose repository is not on this machine (N-041, D-058) gets the type `_ot.missing`.
- Omitted properties (SR-059 AK1) are left out of both channels. The export omits the union of the mapping's `omit-properties`, the chosen profile's `omit-properties` and the input `omitProperties`; with `mapping`, the input is added to the mapping's list and saved (AK3), and a mapping outside the mapping folder is then refused with `input.invalid`. Statements go back to the source with the source IDENTIFIER from `source-identifier`, as STRING or, when `statement.datatype` says so, as XHTML (SR-058); the output counts the elements without one.

### Import (SR-053..SR-057, SR-095)

- Phases, all or nothing: parse (`reqif.invalid`) → mapping (`reqif.unmapped` with the list of `reqif.analyze`, SR-055) → plan everything in memory → conflicts without a choice (`reqif.conflict`, SR-056 AK4) → preflight of every target (unchanged since read, writable, names free) → write. A refusal comes before any write (SR-055 AK3). `reqif.analyze` runs the same phases up to the plan, builds a one-to-one mapping when needed and saves nothing.
- The write phase writes every file of the call: elements, copied images and a saved mapping. New files go through `createFilesAtomic` of `files/write.ts` (`createElementFiles` of `model/new-files.ts` for elements): every file is written and fsynced as a temp file next to its target (`TEMP_FILE_PATTERN`, which the element walk and the watchers ignore); only when all are on disk does each get its name as a hard link, which never replaces a file (an exclusive create where the file system has no hard links); each folder is fsynced once. On a failure the call removes a file it created only while its bytes are exactly what it wrote, removes its temp files, reports what it could not undo in `details.written` and resets the store. Updated files (SR-056) will restore a file only while it is unchanged since the call wrote it. This is compatible with D-045, because no element of the workspace is removed, only a file the failed call itself made. All or nothing holds for errors, not for a crash: a crash between two names leaves the files named so far and the temp files, and the fallback without hard links writes in place.
- Target folder: the mapping's `target`, else a folder with the portable name of the source in the main repository (SR-053 AK1).
- A file of ReqSeq (`REQ-IF-TOOL-ID` `reqseq`) needs no mapping: the import builds a one-to-one mapping by IDENTIFIER and saves it as `<portable source name>.yaml` in the mapping folder. When that file exists it is used, which goes beyond SR-054 AK2 (the command names no file): the import warns when its `source.tool-id` or name differs. The source name is the input `source`, else the header `TITLE`; two workspaces with the same name, or names that are equal once portable, share one source unless `source` tells them apart. `reqseq-markdown` and `reqseq-values` are taken only when the readable attributes written again from them (after the image rewrite below) equal those in the file. Otherwise another tool changed the content: the import reads the readable attributes and warns. From `reqseq-values` the import replaces the origin, ignores the status, and treats an identifier like any other value (a duplicate is the usual hint).
- Elements always get new UUIDs (D-056: the file name comes from the UUID, so a kept UUID would collide in the original repository). `source-identifier` holds the IDENTIFIER, e.g. `_<uuid>`. A repeated import matches only by `source` and `source-identifier` (SR-056 AK2). A mapping that maps a SPEC-OBJECT-TYPE to a type without the five origin properties is refused with `input.invalid` at that entry, so every imported element carries its origin (SR-053 AK1, SR-057 AK1).
- Targets in a ReqSeq file, for relations and relation-valued properties, resolved in this order: (1) an object imported in this call; (2) the element of the same `source` whose `source-identifier` is the target's IDENTIFIER (an earlier delivery); (3) the element with the target's UUID; (4) otherwise the relation is kept to that UUID as a missing target (N-041, D-045, D-058), with the version stored in `reqseq-values`. A stub never becomes an element. Only in a file from another tool is a relation whose other end is not imported a loss (`relation-end-not-imported`).
- Images (SR-095 AK2): the image an `object` names is copied into the new element's attachment folder (`model/attachment.ts`, named like the element file, so after the new UUID). The import rewrites only the image links of `reqseq-markdown` to that folder. The comparison of SR-052 AK3 counts a rewritten image link with equal image bytes as equal (assumption carried in #511).
- New elements get the initial status of their type; the import never sets a status (D-030, SR-087). Dropped requirements are only listed (SR-056 AK3). An update writes the mapped fields and the origin and keeps the properties the mapping does not map (D-022, SR-056 AK2). It replaces only relations of mapped kinds between elements of this source and keeps local ones.
- Importfassung (`import-version`, D-059): the version (ADR-0005) of the element right after its last import, as the import writes it: over the text, the properties D-057 counts and the embedded images. It never counts to the version itself. A change of the title or of a property that does not count (D-057) is therefore neither a change of the delivery nor a local change.
  - *Changed* (SR-056 AK1): the version the element would have after an update with the delivery differs from it.
  - *Locally changed*: the current version of the element differs from it.
  - A *conflict* is both. `take` writes the delivery like an update. `keep` leaves the content and writes `import-version` (the version the delivery would give), `delivery` and `import-date`, so the same conflict does not come back.
  - `take` and `keep` entries match an exact source IDENTIFIER among the conflicts first, else an element reference resolved among the conflicts' elements. An entry in both lists is `input.invalid`; one that names no conflict is a warning.
- Versions: planned versions take the hashes of the image bytes to be copied instead of the lookup on disk. Every relation and relation-valued property the import writes carries the planned version of its target when the target is imported in this call, else its current version, or the stored version for a missing target (#508). After a round trip no relation is outdated. This also hides, intentionally, a change of a target from an element the same delivery changes.
- Losses (SR-053 AK2, SR-095 AK3) are `common.schema.json#/$defs/reqifLoss`: the object, its element when there is one, a stable `code` and the reason. There is one per SPECIFICATION for its hierarchy. An enumeration value the mapping neither maps nor omits is unmapped (SR-055). One it omits (`omit-values`) is a loss `omitted-value`. Values of a SPEC-RELATION or a SPECIFICATION are not imported (`omitted-attribute`); a second SPEC-RELATION of the same kind between the same objects is imported once (`relation-duplicate`); a relation kind the metamodel does not allow between the two types is not written (`relation-not-allowed`). An IDENTIFIER used twice is `reqif.invalid`. Mapped properties never hold `id`, `type`, `status` or the title key, as in `element.create`.

### Paths

- An embedded object (`<xhtml:object data>`, SR-095 AK2) must be a relative path without scheme that resolves, real path included, below the folder of the ReqIF file (later: inside the `.reqifz`), for every access. Through API and MCP it must also lie inside the repositories, checked by the path check of the command context (SR-142). Otherwise it is a loss `image-outside`; a missing file is a loss `image-missing`. Images are copied through `files` like an image pasted in the app.
- Mapping files are written only inside the mapping folder (`mappings` of the workspace file, default `reqif` in the main repository; SR-054 AK1), for every access. That covers `reqif.saveMapping`, the saved one-to-one mapping and `omit-properties` of the export. A target outside it is `input.invalid`. A mapping may be read from any path the access allows.

### Tests

- Every written file is checked against the ReqIF 1.2 XSDs, kept byte for byte in `toolchain/reqif/schema/` with source, checksum and licence in its README. The check is `validateReqif` of the testkit with `xmllint-wasm` (MIT, libxml2 MIT; `--nonet`, in process, the same on every OS). The `schemaLocation`s are pointed to the local files in memory at load; nothing is fetched. libxml2 does not resolve IDREFs in element content, so `validateReqif` checks every `*-REF` itself.
- Hand-written samples per feature are in `toolchain/reqif/samples/` (D-054). Once, at stage acceptance, a real file from another tool is imported.
