import { getCommandRuntime } from "@reqseq/core";
import { describe, expect, it } from "vitest";
import { cliOutput } from "./access.js";
import { SERVERS, SERVERS_PAGE, serversPage } from "./servers.js";

describe("servers page", () => {
  it("shows the help of serve api, serve docs and mcp with links below the base", async () => {
    const runtime = getCommandRuntime();
    const page = await serversPage(runtime, "/ReqSeq/", 52);
    expect(SERVERS_PAGE).toBe("reference/commands/servers.md");
    expect(page).toMatch(/^---\ntitle: Servers\n[^]*\n {2}order: 52\n---\n/);
    for (const server of SERVERS) {
      const call = ["reqseq", ...server.argv].join(" ");
      const help = await cliOutput([...server.argv, "--help"], runtime);
      expect(help).toContain(`Usage: ${call}`);
      expect(page).toContain(`## ${call}\n`);
      expect(page).toContain(help.trimEnd());
    }
    expect(page).toContain("GET /v1/commands");
    expect(page).toContain("](/ReqSeq/reference/formats/api-endpoint/)");
    expect(page).toContain("](/ReqSeq/concepts/cli-api-and-mcp/)");
    expect(page).not.toContain("](/reference/");
  });
});
