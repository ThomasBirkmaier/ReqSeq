// The origin of imported elements (SR-057): reqif.import of fixtures/SR-053/delivery on
// SR-004/one-repository writes source, source IDENTIFIER, import date, delivery and import version;
// the source filters; and only the import writes them.
import { readFileSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { createFixtureWorkspace } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import type { CommandName, CommandOutput } from "../../catalog.js";
import { CommandError } from "../../catalog.js";
import { invoke } from "../../runtime/invoke.js";
import { Workspace } from "../../runtime/workspace.js";

type Imported = CommandOutput<"reqif.import">;
type Got = CommandOutput<"element.get">;

const sample = (name: string): string =>
  readFileSync(new URL(`../../../../../fixtures/SR-053/delivery/${name}`, import.meta.url), "utf8");
const DELIVERY = sample("lieferung.reqif");
const MAPPING = sample("kunde-a.yaml");
const METAMODEL = readFileSync(
  new URL("../../../../../fixtures/SR-004/one-repository/metamodel/standard-model.yaml", import.meta.url),
  "utf8",
);

const open = async (files: Readonly<Record<string, string>> = {}): Promise<Workspace> => {
  const fixture = await createFixtureWorkspace({
    fixture: "SR-004/one-repository",
    files: {
      "in/lieferung.reqif": DELIVERY,
      "reqif/kunde-a.yaml": MAPPING,
      "reqif/kunde-b.yaml": MAPPING.replace("name: Kunde A", "name: Kunde B"),
      ...files,
    },
  });
  onTestFinished(() => fixture.cleanup());
  const workspace = new Workspace(fixture.root);
  onTestFinished(() => workspace.close());
  return workspace;
};

const INPUT = { file: "in/lieferung.reqif", mapping: "reqif/kunde-a.yaml", delivery: "Lastenheft 2026-11" };

const run = async <C extends CommandName>(
  workspace: Workspace,
  command: C,
  input: Record<string, unknown>,
): Promise<CommandOutput<C>> => (await invoke(command, input, { workspace })) as CommandOutput<C>;

const failure = async (
  workspace: Workspace,
  command: CommandName,
  input: Record<string, unknown>,
): Promise<CommandError> => {
  const error = await invoke(command, input, { workspace }).catch((e: unknown) => e);
  if (!(error instanceof CommandError)) {
    throw new Error(`${command} did not fail with a CommandError`);
  }
  return error;
};

/** Makes `date` (local time) the current time of this test; only `Date` is faked. */
const atLocal = (date: Date): void => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(date);
  onTestFinished(() => {
    vi.useRealTimers();
  });
};

const ORIGIN = ["source", "source-identifier", "import-date", "delivery", "import-version"] as const;

const originOf = (got: Got): Record<string, unknown> =>
  Object.fromEntries(ORIGIN.map((key) => [key, got.element.properties[key]]));

describe("origin of imported elements (SR-057)", () => {
  it("[SR-057/AK1] each imported element holds source, source IDENTIFIER, import date, delivery and import version as properties", async () => {
    atLocal(new Date(2026, 10, 2, 23, 30));
    const workspace = await open();
    const out = await run(workspace, "reqif.import", INPUT);
    const got = async (ref: string | undefined): Promise<Got> =>
      run(workspace, "element.get", { ref: ref ?? "" });
    const one = await got(out.created[0]?.id);
    expect(originOf(one)).toEqual({
      source: "Kunde A",
      "source-identifier": "REQ-1",
      "import-date": "2026-11-02",
      delivery: "Lastenheft 2026-11",
      "import-version": expect.stringMatching(/^n1:[0-9a-f]{16}$/) as unknown,
    });
    expect(originOf(await got(out.created[1]?.id))).toMatchObject({
      "source-identifier": "REQ-2",
      "import-date": "2026-11-02",
    });

    // The import version covers what the import wrote, not the origin: another delivery on another
    // day gives the same one. The origin does not count to the version either (D-057).
    atLocal(new Date(2026, 11, 24, 0, 5));
    const again = await run(workspace, "reqif.import", {
      ...INPUT,
      mapping: "reqif/kunde-b.yaml",
      delivery: "2",
    });
    const other = await got(again.created[0]?.id);
    expect(originOf(other)).toMatchObject({ source: "Kunde B", "import-date": "2026-12-24", delivery: "2" });
    expect(other.element.properties["import-version"]).toBe(one.element.properties["import-version"]);
    expect(other.element.version).toBe(one.element.version);
    // A delivery with another text has another import version.
    const changed = await open({ "in/lieferung.reqif": DELIVERY.replace("Every 10 s.", "Every 5 s.") });
    const third = await run(changed, "reqif.import", INPUT);
    const read = await run(changed, "element.get", { ref: third.created[0]?.id ?? "" });
    expect(read.element.properties["import-version"]).not.toBe(one.element.properties["import-version"]);
  });

  it("[SR-057/AK1] does not import an object whose type cannot hold the origin, and needs every origin meaning", async () => {
    const without = await open({
      "metamodel/standard-model.yaml": METAMODEL.replace(
        "        import-version,\n        topic,",
        "        topic,",
      ),
    });
    const out = await run(without, "reqif.import", INPUT);
    expect(out.created).toEqual([]);
    expect(out.files).toEqual([]);
    expect(out.losses.filter((l) => l.code === "type-without-origin")).toEqual([
      {
        identifier: "REQ-1",
        kind: "spec-object",
        code: "type-without-origin",
        reason: "type system-requirement has no import-version, so the origin cannot be kept",
      },
      expect.objectContaining({ identifier: "REQ-2", code: "type-without-origin" }),
    ]);
    // The parts of an object that is not imported are not listed again.
    expect(out.losses.map((l) => l.code)).not.toContain("omitted-attribute");

    const unassigned = await open({
      "metamodel/standard-model.yaml": METAMODEL.replace("      meaning: delivery,\n", ""),
    });
    const error = await failure(unassigned, "reqif.import", INPUT);
    expect([error.code, error.details?.["meaning"]]).toEqual(["metamodel.meaning-unassigned", "delivery"]);
  });

  it("[SR-057/AK2] the filter on the source gives exactly the elements of that source", async () => {
    const workspace = await open();
    const a = await run(workspace, "reqif.import", INPUT);
    const b = await run(workspace, "reqif.import", { ...INPUT, mapping: "reqif/kunde-b.yaml" });
    const ids = async (where: unknown): Promise<string[]> =>
      (await run(workspace, "element.list", { selection: { where }, limit: 5000 })).elements
        .map((e) => e.id)
        .sort();
    const of = (out: Imported): string[] => out.created.map((c) => c.id ?? "").sort();
    expect(await ids({ source: "Kunde A" })).toEqual(of(a));
    expect(await ids({ source: "Kunde B" })).toEqual(of(b));
    expect(await ids({ source: "Kunde C" })).toEqual([]);
  });

  it("[SR-057/AK3] a changed imported element shows its origin unchanged, and every other command that would write the origin is refused", async () => {
    const workspace = await open();
    const out = await run(workspace, "reqif.import", INPUT);
    const id = out.created[0]?.id ?? "";
    const before = await run(workspace, "element.get", { ref: id });
    await run(workspace, "element.update", { ref: id, title: "Measure the gusts", text: "Changed here." });
    const after = await run(workspace, "element.get", { ref: id });
    expect(after.element.title).toBe("Measure the gusts");
    expect(originOf(after)).toEqual(originOf(before));
    const at = path.join(workspace.root, out.files[0] ?? "");
    const file = await fs.readFile(at, "utf8");

    const refusal = async (command: CommandName, input: Record<string, unknown>): Promise<unknown> => {
      const error = await failure(workspace, command, input);
      return [error.code, error.details?.["reason"], error.message];
    };
    expect(await refusal("element.update", { ref: id, set: { source: "Kunde B" } })).toEqual([
      "input.invalid",
      "origin",
      "set cannot hold source: it holds the origin (source), which only reqif.import writes",
    ]);
    expect(await refusal("element.update", { ref: id, unset: ["import-version"] })).toEqual([
      "input.invalid",
      "origin",
      "unset cannot hold import-version: it holds the origin (import-version), which only reqif.import writes",
    ]);
    expect(
      await refusal("element.create", {
        type: "system-requirement",
        title: "By hand",
        properties: { delivery: "1" },
      }),
    ).toEqual([
      "input.invalid",
      "origin",
      "properties cannot hold delivery: it holds the origin (delivery), which only reqif.import writes",
    ]);
    expect(
      await refusal("element.bulkUpdate", {
        selection: { where: { source: "Kunde A" } },
        property: "import-date",
        operation: "set",
        value: "2026-01-01",
        confirm: true,
      }),
    ).toEqual([
      "input.invalid",
      "origin",
      "property: import-date holds the origin (import-date), which only reqif.import writes",
    ]);
    // Nothing was written.
    expect(await fs.readFile(at, "utf8")).toBe(file);
  });
});
