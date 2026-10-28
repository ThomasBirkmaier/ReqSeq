// An element whose file changed outside the tool while its buffer is open (SR-106), as pure functions: the
// buffer has fields (the text, each property box), each with what the file holds and, when it was typed
// in, the input. What happens is decided per field from the outputs of `element.get` (ADR-0002):
// - a field without input follows the file (its editor takes the new text, the cursor stays: AK1);
// - a field whose input is what the file now holds has no input any more (its draft entry is dropped);
// - when the file's bytes (`fileSha256`) are no longer those the input was typed on and input is left,
//   nothing is saved until the user chooses (AK2): the editors keep the input, a quiet block "On disk"
//   under every field with input shows the file's value, and "Resolve change on disk" asks "Keep my input"
//   or "Take the file";
// - a file that is gone (`ref.unknown`) leaves the content in the editors, read-only, with a hint (AK3).
// Assumption until spec question #488 (1) is answered: every change of the file while there is input stops
// saving and asks (the literal reading of AK2), not only a change of a field with input.
import type { Prompt } from "./actions.js";
import type { BoxDraft, Draft } from "./drafts.js";
import type { PropertyInfo } from "./element-view.js";
import { choiceKeys, relationTargets } from "./property-edit.js";

/** The field of the text; the property boxes are named by their keys. */
export const TEXT_FIELD = "Text";

/** What the file holds: its bytes (`fileSha256`; none from an answer without it) and the document of each field. */
export interface FileFields {
  readonly sha: string | undefined;
  readonly docs: ReadonlyMap<string, string>;
}

/** A field with input that the file no longer agrees with: the input in the editor, the file's value below it. */
export interface ConflictField {
  readonly label: string;
  readonly input: string;
  readonly disk: string;
}

/** What a buffer with `input` does after the file was read again. */
export type OutsideChange =
  /** No conflict: the fields without input follow the file, and the `dropped` fields hold what the file holds now. */
  | { readonly kind: "follow"; readonly dropped: readonly string[] }
  /**
   * Nothing is saved until the user chooses: the fields with input that the file holds otherwise. The
   * `dropped` fields hold what the file holds now.
   */
  | {
      readonly kind: "conflict";
      readonly dropped: readonly string[];
      readonly fields: readonly ConflictField[];
    };

/**
 * Whether a failed read of the shown element says that its file is gone (SR-106 AK3); any other failure
 * keeps the buffer as it is and is only echoed.
 */
export const isGone = (code: string): boolean => code === "ref.unknown";

/**
 * How long a file that a read found gone is asked for again before the buffer says it is deleted: longer
 * than one batch of core's watcher (at most 1 s) plus the time core takes to apply a large one (#586
 * review, N8). A file that is being written (a pull) is reported as removed in one batch and added in the
 * next, and core's store does not know the element in between, so the first `ref.unknown` is no deletion
 * yet (SR-106 AK3); the buffer stays editable meanwhile, and no input is lost.
 */
export const GONE_CONFIRM_MS = 2000;

/**
 * After a read found the file gone at `now`: how long to wait before asking again, or 0 when the file has
 * been gone since `since` for long enough to say it is deleted. `since` is the first such read, undefined
 * when the read before found the file.
 */
export const goneWait = (since: number | undefined, now: number): number =>
  since === undefined ? GONE_CONFIRM_MS : Math.max(0, since + GONE_CONFIRM_MS - now);

/** The value of a field in the file: a property the file has not is the empty document. */
const fileDoc = (file: FileFields, label: string): string => file.docs.get(label) ?? "";

/**
 * The outside change for a buffer whose fields with input are `input` (label to document), typed on the
 * file with the bytes `basis`, now that the file is `file`.
 */
export const outsideChange = (
  input: ReadonlyMap<string, string>,
  basis: string | undefined,
  file: FileFields,
): OutsideChange => {
  const left = [...input].filter(([label, doc]) => doc !== fileDoc(file, label));
  const dropped = [...input.keys()].filter((label) => !left.some(([kept]) => kept === label));
  // The trigger (spec question #488, 1): the file is another one than the input was typed on. Answer (b)
  // would ask only when a field with input changed on disk.
  const stops = file.sha !== basis;
  if (left.length === 0 || !stops) {
    return { kind: "follow", dropped };
  }
  return {
    kind: "conflict",
    dropped,
    fields: left.map(([label, doc]) => ({ label, input: doc, disk: fileDoc(file, label) })),
  };
};

/**
 * The input of a draft that the app kept while another buffer was shown: the text when it was typed in,
 * and every box of the draft.
 */
export const draftInput = (kept: Draft): Map<string, string> =>
  new Map([
    ...(kept.text === kept.base ? [] : [[TEXT_FIELD, kept.text] as const]),
    ...[...(kept.boxes ?? [])].map(([key, box]) => [key, box.doc] as const),
  ]);

/**
 * The boxes of a kept draft that still have input, on the stored values of the file now. A box whose
 * property is no longer in the file keeps its input as an added box (its base is the empty document), so
 * no input is lost.
 */
export const keptBoxes = (
  kept: Draft,
  dropped: readonly string[],
  stored: ReadonlyMap<string, string>,
): [string, BoxDraft][] =>
  [...(kept.boxes ?? [])]
    .filter(([key]) => !dropped.includes(key))
    .map(([key, box]) => [key, { doc: box.doc, base: stored.get(key) ?? "" }]);

/** One line of the block "On disk": the file's line, and whether the input lacks it. */
export interface DiskLine {
  readonly text: string;
  readonly differs: boolean;
}

/** Above this many lines on either side the block shows the file's value without marks. */
export const DISK_DIFF_MAX_LINES = 2000;

/**
 * The lines of the file's value, each marked when it is not one of the input's (a longest common
 * subsequence of lines): the block shows the file's version as it is, with what differs in heavier weight.
 */
export const diskLines = (disk: readonly string[], input: readonly string[]): DiskLine[] => {
  if (disk.length > DISK_DIFF_MAX_LINES || input.length > DISK_DIFF_MAX_LINES) {
    return disk.map((text) => ({ text, differs: false }));
  }
  const width = input.length + 1;
  // The length of the longest common subsequence of disk[i..] and input[j..], at i * width + j.
  const table = new Uint32Array((disk.length + 1) * width);
  const cell = (i: number, j: number): number => Number(table[i * width + j]);
  for (let i = disk.length - 1; i >= 0; i -= 1) {
    for (let j = input.length - 1; j >= 0; j -= 1) {
      table[i * width + j] =
        disk[i] === input[j] ? cell(i + 1, j + 1) + 1 : Math.max(cell(i + 1, j), cell(i, j + 1));
    }
  }
  const common = new Set<number>();
  for (let i = 0, j = 0; i < disk.length && j < input.length;) {
    if (disk[i] === input[j]) {
      common.add(i);
      i += 1;
      j += 1;
    } else if (cell(i + 1, j) >= cell(i, j + 1)) {
      i += 1;
    } else {
      j += 1;
    }
  }
  return disk.map((text, at) => ({ text, differs: !common.has(at) }));
};

/**
 * The lines a field shows for a document: the text and a text box their lines, a choice the names of
 * its keys, a relation the labels of its targets. `info` is none for the text.
 */
export const fieldLines = (info: PropertyInfo | undefined, doc: string): string[] => {
  if (info?.kind === "choice") {
    return choiceKeys(doc).map((key) => info.choices?.find((choice) => choice.key === key)?.name ?? key);
  }
  if (info?.kind === "relation") {
    return relationTargets(doc).map((target) => target.label);
  }
  // The final line break of a text (ADR-0004) is no line of its own.
  return doc === "" ? [] : doc.replace(/\n$/, "").split("\n");
};

/** The block "On disk" of a field in conflict: the file's lines, marked where the input differs. */
export const onDisk = (field: ConflictField, info: PropertyInfo | undefined): DiskLine[] =>
  diskLines(fieldLines(info, field.disk), fieldLines(info, field.input));

/** What the modeline says of the file (SR-106): gone, changed under the input, or nothing. */
export const diskMark = (
  deleted: boolean,
  conflict: readonly ConflictField[] | undefined,
): "deleted" | "changed" | undefined =>
  deleted ? "deleted" : conflict === undefined ? undefined : "changed";

/** What the minibuffer says once when a conflict begins. */
export const changedOnDisk = (name: string): string =>
  `${name} changed on disk. Resolve with "Resolve change on disk"`;

/** What the minibuffer says once when the file is gone, and on every try to change it. */
export const deletedOnDisk = (name: string): string =>
  `${name} was deleted on disk; its content stays here until you close the buffer`;

/**
 * What a save says while a read found the file gone and the buffer asks again (`goneWait`): nothing is
 * written until the file is there again or its deletion is certain.
 */
export const unreadable = (name: string): string =>
  `${name} cannot be read now; it may have been deleted on disk`;

/** What "Save element" says while there is a conflict: nothing is saved. */
export const RESOLVE_FIRST = "Resolve the change on disk first";

/** The title of the action and its prompt. */
export const RESOLVE_TITLE = "Resolve change on disk";

/** The two choices: the input is written over the file's value, or the file's value replaces the input. */
export const KEEP_INPUT = "Keep my input";
export const TAKE_FILE = "Take the file";

/** The prompt of "Resolve change on disk": which version holds. */
export const resolvePrompt = (keep: () => void, take: () => void): Prompt => ({
  label: RESOLVE_TITLE,
  items: [
    { id: "keep-input", name: KEEP_INPUT, run: keep },
    { id: "take-file", name: TAKE_FILE, run: take },
  ],
});
