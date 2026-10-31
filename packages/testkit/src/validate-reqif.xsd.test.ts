// The real ReqIF 1.2 XSDs (ADR-0013): skipped locally with the reason of REQIF_XSD_SKIP_REASON,
// required in CI, where the step `ReqIF XSDs` downloads them into REQSEQ_REQIF_XSD_DIR.
import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { REQIF_XSD_PINS, reqifXsdDir, validateReqif } from "./validate-reqif.js";

const SAMPLES = new URL("../../../toolchain/reqif/samples/", import.meta.url);
const NS = 'xmlns="http://www.omg.org/spec/ReqIF/20110401/reqif.xsd"';
const T = "2026-10-31T00:00:00Z";
const minimal = (identifier: string, content = ""): string =>
  `<?xml version="1.0" encoding="UTF-8"?><REQ-IF ${NS}><THE-HEADER><REQ-IF-HEADER IDENTIFIER="${identifier}"><CREATION-TIME>${T}</CREATION-TIME><REQ-IF-TOOL-ID>t</REQ-IF-TOOL-ID><REQ-IF-VERSION>1.0</REQ-IF-VERSION><SOURCE-TOOL-ID>t</SOURCE-TOOL-ID><TITLE>t</TITLE></REQ-IF-HEADER></THE-HEADER><CORE-CONTENT><REQ-IF-CONTENT>${content}</REQ-IF-CONTENT></CORE-CONTENT></REQ-IF>`;
const pins = (): string => fs.readFileSync(REQIF_XSD_PINS, "utf8");

describe("the ReqIF 1.2 XSDs", () => {
  it("accept a minimal file and every hand-written sample", async (context) => {
    const dir = reqifXsdDir(context, process.env);
    expect(await validateReqif(minimal("_hd"), dir, pins())).toEqual({ valid: true, errors: [] });
    for (const name of ["basic.reqif", "xhtml-rich.reqif", "bom-crlf.reqif"]) {
      const text = fs.readFileSync(new URL(name, SAMPLES), "utf8").replace(/^\uFEFF/, "");
      expect(await validateReqif(text, dir, pins()), name).toEqual({ valid: true, errors: [] });
    }
  });

  it("refuse an IDENTIFIER that starts with a digit and one used twice, and the own check finds a dangling reference", async (context) => {
    const dir = reqifXsdDir(context, process.env);
    expect((await validateReqif(minimal("1hd"), dir, pins())).errors).toEqual([
      expect.stringContaining("'1hd' is not a valid value of the atomic type 'xs:ID'"),
    ]);
    const twice = `<DATATYPES><DATATYPE-DEFINITION-DATE IDENTIFIER="_hd" LAST-CHANGE="${T}"/></DATATYPES>`;
    expect((await validateReqif(minimal("_hd", twice), dir, pins())).valid).toBe(false);
    const dangling = `<SPEC-OBJECTS><SPEC-OBJECT IDENTIFIER="_o" LAST-CHANGE="${T}"><TYPE><SPEC-OBJECT-TYPE-REF>_none</SPEC-OBJECT-TYPE-REF></TYPE></SPEC-OBJECT></SPEC-OBJECTS>`;
    expect((await validateReqif(minimal("_hd", dangling), dir, pins())).errors).toEqual([
      "<SPEC-OBJECT-TYPE-REF> _none names no IDENTIFIER of the file",
    ]);
  });
});
