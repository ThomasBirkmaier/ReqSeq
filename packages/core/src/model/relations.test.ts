import { createFixtureWorkspace } from "@logreq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import { Workspace } from "../runtime/workspace.js";
import type { RepositoryLocation, WorkspaceLayout } from "../workspace/index.js";
import type { ElementRecord } from "./elements.js";
import { isRelationTarget, isUnavailableRepository, resolveTarget, targetState } from "./relations.js";
import type { ElementStore } from "./store.js";
import { elementStoreState } from "./store.js";

const NEED = "22a972fd-f4f1-4b95-ba1d-e3e85234824e";
const VERSION = "n1:9f86d081884c7d65";

const store = async (): Promise<ElementStore> => {
  const fixture = await createFixtureWorkspace({ fixture: "SR-086/relation-types" });
  onTestFinished(() => fixture.cleanup());
  const workspace = new Workspace(fixture.path("system"));
  onTestFinished(() => workspace.close());
  return workspace.get(elementStoreState);
};

const need = (s: ElementStore): ElementRecord => {
  const [record] = s.byId.get(NEED) ?? [];
  if (record === undefined) {
    throw new Error("no need");
  }
  return record;
};

describe("relation targets", () => {
  it("tells a relation target from other values", () => {
    expect(isRelationTarget({ id: NEED, version: VERSION, title: "T" })).toBe(true);
    expect(isRelationTarget({ id: NEED, version: VERSION, repository: "system" })).toBe(true);
    expect(isRelationTarget({ id: NEED })).toBe(false);
    expect(isRelationTarget("N-34824e")).toBe(false);
  });

  it("finds the target in the repository it names, or in the source's own (D-058)", async () => {
    const s = await store();
    const element = need(s);
    expect(resolveTarget(s, "system", { id: NEED, version: VERSION })).toEqual({ kind: "found", element });
    expect(resolveTarget(s, "sensor", { id: NEED, version: VERSION, repository: "system" })).toEqual({
      kind: "found",
      element,
    });
  });

  it("gives unknown for a missing target and for a target outside the repository it names", async () => {
    const s = await store();
    const other = { id: "587fff4b-4dce-4f06-8434-acfd25c193f6", version: VERSION };
    expect(resolveTarget(s, "system", other)).toEqual({ kind: "unknown" });
    expect(resolveTarget(s, "sensor", { id: NEED, version: VERSION })).toEqual({ kind: "unknown" });
    expect(resolveTarget(s, "system", { id: NEED, version: VERSION, repository: "elsewhere" })).toEqual({
      kind: "unknown",
    });
  });

  it("gives ambiguous for files of the repository that share the UUID, not for a copy elsewhere", async () => {
    const s = await store();
    const element = need(s);
    const copy = { ...element, file: "needs/copy.md" };
    const elsewhere = { ...element, repository: "sensor" };
    const target = { id: NEED, version: VERSION };
    const shared: ElementStore = { ...s, byId: new Map([[NEED, [element, elsewhere, copy]]]) };
    expect(resolveTarget(shared, "system", target)).toEqual({ kind: "ambiguous", elements: [element, copy] });
    const once: ElementStore = { ...s, byId: new Map([[NEED, [element, elsewhere]]]) };
    expect(resolveTarget(once, "system", target)).toEqual({ kind: "found", element });
  });
});

describe("target states (D-058, SR-006)", () => {
  const repository = (name: string, available: boolean): RepositoryLocation => ({
    name,
    url: `git@git.example.com:ws/${name}.git`,
    main: name === "system",
    path: `../${name}`,
    folder: `/ws/${name}`,
    available,
    excludes: [],
  });
  const layout: Pick<WorkspaceLayout, "repositories"> = {
    repositories: [repository("system", true), repository("sensor", false)],
  };
  const OTHER = "587fff4b-4dce-4f06-8434-acfd25c193f6";

  it("tells an available, inaccessible, missing, ambiguous target and an unknown repository apart", async () => {
    const s = await store();
    const element = need(s);
    const copy = { ...element, file: "needs/copy.md" };
    const shared: ElementStore = { ...s, byId: new Map([[NEED, [element, copy]]]) };
    expect(targetState(layout, s, "system", { id: NEED })).toEqual({ kind: "available", element });
    expect(targetState(layout, s, "system", { id: NEED, repository: "sensor" })).toEqual({
      kind: "inaccessible",
      repository: "sensor",
    });
    expect(targetState(layout, s, "system", { id: OTHER })).toEqual({
      kind: "missing",
      repository: "system",
    });
    expect(targetState(layout, shared, "system", { id: NEED })).toEqual({
      kind: "ambiguous",
      repository: "system",
      elements: [element, copy],
    });
    for (const named of ["elsewhere", null, 7]) {
      expect(targetState(layout, s, "system", { id: NEED, repository: named })).toEqual({
        kind: "unknown-repository",
        repository: named,
      });
    }
    expect(isUnavailableRepository(layout, "sensor")).toBe(true);
    expect(isUnavailableRepository(layout, "system")).toBe(false);
    expect(isUnavailableRepository(layout, "elsewhere")).toBe(false);
  });
});
