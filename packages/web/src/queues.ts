// The work queues: each shows exactly what one ReqSeq command returns, grouped for reading. The data of all of
// them is read once per load of the store (`queueData`); an area adds a queue with `addQueue`.
import type { EvidenceCoverageOutput, EvidenceDegreeOutput, Problem } from "@reqseq/core";
import { call } from "./api.js";
import type { Child } from "./dom.js";
import {
  cap,
  hasMeaning,
  isInitial,
  isInvalid,
  isNeed,
  isReq,
  initialStatus,
  needWords,
  relKind,
  settledStatuses,
  settledWords,
  statusName,
  typeName,
  typePlural,
} from "./meaning.js";
import { verificationMark } from "./marks.js";
import type { ElementPart } from "./store.js";
import { PAGE, el, hasVariants, store, verificationOf, viewSelection } from "./store.js";

/** A row of a queue: the element and what the queue says about it. */
export interface QueueRow {
  readonly id: string;
  /** Title and IDs where the store has no such element (a hint names it). */
  readonly fallback?: Pick<ElementPart, "identifier" | "shortId" | "title">;
  readonly meta?: Child;
}

export interface QueueGroup {
  readonly title: string | null;
  readonly rows: readonly QueueRow[];
}

export interface Queue {
  readonly key: string;
  readonly title: () => string;
  /** The name in the rail, where it differs from the title. */
  readonly short?: () => string;
  readonly sub: () => string;
  /** Its rows show that something is broken. */
  readonly warn?: boolean;
  /** How many rows the overview shows of it. */
  readonly head?: number;
  readonly groups: () => readonly QueueGroup[];
}

/** What the queues read, once per load of the store. */
export interface QueueData {
  readonly epoch: number;
  readonly degree: EvidenceDegreeOutput;
  readonly hints: readonly Problem[];
  readonly coverage: EvidenceCoverageOutput;
  readonly settledOpen: readonly string[];
}

let data: QueueData | undefined;
let loading: Promise<QueueData> | undefined;

/** The data of the queues for the store as it is loaded now. */
export async function queueData(): Promise<QueueData> {
  if (data?.epoch === store.epoch) {
    return data;
  }
  const epoch = store.epoch;
  if (loading === undefined) {
    const selection = viewSelection();
    const settled = settledStatuses(store.mm);
    loading = Promise.all([
      call("evidence.degree", { selection }),
      call("hint.list", {
        limit: PAGE,
        ...(hasVariants() && store.view !== "core" ? { variant: store.view } : {}),
      }),
      call("evidence.coverage", { selection }),
      settled.length === 0
        ? Promise.resolve({ partial: [] })
        : call("element.list", {
            limit: PAGE,
            fields: ["title"],
            selection: {
              ...selection,
              where: {
                all: [
                  { status: settled },
                  { verification: ["open"], ...(hasVariants() ? { variant: store.view } : {}) },
                ],
              },
            },
          }),
    ])
      .then(([degree, hints, coverage, open]) => ({
        epoch,
        degree,
        hints: hints.hints,
        coverage,
        settledOpen: (open.partial ?? []).map((e) => e.id),
      }))
      .finally(() => {
        loading = undefined;
      });
  }
  data = await loading;
  return data;
}

const current = (): QueueData => {
  if (data === undefined) {
    throw new Error("The queues are read before their data");
  }
  return data;
};

/** One row per element with a hint of `code`, in ReqSeq's order. */
const hintRows = (code: string, meta: (hints: readonly Problem[]) => Child): QueueRow[] => {
  const by = new Map<string, Problem[]>();
  for (const hint of current().hints) {
    if (hint.code === code && hint.elementId !== undefined) {
      by.set(hint.elementId, [...(by.get(hint.elementId) ?? []), hint]);
    }
  }
  return [...by].map(([id, hints]) => {
    const first = hints[0];
    return {
      id,
      ...(first?.elementShortId === undefined
        ? {}
        : {
            fallback: {
              shortId: first.elementShortId,
              ...(first.elementIdentifier === undefined ? {} : { identifier: first.elementIdentifier }),
              ...(first.elementTitle === undefined ? {} : { title: first.elementTitle }),
            },
          }),
      meta: meta(hints),
    };
  });
};

const single = (rows: readonly QueueRow[]): readonly QueueGroup[] => [{ title: null, rows }];

const criteriaMeta = (id: string): string => {
  const v = verificationOf(id);
  return v?.total === undefined ? "" : `${String(v.verified)} of ${String(v.total)} criteria verified`;
};

const queues = new Map<string, Queue>();

export function addQueue(queue: Queue): void {
  queues.set(queue.key, queue);
}

export const queueOf = (key: string): Queue | undefined => queues.get(key);
/** The queues in the order of the overview. */
export const allQueues = (): readonly Queue[] => [...queues.values()];
export const rowsOf = (queue: Queue): readonly QueueRow[] => queue.groups().flatMap((g) => g.rows);

addQueue({
  key: "evidence-outdated",
  title: () => "Evidence outdated",
  sub: () => "Each of these changed after its tests ran. New test results will verify it again.",
  warn: true,
  head: 5,
  groups: () => single(hintRows("evidence.outdated", () => "Tests ran against an older version")),
});

addQueue({
  key: "approved-no-evidence",
  title: () => `${settledWords(store.mm)}, not fully verified`,
  // In the rail a long list of status names would wrap; "Not fully verified" says the same there.
  short: () =>
    settledStatuses(store.mm).length > 1
      ? "Not fully verified"
      : `${settledWords(store.mm)}, not fully verified`,
  sub: () =>
    `${settledWords(store.mm)} elements with at least one criterion that no passed test covers for the current version.`,
  groups: () =>
    single(
      current()
        .settledOpen.filter((id) => store.verification.get(id)?.verification !== undefined)
        .map((id) => ({ id, meta: criteriaMeta(id) })),
    ),
});

addQueue({
  key: "missing-relation",
  title: () => "Missing a required relation",
  sub: () => "The metamodel asks for at least a number of relations of a kind; these elements have fewer.",
  warn: true,
  groups: () =>
    single(
      hintRows("relation.too-few", (hints) =>
        hints
          .map(
            (hint) =>
              `${relKind(store.mm, hint.key ?? "")?.name ?? hint.key ?? ""} ${typeName(store.mm, hint.targetType).toLowerCase()}: ${String(hint.count ?? 0)} of at least ${String(hint.limit ?? 0)}`,
          )
          .join("; "),
      ),
    ),
});

addQueue({
  key: "links",
  title: () => "Links to review",
  sub: () => "Links whose target changed after the link was made.",
  groups: () =>
    single(
      hintRows("relation.outdated", (hints) =>
        hints
          .map((hint) => `${hint.targetIdentifier ?? hint.targetShortId ?? ""} changed since it was linked`)
          .join(", "),
      ),
    ),
});

addQueue({
  key: "needs-without",
  title: () => `${cap(needWords(store.mm))} not yet covered`,
  sub: () => `${cap(needWords(store.mm))} that nothing derives from yet.`,
  groups: () =>
    single(
      current()
        .coverage.levels.filter((level) => isNeed(store.mm, level.type))
        .flatMap((level) => level.elements.withoutChildren)
        .filter((id) => !isInvalid(store.mm, el(id)?.status))
        .map((id) => ({ id, meta: "Nothing derives from it yet" })),
    ),
});

/** Requirement types first, then needs, then the rest, with variants and packages last. */
const typeRank = (type: string | undefined): number =>
  isReq(store.mm, type)
    ? 0
    : isNeed(store.mm, type)
      ? 1
      : hasMeaning(store.mm, type, "variant") || hasMeaning(store.mm, type, "package")
        ? 3
        : 2;

addQueue({
  key: "drafts",
  // Elements in the status new elements get (the metamodel marks it initial).
  title: () => {
    const name = statusName(store.mm, initialStatus(store.mm));
    return `${name === "Draft" ? "Drafts" : name} to decide`;
  },
  sub: () => {
    const names = settledStatuses(store.mm).map((key) => statusName(store.mm, key));
    return `Still ${statusName(store.mm, initialStatus(store.mm))}. Set ${names.length > 0 ? names.join(" or ") : "another status"} when the team agrees.`;
  },
  head: 5,
  groups: () => {
    const by = new Map<string, QueueRow[]>();
    for (const e of store.byId.values()) {
      if (isInitial(store.mm, e.status)) {
        const type = e.type ?? "";
        by.set(type, [
          ...(by.get(type) ?? []),
          { id: e.id, meta: verificationMark(verificationOf(e.id)?.status) },
        ]);
      }
    }
    return [...by]
      .sort((a, b) => typeRank(a[0]) - typeRank(b[0]))
      .map(([type, rows]) => ({ title: typePlural(store.mm, type), rows }));
  },
});

/** How many elements `queue` lists. */
export const countOf = (queue: Queue): number => rowsOf(queue).length;

/** The phrase of the verification degree, as ReqSeq counts it. */
export const degreeOf = (): EvidenceDegreeOutput["degree"] => current().degree.degree;
