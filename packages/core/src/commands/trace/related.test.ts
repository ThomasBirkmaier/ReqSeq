// trace.related (SR-023) on fixtures/SR-023/related: N1 and N2 are needs; A derives from N1, B from N1
// and N2, C from A and B (a diamond), D refines C (another kind with the meaning derivation), E
// derives from N2 and names N1 inline (no derivation, ADR-0004).
import fs from "node:fs/promises";
import { createFixtureWorkspace } from "@logreq/testkit";
import type { FixtureOptions, FixtureWorkspace } from "@logreq/testkit";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import type { CommandOutput } from "../../catalog.js";
import { CommandError } from "../../catalog.js";
import { metamodelState } from "../../metamodel/index.js";
import { currentVersions, currentVersionsState, elementStoreState } from "../../model/index.js";
import { invoke } from "../../runtime/invoke.js";
import { Workspace } from "../../runtime/workspace.js";

type Output = CommandOutput<"trace.related">;

const P = "2302a0de-0000-4000-8000-0000000000";
const [N1, N2, A, B, C, D, E] = ["a1", "a2", "b1", "b2", "b3", "b4", "b5"].map((t) => `${P}${t}`) as [
  string,
  string,
  string,
  string,
  string,
  string,
  string,
];
/** Elements added by single tests: a variant, Y (valid for it, derives from N1), Z (derives from Y). */
const [VARIANT, Y, Z] = ["c1", "b6", "b7"].map((t) => `${P}${t}`) as [string, string, string];
const V = "n1:1111111111111111";

const RELATED: FixtureOptions = { fixture: "SR-023/related" };

interface Opened {
  readonly fixture: FixtureWorkspace;
  readonly workspace: Workspace;
}

const open = async (options: FixtureOptions = RELATED, root = ""): Promise<Opened> => {
  const fixture = await createFixtureWorkspace(options);
  onTestFinished(() => fixture.cleanup());
  const workspace = new Workspace(root === "" ? fixture.root : fixture.path(root));
  onTestFinished(() => workspace.close());
  return { fixture, workspace };
};

const related = async (opened: Opened, input: Record<string, unknown>): Promise<Output> =>
  (await invoke("trace.related", input, { workspace: opened.workspace })) as Output;

const ids = (output: Output): string[] => output.elements.map((e) => e.id);

const relatedError = async (opened: Opened, input: Record<string, unknown>): Promise<CommandError> => {
  try {
    await related(opened, input);
  } catch (error) {
    if (error instanceof CommandError) {
      return error;
    }
    throw error;
  }
  throw new Error("trace.related did not fail");
};

const requirement = (tail: string, relations: string, extra = ""): string =>
  [
    "---",
    `id: ${P}${tail}`,
    "type: system-requirement",
    "status: draft",
    `title: R ${tail}`,
    "requirement-type: functional",
    "acceptance-criteria: [Given, when, then.]",
    ...(extra === "" ? [] : [extra]),
    relations,
    "---",
    "",
    "Text.",
    "",
  ].join("\n");

const derivesFrom = (...targets: readonly string[]): string =>
  ["derives-from:", ...targets.map((t) => `  - { id: ${t}, version: ${V} }`)].join("\n");

describe("trace.related (SR-023)", () => {
  it("[SR-023/AK1] lists every element derived directly and indirectly from a parent, along every derivation kind", async () => {
    const opened = await open();
    const out = await related(opened, { refs: ["N-0000a1"], direction: "children" });
    // A and B directly, C below both, D refines C; E only names N1 inline.
    expect(ids(out)).toEqual([A, B, C, D]);
    expect(out.total).toBe(4);
    expect(out.incomplete).toBe(false);
  });

  it("[SR-023/AK1] lists the children only up to the given depth", async () => {
    const opened = await open();
    const at = async (maxDepth: number): Promise<string[]> =>
      ids(await related(opened, { refs: [N1], direction: "children", maxDepth }));
    expect(await at(0)).toEqual([]);
    expect(await at(1)).toEqual([A, B]);
    expect(await at(2)).toEqual([A, B, C]);
    expect(await at(3)).toEqual([A, B, C, D]);
    expect(await at(9)).toEqual([A, B, C, D]);
  });

  it("[SR-023/AK1] lists an element of the selection that derives from another one of it", async () => {
    const opened = await open();
    const out = await related(opened, { refs: [N1, A], direction: "children" });
    expect(ids(out)).toEqual([A, B, C, D]);
    // A is one step below N1; C one below A, so within depth 1 too.
    expect(ids(await related(opened, { refs: [N1, A], direction: "children", maxDepth: 1 }))).toEqual([
      A,
      B,
      C,
    ]);
    // The selection in another order: still by distance, then in walk order.
    expect(ids(await related(opened, { refs: [A, N1], direction: "children" }))).toEqual([A, C, B, D]);
  });

  it("[SR-023/AK1] follows the relation kinds with the meaning derivation of an own metamodel (SR-013)", async () => {
    const wish = "13013013-0000-4000-8000-0000000000a1";
    const item = (tail: string, relation: string): string =>
      `---\nid: 13013013-0000-4000-8000-0000000000${tail}\ntype: spec-item\nstatus: draft\nlabel: I ${tail}\n${relation}:\n  - { id: ${wish}, version: ${V} }\n---\n`;
    const opened = await open({
      fixture: "SR-013/own-meanings",
      files: {
        "wishes/W-0000000000a1.md": `---\nid: ${wish}\ntype: wish\nstatus: draft\nlabel: Wish\n---\n`,
        "items/SPI-0000000000b1.md": item("b1", "satisfies"),
        "items/SPI-0000000000b2.md": item("b2", "traces-to"),
      },
    });
    const out = await related(opened, { refs: [wish], direction: "children" });
    expect(out.elements.map((e) => [e.shortId, e.title])).toEqual([["SPI-0000b1", "I b1"]]);
  });

  it("[SR-023/AK1] lists an element of the selection that lies in a cycle as derived from itself, once", async () => {
    // fixtures/SR-090/cycle: A derives from the need and B, B from C, C from A; D from A.
    const cycle = "5e9c0a7d-2b4f-4c61-9d08-0b000000000";
    const opened = await open({ fixture: "SR-090/cycle" });
    expect(ids(await related(opened, { refs: [`${cycle}1`], direction: "children" }))).toEqual(
      [3, 4, 2, 1].map((n) => `${cycle}${String(n)}`),
    );
    expect(ids(await related(opened, { refs: [`${cycle}4`], direction: "parents" }))).toEqual([
      `${cycle}1`,
      "5e9c0a7d-2b4f-4c61-9d08-0a0000000001",
      `${cycle}2`,
      `${cycle}3`,
    ]);
  });

  it("[SR-023/AK2] lists an element derived from two parents of the selection once", async () => {
    const opened = await open();
    const out = await related(opened, { refs: [N1, N2], direction: "children" });
    // B derives from both needs, C from A and B: each once, by distance.
    expect(ids(out)).toEqual([A, B, E, C, D]);
    expect(out.total).toBe(5);
    // A selection that names an element twice walks it once.
    expect(ids(await related(opened, { refs: [N1, "N-0000a1"], direction: "children" }))).toEqual([
      A,
      B,
      C,
      D,
    ]);
  });

  it("[SR-023/AK3] lists every parent a selection derives from, up to the top parents, each once", async () => {
    const opened = await open();
    expect(ids(await related(opened, { refs: ["SR-0000b4"], direction: "parents" }))).toEqual([
      C,
      A,
      B,
      N1,
      N2,
    ]);
    // C and E: A and B above C, N2 above E and B (once), N1 above A and B (once).
    expect(ids(await related(opened, { refs: [C, E], direction: "parents" }))).toEqual([A, B, N2, N1]);
    expect(ids(await related(opened, { refs: [D], direction: "parents", maxDepth: 1 }))).toEqual([C]);
    // A need derives from nothing.
    expect(await related(opened, { refs: [N1], direction: "parents" })).toEqual({
      elements: [],
      total: 0,
      incomplete: false,
    });
  });

  it("gives each element as element.get shows it, without text, hints, readOnly and the verification status", async () => {
    const opened = await open();
    const out = await related(opened, { refs: [N1, N2], direction: "children" });
    for (const element of out.elements) {
      const { element: shown } = (await invoke(
        "element.get",
        { ref: element.id },
        { workspace: opened.workspace },
      )) as CommandOutput<"element.get">;
      // The verification status is element.get's (SR-031); a list of related elements leaves it out.
      const { text, problems, readOnly, verification, ...rest } = shown;
      expect(verification === undefined || Array.isArray(verification)).toBe(true);
      expect([text, problems, readOnly]).toEqual([
        expect.any(String),
        expect.any(Array),
        expect.any(Boolean),
      ]);
      expect(element).toEqual(rest);
      // The same order of keys as element.get, so the CLI shows both alike.
      expect(Object.keys(element)).toEqual(Object.keys(rest));
    }
    expect(out.elements[2]?.relations.map((r) => [r.kind, r.id, r.shortId])).toEqual([
      ["derives-from", N2, "N-0000a2"],
    ]);
  });

  it("lists one page of the related elements, and counts them all in total", async () => {
    const opened = await open();
    const page = async (offset: number, limit: number): Promise<[string[], number]> => {
      const out = await related(opened, { refs: [N1], direction: "children", offset, limit });
      return [ids(out), out.total];
    };
    expect(await page(0, 2)).toEqual([[A, B], 4]);
    expect(await page(1, 2)).toEqual([[B, C], 4]);
    expect(await page(3, 200)).toEqual([[D], 4]);
    expect(await page(4, 1)).toEqual([[], 4]);
    expect(await page(10, 5000)).toEqual([[], 4]);
    expect((await relatedError(opened, { refs: [N1], direction: "children", limit: 5001 })).code).toBe(
      "input.invalid",
    );
    expect((await relatedError(opened, { refs: [N1], direction: "children", limit: 0 })).code).toBe(
      "input.invalid",
    );
  });

  it("reads only the files of a small page, keeps the versions for a large one, and gives the same versions", async () => {
    const opened = await open();
    // One of seven elements: only its file is read, the workspace keeps no versions.
    const first = await related(opened, { refs: [N1], direction: "children", limit: 1 });
    expect(opened.workspace.peek(currentVersionsState)).toBeUndefined();
    // Four of seven: the versions of the whole store are built and kept.
    const all = await related(opened, { refs: [N1], direction: "children" });
    expect(opened.workspace.peek(currentVersionsState)).toBeDefined();
    expect(all.elements[0]).toEqual(first.elements[0]);
    const versions = await currentVersions(opened.workspace);
    expect(all.elements.map((e) => e.version)).toEqual(
      all.elements.map((e) => {
        const record = versions.store.elements.find((r) => r.id === e.id);
        const entry = record === undefined ? undefined : versions.byRecord.get(record);
        return entry?.kind === "version" ? entry.version : undefined;
      }),
    );
    // Kept versions serve a small page too.
    expect(await related(opened, { refs: [N1], direction: "children", limit: 1 })).toEqual(first);
    // A changed file gets its version from the file as it is now.
    await opened.fixture.write("requirements/SR-0000000000b3.md", requirement("b3", derivesFrom(A, B)));
    await opened.workspace.reset(elementStoreState);
    const changed = await related(opened, { refs: [N1], direction: "children" });
    expect(changed.elements[2]?.version).not.toBe(all.elements[2]?.version);
  });

  it("lists an element whose file changed since the store read it as the file holds it now", async () => {
    const opened = await open();
    const before = await related(opened, { refs: [N1], direction: "children", limit: 1, offset: 2 });
    // C gets another title; the store is not read again (no watcher here).
    await opened.fixture.write(
      "requirements/SR-0000000000b3.md",
      requirement("b3", derivesFrom(A, B)).replace("title: R b3", "title: Shown now"),
    );
    const [listed] = (await related(opened, { refs: [N1], direction: "children", limit: 1, offset: 2 }))
      .elements;
    const { element: shown } = (await invoke(
      "element.get",
      { ref: C },
      { workspace: opened.workspace },
    )) as CommandOutput<"element.get">;
    expect([listed?.id, listed?.title, listed?.version]).toEqual([C, "Shown now", shown.version]);
    expect(listed?.version).not.toBe(before.elements[0]?.version);
    expect(listed?.properties["acceptance-criteria"]).toEqual(["Given", "when", "then."]);
  });

  it("lists an element without a version, with a file.faulty warning, when its file no longer holds it", async () => {
    const opened = await open();
    await opened.workspace.get(elementStoreState);
    // D's file now holds another element.
    await opened.fixture.write("requirements/SR-0000000000b4.md", requirement("b9", derivesFrom(C)));
    const out = await related(opened, { refs: [N1], direction: "children" });
    expect(ids(out)).toEqual([A, B, C, D]);
    expect(out.elements[3]).not.toHaveProperty("version");
    expect([out.elements[3]?.title, out.elements[3]?.problems]).toEqual([
      "Show the last hour",
      [
        {
          code: "file.faulty",
          severity: "warning",
          message: `No version: requirements/SR-0000000000b4.md of repository system no longer holds the element ${D}`,
          repository: "system",
          file: "requirements/SR-0000000000b4.md",
          elementId: D,
          elementShortId: "SR-0000b4",
        },
      ],
    ]);
    expect(out.elements.slice(0, 3).every((e) => e.version !== undefined && e.problems === undefined)).toBe(
      true,
    );
  });

  it("lists an element without a version, with a file.faulty warning, when an image of it cannot be read", async () => {
    const opened = await open({
      ...RELATED,
      files: {
        "requirements/SR-0000000000b6.md": requirement("b6", derivesFrom(N1)).replace(
          "Text.",
          "![wind](img/wind.png)",
        ),
        "requirements/img/wind.png": "W",
      },
    });
    await opened.workspace.get(elementStoreState);
    const readdir = fs.readdir.bind(fs);
    vi.spyOn(fs, "readdir").mockImplementation(((folder: string, options: never) =>
      folder.endsWith("img")
        ? Promise.reject(Object.assign(new Error("denied"), { code: "EACCES" }))
        : readdir(folder, options)) as typeof fs.readdir);
    onTestFinished(() => {
      vi.restoreAllMocks();
    });
    const out = await related(opened, { refs: [N1], direction: "children", maxDepth: 1 });
    expect(ids(out)).toEqual([A, B, Y]);
    expect(out.elements[2]).not.toHaveProperty("version");
    expect(out.elements[2]?.problems).toEqual([
      {
        code: "file.faulty",
        severity: "warning",
        message: "No version: Cannot read folder requirements/img: EACCES",
        repository: "system",
        file: "requirements/SR-0000000000b6.md",
        elementId: Y,
        elementShortId: "SR-0000b6",
      },
    ]);
  });

  it("checks the images of a kept version for the page only, and computes a changed one again", async () => {
    const opened = await open({
      ...RELATED,
      files: {
        "requirements/SR-0000000000b6.md": requirement("b6", derivesFrom(N1)).replace(
          "Text.",
          "![wind](img/wind.png)",
        ),
        "requirements/img/wind.png": "W",
      },
    });
    const firstPage = { refs: [N1], direction: "children", maxDepth: 1 };
    // Three of eight elements: the versions of the whole store are built and kept.
    const before = await related(opened, firstPage);
    const kept = opened.workspace.peek(currentVersionsState);
    expect(kept).toBeDefined();
    expect(await related(opened, firstPage)).toEqual(before);
    // The watcher does not report images: the kept version of Y is stale, the page finds it.
    await opened.fixture.write("requirements/img/wind.png", "A stronger wind");
    const after = await related(opened, firstPage);
    const { element: shown } = (await invoke(
      "element.get",
      { ref: Y },
      { workspace: opened.workspace },
    )) as CommandOutput<"element.get">;
    expect(ids(after)).toEqual([A, B, Y]);
    expect(after.elements[2]?.version).toBe(shown.version);
    expect(after.elements[2]?.version).not.toBe(before.elements[2]?.version);
    expect(after.elements.slice(0, 2)).toEqual(before.elements.slice(0, 2));
    // The page leaves the kept state as it is.
    expect(opened.workspace.peek(currentVersionsState)).toBe(kept);
  });

  it("follows no derivation to an ambiguous (SR-088) or missing (SR-089) target, and stays complete", async () => {
    const MISSING = `${P}ff`;
    const opened = await open({
      ...RELATED,
      files: {
        // A copy of N1: its UUID names two files, so a relation to it is ambiguous.
        "copies/N-0000000000a1.md": `---\nid: ${N1}\ntype: need\nstatus: approved\ntitle: See the wind (copy)\n---\n`,
        // B also derives from an element that is nowhere.
        "requirements/SR-0000000000b2.md": requirement("b2", derivesFrom(N1, N2, MISSING)),
      },
    });
    const out = await related(opened, { refs: [C], direction: "parents" });
    expect([ids(out), out.total, out.incomplete]).toEqual([[A, B, N2], 3, false]);
    // Downwards, the twins themselves cannot be named by their UUID.
    expect((await relatedError(opened, { refs: [N1], direction: "children" })).code).toBe("ref.ambiguous");
  });

  it("refuses a reference that names no element, and lists nothing for an empty selection", async () => {
    const opened = await open();
    expect((await relatedError(opened, { refs: [N1, "SR-ffffff"], direction: "children" })).code).toBe(
      "ref.unknown",
    );
    expect((await relatedError(opened, { refs: ["SR-0000"], direction: "parents" })).code).toBe(
      "ref.unknown",
    );
    expect((await relatedError(opened, { refs: [""], direction: "parents" })).code).toBe("input.invalid");
    expect(await related(opened, { refs: [], direction: "children" })).toEqual({
      elements: [],
      total: 0,
      incomplete: false,
    });
  });

  it("gives empty titles without a property with the meaning title, as element.get (SR-013 AK3)", async () => {
    const opened = await open();
    const model = await fs.readFile(opened.fixture.path("metamodel/standard-model.yaml"), "utf8");
    await opened.fixture.write("metamodel/standard-model.yaml", model.replace("    meaning: title\n", ""));
    const out = await related(opened, { refs: [N1], direction: "children", maxDepth: 1 });
    expect(out.elements.map((e) => [e.shortId, e.title, e.properties["title"]])).toEqual([
      ["SR-0000b1", "", "Show wind speed"],
      ["SR-0000b2", "", "Show gusts"],
    ]);
  });

  it("names the missing meaning derivation (SR-013 AK3)", async () => {
    const opened = await open();
    const model = await fs.readFile(opened.fixture.path("metamodel/standard-model.yaml"), "utf8");
    await opened.fixture.write(
      "metamodel/standard-model.yaml",
      model.replaceAll("    meaning: derivation\n", ""),
    );
    const error = await relatedError(opened, { refs: [N1], direction: "children" });
    expect(error.code).toBe("metamodel.meaning-unassigned");
    expect(error.message).toContain("trace.related");
  });

  describe("view (SR-040; full views in stage 5)", () => {
    const VIEWS: FixtureOptions = {
      ...RELATED,
      files: {
        "variants/VAR-0000000000c1.md": `---\nid: ${VARIANT}\ntype: variant\nstatus: draft\ntitle: Coast\n---\n`,
        "requirements/SR-0000000000b6.md": requirement(
          "b6",
          derivesFrom(N1),
          `validity:\n  - { id: ${VARIANT}, version: ${V} }`,
        ),
        "requirements/SR-0000000000b7.md": requirement("b7", derivesFrom(Y)),
      },
    };

    it("lists only the elements of the view, and nothing that only an element outside it leads to", async () => {
      const opened = await open(VIEWS);
      expect(ids(await related(opened, { refs: [N1], direction: "children" }))).toEqual([A, B, Y, C, Z, D]);
      // Y is valid only for the variant: it and Z below it are not in the core.
      expect(ids(await related(opened, { refs: [N1], direction: "children", view: "core" }))).toEqual([
        A,
        B,
        C,
        D,
      ]);
      expect(ids(await related(opened, { refs: [N1], direction: "children", view: "VAR-0000c1" }))).toEqual([
        A,
        B,
        Y,
        C,
        Z,
        D,
      ]);
      // `core` in any case, as element references (#305).
      expect(ids(await related(opened, { refs: [N1], direction: "children", view: "Core" }))).toEqual([
        A,
        B,
        C,
        D,
      ]);
      // The selection is walked from as given, also when it is not in the view.
      expect(ids(await related(opened, { refs: [Z], direction: "parents", view: "core" }))).toEqual([]);
      expect(ids(await related(opened, { refs: [Z], direction: "parents", view: VARIANT }))).toEqual([Y, N1]);
    });

    it("refuses a view that is no variant, and names a missing meaning", async () => {
      const opened = await open(VIEWS);
      const error = await relatedError(opened, { refs: [N1], direction: "children", view: N2 });
      expect(error.toJSON()).toMatchObject({
        code: "input.invalid",
        details: { command: "trace.related", fields: ["view"] },
      });
      const model = await fs.readFile(opened.fixture.path("metamodel/standard-model.yaml"), "utf8");
      await opened.fixture.write(
        "metamodel/standard-model.yaml",
        model.replace("    meaning: variant\n", ""),
      );
      await opened.workspace.reset(metamodelState);
      expect((await relatedError(opened, { refs: [N1], direction: "children", view: VARIANT })).code).toBe(
        "metamodel.meaning-unassigned",
      );
      expect(ids(await related(opened, { refs: [N1], direction: "children", view: "core" }))).toEqual([
        A,
        B,
        C,
        D,
      ]);
      await opened.fixture.write(
        "metamodel/standard-model.yaml",
        model.replace("    meaning: validity\n", ""),
      );
      await opened.workspace.reset(metamodelState);
      expect((await relatedError(opened, { refs: [N1], direction: "children", view: "core" })).code).toBe(
        "metamodel.meaning-unassigned",
      );
    });
  });

  describe("repositories that are not on this machine (SR-006 AK2)", () => {
    const AWAY_ID = "a0a0a0a0-0000-4000-8000-0000000000f1";
    const workspaceFile = [
      "logreq-workspace: 1",
      "name: Weather station",
      "repositories:",
      '  - { name: system, url: "git@git.example.com:ws/system.git", main: true }',
      '  - { name: away, url: "git@git.example.com:ws/away.git", path: ../away }',
      "metamodel: { repository: system, path: metamodel }",
      "",
    ].join("\n");

    it("marks the parents incomplete when one lies in such a repository, and every list of children", async () => {
      const opened = await open({
        ...RELATED,
        files: {
          "logreq-workspace.yaml": workspaceFile,
          "requirements/SR-0000000000b6.md": requirement(
            "b6",
            `derives-from:\n  - { id: ${N1}, version: ${V} }\n  - { id: ${AWAY_ID}, version: ${V}, repository: away }`,
          ),
        },
      });
      const up = await related(opened, { refs: [Y], direction: "parents" });
      expect([ids(up), up.incomplete]).toEqual([[N1], true]);
      expect((await related(opened, { refs: [A], direction: "parents" })).incomplete).toBe(false);
      // Children in that repository cannot be seen (spec question #262, option 1).
      const down = await related(opened, { refs: [C], direction: "children" });
      expect([ids(down), down.incomplete]).toEqual([[D], true]);
    });
  });
});
