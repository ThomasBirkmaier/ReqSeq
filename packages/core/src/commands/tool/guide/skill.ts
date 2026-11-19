// The skill file of SR-229 AK7: an Agent Skills file named `managing-requirements` with the workflows of
// AK7 as numbered steps, written by `tool.guide` with `skill` (and at the place of D-079 with `write`,
// guide/skill-file.ts). It is built from the catalog only, never from a workspace, so it holds no name of a
// metamodel and is the same for every workspace of one ReqSeq version. Every command appears both ways, as
// the MCP tool and as the command-line call (`renderCall`). The rules of AK5 and AK13 and the pipeline
// paragraph of AK11 stay in the agent guide; the skill points to it.
//
// The frontmatter carries the version of the tool and a checksum over the file (`skillChecksum`), so
// ReqSeq replaces only a file it wrote itself that nobody changed (AK8).
import { createHash } from "node:crypto";
import { PRODUCT_VERSION } from "../../../product.js";
import type { CatalogEntry } from "../../../runtime/contracts.js";
import type { GuideCall } from "./calls.js";
import { renderCall } from "./calls.js";
import { METAMODEL_CHANGES } from "./text.js";

/** The name of the skill (AK7), which is also the name of its folder (D-079). */
export const SKILL_NAME = "managing-requirements";

/** The skill file relative to the Git root, or to the workspace folder without Git (D-079), with `/`. */
export const SKILL_FILE = `.claude/skills/${SKILL_NAME}/SKILL.md`;

/** What the skill does and when it applies, in third person (AK7: at most 1,024 characters). */
export const SKILL_DESCRIPTION =
  "Works with needs, requirements, acceptance criteria, tests and evidence in a ReqSeq workspace. Use when creating a requirement, implementing a requirement up to its evidence, changing an element whose status is not the initial status, changing the metamodel, or checking the workspace before finishing a piece of work.";

/** The headings of the workflows of AK7, in their order. */
export const SKILL_WORKFLOWS = [
  "Create a requirement",
  "Implement a requirement up to its evidence",
  "Check before finishing",
  "Change an element whose status is not the initial status",
  "Change the metamodel",
] as const;

/** The value of `metadata.generator` that marks a file ReqSeq wrote. */
const GENERATOR = "ReqSeq";

const VERSION_LINE = /^ {2}reqseq-version: "([^"\n]*)"$/m;
const CHECKSUM_LINE = /^ {2}reqseq-checksum: "sha256:([0-9a-f]*)"$/m;
const GENERATOR_LINE = `  generator: "${GENERATOR}"`;

/** The checksum line with an empty value, as the canonical form holds it. */
const BLANK_CHECKSUM = `  reqseq-checksum: "sha256:"`;

/**
 * The checksum a skill file states and the one its content has: SHA-256 over the canonical form, which is
 * the text without a byte order mark, with LF line endings, and with the value of the checksum line blanked
 * to `sha256:`, as UTF-8 bytes. So a checkout with CRLF line endings keeps the file ReqSeq's own. One
 * function computes it for a new file and checks it for an existing one.
 */
export const skillChecksum = (text: string): { readonly stated?: string; readonly actual: string } => {
  const lf = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  const stated = CHECKSUM_LINE.exec(lf)?.[1];
  const canonical = lf.replace(CHECKSUM_LINE, BLANK_CHECKSUM);
  const actual = createHash("sha256").update(canonical, "utf8").digest("hex");
  return stated === undefined ? { actual } : { stated, actual };
};

/** What a file at the place of the skill is (AK8, AK10). */
export type SkillIdentity =
  | { readonly own: false }
  /** Written by ReqSeq: its version, and whether its checksum still matches (`intact`). */
  | { readonly own: true; readonly version: string; readonly intact: boolean };

/** Whether `text` is a skill file ReqSeq wrote, by the marks of its frontmatter, and whether it is unchanged. */
export const identifySkill = (text: string): SkillIdentity => {
  const lf = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  const end = lf.startsWith("---\n") ? lf.indexOf("\n---\n", 3) : -1;
  const frontmatter = end === -1 ? "" : lf.slice(0, end + 1);
  const version = VERSION_LINE.exec(frontmatter)?.[1];
  const { stated, actual } = skillChecksum(lf);
  if (!frontmatter.split("\n").includes(GENERATOR_LINE) || version === undefined || stated === undefined) {
    return { own: false };
  }
  return { own: true, version, intact: stated === actual };
};

/** A version `major.minor.patch` with an optional pre-release after `-`; build metadata after `+` is ignored. */
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

/** Compares two numbers written without leading zeros, of any length: by length, then digit by digit. */
const compareNumbers = (a: string, b: string): number =>
  a.length === b.length ? (a < b ? -1 : a > b ? 1 : 0) : Math.sign(a.length - b.length);

/** Compares two pre-release identifiers as Semantic Versioning does: numbers by value and below words. */
const compareIdentifier = (a: string, b: string): number => {
  const numeric = (s: string): boolean => /^\d+$/.test(s);
  if (numeric(a) && numeric(b)) {
    return compareNumbers(a, b);
  }
  if (numeric(a) !== numeric(b)) {
    return numeric(a) ? -1 : 1;
  }
  return a < b ? -1 : a > b ? 1 : 0;
};

/**
 * Compares two versions as Semantic Versioning orders them (a pre-release before its release):
 * negative when `a` is older, 0 when equal, positive when newer; undefined when one is no such version.
 */
export const compareVersions = (a: string, b: string): number | undefined => {
  const [x, y] = [VERSION.exec(a), VERSION.exec(b)];
  if (x === null || y === null) {
    return undefined;
  }
  for (const i of [1, 2, 3]) {
    const order = compareNumbers(String(x[i]), String(y[i]));
    if (order !== 0) {
      return order;
    }
  }
  const [p, q] = [x[4]?.split("."), y[4]?.split(".")];
  if (p === undefined || q === undefined) {
    return p === q ? 0 : p === undefined ? 1 : -1;
  }
  const first = p
    .map((part, i) => (i < q.length ? compareIdentifier(part, String(q[i])) : 0))
    .find((o) => o !== 0);
  if (first !== undefined) {
    return first;
  }
  return Math.sign(p.length - q.length);
};

/** The impact check of AK12 for `subject`, with its commands. */
const impactCheck = (both: (call: GuideCall) => string, subject: string): string =>
  [
    `Check the impact first, as the agent guide describes it, for ${subject}:`,
    `read it with the targets of its relations and references (${both({ command: "element.get", input: { ref: "<element>" } })})`,
    `and its open hints (${both({ command: "hint.list", input: { ref: "<element>" } })}),`,
    `query its affected elements (${both({ command: "trace.affected", input: { ref: "<element>" } })}),`,
    `search for each new or changed term and for its identifier (${both({ command: "element.search", input: { query: "<term>" } })}),`,
    `and read what you find against the change, with the records (${both({ command: "evidence.list", input: { ref: "<requirement>" } })}).`,
  ].join(" ");

/** The body of the skill: its first step, then the workflows of AK7, each as numbered steps. */
const skillBody = (
  both: (call: GuideCall) => string,
  entries: readonly CatalogEntry[],
): readonly string[] => {
  const guide = { command: "tool.guide" } as const;
  const check = both({ command: "workspace.check" });
  const degree = both({ command: "evidence.degree" });
  const steps: Readonly<Record<(typeof SKILL_WORKFLOWS)[number], readonly string[]>> = {
    "Create a requirement": [
      impactCheck(both, "each element the new requirement will point to, such as its need"),
      `Create the need if it is missing, then the requirement with its acceptance criteria and its verification method: ${both({ command: "element.create", input: { type: "<type>", title: "<title>" } })}.`,
      `Relate the requirement to what it derives from: ${both({ command: "relation.add", input: { source: "<requirement>", kind: "<derivation>", target: "<target>" } })}.`,
      `Check the workspace: ${check}.`,
    ],
    "Implement a requirement up to its evidence": [
      impactCheck(both, "the requirement"),
      `Read the requirement and the reference of each acceptance criterion: ${both({ command: "element.get", input: { ref: "<requirement>" } })}.`,
      "Write one test per acceptance criterion, with the reference of its criterion in its name, as the agent guide shows.",
      `Run the tests with JUnit XML output and enrich the result into a new file in an evidence location: ${both({ command: "evidence.enrichJunit", input: { file: "<junit.xml>", item: "<item>", output: "<evidence location>/<run>.xml" } })}.`,
      `For an acceptance criterion with another verification method than test, record the check: ${both({ command: "evidence.record", input: { ref: "<requirement>", kind: "verification", result: "<result>" } })}.`,
      `Check the verification degree: ${degree}.`,
    ],
    "Check before finishing": [
      `Check the workspace: ${check}.`,
      `Check the verification degree (${degree}) and list the requirements without a passed test (${both({ command: "evidence.withoutPassedTest" })}).`,
      "Name each problem and each gap you found when you report the work.",
    ],
    "Change an element whose status is not the initial status": [
      impactCheck(both, "the element"),
      `Ask the person before the change, as the rules of the agent guide say, and name both ways: change the element (${both({ command: "element.update", input: { ref: "<element>" } })}), or supersede it with a successor (${both({ command: "element.supersede", input: { ref: "<element>", status: "<status>", successor: "<successor>" } })}).`,
      "Carry out the way the person chose, through the commands.",
      `Check the workspace: ${check}.`,
    ],
    "Change the metamodel": [
      `Propose the change with its rationale to the person; read the metamodel first (${both({ command: "metamodel.get" })}).`,
      "Wait for the person's explicit decision, as the rules of the agent guide say; without it, change nothing.",
      `Carry out the decision with the command for it, never by editing the files of the metamodel: ${METAMODEL_CHANGES.map((command) => both({ command })).join("; ")}.`,
      `Check the workspace: ${check}.`,
      `Read the agent guide again (${both(guide)}), because it names the types and statuses of the changed metamodel.`,
    ],
  };
  return [
    "# Managing requirements with ReqSeq",
    "",
    "Each command is named as the MCP tool, then as the command-line call; both do the same. The rules for working with ReqSeq are in the agent guide and apply to every step; this skill does not repeat them.",
    "",
    "## First",
    "",
    `1. Read the agent guide: ${renderCall(guide, "mcp", entries)} or ${renderCall(guide, "cli", entries)}. It names the types, statuses and evidence locations of this workspace and the rules. If neither is reachable, tell the person that ReqSeq is not connected and ask them to install it or to connect it (${both({ command: "workspace.connectAgent" })}); do not work on the requirements without the guide.`,
    ...SKILL_WORKFLOWS.flatMap((heading) => [
      "",
      `## ${heading}`,
      "",
      ...steps[heading].map((step, index) => `${String(index + 1)}. ${step}`),
    ]),
  ];
};

/** The skill file as Markdown (AK7): LF line endings, a final newline, version and checksum in its frontmatter. */
export const skillFile = (entries: readonly CatalogEntry[], version: string = PRODUCT_VERSION): string => {
  const both = (call: GuideCall): string =>
    `${renderCall(call, "mcp", entries)} or ${renderCall(call, "cli", entries)}`;
  const text = [
    "---",
    `name: ${SKILL_NAME}`,
    `description: ${JSON.stringify(SKILL_DESCRIPTION)}`,
    "metadata:",
    GENERATOR_LINE,
    `  reqseq-version: ${JSON.stringify(version)}`,
    BLANK_CHECKSUM,
    "---",
    "",
    ...skillBody(both, entries),
  ].join("\n");
  const blank = `${text}\n`;
  return blank.replace(BLANK_CHECKSUM, `  reqseq-checksum: "sha256:${skillChecksum(blank).actual}"`);
};
