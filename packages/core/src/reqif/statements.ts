// The plan of `reqif.export` with `statements` (SR-058, ADR-0013 "Export"): the statement
// (Stellungnahme) of each element of a source as a ReqIF model, in memory, for `writeReqif`. Pure:
// the command picks the elements and reads the mapping.
//
// - Header as for every export (`planExport`): `_hd-<uuid>`, TITLE the workspace name,
//   REQ-IF-TOOL-ID `reqseq`, one export time for CREATION-TIME and every LAST-CHANGE.
// - One SPEC-OBJECT-TYPE `_ot-statement` with one attribute: LONG-NAME the mapping's
//   `statement.attribute`, IDENTIFIER the same when it is an NCName (§10.8.32), else
//   `_ad-statement`; STRING `_dt-string` (MAX-LENGTH the longest statement, at least 1), or XHTML
//   `_dt-xhtml` (the Markdown converted by `markdownToXhtml`, links as written) when
//   `statement.datatype` is `xhtml`.
// - A SPEC-OBJECT per element in the order of the list, IDENTIFIER its source IDENTIFIER
//   (`source-identifier`), with only the statement: an element without one has an empty value
//   (counted in `withoutStatement`, SR-058 AK1). No title, text, other values or relations.
// - One flat SPECIFICATION `_sp-<hash of the identifiers>` with a SPEC-HIERARCHY `_sh-<uuid>` per
//   element.
import { createHash } from "node:crypto";
import { OWN_DATATYPES, OWN_TOOL_ID } from "./own.js";
import type { ReqifWritable } from "./write.js";
import { NC_NAME } from "./write.js";
import { markdownToXhtml } from "./xhtml-markdown.js";

/** One element whose statement goes back to its source. */
export interface StatementElement {
  /** The UUID of the element. */
  readonly id: string;
  /** Its source IDENTIFIER (`source-identifier`). */
  readonly identifier: string;
  /** Its statement as stored (Markdown), undefined when it has none. */
  readonly statement: string | undefined;
}

export interface StatementsInput {
  readonly title: string;
  readonly time: string;
  readonly header: string;
  readonly sourceToolId: string;
  /** The mapping's `statement.attribute`. */
  readonly attribute: string;
  readonly datatype: "string" | "xhtml";
  /** In the order of the list. */
  readonly elements: readonly StatementElement[];
}

export interface StatementsPlan {
  readonly file: ReqifWritable;
  /** The elements without a statement. */
  readonly withoutStatement: number;
}

const STATEMENT_TYPE = "_ot-statement";

/** Code points: a surrogate pair is one character, as MAX-LENGTH counts. */
const characters = (text: string): number => text.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, "_").length;

export const planStatements = (input: StatementsInput): StatementsPlan => {
  const { time: lastChange, datatype } = input;
  const definition = NC_NAME.test(input.attribute) ? input.attribute : "_ad-statement";
  let longest = 0;
  const specObjects = input.elements.map(({ identifier, statement }) => {
    const text = statement ?? "";
    longest = Math.max(longest, characters(text));
    const value: ReqifWritable["specObjects"][number]["values"][number] =
      datatype === "xhtml"
        ? { kind: "xhtml", definition, value: [markdownToXhtml(text, { image: (url) => url }).value] }
        : { kind: "string", definition, value: text };
    return { identifier, lastChange, type: STATEMENT_TYPE, values: [value] };
  });
  const identifiers = input.elements.map((e) => e.identifier);
  const datatypeId = datatype === "xhtml" ? OWN_DATATYPES.xhtml : OWN_DATATYPES.string;
  return {
    file: {
      header: {
        identifier: `_hd-${input.header}`,
        title: input.title,
        creationTime: lastChange,
        toolId: OWN_TOOL_ID,
        sourceToolId: input.sourceToolId,
        version: "1.0",
      },
      datatypes: [
        datatype === "xhtml"
          ? { identifier: datatypeId, lastChange, kind: "xhtml", values: [] }
          : {
              identifier: datatypeId,
              lastChange,
              kind: "string",
              maxLength: String(Math.max(1, longest)),
              values: [],
            },
      ],
      specTypes: [
        {
          identifier: STATEMENT_TYPE,
          lastChange,
          longName: "statement",
          category: "spec-object",
          attributes: [
            {
              identifier: definition,
              lastChange,
              longName: input.attribute,
              kind: datatype,
              datatype: datatypeId,
              multiValued: false,
            },
          ],
        },
        {
          identifier: "_st-specification",
          lastChange,
          longName: "specification",
          category: "specification",
          attributes: [],
        },
      ],
      specObjects,
      specRelations: [],
      specifications: [
        {
          identifier: `_sp-${createHash("sha256").update(identifiers.join("\n")).digest("hex").slice(0, 32)}`,
          lastChange,
          longName: input.title,
          type: "_st-specification",
          values: [],
          children: input.elements.map(({ id, identifier }) => ({
            identifier: `_sh-${id}`,
            lastChange,
            object: identifier,
            children: [],
          })),
        },
      ],
    },
    withoutStatement: input.elements.filter((e) => e.statement === undefined).length,
  };
};
