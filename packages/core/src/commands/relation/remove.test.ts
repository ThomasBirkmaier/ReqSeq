import fs from "node:fs/promises";
import { createFixtureWorkspace } from "@reqseq/testkit";
import type { FixtureOptions, FixtureWorkspace } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import type { CommandOutput } from "../../catalog.js";
import { CommandError } from "../../catalog.js";
import { elementStoreState } from "../../model/index.js";
import { invoke } from "../../runtime/invoke.js";
import { Workspace } from "../../runtime/workspace.js";

type Output = CommandOutput<"relation.remove">;

const V = "n1:1111111111111111";
/** fixtures/SR-001/two-elements: WIND, and GUSTS (written by hand), which derives from WIND. */
const WIND = { id: "e8df96ea-a168-4d90-8d65-6328cee88fb3", file: "requirements/SR-6328cee88fb3.md" };
const GUSTS = { id: "3f2a9c1e-5b7d-4e8a-9c0b-1d2e3f4a5b6c", file: "requirements/SR-1d2e3f4a5b6c.md" };
const NEED = { id: "0b7c6e1a-1111-4222-8333-aaaaaaaaaaa1", file: "needs/N-aaaaaaaaaaa1.md" };
const GADGET = { id: "0b7c6e1a-1111-4222-8333-eeeeeeeeeee1", file: "requirements/X-eeeeeeeeeee1.md" };
/** No element has this UUID (SR-089). */
const GONE = "0b7c6e1a-1111-4222-8333-ffffffffffff";

const element = (id: string, type: string, title: string, extra = ""): string =>
  `---\nid: ${id}\ntype: ${type}\nstatus: draft\ntitle: ${title}\n${extra}---\n\nText.\n`;

/** A need that derives from WIND (not allowed, SR-086), refines GUSTS and a target that is gone. */
const NEED_FILE = element(
  NEED.id,
  "need",
  "Need one",
  [
    "refines:",
    `  - { id: ${GUSTS.id}, version: ${V} } # first`,
    `  - { id: ${GONE}, version: ${V} }`,
    `  - { id: ${GUSTS.id}, version: ${V} } # twice`,
    "derives-from:",
    `  - { id: ${WIND.id}, version: ${V} }`,
    "",
  ].join("\n"),
);

const TWO: FixtureOptions = {
  fixture: "SR-001/two-elements",
  files: {
    [NEED.file]: NEED_FILE,
    [GADGET.file]: element(
      GADGET.id,
      "gadget",
      "Gadget",
      `refines:\n  - { id: ${WIND.id}, version: ${V} }\n`,
    ),
  },
};

interface Opened {
  readonly fixture: FixtureWorkspace;
  readonly workspace: Workspace;
}

const open = async (options: FixtureOptions = TWO, root = ""): Promise<Opened> => {
  const fixture = await createFixtureWorkspace(options);
  onTestFinished(() => fixture.cleanup());
  const workspace = new Workspace(root === "" ? fixture.root : fixture.path(root));
  onTestFinished(() => workspace.close());
  return { fixture, workspace };
};

const remove = async (opened: Opened, input: Record<string, unknown>): Promise<Output> =>
  (await invoke("relation.remove", input, { workspace: opened.workspace })) as Output;

const removeError = async (opened: Opened, input: Record<string, unknown>): Promise<CommandError> => {
  try {
    await remove(opened, input);
  } catch (error) {
    if (error instanceof CommandError) {
      return error;
    }
    throw error;
  }
  throw new Error("expected relation.remove to fail");
};

const read = (opened: Opened, file: string): Promise<string> =>
  fs.readFile(opened.fixture.path(file), "utf8");

describe("relation.remove removes a relation from the source file only (D-045, SR-102)", () => {
  it("[SR-102/AK1] removes the relation's lines and the key with its last item; the target and its file stay", async () => {
    const opened = await open();
    const [before, target] = [await read(opened, GUSTS.file), await read(opened, WIND.file)];
    const out = await remove(opened, { source: GUSTS.id, kind: "derives-from", target: "SR-e88fb3" });
    expect(out).toEqual({ files: [GUSTS.file], problems: [] });
    expect(await read(opened, GUSTS.file)).toBe(
      before.replace(
        `derives-from:\n  - { id: ${WIND.id}, version: n1:0000000000000000, title: Show wind speed }\n`,
        "",
      ),
    );
    expect(await read(opened, WIND.file)).toBe(target);
    const store = await opened.workspace.get(elementStoreState);
    expect(store.byId.get(WIND.id)?.length).toBe(1);
    expect(store.byId.get(GUSTS.id)?.map((r) => r.data["derives-from"])).toEqual([undefined]);
  });

  it("[SR-102/AK1] removes every item naming the target and keeps the others with their comments", async () => {
    const opened = await open();
    const out = await remove(opened, { source: "N-aaaaa1", kind: "refines", target: GUSTS.id });
    expect(out.files).toEqual([NEED.file]);
    expect(await read(opened, NEED.file)).toBe(
      NEED_FILE.replace(`  - { id: ${GUSTS.id}, version: ${V} } # first\n`, "").replace(
        `  - { id: ${GUSTS.id}, version: ${V} } # twice\n`,
        "",
      ),
    );
  });

  it("removes a relation to a target that is gone, by its UUID, and one the metamodel does not allow", async () => {
    const opened = await open();
    expect((await remove(opened, { source: NEED.id, kind: "refines", target: GONE })).files).toEqual([
      NEED.file,
    ]);
    expect(await read(opened, NEED.file)).not.toContain(GONE);
    expect((await remove(opened, { source: NEED.id, kind: "derives-from", target: WIND.id })).files).toEqual([
      NEED.file,
    ]);
    expect(await read(opened, NEED.file)).not.toContain("derives-from");
  });

  it("writes nothing and says so when the source has no such relation", async () => {
    const opened = await open();
    const before = await read(opened, WIND.file);
    expect(await remove(opened, { source: WIND.id, kind: "derives-from", target: GUSTS.id })).toEqual({
      files: [],
      problems: [
        {
          code: "relation.not-found",
          severity: "info",
          message: `System Requirement SR-e88fb3 has no relation Derives from (derives-from) to ${GUSTS.id}; nothing removed`,
          repository: "system",
          file: WIND.file,
          elementId: WIND.id,
          elementShortId: "SR-e88fb3",
          targetId: GUSTS.id,
        },
      ],
    });
    const [problem] =
      (await remove(opened, { source: GUSTS.id, kind: "refines", target: "SR-e88fb3" })).problems ?? [];
    expect([problem?.code, problem?.message, problem?.targetId]).toEqual([
      "relation.not-found",
      "System Requirement SR-4a5b6c has no relation Refines (refines) to SR-e88fb3; nothing removed",
      WIND.id,
    ]);
    expect(await read(opened, WIND.file)).toBe(before);
  });

  it("refuses an unknown kind, a property, an unknown or read-only source and a value that is no list", async () => {
    const opened = await open({
      ...TWO,
      files: {
        ...TWO.files,
        [WIND.file]: element(
          WIND.id,
          "system-requirement",
          "Show wind speed",
          `refines: { id: ${GUSTS.id} }\n`,
        ),
      },
    });
    const kind = await removeError(opened, { source: GUSTS.id, kind: "nope", target: WIND.id });
    expect([kind.code, (kind.details as { reason: string }).reason]).toEqual([
      "input.invalid",
      "unknown-relation",
    ]);
    const property = await removeError(opened, { source: GUSTS.id, kind: "validity", target: WIND.id });
    expect([property.code, property.details]).toEqual([
      "input.invalid",
      { kind: "validity", reason: "property" },
    ]);
    expect((await removeError(opened, { source: "SR-ffffff", kind: "refines", target: WIND.id })).code).toBe(
      "ref.unknown",
    );
    expect((await removeError(opened, { source: GUSTS.id, kind: "refines", target: "SR-ffffff" })).code).toBe(
      "ref.unknown",
    );
    expect((await removeError(opened, { source: GADGET.id, kind: "refines", target: WIND.id })).code).toBe(
      "element.read-only",
    );
    const notList = await removeError(opened, { source: WIND.id, kind: "refines", target: GUSTS.id });
    expect([notList.code, notList.details]).toEqual([
      "input.invalid",
      { kind: "refines", file: WIND.file, reason: "not-a-list" },
    ]);
  });

  it("asks for the short ID when a UUID names relations into several repositories", async () => {
    const SR = "requirements/SR-3d8b2c6e1f05.md";
    const SENSOR_NEED = "a7f3c1e9-5b2d-4e8f-b6a4-0e9d7c5b3a21";
    const fixture: FixtureOptions = { fixture: "SR-021/targets" };
    const opened = await open(fixture, "system");
    const before = await fs.readFile(opened.fixture.path(`system/${SR}`), "utf8");
    const twice = before.replace(
      "\n---\n\nThe display",
      `\nrefines:\n  - { id: ${SENSOR_NEED}, version: ${V}, repository: sensor }\n  - { id: ${SENSOR_NEED}, version: ${V} }\n---\n\nThe display`,
    );
    await opened.fixture.write(`system/${SR}`, twice);
    const source = "6e2f8a4c-1b3d-4c5e-9f7a-3d8b2c6e1f05";
    const error = await removeError(opened, { source, kind: "refines", target: SENSOR_NEED });
    expect([error.code, error.details]).toEqual([
      "ref.ambiguous",
      { ref: SENSOR_NEED, repositories: ["sensor", "system"] },
    ]);
    // The short ID names the need in `sensor`, so only the relation into `sensor` goes.
    const out = await remove(opened, { source, kind: "refines", target: "N-5b3a21" });
    expect(out.files).toEqual([SR]);
    expect(await fs.readFile(opened.fixture.path(`system/${SR}`), "utf8")).toBe(
      twice.replace(`  - { id: ${SENSOR_NEED}, version: ${V}, repository: sensor }\n`, ""),
    );
  });

  it("removes only the relations into the repository given, also the one to a target that is gone", async () => {
    const SR = "requirements/SR-3d8b2c6e1f05.md";
    const SENSOR_NEED = "a7f3c1e9-5b2d-4e8f-b6a4-0e9d7c5b3a21";
    const source = "6e2f8a4c-1b3d-4c5e-9f7a-3d8b2c6e1f05";
    const opened = await open({ fixture: "SR-021/targets" }, "system");
    const before = await fs.readFile(opened.fixture.path(`system/${SR}`), "utf8");
    // Into sensor, where the need is, and into system (no repository), where no element has the UUID.
    const sensorItem = `  - { id: ${SENSOR_NEED}, version: ${V}, repository: sensor }\n`;
    const systemItem = `  - { id: ${SENSOR_NEED}, version: ${V} }\n`;
    const twice = before.replace(
      "\n---\n\nThe display",
      `\nrefines:\n${sensorItem}${systemItem}---\n\nThe display`,
    );
    await opened.fixture.write(`system/${SR}`, twice);
    const error = await removeError(opened, { source, kind: "refines", target: SENSOR_NEED });
    expect(error.message).toContain("give the short ID of the target or repository");
    const out = await remove(opened, { source, kind: "refines", target: SENSOR_NEED, repository: "system" });
    expect(out).toEqual({ files: [SR], problems: [] });
    expect(await fs.readFile(opened.fixture.path(`system/${SR}`), "utf8")).toBe(
      twice.replace(systemItem, ""),
    );
    // A short ID names its element's repository; another one is refused.
    const mismatch = await removeError(opened, {
      source,
      kind: "refines",
      target: "N-5b3a21",
      repository: "system",
    });
    expect([mismatch.code, mismatch.details]).toEqual([
      "input.invalid",
      { ref: "N-5b3a21", repository: "system", reason: "repository-mismatch" },
    ]);
    // With its own repository it is the same as without.
    expect(
      (await remove(opened, { source, kind: "refines", target: "N-5b3a21", repository: "sensor" })).files,
    ).toEqual([SR]);
    expect(await fs.readFile(opened.fixture.path(`system/${SR}`), "utf8")).toBe(before);
  });

  it("asks which one when a repository the UUID points into is not here or not in the workspace file", async () => {
    const SR = "requirements/SR-3d8b2c6e1f05.md";
    const source = "6e2f8a4c-1b3d-4c5e-9f7a-3d8b2c6e1f05";
    const opened = await open({ fixture: "SR-021/targets" }, "system");
    const layout = await fs.readFile(opened.fixture.path("system/logreq-workspace.yaml"), "utf8");
    // `away` is listed but not on this machine; it may hold the element.
    await opened.fixture.write(
      "system/logreq-workspace.yaml",
      layout.replace(
        '  - { name: sensor, url: "git@git.example.com:ws/sensor.git" }\n',
        '  - { name: sensor, url: "git@git.example.com:ws/sensor.git" }\n  - { name: away, url: "git@git.example.com:ws/away.git" }\n',
      ),
    );
    const before = await fs.readFile(opened.fixture.path(`system/${SR}`), "utf8");
    const withItems = async (repository: string): Promise<string> => {
      const text = before.replace(
        "\n---\n\nThe display",
        `\nrefines:\n  - { id: ${GONE}, version: ${V}, repository: ${repository} }\n  - { id: ${GONE}, version: ${V} }\n---\n\nThe display`,
      );
      await opened.fixture.write(`system/${SR}`, text);
      await opened.workspace.reset(elementStoreState);
      return text;
    };
    for (const repository of ["away", "nowhere"]) {
      await withItems(repository);
      const error = await removeError(opened, { source, kind: "refines", target: GONE });
      expect([repository, error.code, error.details]).toEqual([
        repository,
        "ref.ambiguous",
        { ref: GONE, repositories: [repository, "system"] },
      ]);
    }
    const text = await withItems("away");
    expect(await remove(opened, { source, kind: "refines", target: GONE, repository: "away" })).toEqual({
      files: [SR],
      problems: [],
    });
    expect(await fs.readFile(opened.fixture.path(`system/${SR}`), "utf8")).toBe(
      text.replace(`  - { id: ${GONE}, version: ${V}, repository: away }\n`, ""),
    );
  });

  it("removes items with one UUID into several repositories when no element has it in any of them", async () => {
    const SR = "requirements/SR-3d8b2c6e1f05.md";
    const source = "6e2f8a4c-1b3d-4c5e-9f7a-3d8b2c6e1f05";
    const opened = await open({ fixture: "SR-021/targets" }, "system");
    const before = await fs.readFile(opened.fixture.path(`system/${SR}`), "utf8");
    const twice = before.replace(
      "\n---\n\nThe display",
      `\nrefines:\n  - { id: ${GONE}, version: ${V}, repository: sensor }\n  - { id: ${GONE}, version: ${V} }\n---\n\nThe display`,
    );
    await opened.fixture.write(`system/${SR}`, twice);
    // No short ID names a target that is gone, so the UUID is the only way to name it.
    const out = await remove(opened, { source, kind: "refines", target: GONE });
    expect(out).toEqual({ files: [SR], problems: [] });
    expect(await fs.readFile(opened.fixture.path(`system/${SR}`), "utf8")).toBe(before);
  });
});
