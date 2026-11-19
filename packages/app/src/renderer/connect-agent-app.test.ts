// @vitest-environment happy-dom
// "Connect AI agent" in the window (SR-227 AK1, AK7, SR-225 AK7): the command prompt asks the client among its
// fixed values, the output is a buffer with the answer, the block "Copy field" copies and the next step, and
// without a workspace the workspace is asked first, as "Open workspace" asks it, and then the client.
import { act, createElement } from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { CommandListing, InvokeResult, ReqSeqBridge, WorkspaceChange } from "../shared/protocol.js";
import { App } from "./App.js";
import {
  flush,
  press,
  query,
  queryInput,
  render as renderNode,
  texts,
  type,
} from "./components.test-helper.js";
import { AGENTS_POLL_MS } from "./agent-status.js";
import { NONE_OPENED } from "./connect-agent.js";
import { NO_SUMMARY } from "./package-summary-test-data.js";

/**
 * The catalog entry of the command as the bridge lists it, from its schema file: its enum is inline already, so
 * the listing is the file (the core runtime does not load under happy-dom).
 */
const CATALOG: readonly CommandListing[] = [
  {
    ...(JSON.parse(
      readFileSync(join(__dirname, "../../../../schemas/commands/workspace.connectAgent.json"), "utf8"),
    ) as CommandListing),
    implemented: true,
    cliUsage: "reqseq workspace connect-agent [options]",
  },
];

/** The label of the step that asks the client. */
const CLIENT_LABEL = "Connect AI agent · client:";

const CLIENTS = ["claude-code", "claude-desktop", "cursor", "vscode", "codex-cli", "other"];

/** What core gives for Claude Code, as `workspace.connectAgent` does. */
const CLAUDE_CODE = {
  answer: 'Run this command in a terminal to connect Claude Code to the workspace "Weather station".',
  client: "claude-code",
  server: { command: "/opt/reqseq/bin/reqseq", args: ["mcp", "--workspace", "/req/station"], env: {} },
  setup: {
    form: "command",
    shell: "sh",
    text: "claude mcp add --transport stdio reqseq -- /opt/reqseq/bin/reqseq mcp --workspace /req/station",
  },
  valid: "The setup holds as long as ReqSeq stays in /opt/reqseq.",
  next: "Run it in the folder where you start Claude Code; `/mcp` there lists reqseq.",
};

const NO_WORKSPACE = new Error("No workspace is open.");

/** Waits for the answers and the renders they start. */
const settle = async (): Promise<void> => {
  for (let round = 0; round < 3; round += 1) {
    await flush();
  }
};

const keyDown = async (
  target: Element | Window,
  key: string,
  init: KeyboardEventInit = {},
): Promise<void> => {
  await press(target as Element, key, init);
  await settle();
};

const typed = async (value: string): Promise<void> => {
  await type(queryInput(), value);
  await settle();
};

/** Opens the command prompt, types `name` and runs the first candidate. */
const runCommand = async (name: string): Promise<void> => {
  await keyDown(window, "P", { ctrlKey: true, shiftKey: true });
  await typed(name);
  await keyDown(query("input"), "Enter");
};

/** A bridge whose workspace is `open` (none while undefined), with recent workspaces `recent`. */
const fake = (open: boolean, recent: readonly string[] = [], output: unknown = CLAUDE_CODE) => {
  let status: unknown = open ? { name: "Weather station", readOnly: false } : NO_WORKSPACE;
  const handlers: Record<string, (input: Record<string, unknown>) => unknown> = {
    "workspace.status": () => status,
    "metamodel.get": () => ({ relations: [], types: [], statuses: [], properties: [], meanings: {} }),
    "element.list": () => ({ elements: [], total: 0 }),
    "workspace.connectAgent": () => output,
  };
  const invoke = vi.fn((name: string, input: Record<string, unknown> = {}): Promise<InvokeResult> => {
    const output = (handlers[name] ?? NO_SUMMARY[name])?.(input);
    return Promise.resolve(
      output instanceof Error
        ? { ok: false, error: { code: "workspace.not-found", message: output.message } as never }
        : { ok: true, output },
    );
  });
  const listeners = new Set<(change: WorkspaceChange) => void>();
  const copyText = vi.fn<(text: string) => Promise<boolean>>(() => Promise.resolve(true));
  const openWorkspace = vi.fn<ReqSeqBridge["openWorkspace"]>(() => Promise.resolve({ ok: true }));
  const bridge: ReqSeqBridge = {
    invoke,
    commands: () => Promise.resolve(CATALOG),
    copyText,
    pasteText: () => Promise.resolve(true),
    recentWorkspaces: () => Promise.resolve(recent.map((root) => ({ root, state: "found" as const }))),
    openWorkspace,
    listFolder: () => Promise.resolve({ name: "", entries: [] }),
    onSave: () => () => undefined,
    openDocs: () => Promise.resolve({ ok: true as const }),
    onHelp: () => () => undefined,
    on: (event: string, listener: (data: never) => void) => {
      if (event !== "workspace-changed") {
        return () => undefined;
      }
      const added = listener as (change: WorkspaceChange) => void;
      listeners.add(added);
      return () => listeners.delete(added);
    },
  };
  /** Main opened a workspace in the window: core answers for it from now on. */
  const opened = async (): Promise<void> => {
    status = { name: "Weather station", readOnly: false };
    await act(async () => {
      for (const listener of listeners) {
        listener({ reason: "opened" });
      }
      await Promise.resolve();
    });
    await settle();
  };
  return { bridge, invoke, copyText, openWorkspace, opened, handlers };
};

const render = async (bridge: ReqSeqBridge): Promise<void> => {
  await renderNode(createElement(App, { bridge }));
  await settle();
};

const calls = (invoke: ReturnType<typeof fake>["invoke"], name: string): unknown[] =>
  invoke.mock.calls.filter(([called]) => called === name).map(([, input]) => input);

describe("Connect AI agent in the app", () => {
  it("[SR-227/AK-gvt5] the command prompt asks the client as a step with the six fixed values", async () => {
    const { bridge, invoke } = fake(true);
    await render(bridge);
    await runCommand("Connect AI agent");
    expect(query("label").textContent).toBe(CLIENT_LABEL);
    expect(texts('[role="option"] .name')).toEqual(CLIENTS);
    expect(calls(invoke, "workspace.connectAgent")).toEqual([]);
    await typed("cursor");
    await keyDown(query("input"), "Enter");
    expect(calls(invoke, "workspace.connectAgent")).toEqual([{ client: "cursor" }]);
  });

  it("[SR-227/AK-cxxc] the output is a buffer: the answer, under it the block that Copy field copies, and the next step", async () => {
    const { bridge, copyText } = fake(true);
    await render(bridge);
    await runCommand("Connect AI agent");
    await typed("claude-code");
    await keyDown(query("input"), "Enter");
    const buffer = query(".agent-setup");
    expect([...buffer.querySelectorAll(".column > *")].map((part) => part.className)).toEqual([
      "answer",
      "field setup",
      "next",
      "valid",
    ]);
    expect(query(".agent-setup .answer").textContent).toBe(CLAUDE_CODE.answer);
    expect(query(".agent-setup .setup pre").textContent).toBe(CLAUDE_CODE.setup.text);
    expect(query(".agent-setup .next").textContent).toBe(
      "Run it in the folder where you start Claude Code; /mcp there lists reqseq.",
    );
    expect(query(".agent-setup .next code").textContent).toBe("/mcp");
    // "Copy field" by its shortcut, and by the copy symbol of the block.
    await keyDown(window, "C", { ctrlKey: true, shiftKey: true });
    expect(copyText).toHaveBeenLastCalledWith(CLAUDE_CODE.setup.text);
    expect(query('[aria-label="Modeline"]').textContent).toContain("Copied Setup");
    copyText.mockClear();
    await act(async () => {
      query('.agent-setup button[aria-label="Copy Setup"]').click();
      await Promise.resolve();
    });
    expect(copyText).toHaveBeenCalledExactlyOnceWith(CLAUDE_CODE.setup.text);
    // "Copy field" from the command prompt as well.
    copyText.mockClear();
    await runCommand("Copy field");
    expect(copyText).toHaveBeenCalledExactlyOnceWith(CLAUDE_CODE.setup.text);
  });

  it("[SR-225/AK-rqcg] without a workspace it asks the workspace as Open workspace does, opens it, then asks the client", async () => {
    const { bridge, invoke, openWorkspace, opened } = fake(false, ["/req/station", "/req/buoy"]);
    await render(bridge);
    await runCommand("Connect AI agent");
    expect(query("label").textContent).toBe("Workspace");
    expect(texts('[role="option"] .name')).toEqual(["/req/station", "/req/buoy"]);
    // Narrowed as typed (SR-131 AK1).
    await typed("buoy");
    expect(texts('[role="option"] .name')).toEqual(["/req/buoy"]);
    await keyDown(query("input"), "Enter");
    expect(openWorkspace).toHaveBeenCalledExactlyOnceWith("/req/buoy");
    await opened();
    expect(query("label").textContent).toBe(CLIENT_LABEL);
    expect(texts('[role="option"] .name')).toEqual(CLIENTS);
    await keyDown(query("input"), "Enter");
    expect(calls(invoke, "workspace.connectAgent")).toEqual([{ client: "claude-code" }]);
    expect(query(".agent-setup .answer").textContent).toBe(CLAUDE_CODE.answer);
  });

  it("[SR-225/AK-rqcg] a typed folder opens its workspace (SR-131 AK5), and without a recent one the prompt names Create workspace", async () => {
    const { bridge, openWorkspace, opened } = fake(false);
    await render(bridge);
    await runCommand("Connect AI agent");
    expect(query("label").textContent).toBe(NONE_OPENED);
    expect(NONE_OPENED).toContain("Create workspace");
    await typed("/req/station");
    expect(texts('[role="option"] .name')).toEqual(["Open /req/station"]);
    await keyDown(query("input"), "Enter");
    expect(openWorkspace).toHaveBeenCalledExactlyOnceWith("/req/station", { typed: true });
    await opened();
    expect(query("label").textContent).toBe(CLIENT_LABEL);
  });

  it("[SR-225/AK-rqcg] a workspace that does not open asks no client, also when one opens later", async () => {
    const { bridge, openWorkspace, opened } = fake(false);
    openWorkspace.mockResolvedValueOnce({ ok: false, reason: "no-workspace" });
    await render(bridge);
    await runCommand("Connect AI agent");
    await typed("/req/empty");
    await keyDown(query("input"), "Enter");
    expect(query('[aria-label="Minibuffer"]').textContent).toBe(
      "No workspace in /req/empty or a folder above it; no workspace is open",
    );
    // Then opened another way (File > Open Workspace): no prompt follows.
    await opened();
    expect(document.querySelector("input")).toBeNull();
  });

  it("[SR-225/AK-rqcg] a bridge that fails to open asks no client, also when one opens later", async () => {
    const { bridge, openWorkspace, opened } = fake(false);
    openWorkspace.mockRejectedValueOnce(new Error("gone"));
    await render(bridge);
    await runCommand("Connect AI agent");
    await typed("/req/station");
    await keyDown(query("input"), "Enter");
    expect(query('[aria-label="Minibuffer"]').textContent).toBe("/req/station could not be opened");
    await opened();
    expect(document.querySelector("input")).toBeNull();
  });

  it("[SR-227/AK-cxxc] the answer and the place stand as core gives them, also with a backtick in a name", async () => {
    const answer = 'Add this entry to connect it to the workspace "Weather `station".';
    const valid = "The setup holds as long as ReqSeq stays in /opt/re`qseq.";
    const { bridge } = fake(true, [], { ...CLAUDE_CODE, answer, valid, next: "Restart the `client." });
    await render(bridge);
    await runCommand("Connect AI agent");
    await keyDown(query("input"), "Enter");
    expect(query(".agent-setup .answer").textContent).toBe(answer);
    expect(query(".agent-setup .valid").textContent).toBe(valid);
    // A backtick left over in the next step is no code either.
    expect(query(".agent-setup .next").textContent).toBe("Restart the `client.");
    expect(document.querySelector(".agent-setup p code")).toBeNull();
  });

  it("says so when the catalog has no such command", async () => {
    const { bridge } = fake(true);
    bridge.commands = () =>
      Promise.resolve(CATALOG.map((command) => ({ ...command, name: "workspace.status" })));
    await render(bridge);
    await runCommand("Connect AI agent");
    expect(query('[aria-label="Minibuffer"]').textContent).toBe(
      "The command catalog has no workspace.connectAgent",
    );
  });

  it("adds nothing to the error of a catalog that could not be read", async () => {
    const failing = fake(true).bridge;
    failing.commands = () => Promise.reject(new Error("no catalog"));
    await render(failing);
    await runCommand("Connect AI agent");
    // The read said why; the action adds no claim about the catalog.
    expect(query('[aria-label="Minibuffer"]').textContent).not.toContain("catalog has no");
  });
});

describe("the connected agent in the modeline (SR-228)", () => {
  const agentPart = (): HTMLElement | null => document.querySelector(".modeline .agent");
  /** Waits past one poll of `workspace.agents`. */
  const nextPoll = async (): Promise<void> => {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, AGENTS_POLL_MS + 100));
    });
    await settle();
  };

  it("shows nothing without an answer or a usable cache folder, and Connect AI agent when none was ever connected", async () => {
    const { bridge, handlers } = fake(true);
    await render(bridge);
    expect(agentPart()).toBeNull();
    handlers["workspace.agents"] = () => ({ recorded: false, connected: [], last: null });
    await nextPoll();
    expect(agentPart()).toBeNull();
    handlers["workspace.agents"] = () => ({ recorded: true, connected: [], last: null });
    await nextPoll();
    expect(agentPart()?.textContent).toBe("Connect AI agent");
    expect(agentPart()?.tagName).toBe("BUTTON");
    expect(agentPart()?.querySelector(".agent-dot")).toBeNull();
  });

  it("a click on Connect AI agent or on No agent connected starts Connect AI agent, as the command prompt does", async () => {
    const { bridge, handlers } = fake(true);
    handlers["workspace.agents"] = () => ({ recorded: true, connected: [], last: null });
    await render(bridge);
    await act(async () => {
      agentPart()?.click();
      await Promise.resolve();
    });
    await settle();
    expect(query("label").textContent).toBe(CLIENT_LABEL);
    expect(texts('[role="option"] .name')).toEqual(CLIENTS);
    await keyDown(query("input"), "Escape");
    handlers["workspace.agents"] = () => ({
      recorded: true,
      connected: [],
      last: { client: "Claude Code", at: "2026-11-19T10:00:00Z" },
    });
    await nextPoll();
    expect(agentPart()?.textContent).toBe("No agent connected");
    expect(agentPart()?.getAttribute("title")).toMatch(
      /^Claude Code · last connected \d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/,
    );
    await act(async () => {
      agentPart()?.click();
      await Promise.resolve();
    });
    await settle();
    expect(query("label").textContent).toBe(CLIENT_LABEL);
  });

  it("shows Agent connected with a dot while a client is connected, each connection in the hover, and no button", async () => {
    const { bridge, handlers } = fake(true);
    handlers["workspace.agents"] = () => ({
      recorded: true,
      connected: [
        { client: "Claude Code", since: "2026-11-19T10:00:00Z" },
        { client: null, since: "2026-11-19T10:00:05Z" },
      ],
      last: null,
    });
    await render(bridge);
    expect(agentPart()?.textContent).toBe("Agent connected");
    expect(agentPart()?.tagName).toBe("SPAN");
    expect(agentPart()?.dataset["agent"]).toBe("connected");
    expect(agentPart()?.querySelector(".agent-dot")).not.toBeNull();
    expect(agentPart()?.getAttribute("title")?.split("\n")).toEqual([
      expect.stringMatching(/^Claude Code · connected since \d{4}-/),
      expect.stringMatching(/^unknown client · connected since \d{4}-/),
    ]);
  });
});
