// The licence rules of ADR-0015 that every check shares: the allowlist, the evaluation of an SPDX expression
// against it, and which files of a package hold its licence texts. Used by check.mjs (the workspace), site.mjs
// (the documentation site) and scripts/package/lib.mjs (the third-party notices of the delivery).
import fs from "node:fs";
import path from "node:path";

export const ALLOWED = new Set([
  "MIT",
  "ISC",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "Apache-2.0",
  "0BSD",
  "BlueOak-1.0.0",
  "CC0-1.0",
  "Unlicense",
  "Python-2.0",
  "MPL-2.0",
]);

/** The tokens of an SPDX expression, or undefined for a character no expression of ours has. */
const tokens = (expression) => {
  const out = [];
  const re = /\s*(?:(\()|(\))|([A-Za-z0-9.+-]+))/y;
  let at = 0;
  while (at < expression.length) {
    re.lastIndex = at;
    const m = re.exec(expression);
    if (m === null) {
      return /^\s*$/.test(expression.slice(at)) ? out : undefined;
    }
    out.push(m[1] ?? m[2] ?? m[3]);
    at = re.lastIndex;
  }
  return out;
};

/**
 * Whether the SPDX expression `expression` is allowed by `allowed`: a licence ID, `AND` and `OR` (AND binds
 * tighter) and parentheses, evaluated as SPDX defines them: an `OR` is allowed when one side is, an `AND` when
 * both are. Fails closed: `WITH` (an exception, which needs a reading of its own), a `+`, a `LicenseRef-`, an
 * empty or unbalanced expression and anything else it cannot parse give false.
 */
export function licenseAllowed(expression, allowed = ALLOWED) {
  const list = typeof expression === "string" ? tokens(expression) : undefined;
  if (list === undefined || list.length === 0) {
    return false;
  }
  let at = 0;
  const peek = () => list[at];
  // Each parser returns true, false, or undefined for an expression it cannot parse.
  const atom = () => {
    const token = list[at++];
    if (token === "(") {
      const inner = or();
      return list[at++] === ")" ? inner : undefined;
    }
    if (
      token === undefined ||
      ["(", ")", "AND", "OR", "WITH"].includes(token) ||
      /\+$|^LicenseRef-/.test(token)
    ) {
      return undefined;
    }
    return allowed.has(token);
  };
  const and = () => {
    let value = atom();
    while (value !== undefined && peek() === "AND") {
      at += 1;
      const right = atom();
      value = right === undefined ? undefined : value && right;
    }
    return value;
  };
  const or = () => {
    let value = and();
    while (value !== undefined && peek() === "OR") {
      at += 1;
      const right = and();
      value = right === undefined ? undefined : value || right;
    }
    return value;
  };
  const value = or();
  return value === true && at === list.length;
}

/** File names that hold a licence text. */
export const LICENSE_FILE = /^(?:licen[cs]e|copying|notice)(?:[.-].*)?$/i;

/**
 * The licence texts of the package in `folder`: its files whose names LICENSE_FILE matches, in name order, and the
 * files of such a folder (some packages ship a folder `LICENSE`).
 * Links and other entries are left out.
 */
export function licenseTexts(folder) {
  return fs
    .readdirSync(folder, { withFileTypes: true })
    .filter((entry) => LICENSE_FILE.test(entry.name))
    .flatMap((entry) =>
      entry.isDirectory()
        ? fs
            .readdirSync(path.join(folder, entry.name), { withFileTypes: true })
            .filter((inner) => inner.isFile())
            .map((inner) => path.join(entry.name, inner.name))
        : entry.isFile()
          ? [entry.name]
          : [],
    )
    .sort()
    .map((file) => fs.readFileSync(path.join(folder, file), "utf8"));
}
