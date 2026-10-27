// What the modeline and the minibuffer show of the open workspace (`workspace.status`). Pure display
// (SR-080 AK1): every value comes from the command's output or error object as it is.
import type { DataExportElement } from "@logreq/core";
import type { InvokeResult } from "../shared/protocol.js";
import type { Buffer, ElementBuffer, GraphBuffer } from "./buffers.js";
import { bufferName } from "./buffers.js";
import { depthLabel, filterLabel } from "./graph.js";
import type { GraphFilterChoice } from "./graph-choices.js";

/** The part of the `workspace.status` output the modeline shows. */
interface StatusOutput {
  readonly name: string;
  readonly readOnly: boolean;
  readonly problems?: readonly { readonly severity: string }[];
}

export interface WorkspaceView {
  /** The workspace's name; undefined while none is open. */
  readonly name: string | undefined;
  /** Further parts of the modeline, each only when it means something. */
  readonly marks: readonly string[];
  /** The line for the minibuffer: why no workspace is open. */
  readonly message: string;
}

const plural = (count: number, word: string): string => `${String(count)} ${word}${count === 1 ? "" : "s"}`;

/** The title of the window: the workspace's name, then the app's. On macOS the title bar shows it too. */
export const windowTitle = (view: WorkspaceView | undefined): string =>
  view?.name === undefined ? "LogReq" : `${view.name} - LogReq`;

export const workspaceView = (result: InvokeResult): WorkspaceView => {
  if (!result.ok) {
    return { name: undefined, marks: [], message: result.error.message };
  }
  const status = result.output as StatusOutput;
  const problems = status.problems ?? [];
  const errors = problems.filter((p) => p.severity === "error").length;
  const warnings = problems.filter((p) => p.severity === "warning").length;
  return {
    name: status.name,
    marks: [
      ...(status.readOnly ? ["read-only"] : []),
      ...(errors > 0 ? [plural(errors, "error")] : []),
      ...(warnings > 0 ? [plural(warnings, "warning")] : []),
    ],
    message: "",
  };
};

/** What a buffer has loaded, for its part of the modeline. */
export type BufferData =
  | {
      readonly kind: "list" | "search";
      readonly total: number;
      readonly incomplete: boolean;
      /** The elements of the loaded rows, in their order (the selected one is the default of an element argument, #85). */
      readonly rows?: readonly ElementBuffer[];
    }
  | { readonly kind: "overview"; readonly total: number; readonly incomplete: boolean }
  | { readonly kind: "neighbourhood"; readonly incomplete: boolean }
  | { readonly kind: "result"; readonly total: number | undefined }
  | {
      readonly kind: "graph";
      readonly nodes: number;
      readonly truncated: boolean;
      readonly incomplete: boolean;
    }
  | {
      readonly kind: "element";
      readonly element: DataExportElement;
      readonly modified?: boolean;
      /**
       * The file changed outside while the buffer has input that it no longer agrees with, or it is gone
       * (SR-106 AK2, AK3): something to notice (D-062), after the counts.
       */
      readonly disk?: "changed" | "deleted";
    };

/**
 * The element of the selected row of the shown list or search; undefined for any other buffer, while it
 * loads, or while no row is selected (a fresh list, SR-122).
 */
export const selectedRow = (
  current: Buffer | undefined,
  loaded: { readonly key: string; readonly data: BufferData | undefined } | undefined,
): ElementBuffer | undefined => {
  const data = loaded?.key === current?.key ? loaded?.data : undefined;
  if ((current?.kind !== "list" && current?.kind !== "search") || data?.kind !== current.kind) {
    return undefined;
  }
  const rows = data.rows ?? [];
  return rows[Math.min(current.cursor, rows.length - 1)];
};

/** The element that the shown buffer has loaded; undefined for any other buffer, or while it loads. */
export const shownElement = (
  current: Buffer | undefined,
  loaded: { readonly key: string; readonly data: BufferData | undefined } | undefined,
): DataExportElement | undefined =>
  loaded?.key === current?.key && loaded?.data?.kind === "element" ? loaded.data.element : undefined;

/** What a list says when a repository is missing for its answer. */
export const INCOMPLETE = "incomplete: a repository is missing";

/** The parts for an element: ID, type and status in one, then what is worth a mark. */
const elementParts = (
  data: Extract<BufferData, { readonly kind: "element" }>,
  typeNames: ReadonlyMap<string, string>,
): string[] => {
  const { element } = data;
  const outdated = element.relations.filter((relation) => relation.outdated === true).length;
  const hints = element.problems?.length ?? 0;
  return [
    [
      element.identifier ?? element.shortId,
      typeNames.get(element.type) ?? element.type,
      ...(element.status === undefined ? [] : [element.status]),
    ].join(" · "),
    ...(data.modified === true ? ["modified"] : []),
    ...(element.readOnly === true ? ["read-only"] : []),
    ...(outdated > 0 ? [`${String(outdated)} outdated`] : []),
    ...(hints > 0 ? [plural(hints, "hint")] : []),
    ...(data.disk === undefined ? [] : [`${data.disk} on disk`]),
  ];
};

/**
 * The parts for a graph (SR-111): its name, the depth, the kinds followed (only when some are chosen, by
 * the names of the relation kind prompts), the number of nodes, "more not shown" when `trace.graph` left
 * some out, and "incomplete".
 */
const graphParts = (
  buffer: GraphBuffer,
  data: Extract<BufferData, { readonly kind: "graph" }>,
  choices: readonly GraphFilterChoice[],
): string[] => {
  const filter = filterLabel(buffer, choices);
  return [
    bufferName(buffer),
    depthLabel(buffer.depth),
    ...(filter === undefined ? [] : [filter]),
    plural(data.nodes, "node"),
    ...(data.truncated ? ["more not shown"] : []),
    ...(data.incomplete ? [INCOMPLETE] : []),
  ];
};

/**
 * The parts of the modeline for the shown buffer, left of the workspace; each only when it says
 * something. Values are the output's as they are: nothing is computed about a status. An element is
 * named by its ID, its type by its name in the metamodel (else by its key) and its status, in one part
 * (SR-114 AK1). A graph names the kinds it follows as the entries of its relation kind prompts do.
 */
export const bufferView = (
  buffer: Buffer,
  data: BufferData | undefined,
  typeNames: ReadonlyMap<string, string> = new Map(),
  graphChoices: readonly GraphFilterChoice[] = [],
): string[] => {
  if (data === undefined) {
    return [bufferName(buffer)];
  }
  if (data.kind === "element") {
    return elementParts(data, typeNames);
  }
  if (data.kind === "neighbourhood") {
    return [bufferName(buffer), ...(data.incomplete ? [INCOMPLETE] : [])];
  }
  if (data.kind === "result") {
    return [bufferName(buffer), ...(data.total === undefined ? [] : [`${String(data.total)} in all`])];
  }
  if (data.kind === "graph") {
    // Data of a graph belongs to a graph buffer; anything else is named only.
    return buffer.kind === "graph" ? graphParts(buffer, data, graphChoices) : [bufferName(buffer)];
  }
  return [
    bufferName(buffer),
    plural(data.total, data.kind === "search" ? "hit" : "element"),
    ...(data.incomplete ? [INCOMPLETE] : []),
  ];
};
