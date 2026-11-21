// element.create with nextIdentifier (SR-245): the identifier after the highest of the type with the
// same identifier prefix. On fixtures/enabler-305/identifiers, whose types keep their spec ID in
// spec-id (meaning identifier): SR-036 and SR-037, N-001 and D-047.
import fs from "node:fs/promises";
import { createFixtureWorkspace } from "@reqseq/testkit";
import type { FixtureOptions } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import type { CommandOutput } from "../../catalog.js";
import { invoke } from "../../runtime/invoke.js";
import { Workspace } from "../../runtime/workspace.js";

type Output = CommandOutput<"element.create">;

interface Opened {
  readonly workspace: Workspace;
  /** The Markdown files of the workspace with their content, to show that nothing was written. */
  readonly files: () => Promise<Record<string, string>>;
  /** One file, by its path relative to the workspace root. */
  readonly read: (file: string) => Promise<string>;
}

const open = async (
  files: FixtureOptions["files"] = {},
  fixture = "enabler-305/identifiers",
): Promise<Opened> => {
  const ws = await createFixtureWorkspace({ fixture, files });
  onTestFinished(() => ws.cleanup());
  const workspace = new Workspace(ws.root);
  onTestFinished(() => workspace.close());
  const read = async (): Promise<Record<string, string>> => {
    const entries = await fs.readdir(ws.root, { recursive: true });
    const markdown = entries.filter((entry) => entry.endsWith(".md")).sort();
    return Object.fromEntries(
      await Promise.all(
        markdown.map(async (file) => [file, await fs.readFile(ws.path(file), "utf8")] as const),
      ),
    );
  };
  return { workspace, files: read, read: (file) => fs.readFile(ws.path(file), "utf8") };
};

/** The file of an element of `type` with the identifier `specId`; `tail` makes UUID and file name. */
const element = (
  tail: number,
  specId: string,
  type = "system-requirement",
  status = "draft",
): Record<string, string> => {
  const hex = tail.toString(16).padStart(12, "0");
  const prefix = type === "system-requirement" ? "SR" : type === "decision" ? "D" : "N";
  return {
    [`more/${prefix}-${hex}.md`]:
      `---\nid: 24500000-0000-4000-8000-${hex}\ntype: ${type}\nstatus: ${status}\ntitle: Element ${String(tail)}\n` +
      `spec-id: ${JSON.stringify(specId)}\n---\n`,
  };
};

/** Elements with the given identifiers, tails from 0x100 on. */
const elements = (...specIds: readonly string[]): Record<string, string> =>
  Object.fromEntries(specIds.flatMap((specId, index) => Object.entries(element(0x100 + index, specId))));

const create = async (opened: Opened, input: Record<string, unknown>): Promise<Output> =>
  (await invoke(
    "element.create",
    { type: "system-requirement", title: "New", ...input },
    { workspace: opened.workspace },
  )) as Output;

const identifierOf = (output: Output): unknown => output.element.properties["spec-id"];

/** The call is refused with `input.invalid` and `reason`, and no file changes. */
const refused = async (opened: Opened, input: Record<string, unknown>, reason: string): Promise<void> => {
  const before = await opened.files();
  await expect(create(opened, input)).rejects.toMatchObject({ code: "input.invalid", details: { reason } });
  expect(await opened.files()).toEqual(before);
};

describe("element.create with nextIdentifier (SR-245)", () => {
  it("[SR-245/AK-tskf] follows the highest number of the type, other types and identifiers without a number not counted", async () => {
    const specIds = Array.from({ length: 243 }, (_, i) => `SR-${String(i + 1)}`).filter(
      (id) => id !== "SR-36" && id !== "SR-37",
    );
    const opened = await open({
      ...elements(...specIds),
      // The fixture's SR-036 and SR-037 count as 36 and 37.
      // Another type, an identifier that ends in white space, one of digits only and a file that is no element count for nothing.
      ...element(0x201, "SR-900", "decision"),
      ...element(0x202, "SR-901 "),
      ...element(0x203, "902"),
      "more/SR-000000000204.md": "---\nid: [broken\nspec-id: SR-903\n---\n",
    });
    const out = await create(opened, { nextIdentifier: true });
    expect(identifierOf(out)).toBe("SR-244");
    expect(out.incomplete).toBeUndefined();
    const file = await opened.read(out.files[0] ?? "");
    expect(file).toContain("spec-id: SR-244\n");
  });

  it("[SR-245/AK-tskf] counts an element with an invalid status and a superseded one", async () => {
    // obsolete is marked invalid in the fixture's metamodel.
    const invalid = await open({
      ...elements("SR-40"),
      ...element(0x200, "sr-300", "system-requirement", "obsolete"),
    });
    expect(identifierOf(await create(invalid, { nextIdentifier: true }))).toBe("sr-301");
    // SR-400 superseded by SR-040 through element.supersede, which also sets the invalid status.
    const superseded = await open(elements("SR-400", "SR-40"));
    await invoke(
      "element.supersede",
      { ref: "SR-400", status: "obsolete", successor: "SR-40" },
      { workspace: superseded.workspace },
    );
    expect(await superseded.read("more/SR-000000000101.md")).toContain("supersedes:");
    expect(identifierOf(await create(superseded, { nextIdentifier: true }))).toBe("SR-401");
  });

  it("[SR-245/AK-tskf] has no upper bound", async () => {
    const opened = await open(elements("SR-99999999999999999999"));
    expect(identifierOf(await create(opened, { nextIdentifier: true }))).toBe("SR-100000000000000000000");
  });

  it("[SR-245/AK-w5bw] keeps the digits and the prefix as written of the identifier it follows", async () => {
    const padded = await open({
      ...element(0x100, "VAR-003", "decision"),
      ...element(0x101, "VAR-001", "decision"),
    });
    // The decision type has D-047 as well, so the prefix is given.
    expect(
      identifierOf(
        await create(padded, { type: "decision", nextIdentifier: true, identifierPrefix: "VAR-" }),
      ),
    ).toBe("VAR-004");
    const longer = await open(elements("SR-999"));
    expect(identifierOf(await create(longer, { nextIdentifier: true }))).toBe("SR-1000");
  });

  it("[SR-245/AK-w5bw] takes the most digits among the highest numbers, then the first file by repository and path", async () => {
    const digits = await open(elements("SR-50", "sr-050"));
    expect(identifierOf(await create(digits, { nextIdentifier: true }))).toBe("sr-051");
    // Same number and digits: the file more/SR-…100.md comes before more/SR-…101.md.
    const place = await open(elements("Sr-60", "SR-60"));
    expect(identifierOf(await create(place, { nextIdentifier: true }))).toBe("Sr-61");
  });

  it("[SR-245/AK-zh91] refuses several prefixes without a given one and names them", async () => {
    const opened = await open(elements("REQ-1", "req-7", "Req-2"));
    await refused(opened, { nextIdentifier: true }, "several-prefixes");
    await expect(create(opened, { nextIdentifier: true })).rejects.toMatchObject({
      details: { count: 2, prefixes: ["req-", "SR-"] },
    });
  });

  it("[SR-245/AK-zh91] names 20 of more than 20 prefixes: most identifiers first, then ascending in any case", async () => {
    const letters = "abcdefghijklmnopqrstu".split("");
    const opened = await open(
      elements(
        ...letters.map((letter, index) => `${index % 2 === 0 ? letter : letter.toUpperCase()}-1`),
        "Z-1",
        "Z-2",
        "Z-3",
      ),
    );
    // SR- has 2 identifiers (SR-036, SR-037), Z- 3, each letter 1: 23 prefixes.
    await expect(create(opened, { nextIdentifier: true })).rejects.toMatchObject({
      code: "input.invalid",
      details: {
        count: 23,
        prefixes: [
          "Z-",
          "SR-",
          ...letters.slice(0, 18).map((l, i) => `${i % 2 === 0 ? l : l.toUpperCase()}-`),
        ],
      },
    });
  });

  it("[SR-245/AK-kscz] follows a given prefix in any case, and starts a new one with 1 as written", async () => {
    const opened = await open(elements("REQ-4"));
    expect(identifierOf(await create(opened, { nextIdentifier: true, identifierPrefix: "sr-" }))).toBe(
      "SR-038",
    );
    expect(identifierOf(await create(opened, { nextIdentifier: true, identifierPrefix: "Story-" }))).toBe(
      "Story-1",
    );
  });

  it("[SR-245/AK-kvz3] refuses a new prefix that is empty, too long, ends with a digit, has a control character or line break, or white space at an end", async () => {
    const opened = await open(elements(" SR-4"));
    for (const prefix of ["", "x".repeat(101), "SR-2", "S\tR-", "S\nR-", "S R-", " REQ-", "REQ- "]) {
      await refused(opened, { nextIdentifier: true, identifierPrefix: prefix }, "invalid-prefix");
    }
    // 100 characters and a prefix an identifier carries are taken.
    expect(
      identifierOf(await create(opened, { nextIdentifier: true, identifierPrefix: "x".repeat(100) })),
    ).toBe(`${"x".repeat(100)}1`);
    expect(identifierOf(await create(opened, { nextIdentifier: true, identifierPrefix: " SR-" }))).toBe(
      " SR-5",
    );
  });

  it("[SR-245/AK-qp1p] refuses a type without a property with the meaning identifier", async () => {
    const opened = await open({}, "SR-001/two-elements");
    await refused(opened, { nextIdentifier: true, identifierPrefix: "SR-" }, "no-identifier-property");
  });

  it("[SR-245/AK-qp1p] refuses a type that does not have the identifier property", async () => {
    const opened = await open({
      "metamodel/more.yaml":
        "reqseq-metamodel: 1\ntypes:\n  - { key: note, name: Note, prefix: NO, properties: [title], required: [title] }\n",
    });
    await refused(
      opened,
      { type: "note", nextIdentifier: true, identifierPrefix: "NO-" },
      "no-identifier-property",
    );
  });

  it("[SR-245/AK-pf8m] refuses the identifier given as a property as well", async () => {
    const opened = await open();
    await refused(opened, { nextIdentifier: true, properties: { "spec-id": "SR-100" } }, "identifier-given");
  });

  it("[SR-245/AK-fk37] refuses a type without an identifier that counts and names the prefix as the remedy", async () => {
    const opened = await open({
      "decisions/D-0000000c0047.md":
        "---\nid: 30500000-0000-4000-8000-0000000c0047\ntype: decision\nstatus: draft\ntitle: The spec lives in ReqSeq\nspec-id: D-\n---\n",
    });
    await refused(opened, { type: "decision", nextIdentifier: true }, "no-identifiers");
    await expect(create(opened, { type: "decision", nextIdentifier: true })).rejects.toThrow(
      /give identifierPrefix/u,
    );
  });

  it("[SR-245/AK-tc56] assigns from the elements here and marks the output incomplete while a repository is missing", async () => {
    const opened = await open({
      "reqseq-workspace.yaml":
        "reqseq-workspace: 1\nname: ReqSeq spec\nrepositories:\n" +
        '  - { name: spec, url: "git@git.example.com:reqseq/spec.git", main: true }\n' +
        '  - { name: vault, url: "git@git.example.com:reqseq/vault.git", path: ../vault }\n' +
        "metamodel: { repository: spec, path: metamodel }\n",
    });
    const out = await create(opened, { nextIdentifier: true });
    expect(identifierOf(out)).toBe("SR-038");
    expect(out.incomplete).toBe(true);
    expect((out as unknown as { readonly answer: string }).answer).toContain(
      "incomplete, as a repository is not available",
    );
    // Without nextIdentifier nothing is assigned, so nothing is incomplete.
    expect((await create(opened, {})).incomplete).toBeUndefined();
  });

  it("[SR-245/AK-cyr4] refuses an identifier prefix without nextIdentifier", async () => {
    const opened = await open();
    await refused(opened, { identifierPrefix: "SR-" }, "prefix-without-next-identifier");
    await refused(
      opened,
      { nextIdentifier: false, identifierPrefix: "SR-" },
      "prefix-without-next-identifier",
    );
  });

  it("[SR-166/AK-p44g] gives two calls at the same time in one process one identifier each (SR-245)", async () => {
    const opened = await open();
    const ctx = { workspace: opened.workspace, access: "mcp" as const };
    const input = { type: "system-requirement", title: "New", nextIdentifier: true };
    const outs = (await Promise.all([
      invoke("element.create", input, ctx),
      invoke("element.create", input, ctx),
    ])) as Output[];
    expect(outs.map(identifierOf).sort()).toEqual(["SR-038", "SR-039"]);
  });
});
