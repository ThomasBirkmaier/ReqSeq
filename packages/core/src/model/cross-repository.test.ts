// Relations across repository boundaries (SR-005, D-058): stored with UUID, version and the
// workspace name of the target's repository only; shown with the target's title when it is local.
import fs from "node:fs/promises";
import { createFixtureWorkspace } from "@logreq/testkit";
import type { FixtureOptions, FixtureWorkspace } from "@logreq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import type { CommandName, CommandOutput } from "../catalog.js";
import { invoke } from "../runtime/invoke.js";
import { Workspace } from "../runtime/workspace.js";
import { computeVersion } from "../version/version.js";

/** The elements of fixtures/SR-005/cross-repository; `text` is the text of the file. */
const SOURCE = { id: "8f1e3d5c-7b9a-4c2e-a4f6-1a3c5e7b9d0f", file: "requirements/SR-1a3c5e7b9d0f.md" };
/** In the repository with the workspace name `platform`, checked out in the folder `platform-checkout`. */
const NEED = {
  id: "4c1d9e7a-8b2f-4a3c-9d5e-6f7a8b9c0d1e",
  title: "Gusts stand out",
  text: "Gusts are easy to tell from steady wind.",
};
const PKG = {
  id: "7e3a5c9b-1d2f-4e6a-8b0c-2d4e6f8a0b1c",
  title: "Platform 2.0",
  text: "The second platform release.",
};
const VAR = {
  id: "2b8d4f6a-0c1e-4a3b-9c5d-7e9f1a3b5c7d",
  title: "Coastal",
  text: "The variant for stations at the coast.",
};
/** The version of NEED stored in the source file; not the current one. */
const STORED_NEED = "n1:1111111111111111";
const SHARED = "d3c2b1a0-9f8e-4d7c-8b6a-5f4e3d2c1b0a";
const SYSTEM_ONLY = "e1f2a3b4-c5d6-4e7f-8a9b-0c1d2e3f4a5b";

/** The current version of a fixture element, computed from its text alone (no property counts). */
const versionOf = (element: { readonly text: string }): string =>
  computeVersion({ text: element.text, properties: {}, definitions: [], files: [] });

interface Opened {
  readonly fixture: FixtureWorkspace;
  readonly workspace: Workspace;
}

const open = async (files: FixtureOptions["files"] = {}, before?: (f: FixtureWorkspace) => Promise<void>) => {
  const fixture = await createFixtureWorkspace({ fixture: "SR-005/cross-repository", files });
  onTestFinished(() => fixture.cleanup());
  await before?.(fixture);
  const workspace = new Workspace(fixture.path("system"));
  onTestFinished(() => workspace.close());
  return { fixture, workspace } satisfies Opened;
};

const run = async <N extends CommandName>(
  opened: Opened,
  name: N,
  input: Record<string, unknown>,
): Promise<CommandOutput<N>> =>
  (await invoke(name, input, { workspace: opened.workspace })) as CommandOutput<N>;

const read = (opened: Opened, file: string): Promise<string> =>
  fs.readFile(opened.fixture.path(`system/${file}`), "utf8");

/** An element file with only id, type, status and title. */
const element = (id: string, type: string, title: string): string =>
  `---\nid: ${id}\ntype: ${type}\nstatus: draft\ntitle: ${title}\n---\n`;

/** The source file of the fixture with other `derives-from` targets. */
const sourceDerivingFrom = (...targets: string[]): string =>
  [
    "---",
    `id: ${SOURCE.id}`,
    "type: system-requirement",
    "status: draft",
    "title: Show gusts in red",
    "requirement-type: functional",
    "acceptance-criteria:",
    "  - Given a gust, when it is measured, then the display shows it in red.",
    "derives-from:",
    ...targets.map((t) => `  - ${t}`),
    "---",
    "",
    "The display shows gusts in red.",
    "",
  ].join("\n");

/** The relations of the source as `element.update` shows them after a change of its text. */
const relationsOfSource = async (opened: Opened): Promise<unknown> =>
  (await run(opened, "element.update", { ref: SOURCE.id, text: "The display shows gusts in bright red.\n" }))
    .element.relations;

describe("relations across repositories (SR-005)", () => {
  it("[SR-005/AK1] element.create stores a target in another repository with UUID, version and the workspace name of its repository only", async () => {
    const opened = await open();
    const out = await run(opened, "element.create", {
      type: "system-requirement",
      title: "Show the coastal release",
      // The caller sends a title and an old version: neither is stored across repositories.
      properties: {
        packages: [{ id: PKG.id, repository: "platform", version: STORED_NEED, title: "Smuggled title" }],
        validity: [{ id: VAR.id, repository: "platform" }],
      },
    });
    const file = await read(opened, out.element.file);
    expect(file).toContain(
      `packages:\n  - { id: ${PKG.id}, version: ${versionOf(PKG)}, repository: platform }\n`,
    );
    expect(file).toContain(
      `validity:\n  - { id: ${VAR.id}, version: ${versionOf(VAR)}, repository: platform }\n`,
    );
    // No title or text of a target, no title of the caller, and the repository's workspace name,
    // not the folder it is checked out in.
    for (const content of [PKG.title, PKG.text, VAR.title, VAR.text, "Smuggled title", "platform-checkout"]) {
      expect(file).not.toContain(content);
    }
    expect(out.element.properties["packages"]).toEqual([
      { id: PKG.id, version: versionOf(PKG), repository: "platform" },
    ]);
  });

  it("[SR-005/AK1] element.update adds a target in another repository without title or text", async () => {
    const opened = await open();
    const before = await read(opened, SOURCE.file);
    await run(opened, "element.update", {
      ref: SOURCE.id,
      set: { validity: [{ id: VAR.id, repository: "platform" }] },
    });
    const after = await read(opened, SOURCE.file);
    expect(after.split("\n").filter((l) => !before.split("\n").includes(l))).toEqual([
      "validity:",
      `  - { id: ${VAR.id}, version: ${versionOf(VAR)}, repository: platform }`,
    ]);
  });

  it("[SR-005/AK2] shows the title of a relation target in another repository that is available locally", async () => {
    const opened = await open();
    expect(await relationsOfSource(opened)).toEqual([
      {
        kind: "derives-from",
        meaning: "derivation",
        direction: "out",
        id: NEED.id,
        shortId: "N-9c0d1e",
        title: NEED.title,
        accessible: true,
        storedVersion: STORED_NEED,
      },
    ]);
  });

  it("[SR-005/AK2] looks a relation target up in the repository it names", async () => {
    const opened = await open({
      "system/needs/N-5f4e3d2c1b0a.md": element(SHARED, "need", "System copy"),
      "platform-checkout/needs/N-5f4e3d2c1b0a.md": element(SHARED, "need", "Platform copy"),
      "system/needs/N-0c1d2e3f4a5b.md": element(SYSTEM_ONLY, "need", "Only in system"),
      [`system/${SOURCE.file}`]: sourceDerivingFrom(
        `{ id: ${SHARED}, version: ${STORED_NEED}, repository: platform }`,
        `{ id: ${SHARED}, version: ${STORED_NEED} }`,
        // Named in the wrong repository, or in none while it lies in another one: not found there.
        `{ id: ${SYSTEM_ONLY}, version: ${STORED_NEED}, repository: platform }`,
        `{ id: ${NEED.id}, version: ${STORED_NEED} }`,
      ),
    });
    const relations = (await relationsOfSource(opened)) as readonly Record<string, unknown>[];
    // A target not found where the relation points shows neither title nor short ID; how a missing
    // target is marked (`accessible`, a target state) is SR-006 (#18) and SR-089.
    expect(relations.map((r) => [r["id"], r["title"], "shortId" in r])).toEqual([
      [SHARED, "Platform copy", true],
      [SHARED, "System copy", true],
      [SYSTEM_ONLY, undefined, false],
      [NEED.id, undefined, false],
    ]);
  });

  it("shows a target whose repository is not on this machine without title and goes on working", async () => {
    const opened = await open({}, (f) => fs.rm(f.path("platform-checkout"), { recursive: true }));
    const [relation, ...rest] = (await relationsOfSource(opened)) as readonly Record<string, unknown>[];
    expect(rest).toEqual([]);
    expect(relation).toMatchObject({ kind: "derives-from", id: NEED.id, storedVersion: STORED_NEED });
    // SR-006 (#18) refines how a target in a missing repository is shown (short ID, not accessible).
    expect(relation).not.toHaveProperty("title");
    expect(relation).not.toHaveProperty("shortId");
  });

  it("shows a target whose repository is not text as not accessible", async () => {
    const opened = await open({
      [`system/${SOURCE.file}`]: sourceDerivingFrom(
        `{ id: ${NEED.id}, version: ${STORED_NEED}, repository: 7 }`,
      ),
    });
    expect(await relationsOfSource(opened)).toEqual([
      {
        kind: "derives-from",
        meaning: "derivation",
        direction: "out",
        id: NEED.id,
        accessible: false,
        storedVersion: STORED_NEED,
      },
    ]);
  });
});
