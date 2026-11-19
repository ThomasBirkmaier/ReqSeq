// "Connect AI agent" (SR-227) on the built app: the app's core process stands for the installation the app runs
// from, so it gives the same server as the command line started on the Electron of the app, as the launcher of
// a delivery starts it (ADR-0014); that server, on Electron with ELECTRON_RUN_AS_NODE, answers `initialize`.
// The buffer that shows the setup in the app is #1889.
import { spawn } from "node:child_process";
import { expect, test } from "@playwright/test";
import type { RunningApp } from "./support/app.js";
import { launchApp } from "./support/app.js";

interface Server {
  readonly command: string;
  readonly args: readonly string[];
  readonly env: Readonly<Record<string, string>>;
}

/** Starts the server as a client would and resolves to its answer to `initialize`. */
const initialize = (server: Server): Promise<Record<string, unknown>> =>
  new Promise((resolve, reject) => {
    const child = spawn(server.command, [...server.args], {
      env: { ...process.env, ...server.env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    child.stderr.on("data", (chunk: Buffer) => (err += chunk.toString("utf8")));
    child.stdout.on("data", (chunk: Buffer) => {
      out += chunk.toString("utf8");
      const line = out.split("\n")[0];
      if (out.includes("\n") && line !== undefined) {
        child.stdin.end();
        resolve(JSON.parse(line) as Record<string, unknown>);
      }
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      reject(new Error(`the server ended with ${String(code)} before it answered: ${err}`));
    });
    child.stdin.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "spec", version: "1" },
        },
      })}\n`,
    );
  });

test.describe("Connect AI agent", () => {
  let running: RunningApp;
  test.beforeEach(async () => {
    running = await launchApp({ fixture: "SR-004/one-repository" });
    await expect(running.window.getByRole("listbox", { name: "Overview" })).toBeVisible();
  });
  test.afterEach(async () => {
    await running.close();
  });

  test("[SR-227/AK-cw0k] the app gives the server of the command line on its Electron, which starts", async () => {
    const app = await running.window.evaluate(() =>
      window.reqseq.invoke("workspace.connectAgent", { client: "other" }),
    );
    expect(app.ok).toBe(true);
    const fromApp = (app as { output: { server: Server } }).output.server;
    const cli = await running.cli(["workspace", "connect-agent", "--client", "other"], { electron: true });
    expect(cli.code).toBe(0);
    const fromCli = (JSON.parse(cli.stdout) as { server: Server }).server;
    expect(fromApp).toEqual(fromCli);
    expect(fromApp.env).toEqual({ ELECTRON_RUN_AS_NODE: "1" });
    expect(fromApp.args).toContain(running.workspace?.root);
    const answer = await initialize(fromApp);
    expect(answer).toMatchObject({ id: 1, result: { serverInfo: expect.any(Object) } });
  });
});
