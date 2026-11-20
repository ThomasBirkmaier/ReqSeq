// metamodel.addProperty (SR-238 AK1) on the small model of the test helper, and the frame of the
// metamodel commands (SR-236) as the property commands show it.
import fs from "node:fs/promises";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import type { CommandOutput } from "../../catalog.js";
import {
  MODEL,
  SMALL_MODEL,
  elements,
  failure,
  openSmall,
  run,
  uuid,
} from "../metamodel-commands.test-helper.js";

/** The output as `invoke` gives it, with the answer sentence. */
type Added = CommandOutput<"metamodel.addProperty"> & { readonly answer: string };

const add = (workspace: Parameters<typeof run>[0], input: Record<string, unknown>): Promise<Added> =>
  run<Added>(workspace, "metamodel.addProperty", input);

/** The small model with `before` replaced by `after` (each exactly once). */
const replaced = (...pairs: readonly (readonly [string, string])[]): string =>
  pairs.reduce((text, [before, after]) => {
    expect(text.split(before)).toHaveLength(2);
    return text.replace(before, after);
  }, SMALL_MODEL);

const RELATIONS = "relations:\n";

describe("metamodel.addProperty gives a type a property (SR-238 AK1)", () => {
  it("[SR-238/AK-nd2d] gives a type an existing property or a new one with the fields of its kind, required or not", async () => {
    const { workspace, read } = await openSmall(elements([1, "note"]));
    // An existing property the type has neither itself nor inherited, as a required one.
    const existing = await add(workspace, { type: "note", property: "severity", required: true });
    expect(existing).toEqual({
      answer:
        "Gave the type note the required property Severity; 1 file written; 1 element now missing a required property.",
      type: "note",
      property: {
        key: "severity",
        name: "Severity",
        kind: "choice",
        choices: [
          { key: "low", name: "Low" },
          { key: "high", name: "High" },
        ],
      },
      required: true,
      defined: false,
      listedBy: [],
      files: [MODEL],
      versionsChanged: 0,
      missingRequired: 1,
      versionsChangedElements: [],
      missingRequiredElements: [{ id: uuid(1), repository: "system", shortId: "NO-000001" }],
      problems: [],
    });
    // A new one: name, kind and the fields of the kind; the key from the name.
    const fresh = await add(workspace, {
      type: "risk",
      required: false,
      name: "Mitigation steps",
      kind: "choice",
      many: true,
      maxItems: 2,
      choices: [{ name: "Avoid" }, { name: "Reduce", key: "lower" }],
    });
    expect(fresh.property).toEqual({
      key: "mitigation-steps",
      name: "Mitigation steps",
      kind: "choice",
      many: true,
      "max-items": 2,
      choices: [
        { key: "avoid", name: "Avoid" },
        { key: "lower", name: "Reduce" },
      ],
    });
    expect(fresh.defined).toBe(true);
    await add(workspace, {
      type: "hazard",
      required: false,
      name: "Cause",
      kind: "relation",
      targetTypes: ["note"],
    });
    expect(await read(MODEL)).toBe(
      replaced(
        ["    properties: [likelihood]\n", "    properties: [likelihood, mitigation-steps]\n"],
        ["    properties: [title, severity]\n", "    properties: [title, severity, cause]\n"],
        [
          "    required: [title]\n    statuses: [draft, noted]\n",
          "    required: [title, severity]\n    statuses: [draft, noted]\n",
        ],
        [
          RELATIONS,
          [
            "  - key: mitigation-steps",
            "    name: Mitigation steps",
            "    kind: choice",
            "    many: true",
            "    max-items: 2",
            "    choices:",
            "      - key: avoid",
            "        name: Avoid",
            "      - key: lower",
            "        name: Reduce",
            "  - key: cause",
            "    name: Cause",
            "    kind: relation",
            "    target-types: [note]",
            RELATIONS,
          ].join("\n"),
        ],
      ),
    );
    const meta = await run<CommandOutput<"metamodel.get">>(workspace, "metamodel.get", {});
    expect(meta.types.find((t) => t.key === "risk")?.properties).toEqual([
      "title",
      "severity",
      "cause",
      "likelihood",
      "mitigation-steps",
    ]);
  });

  it("lists a key once that the type names already without a definition, and names the other types that list it", async () => {
    const model = SMALL_MODEL.replace(
      "    properties: [title, remark]\n",
      "    properties: [title, remark, owner]\n",
    ).replace("    properties: [likelihood]\n", "    properties: [likelihood, owner]\n");
    const { workspace, read } = await openSmall({}, model);
    const added = await add(workspace, { type: "note", required: false, name: "Owner", kind: "text" });
    expect([added.listedBy, added.answer]).toEqual([
      ["risk"],
      "Gave the type note the new property Owner; also listed by risk; 1 file written.",
    ]);
    expect(await read(MODEL)).toContain("    properties: [title, remark, owner]\n");
    // Required already: the output says so, and nothing is listed again.
    const { workspace: required } = await openSmall(
      {},
      SMALL_MODEL.replace(
        "    required: [title]\n    statuses: [draft, noted]\n",
        "    required: [title, owner]\n    statuses: [draft, noted]\n",
      ),
    );
    expect(
      (await add(required, { type: "note", required: false, name: "Owner", kind: "text" })).required,
    ).toBe(true);
    // `many: false` is the default and describes no new property.
    expect(
      (await add(workspace, { type: "note", property: "severity", required: false, many: false })).defined,
    ).toBe(false);
  });

  it("refuses the keys every element file holds itself, made or given, as an error of the metamodel (D-012)", async () => {
    const { workspace, read } = await openSmall();
    const made = await failure(workspace, "metamodel.addProperty", {
      type: "note",
      required: false,
      name: "Status",
      kind: "text",
    });
    expect(made.details).toMatchObject({ reason: "metamodel-invalid" });
    expect(made.message).toContain("Property key status is a field every element has (D-012)");
    for (const key of ["id", "type"]) {
      const given = await failure(workspace, "metamodel.addProperty", {
        type: "note",
        required: false,
        name: "Ident",
        key,
        kind: "text",
      });
      expect(given.details).toMatchObject({ reason: "metamodel-invalid" });
      expect(given.message).toContain(`Property key ${key} is a field every element has (D-012)`);
    }
    expect(await read(MODEL)).toBe(SMALL_MODEL);
  });

  it("refuses a property the type has, an unknown type or property, and an input that is neither or both", async () => {
    const { workspace, read } = await openSmall();
    // Inherited from hazard.
    expect(
      (
        await failure(workspace, "metamodel.addProperty", {
          type: "risk",
          property: "severity",
          required: false,
        })
      ).details,
    ).toEqual({
      reason: "has-property",
      type: "risk",
      property: "severity",
    });
    expect(
      (
        await failure(workspace, "metamodel.addProperty", {
          type: "nope",
          property: "title",
          required: false,
        })
      ).details,
    ).toEqual({
      reason: "unknown",
      type: "nope",
    });
    expect(
      (await failure(workspace, "metamodel.addProperty", { type: "note", property: "nope", required: false }))
        .details,
    ).toEqual({
      reason: "unknown",
      property: "nope",
    });
    for (const input of [
      { type: "note", required: false },
      { type: "note", required: false, property: "severity", name: "Severity two" },
      { type: "note", required: false, name: "No kind" },
    ]) {
      expect((await failure(workspace, "metamodel.addProperty", input)).details).toEqual({
        reason: "property-or-new",
      });
    }
    // A field of another kind.
    for (const [kind, field, extra] of [
      ["text", "choices", { choices: [{ name: "A" }] }],
      ["choice", "target-types", { targetTypes: ["note"] }],
      ["relation", "max-items", { many: true, maxItems: 1 }],
    ] as const) {
      expect(
        (
          await failure(workspace, "metamodel.addProperty", {
            type: "note",
            required: false,
            name: "X",
            kind,
            ...extra,
          })
        ).details,
      ).toEqual({ reason: "kind-field", field, kind });
    }
    expect(
      (
        await failure(workspace, "metamodel.addProperty", {
          type: "note",
          required: false,
          name: "X",
          kind: "text",
          maxItems: 2,
        })
      ).details,
    ).toEqual({ reason: "single-value" });
    expect(await read(MODEL)).toBe(SMALL_MODEL);
  });
});

describe("metamodel commands: the frame as the property commands show it (SR-236)", () => {
  it("[SR-236/AK-sx7z] refuses a property change that would give the metamodel an error and names it; writes with warnings", async () => {
    const { workspace, read } = await openSmall();
    // A second key with the meaning title is an error.
    const twice = await failure(workspace, "metamodel.changeProperty", {
      property: "remark",
      meaning: "title",
    });
    expect(twice.details).toMatchObject({ reason: "metamodel-invalid" });
    expect(twice.message).toContain("title");
    // A target type no type has.
    const unknown = await failure(workspace, "metamodel.addProperty", {
      type: "note",
      required: false,
      name: "Link",
      kind: "relation",
      targetTypes: ["nope"],
    });
    expect(unknown.details).toMatchObject({ reason: "metamodel-invalid" });
    expect(await read(MODEL)).toBe(SMALL_MODEL);
    // A type that names an undefined property is only a warning: written, and named.
    const { workspace: warned } = await openSmall(
      {},
      SMALL_MODEL.replace("    properties: [likelihood]\n", "    properties: [likelihood, gone]\n"),
    );
    const added = await add(warned, { type: "note", property: "severity", required: false });
    expect(added.problems.map((p) => [p.code, p.severity])).toEqual([["metamodel.invalid", "warning"]]);
  });

  it("[SR-236/AK-rk7z] refuses a property or fixed value name that its list has already and writes nothing", async () => {
    const { workspace, read } = await openSmall();
    expect(
      (
        await failure(workspace, "metamodel.addProperty", {
          type: "note",
          required: false,
          name: "Likelihood",
          kind: "text",
        })
      ).details,
    ).toEqual({
      reason: "taken",
      field: "name",
      key: "likelihood",
    });
    expect(
      (await failure(workspace, "metamodel.changeProperty", { property: "remark", name: "Title" })).details,
    ).toEqual({
      reason: "taken",
      field: "name",
      key: "title",
    });
    expect(
      (
        await failure(workspace, "metamodel.changeProperty", {
          property: "severity",
          addChoices: [{ name: "High", key: "top" }],
        })
      ).details,
    ).toEqual({
      reason: "taken",
      field: "name",
      key: "high",
    });
    expect(
      (
        await failure(workspace, "metamodel.changeProperty", {
          property: "severity",
          changeChoices: [{ choice: "low", name: "High" }],
        })
      ).details,
    ).toEqual({
      reason: "taken",
      field: "name",
      key: "high",
    });
    expect(
      (
        await failure(workspace, "metamodel.addProperty", {
          type: "note",
          required: false,
          name: "Grade",
          kind: "choice",
          choices: [{ name: "A" }, { name: "A", key: "a2" }],
        })
      ).details,
    ).toEqual({
      reason: "taken",
      field: "name",
      key: "a",
    });
    expect(await read(MODEL)).toBe(SMALL_MODEL);
  });

  it("[SR-236/AK-k2s3] changes only the lines of the changed fields, no element file and nothing in Git, and names the file", async () => {
    const files = elements([1, "note", { remark: "Kept" }]);
    const { fixture, workspace, read } = await openSmall(files, SMALL_MODEL, { git: true });
    const commented = "    name: Severity   # how bad\n";
    await fs.writeFile(
      fixture.path(MODEL),
      SMALL_MODEL.replace("    name: Severity\n", commented).replaceAll("\n", "\r\n"),
    );
    await fixture.git(["commit", "--quiet", "--all", "--message", "CRLF"]);
    const head = await fixture.git(["rev-parse", "HEAD"]);
    const changed = await run<CommandOutput<"metamodel.changeProperty">>(
      workspace,
      "metamodel.changeProperty",
      {
        property: "severity",
        description: "How bad",
        removeChoices: ["high"],
        addChoices: [{ name: "Severe" }],
      },
    );
    expect(changed.files).toEqual([MODEL]);
    const severity = [
      "  - key: severity",
      "    name: Severity   # how bad",
      "    kind: choice",
      "    choices:",
      "      - { key: low, name: Low }",
      "      - key: severe",
      "        name: Severe",
      "    description: How bad",
      "",
    ].join("\r\n");
    const before = SMALL_MODEL.replace("    name: Severity\n", commented).replaceAll("\n", "\r\n");
    const old = before.slice(before.indexOf("  - key: severity"), before.indexOf("  - { key: likelihood"));
    expect(await read(MODEL)).toBe(before.replace(old, severity));
    // Changing a line loses the comment at its end; the other lines keep theirs.
    await run(workspace, "metamodel.changeProperty", { property: "severity", name: "Impact" });
    expect(await read(MODEL)).toBe(
      before.replace(old, severity.replace("    name: Severity   # how bad", "    name: Impact")),
    );
    for (const [file, text] of Object.entries(files)) {
      expect(await read(file)).toBe(text);
    }
    expect(await fixture.git(["rev-parse", "HEAD"])).toBe(head);
    expect(await fixture.git(["status", "--porcelain"])).toBe(` M ${MODEL}\n`);
  });

  it("[SR-236/AK-yf6d] puts a new property into the first file by name that has properties and changes a definition in its own file", async () => {
    const { workspace, read } = await openSmall({
      "metamodel/a-types.yaml": "reqseq-metamodel: 1\ntypes:\n  - { key: task, name: Task, prefix: TA }\n",
      "metamodel/b-properties.yaml":
        "reqseq-metamodel: 1\nproperties:\n  - { key: effort, name: Effort, kind: number }\n",
    });
    const added = await add(workspace, { type: "task", required: false, name: "Owner", kind: "text" });
    expect(added.files).toEqual(["metamodel/a-types.yaml", "metamodel/b-properties.yaml"]);
    expect(await read("metamodel/a-types.yaml")).toBe(
      "reqseq-metamodel: 1\ntypes:\n  - { key: task, name: Task, prefix: TA, properties: [owner] }\n",
    );
    expect(await read("metamodel/b-properties.yaml")).toBe(
      "reqseq-metamodel: 1\nproperties:\n  - { key: effort, name: Effort, kind: number }\n  - key: owner\n    name: Owner\n    kind: text\n",
    );
    const changed = await run<CommandOutput<"metamodel.changeProperty">>(
      workspace,
      "metamodel.changeProperty",
      {
        property: "effort",
        name: "Work",
      },
    );
    expect(changed.files).toEqual(["metamodel/b-properties.yaml"]);
    expect(await read(MODEL)).toBe(SMALL_MODEL);

    // No file has the list: it starts at the end of the first file by name.
    const bare = await openSmall(
      {
        "metamodel/a-types.yaml": "reqseq-metamodel: 1\ntypes:\n  - { key: task, name: Task, prefix: TA }\n",
      },
      "reqseq-metamodel: 1\nstatuses:\n  - { key: draft, name: Draft, initial: true }\n",
    );
    await add(bare.workspace, { type: "task", required: true, name: "Owner", kind: "text" });
    expect(await bare.read("metamodel/a-types.yaml")).toBe(
      "reqseq-metamodel: 1\ntypes:\n  - { key: task, name: Task, prefix: TA, required: [owner] }\nproperties:\n  - key: owner\n    name: Owner\n    kind: text\n",
    );
    // Not required any more: a type without its own `properties` gets the list.
    await run(bare.workspace, "metamodel.changeProperty", {
      property: "owner",
      type: "task",
      required: false,
    });
    expect(await bare.read("metamodel/a-types.yaml")).toContain(
      "  - { key: task, name: Task, prefix: TA, required: [], properties: [owner] }\n",
    );
  });

  it("[SR-236/AK-cv7t] refuses a property change on a definition with a YAML anchor or alias, names file and line, and writes nothing", async () => {
    const model = SMALL_MODEL.replace(
      "  - { key: remark, name: Remark, kind: text }\n",
      "  - { key: remark, name: &r Remark, kind: text }\n",
    );
    const { workspace, read } = await openSmall({}, model);
    const refusedChange = await failure(workspace, "metamodel.changeProperty", {
      property: "remark",
      description: "Free text",
    });
    expect([refusedChange.code, refusedChange.details]).toEqual([
      "file.faulty",
      { file: MODEL, line: 31, repository: "system" },
    ]);
    // An anchor in the type the property is given to.
    const typed = await openSmall({}, SMALL_MODEL.replace("    name: Note\n", "    name: &n Note\n"));
    const refused = await failure(typed.workspace, "metamodel.addProperty", {
      type: "note",
      property: "severity",
      required: false,
    });
    expect([refused.code, refused.details]).toEqual([
      "file.faulty",
      { file: MODEL, line: 16, repository: "system" },
    ]);
    expect(await typed.read(MODEL)).toBe(SMALL_MODEL.replace("    name: Note\n", "    name: &n Note\n"));
    expect(await read(MODEL)).toBe(model);

    // A metamodel that does not read refuses every property command.
    const faulty = await openSmall({ "metamodel/z.yaml": "reqseq-metamodel: 1\nproperties: [\n" });
    expect(
      (await failure(faulty.workspace, "metamodel.removeProperty", { type: "note", property: "remark" }))
        .code,
    ).toBe("workspace.read-only");
    // Read-only metamodel repository: simulated, as the tests may run as root (see isWritableFolder).
    const readOnly = await openSmall();
    const platform = Object.getOwnPropertyDescriptor(process, "platform");
    Object.defineProperty(process, "platform", { value: "linux" });
    onTestFinished(() => {
      if (platform !== undefined) {
        Object.defineProperty(process, "platform", platform);
      }
    });
    const access = fs.access.bind(fs);
    vi.spyOn(fs, "access").mockImplementation((target, mode) =>
      target === readOnly.fixture.root
        ? Promise.reject(Object.assign(new Error("EROFS"), { code: "EROFS" }))
        : access(target, mode),
    );
    onTestFinished(() => {
      vi.restoreAllMocks();
    });
    const denied = await failure(readOnly.workspace, "metamodel.addProperty", {
      type: "note",
      property: "severity",
      required: false,
    });
    expect(denied.code).toBe("file.read-only");
    expect(await readOnly.read(MODEL)).toBe(SMALL_MODEL);
  });

  it("[SR-236/AK-n13v] makes the key of a property and of a fixed value from the name, or refuses and asks for one", async () => {
    const { workspace } = await openSmall();
    const added = await add(workspace, {
      type: "note",
      required: false,
      name: "Größe der Wirkung",
      kind: "choice",
      choices: [{ name: "Groß" }, { name: "Sehr groß" }, { name: "Très fort" }],
    });
    expect(added.property).toMatchObject({
      key: "groesse-der-wirkung",
      choices: [
        { key: "gross", name: "Groß" },
        { key: "sehr-gross", name: "Sehr groß" },
        { key: "tres-fort", name: "Très fort" },
      ],
    });
    // A property key counts against the relation kinds too.
    for (const [input, key, why] of [
      [{ name: "About!" }, "about", "is already the key of a property or relation kind"],
      [{ name: "2 sides" }, "2-sides", "does not start with a letter"],
    ] as const) {
      const refused = await failure(workspace, "metamodel.addProperty", {
        type: "note",
        required: false,
        kind: "text",
        ...input,
      });
      expect([refused.details, refused.message.includes(why)]).toEqual([
        { reason: "key-required", key },
        true,
      ]);
    }
    // A given key another property or relation kind has is taken.
    expect(
      (
        await failure(workspace, "metamodel.addProperty", {
          type: "note",
          required: false,
          kind: "text",
          name: "Topic",
          key: "about",
        })
      ).details,
    ).toEqual({
      reason: "taken",
      field: "key",
      key: "about",
    });
    // A fixed value key: made from the name, or given, unique in its property.
    const choice = await failure(workspace, "metamodel.changeProperty", {
      property: "severity",
      addChoices: [{ name: "LOW!" }],
    });
    expect([choice.details, choice.message]).toEqual([
      { reason: "key-required", key: "low" },
      "Give a key: the key made from the name, low, is already the key of a fixed value of the property",
    ]);
    expect(
      (
        await failure(workspace, "metamodel.changeProperty", {
          property: "severity",
          addChoices: [{ name: "Lowest", key: "low" }],
        })
      ).details,
    ).toEqual({
      reason: "taken",
      field: "key",
      key: "low",
    });
  });

  it("[SR-236/AK-drrw] works with the new metamodel at once and counts the elements that miss a new required property", async () => {
    const { workspace } = await openSmall(
      elements([1, "note"], [2, "note", { remark: "Set" }], [3, "hazard", { remark: "Old" }]),
    );
    const added = await run<CommandOutput<"metamodel.changeProperty">>(
      workspace,
      "metamodel.changeProperty",
      {
        property: "remark",
        type: "note",
        required: true,
      },
    );
    expect([added.versionsChanged, added.missingRequired]).toEqual([0, 1]);
    const counted = await run<CommandOutput<"metamodel.changeProperty">>(
      workspace,
      "metamodel.changeProperty",
      {
        property: "remark",
        content: true,
      },
    );
    expect(counted.versionsChanged).toBe(1);
    const meta = await run<CommandOutput<"metamodel.get">>(workspace, "metamodel.get", {});
    expect(meta.types.find((t) => t.key === "note")?.required).toEqual(["title", "remark"]);
    // A property that counts to the version, given to a type whose element holds it.
    const given = await add(workspace, { type: "hazard", property: "remark", required: false });
    expect([given.versionsChanged, given.answer]).toEqual([
      1,
      "Gave the type hazard the property Remark; 1 file written; 1 element with another version.",
    ]);
  });

  it("[SR-236/AK-jskb] runs property calls that arrive at the same time one after the other", async () => {
    const { workspace, read } = await openSmall();
    const results = await Promise.allSettled([
      add(workspace, { type: "note", required: false, name: "Owner", kind: "text" }),
      add(workspace, { type: "hazard", required: false, property: "owner" }),
      add(workspace, { type: "note", required: false, name: "Owner", kind: "text" }),
    ]);
    expect(results.map((r) => r.status)).toEqual(["fulfilled", "fulfilled", "rejected"]);
    expect(await read(MODEL)).toContain("    properties: [title, severity, owner]\n");
  });

  it("[SR-236/AK-rtcn] writes the same bytes and gives the same output for the same property input and metamodel", async () => {
    const first = await openSmall();
    const second = await openSmall();
    const input = { type: "note", required: true, name: "Due date", kind: "date" };
    expect(await add(first.workspace, input)).toEqual(await add(second.workspace, input));
    expect(await first.read(MODEL)).toBe(await second.read(MODEL));
  });
});
