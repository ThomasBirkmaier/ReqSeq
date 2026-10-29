// The cost of confirming many hints in one call (SR-027 AK2, N-036): a ring of inline references
// (spec question #281) is planned again round after round, and only its own files are; the other
// files of the call are planned once. Counted as calls of the file writer (`editElementFile`), so
// the check does not depend on the load of the machine.
import { createFixtureWorkspace } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import type { CommandOutput } from "../catalog.js";
import * as files from "../files/index.js";
import { invoke } from "../runtime/invoke.js";
import { Workspace } from "../runtime/workspace.js";

vi.mock("../files/index.js", async (original) => {
  const actual = await original<typeof files>();
  return { ...actual, editElementFile: vi.fn(actual.editElementFile) };
});

const P = "5e025a7d-2b4f-4c61-9d08-0";
const N = `${P}a0000000001`;
const A = `${P}b0000000001`;
const B = `${P}b0000000002`;
const OLD = "n1:0000000000000000";
/** Other sources in the call, each with one outdated derivation of N. */
const OTHERS = 60;

const requirement = (id: string, extra: string, text = ""): string =>
  `---\nid: ${id}\ntype: system-requirement\nstatus: draft\ntitle: R\nrequirement-type: functional\nacceptance-criteria: [R]\n${extra}---\n\n${text}\n`;

describe("hint.confirm cost (SR-027 AK2, N-036)", () => {
  it("[SR-027/AK2] plans the other files of a call once when a ring of references is planned again", async () => {
    const others = Object.fromEntries(
      Array.from({ length: OTHERS }, (_, i) => {
        const tail = `d${String(i).padStart(10, "0")}`;
        return [
          `requirements/SR-0${tail}.md`,
          requirement(`${P}${tail}`, `derives-from:\n  - { id: ${N}, version: ${OLD} }\n`),
        ];
      }),
    );
    const ws = await createFixtureWorkspace({
      fixture: "SR-025/outdated",
      files: {
        ...others,
        "requirements/SR-0b0000000001.md": requirement(A, "", `[B](logreq:${B}?version=${OLD})`),
        "requirements/SR-0b0000000002.md": requirement(B, "", `[A](logreq:${A}?version=${OLD})`),
      },
    });
    onTestFinished(() => ws.cleanup());
    const workspace = new Workspace(ws.root);
    onTestFinished(() => workspace.close());
    const { hints } = (await invoke(
      "hint.list",
      { kind: ["relation.outdated"] },
      { workspace },
    )) as CommandOutput<"hint.list">;
    const ids = hints.map((h) => h.hintId ?? "");
    expect(ids).toHaveLength(OTHERS + 2);
    const writer = vi.mocked(files.editElementFile);
    writer.mockClear();
    const out = (await invoke(
      "hint.confirm",
      { hintIds: ids },
      { workspace },
    )) as CommandOutput<"hint.confirm">;
    expect(out.files).toHaveLength(OTHERS + 2);
    // Once per file, then the two files of the ring once per round: at most one round per planned
    // target (A and B) and one more.
    expect(writer.mock.calls.length).toBeGreaterThanOrEqual(OTHERS + 2);
    expect(writer.mock.calls.length).toBeLessThanOrEqual(OTHERS + 2 + 2 * 3);
  });
});
