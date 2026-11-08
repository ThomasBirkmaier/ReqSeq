import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { FixtureWorkspace } from "@reqseq/testkit";
import { createFixtureWorkspace } from "@reqseq/testkit";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DocsSite } from "./site.js";
import {
  MAX_DOCS_FILE_BYTES,
  commandPagePath,
  commandSlug,
  docsContentSecurityPolicy,
  inlineScripts,
  openDocsSite,
  siteSegments,
} from "./site.js";

const PAGE = '<!doctype html><title>Start</title><script>let a = 1;</script><script src="/x.js"></script>';

let fixture: FixtureWorkspace;
let site: DocsSite;

beforeEach(async () => {
  fixture = await createFixtureWorkspace({
    files: {
      "site/index.html": PAGE,
      "site/404.html": "<title>Not here</title>",
      "site/start/get-started/index.html": "<title>Get started</title>",
      "site/_astro/page.js": "export {};",
      "site/pagefind/pagefind-entry.json": "{}",
      "site/pagefind/wasm.en.pagefind": "wasm",
      "site/odd.exe": "MZ",
      "site/.hidden.html": "hidden",
      "site/folder.css/index.html": "a folder with an extension",
      "outside/secret.html": "secret",
    },
  });
  const opened = await openDocsSite(fixture.path("site"));
  if (opened === undefined) {
    throw new Error("the fixture site has no index.html");
  }
  site = opened;
});

afterEach(async () => {
  await fixture.cleanup();
});

const text = async (target: string): Promise<{ status: number; type: string | undefined; body: string }> => {
  const response = await site.respond(target);
  return {
    status: response.status,
    type: response.headers["content-type"],
    body: response.body.toString("utf8"),
  };
};

describe("commandPagePath", () => {
  it("names a command's reference page in the lower case of the site's URLs", () => {
    expect(commandSlug("element.setStatus")).toBe("element-set-status");
    expect(commandSlug("data.export")).toBe("data-export");
    expect(commandPagePath("element.get")).toBe("reference/commands/element-get/");
  });
});

describe("siteSegments", () => {
  it("maps a folder to its index.html and ignores query and fragment", () => {
    expect(siteSegments("/")).toEqual(["index.html"]);
    expect(siteSegments("/start/get-started/")).toEqual(["start", "get-started", "index.html"]);
    expect(siteSegments("/start/get-started?x=1")).toEqual(["start", "get-started", "index.html"]);
    expect(siteSegments("/_astro/page.js#top")).toEqual(["_astro", "page.js"]);
    expect(siteSegments("/a%20b/c.html")).toEqual(["a b", "c.html"]);
  });

  it.each([
    ["no leading slash", "start/"],
    ["an absolute URL", "http://127.0.0.1/"],
    ["a bad escape", "/%E0%A4%A"],
    ["..", "/../outside/secret.html"],
    ["encoded ..", "/%2e%2e/outside/secret.html"],
    ["encoded / and ..", "/start%2f..%2f..%2foutside/secret.html"],
    [".", "/./index.html"],
    ["an empty segment", "/start//index.html"],
    ["a backslash", "/start%5c..%5c..%5coutside%5csecret.html"],
    ["a drive", "/C:/Windows/win.ini"],
    ["a colon", "/index.html:stream"],
    ["NUL", "/index.html%00.css"],
    ["a control character", "/index%0a.html"],
    ["a hidden file", "/.hidden.html"],
  ])("names no file for %s", (_reason, target) => {
    expect(siteSegments(target)).toBeUndefined();
  });
});

describe("openDocsSite", () => {
  it("serves a page with its media type, nosniff and the CSP with the hashes of its own inline scripts", async () => {
    const response = await site.respond("/");
    expect(response.status).toBe(200);
    expect(response.body.toString("utf8")).toBe(PAGE);
    const hash = createHash("sha256").update("let a = 1;").digest("base64");
    expect(response.headers).toEqual({
      "content-type": "text/html; charset=utf-8",
      "content-length": String(Buffer.byteLength(PAGE)),
      "x-content-type-options": "nosniff",
      "content-security-policy": docsContentSecurityPolicy(["let a = 1;"]),
      "referrer-policy": "no-referrer",
      "cache-control": "no-cache",
    });
    expect(response.headers["content-security-policy"]).toContain(
      `script-src 'self' 'wasm-unsafe-eval' 'sha256-${hash}'; `,
    );
  });

  it("gives other files the CSP without hashes", async () => {
    const response = await site.respond("/_astro/page.js");
    expect(response.headers["content-type"]).toBe("text/javascript; charset=utf-8");
    expect(response.headers["content-security-policy"]).toBe(docsContentSecurityPolicy());
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
  });

  it("serves folders without a trailing slash and Pagefind's files", async () => {
    expect(await text("/start/get-started")).toMatchObject({
      status: 200,
      body: "<title>Get started</title>",
    });
    expect(await text("/pagefind/wasm.en.pagefind")).toEqual({
      status: 200,
      type: "application/octet-stream",
      body: "wasm",
    });
    expect((await text("/pagefind/pagefind-entry.json")).type).toBe("application/json; charset=utf-8");
  });

  it.each([
    ["a missing file", "/missing.html"],
    ["an extension outside the allowlist", "/odd.exe"],
    ["a refused path", "/%2e%2e/outside/secret.html"],
    ["a hidden file", "/.hidden.html"],
    ["a folder with an extension", "/folder.css"],
  ])("answers %s with 404.html and status 404", async (_reason, target) => {
    expect(await text(target)).toEqual({
      status: 404,
      type: "text/html; charset=utf-8",
      body: "<title>Not here</title>",
    });
  });

  it("does not follow a symbolic link out of the site", async () => {
    // A junction needs no rights on Windows; elsewhere the type is ignored.
    await fs.symlink(fixture.path("outside"), fixture.path("site/out"), "junction");
    expect((await text("/out/secret.html")).status).toBe(404);
  });

  it("serves no file larger than MAX_DOCS_FILE_BYTES", async () => {
    await fs.writeFile(fixture.path("site/large.png"), "");
    await fs.truncate(fixture.path("site/large.png"), MAX_DOCS_FILE_BYTES + 1);
    expect((await text("/large.png")).status).toBe(404);
  });

  it("answers with a short text when the site has no 404.html", async () => {
    await fs.rm(fixture.path("site/404.html"));
    expect(await text("/missing.html")).toEqual({
      status: 404,
      type: "text/plain; charset=utf-8",
      body: "Not found\n",
    });
  });

  it("is undefined for a missing folder or one without index.html", async () => {
    expect(await openDocsSite(fixture.path("missing"))).toBeUndefined();
    expect(await openDocsSite(fixture.path("outside"))).toBeUndefined();
  });

  it("resolves the root's own links", async () => {
    await fs.symlink(fixture.path("site"), fixture.path("linked"), "junction");
    expect((await openDocsSite(fixture.path("linked")))?.root).toBe(path.join(fixture.root, "site"));
  });
});

describe("inlineScripts", () => {
  it("takes the text of scripts without src, also of modules and empty ones", () => {
    expect(
      inlineScripts('<script type="module">a()</script><script src="b.js"></script><SCRIPT></SCRIPT>'),
    ).toEqual(["a()", ""]);
  });
});
