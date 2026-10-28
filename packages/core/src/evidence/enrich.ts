// Enriching a JUnit XML file (SR-029, ADR-0012 "JUnit XML", "Enriching"): `evidence.enrichJunit` adds
// to each test case that names a requirement the UUID, the current version, the item (Prüfling) and
// the date, so that the JUnit reader (SR-093) assigns it without further input (AK3).
//
// - References: every `logreq:element` property in file order, then the name tokens of the test case
//   (`elementRefsOf`). A property is an explicit statement: one that names no element or more than
//   one is reported. A name token of the form of a short ID or UUID is reported the same way; any
//   other name token (an identifier such as `[SR-036]`, a pytest parameter list) counts only when it
//   names exactly one element. Elements named twice count once.
// - A test case with a reported reference stays unchanged and is listed (AK2, spec question #529 Q1);
//   the others are enriched and the file is written.
// - A test case that already has a `logreq:version` is never changed: its version is the one it was
//   tested against (D-026, spec question #529 Q5, assumption "keep"). A kept version that is no longer
//   current gives `evidence.outdated` (warning); one the reader rejects `evidence.invalid-record`.
// - The bytes are spliced at the offsets of the JUnit model, so every other byte stays (BOM, CRLF,
//   comments, CDATA, layout). The result is read back with the reader's checks before it is written
//   (ADR-0007 pattern): a difference is `internal`, and nothing is written.
// - Writing (ADR-0002 rule 5): the input in place, or `output`; an existing `output` only when it is a
//   JUnit file; never below a `.git` folder (D-036); through `writeFileAtomic` with the `xml` guard.
import fs from "node:fs/promises";
import path from "node:path";
import type { Problem } from "../catalog.js";
import { CommandError } from "../catalog.js";
import { readFileSnapshot, shown, writeFileAtomic, zip } from "../files/index.js";
import type { FileSnapshot } from "../files/index.js";
import type { EvidenceEnrichJunitInput, EvidenceEnrichJunitOutput } from "../generated/types.js";
import type { ElementRecord } from "../model/index.js";
import { currentVersionsOf, elementStoreState, resolveRef, shortIdState } from "../model/index.js";
import { fileSchemaValidator } from "../runtime/contracts.js";
import type { Workspace } from "../runtime/workspace.js";
import type { WorkspaceLayout } from "../workspace/index.js";
import { refuseGit, shownPath, workspaceLayoutState } from "../workspace/index.js";
import { enrichmentOf } from "./junit.js";
import type { JunitProperty, JunitTestCase } from "./junit-model.js";
import { elementRefsOf, junitTestCases } from "./junit-model.js";
import { evidenceReadState } from "./state.js";

const ELEMENT = "logreq:element";
const VERSION = "logreq:version";
const ITEM = "logreq:item";
const DATE = "logreq:date";
const VARIANT = "logreq:variant";

/** What a reference names (`resolveRef` without the throw). */
export type RefResolution =
  | { readonly kind: "found"; readonly id: string }
  | { readonly kind: "unknown" }
  /** `candidates`: each element it names, for the message. */
  | { readonly kind: "ambiguous"; readonly candidates: readonly string[] };

/** The current version of an element, or why it has none (`CurrentVersion`). */
export type VersionLookup =
  | { readonly kind: "version"; readonly version: string }
  | { readonly kind: "unknown"; readonly message: string };

/** One reported reference (`unknown` of the output). */
export interface UnknownRef {
  readonly testCase: string;
  readonly className?: string;
  readonly line: number;
  readonly ref: string;
}

export interface EnrichOptions {
  /** What a reference names (a short ID, a UUID, an identifier, any text). */
  readonly resolve: (ref: string) => RefResolution;
  /** The current versions of the elements by UUID; called once, with each element once. */
  readonly versionsOf: (ids: readonly string[]) => Promise<ReadonlyMap<string, VersionLookup>>;
  readonly item: string;
  /** The given date; else the fallback (`dateFor`). */
  readonly date?: string | undefined;
  /** The time of the call, for the last fallback of the date. */
  readonly now: () => Date;
  /** The base name of the file, for error messages (ADR-0009). */
  readonly name: string;
  /** The file as problems name it (relative to the workspace root, or absolute). */
  readonly file: string;
  /** Appended to the message of an unknown reference, e.g. that a repository is not on this machine. */
  readonly unknownNote?: string;
}

export interface EnrichResult {
  /** The new bytes; the input itself when nothing changed. */
  readonly bytes: Uint8Array;
  readonly changed: boolean;
  /** Test cases that name an element and are enriched, by this call or before. */
  readonly testCases: number;
  readonly unknown: readonly UnknownRef[];
  readonly problems: readonly Problem[];
}

const isDateTime = (value: string): boolean =>
  fileSchemaValidator("common.schema.json#/$defs/dateTime")(value);

const isUuidText = (value: string): boolean =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value.toLowerCase());

/** `value` escaped for element text: `&`, `<`, `>` and a carriage return (which XML would turn into a line feed). */
export const escapeText = (value: string): string =>
  value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll("\r", "&#13;");

/**
 * `value` escaped for an attribute in `quote`: as text, plus the quote, and tab and line feed as
 * character references, so they survive attribute value normalisation.
 */
export const escapeAttribute = (value: string, quote: '"' | "'"): string =>
  escapeText(value)
    .replaceAll(quote, quote === '"' ? "&quot;" : "&apos;")
    .replaceAll("\t", "&#9;")
    .replaceAll("\n", "&#10;");

/** A change of the file: the bytes from `start` to `end` replaced by `text` (an insertion when equal). */
interface Splice {
  readonly start: number;
  readonly end: number;
  readonly text: string;
  /** Order of splices at the same offset. */
  readonly seq: number;
}

/** What one test case gives. */
type Plan =
  | { readonly kind: "none" }
  | { readonly kind: "kept"; readonly testCase: JunitTestCase; readonly pairs: ReadonlyMap<string, string> }
  | { readonly kind: "invalid"; readonly testCase: JunitTestCase; readonly reason: string }
  | {
      readonly kind: "reported";
      readonly testCase: JunitTestCase;
      readonly refs: readonly Reported[];
    }
  | {
      readonly kind: "enrich";
      readonly testCase: JunitTestCase;
      /** The `logreq:element` properties and the element each names, in file order. */
      readonly named: readonly { readonly property: JunitProperty; readonly id: string }[];
      /** Elements only the name names, to append. */
      readonly added: readonly string[];
    };

const testCaseText = (testCase: JunitTestCase): string =>
  `Test case "${shown(testCase.name)}" (line ${String(testCase.line)})`;

const nameOf = (testCase: JunitTestCase): Pick<UnknownRef, "testCase" | "className" | "line"> => ({
  testCase: testCase.name,
  ...(testCase.className === "" ? {} : { className: testCase.className }),
  line: testCase.line,
});

/** The trimmed values of the properties named `name`. */
const valuesOf = (testCase: JunitTestCase, name: string): string[] =>
  testCase.properties.filter((p) => p.name === name).map((p) => p.value.trim());

/** Why an existing `logreq:variant` does not fit (enrich writes none, S2), or undefined. */
const variantProblem = (testCase: JunitTestCase): string | undefined => {
  const variants = valuesOf(testCase, VARIANT);
  const wrong = variants.find((v) => !isUuidText(v));
  if (wrong !== undefined) {
    return `${VARIANT} "${shown(wrong)}" is not a UUID`;
  }
  return new Set(variants.map((v) => v.toLowerCase())).size > 1
    ? `${VARIANT} is given with different values`
    : undefined;
};

/** A reference that names no element or more than one, with what it names. */
interface Reported {
  readonly ref: string;
  readonly resolution: RefResolution;
}

/**
 * The elements only the name of `testCase` names, each once and none a property names already
 * (`named`). A short ID or UUID token that names no element or several is added to `reported`,
 * unless a property reported it already; any other token counts only when it names exactly one.
 */
const nameElements = (
  testCase: JunitTestCase,
  resolve: EnrichOptions["resolve"],
  named: readonly string[],
  reported: Reported[],
): string[] => {
  const added: string[] = [];
  for (const token of elementRefsOf(testCase).filter((t) => t.source === "name")) {
    const resolution = resolve(token.text);
    if (resolution.kind === "found") {
      if (!named.includes(resolution.id) && !added.includes(resolution.id)) {
        added.push(resolution.id);
      }
    } else if (token.kind !== "other" && !reported.some((r) => r.ref === token.text)) {
      reported.push({ ref: token.text, resolution });
    }
  }
  return added;
};

/** What `testCase` gives (see the file comment). */
const planOf = (testCase: JunitTestCase, resolve: EnrichOptions["resolve"]): Plan => {
  if (testCase.properties.some((p) => p.name === VERSION)) {
    const enrichment = enrichmentOf(testCase);
    return "error" in enrichment
      ? { kind: "invalid", testCase, reason: enrichment.error }
      : { kind: "kept", testCase, pairs: enrichment.pairs };
  }
  const reported: Reported[] = [];
  const named: { property: JunitProperty; id: string }[] = [];
  // Each property on its own (a repeated property gets its own version), the raw value trimmed.
  for (const property of testCase.properties.filter((p) => p.name === ELEMENT)) {
    const ref = property.value.trim();
    const resolution: RefResolution = ref === "" ? { kind: "unknown" } : resolve(ref);
    if (resolution.kind === "found") {
      named.push({ property, id: resolution.id });
    } else {
      reported.push({ ref, resolution });
    }
  }
  const added = nameElements(
    testCase,
    resolve,
    named.map((n) => n.id),
    reported,
  );
  if (reported.length > 0) {
    return { kind: "reported", testCase, refs: reported };
  }
  if (named.length === 0 && added.length === 0) {
    return { kind: "none" };
  }
  const variant = variantProblem(testCase);
  return variant === undefined
    ? { kind: "enrich", testCase, named, added }
    : { kind: "invalid", testCase, reason: variant };
};

/** The message of a reported reference (N2: the test case, its line, the reference). */
const reportedMessage = (
  testCase: JunitTestCase,
  ref: string,
  resolution: RefResolution,
  note: string,
): string => {
  const what = ref === "" ? `an empty ${ELEMENT} property` : `"${shown(ref)}"`;
  return resolution.kind === "ambiguous"
    ? `${testCaseText(testCase)}: ${what} names more than one element (${resolution.candidates.join(", ")}); give the full UUID`
    : `${testCaseText(testCase)}: no element has the reference ${what}${note}`;
};

/** The date a test case gets: given, else its own valid one, else the suite's with time zone, else now. */
const dateFor = (testCase: JunitTestCase, options: EnrichOptions): string => {
  if (options.date !== undefined) {
    return options.date;
  }
  const own = valuesOf(testCase, DATE);
  const [first] = own;
  if (first !== undefined && own.every((d) => d === first) && isDateTime(first)) {
    return first;
  }
  const suite = testCase.timestamp?.trim();
  return suite !== undefined && isDateTime(suite) ? suite : options.now().toISOString();
};

/**
 * What goes before a new property after `anchor`: the line ending and indentation of the anchor's line
 * when it stands on a line of its own (only spaces and tabs before it), else nothing (inline). Looks
 * back only to the start of that line or the first other byte, never at the whole file.
 */
const separatorAfter = (bytes: Uint8Array, anchor: JunitProperty): string => {
  // bytes[-1] is undefined, so the loop ends at the start of the file too.
  for (let i = anchor.start - 1; ; i -= 1) {
    const byte = bytes[i];
    if (byte === 0x0a) {
      const eol = bytes[i - 1] === 0x0d ? "\r\n" : "\n";
      return eol + Buffer.from(bytes.subarray(i + 1, anchor.start)).toString("latin1");
    }
    if (byte !== 0x20 && byte !== 0x09) {
      return "";
    }
  }
};

/** What enriching one test case changes; the splices are numbered from `seq`. */
const splicesOf = (
  bytes: Uint8Array,
  plan: Extract<Plan, { kind: "enrich" }>,
  versions: readonly string[],
  item: string,
  date: string,
): Splice[] => {
  const { testCase, named, added } = plan;
  const splices: Omit<Splice, "seq">[] = [];
  const property = (name: string, value: string): string =>
    `<property name="${name}" value="${escapeAttribute(value, '"')}"/>`;
  /** Replaces the value of `existing` in place by `value`, unless it is that already. */
  const replace = (existing: JunitProperty, name: string, value: string): void => {
    if (existing.value === value) {
      return;
    }
    const at = existing.valueAt;
    if (at === undefined) {
      splices.push({ start: existing.start, end: existing.end, text: property(name, value) });
    } else {
      const text = at.quote === undefined ? escapeText(value) : escapeAttribute(value, at.quote);
      splices.push({ start: at.start, end: at.end, text });
    }
  };
  for (const { property: existing, id } of named) {
    replace(existing, ELEMENT, id);
  }
  /** New properties; those for `propertiesAt` are collected in `rest`. */
  const rest: string[] = [];
  const lastElement = named.at(-1)?.property;
  if (lastElement === undefined) {
    rest.push(...added.map((id) => property(ELEMENT, id)));
  } else if (added.length > 0) {
    const separator = separatorAfter(bytes, lastElement);
    splices.push({
      start: lastElement.end,
      end: lastElement.end,
      text: added.map((id) => separator + property(ELEMENT, id)).join(""),
    });
  }
  rest.push(...versions.map((version) => property(VERSION, version)));
  for (const [name, value] of [
    [ITEM, item],
    [DATE, date],
  ] as const) {
    const existing = testCase.properties.filter((p) => p.name === name);
    if (existing.length === 0) {
      rest.push(property(name, value));
    }
    for (const p of existing) {
      replace(p, name, value);
    }
  }
  const at = testCase.propertiesAt;
  const block = `<properties>${rest.join("")}</properties>`;
  switch (at.kind) {
    case "append": {
      const anchor = testCase.properties.filter((p) => p.end <= at.offset).at(-1);
      const separator = anchor === undefined ? "" : separatorAfter(bytes, anchor);
      const offset = anchor?.end ?? at.offset;
      splices.push({ start: offset, end: offset, text: rest.map((p) => separator + p).join("") });
      break;
    }
    case "open-properties":
      splices.push({ start: at.start, end: at.end, text: `>${rest.join("")}</properties>` });
      break;
    case "new-block":
      splices.push({ start: at.offset, end: at.offset, text: block });
      break;
    case "open-testcase":
      splices.push({ start: at.start, end: at.end, text: `>${block}</testcase>` });
      break;
  }
  return splices.map((s, i) => ({ ...s, seq: i }));
};

/**
 * `bytes` with `splices` applied, built with one concatenation (S5), and where each offset of `bytes`
 * lies in the result (`moved`: the offset plus what the splices before it added or removed; it is
 * called with offsets in ascending order).
 */
const applySplices = (
  bytes: Uint8Array,
  splices: readonly Splice[],
): { readonly bytes: Uint8Array; readonly moved: (offset: number) => number } => {
  const sorted = [...splices].sort((a, b) => a.start - b.start || a.seq - b.seq);
  const parts: Uint8Array[] = [];
  /** What each splice adds (or removes, negative), by its start. */
  const deltas: { readonly start: number; readonly delta: number }[] = [];
  let at = 0;
  // The splices lie in distinct properties and insertion points, so they never overlap; the read-back
  // check would refuse the result if they did.
  for (const splice of sorted) {
    const text = Buffer.from(splice.text, "utf8");
    parts.push(bytes.subarray(at, splice.start), text);
    deltas.push({ start: splice.start, delta: text.byteLength - (splice.end - splice.start) });
    at = splice.end;
  }
  parts.push(bytes.subarray(at));
  const pending = deltas.values();
  let next = pending.next();
  let total = 0;
  const moved = (offset: number): number => {
    while (next.done !== true && next.value.start < offset) {
      total += next.value.delta;
      next = pending.next();
    }
    return offset + total;
  };
  return { bytes: Buffer.concat(parts), moved };
};

/** What a test case enriched by this call must read back as, and where it lies in the file as read. */
export interface Intended {
  readonly name: string;
  readonly className: string;
  readonly outcome: JunitTestCase["outcome"];
  /** The `<` of `<testcase` and the byte after the test case, in the file as read. */
  readonly start: number;
  readonly end: number;
  readonly pairs: ReadonlyMap<string, string>;
  readonly item: string;
  readonly date: string;
}

const NOT_READ_BACK = "Enrich produced a file that does not read back; nothing written";

const SUITE_START = Buffer.from("<testsuite>");
const SUITE_END = Buffer.from("</testsuite>");

/**
 * Whether `testCase`, the bytes of one enriched `<testcase>` element of the result, reads back as
 * `wanted` says: one test case with the same name, class name and outcome that gives exactly the
 * intended pairs, item and date by the reader's checks (`enrichmentOf`).
 */
export const readsBackAs = (testCase: Uint8Array, wanted: Intended): boolean => {
  const read = junitTestCases(Buffer.concat([SUITE_START, testCase, SUITE_END]));
  const cases = read.kind === "junit" ? read.file.testCases : [];
  const [a] = cases;
  if (
    cases.length !== 1 ||
    a?.name !== wanted.name ||
    a.className !== wanted.className ||
    a.outcome !== wanted.outcome
  ) {
    return false;
  }
  const got = enrichmentOf(a);
  return (
    !("error" in got) &&
    got.item === wanted.item.trim() &&
    got.date === wanted.date &&
    got.pairs.size === wanted.pairs.size &&
    [...wanted.pairs].every(([id, version]) => got.pairs.get(id) === version)
  );
};

/**
 * Reads the result back (B3 of the plan review) without a model of the whole result (S1 of the PR
 * review): the bytes outside the enriched test cases must be those of `input` (the file as read, which
 * scanned), so the test cases not to be enriched are unchanged (N1), and each enriched `<testcase>`
 * element must read back as intended (`readsBackAs`). `intended` is in file order; `moved` gives where
 * an offset of `input` lies in `out` and is called with offsets in ascending order. Throws `internal`
 * on any difference.
 */
export const checkReadBack = (
  input: Uint8Array,
  out: Uint8Array,
  moved: (offset: number) => number,
  intended: readonly Intended[],
): void => {
  const same = (a: Uint8Array, b: Uint8Array): void => {
    if (Buffer.compare(a, b) !== 0) {
      throw new CommandError("internal", NOT_READ_BACK);
    }
  };
  let from = 0;
  let outFrom = 0;
  for (const wanted of intended) {
    const start = moved(wanted.start);
    same(input.subarray(from, wanted.start), out.subarray(outFrom, start));
    const end = moved(wanted.end);
    if (!readsBackAs(out.subarray(start, end), wanted)) {
      throw new CommandError("internal", NOT_READ_BACK);
    }
    from = wanted.end;
    outFrom = end;
  }
  same(input.subarray(from), out.subarray(outFrom));
};

/** A problem of a test case: it has the line of the `<testcase>`. */
type LinedProblem = Problem & { readonly line: number };

/** What the test cases of a file give, put together. */
interface Outcome {
  readonly unknown: UnknownRef[];
  readonly problems: LinedProblem[];
  readonly splices: Splice[];
  readonly intended: Intended[];
  count: number;
}

/** What the plans need: the lookups and the values, for `addPlan`. */
interface Context {
  readonly bytes: Uint8Array;
  readonly options: EnrichOptions;
  readonly resolutions: ReadonlyMap<string, RefResolution>;
  readonly versions: ReadonlyMap<string, VersionLookup>;
  readonly where: { readonly file: string };
}

/** The elements a plan names: those to enrich, or the UUIDs a kept test case gives. */
const idsOf = (plan: Extract<Plan, { kind: "enrich" | "kept" }>): readonly string[] =>
  plan.kind === "enrich" ? [...plan.named.map((n) => n.id), ...plan.added] : [...plan.pairs.keys()];

/** Adds what enriching one planned test case gives to `outcome`. */
const addEnriched = (outcome: Outcome, plan: Extract<Plan, { kind: "enrich" }>, context: Context): void => {
  const ids = idsOf(plan);
  const lookups = ids.map((id) => ({ id, entry: context.versions.get(id) }));
  const current = lookups.flatMap(({ entry }) => (entry?.kind === "version" ? [entry.version] : []));
  if (current.length < ids.length) {
    for (const { id, entry } of lookups) {
      if (entry?.kind !== "version") {
        outcome.problems.push({
          code: "file.faulty",
          severity: "error",
          ...context.where,
          line: plan.testCase.line,
          elementId: id,
          message: `${testCaseText(plan.testCase)} is not enriched: element ${id} has no current version (${entry?.message ?? "it is not in the workspace"})`,
        });
      }
    }
    return;
  }
  const { options } = context;
  const date = dateFor(plan.testCase, options);
  const own = splicesOf(context.bytes, plan, current, options.item, date);
  const base = outcome.splices.length;
  outcome.splices.push(...own.map((s) => ({ ...s, seq: base + s.seq })));
  const { name, className, start, end } = plan.testCase;
  outcome.intended.push({
    name,
    className,
    outcome: plan.testCase.outcome,
    start,
    end,
    pairs: new Map(zip(ids, current)),
    item: options.item,
    date,
  });
  outcome.count += 1;
};

/** Adds what one planned test case gives to `outcome`. */
const addPlan = (outcome: Outcome, plan: Plan, context: Context): void => {
  const { where, options } = context;
  switch (plan.kind) {
    case "none":
      return;
    case "invalid":
      outcome.problems.push({
        code: "evidence.invalid-record",
        severity: "error",
        ...where,
        line: plan.testCase.line,
        message: `${testCaseText(plan.testCase)} is not enriched: ${plan.reason}`,
      });
      return;
    case "reported":
      for (const { ref, resolution } of plan.refs) {
        outcome.unknown.push({ ...nameOf(plan.testCase), ref });
        outcome.problems.push({
          code: resolution.kind === "ambiguous" ? "evidence.ambiguous-element" : "evidence.unknown-element",
          severity: "error",
          ...where,
          line: plan.testCase.line,
          message: reportedMessage(plan.testCase, ref, resolution, options.unknownNote ?? ""),
        });
      }
      return;
    case "kept":
      outcome.count += 1;
      outcome.problems.push(...keptProblems(plan, context));
      return;
    case "enrich":
      addEnriched(outcome, plan, context);
  }
};

/** Problems by line, stable (problems of one test case keep their order). */
const byLine = (problems: readonly LinedProblem[]): Problem[] =>
  [...problems].sort((a, b) => a.line - b.line);

/** What planning a file gives: the result, the splices, and what the read-back checks. */
interface Planned {
  readonly result: Omit<EnrichResult, "bytes" | "changed">;
  readonly splices: readonly Splice[];
  readonly intended: readonly Intended[];
}

/**
 * Reads and plans the file. Its JUnit model lives only in this call, so it can be freed before the
 * result is read back (S1 of the PR review).
 */
const planFile = async (bytes: Uint8Array, options: EnrichOptions): Promise<Planned> => {
  const read = junitTestCases(bytes);
  if (read.kind === "invalid") {
    throw new CommandError(
      "file.faulty",
      `Not enriched: ${options.name} is no readable XML (line ${String(read.line)}): ${read.message}`,
      { file: options.name, line: read.line },
    );
  }
  if (read.kind === "not-junit") {
    throw new CommandError(
      "input.invalid",
      `${options.name} is not a JUnit XML file: its root is <${shown(read.root)}>, not <testsuites> or <testsuite>`,
      { file: options.name, reason: "not-junit" },
    );
  }
  const testCases = read.file.testCases;
  const plans = testCases.map((testCase) => planOf(testCase, options.resolve));
  // The UUIDs of kept test cases are looked up too, to tell whether their versions are current.
  const resolutions = new Map<string, RefResolution>();
  for (const plan of plans.filter((p) => p.kind === "kept")) {
    for (const id of idsOf(plan)) {
      resolutions.set(id, resolutions.get(id) ?? options.resolve(id));
    }
  }
  const wanted = new Set(plans.filter((p) => p.kind === "enrich").flatMap(idsOf));
  for (const resolution of resolutions.values()) {
    if (resolution.kind === "found") {
      wanted.add(resolution.id);
    }
  }
  const versions =
    wanted.size === 0 ? new Map<string, VersionLookup>() : await options.versionsOf([...wanted]);
  const context: Context = { bytes, options, resolutions, versions, where: { file: options.file } };
  const outcome: Outcome = { unknown: [], problems: [], splices: [], intended: [], count: 0 };
  for (const plan of plans) {
    addPlan(outcome, plan, context);
  }
  return {
    result: { testCases: outcome.count, unknown: outcome.unknown, problems: byLine(outcome.problems) },
    splices: outcome.splices,
    intended: outcome.intended,
  };
};

/**
 * Enriches the bytes of a JUnit XML file (see the file comment). Pure apart from the injected
 * lookups: reads and writes no file. Throws `file.faulty` for a file the XML scanner refuses,
 * `input.invalid` for XML that is no JUnit file, `internal` when the result does not read back.
 */
export const enrichJunitBytes = async (bytes: Uint8Array, options: EnrichOptions): Promise<EnrichResult> => {
  const { result, splices, intended } = await planFile(bytes, options);
  if (splices.length === 0) {
    return { bytes, changed: false, ...result };
  }
  const out = applySplices(bytes, splices);
  checkReadBack(bytes, out.bytes, out.moved, intended);
  return { bytes: out.bytes, changed: true, ...result };
};

/**
 * What a kept test case gives (B1): `evidence.outdated` (warning) for a kept version that is no
 * longer current, `evidence.unknown-element` or `evidence.ambiguous-element` (warning) for a UUID
 * that names no element or several, as `workspace.check` reports them.
 */
const keptProblems = (
  plan: Extract<Plan, { kind: "kept" }>,
  { resolutions, versions, where }: Context,
): LinedProblem[] =>
  [...plan.pairs].flatMap(([uuid, stored]): LinedProblem[] => {
    const resolution = resolutions.get(uuid);
    const line = plan.testCase.line;
    if (resolution?.kind !== "found") {
      return [
        {
          code: resolution?.kind === "ambiguous" ? "evidence.ambiguous-element" : "evidence.unknown-element",
          severity: "warning",
          ...where,
          line,
          targetId: uuid,
          message: `${testCaseText(plan.testCase)} is enriched already and names element ${uuid}, which ${resolution?.kind === "ambiguous" ? "several files share" : "the workspace does not have"}; it is kept as it is`,
        },
      ];
    }
    const current = versions.get(resolution.id);
    return current?.kind === "version" && current.version !== stored
      ? [
          {
            code: "evidence.outdated",
            severity: "warning",
            ...where,
            line,
            elementId: resolution.id,
            storedVersion: stored,
            currentVersion: current.version,
            message: `${testCaseText(plan.testCase)} is enriched already with version ${stored}, which is no longer current; it is kept (D-026: the version it was tested against)`,
          },
        ]
      : [];
  });

/** The real folder of `file`; `file.folder-missing` when it does not exist. */
const realFolder = async (file: string): Promise<string> => {
  try {
    return await fs.realpath(path.dirname(file));
  } catch {
    throw new CommandError(
      "file.folder-missing",
      `Not written: the folder of ${path.basename(file)} does not exist`,
      { file: path.basename(file) },
    );
  }
};

/** The input file: its bytes and snapshot, or `input.invalid` naming only its base name. */
const readInput = async (file: string): Promise<{ bytes: Uint8Array; snapshot: FileSnapshot }> => {
  const name = path.basename(file);
  const read = await readFileSnapshot(path.dirname(file), name);
  if (read.kind === "read") {
    return read;
  }
  throw read.missing
    ? new CommandError("input.invalid", `The file ${name} does not exist`, {
        file: name,
        reason: "source-missing",
      })
    : new CommandError("input.invalid", `Cannot enrich ${name}: ${read.problem.message}`, {
        file: name,
        reason: "source-unreadable",
      });
};

/**
 * The snapshot an existing `output` is replaced under, or null to create it (B2): only a JUnit file
 * is replaced; anything else is `file.faulty` and stays untouched.
 */
const outputSnapshot = async (
  file: string,
): Promise<{ readonly snapshot: FileSnapshot; readonly bytes: Uint8Array } | null> => {
  const name = path.basename(file);
  const read = await readFileSnapshot(path.dirname(file), name);
  if (read.kind === "problem") {
    if (read.missing) {
      return null;
    }
    throw new CommandError(
      "file.faulty",
      `Not written: ${name} cannot be replaced: ${read.problem.message}`,
      {
        file: name,
      },
    );
  }
  if (junitTestCases(read.bytes).kind !== "junit") {
    throw new CommandError(
      "file.faulty",
      `Not written: ${name} is not a JUnit XML file; LogReq replaces only JUnit files`,
      { file: name },
    );
  }
  return read;
};

/** `; the workspace is incomplete (...)` when repositories of the workspace are not on this machine. */
const incompleteNote = (layout: WorkspaceLayout): string => {
  const names = layout.repositories.filter((r) => !r.available).map((r) => r.name);
  return names.length === 0
    ? ""
    : `; the workspace is incomplete, the element may lie in a repository that is not on this machine (${names.join(", ")})`;
};

/** A candidate of `ref.ambiguous` (`resolveRef`). */
interface Candidate {
  readonly id: string;
  readonly repository: string;
  readonly file: string;
}

/**
 * `resolve` (`resolveRef` of the store) as a `RefResolution`: `ref.unknown` and `ref.ambiguous` become
 * results, any other error passes on. Remembers the record of every element found in `found`.
 */
export const resolverOf =
  (resolve: (ref: string) => ElementRecord, found: Map<string, ElementRecord>) =>
  (ref: string): RefResolution => {
    try {
      const record = resolve(ref);
      found.set(record.id, record);
      return { kind: "found", id: record.id };
    } catch (error) {
      if (error instanceof CommandError && error.code === "ref.unknown") {
        return { kind: "unknown" };
      }
      if (error instanceof CommandError && error.code === "ref.ambiguous") {
        // resolveRef always gives the candidates of `ref.ambiguous`.
        const { candidates } = error.details as { readonly candidates: readonly Candidate[] };
        return {
          kind: "ambiguous",
          candidates: candidates.map((c) => `${c.id} in ${c.repository}/${c.file}`),
        };
      }
      throw error;
    }
  };

/**
 * `evidence.enrichJunit` (SR-029): enriches the JUnit file `input.file` (a local path, relative to
 * the workspace root or absolute) and writes it in place or to `input.output` (see the file comment).
 */
export const enrichJunitFile = async (
  workspace: Workspace,
  input: EvidenceEnrichJunitInput,
): Promise<EvidenceEnrichJunitOutput> => {
  const layout = await workspace.get(workspaceLayoutState);
  const main = await fs.realpath(layout.root);
  const source = path.resolve(workspace.root, input.file);
  const target = input.output === undefined ? source : path.resolve(workspace.root, input.output);
  const { bytes, snapshot } = await readInput(source);
  const sourceFolder = await realFolder(source);
  const targetFolder = await realFolder(target);
  refuseGit(targetFolder, target);
  const inPlace =
    path.join(targetFolder, path.basename(target)) === path.join(sourceFolder, path.basename(source));
  const store = await workspace.get(elementStoreState);
  const shortIds = await workspace.get(shortIdState);
  const found = new Map<string, ElementRecord>();
  const result = await enrichJunitBytes(bytes, {
    resolve: resolverOf((ref) => resolveRef(store, shortIds, ref), found),
    versionsOf: async (ids) => {
      const wanted = new Set(ids);
      const records = [...found.values()].filter((record) => wanted.has(record.id));
      const entries = await currentVersionsOf(workspace, records);
      return new Map(
        [...entries].map(([record, entry]): [string, VersionLookup] => [
          record.id,
          entry.kind === "version" ? { kind: "version", version: entry.version } : entry,
        ]),
      );
    },
    item: input.item,
    date: input.date,
    now: () => new Date(),
    name: path.basename(source),
    file: shownPath(layout, main, sourceFolder, source),
    unknownNote: incompleteNote(layout),
  });
  const output = {
    testCases: result.testCases,
    unknown: [...result.unknown],
    problems: [...result.problems],
  };
  // Nothing to change: the input is not rewritten, but a given output is still written (it is the file
  // the caller asked for), unless it holds these bytes already.
  if (inPlace && !result.changed) {
    return { ...output, files: [] };
  }
  const existing = inPlace ? { snapshot, bytes } : await outputSnapshot(target);
  if (!inPlace && existing !== null && Buffer.from(existing.bytes).equals(result.bytes)) {
    return { ...output, files: [] };
  }
  await writeFileAtomic(
    path.dirname(target),
    path.basename(target),
    result.bytes,
    existing?.snapshot ?? null,
    {
      kind: "xml",
    },
  );
  // The written file may lie in an evidence folder: read the records again, so app, API and MCP see
  // it at once. Unconditional for any written path: cheap, and outside changes are E3's.
  await workspace.reset(evidenceReadState);
  return { ...output, files: [shownPath(layout, main, targetFolder, target)] };
};
