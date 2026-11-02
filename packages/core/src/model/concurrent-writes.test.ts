// Write calls that run at the same time in one process (SR-166), as the API and the MCP server run
// them (#686): every call that reports success is in the file of the element, and a call whose
// change cannot be written reports an error. On fixtures/SR-004/one-repository, one system
// requirement S.
import fs from "node:fs/promises";
import { createFixtureWorkspace } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import type { CommandOutput } from "../catalog.js";
import { invoke } from "../runtime/invoke.js";
import { Workspace } from "../runtime/workspace.js";

const S = "e8df96ea-a168-4d90-8d65-6328cee88fb3";
const S_FILE = "requirements/SR-6328cee88fb3.md";

/** Calls at the same time, as many as an MCP client sends in one turn. */
const CALLS = 8;

const open = async (): Promise<{ readonly workspace: Workspace; readonly read: () => Promise<string> }> => {
  const ws = await createFixtureWorkspace({ fixture: "SR-004/one-repository" });
  onTestFinished(() => ws.cleanup());
  const workspace = new Workspace(ws.root);
  onTestFinished(() => workspace.close());
  return { workspace, read: () => fs.readFile(ws.path(S_FILE), "utf8") };
};

/** `count` needs, created one after the other; their IDs. */
const needs = async (workspace: Workspace, count: number): Promise<string[]> => {
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const created = (await invoke(
      "element.create",
      { type: "need", title: `Need ${String(i)}` },
      { workspace, access: "mcp" },
    )) as CommandOutput<"element.create">;
    ids.push(created.element.id);
  }
  return ids;
};

describe("write calls at the same time in one process (SR-166)", () => {
  it("[SR-166/AK1] keeps the change of every call that reports success in the file", async () => {
    const { workspace, read } = await open();
    const ctx = { workspace, access: "mcp" as const };
    const targets = await needs(workspace, CALLS);
    // A change of title or text carries the bytes it was made on (#269), so one call writes both.
    const { fileSha256 } = (await invoke("element.get", { ref: S }, ctx)) as CommandOutput<"element.get">;
    const results = await Promise.allSettled([
      invoke(
        "element.update",
        { ref: S, title: "New title", text: "New text", expectedFileSha256: fileSha256 },
        ctx,
      ),
      invoke("element.update", { ref: S, set: { rationale: "New rationale" } }, ctx),
      ...targets.map((target) => invoke("relation.add", { source: S, kind: "derives-from", target }, ctx)),
    ]);
    expect(results.map((result) => result.status)).toEqual(results.map(() => "fulfilled"));
    const file = await read();
    expect(file).toContain("title: New title");
    expect(file).toContain("New text");
    expect(file).toContain("rationale: New rationale");
    for (const target of targets) {
      expect(file).toContain(target);
    }
  });

  it("[SR-166/AK2] reports an error for the call whose change cannot be written", async () => {
    const { workspace, read } = await open();
    const ctx = { workspace, access: "mcp" as const };
    // Both calls expect the file as it is now; the one that runs second finds the first one's change.
    const got = (await invoke("element.get", { ref: S }, ctx)) as CommandOutput<"element.get">;
    const expectedFileSha256 = got.fileSha256;
    const results = await Promise.allSettled([
      invoke("element.update", { ref: S, title: "First title", expectedFileSha256 }, ctx),
      invoke("element.update", { ref: S, title: "Second title", expectedFileSha256 }, ctx),
    ]);
    expect(results.map((result) => result.status)).toEqual(["fulfilled", "rejected"]);
    const file = await read();
    expect(file).toContain("title: First title");
    expect(file).not.toContain("Second title");
  });
});
