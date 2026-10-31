import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MANIFEST, PINS, annotation, fetchXsds, main, plan } from "./fetch.mjs";

const sha = (text) => createHash("sha256").update(text).digest("hex");
const A = "<xs:schema>a</xs:schema>";
const B = "<xs:schema>b</xs:schema>";
const manifest = {
  files: [
    { name: "a.xsd", url: "https://example.org/a.xsd" },
    { name: "b.xsd", url: "https://example.org/b.xsd" },
  ],
};
const pins = `${sha(A)}  a.xsd\n${sha(B)} *b.xsd\n`;

const roots = [];
afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
const tempDir = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "reqif-xsd-"));
  roots.push(root);
  return root;
};

/** Response headers with an optional content type. */
const headers = (type) => ({ get: (name) => (name === "content-type" ? (type ?? null) : null) });

/** A fetch that answers from `bodies` (url → text, a status number, or an Error) and records the calls. */
const fakeFetch = (bodies) => {
  const calls = [];
  const fetch = async (url) => {
    calls.push(url);
    const body = bodies[url];
    if (body instanceof Error) {
      throw body;
    }
    if (typeof body === "number") {
      return { ok: false, status: body, url, headers: headers() };
    }
    if (typeof body === "object") {
      return {
        ok: true,
        status: 200,
        url: body.url,
        headers: headers(),
        arrayBuffer: async () => new ArrayBuffer(0),
      };
    }
    return {
      ok: true,
      status: 200,
      url,
      headers: headers("application/xml"),
      arrayBuffer: async () => Buffer.from(body),
    };
  };
  return { fetch, calls };
};
const noSleep = async () => {};
const OK = { "https://example.org/a.xsd": A, "https://example.org/b.xsd": B };

describe("plan", () => {
  it("pairs every manifest file with its pin, in sha256sum format", () => {
    expect(plan(manifest, pins)).toEqual({
      files: [
        { name: "a.xsd", url: "https://example.org/a.xsd", sha256: sha(A) },
        { name: "b.xsd", url: "https://example.org/b.xsd", sha256: sha(B) },
      ],
      problems: [],
    });
  });

  it("fails while the pins are a placeholder, and names a missing or unknown pin", () => {
    expect(plan(manifest, "PENDING\n").problems).toEqual([
      expect.stringMatching(/^::error title=ReqIF XSD not pinned::.*"PENDING"/),
    ]);
    expect(plan(manifest, `${sha(A)}  a.xsd\n${sha(B)}  c.xsd\n`).problems).toEqual([
      "::error title=ReqIF XSD not pinned::b.xsd has no SHA-256 in toolchain/reqif/xsd.sha256.",
      "::error title=ReqIF XSD manifest::toolchain/reqif/xsd.sha256 pins c.xsd, which xsd.json does not list.",
    ]);
  });

  it("refuses an http URL and a base name listed twice", () => {
    const problems = plan(
      {
        files: [
          { name: "a.xsd", url: "http://example.org/a.xsd" },
          { name: "b.xsd", url: "https://example.org/b.xsd" },
          { name: "b.xsd", url: "https://example.org/other/b.xsd" },
        ],
      },
      pins,
    ).problems;
    expect(problems).toEqual([
      "::error title=ReqIF XSD manifest::a.xsd: http://example.org/a.xsd is not https; only https URLs are fetched.",
      "::error title=ReqIF XSD manifest::b.xsd is listed twice; every schemaLocation maps to one base name.",
    ]);
  });

  it("the committed manifest lists the 21 files, https only, each name once", () => {
    const committed = JSON.parse(fs.readFileSync(MANIFEST, "utf8"));
    expect(committed.files).toHaveLength(21);
    expect(new Set(committed.files.map((file) => file.name)).size).toBe(21);
    expect(
      committed.files.every((file) => file.url.startsWith("https://") && file.url.endsWith(`/${file.name}`)),
    ).toBe(true);
    expect(fs.existsSync(PINS)).toBe(true);
  });
});

describe("fetchXsds", () => {
  const { files } = plan(manifest, pins);

  it("downloads every file once and keeps a cached file with its pinned hash", async () => {
    const dir = tempDir();
    const first = fakeFetch(OK);
    expect(await fetchXsds(files, dir, { fetch: first.fetch, sleep: noSleep })).toEqual([]);
    expect(fs.readFileSync(path.join(dir, "a.xsd"), "utf8")).toBe(A);
    const second = fakeFetch(OK);
    expect(await fetchXsds(files, dir, { fetch: second.fetch, sleep: noSleep })).toEqual([]);
    expect(second.calls).toEqual([]);
    const fresh = fakeFetch(OK);
    expect(await fetchXsds(files, dir, { fresh: true, fetch: fresh.fetch, sleep: noSleep })).toEqual([]);
    expect(fresh.calls).toHaveLength(2);
  });

  it("downloads a cached file again when its hash does not match", async () => {
    const dir = tempDir();
    fs.writeFileSync(path.join(dir, "a.xsd"), "stale");
    const fake = fakeFetch(OK);
    expect(await fetchXsds(files, dir, { fetch: fake.fetch, sleep: noSleep })).toEqual([]);
    expect(fake.calls).toEqual(["https://example.org/a.xsd", "https://example.org/b.xsd"]);
    expect(fs.readFileSync(path.join(dir, "a.xsd"), "utf8")).toBe(A);
  });

  it("reports a hash mismatch apart from a download failure, with size, type and the first bytes", async () => {
    const dir = tempDir();
    const fake = fakeFetch({
      "https://example.org/a.xsd": "<html>\nCaptcha</html>",
      "https://example.org/b.xsd": 503,
    });
    const problems = await fetchXsds(files, dir, { fetch: fake.fetch, sleep: noSleep });
    expect(problems).toHaveLength(2);
    expect(problems[0]).toMatch(
      /^::error title=ReqIF XSD hash mismatch::a\.xsd from https:\/\/example\.org\/a\.xsd changed upstream/,
    );
    expect(problems[0]).toContain(
      `got ${sha("<html>\nCaptcha</html>")} (21 bytes, content type application/xml, starts with "<html>.Captcha</html>")`,
    );
    expect(problems[1]).toMatch(
      /^::error title=ReqIF XSD download failed::b\.xsd from https:\/\/example\.org\/b\.xsd: HTTP 503\. Re-run/,
    );
    // Retried once.
    expect(fake.calls).toEqual([
      "https://example.org/a.xsd",
      "https://example.org/b.xsd",
      "https://example.org/b.xsd",
    ]);
    expect(fs.existsSync(path.join(dir, "a.xsd"))).toBe(false);
  });

  it("names a network error by its code, retries once and refuses a redirect to http", async () => {
    const dir = tempDir();
    const refused = Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } });
    const fake = fakeFetch({
      "https://example.org/a.xsd": refused,
      "https://example.org/b.xsd": { url: "http://example.org/b.xsd" },
    });
    const problems = await fetchXsds(files, dir, { fetch: fake.fetch });
    expect(problems[0]).toContain("a.xsd from https://example.org/a.xsd: ECONNREFUSED.");
    expect(problems[1]).toContain(
      "b.xsd from https://example.org/b.xsd: redirected to http://example.org/b.xsd, which is not https.",
    );
    expect(fake.calls).toEqual([
      "https://example.org/a.xsd",
      "https://example.org/a.xsd",
      "https://example.org/b.xsd",
    ]);
    const timeout = fakeFetch({
      ...OK,
      "https://example.org/a.xsd": Object.assign(new Error("x"), { name: "TimeoutError" }),
    });
    expect((await fetchXsds(files, tempDir(), { fetch: timeout.fetch, sleep: noSleep }))[0]).toContain(
      ": TimeoutError.",
    );
    const odd = fakeFetch({ ...OK, "https://example.org/a.xsd": "plain" });
    odd.fetch = async () => Promise.reject("odd");
    expect((await fetchXsds(files, tempDir(), { fetch: odd.fetch, sleep: noSleep }))[0]).toContain(": odd.");
  }, 20_000);
});

describe("main", () => {
  it("prints usage without a folder, the problems as ::error lines, and a summary when all is well", async () => {
    const lines = [];
    const log = (line) => lines.push(line);
    expect(await main([], { log })).toBe(2);
    const dir = tempDir();
    const manifestFile = path.join(dir, "xsd.json");
    const pinsFile = path.join(dir, "xsd.sha256");
    fs.writeFileSync(manifestFile, JSON.stringify(manifest));
    fs.writeFileSync(pinsFile, "PENDING\n");
    expect(await main([path.join(dir, "out")], { log, manifest: manifestFile, pins: pinsFile })).toBe(1);
    fs.writeFileSync(pinsFile, pins);
    const fake = fakeFetch(OK);
    expect(
      await main([path.join(dir, "out"), "--fresh"], {
        log,
        fetch: fake.fetch,
        manifest: manifestFile,
        pins: pinsFile,
      }),
    ).toBe(0);
    expect(lines).toEqual([
      "Usage: node scripts/reqif-xsd/fetch.mjs <dir> [--fresh]",
      expect.stringMatching(/^::error title=ReqIF XSD not pinned::/),
      `2 ReqIF XSDs in ${path.join(dir, "out")}, each with its pinned SHA-256.`,
    ]);
  });

  it("escapes % and line breaks in an annotation", () => {
    expect(annotation("T", "50%\r\nnext")).toBe("::error title=T::50%25%0D%0Anext");
  });
});
