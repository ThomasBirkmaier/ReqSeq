// "Connect AI agent" (SR-227) on the built app: the app's core process stands for the installation the app runs
// from, so it gives the same server as the command line started on the Electron of the app, as the launcher of
// a delivery starts it (ADR-0014); that server, on Electron with ELECTRON_RUN_AS_NODE, answers `initialize`.
// In the command prompt the app asks the client as a step and shows the setup as a buffer whose block "Copy
// field" copies (AK1, AK7); without a workspace it asks for the workspace first (SR-225 AK7). The tests keep
// the clipboard of the machine they run on. Keys use ControlOrMeta, so the same tests run on Linux and macOS.
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import type { FixtureWorkspace, RunningApp } from "./support/app.js";
import { copyFixture, launchApp } from "./support/app.js";

const OUT =
  process.env["REQSEQ_SCREENSHOTS"] ??
  fileURLToPath(new URL("../../../test-results/electron/screenshots", import.meta.url));

const CLIENTS = ["claude-code", "claude-desktop", "cursor", "vscode", "codex-cli", "other"];

const names = (window: Page) => window.locator('.candidates [role="option"] .name');

/** Chooses "Connect AI agent" in the command prompt. */
const connectAgent = async (window: Page): Promise<void> => {
  await window.keyboard.press("ControlOrMeta+Shift+P");
  await window.keyboard.type("Connect AI agent");
  await expect(names(window).first()).toHaveText("Connect AI agent");
  await window.keyboard.press("Enter");
};

/** The step that asks the client, with the six clients (SR-227 AK1, tested in `connect-agent-app.test.ts`). */
const expectClientStep = async (window: Page): Promise<void> => {
  await expect(window.locator("label.prompt-label")).toHaveText("Connect AI agent · client:");
  await expect(names(window)).toHaveText(CLIENTS);
};

/** The setup the command line gives for `client`, on the Electron of the app. */
const cliSetup = async (
  running: RunningApp,
  client: string,
): Promise<{ answer: string; setup: { text: string }; next: string }> => {
  const cli = await running.cli(["workspace", "connect-agent", "--client", client], { electron: true });
  expect(cli.code).toBe(0);
  return JSON.parse(cli.stdout) as { answer: string; setup: { text: string }; next: string };
};

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

  test("[SR-227/AK-cxxc] the setup is a buffer: the answer, the block Copy field copies, and how to go on", async () => {
    const { window } = running;
    const before = await running.app.evaluate(({ clipboard }) => clipboard.readText());
    try {
      await connectAgent(window);
      await expectClientStep(window);
      await window.keyboard.press("Enter");
      const expected = await cliSetup(running, "claude-code");
      const buffer = window.locator(".agent-setup[data-buffer]");
      await expect(buffer.locator(".answer")).toHaveText(expected.answer);
      await expect(buffer.locator(".setup pre")).toHaveText(expected.setup.text);
      await expect(buffer.locator(".next")).toHaveText(expected.next.replaceAll("`", ""));
      await expect(buffer.locator(".column > *")).toHaveCount(4);
      await window.keyboard.press("ControlOrMeta+Shift+C");
      await expect(window.getByLabel("Modeline")).toContainText("Copied Setup");
      expect(await running.app.evaluate(({ clipboard }) => clipboard.readText())).toBe(expected.setup.text);
      await buffer.locator(".setup").hover();
      await window.screenshot({ path: path.join(OUT, "connect-agent-light.png") });
      // Long paths wrap inside the column, also in a narrow window: no part runs past it (#2169).
      await running.app.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0]?.setContentSize(480, 800);
      });
      await expect
        .poll(() =>
          buffer
            .locator(".column > *")
            .evaluateAll((parts) => parts.filter((part) => part.scrollWidth > part.clientWidth).length),
        )
        .toBe(0);
    } finally {
      await running.app.evaluate(({ clipboard }, text) => clipboard.writeText(text), before);
    }
  });
});

test.describe("Connect AI agent without a workspace", () => {
  let running: RunningApp | undefined;
  let other: FixtureWorkspace | undefined;
  test.afterEach(async () => {
    await running?.close();
    await other?.cleanup();
  });

  test("[SR-225/AK-rqcg] asks the workspace as Open workspace does, opens it, then asks the client", async () => {
    other = await copyFixture({ fixture: "SR-004/one-repository" });
    running = await launchApp(undefined, { recent: [other.root] });
    const { window } = running;
    await expect(window.getByLabel("Modeline")).toHaveText("No workspace is open.");
    await connectAgent(window);
    await expect(window.locator("label.prompt-label")).toHaveText("Workspace");
    await expect(names(window)).toHaveText([other.root]);
    await window.keyboard.press("Enter");
    await expectClientStep(window);
    await expect(window).toHaveTitle("Weather station - ReqSeq");
    await window.keyboard.press("Enter");
    await expect(window.locator(".agent-setup .setup pre")).toContainText(other.root);
  });

  test("[SR-225/AK-rqcg] without a workspace opened before, the prompt names Create workspace", async () => {
    running = await launchApp(undefined);
    const { window } = running;
    await expect(window.getByLabel("Modeline")).toHaveText("No workspace is open.");
    await connectAgent(window);
    await expect(window.locator("label.prompt-label")).toHaveText(
      "Workspace (none opened yet: type its folder, or use Create workspace)",
    );
  });
});
