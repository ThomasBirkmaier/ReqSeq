// The module-level parts of the window (`App.tsx`): its messages and storages, the title bar of macOS, and
// the helpers of the modeline and the minibuffer. They hold no state.
import type { DataExportElement, MetamodelGetOutput } from "@reqseq/core";
import type { WorkspaceChangeReason } from "../shared/protocol.js";
import type { Buffer, MetamodelBuffer } from "./buffers.js";
import type { Draft } from "./drafts.js";
import type { DraftStorage } from "./draft-store.js";
import type { GraphFilterChoice } from "./graph-choices.js";
import type { BufferData, ElementHead, WorkspaceView } from "./modeline.js";
import { bufferView, elementHead } from "./modeline.js";
import type { RecentStorage } from "./recent.js";

export const MESSAGES: Readonly<Record<string, string>> = {
  restarted: "The background process of the app stopped and was started again.",
};

/** No relation kinds or properties: the metamodel is not read (yet). */
export const NO_RELATIONS: Pick<MetamodelGetOutput, "relations" | "properties"> = {
  relations: [],
  properties: [],
};

/**
 * The app's local storage, where the recent elements (SR-118 AK5) and the open buffers (SR-115 AK4) of a
 * workspace are kept; read when needed, it may throw.
 */
export const appStorage = (): RecentStorage => window.localStorage;

/**
 * The window's session storage, where its drafts are kept while the window is open, so that a page loaded
 * again after a crash gets them back (#270); read when needed, it may throw.
 */
export const windowStorage = (): DraftStorage => window.sessionStorage;

/**
 * Whether a status after `reason` starts the buffers of its workspace: the first one of a page, another
 * workspace, a restarted core before any workspace started in the page, or a workspace (`ok`) that a write
 * created in the folder open without one ("Create workspace": its overview, SR-226 AK2).
 */
export const startsBuffers = (
  reason: WorkspaceChangeReason | undefined,
  started: boolean,
  ok: boolean,
): boolean =>
  reason === undefined ||
  reason === "opened" ||
  (reason === "restarted" && !started) ||
  (reason === "written" && !started && ok);

/** The minibuffer's line when a page loaded again got drafts back (#270). */
export const draftsBack = (count: number): string =>
  `The window was loaded again; the unsaved input of ${count === 1 ? "1 buffer" : `${String(count)} buffers`} is back`;

/**
 * macOS: the window has no native title bar (ADR-0010, ThomasBirkmaier/ReqSeq-archive#490), so this strip of the sheet moves the window
 * and names it. It holds no control.
 */
export const TitleBar = ({
  shown,
  title,
}: {
  readonly shown: boolean;
  readonly title: string;
}): React.JSX.Element | null =>
  shown ? (
    <div className="titlebar" aria-hidden="true">
      {title}
    </div>
  ) : null;

/** The parts of the modeline for the shown buffer: what it loaded, and `modified` for unsaved text. */
export const modelineParts = (
  current: Buffer | undefined,
  loaded: { readonly key: string; readonly data: BufferData | undefined } | undefined,
  drafts: ReadonlyMap<string, Draft>,
  typeNames: ReadonlyMap<string, string>,
  graphChoices: readonly GraphFilterChoice[],
): string[] => {
  if (current === undefined) {
    return [];
  }
  const data = loaded?.key === current.key ? loaded.data : undefined;
  return bufferView(
    current,
    data?.kind === "element" && drafts.has(current.key) ? { ...data, modified: true } : data,
    typeNames,
    graphChoices,
  );
};

/** The first part of the modeline for the shown element, or none. */
export const headOf = (
  element: DataExportElement | undefined,
  typeNames: ReadonlyMap<string, string>,
): ElementHead | undefined => (element === undefined ? undefined : elementHead(element, typeNames));

/** The minibuffer's line: the last message, else why no workspace is open. */
export const echoLine = (echo: string, view: WorkspaceView | undefined): string =>
  echo === "" ? (view?.message ?? "") : echo;

/** The mode of the shown metamodel (SR-130 AK4); undefined for another buffer. */
export const metamodelMode = (buffer: Buffer | undefined): MetamodelBuffer["mode"] | undefined =>
  buffer?.kind === "metamodel" ? buffer.mode : undefined;

/** What the views of the shown buffers loaded, by buffer key. */
export type Loaded = ReadonlyMap<string, BufferData | undefined>;

/** `loaded` without the buffers no area shows; the same map when it has none of them. */
export const shownOnly = (loaded: Loaded, keys: readonly string[]): Loaded =>
  [...loaded.keys()].every((key) => keys.includes(key))
    ? loaded
    : new Map([...loaded].filter(([key]) => keys.includes(key)));
