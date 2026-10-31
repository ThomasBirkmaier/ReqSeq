# ReqIF block (`src/reqif/`)

ReqIF 1.2 import and export (SR-052..SR-059, SR-095; ADR-0013). So far the model and the parser; the writer, the XHTML conversion and the commands follow (#265, Lanes E and I).

## Model (`model.ts`)

`ReqifFile`: the header, datatypes (STRING, XHTML, INTEGER, REAL, DATE, BOOLEAN, ENUMERATION with its values, `KEY` and `OTHER-CONTENT`), spec types by category (`spec-object`, `spec-relation`, `specification`, `relation-group`) with their attribute definitions, SPEC-OBJECTs, SPEC-RELATIONs, SPECIFICATIONs with the nested SPEC-HIERARCHY, and `unread`: the elements the model leaves out (relation groups, tool extensions, unknown definitions), by name and line, for the loss list (SR-053 AK2). Every identifiable keeps IDENTIFIER, `LONG-NAME`, `LAST-CHANGE`, `DESC` and its line. References stay IDENTIFIERs; values stay the text of the file (numbers, dates, booleans as written), the import converts them. An XHTML value is the namespace-resolved node tree (`XhtmlElement`: local name, namespace, attributes, children in order with the text runs between them), never a re-escaped string.

## Parser (`parse.ts`)

`parseReqif(bytes)` gives `{ kind: "parsed", file }` or `{ kind: "refused", message, line }`; the commands turn a refusal into `reqif.invalid`.

- The bytes stream through `streamXml` of `files/xml-scan.ts` (ADR-0012): UTF-8 only, no `<!DOCTYPE`, no entity but the five predefined ones and numeric references, well-formed only, so no file can make ReqSeq open a connection or read another file. No tree of the whole file is built: each item of DATATYPES, SPEC-TYPES, SPEC-OBJECTS, SPEC-RELATIONS and SPECIFICATIONS is read when it ends and its elements are dropped; inside THE-VALUE the XHTML elements are kept as the model's nodes at once. The walk is the scanner's iteration, so nesting depth is not limited (a SPEC-HIERARCHY 5,000 levels deep is read).
- Memory (Node 22, default heap): a delivery of 50,000 SPEC-OBJECTs with XHTML and 200,000 SPEC-RELATIONs (114 to 161 MB) keeps about 250 to 290 MB and parses in a heap of 448 MB, in about 6 to 9 s. Guards: more than `MAX_REQIF_BYTES` (256 MiB) is refused before reading, more than `MAX_REQIF_ELEMENTS` (8 million, the model keeps at most about 100 bytes per element) while reading; a hostile file of millions of tiny elements stays under 0.7 GB.
- Refused while reading: a prefix without declaration (of an element or an attribute), a root that is not `REQ-IF` in the ReqIF namespace, a ReqIF element inside XHTML, a missing required part (`THE-HEADER`, `REQ-IF-HEADER`, `CORE-CONTENT`, `REQ-IF-CONTENT`, a `TYPE`, `DEFINITION`, `SOURCE`, `TARGET` or `OBJECT` reference, `THE-VALUE`) and an identifiable without IDENTIFIER.
- Names of elements are resolved by their namespace declarations, never by the prefix: `reqif:SPEC-OBJECT` and an unprefixed one in the default namespace are the same, and XHTML may sit in a default namespace on its `div`. Attributes keep their name as written, in an object without prototype (`__proto__` is an ordinary name). `MULTI-VALUED` is an `xsd:boolean` (`true` or `1`).
- `unread` holds, by name and line: unknown children of the root, the children of TOOL-EXTENSIONS and of unknown or foreign parts (relation groups), and unknown children of the items read. Part 1b of #265 refuses a repeated part, records what is still dropped (a second VALUES, THE-ORIGINAL-VALUE, defaults, facets) and gives each entry its owner, as the loss list needs; it also refuses an IDENTIFIER used twice and warns about dangling references. Until then a reference to an IDENTIFIER the file does not define is kept as written.
- `.reqifz` archives are not read (SR-053).

The hand-written samples and the nightly parse at N-036 follow in part 1b.
