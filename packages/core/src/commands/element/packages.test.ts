// Packages as elements (SR-048) and an element in several packages (SR-049) on
// fixtures/SR-048/packages: packages P1 "Release 1" and P2 "Release 2"; R1 in P1 and P2, R2 in P1,
// R3 in none; need N1, the parent of all three. One Git repository at the root, so `git status`
// shows which files a command wrote. An opened package is `selection.package` (SR-112 AK1).
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { createFixtureWorkspace } from "@reqseq/testkit";
import type { FixtureWorkspace } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import type { CommandOutput } from "../../catalog.js";
import { invoke } from "../../runtime/invoke.js";
import { Workspace } from "../../runtime/workspace.js";

const P = "48048048-0000-4000-8000-0000000000";
const [P1, P2, R1, R2, R3] = ["d1", "d2", "b1", "b2", "b3"].map((tail) => `${P}${tail}`) as [
  string,
  string,
  string,
  string,
  string,
];
const FILE = {
  P1: "packages/PKG-0000000000d1.md",
  P2: "packages/PKG-0000000000d2.md",
  R1: "requirements/SR-0000000000b1.md",
  R2: "requirements/SR-0000000000b2.md",
  R3: "requirements/SR-0000000000b3.md",
};

interface Opened {
  readonly fixture: FixtureWorkspace;
  readonly workspace: Workspace;
}

const open = async (): Promise<Opened> => {
  const fixture = await createFixtureWorkspace({ fixture: "SR-048/packages", git: true });
  onTestFinished(() => fixture.cleanup());
  const workspace = new Workspace(fixture.root);
  onTestFinished(() => workspace.close());
  return { fixture, workspace };
};

const run = async <N extends "element.create" | "element.update" | "element.list">(
  opened: Opened,
  name: N,
  input: Record<string, unknown>,
): Promise<CommandOutput<N>> =>
  (await invoke(name, input, { workspace: opened.workspace })) as CommandOutput<N>;

const read = (opened: Opened, file: string): Promise<string> =>
  fs.readFile(opened.fixture.path(file), "utf8");

const sha256 = async (opened: Opened, file: string): Promise<string> =>
  createHash("sha256")
    .update(await fs.readFile(opened.fixture.path(file)))
    .digest("hex");

/** The IDs of the elements of a package, as the opened package lists them. */
const membersOf = async (opened: Opened, pkg: string): Promise<string[]> =>
  (await run(opened, "element.list", { selection: { package: pkg } })).elements.map((e) => e.id);

/** Every file below the workspace (without `.git`) whose front matter has the line `id: <id>`. */
const filesWithId = async (opened: Opened, id: string): Promise<string[]> => {
  const entries = await fs.readdir(opened.fixture.root, { recursive: true, withFileTypes: true });
  const files = entries
    .filter((e) => e.isFile() && !e.parentPath.split(path.sep).includes(".git"))
    .map((e) => path.join(e.parentPath, e.name));
  const holding: string[] = [];
  for (const file of files) {
    if ((await fs.readFile(file, "utf8")).split(/\r?\n/).includes(`id: ${id}`)) {
      holding.push(path.relative(opened.fixture.root, file).split(path.sep).join("/"));
    }
  }
  return holding;
};

describe("packages (SR-048, SR-049)", () => {
  it("[SR-048/AK1] element.create of type package writes a package file", async () => {
    const opened = await open();
    const out = await run(opened, "element.create", { type: "package", title: "Release 3", text: "P3." });
    const tail = out.element.id.replaceAll("-", "").slice(-12);
    expect(out.element.type).toBe("package");
    expect(out.files).toEqual([`package/PKG-${tail}.md`]);
    expect(await read(opened, out.files[0] ?? "")).toBe(
      `---\nid: ${out.element.id}\ntype: package\nstatus: draft\ntitle: Release 3\n---\n\nP3.\n`,
    );
    expect(await opened.fixture.git(["status", "--porcelain"])).toBe("?? package/\n");
  });

  it("[SR-048/AK2] assigning a package writes it into the element file and leaves the package file unchanged", async () => {
    const opened = await open();
    const before = await sha256(opened, FILE.P1);
    const p1 = await run(opened, "element.list", { selection: { ids: [P1] } });
    const out = await run(opened, "element.update", { ref: "SR-0000b3", set: { packages: [{ id: P1 }] } });
    expect(out.files).toEqual([FILE.R3]);
    expect(await read(opened, FILE.R3)).toContain(
      `packages:\n  - { id: ${P1}, version: ${p1.elements[0]?.version ?? ""}, title: Release 1 }\n`,
    );
    expect(await sha256(opened, FILE.P1)).toBe(before);
    expect(await opened.fixture.git(["status", "--porcelain"])).toBe(` M ${FILE.R3}\n`);
    expect(await membersOf(opened, P1)).toEqual([R1, R2, R3]);
  });

  it("[SR-048/AK3] removing the package with element.update drops it from the element and from the package's elements", async () => {
    const opened = await open();
    const before = [await sha256(opened, FILE.P1), await sha256(opened, FILE.P2)];
    expect(await membersOf(opened, P1)).toEqual([R1, R2]);

    // R2 is only in P1: the property goes; R1 keeps P2 and loses P1.
    await run(opened, "element.update", { ref: R2, unset: ["packages"] });
    await run(opened, "element.update", { ref: R1, set: { packages: [{ id: P2 }] } });

    expect(await read(opened, FILE.R2)).not.toContain("packages:");
    const r1 = await read(opened, FILE.R1);
    expect(r1).toContain(`id: ${P2}`);
    expect(r1).not.toContain(`id: ${P1}`);
    expect([await sha256(opened, FILE.P1), await sha256(opened, FILE.P2)]).toEqual(before);
    expect(await opened.fixture.git(["status", "--porcelain"])).toBe(` M ${FILE.R1}\n M ${FILE.R2}\n`);
    expect(await membersOf(opened, P1)).toEqual([]);
    expect(await membersOf(opened, P2)).toEqual([R1]);
  });

  it("[SR-049/AK1] a requirement in P1 and P2 appears in both", async () => {
    const opened = await open();
    expect(await membersOf(opened, P1)).toEqual([R1, R2]);
    expect(await membersOf(opened, P2)).toEqual([R1]);
    expect(await membersOf(opened, "PKG-0000d2")).toEqual([R1]);
  });

  it("[SR-049/AK2] after a change both packages show the same content and there is exactly one file", async () => {
    const opened = await open();
    const old = await run(opened, "element.list", { selection: { ids: [R1] } });
    const out = await run(opened, "element.update", { ref: R1, text: "R1: changed once." });
    expect(out.element.version).not.toBe(old.elements[0]?.version);

    const shown = await Promise.all(
      [P1, P2].map(async (pkg) => {
        const listed = await run(opened, "element.list", { selection: { package: pkg }, withText: true });
        const element = listed.elements.find((e) => e.id === R1);
        return { text: element?.text, version: element?.version };
      }),
    );
    expect(shown).toEqual([
      { text: "R1: changed once.\n", version: out.element.version },
      { text: "R1: changed once.\n", version: out.element.version },
    ]);
    expect((await run(opened, "element.list", { selection: { ids: [R1] } })).total).toBe(1);
    expect(await filesWithId(opened, R1)).toEqual([FILE.R1]);
  });
});
