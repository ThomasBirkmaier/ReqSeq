// The open buffers of a workspace, kept for the next time it opens (SR-115 AK4: "Gegeben die App wird
// geschlossen, wenn sie wieder geöffnet wird, dann sind die zuletzt offenen Buffer wieder da."). Display
// state of the app like the elements opened last (`recent.ts`): kept in the app's own local storage, per
// workspace, never in the files of the workspace (as SR-118 AK5) and not through a catalog command
// (SR-080 AK1: "außer reiner Darstellung der App", ADR-0002 rule 3).
//
// Stored is what rebuilds each buffer, in the order of use: the kind, the UUID and repository of an
// element, the kept parts of a list's query (`keptQuery`: steps and sort) and its mode, the text of a
// search with its steps (as a list keeps them, not the grouping), the input of a graph, the mode of the metamodel, the command and input of a result. Never an
// element's title or text, no output and no selected row. The names of the elements are read again when
// the workspace opens, with one `element.list`; an element that is gone is left out, as the overview
// leaves it out of its recent list. A result is run again when it is shown, and only when the catalog
// lists its command as an implemented read command, so a restore never writes.
import type { CommandTypes, FilterSortKeyWithDefaults, TraceGraphInput } from "@reqseq/core";
import type { CommandListing, InvokeResult } from "../shared/protocol.js";
import { fold } from "@reqseq/core/fold";
import { keptQuery } from "./list-query.js";
import { checkPerspective, checkedBuffer, perspectiveNamed } from "./perspective-actions.js";
import { memberQuery } from "./package-page.js";
import type {
  Buffer,
  Buffers,
  ElementBuffer,
  FilterStep,
  GraphDepth,
  ListBuffer,
  SearchBuffer,
  SearchField,
} from "./buffers.js";
import {
  MAX_BUFFERS,
  elementBuffer,
  elementBufferOf,
  filteredList,
  graphBuffer,
  metamodelBuffer,
  neighbourhoodBuffer,
  overviewBuffer,
  perspectiveBuffer,
  queryOf,
  readOnlyBuffer,
  resultBuffer,
  searchBuffer,
  savedOf,
  searchQueryOf,
} from "./buffers.js";
import type { Call } from "./call.js";
import { workspaceParts } from "./recent.js";

/** The part of `Storage` used here. */
export type SessionStorage = Pick<Storage, "getItem" | "setItem">;

/** An element by what identifies it. */
interface Named {
  readonly id: string;
  readonly repository: string;
}

/** One buffer as stored: only what rebuilds it. */
export type StoredBuffer =
  | { readonly kind: "overview" }
  | {
      readonly kind: "list";
      readonly steps: readonly FilterStep[];
      readonly sort?: readonly FilterSortKeyWithDefaults[];
      readonly matrix?: true;
    }
  /** The buffer of a perspective (SR-214 AK7): only its name, since it comes back as saved. */
  | { readonly kind: "perspective"; readonly name: string }
  | {
      readonly kind: "search";
      readonly query: string;
      readonly steps?: readonly FilterStep[];
      /** The fields the search is restricted to (SR-216 AK10). */
      readonly fields?: readonly SearchField[];
    }
  | (Named & {
      readonly kind: "element";
      readonly memberSort?: readonly FilterSortKeyWithDefaults[];
      readonly memberSteps?: readonly FilterStep[];
      /** Shown read-only (SR-044 AK2). */
      readonly readOnly?: true;
    })
  | (Named & { readonly kind: "neighbourhood"; readonly open: readonly string[] })
  | (Named & {
      readonly kind: "graph";
      readonly depth: GraphDepth;
      readonly kinds?: TraceGraphInput["kinds"];
      readonly meanings?: TraceGraphInput["meanings"];
      readonly withEvidence?: true;
      readonly view?: TraceGraphInput["view"];
    })
  | { readonly kind: "metamodel"; readonly mode: "graph" | "text" }
  | {
      readonly kind: "result";
      readonly command: string;
      readonly input: Readonly<Record<string, unknown>>;
      readonly name: string;
    };

/** The buffers of a workspace as stored, in the order of use. */
export interface StoredSession {
  readonly buffers: readonly StoredBuffer[];
}

/** The buffers to show again behind the open ones. */
export interface RestoredSession {
  readonly buffers: Buffers;
  /**
   * False when the name of an element could not be read for another reason than the element being gone
   * (core restarting): the buffers shown are not all that was stored, so
   * the stored session must stay as it is.
   */
  readonly complete: boolean;
}

/** Nothing stored, or nothing that could be read. */
export const NO_SESSION: StoredSession = { buffers: [] };

/**
 * The revision of a restored result: below every revision of the app, so the result view runs its
 * command when it is shown (`ResultView`), and only then.
 */
export const RESTORED_REVISION = -1;

/**
 * The storage key of a workspace's buffers: `reqseq.buffers.v1` (literal, like the other keys of the app;
 * a rename renames them together), then the name and repositories of the workspace (`workspaceParts`, as the recent elements). Undefined without a workspace.
 */
export const sessionKey = (status: InvokeResult): string | undefined => {
  const parts = workspaceParts(status);
  return parts === undefined ? undefined : ["reqseq.buffers.v1", ...parts].join("\n");
};

const ofElement = (buffer: Named): Named => ({ id: buffer.id, repository: buffer.repository });

/** The steps as stored: the label, the heading and the selection of each. */
const storedSteps = (steps: readonly FilterStep[]): FilterStep[] =>
  steps.map((step) => ({
    label: step.label,
    ...(step.heading === undefined ? {} : { heading: step.heading }),
    selection: step.selection,
  }));

/** What is stored of an element buffer: the element, the sort and the filter steps of a package page's elements, read-only. */
const storedElement = (buffer: ElementBuffer): StoredBuffer => {
  const kept = keptQuery(memberQuery(buffer));
  return {
    kind: "element",
    ...ofElement(buffer),
    ...(kept.sort === undefined ? {} : { memberSort: kept.sort }),
    ...(kept.steps.length === 0 ? {} : { memberSteps: storedSteps(kept.steps) }),
    ...(buffer.readOnly === true ? { readOnly: true as const } : {}),
  };
};

/**
 * What is stored of a search: its text, its fields (SR-216 AK10) and the steps a restart keeps (`keptQuery`), not
 * the grouping.
 */
const storedSearch = (buffer: SearchBuffer): StoredBuffer => {
  const kept = keptQuery(searchQueryOf(buffer));
  return {
    kind: "search",
    query: buffer.query,
    ...(kept.steps.length === 0 ? {} : { steps: storedSteps(kept.steps) }),
    ...(buffer.fields === undefined ? {} : { fields: buffer.fields }),
  };
};

/**
 * What is stored of a list: of a perspective buffer only the name, since it comes back as saved (SR-214
 * AK7); of any other what a restart keeps of the query (`keptQuery`): the steps and the sort, not the
 * grouping, and the mode.
 */
const storedList = (buffer: ListBuffer): StoredBuffer => {
  if (buffer.perspective !== undefined) {
    return { kind: "perspective", name: buffer.perspective.name };
  }
  const kept = keptQuery(queryOf(buffer));
  return {
    kind: "list",
    steps: storedSteps(kept.steps),
    ...(kept.sort === undefined ? {} : { sort: kept.sort }),
    ...(buffer.matrix === true ? { matrix: true as const } : {}),
  };
};

/** What is stored of `buffer`. */
const storedOf = (buffer: Buffer): StoredBuffer => {
  switch (buffer.kind) {
    case "overview":
      return { kind: "overview" };
    case "list":
      return storedList(buffer);
    case "search":
      return storedSearch(buffer);
    case "element":
      return storedElement(buffer);
    case "neighbourhood":
      return { kind: "neighbourhood", ...ofElement(buffer), open: buffer.open };
    case "graph":
      return {
        kind: "graph",
        ...ofElement(buffer),
        depth: buffer.depth,
        ...(buffer.kinds === undefined ? {} : { kinds: buffer.kinds }),
        ...(buffer.meanings === undefined ? {} : { meanings: buffer.meanings }),
        ...(buffer.withEvidence === true ? { withEvidence: true as const } : {}),
        ...(buffer.view === undefined ? {} : { view: buffer.view }),
      };
    case "metamodel":
      return { kind: "metamodel", mode: buffer.mode };
    case "result":
      return { kind: "result", command: buffer.command, input: buffer.input, name: buffer.name };
  }
};

/**
 * The text stored for `buffers`, in the order of use. The same buffers give the same text, also when only a selected row changed, so the app writes only when
 * something to restore changed.
 */
export const sessionText = (buffers: Buffers): string => {
  const session: StoredSession = { buffers: buffers.map(storedOf) };
  return JSON.stringify(session);
};

/** Stores the text of `sessionText`. Restoring is a convenience: a storage that fails is ignored. */
export const saveSession = (storage: () => SessionStorage, key: string, text: string): void => {
  try {
    storage().setItem(key, text);
  } catch {
    // Not stored; the workspace opens with the overview alone next time.
  }
};

type Fields = Readonly<Record<string, unknown>>;

const isObject = (value: unknown): value is Fields =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isText = (value: unknown): value is string => typeof value === "string";

const isTexts = (value: unknown): value is readonly string[] => Array.isArray(value) && value.every(isText);

const isSort = (value: unknown): value is readonly FilterSortKeyWithDefaults[] =>
  Array.isArray(value) &&
  value.every(
    (key) => isObject(key) && isText(key["by"]) && (key["order"] === "asc" || key["order"] === "desc"),
  );

const isStep = (value: unknown): value is FilterStep =>
  isObject(value) &&
  isText(value["label"]) &&
  (value["heading"] === undefined || isText(value["heading"])) &&
  isObject(value["selection"]) &&
  (value["selection"]["where"] === undefined || isObject(value["selection"]["where"])) &&
  (value["selection"]["filter"] === undefined || isText(value["selection"]["filter"]));

const isSteps = (value: unknown): value is readonly FilterStep[] =>
  Array.isArray(value) && value.length > 0 && value.every(isStep);

const isKinds = (value: unknown): value is NonNullable<TraceGraphInput["kinds"]> => isTexts(value);

/** The meanings as stored; `trace.graph` refuses one it does not know when the graph is shown. */
const isMeanings = (value: unknown): value is NonNullable<TraceGraphInput["meanings"]> => isTexts(value);

const isDepth = (value: unknown): value is GraphDepth =>
  value === "all" || (typeof value === "number" && Number.isInteger(value) && value > 0);

/**
 * `{ [key]: value }` when `value` is valid, `{}` when it is not set (so a stored `undefined` reads as not
 * set), undefined when it is not valid.
 */
const optional = <K extends string, T>(
  key: K,
  value: unknown,
  valid: (value: unknown) => value is T,
): Partial<Readonly<Record<K, T>>> | undefined => {
  if (value === undefined) {
    return {};
  }
  return valid(value) ? ({ [key]: value } as Partial<Readonly<Record<K, T>>>) : undefined;
};

/** The element a stored buffer names, when it names one by UUID and repository. */
const namedOf = (value: Fields): Named | undefined =>
  isText(value["id"]) && isText(value["repository"])
    ? { id: value["id"], repository: value["repository"] }
    : undefined;

const parseList = (value: Fields): StoredBuffer | undefined => {
  const sort = optional("sort", value["sort"], isSort);
  const steps = value["steps"];
  return Array.isArray(steps) && steps.every(isStep) && sort !== undefined
    ? { kind: "list", steps, ...sort, ...(value["matrix"] === true ? { matrix: true as const } : {}) }
    : undefined;
};

const parseSearch = (value: Fields): StoredBuffer | undefined => {
  const steps = optional(
    "steps",
    value["steps"],
    (found): found is FilterStep[] => Array.isArray(found) && found.every(isStep),
  );
  const fields = optional(
    "fields",
    value["fields"],
    (found): found is SearchField[] =>
      Array.isArray(found) &&
      found.length > 0 &&
      found.every((field: unknown) => isObject(field) && isText(field["key"]) && isText(field["name"])),
  );
  return isText(value["query"]) && steps !== undefined && fields !== undefined
    ? { kind: "search", query: value["query"], ...steps, ...fields }
    : undefined;
};

const parseElement = (value: Fields): StoredBuffer | undefined => {
  const named = namedOf(value);
  const memberSort = optional("memberSort", value["memberSort"], isSort);
  const memberSteps = optional("memberSteps", value["memberSteps"], isSteps);
  return named === undefined || memberSort === undefined || memberSteps === undefined
    ? undefined
    : {
        kind: "element",
        ...named,
        ...memberSort,
        ...memberSteps,
        ...(value["readOnly"] === true ? { readOnly: true as const } : {}),
      };
};

const parseNeighbourhood = (value: Fields): StoredBuffer | undefined => {
  const named = namedOf(value);
  const open = value["open"];
  return named === undefined || !isTexts(open) ? undefined : { kind: "neighbourhood", ...named, open };
};

const parseGraph = (value: Fields): StoredBuffer | undefined => {
  const named = namedOf(value);
  const depth = value["depth"];
  const kinds = optional("kinds", value["kinds"], isKinds);
  const meanings = optional("meanings", value["meanings"], isMeanings);
  const view = optional("view", value["view"], isText);
  return named === undefined ||
    !isDepth(depth) ||
    kinds === undefined ||
    meanings === undefined ||
    view === undefined
    ? undefined
    : {
        kind: "graph",
        ...named,
        depth,
        ...kinds,
        ...meanings,
        ...(value["withEvidence"] === true ? { withEvidence: true as const } : {}),
        ...view,
      };
};

/** How each kind of stored buffer is checked. */
const PARSERS: Readonly<Record<StoredBuffer["kind"], (value: Fields) => StoredBuffer | undefined>> = {
  overview: () => ({ kind: "overview" }),
  list: parseList,
  perspective: (value) => (isText(value["name"]) ? { kind: "perspective", name: value["name"] } : undefined),
  search: parseSearch,
  element: parseElement,
  neighbourhood: parseNeighbourhood,
  graph: parseGraph,
  metamodel: (value) =>
    value["mode"] === "graph" || value["mode"] === "text"
      ? { kind: "metamodel", mode: value["mode"] }
      : undefined,
  result: (value) =>
    isText(value["command"]) && isObject(value["input"]) && isText(value["name"])
      ? { kind: "result", command: value["command"], input: value["input"], name: value["name"] }
      : undefined,
};

/** One stored buffer, checked; undefined for anything else (a newer or foreign entry). */
const parseBuffer = (value: unknown): StoredBuffer | undefined => {
  if (!isObject(value)) {
    return undefined;
  }
  const kind = value["kind"];
  return isText(kind) && Object.hasOwn(PARSERS, kind)
    ? PARSERS[kind as StoredBuffer["kind"]](value)
    : undefined;
};

/**
 * The buffers stored under `key`, checked entry by entry: one that is not a buffer of this app is left
 * out. Broken or foreign content, or a storage that throws, gives `NO_SESSION`.
 */
export const loadSession = (storage: () => SessionStorage, key: string): StoredSession => {
  try {
    const stored = storage().getItem(key);
    const parsed: unknown = stored === null ? undefined : JSON.parse(stored);
    if (!isObject(parsed) || !Array.isArray(parsed["buffers"])) {
      return NO_SESSION;
    }
    const all: readonly unknown[] = parsed["buffers"];
    const read = all.slice(0, MAX_BUFFERS).map(parseBuffer);
    return { buffers: read.filter((buffer) => buffer !== undefined) };
  } catch {
    return NO_SESSION;
  }
};

const nameKey = (element: Named): string => `${element.repository}:${element.id}`;

/** The elements whose buffers need a name: elements, neighbourhoods and graphs. */
const namedIn = (session: StoredSession): readonly Named[] =>
  session.buffers.flatMap((buffer) =>
    buffer.kind === "element" || buffer.kind === "neighbourhood" || buffer.kind === "graph"
      ? [ofElement(buffer)]
      : [],
  );

/** The answers that say an element is gone (or its UUID not unique): it is left out for good. */
const GONE = new Set(["ref.unknown", "ref.ambiguous"]);

interface Names {
  readonly names: ReadonlyMap<string, string>;
  /** The keys of their types, by repository and UUID, for the elements drawn in advance (SR-212 AK5). */
  readonly types: ReadonlyMap<string, string>;
  /** False when a read failed for another reason than `GONE`. */
  readonly complete: boolean;
}

/**
 * The names of `elements` ("<short ID> (<identifier>) <title>", SR-084 AK4), by repository and UUID: one
 * `element.list` with their UUIDs. That call fails as a whole when one UUID is unknown (an element deleted
 * since) or in two repositories; then each is read with `element.get` and its repository. An element not
 * found has no name; one whose read failed otherwise has none either, and makes the names incomplete.
 */
const readNames = async (call: Call, elements: readonly Named[]): Promise<Names> => {
  const ids = [...new Set(elements.map((element) => element.id))];
  if (ids.length === 0) {
    return { names: new Map(), types: new Map(), complete: true };
  }
  const listed = await call("element.list", { selection: { ids } });
  if (listed.ok) {
    const elements = listed.output.elements ?? [];
    return {
      names: new Map(elements.map((element) => [nameKey(element), elementBufferOf(element).name])),
      types: new Map(elements.map((element) => [nameKey(element), element.type])),
      complete: true,
    };
  }
  const each = new Map(elements.map((element) => [nameKey(element), element]));
  const answers = await Promise.all(
    [...each.values()].map((element) =>
      call("element.get", { ref: element.id, repository: element.repository }),
    ),
  );
  const found = answers.flatMap((answer) => (answer.ok ? [answer.output.element] : []));
  return {
    names: new Map(found.map((element) => [nameKey(element), elementBufferOf(element).name])),
    types: new Map(found.map((element) => [nameKey(element), element.type])),
    complete: answers.every((answer) => answer.ok || GONE.has(answer.code)),
  };
};

/** The perspective buffers to show again, by folded name, and whether every name could be decided. */
interface Perspectives {
  readonly buffers: ReadonlyMap<string, Buffer>;
  /** False when a perspective could not be read for another reason than its own errors. */
  readonly complete: boolean;
}

/** The answers of `element.list` that are about the perspective itself (SR-213 AK6, AK8, an unknown name). */
const OWN = new Set(["input.invalid", "file.faulty"]);

/**
 * The perspective buffers of `names` as saved (SR-214 AK7): with one `perspective.list` and the check of
 * opening for each (`checkPerspective`). A listed perspective comes back from what is saved, without its
 * grouping when that can no longer be chosen (SR-213 AK7, its warning shown when the buffer is), and also
 * when core refuses it (a saved filter missing or faulty, SR-213 AK6): the buffer shows the error, as a
 * reload does. A name that only a faulty file holds comes back too, shows `file.faulty` and lists nothing. Only a name no
 * file holds is left out. A list that is incomplete or fails, or a check that fails for another reason,
 * leaves the restore incomplete, so the stored buffers stay for the next start.
 */
const readPerspectives = async (call: Call, names: readonly string[]): Promise<Perspectives> => {
  if (names.length === 0) {
    return { buffers: new Map(), complete: true };
  }
  const listed = await call("perspective.list", {});
  if (!listed.ok) {
    return { buffers: new Map(), complete: false };
  }
  const known = listed.output.incomplete !== true;
  // Each name once, as it was stored first.
  const byFold = new Map<string, string>();
  for (const name of names) {
    if (!byFold.has(fold(name))) {
      byFold.set(fold(name), name);
    }
  }
  const read = await Promise.all(
    [...byFold].map(async ([folded, name]) => {
      const found = perspectiveNamed(listed.output.perspectives, name);
      const check = await checkPerspective(call, found?.name ?? name);
      if (found !== undefined) {
        const own = check.ok || OWN.has(check.code);
        const buffer = check.ok
          ? checkedBuffer(found, check.output, true).buffer
          : perspectiveBuffer({ name: found.name, saved: savedOf(found, true) });
        return { folded, buffer, complete: own };
      }
      if (!check.ok && check.code === "file.faulty") {
        return { folded, buffer: perspectiveBuffer({ name, error: check.message }), complete: true };
      }
      // Gone: no file holds the name; undecided while the list or the check is not complete.
      return { folded, buffer: undefined, complete: known && !check.ok && check.code === "input.invalid" };
    }),
  );
  return {
    buffers: new Map(read.flatMap(({ folded, buffer }) => (buffer === undefined ? [] : [[folded, buffer]]))),
    complete: read.every((entry) => entry.complete),
  };
};

/** The commands a restored result may run: the implemented read commands of the catalog. */
const readCommands = (catalog: readonly CommandListing[]): ReadonlySet<string> =>
  new Set(catalog.filter((entry) => entry.implemented && entry.effect === "read").map((entry) => entry.name));

/** The element buffer `stored` rebuilds with its name and type: read-only, the sort and the filter steps of a package page. */
const rebuildElement = (
  stored: StoredBuffer & { readonly kind: "element" },
  name: string,
  type: string | undefined,
): Buffer => {
  const named = elementBuffer(stored.id, stored.repository, name);
  const element = type === undefined ? named : { ...named, type };
  return {
    ...(stored.readOnly === true ? readOnlyBuffer(element) : element),
    ...(stored.memberSort === undefined ? {} : { memberSort: stored.memberSort }),
    ...(stored.memberSteps === undefined ? {} : { memberSteps: stored.memberSteps }),
  };
};

/** The buffer `stored` rebuilds; undefined when it cannot be shown again. */
const rebuild = (
  stored: StoredBuffer,
  { names, types }: Pick<Names, "names" | "types">,
  runs: ReadonlySet<string>,
  perspectives: ReadonlyMap<string, Buffer>,
): Buffer | undefined => {
  switch (stored.kind) {
    case "overview":
      return overviewBuffer();
    case "list":
      return filteredList(stored.steps, stored.sort, stored.matrix === true);
    case "perspective":
      return perspectives.get(fold(stored.name));
    case "search":
      return searchBuffer(stored.query, stored.steps, undefined, stored.fields);
    case "metamodel":
      return metamodelBuffer(stored.mode);
    case "result":
      return runs.has(stored.command)
        ? resultBuffer(
            stored.command as keyof CommandTypes,
            stored.input,
            stored.name,
            undefined,
            RESTORED_REVISION,
          )
        : undefined;
    case "element":
    case "neighbourhood":
    case "graph": {
      const name = names.get(nameKey(stored));
      if (name === undefined) {
        return undefined;
      }
      if (stored.kind === "element") {
        return rebuildElement(stored, name, types.get(nameKey(stored)));
      }
      if (stored.kind === "neighbourhood") {
        return { ...neighbourhoodBuffer(stored.id, stored.repository, name), open: stored.open };
      }
      const { kind: _kind, id: _id, repository: _repository, ...input } = stored;
      return { ...graphBuffer(stored.id, stored.repository, name), ...input };
    }
  }
};

/**
 * The buffers of `session` as they open again: element-like ones named by `readNames`, those that are
 * gone left out (`complete` false when a name could not be read for another reason), results only of implemented read commands (`catalog`, which may fail: then none), each
 * key once. Reads only.
 */
export const restoreSession = async (
  session: StoredSession,
  call: Call,
  catalog: () => Promise<readonly CommandListing[]>,
): Promise<RestoredSession> => {
  if (session.buffers.length === 0) {
    return { buffers: [], complete: true };
  }
  const hasResult = session.buffers.some((buffer) => buffer.kind === "result");
  const [named, runs, perspectives] = await Promise.all([
    readNames(call, namedIn(session)),
    hasResult ? catalog().then(readCommands, () => new Set<string>()) : Promise.resolve(new Set<string>()),
    readPerspectives(
      call,
      session.buffers.flatMap((buffer) => (buffer.kind === "perspective" ? [buffer.name] : [])),
    ),
  ]);
  const rebuilt = session.buffers.map((stored) => rebuild(stored, named, runs, perspectives.buffers));
  const seen = new Set<string>();
  const buffers = rebuilt.flatMap((buffer) => {
    if (buffer === undefined || seen.has(buffer.key)) {
      return [];
    }
    seen.add(buffer.key);
    return [buffer];
  });
  return { buffers, complete: named.complete && perspectives.complete };
};
