# ReqIF block (`src/reqif/`)

ReqIF 1.2 import and export (SR-052..SR-059, SR-095; ADR-0013). So far the model and the parser; the writer, the XHTML conversion and the commands follow (#265, Lanes E and I).

## Model (`model.ts`)

`ReqifFile`: the header, datatypes (STRING, XHTML, INTEGER, REAL, DATE, BOOLEAN, ENUMERATION with its values, `KEY` and `OTHER-CONTENT`), spec types by category (`spec-object`, `spec-relation`, `specification`, `relation-group`) with their attribute definitions, SPEC-OBJECTs, SPEC-RELATIONs, SPECIFICATIONs with the nested SPEC-HIERARCHY, and `unread`: the elements the model leaves out (relation groups, tool extensions, unknown definitions), by name and line, for the loss list (SR-053 AK2). Every identifiable keeps IDENTIFIER, `LONG-NAME`, `LAST-CHANGE`, `DESC` and its line. References stay IDENTIFIERs; values stay the text of the file (numbers, dates, booleans as written), the import converts them. An XHTML value is the namespace-resolved node tree (`XhtmlElement`: local name, namespace, attributes, children in order with the text runs between them), never a re-escaped string.

## Parser (`parse.ts`)

`parseReqif(bytes)` gives `{ kind: "parsed", file }` or `{ kind: "refused", message, line }`; the commands turn a refusal into `reqif.invalid`.

- The bytes go through `files/xml-scan.ts` (ADR-0012), which keeps children and text runs in order (`content`). So the parser reads UTF-8 only, refuses `<!DOCTYPE`, every entity but the five predefined ones and numeric references, and input that is not well-formed (truncated, a second root): no file can make ReqSeq open a connection or read another file.
- Refused before reading: more than `MAX_REQIF_BYTES` (256 MiB). Refused while reading: elements nested deeper than `MAX_REQIF_DEPTH` (256), a prefix without declaration, a root that is not `REQ-IF` in the ReqIF namespace, a missing required part (`THE-HEADER`, `REQ-IF-HEADER`, `CORE-CONTENT`, `REQ-IF-CONTENT`, a `TYPE`, `DEFINITION`, `SOURCE`, `TARGET` or `OBJECT` reference, `THE-VALUE`) and an identifiable without IDENTIFIER.
- Names are resolved by their namespace declarations, never by the prefix: `reqif:SPEC-OBJECT` and an unprefixed one in the default namespace are the same, and XHTML may sit in a default namespace on its `div`.
- A reference to an IDENTIFIER the file does not define is kept as written. Refusing an IDENTIFIER used twice and warning about dangling references come in part 1b of #265.
- `.reqifz` archives are not read (SR-053).

The hand-written samples and the nightly parse of 50,000 SPEC-OBJECTs and 200,000 SPEC-RELATIONs (N-036) follow in part 1b of #265.
