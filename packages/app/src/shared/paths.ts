// Path checks of the protocols that serve files (`app:` and `reqseq-file:`, ADR-0010).
import path from "node:path";

/** Whether `child` lies inside `parent` (both absolute) and is not `parent` itself; `paths` for tests. */
export const isInside = (parent: string, child: string, paths: path.PlatformPath = path): boolean => {
  const relative = paths.relative(parent, child);
  return relative !== "" && relative.split(paths.sep)[0] !== ".." && !paths.isAbsolute(relative);
};

/** The decoded path of `url` without its leading slashes, or undefined when it does not decode. */
export const decodedPath = (url: URL): string | undefined => {
  try {
    return decodeURIComponent(url.pathname).replace(/^\/+/, "");
  } catch {
    return undefined;
  }
};
