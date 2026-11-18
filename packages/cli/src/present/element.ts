// Part of the CLI output for people (`../present.ts`, whose comment describes the layout): the line
// of an element with its marks, its details, and the line of a finding.
import { criterionKey, criterionLabel, criterionText, degreePercent, isCriterionKey } from "@reqseq/core";
import type { Style } from "../style.js";
import { PLAIN, cut, widthOf } from "../style.js";
import type { Namer, Names, Rec } from "./common.js";
import {
  indent,
  isRecord,
  join,
  listOf,
  nameOn,
  namerOf,
  reasonText,
  text,
  withIdentifier,
  withNames,
  yamlLines,
} from "./common.js";

/** A criterion an output names (`$defs/criterionName`) as `AK2 (k7f3)` (`criterionLabel`), read loosely. */
export const nameOfCriterion = (value: Rec): string =>
  criterionLabel({
    ...(typeof value["criterion"] === "number" ? { criterion: value["criterion"] } : {}),
    ...(typeof value["key"] === "string" ? { key: value["key"] } : {}),
  });

/**
 * How an element points at the one before it on its path (trace.affected `via`, `path`, SR-024 AK1
 * "mit Weg und Abstand"): `[via derives-from from SR-00b002]`; without `from` when the one before
 * is the element asked for, the start of the path.
 */
const viaText = (element: Rec, name: Namer): string => {
  const via = element["via"];
  if (!isRecord(via)) {
    return "";
  }
  const how = via["kind"] === "reference" ? "reference" : text(via["key"]);
  const path = listOf(element["path"]).filter(isRecord);
  const before = path.length > 2 ? path[path.length - 2] : undefined;
  const from = before === undefined ? "" : ` from ${name(text(before["repository"]), text(before["id"]))}`;
  return `[via ${how}${from}]`;
};

/** Names a view of `verification` (`core` or a variant's UUID): the variant's short ID when the list has it. */
export type ViewNamer = (view: string) => string;

/**
 * A view namer from the elements of a list; the elements of `names` first, with their identifier
 * (`SR-3c90b0 (SR-036)`, ThomasBirkmaier/ReqSeq-archive#588).
 */
export const viewNamerOf =
  (elements: readonly Rec[], names: Names = new Map()): ViewNamer =>
  (view) => {
    const name = names.get(view);
    return name === undefined
      ? text(elements.find((e) => e["id"] === view)?.["shortId"]) || view
      : withIdentifier(name.shortId, name["identifier"]);
  };

/**
 * The acceptance criteria of a verification entry (SR-031 AK5): ` 2 of 3 criteria (AK3 not
 * verified)`; nothing without `criteria`.
 */
const criteriaCountText = (criteria: unknown): string => {
  if (!isRecord(criteria)) {
    return "";
  }
  const open = listOf(criteria["notVerified"]).filter(isRecord).map(nameOfCriterion);
  return ` ${String(criteria["verified"])} of ${String(criteria["total"])} criteria${open.length === 0 ? "" : ` (${open.join(", ")} not verified)`}`;
};

/**
 * The verification status of an element per view (SR-031), apart from its own status:
 * `[verification: core verified, VAR-0000c1 open (missing SR-0000b2, SR-0000b3)]`; nothing for an
 * element without one. The children that are missing for an indirect verification (SR-034 AK2) follow
 * their view. A variant or child is named by its short ID from the list, else from the element's own
 * relations (its validity, its incoming relations), else by its UUID: the output gives UUIDs only
 * (`missingChildren`, the open export format), so a child that neither lists is shown as its UUID. An
 * output that names them in `names` (ThomasBirkmaier/ReqSeq-archive#588) gives them all (`view` takes those first).
 */
const verificationText = (element: Rec, view: ViewNamer): string => {
  const entries = listOf(element["verification"]).filter(isRecord);
  const own = viewNamerOf(listOf(element["relations"]).filter(isRecord));
  const named = (id: string): string => {
    const listed = view(id);
    return listed === id ? own(id) : listed;
  };
  const entryText = (e: Rec): string => {
    const missing = listOf(e["missingChildren"]).map((id) => named(text(id)));
    return `${named(text(e["view"]))} ${text(e["status"])}${criteriaCountText(e["criteria"])}${missing.length === 0 ? "" : ` (missing ${missing.join(", ")})`}`;
  };
  return entries.length === 0 ? "" : `[verification: ${entries.map(entryText).join(", ")}]`;
};

/**
 * The validation status of an element (SR-038), apart from its verification status: `[validation: validated]`,
 * `[validation: inconclusive — <reason>]` with the reason of an inconclusive one (SR-172 AK2).
 */
const validationText = (element: Rec): string => {
  const validation = text(element["validation"]);
  const reason = reasonText(element["validationReason"]);
  return validation === "" ? "" : `[validation: ${validation}${reason === "" ? "" : ` — ${reason}`}]`;
};

/**
 * The verification degree of the requirements derived from a need in a graph (SR-136 AK3):
 * `[degree: 60 % of 10]`; nothing when none counts (AK6) or the element has none.
 */
const degreeText = (element: Rec): string => {
  const degree = element["degree"];
  return isRecord(degree) && typeof degree["share"] === "number"
    ? `[degree: ${degreePercent(degree["share"])} of ${String(degree["total"])}]`
    : "";
};

/** `[emergent]` for an element marked emergent (SR-035), next to the `open` it explains; else nothing. */
const emergentText = (element: Rec): string => (element["emergent"] === true ? "[emergent]" : "");

/**
 * What an element line shows after the title: how it points, its mark emergent, its verification
 * status per view and its validation status (the plain and the terminal line alike).
 */
export const marksOf = (element: Rec, name: Namer, view: ViewNamer): string[] => [
  viaText(element, name),
  emergentText(element),
  verificationText(element, view),
  degreeText(element),
  validationText(element),
];

/**
 * `SHORT-ID  status  title`; an element with a distance has it in front, how it points behind, its
 * mark emergent and its verification status per view last.
 */
export const elementLine = (
  element: Rec & { readonly shortId: string; readonly title: string },
  name: Namer = namerOf([]),
  view: ViewNamer = viewNamerOf([]),
): string => {
  const distance = element["distance"];
  return join(
    typeof distance === "number" ? String(distance) : "",
    withIdentifier(element.shortId, element["identifier"]),
    text(element["status"]),
    element.title,
    ...marksOf(element, name, view),
  );
};

/** One relation of an element: `-> kind  SHORT-ID  title`, the target state when it is not available. */
const relationLine = (r: Rec): string => {
  const state = text(r["targetState"]);
  return join(
    `${r["direction"] === "in" ? "<-" : "->"} ${text(r["kind"])}`,
    text(r["shortId"]) === "" ? text(r["id"]) : withIdentifier(text(r["shortId"]), r["identifier"]),
    text(r["title"]),
    state === "available" || state === "" ? "" : `[${state}]`,
  );
};

/** A criterion as `element get` lists it: `AK1 (k7f3) [SR-036/AK-k7f3]` (SR-205 AK1), `AK2` without key. */
export const criterionEntryLabel = (entry: Rec): string =>
  [nameOfCriterion(entry), typeof entry["reference"] === "string" ? entry["reference"] : ""]
    .filter((part) => part !== "")
    .join(" ");

/** `criterionReferences` of element.get and element.resolve (SR-205 AK1), read loosely; undefined without. */
export const criterionReferencesIn = (
  value: unknown,
): { readonly property: string; readonly criteria: Rec[] } | undefined =>
  isRecord(value) && typeof value["property"] === "string"
    ? { property: value["property"], criteria: listOf(value["criteria"]).filter(isRecord) }
    : undefined;

/**
 * Properties with every list of texts as a map from its item number, counted from 1, to the item, so
 * the YAML shows `1: ...` (#401). With `references` (element.get, element.resolve), the list of
 * acceptance criteria as a map from `AK1 (k7f3)` and the reference for a test name (SR-205 AK1) to
 * its text. Without (`element list --with-text`), a list whose items carry criterion keys is labelled
 * `AK1 (k7f3)` as well, a key in another form as none, as element.get shows it; a list without keys
 * cannot be told from another list of texts and stays numbered. Other values as they are.
 */
const numberedProperties = (
  properties: unknown,
  references?: ReturnType<typeof criterionReferencesIn>,
): unknown =>
  isRecord(properties)
    ? Object.fromEntries(
        Object.entries(properties).map(([key, value]) => {
          if (key === references?.property) {
            return [
              key,
              new Map(references.criteria.map((entry) => [criterionEntryLabel(entry), entry["text"]])),
            ];
          }
          if (
            !Array.isArray(value) ||
            value.length === 0 ||
            !value.map(criterionText).every((item) => typeof item === "string")
          ) {
            return [key, value];
          }
          const keyOf = (item: unknown): string | undefined => {
            const itemKey = criterionKey(item);
            return isCriterionKey(itemKey) ? itemKey : undefined;
          };
          const keyed = value.some((item) => criterionKey(item) !== undefined);
          return [
            key,
            new Map(
              value.map((item, i) => [
                keyed
                  ? nameOfCriterion({
                      criterion: i + 1,
                      ...(keyOf(item) === undefined ? {} : { key: keyOf(item) }),
                    })
                  : i + 1,
                criterionText(item),
              ]),
            ),
          ];
        }),
      )
    : properties;

/**
 * The details of an element below its line: what the line does not show, type and file first, the
 * relations one line each, the text last. The UUIDs of `names` in the values other than the
 * properties (shown as stored) print as the elements they name (`replacedBy`, `excludedBy`, SR-046 AK3).
 */
export const elementDetails = (
  element: Rec,
  names: Names,
  references?: ReturnType<typeof criterionReferencesIn>,
): string[] => {
  const {
    id,
    shortId: _shortId,
    identifier: _identifier,
    status: _status,
    title: _title,
    problems: _problems,
    verification: _verification,
    validation: _validation,
    validationReason: _validationReason,
    emergent: _emergent,
    repository,
    file,
    relations,
    text: body,
    ...rest
  } = element;
  const details: Record<string, unknown> = {
    id,
    type: rest["type"],
    file: `${text(repository)}:${text(file)}`,
    ...Object.fromEntries(
      Object.entries(rest).map(([key, value]) => [
        key,
        key === "properties" ? numberedProperties(value, references) : withNames(value, names),
      ]),
    ),
    relations: (Array.isArray(relations) ? relations : []).filter(isRecord).map(relationLine),
    text: body,
  };
  return indent(yamlLines(details));
};

/**
 * An element of a list that carries its text (element.list `withText`, #397), below its line: its
 * properties with lists of texts numbered from 1 (`1: ...`, the acceptance criteria), without those
 * that hold relation targets, which the relations show; the relations one line each; the text last.
 * Compact for review, smaller than the files (`--json` and `--yaml` keep everything).
 */
export const listedElementDetails = (element: Rec): string[] => {
  const relations = listOf(element["relations"]).filter(isRecord);
  const targetKeys = new Set(relations.filter((r) => r["property"] === true).map((r) => text(r["kind"])));
  const properties = Object.fromEntries(
    Object.entries(isRecord(element["properties"]) ? element["properties"] : {}).filter(
      ([key]) => !targetKeys.has(key),
    ),
  );
  const details: Record<string, unknown> = {
    ...(Object.keys(properties).length > 0 ? { properties: numberedProperties(properties) } : {}),
    ...(relations.length > 0 ? { relations: relations.map(relationLine) } : {}),
    text: element["text"],
  };
  return indent(yamlLines(details));
};

/**
 * A hint of a list: who, in the form of a problem line (`element → target`, #252; the element by
 * short ID with identifier, and title where core gives one (the hints of hint.list), else its file,
 * the target the same way when core names it, #172), the kind, the message, the view of outdated
 * evidence and the hint ID.
 */
export const findingLine = (finding: Rec, style?: Style): string => {
  // By short ID with identifier, as the other list lines of the CLI name elements: an identifier is
  // unique per type only, so alone it could name the wrong element (`--ref`).
  // Each with its title when it has one (SR-026 AK6), as `names` prints an element: `SHORT-ID  title`,
  // on one line however the title is written.
  const titleOf = (value: unknown): string =>
    text(value)
      .replace(/[\s\p{Cc}]+/gu, " ")
      .trim();
  const elementShortId = text(finding["elementShortId"]);
  const element =
    elementShortId === ""
      ? text(finding["file"])
      : join(nameOn(style, elementShortId, finding["elementIdentifier"]), titleOf(finding["elementTitle"]));
  const targetShortId = text(finding["targetShortId"]);
  const target =
    targetShortId === ""
      ? ""
      : join(nameOn(style, targetShortId, finding["targetIdentifier"]), titleOf(finding["targetTitle"]));
  const who = target === "" ? element : element === "" ? `→ ${target}` : `${element} → ${target}`;
  const hintId = text(finding["hintId"]);
  const hint = hintId === "" ? "" : `hint: ${hintId}`;
  // The view of outdated evidence (SR-026 AK6), `core` or the variant's UUID, as core gives it.
  const viewOf = text(finding["view"]);
  const view = viewOf === "" ? "" : `view: ${viewOf}`;
  if (style === undefined) {
    return join(who, text(finding["code"]), text(finding["message"]), view, hint);
  }
  // On a terminal (#988) its severity first, coloured by it, the hint ID faint.
  const severity = text(finding["severity"]);
  return join(
    style.severity(severity, severity),
    who,
    text(finding["code"]),
    text(finding["message"]),
    view,
    style.faint(hint),
  );
};

/**
 * `line` cut to `room` columns (`cut`) with the words that `marks` names strong (core's marks of a
 * search hit, SR-174: never computed here); a mark the cut ends is strong up to the cut.
 */
export const markedText = (line: string, marks: unknown, style: Style, room: number): string => {
  const shown = cut(line, room);
  const kept = shown === line ? line.length : shown.length - 1;
  let out = "";
  let at = 0;
  for (const mark of listOf(marks).filter(isRecord)) {
    const start = Math.max(at, Math.min(Number(mark["start"]), kept));
    const end = Math.max(start, Math.min(Number(mark["end"]), kept));
    out += `${line.slice(at, start)}${style.strong(line.slice(start, end))}`;
    at = end;
  }
  return `${out}${shown.slice(at)}`;
};

/**
 * Where a snippet of a search hit stands (SR-174, SR-222 AK3): `text`, or the property's name, with the
 * number and key of an acceptance criterion (`Acceptance Criteria AK3 (rqjp)`), the key strong when
 * core marks it; and its width.
 */
const snippetWhere = (snippet: Rec, style: Style): { readonly shown: string; readonly width: number } => {
  if (snippet["field"] === "text") {
    return { shown: style.faint("text:"), width: widthOf("text:") };
  }
  const name = text(snippet["propertyName"]);
  const criterion = snippet["criterion"];
  if (!isRecord(criterion) || typeof criterion["criterion"] !== "number") {
    return { shown: style.faint(`${name}:`), width: widthOf(`${name}:`) };
  }
  const number = `${name} AK${String(criterion["criterion"])}`;
  const key = typeof criterion["key"] === "string" ? criterion["key"] : undefined;
  if (key === undefined) {
    return { shown: style.faint(`${number}:`), width: widthOf(`${number}:`) };
  }
  const shownKey = criterion["keyMarked"] === true ? style.strong(key) : style.faint(key);
  return {
    shown: `${style.faint(`${number} (`)}${shownKey}${style.faint("):")}`,
    width: widthOf(`${number} (${key}):`),
  };
};

/**
 * The snippet of a search hit (element.search, SR-174), below its line: where it was found
 * (`snippetWhere`) and the line core gives, on a terminal cut to its width past `indent` columns, the
 * marked words strong.
 */
export const snippetLines = (element: Rec, style: Style = PLAIN, indent = 0): string[] => {
  const snippet = element["snippet"];
  if (!isRecord(snippet) || typeof snippet["text"] !== "string") {
    return [];
  }
  const where = snippetWhere(snippet, style);
  const room = style.width - indent - where.width - 3;
  return [`  ${where.shown} ${markedText(snippet["text"], snippet["marks"], style, room)}`];
};
