// The cause of an `internal` error as every access may send it (#1794, ADR-0009 "Errors"): the name of the
// original error, its Node code, and the first line of its message without absolute paths. Internal errors
// are bugs; without their cause a user cannot tell a stack overflow from a missing file. The stack and the
// rest of the message stay in the CommandError's `cause`, inside the process.
//
// The sanitiser is pure text: it never touches the file system for a path it finds in a message (SR-078:
// a `\\server` path must not open an SMB connection). The real form of the workspace root is read once per
// workspace before a command runs (`learnWorkspaceRoots`), never when an error is mapped.
import fs from "node:fs/promises";
import { CommandError } from "../catalog.js";
import type { Workspace } from "./workspace.js";
import { defineWorkspaceState } from "./workspace.js";

/** `details.cause` of an `internal` error (common.schema.json#/$defs/error). */
export interface InternalCause {
  /** The error's `name` (`RangeError`), `Error` when it is not a plain word; `typeof` a value that is no Error. */
  readonly name: string;
  /** Node's `code` of the error (`ENOENT`, `ERR_STRING_TOO_LONG`), when it has one of that form. */
  readonly code?: string;
  /** The first line of the error's message, absolute paths replaced, at most MAX_CAUSE_MESSAGE characters. */
  readonly message?: string;
}

export interface InternalCauseOptions {
  /** Roots shown as `<workspace>`: the workspace root as given and its real form (`workspaceRoots`). */
  readonly roots?: readonly string[];
  /** Whose path rules apply to the roots; default `process.platform` (tests). */
  readonly platform?: NodeJS.Platform;
}

/** Characters of the cause message, counted in code points; a longer one is cut and ends with `…`. */
export const MAX_CAUSE_MESSAGE = 160;

/** How much of a message is searched for the end of its first line. */
const HEAD = 4096;

const NAME = /^[A-Za-z][A-Za-z0-9]{0,39}$/;
const CODE = /^[A-Z][A-Z0-9_]{1,39}$/;
/** Control characters (C0, DEL, C1), format characters (`\p{Cf}`) and lone surrogates. */
const UNSEEN = /[\p{Cc}\p{Cf}\p{Cs}]/gu;

/**
 * Where an absolute path starts: a POSIX `/` not inside a word or a relative path, a drive (`C:\`, `c:/`),
 * or a UNC path (`\\server`, `\\?\`, `\\.\`).
 */
const START = String.raw`(?:(?<![A-Za-z0-9._~-])/|(?<![A-Za-z0-9])[A-Za-z]:[\\/]|\\\\)`;
/** A URL: `file:` URLs are paths, other URLs lose their credentials. */
const URL_FORM = String.raw`(?<url>(?<![A-Za-z0-9])[A-Za-z][A-Za-z0-9+.-]*://[^\s'"\x60]*)`;
/** A path right after a quote runs to the same quote; it may hold blanks. */
const QUOTED = String.raw`(?<quote>['"\x60])(?<quoted>${START}(?:(?!\k<quote>).)*)\k<quote>`;
/** Any other path runs to the next blank or quote. */
const BARE = String.raw`(?<bare>${START}[^\s'"\x60]*)`;
/** Punctuation at the end of a bare path that belongs to the sentence: `(at /x/y)`, `/x/y, then`. */
const TRAILING = /[),.;:]+$/;
/** Where an exact path of the error may start and end: a quote, a blank, or the edge of the line. */
const EDGE_BEFORE = String.raw`(?<=^|[\s'"\x60])`;
const EDGE_AFTER = String.raw`(?=$|[\s'"\x60])`;
const ABSOLUTE = new RegExp(`^${START}`);

const escaped = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, (c) => `\\${c}`);

/** `key` of `value`, or undefined when reading it throws (a getter, a Proxy). */
const read = (value: object, key: string): unknown => {
  try {
    return (value as Record<string, unknown>)[key];
  } catch {
    return undefined;
  }
};

/** The text up to the first line break, searched in the first HEAD characters only. */
const firstLine = (message: string): string => {
  const head = message.slice(0, HEAD);
  const ends = [head.indexOf("\n"), head.indexOf("\r")].filter((at) => at >= 0);
  return ends.length === 0 ? head : head.slice(0, Math.min(...ends));
};

/** Roots in the form they are compared in: `/` as separator on Windows, no separator at the end. */
interface Prepared {
  readonly roots: readonly string[];
  readonly windows: boolean;
  readonly folds: boolean;
}

const slashed = (text: string, windows: boolean): string => (windows ? text.replaceAll("\\", "/") : text);

/** A Windows path without its `\\?\` or `\\.\` prefix (as slashes): `//?/C:/x` is `C:/x`, `//?/UNC/s/x` is `//s/x`. */
const withoutDevicePrefix = (text: string): string => {
  if (/^\/\/\?\/UNC\//i.test(text)) {
    return `/${text.slice(7)}`;
  }
  return /^\/\/[?.]\//.test(text) ? text.slice(4) : text;
};

const prepare = (options: InternalCauseOptions): Prepared => {
  const platform = options.platform ?? process.platform;
  const windows = platform === "win32";
  // A root `/` (or `C:\`) becomes "", which every absolute path starts with; the longest root wins.
  const roots = [
    ...new Set(
      (options.roots ?? [])
        .filter((root) => root !== "")
        .map((root) => slashed(root, windows).replace(/\/+$/, "")),
    ),
  ].sort((a, b) => b.length - a.length);
  return { roots, windows, folds: windows || platform === "darwin" };
};

const fold = (text: string): string => text.toLowerCase();

/** `<workspace>` and the rest of `path` with `/`, when it lies in a root; else `<path>`. */
const placed = (path: string, prepared: Prepared): string => {
  const plain = prepared.windows ? withoutDevicePrefix(slashed(path, true)) : path;
  for (const root of prepared.roots) {
    const head = plain.slice(0, root.length);
    const same = prepared.folds ? fold(head) === fold(root) : head === root;
    if (same && (plain.length === root.length || plain[root.length] === "/")) {
      const rest = slashed(plain.slice(root.length), true);
      // `/ws/../home/x` lies outside the root.
      return rest.split("/").includes("..") ? "<path>" : `<workspace>${rest}`;
    }
  }
  return "<path>";
};

/**
 * A `file:` URL as its path, placed; any other URL without the user and password before its host and without
 * its query and fragment, which may hold a token.
 */
const urlShown = (url: string, prepared: Prepared): string => {
  if (!/^file:/i.test(url)) {
    return url
      .replace(/^([^:]+:\/\/)[^/@]*@/, (_whole, scheme: string) => scheme)
      .replace(/[?#].*$/, () => "");
  }
  const local = url
    .slice("file:".length)
    .replace(/^\/\/[^/]*/, () => "")
    .replace(/^\/(?=[A-Za-z]:)/, () => "");
  let decoded: string;
  try {
    decoded = decodeURIComponent(local);
  } catch {
    decoded = local;
  }
  return placed(decoded, prepared);
};

/** The named groups of `PATTERN`. */
interface Groups {
  readonly url?: string;
  readonly quote?: string;
  readonly quoted?: string;
  readonly bare?: string;
}

const PATTERN = new RegExp(`${URL_FORM}|${QUOTED}|${BARE}`, "g");

/** `text` with every absolute path of the forms above replaced. */
const maskedForms = (text: string, prepared: Prepared): string =>
  text.replace(PATTERN, (...args: unknown[]) => {
    // Exactly one alternative matched; `quoted` comes with `quote`.
    const { url, quote, quoted, bare } = args.at(-1) as Groups;
    if (url !== undefined) {
      return urlShown(url, prepared);
    }
    if (quote !== undefined) {
      return `${quote}${placed(String(quoted), prepared)}${quote}`;
    }
    const path = String(bare);
    const trailing = TRAILING.exec(path)?.[0] ?? "";
    return `${placed(path.slice(0, path.length - trailing.length), prepared)}${trailing}`;
  });

/**
 * `line` with every absolute path replaced: first `exact` (the error's own paths, which may hold blanks and
 * quotes) where one stands between quotes, blanks or the edges of the line, in a pass of its own; then the
 * forms above in the text between them, so that no quote inside an exact path ends a quoted one.
 */
const masked = (line: string, exact: readonly string[], prepared: Prepared): string => {
  if (exact.length === 0) {
    return maskedForms(line, prepared);
  }
  const own = new RegExp(`${EDGE_BEFORE}(?:${exact.map(escaped).join("|")})${EDGE_AFTER}`, "g");
  let shown = "";
  let from = 0;
  for (const match of line.matchAll(own)) {
    shown += maskedForms(line.slice(from, match.index), prepared) + placed(match[0], prepared);
    from = match.index + match[0].length;
  }
  return shown + maskedForms(line.slice(from), prepared);
};

/** The absolute paths the error names itself (`path`, `dest` of a Node file system error), longest first. */
const pathsOf = (error: object): string[] =>
  [read(error, "path"), read(error, "dest")]
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.replace(UNSEEN, ""))
    .filter((value) => ABSOLUTE.test(value))
    .sort((a, b) => b.length - a.length);

/** At most MAX_CAUSE_MESSAGE code points; a longer text keeps MAX_CAUSE_MESSAGE - 1 and ends with `…`. */
const cut = (text: string): string => {
  const points = Array.from(text);
  return points.length <= MAX_CAUSE_MESSAGE ? text : `${points.slice(0, MAX_CAUSE_MESSAGE - 1).join("")}…`;
};

const causeOf = (error: unknown, options: InternalCauseOptions): InternalCause => {
  if (!(error instanceof Error)) {
    return { name: typeof error };
  }
  const name = read(error, "name");
  const code = read(error, "code");
  const message = read(error, "message");
  // Invisible characters go first, so that none can split a path and hide it from the patterns.
  const line = typeof message === "string" ? firstLine(message).replace(UNSEEN, "") : "";
  const shown = cut(masked(line, pathsOf(error), prepare(options)).trim());
  return {
    name: typeof name === "string" && NAME.test(name) ? name : "Error",
    ...(typeof code === "string" && CODE.test(code) ? { code } : {}),
    ...(shown === "" ? {} : { message: shown }),
  };
};

/**
 * `details.cause` of an `internal` error for `error`: its name, its Node code, and the first line of its
 * message with every absolute path replaced (`<workspace>/…` inside one of `options.roots`, else `<path>`),
 * credentials of URLs removed, and invisible characters dropped. Never throws: an error whose properties
 * cannot be read gives `{ name: "Error" }`.
 */
export function internalCause(error: unknown, options: InternalCauseOptions = {}): InternalCause {
  try {
    return causeOf(error, options);
  } catch {
    return { name: "Error" };
  }
}

/** The real form of the workspace root, once it is known; filled in by `learnWorkspaceRoots`. */
interface RealRoot {
  real: string | undefined;
}

const realRootState = defineWorkspaceState<RealRoot>("real workspace root", () => ({ real: undefined }));

/**
 * Reads the real form of the workspace root (symbolic links resolved, the long names of Windows) until it
 * is known, so that `workspaceRoots` has it without touching the file system. A root that does not exist
 * yet is read again on the next call (`workspace.init` creates it). `invoke` waits for it before a command
 * runs; on a closed workspace it does nothing, and the command fails as it did before.
 */
export const learnWorkspaceRoots = async (workspace: Workspace): Promise<void> => {
  if (workspace.closed) {
    return;
  }
  const known = workspace.get(realRootState);
  known.real ??= await fs.realpath(workspace.root).catch(() => undefined);
};

/** The workspace root as given and, once `learnWorkspaceRoots` found it, its real form. */
export const workspaceRoots = (workspace: Workspace): readonly string[] => {
  const real = workspace.peek(realRootState)?.real;
  return real === undefined || real === workspace.root ? [workspace.root] : [workspace.root, real];
};

/**
 * The `internal` error for `error`, a failure that is no CommandError: `message` for people, `details.cause`
 * (`internalCause` with the roots of `workspace`) and `details.command` when a command was called; the
 * original error stays in `cause`. `invoke` maps failures with it, and adapters a failure outside `invoke`.
 */
export const internalError = (
  message: string,
  error: unknown,
  { workspace, command }: { readonly workspace?: Workspace; readonly command?: string } = {},
): CommandError => {
  const cause = internalCause(error, workspace === undefined ? {} : { roots: workspaceRoots(workspace) });
  return new CommandError("internal", message, command === undefined ? { cause } : { command, cause }, {
    cause: error,
  });
};
