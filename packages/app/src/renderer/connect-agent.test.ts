// What the app asks and shows of "Connect AI agent" (SR-227 AK1, AK7): only its client is an optional argument the
// prompt asks as a step, and the buffer takes the answer, the block and the next step from the output.
import { describe, expect, it } from "vitest";
import { getCommandRuntime } from "@reqseq/core";
import type { CommandListing } from "../shared/protocol.js";
import { listedEntry } from "../core/listing.js";
import { ASKED_IN_APP, askedOf, isWrite, schemaOf } from "./catalog-arguments.js";
import { CONNECT_AGENT, agentSetupOf, codeParts } from "./connect-agent.js";

const runtime = getCommandRuntime();
const CATALOG: readonly CommandListing[] = runtime.contracts.commands.map((entry) => ({
  ...listedEntry(entry, runtime.contracts.schemas),
  implemented: runtime.commands.has(entry.name),
  cliUsage: "",
}));

const required = (command: CommandListing): readonly string[] =>
  (command.input as { readonly required?: readonly string[] }).required ?? [];

describe("Connect AI agent: the client step and the setup buffer", () => {
  it("[SR-227/AK-gvt5] the client is asked before the command runs, among the six clients of the catalog", () => {
    const command = CATALOG.find((listed) => listed.name === CONNECT_AGENT);
    expect(command?.implemented).toBe(true);
    if (command === undefined) {
      return;
    }
    expect(required(command)).toEqual([]);
    expect(askedOf(command)).toEqual(["client"]);
    expect(command.arguments).toEqual([{ field: "client", complete: "choice" }]);
    expect(schemaOf(command, "client").enum).toEqual([
      "claude-code",
      "claude-desktop",
      "cursor",
      "vscode",
      "codex-cli",
      "other",
    ]);
  });

  it("asks no other optional argument of a read command as a step", () => {
    expect([...ASKED_IN_APP.keys()]).toEqual([CONNECT_AGENT]);
    for (const command of CATALOG.filter((listed) => !isWrite(listed) && listed.name !== CONNECT_AGENT)) {
      expect(askedOf(command), command.name).toEqual(required(command));
    }
  });

  it("[SR-227/AK-cxxc] the buffer shows the answer, the block and the next step of an output for a client", () => {
    const output = {
      answer: "Add this entry to your client's MCP configuration.",
      client: "other",
      setup: { form: "json", text: '{ "mcpServers": {} }' },
      valid: "The setup holds as long as ReqSeq stays in /opt/reqseq.",
      next: "Add the entry; a client with another form takes the same `command`, `args` and `env`.",
    };
    expect(agentSetupOf({ command: CONNECT_AGENT, output })).toEqual({
      answer: output.answer,
      text: output.setup.text,
      form: "json",
      next: output.next,
      valid: output.valid,
    });
    // Without a client (CLI, API and MCP list the clients), or another command: the outline of every output.
    expect(
      agentSetupOf({ command: CONNECT_AGENT, output: { answer: "Choose the client.", clients: [] } }),
    ).toBe(undefined);
    expect(agentSetupOf({ command: CONNECT_AGENT, output: undefined })).toBe(undefined);
    expect(agentSetupOf({ command: "workspace.status", output })).toBe(undefined);
    expect(codeParts("Run `it.")).toEqual([{ text: "Run `it.", code: false }]);
    expect(codeParts(output.next)).toEqual([
      { text: "Add the entry; a client with another form takes the same ", code: false },
      { text: "command", code: true },
      { text: ", ", code: false },
      { text: "args", code: true },
      { text: " and ", code: false },
      { text: "env", code: true },
      { text: ".", code: false },
    ]);
  });
});
