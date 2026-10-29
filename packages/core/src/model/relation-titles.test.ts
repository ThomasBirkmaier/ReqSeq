// Stored titles of relation targets follow their targets on the next write of the source (decision
// on spec question #307, `relation-titles.ts`). On fixtures/SR-025/outdated: requirement A derives
// from the need N, is valid in the variant V and references N in its text; requirement B refines A.
// Cross-repository targets on fixtures/SR-005/cross-repository.
import fs from "node:fs";
import { createFixtureWorkspace } from "@reqseq/testkit";
import type { FixtureOptions, FixtureWorkspace } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import type { CommandName, CommandOutput } from "../catalog.js";
import { metamodelState } from "../metamodel/index.js";
import { invoke } from "../runtime/invoke.js";
import { Workspace } from "../runtime/workspace.js";
import { workspaceLayoutState } from "../workspace/index.js";
import { withCurrentTitles } from "./relation-titles.js";
import { elementStoreState } from "./store.js";
import { readUnchanged } from "./write.js";

const P = "5e025a7d-2b4f-4c61-9d08-0";
const N = `${P}a0000000001`;
const A = `${P}b0000000001`;
const B = `${P}b0000000002`;
const V = `${P}c0000000001`;
const N_FILE = "needs/N-0a0000000001.md";
const V_FILE = "variants/V-0c0000000001.md";
const A_FILE = "requirements/SR-0b0000000001.md";
const B_FILE = "requirements/SR-0b0000000002.md";
const N_VERSION = "n1:4a120bac998acdc8";
const V_VERSION = "n1:b3f17e3d2a46ea1e";
const A_VERSION = "n1:c432bd0d8bcd0958";

const N_LINE = `  - { id: ${N}, version: ${N_VERSION}, title: See the wind }`;
const V_LINE = `  - { id: ${V}, version: ${V_VERSION}, title: Pro }`;
const A_LINE = `  - { id: ${A}, version: ${A_VERSION}, title: Show wind speed }`;

interface Opened {
  readonly ws: FixtureWorkspace;
  readonly workspace: Workspace;
}

const open = async (options: FixtureOptions = {}, root = ""): Promise<Opened> => {
  const ws = await createFixtureWorkspace({ fixture: "SR-025/outdated", ...options });
  onTestFinished(() => ws.cleanup());
  const workspace = new Workspace(root === "" ? ws.root : ws.path(root));
  onTestFinished(() => workspace.close());
  return { ws, workspace };
};

const run = async <C extends CommandName>(
  { workspace }: Opened,
  name: C,
  input: Record<string, unknown>,
): Promise<CommandOutput<C>> => (await invoke(name, input, { workspace })) as CommandOutput<C>;

const read = ({ ws }: Opened, file: string): string => fs.readFileSync(ws.path(file), "utf8");

/** An element file of the fixture with another title and the same text, so its version stays. */
const renamed = (text: string, title: string): string => text.replace(/^title: .*$/m, `title: ${title}`);

/** A file of fixtures/SR-025/outdated as it is checked in. */
const fixtureFile = (file: string): string =>
  fs.readFileSync(new URL(`../../../../fixtures/SR-025/outdated/${file}`, import.meta.url), "utf8");

/** The fixture with N renamed to `title` (and V to `variant`, A to `requirement`, when given); no version changes. */
const renamedTargets = (title: string, variant?: string, requirement?: string): FixtureOptions => ({
  files: {
    [N_FILE]: renamed(fixtureFile(N_FILE), title),
    ...(variant === undefined ? {} : { [V_FILE]: renamed(fixtureFile(V_FILE), variant) }),
    ...(requirement === undefined ? {} : { [A_FILE]: renamed(fixtureFile(A_FILE), requirement) }),
  },
});

/** The open `relation.outdated` hints, or those about `ref`. */
const outdated = async (opened: Opened, ref?: string): Promise<readonly unknown[]> =>
  (await run(opened, "hint.list", { kind: ["relation.outdated"], ...(ref === undefined ? {} : { ref }) }))
    .hints;

describe("stored titles of relation targets (decision on #307)", () => {
  it("gives no hint for a rename alone and changes no file", async () => {
    const opened = await open(renamedTargets("See the gusts", "Pro 2"));
    const before = read(opened, A_FILE);
    expect(await outdated(opened)).toEqual([]);
    expect(read(opened, A_FILE)).toBe(before);
  });

  it("element.update writes the current titles of the same-repository targets and nothing else besides its change", async () => {
    const opened = await open(renamedTargets("See the gusts", "Pro 2"));
    const before = read(opened, A_FILE);
    const result = await run(opened, "element.update", { ref: A, set: { "requirement-type": "quality" } });
    expect(result.files).toEqual([A_FILE]);
    expect(read(opened, A_FILE)).toBe(
      before
        .replace("requirement-type: functional", "requirement-type: quality")
        .replace(N_LINE, N_LINE.replace("See the wind }", "See the gusts }"))
        .replace(V_LINE, V_LINE.replace("Pro }", "Pro 2 }")),
    );
    // The label of the inline reference is text, which counts to the version: it stays.
    expect(read(opened, A_FILE)).toContain(`[See the wind](logreq:${N}?version=${N_VERSION})`);
    // The stored versions stay: nothing in A was confirmed or became outdated.
    expect(await outdated(opened, A)).toEqual([]);
    expect(result.element.relations).toContainEqual(
      expect.objectContaining({ id: N, title: "See the gusts" }),
    );
  });

  it("element.update that changes nothing writes nothing, also with a stale title", async () => {
    const opened = await open(renamedTargets("See the gusts"));
    const before = read(opened, A_FILE);
    const result = await run(opened, "element.update", { ref: A, title: "Show wind speed" });
    expect(result.files).toEqual([]);
    expect(read(opened, A_FILE)).toBe(before);
  });

  it("element.update gives a relation of the element to itself its new title", async () => {
    const self = `  - { id: ${A}, version: ${A_VERSION}, title: Show wind speed }`;
    const opened = await open();
    const text = read(opened, A_FILE).replace(N_LINE, `${N_LINE}\nrefines:\n${self}`);
    await opened.ws.write(A_FILE, text);
    await run(opened, "element.update", { ref: A, title: "Show the wind speed" });
    expect(read(opened, A_FILE)).toBe(
      text
        .replace("title: Show wind speed\n", "title: Show the wind speed\n")
        .replace(self, self.replace("Show wind speed }", "Show the wind speed }")),
    );
  });

  it("element.setStatus, relation.add and relation.remove refresh the titles of the file they write", async () => {
    const opened = await open(renamedTargets("See the gusts", "Pro 2"));
    const a = read(opened, A_FILE);
    await run(opened, "element.setStatus", { refs: [A], status: "approved" });
    const afterStatus = a
      .replace("status: draft", "status: approved")
      .replace(N_LINE, N_LINE.replace("See the wind }", "See the gusts }"))
      .replace(V_LINE, V_LINE.replace("Pro }", "Pro 2 }"));
    expect(read(opened, A_FILE)).toBe(afterStatus);

    // B refines A; A is renamed, then B gets a new relation: its stored title of A follows too.
    await run(opened, "element.update", { ref: A, title: "Show the wind speed" });
    const b = read(opened, B_FILE);
    const added = await run(opened, "relation.add", { source: B, kind: "derives-from", target: N });
    expect(added.files).toEqual([B_FILE]);
    const newLine = `derives-from:\n  - { id: ${N}, version: ${N_VERSION}, title: See the gusts }\n`;
    const afterAdd = b
      .replace(A_LINE, A_LINE.replace("Show wind speed }", "Show the wind speed }"))
      .replace("---\n\nRefines", `${newLine}---\n\nRefines`);
    expect(read(opened, B_FILE)).toBe(afterAdd);

    await opened.ws.write(N_FILE, renamed(read(opened, N_FILE), "See the storm"));
    // The title comes from the element store the command reads, as the hints do; read it again.
    await opened.workspace.reset(elementStoreState);
    await run(opened, "relation.remove", { source: B, kind: "refines", target: A });
    expect(read(opened, B_FILE)).toBe(
      afterAdd
        .replace(`refines:\n${A_LINE.replace("Show wind speed }", "Show the wind speed }")}\n`, "")
        .replace("title: See the gusts }", "title: See the storm }"),
    );
  });

  it("element.bulkUpdate refreshes the titles of every file it writes", async () => {
    const opened = await open(renamedTargets("See the gusts", undefined, "Wind speed"));
    const a = read(opened, A_FILE);
    const b = read(opened, B_FILE);
    const bulk = await run(opened, "element.bulkUpdate", {
      selection: { ids: [A, B] },
      property: "requirement-type",
      operation: "set",
      value: "quality",
      confirm: true,
    });
    expect(bulk.files).toEqual([A_FILE, B_FILE]);
    expect(read(opened, A_FILE)).toBe(
      a
        .replace("requirement-type: functional", "requirement-type: quality")
        .replace(N_LINE, N_LINE.replace("See the wind }", "See the gusts }")),
    );
    expect(read(opened, B_FILE)).toBe(
      b
        .replace("requirement-type: functional", "requirement-type: quality")
        .replace(A_LINE, A_LINE.replace("Show wind speed }", "Wind speed }")),
    );
  });

  it("element.supersede refreshes the titles of both files it writes", async () => {
    const opened = await open(renamedTargets("See the gusts", undefined, "Wind speed"));
    const a = read(opened, A_FILE);
    const b = read(opened, B_FILE);
    const result = await run(opened, "element.supersede", {
      ref: A,
      status: "obsolete",
      successor: B,
      relation: "supersedes",
    });
    expect(result.files).toEqual([A_FILE, B_FILE]);
    expect(read(opened, A_FILE)).toBe(
      a
        .replace("status: draft", "status: obsolete")
        .replace(N_LINE, N_LINE.replace("See the wind }", "See the gusts }")),
    );
    expect(read(opened, B_FILE)).toBe(
      b
        .replace(A_LINE, A_LINE.replace("Show wind speed }", "Wind speed }"))
        .replace(
          "---\n\nRefines",
          `supersedes:\n  - { id: ${A}, version: ${A_VERSION}, title: Wind speed }\n---\n\nRefines`,
        ),
    );
  });

  it("hint.confirm writes the current version and title of the confirmed target and the current titles of the others", async () => {
    const opened = await open(renamedTargets("See the gusts", "Pro 2"));
    await opened.ws.write(N_FILE, read(opened, N_FILE).replace("at a glance.", "at once."));
    const hint = (await run(opened, "hint.list", { kind: ["relation.outdated"], ref: A })).hints.find((h) =>
      (h.hintId ?? "").includes("/derives-from/"),
    );
    const a = read(opened, A_FILE);
    const current = String(hint?.currentVersion);
    await run(opened, "hint.confirm", { hintIds: [hint?.hintId] });
    expect(read(opened, A_FILE)).toBe(
      a
        .replace(N_LINE, N_LINE.replace(N_VERSION, current).replace("See the wind }", "See the gusts }"))
        .replace(V_LINE, V_LINE.replace("Pro }", "Pro 2 }")),
    );
  });

  it("hint.confirm writes the current version and title into a relation-valued property that holds one target", async () => {
    const OLD = "n1:0000000000000000";
    const model = fixtureFile("metamodel/standard-model.yaml");
    const opened = await open({
      files: {
        ...renamedTargets("See the gusts").files,
        "metamodel/standard-model.yaml": model.replace(
          "properties:\n  - key: title\n",
          "properties:\n  - { key: origin, name: Origin, kind: relation, target-types: [need] }\n  - key: title\n",
        ),
        [B_FILE]: `---\nid: ${B}\ntype: system-requirement\nstatus: draft\ntitle: Large digits\nrequirement-type: functional\nacceptance-criteria: [Big]\norigin: { id: ${N}, version: ${OLD}, title: See the wind }\n---\n`,
      },
    });
    const id = `relation.outdated/system/${encodeURIComponent(B_FILE)}/${B}/origin/${N}?version=${OLD}`;
    expect(await run(opened, "hint.confirm", { hintIds: [id] })).toMatchObject({
      confirmed: [id],
      files: [B_FILE],
    });
    expect(read(opened, B_FILE)).toContain(
      `origin: { id: ${N}, version: ${N_VERSION}, title: See the gusts }\n`,
    );
  });

  it("leaves an entry the call itself sets as set: a new target gets its title from its file, not from an older store", async () => {
    const opened = await open();
    // The store is read; then N is renamed by hand, so the store still holds its old title.
    expect(await outdated(opened)).toEqual([]);
    await opened.ws.write(N_FILE, renamed(read(opened, N_FILE), "See the storm"));
    const b = read(opened, B_FILE);
    await run(opened, "relation.add", { source: B, kind: "derives-from", target: N });
    expect(read(opened, B_FILE)).toBe(
      b.replace(
        "---\n\nRefines",
        `derives-from:\n  - { id: ${N}, version: ${N_VERSION}, title: See the storm }\n---\n\nRefines`,
      ),
    );
  });

  it("keeps the quoting and layout of each title and leaves titles it cannot change in place", async () => {
    const opened = await open(renamedTargets('"Wind: gusts"', "Pro 2"));
    const text = [
      "---",
      `id: ${A}`,
      "type: system-requirement",
      "status: draft",
      "title: Show wind speed",
      "rationale: &why See the wind",
      "requirement-type: functional # by hand",
      "derives-from:",
      `  - { id: ${N}, version: ${N_VERSION}, title: 'See the wind' } # quoted`,
      `  - id: ${N}`,
      `    version: ${N_VERSION}`,
      "    title: See the wind   # block",
      `  - { id: ${N}, version: ${N_VERSION}, title: *why }`,
      "validity:",
      `  - id: ${V}`,
      `    version: ${V_VERSION}`,
      "    title: >-",
      "      Pro",
      "refines:",
      `  - { id: ${B}, version: n1:0000000000000000, title: &b Old }`,
      "topic: *b",
      "---",
      "",
      "Text.",
      "",
    ].join("\n");
    await opened.ws.write(A_FILE, text);
    await run(opened, "element.update", { ref: A, set: { "requirement-type": "quality" } });
    expect(read(opened, A_FILE)).toBe(
      text
        .replace("requirement-type: functional", "requirement-type: quality")
        .replace("title: 'See the wind' }", "title: 'Wind: gusts' }")
        .replace("    title: See the wind   # block", '    title: "Wind: gusts"   # block'),
    );
  });

  it("never touches a target in another repository or one it cannot name, nor an entry without a text title", async () => {
    const MISSING = `${P}a00000000ff`;
    const TWICE = `${P}a0000000002`;
    const NUMBER = `${P}a0000000003`;
    const need = (id: string, title: string): string =>
      `---\nid: ${id}\ntype: need\nstatus: draft\ntitle: ${title}\n---\n\nA need.\n`;
    const text = [
      "---",
      `id: ${A}`,
      "type: system-requirement",
      "status: draft",
      "title: Show wind speed",
      "requirement-type: functional",
      "derives-from:",
      `  - { id: ${N}, version: ${N_VERSION}, repository: other, title: See the wind }`,
      `  - { id: ${N}, version: ${N_VERSION}, repository: system, title: Old }`,
      `  - { id: ${MISSING}, version: ${N_VERSION}, title: Gone }`,
      `  - { id: ${TWICE}, version: ${N_VERSION}, title: Twice }`,
      `  - { id: ${NUMBER}, version: ${N_VERSION}, title: Number }`,
      `  - { id: ${N}, version: ${N_VERSION} }`,
      `  - { id: ${N}, version: ${N_VERSION}, title: 42 }`,
      "  - plain",
      "x-by-hand:",
      `  - { id: ${N}, version: ${N_VERSION}, title: Old }`,
      "---",
      "",
      "Text.",
      "",
    ].join("\n");
    const opened = await open({
      files: {
        [A_FILE]: text,
        "needs/twice-1.md": need(TWICE, "One"),
        "needs/twice-2.md": need(TWICE, "Two"),
        "needs/number.md": need(NUMBER, "2026"),
      },
    });
    await run(opened, "element.update", { ref: A, set: { "requirement-type": "quality" } });
    expect(read(opened, A_FILE)).toBe(
      text
        .replace("requirement-type: functional", "requirement-type: quality")
        .replace("repository: system, title: Old }", "repository: system, title: See the wind }"),
    );
  });

  it("never touches a target across repositories, also one stored by hand with a title", async () => {
    const SOURCE = "requirements/SR-1a3c5e7b9d0f.md";
    const NEED = "4c1d9e7a-8b2f-4a3c-9d5e-6f7a8b9c0d1e";
    const ws = await createFixtureWorkspace({ fixture: "SR-005/cross-repository" });
    onTestFinished(() => ws.cleanup());
    const file = ws.path(`system/${SOURCE}`);
    const across = `  - { id: ${NEED}, version: n1:1111111111111111, repository: platform }`;
    const text = fs.readFileSync(file, "utf8").replace(
      across,
      [
        across.replace(" }", ", title: Old }"),
        // Written before references named their repository: the target is not in this one.
        `  - { id: ${NEED}, version: n1:1111111111111111, title: Old }`,
      ].join("\n"),
    );
    fs.writeFileSync(file, text);
    const workspace = new Workspace(ws.path("system"));
    onTestFinished(() => workspace.close());
    await invoke(
      "element.update",
      { ref: "8f1e3d5c-7b9a-4c2e-a4f6-1a3c5e7b9d0f", set: { "requirement-type": "quality" } },
      { workspace },
    );
    expect(fs.readFileSync(file, "utf8")).toBe(
      text.replace("requirement-type: functional", "requirement-type: quality"),
    );
  });

  it("passes a planned write that changes nothing, bytes that are no element mapping, and a metamodel without title as they are", async () => {
    const opened = await open(renamedTargets("See the gusts"));
    const { workspace } = opened;
    const [layout, metamodel, store] = await Promise.all([
      workspace.get(workspaceLayoutState),
      workspace.get(metamodelState),
      workspace.get(elementStoreState),
    ]);
    const record = store.byId.get(A)?.[0];
    if (record === undefined) {
      throw new Error("A is not in the store");
    }
    const unchanged = await readUnchanged(workspace, layout, record);
    const encode = (text: string): Uint8Array => new TextEncoder().encode(text);
    const same = { ...unchanged, bytes: encode(read(opened, A_FILE)) };
    const plain = { ...unchanged, bytes: encode("No frontmatter.\n") };
    const list = { ...unchanged, bytes: encode("---\n- a\n---\n") };
    const stale = { ...unchanged, bytes: encode(read(opened, A_FILE).replace("draft", "approved")) };
    const context = { metamodel, store };
    const out = withCurrentTitles(context, [same, plain, list, stale]);
    expect(out.slice(0, 3)).toEqual([same, plain, list]);
    expect(new TextDecoder().decode(out[3]?.bytes)).toContain("title: See the gusts }");
    const untitled = { ...metamodel, properties: metamodel.properties.filter((p) => p.meaning !== "title") };
    expect(withCurrentTitles({ metamodel: untitled, store }, [stale])).toEqual([stale]);
  });
});
