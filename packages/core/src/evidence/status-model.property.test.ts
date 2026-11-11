// Level 1 of the status model (#1394, #1395, epic #1389): the core's pure status functions against the reference
// model of `@reqseq/testkit/status-model`, on generated elements and workspaces. No test here names an [SR/AK] token:
// they are no evidence of the tool (the model's rule table names the sources).
//
// The workspace test builds the inputs of `workspaceStatusOf` (status source, child rules, view scope, version
// reader) from the model and compares `verificationOf` per requirement, asking in a generated order. So it checks
// what the core does with them: own records per view (`holdsIn`, SR-173 pooling), the counted children (type,
// invalid status, view, each once), indirect, missing children, emergent, cycles, the shared neutral view of the
// variants, the entries per view (invalid variants), and which versions `prepare` reads.
//
// What level 1 does not check: the reader (records it refuses, Markdown and JUnit forms, criteria order as read),
// the metamodel meanings, relation resolution and twins (the adapter resolves items with the model's W1 for the
// child rules), the real view rule index (`viewRuleIndexOf`, `ruleScope`: the adapter's scope applies the model's
// W2 to W7), version hashes and the Git walk behind older criteria (`older-criteria.ts`), and the index order of the
// store. The level-2 tests of #1396 cover them through a workspace on disk.
//
// Runs: STATUS_MODEL_RUNS (default 1000) and STATUS_MODEL_SEED (default fixed); a failure names the seed.
import {
  CORE_VIEW,
  CURRENT,
  type ModelCriterion,
  type ModelCriterionRef,
  type ModelElement,
  type ModelEntry,
  type ModelRecord,
  type ModelVariant,
  type ModelWorkspace,
  type ModelWorkspaceElement,
  appliesIn as modelAppliesIn,
  forAllElements,
  forAllWorkspaces,
  instantOf,
  isExcluded,
  isReplaced,
  propertyParameters,
  recordsInView,
  resolveRef,
  statusOfRecords,
  validationOf as modelValidationOf,
  verificationOf as modelVerificationOf,
  workspaceStatusOf as modelWorkspaceStatusOf,
} from "@reqseq/testkit/status-model";
import { describe, expect, it } from "vitest";
import type { CriterionRef, ElementRecord, VersionForms } from "../model/index.js";
import { compareCriterionRefs } from "../model/index.js";
import type { View } from "../variants/index.js";
import { evidenceIndex } from "./by-element.js";
import type { ElementCriteria } from "./criteria.js";
import { elementCriteria } from "./criteria.js";
import type { ChildRules, ViewScope } from "./indirect.js";
import { nodeKey } from "./indirect.js";
import type { EvidenceRecord } from "./record.js";
import type { RecordStatus, StatusSource, VerificationEntries } from "./status.js";
import { criterionStatusesOf, ownVerificationOf, recordStatusOf, validationOf } from "./status.js";
import { verificationOf, workspaceStatusOf } from "./verification.js";

const ELEMENT = "6adc6c43-5d42-4c01-8c55-f332cc90a529";
const CURRENT_FORMS: VersionForms = { n1: "n1:1111111111111111", n2: "n2:2222222222222222" };
const OLDER: Readonly<Record<string, string>> = { v1: "n2:aaaaaaaaaaaaaaaa", v2: "n1:bbbbbbbbbbbbbbbb" };
const CORE: View = { kind: "core" };
const parameters = propertyParameters(process.env);

/** The items of a criteria list as the element file holds them: `{ key, text }`, or the text alone without key. */
function itemsOf(criteria: readonly ModelCriterion[]): unknown[] {
  return criteria.map((criterion, index) =>
    criterion.key === undefined
      ? `Criterion ${String(index + 1)}`
      : { key: criterion.key, text: `Criterion ${String(index + 1)}` },
  );
}

/** The refs as the readers hold them: each once, in the readers' order (`compareCriterionRefs`). */
function refsOf(refs: readonly ModelCriterionRef[]): CriterionRef[] {
  return [...new Set(refs.map((ref) => (ref.by === "number" ? ref.number : ref.key)))].sort(
    compareCriterionRefs,
  );
}

/**
 * One model record as the core reads it; `position` is its place in the index, which also picks the version form of
 * a current record (both forms occur). Validation records lose their criteria, as the reader drops them.
 */
function recordOf(record: ModelRecord, position: number): EvidenceRecord {
  const version =
    record.version === CURRENT
      ? position % 2 === 0
        ? CURRENT_FORMS.n1
        : CURRENT_FORMS.n2
      : (OLDER[record.version] ?? record.version);
  return {
    element: ELEMENT,
    version,
    kind: record.kind,
    method: "test",
    item: "build",
    result: record.result,
    date: record.date,
    repository: "spec",
    file: `evidence/record-${String(position).padStart(2, "0")}.md`,
    line: 1,
    ...(record.reason === undefined ? {} : { reason: record.reason }),
    ...(record.criteria === undefined || record.kind === "validation"
      ? {}
      : { criteria: refsOf(record.criteria) }),
  };
}

/**
 * The element in index order (newest first by instant, then by file: ADR-0012 "Index"), so the model's "first in
 * index order" (A6) and the core's "first in the order of `records`" read the same list. Pure: no randomness.
 */
function inIndexOrder(element: ModelElement): ModelElement {
  const records = element.records
    .map((record, position) => ({ record, position }))
    .sort((a, b) => instantOf(b.record.date) - instantOf(a.record.date) || a.position - b.position)
    .map(({ record }) => record);
  return { ...element, records };
}

/** The core's input for `element` (already in index order). */
function coreInput(element: ModelElement) {
  const older = (id: string, version: string): readonly unknown[] | undefined => {
    const entry = Object.entries(OLDER).find(([, value]) => value === version);
    const known = element.olderVersions.find((candidate) => candidate.id === entry?.[0]);
    return id === ELEMENT && known?.criteria !== undefined ? itemsOf(known.criteria) : undefined;
  };
  return {
    records: element.records.map(recordOf),
    criteria: elementCriteria(ELEMENT, itemsOf(element.criteria), older),
  };
}

describe("status model level 1: core against the reference model", () => {
  // One pass per element checks all three functions, so the generation and the adapter run once per input.
  it("gives the verification status, the criteria count, every criterion's status and the validation of the model", () => {
    forAllElements((generated) => {
      const element = inIndexOrder(generated);
      const { records, criteria } = coreInput(element);
      const expected = modelVerificationOf(element);
      const own = ownVerificationOf(records, CURRENT_FORMS, CORE, false, criteria);
      const count = element.criteria.length;
      expect({ status: own.status, verified: own.criteria?.verified, total: own.criteria?.total }).toEqual({
        status: expected.status,
        verified: count === 0 ? undefined : expected.verified,
        total: count === 0 ? undefined : count,
      });
      expect(criterionStatusesOf(records, CURRENT_FORMS, CORE, false, criteria)).toEqual(
        count === 0 ? [expected.status] : expected.criteria,
      );
      expect(validationOf(records, CURRENT_FORMS)).toEqual(modelValidationOf(element));
    }, parameters);
  });
});

/** The status a set of records gives as `recordStatusOf` names it. */
function asRecordStatus(status: string): RecordStatus {
  return status === "verified" || status === "validated" ? "passed" : (status as RecordStatus);
}

/** A file of the store for the adapter: type, repository, status and validity in the frontmatter. */
function fileOf(
  key: string,
  id: string,
  type: string,
  repository: string,
  data: Readonly<Record<string, unknown>>,
): ElementRecord {
  return {
    id,
    type,
    repository,
    file: `${key}.md`,
    data: { id, type, ...data },
    eol: "\n",
    closingEol: "\n",
    bom: false,
    snapshot: { path: `${key}.md`, size: 0, mtimeMs: 0, sha256: "0".repeat(64) },
  };
}

const VALIDITY = { key: "validity", many: true, label: "property Validity (validity)" };
const INVALID = "obsolete";
const READ_FORMS = { kind: "version" as const, forms: CURRENT_FORMS, images: [] };

/**
 * The core's inputs for a model workspace. Pure: the files, records and rules are functions of `ws` alone. The
 * child rules resolve derivation items with the model's W1 and the scope applies the model's view rule, standing
 * in for the trace block and the view rule index (level 2, #1396).
 */
function coreWorkspace(ws: ModelWorkspace) {
  const variantFiles = new Map<ModelVariant, ElementRecord>(
    ws.variants.map((variant) => [
      variant,
      fileOf(`variant-${variant.id}`, variant.id, "variant", variant.repository, {
        status: variant.invalid ? INVALID : "draft",
      }),
    ]),
  );
  const files = new Map<ModelWorkspaceElement, ElementRecord>(
    ws.elements.map((element) => [
      element,
      fileOf(element.key, element.id, element.type, element.repository, {
        status: element.invalid ? INVALID : "draft",
        ...(element.validity.length === 0
          ? {}
          : {
              validity: element.validity.map((id) => ({
                id,
                repository: ws.variants.find((variant) => variant.id === id)?.repository,
              })),
            }),
      }),
    ]),
  );
  const modelOf = new Map([...files].map(([element, file]) => [file, element]));
  // R4: one list of records per UUID, from the own part its files share.
  const uuids = [...new Map(ws.elements.map((element) => [element.id, element.own])).entries()];
  const records = uuids.flatMap(([id, own]) =>
    own.records.map((record, position) => ({
      ...recordOf(record, position),
      element: id,
      file: `evidence/${id}-${String(position).padStart(2, "0")}.md`,
      ...(record.variant === undefined ? {} : { variant: record.variant }),
    })),
  );
  const index = evidenceIndex(records);
  const older = (id: string, version: string): readonly unknown[] | undefined => {
    const name = Object.entries(OLDER).find(([, value]) => value === version)?.[0];
    const own = uuids.find(([uuid]) => uuid === id)?.[1];
    const known = own?.olderVersions.find((candidate) => candidate.id === name);
    return known?.criteria === undefined ? undefined : itemsOf(known.criteria);
  };
  const criteria = new Map<string, ElementCriteria>(
    uuids.map(([id, own]) => [id, elementCriteria(id, itemsOf(own.criteria), older)]),
  );
  const independent = new Set(ws.repositories.filter((r) => r.variantIndependent).map((r) => r.name));
  const source: StatusSource = {
    requirements: new Set(["requirement"]),
    needs: new Set(["need"]),
    invalid: new Set([INVALID]),
    validity: VALIDITY,
    recordsOf: (id) => index.byElement.get(id) ?? [],
    emergent: (file) => modelOf.get(file)?.emergent === true,
    independent: (file) => independent.has(file.repository),
    criteriaOf: (file) => criteria.get(file.id) ?? elementCriteria(file.id, [], older),
  };
  const children: ChildRules = {
    // Each derivation item once, so a child named twice comes twice; twins are named by no item (W1).
    childrenOf: (file) =>
      ws.elements.flatMap((child) =>
        child.derivesFrom
          .filter((ref) => resolveRef(ws, ref, child.repository) === modelOf.get(file))
          .flatMap(() => [files.get(child)].filter((found) => found !== undefined)),
      ),
    counts: (file) => file.data["status"] !== INVALID,
  };
  const viewIdOf = (view: View): string => (view.kind === "core" ? CORE_VIEW : view.variant.id);
  const scope: ViewScope = {
    includesIn: (view) => (file) => {
      const element = modelOf.get(file);
      return element === undefined || modelAppliesIn(ws, element, viewIdOf(view));
    },
    removersOf: (file) => {
      const element = modelOf.get(file);
      return element === undefined
        ? []
        : [...variantFiles]
            .filter(([variant]) => isExcluded(ws, element, variant) || isReplaced(ws, element, variant.id))
            .map(([, variantFile]) => nodeKey(variantFile));
    },
  };
  let reads = 0;
  const status = workspaceStatusOf(
    source,
    [...variantFiles.values()],
    children,
    (wanted) => {
      reads += wanted.length;
      return Promise.resolve(new Map(wanted.map((file) => [file, READ_FORMS])));
    },
    scope,
  );
  const views: View[] = [
    { kind: "core" },
    ...[...variantFiles.values()].map((variant) => ({ kind: "variant" as const, variant })),
  ];
  return { files, source, status, views, reads: () => reads };
}

/** The model's entries as the core shows them: missing children by UUID, each once and sorted. */
function expectedEntries(ws: ModelWorkspace, entries: readonly ModelEntry[]) {
  const idOf = new Map(ws.elements.map((element) => [element.key, element.id]));
  return entries.map(({ view, status, missingChildren, verified, total }) => ({
    view,
    status,
    ...(missingChildren === undefined
      ? {}
      : { missingChildren: [...new Set(missingChildren.map((key) => idOf.get(key)))].sort() }),
    ...(total === undefined ? {} : { criteria: { verified, total } }),
  }));
}

/** The core's entries in the same shape; missing children sorted, after checking they hold no duplicate. */
function actualEntries(entries: VerificationEntries | undefined) {
  return (entries ?? []).map(({ view, status, missingChildren, criteria }) => {
    if (missingChildren !== undefined) {
      expect(new Set(missingChildren).size).toBe(missingChildren.length);
    }
    return {
      view,
      status,
      ...(missingChildren === undefined ? {} : { missingChildren: [...missingChildren].sort() }),
      ...(criteria === undefined ? {} : { criteria: { verified: criteria.verified, total: criteria.total } }),
    };
  });
}

describe("status model level 1: workspaces against the reference model", () => {
  it("gives every requirement the model's entries in every view, whatever order the views are asked in", async () => {
    await forAllWorkspaces(async (ws) => {
      const { files, status, views } = coreWorkspace(ws);
      const requirements = ws.elements.filter((element) => element.type === "requirement");
      // The pairs of element and view in the generated order (sort keys of `ws.order`), so the memos of the
      // evaluator fill in a different order each run.
      const pairs = requirements
        .flatMap((element) =>
          views.map((view, v) => ({ element, view, at: ws.elements.indexOf(element) * 4 + v })),
        )
        .sort((a, b) => (ws.order[a.at] ?? 0) - (ws.order[b.at] ?? 0) || a.at - b.at);
      const ordered = [...new Set(pairs.map(({ element }) => element))];
      // As the commands that show elements do: their own versions too (`own`).
      await status.prepare(
        ordered.flatMap((element) => [files.get(element)].filter((file) => file !== undefined)),
        { own: true },
      );
      for (const { element, view } of pairs) {
        const file = files.get(element);
        if (file !== undefined) {
          status.evaluate(file, view);
        }
      }
      const expected = modelWorkspaceStatusOf(ws);
      for (const element of ordered) {
        const file = files.get(element);
        expect(file).toBeDefined();
        if (file !== undefined) {
          expect({ key: element.key, entries: actualEntries(verificationOf(status, file)) }).toEqual({
            key: element.key,
            entries: expectedEntries(ws, expected.get(element.key) ?? []),
          });
        }
      }
    }, parameters);
  });

  it("gives the record status of the model for each kind and view (recordStatusOf)", async () => {
    await forAllWorkspaces((ws) => {
      const { files, source, views } = coreWorkspace(ws);
      for (const [element, file] of files) {
        const records = source.recordsOf(file.id);
        const independent = source.independent(file);
        for (const view of views) {
          const viewId = view.kind === "core" ? CORE_VIEW : view.variant.id;
          expect(recordStatusOf(records, "verification", CURRENT_FORMS, view, independent)).toBe(
            asRecordStatus(statusOfRecords(recordsInView(ws, element, viewId))),
          );
        }
        // Validation records hold in the core only (SR-038 AK4: the reader refuses one with a variant).
        expect(recordStatusOf(records, "validation", CURRENT_FORMS, CORE, independent)).toBe(
          asRecordStatus(modelValidationOf(element.own).status),
        );
      }
      return Promise.resolve();
    }, parameters);
  });
});
