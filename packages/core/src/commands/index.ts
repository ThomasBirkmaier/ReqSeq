// Registry of all command implementations (ADR-0002 rule 2).
//
// To add a command: write `commands/<group>/<action>.ts` that default-exports
// `defineCommand({ name: "<group>.<action>", run })` for an entry of schemas/commands/catalog.json,
// import it here and add it to the list (keep both sorted by name).
// commands/registry.test.ts checks that files, this list and the catalog agree.
import type { AnyCommand } from "../catalog.js";
import workspaceStatus from "./workspace/status.js";

export const commands: readonly AnyCommand[] = [workspaceStatus];
