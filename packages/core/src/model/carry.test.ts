// Derived states carried over a change of the element store (#184, ADR-0008): after a save or a
// watcher batch the short IDs and the finding states that have a `carry` hook are updated from the
// changed files only. Whatever happened, each must equal what a fresh workspace builds from the
// files, and the hooks must actually run (the state is still there right after the change).
import fs from "node:fs/promises";
import { createFixtureWorkspace } from "@logreq/testkit";
import type { FixtureWorkspace } from "@logreq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import type { Problem } from "../catalog.js";
import type { WorkspaceState } from "../runtime/workspace.js";
import { Workspace } from "../runtime/workspace.js";
import { supersededValidityProblemsState } from "../variants/index.js";
import { workspaceLayoutState } from "../workspace/index.js";
import { carryProblems } from "./carry.js";
import { duplicateIdProblemsState } from "./duplicates.js";
import { missingTargetProblemsState } from "./missing-targets.js";
import { relationTypeProblemsState } from "./relation-types.js";
import { requiredProblemsState } from "./required.js";
import { shortIdState } from "./short-id.js";
import { setElementStatus } from "./status.js";
import type { Contribution } from "./contribution.js";
import type { ElementStore } from "./store.js";
import {
  applyStoreChange,
  carryStoreUpdate,
  elementStoreState,
  recordWrites,
  storeUpdate,
  updateElements,
} from "./store.js";
import { supersededTargetProblemsState } from "./superseded.js";
import { unknownProblemsState } from "./unknown.js";
import { valueKindProblemsState } from "./values.js";
import { createElement, updateElement } from "./write.js";

const NEED = "1a1a1a1a-1111-4111-8111-a0000000000";
const SR = "2b2b2b2b-2222-4222-8222-b0000000000";

/** The finding states with a `carry` hook. */
const CARRIED: readonly WorkspaceState<Promise<readonly Problem[]>>[] = [
  requiredProblemsState,
  unknownProblemsState,
  valueKindProblemsState,
  relationTypeProblemsState,
  duplicateIdProblemsState,
];

/** The finding states without one: reset by a change of the store, as before. */
const RESET: readonly WorkspaceState<Promise<readonly Problem[]>>[] = [
  supersededTargetProblemsState,
  supersededValidityProblemsState,
  missingTargetProblemsState,
];

const open = async (
  files: Readonly<Record<string, string>> = {},
): Promise<{ fixture: FixtureWorkspace; workspace: Workspace }> => {
  const fixture = await createFixtureWorkspace({ fixture: "SR-019/findings", files });
  onTestFinished(() => fixture.cleanup());
  const workspace = new Workspace(fixture.root);
  onTestFinished(() => workspace.close());
  return { fixture, workspace };
};

/** Builds the short IDs and every finding state. */
const buildAll = async (workspace: Workspace): Promise<void> => {
  await workspace.get(shortIdState);
  for (const state of [...CARRIED, ...RESET]) {
    await workspace.get(state);
  }
};

/** What callers see of the derived states: the short ID of each element, what it finds, every finding. */
const derived = async (workspace: Workspace): Promise<unknown> => {
  const store = await workspace.get(elementStoreState);
  const shortIds = await workspace.get(shortIdState);
  const findings: Record<string, readonly Problem[]> = {};
  for (const state of [...CARRIED, ...RESET]) {
    findings[state.name] = await workspace.get(state);
  }
  return {
    shortIds: store.elements.map((e) => {
      const match = shortIds.find(shortIds.of(e));
      return [e.file, shortIds.of(e), match.kind === "found" ? match.element.file : match.kind];
    }),
    findings,
  };
};

/** The derived states of `workspace` equal those a fresh workspace builds from the files. */
const expectFresh = async (fixture: FixtureWorkspace, workspace: Workspace): Promise<void> => {
  const fresh = new Workspace(fixture.root);
  onTestFinished(() => fresh.close());
  expect(await derived(workspace)).toEqual(await derived(fresh));
};

/** The states carried right after a change: the short IDs and every state with a hook. */
const expectCarried = (workspace: Workspace): void => {
  expect(workspace.peek(shortIdState)).toBeDefined();
  for (const state of CARRIED) {
    expect(workspace.peek(state), state.name).toBeDefined();
  }
  for (const state of RESET) {
    expect(workspace.peek(state), state.name).toBeUndefined();
  }
};

/** Writes a file as the user's editor does and applies it the way the watcher does (SR-007). */
const external = async (
  fixture: FixtureWorkspace,
  workspace: Workspace,
  files: Readonly<Record<string, string | undefined>>,
): Promise<void> => {
  for (const [file, text] of Object.entries(files)) {
    if (text === undefined) {
      await fs.rm(fixture.path(file));
    } else {
      await fixture.write(file, text);
    }
  }
  const layout = await workspace.get(workspaceLayoutState);
  const changed = await applyStoreChange(workspace, (store) =>
    updateElements(store, layout, new Map([["system", { paths: Object.keys(files) }]])),
  );
  expect(changed).toBeDefined();
};

const need = (id: string, extra = ""): string =>
  `---\nid: ${id}\ntype: need\nstatus: draft\ntitle: A need\n${extra}---\n\nText.\n`;

describe("derived states carried over a change of the store (#184)", () => {
  it("equal a fresh build after element.update, and are carried", async () => {
    const { fixture, workspace } = await open();
    await buildAll(workspace);
    // SR-085 gone: the weight is a number now.
    await updateElement(workspace, { ref: `${SR}4`, set: { weight: 5 } });
    expectCarried(workspace);
    await expectFresh(fixture, workspace);
    // SR-015 gone, SR-016 still there; a title change only.
    await updateElement(workspace, { ref: `${SR}2`, set: { "verification-method": "test" } });
    await updateElement(workspace, { ref: `${SR}3`, title: "Show the direction" });
    expectCarried(workspace);
    await expectFresh(fixture, workspace);
  });

  it("equal a fresh build after element.create and element.setStatus", async () => {
    const { fixture, workspace } = await open();
    await buildAll(workspace);
    await createElement(workspace, { type: "need", title: "A new need", properties: { priority: "urgent" } });
    expectCarried(workspace);
    await expectFresh(fixture, workspace);
    await setElementStatus(workspace, { refs: [`${NEED}1`, `${SR}1`], status: "approved" });
    await expectFresh(fixture, workspace);
  });

  it("equal a fresh build when a target changes type, a UUID collides and a copy goes (watcher)", async () => {
    const { fixture, workspace } = await open();
    await buildAll(workspace);
    // The target of N-…2's relation becomes a need: the hint on the unchanged N-…2 names it anew.
    const sr1 = await fs.readFile(fixture.path("requirements/SR-b00000000001.md"), "utf8");
    await external(fixture, workspace, {
      "requirements/SR-b00000000001.md": sr1.replace("type: system-requirement", "type: need"),
    });
    expectCarried(workspace);
    await expectFresh(fixture, workspace);
    // A UUID with the last 6 digits of N-…1, SR-…1 and VAR-…1: their short IDs grow, and so do
    // those in the messages of unchanged files.
    await external(fixture, workspace, {
      "needs/N-f00000000001.md": need("4d4d4d4d-4444-4444-8444-f00000000001", "legacy: x\n"),
    });
    expectCarried(workspace);
    await expectFresh(fixture, workspace);
    // A UUID in the group of N-…2, the source of the SR-086 hint, but not of its target SR-…1: the
    // hint's own short ID grows, in an unchanged file.
    await external(fixture, workspace, {
      // One target where a list belongs (SR-085), looked at again by later steps.
      "needs/N-a00000000002x.md": need(
        "4d4d4d4d-4444-4444-8444-a00000000002",
        `derives-from: { id: ${SR}1, version: n1:1111111111111111 }\n`,
      ),
    });
    expectCarried(workspace);
    await expectFresh(fixture, workspace);
    // The faulty file becomes an element: a record where none was before.
    await external(fixture, workspace, {
      "requirements/SR-b00000000006.md":
        "---\nid: 2b2b2b2b-2222-4222-8222-b00000000006\ntype: system-requirement\nstatus: draft\ntitle: Fixed\nweight: heavy\n---\n\nText.\n",
    });
    expectCarried(workspace);
    await expectFresh(fixture, workspace);
    // The UUID of N-…4 changes in place: the old and the new UUID both change.
    const old4 = await fs.readFile(fixture.path("needs/N-a00000000004.md"), "utf8");
    await external(fixture, workspace, {
      "needs/N-a00000000004.md": old4.replace(`id: ${NEED}4`, "id: 5e5e5e5e-5555-4555-8555-e00000000004"),
    });
    expectCarried(workspace);
    await expectFresh(fixture, workspace);
    // The copy is deleted (SR-088 gone) and a value of the wrong kind appears elsewhere.
    await external(fixture, workspace, {
      "copies/N-a00000000003.md": undefined,
      "needs/N-a00000000004.md": need(`${NEED}4`, "priority: 3\n"),
    });
    expectCarried(workspace);
    await expectFresh(fixture, workspace);
  });

  it("equal a fresh build when the target of a single relation property changes type (watcher)", async () => {
    const model = await fs.readFile(
      new URL("../../../../fixtures/SR-019/findings/metamodel/model.yaml", import.meta.url),
      "utf8",
    );
    const { fixture, workspace } = await open({
      // A relation property with one target (no `many`) that names its target types (SR-086).
      "metamodel/model.yaml": model
        .replace(
          "properties: [title, weight, verification-method, validity]",
          "properties: [title, weight, verification-method, validity, parent]",
        )
        .replace(
          "  - { key: title, name: Title, kind: text, meaning: title }",
          "  - { key: title, name: Title, kind: text, meaning: title }\n  - { key: parent, name: Parent, kind: relation, target-types: [need] }",
        ),
      "requirements/SR-b0000000000a.md": `---\nid: ${SR}a\ntype: system-requirement\nstatus: draft\ntitle: Has a parent\nverification-method: test\nparent: { id: ${NEED}1, version: n1:1111111111111111 }\n---\n\nText.\n`,
    });
    await buildAll(workspace);
    expect((await workspace.get(relationTypeProblemsState)).map((p) => p.file)).toEqual([
      "needs/N-a00000000002.md",
    ]);
    // The parent becomes a system requirement: the unchanged SR-…a now has a hint.
    const need1 = await fs.readFile(fixture.path("needs/N-a00000000001.md"), "utf8");
    await external(fixture, workspace, {
      "needs/N-a00000000001.md": need1.replace("type: need", "type: system-requirement"),
    });
    expectCarried(workspace);
    expect((await workspace.get(relationTypeProblemsState)).map((p) => p.file)).toContain(
      "requirements/SR-b0000000000a.md",
    );
    await expectFresh(fixture, workspace);
  });

  it("equal a fresh build when one watcher batch adds a file that sorts before a changed one", async () => {
    const { fixture, workspace } = await open();
    await buildAll(workspace);
    const need4 = await fs.readFile(fixture.path("needs/N-a00000000004.md"), "utf8");
    // Both files get an unknown key; `a/N-new.md` comes first in store order, though not in the batch.
    await external(fixture, workspace, {
      "needs/N-a00000000004.md": need4.replace("title: Old need", "title: Old need\nbogus-a: 1"),
      "a/N-new.md": need("9c9c9c9c-9999-4999-8999-c00000000077", "bogus-b: 2\n"),
    });
    expectCarried(workspace);
    await expectFresh(fixture, workspace);
  });

  it("look at no unchanged element again after a save that keeps every UUID in place (SR-086 shortcut)", async () => {
    const { fixture, workspace } = await open();
    await buildAll(workspace);
    // The SR-086 hint of the unchanged N-…2 names SR-…1 as its target.
    const [hint] = (await workspace.get(relationTypeProblemsState)).filter(
      (p) => p.file === "needs/N-a00000000002.md",
    );
    expect(hint).toBeDefined();
    await updateElement(workspace, { ref: `${SR}1`, title: "A new title" });
    expectCarried(workspace);
    const [after] = (await workspace.get(relationTypeProblemsState)).filter(
      (p) => p.file === "needs/N-a00000000002.md",
    );
    // The very problem kept, not found and located again.
    expect(after).toBe(hint);
    await expectFresh(fixture, workspace);
  });

  it("are reset when nothing tells which records changed", async () => {
    const { workspace } = await open();
    await buildAll(workspace);
    const store = await workspace.get(elementStoreState);
    // A replace from outside `applyStoreChange` carries nothing.
    expect(
      await workspace.replace(elementStoreState, workspace.peek(elementStoreState), Promise.resolve(store)),
    ).toBe(true);
    expect(workspace.peek(shortIdState)).toBeUndefined();
    expect(workspace.peek(valueKindProblemsState)).toBeUndefined();
  });

  it("are reset after a store without its repositories", async () => {
    const { fixture, workspace } = await open();
    await buildAll(workspace);
    const layout = await workspace.get(workspaceLayoutState);
    await applyStoreChange(workspace, (store) => {
      const { repositories: _dropped, ...rest } = store;
      return Promise.resolve(rest);
    });
    expect(workspace.peek(shortIdState)).toBeUndefined();
    // A save then reads the store in full again, through the fallback of `recordWrites`.
    await recordWrites(workspace, layout, []);
    await expectFresh(fixture, workspace);
  });
});

describe("derived states carried over a change in several repositories (#184)", () => {
  /** The SR-085 fixture (repositories `system` and `sensor`), with an extra system requirement. */
  const openTwo = async (): Promise<{ fixture: FixtureWorkspace; workspace: Workspace }> => {
    const fixture = await createFixtureWorkspace({
      fixture: "SR-085/value-kinds",
      files: {
        // A parent item that is a system requirement (SR-086), named without `repository:`.
        "system/requirements/SR-new000000001.md":
          "---\nid: 9d9d9d9d-9999-4999-8999-d00000000001\ntype: system-requirement\nstatus: draft\ntitle: New\nparent-item: { id: 234ae95e-f9e5-4d31-9ab2-9b0f1826503d, version: n1:1111111111111111 }\n---\n\nText.\n",
      },
    });
    onTestFinished(() => fixture.cleanup());
    const workspace = new Workspace(fixture.path("system"));
    onTestFinished(() => workspace.close());
    await buildAll(workspace);
    return { fixture, workspace };
  };

  /** Applies changed paths per repository the way the watcher does (SR-007). */
  const watched = async (
    workspace: Workspace,
    paths: Readonly<Record<string, readonly string[]>>,
  ): Promise<void> => {
    const layout = await workspace.get(workspaceLayoutState);
    const changed = await applyStoreChange(workspace, (store) =>
      updateElements(
        store,
        layout,
        new Map(Object.entries(paths).map(([repository, list]) => [repository, { paths: [...list] }])),
      ),
    );
    expect(changed).toBeDefined();
  };

  const expectFreshTwo = async (fixture: FixtureWorkspace, workspace: Workspace): Promise<void> => {
    const fresh = new Workspace(fixture.path("system"));
    onTestFinished(() => fresh.close());
    expect(await derived(workspace)).toEqual(await derived(fresh));
  };

  it("equal a fresh build when a target moves to another repository with its UUID and type", async () => {
    const { fixture, workspace } = await openTwo();
    expect((await workspace.get(relationTypeProblemsState)).map((p) => p.file)).toContain(
      "requirements/SR-new000000001.md",
    );
    await fs.rename(
      fixture.path("system/requirements/SR-9b0f1826503d.md"),
      fixture.path("sensor/SR-9b0f1826503d.md"),
    );
    await watched(workspace, { system: ["requirements/SR-9b0f1826503d.md"], sensor: ["SR-9b0f1826503d.md"] });
    expectCarried(workspace);
    await expectFreshTwo(fixture, workspace);
  });

  it("equal a fresh build when a file of the first repository changes and the second keeps its problems", async () => {
    const { fixture, workspace } = await openTwo();
    expect((await workspace.get(valueKindProblemsState)).map((p) => p.repository)).toContain("sensor");
    const file = fixture.path("system/requirements/SR-9b0f1826503d.md");
    await fs.writeFile(
      file,
      (await fs.readFile(file, "utf8")).replace("One wrong value", "One more wrong value"),
    );
    await watched(workspace, { system: ["requirements/SR-9b0f1826503d.md"] });
    expectCarried(workspace);
    await expectFreshTwo(fixture, workspace);
  });

  it("equal a fresh build when a file of the second repository changes and the first keeps its problems", async () => {
    const { fixture, workspace } = await openTwo();
    expect((await workspace.get(valueKindProblemsState)).map((p) => p.repository)).toContain("system");
    const file = fixture.path("sensor/anemometer/SR-b69e094ad34c.md");
    await fs.writeFile(
      file,
      (await fs.readFile(file, "utf8")).replace("The choice value", "The choice value really"),
    );
    await watched(workspace, { sensor: ["anemometer/SR-b69e094ad34c.md"] });
    expectCarried(workspace);
    await expectFreshTwo(fixture, workspace);
  });
});

describe("storeUpdate (#184)", () => {
  const load = async (): Promise<ElementStore> => {
    const { workspace } = await open();
    return workspace.get(elementStoreState);
  };

  it("names the files and UUIDs whose records are other objects, before and after", async () => {
    const store = await load();
    const repositories = store.repositories ?? [];
    const [system] = repositories;
    if (system === undefined) {
      throw new Error("no repository");
    }
    const files = new Map(system.files);
    const sr1 = files.get("requirements/SR-b00000000001.md");
    if (sr1?.kind !== "element") {
      throw new Error("SR-…1 is no element");
    }
    files.delete("requirements/SR-b00000000001.md");
    files.set("requirements/SR-b0000000000x.md", {
      kind: "element",
      element: { ...sr1.element, id: `${SR}x`, file: "requirements/SR-b0000000000x.md" },
      warnings: [],
    } satisfies Contribution);
    // A file that is no element changing counts for nothing.
    const faulty = files.get("requirements/SR-b00000000006.md");
    if (faulty === undefined) {
      throw new Error("no faulty file");
    }
    files.set("requirements/SR-b00000000006.md", { ...faulty } satisfies Contribution);
    const to = { ...store, repositories: [{ ...system, files }] };
    const update = storeUpdate(store, to);
    expect(update?.files).toEqual(
      new Map([["system", new Set(["requirements/SR-b00000000001.md", "requirements/SR-b0000000000x.md"])]]),
    );
    expect([...(update?.ids ?? [])].sort()).toEqual([`${SR}1`, `${SR}x`]);
    expect(storeUpdate(store, store)).toEqual({
      from: store,
      to: store,
      files: new Map(),
      ids: new Set(),
      repositories: store.repositories,
    });
  });

  it("cannot tell without repositories or with other repositories or another order of them", async () => {
    const store = await load();
    const { repositories: _dropped, ...bare } = store;
    expect(storeUpdate(bare, store)).toBeUndefined();
    expect(storeUpdate(store, bare)).toBeUndefined();
    expect(storeUpdate(store, { ...store, repositories: [] })).toBeUndefined();
    const renamed = (store.repositories ?? []).map((r) => ({ ...r, repository: "other" }));
    expect(storeUpdate(store, { ...store, repositories: renamed })).toBeUndefined();
    const two = await createFixtureWorkspace({ fixture: "SR-085/value-kinds" });
    onTestFinished(() => two.cleanup());
    const both = new Workspace(two.path("system"));
    onTestFinished(() => both.close());
    const pair = await both.get(elementStoreState);
    const reversed = [...(pair.repositories ?? [])].reverse();
    expect(reversed.map((r) => r.repository)).toEqual(["sensor", "system"]);
    expect(storeUpdate(pair, { ...pair, repositories: reversed })).toBeUndefined();
  });

  it("gives a hook nothing for another state than the store", () => {
    const hook = carryStoreUpdate(() => "carried");
    const ws = new Workspace("/w");
    expect(hook("old", { key: shortIdState, from: 1, to: 2 }, ws)).toBeUndefined();
  });
});

describe("carryProblems (#184)", () => {
  it("finds everything again when a problem names no file", async () => {
    const { workspace } = await open();
    const store = await workspace.get(elementStoreState);
    const update = storeUpdate(store, store);
    if (update === undefined) {
      throw new Error("no update");
    }
    const loose: Problem = { code: "element.unknown-property", severity: "warning", message: "no file" };
    const problems = await carryProblems(workspace, Promise.resolve([loose]), update, {
      findingsOf: Promise.resolve((element) =>
        element.id === `${SR}1`
          ? [{ element, path: ["title"], problem: { ...loose, file: element.file } }]
          : [],
      ),
    });
    expect(problems).toEqual([{ ...loose, file: "requirements/SR-b00000000001.md", line: 5 }]);
  });

  it("keeps every problem of an unchanged file, in order", async () => {
    const { workspace } = await open();
    const store = await workspace.get(elementStoreState);
    const update = storeUpdate(store, store);
    if (update === undefined) {
      throw new Error("no update");
    }
    const file = "requirements/SR-b00000000001.md";
    const kept: Problem[] = [
      { code: "element.unknown-property", severity: "warning", message: "one", repository: "system", file },
      { code: "element.unknown-property", severity: "warning", message: "two", repository: "system", file },
    ];
    const problems = await carryProblems(workspace, Promise.resolve(kept), update, {
      findingsOf: Promise.resolve(() => []),
    });
    expect(problems).toEqual(kept);
  });

  it("keeps every problem of an unchanged file when it walks the store", async () => {
    const { workspace } = await open();
    const store = await workspace.get(elementStoreState);
    const update = storeUpdate(store, store);
    if (update === undefined) {
      throw new Error("no update");
    }
    const file = "requirements/SR-b00000000001.md";
    const kept: Problem[] = [
      { code: "element.unknown-property", severity: "warning", message: "one", repository: "system", file },
      { code: "element.unknown-property", severity: "warning", message: "two", repository: "system", file },
    ];
    const problems = await carryProblems(workspace, Promise.resolve(kept), update, {
      findingsOf: Promise.resolve(() => []),
      again: Promise.resolve(() => false),
    });
    expect(problems).toEqual(kept);
  });

  it("merges the findings of the elements it names again into the kept problems, in store order", async () => {
    const { workspace } = await open();
    const store = await workspace.get(elementStoreState);
    const update = storeUpdate(store, store);
    const [sr1] = store.byId.get(`${SR}1`) ?? [];
    if (update === undefined || sr1 === undefined) {
      throw new Error("no update");
    }
    const problem = (file: string, message: string): Problem => ({
      code: "element.unknown-property",
      severity: "warning",
      message,
      repository: "system",
      file,
    });
    const before = [
      problem("copies/N-a00000000003.md", "first"),
      problem("requirements/SR-b00000000001.md", "replaced"),
      problem("variants/VAR-c00000000001.md", "last"),
    ];
    const problems = await carryProblems(workspace, Promise.resolve(before), update, {
      findingsOf: Promise.resolve((element) =>
        element === sr1 ? [{ element, path: ["title"], problem: problem(element.file, "new") }] : [],
      ),
      again: Promise.resolve([sr1]),
    });
    expect(problems).toEqual([
      problem("copies/N-a00000000003.md", "first"),
      { ...problem("requirements/SR-b00000000001.md", "new"), line: 5 },
      problem("variants/VAR-c00000000001.md", "last"),
    ]);
  });

  it("finds everything again for a problem of a repository the store does not have", async () => {
    const { workspace } = await open();
    const store = await workspace.get(elementStoreState);
    const update = storeUpdate(store, store);
    if (update === undefined) {
      throw new Error("no update");
    }
    const elsewhere: Problem = {
      code: "element.unknown-property",
      severity: "warning",
      message: "elsewhere",
      repository: "gone",
      file: "x.md",
    };
    const problems = await carryProblems(workspace, Promise.resolve([elsewhere]), update, {
      findingsOf: Promise.resolve(() => []),
    });
    expect(problems).toEqual([]);
  });
});
