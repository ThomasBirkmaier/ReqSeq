// A changed core requirement at its replacement (SR-045), on fixtures/SR-045/core-changed: SR-K
// (K) is a core requirement; SR-A (A1, validity [Coast]) replaces it, as does B2 without validity
// (SR-041 AK6). Both store K's current version, so the fixture has no hint until a test changes K.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createFixtureWorkspace } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import type { CommandOutput, Problem } from "../catalog.js";
import { invoke } from "../runtime/invoke.js";
import { Workspace } from "../runtime/workspace.js";

const P = "45045045-0000-4000-8000-0000000000";
const K = `${P}a1`;
const A1 = `${P}b1`;
const B2 = `${P}b2`;
const K_FILE = "requirements/SR-0000000000a1.md";
const A1_FILE = "requirements/SR-0000000000b1.md";
const K_VERSION = "n1:0b18d8dadbb9f1a5";
const FIXTURE = path.resolve(import.meta.dirname, "../../../../fixtures/SR-045/core-changed");

/** The fixture's file of K with `from` replaced by `to`. */
const changedK = async (from: string, to: string): Promise<string> =>
  (await readFile(path.join(FIXTURE, K_FILE), "utf8")).replace(from, to);

const open = async (
  files: Readonly<Record<string, string>> = {},
): Promise<{ readonly workspace: Workspace; readonly root: string }> => {
  const fixture = await createFixtureWorkspace({ fixture: "SR-045/core-changed", files });
  onTestFinished(() => fixture.cleanup());
  const workspace = new Workspace(fixture.root);
  onTestFinished(() => workspace.close());
  return { workspace, root: fixture.root };
};

/** The findings of workspace.check but the fixture's requirements without a parent (SR-022 AK6), which this file does not test. */
const check = async (workspace: Workspace): Promise<readonly Problem[]> =>
  ((await invoke("workspace.check", {}, { workspace })) as CommandOutput<"workspace.check">).problems.filter(
    (p) => p.code !== "trace.no-parent",
  );

const listed = async (workspace: Workspace, input: Record<string, unknown>): Promise<readonly Problem[]> =>
  ((await invoke("hint.list", input, { workspace })) as CommandOutput<"hint.list">).hints;

/** Code, element and target of each problem. */
const rows = (problems: readonly Problem[]): unknown[] =>
  problems.map((p) => [p.code, p.elementId, p.targetId]);

describe("a changed core requirement at its replacement (SR-045)", () => {
  it("[SR-045/AK1] a content change of SR-K gives one hint at SR-A with stored and current version, listed by hint.list for A", async () => {
    const { workspace } = await open({ [K_FILE]: await changedK("within 10 ms.\n", "within 12 ms.\n") });
    const problems = await check(workspace);
    // One hint at A1, none `relation.outdated` beside it; B2 without validity replaces in no view (SR-041 AK6).
    expect(rows(problems)).toEqual([
      ["variant.core-changed", A1, K],
      ["relation.outdated", B2, K],
    ]);
    const [hint] = problems;
    expect(hint).toMatchObject({
      severity: "warning",
      file: A1_FILE,
      line: 12,
      storedVersion: K_VERSION,
      hintId: `variant.core-changed/system/${encodeURIComponent(A1_FILE)}/${A1}/replaces/${K}?version=${K_VERSION}`,
    });
    expect(hint?.currentVersion).not.toBe(K_VERSION);
    expect(hint?.message).toMatch(
      /^Core requirement System Requirement SR-0000a1, which System Requirement SR-0000b1 replaces, has changed since the replacement stored its version: stored version from no date/,
    );
    const coast = await listed(workspace, { variant: "VAR-0000c1", kind: ["variant.core-changed"] });
    expect(coast.map((h) => h.hintId)).toEqual([hint?.hintId]);
    // Mountain does not hold A1, so its list does not name the hint.
    expect(await listed(workspace, { variant: "VAR-0000c2", kind: ["variant.core-changed"] })).toEqual([]);
    // At the element too (SR-026 AK3).
    const shown = (await invoke("element.get", { ref: A1 }, { workspace })) as CommandOutput<"element.get">;
    // Besides the missing parent of the fixture's requirement (SR-022 AK6), which cannot be confirmed.
    expect(shown.element.problems?.map((p) => p.hintId ?? p.code)).toEqual(["trace.no-parent", hint?.hintId]);
  });

  it("[SR-045/AK2] hint.confirm writes the current version and title of SR-K into replaces and the hint is gone", async () => {
    const changed = (await changedK("within 10 ms.\n", "within 12 ms.\n")).replace(
      "title: Response time at most 10 ms",
      "title: Response time at most 12 ms",
    );
    const { workspace, root } = await open({ [K_FILE]: changed });
    const [hint] = await check(workspace);
    const confirmed = (await invoke(
      "hint.confirm",
      { hintIds: [hint?.hintId] },
      { workspace },
    )) as CommandOutput<"hint.confirm">;
    expect([confirmed.confirmed, confirmed.problems]).toEqual([[hint?.hintId], []]);
    expect(rows(await check(workspace))).toEqual([["relation.outdated", B2, K]]);
    const text = await readFile(path.join(root, A1_FILE), "utf8");
    expect(text).toContain(
      `{ id: ${K}, version: ${String(hint?.currentVersion)}, title: Response time at most 12 ms }`,
    );
  });

  it("[SR-045/AK3] a title-only change of SR-K gives no hint, and the next write of SR-A's file stores the new title", async () => {
    const { workspace, root } = await open({
      [K_FILE]: await changedK("title: Response time at most 10 ms", "title: Answer within 10 ms"),
    });
    expect(await check(workspace)).toEqual([]);
    await invoke(
      "element.update",
      { ref: A1, text: "At the coast the station answers in 20 ms.\n" },
      { workspace },
    );
    const text = await readFile(path.join(root, A1_FILE), "utf8");
    expect(text).toContain(`{ id: ${K}, version: ${K_VERSION}, title: Answer within 10 ms }`);
  });

  it("[SR-045/AK4] a superseded SR-K gives the superseded-target hint with its successor and no core-change hint", async () => {
    const successor = (await changedK("10 ms", "5 ms"))
      .replace(`id: ${K}`, `id: ${P}a2`)
      .replaceAll("10 ms", "5 ms");
    const { workspace } = await open({ "requirements/SR-0000000000a2.md": successor });
    await invoke("element.supersede", { ref: K, status: "obsolete", successor: `${P}a2` }, { workspace });
    const atA1 = async (): Promise<readonly Problem[]> =>
      (await check(workspace)).filter((p) => p.elementId === A1);
    // The status is no part of the version (ADR-0005): superseding alone leaves the replacement current.
    const superseded = await atA1();
    expect(rows(superseded)).toEqual([["relation.target-superseded", A1, K]]);
    expect(superseded[0]?.message).toContain("SR-0000a2");
    // Its content changed too: the usual hints of a relation to it (assumption, see core-changed.ts).
    await invoke("element.update", { ref: K, text: "Superseded by SR-0000a2.\n" }, { workspace });
    expect(rows(await atA1())).toEqual([
      ["relation.target-superseded", A1, K],
      ["relation.outdated", A1, K],
    ]);
  });

  it("a replacement onto a changed element that is no core requirement stays relation.outdated (SR-041 AK8)", async () => {
    const valid = await changedK(
      "acceptance-criteria:",
      `validity:\n  - { id: ${P}c2, version: n1:0000000000000000, title: Mountain }\nacceptance-criteria:`,
    );
    const { workspace } = await open({ [K_FILE]: valid });
    const atA1 = (await check(workspace)).filter((p) => p.elementId === A1 && p.targetId === K);
    expect(atA1.map((p) => p.code)).toEqual(["variant.target-not-core", "relation.outdated"]);
  });
});
