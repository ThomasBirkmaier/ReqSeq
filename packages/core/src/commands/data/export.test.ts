// data.export through `invoke` (SR-061, SR-101) on fixtures/SR-061/export: the workspace `system/`
// with the repositories `system` and `sensor`, the standard model, records in Markdown and JUnit, a
// saved filter and baselines (the fixture's README lists the elements, versions and the expected
// selections). The same output on every access: cross-access.test.ts; the CLI end to end:
// packages/cli/test/e2e/data-export.test.ts.
import { readFile, rm } from "node:fs/promises";
import { createFixtureWorkspace } from "@reqseq/testkit";
import type { FixtureWorkspace } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import { parse } from "yaml";
import type { CommandOutput } from "../../catalog.js";
import { CommandError } from "../../catalog.js";
import { verificationState } from "../../evidence/index.js";
import { elementStoreState } from "../../model/index.js";
import { fileSchemaValidator } from "../../runtime/contracts.js";
import { invoke } from "../../runtime/invoke.js";
import { Workspace } from "../../runtime/workspace.js";

type Output = CommandOutput<"data.export">;
type Element = Output["elements"][number];

const P = "61061061-0000-4000-8000-0000000000";
const ID = {
  a1: `${P}a1`,
  b1: `${P}b1`,
  b2: `${P}b2`,
  b3: `${P}b3`,
  b4: `${P}b4`,
  c1: `${P}c1`,
  c2: `${P}c2`,
  d1: `${P}d1`,
  e1: `${P}e1`,
} as const;
type Name = keyof typeof ID;
const NAME = new Map<string, Name>((Object.entries(ID) as [Name, string][]).map(([name, id]) => [id, name]));
/** The current versions (the fixture's README). */
const VERSION = {
  a1: "n1:c2b89c0554cf891b",
  b1: "n1:d7089e63fea26191",
  b2: "n1:46f520a356e92a87",
  b4: "n1:4e09d2361f4d1948",
} as const;
const OLD = "n1:0000000000000000";
/** Store order: system (needs, packages, requirements, variants), then sensor. */
const ALL: readonly Name[] = ["a1", "d1", "b1", "b2", "b3", "b4", "c1", "c2", "e1"];

const fixture = async (): Promise<FixtureWorkspace> => {
  const created = await createFixtureWorkspace({ fixture: "SR-061/export", git: ["system", "sensor"] });
  onTestFinished(() => created.cleanup());
  return created;
};

const open = (ws: FixtureWorkspace): Workspace => {
  const workspace = new Workspace(ws.path("system"));
  onTestFinished(() => workspace.close());
  return workspace;
};

const exportOf = async (
  workspace: Workspace,
  input: Readonly<Record<string, unknown>> = {},
): Promise<Output> => (await invoke("data.export", input, { workspace })) as Output;

const names = (out: Output): (string | undefined)[] => out.elements.map((e) => NAME.get(e.id) ?? e.id);

const element = (out: Output, name: Name): Element => {
  const found = out.elements.find((e) => e.id === ID[name]);
  if (found === undefined) {
    throw new Error(`${name} is not exported`);
  }
  return found;
};

const failure = async (
  workspace: Workspace,
  input: Readonly<Record<string, unknown>>,
): Promise<CommandError> => {
  const error = await exportOf(workspace, input).catch((e: unknown) => e);
  expect(error).toBeInstanceOf(CommandError);
  return error as CommandError;
};

describe("data.export: every element of a workspace (SR-061 AK1)", () => {
  it("[SR-061/AK1] gives every element of both repositories with its properties, relations, version, verification status and validity", async () => {
    const workspace = open(await fixture());
    const out = await exportOf(workspace);
    expect(out["logreq-data"]).toBe(2);
    expect(out.workspace).toBe("Weather station");
    expect(names(out)).toEqual(ALL);
    const b1 = element(out, "b1");
    expect(b1).toMatchObject({
      shortId: "SR-0000b1",
      type: "system-requirement",
      status: "draft",
      title: "Show the wind speed",
      version: VERSION.b1,
      repository: "system",
      file: "requirements/SR-0000000000b1.md",
      validity: [ID.c1],
      packages: [ID.d1],
      verification: [{ view: ID.c1, status: "verified" }],
    });
    // Unknown properties are kept (SR-016).
    expect(b1.properties).toMatchObject({ "requirement-type": "functional", "x-supplier": "Anemo Ltd" });
    expect(b1.relations.find((r) => r.kind === "derives-from")).toEqual({
      kind: "derives-from",
      meaning: "derivation",
      direction: "out",
      id: ID.a1,
      repository: "system",
      shortId: "N-0000a1",
      title: "Know the wind",
      accessible: true,
      targetState: "available",
      storedVersion: VERSION.a1,
      currentVersion: VERSION.a1,
      outdated: false,
    });
    // The version is that of element.get.
    const got = (await invoke(
      "element.get",
      { ref: "SR-0000b1" },
      { workspace },
    )) as CommandOutput<"element.get">;
    expect(b1.version).toBe(got.element.version);
    // The core and every variant for a requirement without validity (SR-047 AK3).
    expect(element(out, "b2")).toMatchObject({
      validity: [],
      packages: [ID.d1],
      verification: [
        { view: "core", status: "failed" },
        { view: ID.c1, status: "open" },
        { view: ID.c2, status: "open" },
      ],
    });
    // Across repositories (SR-005): SR-0000e1 in `sensor` derives from SR-0000b1 in `system`.
    expect(element(out, "e1")).toMatchObject({
      repository: "sensor",
      relations: [
        {
          kind: "derives-from",
          id: ID.b1,
          repository: "system",
          targetState: "available",
          currentVersion: VERSION.b1,
          outdated: false,
        },
      ],
    });
    // A need has no verification, but its validation status (SR-038); a variant no validity of its own.
    expect(element(out, "a1")).not.toHaveProperty("verification");
    expect(element(out, "a1").validation).toBe("validated");
    expect(element(out, "c1")).toMatchObject({ validity: [], packages: [] });
  });

  it("[SR-061/AK1] gives the same verification and validation status per element as evidence.status", async () => {
    const workspace = open(await fixture());
    const out = await exportOf(workspace);
    const status = (await invoke(
      "evidence.status",
      { limit: 5000 },
      { workspace },
    )) as CommandOutput<"evidence.status">;
    expect(out.elements.map((e) => [e.id, e.verification, e.validation])).toEqual(
      status.elements.map((e) => [e.id, e.verification, e.validation]),
    );
  });

  it("[SR-061/AK1] marks a relation whose stored version is older than its target as outdated", async () => {
    const workspace = open(await fixture());
    const outdated = {
      kind: "derives-from",
      id: ID.a1,
      storedVersion: OLD,
      currentVersion: VERSION.a1,
      outdated: true,
    };
    expect(element(await exportOf(workspace), "b2").relations).toContainEqual(
      expect.objectContaining(outdated),
    );
    // Also when the target is outside the selection.
    const alone = await exportOf(workspace, { selection: { ids: ["SR-0000b2"] } });
    expect(names(alone)).toEqual(["b2"]);
    expect(element(alone, "b2").relations).toContainEqual(expect.objectContaining(outdated));
    // The successor's relation to a superseded element is measured against that element (SR-072 AK3).
    expect(element(await exportOf(workspace), "b4").relations).toEqual([
      expect.objectContaining({
        kind: "supersedes",
        direction: "in",
        id: ID.b2,
        storedVersion: VERSION.b4,
        currentVersion: VERSION.b4,
        outdated: false,
      }),
    ]);
  });

  it("[SR-061/AK1] names each repository with its commit and is complete when every repository is here", async () => {
    const ws = await fixture();
    const out = await exportOf(open(ws));
    expect(out.repositories).toEqual([
      { name: "system", available: true, commit: await ws.head("system"), dirty: false },
      { name: "sensor", available: true, commit: await ws.head("sensor"), dirty: false },
    ]);
    expect(out.incomplete).toBe(false);
  });

  it("gives dirty: true for a repository whose element files differ from its commit, and no dirty without a commit (SR-062)", async () => {
    const ws = await fixture();
    await ws.write(
      "sensor/requirements/SR-0000000000e1.md",
      (await readFile(ws.path("sensor/requirements/SR-0000000000e1.md"), "utf8")).replace(
        "quality",
        "functional",
      ),
    );
    const out = await exportOf(open(ws));
    expect(out.repositories.map((r) => [r.name, r.dirty])).toEqual([
      ["system", false],
      ["sensor", true],
    ]);
    const plain = await createFixtureWorkspace({ fixture: "SR-061/export" });
    onTestFinished(() => plain.cleanup());
    const without = await exportOf(open(plain));
    expect(without.repositories).toEqual([
      { name: "system", available: true },
      { name: "sensor", available: true },
    ]);
  });

  it("[SR-006/AK2] marks the export incomplete when a repository of the workspace is not on this machine", async () => {
    const ws = await fixture();
    await rm(ws.path("sensor"), { recursive: true });
    const out = await exportOf(open(ws));
    expect(out.incomplete).toBe(true);
    expect(out.repositories).toEqual([
      { name: "system", available: true, commit: await ws.head("system"), dirty: false },
      { name: "sensor", available: false },
    ]);
    // What is on this machine is exported; SR-0000b1's child in `sensor` is not.
    expect(names(out)).toEqual(ALL.filter((n) => n !== "e1"));
  });

  it("gives the time of the call and the selection as given", async () => {
    const workspace = open(await fixture());
    const start = Math.floor(Date.now() / 1000) * 1000;
    const out = await exportOf(workspace, { selection: { package: "pkg-0000d1" } });
    const end = Date.now();
    expect(out.generated).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
    expect(Date.parse(out.generated)).toBeGreaterThanOrEqual(start);
    expect(Date.parse(out.generated)).toBeLessThanOrEqual(end);
    expect(out.selection).toEqual({ package: "pkg-0000d1" });
    expect(await exportOf(workspace)).not.toHaveProperty("selection");
  });

  it("lists an element whose file no longer holds it with its problem, and the superseded one", async () => {
    const ws = await fixture();
    const workspace = open(ws);
    // The store is read, then SR-0000b3's file goes: the store still has it.
    await workspace.get(elementStoreState);
    await rm(ws.path("system/requirements/SR-0000000000b3.md"));
    const out = await exportOf(workspace);
    const b3 = element(out, "b3");
    expect(b3).not.toHaveProperty("version");
    expect(b3.problems?.map((p) => [p.code, p.severity])).toEqual([["file.faulty", "warning"]]);
    expect(element(out, "b4").status).toBe("obsolete");
  });

  it("reads the versions for the status in one batch and no other version for a whole workspace", async () => {
    const workspace = open(await fixture());
    await exportOf(workspace);
    const status = await workspace.get(verificationState);
    expect(status.versionBatches()).toBeLessThanOrEqual(1);
  });

  it("exports a workspace whose metamodel is not valid: every requirement open, nothing at the top", async () => {
    const ws = await fixture();
    await ws.write("system/metamodel/standard-model.yaml", "logreq-metamodel: 1\ntypes: [}\n");
    const out = await exportOf(open(ws));
    expect(out.incomplete).toBe(false);
    expect(Object.keys(out)).toEqual([
      "logreq-data",
      "commit",
      "dirty",
      "workspace",
      "generated",
      "repositories",
      "incomplete",
      "elements",
    ]);
    expect(out.elements.length).toBe(ALL.length);
    expect(out.elements.flatMap((e) => e.verification ?? [])).toEqual([]);
  });
});

describe("data.export: only the selection (SR-061 AK2, SR-101)", () => {
  it("[SR-061/AK2] a saved filter gives only its elements", async () => {
    const workspace = open(await fixture());
    expect(names(await exportOf(workspace, { selection: { filter: "Functional" } }))).toEqual([
      "b1",
      "b3",
      "b4",
    ]);
  });

  it("[SR-061/AK2] a package gives only the elements of the package", async () => {
    const workspace = open(await fixture());
    expect(names(await exportOf(workspace, { selection: { package: "PKG-0000d1" } }))).toEqual(["b1", "b2"]);
  });

  it("[SR-101/AK1] data.export processes exactly the elements of package P", async () => {
    const workspace = open(await fixture());
    const out = await exportOf(workspace, { selection: { package: "PKG-0000d1" } });
    expect(out.elements.map((e) => e.packages)).toEqual([[ID.d1], [ID.d1]]);
    expect(names(out)).toEqual(["b1", "b2"]);
  });

  it("[SR-061/AK2] a baseline gives only the elements it lists, by name and by file", async () => {
    const workspace = open(await fixture());
    for (const baseline of ["Release 1", "release 1", "release-1", "release-1.yaml"]) {
      const out = await exportOf(workspace, { selection: { baseline } });
      // SR-0000b3 is listed with an older version: it is exported as it is now; the unknown UUID is left out.
      expect([baseline, names(out)]).toEqual([baseline, ["a1", "b1", "b3"]]);
      expect(out.selection).toEqual({ baseline });
    }
  });

  it("[SR-061/AK2] a variant view gives only the elements valid in it", async () => {
    const workspace = open(await fixture());
    const out = await exportOf(workspace, { selection: { view: "VAR-0000c1" } });
    expect(names(out)).toEqual(ALL.filter((n) => n !== "b3"));
    // Each element still carries its status in the core and in every variant it applies in (A2).
    expect(element(out, "b2").verification?.map((v) => v.view)).toEqual(["core", ID.c1, ID.c2]);
  });

  it("[SR-101/AK2] a saved filter and a variant together give only the elements meeting both", async () => {
    const workspace = open(await fixture());
    const out = await exportOf(workspace, { selection: { filter: "Functional", view: "VAR-0000c1" } });
    expect(names(out)).toEqual(["b1", "b4"]);
  });

  it("refuses a baseline that is not there, faulty or named by two files", async () => {
    const ws = await fixture();
    const workspace = open(ws);
    const unknown = await failure(workspace, { selection: { baseline: "Release 2" } });
    expect([unknown.code, unknown.details?.["fields"]]).toEqual(["input.invalid", ["selection.baseline"]]);
    expect(unknown.message).toContain("Release 2");
    const faulty = await failure(workspace, { selection: { baseline: "broken" } });
    expect([faulty.code, faulty.details?.["files"]]).toEqual(["file.faulty", ["baselines/broken.yaml"]]);
    await ws.write(
      "system/baselines/copy.yaml",
      "logreq-baseline: 1\nname: Release 1\ndate: 2026-10-24T09:00:00Z\n" +
        "repositories:\n  - { name: system, commit: 61aa061aa061aa061aa061aa061aa061aa061aa0 }\nelements: []\n",
    );
    const twice = await failure(workspace, { selection: { baseline: "Release 1" } });
    expect([twice.code, twice.details?.["fields"]]).toEqual(["input.invalid", ["selection.baseline"]]);
    expect(twice.message).toContain("baselines/copy.yaml");
    // By its file, each one is still found.
    expect(names(await exportOf(workspace, { selection: { baseline: "copy" } }))).toEqual([]);
  });
});

describe("data.export: the documented schema (SR-061 AK3)", () => {
  it("[SR-061/AK3] the export of the fixture matches the shipped data-export.schema.json", async () => {
    const workspace = open(await fixture());
    const validate = fileSchemaValidator("data-export.schema.json");
    for (const input of [{}, { selection: { baseline: "Release 1" } }]) {
      const out = await exportOf(workspace, input);
      expect([input, validate(out), validate.errors ?? null]).toEqual([input, true, null]);
    }
  });

  it("gives what the schema example of a package selection shows, but for the time and the commits", async () => {
    const ws = await fixture();
    const example = parse(
      await readFile(
        new URL("../../../../../schemas/examples/data-export/export-package.yaml", import.meta.url),
        "utf8",
      ),
    ) as Output;
    const out = await exportOf(open(ws), { selection: { package: "PKG-0000d1" } });
    expect(out.repositories.map((r) => [r.name, r.available, typeof r.commit])).toEqual([
      ["system", true, "string"],
      ["sensor", true, "string"],
    ]);
    expect(out.commit).toBe(out.repositories[0]?.commit);
    expect({
      ...out,
      commit: example.commit,
      generated: example.generated,
      repositories: example.repositories,
    }).toEqual(example);
  });
});
