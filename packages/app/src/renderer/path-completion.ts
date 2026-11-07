// Completion of a typed path in the command prompt (SR-143): the folder of the typed text, up to its last
// separator (`/`, and `\` on Windows), is listed by core (`workspace.listFolder`, or for "Open workspace"
// main's listing of the same function), and the typed name after it narrows its entries with the ranking
// of the command prompt (`fuzzy.ts`, on the NFC form of the names, so a name a Mac file system gives in
// NFD matches what is typed), folders and links before files (AK3). Core decides which entries exist:
// names that start with "." only when the typed name does (AK6), files only for a file argument. A
// listing is asked once per folder and dot rule while the prompt is open, so a letter only narrows it
// (AK5); the prompt drops the answers of texts typed over. A choice puts the path up to the entry in the
// input (the spelling on disk, a folder or link with a separator at its end) and keeps the prompt open
// (AK1); at most SHOWN_ENTRIES are shown, a row "… n more" stands for the rest, so 10,000 entries render
// within the bound. A folder that is missing, not readable or refused by its text gives no choices and a
// note for the label (AK4). UI only: the app decides nothing about the paths (ADR-0002).
import type { FolderListing, FolderProblem } from "../shared/protocol.js";
import type { Choice, Found } from "./actions.js";
import { rank } from "./fuzzy.js";

/** At most this many entries are shown; one row more says how many are left out (SR-143 AK5). */
export const SHOWN_ENTRIES = 200;

/** A typed path split at its last separator. */
export interface TypedPath {
  /** The text up to and with the last separator; empty when there is none. */
  readonly folder: string;
  /** The text after it: the name being typed. */
  readonly name: string;
}

/** Splits `text` at its last separator, as core does (`splitTypedPath`): `\` is one only on Windows. */
export const splitPath = (text: string, windows: boolean): TypedPath => {
  const at = windows ? Math.max(text.lastIndexOf("/"), text.lastIndexOf("\\")) : text.lastIndexOf("/");
  return { folder: text.slice(0, at + 1), name: text.slice(at + 1) };
};

/** What a listing answers: the folder's entries or its problem, or why it could not be asked. */
export type ListingAnswer = FolderListing | { readonly failed: string };

export interface PathCompletion {
  /** Lists the folder of a typed path: the entries the typed name may take (core's dot rule). */
  readonly list: (text: string) => Promise<ListingAnswer>;
  /** Whether `\` separates, and is the separator a completed folder gets when none was typed. */
  readonly windows: boolean;
  /** The choices take the place of the prompt's own items ("Open workspace", AK1). */
  readonly alone?: boolean;
}

const NOTES: Readonly<Record<FolderProblem, (folder: string) => string>> = {
  missing: (folder) => `${folder} is missing`,
  unreadable: (folder) => `${folder} is not readable`,
  invalid: () => "Not a local folder path",
};

const noop = (): void => undefined;

/** A choice that puts `text` in the input and keeps the prompt open. */
const completing = (id: string, name: string, text: string, extra: Partial<Choice> = {}): Choice => ({
  id,
  name,
  complete: text,
  run: noop,
  ...extra,
});

/**
 * The one completion of a text that names no folder yet: `~` gives `~/` (the home folder), and on Windows
 * a drive `C:` gives `C:\`.
 */
const shortcutOf = (text: string, windows: boolean): string | undefined =>
  text === "~" ? `~${windows ? "\\" : "/"}` : windows && /^[A-Za-z]:$/.test(text) ? `${text}\\` : undefined;

/**
 * The choices for the entries of a folder typed as `folder`, narrowed by `name`: the best matches first,
 * folders and links before files, each with the matched letters marked; at most SHOWN_ENTRIES and a row
 * for the others.
 */
export const entryChoices = (
  entries: FolderListing["entries"],
  folder: string,
  name: string,
  windows: boolean,
): Choice[] => {
  const fuzzy = rank(entries, (entry) => entry.name.normalize("NFC"), name);
  // A typed name of signs only ("." of AK6, "..", "-") has no letters for the fuzzy search: the names that
  // start with it, in core's order.
  const ranked =
    fuzzy.length > 0 || /[\p{L}\p{N}]/u.test(name)
      ? fuzzy
      : entries
          .filter((entry) => entry.name.normalize("NFC").startsWith(name))
          .map((item) => ({ item, ranges: [[0, name.length] as const] }));
  const ordered = [
    ...ranked.filter(({ item }) => item.kind !== "file"),
    ...ranked.filter(({ item }) => item.kind === "file"),
  ];
  // The separator typed last, else the platform's.
  const separator = folder === "" ? (windows ? "\\" : "/") : folder.slice(-1);
  const shown = ordered.slice(0, SHOWN_ENTRIES).map(({ item, ranges }) => {
    const end = item.kind === "file" ? "" : separator;
    return completing(
      `entry:${item.name}`,
      `${item.name.normalize("NFC")}${end}`,
      `${folder}${item.name}${end}`,
      {
        marks: ranges,
        ...(item.kind === "link" ? { hint: "link" } : {}),
      },
    );
  });
  const left = ordered.length - shown.length;
  return left > 0
    ? [...shown, { id: "more", name: `… ${left.toLocaleString("en")} more`, inert: true, run: noop }]
    : shown;
};

/** What `seek` gives for a typed path: the entries of its folder, or a note why there are none. */
export const pathSeeker = (completion: PathCompletion): ((text: string) => Promise<Found>) => {
  const { windows } = completion;
  const alone = completion.alone === true ? { alone: true } : {};
  // One listing per folder and dot rule while the prompt is open: a letter typed only narrows it.
  const listings = new Map<string, Promise<ListingAnswer>>();
  return async (text) => {
    const shortcut = shortcutOf(text, windows);
    if (shortcut !== undefined) {
      return { choices: [completing("shortcut", shortcut, shortcut)], ...alone };
    }
    const { folder, name } = splitPath(text, windows);
    const dots = name.startsWith(".") ? "." : "";
    const key = JSON.stringify([folder, dots]);
    let listing = listings.get(key);
    if (listing === undefined) {
      // The typed name matters to core only by its first character (the dot rule).
      listing = completion.list(`${folder}${dots}`);
      listings.set(key, listing);
    }
    const answer = await listing;
    // Only entries are kept: a folder that is missing, not readable or had no answer in time (a slow share)
    // is asked again on the next key, so it gives suggestions once it answers.
    if (("failed" in answer || answer.problem !== undefined) && listings.get(key) === listing) {
      listings.delete(key);
    }
    if ("failed" in answer) {
      return { choices: [], note: answer.failed, ...alone };
    }
    if (answer.problem !== undefined) {
      return { choices: [], note: NOTES[answer.problem](answer.folder ?? folder), ...alone };
    }
    return { choices: entryChoices(answer.entries, folder, name, windows), ...alone };
  };
};
