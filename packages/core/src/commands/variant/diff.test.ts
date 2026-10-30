// variant.diff (SR-044, SR-041 AK8, SR-042 AK5) on fixtures/SR-043/example: variant A (Coast,
// VAR-0000c1) replaces K1 (a1) by A1 (b1, validity [A]), excludes K2 (a2) and adds A2 (b2,
// validity [A]); variants B and C change nothing.
import { createFixtureWorkspace } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import type { CommandOutput } from "../../catalog.js";
import { CommandError } from "../../catalog.js";
import { invoke } from "../../runtime/invoke.js";
import { Workspace } from "../../runtime/workspace.js";

const P = "43043043-0000-4000-8000-0000000000";
const NAMES: Readonly<Record<string, string>> = { a1: "K1", a2: "K2", b1: "A1", b2: "A2" };
const name = (id: string): string => NAMES[id.slice(-2)] ?? id.slice(-2);
const A = `{ id: ${P}c1 }`;

/** A system requirement with tail `tail` and the frontmatter lines `lines`. */
const requirement = (tail: string, lines: string): Record<string, string> => ({
  [`requirements/SR-0000000000${tail}.md`]: `---\nid: ${P}${tail}\ntype: system-requirement\nstatus: draft\ntitle: R ${tail}\n${lines}---\n`,
});

const open = async (files: Readonly<Record<string, string>> = {}): Promise<Workspace> => {
  const fixture = await createFixtureWorkspace({ fixture: "SR-043/example", files });
  onTestFinished(() => fixture.cleanup());
  const workspace = new Workspace(fixture.root);
  onTestFinished(() => workspace.close());
  return workspace;
};

const diff = async (workspace: Workspace, variant = "VAR-0000c1"): Promise<CommandOutput<"variant.diff">> =>
  (await invoke("variant.diff", { variant }, { workspace })) as CommandOutput<"variant.diff">;

/** The lists of `out` by the fixture's names. */
const named = (out: CommandOutput<"variant.diff">) => ({
  added: out.added.map(name),
  replaced: out.replaced.map((row) => [name(row.core), name(row.replacement)]),
  excluded: out.excluded.map(name),
});

describe("variant.diff (SR-044)", () => {
  it("[SR-044/AK1] variant.diff of A lists added A2, replaced K1 by A1 and excluded K2", async () => {
    const out = await diff(await open());
    expect(named(out)).toEqual({ added: ["A2"], replaced: [["K1", "A1"]], excluded: ["K2"] });
    expect(out.names?.map((n) => [name(n.id), n.shortId, n.title])).toEqual([
      ["A2", "SR-0000b2", "Warn of storms"],
      ["K1", "SR-0000a1", "Response time at most 10 ms"],
      ["A1", "SR-0000b1", "Response time at most 20 ms"],
      ["K2", "SR-0000a2", "Measure the wind"],
    ]);
    expect([out.problems, out.incomplete]).toEqual([undefined, false]);
  });

  it("[SR-044/AK3] a replaced row names the IDs of core requirement and replacement", async () => {
    const out = await diff(await open());
    expect(out.replaced).toEqual([{ core: `${P}a1`, replacement: `${P}b1` }]);
  });

  it("[SR-041/AK8] variant.diff of A lists SR-A, whose replaces names no core requirement, as added", async () => {
    // b3 [A] replaces the need N1, b4 [A] replaces A2, which has a validity: both are added, and each
    // entry gives its hint; A's own exclusion of the need N1 gives one too.
    const out = await diff(
      await open({
        ...requirement("b3", `validity: [${A}]\nreplaces: [{ id: ${P}d1 }]\n`),
        ...requirement("b4", `validity: [${A}]\nreplaces: [{ id: ${P}b2 }]\n`),
        "variants/VAR-0000000000c1.md": `---\nid: ${P}c1\ntype: variant\nstatus: draft\ntitle: Coast\nexcludes: [{ id: ${P}a2 }, { id: ${P}d1 }]\n---\n`,
      }),
    );
    expect(named(out)).toEqual({ added: ["A2", "b3", "b4"], replaced: [["K1", "A1"]], excluded: ["K2"] });
    expect(
      out.problems?.map((p) => [p.code, name(p.elementId ?? ""), name(p.targetId ?? ""), p.line]),
    ).toEqual([
      ["variant.target-not-core", "b3", "d1", 7],
      ["variant.target-not-core", "b4", "A2", 7],
      ["variant.target-not-core", "c1", "d1", 6],
    ]);
  });

  it("[SR-042/AK5] an excluded and replaced core requirement is listed only as excluded, and the replacing requirement under added", async () => {
    // b3 [A] replaces K2, which A excludes.
    const out = await diff(await open(requirement("b3", `validity: [${A}]\nreplaces: [{ id: ${P}a2 }]\n`)));
    expect(named(out)).toEqual({ added: ["A2", "b3"], replaced: [["K1", "A1"]], excluded: ["K2"] });
  });

  it("gives empty lists for a variant that changes nothing, and no hint of another variant", async () => {
    const out = await diff(
      await open(requirement("b3", `validity: [${A}]\nreplaces: [{ id: ${P}d1 }]\n`)),
      "VAR-0000c2",
    );
    expect(out).toEqual({ added: [], replaced: [], excluded: [], incomplete: false });
  });

  it("is incomplete when a repository of the workspace is not on this machine", async () => {
    const out = await diff(
      await open({
        "reqseq-workspace.yaml":
          "reqseq-workspace: 1\nname: Weather station\nrepositories:\n" +
          '  - { name: system, url: "git@git.example.com:ws/system.git", main: true }\n' +
          '  - { name: other, url: "git@git.example.com:ws/other.git" }\n' +
          "metamodel: { repository: system, path: metamodel }\n",
      }),
    );
    expect(out.incomplete).toBe(true);
  });

  it("refuses an element that is no variant", async () => {
    const error = await diff(await open(), "SR-0000a1").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CommandError);
    expect((error as CommandError).toJSON()).toMatchObject({
      code: "input.invalid",
      details: { fields: ["variant"], reason: "not-a-variant" },
    });
  });
});
