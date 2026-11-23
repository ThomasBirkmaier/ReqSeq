#!/usr/bin/env node
// Adds the test suites of one JUnit file to another (delivery-tests.sh, #2379): the run of SR-252 AK8 after the web
// engine is removed joins the file of the delivery tests, which evidence.yml reads as the one file of its artifact.
//
//   node scripts/package/merge-junit.mjs <into> <from>   a missing <from> leaves <into> as it is
import fs from "node:fs";
import { pathToFileURL } from "node:url";

/** The counts of the root element that are sums of its suites. */
const COUNTS = ["tests", "failures", "errors", "skipped"];

/** The value of the attribute `name` of the XML start tag `tag`, as a number (0 without it). */
const countOf = (tag, name) => Number(new RegExp(`\\s${name}="(\\d+)"`).exec(tag)?.[1] ?? 0);

/** `into` with the `<testsuite>` elements of `from` before its closing `</testsuites>`, and the root's counts summed. */
export function mergeJunit(into, from) {
  const suites = [...from.matchAll(/<testsuite[\s>][\s\S]*?<\/testsuite>/g)].map((m) => m[0]);
  const end = into.lastIndexOf("</testsuites>");
  if (end < 0) {
    throw new Error("no </testsuites> in the JUnit file to merge into");
  }
  const merged = `${into.slice(0, end)}${suites.map((s) => `    ${s}\n`).join("")}${into.slice(end)}`;
  const root = /<testsuites\b[^>]*>/;
  const intoRoot = root.exec(into)?.[0] ?? "";
  const fromRoot = root.exec(from)?.[0] ?? "";
  let tag = intoRoot;
  for (const name of COUNTS) {
    if (new RegExp(`\\s${name}="\\d+"`).test(tag)) {
      tag = tag.replace(
        new RegExp(`(\\s${name}=")\\d+"`),
        `$1${String(countOf(intoRoot, name) + countOf(fromRoot, name))}"`,
      );
    }
  }
  return merged.replace(intoRoot, () => tag);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const [into, from] = process.argv.slice(2);
  if (into === undefined || from === undefined) {
    console.error("usage: node scripts/package/merge-junit.mjs <into> <from>");
    process.exit(2);
  }
  if (fs.existsSync(from)) {
    fs.writeFileSync(into, mergeJunit(fs.readFileSync(into, "utf8"), fs.readFileSync(from, "utf8")));
  }
}
