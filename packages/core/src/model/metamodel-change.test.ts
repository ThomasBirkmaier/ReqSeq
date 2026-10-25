// SR-015: a changed metamodel takes effect in an open workspace without a restart, and LogReq
// rewrites no element file for it. The real watcher (SR-007) picks up the saved metamodel file;
// element views, findings and versions are then those of the new metamodel, and every element file
// keeps its bytes and its modification time.
import fs from "node:fs/promises";
import path from "node:path";
import type { FixtureWorkspace } from "@logreq/testkit";
import { createFixtureWorkspace, untilWatching } from "@logreq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import type { CommandOutput, Problem } from "../catalog.js";
import { readElementFile } from "../files/index.js";
import { metamodelState } from "../metamodel/index.js";
import { invoke } from "../runtime/invoke.js";
import { Workspace } from "../runtime/workspace.js";
import { workspaceLayoutState } from "../workspace/index.js";
import { duplicateIdProblemsState } from "./duplicates.js";
import { relationTypeProblemsState } from "./relation-types.js";
import { requiredProblemsState } from "./required.js";
import { shortIdState } from "./short-id.js";
import { elementStoreState } from "./store.js";
import { unknownProblemsState } from "./unknown.js";
import { valueKindProblemsState } from "./values.js";
import { elementView, titleKeyOf } from "./view.js";
import { watchWorkspace } from "./watch.js";

const FIXTURE = "SR-015/metamodel-change";
const MODEL = "metamodel/model.yaml";

const NEED = "1a2b3c4d-1e2f-4a3b-8c4d-5d6e7f8a9b0c";
const SPEED = "7e8f9a0b-2c3d-4e5f-9a6b-3b4c5d6e7f80";
const DIRECTION = "4f5a6b7c-8d9e-4f0a-b1c2-9c0d1e2f3a4b";
const STORMS = "2b3c4d5e-6f7a-4b8c-9d0e-6a7b8c9d0e1f";
const DIRECTION_FILE = "requirements/SR-9c0d1e2f3a4b.md";
const STORMS_FILE = "requirements/SAF-6a7b8c9d0e1f.md";
const NEED_FILE = "requirements/N-5d6e7f8a9b0c.md";

/** SR-015 AK1: the tool works with the saved metamodel after at most 2 seconds. */
const TAKE_OVER_LIMIT_MS = 2000;

type MetamodelOutput = CommandOutput<"metamodel.get">;

interface Opened {
  readonly fixture: FixtureWorkspace;
  readonly workspace: Workspace;
  /** The metamodel file as the fixture has it. */
  readonly model: string;
}

/** Copies the fixture and opens it; the workspace (and its watcher) closes before the folder goes. */
const open = async (files: Readonly<Record<string, string>> = {}): Promise<Opened> => {
  const fixture = await createFixtureWorkspace({ fixture: FIXTURE, files });
  const workspace = new Workspace(fixture.root);
  onTestFinished(async () => {
    await workspace.close();
    await fixture.cleanup();
  });
  return { fixture, workspace, model: await fs.readFile(fixture.path(MODEL), "utf8") };
};

/**
 * Reads store and metamodel, starts the real watcher and waits until it reports changes in the
 * metamodel folder: a probe file that is no metamodel file (`*.txt`) is written there until the
 * metamodel was reset. macOS starts FSEvents asynchronously, so the first change after `ready`
 * could be lost.
 */
const watching = async ({ fixture, workspace }: Opened): Promise<void> => {
  await workspace.get(elementStoreState);
  await workspace.get(metamodelState);
  await watchWorkspace(workspace).ready;
  await untilWatching({
    probe: async (attempt) => {
      await workspace.get(metamodelState);
      await fixture.write("metamodel/probe.txt", `Probe ${String(attempt)}\n`);
    },
    seen: () => Promise.resolve(workspace.peek(metamodelState) === undefined),
  });
  await watchWorkspace(workspace).settled();
};

const metamodelOf = async (workspace: Workspace): Promise<MetamodelOutput> =>
  (await invoke("metamodel.get", {}, { workspace })) as MetamodelOutput;

/**
 * Polls `metamodel.get` until `condition` holds and returns the milliseconds since `start`; fails
 * after the 2 seconds of AK1. No fixed sleep: how soon events arrive differs between systems.
 */
const takenOver = async (
  workspace: Workspace,
  start: number,
  condition: (metamodel: MetamodelOutput) => boolean,
): Promise<number> => {
  for (;;) {
    if (condition(await metamodelOf(workspace))) {
      return performance.now() - start;
    }
    if (performance.now() - start > TAKE_OVER_LIMIT_MS) {
      throw new Error(`the changed metamodel was not taken over within ${String(TAKE_OVER_LIMIT_MS)} ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};

/** Saves the metamodel file in place and waits until the tool works with it. */
const saveModel = async (
  { fixture, workspace }: Opened,
  text: string,
  condition: (metamodel: MetamodelOutput) => boolean,
): Promise<number> => {
  const start = performance.now();
  await fixture.write(MODEL, text);
  return takenOver(workspace, start, condition);
};

const typeName = (metamodel: MetamodelOutput, key: string): string | undefined =>
  metamodel.types.find((t) => t.key === key)?.name;

const requiredOf = (metamodel: MetamodelOutput, key: string): readonly string[] | undefined =>
  metamodel.types.find((t) => t.key === key)?.required;

/** Every file below the requirements folder with its bytes, size and modification time. */
const elementFiles = async (fixture: FixtureWorkspace): Promise<Record<string, unknown>> => {
  const folder = fixture.path("requirements");
  const names = (await fs.readdir(folder)).sort();
  const out: Record<string, unknown> = {};
  for (const name of names) {
    const file = path.join(folder, name);
    const stat = await fs.stat(file);
    out[name] = {
      bytes: (await fs.readFile(file)).toString("base64"),
      size: stat.size,
      mtimeMs: stat.mtimeMs,
    };
  }
  return out;
};

/** What the tool shows of every element (the view as `element.create`/`element.update` give it). */
const views = async ({ fixture, workspace }: Opened): Promise<Record<string, unknown>> => {
  const store = await workspace.get(elementStoreState);
  const metamodel = await workspace.get(metamodelState);
  const shortIds = await workspace.get(shortIdState);
  const layout = await workspace.get(workspaceLayoutState);
  const titleKey = titleKeyOf(metamodel) ?? "title";
  const out: Record<string, unknown> = {};
  for (const record of store.elements) {
    const read = await readElementFile(fixture.root, record.file);
    if (read.kind !== "parsed") {
      throw new Error(`cannot read ${record.file}`);
    }
    out[record.id] = elementView({
      successionsOf: () => [],
      record,
      file: read.file,
      images: [],
      metamodel,
      store,
      shortIds,
      titleKey,
      layout,
    });
  }
  return out;
};

const viewOf = (
  all: Record<string, unknown>,
  id: string,
): { version: string; problems: readonly Problem[] } =>
  all[id] as { version: string; problems: readonly Problem[] };

/** The findings of the whole workspace, by kind (for `workspace.check`, SR-019). */
const findings = async ({ workspace }: Opened): Promise<Record<string, readonly Problem[]>> => ({
  unknown: await workspace.get(unknownProblemsState),
  required: await workspace.get(requiredProblemsState),
  valueKinds: await workspace.get(valueKindProblemsState),
  relationTypes: await workspace.get(relationTypeProblemsState),
  duplicates: await workspace.get(duplicateIdProblemsState),
});

const missingRequired = (file: string, elementId: string, type: string, line?: number): Problem => ({
  code: "element.missing-required",
  severity: "warning",
  message: `Required property Verification Method (verification-method) of type ${type} has no value; LogReq changes no file`,
  repository: "system",
  file,
  ...(line === undefined ? {} : { line }),
  elementId,
});

describe("metamodel changes without rewriting element files (SR-015)", () => {
  it("[SR-015/AK1] works with a metamodel file saved by another editor within 2 seconds, without restart", async () => {
    const opened = await open();
    await watching(opened);
    const store = opened.workspace.peek(elementStoreState);
    const renamed = opened.model.replace("name: System Requirement", "name: Technical Requirement");
    const ms = await saveModel(
      opened,
      renamed,
      (m) => typeName(m, "system-requirement") === "Technical Requirement",
    );
    expect(ms).toBeLessThanOrEqual(TAKE_OVER_LIMIT_MS);
    // The same workspace object, and the element store was not read again for it.
    expect(opened.workspace.peek(elementStoreState)).toBe(store);
  });

  it("[SR-015/AK1] works with a metamodel file that an editor saved by renaming a new file over it within 2 seconds", async () => {
    const opened = await open();
    await watching(opened);
    const added = opened.model.replace(
      "\nrelations:",
      "  - { key: rationale, name: Rationale, kind: text }\n\nrelations:",
    );
    const start = performance.now();
    // As vim, JetBrains IDEs and LogReq's own atomic write save: a new file renamed over the old one.
    await opened.fixture.write("metamodel/.model.yaml.swp", added);
    await fs.rename(opened.fixture.path("metamodel/.model.yaml.swp"), opened.fixture.path(MODEL));
    const ms = await takenOver(opened.workspace, start, (m) =>
      m.properties.some((p) => p.key === "rationale"),
    );
    expect(ms).toBeLessThanOrEqual(TAKE_OVER_LIMIT_MS);
  });

  it("[SR-015/AK1] creates an element of a type that the saved metamodel added, within 2 seconds", async () => {
    const opened = await open();
    await watching(opened);
    const added = opened.model.replace(
      "\nproperties:",
      "  - { key: interface-requirement, name: Interface Requirement, prefix: IR, properties: [title], required: [title] }\n\nproperties:",
    );
    const ms = await saveModel(opened, added, (m) => typeName(m, "interface-requirement") !== undefined);
    expect(ms).toBeLessThanOrEqual(TAKE_OVER_LIMIT_MS);
    const out = (await invoke(
      "element.create",
      { type: "interface-requirement", title: "Serial port" },
      { workspace: opened.workspace },
    )) as CommandOutput<"element.create">;
    expect(out.element).toMatchObject({ type: "interface-requirement", title: "Serial port", problems: [] });
  });

  it("[SR-015/AK2] shows a renamed type under its new name and changes no element file", async () => {
    // The need carries a property its type does not have: the hint names the type.
    const opened = await open();
    await watching(opened);
    const before = { views: await views(opened), findings: await findings(opened) };
    const files = await elementFiles(opened.fixture);
    expect(before.findings["unknown"]).toEqual([
      expect.objectContaining({
        code: "element.unknown-property",
        file: NEED_FILE,
        message:
          "Property Priority (priority) is not a property of type Need (need); LogReq keeps it and its value unchanged",
      }),
    ]);

    await saveModel(
      opened,
      opened.model.replace("name: Need,", "name: Stakeholder Need,"),
      (m) => typeName(m, "need") === "Stakeholder Need",
    );
    await watchWorkspace(opened.workspace).settled();

    // Hints use the new name; the views keep type key, short IDs and versions.
    const after = { views: await views(opened), findings: await findings(opened) };
    expect(after.findings["unknown"]).toEqual([
      expect.objectContaining({
        code: "element.unknown-property",
        file: NEED_FILE,
        message:
          "Property Priority (priority) is not a property of type Stakeholder Need (need); LogReq keeps it and its value unchanged",
      }),
    ]);
    expect({ ...after.findings, unknown: [] }).toEqual({ ...before.findings, unknown: [] });
    const { [NEED]: needAfter, ...othersAfter } = after.views;
    const { [NEED]: needBefore, ...othersBefore } = before.views;
    expect(othersAfter).toEqual(othersBefore);
    expect({ ...(needAfter as object), problems: [] }).toEqual({ ...(needBefore as object), problems: [] });
    expect(await elementFiles(opened.fixture)).toEqual(files);
  });

  it("[SR-015/AK3] gives a hint for every element without a new required property and changes no file", async () => {
    const opened = await open();
    await watching(opened);
    const before = await views(opened);
    expect(await opened.workspace.get(requiredProblemsState)).toEqual([]);
    const files = await elementFiles(opened.fixture);

    await saveModel(
      opened,
      opened.model.replace(
        "required: [title]\n  - key: safety",
        "required: [title, verification-method]\n  - key: safety",
      ),
      (m) => requiredOf(m, "safety-requirement")?.includes("verification-method") === true,
    );
    await watchWorkspace(opened.workspace).settled();

    // One hint per element of the type, or of a type inheriting it, without a value: an absent
    // key has no line, an empty one the line of its key. Speed has a value; the need is another type.
    const direction = missingRequired(DIRECTION_FILE, DIRECTION, "System Requirement (system-requirement)");
    const storms = missingRequired(STORMS_FILE, STORMS, "Safety Requirement (safety-requirement)", 6);
    expect(await opened.workspace.get(requiredProblemsState)).toEqual([storms, direction]);
    const after = await views(opened);
    expect(viewOf(after, DIRECTION).problems).toEqual([direction]);
    expect(viewOf(after, STORMS).problems).toEqual([storms]);
    expect(viewOf(after, SPEED).problems).toEqual(viewOf(before, SPEED).problems);
    expect(viewOf(after, NEED).problems).toEqual(viewOf(before, NEED).problems);
    // A required property without a value adds nothing to the version (ADR-0005).
    for (const id of [NEED, SPEED, DIRECTION, STORMS]) {
      expect(viewOf(after, id).version).toBe(viewOf(before, id).version);
    }
    expect(await elementFiles(opened.fixture)).toEqual(files);
    // The workspace stays writable: a hint blocks nothing.
    const status = (await invoke(
      "workspace.status",
      {},
      { workspace: opened.workspace },
    )) as CommandOutput<"workspace.status">;
    expect(status.readOnly).toBe(false);
  });

  // The reset stands for the watcher here: that it resets the metamodel on a save is AK1's test.
  it("computes versions with the changed metamodel and changes no file (spec question #181, option 1)", async () => {
    const opened = await open();
    const before = await views(opened);
    const files = await elementFiles(opened.fixture);
    // Verification Method no longer counts to the version: Speed, the only element with a value,
    // gets a new version; the others keep theirs.
    await opened.fixture.write(MODEL, opened.model.replace("    content: true\n", ""));
    await opened.workspace.reset(metamodelState);
    const after = await views(opened);
    expect(viewOf(after, SPEED).version).not.toBe(viewOf(before, SPEED).version);
    for (const id of [NEED, DIRECTION, STORMS]) {
      expect(viewOf(after, id).version).toBe(viewOf(before, id).version);
    }
    expect(await elementFiles(opened.fixture)).toEqual(files);
  });
});
