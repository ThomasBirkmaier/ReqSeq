// Confirming hints (SR-027) on fixtures/SR-025/outdated: requirement A derives from the need N, is
// valid in the variant V (a relation-valued property, ADR-0004) and references N in its text;
// requirement B refines A. Every stored version is current until a test changes a target.
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createFixtureWorkspace } from "@logreq/testkit";
import type { FixtureWorkspace } from "@logreq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import type { CommandOutput, Problem } from "../catalog.js";
import { elementStoreState } from "../model/index.js";
import { invoke } from "../runtime/invoke.js";
import { Workspace } from "../runtime/workspace.js";

type Confirmed = CommandOutput<"hint.confirm">;

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
const OLD = "n1:0000000000000000";
/** Where A is stored, as hint IDs name it. */
const AT_A = `system/${encodeURIComponent(A_FILE)}/${A}`;
const AT_B = `system/${encodeURIComponent(B_FILE)}/${B}`;
const DERIVES = `relation.outdated/${AT_A}/derives-from/${N}?version=${N_VERSION}`;
const VALIDITY = `relation.outdated/${AT_A}/validity/${V}?version=${V_VERSION}`;
const LINK = `relation.outdated/${AT_A}/@text/${N}?version=${N_VERSION}&n=1`;

const fixture = async (
  options: Parameters<typeof createFixtureWorkspace>[0] = {},
): Promise<FixtureWorkspace> => {
  const created = await createFixtureWorkspace({ fixture: "SR-025/outdated", ...options });
  onTestFinished(() => created.cleanup());
  return created;
};

const open = (root: string): Workspace => {
  const workspace = new Workspace(root);
  onTestFinished(() => workspace.close());
  return workspace;
};

const confirm = async (workspace: Workspace, hintIds: readonly string[]): Promise<Confirmed> =>
  (await invoke("hint.confirm", { hintIds }, { workspace })) as Confirmed;

/** The open `relation.outdated` hints. */
const outdated = async (workspace: Workspace): Promise<readonly Problem[]> =>
  ((await invoke("hint.list", { kind: ["relation.outdated"] }, { workspace })) as CommandOutput<"hint.list">)
    .hints;

const need = (text: string): string =>
  `---\nid: ${N}\ntype: need\nstatus: approved\ntitle: See the wind\n---\n\n${text}\n`;

/** Changes the text of N and of V, so that every relation of A to them is outdated. */
const changeTargets = async (ws: FixtureWorkspace): Promise<void> => {
  await ws.write(N_FILE, need("The operator sees wind speed and direction at a glance."));
  await ws.write(
    V_FILE,
    `---\nid: ${V}\ntype: variant\nstatus: draft\ntitle: Pro\n---\n\nFor professional users.\n`,
  );
};

const FIXTURE_FOLDER = path.resolve(import.meta.dirname, "../../../../fixtures/SR-025/outdated");
/** A file of fixtures/SR-025/outdated as it is checked in. */
const fromFixture = (file: string): string => fs.readFileSync(path.join(FIXTURE_FOLDER, file), "utf8");

const read = (ws: FixtureWorkspace, file: string): string => fs.readFileSync(ws.path(file), "utf8");

/** The current version of `id` as `hint.list` reports it on a hint about it. */
const currentOf = (hints: readonly Problem[], hintId: string): string => {
  const version = hints.find((h) => h.hintId === hintId)?.currentVersion;
  expect(version).toMatch(/^n1:[0-9a-f]{16}$/);
  return version ?? "";
};

/** SHA-256 of every file below `folder`, by relative path. */
const tree = (folder: string): Record<string, string> =>
  Object.fromEntries(
    fs
      .readdirSync(folder, { recursive: true, withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) => {
        const file = path.join(e.parentPath, e.name);
        return [
          path.relative(folder, file),
          createHash("sha256").update(fs.readFileSync(file)).digest("hex"),
        ];
      }),
  );

describe("hint.confirm (SR-027)", () => {
  it("[SR-027/AK1] writes the current version and title of the confirmed target into its relation; besides, only the other stale titles of the file change (decision on #307)", async () => {
    const ws = await fixture();
    await changeTargets(ws);
    // N and V are renamed too. Since the decision on #307 the confirmed relation gets the current
    // title with the version, and the write refreshes the stale title of V (not its version);
    // every other byte of the file stays.
    await ws.write(
      N_FILE,
      need("The operator sees wind speed and direction at a glance.").replace(
        "title: See the wind",
        "title: See the gusts",
      ),
    );
    await ws.write(V_FILE, fs.readFileSync(ws.path(V_FILE), "utf8").replace("title: Pro", "title: Pro 2"));
    const workspace = open(ws.root);
    const hints = await outdated(workspace);
    expect(hints.map((h) => h.hintId)).toEqual([VALIDITY, DERIVES, LINK]);
    const before = read(ws, A_FILE);
    const current = currentOf(hints, DERIVES);
    expect(await confirm(workspace, [DERIVES])).toEqual({
      confirmed: [DERIVES],
      files: [A_FILE],
      problems: [],
    });
    const line = `  - { id: ${N}, version: ${N_VERSION}, title: See the wind }`;
    expect(before).toContain(line);
    const variant = `  - { id: ${V}, version: ${V_VERSION}, title: Pro }`;
    expect(read(ws, A_FILE)).toBe(
      before
        .replace(line, line.replace(N_VERSION, current).replace("See the wind }", "See the gusts }"))
        .replace(variant, variant.replace("Pro }", "Pro 2 }")),
    );
    // The other two are still open; only the confirmed one is gone.
    expect((await outdated(workspace)).map((h) => h.hintId)).toEqual([VALIDITY, LINK]);
  });

  it("[SR-027/AK1] writes into a relation-valued property and into an inline reference alike", async () => {
    const ws = await fixture();
    await changeTargets(ws);
    const workspace = open(ws.root);
    const hints = await outdated(workspace);
    const before = read(ws, A_FILE);
    await confirm(workspace, [VALIDITY]);
    const item = `  - { id: ${V}, version: ${V_VERSION}, title: Pro }`;
    const afterValidity = before.replace(item, item.replace(V_VERSION, currentOf(hints, VALIDITY)));
    expect(read(ws, A_FILE)).toBe(afterValidity);
    await confirm(workspace, [LINK]);
    const link = `[See the wind](logreq:${N}?version=${N_VERSION})`;
    expect(read(ws, A_FILE)).toBe(
      afterValidity.replace(link, link.replace(N_VERSION, currentOf(hints, LINK))),
    );
    expect((await outdated(workspace)).map((h) => h.hintId)).toEqual([
      DERIVES,
      expect.stringContaining(AT_B),
    ]);
  });

  it("[SR-027/AK1] keeps the quoting, comments and layout of the item and the other parameters of the link", async () => {
    const text = [
      "---",
      `id: ${A}`,
      "type: system-requirement",
      "status: draft",
      "title: Show wind speed",
      "requirement-type: functional",
      "acceptance-criteria:",
      "  - Given wind, when it is measured, then the station shows its speed.",
      "derives-from:   # by hand",
      `  - id: ${N}`,
      `    version: '${OLD}'   # old`,
      '    title: "See the wind"',
      `  - {id: ${N}, version: "${OLD}", title: 'See the wind'}`,
      "---",
      "",
      `[One](logreq:${N}?a=1&version=${OLD}&b=2) and [two](logreq:${N}?version=${OLD}) and [three](<logreq:${N}?version=${OLD}>) and [unversioned](logreq:${N}).`,
      "",
    ].join("\r\n");
    const ws = await fixture({ files: { [A_FILE]: text } });
    const workspace = open(ws.root);
    const hints = await outdated(workspace);
    const derives = `relation.outdated/${AT_A}/derives-from/${N}?version=${OLD}`;
    const link = (n: number): string => `relation.outdated/${AT_A}/@text/${N}?version=${OLD}&n=${String(n)}`;
    // Both items share one ID; the links name the same target, repository and version: n counts them.
    expect(hints.filter((h) => h.elementId === A).map((h) => [h.hintId, h.line])).toEqual([
      [derives, 10],
      [derives, 13],
      [link(1), 16],
      [link(2), 16],
      [link(3), 16],
    ]);
    const current = currentOf(hints, derives);
    expect(await confirm(workspace, [derives, link(3)])).toEqual({
      confirmed: [derives, link(3)],
      files: [A_FILE],
      problems: [],
    });
    expect(read(ws, A_FILE)).toBe(
      text
        .replace(`'${OLD}'   # old`, `'${current}'   # old`)
        .replace(`"${OLD}"`, `"${current}"`)
        .replace(`<logreq:${N}?version=${OLD}>`, `<logreq:${N}?version=${current}>`),
    );
    // n=1 is the first of them; the other parameters stay where they are.
    expect(await confirm(workspace, [link(1)])).toMatchObject({ confirmed: [link(1)] });
    expect(read(ws, A_FILE)).toContain(
      `[One](logreq:${N}?a=1&version=${current}&b=2) and [two](logreq:${N}?version=${OLD})`,
    );
  });

  it("[SR-027/AK1] writes into a relation-valued property that holds one target", async () => {
    const model = fromFixture("metamodel/standard-model.yaml");
    const ws = await fixture({
      files: {
        "metamodel/standard-model.yaml": model.replace(
          "properties:\n  - key: title\n",
          "properties:\n  - { key: origin, name: Origin, kind: relation, target-types: [need] }\n  - key: title\n",
        ),
        [B_FILE]: `---\nid: ${B}\ntype: system-requirement\nstatus: draft\ntitle: Large digits\nrequirement-type: functional\nacceptance-criteria: [Big]\norigin: { id: ${N}, version: ${OLD} }\n---\n`,
      },
    });
    const workspace = open(ws.root);
    const id = `relation.outdated/${AT_B}/origin/${N}?version=${OLD}`;
    expect(await confirm(workspace, [id])).toEqual({ confirmed: [id], files: [B_FILE], problems: [] });
    expect(read(ws, B_FILE)).toContain(`origin: { id: ${N}, version: ${N_VERSION} }\n`);
  });

  it("[SR-027/AK2] confirms each of several hints on its own, with one write per file", async () => {
    // C refines B: B is written and a target, but a relation item is no part of B's version (ADR-0005).
    const C_FILE = "requirements/SR-0b0000000003.md";
    const C = `${P}b0000000003`;
    const ws = await fixture({
      files: {
        [B_FILE]: fromFixture(B_FILE).replace(A_VERSION, OLD),
        [C_FILE]: `---\nid: ${C}\ntype: system-requirement\nstatus: draft\ntitle: C\nrequirement-type: functional\nacceptance-criteria: [C]\nrefines:\n  - { id: ${B}, version: ${OLD} }\n---\n`,
      },
    });
    await changeTargets(ws);
    const workspace = open(ws.root);
    const refines = `relation.outdated/${AT_B}/refines/${A}?version=${OLD}`;
    const refinesB = `relation.outdated/system/${encodeURIComponent(C_FILE)}/${C}/refines/${B}?version=${OLD}`;
    expect((await outdated(workspace)).map((h) => h.hintId)).toEqual([
      VALIDITY,
      DERIVES,
      LINK,
      refines,
      refinesB,
    ]);
    const out = await confirm(workspace, [LINK, refines, DERIVES, VALIDITY, refinesB]);
    expect(out).toEqual({
      confirmed: [LINK, refines, DERIVES, VALIDITY, refinesB],
      files: [A_FILE, B_FILE, C_FILE],
      problems: [],
    });
    // The confirmed link changed A's text and so its version (ADR-0005); B gets A's version after
    // this call, as if the hints were confirmed one after the other. Nothing is left.
    expect(await outdated(workspace)).toEqual([]);
  });

  it("[SR-027/AK2] confirms one after the other along a chain of written sources, and writes a ring of references once (spec question #281)", async () => {
    const C = `${P}b0000000003`;
    const C_FILE = "requirements/SR-0b0000000003.md";
    const ws = await fixture({
      files: {
        [B_FILE]: fromFixture(B_FILE)
          .replace(A_VERSION, OLD)
          .replace("Refines how", `[A](logreq:${A}?version=${OLD}) refines how`),
        [C_FILE]: `---\nid: ${C}\ntype: system-requirement\nstatus: draft\ntitle: C\nrequirement-type: functional\nacceptance-criteria: [C]\nrefines:\n  - { id: ${B}, version: ${OLD} }\n---\n`,
      },
    });
    await changeTargets(ws);
    const workspace = open(ws.root);
    // C refines B refines A, whose link to N is confirmed: each later one gets the version after the write.
    const chain = (await outdated(workspace))
      .map((h) => h.hintId ?? "")
      .filter((id) => id !== DERIVES && id !== VALIDITY);
    expect(chain).toHaveLength(4);
    expect((await confirm(workspace, chain.toReversed())).files).toEqual([C_FILE, B_FILE, A_FILE]);
    expect((await outdated(workspace)).map((h) => h.hintId)).toEqual([VALIDITY, DERIVES]);
    // A ring: A's text points at B and B's text at A. Each write changes the other's target.
    await ws.write(A_FILE, `${read(ws, A_FILE)}\n[B](logreq:${B}?version=${OLD})\n`);
    await workspace.reset(elementStoreState);
    const ring = (await outdated(workspace)).filter(
      (h) => h.code === "relation.outdated" && h.storedVersion === OLD,
    );
    expect(ring.map((h) => [h.elementId, h.targetId])).toEqual([[A, B]]);
    const out = await confirm(
      workspace,
      ring.map((h) => h.hintId ?? ""),
    );
    expect(out).toMatchObject({ files: [A_FILE], problems: [] });
    // B's links to A are outdated now; confirming them changes A again, and so on (#281).
    expect((await outdated(workspace)).map((h) => [h.elementId, h.targetId])).toEqual([
      [A, V],
      [A, N],
      [B, A],
      [B, A],
    ]);
    const ofB = (await outdated(workspace)).filter((h) => h.elementId === B).map((h) => h.hintId ?? "");
    expect(await confirm(workspace, ofB)).toMatchObject({ confirmed: ofB, files: [B_FILE] });
    // B changed, so A's link to B and C's refinement of B are outdated again: the ring never settles.
    expect((await outdated(workspace)).map((h) => [h.elementId, h.targetId])).toEqual([
      [A, V],
      [A, N],
      [A, B],
      [C, B],
    ]);
  });

  it("[SR-027/AK2] ends a call that confirms both sides of a ring of references, writes both files, and leaves the ring outdated (spec question #281)", async () => {
    const ws = await fixture({
      files: {
        [A_FILE]: `${fromFixture(A_FILE)}\n[B](logreq:${B}?version=${OLD})\n`,
        [B_FILE]: `${fromFixture(B_FILE)}\n[A](logreq:${A}?version=${OLD})\n`,
      },
    });
    const workspace = open(ws.root);
    const ring = (await outdated(workspace)).filter((h) => h.storedVersion === OLD);
    expect(ring.map((h) => [h.elementId, h.targetId])).toEqual([
      [A, B],
      [B, A],
    ]);
    const out = await confirm(
      workspace,
      ring.map((h) => h.hintId ?? ""),
    );
    expect(out).toMatchObject({ files: [A_FILE, B_FILE], problems: [] });
    // Each write changes the other side's target, so the ring does not settle: the last round gave B
    // A's final version, which B's new text makes outdated on A's side again; B's refinement of A,
    // not confirmed here, is outdated since A's text changed.
    const left = (await outdated(workspace)).map((h) => [h.elementId, h.targetId, h.storedVersion === OLD]);
    expect(left).toEqual([
      [A, B, false],
      [B, A, false],
    ]);
    expect((await outdated(workspace)).map((h) => h.hintId)).not.toContain(ring[1]?.hintId);
  });

  it("[SR-027/AK2] confirms an ID in another spelling once, and writes the others when a file holds a version by a YAML alias or anchor", async () => {
    const text = [
      "---",
      `id: ${A}`,
      "type: system-requirement",
      "status: draft",
      "title: Show wind speed",
      "requirement-type: functional",
      "acceptance-criteria:",
      "  - Given wind, when it is measured, then the station shows its speed.",
      "derives-from:",
      `  - { id: ${N}, version: &v ${N_VERSION}, title: See the wind }`,
      "validity:",
      `  - { id: ${V}, version: *v, title: Pro }`,
      "---",
      "",
      `So that the operator can [See the wind](logreq:${N}?version=${N_VERSION}).`,
      "",
    ].join("\n");
    const ws = await fixture({
      files: { [A_FILE]: text, [B_FILE]: fromFixture(B_FILE).replace(A_VERSION, OLD) },
    });
    await changeTargets(ws);
    const workspace = open(ws.root);
    const refines = `relation.outdated/${AT_B}/refines/${A}?version=${OLD}`;
    const aliased = `relation.outdated/${AT_A}/validity/${V}?version=${N_VERSION}`;
    // The same refinement, with the slash of the file name percent-encoded in lower case (%2f).
    const respelled = `relation.outdated/system/${encodeURIComponent(B_FILE).replace("%2F", "%2f")}/${B}/refines/${A}?version=${OLD}`;
    const first = await confirm(workspace, [aliased, refines, respelled]);
    expect(first).toMatchObject({ confirmed: [refines, respelled], files: [B_FILE] });
    expect(first.problems).toEqual([
      expect.objectContaining({
        code: "hint.not-confirmable",
        hintId: aliased,
        message: expect.stringContaining(`${A_FILE} cannot be changed in place`) as unknown,
      }),
    ]);
    expect(read(ws, A_FILE)).toBe(text);
    expect(read(ws, B_FILE)).not.toContain(OLD);
    // The anchored version: changing it would change the alias too, so A is not written.
    const anchored = await confirm(workspace, [DERIVES, LINK]);
    expect(anchored).toMatchObject({ confirmed: [], files: [] });
    expect(anchored.problems?.map((p) => [p.code, p.hintId])).toEqual([
      ["hint.not-confirmable", DERIVES],
      ["hint.not-confirmable", LINK],
    ]);
    expect(read(ws, A_FILE)).toBe(text);
  });

  it("[SR-027/AK2] gives a problem for each ID that confirms nothing and confirms the others", async () => {
    const ws = await fixture();
    await changeTargets(ws);
    const workspace = open(ws.root);
    const unknownProperty = `element.unknown-property/system/${encodeURIComponent(A_FILE)}/${A}/customer-id`;
    const stale = `relation.outdated/${AT_A}/derives-from/${N}?version=${OLD}`;
    const gone = `relation.outdated/system/${encodeURIComponent("needs/gone.md")}/${A}/derives-from/${N}?version=${N_VERSION}`;
    const nobody = `relation.outdated/${AT_A.replace(A, `${P}b0000000009`)}/derives-from/${N}?version=${N_VERSION}`;
    const out = await confirm(workspace, [unknownProperty, DERIVES, stale, DERIVES, gone, nobody, ""]);
    expect(out.confirmed).toEqual([DERIVES]);
    expect(out.files).toEqual([A_FILE]);
    expect((out.problems ?? []).map((p) => [p.code, p.severity, p.hintId])).toEqual([
      ["hint.not-confirmable", "error", unknownProperty],
      ["hint.not-found", "warning", stale],
      ["hint.not-found", "warning", gone],
      ["hint.not-found", "warning", nobody],
      ["hint.not-confirmable", "error", ""],
    ]);
    expect(out.problems?.[1]).toMatchObject({
      repository: "system",
      file: A_FILE,
      elementId: A,
      targetId: N,
    });
    // Confirmed already: nothing to write.
    const again = await confirm(workspace, [DERIVES]);
    expect(again).toEqual({
      confirmed: [],
      files: [],
      problems: [expect.objectContaining({ code: "hint.not-found", hintId: DERIVES })],
    });
  });

  it("[SR-027/AK2] writes nothing when one of the files changed on disk since it was read", async () => {
    const ws = await fixture({
      files: { [B_FILE]: fromFixture(B_FILE).replace(A_VERSION, OLD) },
    });
    await changeTargets(ws);
    const workspace = open(ws.root);
    await workspace.get(elementStoreState);
    const refines = `relation.outdated/${AT_B}/refines/${A}?version=${OLD}`;
    const changed = `${read(ws, B_FILE)}\nEdited elsewhere.\n`;
    const before = read(ws, A_FILE);
    await ws.write(B_FILE, changed);
    await expect(confirm(workspace, [DERIVES, refines])).rejects.toMatchObject({
      code: "file.changed-on-disk",
    });
    expect([read(ws, A_FILE), read(ws, B_FILE)]).toEqual([before, changed]);
  });

  it("[SR-027/AK2] refuses an element whose type the metamodel does not know (SR-016 AK3) and writes nothing", async () => {
    const file = "requirements/X-0b0000000003.md";
    const id = `${P}b0000000003`;
    const text = `---\nid: ${id}\ntype: gadget\nstatus: draft\ntitle: Gadget\nderives-from:\n  - { id: ${N}, version: ${OLD} }\n---\n`;
    const ws = await fixture({ files: { [file]: text } });
    const workspace = open(ws.root);
    const hintId = `relation.outdated/system/${encodeURIComponent(file)}/${id}/derives-from/${N}?version=${OLD}`;
    expect((await outdated(workspace)).map((h) => h.hintId)).toEqual([hintId]);
    await expect(confirm(workspace, [hintId])).rejects.toMatchObject({ code: "element.read-only" });
    expect(read(ws, file)).toBe(text);
  });

  it("[SR-027/AK3] [SR-025/AK3] shows the new version as a normal change in Git, and the check reports the relation no more; .git stays as it was (D-036)", async () => {
    const ws = await fixture({ git: true });
    await changeTargets(ws);
    await ws.commit(undefined, "Change N and V");
    // Every byte of the repository's Git folder, before LogReq reads anything.
    const git = tree(ws.path(".git"));
    const workspace = open(ws.root);
    const before = (await invoke("workspace.check", {}, { workspace })) as CommandOutput<"workspace.check">;
    expect(before.problems.map((p) => p.hintId)).toContain(DERIVES);
    await confirm(workspace, [DERIVES]);
    const after = (await invoke("workspace.check", {}, { workspace })) as CommandOutput<"workspace.check">;
    expect(after.problems.map((p) => p.hintId)).toEqual([VALIDITY, LINK]);
    expect(tree(ws.path(".git"))).toEqual(git);
    // A normal change of the working tree: one line out, one line in, nothing staged.
    expect(await ws.git(["status", "--porcelain"])).toBe(` M ${A_FILE}\n`);
    const diff = await ws.git(["diff", "--unified=0", "--no-color", "--", A_FILE]);
    const changed = diff.split("\n").filter((l) => /^[-+](?![-+]{2} )/.test(l));
    expect(changed).toEqual([
      `-  - { id: ${N}, version: ${N_VERSION}, title: See the wind }`,
      `+  - { id: ${N}, version: ${currentOf(before.problems, DERIVES)}, title: See the wind }`,
    ]);
  });
});

describe("hint.confirm of one element (#310)", () => {
  const confirmBy = async (workspace: Workspace, input: Record<string, unknown>): Promise<Confirmed> =>
    (await invoke("hint.confirm", input, { workspace })) as Confirmed;

  const failure = async (workspace: Workspace, input: Record<string, unknown>): Promise<unknown> =>
    confirmBy(workspace, input).then(
      () => undefined,
      (error: unknown) => error,
    );

  it("[SR-027/AK2] confirms every open hint about ref, as one call with their IDs does", async () => {
    const ws = await fixture();
    await changeTargets(ws);
    const expected = await confirm(open(ws.root), [VALIDITY, DERIVES, LINK]);
    const other = await fixture();
    await changeTargets(other);
    const workspace = open(other.root);
    expect(await confirmBy(workspace, { ref: A })).toEqual(expected);
    expect(expected).toEqual({ confirmed: [VALIDITY, DERIVES, LINK], files: [A_FILE], problems: [] });
    expect(read(other, A_FILE)).toBe(read(ws, A_FILE));
    // A changed, so B's relation to A is open now: a hint of another element, not confirmed.
    expect((await outdated(workspace)).map((h) => h.hintId)).toEqual([expect.stringContaining(AT_B)]);
  });

  it("[SR-027/AK2] confirms every open hint that points at target, and only those of ref when both are given", async () => {
    const ws = await fixture();
    await changeTargets(ws);
    const workspace = open(ws.root);
    // N is the target of A's relation and of its inline reference; the validity names V.
    expect(await confirmBy(workspace, { target: N })).toEqual({
      confirmed: [DERIVES, LINK],
      files: [A_FILE],
      problems: [],
    });
    expect((await outdated(workspace)).map((h) => h.hintId)).toEqual([
      VALIDITY,
      expect.stringContaining(AT_B),
    ]);
    expect(await confirmBy(workspace, { ref: A, target: V })).toMatchObject({ confirmed: [VALIDITY] });
    expect((await outdated(workspace)).map((h) => h.hintId)).toEqual([expect.stringContaining(AT_B)]);
  });

  it("[SR-027/AK2] narrows the selection by kind, and joins it with hintIds, each ID once", async () => {
    const ws = await fixture();
    await changeTargets(ws);
    const workspace = open(ws.root);
    expect(await confirmBy(workspace, { ref: A, kind: ["element.unknown-property"] })).toEqual({
      confirmed: [],
      files: [],
      problems: [
        {
          code: "hint.not-found",
          severity: "warning",
          message: `No open hint about ${A} of kind element.unknown-property can be confirmed, so nothing was written for it (a warning, exit code 0); hint.list gives the open hints`,
        },
      ],
    });
    expect(await confirmBy(workspace, { hintIds: [LINK], target: N, kind: ["relation.outdated"] })).toEqual({
      confirmed: [LINK, DERIVES],
      files: [A_FILE],
      problems: [],
    });
    expect((await outdated(workspace)).map((h) => h.hintId)).toEqual([
      VALIDITY,
      expect.stringContaining(AT_B),
    ]);
  });

  it("[SR-027/AK2] lists a hint once whose relation is written twice, and writes both items", async () => {
    const item = `  - { id: ${N}, version: ${N_VERSION}, title: See the wind }`;
    const ws = await fixture({ files: { [A_FILE]: fromFixture(A_FILE).replace(item, `${item}\n${item}`) } });
    await changeTargets(ws);
    const workspace = open(ws.root);
    expect(await confirmBy(workspace, { target: N })).toEqual({
      confirmed: [DERIVES, LINK],
      files: [A_FILE],
      problems: [],
    });
    expect(read(ws, A_FILE)).not.toContain(N_VERSION);
  });

  it("[SR-027/AK2] lists a selected hint once when a given ID names it in another spelling", async () => {
    const ws = await fixture();
    await changeTargets(ws);
    const workspace = open(ws.root);
    // The slash of the file name percent-encoded in lower case (%2f): the same hint as DERIVES.
    const respelled = DERIVES.replace("%2F", "%2f");
    expect(respelled).not.toBe(DERIVES);
    expect(await confirmBy(workspace, { hintIds: [respelled], target: N })).toEqual({
      confirmed: [respelled, LINK],
      files: [A_FILE],
      problems: [],
    });
  });

  it("[SR-027/AK2] warns when the selection finds no open hint to confirm, and still answers for the given IDs", async () => {
    const workspace = open((await fixture()).root);
    const out = await confirmBy(workspace, { hintIds: [DERIVES], ref: B, target: A });
    expect(out.confirmed).toEqual([]);
    expect((out.problems ?? []).map((p) => [p.code, p.message.split(" can be confirmed")[0]])).toEqual([
      ["hint.not-found", `No open hint about ${B} pointing at ${A}`],
      ["hint.not-found", expect.stringContaining(DERIVES)],
    ]);
    expect((await confirmBy(workspace, { target: N })).problems?.map((p) => p.message)).toEqual([
      `No open hint pointing at ${N} can be confirmed, so nothing was written for it (a warning, exit code 0); hint.list gives the open hints`,
    ]);
  });

  it("refuses an input that selects no hint, and a ref that names no element", async () => {
    const workspace = open((await fixture()).root);
    expect(await failure(workspace, {})).toMatchObject({
      code: "input.invalid",
      details: { fields: ["hintIds", "ref", "target"] },
    });
    expect(await failure(workspace, { hintIds: [], kind: ["relation.outdated"] })).toMatchObject({
      code: "input.invalid",
      details: { fields: ["kind"] },
    });
    expect(await failure(workspace, { target: "SR-ffffff" })).toMatchObject({ code: "ref.unknown" });
    // Empty hintIds alone select nothing, as an empty selection does: a warning, no failure.
    expect(await confirmBy(workspace, { hintIds: [] })).toEqual({
      confirmed: [],
      files: [],
      problems: [
        {
          code: "hint.not-found",
          severity: "warning",
          message:
            "No hint ID is given, so nothing was written (a warning, exit code 0); hint.list gives the open hints",
        },
      ],
    });
  });
});
