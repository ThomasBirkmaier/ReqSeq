# ADR-0013: ReqIF import and export

Status: Proposed · Based on: D-022, D-030, D-032, D-033, D-045, D-056, D-057, D-059 · SRs: SR-052..SR-059, SR-095 · Schema: `schemas/reqif-mapping.schema.json`, catalog `reqif.*`

## Decision

### Block, parser, conversion

- Block `core/src/reqif/` in the layer of `data` (architecture README §5): it may use every lower block. Parsing, planning and conversion are pure functions; files are written only through `model/write.ts` and `files`.
- ReqIF 1.2 is read with core's own XML scanner `files/xml-scan.ts` (ADR-0012), extended by ordered child nodes (text segments between elements) so that XHTML mixed content keeps its order. The scanner reads UTF-8 only, refuses `<!DOCTYPE` and every entity except the five predefined ones and numeric references, refuses malformed input and is iterative and linear: no entity expansion, no external reference, no network (SR-077). An input size guard refuses larger files with `reqif.invalid`. `fast-xml-parser` was rejected: it accepts truncated input and two roots without a second validator pass and needs its own entity handling. No ReqIF library: the available ones are unmaintained or Java. `.reqifz` is not in the base scope (SR-053).
- Into our own small ReqIF model; XHTML values stay the scanned node tree. The writer `reqif/write.ts` writes UTF-8 with LF in a fixed order and has no dependency.
- XHTML to Markdown (SR-095): our mapping from the node tree to hast, then `hast-util-to-mdast`, `mdast-util-to-markdown` and `mdast-util-gfm`, set to the editor's style. Markdown to XHTML: `mdast-util-from-markdown` with `micromark-extension-gfm`, `mdast-util-to-hast`, then our serializer limited to the XHTML modules of the ReqIF driver schema. `THE-VALUE` is one `div`. The driver has no image module, so images are written as `<xhtml:object data type>`; `img` is read on import only. What has no Markdown form is a loss with a stable code (below); its text is kept.

### Export (SR-052, SR-058, SR-059)

- Every IDENTIFIER starts with `_` (`xs:ID` cannot start with a digit) and has a category, because IDs are unique per file and keys of types, properties and relation kinds can coincide: element `_<uuid>` (SR-052 AK2), datatype `_dt-…`, object type `_ot-<type>`, attribute `_ad-<type>-<key>`, relation type `_rt-<kind>`, relation `_sr-<hash>`, specification and hierarchy `_sp-…`/`_sh-…`, header `_hd-…`. All but the header ID are derived from the content, so one model gives the same bytes.
- `REQ-IF-TOOL-ID` is `reqseq`, `TITLE` the workspace name. `CREATION-TIME` and every `LAST-CHANGE` take one export time (no per-element Git date, ADR-0005). The elements are in one flat SPECIFICATION in the order of the list (SR-052 AK1).
- Kinds, each with a readable attribute for other tools and, for the round trip into ReqSeq (SR-052 AK3), two STRING attributes per object: `reqseq-markdown` (the text, byte for byte) and `reqseq-values` (a JSON object of the exported property values as stored):

  | Own kind | Readable attribute | Read back from a ReqSeq file |
  |---|---|---|
  | title | `LONG-NAME`, STRING `_ad-<type>-title` | `reqseq-values` |
  | text | XHTML | `reqseq-markdown` |
  | text property (`many`: XHTML list; `markdown`: raw) | STRING or XHTML | `reqseq-values` |
  | number | REAL | `reqseq-values` |
  | date | DATE, `T00:00:00Z` | `reqseq-values` |
  | choice (`many`) | ENUMERATION (`MULTI-VALUED`) | `reqseq-values` |
  | relation-valued property (validity, packages) | STRING of short IDs | `reqseq-values` (UUIDs), versions as relations |
  | relation kind | SPEC-RELATION of type `_rt-<kind>` | target, version as below |
  | status | ENUMERATION, for information | never read (D-030, SR-087) |

- A target outside the export is a stub: a SPEC-OBJECT with IDENTIFIER and type only, without values (SR-059 AK2). Omitted properties (SR-059 AK1) are left out of both channels; with `mapping` they are saved in its `omit-properties` and used again (AK3). Statements go back to the source with the source IDENTIFIER from `source-identifier`, as STRING or, when `statement.datatype` says so, as XHTML (SR-058); the output counts the elements without one.

### Import (SR-053..SR-057, SR-095)

- Phases, all or nothing: parse (`reqif.invalid`) → mapping (`reqif.unmapped` with the list of `reqif.analyze`, SR-055) → plan everything in memory → conflicts without a choice (`reqif.conflict`, SR-056 AK4) → preflight of every target (unchanged since read, writable, names free) → write. A refusal comes before any write (SR-055 AK3). `reqif.analyze` runs the same phases up to the plan and writes nothing.
- The write extends `writeElementFiles` of `model/write.ts`: new files are written as temporary siblings that the element walk ignores and renamed last; on a failure the call removes a file it created only while its bytes are exactly what it wrote, restores an updated file only while it is unchanged since it wrote it, reports what it could not undo in `details.written` and resets the store. This departs from that function's "nothing is deleted"; it is compatible with D-045, because no element of the workspace is removed, only a file the failed call itself made.
- A file of ReqSeq (`REQ-IF-TOOL-ID` `reqseq`) needs no mapping: the import builds a one-to-one mapping by IDENTIFIER and saves it as `<portable source name>.yaml` in the mapping folder, or uses that file when it exists (SR-052 AK3, SR-054 AK2). The source name is the input `source`, else the header `TITLE`. `reqseq-markdown` and `reqseq-values` are taken only when the readable attributes written again from them equal those in the file; otherwise another tool changed the content, and the import reads the readable attributes and warns.
- Elements always get new UUIDs (D-056: the file name comes from the UUID, so a kept UUID would collide in the original repository). `source-identifier` holds the IDENTIFIER, e.g. `_<uuid>`. A repeated import matches only by `source` and `source-identifier` (SR-056 AK2). A mapped type without the five origin properties is not imported (loss `type-without-origin`). A stub never becomes an element: a relation to it goes to the element with that UUID when the workspace has one, else it is a loss.
- New elements get the initial status of their type; the import never sets a status (D-030, SR-087). Dropped requirements are only listed (SR-056 AK3). An update writes the mapped fields and the origin and keeps the unmapped properties (SR-102); it replaces only relations of mapped kinds between elements of this source and keeps local ones.
- Importfassung (`import-version`, D-059): an `n1` hash (ADR-0005) over what the import writes: title, text, the mapped properties whether they count to the version or not, and the bytes of the text's embedded images; unmapped and origin properties are left out (assumption carried in #511). It never counts to the version. *Changed* (SR-056 AK1): the hash of the delivery differs from it. *Locally changed*: the hash of the current element differs from it. A *conflict* is both; `take` writes the delivery like an update, `keep` leaves the content and writes `import-version` (the delivery's hash), `delivery` and `import-date`, so the same conflict does not come back.
- Versions: planned versions take the hashes of the image bytes to be copied instead of the lookup on disk. Every relation and relation-valued property the import writes carries the planned version of its target when the target is imported, else its current version (#508): after a round trip no relation is outdated. This also hides, intentionally, a change of a target from an element the same delivery changes.
- Losses (SR-053 AK2, SR-095 AK3) are `common.schema.json#/$defs/reqifLoss`: the object, its element when there is one, a stable `code` and the reason. One per SPECIFICATION for its hierarchy, one per SPEC-RELATION whose other end is not imported.

### Paths

- An embedded object (`<xhtml:object data>`, SR-095 AK2) must be a relative path without scheme that resolves, real path included, below the folder of the ReqIF file (later: inside the `.reqifz`), for every access; through API and MCP it must also lie inside the repositories, checked by the path check of the command context (SR-142). Otherwise it is a loss `image-outside`, and a missing file `image-missing`. Images are copied through `files` like an image pasted in the app.
- Mapping files are written only inside the mapping folder (`mappings` of the workspace file, default `reqif` in the main repository; SR-054 AK1), for every access: `reqif.saveMapping`, the saved one-to-one mapping and `omit-properties` of the export. A mapping may be read from any path the access allows.

### Tests

- Every written file is checked against the ReqIF 1.2 XSDs, kept byte for byte in `toolchain/reqif/schema/` with source, checksum and licence in its README, by `validateReqif` of the testkit with `xmllint-wasm` (MIT, libxml2 MIT; `--nonet`, in process, the same on every OS). The `schemaLocation`s are pointed to the local files in memory at load; nothing is fetched. libxml2 does not resolve IDREFs in element content, so `validateReqif` checks every `*-REF` itself.
- Hand-written samples per feature are in `toolchain/reqif/samples/` (D-054). Once, at stage acceptance, a real file from another tool is imported.
