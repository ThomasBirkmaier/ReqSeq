# ReqIF samples

Hand-written ReqIF 1.2 files for the tests of the ReqIF block (ADR-0013, D-054). They are ours, written for these tests; no file of another tool is checked in. A real file from another tool is imported once at stage acceptance.

| File | What it shows |
|---|---|
| `basic.reqif` | Every datatype, an enumeration with keys, two SPEC-OBJECT-TYPEs (`ot-note` for a mapping that omits it), two SPEC-RELATIONs (`rel-2` from a note), two SPECIFICATIONs with a nested SPEC-HIERARCHY; and what is not taken over: a RELATION-GROUP, an ALTERNATIVE-ID and THE-ORIGINAL-VALUE of `req-1`, a tool extension |
| `xhtml-rich.reqif` | ReqIF elements with a prefix and XHTML with a default namespace: headings, nested lists, a table with `rowspan`, a `style` colour, `object` images inside, outside (`../`) and absolute (SR-095) |
| `images/start.png` | The image `xhtml-rich.reqif` embeds (the PNG signature only) |
| `bom-crlf.reqif` | A byte order mark and CRLF line ends (kept byte for byte, see `.gitattributes`) |

The XSD check of every sample comes with the writer (#265, part 2). `packages/core/src/reqif/parse.test.ts` shows what the parser reads from each.
