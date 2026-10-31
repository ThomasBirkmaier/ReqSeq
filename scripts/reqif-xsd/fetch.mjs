#!/usr/bin/env node
// Downloads the ReqIF 1.2 XSDs of toolchain/reqif/xsd.json into a folder and checks each against its
// SHA-256 in toolchain/reqif/xsd.sha256 (product owner decision, 2026-10-31: the XSDs are never in the
// repository; CI downloads them before the tests, pinned, cache first). CI tooling only: it runs before
// the network-blocked tests and is never part of ReqSeq, which opens no connection.
//
//   node scripts/reqif-xsd/fetch.mjs <dir> [--fresh]
//
// A file already in <dir> with the pinned hash is kept (the CI cache); --fresh downloads every file
// (the nightly upstream check). Each failure is one `::error` annotation, and the exit code is 1.
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const MANIFEST = path.join(ROOT, "toolchain/reqif/xsd.json");
export const PINS = path.join(ROOT, "toolchain/reqif/xsd.sha256");
const TIMEOUT_MS = 20_000;
const RETRY_MS = 5_000;

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** A GitHub workflow command `::error` with its message escaped. */
export const annotation = (title, message) =>
  `::error title=${title}::${message.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A")}`;

/**
 * The files to fetch: `manifest` is the parsed xsd.json, `pins` the text of xsd.sha256 (`<sha256>  <name>`
 * per line, as sha256sum writes it; `#` starts a comment line). Gives the files with their hash, or the reasons the two do not fit.
 */
export const plan = (manifest, pins) => {
  const problems = [];
  const hashes = new Map();
  for (const line of pins
    .split(/\r?\n/)
    .filter((text) => text.trim() !== "" && !text.trimStart().startsWith("#"))) {
    const match = /^([0-9a-f]{64}) [ *](\S+)$/.exec(line.trim());
    if (match === null) {
      problems.push(
        annotation(
          "ReqIF XSD not pinned",
          `toolchain/reqif/xsd.sha256 has no SHA-256 for the XSDs yet ("${line.trim()}"). The product owner confirms them once (stage epic); until then CI cannot check the ReqIF XSDs.`,
        ),
      );
      return { files: [], problems };
    }
    hashes.set(match[2], match[1]);
  }
  const names = new Set();
  const files = [];
  for (const { name, url } of manifest.files) {
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

/** The bytes of `url`, retried once; throws a message that names the URL and the cause. */
const download = async (url, { fetch, sleep }) => {
  let cause = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) {
      await sleep(RETRY_MS);
    }
    try {
      const response = await fetch(url, {
        redirect: "follow",
        signal: globalThis.AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!String(response.url || url).startsWith("https://")) {
        throw new Error(`redirected to ${response.url}, which is not https`);
      }
      if (!response.ok) {
        cause = `HTTP ${String(response.status)}`;
        continue;
      }
      return {
        bytes: Buffer.from(await response.arrayBuffer()),
        type: response.headers.get("content-type") ?? "none",
      };
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("redirected to")) {
        throw error;
      }
      cause = error?.cause?.code ?? error?.name ?? String(error);
    }
  }
  throw new Error(cause);
};

/**
 * Brings every file of `files` into `dir` with its pinned hash. Gives the `::error` lines of what failed;
 * empty means every file is there and checked.
 */
export const fetchXsds = async (files, dir, { fresh = false, fetch = globalThis.fetch, sleep } = {}) => {
  const wait = sleep ?? delay;
  fs.mkdirSync(dir, { recursive: true });
  const problems = [];
  for (const { name, url, sha256: expected } of files) {
    const target = path.join(dir, name);
    if (!fresh && fs.existsSync(target) && sha256(fs.readFileSync(target)) === expected) {
      continue;
    }
    let got;
    try {
      got = await download(url, { fetch, sleep: wait });
    } catch (error) {
      problems.push(
        annotation(
          "ReqIF XSD download failed",
          `${name} from ${url}: ${error.message}. Re-run the job once (the server may have been busy). If it fails again, open the URL in a browser: if the file moved, change only its url in toolchain/reqif/xsd.json (the hash stays); if its content changed, the hash check says so.`,
        ),
      );
      continue;
    }
    const actual = sha256(got.bytes);
    if (actual !== expected) {
      const start = got.bytes
        .subarray(0, 64)
        .toString("latin1")
        .replace(/[^\x20-\x7e]/g, ".");
      problems.push(
        annotation(
          "ReqIF XSD hash mismatch",
          `${name} from ${url} changed upstream, or the server sent something else: expected SHA-256 ${expected}, got ${actual} (${String(got.bytes.length)} bytes, content type ${got.type}, starts with "${start}"). The pins are in toolchain/reqif/xsd.sha256; they change only with the product owner's confirmation.`,
        ),
      );
      fs.rmSync(target, { force: true });
      continue;
    }
    fs.writeFileSync(target, got.bytes);
  }
  return problems;
};

/** The command line: `<dir> [--fresh]`; gives the exit code. */
export const main = async (
  args,
  { fetch = globalThis.fetch, sleep, log = console.log, manifest = MANIFEST, pins = PINS } = {},
) => {
  const dir = args.find((arg) => !arg.startsWith("--"));
  if (dir === undefined) {
    log("Usage: node scripts/reqif-xsd/fetch.mjs <dir> [--fresh]");
    return 2;
  }
  const planned = plan(JSON.parse(fs.readFileSync(manifest, "utf8")), fs.readFileSync(pins, "utf8"));
  const problems = [
    ...planned.problems,
    ...(planned.problems.length === 0
      ? await fetchXsds(planned.files, dir, { fresh: args.includes("--fresh"), fetch, sleep })
      : []),
  ];
  for (const problem of problems) {
    log(problem);
  }
  if (problems.length === 0) {
    log(`${String(planned.files.length)} ReqIF XSDs in ${dir}, each with its pinned SHA-256.`);
  }
  return problems.length === 0 ? 0 : 1;
};

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
