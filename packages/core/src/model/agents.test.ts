import type * as FsPromises from "node:fs/promises";
import dgram from "node:dgram";
import fs from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import tls from "node:tls";
import type { FixtureWorkspace } from "@reqseq/testkit";
import { createFixtureWorkspace } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import type { AgentConnectionFile } from "../generated/types.js";
import { invoke } from "../runtime/invoke.js";
import { Workspace } from "../runtime/workspace.js";
import * as WorkspaceBlock from "../workspace/index.js";
import * as ModelCache from "./model-cache.js";
import type { AgentRecording } from "./agents.js";
import {
  AGENT_LIVE_MS,
  AGENT_MAX_FILES,
  CLIENT_MAX_CHARACTERS,
  agentConnections,
  clientName,
  recordAgentConnection,
} from "./agents.js";
import { elementStoreState } from "./store.js";

// The real functions, wrapped so that a test can make a look at the cache folder fail.
vi.mock("node:fs/promises", async (importOriginal) => {
  const original = await importOriginal<typeof FsPromises>();
  const wrapped = { ...original, stat: vi.fn(original.stat), readdir: vi.fn(original.readdir) };
  return { ...wrapped, default: wrapped };
});
// The real block, with `removeCacheFile` wrapped so that a test can make a removal fail.
vi.mock("../workspace/index.js", async (importOriginal) => {
  const original = await importOriginal<typeof WorkspaceBlock>();
  return { ...original, removeCacheFile: vi.fn(original.removeCacheFile) };
});
const actual = await vi.importActual<typeof FsPromises>("node:fs/promises");
const { removeCacheFile: actualRemove } =
  await vi.importActual<typeof WorkspaceBlock>("../workspace/index.js");

// The real module, with `loadThroughCache` wrapped so that a test can hold the load of the element
// store back (SR-228 AK5).
vi.mock("./model-cache.js", async (importOriginal) => {
  const original = await importOriginal<typeof ModelCache>();
  return { ...original, loadThroughCache: vi.fn(original.loadThroughCache) };
});

const tempFolder = async (): Promise<string> => {
  const folder = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "reqseq-agents-")));
  onTestFinished(() => fs.rm(folder, { recursive: true, force: true, maxRetries: 3 }));
  return folder;
};

const fixture = async (): Promise<FixtureWorkspace> => {
  const created = await createFixtureWorkspace({ fixture: "SR-004/one-repository" });
  onTestFinished(() => created.cleanup());
  return created;
};

const open = (root: string, cacheFolder: string | undefined): Workspace => {
  const workspace = new Workspace(root, cacheFolder === undefined ? {} : { cacheFolder });
  onTestFinished(() => workspace.close());
  return workspace;
};

const NOW = Date.UTC(2026, 10, 18, 10, 0, 0);

/** Writes the connection file of `process` into `folder`, with its modification time `mtime` (ms). */
const place = async (
  folder: string,
  file: Partial<AgentConnectionFile> & { readonly process: string },
  mtime: number,
  name = `agent-${file.process}.json`,
): Promise<string> => {
  const full: AgentConnectionFile = {
    version: 1,
    client: "agent",
    since: new Date(NOW - 60_000).toISOString(),
    ended: null,
    ...file,
  };
  const target = path.join(folder, name);
  await fs.writeFile(target, JSON.stringify(full));
  await fs.utimes(target, new Date(mtime), new Date(mtime));
  return target;
};

const agentFiles = async (folder: string): Promise<string[]> =>
  (await fs.readdir(folder)).filter((name) => name.startsWith("agent-")).sort();

const readConnectionFile = async (folder: string): Promise<AgentConnectionFile> => {
  const [name] = await agentFiles(folder);
  return JSON.parse(await fs.readFile(path.join(folder, name ?? ""), "utf8")) as AgentConnectionFile;
};

/** Resolves once `check` holds, polling every 10 ms (at most 10 s). */
const until = async (check: () => Promise<boolean>): Promise<void> => {
  for (let tries = 0; tries < 1000; tries += 1) {
    if (await check()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("condition not met in time");
};

const recordWith = (workspace: Workspace, client: unknown, beatMs = 20): AgentRecording => {
  const recording = recordAgentConnection(workspace, client, { beatMs });
  onTestFinished(() => recording.end());
  return recording;
};

describe("clientName", () => {
  it("keeps a name as text: without control and format characters, trimmed, at most 40 characters", () => {
    expect(clientName(`  Claude\u0000 Code${String.fromCodePoint(0x200b, 0x202e)}\n `)).toBe("Claude Code");
    // Line breaks and tabs are white space: one space each run.
    expect(clientName("Claude\nCode")).toBe("Claude Code");
    expect(clientName("a\t\r\n b\u2028c\u0000 \u0007 d")).toBe("a b c d");
    expect(clientName(42)).toBeNull();
    expect(clientName(undefined)).toBeNull();
    expect(clientName(" \u0007 ")).toBeNull();
    const long = "a".repeat(CLIENT_MAX_CHARACTERS + 5);
    expect(clientName(long)).toBe("a".repeat(CLIENT_MAX_CHARACTERS));
    // A family emoji is one character of several code points; a cut never splits it.
    const family = "\u{1f468}‍\u{1f469}‍\u{1f467}";
    expect(clientName(`${"b".repeat(CLIENT_MAX_CHARACTERS - 1)}${family}tail`)).toBe(
      `${"b".repeat(CLIENT_MAX_CHARACTERS - 1)}${family}`,
    );
    // 40 characters of many combining marks each are cut further, at a character, so the file stays small.
    const heavy = `x${"\u0301".repeat(30)}`;
    expect(clientName(heavy.repeat(CLIENT_MAX_CHARACTERS))).toBe(heavy.repeat(12));
    // A cut that ends before a space gives no trailing space.
    expect(clientName(`${"c".repeat(CLIENT_MAX_CHARACTERS - 1)} d`)).toBe(
      "c".repeat(CLIENT_MAX_CHARACTERS - 1),
    );
  });
});

describe("agentConnections", () => {
  it("[SR-228/AK-wkj0] gives nothing recorded without a usable cache folder, or one that cannot be read", async () => {
    expect(await agentConnections(undefined)).toEqual({ recorded: false, connected: [], last: null });
    const top = await tempFolder();
    const file = path.join(top, "file");
    await fs.writeFile(file, "");
    expect(await agentConnections(file)).toEqual({ recorded: false, connected: [], last: null });
    // A missing folder knows no connection: recorded, but none (SR-228 AK3).
    expect(await agentConnections(path.join(top, "missing"))).toEqual({
      recorded: true,
      connected: [],
      last: null,
    });
  });

  it("gives the live connections, the first connected first, and the one that ended last", async () => {
    const folder = await tempFolder();
    const since = (minutes: number): string => new Date(NOW - minutes * 60_000).toISOString();
    await place(folder, { process: "1-0000000a", client: "late", since: since(1) }, NOW - 500);
    await place(folder, { process: "2-0000000b", client: "early", since: since(5) }, NOW);
    // The same start: the file name decides.
    await place(folder, { process: "3-0000000c", client: "same", since: since(5) }, NOW + 1000);
    // Ended cleanly 2 minutes ago, though its file is newer.
    await place(folder, { process: "4-0000000d", client: "ended", ended: since(2) }, NOW);
    // Crashed: no `ended`, its last beat 10 s ago.
    await place(folder, { process: "5-0000000e", client: "crashed" }, NOW - 10_000);
    // Ended long ago.
    await place(folder, { process: "6-0000000f", client: "old", ended: since(30) }, NOW - 30 * 60_000);
    const found = await agentConnections(folder, NOW);
    expect(found).toEqual({
      recorded: true,
      connected: [
        { client: "early", since: since(5), until: NOW + AGENT_LIVE_MS },
        { client: "same", since: since(5), until: NOW + 1000 + AGENT_LIVE_MS },
        { client: "late", since: since(1), until: NOW - 500 + AGENT_LIVE_MS },
      ],
      last: { client: "crashed", at: new Date(NOW - 10_000).toISOString() },
    });
    // A beat older than AGENT_LIVE_MS ends a connection; the clock going back does not keep it.
    const later = await agentConnections(folder, NOW + AGENT_LIVE_MS + 1);
    expect(later.connected.map((c) => c.client)).toEqual(["same"]);
    expect(later.last).toEqual({ client: "early", at: new Date(NOW).toISOString() });
    const earlier = await agentConnections(folder, NOW - AGENT_LIVE_MS - 1);
    expect(earlier.connected.map((c) => c.client)).toEqual(["late"]);
  });

  it("skips what is not a connection file of ReqSeq, and cuts a long name when it reads it", async () => {
    const folder = await tempFolder();
    await place(folder, { process: "1-0000000a", client: "n".repeat(50) }, NOW);
    // Other names: a temp file, a name that differs from its process, another cache file.
    await place(folder, { process: "2-0000000b" }, NOW, ".agent-2-0000000b.json.0a0b0c0d.reqseq-tmp");
    await place(folder, { process: "3-0000000c" }, NOW, "agent-9-0000000c.json");
    await place(folder, { process: "4-0000000d" }, NOW, "activity.json");
    // Broken, invalid and too large files; a folder with a matching name.
    await fs.writeFile(path.join(folder, "agent-5-0000000e.json"), "{");
    await fs.writeFile(path.join(folder, "agent-6-0000000f.json"), JSON.stringify({ version: 2 }));
    await place(folder, { process: "7-00000010", client: "x".repeat(5000) }, NOW);
    await fs.mkdir(path.join(folder, "agent-8-00000011.json"));
    const found = await agentConnections(folder, NOW);
    expect(found).toEqual({
      recorded: true,
      connected: [
        {
          client: "n".repeat(CLIENT_MAX_CHARACTERS),
          since: expect.any(String) as unknown,
          until: NOW + AGENT_LIVE_MS,
        },
      ],
      last: null,
    });
  });

  it(`reads only the ${String(AGENT_MAX_FILES)} newest files`, async () => {
    const folder = await tempFolder();
    for (let i = 0; i < AGENT_MAX_FILES; i += 1) {
      const hex = i.toString(16).padStart(8, "0");
      await place(folder, { process: `1-${hex}`, ended: new Date(NOW - 1000).toISOString() }, NOW - 1000);
    }
    // The oldest file is live by its content but is not read.
    await place(folder, { process: "2-ffffffff", client: "oldest" }, NOW - 60_000);
    const found = await agentConnections(folder, NOW - 60_000);
    expect(found.connected).toEqual([]);
  });

  it("skips a file that is gone between the listing and the read", async () => {
    const folder = await tempFolder();
    await place(folder, { process: "1-0000000a" }, NOW);
    await place(folder, { process: "2-0000000b", client: "kept" }, NOW);
    vi.mocked(fs.stat).mockImplementation(((file: string, ...rest: never[]) =>
      file.includes("1-0000000a")
        ? Promise.reject(Object.assign(new Error("gone"), { code: "ENOENT" }))
        : actual.stat(file, ...rest)) as typeof fs.stat);
    onTestFinished(() => {
      vi.mocked(fs.stat).mockImplementation(actual.stat);
    });
    const found = await agentConnections(folder, NOW);
    expect(found.connected).toHaveLength(1);
  });
});

describe("recordAgentConnection", () => {
  it("[SR-228/AK-dymn] writes only into the cache folder of the copy and does not wait for the element store", async () => {
    // No port and no other connection (SR-079 AK1): the beat thread only touches the file (agent-beat.ts).
    const spies = [
      vi.spyOn(net.Socket.prototype, "connect"),
      vi.spyOn(net.Server.prototype, "listen"),
      vi.spyOn(dgram, "createSocket"),
      vi.spyOn(http, "request"),
      vi.spyOn(https, "request"),
      vi.spyOn(tls, "connect"),
    ];
    onTestFinished(() => {
      for (const spy of spies) {
        spy.mockRestore();
      }
    });
    const workspace = open((await fixture()).root, await tempFolder());
    const cache = workspace.cacheFolder ?? "";
    // The element store does not load until released.
    let release = (): void => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const load = vi.mocked(ModelCache.loadThroughCache);
    load.mockImplementationOnce(async (...args) => {
      await held;
      return (await vi.importActual<typeof ModelCache>("./model-cache.js")).loadThroughCache(...args);
    });
    const loading = workspace.get(elementStoreState);
    const before = await fs.readdir(workspace.root, { recursive: true });
    const started = Date.now();
    const recording = recordAgentConnection(workspace, "Claude Code");
    await until(async () => (await agentFiles(cache)).length === 1);
    expect(Date.now() - started).toBeLessThan(1000);
    const file = await readConnectionFile(cache);
    expect(file).toEqual({
      version: 1,
      process: expect.stringMatching(new RegExp(`^${String(process.pid)}-[0-9a-f]{8}$`)) as unknown,
      client: "Claude Code",
      since: expect.any(String) as unknown,
      ended: null,
    });
    expect(Math.abs(Date.parse(file.since) - started)).toBeLessThan(1000);
    expect(await fs.readdir(cache)).toEqual([`agent-${file.process}.json`]);
    expect(await fs.readdir(workspace.root, { recursive: true })).toEqual(before);
    release();
    await loading;
    await recording.end();
    expect((await readConnectionFile(cache)).ended).toEqual(expect.any(String));
    expect(spies.map((spy) => spy.mock.calls.length)).toEqual([0, 0, 0, 0, 0, 0]);
  });

  it("[SR-228/AK-wkj0] records nothing without a usable cache folder", async () => {
    const root = (await fixture()).root;
    const inside = path.join(root, "requirements", ".cache");
    const recording = recordAgentConnection(open(root, inside), "agent");
    await recording.end();
    await expect(fs.stat(inside)).rejects.toThrow();
    await recordAgentConnection(open(root, undefined), "agent").end();
    // A closed workspace and a folder without a workspace file record nothing either.
    const closed = new Workspace(root, { cacheFolder: await tempFolder() });
    await closed.close();
    await recordAgentConnection(closed, "agent").end();
    const empty = await tempFolder();
    const cache = await tempFolder();
    await recordAgentConnection(open(empty, cache), "agent").end();
    expect(await fs.readdir(cache)).toEqual([]);
  });

  it("renews the file while it runs, writes it again when it is gone, and ends with the workspace", async () => {
    const cache = await tempFolder();
    const workspace = new Workspace((await fixture()).root, { cacheFolder: cache });
    recordWith(workspace, { not: "a name" });
    await until(async () => (await agentFiles(cache)).length === 1);
    const [name = ""] = await agentFiles(cache);
    const file = path.join(cache, name);
    const old = new Date(NOW - 60_000);
    await fs.utimes(file, old, old);
    await until(async () => (await fs.stat(file)).mtimeMs > old.getTime());
    const connected = await agentConnections(cache);
    expect(connected.connected).toEqual([
      { client: null, since: expect.any(String) as unknown, until: expect.any(Number) as unknown },
    ]);
    // The cache is safe to remove (ADR-0008): the beat writes the file again.
    await fs.rm(cache, { recursive: true });
    await until(async () => (await agentFiles(cache).catch(() => [])).length === 1);
    await workspace.close();
    const ended = await agentConnections(cache);
    expect(ended).toEqual({
      recorded: true,
      connected: [],
      last: { client: null, at: expect.any(String) as unknown },
    });
  });

  it("removes the files that no longer count when it starts, and ends once however often it is ended", async () => {
    const cache = await tempFolder();
    const now = Date.now();
    await place(cache, { process: "1-0000000a", ended: new Date(now - 60_000).toISOString() }, now - 60_000);
    await place(cache, { process: "2-0000000b", ended: new Date(now - 1000).toISOString() }, now - 1000);
    await place(cache, { process: "3-0000000c" }, now - 120_000);
    await place(cache, { process: "4-0000000d", client: "live" }, now + 2000);
    await place(cache, { process: "5-0000000e" }, now - 120_000);
    // A file that cannot be removed stays; the others still go.
    const remove = vi.mocked(WorkspaceBlock.removeCacheFile);
    remove.mockImplementation((folder, name) =>
      name === "agent-5-0000000e.json" ? Promise.reject(new Error("held")) : actualRemove(folder, name),
    );
    onTestFinished(() => {
      remove.mockImplementation(actualRemove);
    });
    const workspace = open((await fixture()).root, cache);
    const recording = recordWith(workspace, "new");
    await until(async () => (await agentFiles(cache)).length === 4);
    const names = await agentFiles(cache);
    expect(names.filter((n) => !n.startsWith(`agent-${String(process.pid)}-`))).toEqual([
      "agent-2-0000000b.json",
      "agent-4-0000000d.json",
      "agent-5-0000000e.json",
    ]);
    await Promise.all([recording.end(), recording.end()]);
    await recording.end();
    const found = await agentConnections(cache);
    expect(found.last?.client).toBe("new");
  });

  it("keeps quiet when the beat cannot start or the cache folder cannot be written at the end", async () => {
    const cache = await tempFolder();
    const workspace = open((await fixture()).root, cache);
    const broken = new URL(`data:text/javascript,${encodeURIComponent("throw new Error('broken beat')")}`);
    const recording = recordAgentConnection(workspace, "agent", { beatEntry: broken });
    await until(async () => (await agentFiles(cache)).length === 1);
    // A file in place of the cache folder: the beat and the last write fail.
    await fs.rm(cache, { recursive: true });
    await fs.writeFile(cache, "");
    await expect(recording.end()).resolves.toBeUndefined();
    await fs.rm(cache);
  });

  it("terminates a beat thread that does not stop in time, and writes the end", async () => {
    const cache = await tempFolder();
    const workspace = open((await fixture()).root, cache);
    const deaf = new URL(
      `data:text/javascript,${encodeURIComponent(
        'import { parentPort } from "node:worker_threads"; parentPort.on("message", () => undefined); setInterval(() => undefined, 1000);',
      )}`,
    );
    const recording = recordAgentConnection(workspace, "agent", { beatEntry: deaf, stopMs: 50 });
    await until(async () => (await agentFiles(cache)).length === 1);
    await recording.end();
    expect((await readConnectionFile(cache)).ended).toEqual(expect.any(String));
  });

  it("writes the end and prunes when the beat thread cannot be created", async () => {
    const cache = await tempFolder();
    const now = Date.now();
    await place(cache, { process: "1-0000000a", ended: new Date(now - 60_000).toISOString() }, now - 60_000);
    await place(cache, { process: "2-0000000b", ended: new Date(now - 1000).toISOString() }, now - 1000);
    const workspace = open((await fixture()).root, cache);
    // A URL a worker cannot load: `new Worker` throws.
    const recording = recordAgentConnection(workspace, "agent", {
      beatEntry: new URL("https://example.invalid/beat.js"),
    });
    await recording.end();
    const names = await agentFiles(cache);
    const own = names.find((n) => n.startsWith(`agent-${String(process.pid)}-`)) ?? "";
    expect(names.filter((n) => n !== own)).toEqual(["agent-2-0000000b.json"]);
    const file = JSON.parse(await fs.readFile(path.join(cache, own), "utf8")) as AgentConnectionFile;
    expect(file.ended).toEqual(expect.any(String));
  });

  it("does not prune when the folder cannot be read after the write", async () => {
    const cache = await tempFolder();
    await place(cache, { process: "1-0000000a" }, Date.now() - 120_000);
    const workspace = open((await fixture()).root, cache);
    // The scans of core list with file types; the test's own listing does not.
    vi.mocked(fs.readdir).mockImplementation(((folder: string, options?: object) =>
      folder === cache && options !== undefined
        ? Promise.reject(Object.assign(new Error("no access"), { code: "EACCES" }))
        : actual.readdir(folder, options as undefined)) as typeof fs.readdir);
    onTestFinished(() => {
      vi.mocked(fs.readdir).mockImplementation(actual.readdir);
    });
    const recording = recordWith(workspace, "agent");
    await until(async () => (await agentFiles(cache)).length === 2);
    await recording.end();
    expect(await agentFiles(cache)).toHaveLength(2);
  });
});

describe("workspace.agents", () => {
  it("gives the connections of the copy, without `until`", async () => {
    const cache = await tempFolder();
    const workspace = open((await fixture()).root, cache);
    expect(await invoke("workspace.agents", {}, { workspace })).toEqual({
      answer: "0 agents connected to this copy; no connection has ended.",
      recorded: true,
      connected: [],
      last: null,
    });
    await place(
      cache,
      { process: "1-0000000a", client: "agent", since: "2026-11-18T09:00:00.000Z" },
      Date.now(),
    );
    expect(await invoke("workspace.agents", {}, { workspace })).toEqual({
      answer: "1 agent connected to this copy; no connection has ended.",
      recorded: true,
      connected: [{ client: "agent", since: "2026-11-18T09:00:00.000Z" }],
      last: null,
    });
    expect(await invoke("workspace.agents", {}, { workspace: open(workspace.root, undefined) })).toEqual({
      answer: "This copy has no cache folder that records agent connections.",
      recorded: false,
      connected: [],
      last: null,
    });
  });
});
