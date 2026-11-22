// The functions of `node:path`'s `posix` that the image links of a text need (`model/image-link.ts`), with the same
// results, so the Markdown renderer (`@reqseq/core/markdown`) runs in a browser. It imports nothing;
// `posix-path.test.ts` compares each function with `node:path`.

/** `path` with `.` and `..` resolved and repeated `/` joined, as `path.posix.normalize`. */
export const normalize = (path: string): string => {
  if (path === "") {
    return ".";
  }
  const absolute = path.startsWith("/");
  const out: string[] = [];
  for (const name of path.split("/")) {
    if (name === "..") {
      if (out.length > 0 && out.at(-1) !== "..") {
        out.pop();
      } else if (!absolute) {
        out.push("..");
      }
    } else if (name !== "" && name !== ".") {
      out.push(name);
    }
  }
  const body = out.join("/");
  const trailing = path.endsWith("/") ? "/" : "";
  if (absolute) {
    return `/${body}${body === "" ? "" : trailing}`;
  }
  return body === "" ? `.${trailing}` : `${body}${trailing}`;
};

/** The non-empty `parts` joined with `/` and normalized, as `path.posix.join`. */
export const join = (...parts: readonly string[]): string => {
  const joined = parts.filter((part) => part !== "").join("/");
  return joined === "" ? "." : normalize(joined);
};

/** The folder of `path`, as `path.posix.dirname`. */
export const dirname = (path: string): string => {
  if (path === "") {
    return ".";
  }
  const root = path.startsWith("/");
  let end = -1;
  let slashesAtEnd = true;
  for (let i = path.length - 1; i >= 1; i--) {
    if (path[i] !== "/") {
      slashesAtEnd = false;
    } else if (!slashesAtEnd) {
      end = i;
      break;
    }
  }
  if (end === -1) {
    return root ? "/" : ".";
  }
  return root && end === 1 ? "//" : path.slice(0, end);
};

/** The path from the absolute path `from` to the absolute path `to`, as `path.posix.relative` gives it for them. */
export const relative = (from: string, to: string): string => {
  const names = (absolute: string): string[] =>
    normalize(absolute)
      .split("/")
      .filter((name) => name !== "");
  const a = names(from);
  const b = names(to);
  let common = 0;
  while (common < a.length && common < b.length && a[common] === b[common]) {
    common++;
  }
  return [...a.slice(common).map(() => ".."), ...b.slice(common)].join("/");
};
