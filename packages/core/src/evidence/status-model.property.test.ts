// Level 1 of the status model (#1394, epic #1389): the core's pure status functions against the reference model of
// `@reqseq/testkit/status-model`, on generated elements. No test here names an [SR/AK] token: they are no evidence
// of the tool (the model's rule table names the sources).
//
// What level 1 does not check: the reader (records it refuses, Markdown and JUnit forms, criteria order as read),
// the metamodel meanings, relation resolution and twins, views and variants (replacement, exclusion, SR-173),
// version hashes and the Git walk behind older criteria (`older-criteria.ts`), and the index order of the store.
// The level-2 tests of #1396 cover them through a workspace on disk.
//
// Runs: STATUS_MODEL_RUNS (default 1000) and STATUS_MODEL_SEED (default fixed); a failure names the seed.
import {
  CURRENT,
  type ModelCriterion,
  type ModelCriterionRef,
  type ModelElement,
  type ModelRecord,
  forAllElements,
  instantOf,
  propertyParameters,
  validationOf as modelValidationOf,
  verificationOf as modelVerificationOf,
} from "@reqseq/testkit/status-model";
import { describe, expect, it } from "vitest";
import type { CriterionRef, VersionForms } from "../model/index.js";
import { compareCriterionRefs } from "../model/index.js";
import type { View } from "../variants/index.js";
import { elementCriteria } from "./criteria.js";
import type { EvidenceRecord } from "./record.js";
import { criterionStatusesOf, ownVerificationOf, validationOf } from "./status.js";

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
