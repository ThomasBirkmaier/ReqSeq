// The views of variants end to end (SR-041, SR-043): the built binary on fixtures/SR-043/example,
// where variant A (VAR-0000c1) replaces K1 (SR-0000a1) by A1 (SR-0000b1), excludes K2 (SR-0000a2)
// and adds A2 (SR-0000b2). Run after `pnpm build` with `pnpm test:e2e`.
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
});
