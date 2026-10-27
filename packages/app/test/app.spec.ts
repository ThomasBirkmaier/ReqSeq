// The app shell (#322, ADR-0010): the processes, the bridge to the command catalog, the protocols and the
// security settings, on the built app.
import type { InvokeResult, LogReqBridge } from "@logreq/app";
import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import type { RunningApp } from "./support/app.js";
import { launchApp } from "./support/app.js";

declare global {
  interface Window {
    readonly logreq: LogReqBridge;
  }
}

/** The command catalog (ADR-0002). */
const CATALOG = JSON.parse(
  fs.readFileSync(new URL("../../../schemas/commands/catalog.json", import.meta.url), "utf8"),
) as { readonly commands: readonly { readonly name: string }[] };

/** A 1×1 PNG. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

const FIXTURE = {
  fixture: "SR-004/one-repository",
  files: { "images/dot.png": new Uint8Array(PNG), "images/notes.txt": "not an image\n" },
};

/** Whether the window can load `url` as an image. */
const loadsImage = (running: RunningApp, url: string): Promise<boolean> =>
  running.window.evaluate(
    (src) =>
      new Promise<boolean>((resolve) => {
        const image = new Image();
        image.onload = () => {
          resolve(true);
        };
        image.onerror = () => {
          resolve(false);
        };
        image.src = src;
      }),
    url,
  );

const invoke = (running: RunningApp, name: string, input: unknown): Promise<InvokeResult> =>
  running.window.evaluate(([n, i]) => window.logreq.invoke(n, i), [name, input] as const);

test.describe("on a fixture workspace", () => {
  let running: RunningApp;
  test.beforeEach(async () => {
    running = await launchApp(FIXTURE);
  });
  test.afterEach(async () => {
    await running.close();
  });

  test("starts and shows the status of the workspace", async () => {
    await expect(running.window.getByLabel("Modeline")).toContainText("Weather station");
    await expect(running.window).toHaveTitle("Weather station - LogReq");
    await expect(running.window.getByLabel("Minibuffer")).toHaveText("");
  });

  test("[SR-080/AK2] an invoke round trip gives what the CLI gives, output and error alike", async () => {
    for (const [name, input, argv] of [
      ["workspace.status", {}, ["workspace", "status"]],
      ["element.get", { ref: "SR-e88fb3" }, ["element", "get", "SR-e88fb3"]],
    ] as const) {
      const [app, cli] = await Promise.all([invoke(running, name, input), running.cli(argv)]);
      expect([name, cli.code]).toEqual([name, 0]);
      expect([name, app]).toEqual([name, { ok: true, output: JSON.parse(cli.stdout) as unknown }]);
    }
    const [app, cli] = await Promise.all([
      invoke(running, "element.get", { ref: "SR-ffffff" }),
      running.cli(["element", "get", "SR-ffffff"]),
    ]);
    expect(cli.code).toBe(2);
    expect(app).toEqual({ ok: false, error: JSON.parse(cli.stderr) as unknown });
  });

  test("[SR-099/AK1] the bridge offers the catalog commands and nothing else", async () => {
    const offered = await running.window.evaluate(() => Object.keys(window.logreq).sort());
    // `copyText` (SR-128) is the one facility of the window besides the catalog; it deletes nothing.
    expect(offered).toEqual(["commands", "copyText", "invoke", "on"]);
    const names = await running.window.evaluate(async () =>
      (await window.logreq.commands()).map((c) => c.name),
    );
    expect(names).toEqual(CATALOG.commands.map((c) => c.name));
    expect(names.filter((name) => /delete/i.test(name))).toEqual([]);
    const refused = await invoke(running, "element.delete", { ref: "SR-e88fb3" });
    expect(refused).toEqual({
      ok: false,
      error: {
        code: "input.invalid",
        message: "Unknown command: element.delete",
        details: { command: "element.delete" },
      },
    });
  });

  test("the renderer is sandboxed: no Node, no require, no process", async () => {
    const reach = await running.window.evaluate(() => ({
      require: typeof (globalThis as { require?: unknown }).require,
      process: typeof (globalThis as { process?: unknown }).process,
      module: typeof (globalThis as { module?: unknown }).module,
    }));
    expect(reach).toEqual({ require: "undefined", process: "undefined", module: "undefined" });
  });

  test("the session cancels every request that is not local, and the app makes none (SR-078)", async () => {
    await expect(running.window.getByLabel("Modeline")).toContainText("Weather station");
    // The app itself asked for nothing outside its own protocols while it started and loaded the workspace.
    expect(running.stderr()).not.toContain("Blocked a request");
    const fromMain = await running.app.evaluate(async ({ session }) => {
      try {
        await session.defaultSession.fetch("https://example.com/logreq-probe");
        return "loaded";
      } catch (error) {
        return String(error);
      }
    });
    expect(fromMain).toContain("ERR_BLOCKED_BY_CLIENT");
    expect(running.stderr()).toContain("Blocked a request to https://example.com\n");
    expect(running.stderr()).not.toContain("logreq-probe");
    // The page's content security policy stops these before they reach the session.
    expect(await loadsImage(running, "https://example.com/image.png")).toBe(false);
    const fetched = await running.window.evaluate(() =>
      fetch("http://127.0.0.1:9/").then(
        () => "loaded",
        () => "refused",
      ),
    );
    expect(fetched).toBe("refused");
  });

  test("logreq-file: serves images inside a repository of the workspace, nothing else", async () => {
    const root = running.workspace?.root ?? "";
    // An image outside the repository, and a link to it inside.
    await fs.promises.writeFile(path.join(root, "..", "outside.png"), PNG);
    await fs.promises.symlink(
      path.join(root, "..", "outside.png"),
      path.join(root, "images", "link.png"),
      "file",
    );
    expect(await loadsImage(running, "logreq-file://workspace/system/images/dot.png")).toBe(true);
    // Chromium resolves dot segments, also encoded ones, before the request: still inside.
    expect(await loadsImage(running, "logreq-file://workspace/system/x/%2e%2e/images/dot.png")).toBe(true);
    expect(await loadsImage(running, "logreq-file://workspace/system/images/missing.png")).toBe(false);
    expect(await loadsImage(running, "logreq-file://workspace/system/images/notes.txt")).toBe(false);
    expect(await loadsImage(running, "logreq-file://workspace/vault/images/dot.png")).toBe(false);
    expect(await loadsImage(running, "logreq-file://workspace/system/images/link.png")).toBe(false);
    expect(await loadsImage(running, "logreq-file://workspace/system/..%2Foutside.png")).toBe(false);
  });

  test("navigation and new windows are denied", async () => {
    await expect(running.window.getByLabel("Modeline")).toContainText("Weather station");
    await running.window.evaluate(() => {
      window.open("app://logreq/index.html");
      window.open("https://example.com/");
    });
    await running.window.evaluate(() => {
      window.location.href = "https://example.com/";
    });
    // Asked in the main process: a denied navigation leaves the page where it was.
    const windows = await running.app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().map((w) => w.webContents.getURL()),
    );
    expect(windows).toEqual(["app://logreq/index.html"]);
    expect(
      await running.window.evaluate(() => document.querySelector('[aria-label="Modeline"]')?.textContent),
    ).toContain("Weather station");
  });

  test("a core process that stops is started again on the same workspace", async () => {
    await expect(running.window.getByLabel("Modeline")).toContainText("Weather station");
    const pid = await running.app.evaluate(
      ({ app }) => app.getAppMetrics().find((m) => m.name === "LogReq core")?.pid,
    );
    expect(pid).toBeGreaterThan(0);
    process.kill(pid ?? 0);
    await expect(running.window.getByLabel("Minibuffer")).toHaveText(
      "The core process stopped and was started again.",
    );
    await expect(running.window.getByLabel("Modeline")).toContainText("Weather station");
    expect((await invoke(running, "element.get", { ref: "SR-e88fb3" })).ok).toBe(true);
  });
});

test.describe("without a workspace", () => {
  let running: RunningApp;
  test.beforeEach(async () => {
    running = await launchApp(undefined);
  });
  test.afterEach(async () => {
    await running.close();
  });

  test("says that none is open and how to open one", async () => {
    await expect(running.window.getByLabel("Modeline")).toHaveText("No workspace");
    await expect(running.window.getByLabel("Minibuffer")).toHaveText(
      "No workspace is open. Open one with File > Open Workspace.",
    );
    expect(await invoke(running, "workspace.status", {})).toEqual({
      ok: false,
      error: {
        code: "workspace.not-found",
        message: "No workspace is open. Open one with File > Open Workspace.",
      },
    });
  });
});
