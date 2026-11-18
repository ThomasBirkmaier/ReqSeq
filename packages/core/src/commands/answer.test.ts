// The answer sentence of every command (SR-224 AK1): `invoke` puts the sentence of the command first in
// its output, for every implemented command with the calls of scenarios.test-helper.ts; the words the
// sentences share (answer.ts) and the cases of single sentences that those calls do not reach. That the
// sentence is the same through the command line, the API and the MCP server is shown by the cross-access
// test of packages/cli (`[SR-224/AK-cw40]`), which compares whole outputs.
import { createFixtureWorkspace } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import type { AnyCommand } from "../catalog.js";
import { loadContracts } from "../runtime/contracts.js";
import { createCommandRuntime } from "../runtime/invoke.js";
import { Workspace } from "../runtime/workspace.js";
import {
  counted,
  filesNote,
  incompleteNote,
  listed,
  named,
  paged,
  problemsNote,
  sentence,
} from "./answer.js";
import elementList from "./element/list.js";
import { commands } from "./index.js";
import { FILES, GUSTS, SCENARIOS, WIND } from "./scenarios.test-helper.js";
import workspaceActivity from "./workspace/activity.js";
import workspaceCheck from "./workspace/check.js";
import workspaceInit from "./workspace/init.js";
import workspaceListFolder from "./workspace/listFolder.js";

const contracts = loadContracts();
const runtime = createCommandRuntime({ commands, validateOutput: true });

/** Every implemented command with its calls: those of the helper and the two status commands. */
const CALLS: Readonly<Record<string, readonly Readonly<Record<string, unknown>>[]>> = {
  ...SCENARIOS,
  "element.setStatus": [{ refs: [WIND], status: "approved" }],
  "element.supersede": [{ ref: GUSTS, status: "obsolete", successor: WIND, relation: "supersedes" }],
};

/** Words that name a time relative to reading the sentence, which an answer never has (SR-224 AK1). */
const RELATIVE_TIME =
  /\b(now|today|yesterday|tomorrow|ago|recently|currently|just|soon|still|yet|anymore|meanwhile)\b/i;

/** The answer of `command` for `output` and `input`, as `invoke` builds it. */
const answerOf = (command: AnyCommand, output: unknown, input: unknown = {}): string =>
  command.answer?.(output, input as never) ?? "";

describe("the answer sentence of every command (SR-224 AK1)", () => {
  for (const [name, calls] of Object.entries(CALLS)) {
    it(`[SR-224/AK-cw40] ${name} starts its output with one English sentence that names no time relative to reading it`, async () => {
      const repository = await createFixtureWorkspace({
        fixture: "SR-001/two-elements",
        files: FILES,
        git: true,
      });
      const workspace = new Workspace(repository.root);
      onTestFinished(async () => {
        await workspace.close();
        await repository.cleanup();
      });
      if (name === "baseline.compare" || name === "baseline.get") {
        await runtime.invoke("baseline.create", { name: "Base", selection: { ids: [WIND] } }, { workspace });
      }
      let answered = 0;
      for (const input of calls) {
        const output = await runtime.invoke(name, input, { workspace }).catch(() => undefined);
        if (output === undefined) {
          continue;
        }
        const [first, answer] = Object.entries(output as Record<string, unknown>)[0] ?? [];
        expect(first).toBe("answer");
        expect(typeof answer).toBe("string");
        const text = String(answer);
        // One sentence: not empty, one line, a period at its end, no time relative to reading it.
        expect([text, /^\S.*\.$/.test(text)]).toEqual([text, true]);
        expect(text).not.toMatch(/[\n\r]/);
        expect(text).not.toMatch(RELATIVE_TIME);
        answered++;
      }
      expect(answered).toBeGreaterThan(0);
    });
  }

  it("[SR-224/AK-cw40] covers every implemented command", () => {
    const implemented = contracts.commands.map((c) => c.name).filter((n) => runtime.commands.has(n));
    expect(Object.keys(CALLS).sort()).toEqual(implemented.sort());
    expect([...runtime.commands.values()].filter((c) => c.answer === undefined)).toEqual([]);
  });
});

describe("the words of the answer sentences", () => {
  it("counts, pages, names and lists", () => {
    expect([counted(1, "entry", "entries"), counted(0, "file"), counted(2, "file")]).toEqual([
      "1 entry",
      "0 files",
      "2 files",
    ]);
    expect([paged(2, 5, "hit"), paged(5, 5, "hit")]).toEqual(["2 of 5 hits", "5 hits"]);
    expect([named({ shortId: "SR-0000b1" }), named({ shortId: "SR-0000b1", identifier: "SR-1" })]).toEqual([
      "SR-0000b1",
      "SR-1",
    ]);
    expect([listed([]), listed(["a"]), listed(["a", "b"]), listed(["a", "b", "c"])]).toEqual([
      "",
      "a",
      "a and b",
      "a, b and c",
    ]);
  });

  it("joins what a command did with the notes that are not empty", () => {
    expect(sentence("Done", filesNote([]), problemsNote(undefined), incompleteNote(false))).toBe(
      "Done; no file written.",
    );
    expect(sentence("Done", filesNote(["a", "b"]), problemsNote([{}]), incompleteNote(true))).toBe(
      "Done; 2 files written; 1 problem; incomplete, as a repository is not available.",
    );
    expect(sentence("Done", problemsNote([]))).toBe("Done.");
  });
});

describe("answer sentences of single commands", () => {
  it("element.list counts the rows of `partial` as of `elements`", () => {
    expect(answerOf(elementList, { partial: [{}, {}], total: 3 })).toBe("Listed 2 of 3 elements.");
    expect(answerOf(elementList, { total: 0 })).toBe("Listed 0 elements.");
  });

  it("workspace.activity names the access of the last call", () => {
    const activity = { command: "element.get", at: "2026-11-18T10:00:00Z" };
    expect(
      ["api", "mcp", "cli"].map((access) =>
        answerOf(workspaceActivity, { activity: { ...activity, access } }),
      ),
    ).toEqual([
      "The last call through the API that named an element was element.get, at 2026-11-18T10:00:00Z.",
      "The last call through the MCP server that named an element was element.get, at 2026-11-18T10:00:00Z.",
      "The last call through cli that named an element was element.get, at 2026-11-18T10:00:00Z.",
    ]);
  });

  it("workspace.check counts the problems shown and those severity leaves out, by severity", () => {
    const problems = [
      { severity: "error" },
      { severity: "error" },
      { severity: "warning" },
      { severity: "info" },
    ];
    expect(answerOf(workspaceCheck, { problems, checkedElements: 1 })).toBe(
      "Checked 1 element and found 2 errors, 1 warning and 1 info.",
    );
    expect(answerOf(workspaceCheck, { problems: [], hidden: { below: "error", warning: 2, info: 3 } })).toBe(
      "The workspace check found 2 warnings and 3 info.",
    );
  });

  it("workspace.init says when it created no workspace", () => {
    expect(answerOf(workspaceInit, { files: [], problems: [{}] }, { name: "W" })).toBe(
      "Created no workspace W; no file written; 1 problem.",
    );
  });

  it("workspace.listFolder names why there are no entries, and a list cut short", () => {
    expect(
      (["missing", "unreadable", "invalid"] as const).map((problem) =>
        answerOf(workspaceListFolder, { name: "", entries: [], problem }),
      ),
    ).toEqual([
      "Found no entries: the folder does not exist.",
      "Found no entries: the folder cannot be read.",
      "Found no entries: the path is refused.",
    ]);
    expect(answerOf(workspaceListFolder, { name: "", entries: [{}], truncated: true })).toBe(
      "Found 1 entry, more not listed.",
    );
  });
});
