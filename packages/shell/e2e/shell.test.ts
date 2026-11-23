// The e2e tests of the desktop shell (SR-252, ADR-0021, Test seam): the e2e build of `reqseq-shell` with the CLI
// of the checkout, driven through its test driver. The recording tests (AK2, AK6, AK7) run on Linux with
// `strace -f`; on Linux CI the suite runs under Xvfb and a D-Bus session inside `unshare -rn`, so every connection
// to another machine is refused. On Windows they record with the event log, ETW and firewall rules
// (record-windows.ts), on macOS with eslogger, pktap and pf (record-macos.ts).
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { FixtureWorkspace } from "@reqseq/testkit";
import { createFixtureWorkspace } from "@reqseq/testkit";
import { afterAll, afterEach, beforeAll, describe, expect, it, onTestFinished } from "vitest";
import type { WindowsRecord } from "./record-windows.js";
import type { MacRecord } from "./record-macos.js";
import { MacRecorder, isEngine, macRecordingMode, onLoopback } from "./record-macos.js";
import { CONTROL_ADDRESS, WindowsRecorder, holds, inside, recordingMode } from "./record-windows.js";
import type { Shell } from "./support.js";
import {
  FAKE_SERVER,
  OPENER,
  SHELL,
  descends,
  endShells,
  loopback,
  openWorkspace,
  readTrace,
  requireBuilt,
  startShell,
  stopsAnswering,
  tempFolder,
} from "./support.js";

const linux = process.platform === "linux";
const windows = process.platform === "win32";
const ELEMENT = "e8df96ea-a168-4d90-8d65-6328cee88fb3";
const LINK = "https://example.org/guide?from=reqseq";

beforeAll(() => {
  requireBuilt();
});

afterEach(async () => {
  await endShells();
});

/** The fixture workspace with an element whose text holds links, a remote image and raw HTML, removed after the test. */
async function workspace(): Promise<FixtureWorkspace> {
  const ws = await newWorkspace();
  onTestFinished(() => ws.cleanup());
  return ws;
}

/** The fixture workspace of `workspace()`, which the caller removes. */
function newWorkspace(): Promise<FixtureWorkspace> {
  return createFixtureWorkspace({
    fixture: "SR-004/one-repository",
    files: {
      "requirements/SR-6328cee88fb3.md": [
        "---",
        `id: ${ELEMENT}`,
        "type: system-requirement",
        "status: draft",
        "title: Show wind speed",
        "---",
        "",
        `The station shows the current wind speed. See [the guide](${LINK}), [write to us](mailto:someone@example.org)`,
        "and the picture ![wind](https://192.0.2.7/wind.png).",
        "",
        '<a href="https://192.0.2.8/raw">raw link</a> <img src="https://192.0.2.9/raw.png"> <iframe src="https://192.0.2.10/"></iframe>',
        "",
      ].join("\n"),
    },
  });
}

/** A folder whose `xdg-open` (Linux) or opener script (macOS, Windows) records each address it gets. */
async function opener(): Promise<{ env: Record<string, string>; opened: () => Promise<string[][]> }> {
  const folder = await tempFolder("opener");
  onTestFinished(() => fs.rm(folder, { recursive: true, force: true }));
  const record = path.join(folder, "opened.jsonl");
  const env: Record<string, string> = { REQSEQ_OPENED: record };
  if (linux) {
    await fs.writeFile(
      path.join(folder, "xdg-open"),
      `#!/bin/sh\nexec "${process.execPath}" "${OPENER}" "$@"\n`,
      { mode: 0o755 },
    );
    env["PATH"] = `${folder}${path.delimiter}${process.env["PATH"] ?? ""}`;
  } else {
    env["REQSEQ_SHELL_E2E_OPENER"] = OPENER;
  }
  const opened = async (): Promise<string[][]> => {
    const text = await fs.readFile(record, "utf8").catch(() => "");
    return text
      .split("\n")
      .filter((l) => l !== "")
      .map((l) => JSON.parse(l) as string[]);
  };
  return { env, opened };
}

/** Shows the element with the links in the page and waits until its link is there. */
async function showElement(shell: Shell, ws: FixtureWorkspace): Promise<void> {
  await openWorkspace(shell, ws.root);
  await showRoute(shell, `#/e/${ELEMENT}`);
  await shell.evalUntil(
    "the element's link",
    `document.querySelector('a[href=${JSON.stringify(LINK)}]') !== null`,
  );
}

/** Goes to `route` until the page stays there: right after an open, the page may still go to its workspace page. */
async function showRoute(shell: Shell, route: string): Promise<void> {
  await shell.evalUntil(
    `the route ${route}`,
    `(() => { if (location.hash !== ${JSON.stringify(route)}) { location.hash = ${JSON.stringify(route)}; return false; } return document.readyState === "complete"; })()`,
  );
}

/** A page script that asks the shell to open `address` and keeps the answer in `window.__open[key]`. */
const askOpen = (key: string, address: string): string => `(() => {
  window.__open = window.__open || {};
  window.__TAURI_INTERNALS__.invoke("open_address", { address: ${JSON.stringify(address)} })
    .then(() => { window.__open[${JSON.stringify(key)}] = "opened"; }, (e) => { window.__open[${JSON.stringify(key)}] = "refused: " + String(e); });
  return true;
})()`;

const answer = (shell: Shell, key: string): Promise<unknown> =>
  shell.evalUntil(`the answer for ${key}`, `(window.__open || {})[${JSON.stringify(key)}] || null`);

/** Reads the element and changes its title through the server, as the page's edit does, and checks the file. */
async function changeElement(shell: Shell, ws: FixtureWorkspace): Promise<void> {
  const changed = await shell.eval(`(() => {
    window.__changed = null;
    const call = (name, input) => fetch("api/" + name, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer " + sessionStorage.getItem("reqseq.token"), "x-reqseq-workspace": String(window.__generation) },
      body: JSON.stringify(input),
    });
    call("element.get", { ref: "${ELEMENT}" })
      .then((r) => r.json())
      .then((got) => call("element.update", { ref: "${ELEMENT}", title: "Show wind speed and gusts", expectedFileSha256: got.fileSha256 }))
      .then(async (r) => { window.__changed = r.status === 200 ? 200 : r.status + " " + (await r.text()); }, (e) => { window.__changed = String(e); });
    return true;
  })()`);
  expect(changed).toBe(true);
  expect(await shell.evalUntil("the change", "window.__changed")).toBe(200);
  expect(await fs.readFile(path.join(ws.root, "requirements", "SR-6328cee88fb3.md"), "utf8")).toContain(
    "title: Show wind speed and gusts",
  );
}

/** The token of the page. The page's answer passes the shell's output filter too, so it comes back encoded. */
async function pageToken(shell: Shell): Promise<string> {
  const token = Buffer.from(
    String(await shell.evalUntil("the token", "btoa(sessionStorage.getItem('reqseq.token') || '') || null")),
    "base64",
  ).toString("utf8");
  expect(token).toMatch(/^[\w-]{20,}$/);
  return token;
}

describe("SR-252: the desktop shell shows the web UI of its release", () => {
  it("[SR-252/AK-gq7j] the address stops answering within 5 s however the shell ends, and closing the window ends it", async () => {
    const ends: { name: string; end: (shell: Shell) => void; clean: boolean }[] = [
      {
        name: "window closed",
        end: (s) => {
          s.send({ close: true });
        },
        clean: true,
      },
      {
        name: "crash",
        end: (s) => {
          s.send({ crash: true });
        },
        clean: false,
      },
      ...(windows
        ? [{ name: "TerminateProcess", end: (s: Shell) => s.child.kill(), clean: false }]
        : (["SIGTERM", "SIGINT", "SIGHUP", "SIGKILL"] as const).map((signal) => ({
            name: signal,
            end: (s: Shell) => s.child.kill(signal),
            clean: signal !== "SIGKILL",
          }))),
    ];
    for (const { name, end, clean } of ends) {
      const shell = await startShell();
      const port = await shell.port();
      await shell.event("page-load", (v) => String(v).startsWith("Finished"));
      end(shell);
      const took = await stopsAnswering(port);
      expect([name, took !== undefined && took <= 5_000]).toEqual([name, true]);
      const { code } = await shell.exited;
      if (clean) {
        expect([name, code]).toEqual([name, 0]);
      }
    }
  }, 180_000);

  it("[SR-252/AK-bdg4] a server that fails, prints no address or ends is killed and named, and no page of it loads", async () => {
    const pids = await tempFolder("pids");
    onTestFinished(() => fs.rm(pids, { recursive: true, force: true }));
    const fake = (mode: string, extra: Record<string, string> = {}) =>
      startShell({
        cli: FAKE_SERVER,
        env: { REQSEQ_FAKE: mode, REQSEQ_FAKE_PID: path.join(pids, mode), ...extra },
      });
    const gone = async (mode: string): Promise<boolean> => {
      const pid = Number(await fs.readFile(path.join(pids, mode), "utf8"));
      for (let i = 0; i < 50; i++) {
        try {
          process.kill(pid, 0);
        } catch {
          return true;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      return false;
    };

    // It ends with an error: the last 2,000 characters of its standard error are the reason.
    const fails = await fake("fails");
    expect((await fails.exited).code).not.toBe(0);
    const reason = (await fails.event("report")) as string;
    expect(reason).toContain("Error: the port is taken");
    expect(reason).not.toContain("HEAD");
    expect(fails.stderr).toContain("Error: the port is taken");
    expect(fails.all("page-load")).toEqual([]);
    expect(fails.all("shown")).toEqual([]);

    // It prints no address: killed, and the reason says so (the wait is shortened from 30 s in the e2e build).
    const silent = await fake("silent", { REQSEQ_SHELL_E2E_ADDRESS_WAIT_MS: "2000" });
    expect((await silent.exited).code).not.toBe(0);
    expect(await silent.event("report")).toBe(
      "The ReqSeq UI server printed no loopback address within 30 s.",
    );
    expect(await gone("silent")).toBe(true);
    expect(silent.all("page-load")).toEqual([]);

    // It prints the address of another machine: killed, and nothing loaded from there.
    const elsewhere = await fake("elsewhere");
    expect((await elsewhere.exited).code).not.toBe(0);
    expect(String(await elsewhere.event("report"))).toContain("not a loopback address");
    expect(await gone("elsewhere")).toBe(true);
    expect(elsewhere.all("page-load")).toEqual([]);

    // It cannot start at all.
    const missing = await startShell({ node: path.join(pids, "no-such-node") });
    expect((await missing.exited).code).not.toBe(0);
    expect(String(await missing.event("report"))).toMatch(/^The ReqSeq UI server could not start: /);

    // It ends while the shell shows it: the shell names it and loads nothing more.
    const ends = await fake("ends");
    await ends.shown();
    expect((await ends.exited).code).not.toBe(0);
    expect(String(await ends.event("report"))).toContain("Error: the server stopped");
    const loadsAfterReport = ends.events.slice(ends.events.findIndex((e) => e.kind === "report"));
    expect(loadsAfterReport.filter((e) => e.kind === "page-load")).toEqual([]);
  }, 120_000);

  it("[SR-252/AK-vfnt] a workspace file at the root, readable or not, starts no server and names the file", async () => {
    // The e2e build takes `REQSEQ_SHELL_E2E_ROOT` for the root of the file system (or of the system drive).
    const root = await tempFolder("root");
    onTestFinished(() => fs.rm(root, { recursive: true, force: true }));
    const file = path.join(root, "reqseq-workspace.yaml");
    const pid = path.join(root, "server.pid");
    await fs.writeFile(file, "name: at the root\n");
    const cases = windows ? ["readable"] : ["readable", "unreadable"];
    for (const name of cases) {
      if (name === "unreadable") {
        await fs.chmod(file, 0o000);
        // Root, and the mapped root of `unshare -r` on Linux CI, still reads it: the case then shows nothing new.
        if (
          await fs.access(file, fs.constants.R_OK).then(
            () => true,
            () => false,
          )
        ) {
          continue;
        }
      }
      const shell = await startShell({
        cli: FAKE_SERVER,
        env: { REQSEQ_SHELL_E2E_ROOT: root, REQSEQ_FAKE: "silent", REQSEQ_FAKE_PID: pid },
      });
      expect((await shell.exited).code, name).not.toBe(0);
      const reason = String(await shell.event("report"));
      expect(reason, name).toContain(file);
      expect(reason, name).toMatch(/^ReqSeq cannot start its UI server: /);
      expect(shell.stderr, name).toContain(file);
      expect(shell.all("shown"), name).toEqual([]);
      expect(shell.all("page-load"), name).toEqual([]);
      await expect(fs.access(pid), name).rejects.toThrow();
    }
  }, 60_000);

  it("[SR-252/AK-m1m2] hands full http, https and mailto addresses to the system's opener and refuses the own server and the rest", async () => {
    const ws = await workspace();
    const open = await opener();
    const shell = await startShell({ env: open.env });
    const origin = await shell.shown();
    const port = new URL(origin).port;
    await showElement(shell, ws);

    // A click on a link of the element text.
    await shell.eval(
      `(() => { document.querySelector('a[href=${JSON.stringify(LINK)}]').click(); return true; })()`,
    );
    for (const [key, address] of [
      ["mail", "MAILTO:someone@example.org"],
      ["https", "HTTPS://Example.org/x"],
      ["loopback other port", `http://127.0.0.1:${String(Number(port) + 1)}/`],
    ] as const) {
      await shell.eval(askOpen(key, address));
      expect([key, await answer(shell, key)]).toEqual([key, "opened"]);
    }
    for (const [key, address] of [
      ["own", origin],
      ["own with token", `${origin}/#token=x`],
      ["own as localhost", `http://localhost:${port}/`],
      ["own as 127.1", `http://127.1:${port}/`],
      ["own as ::1", `http://[::1]:${port}/`],
      ["no scheme", "example.org/x"],
      ["relative", "#/e/x"],
      ["empty", ""],
      ["file", "file:///etc/passwd"],
      ["javascript", "javascript:alert(1)"],
    ] as const) {
      await shell.eval(askOpen(key, address));
      expect([key, String(await answer(shell, key))]).toEqual([
        key,
        expect.stringMatching(/^refused: Not opened: /),
      ]);
    }
    const handed = await (async () => {
      for (let i = 0; i < 50; i++) {
        const list = await open.opened();
        if (list.length >= 4) {
          return list;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      return open.opened();
    })();
    expect(handed.sort()).toEqual(
      [
        [LINK],
        ["mailto:someone@example.org"],
        ["https://example.org/x"],
        [`http://127.0.0.1:${String(Number(port) + 1)}/`],
      ].sort(),
    );
    // Nothing of it loads in the window, which still shows its server.
    expect(await shell.eval("location.origin")).toBe(origin);
    expect(shell.all("navigation").filter((n) => !String(n).startsWith("allowed"))).toEqual([]);

    // Without an opener the shell keeps running and the page learns it.
    const lonely = await startShell({
      env: linux
        ? { ...open.env, PATH: path.dirname(process.execPath) }
        : { ...open.env, REQSEQ_SHELL_E2E_OPENER_NODE: path.join(ws.root, "no-node") },
    });
    await lonely.shown();
    await lonely.eval(askOpen("none", "https://example.org/"));
    expect(String(await answer(lonely, "none"))).toMatch(/^refused: No program could open the address/);
    expect(await lonely.eval("1 + 1")).toBe(2);
    expect(lonely.child.exitCode).toBeNull();
  }, 120_000);

  it("[SR-252/AK-cykp] loading pages and elements with links and raw HTML asks for no address; one click asks for exactly its own", async () => {
    const ws = await workspace();
    const open = await opener();
    const shell = await startShell({ env: open.env });
    await shell.shown();
    await showElement(shell, ws);
    await showRoute(shell, "#/q/overview");
    await showRoute(shell, `#/e/${ELEMENT}`);
    await shell.evalUntil(
      "the link again",
      `document.querySelector('a[href=${JSON.stringify(LINK)}]') !== null`,
    );
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    expect(shell.all("open_address")).toEqual([]);
    await shell.eval(
      `(() => { document.querySelector('a[href=${JSON.stringify(LINK)}]').click(); return true; })()`,
    );
    await shell.event("open_address");
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(shell.all("open_address")).toEqual([LINK]);
  }, 90_000);
});

describe.runIf(linux)(
  "SR-252: what the desktop shell starts, opens, writes and connects to (strace, Linux)",
  () => {
    it("[SR-252/AK-nhyc] the token is in no argument, no output of the shell and no file it writes", async () => {
      const shell = await startShell({ record: true });
      await shell.shown();
      const token = await pageToken(shell);
      await shell.eval(
        "(() => { console.log(location.href, sessionStorage.getItem('reqseq.token')); return true; })()",
      );
      shell.send({ close: true });
      expect((await shell.exited).code).toBe(0);
      expect(shell.stdout).not.toContain(token);
      expect(shell.stderr).not.toContain(token);
      const recorded = await readTrace(shell.trace ?? "");
      expect(recorded.execs.length).toBeGreaterThan(1);
      expect(recorded.execs.filter((e) => e.argv.includes(token) || e.program.includes(token))).toEqual([]);
      const server = recorded.execs.find((e) => e.argv.includes('"ui", "--no-open"'));
      expect(server).toBeDefined();
      const written = [
        ...new Set(
          recorded.opens
            .filter((o) => o.write && !descends(recorded, o.pid, server?.pid ?? -1))
            .map((o) => o.path),
        ),
      ];
      const holding: string[] = [];
      for (const file of written) {
        // The engine's data folder is the exception (SR-252 AK2); devices and the process's own files are no files
        // the shell writes.
        if (/^\/(?:dev|proc|sys)\//.test(file) || file.includes("io.github.thomasbirkmaier.reqseq")) {
          continue;
        }
        const content = await fs.readFile(file, "utf8").catch(() => "");
        if (content.includes(token)) {
          holding.push(file);
        }
      }
      expect(holding).toEqual([]);
    }, 90_000);

    it("[SR-252/AK-cg77] reading and changing elements starts only the server and the engine and opens no workspace file", async () => {
      const ws = await workspace();
      const shell = await startShell({ record: true });
      await shell.shown();
      await showElement(shell, ws);
      await changeElement(shell, ws);
      shell.send({ close: true });
      expect((await shell.exited).code).toBe(0);
      const recorded = await readTrace(shell.trace ?? "");
      const server = recorded.execs.find((e) => e.argv.includes('"ui", "--no-open"'));
      const shellPid = recorded.execs.find((e) => e.program.endsWith("reqseq-shell"))?.pid ?? -1;
      expect(server).toBeDefined();
      const started = recorded.execs.filter(
        (e) =>
          e.pid !== shellPid &&
          descends(recorded, e.pid, shellPid) &&
          !descends(recorded, e.pid, server?.pid ?? -1),
      );
      const engine = /\/webkit2gtk-4\.1\/WebKit(?:Web|Network|GPU)Process$/;
      expect(started.filter((e) => !engine.test(e.program))).toEqual([]);
      const opened = recorded.opens.filter(
        (o) => o.path.startsWith(ws.root) && !descends(recorded, o.pid, server?.pid ?? -1),
      );
      expect(opened).toEqual([]);
    }, 90_000);

    it("[SR-252/AK-wfx8] showing pages and an element with a remote image and raw HTML connects to no other machine", async () => {
      const ws = await workspace();
      const shell = await startShell({ record: true });
      await shell.shown();
      await showElement(shell, ws);
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      shell.send({ close: true });
      expect((await shell.exited).code).toBe(0);
      const recorded = await readTrace(shell.trace ?? "");
      expect(recorded.connections.length).toBeGreaterThan(0);
      expect(recorded.connections.filter((c) => !loopback(c.address)).map((c) => c.line)).toEqual([]);
    }, 90_000);
  },
);

const windowsRecording = windows ? recordingMode() : "skip";

// On Windows one recorded run of the shell serves the tests of AK2, AK6 and AK7, each reading the same record: it
// reads, shows and changes elements, shows the remote image and raw HTML, and logs the token in the page.
describe.skipIf(windowsRecording === "skip")(
  "SR-252: what the desktop shell starts, opens, writes and connects to (event log, ETW and firewall, Windows)",
  () => {
    let recorder: WindowsRecorder | undefined;
    let ws: FixtureWorkspace | undefined;
    let record: WindowsRecord;
    let token = "";
    let shellOut = { stdout: "", stderr: "" };
    let control = "";
    let port = -1;

    beforeAll(async () => {
      if (windowsRecording === "fail") {
        throw new Error(
          "The recording on Windows is not set up (REQSEQ_SHELL_E2E_RECORD=windows is missing); in CI the step " +
            "`Shell - recorders (Windows)` sets it, and without it these tests fail instead of skipping.",
        );
      }
      recorder = await WindowsRecorder.start();
      ws = await newWorkspace();
      control = await recorder.runControl();
      const shell = await startShell({ node: recorder.node });
      // Up to the shell's own 30 s wait for the server's address, plus its start under the trace.
      port = Number(new URL(String(await shell.event("shown", () => true, 60_000))).port);
      token = await pageToken(shell);
      await shell.eval(
        "(() => { console.log(location.href, sessionStorage.getItem('reqseq.token')); return true; })()",
      );
      await showElement(shell, ws);
      await changeElement(shell, ws);
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      shell.send({ close: true });
      expect((await shell.exited).code).toBe(0);
      shellOut = { stdout: shell.stdout, stderr: shell.stderr };
      record = await recorder.stop(shell.child.pid ?? -1);
    }, 300_000);

    afterAll(async () => {
      await recorder?.cleanup();
      await ws?.cleanup();
    });

    /**
     * The record is complete and can find what it looks for: the trace lost nothing, the control process and the shell
     * are in the process events, the server opened the workspace file and the engine wrote to its data folder.
     */
    function expectControls(): void {
      expect([record.lost.buffersLost, record.lost.eventsLost]).toEqual([0, 0]);
      expect(record.lost.eventsProcessed).toBeGreaterThan(0);
      expect(record.control.started).toBe(true);
      expect(record.processes.find((p) => p.pid === record.shellPid)?.normalized).toBe(
        record.normalize(SHELL),
      );
      expect(record.serverPid).toBeDefined();
      // The engine's browser process starts the renderer: the tree reaches the engine's own descendants.
      expect(record.processes.some((p) => !p.server && p.commandLine.includes("--type=renderer"))).toBe(true);
      const root = record.normalize(ws?.root ?? "");
      const workspaceFile = `${root}\\reqseq-workspace.yaml`;
      const serverOpens = record.opens.filter(
        (o) => o.path === workspaceFile && record.processes.some((p) => p.pid === o.pid && p.server),
      );
      expect(serverOpens.length).toBeGreaterThan(0);
      // A Write event, named through its file object or file key, not only a Create that may write.
      const engineWrites = record.writes.filter(
        (w) =>
          w.write &&
          inside(w.path, record.engineData) &&
          record.processes.some((p) => p.pid === w.pid && !p.server && record.engines.includes(p.normalized)),
      );
      expect(engineWrites.length).toBeGreaterThan(0);
    }

    it("[SR-252/AK-nhyc] the token is in no argument, no output of the shell and no file it writes (Windows)", async ({
      annotate,
    }) => {
      expectControls();
      expect(shellOut.stdout).not.toContain(token);
      expect(shellOut.stderr).not.toContain(token);
      expect(record.processes.length).toBeGreaterThan(2);
      expect(
        record.processes
          .filter((p) => p.commandLine.includes(token) || p.program.includes(token))
          .map((p) => p.program),
      ).toEqual([]);
      // Every file a process of the tree other than the server wrote or created, the engine's data folder excepted
      // (SR-252 AK2). Paths the trace names by a device other than a drive (pipes, the console) are no files, and the
      // metadata files at the root of a volume (`$Mft`, `$LogFile`) are the file system's own.
      const server = new Set(record.processes.filter((p) => p.server).map((p) => p.pid));
      const written = [
        ...new Set(
          record.writes
            .filter(
              (w) =>
                !server.has(w.pid) &&
                w.path !== undefined &&
                !/^[a-z]:\\\$[^\\]+$/.test(w.path) &&
                !inside(w.path, record.engineData),
            )
            .map((w) => w.path ?? ""),
        ),
      ];
      // The tree may write no file outside the engine's data folder; the control is that the read-back finds the
      // token in a file that holds it, as UTF-8 and as UTF-16.
      const probe = path.join(ws?.root ?? "", "token-control");
      for (const encoding of ["utf8", "utf16le"] as const) {
        await fs.writeFile(probe, `x${token}x`, encoding);
        expect([encoding, await holds(probe, token)]).toEqual([encoding, true]);
      }
      await fs.rm(probe);
      const holding: string[] = [];
      const unreadable: string[] = [];
      for (const file of written) {
        const found = await holds(file, token);
        if (found === true) {
          holding.push(file);
        } else if (found === undefined) {
          unreadable.push(file);
        }
      }
      // A write the trace gives no name for (its file object was created before the trace started) cannot be read
      // back; the test names how many there were (verification/SR-252.md, gaps of the Windows recording).
      const unnamed = record.writes
        .filter((w) => !server.has(w.pid) && w.unnamed)
        .map((w) => `${String(w.pid)} ${w.raw}`);
      await annotate(
        `${String(record.processes.length)} processes, ${String(written.length)} written files checked, ` +
          `${String(unnamed.length)} writes the trace names no file for${unnamed.length > 0 ? `: ${unnamed.join(", ")}` : ""}`,
      );
      expect({ holding, unreadable }).toEqual({ holding: [], unreadable: [] });
    }, 120_000);

    it("[SR-252/AK-cg77] reading and changing elements starts only the server and the engine and opens no workspace file (Windows)", () => {
      expectControls();
      const started = record.processes.filter((p) => p.pid !== record.shellPid && !p.server);
      expect(started.length).toBeGreaterThan(0);
      expect(
        started
          .filter((p) => !record.engines.includes(p.normalized))
          .map((p) => `${p.program} ${p.commandLine}`),
      ).toEqual([]);
      const root = record.normalize(ws?.root ?? "");
      const server = new Set(record.processes.filter((p) => p.server).map((p) => p.pid));
      expect(
        record.opens.filter((o) => !server.has(o.pid) && inside(o.path, root)).map((o) => o.raw),
      ).toEqual([]);
    });

    // A name lookup counts as a connection to another machine (#2480), also one the engine makes by itself. Lookups go
    // through the DNS client service, which no program rule refuses, so the DNS client log records them. The program
    // rules refuse the shell, the server's Node copy and the engine; a connection of any other program of the tree
    // (a child of the server) is recorded as permitted (5156).
    it("[SR-252/AK-wfx8] showing pages and an element with a remote image and raw HTML connects to no other machine and looks up no name (Windows)", () => {
      expect(control).toBe("error EACCES");
      expect(record.control.refused).toEqual([
        { application: record.normalize(recorder?.node ?? ""), address: CONTROL_ADDRESS },
      ]);
      expect(record.control.lookedUp).toBe(true);
      const engines = [
        ...new Set(
          record.processes.filter((p) => !p.server && p.pid !== record.shellPid).map((p) => p.normalized),
        ),
      ];
      expect(engines.length).toBeGreaterThan(0);
      expect(engines.filter((e) => !record.rules.includes(e))).toEqual([]);
      expect(record.rules).toContain(record.normalize(recorder?.node ?? ""));
      expect(record.rules).toContain(record.normalize(SHELL));
      // Permitted connections of every process of the tree, the server's subtree included: the engine's own to its
      // server shows that the record attributes them.
      expect(
        record.connections.some(
          (c) =>
            c.address === "127.0.0.1" &&
            c.port === port &&
            record.processes.some(
              (p) => p.pid === c.pid && !p.server && record.engines.includes(p.normalized),
            ),
        ),
      ).toBe(true);
      expect({
        refused: record.refused,
        connections: record.connections.filter((c) => !loopback(c.source) || !loopback(c.address)),
        lookups: record.lookups,
      }).toEqual({ refused: [], connections: [], lookups: [] });
    });
  },
);

const macRecording = process.platform === "darwin" ? macRecordingMode() : "skip";

// On macOS one recorded run of the shell serves the tests of AK2, AK6 and AK7, each reading the same record, as on
// Windows. The shell and its server run in the test group, whose connections pf refuses; the engine's processes do
// not (launchd starts them), so their packets are recorded and any one off loopback fails the test (#2479).
describe.skipIf(macRecording === "skip")(
  "SR-252: what the desktop shell starts, opens, writes and connects to (eslogger, pktap and pf, macOS)",
  () => {
    let recorder: MacRecorder | undefined;
    let ws: FixtureWorkspace | undefined;
    let root = "";
    let record: MacRecord;
    let token = "";
    let shellOut = { stdout: "", stderr: "" };
    let port = -1;

    beforeAll(async () => {
      if (macRecording === "fail") {
        throw new Error(
          "The recording on macOS is not set up (REQSEQ_SHELL_E2E_RECORD=macos is missing); in CI the step " +
            "`Shell - recorders (macOS)` sets it, and without it these tests fail instead of skipping.",
        );
      }
      recorder = await MacRecorder.start();
      ws = await newWorkspace();
      // The record names real paths: the temporary folder is under /private/var on macOS.
      root = await fs.realpath(ws.root);
      await recorder.runControls();
      const shell = await startShell({ node: recorder.node, wrap: recorder.wrap });
      port = Number(new URL(String(await shell.event("shown", () => true, 60_000))).port);
      token = await pageToken(shell);
      await shell.eval(
        "(() => { console.log(location.href, sessionStorage.getItem('reqseq.token')); return true; })()",
      );
      await showElement(shell, ws);
      await changeElement(shell, ws);
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      shell.send({ close: true });
      expect((await shell.exited).code).toBe(0);
      shellOut = { stdout: shell.stdout, stderr: shell.stderr };
      record = await recorder.stop(shell.child.pid ?? -1);
    }, 300_000);

    afterAll(async () => {
      await recorder?.cleanup();
      await ws?.cleanup();
    });

    const serverPids = (): Set<number> => new Set(record.processes.filter((p) => p.server).map((p) => p.pid));
    const enginePids = (): Set<number> => new Set(record.engine.map((p) => p.pid));

    /**
     * The record is complete and can find what it looks for: Endpoint Security dropped no event, the stream reaches
     * the shell's exit and a marker after it, the controls are in it, the server opened the workspace file and the
     * engine's processes are in it and wrote a file.
     */
    function expectControls(): void {
      expect(record.events).toBeGreaterThan(0);
      expect(record.missing).toEqual({
        global: 0,
        byKind: Object.fromEntries(Object.keys(record.missing.byKind).map((k) => [k, 0])),
      });
      expect([record.shellExit, record.marker, record.control.started]).toEqual([true, true, true]);
      expect(record.shellPid).toBeDefined();
      expect(serverPids().size).toBeGreaterThan(0);
      expect(record.engine.some((p) => p.program.endsWith("/com.apple.WebKit.WebContent"))).toBe(true);
      expect(record.engine.some((p) => p.program.endsWith("/com.apple.WebKit.Networking"))).toBe(true);
      const workspaceFile = path.join(root, "reqseq-workspace.yaml");
      expect(record.serverFiles.some((f) => f.kind === "open" && f.path === workspaceFile)).toBe(true);
      const engine = enginePids();
      expect(record.files.some((f) => f.write === true && engine.has(f.pid))).toBe(true);
    }

    it("[SR-252/AK-nhyc] the token is in no argument, no output of the shell and no file it writes (macOS)", async ({
      annotate,
    }) => {
      expectControls();
      expect(shellOut.stdout).not.toContain(token);
      expect(shellOut.stderr).not.toContain(token);
      // The arguments of every program the tree ran and of every engine process; the exec of each engine process is
      // in the stream (xpcproxy runs it).
      expect(
        record.engine.filter((p) => p.args === undefined).map((p) => `${String(p.pid)} ${p.program}`),
      ).toEqual([]);
      const argv = [
        ...record.processes.flatMap((p) => p.programs.map((r) => [r.program, ...r.args].join(" "))),
        ...record.engine.map((p) => [p.program, ...(p.args ?? [])].join(" ")),
      ];
      expect(argv.length).toBeGreaterThan(2);
      expect(argv.filter((a) => a.includes(token))).toEqual([]);
      // Every file a process of the tree other than the server, or of the engine, created, renamed to or opened for
      // writing; devices are no files.
      const written = [
        ...new Set(
          record.files
            .filter((f) => f.write === true && f.path !== undefined && !f.path.startsWith("/dev/"))
            .map((f) => f.path ?? ""),
        ),
      ];
      const probe = path.join(root, "token-control");
      for (const encoding of ["utf8", "utf16le"] as const) {
        await fs.writeFile(probe, `x${token}x`, encoding);
        expect([encoding, await holds(probe, token)]).toEqual([encoding, true]);
      }
      await fs.rm(probe);
      const holding: string[] = [];
      const unreadable: string[] = [];
      for (const file of written) {
        const found = await holds(file, token);
        if (found === true) {
          holding.push(file);
        } else if (found === undefined) {
          unreadable.push(file);
        }
      }
      await annotate(
        `${String(record.processes.length)} processes in the tree, ${String(record.engine.length)} engine processes, ` +
          `${String(written.length)} written files checked: ${written.join(", ")}`,
      );
      expect({ holding, unreadable }).toEqual({ holding: [], unreadable: [] });
    }, 120_000);

    it("[SR-252/AK-cg77] reading and changing elements starts only the server and the engine and opens no workspace file (macOS)", async ({
      annotate,
    }) => {
      await annotate(
        `${String(record.events)} events; tree: ${record.processes.map((p) => `${String(p.pid)}${p.server ? " (server)" : ""} ${p.programs.map((r) => path.basename(r.program)).join(" > ")}`).join("; ")}; ` +
          `engine: ${record.engine.map((p) => `${String(p.pid)} ${path.basename(p.program)}`).join(", ")}; ` +
          `${String(record.files.length)} file events of the tree outside the server and of the engine`,
      );
      expectControls();
      // A process of the tree outside the server runs no program but the shell itself (a fork) and the engine's.
      const started = record.processes
        .filter((p) => p.pid !== record.shellPid && !p.server)
        .flatMap((p) => p.programs.filter((r) => r.program !== SHELL && !isEngine(r.program)))
        .map((r) => [r.program, ...r.args].join(" "));
      expect(started).toEqual([]);
      expect(
        record.files
          .filter((f) => f.path !== undefined && (f.path === root || f.path.startsWith(`${root}/`)))
          .map((f) => `${String(f.pid)} ${f.kind} ${f.path ?? ""}`),
      ).toEqual([]);
    });

    // pf refuses every connection of the shell and the server off loopback and counts it; pktap records every packet
    // with its process and, for a lookup through mDNSResponder, the process that asked. The test fails on a refused
    // packet of the test group after the controls and on any packet of the tree or the engine off loopback.
    it("[SR-252/AK-wfx8] showing pages and an element with a remote image and raw HTML connects to no other machine and looks up no name (macOS)", async ({
      annotate,
    }) => {
      await annotate(
        `${String(record.packets.length)} packets of the tree and the engine; pf counters after the controls ` +
          `${record.counters.control.join("/")}, at the end ${record.counters.end.join("/")}`,
      );
      expect(record.control.outside).toBe("timeout");
      expect(record.control.inside).toBe("error ECONNREFUSED");
      expect({
        packet: record.control.packet,
        lookedUp: record.control.lookedUp,
        reset: record.control.reset,
      }).toEqual({ packet: true, lookedUp: true, reset: true });
      expect(record.rules).toMatch(
        /block return out log quick inet from any to ! 127\.0\.0\.0\/8 group = \d+/,
      );
      expect(record.rules).toMatch(/block return out log quick inet6 from any to ! ::1 group = \d+/);
      expect(record.counters.control[0]).toBeGreaterThan(0);
      expect(record.dropped).toBe(0);
      // The engine's own packets to its server: the record attributes the engine's traffic.
      const engine = enginePids();
      expect(
        record.packets.some(
          (p) =>
            onLoopback(p) && p.pids.some((pid) => engine.has(pid)) && p.line.includes(`.${String(port)}`),
        ),
      ).toBe(true);
      expect({
        refused: record.counters.end,
        packets: record.packets.filter((p) => !onLoopback(p)).map((p) => p.line),
      }).toEqual({ refused: record.counters.control, packets: [] });
    });
  },
);

describe.runIf(windows)("SR-252: a window that cannot open (Windows)", () => {
  it("[SR-252/AK-ts68] with an empty WebView2 runtime folder the shell ends with 1, names the reason in English, and no server runs", async () => {
    // WebView2 takes its runtime from this folder (WEBVIEW2_BROWSER_EXECUTABLE_FOLDER); an empty one is no runtime,
    // and the window cannot open. The hangs with other broken runtimes are #2477.
    const empty = await tempFolder("no-runtime");
    onTestFinished(() => fs.rm(empty, { recursive: true, force: true }));
    const shell = await startShell({ env: { WEBVIEW2_BROWSER_EXECUTABLE_FOLDER: empty } });
    const ended = await Promise.race([
      shell.exited,
      new Promise<undefined>((resolve) => setTimeout(resolve, 30_000, undefined)),
    ]);
    expect(ended).toEqual({ code: 1, signal: null });
    // The reason of the builder error, not the fixed line of the panic hook (which a release build would reach by
    // abort, ADR-0021).
    expect(shell.stderr).toMatch(/^ReqSeq: the window could not open: .*webview runtime/im);
    expect(shell.stderr).not.toMatch(/^ReqSeq: the window could not open\.\s*$/m);
    expect(shell.all("shown")).toEqual([]);
    expect(shell.all("page-load")).toEqual([]);
    expect(await children(shell.child.pid ?? -1)).toEqual([]);
  }, 60_000);
});

/** The processes still running whose parent was `pid`, with their programs and command lines. */
async function children(pid: number): Promise<string[]> {
  const script = `$ErrorActionPreference = 'Stop'; Get-CimInstance Win32_Process -Filter "ParentProcessId = ${String(pid)}" | ForEach-Object { $_.Name + ' ' + $_.CommandLine }`;
  const { stdout } = await promisify(execFile)("powershell.exe", [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    script,
  ]);
  return stdout.split(/\r?\n/).filter((l) => l.trim() !== "");
}

/** A page script that calls the shell's `command` with `args` and keeps the answer in `window.__call[key]`. */
const askShell = (key: string, command: string, args: Record<string, unknown>): string => `(() => {
  window.__call = window.__call || {};
  window.__TAURI_INTERNALS__.invoke(${JSON.stringify(command)}, ${JSON.stringify(args)})
    .then((value) => { window.__call[${JSON.stringify(key)}] = { value: value === undefined ? null : value }; },
      (e) => { window.__call[${JSON.stringify(key)}] = { refused: String(e) }; });
  return true;
})()`;

/** Calls the shell's `command` from the page and waits for its answer. */
async function callShell(
  shell: Shell,
  key: string,
  command: string,
  args: Record<string, unknown> = {},
): Promise<{ value?: unknown; refused?: string }> {
  await shell.eval(askShell(key, command, args));
  return (await shell.evalUntil(
    `the answer for ${key}`,
    `(window.__call || {})[${JSON.stringify(key)}] || null`,
  )) as { value?: unknown; refused?: string };
}

/** Clicks the element `selector` names in the page. */
async function click(shell: Shell, selector: string): Promise<void> {
  await shell.evalUntil(
    `a click on ${selector}`,
    `(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (e === null || e.disabled) return false; e.click(); return true; })()`,
  );
}

describe("SR-253: the desktop shell offers the operating system's dialogs", () => {
  it("[SR-253/AK-hyw0] offers the three dialogs and the opener, refuses every other call, and a dialog gives one absolute path or none", async () => {
    const folder = await tempFolder("pick");
    onTestFinished(() => fs.rm(folder, { recursive: true, force: true }));
    const chosen = path.join(folder, "chosen.reqif");
    const shell = await startShell({ record: linux });
    const origin = await shell.shown();
    await shell.loaded();

    // Each dialog gives the path chosen there; the page's inputs set only where it opens and the proposed name.
    shell.send({ dialog: folder });
    expect(await callShell(shell, "folder", "pick_folder", { start: folder })).toEqual({ value: folder });
    shell.send({ dialog: chosen });
    expect(await callShell(shell, "file", "pick_file", { start: folder, name: "x.reqif" })).toEqual({
      value: chosen,
    });
    shell.send({ dialog: chosen });
    expect(await callShell(shell, "target", "pick_save_target", { start: folder, name: "ws.reqif" })).toEqual(
      { value: chosen },
    );
    shell.send({ dialog: chosen });
    expect(
      await callShell(shell, "inputs", "pick_save_target", {
        start: "relative/folder",
        name: "../../etc/passwd",
        path: "/etc/passwd",
        write: "x",
      }),
    ).toEqual({ value: chosen });
    // Cancelled, a dialog that cannot open, and an answer that is not an absolute path: no path.
    shell.send({ dialog: null });
    expect(await callShell(shell, "cancel", "pick_folder")).toEqual({ value: null });
    expect(await callShell(shell, "no dialog", "pick_file")).toEqual({ value: null });
    shell.send({ dialog: "relative/chosen.reqif" });
    expect(await callShell(shell, "relative", "pick_save_target")).toEqual({ value: null });
    expect(shell.all("dialog")).toEqual([
      { command: "pick_folder", folder, name: null },
      { command: "pick_file", folder, name: null },
      { command: "pick_save_target", folder, name: "ws.reqif" },
      { command: "pick_save_target", folder: null, name: null },
      { command: "pick_folder", folder: null, name: null },
      { command: "pick_file", folder: null, name: null },
      { command: "pick_save_target", folder: null, name: null },
    ]);

    // The fourth function: opening an address (SR-252 AK3), which refuses the own server.
    expect(String((await callShell(shell, "open", "open_address", { address: origin })).refused)).toMatch(
      /Not opened: /,
    );
    // Every other call is refused and runs nothing.
    for (const command of [
      "plugin:dialog|open",
      "plugin:dialog|save",
      "plugin:dialog|message",
      "plugin:opener|open_url",
      "plugin:fs|read_file",
      "plugin:window|close",
      "plugin:webview|create_webview_window",
      "plugin:event|listen",
      "pick_folders",
      "read_file",
    ]) {
      const answer = await callShell(shell, `other ${command}`, command, {
        path: folder,
        url: "https://example.org/",
        options: {},
      });
      // Tauri's access control answers before any code runs.
      expect([command, answer.refused]).toEqual([command, expect.stringMatching(/ not allowed\. /)]);
    }
    expect(shell.all("dialog")).toHaveLength(7);
    expect(await shell.eval("location.origin")).toBe(origin);

    shell.send({ close: true });
    expect((await shell.exited).code).toBe(0);
    if (linux) {
      // The shell itself read, wrote and created no file in the folder of the dialogs.
      const recorded = await readTrace(shell.trace ?? "");
      expect(recorded.opens.filter((o) => o.path.startsWith(folder))).toEqual([]);
      expect(await fs.readdir(folder)).toEqual([]);
    }
  }, 90_000);

  it("[SR-253/AK-d2n7] a chosen target outside the repositories is refused as a typed one, a chosen workspace folder opens, and the command decides on an existing target", async () => {
    const ws = await workspace();
    const outside = await tempFolder("outside");
    onTestFinished(() => fs.rm(outside, { recursive: true, force: true }));
    const shell = await startShell();
    await shell.shown();
    await shell.evalUntil("the token", "sessionStorage.getItem('reqseq.token') !== null");

    // The folder of a workspace to open is the exception of SR-248 AK4: chosen in the dialog, it opens.
    await showRoute(shell, "#/w/open");
    shell.send({ dialog: ws.root });
    await click(shell, 'button[aria-label="Choose… Folder of the workspace"]');
    await shell.evalUntil(
      "the chosen folder in the field",
      `document.querySelector('input[name="open-path"]').value === ${JSON.stringify(ws.root)}`,
    );
    await click(shell, '.frow:has(input[name="open-path"]) > .btn');
    // The page goes to the overview once the workspace is open.
    await shell.evalUntil("the opened workspace", `location.hash === "#/q/overview"`);
    await showRoute(shell, "#/w/export");
    await shell.evalUntil("the export page", `document.querySelector('input[name="reqif-out"]') !== null`);

    /** Exports ReqIF to the path in the field and gives the page's answer. */
    const exportTo = async (how: "chosen" | "typed", target: string): Promise<string> => {
      if (how === "chosen") {
        shell.send({ dialog: target });
        await click(shell, 'button[aria-label="Choose… File"]');
      } else {
        await shell.eval(`(() => {
          const input = document.querySelector('input[name="reqif-out"]');
          input.value = ${JSON.stringify(target)};
          input.dispatchEvent(new Event("input", { bubbles: true }));
          return true;
        })()`);
      }
      await shell.evalUntil(
        `the ${how} target in the field`,
        `document.querySelector('input[name="reqif-out"]').value === ${JSON.stringify(target)}`,
      );
      const out = `.frow:has(input[name="reqif-out"]) + div`;
      await shell.eval(
        `(() => { document.querySelector(${JSON.stringify(out)}).replaceChildren(); return true; })()`,
      );
      await click(shell, `.frow:has(input[name="reqif-out"]) > .btn.primary`);
      return String(
        await shell.evalUntil(
          `the answer for the ${how} target`,
          `document.querySelector(${JSON.stringify(out)}).textContent || null`,
        ),
      );
    };

    const away = path.join(outside, "ws.reqif");
    const chosenAway = await exportTo("chosen", away);
    expect(chosenAway).toBe(await exportTo("typed", away));
    expect(chosenAway).toContain('"reason": "outside-repositories"');
    expect(await fs.readdir(outside)).toEqual([]);

    // Inside the repositories, an existing target: replaced or not as the command decides for a typed path.
    const inside = path.join(ws.root, "exports", "chosen.reqif");
    const first = await exportTo("typed", inside);
    const written = await fs.stat(inside);
    const chosenAgain = await exportTo("chosen", inside);
    expect(chosenAgain).toBe(await exportTo("typed", inside));
    expect([first, chosenAgain]).toEqual([
      expect.stringMatching(/^Exported .*chosen\.reqif/),
      expect.stringMatching(/^Exported .*chosen\.reqif/),
    ]);
    expect(written.isFile()).toBe(true);
    expect(shell.all("dialog").map((d) => (d as { command: string }).command)).toEqual([
      "pick_folder",
      "pick_save_target",
      "pick_save_target",
    ]);
  }, 120_000);
});
