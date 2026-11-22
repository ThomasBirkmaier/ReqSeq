// The image link a destination of a text makes (ADR-0005 "Files"), before the disk is looked at. It imports only
// import-free modules, so the Markdown renderer (`@reqseq/core/markdown`) runs in a browser; `images.ts` re-exports
// it.
import * as posix from "../files/posix-path.js";
import { isSkippedOnSomeSystem, windowsChanges } from "./portable-names.js";

/** A URL with a scheme (`https:`, `file:`, `data:`, also `C:` on Windows): never relative. */
const SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/;

/** A backslash before ASCII punctuation escapes it (CommonMark). */
const ESCAPE = /\\([!-/:-@[-`{-~])/g;

/** Whether `text` holds a C0 control character or DEL: a path with one never counts. */
const hasControl = (text: string): boolean => {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) {
      return true;
    }
  }
  return false;
};

/** Percent-decoded; a destination that is not valid percent-encoded UTF-8 stays as written. */
const percentDecoded = (destination: string): string => {
  try {
    return decodeURIComponent(destination);
  } catch {
    return destination;
  }
};

/** One image link that counts, before the disk is looked at. */
export interface ImageLink {
  /** As written in the canonical form: relative to the folder of the element file, with `/`. */
  readonly path: string;
  /** The names from the repository folder down to the file. */
  readonly names: readonly string[];
  /** Missing whatever is on disk: a `\`, a trailing `/` or a name that Windows changes. */
  readonly missing: boolean;
}

/** Whether the walk leaves out a path below `names[0..i]`: a skipped name or an `ignore` glob. */
const walkSkips = (names: readonly string[], ignored: (relativePath: string) => boolean): boolean =>
  names.some((name, i) => isSkippedOnSomeSystem(name) || ignored(names.slice(0, i + 1).join("/")));

/**
 * The image link a destination makes, or undefined when it does not count (ADR-0005 "Files"):
 * escapes are removed, a query or fragment dropped, the rest percent-decoded and resolved against
 * the element's folder. It does not count when it is empty, an absolute URL or path, holds a
 * control character, leaves the repository, names the repository folder, the element's folder or
 * the element's own file, or goes through a name the element walk skips.
 */
export const imageLink = (
  elementFile: string,
  destination: string,
  ignored: (relativePath: string) => boolean,
): ImageLink | undefined => {
  const link = destination.replace(ESCAPE, "$1").replace(/[?#][\s\S]*$/, "");
  if (link === "" || SCHEME.test(link) || link.startsWith("/")) {
    return undefined;
  }
  const decoded = percentDecoded(link);
  const folder = posix.dirname(elementFile);
  const resolved = posix.normalize(posix.join(folder, decoded)).replace(/\/$/, "");
  if (hasControl(decoded) || resolved === "." || resolved === ".." || resolved.startsWith("../")) {
    return undefined;
  }
  const names = resolved.split("/");
  // The element's folder and file count as themselves in any normal form.
  const nfc = resolved.normalize("NFC");
  if (nfc === folder.normalize("NFC") || nfc === elementFile.normalize("NFC") || walkSkips(names, ignored)) {
    return undefined;
  }
  const slash = posix.normalize(decoded).endsWith("/");
  // Both from the repository folder, so the working directory of the process plays no part.
  const relative = posix.relative(`/${folder}`, `/${resolved}`);
  return {
    path: slash ? `${relative}/` : relative,
    names,
    missing: slash || decoded.includes("\\") || names.some(windowsChanges),
  };
};

/** Why a destination names no file to read: outside the repository (SR-251 AK5) or missing whatever is on disk (AK2). */
export type ImageTarget =
  | { readonly kind: "outside"; readonly cause: "scheme" | "absolute" | "parent" }
  | { readonly kind: "missing"; readonly cause: "empty" | "backslash" | "control" | "folder" }
  /** The names from the repository folder down to the file, as written; not looked up yet. */
  | { readonly kind: "path"; readonly names: readonly string[] };

/**
 * The file a destination names for reading it (`element.readImage`, SR-251), by its text alone,
 * before any file system call. As `imageLink`, but with a reason for each refusal: a scheme or a
 * leading `/` after the escapes are removed, or a `..` that leaves the repository after decoding, is
 * outside (AK5); an empty one, one with `\` or a control character after decoding, or one that names
 * a folder by a trailing `/` or the repository folder itself is missing (AK2). The element's own file
 * and folder are not refused here: they are a file that is no image and a folder on disk.
 */
export const imageTarget = (elementFile: string, destination: string): ImageTarget => {
  const unescaped = destination.replace(ESCAPE, "$1");
  if (SCHEME.test(unescaped)) {
    return { kind: "outside", cause: "scheme" };
  }
  if (unescaped.startsWith("/")) {
    return { kind: "outside", cause: "absolute" };
  }
  const link = unescaped.replace(/[?#][\s\S]*$/, "");
  if (link === "") {
    return { kind: "missing", cause: "empty" };
  }
  const decoded = percentDecoded(link);
  const resolved = posix.normalize(posix.join(posix.dirname(elementFile), decoded));
  if (resolved === ".." || resolved.startsWith("../")) {
    return { kind: "outside", cause: "parent" };
  }
  if (decoded.includes("\\")) {
    return { kind: "missing", cause: "backslash" };
  }
  if (hasControl(decoded)) {
    return { kind: "missing", cause: "control" };
  }
  if (resolved === "." || resolved === "./" || resolved.endsWith("/")) {
    return { kind: "missing", cause: "folder" };
  }
  return { kind: "path", names: resolved.split("/") };
};
