import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { MessagePort } from "node:worker_threads";
import { MessageChannel } from "node:worker_threads";
import { Workspace, createCommandRuntime } from "@logreq/core";
import type { FixtureWorkspace } from "@logreq/testkit";
import { createFixtureWorkspace } from "@logreq/testkit";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { CoreMessage, PortMessage } from "../shared/protocol.js";
import type { MainPort, ParentPort } from "./process.js";
import { channelOfPort, serveCoreProcess } from "./process.js";

const runtime = createCommandRuntime();

/** A Node MessagePort with the events of Electron's MessagePortMain (`{ data }`). */
class ElectronLikePort implements MainPort {
  started = false;
  readonly #port: MessagePort;

  constructor(port: MessagePort) {
    this.#port = port;
  }

  on(
    event: "message" | "close",
    listener: ((event: { readonly data: unknown }) => void) | (() => void),
  ): this {
    if (event === "message") {
      this.#port.on("message", (data: unknown) => {
        listener({ data });
      });
    } else {
      this.#port.on("close", listener);
    }
    return this;
  }

  postMessage(message: unknown): void {
    this.#port.postMessage(message);
  }

  start(): void {
    this.started = true;
  }

  close(): void {
    this.#port.close();
  }
}

class FakeParentPort extends EventEmitter implements ParentPort {
  readonly sent: CoreMessage[] = [];

  postMessage(message: CoreMessage): void {
    this.sent.push(message);
  }

  send(data: unknown, ports: MainPort[] = []): void {
    this.emit("message", { data, ports });
  }
}

/** Waits until `condition` holds (a few seconds at most). */
const waitUntil = async (condition: () => boolean): Promise<void> => {
  const end = Date.now() + 10_000;
  while (!condition()) {
    if (Date.now() > end) {
      throw new Error("condition did not hold");
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
};

let cacheHome = "";
beforeAll(async () => {
  cacheHome = await fs.mkdtemp(path.join(os.tmpdir(), "logreq-cache-home-"));
  for (const name of ["HOME", "USERPROFILE", "XDG_CACHE_HOME", "LOCALAPPDATA"]) {
    vi.stubEnv(name, cacheHome);
  }
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await fs.rm(cacheHome, { recursive: true, force: true });
});

const fixtures: FixtureWorkspace[] = [];
afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((f) => f.cleanup()));
});

const start = (openWorkspace?: (root: string) => Workspace) => {
  const parent = new FakeParentPort();
  const exit = vi.fn<(code: number) => void>();
  const log = vi.fn<(line: string) => void>();
  serveCoreProcess({
    parentPort: parent,
    runtime,
    exit,
    log,
    ...(openWorkspace === undefined ? {} : { openWorkspace }),
  });
  return { parent, exit, log };
};

/** A window's port to the core process, and the messages it receives. */
const windowPort = () => {
  const { port1, port2 } = new MessageChannel();
  const received: PortMessage[] = [];
  port2.on("message", (message: PortMessage) => received.push(message));
  return { core: new ElectronLikePort(port1), window: port2, received };
};

describe("serveCoreProcess", () => {
  it("opens the workspace found upwards from the folder, with the cache of the copy, and serves windows", async () => {
    const fixture = await createFixtureWorkspace({
      fixture: "SR-004/one-repository",
      files: { "images/dot.png": new Uint8Array([1]) },
    });
    fixtures.push(fixture);
    const { parent, exit } = start();
    parent.send({ type: "open", folder: path.join(fixture.root, "requirements") });
    parent.send({ type: "open", folder: os.tmpdir() });
    const { core, window, received } = windowPort();
    parent.send({ type: "connect" }, [core]);
    window.postMessage({ id: 1, kind: "invoke", name: "workspace.status", input: {} });
    await waitUntil(() => received.length === 1);
    expect(core.started).toBe(true);
    expect(received[0]).toMatchObject({ id: 1, result: { ok: true, output: { name: "Weather station" } } });
    expect(parent.sent).toEqual([{ type: "ready", root: fixture.root }]);
    parent.send({ type: "file", id: 5, url: "logreq-file://workspace/system/images/dot.png" });
    await waitUntil(() => parent.sent.length === 2);
    expect(parent.sent[1]).toEqual({
      type: "file",
      id: 5,
      status: 200,
      mimeType: "image/png",
      data: new Uint8Array([1]),
    });
    // The element store loads through the model cache in the cache folder of the copy (ADR-0008).
    window.postMessage({ id: 2, kind: "invoke", name: "element.get", input: { ref: "SR-e88fb3" } });
    await waitUntil(() => received.length === 2);
    expect(received[1]).toMatchObject({ id: 2, result: { ok: true } });
    let cached = 0;
    for (const end = Date.now() + 10_000; cached === 0 && Date.now() < end;) {
      cached = (await fs.readdir(cacheHome, { recursive: true })).length;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(cached).toBeGreaterThan(0);
    let closed = false;
    window.on("close", () => {
      closed = true;
    });
    parent.send({ type: "stop" });
    await waitUntil(() => exit.mock.calls.length === 1 && closed);
  });

  it("opens the folder itself when no workspace lies above it", async () => {
    const folder = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "logreq-no-workspace-")));
    try {
      const opened: string[] = [];
      const { parent, exit } = start((root) => {
        opened.push(root);
        return new Workspace(root);
      });
      parent.send({ type: "open", folder });
      await waitUntil(() => parent.sent.length === 1);
      expect(parent.sent).toEqual([{ type: "ready", root: folder }]);
      expect(opened).toEqual([folder]);
      parent.send({ type: "stop" });
      await waitUntil(() => exit.mock.calls.length === 1);
    } finally {
      await fs.rm(folder, { recursive: true, force: true });
    }
  });

  it("before open: closes ports, finds no files, and ends on stop", async () => {
    const { parent, exit } = start();
    const { core, window } = windowPort();
    let closed = false;
    window.on("close", () => {
      closed = true;
    });
    parent.send({ type: "connect" }, [core]);
    parent.send({ type: "file", id: 1, url: "logreq-file://workspace/system/a.png" });
    parent.send({ type: "nonsense" });
    parent.send({ type: "stop" });
    await waitUntil(() => closed && exit.mock.calls.length === 1 && parent.sent.length === 1);
    expect(parent.sent).toEqual([{ type: "file", id: 1, status: 404 }]);
  });

  it("ends on stop even when the workspace fails to close", async () => {
    const folder = await fs.mkdtemp(path.join(os.tmpdir(), "logreq-failing-close-"));
    try {
      const { parent, exit } = start((root) => {
        const workspace = new Workspace(root);
        workspace.close = () => Promise.reject(new Error("dispose failed"));
        return workspace;
      });
      parent.send({ type: "open", folder });
      parent.send({ type: "stop" });
      await waitUntil(() => exit.mock.calls.length === 1);
    } finally {
      await fs.rm(folder, { recursive: true, force: true });
    }
  });
});

describe("serveCoreProcess: a workspace that cannot be opened", () => {
  it("logs it and ends the process with 1; ports close, files are not found, stop still ends", async () => {
    const { parent, exit, log } = start(() => {
      throw new Error("EACCES: permission denied");
    });
    parent.send({ type: "open", folder: os.tmpdir() });
    await waitUntil(() => exit.mock.calls.length === 1);
    expect(exit).toHaveBeenCalledWith(1);
    expect(log).toHaveBeenCalledWith(
      "The core process could not open the workspace: EACCES: permission denied",
    );
    const { core, window } = windowPort();
    let closed = false;
    window.on("close", () => {
      closed = true;
    });
    parent.send({ type: "connect" }, [core]);
    parent.send({ type: "file", id: 3, url: "logreq-file://workspace/system/a.png" });
    parent.send({ type: "stop" });
    await waitUntil(() => closed && parent.sent.length === 1 && exit.mock.calls.length === 2);
    expect(parent.sent).toEqual([{ type: "file", id: 3, status: 404 }]);
    expect(exit.mock.calls).toEqual([[1], [0]]);
  });

  it("logs what is no Error as it is", async () => {
    const { parent, exit, log } = start(() => {
      // Something that is no Error object, as a dependency might throw.
      throw "odd" as unknown as Error;
    });
    parent.send({ type: "open", folder: os.tmpdir() });
    await waitUntil(() => exit.mock.calls.length === 1);
    expect(log).toHaveBeenCalledWith("The core process could not open the workspace: odd");
  });
});

describe("channelOfPort", () => {
  it("closes the port", async () => {
    const { core, window } = windowPort();
    let closed = false;
    window.on("close", () => {
      closed = true;
    });
    channelOfPort(core).close();
    await waitUntil(() => closed);
  });
});
