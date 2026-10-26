// Registry of all command implementations (ADR-0002 rule 2).
//
// To add a command: write `commands/<group>/<action>.ts` that default-exports
// `defineCommand({ name: "<group>.<action>", run })` for an entry of schemas/commands/catalog.json
// (input and output are typed from the catalog, generated/types.ts), import it here and add it to
// the list (keep both sorted by name).
// commands/registry.test.ts checks that files, this list and the catalog agree.
import type { AnyCommand } from "../catalog.js";
import elementAddAttachment from "./element/addAttachment.js";
import elementBulkUpdate from "./element/bulkUpdate.js";
import elementCreate from "./element/create.js";
import elementGet from "./element/get.js";
import elementList from "./element/list.js";
import elementResolve from "./element/resolve.js";
import elementSetStatus from "./element/setStatus.js";
import elementSupersede from "./element/supersede.js";
import elementUpdate from "./element/update.js";
import filterList from "./filter/list.js";
import filterSave from "./filter/save.js";
import hintConfirm from "./hint/confirm.js";
import hintList from "./hint/list.js";
import metamodelGet from "./metamodel/get.js";
import relationAdd from "./relation/add.js";
import relationRemove from "./relation/remove.js";
import traceAffected from "./trace/affected.js";
import traceChain from "./trace/chain.js";
import traceRelated from "./trace/related.js";
import workspaceCheck from "./workspace/check.js";
import workspaceInit from "./workspace/init.js";
import workspaceStatus from "./workspace/status.js";

export const commands: readonly AnyCommand[] = [
  elementAddAttachment,
  elementBulkUpdate,
  elementCreate,
  elementGet,
  elementList,
  elementResolve,
  elementSetStatus,
  elementSupersede,
  elementUpdate,
  filterList,
  filterSave,
  hintConfirm,
  hintList,
  metamodelGet,
  relationAdd,
  relationRemove,
  traceAffected,
  traceChain,
  traceRelated,
  workspaceCheck,
  workspaceInit,
  workspaceStatus,
];
