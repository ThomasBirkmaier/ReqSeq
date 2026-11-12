// The document of the acceptance criteria box with the criterion key of each line (SR-204 AK7 to AK9).
// The element buffer compares, keeps as a draft and saves the document of a box as one string; for the
// criteria box that string holds the keys too, so a changed key is input like a changed text and a draft
// brings the keys back. A line that is not blank is `<key>\u001f<text>` (an empty key for a line without
// one); a blank line is itself and holds no key. A line without the mark (a draft written before the keys)
// reads as a line without key. The editor shows the texts only (`editor/criterion-keys.ts`).
import { isBlankLine } from "@reqseq/core/criterion-lines";
import type { PropertyInfo } from "./element-view.js";

/** Between the key and the text of a line: a control character no criterion text holds. */
export const KEY_MARK = "\u001f";

/** The lines of a criteria document and the key of each; undefined where a line has none. */
export interface CriterionLines {
  readonly lines: readonly string[];
  readonly keys: readonly (string | undefined)[];
}

/** Whether a box holds the acceptance criteria: the property with that meaning, a list of text (`acceptanceCriteriaKeyOf`). */
export const isCriteriaInfo = (info: PropertyInfo): boolean =>
  info.meaning === "acceptance-criteria" && info.kind === "text" && info.many;

/** The document of `lines` with their `keys`. */
export const keyedDoc = (lines: readonly string[], keys: readonly (string | undefined)[]): string =>
  lines.map((line, i) => (isBlankLine(line) ? line : `${keys[i] ?? ""}${KEY_MARK}${line}`)).join("\n");

/** The lines and keys of a criteria document. */
export const criterionLines = (doc: string): CriterionLines => {
  const lines: string[] = [];
  const keys: (string | undefined)[] = [];
  for (const line of doc.split("\n")) {
    const at = line.indexOf(KEY_MARK);
    lines.push(at < 0 ? line : line.slice(at + 1));
    keys.push(at <= 0 ? undefined : line.slice(0, at));
  }
  return { lines, keys };
};

/** What a box document says as text (a copy, the block "On disk"): for the criteria box without the keys. */
export const shownDoc = (info: PropertyInfo | undefined, doc: string): string =>
  info !== undefined && isCriteriaInfo(info) ? criterionLines(doc).lines.join("\n") : doc;
