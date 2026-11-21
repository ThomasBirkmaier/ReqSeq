// How a message names a command (#2200): by its title (`title` in schemas/commands/<name>.json), in quotes,
// as the app and the command line's help show it, never by its catalog name.
import type { CatalogEntry } from "./contracts.js";
import { contractsBundle } from "./contracts.js";

const titles = new Map(
  (contractsBundle.catalog as { readonly commands: readonly CatalogEntry[] }).commands.map((entry) => [
    entry.name,
    entry.title,
  ]),
);

/**
 * The title of command `name` in quotes, such as `"List hints"`, for a message that names it; the name in
 * quotes for a command the product catalog does not have (a test command).
 */
export const commandTitle = (name: string): string => `"${titles.get(name) ?? name}"`;
