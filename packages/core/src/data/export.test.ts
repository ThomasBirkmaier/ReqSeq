// The parts of the data export (export.ts) that the command tests on fixtures/SR-061/export
// (commands/data/export.test.ts) do not reach: a metamodel without validity or packages property,
// entries that name no UUID, relation ends that are not available or have no version, the reads of
// the second pass, and the header. Records and metamodel come from the fixture; the rest is stubbed.
import { createFixtureWorkspace } from "@logreq/testkit";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import type { DataExportElement, DataExportRelation } from "../generated/types.js";
import type { Metamodel } from "../metamodel/index.js";
import { metamodelState } from "../metamodel/index.js";
import type { CurrentVersion, ElementRecord, ElementStore } from "../model/index.js";
import { elementStoreState } from "../model/index.js";
import { Workspace } from "../runtime/workspace.js";
import {
  exportHeader,
  exportTime,
  exportedElement,
  exportedProperties,
  withRelationVersions,
} from "./export.js";

const P = "61061061-0000-4000-8000-0000000000";
const B1 = `${P}b1`;
const C1 = `${P}c1`;
const D1 = `${P}d1`;
const V = "n1:1111111111111111";
const W = "n1:2222222222222222";

const opened = async (): Promise<{ metamodel: Metamodel; store: ElementStore }> => {
  const fixture = await createFixtureWorkspace({ fixture: "SR-061/export" });
  onTestFinished(() => fixture.cleanup());
  const workspace = new Workspace(fixture.path("system"));
  onTestFinished(() => workspace.close());
  return { metamodel: await workspace.get(metamodelState), store: await workspace.get(elementStoreState) };
};

const recordIn = (store: ElementStore, id: string): ElementRecord => {
  const [found] = store.byId.get(id) ?? [];
  if (found === undefined) {
    throw new Error(`${id} is not in the store`);
  }
  return found;
};

/** An element as listed, with only what the export reads. */
const listed = (
  record: Pick<ElementRecord, "id" | "repository">,
  relations: readonly DataExportRelation[],
  version?: string,
): DataExportElement => ({
  id: record.id,
  shortId: "SR-000000",
  type: "system-requirement",
  title: "",
  ...(version === undefined ? {} : { version }),
  repository: record.repository,
  file: "x.md",
  properties: {},
  relations: [...relations],
});

const out = (id: string, more: Partial<DataExportRelation> = {}): DataExportRelation => ({
  kind: "derives-from",
  direction: "out",
  id,
  repository: "system",
  accessible: true,
  targetState: "available",
  storedVersion: V,
  ...more,
});

describe("validity and packages of an exported element", () => {
  it("are left out without a property of kind relation with the meaning", async () => {
    const { metamodel, store } = await opened();
    const b1 = recordIn(store, B1);
    const element = listed(b1, []);
    expect(exportedElement(exportedProperties(metamodel), b1, element)).toMatchObject({
      validity: [C1],
      packages: [D1],
    });
    const without: Metamodel = {
      ...metamodel,
      properties: metamodel.properties.filter((p) => p.meaning !== "validity" && p.meaning !== "packages"),
    };
    expect(exportedElement(exportedProperties(without), b1, element)).toEqual(element);
    // A property with the meaning that holds text names no target.
    const asText: Metamodel = {
      ...metamodel,
      properties: metamodel.properties.map((p) => (p.meaning === "packages" ? { ...p, kind: "text" } : p)),
    };
    expect(exportedProperties(asText).packages).toBeUndefined();
  });

  it("give only entries that name a UUID", async () => {
    const { metamodel, store } = await opened();
    const b1 = recordIn(store, B1);
    const odd: ElementRecord = {
      ...b1,
      data: { ...b1.data, validity: ["Coast", { id: "VAR-0000c1" }, { id: C1, repository: "system" }] },
    };
    expect(exportedElement(exportedProperties(metamodel), odd, listed(odd, []))).toMatchObject({
      validity: [C1],
      packages: [D1],
    });
  });
});

describe("current versions of relation ends (second pass)", () => {
  it("reads the versions of available targets outside the listed elements once, and none without such targets", async () => {
    const { store } = await opened();
    const [a1, b1] = [recordIn(store, `${P}a1`), recordIn(store, B1)];
    const read = vi.fn(
      (records: readonly ElementRecord[]): Promise<ReadonlyMap<ElementRecord, CurrentVersion>> =>
        Promise.resolve(
          new Map(
            records.map((r): [ElementRecord, CurrentVersion] =>
              r === a1
                ? [r, { kind: "version", version: V, images: [] }]
                : [r, { kind: "unknown", reason: "not-in-file", message: "gone" }],
            ),
          ),
        ),
    );
    const elements = await withRelationVersions(
      store,
      [
        listed(
          b1,
          [
            out(a1.id),
            out(`${P}c1`, { kind: "validity", property: true, storedVersion: W }),
            out(`${P}ff`, { accessible: false, targetState: "missing" }),
            // Available when it was listed, gone from the store since.
            out(`${P}ee`),
            { ...out(`${P}b2`), direction: "in" },
          ],
          W,
        ),
      ],
      read,
    );
    expect(read).toHaveBeenCalledTimes(1);
    expect(read.mock.calls[0]?.[0]).toEqual([a1, recordIn(store, C1)]);
    expect(elements[0]?.relations.map((r) => [r.id.slice(-2), r.currentVersion, r.outdated])).toEqual([
      ["a1", V, false],
      // The variant has no version now: nothing to compare with.
      ["c1", undefined, false],
      ["ff", undefined, false],
      ["ee", undefined, false],
      // An incoming relation is measured against the element itself.
      ["b2", W, true],
    ]);
    // Among the listed elements: their versions as listed, an element without version as target and source.
    read.mockClear();
    const both = await withRelationVersions(
      store,
      [listed(b1, [out(a1.id)]), listed(a1, [{ ...out(B1), direction: "in" }])],
      read,
    );
    expect(read).not.toHaveBeenCalled();
    expect(both.map((e) => e.relations.map((r) => [r.currentVersion, r.outdated]))).toEqual([
      [[undefined, false]],
      [[undefined, false]],
    ]);
  });
});

describe("the header of an export", () => {
  it("gives the time in seconds, the selection when given and the commit when known", () => {
    expect(exportTime(new Date("2026-10-27T08:09:10.987Z"))).toBe("2026-10-27T08:09:10Z");
    const header = {
      name: "Weather station",
      main: "system",
      generated: "2026-10-27T08:09:10Z",
      repositories: [
        { name: "system", available: true, commit: "0123456789abcdef0123456789abcdef01234567" },
        { name: "sensor", available: true },
        { name: "vault", available: false },
      ],
      incomplete: true,
    };
    const out = exportHeader({ ...header, selection: { package: "PKG-0000d1" } });
    expect(out).toEqual({
      "logreq-data": 2,
      commit: "0123456789abcdef0123456789abcdef01234567",
      dirty: true,
      workspace: "Weather station",
      generated: "2026-10-27T08:09:10Z",
      selection: { package: "PKG-0000d1" },
      repositories: header.repositories,
      incomplete: true,
    });
    // `logreq-data` first, then the state: the order of every line of the JSON Lines form.
    expect(Object.keys(out).slice(0, 3)).toEqual(["logreq-data", "commit", "dirty"]);
    expect(exportHeader({ ...header, selection: undefined })).not.toHaveProperty("selection");
  });

  it("is clean only when every available repository is known clean; the commit is the main one's", () => {
    const at = (dirty: boolean | undefined) => ({
      name: "Weather station",
      main: "sensor",
      generated: "2026-10-27T08:09:10Z",
      selection: undefined,
      repositories: [
        { name: "system", available: true, commit: "0123456789abcdef0123456789abcdef01234567", dirty: false },
        { name: "sensor", available: true, ...(dirty === undefined ? {} : { dirty }) },
        { name: "vault", available: false },
      ],
      incomplete: true,
    });
    expect(exportHeader(at(false))).toMatchObject({ dirty: false });
    expect(exportHeader(at(false))).not.toHaveProperty("commit");
    expect(exportHeader(at(true))).toMatchObject({ dirty: true });
    expect(exportHeader(at(undefined))).toMatchObject({ dirty: true });
  });
});
