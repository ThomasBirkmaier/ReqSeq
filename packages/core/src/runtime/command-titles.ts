// How a message names a command (#2200): by its title (`title` in schemas/commands/<name>.json), in quotes,
// as the app and the command line's help show it, never by its catalog name.
import type { CommandName } from "../catalog.js";
import type { CatalogEntry } from "./contracts.js";
import { contractsBundle } from "./contracts.js";

const titles = new Map(
  (contractsBundle.catalog as { readonly commands: readonly CatalogEntry[] }).commands.map((entry) => [
    entry.name,
    entry.title,
  ]),
);

/** The title of command `name` in quotes, such as `"List hints"`, for a message that names it. */
export const commandTitle = (name: CommandName): string => `"${titles.get(name) ?? name}"`;
