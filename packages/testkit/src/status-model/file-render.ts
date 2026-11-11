// The files of a level-2 workspace (#1396): the pure adapter from a `ModelFileWorkspace` to file contents, by path
// relative to the workspace root with `/`. No randomness and no file access, so a seed replays the same bytes. The
// element files come first; the record files need the current version of each element file in both forms, which only
// the core computes (ADR-0005), so the caller passes them.
import { CURRENT, type ModelCriterion, type ModelCriterionRef } from "./model.js";
import { type ModelFileRecord, type ModelFileWorkspace, filesOf } from "./file-workspace.js";
import type { ModelRef, ModelWorkspaceElement } from "./workspace-model.js";

/** The folder of each repository below the workspace root; the main repository is the root. */
export const REPOSITORY_FOLDERS: Readonly<Record<string, string>> = { spec: "", lib: "lib/" };
/** The invalid status of the metamodel (D-044). */
export const INVALID_STATUS = "obsolete";
/** The versions older records name; never the current version of a generated file. */
export const OLDER_VERSIONS: Readonly<Record<string, string>> = {
  v1: "n2:aaaaaaaaaaaaaaaa",
  v2: "n1:bbbbbbbbbbbbbbbb",
};
/** A stored relation version; outdated targets give hints only. */
const STORED_VERSION = "n1:0000000000000000";

export const METAMODEL = `reqseq-metamodel: 1
types:
  - { key: need, name: Need, prefix: N, meaning: need, properties: [title] }
  - key: system-requirement
    name: System Requirement
    prefix: SR
    meaning: requirement
    properties: [title, acceptance-criteria, validity, emergent]
  - { key: variant, name: Variant, prefix: VAR, meaning: variant, properties: [title] }
  - { key: package, name: Package, prefix: PKG, meaning: package, properties: [title] }
properties:
  - { key: title, name: Title, kind: text, meaning: title }
  - key: acceptance-criteria
    name: Acceptance Criteria
    kind: text
    many: true
    content: true
    meaning: acceptance-criteria
  - { key: validity, name: Validity, kind: relation, many: true, target-types: [variant], content: true, meaning: validity }
  - key: emergent
    name: Emergent
    kind: choice
    meaning: emergent
    choices:
      - { key: "yes", name: "Yes" }
      - { key: "no", name: "No" }
relations:
  - { key: derives-from, name: Derives from, inverse-name: Derived by, meaning: derivation }
  - { key: replaces, name: Replaces, inverse-name: Replaced by, meaning: replacement }
  - { key: excludes, name: Excludes, inverse-name: Excluded by, meaning: exclusion }
statuses:
  - { key: draft, name: Draft, initial: true }
  - { key: ${INVALID_STATUS}, name: Obsolete, invalid: true }
`;

/** The UUID of a model id: `e1` to `e6` for elements, `A` to `C` for variants. */
export function uuidOf(id: string): string {
  const code = Array.from({ length: id.length }, (_, at) => id.charCodeAt(at).toString(16)).join("");
  return `13961396-0000-4000-8000-${code.padStart(12, "0")}`;
}

/** Where an element file lies: its repository, its path there and below the workspace root. */
export interface ElementPlace {
  readonly repository: string;
  readonly file: string;
  readonly path: string;
}

/** The place of an element file: a folder of its own per key, so twins in one repository have two paths. */
export function elementPlaceOf(element: ModelWorkspaceElement): ElementPlace {
  const [folder, prefix] = element.type === "need" ? ["needs", "N"] : ["requirements", "SR"];
  const file = `${folder}/${element.key}/${prefix}-${uuidOf(element.id).slice(-12)}.md`;
  return {
    repository: element.repository,
    file,
    path: `${REPOSITORY_FOLDERS[element.repository] ?? ""}${file}`,
  };
}

/** The place of a variant file. */
export function variantPlaceOf(variant: { readonly id: string; readonly repository: string }): ElementPlace {
  const file = `variants/VAR-${uuidOf(variant.id).slice(-12)}.md`;
  return {
    repository: variant.repository,
    file,
    path: `${REPOSITORY_FOLDERS[variant.repository] ?? ""}${file}`,
  };
}

function withEol(text: string, crlf: boolean): string {
  return crlf ? text.replaceAll("\n", "\r\n") : text;
}

/** Relation items as flow mappings; `repository` only where the item names one (W1). */
function itemsOf(key: string, refs: readonly ModelRef[]): string {
  if (refs.length === 0) {
    return "";
  }
  const items = refs.map(
    (ref) =>
      `  - { id: ${uuidOf(ref.id)}, version: ${STORED_VERSION}${ref.repository === undefined ? "" : `, repository: ${ref.repository}`} }\n`,
  );
  return `${key}:\n${items.join("")}`;
}

function criteriaOf(criteria: readonly ModelCriterion[]): string {
  if (criteria.length === 0) {
    return "";
  }
  const items = criteria.map((criterion, index) => {
    const text = `Criterion ${String(index + 1)}`;
    return criterion.key === undefined ? `  - ${text}\n` : `  - key: ${criterion.key}\n    text: ${text}\n`;
  });
  return `acceptance-criteria:\n${items.join("")}`;
}

/** The workspace file: both repositories with their mark (SR-173) and an evidence location each. */
export function workspaceFileOf(files: ModelFileWorkspace): string {
  const mark = (name: string) =>
    files.base.repositories.find((repository) => repository.name === name)?.variantIndependent === true
      ? ", variant-independent: true"
      : "";
  return [
    "reqseq-workspace: 1",
    "name: Status model",
    "repositories:",
    `  - { name: spec, url: "https://example.invalid/spec.git", main: true${mark("spec")} }`,
    `  - { name: lib, url: "https://example.invalid/lib.git", path: lib${mark("lib")} }`,
    "metamodel: { repository: spec, path: metamodel }",
    "evidence:",
    "  - { repository: spec, path: evidence }",
    "  - { repository: lib, path: evidence }",
    "",
  ].join("\n");
}

/** Every file except the records: workspace file, metamodel, variants and elements. */
export function elementFilesOf(files: ModelFileWorkspace): Map<string, string> {
  const out = new Map<string, string>([
    ["reqseq-workspace.yaml", workspaceFileOf(files)],
    ["metamodel/model.yaml", METAMODEL],
  ]);
  const variantRepository = new Map(files.base.variants.map((variant) => [variant.id, variant.repository]));
  for (const variant of files.base.variants) {
    out.set(
      variantPlaceOf(variant).path,
      `---\nid: ${uuidOf(variant.id)}\ntype: variant\nstatus: ${variant.invalid ? INVALID_STATUS : "draft"}\n` +
        `title: Variant ${variant.id}\n${itemsOf("excludes", variant.excludes)}---\n`,
    );
  }
  files.base.elements.forEach((element, index) => {
    const requirement = element.type === "requirement";
    const validity = element.validity.map((id) => ({
      id,
      ...(variantRepository.get(id) === element.repository ? {} : { repository: variantRepository.get(id) }),
    }));
    const text =
      `---\nid: ${uuidOf(element.id)}\ntype: ${requirement ? "system-requirement" : "need"}\n` +
      `status: ${element.invalid ? INVALID_STATUS : "draft"}\ntitle: Element ${element.key}\n` +
      (requirement ? criteriaOf(files.criteria[index] ?? element.own.criteria) : "") +
      (element.emergent ? 'emergent: "yes"\n' : "") +
      itemsOf("validity", validity as ModelRef[]) +
      itemsOf("derives-from", element.derivesFrom) +
      itemsOf("replaces", element.replaces) +
      `---\n\nText of ${element.key}.\n`;
    out.set(elementPlaceOf(element).path, withEol(text, files.crlf[index] === true));
  });
  return out;
}

/** Both forms of the current version of an element file, by element key. */
export type CurrentForms = (key: string) => { readonly n1: string; readonly n2: string };

/** The criteria refs as written: each once, in generated order (the reader refuses a repeated one). */
function refsOf(refs: readonly ModelCriterionRef[]): (string | number)[] {
  return [...new Set(refs.map((ref) => (ref.by === "number" ? ref.number : ref.key)))];
}

/** The version a record names: a current one of the file it was written against (R4), else an older one. */
function versionOf(
  files: ModelFileWorkspace,
  id: string,
  file: ModelFileRecord,
  forms: CurrentForms,
): string {
  if (file.record.version !== CURRENT) {
    return OLDER_VERSIONS[file.record.version] ?? STORED_VERSION;
  }
  const pinned = filesOf(files.base, id)[file.pin];
  return pinned === undefined ? STORED_VERSION : forms(pinned.key)[file.form];
}

function markdownRecord(id: string, file: ModelFileRecord, version: string): string {
  const { record } = file;
  const criteria = record.criteria === undefined ? [] : refsOf(record.criteria);
  const lines = [
    "---",
    "reqseq-record: 1",
    `kind: ${record.kind}`,
    `element: ${uuidOf(id)}`,
    `version: ${version}`,
    ...(record.kind === "verification" ? ["method: test"] : []),
    ...(record.variant === undefined ? [] : [`variant: ${uuidOf(record.variant)}`]),
    ...(record.kind === "verification" ? ["item: build"] : []),
    `result: ${record.result}`,
    ...(record.reason === undefined ? [] : [`reason: ${record.reason}`]),
    `date: ${record.date}`,
    ...(criteria.length === 0 ? [] : [`criteria: [${criteria.join(", ")}]`]),
    "---",
    "",
  ];
  return withEol(lines.join("\n"), file.crlf);
}

function junitRecord(id: string, file: ModelFileRecord, version: string, name: string): string {
  const { record } = file;
  const uuid = uuidOf(id);
  const property = (key: string, value: string) => `<property name="reqseq:${key}" value="${value}"/>`;
  const criteria = record.criteria === undefined ? [] : refsOf(record.criteria);
  const properties = [
    property("element", uuid),
    property("version", version),
    ...criteria.map((ref) => property("criterion", `${uuid}:${String(ref)}`)),
    property("item", "build"),
    property("date", record.date),
    ...(record.variant === undefined ? [] : [property("variant", uuidOf(record.variant))]),
  ];
  const failure = record.result === "failed" ? '<failure message="failed"/>' : "";
  const text =
    '<?xml version="1.0" encoding="UTF-8"?>\n<testsuites>\n  <testsuite name="model" tests="1">\n' +
    `    <testcase classname="model" name="${name}"><properties>${properties.join("")}</properties>${failure}</testcase>\n` +
    "  </testsuite>\n</testsuites>\n";
  return withEol(text, file.crlf);
}

/**
 * The record files: `r-<UUID index>-<position>.md` or `.xml` in the evidence location the record names, so path order
 * within a location is record order (A6).
 */
export function recordFilesOf(files: ModelFileWorkspace, forms: CurrentForms): Map<string, string> {
  const out = new Map<string, string>();
  Object.entries(files.records).forEach(([id, records], uuidIndex) => {
    records.forEach((file, position) => {
      const name = `r-${String(uuidIndex)}-${String(position).padStart(2, "0")}`;
      const folder = file.location === 1 ? "lib/evidence/" : "evidence/";
      const version = versionOf(files, id, file, forms);
      out.set(
        `${folder}${name}.${file.format === "junit" ? "xml" : "md"}`,
        file.format === "junit" ? junitRecord(id, file, version, name) : markdownRecord(id, file, version),
      );
    });
  });
  return out;
}
