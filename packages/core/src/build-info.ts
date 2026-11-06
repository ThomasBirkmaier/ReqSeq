// The build of a delivery (`tool.info`, SR-161): the commit and its date, which the packaging
// (`scripts/package/stage.mjs`) writes into `BUILD_INFO_FILE` next to this module in each staged copy of
// core's `dist`. A build from a checkout has no such file. It is read at run time, not imported, because it
// is missing there.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** The file name, in core's `dist` (`src` when tests run the sources). */
export const BUILD_INFO_FILE = "build-info.json";

export interface BuildInfo {
  /** The commit the delivery was built from, 40 hex characters. */
  readonly commit: string;
  /** The date of that commit, ISO 8601. */
  readonly date: string;
}

const CODE_FOLDER = path.dirname(fileURLToPath(import.meta.url));

const isBuildInfo = (value: unknown): value is BuildInfo => {
  const { commit, date } = (value ?? {}) as { readonly commit?: unknown; readonly date?: unknown };
  return typeof commit === "string" && /^[0-9a-f]{40}$/.test(commit) && typeof date === "string";
};

/** The build info in `folder` (default: core's code folder); undefined when it is missing or not valid. */
export const readBuildInfo = async (folder: string = CODE_FOLDER): Promise<BuildInfo | undefined> => {
  let value: unknown;
  try {
    value = JSON.parse(await readFile(path.join(folder, BUILD_INFO_FILE), "utf8"));
  } catch {
    return undefined;
  }
  return isBuildInfo(value) ? { commit: value.commit, date: value.date } : undefined;
};
