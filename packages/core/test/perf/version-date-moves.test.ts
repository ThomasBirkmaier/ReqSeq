// The version date (ADR-0005 "Moves", #460) after a commit that moved every element file to another
// folder, as a reorganisation does: 20,000 element files, then one commit that moves them all
// unchanged. The first walk of 2,000 of them in one call is recorded; the walks follow the old
// paths, and each one finds its move by its path among the 20,000 moves of that commit, so the
// time grows with the files dated, not with their product with the files moved. No SR sets a limit
// for the date, so the time is recorded only (ADR-0011).
import type { FixtureWorkspace } from "@reqseq/testkit";
import { createFixtureWorkspace, measure } from "@reqseq/testkit";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseFileBytes } from "../../src/files/index.js";
import type { Metamodel } from "../../src/metamodel/index.js";
import { metamodelState } from "../../src/metamodel/index.js";
import { versionDates } from "../../src/model/version-date.js";
import type { VersionDateRequest } from "../../src/model/version-date.js";
import { elementVersion } from "../../src/model/view.js";
import { Workspace } from "../../src/runtime/workspace.js";
import { workspaceLayoutState } from "../../src/workspace/index.js";

/** Element files, first in `old/`, then all moved to `requirements/`. */
const FILES = 20_000;
/** Files dated in one call. */
const DATED = 2_000;

const hex = (n: number, width: number): string => n.toString(16).padStart(width, "0");
const idOf = (i: number): string => `${hex(i, 8)}-0000-4000-8000-${hex(i, 12)}`;
const nameOf = (i: number): string => `SR-${hex(i, 12)}.md`;
const textOf = (i: number): string =>
  `---\nid: ${idOf(i)}\ntype: system-requirement\nstatus: draft\ntitle: Requirement ${String(i)}\n---\n\nText of ${String(i)}.\n`;

/** The version of an element file without images (ADR-0005). */
const versionOf = (metamodel: Metamodel, text: string): string => {
  const parsed = parseFileBytes("x.md", Buffer.from(text));
  if (parsed.kind !== "parsed") {
    throw new Error("generated file did not parse");
  }
  const data = parsed.content.data as Readonly<Record<string, unknown>>;
  return elementVersion({ type: String(data["type"]), data }, parsed.content.body, metamodel, []);
};

describe("version date after a commit that moved every element file (#460)", () => {
  let fixture: FixtureWorkspace | undefined;
  let workspace: Workspace | undefined;
  let created = "";

  beforeAll(async () => {
    fixture = await createFixtureWorkspace({ fixture: "SR-001/two-elements" });
    await fixture.git(["init", "--quiet", "--initial-branch=main"]);
    const all = Array.from({ length: FILES }, (_, i) => i);
    const made = await fixture.commitHistory(
      [
        { name: "created", files: Object.fromEntries(all.map((i) => [`old/${nameOf(i)}`, textOf(i)])) },
        {
          name: "moved",
          deleted: all.map((i) => `old/${nameOf(i)}`),
          files: Object.fromEntries(all.map((i) => [`requirements/${nameOf(i)}`, textOf(i)])),
        },
      ],
      { branch: "main" },
    );
    await fixture.git(["reset", "--hard", "--quiet"]);
    created = String(made["created"]?.date.toISOString().replace(".000Z", "Z"));
    workspace = new Workspace(fixture.root);
  }, 600_000);

  afterAll(async () => {
    await workspace?.close();
    await fixture?.cleanup();
  });

  it(`records the first walk of ${String(DATED)} files over a move of ${String(FILES)}`, async () => {
    const opened = workspace;
    if (opened === undefined) {
      throw new Error("the workspace was not opened");
    }
    const metamodel = await opened.get(metamodelState);
    const context = { workspace: opened, layout: await opened.get(workspaceLayoutState), metamodel };
    const dated = Array.from({ length: DATED }, (_, k) => (k * 7) % FILES);
    const requests = dated.map((i): VersionDateRequest => ({
      repository: "system",
      file: `requirements/${nameOf(i)}`,
      id: idOf(i),
      version: versionOf(metamodel, textOf(i)),
    }));
    const cold = await measure(
      `version dates of ${String(DATED)} files moved with ${String(FILES - DATED)} others (first walk)`,
      () => versionDates(context, requests),
      { basis: "ADR-0005 version date (Moves, #460) for SR-025 after a reorganisation (no threshold)" },
    );
    expect(cold.result).toEqual(dated.map(() => created));
  });
});
