// The output of element.list without `fields` (#982), which always gives `elements`: the type the tests
// that list without `fields` read the output as.
import type { CommandName, CommandOutput } from "../catalog.js";
import type { DataExportElement } from "../generated/types.js";

export type FullList = CommandOutput<"element.list"> & { readonly elements: readonly DataExportElement[] };

/** The output of `command` as a test reads it: element.list as `FullList`. */
export type Output<C extends CommandName> = C extends "element.list" ? FullList : CommandOutput<C>;
