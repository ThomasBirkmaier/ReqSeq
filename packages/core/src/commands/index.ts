// Registry of all command implementations (ADR-0002 rule 2).
//
// To add a command: write `commands/<group>/<action>.ts` that default-exports
// `defineCommand({ name: "<group>.<action>", run })` for the catalog entry schemas/commands/<group>.<action>.json
// (input and output are typed from the catalog, generated/types.ts), import it here and add it to
// the list (keep both sorted by name). A command whose dependencies would slow down every start is
// listed as `lazyCommand(name, () => import(...))` instead, which imports it on its first call (#178).
// commands/registry.test.ts checks that files, this list and the catalog agree.
import type { AnyCommand } from "../catalog.js";
import { lazyCommand } from "../catalog.js";
import baselineCompare from "./baseline/compare.js";
import baselineCreate from "./baseline/create.js";
import baselineGet from "./baseline/get.js";
import baselineList from "./baseline/list.js";
import dataExport from "./data/export.js";
import dataStore from "./data/store.js";
import elementAddAttachment from "./element/addAttachment.js";
import elementBulkUpdate from "./element/bulkUpdate.js";
import elementCreate from "./element/create.js";
import elementFacets from "./element/facets.js";
import elementGet from "./element/get.js";
import elementList from "./element/list.js";
import elementResolve from "./element/resolve.js";
import elementSetStatus from "./element/setStatus.js";
import elementSupersede from "./element/supersede.js";
import elementUpdate from "./element/update.js";
import evidenceCoverage from "./evidence/coverage.js";
import evidenceDegree from "./evidence/degree.js";
import evidenceEnrichJunit from "./evidence/enrichJunit.js";
import evidenceList from "./evidence/list.js";
import evidenceRecord from "./evidence/record.js";
import evidenceStatus from "./evidence/status.js";
import evidenceWithoutPassedTest from "./evidence/withoutPassedTest.js";
import filterList from "./filter/list.js";
import filterSave from "./filter/save.js";
import hintConfirm from "./hint/confirm.js";
import hintList from "./hint/list.js";
import metamodelGet from "./metamodel/get.js";
import relationAdd from "./relation/add.js";
import relationOptions from "./relation/options.js";
import relationRemove from "./relation/remove.js";
import toolInfo from "./tool/info.js";
import traceAffected from "./trace/affected.js";
import traceChain from "./trace/chain.js";
import traceGraph from "./trace/graph.js";
import traceMatrix from "./trace/matrix.js";
import traceNeighbourhood from "./trace/neighbourhood.js";
import traceRelated from "./trace/related.js";
import variantDiff from "./variant/diff.js";
import variantExclude from "./variant/exclude.js";
import workspaceActivity from "./workspace/activity.js";
import workspaceCheck from "./workspace/check.js";
import workspaceInit from "./workspace/init.js";
import workspaceRecent from "./workspace/recent.js";
import workspaceStatus from "./workspace/status.js";

export const commands: readonly AnyCommand[] = [
  baselineCompare,
  baselineCreate,
  baselineGet,
  baselineList,
  dataExport,
  dataStore,
  elementAddAttachment,
  elementBulkUpdate,
  elementCreate,
  elementFacets,
  elementGet,
  elementList,
  elementResolve,
  lazyCommand("element.search", () => import("./element/search.js")),
  elementSetStatus,
  elementSupersede,
  elementUpdate,
  evidenceCoverage,
  evidenceDegree,
  evidenceEnrichJunit,
  evidenceList,
  evidenceRecord,
  evidenceStatus,
  evidenceWithoutPassedTest,
  filterList,
  filterSave,
  hintConfirm,
  hintList,
  metamodelGet,
  relationAdd,
  relationOptions,
  relationRemove,
  lazyCommand("reqif.analyze", () => import("./reqif/analyze.js")),
  lazyCommand("reqif.export", () => import("./reqif/export.js")),
  lazyCommand("reqif.import", () => import("./reqif/import.js")),
  lazyCommand("reqif.saveMapping", () => import("./reqif/saveMapping.js")),
  toolInfo,
  traceAffected,
  traceChain,
  traceGraph,
  traceMatrix,
  traceNeighbourhood,
  traceRelated,
  variantDiff,
  variantExclude,
  workspaceActivity,
  workspaceCheck,
  workspaceInit,
  workspaceRecent,
  workspaceStatus,
];
