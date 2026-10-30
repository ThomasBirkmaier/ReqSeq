// The views of variants end to end (SR-041, SR-043): the built binary on fixtures/SR-043/example,
// where variant A (VAR-0000c1) replaces K1 (SR-0000a1) by A1 (SR-0000b1), excludes K2 (SR-0000a2)
// and adds A2 (SR-0000b2); `CHILDREN` adds P (SR-0000a0) as the parent of all six and records (core
// and A) for K1 to K4 and A2; SR-046 lets B (VAR-0000c2) exclude K1. Run after `pnpm build` with `pnpm test:e2e`.
import type { FixtureWorkspace } from "@reqseq/testkit";
import { createFixtureWorkspace } from "@reqseq/testkit";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { reqseq as run, requireBuiltCli } from "../support/reqseq.js";

const fixtures: FixtureWorkspace[] = [];
afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((f) => f.cleanup()));
});

beforeAll(() => {
  requireBuiltCli("pnpm test:e2e");
});

const workspace = async (files: Readonly<Record<string, string>> = {}): Promise<FixtureWorkspace> => {
  const ws = await createFixtureWorkspace({ fixture: "SR-043/example", files });
  fixtures.push(ws);
  return ws;
};

/** The short IDs of the requirements a command gives as JSON under `elements`. */
const requirements = async (
  ws: FixtureWorkspace,
  args: readonly string[],
  view: string,
): Promise<string[]> => {
  const input = { selection: { view, where: { type: ["system-requirement"] } } };
  const result = await run([...args, "--input", JSON.stringify(input), "--json"], { cwd: ws.root });
  expect([result.code, result.stderr]).toEqual([0, ""]);
  const output = JSON.parse(result.stdout) as { elements: { id: string }[] };
  return output.elements.map((e) => `SR-${e.id.slice(-6)}`);
};

describe("variant views (SR-041, SR-043)", () => {
  it("[SR-041/AK1] element list in the view of A shows A1 instead of K1", async () => {
    const ws = await workspace();
    const result = await run(["element", "list", "--input", '{"selection":{"view":"VAR-0000c1"}}'], {
      cwd: ws.root,
    });
    expect([result.code, result.stderr]).toEqual([0, ""]);
    expect(result.stdout).toContain("SR-0000b1  draft  Response time at most 20 ms\n");
    expect(result.stdout).not.toContain("SR-0000a1");
  });

  it("[SR-043/AK9] the core view holds only requirements without validity", async () => {
    const ws = await workspace();
    expect(await requirements(ws, ["element", "list"], "core")).toEqual([
      "SR-0000a1",
      "SR-0000a2",
      "SR-0000a3",
      "SR-0000a4",
    ]);
  });

  it("[SR-043/AK8] data export in the view of A holds exactly K3, K4, A1 and A2", async () => {
    const ws = await workspace();
    expect(await requirements(ws, ["data", "export"], "VAR-0000c1")).toEqual([
      "SR-0000a3",
      "SR-0000a4",
      "SR-0000b1",
      "SR-0000b2",
    ]);
  });

  it("[SR-041/AK8] workspace check names a replaces onto a need at the line of the entry", async () => {
    const ws = await workspace({
      "requirements/SR-0000000000b3.md":
        "---\nid: 43043043-0000-4000-8000-0000000000b3\ntype: system-requirement\nstatus: draft\ntitle: R\n" +
        "validity: [{ id: 43043043-0000-4000-8000-0000000000c1 }]\n" +
        "replaces: [{ id: 43043043-0000-4000-8000-0000000000d1 }]\n---\n",
    });
    const result = await run(["workspace", "check"], { cwd: ws.root });
    expect(result.stdout).toContain(
      "warning  variant.target-not-core  system:requirements/SR-0000000000b3.md:7  System Requirement SR-0000b3 replaces Need N-0000d1",
    );
  });

  it("[SR-046/AK3] element get names A as replacing and B as excluding variant", async () => {
    const ws = await workspace({
      "variants/VAR-0000000000c2.md":
        "---\nid: 43043043-0000-4000-8000-0000000000c2\ntype: variant\nstatus: draft\ntitle: Mountain\n" +
        "excludes: [{ id: 43043043-0000-4000-8000-0000000000a1 }]\n---\n",
    });
    const result = await run(["element", "get", "SR-0000a1"], { cwd: ws.root });
    expect([result.code, result.stderr]).toEqual([0, ""]);
    expect(result.stdout).toContain(
      "  replacedBy:\n    - variant: VAR-0000c1  Coast\n      replacement: SR-0000b1  Response time at most 20 ms\n" +
        "  excludedBy:\n    - VAR-0000c2  Mountain\n",
    );
  });

  const P = "43043043-0000-4000-8000-0000000000";
  const V = "n1:67ebd0624004c969";
  const COAST = `validity: [{ id: ${P}c1, version: ${V} }]\n`;
  const requirement = (tail: string, parent: string, extra = "") => ({
    [`requirements/SR-0000000000${tail}.md`]: `---\nid: ${P}${tail}\ntype: system-requirement\nstatus: draft\ntitle: R ${tail}\nderives-from: [{ id: ${P}${parent}, version: ${V} }]\n${extra}---\n`,
  });
  const record = (tail: string, result: string, variant = "") => ({
    [`evidence/${tail}-${variant}.md`]: `---\nreqseq-record: 1\nkind: verification\nelement: ${P}${tail}\nversion: ${V}\nmethod: test\nitem: b\nresult: ${result}\ndate: 2026-10-30T10:00:00Z\n${variant === "" ? "" : `variant: ${P}${variant}\n`}---\n`,
  });
  const CHILDREN = {
    "reqseq-workspace.yaml": `reqseq-workspace: 1\nname: W\nrepositories:\n  - { name: system, url: "git@example.com:s.git", main: true }\nmetamodel: { repository: system, path: metamodel }\nevidence:\n  - { repository: system, path: evidence }\n`,
    ...requirement("a0", "d1"),
    ...["a1", "a2", "a3", "a4"].reduce((all, tail) => ({ ...all, ...requirement(tail, "a0") }), {}),
    ...requirement("b1", "a0", `${COAST}replaces: [{ id: ${P}a1, version: ${V} }]\n`),
    ...requirement("b2", "a0", COAST),
    ...record("a1", "failed"),
    ...record("a2", "failed"),
    ...record("a3", "passed"),
    ...record("a3", "passed", "c1"),
    ...record("a4", "passed"),
    ...record("a4", "passed", "c1"),
    ...record("b2", "passed", "c1"),
  };

  /** The JSON output of `args` with `input` on the example with `CHILDREN`. */
  const json = async (args: readonly string[], input: unknown): Promise<Record<string, unknown>> => {
    const ws = await workspace(CHILDREN);
    const result = await run([...args, "--input", JSON.stringify(input), "--json"], { cwd: ws.root });
    expect([result.code, result.stderr]).toEqual([0, ""]);
    return JSON.parse(result.stdout) as Record<string, unknown>;
  };
  const SIX = ["a1", "a2", "a3", "a4", "b1", "b2"].map((tail) => `SR-0000${tail}`);
  const short = (id: unknown): string => `SR-${String(id).slice(-6)}`;

  it("[SR-043/AK4] trace chain in the view of A holds of the six requirements only K3, K4, A1 and A2", async () => {
    const out = await json(["trace", "chain"], { ref: "SR-0000a0", direction: "down", view: "VAR-0000c1" });
    const nodes = (out["nodes"] as { id: string }[]).map((n) => short(n.id));
    expect(nodes).toEqual(["SR-0000a0", "SR-0000a3", "SR-0000a4", "SR-0000b1", "SR-0000b2"]);
  });

  it("[SR-043/AK5] evidence coverage in the view of A counts exactly K3, K4, A1 and A2", async () => {
    const out = await json(["evidence", "coverage"], { selection: { ids: SIX, view: "VAR-0000c1" } });
    expect(out["levels"]).toMatchObject([{ type: "system-requirement", total: 4, withChildren: 0 }]);
  });

  it("[SR-043/AK6] evidence degree in the view of A counts exactly K3, K4, A1 and A2", async () => {
    const out = await json(["evidence", "degree"], { selection: { ids: SIX, view: "VAR-0000c1" } });
    expect(out["degree"]).toMatchObject({ total: 4, counts: { verified: 3, open: 1 } });
  });

  it("[SR-043/AK7] evidence status in the view of A counts only children from K3, K4, A1 and A2", async () => {
    const out = await json(["evidence", "status"], { selection: { ids: ["SR-0000a0"] } });
    const [p] = out["elements"] as { verification: { view: string; missingChildren?: string[] }[] }[];
    const missing = (view: string) =>
      p?.verification.find((v) => v.view.endsWith(view))?.missingChildren?.map(short);
    expect([missing("core"), missing("c1")]).toEqual([["SR-0000a1", "SR-0000a2"], ["SR-0000b1"]]);
  });
});
