#!/usr/bin/env node
// Downloads the ReqIF 1.2 XSDs of toolchain/reqif/xsd.json into a folder and checks each against its
// SHA-256 in toolchain/reqif/xsd.sha256 (product owner decision, 2026-10-31: the XSDs are never in the
// repository; CI downloads them before the tests, pinned, cache first). CI tooling only: it runs before
// the network-blocked tests and is never part of ReqSeq, which opens no connection.
//
//   node scripts/reqif-xsd/fetch.mjs <dir> [--fresh]
//
// A file already in <dir> with the pinned hash is kept (the CI cache); --fresh downloads every file
// (the nightly upstream check). The files are fetched in parallel within one deadline that ends before
// the CI step's timeout, and each failure is printed as one `::error` annotation the moment it is
// found; the exit code is then 1.
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { URL, fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const MANIFEST = path.join(ROOT, "toolchain/reqif/xsd.json");
export const PINS = path.join(ROOT, "toolchain/reqif/xsd.sha256");
/** Per request. */
const TIMEOUT_MS = 20_000;
const RETRY_MS = 5_000;
/** For all files together; the CI step's `timeout-minutes: 3` is 180 s. */
export const DEADLINE_MS = 150_000;
/** Downloads at once: few, to be polite to omg.org and w3.org. */
const PARALLEL = 6;
const MAX_REDIRECTS = 5;
const BASE_NAME = /^(?!\.{1,2}$)[A-Za-z0-9._-]+$/;

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** A GitHub workflow command `::error` with its message escaped. */
export const annotation = (title, message) =>
  `::error title=${title}::${message.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A")}`;

/**
 * The files to fetch: `manifest` is the parsed xsd.json, `pins` the text of xsd.sha256 (`<sha256>  <name>`
 * per line, as sha256sum writes it; `#` starts a comment line). Gives the files with their hash, or the
 * reasons the two do not fit.
 */
export const plan = (manifest, pins) => {
  const problems = [];
  const hashes = new Map();
  for (const [index, line] of pins.split(/\r?\n/).entries()) {
    const text = line.trim();
    if (text === "" || text.startsWith("#")) {
      continue;
    }
    const match = /^([0-9a-f]{64}) [ *](\S+)$/.exec(text);
    if (match === null) {
      problems.push(
        annotation(
          "ReqIF XSD pins",
          `toolchain/reqif/xsd.sha256 line ${String(index + 1)} is not "<sha256 in lower-case hex>  <name>": "${text}".`,
        ),
      );
    } else if (hashes.has(match[2])) {
      problems.push(
        annotation(
          "ReqIF XSD pins",
          `toolchain/reqif/xsd.sha256 pins ${match[2]} twice (line ${String(index + 1)}).`,
        ),
      );
    } else {
      hashes.set(match[2], match[1]);
    }
  }
  const names = new Set();
  const files = [];
  for (const { name, url } of manifest.files) {
    if (!BASE_NAME.test(name)) {
      problems.push(annotation("ReqIF XSD manifest", `"${name}" is not a plain file name.`));
      continue;
    }
    if (names.has(name)) {
      problems.push(
        annotation(
          "ReqIF XSD manifest",
          `${name} is listed twice; every schemaLocation maps to one base name.`,
        ),
      );
      continue;
    }
    names.add(name);
    if (!url.startsWith("https://")) {
      problems.push(
        annotation("ReqIF XSD manifest", `${name}: ${url} is not https; only https URLs are fetched.`),
      );
      continue;
    }
    const sha = hashes.get(name);
    if (sha === undefined) {
      problems.push(
        annotation("ReqIF XSD not pinned", `${name} has no SHA-256 in toolchain/reqif/xsd.sha256.`),
      );
      continue;
    }
    files.push({ name, url, sha256: sha });
  }
  for (const name of hashes.keys()) {
    if (!names.has(name)) {
      problems.push(
        annotation(
          "ReqIF XSD manifest",
          `toolchain/reqif/xsd.sha256 pins ${name}, which xsd.json does not list.`,
        ),
      );
    }
  }
  return { files, problems };
};

class Refused extends Error {}

/** One request, following redirects by hand so that every hop must be https. */
const request = async (url, { fetch, signal }) => {
  let at = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const response = await fetch(at, { redirect: "manual", signal });
    if (response.status < 300 || response.status >= 400) {
      return response;
    }
    const location = response.headers.get("location");
    if (location === null) {
      throw new Refused(`HTTP ${String(response.status)} without a Location`);
    }
    const next = new URL(location, at).href;
    if (!next.startsWith("https://")) {
      throw new Refused(`redirected to ${next}, which is not https`);
    }
    at = next;
  }
  throw new Refused(`more than ${String(MAX_REDIRECTS)} redirects`);
};

/** The bytes of `url`, retried once, within `deadline` (an epoch ms); throws a message naming the cause. */
const download = async (url, { fetch, sleep, deadline, now }) => {
  let cause = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) {
      await sleep(RETRY_MS);
    }
    const left = deadline - now();
    if (left <= 0) {
      throw new Error(`${cause === "" ? "" : `${cause}; then `}the deadline of all downloads passed`);
    }
    try {
      const response = await request(url, {
        fetch,
        signal: globalThis.AbortSignal.timeout(Math.min(TIMEOUT_MS, left)),
      });
      if (!response.ok) {
        cause = `HTTP ${String(response.status)}`;
        continue;
      }
      return {
        bytes: Buffer.from(await response.arrayBuffer()),
        type: response.headers.get("content-type") ?? "none",
      };
    } catch (error) {
      if (error instanceof Refused) {
        throw error;
      }
      cause = error?.cause?.code ?? error?.name ?? String(error);
    }
  }
  // A timeout signal can fire a moment before the clock reaches the deadline, so the last attempt may
  // start with time left and still end at the deadline: name the deadline whenever it has passed.
  throw new Error(deadline - now() <= 0 ? `${cause}; then the deadline of all downloads passed` : cause);
};

/** Brings one file into `dir`; gives its `::error` line, or undefined when it is there and checked. */
const one = async ({ name, url, sha256: expected }, dir, options) => {
  const target = path.join(dir, name);
  if (!options.fresh && fs.existsSync(target) && sha256(fs.readFileSync(target)) === expected) {
    return undefined;
  }
  let got;
  try {
    got = await download(url, options);
  } catch (error) {
    return annotation(
      "ReqIF XSD download failed",
      `${name} from ${url}: ${error.message}. Re-run the job once (the server may have been busy). If it fails again, open the URL in a browser: if the file moved, change only its url in toolchain/reqif/xsd.json (the hash stays); if its content changed, the hash check says so.`,
    );
  }
  const actual = sha256(got.bytes);
  if (actual !== expected) {
    fs.rmSync(target, { force: true });
    const start = got.bytes
      .subarray(0, 64)
      .toString("latin1")
      .replace(/[^\x20-\x7e]/g, ".");
    return annotation(
      "ReqIF XSD hash mismatch",
      `${name} from ${url} changed upstream, or the server sent something else: expected SHA-256 ${expected}, got ${actual} (${String(got.bytes.length)} bytes, content type ${got.type}, starts with "${start}"). The pins are in toolchain/reqif/xsd.sha256; they change only with the product owner's confirmation.`,
    );
  }
  fs.writeFileSync(target, got.bytes);
  return undefined;
};

/**
 * Brings every file of `files` into `dir` with its pinned hash, `PARALLEL` at a time within `deadlineMs`.
 * Each problem goes to `report` when it is found; gives them all, empty when every file is there and checked.
 */
export const fetchXsds = async (
  files,
  dir,
  {
    fresh = false,
    fetch = globalThis.fetch,
    sleep = delay,
    now = Date.now,
    deadlineMs = DEADLINE_MS,
    report = () => {},
  } = {},
) => {
  fs.mkdirSync(dir, { recursive: true });
  const options = { fresh, fetch, sleep, now, deadline: now() + deadlineMs };
  const problems = [];
  const queue = [...files];
  const worker = async () => {
    for (let file = queue.shift(); file !== undefined; file = queue.shift()) {
      const problem = await one(file, dir, options);
      if (problem !== undefined) {
        problems.push(problem);
        report(problem);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(PARALLEL, files.length) }, worker));
  return problems;
};

/** The command line: `<dir> [--fresh]`; gives the exit code. */
export const main = async (
  args,
  { fetch, sleep, log = console.log, manifest = MANIFEST, pins = PINS } = {},
) => {
  const dir = args.find((arg) => !arg.startsWith("--"));
  if (dir === undefined) {
    log("Usage: node scripts/reqif-xsd/fetch.mjs <dir> [--fresh]");
    return 2;
  }
  const planned = plan(JSON.parse(fs.readFileSync(manifest, "utf8")), fs.readFileSync(pins, "utf8"));
  for (const problem of planned.problems) {
    log(problem);
  }
  if (planned.problems.length > 0) {
    return 1;
  }
  const problems = await fetchXsds(planned.files, dir, {
    fresh: args.includes("--fresh"),
    ...(fetch === undefined ? {} : { fetch }),
    ...(sleep === undefined ? {} : { sleep }),
    report: log,
  });
  if (problems.length > 0) {
    return 1;
  }
  log(`${String(planned.files.length)} ReqIF XSDs in ${dir}, each with its pinned SHA-256.`);
  return 0;
};

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
