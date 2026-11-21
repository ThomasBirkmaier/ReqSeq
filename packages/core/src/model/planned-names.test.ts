// The names a dry run (SR-246) gives the planned element on its problems (`withPlannedNames`).
import { describe, expect, it } from "vitest";
import type { Problem } from "../generated/types.js";
import { withPlannedNames } from "./planned-names.js";
import type { ShortIds } from "./short-id.js";
import type { ElementRecord } from "./elements.js";

const ID = "24600000-0000-4000-8000-000000000001";
const RECORD = { id: ID, repository: "spec", file: "requirements/SR-000000000001.md" } as ElementRecord;

/** Short IDs that name only the planned record, with or without an identifier. */
const shortIds = (identifier: string | undefined): ShortIds =>
  ({
    of: (record: ElementRecord) => (record === RECORD ? "SR-000001" : "other"),
    identifierOf: (record: ElementRecord) => (record === RECORD ? identifier : undefined),
  }) as unknown as ShortIds;

const problem = (more: Partial<Problem>): Problem => ({
  code: "element.text-emptied",
  severity: "warning",
  message: "m",
  ...more,
});

const result = (problems: readonly Problem[], record: ElementRecord | null = RECORD) => ({
  element: { problems },
  problems,
  ...(record === null ? {} : { dryRun: { record, files: [] } }),
});

describe("withPlannedNames (SR-246)", () => {
  it("names the planned element by UUID and repository, as element and as target", () => {
    const problems = [
      problem({ elementId: ID, repository: "spec" }),
      problem({ elementId: ID, elementRepository: "spec", repository: "other" }),
      // Another copy of the UUID (SR-088), and another element.
      problem({ elementId: ID, repository: "other" }),
      problem({ elementId: "24600000-0000-4000-8000-000000000002", repository: "spec" }),
      problem({ targetId: ID, targetRepository: "spec" }),
      problem({ targetId: ID }),
    ];
    const named = withPlannedNames(result(problems), shortIds("SR-136"));
    const names = named.problems.map((p) => [
      p.elementShortId,
      p.elementIdentifier,
      p.targetShortId,
      p.targetIdentifier,
    ]);
    expect(names).toEqual([
      ["SR-000001", "SR-136", undefined, undefined],
      ["SR-000001", "SR-136", undefined, undefined],
      [undefined, undefined, undefined, undefined],
      [undefined, undefined, undefined, undefined],
      [undefined, undefined, "SR-000001", "SR-136"],
      [undefined, undefined, undefined, undefined],
    ]);
    expect(named.element.problems).toEqual(named.problems);
  });

  it("gives no identifier the planned element lacks, and leaves a result without a planned element", () => {
    const problems = [problem({ elementId: ID, repository: "spec" })];
    expect(withPlannedNames(result(problems), shortIds(undefined)).problems).toEqual([
      { ...problems[0], elementShortId: "SR-000001" },
    ]);
    const none = result(problems, null);
    expect(withPlannedNames(none, shortIds("SR-136"))).toBe(none);
  });
});
