// The files of one folder, for the readers of YAML files kept directly in a folder of the workspace
// file (saved filters, baselines). Reads only; never follows into subfolders.
import fs from "node:fs/promises";

/** What a folder holds: its files, the names of all its entries, or why there are none. */
export type FolderListing =
  | {
      readonly kind: "names";
      /** The entries that are no folders and not hidden (`.` first), sorted by code units. */
      readonly names: readonly string[];
      /** The name of every entry, folders and hidden ones included. */
      readonly entries: readonly string[];
    }
  | { readonly kind: "missing" }
  | { readonly kind: "error"; readonly reason: string };

/** Lists `folder` (absolute): `missing` when it does not exist, `error` with the code otherwise. */
export const listFolderFiles = async (folder: string): Promise<FolderListing> => {
  try {
    const entries = await fs.readdir(folder, { withFileTypes: true });
    const names = entries.filter((e) => !e.isDirectory() && !e.name.startsWith(".")).map((e) => e.name);
    return { kind: "names", names: [...names].sort(), entries: entries.map((e) => e.name) };
  } catch (error) {
    // Errors of `readdir` carry a code.
    const { code } = error as NodeJS.ErrnoException;
    return code === "ENOENT" ? { kind: "missing" } : { kind: "error", reason: String(code) };
  }
};
