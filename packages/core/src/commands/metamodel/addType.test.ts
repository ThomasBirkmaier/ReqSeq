// metamodel.addType (SR-237 AK1) and the frame of the metamodel commands (SR-236) as this command
// shows it. On fixtures/SR-004/one-repository (the standard model in one file, one requirement) and
// fixtures/SR-018/own-repository (types, properties and statuses in three files of an own
// repository). The write layer's rollback and Git place are in metamodel/write.test.ts.
import fs from "node:fs/promises";
import path from "node:path";
import { createFixtureWorkspace } from "@reqseq/testkit";
import type { FixtureOptions, FixtureWorkspace } from "@reqseq/testkit";
import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";
import type { CommandInput, CommandOutput } from "../../catalog.js";
import { CommandError } from "../../catalog.js";
import { invoke } from "../../runtime/invoke.js";
import { Workspace } from "../../runtime/workspace.js";

type Added = CommandOutput<"metamodel.addType">;
type Input = Partial<CommandInput<"metamodel.addType">>;

const MODEL = "metamodel/standard-model.yaml";
const OWN = { types: "models/model/types.yaml", properties: "models/model/properties.yaml" } as const;

interface Opened {
  readonly fixture: FixtureWorkspace;
  readonly workspace: Workspace;
  readonly read: (file: string) => Promise<string>;
}

const open = async (options: FixtureOptions = {}, root = ""): Promise<Opened> => {
  const fixture = await createFixtureWorkspace({ fixture: "SR-004/one-repository", ...options });
  onTestFinished(() => fixture.cleanup());
  const workspace = new Workspace(path.join(fixture.root, root));
  onTestFinished(() => workspace.close());
  return { fixture, workspace, read: (file) => fs.readFile(fixture.path(file), "utf8") };
};

const own = (files: FixtureOptions["files"] = {}): Promise<Opened> =>
  open({ fixture: "SR-018/own-repository", files }, "system");

const add = async (workspace: Workspace, input: Input): Promise<Added> =>
  (await invoke("metamodel.addType", input, { workspace, access: "mcp" })) as Added;

const failure = async (workspace: Workspace, input: Input): Promise<CommandError> => {
  try {
    await add(workspace, input);
  } catch (error) {
    if (error instanceof CommandError) {
      return error;
    }
    throw error;
  }
  throw new Error("metamodel.addType did not fail");
};

/** The files below `folder`, by path, with their bytes as text. */
const snapshot = async (folder: string): Promise<Record<string, string>> => {
  const entries = await fs.readdir(folder, { recursive: true, withFileTypes: true });
  const files = entries.filter((e) => e.isFile());
  return Object.fromEntries(
    await Promise.all(
      files.map(async (e) => {
        const file = path.join(e.parentPath, e.name);
        return [path.relative(folder, file), await fs.readFile(file, "utf8")] as const;
      }),
    ),
  );
};

const RISK = { name: "Risk", prefix: "RI" };
/** The lines the standard model gets for RISK, at the end of `types`. */
const RISK_LINES = "  - key: risk\n    name: Risk\n    prefix: RI\n    required: [title]\n";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("metamodel.addType adds a type (SR-237 AK1)", () => {
  it("[SR-237/AK-hzk4] adds a type whose elements can be created, with the title as required property, and an abstract one whose cannot", async () => {
    const { workspace } = await open();
    const added = await add(workspace, RISK);
    expect(added).toEqual({
      answer: "Added the type Risk with prefix RI; 1 file written.",
      type: { key: "risk", name: "Risk", prefix: "RI", required: ["title"] },
      files: [MODEL],
      versionsChanged: 0,
      missingRequired: 0,
      versionsChangedElements: [],
      missingRequiredElements: [],
      problems: [],
    });
    const created = (await invoke(
      "element.create",
      { type: "risk", title: "Hail" },
      { workspace },
    )) as CommandOutput<"element.create">;
    expect(created.element).toMatchObject({ type: "risk", shortId: expect.stringMatching(/^RI-/) as string });

    const base = await add(workspace, { name: "Hazard", prefix: "HZ", abstract: true, extends: "risk" });
    expect(base.type).toEqual({
      key: "hazard",
      name: "Hazard",
      prefix: "HZ",
      extends: "risk",
      abstract: true,
    });
    const refused = await invoke("element.create", { type: "hazard", title: "Storm" }, { workspace }).catch(
      (e: unknown) => e,
    );
    expect(refused).toMatchObject({ code: "input.invalid", details: { type: "hazard", reason: "abstract" } });
    const meta = (await invoke("metamodel.get", {}, { workspace })) as CommandOutput<"metamodel.get">;
    expect(meta.types.find((t) => t.key === "hazard")).toMatchObject({ required: ["title"], abstract: true });
  });

  it("gives no required property when the metamodel has no property with the meaning title", async () => {
    const { workspace } = await own();
    expect((await add(workspace, RISK)).type).toEqual({ key: "risk", name: "Risk", prefix: "RI" });
  });
});

describe("metamodel commands: the frame as metamodel.addType shows it (SR-236)", () => {
  it("[SR-236/AK-sx7z] refuses a type that would give the metamodel an error and names it; writes with warnings and names them", async () => {
    const { workspace, read } = await open();
    const before = await read(MODEL);
    const unknown = await failure(workspace, { ...RISK, extends: "hazard" });
    expect(unknown.code).toBe("input.invalid");
    expect(unknown.details).toMatchObject({
      reason: "metamodel-invalid",
      problems: [{ code: "metamodel.invalid", severity: "error", file: MODEL, repository: "system" }],
    });
    expect(unknown.message).toContain("hazard");
    const twice = await failure(workspace, { ...RISK, key: "need" });
    expect(twice.details).toMatchObject({ reason: "metamodel-invalid" });
    expect(twice.message).toContain("Type key need is already defined");
    expect(await read(MODEL)).toBe(before);

    // A type that names an unknown property is only a warning: written, and named.
    const { workspace: warned } = await own({
      [OWN.types]: `${await fs.readFile(path.join(import.meta.dirname, "../../../../../fixtures/SR-018/own-repository", OWN.types), "utf8")}  - key: old\n    name: Old\n    prefix: O\n    properties: [gone]\n`,
    });
    const added = await add(warned, RISK);
    expect(added.problems.map((p) => [p.code, p.severity, p.file])).toEqual([
      ["metamodel.invalid", "warning", "model/types.yaml"],
    ]);
  });

  it("[SR-236/AK-rk7z] refuses a name or a prefix another type has and writes nothing", async () => {
    const { workspace, read } = await open();
    const before = await read(MODEL);
    const name = await failure(workspace, { name: "Need", prefix: "ND" });
    expect([name.code, name.details]).toEqual([
      "input.invalid",
      { reason: "taken", field: "name", type: "need" },
    ]);
    // The same name in another Unicode normal form is the same name.
    const { workspace: named } = await own({
      [OWN.types]: "reqseq-metamodel: 1\ntypes:\n  - { key: waste, name: M\u00fcll, prefix: W }\n",
    });
    const nfd = await failure(named, { name: "Mu\u0308ll", prefix: "MU" });
    expect(nfd.details).toEqual({ reason: "taken", field: "name", type: "waste" });
    const prefix = await failure(workspace, { name: "Risk", prefix: "SR" });
    expect([prefix.code, prefix.details]).toEqual([
      "input.invalid",
      { reason: "taken", field: "prefix", type: "system-requirement" },
    ]);
    expect(await read(MODEL)).toBe(before);
  });

  it("[SR-236/AK-k2s3] changes only the lines it adds in the metamodel file, no element file and nothing in Git, and names the file", async () => {
    const opened = await open({ git: true });
    const { fixture, workspace } = opened;
    const head = await fixture.git(["rev-parse", "HEAD"]);
    const gitBefore = await snapshot(fixture.path(".git"));
    const before = await snapshot(fixture.root);
    const added = await add(workspace, RISK);
    expect(added.files).toEqual([MODEL]);
    const after = await snapshot(fixture.root);
    const changed = Object.keys(after).filter((file) => after[file] !== before[file]);
    expect(changed.filter((file) => !file.startsWith(".git"))).toEqual([path.normalize(MODEL)]);
    // Every line stays, comments and line endings included; the new lines follow the last type.
    const old = before[path.normalize(MODEL)] ?? "";
    const at = old.indexOf("\nproperties:");
    expect(after[path.normalize(MODEL)]).toBe(`${old.slice(0, at)}${RISK_LINES}${old.slice(at)}`);
    expect(await fixture.git(["rev-parse", "HEAD"])).toBe(head);
    expect(await snapshot(fixture.path(".git"))).toEqual(gitBefore);
    expect(await fixture.git(["status", "--porcelain"])).toBe(` M ${MODEL}\n`);
  });

  it("[SR-236/AK-yf6d] puts a new type into the first file by name that has types, else at the end of the first file", async () => {
    const opened = await own();
    expect((await add(opened.workspace, RISK)).files).toEqual(["../models/model/types.yaml"]);

    // Without types in any file: the list starts at the end of the first file by name.
    const properties = await fs.readFile(
      path.join(import.meta.dirname, "../../../../../fixtures/SR-018/own-repository", OWN.properties),
      "utf8",
    );
    const none = await own({
      [OWN.types]: "reqseq-metamodel: 1\n",
      "models/model/a-statuses.yaml": "reqseq-metamodel: 1   # first by name\n",
    });
    const added = await add(none.workspace, RISK);
    expect(added.files).toEqual(["../models/model/a-statuses.yaml"]);
    expect(await none.read("models/model/a-statuses.yaml")).toBe(
      "reqseq-metamodel: 1   # first by name\ntypes:\n  - key: risk\n    name: Risk\n    prefix: RI\n",
    );
    expect(await none.read(OWN.types)).toBe("reqseq-metamodel: 1\n");
    expect(await none.read(OWN.properties)).toBe(properties);

    // A first file that ends with a document end marker gets the list before it.
    const marked = await own({
      [OWN.types]: "reqseq-metamodel: 1\n",
      "models/model/a-statuses.yaml": "reqseq-metamodel: 1\n...\n",
    });
    await add(marked.workspace, RISK);
    expect(await marked.read("models/model/a-statuses.yaml")).toBe(
      "reqseq-metamodel: 1\ntypes:\n  - key: risk\n    name: Risk\n    prefix: RI\n...\n",
    );
  });

  it("[SR-236/AK-cv7t] refuses on a read-only metamodel repository, a metamodel that does not read and a list behind a YAML alias, and writes nothing", async () => {
    // Read-only: simulated, as the tests may run as root; a POSIX platform (see isWritableFolder).
    const readOnly = await own();
    const platform = Object.getOwnPropertyDescriptor(process, "platform");
    Object.defineProperty(process, "platform", { value: "linux" });
    onTestFinished(() => {
      if (platform !== undefined) {
        Object.defineProperty(process, "platform", platform);
      }
    });
    const models = readOnly.fixture.path("models");
    const access = fs.access.bind(fs);
    vi.spyOn(fs, "access").mockImplementation((target, mode) =>
      target === models
        ? Promise.reject(Object.assign(new Error("EROFS"), { code: "EROFS" }))
        : access(target, mode),
    );
    const before = await readOnly.read(OWN.types);
    const denied = await failure(readOnly.workspace, RISK);
    expect([denied.code, denied.message, denied.details]).toEqual([
      "file.read-only",
      "The metamodel repository models is read-only; metamodel.addType changes no file",
      { repository: "models" },
    ]);
    expect(await readOnly.read(OWN.types)).toBe(before);
    vi.restoreAllMocks();

    const faulty = await own({ "models/model/statuses.yaml": "reqseq-metamodel: 1\nstatuses: [\n" });
    const unreadable = await failure(faulty.workspace, RISK);
    expect(unreadable.code).toBe("workspace.read-only");
    expect(unreadable.details).toMatchObject({
      problems: [{ code: "file.invalid-yaml", file: "model/statuses.yaml" }],
    });

    const anchored = await own({
      [OWN.types]: "reqseq-metamodel: 1\ntypes: &all\n  - { key: need, name: Need, prefix: N }\n",
    });
    const alias = await failure(anchored.workspace, RISK);
    expect([alias.code, alias.details]).toEqual([
      "file.faulty",
      { file: "model/types.yaml", line: 2, repository: "models" },
    ]);
    expect(await anchored.read(OWN.types)).toBe(
      "reqseq-metamodel: 1\ntypes: &all\n  - { key: need, name: Need, prefix: N }\n",
    );
  });

  it("[SR-236/AK-n13v] makes the key from the name, or refuses and asks for one; a given key is taken as it is", async () => {
    const { workspace } = await open();
    expect((await add(workspace, { name: "Über-Größe  Maß / Ölstand 2", prefix: "UG" })).type.key).toBe(
      "ueber-groesse-mass-oelstand-2",
    );
    // An umlaut written as a base letter and a combining mark counts as the umlaut (NFC).
    expect((await add(workspace, { name: "Müll", prefix: "MU" })).type.key).toBe("muell");
    // Other letters with a diacritic lose it (İ is I and a dot); the Kelvin sign is the letter K in NFC.
    expect((await add(workspace, { name: "Café Order", prefix: "CO" })).type.key).toBe("cafe-order");
    expect((await add(workspace, { name: "\u0130ris \u212Aelvin", prefix: "IK" })).type.key).toBe(
      "iris-kelvin",
    );
    expect((await add(workspace, { name: "Line\u2028Break", prefix: "LB" })).type.name).toBe(
      "Line\u2028Break",
    );
    expect((await add(workspace, { name: "Hazard", prefix: "HZ", key: "danger" })).type.key).toBe("danger");
    for (const [name, key, why] of [
      ["2nd level", "2nd-level", "does not start with a letter"],
      ["***", "", "is empty"],
      [`R${"x".repeat(64)}`, `r${"x".repeat(64)}`, "is longer than 64 characters"],
      ["NEED!", "need", "is already the key of a type"],
    ] as const) {
      const refused = await failure(workspace, { name, prefix: "Q" });
      expect([refused.code, refused.details]).toEqual(["input.invalid", { reason: "key-required", key }]);
      expect(refused.message).toContain(why);
    }
  });

  it("[SR-236/AK-drrw] works with the new metamodel at once in the same process and counts the elements whose version changes or that miss a required property", async () => {
    const UNKNOWN = "0b7c6e1a-1111-4222-8333-000000000001";
    const PLAIN = "0b7c6e1a-1111-4222-8333-000000000002";
    const { workspace } = await open({
      files: {
        // Elements of a type the metamodel does not know yet.
        "risks/X-000000000001.md": `---\nid: ${UNKNOWN}\ntype: risk\ntitle: Hail\nrequirement-type: functional\n---\n`,
        "risks/X-000000000002.md": `---\nid: ${PLAIN}\ntype: risk\n---\n`,
        // One that has every required value: its version changes, nothing is missing.
        "risks/X-000000000003.md": `---\nid: 0b7c6e1a-1111-4222-8333-000000000003\ntype: risk\ntitle: Ice\nrequirement-type: functional\nacceptance-criteria: [It warns.]\n---\n`,
      },
    });
    await invoke("metamodel.get", {}, { workspace });
    const added = await add(workspace, { ...RISK, extends: "system-requirement" });
    // The first two now miss acceptance-criteria (the second its title too); the first and the third
    // have a value that counts to the version.
    expect([added.versionsChanged, added.missingRequired]).toEqual([2, 2]);
    // Each number names its elements, by the short IDs of the new type (SR-224 AK4).
    const named = (list: readonly { readonly id: string; readonly shortId: string }[]): string[] =>
      list.map((e) => `${e.id.slice(-1)} ${e.shortId.slice(0, 3)}`);
    expect([named(added.versionsChangedElements), named(added.missingRequiredElements)]).toEqual([
      ["1 RI-", "3 RI-"],
      ["1 RI-", "2 RI-"],
    ]);
    expect(added.versionsChangedElements[0]?.repository).toBe(added.missingRequiredElements[0]?.repository);
    const meta = (await invoke("metamodel.get", {}, { workspace })) as CommandOutput<"metamodel.get">;
    expect(meta.types.map((t) => t.key)).toContain("risk");
    const got = (await invoke(
      "element.get",
      { ref: UNKNOWN },
      { workspace },
    )) as CommandOutput<"element.get">;
    expect(got.element.shortId).toMatch(/^RI-/);
  });

  it("[SR-236/AK-jskb] runs calls that arrive at the same time one after the other, each on the metamodel the one before wrote", async () => {
    const { workspace, read } = await open();
    const results = await Promise.allSettled([
      add(workspace, RISK),
      add(workspace, { name: "Hazard", prefix: "HZ", extends: "risk" }),
      add(workspace, { name: "Risk", prefix: "RX" }),
    ]);
    expect(results.map((r) => r.status)).toEqual(["fulfilled", "fulfilled", "rejected"]);
    expect((results[2] as PromiseRejectedResult).reason).toMatchObject({
      details: { reason: "taken", field: "name" },
    });
    const text = await read(MODEL);
    expect(text).toContain(
      `${RISK_LINES}  - key: hazard\n    name: Hazard\n    prefix: HZ\n    extends: risk\n`,
    );
  });

  it("[SR-236/AK-rtcn] writes the same bytes and gives the same output for the same input and metamodel", async () => {
    const first = await open();
    const second = await open();
    const input = { name: "Risk Item", prefix: "RI", extends: "need" };
    expect(await add(first.workspace, input)).toEqual(await add(second.workspace, input));
    expect(await first.read(MODEL)).toBe(await second.read(MODEL));
  });
});
