// The calls of every implemented command that the cross-command tests share: SR-087 (no status
// change, no-status-change.test.ts) and SR-083 (Git only read, git-read-only.test.ts). The fixture is
// SR-001/two-elements with FILES on top; GIT_COMMANDS need it as a Git repository.
import fs from "node:fs";

export const WIND = "e8df96ea-a168-4d90-8d65-6328cee88fb3";
export const GUSTS = "3f2a9c1e-5b7d-4e8a-9c0b-1d2e3f4a5b6c";
export const OBSOLETE = "0b7c6e1a-1111-4222-8333-444455556666";
export const APPROVED = "0b7c6e1a-1111-4222-8333-aaaaaaaaaaaa";
export const RETIRED = "0b7c6e1a-1111-4222-8333-bbbbbbbbbbbb";

/** A variant, so variant.exclude writes. */
export const VARIANT = "0b7c6e1a-1111-4222-8333-cccccccccccc";
export const VARIANT_FILE = "variants/VAR-cccccccccccc.md";
/** A relation to an outdated version of WIND, as SR-001/two-elements has one from GUSTS, so `hint.confirm` writes. */
export const OUTDATED = `derives-from:\n  - { id: ${WIND}, version: n1:0000000000000000 }\n`;

/** The hint ID of the outdated derivation of `source` in `file` (hints/hint-id.ts). */
export const hintId = (file: string, source: string, target: string): string =>
  `relation.outdated/system/${encodeURIComponent(file)}/${source}/derives-from/${target}?version=n1:0000000000000000`;

/** A file of fixtures/enabler-535/evidence: an evidence location with a Markdown record and an enriched JUnit file. */
export const evidenceFixture = (file: string): string =>
  fs.readFileSync(new URL(`../../../../fixtures/enabler-535/evidence/${file}`, import.meta.url), "utf8");

/** The evidence files every scenario has (#535); read once the readers are in (SR-028, SR-093). */
export const EVIDENCE_RECORD = "evidence/2026-10-20-SR-e88fb3-inspection.md";
export const EVIDENCE_JUNIT = "evidence/ci/results.xml";

/**
 * A JUnit file outside the evidence folder that is not enriched yet, naming elements of every status
 * by short ID (WIND draft, APPROVED, OBSOLETE, RETIRED), so evidence.enrichJunit writes (SR-029).
 */
export const RAW_JUNIT = "results/raw.xml";
export const RAW_JUNIT_TEXT =
  '<?xml version="1.0" encoding="UTF-8"?>\n<testsuites>\n  <testsuite name="station">\n' +
  ["SR-e88fb3", "N-aaaaaa", "SR-556666", "N-bbbbbb"]
    .map((ref) => `    <testcase classname="station" name="[${ref}] is checked"/>\n`)
    .join("") +
  "  </testsuite>\n</testsuites>\n";

/** The delivery and mapping of fixtures/SR-053/delivery, so reqif.import writes (SR-053). */
export const delivery = (file: string): string =>
  fs.readFileSync(new URL(`../../../../fixtures/SR-053/delivery/${file}`, import.meta.url), "utf8");
export const IMPORT = {
  file: "in/lieferung.reqif",
  mapping: "reqif/import-kunde-a.yaml",
  delivery: "Lastenheft 2026-11",
};

/**
 * Added to SR-001/two-elements: elements approved, obsolete, and `retired`, which the metamodel
 * does not know; an evidence location with a Markdown record and an enriched JUnit file of WIND.
 */
export const FILES: Readonly<Record<string, string>> = {
  "reqseq-workspace.yaml": evidenceFixture("reqseq-workspace.yaml"),
  [EVIDENCE_RECORD]: evidenceFixture(EVIDENCE_RECORD),
  [EVIDENCE_JUNIT]: evidenceFixture(EVIDENCE_JUNIT),
  [RAW_JUNIT]: RAW_JUNIT_TEXT,
  "requirements/SR-444455556666.md": `---\nid: ${OBSOLETE}\ntype: system-requirement\nstatus: obsolete\ntitle: Old\n${OUTDATED}---\n`,
  "needs/N-aaaaaaaaaaaa.md": `---\nid: ${APPROVED}\ntype: need\nstatus: approved\ntitle: Need\n${OUTDATED}---\n`,
  "needs/N-bbbbbbbbbbbb.md": `---\nid: ${RETIRED}\ntype: need\nstatus:   retired   # unknown to the metamodel\ntitle: Retired need\n${OUTDATED}---\n`,
  "new/.keep": "",
  "new/layout.png": "an image",
  [VARIANT_FILE]: `---\nid: ${VARIANT}\ntype: variant\nstatus: approved\ntitle: Coast\n---\n`,
  "in/lieferung.reqif": delivery("lieferung.reqif"),
  "in/lieferung-2.reqif": delivery("lieferung.reqif").replace("Every 10 s.", "Every 5 s."),
  "reqif/import-kunde-a.yaml": delivery("kunde-a.yaml"),
  "reqif/import-status.yaml": delivery("kunde-a.yaml").replace(
    "{ source: Internal Comment, omit: true }",
    "{ source: Internal Comment, property: status }",
  ),
};

export type Scenario = Readonly<Record<string, unknown>>;

/** Commands that write only with Git, so their fixture is a Git repository. */
export const GIT_COMMANDS: ReadonlySet<string> = new Set([
  "baseline.compare",
  "baseline.create",
  "baseline.get",
  "baseline.list",
]);

/** Every implemented command except the two status commands, with calls that succeed and calls that fail. */
export const SCENARIOS: Readonly<Record<string, readonly Scenario[]>> = {
  // In a Git repository (`GIT_COMMANDS`): the second call is refused, the name exists (SR-050 AK6).
  "baseline.compare": [
    { baseline: "Base", ref: WIND },
    { baseline: "nope", ref: WIND },
  ],
  "baseline.create": [
    { name: "Release 1", selection: { ids: [WIND, OBSOLETE, RETIRED] } },
    { name: "release 1", selection: {} },
  ],
  "baseline.get": [{ baseline: "Base" }, { baseline: "nope" }],
  "baseline.list": [{}, { unknown: true }],
  "data.export": [
    {},
    { selection: { where: { any: [{ status: ["retired"] }, { invalid: true }] } } },
    { selection: { ids: [WIND, OBSOLETE, RETIRED], view: "core" } },
    { selection: { baseline: "nope" } },
  ],
  // Without Git (this fixture): nothing is written, the output names git.unavailable (SR-062 K3). The
  // writes with Git are in the test of data.store below.
  "data.store": [{ folder: "out" }, { folder: "out", selection: { ids: [RETIRED] } }, {}],
  "element.addAttachment": [
    { ref: WIND, sourcePath: "new/layout.png" },
    { ref: OBSOLETE, sourcePath: "new/layout.png" },
    { ref: APPROVED, sourcePath: "new/layout.png" },
    { ref: RETIRED, sourcePath: "new/layout.png" },
    { ref: WIND, sourcePath: "new/.keep" },
  ],
  "element.bulkUpdate": [
    { selection: {}, property: "rationale", operation: "set", value: "Changed together", confirm: true },
    { selection: { where: { type: ["need"] } }, property: "topic", operation: "set", value: "Wind" },
    {
      selection: { ids: [WIND, OBSOLETE] },
      property: "acceptance-criteria",
      operation: "add",
      value: "New",
      confirm: true,
    },
    { selection: {}, property: "rationale", operation: "remove", confirm: true },
    { selection: {}, property: "status", operation: "set", value: "approved", confirm: true },
    { selection: { ids: [RETIRED] }, property: "status", operation: "remove", confirm: true },
  ],
  "element.create": [
    { type: "system-requirement", title: "Show gusts", folder: "requirements" },
    { type: "need", title: "New need", folder: "needs" },
    { type: "decision", title: "New decision", folder: "new" },
    { type: "nope", title: "Unknown type" },
  ],
  "element.facets": [
    {},
    { selection: { where: { status: ["retired"] } } },
    { selection: { ids: ["SR-ffffff"] } },
  ],
  "element.get": [{ ref: WIND }, { ref: OBSOLETE }, { ref: RETIRED }, { ref: "SR-ffffff" }],
  "element.list": [
    {},
    { selection: { where: { any: [{ status: ["retired"] }, { invalid: true }] } }, withText: true },
    { selection: { ids: [WIND, RETIRED], view: "core" } },
    { selection: { where: { relation: { meaning: "derivation", direction: "down" }, exists: false } } },
    { selection: { ids: ["SR-ffffff"] } },
    { fields: ["title", "status"], group: "status" },
  ],
  "element.resolve": [{ ref: WIND, version: "n1:0000000000000000" }, { ref: RETIRED }, { ref: "SR-ffffff" }],
  "element.search": [
    { query: "approved" },
    { query: "wind", selection: { where: { text: "retired" } } },
    { query: "obsolete", selection: { ids: [RETIRED] } },
    { query: "wind", selection: { ids: ["SR-ffffff"] } },
  ],
  "element.update": [
    { ref: WIND, title: "Renamed", text: "" },
    { ref: GUSTS, text: "New text\n", set: { rationale: "Why", "requirement-type": "quality" } },
    { ref: GUSTS, unset: ["acceptance-criteria", "rationale"] },
    { ref: OBSOLETE, title: "Still old", set: { "verification-method": "test" } },
    { ref: APPROVED, text: "approved stays\n" },
    { ref: RETIRED, title: "Still retired", text: "retired stays\n" },
    { ref: WIND, set: { status: "approved" } },
    { ref: WIND, unset: ["status"] },
    { ref: "SR-ffffff", title: "Unknown element" },
  ],
  "evidence.coverage": [
    {},
    { selection: { where: { any: [{ status: ["retired"] }, { invalid: true }] }, view: "core" } },
    { selection: { ids: [WIND, OBSOLETE, RETIRED] } },
    { selection: { ids: ["SR-ffffff"] } },
  ],
  "evidence.degree": [
    {},
    { selection: { where: { any: [{ status: ["retired"] }, { invalid: true }] }, view: "core" } },
    { selection: { ids: [WIND, OBSOLETE, RETIRED] } },
    { selection: { ids: ["SR-ffffff"] } },
  ],
  "evidence.enrichJunit": [
    { file: RAW_JUNIT, item: "build-513", date: "2026-10-27T10:00:00Z", output: "evidence/ci/raw.xml" },
    { file: RAW_JUNIT, item: "build-513", date: "2026-10-27T10:00:00Z" },
    { file: EVIDENCE_JUNIT, item: "build-514" },
    { file: "results/gone.xml", item: "build-513" },
  ],
  "evidence.list": [{ ref: WIND }, { ref: OBSOLETE, view: "core" }, { ref: "SR-ffffff" }],
  // Records of every status (SR-030): a verification and a validation of the requirements, validations
  // of the approved and the retired need; a verification of a need is refused (D-012).
  "evidence.record": [
    {
      ref: WIND,
      kind: "verification",
      result: "passed",
      method: "inspection",
      item: "unit 7",
      date: "2026-10-27T10:00:00Z",
    },
    {
      ref: OBSOLETE,
      kind: "verification",
      result: "failed",
      method: "test",
      item: "build-513",
      date: "2026-10-27T10:00:00Z",
    },
    { ref: WIND, kind: "validation", result: "passed", date: "2026-10-27T10:00:00Z" },
    { ref: OBSOLETE, kind: "validation", result: "failed", date: "2026-10-27T10:00:00Z" },
    { ref: APPROVED, kind: "validation", result: "passed", date: "2026-10-27T10:00:00Z" },
    { ref: RETIRED, kind: "validation", result: "failed", date: "2026-10-27T10:00:00Z" },
    {
      ref: APPROVED,
      kind: "verification",
      result: "passed",
      method: "test",
      item: "build-513",
      date: "2026-10-27T10:00:00Z",
    },
  ],
  "evidence.status": [
    {},
    { selection: { where: { verification: ["open", "verified"] } }, limit: 1 },
    { selection: { ids: [WIND, RETIRED], view: "core" } },
    { selection: { ids: ["SR-ffffff"] } },
  ],
  "evidence.withoutPassedTest": [{}, { view: "core", limit: 1, offset: 1 }, { view: "SR-e88fb3" }],
  "filter.list": [{}, { extra: true }],
  "filter.save": [
    { name: "Drafts", where: { status: ["draft"] }, sort: [{ by: "status" }] },
    { name: "drafts", where: { any: [{ status: ["retired"] }, { invalid: true }] } },
    { name: "Retired", where: { status: ["retired"] } },
    { name: "Unknown", where: { package: "SR-ffffff" } },
  ],
  "hint.confirm": [
    { hintIds: [hintId("requirements/SR-1d2e3f4a5b6c.md", GUSTS, WIND)] },
    {
      hintIds: [
        hintId("needs/N-aaaaaaaaaaaa.md", APPROVED, WIND),
        hintId("requirements/SR-444455556666.md", OBSOLETE, WIND),
      ],
    },
    { hintIds: ["element.unknown-property", hintId("requirements/SR-1d2e3f4a5b6c.md", GUSTS, WIND)] },
    { hintIds: [hintId("needs/N-bbbbbbbbbbbb.md", RETIRED, WIND)] },
    {},
  ],
  "hint.list": [{}, { kind: ["relation.outdated"], type: ["need"] }, { ref: OBSOLETE }, { ref: "SR-ffffff" }],
  "metamodel.get": [{}, { extra: true }],
  "relation.add": [
    { source: GUSTS, kind: "replaces", target: OBSOLETE },
    { source: APPROVED, kind: "refines", target: RETIRED },
    { source: RETIRED, kind: "refines", target: WIND },
    { source: APPROVED, kind: "derives-from", target: GUSTS },
  ],
  "relation.options": [{ ref: WIND }, { ref: RETIRED, kind: "refines" }, { ref: "SR-ffffff" }],
  "relation.remove": [
    { source: GUSTS, kind: "derives-from", target: WIND },
    { source: APPROVED, kind: "refines", target: RETIRED },
    { source: "SR-ffffff", kind: "refines", target: WIND },
  ],
  // The status is exported for information only.
  "reqif.export": [{ output: "out.reqif" }, { output: "out.reqif", profile: "p" }],
  "reqif.analyze": [
    { file: IMPORT.file },
    { file: IMPORT.file, mapping: IMPORT.mapping },
    { file: "in/missing.reqif" },
  ],
  // A mapping that maps an attribute to `status` is refused: the delivery never sets a status.
  "reqif.import": [
    IMPORT,
    { ...IMPORT, file: "in/lieferung-2.reqif", delivery: "2" },
    { ...IMPORT, file: "in/missing.reqif" },
    { ...IMPORT, mapping: "reqif/import-status.yaml" },
  ],
  "reqif.saveMapping": [
    {
      mapping: {
        "reqseq-reqif-mapping": 1,
        source: { name: "Kunde A" },
        types: [{ source: "Customer Requirement", type: "system-requirement" }],
        attributes: [{ source: "Status", property: "requirement-type", values: { Open: "functional" } }],
      },
    },
    {
      mapping: {
        "reqseq-reqif-mapping": 1,
        source: { name: "Kunde A" },
        types: [{ source: "X", type: "nope" }],
      },
    },
  ],
  "variant.diff": [{ variant: VARIANT }, { variant: WIND }],
  "trace.affected": [{ ref: WIND }, { ref: OBSOLETE }, { ref: RETIRED }, { ref: "SR-ffffff" }],
  "trace.chain": [
    { ref: WIND },
    { ref: APPROVED, direction: "down", view: "core" },
    { ref: RETIRED, direction: "up" },
    { ref: "SR-ffffff" },
  ],
  "trace.graph": [
    { ref: WIND },
    { ref: APPROVED, allLevels: true, view: "core" },
    { ref: RETIRED, meanings: ["derivation"], limit: 2 },
    { ref: "SR-ffffff" },
  ],
  "trace.matrix": [
    {},
    { selection: { ids: [APPROVED, WIND] }, sort: [{ by: "hierarchy" }] },
    { kinds: ["nope"] },
  ],
  "trace.neighbourhood": [
    { ref: WIND },
    { ref: APPROVED, direction: "down", view: "core" },
    { ref: RETIRED, allLevels: true },
    { ref: "SR-ffffff" },
  ],
  "trace.related": [
    { refs: [WIND, APPROVED, RETIRED, OBSOLETE], direction: "children" },
    { refs: [GUSTS, OBSOLETE, RETIRED], direction: "parents", view: "core" },
    { refs: ["SR-ffffff"], direction: "children" },
  ],
  "workspace.activity": [{}, { extra: true }],
  "variant.exclude": [
    { variant: VARIANT, refs: [WIND] },
    { variant: VARIANT, refs: [WIND, OBSOLETE], undo: true },
    { variant: VARIANT, refs: [APPROVED] },
  ],
  "workspace.check": [
    {},
    { severity: "error" },
    { changedFiles: ["needs/N-aaaaaaaaaaaa.md"] },
    { changedSince: "main" },
  ],
  "workspace.init": [
    { path: "new", name: "New" },
    { path: ".", name: "Again" },
  ],
  "tool.info": [{}, { extra: true }],
  "workspace.recent": [{}, { extra: true }],
  "workspace.status": [{}, { extra: true }],
};
