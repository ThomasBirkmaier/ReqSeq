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
const pins = `# confirmed\n${sha(A)}  a.xsd\n${sha(B)} *b.xsd\n`;

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

/** Response headers. */
const headers = (values = {}) => ({ get: (name) => values[name] ?? null });

/**
 * A fetch that answers from `bodies`: url → text, a status number, `{ redirect }`, an Error, or "hang"
 * (waits until its signal aborts). Records the calls.
 */
const fakeFetch = (bodies) => {
  const calls = [];
  const fetch = async (url, { signal }) => {
    calls.push(url);
    const body = bodies[url];
    if (body instanceof Error) {
      throw body;
    }
    if (body === "hang") {
      return new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason));
      });
    }
    if (typeof body === "number") {
      return { ok: false, status: body, headers: headers() };
    }
    if (typeof body === "object") {
      return {
        ok: false,
        status: 302,
        headers: headers(body.redirect === null ? {} : { location: body.redirect }),
      };
    }
    return {
      ok: true,
      status: 200,
      headers: headers({ "content-type": "application/xml" }),
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

  it("refuses a malformed and a repeated pin line with its line, and names a missing or unknown pin", () => {
    expect(
      plan(manifest, `${sha(A).toUpperCase()}  a.xsd\n${sha(B)}  b.xsd\n${sha(A)}  b.xsd\n`).problems,
    ).toEqual([
      `::error title=ReqIF XSD pins::toolchain/reqif/xsd.sha256 line 1 is not "<sha256 in lower-case hex>  <name>": "${sha(A).toUpperCase()}  a.xsd".`,
      "::error title=ReqIF XSD pins::toolchain/reqif/xsd.sha256 pins b.xsd twice (line 3).",
      "::error title=ReqIF XSD not pinned::a.xsd has no SHA-256 in toolchain/reqif/xsd.sha256.",
    ]);
    expect(plan(manifest, `${sha(A)}  a.xsd\n${sha(B)}  c.xsd\n`).problems).toEqual([
      "::error title=ReqIF XSD not pinned::b.xsd has no SHA-256 in toolchain/reqif/xsd.sha256.",
      "::error title=ReqIF XSD manifest::toolchain/reqif/xsd.sha256 pins c.xsd, which xsd.json does not list.",
    ]);
  });

  it("refuses an http URL, a name that is no plain file name and a base name listed twice", () => {
    const problems = plan(
      {
        files: [
          { name: "a.xsd", url: "http://example.org/a.xsd" },
          { name: "../x.xsd", url: "https://example.org/x.xsd" },
          { name: "..", url: "https://example.org/up" },
          { name: "b.xsd", url: "https://example.org/b.xsd" },
          { name: "b.xsd", url: "https://example.org/other/b.xsd" },
        ],
      },
      pins,
    ).problems;
    expect(problems).toEqual([
      "::error title=ReqIF XSD manifest::a.xsd: http://example.org/a.xsd is not https; only https URLs are fetched.",
      '::error title=ReqIF XSD manifest::"../x.xsd" is not a plain file name.',
      '::error title=ReqIF XSD manifest::".." is not a plain file name.',
      "::error title=ReqIF XSD manifest::b.xsd is listed twice; every schemaLocation maps to one base name.",
    ]);
  });

  it("the committed manifest and pins fit: 21 files, https only, each name once and pinned", () => {
    const committed = JSON.parse(fs.readFileSync(MANIFEST, "utf8"));
    expect(committed.files).toHaveLength(21);
    expect(
      committed.files.every((file) => file.url.startsWith("https://") && file.url.endsWith(`/${file.name}`)),
    ).toBe(true);
    const pinned = plan(committed, fs.readFileSync(PINS, "utf8"));
    expect(pinned.problems).toEqual([]);
    expect(pinned.files.map((file) => file.name)).toEqual(committed.files.map((file) => file.name));
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
    expect(fake.calls.sort()).toEqual(["https://example.org/a.xsd", "https://example.org/b.xsd"]);
    expect(fs.readFileSync(path.join(dir, "a.xsd"), "utf8")).toBe(A);
  });

  it("reports a hash mismatch apart from a download failure, each at once, with size, type and the first bytes", async () => {
    const dir = tempDir();
    const reported = [];
    const fake = fakeFetch({
      "https://example.org/a.xsd": "<html>\nCaptcha</html>",
      "https://example.org/b.xsd": 503,
    });
    const problems = await fetchXsds(files, dir, {
      fetch: fake.fetch,
      sleep: noSleep,
      report: (line) => reported.push(line),
    });
    expect(reported).toEqual(problems);
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
    // b is retried once.
    expect(fake.calls.filter((url) => url.endsWith("b.xsd"))).toHaveLength(2);
    expect(fs.existsSync(path.join(dir, "a.xsd"))).toBe(false);
  });

  it("follows https redirects, refuses any http hop, a redirect without Location and a loop", async () => {
    const follows = fakeFetch({
      ...OK,
      "https://example.org/a.xsd": { redirect: "/moved/a.xsd" },
      "https://example.org/moved/a.xsd": A,
    });
    expect(await fetchXsds(files, tempDir(), { fetch: follows.fetch, sleep: noSleep })).toEqual([]);
    const hop = fakeFetch({
      ...OK,
      "https://example.org/a.xsd": { redirect: "http://example.org/a.xsd" },
      "https://example.org/b.xsd": { redirect: null },
    });
    const problems = await fetchXsds(files, tempDir(), { fetch: hop.fetch, sleep: noSleep });
    expect(problems[0]).toContain(
      "a.xsd from https://example.org/a.xsd: redirected to http://example.org/a.xsd, which is not https.",
    );
    expect(problems[1]).toContain("b.xsd from https://example.org/b.xsd: HTTP 302 without a Location.");
    // A refused redirect is not retried.
    expect(hop.calls).toEqual(["https://example.org/a.xsd", "https://example.org/b.xsd"]);
    const loop = fakeFetch({ ...OK, "https://example.org/a.xsd": { redirect: "https://example.org/a.xsd" } });
    expect((await fetchXsds(files, tempDir(), { fetch: loop.fetch, sleep: noSleep }))[0]).toContain(
      ": more than 5 redirects.",
    );
  });

  it("names a network error by its code, a timeout by its name, and anything else as it is", async () => {
    const refused = Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } });
    const network = fakeFetch({ ...OK, "https://example.org/a.xsd": refused });
    expect((await fetchXsds(files, tempDir(), { fetch: network.fetch, sleep: noSleep }))[0]).toContain(
      "a.xsd from https://example.org/a.xsd: ECONNREFUSED.",
    );
    expect(network.calls.filter((url) => url.endsWith("a.xsd"))).toHaveLength(2);
    const timeout = fakeFetch({
      ...OK,
      "https://example.org/a.xsd": Object.assign(new Error("x"), { name: "TimeoutError" }),
    });
    expect((await fetchXsds(files, tempDir(), { fetch: timeout.fetch, sleep: noSleep }))[0]).toContain(
      ": TimeoutError.",
    );
    const odd = async () => Promise.reject("odd");
    expect((await fetchXsds(files, tempDir(), { fetch: odd, sleep: noSleep }))[0]).toContain(": odd.");
  });

  it("stops every download at one deadline, so the CI step never times out silently", async () => {
    const reported = [];
    const hanging = fakeFetch({ "https://example.org/a.xsd": "hang", "https://example.org/b.xsd": "hang" });
    const problems = await fetchXsds(files, tempDir(), {
      fetch: hanging.fetch,
      sleep: noSleep,
      deadlineMs: 30,
      report: (line) => reported.push(line),
    });
    expect(problems).toHaveLength(2);
    expect(reported).toEqual(problems);
    expect(problems[0]).toContain(": TimeoutError; then the deadline of all downloads passed.");
    // Past the deadline nothing is requested any more.
    let clock = 0;
    const late = fakeFetch(OK);
    const after = await fetchXsds(files, tempDir(), {
      fetch: late.fetch,
      sleep: noSleep,
      now: () => (clock += 1000),
      deadlineMs: 500,
    });
    expect(after[0]).toContain(": the deadline of all downloads passed.");
    expect(late.calls).toEqual([]);
  });
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
    expect(
      await main([path.join(dir, "out")], {
        log,
        fetch: fakeFetch({}).fetch,
        sleep: noSleep,
        manifest: manifestFile,
        pins: pinsFile,
      }),
    ).toBe(1);
    expect(
      await main([path.join(dir, "out"), "--fresh"], {
        log,
        fetch: fakeFetch(OK).fetch,
        manifest: manifestFile,
        pins: pinsFile,
      }),
    ).toBe(0);
    expect(lines).toEqual([
      "Usage: node scripts/reqif-xsd/fetch.mjs <dir> [--fresh]",
      expect.stringMatching(/^::error title=ReqIF XSD pins::toolchain\/reqif\/xsd.sha256 line 1/),
      expect.stringMatching(/^::error title=ReqIF XSD not pinned::a\.xsd/),
      expect.stringMatching(/^::error title=ReqIF XSD not pinned::b\.xsd/),
      expect.stringMatching(/^::error title=ReqIF XSD download failed::/),
      expect.stringMatching(/^::error title=ReqIF XSD download failed::/),
      `2 ReqIF XSDs in ${path.join(dir, "out")}, each with its pinned SHA-256.`,
    ]);
  });

  it("escapes % and line breaks in an annotation", () => {
    expect(annotation("T", "50%\r\nnext")).toBe("::error title=T::50%25%0D%0Anext");
  });
});
