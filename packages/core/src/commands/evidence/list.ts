// evidence.list (SR-032): the evidence records of one element, newest first, each with its version,
// item (Prüfling), date, result and evidence (Beleg) (AK1) and the names of the baselines that
// contain its version (AK2, read-only baseline reader, spec question ThomasBirkmaier/ReqSeq-archive#530; a baseline entry of the
// other normal form counts when both are of the current version, ADR-0005 "Normal form 2"). `view` keeps the records
// of the core or of one variant (SR-047), in a variant with those without variant when the element's
// repository is marked `variant-independent` (SR-173). `problems` are those of the baseline files; `incomplete`
// says that an evidence location or the baselines folder is not on this machine (SR-006 AK2).
// `testCases` are the test cases that name the element, each with the element's executions that hold
// in the view (SR-033, `testCasesIn`; every kind of record, as `records`). Every record carries its
// `evidenceSource` (#821) and, where it names criteria, their numbers, keys and texts
// (`criterionNames`, SR-205 AK2). `bearing` names the records that bear the status (AK3, `bearingRecords`), and `display` groups them for the
// app (AK3 to AK5, `displayOf`, over the views the element applies in, without that of a variant
// whose status is invalid unless `view` names it, SR-047 AK6). Nothing is written.
import { workspaceBaselines, baselinesContaining } from "../../baselines/index.js";
import type { CommandContext, CommandOutput } from "../../catalog.js";
import { defineCommand } from "../../catalog.js";
import {
  bearingRecords,
  displayOf,
  evidenceIndexState,
  evidenceReadState,
  listedRecords,
  namedCriterion,
  plainCriteria,
  testCaseWithEvidenceSource,
  testCasesIn,
  validatesType,
  verificationState,
  withEvidenceSource,
} from "../../evidence/index.js";
import type { ElementCriteria, EvidenceRecord, ViewHolder } from "../../evidence/index.js";
import type { ElementRecord, VersionForms } from "../../model/index.js";
import { metamodelState } from "../../metamodel/index.js";
import {
  acceptanceCriteriaKeyOf,
  criteriaItemsOf,
  currentVersionsOf,
  elementStoreState,
  formsOfEntry,
  resolveRef,
  shortIdState,
  storedForms,
} from "../../model/index.js";
import type { View } from "../../variants/index.js";
import { resolveView } from "../../variants/index.js";
import { versionValues } from "../../model/version-date.js";
import { variantIndependentOf, workspaceLayoutState } from "../../workspace/index.js";

/**
 * Whether the view of `holder` is `asked`; when none is asked, every view but that of a variant
 * whose status is invalid (SR-047 AK6, as `verificationOf`).
 */
const shownView = ({ view: holder, invalid }: ViewHolder, asked: View | undefined): boolean =>
  asked === undefined
    ? !invalid
    : holder.kind === "core"
      ? asked.kind === "core"
      : asked.kind === "variant" && asked.variant.id === holder.variant.id;

/** The items of each version the status lookup did not give, by version (`namedItemsOf`). */
type FetchedItems = ReadonlyMap<string, readonly unknown[]>;

/**
 * The acceptance criteria items of the older versions that `records` name by number and the status
 * lookup does not give (it looks up only what can change a count, `older-criteria.ts`): those of the
 * newest commit with the version, from the walk of the version dates, where Git has it (SR-205 AK2:
 * the text of a criterion without key in the named version). Bounded by the records of one element.
 */
const namedItemsOf = async (
  ctx: CommandContext,
  element: ElementRecord,
  records: readonly EvidenceRecord[],
  criteria: ElementCriteria,
  current: VersionForms | undefined,
): Promise<FetchedItems> => {
  const versions = [
    ...new Set(
      records
        .filter(
          (r) =>
            r.criteria?.some((ref) => typeof ref === "number") === true &&
            criteria.namedItems(r, current) === undefined,
        )
        .map((r) => r.version),
    ),
  ];
  if (versions.length === 0) {
    return new Map();
  }
  const metamodel = await ctx.workspace.get(metamodelState);
  const layout = await ctx.workspace.get(workspaceLayoutState);
  const values = await versionValues(
    { workspace: ctx.workspace, layout, metamodel },
    versions.map((version) => ({
      repository: element.repository,
      file: element.file,
      id: element.id,
      version,
    })),
  );
  const key = acceptanceCriteriaKeyOf(metamodel);
  return new Map(
    versions.flatMap((version, i) => {
      const at = values[i];
      return at === null || at === undefined ? [] : [[version, criteriaItemsOf(at, key)] as const];
    }),
  );
};

/**
 * `record` with `criterionNames`: each criterion it names with number, key and text (SR-205 AK2,
 * `namedCriterion`), the number that of the current version.
 */
const withCriterionNames = (
  record: EvidenceRecord,
  criteria: ElementCriteria,
  current: VersionForms | undefined,
  fetched: FetchedItems,
): EvidenceRecord => {
  const resolved = criteria.resolve(record, current);
  if (resolved === undefined) {
    return record;
  }
  const named = criteria.namedItems(record, current) ?? fetched.get(record.version);
  return {
    ...record,
    criterionNames: resolved.map((r) => namedCriterion(r, criteria.items, named)),
  };
};

export default defineCommand({
  name: "evidence.list",
  run: async (ctx, input): Promise<CommandOutput<"evidence.list">> => {
    const store = await ctx.workspace.get(elementStoreState);
    const shortIds = await ctx.workspace.get(shortIdState);
    const element = resolveRef(store, shortIds, input.ref, {
      repository: input.repository,
      file: input.file,
    });
    const view =
      input.view === undefined
        ? undefined
        : resolveView(
            { metamodel: await ctx.workspace.get(metamodelState), store, shortIds },
            input.view,
            "evidence.list",
          );
    const index = await ctx.workspace.get(evidenceIndexState);
    const read = await ctx.workspace.get(evidenceReadState);
    const baselines = await workspaceBaselines(ctx.workspace);
    const layout = await ctx.workspace.get(workspaceLayoutState);
    const independent = variantIndependentOf(layout).has(element.repository);
    // A baseline of the other normal form than a record contains it when both are of the current version.
    // Read only for an element with records.
    const records = index.byElement.get(element.id) ?? [];
    const current =
      records.length === 0
        ? undefined
        : formsOfEntry((await currentVersionsOf(ctx.workspace, [element])).get(element));
    // Copies with their evidence source (#821): the index records and test cases stay as they are.
    const listed = listedRecords(records, view, independent, (id, version) =>
      baselinesContaining(baselines, id, storedForms(version, current)),
    ).map(withEvidenceSource);
    // The views the element applies in (the view rule of the status, as `verificationOf`), with
    // `view` that one alone, as `listed` holds only its records; none for an element that is no
    // requirement. Read only for an element with records.
    const status = listed.length === 0 ? undefined : await ctx.workspace.get(verificationState);
    // Its criteria as the status counts them (key or number, older versions through Git, SR-031 AK11).
    const criteria = status === undefined ? plainCriteria(0) : status.source.criteriaOf(element);
    const fetched = await namedItemsOf(ctx, element, listed, criteria, current);
    const named = listed.map((record) => withCriterionNames(record, criteria, current, fetched));
    const bearing = bearingRecords(named, current, criteria, independent);
    const views =
      status?.source.requirements.has(element.type) !== true
        ? []
        : status.holders
            .filter((holder) => holder.includes(element) && shownView(holder, view))
            .map(({ view: holder }) => holder);
    return {
      records: named,
      bearing,
      display: displayOf(named, {
        bearing,
        current,
        criteria,
        views,
        independent,
        validates: status !== undefined && validatesType(status.source, element.type),
      }),
      testCases: testCasesIn(index, element.id, view, independent).map(testCaseWithEvidenceSource),
      problems: [...baselines.problems],
      incomplete: read.incomplete || baselines.incomplete,
    };
  },
});
