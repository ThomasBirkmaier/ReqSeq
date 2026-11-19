// `licenses/THIRD-PARTY-NOTICES.txt` of the HTML export (ADR-0015): every package whose code or styles the folder
// holds, with its licence texts: the Mermaid bundle and KaTeX (`notices.generated.ts`) and Starlight, whose page
// frame and stylesheet the pages use (`docs-theme.generated.ts`).
import { STARLIGHT_NOTICE } from "./docs-theme.generated.js";
import { VENDOR_NOTICES } from "./notices.generated.js";

/** The notices file, relative to the export folder. */
export const NOTICES_FILE = "licenses/THIRD-PARTY-NOTICES.txt";

/** The text of the notices file. */
export const noticesText = (): string => {
  const entries = [...VENDOR_NOTICES, { ...STARLIGHT_NOTICE, texts: [STARLIGHT_NOTICE.text] }].sort(
    (a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version),
  );
  const sections = entries.map((p) =>
    [
      `${p.name} ${p.version}`,
      `License: ${p.license}`,
      "",
      ...(p.texts.length > 0 ? p.texts : ["(the package has no licence file)"]),
    ].join("\n"),
  );
  return `Third-party software in this HTML export of ReqSeq\n\n${sections.join(`\n\n${"-".repeat(72)}\n\n`)}\n`;
};
