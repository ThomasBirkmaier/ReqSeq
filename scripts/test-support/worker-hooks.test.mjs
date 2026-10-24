import { URL } from "node:url";
import { Worker } from "node:worker_threads";
import { describe, expect, it } from "vitest";
import { inSources, resolve, sourceFor } from "./worker-hooks.mjs";

const src = new URL("../../packages/core/src/model/", import.meta.url).href;

describe("worker hooks (TypeScript sources in worker threads)", () => {
  it("maps a .js file of the sources that exists only as .ts", () => {
    expect(sourceFor(`${src}read-worker.js`)).toBe(`${src}read-worker.ts`);
  });

  it("leaves everything else alone", () => {
    expect(sourceFor(`${src}missing.js`)).toBeUndefined();
    expect(sourceFor(`${src}read-worker.ts`)).toBeUndefined();
    expect(sourceFor(new URL("./block-network.mjs", import.meta.url).href)).toBeUndefined();
    expect(sourceFor("file:///elsewhere/src/a.js")).toBeUndefined();
  });

  it("compares file URLs without case on Windows only", () => {
    const other = src.toUpperCase().replace(/^FILE:/, "file:");
    expect(inSources(src, "linux")).toBe(true);
    expect(inSources(other, "win32")).toBe(true);
    expect(inSources(other, "linux")).toBe(other === src);
    expect(inSources("file:///elsewhere/src/a.js", "win32")).toBe(false);
  });

  it("resolves relative and file: specifiers to the source and passes others on", async () => {
    const next = (specifier) => Promise.resolve({ url: specifier });
    const parentURL = `${src}read-pool.ts`;
    expect(await resolve("./store.js", { parentURL }, next)).toEqual({ url: `${src}store.ts` });
    expect(await resolve(`${src}read-worker.js`, {}, next)).toEqual({ url: `${src}read-worker.ts` });
    expect(await resolve("../files/index.js", { parentURL }, next)).toEqual({
      url: new URL("../files/index.ts", src).href,
    });
    expect(await resolve("yaml", { parentURL }, next)).toEqual({ url: "yaml" });
    expect(await resolve("data:text/javascript,1", {}, next)).toEqual({ url: "data:text/javascript,1" });
  });
});

describe("worker preload", () => {
  it("blocks the network in a worker thread too", async () => {
    // The worker inherits `--import worker-preload.mjs` from the Vitest fork (execArgv of the config).
    const code = `import net from "node:net";
import { parentPort } from "node:worker_threads";
try {
  net.connect(80, "192.0.2.1").on("error", () => {});
  parentPort.postMessage("connected");
} catch (error) {
  parentPort.postMessage(String(error.message));
}`;
    const worker = new Worker(new URL(`data:text/javascript,${encodeURIComponent(code)}`));
    try {
      const message = await new Promise((resolve, reject) => {
        worker.once("message", resolve);
        worker.once("error", reject);
      });
      expect(message).toMatch(/network access blocked in tests: 192\.0\.2\.1:80/);
    } finally {
      await worker.terminate();
    }
  });
});
