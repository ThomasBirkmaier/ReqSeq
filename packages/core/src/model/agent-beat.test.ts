import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { MessageChannel } from "node:worker_threads";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import * as Files from "../files/index.js";
import { AGENT_BEAT_WORKER, beat, serveBeat } from "./agent-beat.js";

// The real block, with `writePrivateFile` wrapped so that a test can make the write fail.
vi.mock("../files/index.js", async (importOriginal) => {
  const original = await importOriginal<typeof Files>();
  return { ...original, writePrivateFile: vi.fn(original.writePrivateFile) };
});

const tempFolder = async (): Promise<string> => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), "reqseq-agent-beat-"));
  onTestFinished(() => fs.rm(folder, { recursive: true, force: true, maxRetries: 3 }));
  return folder;
};

const OLD = new Date(Date.UTC(2026, 0, 1));

describe("beat", () => {
  it("renews the modification time, writes a missing file again, and drops other failures", async () => {
    const folder = await tempFolder();
    const file = path.join(folder, "agent-1-0000000a.json");
    await fs.writeFile(file, "old");
    await fs.utimes(file, OLD, OLD);
    await beat(file, "text");
    expect((await fs.stat(file)).mtimeMs).toBeGreaterThan(OLD.getTime());
    expect(await fs.readFile(file, "utf8")).toBe("old");

    await fs.rm(file);
    await beat(file, "text");
    expect(await fs.readFile(file, "utf8")).toBe("text");

    // A file on the path of the folder: neither renewed nor written, and no rejection.
    await expect(beat(path.join(file, "below.json"), "text")).resolves.toBeUndefined();
    vi.mocked(Files.writePrivateFile).mockRejectedValueOnce(new Error("disk full"));
    await expect(beat(path.join(folder, "gone.json"), "text")).resolves.toBeUndefined();
  });
});

describe("serveBeat", () => {
  it("beats until it is told to stop, then answers and closes its port", async () => {
    const folder = await tempFolder();
    const file = path.join(folder, "agent-1-0000000a.json");
    await fs.writeFile(file, "text");
    await fs.utimes(file, OLD, OLD);
    const { port1, port2 } = new MessageChannel();
    onTestFinished(() => {
      port1.close();
    });
    serveBeat(port2, { marker: AGENT_BEAT_WORKER, file, text: "text", everyMs: 5 });
    await vi.waitFor(async () => {
      expect((await fs.stat(file)).mtimeMs).toBeGreaterThan(OLD.getTime());
    });
    const answer = new Promise((resolve) => port1.once("message", resolve));
    const closed = new Promise((resolve) => port1.once("close", resolve));
    port1.postMessage("stop");
    expect(await answer).toBe("stopped");
    await closed;
    // No beat after the stop.
    await fs.utimes(file, OLD, OLD);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect((await fs.stat(file)).mtimeMs).toBe(OLD.getTime());
  });

  it("serves nothing without a port or in a thread that is no beat worker", async () => {
    serveBeat(null, { marker: AGENT_BEAT_WORKER, file: "x", text: "", everyMs: 5 });
    const { port1, port2 } = new MessageChannel();
    onTestFinished(() => {
      port1.close();
    });
    serveBeat(port2, { marker: "reqseq-read-worker" });
    serveBeat(port2, null);
    expect(port2.listenerCount("message")).toBe(0);
    await expect(import("./agent-beat-worker.js")).resolves.toBeDefined();
  });
});
