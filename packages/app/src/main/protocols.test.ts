import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { APP_SCHEMES, RENDERER_URL, rendererFiles, workspaceFiles } from "./protocols.js";
import { CONTENT_SECURITY_POLICY } from "./security.js";

let top: string;
let folder: string;

beforeAll(async () => {
  top = await fs.mkdtemp(path.join(os.tmpdir(), "logreq-renderer-"));
  folder = path.join(top, "renderer");
  await fs.mkdir(path.join(folder, "assets"), { recursive: true });
  await fs.writeFile(path.join(folder, "index.html"), "<!doctype html>");
  await fs.writeFile(path.join(folder, "assets", "index.js"), "export {};");
  await fs.writeFile(path.join(folder, "assets", "notes.txt"), "no");
  await fs.writeFile(path.join(top, "secret.js"), "outside");
});

afterAll(async () => {
  await fs.rm(top, { recursive: true, force: true });
});

describe("APP_SCHEMES", () => {
  it("registers app: and logreq-file: as standard, secure schemes", () => {
    expect(APP_SCHEMES).toEqual([
      { scheme: "app", privileges: { standard: true, secure: true } },
      { scheme: "logreq-file", privileges: { standard: true, secure: true } },
    ]);
    expect(RENDERER_URL).toBe("app://logreq/index.html");
  });
});

describe("rendererFiles (app:)", () => {
  const serve = (url: string): Promise<Response> => rendererFiles(folder)({ url });

  it("serves the bundled files with their type and the content security policy", async () => {
    const page = await serve("app://logreq/index.html");
    expect(page.status).toBe(200);
    expect(page.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(page.headers.get("content-security-policy")).toBe(CONTENT_SECURITY_POLICY);
    expect(page.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await page.text()).toBe("<!doctype html>");
    const script = await serve("app://logreq/assets/index.js");
    expect(script.headers.get("content-type")).toBe("text/javascript; charset=utf-8");
  });

  it("serves nothing outside the folder, of another host, of another type, or missing", async () => {
    for (const url of [
      "app://logreq/..%2Fsecret.js",
      "app://other/index.html",
      "app://logreq/assets/notes.txt",
      "app://logreq/missing.js",
      "app://logreq/",
      "app://logreq/%E0%A4%A.js",
      "::",
    ]) {
      expect([url, (await serve(url)).status]).toEqual([url, 404]);
    }
  });
});

describe("workspaceFiles (logreq-file:)", () => {
  it("answers with what the core process read, or 404", async () => {
    const read = vi.fn((url: string) =>
      Promise.resolve(
        url.endsWith("a.png")
          ? ({ status: 200, mimeType: "image/png", data: new Uint8Array([1, 2, 3]) } as const)
          : ({ status: 404 } as const),
      ),
    );
    const serve = workspaceFiles(read);
    const image = await serve({ url: "logreq-file://workspace/system/a.png" });
    expect(image.status).toBe(200);
    expect(image.headers.get("content-type")).toBe("image/png");
    expect(image.headers.get("content-security-policy")).toBe(
      "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    );
    expect(new Uint8Array(await image.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
    expect((await serve({ url: "logreq-file://workspace/system/b.png" })).status).toBe(404);
    expect(read.mock.calls).toEqual([
      ["logreq-file://workspace/system/a.png"],
      ["logreq-file://workspace/system/b.png"],
    ]);
  });
});
