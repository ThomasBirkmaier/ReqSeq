// A repeated delivery (SR-056): reqif.analyze and reqif.import of fixtures/SR-056/delivery on
// SR-004/one-repository after delivery 1 was imported. Delivery 2 changes REQ-1 and REQ-3, keeps
// REQ-2, drops REQ-4 and adds REQ-5. The assumptions of #575 are tested by name.
import { readFileSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { createFixtureWorkspace } from "@reqseq/testkit";
import type { FixtureWorkspace } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import type { CommandName, CommandOutput } from "../../catalog.js";
import { CommandError } from "../../catalog.js";
import { invoke } from "../../runtime/invoke.js";
import { Workspace } from "../../runtime/workspace.js";

type Imported = CommandOutput<"reqif.import">;
type Analysis = CommandOutput<"reqif.analyze">;
type Got = CommandOutput<"element.get">;

const sample = (name: string): string =>
  readFileSync(new URL(`../../../../../fixtures/SR-056/delivery/${name}`, import.meta.url), "utf8");
const DELIVERY_1 = sample("lieferung-1.reqif");
const DELIVERY_2 = sample("lieferung-2.reqif");
const MAPPING = sample("kunde-a.yaml");
/** The PNG `element.addAttachment` takes: its signature is enough. */
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

interface Opened {
  readonly fixture: FixtureWorkspace;
  readonly workspace: Workspace;
  readonly root: string;
}

const open = async (
  files: Readonly<Record<string, string>> = {},
  base = "SR-004/one-repository",
  main = "",
): Promise<Opened> => {
  const at = (file: string): string => (main === "" ? file : `${main}/${file}`);
  const fixture = await createFixtureWorkspace({
    fixture: base,
    files: {
      [at("in/1.reqif")]: DELIVERY_1,
      [at("in/2.reqif")]: DELIVERY_2,
      [at("reqif/kunde-a.yaml")]: MAPPING,
      ...files,
    },
  });
  onTestFinished(() => fixture.cleanup());
  const root = main === "" ? fixture.root : fixture.path(main);
  const workspace = new Workspace(root);
  onTestFinished(() => workspace.close());
  return { fixture, workspace, root };
};

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

const importOf = (workspace: Workspace, n: number, extra: Record<string, unknown> = {}): Promise<Imported> =>
  run(workspace, "reqif.import", {
    file: `in/${String(n)}.reqif`,
    mapping: "reqif/kunde-a.yaml",
    delivery: `D${String(n)}`,
    ...extra,
  });
const analyzeOf = (workspace: Workspace, n: number): Promise<Analysis> =>
  run(workspace, "reqif.analyze", { file: `in/${String(n)}.reqif`, mapping: "reqif/kunde-a.yaml" });
const get = (workspace: Workspace, ref: string): Promise<Got> => run(workspace, "element.get", { ref });

/** The UUID of each identifier of delivery 1 as imported. */
const idsOf = (imported: Imported): Record<string, string> =>
  Object.fromEntries(imported.created.map(({ identifier, id }) => [identifier, String(id)]));

/** Every file below `root` with its bytes, and every folder (`name/`), sorted. */
const tree = async (root: string): Promise<[string, string][]> => {
  const entries = await fs.readdir(root, { recursive: true, withFileTypes: true });
  const out: [string, string][] = [];
  for (const entry of entries) {
    const file = path.join(entry.parentPath, entry.name);
    const name = path.relative(root, file).replaceAll("\\", "/");
    out.push(entry.isDirectory() ? [`${name}/`, ""] : [name, await fs.readFile(file, "base64")]);
  }
  return out.sort(([a], [b]) => (a < b ? -1 : 1));
};

/** Delivery 1 imported, with the UUID of each requirement. */
const delivered = async (
  files: Readonly<Record<string, string>> = {},
): Promise<Opened & { ids: Record<string, string> }> => {
  const opened = await open(files);
  return { ...opened, ids: idsOf(await importOf(opened.workspace, 1)) };
};

const pick = (list: readonly { identifier: string; id?: string | undefined }[]): string[] =>
  list.map((o) => o.identifier);

describe("repeated ReqIF import (SR-056)", () => {
  it("fixtures/SR-056/imported holds delivery 1 as reqif.import writes it today (cross-access fixture)", async () => {
    const { workspace, ids } = await delivered();
    for (const n of [1, 2, 3, 4]) {
      const fixture = sample(`../imported/Kunde-A/SR-00000000000${String(n)}.md`);
      const fresh = await get(workspace, String(ids[`REQ-${String(n)}`]));
      expect(fixture).toContain(`import-version: ${String(fresh.element.properties["import-version"])}\n`);
    }
  });

  it("[SR-056/AK1] reqif.analyze and reqif.import show new, changed and dropped requirements separately, matched by source and IDENTIFIER", async () => {
    const { workspace, ids } = await delivered();
    const analysis = await analyzeOf(workspace, 2);
    expect(analysis).toEqual({
      unmapped: [],
      new: [{ identifier: "REQ-5" }],
      changed: [
        { identifier: "REQ-1", id: ids["REQ-1"] },
        { identifier: "REQ-3", id: ids["REQ-3"] },
      ],
      dropped: [{ identifier: "REQ-4", id: ids["REQ-4"] }],
      conflicts: [],
      losses: [],
    });
    const imported = await importOf(workspace, 2);
    expect(pick(imported.created)).toEqual(["REQ-5"]);
    // REQ-2 is written for the new version of its relation target REQ-1 only.
    expect(imported.updated).toEqual([
      { identifier: "REQ-1", id: ids["REQ-1"] },
      { identifier: "REQ-2", id: ids["REQ-2"] },
      { identifier: "REQ-3", id: ids["REQ-3"] },
    ]);
    expect([imported.kept, imported.dropped]).toEqual([[], [{ identifier: "REQ-4", id: ids["REQ-4"] }]]);
    expect(imported.problems).toEqual([]);
  });

  it("[SR-056/AK2] updates the element of the same source and IDENTIFIER in place and creates no second one", async () => {
    const { workspace, ids, root } = await delivered();
    const one = String(ids["REQ-1"]);
    // A property the mapping does not map stays (D-022); rationale does not count to the version.
    await run(workspace, "element.update", { ref: one, set: { rationale: "local note" } });
    const before = await get(workspace, one);
    const files = (await fs.readdir(path.join(root, "Kunde-A"))).sort();
    const imported = await importOf(workspace, 2);
    const after = await get(workspace, one);
    expect(after.element.id).toBe(one);
    expect(after.element.text).toBe("The station measures the wind speed every 10 s.\n");
    expect(after.element.properties).toMatchObject({
      rationale: "local note",
      delivery: "D2",
      "source-identifier": "REQ-1",
      "import-version": after.element.version,
    });
    expect(after.element.version).not.toBe(before.element.version);
    const now = (await fs.readdir(path.join(root, "Kunde-A"))).sort();
    expect(now.length).toBe(files.length + 1);
    expect(imported.files).toContain(`Kunde-A/${path.basename(after.element.file.split(":").pop() ?? "")}`);
    // The new REQ-5 satisfies REQ-1 at its new version, and REQ-2 follows it.
    const five = await get(workspace, String(imported.created[0]?.id));
    expect(five.element.relations).toEqual([
      expect.objectContaining({
        kind: "derives-from",
        id: one,
        storedVersion: after.element.version,
      }) as unknown,
    ]);
    const two = await get(workspace, String(ids["REQ-2"]));
    expect(two.element.relations).toEqual([
      expect.objectContaining({ id: one, storedVersion: after.element.version }) as unknown,
    ]);
  });

  it("[SR-056/AK3] lists a dropped requirement only in the output and leaves its file, status and properties as they were", async () => {
    const { workspace, ids, root } = await delivered();
    const four = await get(workspace, String(ids["REQ-4"]));
    const file = path.join(root, "Kunde-A", path.basename(four.element.file));
    const bytes = await fs.readFile(file);
    expect((await analyzeOf(workspace, 2)).dropped).toEqual([{ identifier: "REQ-4", id: ids["REQ-4"] }]);
    const imported = await importOf(workspace, 2);
    expect(imported.dropped).toEqual([{ identifier: "REQ-4", id: ids["REQ-4"] }]);
    expect(await fs.readFile(file)).toEqual(bytes);
    const after = await get(workspace, String(ids["REQ-4"]));
    expect([after.element.status, after.element.properties]).toEqual([
      four.element.status,
      four.element.properties,
    ]);
  });

  it("[SR-056/AK4] shows a requirement changed locally and in the delivery as a conflict and refuses the import without a choice, naming it", async () => {
    const { workspace, ids, root } = await delivered();
    const three = String(ids["REQ-3"]);
    await run(workspace, "element.update", { ref: three, text: "Stored locally for a year.\n" });
    const analysis = await analyzeOf(workspace, 2);
    expect(analysis.conflicts).toEqual([{ identifier: "REQ-3", id: three }]);
    expect(pick(analysis.changed)).toEqual(["REQ-1", "REQ-3"]);
    const before = await tree(root);
    const refused = await failure(workspace, "reqif.import", {
      file: "in/2.reqif",
      mapping: "reqif/kunde-a.yaml",
      delivery: "D2",
    });
    expect([refused.code, refused.details?.["conflicts"]]).toEqual([
      "reqif.conflict",
      [{ identifier: "REQ-3", id: three }],
    ]);
    expect(refused.message).toContain("REQ-3");
    expect(await tree(root)).toEqual(before);
  });

  it("[SR-055/AK3] a repeated import refused for a conflict changes no file and creates no folder", async () => {
    const { workspace, ids, root } = await delivered({ "in/img/a.png": PNG.toString("latin1") });
    await run(workspace, "element.update", { ref: String(ids["REQ-3"]), text: "Local.\n" });
    const delivery = DELIVERY_2.replace(
      "The station warns above 20 m/s.",
      'The station warns above 20 m/s. <xhtml:object data="img/a.png" type="image/png">a</xhtml:object>',
    );
    await fs.writeFile(path.join(root, "in/2.reqif"), delivery);
    const before = await tree(root);
    const refused = await failure(workspace, "reqif.import", {
      file: "in/2.reqif",
      mapping: "reqif/kunde-a.yaml",
      delivery: "D2",
    });
    expect(refused.code).toBe("reqif.conflict");
    expect(await tree(root)).toEqual(before);
  });

  it("[SR-056/AK4] takes the delivery for a conflict in take, and keeps the local element for one in keep until the delivery changes it again", async () => {
    const { workspace, ids } = await delivered();
    const one = String(ids["REQ-1"]);
    const three = String(ids["REQ-3"]);
    await run(workspace, "element.update", { ref: one, text: "Local one.\n" });
    await run(workspace, "element.update", { ref: three, text: "Local three.\n" });
    const shortOne = (await get(workspace, one)).element.shortId;
    // REQ-1 by its short ID, REQ-3 by its source IDENTIFIER.
    const imported = await importOf(workspace, 2, { take: [shortOne], keep: ["REQ-3"] });
    expect([pick(imported.updated), pick(imported.kept)]).toEqual([["REQ-1", "REQ-2"], ["REQ-3"]]);
    expect((await get(workspace, one)).element.text).toBe(
      "The station measures the wind speed every 10 s.\n",
    );
    const kept = await get(workspace, three);
    expect(kept.element.text).toBe("Local three.\n");
    expect(kept.element.properties["delivery"]).toBe("D2");
    // The same delivery again: no conflict comes back, and nothing is written.
    const again = await importOf(workspace, 2);
    expect([again.updated, again.kept, again.files]).toEqual([[], [], []]);
    expect((await analyzeOf(workspace, 2)).conflicts).toEqual([]);
  });

  it("[SR-056/AK4] refuses one conflict in both take and keep, and warns of an entry that names no conflict", async () => {
    const { workspace, ids } = await delivered();
    await run(workspace, "element.update", { ref: String(ids["REQ-3"]), text: "Local.\n" });
    const both = await failure(workspace, "reqif.import", {
      file: "in/2.reqif",
      mapping: "reqif/kunde-a.yaml",
      delivery: "D2",
      take: ["REQ-3"],
      keep: [String(ids["REQ-3"])],
    });
    expect([both.code, both.details?.["fields"], both.details?.["reason"]]).toEqual([
      "input.invalid",
      ["take", "keep"],
      "take-and-keep",
    ]);
    const imported = await importOf(workspace, 2, { take: ["REQ-3", "REQ-1", "nothing-like-it"] });
    expect(imported.problems?.map((p) => [p.code, p.severity, p.message])).toEqual([
      ["reqif.choice-unused", "warning", "take: REQ-1 names no conflict of this delivery"],
      ["reqif.choice-unused", "warning", "take: nothing-like-it names no conflict of this delivery"],
    ]);
    expect(pick(imported.updated)).toContain("REQ-3");
  });

  it("writes nothing when the same delivery is imported again", async () => {
    const { workspace, root } = await delivered();
    const before = await tree(root);
    const analysis = await analyzeOf(workspace, 1);
    expect([analysis.new, analysis.changed, analysis.conflicts, analysis.dropped, analysis.problems]).toEqual(
      [[], [], [], [], undefined],
    );
    const again = await importOf(workspace, 1, { delivery: "D1 again" });
    expect([again.created, again.updated, again.kept, again.files]).toEqual([[], [], [], []]);
    expect(await tree(root)).toEqual(before);
  });

  it("writes the delivery's title back over a local edit and warns beforehand (#575/4a)", async () => {
    const { workspace, ids } = await delivered();
    const two = String(ids["REQ-2"]);
    await run(workspace, "element.update", { ref: two, title: "Local title" });
    const analysis = await analyzeOf(workspace, 1);
    expect(analysis.changed).toEqual([]);
    expect(analysis.problems?.map((p) => [p.code, p.elementId, p.message])).toEqual([
      [
        "reqif.replaces-local",
        two,
        expect.stringContaining("REQ-2: the delivery writes title into") as unknown,
      ],
    ]);
    const again = await importOf(workspace, 1);
    expect(pick(again.updated)).toEqual(["REQ-2"]);
    expect((await get(workspace, two)).element.title).toBe("Show the wind");
  });

  it("warns before it writes the delivery's relations over a local relation edit (#575/4a)", async () => {
    const { workspace, ids } = await delivered();
    const three = String(ids["REQ-3"]);
    await run(workspace, "relation.add", {
      source: three,
      kind: "derives-from",
      target: String(ids["REQ-4"]),
    });
    const analysis = await analyzeOf(workspace, 1);
    expect([analysis.changed, analysis.problems?.map((p) => [p.code, p.elementId, p.message])]).toEqual([
      [],
      [
        [
          "reqif.replaces-local",
          three,
          expect.stringContaining("REQ-3: the delivery writes derives-from into") as unknown,
        ],
      ],
    ]);
    const again = await importOf(workspace, 1);
    expect([pick(again.updated), again.problems?.map((p) => p.code)]).toEqual([
      ["REQ-3"],
      ["reqif.replaces-local"],
    ]);
    expect((await get(workspace, three)).element.relations).toEqual([]);
  });

  it("warns of a local value of a mapped property that does not count (#575/4a)", async () => {
    const comment =
      '<ATTRIBUTE-VALUE-STRING THE-VALUE="from the source"><DEFINITION><ATTRIBUTE-DEFINITION-STRING-REF>ad-comment</ATTRIBUTE-DEFINITION-STRING-REF></DEFINITION></ATTRIBUTE-VALUE-STRING>';
    const { workspace } = await open({
      "in/1.reqif": DELIVERY_1.replaceAll(
        "</ATTRIBUTE-VALUE-ENUMERATION>",
        `</ATTRIBUTE-VALUE-ENUMERATION>${comment}`,
      ),
      "reqif/kunde-a.yaml": MAPPING.replace(
        "{ source: Internal Comment, omit: true }",
        "{ source: Internal Comment, property: rationale }",
      ),
    });
    const ids = idsOf(await importOf(workspace, 1));
    const two = String(ids["REQ-2"]);
    expect((await get(workspace, two)).element.properties["rationale"]).toBe("from the source");
    await run(workspace, "element.update", { ref: two, set: { rationale: "local" } });
    const analysis = await analyzeOf(workspace, 1);
    expect(analysis.problems?.map((p) => p.message)).toEqual([
      expect.stringContaining("REQ-2: the delivery writes rationale into") as unknown,
    ]);
  });

  it("warns of a local title an update with a changed delivery writes over (#575/4a)", async () => {
    const { workspace, ids } = await delivered();
    const one = String(ids["REQ-1"]);
    await run(workspace, "element.update", { ref: one, title: "Local title" });
    const analysis = await analyzeOf(workspace, 2);
    expect(pick(analysis.changed)).toEqual(["REQ-1", "REQ-3"]);
    expect(analysis.problems?.map((p) => [p.code, p.elementId, p.message])).toEqual([
      [
        "reqif.replaces-local",
        one,
        expect.stringContaining("REQ-1: the delivery writes title into") as unknown,
      ],
    ]);
  });

  it("refuses the import while an element file cannot be read, and warns in reqif.analyze (#575/8)", async () => {
    const { workspace, ids, root } = await delivered();
    const one = await get(workspace, String(ids["REQ-1"]));
    const file = path.join(root, "Kunde-A", path.basename(one.element.file));
    await fs.writeFile(file, (await fs.readFile(file, "utf8")).replace(/^title: .*$/m, "title: [unclosed"));
    const fresh = new Workspace(root);
    onTestFinished(() => fresh.close());
    const analysis = await analyzeOf(fresh, 2);
    // REQ-1 is not matched, so the analysis takes it as new.
    expect(analysis.problems?.map((p) => [p.code, p.severity, p.file])).toContainEqual([
      "file.invalid-yaml",
      "warning",
      `Kunde-A/${path.basename(one.element.file)}`,
    ]);
    const before = await tree(root);
    const refused = await failure(fresh, "reqif.import", {
      file: "in/2.reqif",
      mapping: "reqif/kunde-a.yaml",
      delivery: "D2",
    });
    expect([refused.code, refused.details?.["files"]]).toEqual([
      "file.faulty",
      [{ repository: "system", file: `Kunde-A/${path.basename(one.element.file)}` }],
    ]);
    expect(await tree(root)).toEqual(before);
  });

  it("leaves an element changed only locally as it is (#575/1)", async () => {
    const { workspace, ids, root } = await delivered();
    await run(workspace, "element.update", { ref: String(ids["REQ-2"]), text: "Local.\n" });
    const before = await tree(root);
    expect((await analyzeOf(workspace, 1)).changed).toEqual([]);
    const again = await importOf(workspace, 1);
    expect([again.updated, again.files]).toEqual([[], []]);
    expect(await tree(root)).toEqual(before);
  });

  it("gives a relation to an element changed only locally its current version", async () => {
    const { workspace, ids } = await delivered();
    const one = String(ids["REQ-1"]);
    await run(workspace, "element.update", { ref: one, text: "Local.\n" });
    const current = (await get(workspace, one)).element.version;
    const again = await importOf(workspace, 1);
    expect(pick(again.updated)).toEqual(["REQ-2"]);
    expect((await get(workspace, String(ids["REQ-2"]))).element.relations).toEqual([
      expect.objectContaining({ id: one, storedVersion: current }) as unknown,
    ]);
  });

  it("updates without conflict an element changed locally to what the delivery gives (#575/2)", async () => {
    const { workspace, ids } = await delivered();
    const one = String(ids["REQ-1"]);
    await run(workspace, "element.update", {
      ref: one,
      text: "The station measures the wind speed every 10 s.\n",
    });
    const analysis = await analyzeOf(workspace, 2);
    expect([pick(analysis.changed), analysis.conflicts]).toEqual([["REQ-1", "REQ-3"], []]);
    await importOf(workspace, 2);
    const after = await get(workspace, one);
    expect(after.element.properties["import-version"]).toBe(after.element.version);
  });

  it("counts a local value of an unmapped property that counts as a change of the delivery, and with a local text a conflict (#575/5a)", async () => {
    const { workspace, ids } = await delivered();
    const two = String(ids["REQ-2"]);
    await run(workspace, "element.update", {
      ref: two,
      set: { "acceptance-criteria": ["Shown within 1 s"] },
    });
    expect(pick((await analyzeOf(workspace, 1)).changed)).toEqual(["REQ-2"]);
    expect((await analyzeOf(workspace, 1)).conflicts).toEqual([]);
    await run(workspace, "element.update", { ref: two, text: "Local.\n" });
    expect((await analyzeOf(workspace, 1)).conflicts).toEqual([{ identifier: "REQ-2", id: two }]);
  });

  it("refuses an element whose current version cannot be computed, and two elements with one source IDENTIFIER of the delivery", async () => {
    const { workspace, ids, root, fixture } = await delivered();
    const one = await get(workspace, String(ids["REQ-1"]));
    const file = path.join(root, "Kunde-A", path.basename(one.element.file));
    const original = await fs.readFile(file, "utf8");
    await fs.writeFile(file, original.replace("---\n\n", "acceptance-criteria: [.inf]\n---\n\n"));
    const fresh = new Workspace(root);
    onTestFinished(() => fresh.close());
    const unknown = await failure(fresh, "reqif.import", {
      file: "in/2.reqif",
      mapping: "reqif/kunde-a.yaml",
      delivery: "D2",
    });
    expect([unknown.code, unknown.details?.["reason"], unknown.details?.["identifier"]]).toEqual([
      "input.invalid",
      "no-version",
      "REQ-1",
    ]);
    await fs.writeFile(file, original);
    // A copy of REQ-1 with another UUID, and one of the dropped REQ-4, which does not stop the import.
    const copyId = "6f1c2a3b-4d5e-4f60-9a7b-c0ffe0000001";
    const copy = original.replace(String(ids["REQ-1"]), copyId);
    await fixture.write(`Kunde-A/SR-c0ffe0000001.md`, copy);
    const twice = new Workspace(root);
    onTestFinished(() => twice.close());
    const duplicate = await failure(twice, "reqif.import", {
      file: "in/2.reqif",
      mapping: "reqif/kunde-a.yaml",
      delivery: "D2",
    });
    expect([duplicate.code, duplicate.details?.["reason"], duplicate.details?.["identifier"]]).toEqual([
      "input.invalid",
      "origin-duplicate",
      "REQ-1",
    ]);
  });

  it("keeps the UUID on the losses of an existing element, and removes a mapped property the delivery no longer has", async () => {
    const { workspace, ids, root } = await delivered();
    const comment =
      '<ATTRIBUTE-VALUE-STRING THE-VALUE="note"><DEFINITION><ATTRIBUTE-DEFINITION-STRING-REF>ad-comment</ATTRIBUTE-DEFINITION-STRING-REF></DEFINITION></ATTRIBUTE-VALUE-STRING>';
    const [head = "", rest = ""] = DELIVERY_2.split('<SPEC-OBJECT IDENTIFIER="REQ-2"');
    const two = rest.replace(/<ATTRIBUTE-VALUE-ENUMERATION>.*?<\/ATTRIBUTE-VALUE-ENUMERATION>/s, comment);
    await fs.writeFile(path.join(root, "in/2.reqif"), `${head}<SPEC-OBJECT IDENTIFIER="REQ-2"${two}`);
    const analysis = await analyzeOf(workspace, 2);
    expect(analysis.losses).toEqual([
      expect.objectContaining({
        identifier: "REQ-2",
        id: ids["REQ-2"],
        code: "omitted-attribute",
      }) as unknown,
    ]);
    expect(pick(analysis.changed)).toEqual(["REQ-1", "REQ-2", "REQ-3"]);
    await importOf(workspace, 2);
    expect(
      (await get(workspace, String(ids["REQ-2"]))).element.properties["requirement-type"],
    ).toBeUndefined();
  });

  it("takes an element without import version as changed", async () => {
    const { workspace, ids, root } = await delivered();
    const two = await get(workspace, String(ids["REQ-2"]));
    const file = path.join(root, "Kunde-A", path.basename(two.element.file));
    await fs.writeFile(file, (await fs.readFile(file, "utf8")).replace(/^import-version: .*\n/m, ""));
    const fresh = new Workspace(root);
    onTestFinished(() => fresh.close());
    const analysis = await analyzeOf(fresh, 1);
    expect([pick(analysis.changed), analysis.conflicts]).toEqual([["REQ-2"], []]);
    await importOf(fresh, 1);
    const after = await get(fresh, String(ids["REQ-2"]));
    expect(after.element.properties["import-version"]).toBe(after.element.version);
  });

  it("refuses a mapping that now gives an existing element another type", async () => {
    const { workspace } = await delivered({
      "reqif/need.yaml": MAPPING.replace("type: system-requirement", "type: need").replace(
        "  - { source: Priority, property: requirement-type, values: { High: functional, Low: quality } }",
        "  - { source: Priority, omit: true }",
      ),
    });
    const refused = await failure(workspace, "reqif.import", {
      file: "in/2.reqif",
      mapping: "reqif/need.yaml",
      delivery: "D2",
    });
    expect([refused.code, refused.details?.["fields"]]).toEqual(["input.invalid", ["mapping.types[0].type"]]);
  });

  it("warns in reqif.analyze of a repository that is not on this machine", async () => {
    const { workspace, root } = await open({
      "reqseq-workspace.yaml": [
        "reqseq-workspace: 1",
        "name: Weather station",
        "repositories:",
        '  - { name: system, url: "git@git.example.com:ws/system.git", main: true }',
        '  - { name: customer, url: "git@git.example.com:ws/customer.git", path: ../missing-customer }',
        "metamodel: { repository: system, path: metamodel }",
        "",
      ].join("\n"),
    });
    const analysis = await analyzeOf(workspace, 1);
    expect(analysis.problems?.map((p) => [p.code, p.repository])).toEqual([
      ["workspace.repository-missing", "customer"],
    ]);
    await fs.appendFile(
      path.join(root, "reqif/kunde-a.yaml"),
      "target: { repository: customer, path: kunde-a }\n",
    );
    const missing = await failure(workspace, "reqif.analyze", {
      file: "in/1.reqif",
      mapping: "reqif/kunde-a.yaml",
    });
    expect([missing.code, missing.details?.["repository"]]).toEqual(["file.folder-missing", "customer"]);
  });

  it("names the repository of a relation target an earlier delivery has in another repository", async () => {
    const opened = await open({}, "SR-004/three-repositories", "system");
    const { workspace, root, fixture } = opened;
    const ids = idsOf(await importOf(workspace, 1));
    const one = await get(workspace, String(ids["REQ-1"]));
    const name = path.basename(one.element.file);
    await fs.rename(path.join(root, "Kunde-A", name), fixture.path(`sensor/${name}`));
    const fresh = new Workspace(root);
    onTestFinished(() => fresh.close());
    const imported = await importOf(fresh, 2);
    const five = await get(fresh, String(imported.created[0]?.id));
    expect(five.element.relations).toEqual([
      expect.objectContaining({
        id: ids["REQ-1"],
        repository: "sensor",
        targetState: "available",
      }) as unknown,
    ]);
    const moved = await fs.readFile(fixture.path(`sensor/${name}`), "utf8");
    expect(moved).toContain("every 10 s.");
    // The same delivery again finds the relations with their repository as they are.
    expect((await importOf(fresh, 2)).files).toEqual([]);
  });

  it("copies a new image of an updated element into its image folder and keeps the names of the images there", async () => {
    const image = (n: number, file: string): string =>
      DELIVERY_1.replace(
        "The station measures the wind speed.",
        `The station measures the wind speed. <xhtml:object data="img/${file}" type="image/png">${file}</xhtml:object>`,
      ).replace("Lastenheft 2026-11", `Lastenheft ${String(n)}`);
    const { workspace, root } = await open({
      "in/1.reqif": image(1, "a.png"),
      "in/2.reqif": image(2, "b.png"),
    });
    await fs.mkdir(path.join(root, "in/img"));
    await fs.writeFile(path.join(root, "in/img/a.png"), PNG);
    await fs.writeFile(path.join(root, "in/img/b.png"), Buffer.concat([PNG, Buffer.from([9])]));
    const first = await importOf(workspace, 1);
    const one = await get(workspace, String(first.created[0]?.id));
    const stem = path.basename(one.element.file, ".md");
    // The same image again: no copy and no write.
    await fs.writeFile(path.join(root, "in/3.reqif"), image(3, "a.png"));
    expect((await importOf(workspace, 3)).files).toEqual([]);
    // Another folder in the image folder is no image.
    await fs.mkdir(path.join(root, "Kunde-A", stem, "drafts"));
    const second = await importOf(workspace, 2);
    // REQ-2 follows the new version of REQ-1, its relation target.
    expect(second.files).toEqual([
      `Kunde-A/${stem}.md`,
      expect.stringMatching(/^Kunde-A\/SR-/) as unknown,
      `Kunde-A/${stem}/b.png`,
    ]);
    expect((await fs.readdir(path.join(root, "Kunde-A", stem))).sort()).toEqual(["a.png", "b.png", "drafts"]);
    expect((await get(workspace, String(first.created[0]?.id))).element.text).toContain(`](${stem}/b.png)`);
  });

  it("checks every image copy of an updated element before it creates a folder for one", async () => {
    const withImage = (text: string): string =>
      `${text} <xhtml:object data="img/a.png" type="image/png">a</xhtml:object>`;
    const { workspace, root } = await open({
      "in/1.reqif": DELIVERY_1,
      "in/2.reqif": DELIVERY_1.replace(
        "The station measures the wind speed.",
        withImage("The station measures the wind speed."),
      ).replace("The display shows the wind speed.", withImage("The display shows the wind speed.")),
    });
    await fs.mkdir(path.join(root, "in/img"));
    await fs.writeFile(path.join(root, "in/img/a.png"), PNG);
    const ids = idsOf(await importOf(workspace, 1));
    const stem = async (identifier: string): Promise<string> =>
      path.basename((await get(workspace, String(ids[identifier]))).element.file, ".md");
    const [first, second] = [await stem("REQ-1"), await stem("REQ-2")];
    // The image folder of the second element is a link, which the walk does not follow.
    await fs.mkdir(path.join(root, "in/elsewhere"));
    await fs.symlink(path.join(root, "in/elsewhere"), path.join(root, "Kunde-A", second), "junction");
    await expect(importOf(workspace, 2)).rejects.toMatchObject({
      details: { rule: "link", file: `Kunde-A/${second}/a.png` },
    });
    // Refused before the image folder of the first one was created.
    await expect(fs.stat(path.join(root, "Kunde-A", first))).rejects.toMatchObject({ code: "ENOENT" });
  });
});
