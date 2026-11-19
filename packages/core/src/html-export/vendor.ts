// The files the HTML export copies from its vendor folder (SR-231 AK5): the Mermaid bundle and KaTeX's stylesheet
// with its fonts, written by `scripts/build/html-export-vendor.mjs` into `packages/core/vendor/html-export/`. The
// folder lies two levels above both `src/html-export/` and `dist/html-export/`, so it is found from this module in
// tests and builds alike. No input names it: an API or MCP caller must not choose a script folder.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CommandError } from "../catalog.js";

/** The vendor folder (see the file comment). */
export const VENDOR_FOLDER = fileURLToPath(new URL("../../vendor/html-export/", import.meta.url));

export interface VendorFiles {
  readonly mermaid: Uint8Array;
  readonly katex: Uint8Array;
}

/** The vendor files of `folder`; `internal` when one is missing, before the export writes anything. */
export const readVendor = async (folder: string = VENDOR_FOLDER): Promise<VendorFiles> => {
  try {
    const [mermaid, katex] = await Promise.all([
      fs.readFile(path.join(folder, "mermaid.js")),
      fs.readFile(path.join(folder, "katex.css")),
    ]);
    return { mermaid, katex };
  } catch (error) {
    throw new CommandError(
      "internal",
      `The files of the HTML export are missing in ${folder} (${String(error)}); this installation of ReqSeq is incomplete`,
    );
  }
};
