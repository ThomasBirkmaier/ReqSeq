// Packages end to end (SR-048, SR-049): the built binary on fixtures/SR-048/packages (packages P1
// "Release 1" and P2 "Release 2"; R1 in P1 and P2, R2 in P1, R3 in none), one Git repository at the
// root. An opened package is `element list` with `selection.package`. Run after `pnpm build` with
// `pnpm test:e2e`.
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import type { FixtureWorkspace } from "@reqseq/testkit";
import { createFixtureWorkspace } from "@reqseq/testkit";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { reqseq, requireBuiltCli } from "../support/reqseq.js";

const P = "48048048-0000-4000-8000-0000000000";
const [P1, P2] = [`${P}d1`, `${P}d2`];
const FILE = {
  P1: "packages/PKG-0000000000d1.md",
  R1: "requirements/SR-0000000000b1.md",
  R2: "requirements/SR-0000000000b2.md",
  R3: "requirements/SR-0000000000b3.md",
};

interface Listed {
  readonly elements: readonly {
    readonly shortId: string;
    readonly version: string;
    readonly text?: string;
  }[];
}

const fixtures: FixtureWorkspace[] = [];
afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((f) => f.cleanup()));
});

beforeAll(() => {
  requireBuiltCli("pnpm test:e2e");
});

const workspace = async (): Promise<FixtureWorkspace> => {
  const ws = await createFixtureWorkspace({ fixture: "SR-048/packages", git: true });
  fixtures.push(ws);
  return ws;
};

/** Runs `reqseq <args> --json` in the workspace and gives the parsed output. */
const json = async <T>(ws: FixtureWorkspace, args: readonly string[]): Promise<T> => {
  const result = await reqseq([...args, "--json"], { cwd: ws.root });
  expect([result.code, result.stderr]).toEqual([0, ""]);
  return JSON.parse(result.stdout) as T;
};

const opened = (ws: FixtureWorkspace, pkg: string, withText = false): Promise<Listed> =>
  json<Listed>(ws, ["element", "list", "--input", JSON.stringify({ selection: { package: pkg }, withText })]);

const members = async (ws: FixtureWorkspace, pkg: string): Promise<string[]> =>
  (await opened(ws, pkg)).elements.map((e) => e.shortId);

const sha256 = async (ws: FixtureWorkspace, file: string): Promise<string> =>
  createHash("sha256")
    .update(await fs.readFile(ws.path(file)))
    .digest("hex");

describe("reqseq packages (SR-048, SR-049)", () => {
  it("[SR-048/AK1] element.create of type package writes a package file", async () => {
    const ws = await workspace();
    const out = await json<{ element: { id: string; shortId: string }; files: string[] }>(ws, [
      "element",
      "create",
      "package",
      "Release 3",
    ]);
    expect(out.files).toEqual([`package/PKG-${out.element.id.replaceAll("-", "").slice(-12)}.md`]);
    expect(await fs.readFile(ws.path(out.files[0] ?? ""), "utf8")).toBe(
      `---\nid: ${out.element.id}\ntype: package\nstatus: draft\ntitle: Release 3\n---\n`,
    );
  });

  it("[SR-048/AK2] assigning a package writes it into the element file and leaves the package file unchanged", async () => {
    const ws = await workspace();
    const before = await sha256(ws, FILE.P1);
    await json(ws, [
      "element",
      "update",
      "SR-0000b3",
      "--input",
      JSON.stringify({ set: { packages: [{ id: P1 }] } }),
    ]);
    expect(await fs.readFile(ws.path(FILE.R3), "utf8")).toMatch(
      new RegExp(`packages:\\n  - \\{ id: ${P1}, version: n1:[0-9a-f]{16}, title: Release 1 \\}\\n`),
    );
    expect(await sha256(ws, FILE.P1)).toBe(before);
    expect(await ws.git(["status", "--porcelain"])).toBe(` M ${FILE.R3}\n`);
  });

  it("[SR-048/AK3] removing the package with element.update drops it from the element and from the package's elements", async () => {
    const ws = await workspace();
    const before = await sha256(ws, FILE.P1);
    await json(ws, ["element", "update", "SR-0000b2", "--unset", "packages"]);
    await json(ws, [
      "element",
      "update",
      "SR-0000b1",
      "--input",
      JSON.stringify({ set: { packages: [{ id: P2 }] } }),
    ]);
    expect(await fs.readFile(ws.path(FILE.R2), "utf8")).not.toContain("packages:");
    expect(await fs.readFile(ws.path(FILE.R1), "utf8")).not.toContain(P1);
    expect(await sha256(ws, FILE.P1)).toBe(before);
    expect(await members(ws, "PKG-0000d1")).toEqual([]);
    expect(await members(ws, "PKG-0000d2")).toEqual(["SR-0000b1"]);
  });

  it("[SR-049/AK1] a requirement in P1 and P2 appears in both", async () => {
    const ws = await workspace();
    expect(await members(ws, "PKG-0000d1")).toEqual(["SR-0000b1", "SR-0000b2"]);
    expect(await members(ws, "PKG-0000d2")).toEqual(["SR-0000b1"]);
  });

  it("[SR-049/AK2] after a change both packages show the same content and there is exactly one file", async () => {
    const ws = await workspace();
    await json(ws, ["element", "update", "SR-0000b1", "--text", "R1: changed once."]);
    const [one, two] = [await opened(ws, P1, true), await opened(ws, P2, true)];
    const r1 = (listed: Listed): unknown => listed.elements.find((e) => e.shortId === "SR-0000b1");
    expect(r1(one)).toMatchObject({ text: "R1: changed once.\n" });
    expect(r1(one)).toEqual(r1(two));
    expect(await ws.git(["status", "--porcelain"])).toBe(` M ${FILE.R1}\n`);
    const ids = await json<Listed>(ws, [
      "element",
      "list",
      "--input",
      JSON.stringify({ selection: { ids: ["SR-0000b1"] } }),
    ]);
    expect(ids.elements).toHaveLength(1);
  });
});
