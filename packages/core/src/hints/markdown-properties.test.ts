// References in properties marked `markdown` (SR-127, #444) on fixtures/SR-025/outdated: outdated
// hints with `@text:<key>` IDs, confirming, missing targets, affected elements and writing.
import fs from "node:fs";
import path from "node:path";
import { createFixtureWorkspace } from "@logreq/testkit";
import type { FixtureWorkspace } from "@logreq/testkit";
import { parse } from "yaml";
import { describe, expect, it, onTestFinished } from "vitest";
import type { CommandOutput, Problem } from "../catalog.js";
import { CommandError } from "../catalog.js";
import { invoke } from "../runtime/invoke.js";
import { Workspace } from "../runtime/workspace.js";

const P = "5e025a7d-2b4f-4c61-9d08-0";
const N = `${P}a0000000001`;
const A = `${P}b0000000001`;
const N_FILE = "needs/N-0a0000000001.md";
const A_FILE = "requirements/SR-0b0000000001.md";
const N_VERSION = "n1:4a120bac998acdc8";
const AT_A = `system/${encodeURIComponent(A_FILE)}/${A}`;
const AC = `relation.outdated/${AT_A}/@text:acceptance-criteria/${N}?version=${N_VERSION}`;
const MODEL = path.resolve(import.meta.dirname, "../../../../schemas/examples/metamodel/standard-model.yaml");

const link = (label: string, version = N_VERSION): string => `[${label}](logreq:${N}?version=${version})`;

/** A with four criteria, one in each YAML style, all linking N at the version N has in the fixture. */
const requirement = (criteria: string): string =>
  `---\nid: ${A}\ntype: system-requirement\nstatus: draft\ntitle: Show wind speed\nrequirement-type: functional\n${criteria}---\n\nSo that the operator sees the wind.\n`;

const CRITERIA = [
  "acceptance-criteria:",
  `  - Given wind, when measured, then ${link("the wind")} is shown.`,
  `  - '**Then** it is "fast", see ${link("wind")}'`,
  `  - "Then ${link("wind")}: done"`,
  "  - |",
  `    Then ${link("wind")}`,
  "    and more.",
  "",
].join("\n");

const fixture = async (
  a = requirement(CRITERIA),
  model = fs.readFileSync(MODEL, "utf8"),
): Promise<FixtureWorkspace> => {
  const created = await createFixtureWorkspace({
    fixture: "SR-025/outdated",
    files: { [A_FILE]: a, "metamodel/standard-model.yaml": model },
  });
  onTestFinished(() => created.cleanup());
  return created;
};

const open = (root: string): Workspace => {
  const workspace = new Workspace(root);
  onTestFinished(() => workspace.close());
  return workspace;
};

/** Changes the text of N, so that every link to it with its fixture version is outdated. */
const changeN = (ws: FixtureWorkspace): Promise<void> =>
  ws.write(
    N_FILE,
    `---\nid: ${N}\ntype: need\nstatus: approved\ntitle: See the wind\n---\n\nThe operator sees wind speed and direction at a glance.\n`,
  );

const hints = async (workspace: Workspace): Promise<readonly Problem[]> =>
  ((await invoke("hint.list", { kind: ["relation.outdated"] }, { workspace })) as CommandOutput<"hint.list">)
    .hints;

const C = `${P}b0000000003`;
const C_FILE = "requirements/SR-0b0000000003.md";
const MISSING = `${P}f0000000009`;

/** A system requirement with the given frontmatter lines after the title. */
const requirementWith = (id: string, lines: string): string =>
  `---\nid: ${id}\ntype: system-requirement\nstatus: draft\ntitle: Other\nrequirement-type: functional\n${lines}---\n\nText.\n`;

const read = (ws: FixtureWorkspace, file: string): string => fs.readFileSync(ws.path(file), "utf8");

/** The hints about the criteria of A. */
const criteriaHints = async (workspace: Workspace): Promise<readonly Problem[]> =>
  (await hints(workspace)).filter((h) => h.hintId?.includes("/@text:") === true);

const confirm = async (
  workspace: Workspace,
  hintIds: readonly string[],
): Promise<CommandOutput<"hint.confirm">> =>
  (await invoke("hint.confirm", { hintIds }, { workspace })) as CommandOutput<"hint.confirm">;

const at = (n: number): string => `${AC}&n=${String(n)}`;

const frontmatterOf = (text: string): Record<string, unknown> =>
  parse(text.split("---\n")[1] ?? "") as Record<string, unknown>;

describe("references in properties marked markdown (SR-127)", () => {
  it("[SR-127/AK3] a changed target makes a reference in an acceptance criterion outdated, with a @text:acceptance-criteria hint that names the item and the line", async () => {
    const ws = await fixture();
    const workspace = open(ws.root);
    expect(await criteriaHints(workspace)).toEqual([]);
    await changeN(ws);
    const found = await criteriaHints(open(ws.root));
    expect(found.map((h) => [h.hintId, h.line])).toEqual([
      [at(1), 8],
      [at(2), 9],
      [at(3), 10],
      // The link in a block scalar: the line of the link, below the line with the `|`.
      [at(4), 12],
    ]);
    expect(found.map((h) => h.message.split(" points")[0])).toEqual(
      [1, 2, 3, 4].map(
        (item) =>
          `Reference in acceptance-criteria (item ${String(item)}) of System Requirement SR-b0000000001`,
      ),
    );
  });

  it("[SR-127/AK5] a link in the title or in a property the metamodel does not mark is no reference: no hint, no missing target, nothing affected", async () => {
    const ws = await fixture(
      requirementWith(
        A,
        `acceptance-criteria:\n  - Plain.\ntopic: See ${link("the wind")} and [gone](logreq:${MISSING}?version=${N_VERSION})\n`,
      ).replace(
        "title: Other",
        `title: See ${link("the wind")} and [gone](logreq:${MISSING}?version=${N_VERSION})`,
      ),
    );
    await changeN(ws);
    const workspace = open(ws.root);
    expect(await criteriaHints(workspace)).toEqual([]);
    const check = (await invoke("workspace.check", {}, { workspace })) as CommandOutput<"workspace.check">;
    expect(check.problems.filter((p) => p.file === A_FILE && p.code === "relation.missing-target")).toEqual(
      [],
    );
    const affected = (await invoke(
      "trace.affected",
      { ref: N },
      { workspace },
    )) as CommandOutput<"trace.affected">;
    // A has no relation to N here, and its links in the title and in topic are none.
    expect(affected.affected.map((a) => a.id)).not.toContain(A);
  });

  it("[SR-127/AK3] trace.affected of the target lists the element whose acceptance criterion references it", async () => {
    const ws = await fixture();
    await ws.write(C_FILE, requirementWith(C, `acceptance-criteria:\n  - "Then ${link("the wind")}."\n`));
    const workspace = open(ws.root);
    const affected = (await invoke(
      "trace.affected",
      { ref: N },
      { workspace },
    )) as CommandOutput<"trace.affected">;
    expect(affected.affected.find((a) => a.id === C)?.via).toEqual({ kind: "reference" });
  });

  it("[SR-127/AK3] a missing target in an acceptance criterion is reported like one in the text (SR-089), naming the property and the item", async () => {
    const ws = await fixture(
      requirementWith(
        A,
        `acceptance-criteria:\n  - Fine.\n  - "See [gone](logreq:${MISSING}?version=${N_VERSION})"\n`,
      ),
    );
    const workspace = open(ws.root);
    const check = (await invoke("workspace.check", {}, { workspace })) as CommandOutput<"workspace.check">;
    const [found] = check.problems.filter((p) => p.code === "relation.missing-target" && p.file === A_FILE);
    expect(found?.line).toBe(9);
    expect(found?.message).toMatch(/^Reference in acceptance-criteria \(item 2\) of /u);
    expect(found?.message).toContain(MISSING);
  });

  describe("hint.confirm", () => {
    it("[SR-127/AK3] hint.confirm writes the new version into that criterion only, in its own quoting (SR-027 AK1)", async () => {
      const ws = await fixture();
      await changeN(ws);
      const workspace = open(ws.root);
      const before = read(ws, A_FILE);
      const current = (await criteriaHints(workspace)).find((h) => h.hintId === at(2))?.currentVersion;
      expect(current).toMatch(/^n1:[0-9a-f]{16}$/u);
      expect(await confirm(workspace, [at(2)])).toEqual({
        confirmed: [at(2)],
        files: [A_FILE],
        problems: [],
      });
      // The single-quoted item of line 9 gets the version and nothing else; the lines of the other
      // criteria stay as they are.
      const lines = before.split("\n");
      const after = read(ws, A_FILE).split("\n");
      expect(after[8]).toBe((lines[8] ?? "").replace(N_VERSION, current ?? ""));
      expect(after.slice(6, 8)).toEqual(lines.slice(6, 8));
      expect(after.slice(9, 13)).toEqual(lines.slice(9, 13));
      // The others are still open, this one is gone (the links to the version that is left count from 1 again).
      expect((await criteriaHints(workspace)).map((h) => h.hintId)).toEqual([at(1), at(2), at(3)]);
    });

    it("[SR-127/AK4] confirming every criterion keeps each in its quoting, writes a block scalar as one line, and the YAML reads back with the new versions", async () => {
      const ws = await fixture();
      await changeN(ws);
      const workspace = open(ws.root);
      const current = (await criteriaHints(workspace))[0]?.currentVersion ?? "";
      const before = read(ws, A_FILE);
      const out = await confirm(workspace, [1, 2, 3, 4].map(at));
      expect(out.problems ?? []).toEqual([]);
      const after = read(ws, A_FILE);
      const lines = after.split("\n");
      expect(lines.slice(7, 10)).toEqual(
        before
          .split("\n")
          .slice(7, 10)
          .map((l) => l.replace(N_VERSION, current)),
      );
      expect(lines[7]).toBe(`  - Given wind, when measured, then ${link("the wind", current)} is shown.`);
      expect(lines[8]?.startsWith("  - '**Then**")).toBe(true);
      expect(lines[9]?.startsWith('  - "Then')).toBe(true);
      expect(frontmatterOf(after)["acceptance-criteria"]).toEqual([
        `Given wind, when measured, then ${link("the wind", current)} is shown.`,
        `**Then** it is "fast", see ${link("wind", current)}`,
        `Then ${link("wind", current)}: done`,
        `Then ${link("wind", current)}\nand more.\n`,
      ]);
      expect(await criteriaHints(workspace)).toEqual([]);
    });

    it("[SR-127/AK3] confirms a single value, plain and in a block scalar, of a property marked markdown", async () => {
      const decision = (rationale: string): string =>
        `---\nid: ${C}\ntype: decision\nstatus: draft\ntitle: Choose\n${rationale}---\n\nText.\n`;
      for (const [rationale, expected] of [
        [`rationale: Because ${link("the wind")}.\n`, (v: string) => `Because ${link("the wind", v)}.`],
        [
          `rationale: |\n  Because ${link("the wind")}.\n`,
          (v: string) => `Because ${link("the wind", v)}.\n`,
        ],
      ] as const) {
        const ws = await fixture();
        await ws.write(C_FILE, decision(rationale));
        await changeN(ws);
        const workspace = open(ws.root);
        const [found] = (await hints(workspace)).filter(
          (h) => h.hintId?.includes("/@text:rationale/") === true,
        );
        expect(found?.message).toMatch(/^Reference in rationale of /u);
        const current = found?.currentVersion ?? "";
        expect((await confirm(workspace, [found?.hintId ?? ""])).problems ?? []).toEqual([]);
        expect(frontmatterOf(read(ws, C_FILE))["rationale"]).toBe(expected(current));
      }
    });

    it("quotes an escaped link anew, leaves a value that is no text alone, and does not change a link held by an alias (#444)", async () => {
      const escaped = `acceptance-criteria:\n  - "Then [a](logreq:${N}?version=${N_VERSION}&repository=sys\\x74em)"\n  - 5\n`;
      const ws = await fixture(requirement(escaped));
      await changeN(ws);
      const workspace = open(ws.root);
      const [found] = await criteriaHints(workspace);
      expect(found?.hintId).toContain("&repository=system");
      expect((await confirm(workspace, [found?.hintId ?? ""])).problems ?? []).toEqual([]);
      expect(frontmatterOf(read(ws, A_FILE))["acceptance-criteria"]).toEqual([
        `Then [a](logreq:${N}?version=${found?.currentVersion ?? ""}&repository=system)`,
        5,
      ]);
      // A link held by an alias cannot be changed in place; the file is left as it is.
      const aliased = `acceptance-criteria:\n  - &c Then ${link("a")}\n  - *c\n`;
      const other = await fixture(requirement(aliased));
      await changeN(other);
      const again = open(other.root);
      const second = (await criteriaHints(again)).find((h) => h.hintId === at(2));
      const out = await confirm(again, [second?.hintId ?? ""]);
      expect(out.files).toEqual([]);
      expect((out.problems ?? []).map((p) => p.code)).toEqual(["hint.not-confirmable"]);
      expect(read(other, A_FILE)).toBe(requirement(aliased));
    });

    it("[SR-127/AK3] a hint ID of a property that holds no such link confirms nothing", async () => {
      const ws = await fixture();
      await changeN(ws);
      const workspace = open(ws.root);
      const unmarked = `relation.outdated/${AT_A}/@text:topic/${N}?version=${N_VERSION}&n=1`;
      const out = await confirm(workspace, [unmarked, at(9)]);
      expect(out.confirmed).toEqual([]);
      expect((out.problems ?? []).map((p) => p.code)).toEqual(["hint.not-found", "hint.not-found"]);
      expect(read(ws, A_FILE)).toBe(requirement(CRITERIA));
    });
  });

  describe("version (ADR-0005)", () => {
    const versionOf = async (workspace: Workspace, ref: string): Promise<string> =>
      ((await invoke("element.get", { ref }, { workspace })) as CommandOutput<"element.get">).element
        .version ?? "";

    it("[SR-127/AK5] the flag does not change the version of an element: the same file has the same version with and without markdown on its properties", async () => {
      const model = fs.readFileSync(MODEL, "utf8");
      const plain = model.replaceAll("    markdown: true\n", "");
      expect(plain).not.toBe(model);
      const marked = open((await fixture(requirement(CRITERIA), model)).root);
      const unmarked = open((await fixture(requirement(CRITERIA), plain)).root);
      expect(await versionOf(marked, A)).toMatch(/^n1:[0-9a-f]{16}$/u);
      expect(await versionOf(marked, A)).toBe(await versionOf(unmarked, A));
    });

    it("a reference confirmed in a property that counts changes the version of its element, in one that does not count it stays (#444)", async () => {
      const decision = `---\nid: ${C}\ntype: decision\nstatus: draft\ntitle: Choose\nrationale: Because ${link("the wind")}.\n---\n\nText.\n`;
      const ws = await fixture();
      await ws.write(C_FILE, decision);
      await changeN(ws);
      const workspace = open(ws.root);
      const [rationale] = (await hints(workspace)).filter(
        (h) => h.hintId?.includes("/@text:rationale/") === true,
      );
      const criteriaBefore = await versionOf(workspace, A);
      const decisionBefore = await versionOf(workspace, C);
      await confirm(workspace, [at(1), rationale?.hintId ?? ""]);
      expect(await versionOf(workspace, A)).not.toBe(criteriaBefore);
      expect(await versionOf(workspace, C)).toBe(decisionBefore);
    });
  });

  describe("writing", () => {
    const update = (workspace: Workspace, input: Record<string, unknown>): Promise<unknown> =>
      invoke("element.update", { ref: A, ...input }, { workspace });

    it("element.update stores a new reference in an acceptance criterion with id and version, and keeps one that is stored (#444)", async () => {
      const ws = await fixture();
      const workspace = open(ws.root);
      await update(workspace, {
        set: {
          "acceptance-criteria": [
            `Then ${link("kept")}.`,
            `**Then** [new](logreq:${N}).`,
            "No link here.",
            "With a label only: [x](https://example.com)",
          ],
        },
      });
      expect(frontmatterOf(read(ws, A_FILE))["acceptance-criteria"]).toEqual([
        `Then ${link("kept")}.`,
        `**Then** ${link("new")}.`,
        "No link here.",
        "With a label only: [x](https://example.com)",
      ]);
    });

    it("[SR-127/AK4] criteria with bold, italic, code and a reference are written as valid YAML, one readable Markdown line each", async () => {
      const ws = await fixture();
      const workspace = open(ws.root);
      const criteria = [
        `**Gegeben** ein *Wind*, wenn \`gemessen\`, **dann** zeigt [die Station](logreq:${N}) ihn: schnell`,
        "Plain without marks",
        "_Wenn_ ein Wert: **fett**",
      ];
      await update(workspace, { set: { "acceptance-criteria": criteria } });
      const text = read(ws, A_FILE);
      const stored = [
        criteria[0]?.replace(`logreq:${N})`, `logreq:${N}?version=${N_VERSION})`),
        criteria[1],
        criteria[2],
      ];
      expect(frontmatterOf(text)["acceptance-criteria"]).toEqual(stored);
      // Each criterion is one line of the file, the Markdown as typed (quoted where YAML needs it).
      expect(text).toContain(
        `  - "${String(stored[0])}"\n  - Plain without marks\n  - "_Wenn_ ein Wert: **fett**"\n`,
      );
    });

    it("an update that does not set a Markdown property leaves the links in it as they are written (#444)", async () => {
      const unversioned = requirement(`acceptance-criteria:\n  - Then [wind](logreq:${N}).\n`);
      const ws = await fixture(unversioned);
      const workspace = open(ws.root);
      await update(workspace, { title: "Show gusts" });
      expect(read(ws, A_FILE)).toBe(unversioned.replace("title: Show wind speed", "title: Show gusts"));
    });

    it("element.create stores the reference of a criterion with its version (#444)", async () => {
      const ws = await fixture();
      const workspace = open(ws.root);
      const out = (await invoke(
        "element.create",
        {
          type: "system-requirement",
          title: "New one",
          properties: {
            "requirement-type": "functional",
            "acceptance-criteria": [`Then [wind](logreq:${N}).`],
          },
        },
        { workspace },
      )) as CommandOutput<"element.create">;
      const [file] = out.files;
      expect(frontmatterOf(read(ws, file ?? ""))["acceptance-criteria"]).toEqual([`Then ${link("wind")}.`]);
    });

    it("refuses a criterion whose reference names no element or several, naming the property (#444)", async () => {
      const ws = await fixture();
      await ws.write("needs/N-copy.md", fs.readFileSync(ws.path(N_FILE), "utf8"));
      const workspace = open(ws.root);
      for (const [id, code] of [
        [MISSING, "ref.unknown"],
        [N, "ref.ambiguous"],
      ] as const) {
        const error = await update(workspace, {
          set: { "acceptance-criteria": [`Then [x](logreq:${id})`] },
        }).catch((e: unknown) => e);
        expect(error).toBeInstanceOf(CommandError);
        expect(error).toMatchObject({ code, details: { key: "acceptance-criteria", ref: id } });
        expect((error as CommandError).message).toMatch(/\(in the property acceptance-criteria\)$/u);
      }
    });

    it("element.bulkUpdate sets and adds criteria with their references stored (#444)", async () => {
      const ws = await fixture();
      const workspace = open(ws.root);
      const bulk = (operation: "set" | "add", value: string[]): Promise<unknown> =>
        invoke(
          "element.bulkUpdate",
          { selection: { ids: [A] }, property: "acceptance-criteria", operation, value, confirm: true },
          { workspace },
        );
      await bulk("set", [`Then [a](logreq:${N}).`]);
      expect(frontmatterOf(read(ws, A_FILE))["acceptance-criteria"]).toEqual([`Then ${link("a")}.`]);
      await bulk("add", [`And [b](logreq:${N}).`, "Plain."]);
      expect(frontmatterOf(read(ws, A_FILE))["acceptance-criteria"]).toEqual([
        `Then ${link("a")}.`,
        `And ${link("b")}.`,
        "Plain.",
      ]);
    });
  });
});
