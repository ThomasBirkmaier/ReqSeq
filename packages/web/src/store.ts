// What every page of the workspace reads, as ReqSeq returns it: the metamodel, the workspace's name, the variants
// and every element with its verification. Loaded once and again after a change; the store only looks things up,
// every number and status is ReqSeq's. An area keeps data of its own by `store.epoch`, which grows with each load.
import type { DataExportElementPart, DataExportRowVerification } from "@reqseq/core";
import type { InputOf, OutputOf } from "./api.js";
import { call } from "./api.js";
import { PAGE, allPages } from "./pages.js";
import type { Metamodel } from "./meaning.js";
import { propKey, typesWith } from "./meaning.js";
import { preference, setPreference } from "./preferences.js";

export type ElementPart = DataExportElementPart;

export interface Store {
  mm: Metamodel;
  workspaceName: string;
  /** `core` or the UUID of a variant: the view verification is shown for. */
  view: string;
  variants: readonly ElementPart[];
  byId: ReadonlyMap<string, ElementPart>;
  /** By identifier and by short ID, lower case. */
  byRef: ReadonlyMap<string, ElementPart>;
  verification: ReadonlyMap<string, DataExportRowVerification>;
  /** Grows with each load. */
  epoch: number;
}

/** Every page of `element.list` with `input`. */
export const listAll = (input: InputOf<"element.list">): Promise<OutputOf<"element.list">[]> =>
  allPages(
    (offset) => call("element.list", { ...input, limit: PAGE, offset }),
    (page) => page.partial?.length ?? 0,
  );

export const store: Store = {
  mm: { types: [], properties: [], relations: [], statuses: [] },
  workspaceName: "",
  view: preference("view", "core"),
  variants: [],
  byId: new Map(),
  byRef: new Map(),
  verification: new Map(),
  epoch: 0,
};

/** Whether the workspace can have variants at all (a property with the meaning validity). */
export const hasVariants = (): boolean => propKey(store.mm, "validity") !== undefined;
/** The view part of a selection: none where the workspace knows no variants, since ReqSeq refuses one there. */
export const viewSelection = (): { view?: string } => (hasVariants() ? { view: store.view } : {});

export function setView(view: string): void {
  store.view = view;
  setPreference("view", view);
}

export async function load(): Promise<Store> {
  const [mm, status] = await Promise.all([call("metamodel.get"), call("workspace.status")]);
  store.mm = mm;
  store.workspaceName = status.name;
  const variantTypes = typesWith(mm, "variant");
  store.variants =
    variantTypes.length === 0
      ? []
      : await listAll({ fields: ["title", "identifier"], selection: { where: { type: variantTypes } } }).then(
          (pages) => pages.flatMap((p) => p.partial ?? []),
        );
  if (store.view !== "core" && !store.variants.some((v) => v.id === store.view)) {
    setView("core");
  }
  const pages = await listAll({ withVerification: true, fields: ["title", "status", "type", "identifier"] });
  const list = {
    partial: pages.flatMap((p) => p.partial ?? []),
    rowVerification: pages.flatMap((p) => p.rowVerification ?? []),
  };
  const byId = new Map<string, ElementPart>();
  const byRef = new Map<string, ElementPart>();
  for (const e of list.partial) {
    byId.set(e.id, e);
    byRef.set(e.shortId.toLowerCase(), e);
    if (e.identifier !== undefined) {
      byRef.set(e.identifier.toLowerCase(), e);
    }
  }
  store.byId = byId;
  store.byRef = byRef;
  store.verification = new Map(list.rowVerification.map((r) => [r.id, r]));
  store.epoch += 1;
  return store;
}

/** An element by UUID, identifier or short ID. */
export const el = (ref: string | undefined): ElementPart | undefined =>
  ref === undefined ? undefined : (store.byId.get(ref) ?? store.byRef.get(ref.toLowerCase()));
/** How a route names an element: its identifier, else its short ID. */
export const refOf = (e: Pick<ElementPart, "identifier" | "shortId">): string => e.identifier ?? e.shortId;
/** The ID people read: the identifier; elements without one show none (the short ID is for links only). */
export const shownId = (e: Pick<ElementPart, "identifier"> | undefined): string => e?.identifier ?? "";
/** The verification of an element in the chosen view, as `element.list` gives it. */
export const verificationOf = (
  id: string,
): { status: string; verified?: number; total?: number } | undefined => {
  const row = store.verification.get(id);
  const entry = row?.verification?.find((v) => v.view === store.view);
  if (entry === undefined) {
    return undefined;
  }
  const criteria = entry.criteria ?? row?.criteria;
  return criteria === undefined
    ? { status: entry.status }
    : { status: entry.status, verified: criteria.verified, total: criteria.total };
};
export const variantName = (view: string): string =>
  view === "core" ? "Core" : (store.byId.get(view)?.title ?? view);
