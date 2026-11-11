// The docs server on a fixture site (SR-141); which file a path names is tested in core (docs-site/site.test.ts).
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { docsContentSecurityPolicy } from "@reqseq/core/docs-site";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DocsServer } from "./docs-server.js";
import { DOCS_HOST, startDocsServer } from "./docs-server.js";

let temp: string;
let server: DocsServer | undefined;

/** A path in the temporary folder of the test. */
const at = (name: string): string => path.join(temp, name);

beforeEach(async () => {
  temp = await fs.mkdtemp(path.join(os.tmpdir(), "reqseq-docs-"));
  await fs.mkdir(at("site/start"), { recursive: true });
  await fs.writeFile(at("site/index.html"), "<title>ReqSeq</title>");
  await fs.writeFile(at("site/404.html"), "<title>Not found</title>");
  await fs.writeFile(at("site/start/index.html"), "<title>Start</title>");
});

afterEach(async () => {
  await server?.close();
  server = undefined;
  await fs.rm(temp, { recursive: true, force: true });
});

interface Answer {
  readonly status: number | undefined;
  readonly headers: http.IncomingHttpHeaders;
  readonly body: string;
}

/** One request with the raw target `target`; `host` replaces the Host header. */
const request = (port: number, target: string, method = "GET", host?: string): Promise<Answer> =>
  new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: DOCS_HOST,
        port,
        method,
        path: target,
        agent: false,
        ...(host === undefined ? {} : { headers: { host } }),
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
      },
    );
    req.on("error", reject);
    req.end();
  });

describe("startDocsServer", () => {
  it("[SR-141/AK4] serves the site on 127.0.0.1 with nosniff and the CSP", async () => {
    server = await startDocsServer({ folder: at("site") });
    expect(server.url).toBe(`http://127.0.0.1:${String(server.port)}/`);
    const answer = await request(server.port, "/start/");
    expect(answer).toMatchObject({ status: 200, body: "<title>Start</title>" });
    expect(answer.headers["content-type"]).toBe("text/html; charset=utf-8");
    expect(answer.headers["x-content-type-options"]).toBe("nosniff");
    expect(answer.headers["content-security-policy"]).toBe(docsContentSecurityPolicy());
  });

  it("answers HEAD with the headers only and a missing page with 404.html", async () => {
    server = await startDocsServer({ folder: at("site") });
    const head = await request(server.port, "/", "HEAD");
    expect(head).toMatchObject({ status: 200, body: "" });
    expect(head.headers["content-length"]).toBe(String("<title>ReqSeq</title>".length));
    expect(await request(server.port, "/%2e%2e/%2e%2e/etc/passwd")).toMatchObject({
      status: 404,
      body: "<title>Not found</title>",
    });
  });

  it("[SR-141/AK4] refuses a method other than GET and HEAD, with the CSP too", async () => {
    server = await startDocsServer({ folder: at("site") });
    const answer = await request(server.port, "/", "POST");
    expect(answer).toMatchObject({ status: 405, body: "Use GET or HEAD\n" });
    expect(answer.headers.allow).toBe("GET, HEAD");
    expect(answer.headers["content-security-policy"]).toBe(docsContentSecurityPolicy());
  });

  it("[SR-141/AK4] refuses a Host other than loopback with this port (DNS rebinding)", async () => {
    server = await startDocsServer({ folder: at("site") });
    const port = String(server.port);
    for (const host of ["evil.example", `evil.example:${port}`, "127.0.0.1:1"]) {
      const answer = await request(server.port, "/", "GET", host);
      expect(answer.status).toBe(403);
      expect(answer.headers["x-content-type-options"]).toBe("nosniff");
    }
    for (const host of [`localhost:${port}`, `[::1]:${port}`]) {
      expect((await request(server.port, "/", "GET", host)).status).toBe(200);
    }
  });

  it("takes a port and refuses one that is no TCP port", async () => {
    const first = await startDocsServer({ folder: at("site") });
    try {
      await expect(startDocsServer({ folder: at("site"), port: first.port })).rejects.toMatchObject({
        code: "input.invalid",
      });
    } finally {
      await first.close();
    }
    await expect(startDocsServer({ folder: at("site"), port: 70000 })).rejects.toMatchObject({
      code: "input.invalid",
    });
  });

  it("refuses a folder without a site", async () => {
    await expect(startDocsServer({ folder: at("missing") })).rejects.toMatchObject({
      code: "file.folder-missing",
      details: { folder: at("missing") },
    });
  });
});
