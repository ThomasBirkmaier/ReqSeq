import { fileURLToPath } from "node:url";
import { SHORTCUT_TABLES, shortcutReference } from "@reqseq/app";
import { getCommandRuntime } from "@reqseq/core";
import { describe, expect, it } from "vitest";
import { readGuidePages } from "./examples.js";
import type { AccessNames } from "./how-to.js";
import { accessNames, checkHowTos, howToProblems, keyPairs, shortcutProblems } from "./how-to.js";

const names: AccessNames = {
  appEntries: new Set(["Show trace chain"]),
  inputs: new Map([["trace.chain", new Set(["ref", "limit"])]]),
};

const page = (sections: Record<string, string>, path = "how-to/x.md"): { path: string; text: string } => ({
  path,
  text: [
    "---",
    "title: X",
    "---",
    "Intro.",
    ...Object.entries(sections).map(([h, b]) => `## ${h}\n\n${b}\n`),
  ].join("\n"),
});

const complete = {
  App: "Run **Show trace chain**.",
  CLI: "```sh\n## not a heading in a block\n```\nText.",
  API: '```http\nPOST /v1/commands/trace.chain\nAuthorization: Bearer <token>\n\n{ "ref": "N-7fe707" }\n```\n\n```http\nPOST /v1/commands/trace.chain\n```',
  MCP: '```json\n{ "name": "trace_chain", "arguments": { "ref": "N-7fe707", "limit": 5 } }\n```\n\n```json\n{ "command": "reqseq", "args": ["mcp"] }\n```',
};

describe("accessNames", () => {
  it("takes the app entries of all commands (a covering action by its title), the actions of the app, and the inputs of those with an API path and an MCP tool", () => {
    const commands = [
      { name: "trace.chain", title: "Show trace chain" },
      { name: "trace.matrix", title: "Show traceability matrix" },
      { name: "element.get", title: "Show element" },
    ] as unknown as Parameters<typeof accessNames>[0];
    const found = accessNames(commands, {
      openapi: {
        paths: { "/v1/commands/trace.chain": { post: {} }, "/v1/commands/trace.matrix": { post: {} } },
      },
      mcpTools: {
        tools: [
          { name: "trace_chain", inputSchema: { properties: { ref: {} } } },
          { name: "trace_matrix" },
          { name: "element_get", inputSchema: {} },
        ],
      },
    });
    // The entries of the commands, and the actions of the app by their titles, such as "Write skill file".
    expect(found.appEntries).toEqual(
      new Set([
        "Show trace chain",
        "Show traceability matrix",
        "Go to element or buffer",
        ...SHORTCUT_TABLES.actions.map((action) => action.title),
      ]),
    );
    expect(found.appEntries.has("Write skill file")).toBe(true);
    expect(found.inputs).toEqual(
      new Map([
        ["trace.chain", new Set(["ref"])],
        ["trace.matrix", new Set()],
      ]),
    );
  });
});

describe("howToProblems", () => {
  it("accepts a page with every access and names that exist", () => {
    expect(howToProblems(page(complete), names)).toEqual([]);
    expect(
      howToProblems(page({ ...complete, App: "Not possible in the app: no pipeline there." }), names),
    ).toEqual([]);
  });

  it("names a missing or empty section, an unknown app entry, API path, MCP tool and input field", () => {
    const { CLI: _cli, ...withoutCli } = complete;
    expect(
      howToProblems(
        page({
          ...withoutCli,
          App: "Run **Show matrix**.",
          API: "```http\nPOST /v1/commands/trace.matrix\n\n{}\n```\n```http\nGET /v1/commands\n```",
          MCP: '```json\n{ "name": "trace_graph", "arguments": {} }\n```\n```json\n{ "name": "trace_chain", "arguments": { "depth": 1 } }\n```\n```json\n{ "name": "trace_chain" }\n```\n```json\n{ "name": "trace_chain", "arguments": null }\n```',
          Other: "",
        }),
        names,
      ),
    ).toEqual([
      'how-to/x.md: no section "## CLI" with its steps, or why it is not possible there',
      'how-to/x.md: ## App: the command prompt has no entry "Show matrix"',
      "how-to/x.md: ## API: no command trace.matrix in the API and MCP",
      'how-to/x.md: ## API: an http block starts with POST /v1/commands/<command>, not "GET /v1/commands"',
      'how-to/x.md: ## MCP: no MCP tool "trace_graph"',
      "how-to/x.md: ## MCP: trace.chain has no input depth",
    ]);
    expect(howToProblems(page({ ...complete, MCP: "  " }), names)).toEqual([
      'how-to/x.md: no section "## MCP" with its steps, or why it is not possible there',
    ]);
  });
});

describe("howToProblems blocks", () => {
  it("checks API and MCP blocks with a longer or ~ fence and attributes after the language", () => {
    expect(
      howToProblems(
        page({
          ...complete,
          API: '````http title="Request"\nPOST /v1/commands/trace.graph\n````',
          MCP: '~~~json \n{ "name": "trace_chain", "arguments": { "depth": 1 } }\n~~~\n```jsonc\n{ "name": "x" }\n```\n```json\nnull\n```',
        }),
        names,
      ),
    ).toEqual([
      "how-to/x.md: ## API: no command trace.graph in the API and MCP",
      "how-to/x.md: ## MCP: trace.chain has no input depth",
    ]);
  });

  it("reports a block that is no valid JSON", () => {
    const problems = howToProblems(
      page({
        ...complete,
        API: "```http\nPOST /v1/commands/trace.chain\n\n{ ref: 1 }\n```",
        MCP: '```json\n{ "name": "trace_chain", }\n```',
      }),
      names,
    );
    expect(problems).toHaveLength(2);
    expect(problems[0]).toMatch(/^how-to\/x\.md: ## API: no valid JSON: /);
    expect(problems[1]).toMatch(/^how-to\/x\.md: ## MCP: no valid JSON: /);
  });
});

describe("checkHowTos", () => {
  it("checks the pages of the how-to folder only and throws with every problem", () => {
    const other = { path: "start/get-started.md", text: "No sections." };
    expect(checkHowTos([page(complete), other], names)).toBe(1);
    expect(() => checkHowTos([page({ App: "x" }, "how-to/a.md"), other], names)).toThrow(
      'docs: how-to pages\nhow-to/a.md: no section "## CLI" with its steps, or why it is not possible there\n',
    );
  });
});

describe("shortcutProblems", () => {
  const keys = keyPairs([
    {
      title: "T",
      about: "",
      rows: [
        { keys: ["Ctrl+K E"], mac: ["⌘K E"], does: "Create element" },
        { keys: ["Ctrl+P"], mac: ["⌘P"], does: "Go to" },
        { keys: ["Up", "Ctrl+P"], mac: ["Up", "⌃P"], does: "Previous row" },
        { keys: ["Ctrl+Enter"], mac: ["⌘↩"], does: "More" },
        { keys: ["Ctrl+Shift+Z", "Ctrl+Y"], mac: ["⌘⇧Z"], does: "Redo" },
        { keys: [], mac: ["⌘W"], does: "Close the window" },
      ],
    },
  ]);
  const problems = (text: string): string[] => shortcutProblems({ path: "how-to/x.md", text }, keys);

  it("pairs the n-th key of a row on Windows and Linux with its n-th key on macOS", () => {
    expect(keys.pairs.get("Ctrl+P")).toEqual(new Set(["⌘P", "⌃P"]));
    expect(keys.plainOnly).toEqual(new Set(["Ctrl+Y"]));
    expect(keys.macOnly).toEqual(new Set(["⌘W"]));
  });

  it("accepts each key with its macOS key after a comma or in parentheses, and keys of one system alone", () => {
    expect(
      problems(
        "Run it (Ctrl+K E, ⌘K E), then Ctrl+Enter (⌘↩); Ctrl+P (⌃P) or Ctrl+P, ⌘P. Ctrl+Y redoes, ⌘W closes.\n" +
          "Ctrl+P, ⌘P A dialog opens.\n" +
          "```sh\nCtrl+Q\n```\nIn code `Ctrl+X` and plain keys like Enter or Ctrl-C are not checked.",
      ),
    ).toEqual([]);
  });

  it("names a key without its macOS key, with a wrong one, one the app does not have, and a lone macOS key", () => {
    expect(
      problems("Ctrl+K E alone, Ctrl+Enter (⌘Enter), Ctrl+P, ⌘K P, Ctrl+Alt+X, Ctrl+Y (⌘Y), and ⌘↩ alone."),
    ).toEqual([
      'how-to/x.md: "Ctrl+K E" without its macOS key "⌘K E"',
      'how-to/x.md: "Ctrl+Enter" is "⌘↩" on macOS, not "⌘Enter"',
      'how-to/x.md: "Ctrl+P" is "⌘P" or "⌃P" on macOS, not "⌘K P"',
      'how-to/x.md: "Ctrl+Alt+X" is no key of the app',
      'how-to/x.md: "Ctrl+Y" has no macOS key, not "⌘Y"',
      'how-to/x.md: "⌘↩" without its key on Windows and Linux before it',
    ]);
  });

  it("gives every key of the guide's pages with its macOS key as the app shows it", async () => {
    const pages = await readGuidePages(fileURLToPath(new URL("../../../docs/guide/", import.meta.url)));
    const keysOfApp = keyPairs(shortcutReference(getCommandRuntime().contracts.commands));
    expect(pages.length).toBeGreaterThan(20);
    expect(pages.flatMap((page) => shortcutProblems(page, keysOfApp))).toEqual([]);
  });
});
