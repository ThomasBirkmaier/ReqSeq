// Variants end to end (SR-039): the built binary on fixtures/SR-040/validity (standard model) and
// fixtures/SR-039/nested (the type Variant has a validity; B's validity names A, written by hand, and
// C only relates to A), one Git repository at the root. Run after `pnpm build` with `pnpm test:e2e`.
import fs from "node:fs/promises";
import type { FixtureWorkspace } from "@reqseq/testkit";
import { createFixtureWorkspace } from "@reqseq/testkit";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { reqseq, requireBuiltCli } from "../support/reqseq.js";

const A = "39039039-0000-4000-8000-0000000000a1";
const FILE_B = "variants/VAR-0000000000b2.md";
const NESTED_B =
  "Property Validity (validity) of Variant VAR-0000b2 names Variant VAR-0000a1, but a variant builds only on the core (D-020)";

const fixtures: FixtureWorkspace[] = [];
afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((f) => f.cleanup()));
});

beforeAll(() => {
  requireBuiltCli("pnpm test:e2e");
});

const workspace = async (fixture: string): Promise<FixtureWorkspace> => {
  const ws = await createFixtureWorkspace({ fixture, git: true });
  fixtures.push(ws);
  return ws;
};

describe("reqseq variants (SR-039)", () => {
  it("[SR-039/AK1] element.create of type variant writes a variant file in the workspace of the core", async () => {
    const ws = await workspace("SR-040/validity");
    const head = await ws.head();
    const result = await reqseq(["element", "create", "variant", "Valley", "--json"], { cwd: ws.root });
    expect([result.code, result.stderr]).toEqual([0, ""]);
    const out = JSON.parse(result.stdout) as { element: { id: string; repository: string }; files: string[] };
    const file = `variant/VAR-${out.element.id.replaceAll("-", "").slice(-12)}.md`;
    expect([out.element.repository, out.files]).toEqual(["system", [file]]);
    expect(await fs.readFile(ws.path(file), "utf8")).toBe(
      `---\nid: ${out.element.id}\ntype: variant\nstatus: draft\ntitle: Valley\n---\n`,
    );
    expect(await ws.head()).toBe(head);
  });

  it("[SR-039/AK2] element.create, update and bulkUpdate refuse a variant whose validity names a variant, naming the reason; a relation between variants is allowed", async () => {
    const ws = await workspace("SR-039/nested");
    const before = await fs.readFile(ws.path(FILE_B), "utf8");
    const create = await reqseq(
      [
        "element",
        "create",
        "variant",
        "South coast",
        "--input",
        JSON.stringify({ properties: { validity: [{ id: A }] } }),
      ],
      { cwd: ws.root },
    );
    expect(create.code).toBe(2);
    expect(create.stderr).toMatch(
      /^error variant\.nested: Not written: Property Validity \(validity\) of the new variant names Variant VAR-0000a1, but a variant builds only on the core \(D-020\)\. Write the variant without validity entries; a relation between variants is allowed\n$/,
    );
    const update = await reqseq(["element", "update", "VAR-0000b2", "--title", "North"], { cwd: ws.root });
    expect([update.code, update.stderr]).toEqual([
      2,
      `error variant.nested: Not written: ${NESTED_B}. Write the variant without validity entries; a relation between variants is allowed\n`,
    ]);
    const bulk = await reqseq(
      [
        "element",
        "bulk-update",
        "validity",
        "add",
        "--input",
        JSON.stringify({ selection: { ids: ["VAR-0000c3"] }, value: { id: A }, confirm: true }),
      ],
      { cwd: ws.root },
    );
    expect([bulk.code, bulk.stderr]).toMatchObject([
      2,
      expect.stringMatching(/^error variant\.nested: Not written: .* of Variant VAR-0000c3 /),
    ]);
    expect(await fs.readFile(ws.path(FILE_B), "utf8")).toBe(before);
    // C relates to A only: written.
    const related = await reqseq(["element", "update", "VAR-0000c3", "--title", "Mountains"], {
      cwd: ws.root,
    });
    expect([related.code, related.stderr]).toEqual([0, ""]);
    expect(await ws.git(["status", "--porcelain"])).toBe(" M variants/VAR-0000000000c3.md\n");
  });

  it("[SR-039/AK3] workspace.check and hint.list report a hand-written validity of a variant at its line", async () => {
    const ws = await workspace("SR-039/nested");
    const check = await reqseq(["workspace", "check"], { cwd: ws.root });
    expect([check.code, check.stderr]).toEqual([0, ""]);
    expect(check.stdout).toContain(
      `warning  variant.nested  system:${FILE_B}:7  ${NESTED_B}  (element VAR-0000b2)\n`,
    );
    const hints = await reqseq(["hint", "list", "--json"], { cwd: ws.root });
    expect([hints.code, hints.stderr]).toEqual([0, ""]);
    expect((JSON.parse(hints.stdout) as { hints: unknown[] }).hints).toEqual([
      expect.objectContaining({
        code: "variant.nested",
        file: FILE_B,
        line: 7,
        message: NESTED_B,
        targetId: A,
      }),
    ]);
  });
});
