import { createFixtureWorkspace } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import type { Metamodel } from "../metamodel/index.js";
import { metamodelState } from "../metamodel/index.js";
import { Workspace } from "../runtime/workspace.js";
import type { ElementRecord } from "./elements.js";
import type { IdentifierIndex } from "./identifier-index.js";
import {
  buildIdentifierIndex,
  elementsWithIdentifier,
  identifierKeyOf,
  identifierValue,
  updateIdentifierIndex,
} from "./identifier-index.js";
import { buildShortIds, identifierField, updateShortIds } from "./short-id.js";

/** The metamodel of fixtures/enabler-305/identifiers (`spec-id` has the meaning identifier) or of the standard model. */
const metamodelOf = async (fixture: string): Promise<Metamodel> => {
  const created = await createFixtureWorkspace({ fixture });
  onTestFinished(() => created.cleanup());
  const workspace = new Workspace(created.root);
  onTestFinished(() => workspace.close());
  return workspace.get(metamodelState);
};

const record = (
  id: string,
  file: string,
  specId: unknown,
  repository = "spec",
  type = "system-requirement",
): ElementRecord => ({
  id,
  type,
  repository,
  file,
  data: { id, type, status: "draft", title: "T", ...(specId === undefined ? {} : { "spec-id": specId }) },
  eol: "\n",
  closingEol: "\n",
  bom: false,
  snapshot: { path: file, size: 0, mtimeMs: 0, sha256: "" },
});

const byIdOf = (records: readonly ElementRecord[]): Map<string, ElementRecord[]> => {
  const byId = new Map<string, ElementRecord[]>();
  for (const r of records) {
    byId.set(r.id, [...(byId.get(r.id) ?? []), r]);
  }
  return byId;
};

const uuid = (n: number): string => `30500000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;

/** The index as plain data: each identifier with the places of its elements. */
const seen = (index: IdentifierIndex): Record<string, string[]> =>
  Object.fromEntries(
    [...index.byValue.keys()].map((value) => [
      value,
      elementsWithIdentifier(index, value).map((e) => `${e.repository}:${e.file}`),
    ]),
  );

describe("identifier index (#305)", () => {
  it("takes the non-empty text under the key with the meaning identifier, in any case", async () => {
    const metamodel = await metamodelOf("enabler-305/identifiers");
    expect(identifierKeyOf(metamodel)).toBe("spec-id");
    expect(identifierValue(record(uuid(1), "a.md", "SR-036"), "spec-id")).toBe("SR-036");
    for (const value of ["", 36, ["SR-036"], null, undefined]) {
      expect(identifierValue(record(uuid(1), "a.md", value), "spec-id")).toBeUndefined();
    }
    expect(identifierValue(record(uuid(1), "a.md", "SR-036"), undefined)).toBeUndefined();
    const index = buildIdentifierIndex(
      byIdOf([
        record(uuid(1), "b.md", "SR-036"),
        record(uuid(2), "a.md", "sr-036", "other"),
        record(uuid(3), "a.md", "Sr-036"),
        record(uuid(4), "c.md", 4711),
      ]),
      metamodel,
    );
    // By repository, then file, whatever the order of the store.
    expect(seen(index)).toEqual({ "sr-036": ["other:a.md", "spec:a.md", "spec:b.md"] });
    const shortIds = buildShortIds(byIdOf([record(uuid(1), "b.md", "SR-036")]), metamodel);
    expect(shortIds.withIdentifier("SR-036").map((e) => e.file)).toEqual(["b.md"]);
    expect(shortIds.withIdentifier("SR-37")).toEqual([]);
    expect(identifierField(shortIds, record(uuid(1), "b.md", "SR-036"))).toEqual({ identifier: "SR-036" });
    expect(identifierField(shortIds, record(uuid(1), "b.md", undefined))).toEqual({});
  });

  it("has no identifiers when no property has the meaning", async () => {
    const metamodel = await metamodelOf("SR-001/two-elements");
    const byId = byIdOf([record(uuid(1), "a.md", "SR-036")]);
    const index = buildIdentifierIndex(byId, metamodel);
    expect(index).toEqual({ key: undefined, byValue: new Map(), byId });
    const next = byIdOf([record(uuid(2), "b.md", "SR-037")]);
    expect(updateIdentifierIndex(index, next, [uuid(2)], () => [])).toEqual({
      key: undefined,
      byValue: new Map(),
      byId: next,
    });
    const shortIds = buildShortIds(byId, metamodel);
    expect(shortIds.identifierOf(record(uuid(1), "a.md", "SR-036"))).toBeUndefined();
    expect(shortIds.withIdentifier("SR-036")).toEqual([]);
  });

  it("updates to what a full build gives, and leaves the index before as it was", async () => {
    const metamodel = await metamodelOf("enabler-305/identifiers");
    const a = record(uuid(1), "a.md", "SR-036");
    const b = record(uuid(2), "b.md", "SR-037");
    const c = record(uuid(3), "c.md", "N-001", "spec", "need");
    const steps: { records: ElementRecord[]; ids: string[] }[] = [
      // A new element with the identifier of another one.
      { records: [a, b, c, record(uuid(4), "d.md", "sr-036")], ids: [uuid(4)] },
      // Its identifier changes; one with the same UUID is copied elsewhere (SR-088).
      {
        records: [a, b, c, record(uuid(4), "d.md", "SR-038"), record(uuid(4), "e/d.md", "SR-038")],
        ids: [uuid(4)],
      },
      // The first is gone, the second loses its identifier.
      {
        records: [
          record(uuid(2), "b.md", undefined),
          c,
          record(uuid(4), "d.md", "SR-038"),
          record(uuid(4), "e/d.md", "SR-038"),
        ],
        ids: [uuid(1), uuid(2)],
      },
      // The second gets an identifier again; the copies of the fourth get different ones.
      {
        records: [
          record(uuid(2), "b.md", "SR-037"),
          c,
          record(uuid(4), "d.md", "SR-038"),
          record(uuid(4), "e/d.md", "SR-039"),
        ],
        ids: [uuid(2), uuid(4)],
      },
      // Two get the same new identifier.
      {
        records: [
          record(uuid(2), "b.md", "SR-040"),
          c,
          record(uuid(4), "d.md", "SR-040"),
          record(uuid(4), "e/d.md", "SR-040"),
        ],
        ids: [uuid(2), uuid(4)],
      },
      // Both lose it at once.
      {
        records: [
          record(uuid(2), "b.md", undefined),
          c,
          record(uuid(4), "d.md", undefined),
          record(uuid(4), "e/d.md", undefined),
        ],
        ids: [uuid(2), uuid(4)],
      },
      // Saved again with the same identifiers (new records): the lists stay.
      {
        records: [
          record(uuid(2), "b.md", undefined),
          record(uuid(3), "c.md", "N-001", "spec", "need"),
          record(uuid(4), "d.md", undefined),
          record(uuid(4), "e/d.md", undefined),
        ],
        ids: [uuid(3)],
      },
      // Nothing changed.
      {
        records: [
          record(uuid(2), "b.md", undefined),
          c,
          record(uuid(4), "d.md", undefined),
          record(uuid(4), "e/d.md", undefined),
        ],
        ids: [],
      },
    ];
    let byId = byIdOf([a, b, c]);
    let shortIds = buildShortIds(byId, metamodel);
    let index = buildIdentifierIndex(byId, metamodel);
    for (const step of steps) {
      const next = byIdOf(
        step.records.map((r) =>
          step.ids.includes(r.id) ? r : (byId.get(r.id)?.find((o) => o.file === r.file) ?? r),
        ),
      );
      const before = seen(index);
      const old = byId;
      const updated = updateIdentifierIndex(index, next, step.ids, (id) => old.get(id) ?? []);
      expect(seen(updated)).toEqual(seen(buildIdentifierIndex(next, metamodel)));
      // The same lists (a Map compares without regard to the order of its keys).
      expect(updated.byValue).toEqual(buildIdentifierIndex(next, metamodel).byValue);
      expect(seen(index)).toEqual(before);
      // The short IDs carry their identifiers the same way.
      const carried = updateShortIds(shortIds, next, step.ids);
      const built = buildShortIds(next, metamodel);
      for (const value of ["SR-036", "SR-037", "SR-038", "SR-039", "SR-040", "N-001"]) {
        expect(carried.withIdentifier(value), value).toEqual(built.withIdentifier(value));
      }
      if (step.ids.length === 0 || step.ids.includes(uuid(3))) {
        // No identifier changed: the map is taken over, nothing is copied.
        expect(updated.byValue).toBe(index.byValue);
      }
      byId = next;
      index = updated;
      shortIds = carried;
    }
  });
});
