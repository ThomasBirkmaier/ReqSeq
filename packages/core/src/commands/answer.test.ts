// The answer of every command (SR-224 AK1): `invoke` puts the sentence of the command first in
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
  rootNamed,
  paged,
  problemsNote,
  sentence,
  viewNamed,
} from "./answer.js";
import elementList from "./element/list.js";
import { commands } from "./index.js";
import traceChain from "./trace/chain.js";
import traceGraph from "./trace/graph.js";
import traceNeighbourhood from "./trace/neighbourhood.js";
import { APPROVED, FILES, GUSTS, OBSOLETE, SCENARIOS, VARIANT, WIND } from "./scenarios.test-helper.js";
import workspaceActivity from "./workspace/activity.js";
import workspaceAgents from "./workspace/agents.js";
import workspaceConnectAgent from "./workspace/connectAgent.js";
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

/** The answer of `command` for `output` and `input`, as `invoke` builds it; types are named by their key. */
const answerOf = (command: AnyCommand, output: unknown, input: unknown = {}): string =>
  command.answer?.(output, input as never, { type: (key) => key, element: (ref) => ref }) ?? "";

describe("the answer of every command (SR-224 AK1)", () => {
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

describe("the words of the answers", () => {
  it("names a view as core, else its variant by identifier or short ID, else by UUID", () => {
    const id = "37373737-3737-4737-8737-00000000c001";
    expect([
      viewNamed("core", undefined),
      viewNamed(id, [{ id, shortId: "VAR-00c001", identifier: "VAR-001" }]),
      viewNamed(id, [{ id, shortId: "VAR-00c001" }]),
      viewNamed(id, []),
    ]).toEqual(["core", "VAR-001", "VAR-00c001", id]);
  });

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
    // The root by its node, whatever ref named it; the ref as given when the page does not hold the root.
    const nodes = [{ id: "uuid-1", shortId: "SR-0000b1", identifier: "SR-1" }];
    expect([rootNamed("uuid-1", nodes, "uuid-1"), rootNamed("uuid-2", nodes, "uuid-2")]).toEqual([
      "SR-1",
      "uuid-2",
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
    // A line break of an input text (a query, a name) keeps the sentence on one line.
    expect(sentence("Found 0 hits for the query wind\r\n  speed")).toBe(
      "Found 0 hits for the query wind speed.",
    );
  });
});

describe("answers of single commands", () => {
  it("trace.chain, trace.graph and trace.neighbourhood name the root by its node, also for a UUID as ref (#1874)", () => {
    const root = { id: "uuid-1", shortId: "SR-0000b1", identifier: "SR-073" };
    const chain = { root: "uuid-1", nodes: [root], total: 5, gaps: [], unresolved: [] };
    expect(answerOf(traceChain, chain, { ref: "uuid-1" })).toBe("The chain of SR-073 has 5 elements.");
    expect(answerOf(traceGraph, { root: "uuid-1", nodes: [root], edges: [] }, { ref: "uuid-1" })).toBe(
      "The graph of SR-073 has 1 element and 0 relations.",
    );
    expect(answerOf(traceNeighbourhood, { root: "uuid-1", nodes: [root], total: 1 }, { ref: "uuid-1" })).toBe(
      "The neighbourhood of SR-073 has 1 element.",
    );
    // A later page names the root by `names`, as the first page does.
    const later = { root: "uuid-1", nodes: [], names: [root] };
    expect(answerOf(traceChain, { ...later, total: 5, gaps: [], unresolved: [] }, { ref: "uuid-1" })).toBe(
      "The chain of SR-073 has 5 elements.",
    );
    expect(answerOf(traceNeighbourhood, { ...later, total: 3 }, { ref: "uuid-1" })).toBe(
      "The neighbourhood of SR-073 has 3 elements.",
    );
  });

  it("[SR-224/AK-cw40] the commands whose answer names elements of the input name them by short ID or identifier, also for a UUID as ref (#1998)", async () => {
    const calls: readonly (readonly [string, Readonly<Record<string, unknown>>])[] = [
      ["trace.affected", { ref: WIND }],
      ["trace.mermaid", { ref: WIND }],
      ["trace.related", { refs: [WIND, APPROVED], direction: "children" }],
      ["relation.options", { ref: WIND }],
      ["element.supersede", { ref: GUSTS, status: "obsolete", successor: WIND, relation: "supersedes" }],
      ["variant.exclude", { variant: VARIANT, refs: [WIND] }],
      ["evidence.record", { ...SCENARIOS["evidence.record"]?.[0], ref: WIND }],
      ["evidence.list", { ref: WIND }],
      ["relation.add", { source: GUSTS, kind: "replaces", target: OBSOLETE }],
      ["relation.remove", { source: GUSTS, kind: "derives-from", target: WIND }],
      ["variant.diff", { variant: VARIANT }],
    ];
    const answers: Record<string, string> = {};
    for (const [name, input] of calls) {
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
      const output = (await runtime.invoke(name, input, { workspace })) as { readonly answer: string };
      answers[name] = output.answer;
    }
    expect(answers).toEqual({
      "trace.affected": "4 elements are affected by a change of SR-e88fb3.",
      "trace.mermaid": "Drew the graph of SR-e88fb3 as a Mermaid flowchart.",
      "trace.related": "Found 4 children of SR-e88fb3 and N-aaaaaa.",
      "relation.options": "SR-e88fb3 can get 6 relation kinds.",
      "element.supersede":
        "Superseded SR-4a5b6c with status obsolete, succeeded by SR-e88fb3; 2 files written.",
      "variant.exclude": "Variant VAR-cccccc excludes SR-e88fb3; 1 file written.",
      "evidence.record": "Recorded a verification with result passed for SR-e88fb3; 1 file written.",
      "evidence.list": "Found 2 evidence records and 2 test cases of SR-e88fb3.",
      "relation.add": "Added a replaces relation from SR-4a5b6c to SR-556666; 1 file written.",
      "relation.remove": "Removed the derives-from relation from SR-4a5b6c to SR-e88fb3; 1 file written.",
      "variant.diff": "Variant VAR-cccccc adds 0 requirements, replaces 0 and excludes 0.",
    });
  });

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
      "The last call through the command line that named an element was element.get, at 2026-11-18T10:00:00Z.",
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

  it("workspace.agents names the client whose connection ended last, also one without a name", () => {
    const at = "2026-11-18T09:00:00.000Z";
    expect(
      [
        { client: "agent", at },
        { client: null, at },
      ].map((last) => answerOf(workspaceAgents, { recorded: true, connected: [{}], last })),
    ).toEqual([
      "1 agent connected to this copy; the connection that ended last was agent.",
      "1 agent connected to this copy; the connection that ended last was a client without a name.",
    ]);
  });

  it("workspace.connectAgent keeps the sentence its run built, and names the clients without one", () => {
    expect(answerOf(workspaceConnectAgent, { answer: "Run this command in a terminal." })).toBe(
      "Run this command in a terminal.",
    );
    expect(answerOf(workspaceConnectAgent, { clients: [] })).toMatch(/^Choose the client to connect: /);
  });
});
