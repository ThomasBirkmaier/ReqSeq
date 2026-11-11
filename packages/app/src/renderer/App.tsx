// The window: a white sheet with one buffer (D-061..D-063), or two side by side after "Split window"
// (SR-115 AK3, `window-layout.ts`), the modeline (a display) and the minibuffer, the one control, below it.
// The sheet shows the most recent buffer: a list, a search result or an element; the modeline names the
// buffer of the active area. Nothing else is permanently visible (SR-100). Every datum comes from a
// catalog command through the bridge (ADR-0002); the app only builds inputs and shows outputs.
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { DataExportElement, MetamodelGetOutput } from "@reqseq/core";
import type { CommandListing, InvokeResult, WorkspaceChangeReason } from "../shared/protocol.js";
import type { ReqSeqBridge } from "../shared/protocol.js";
import type { ActionContext, ElementControls, Prompt } from "./actions.js";
import {
  ACTIONS,
  actionFor,
  commandPrompt,
  historyKeyAction,
  isBufferMouseButton,
  mouseButtonAction,
  referencePrompt,
  runAction,
} from "./actions.js";
import type { BufferKeep, UndoMemory } from "./buffer-memory.js";
import { forgetClosed, memoryOf, queueSave, savesDone } from "./buffer-memory.js";
import { loadSession, restoreSession, saveSession, sessionKey, sessionText } from "./buffer-session.js";
import { catalogItems } from "./catalog-commands.js";
import type { Draft } from "./drafts.js";
import type { DraftStorage, KeptDrafts } from "./draft-store.js";
import { takeDrafts, useWindowDrafts } from "./draft-store.js";
import type { Buffer, ElementBuffer, MetamodelBuffer } from "./buffers.js";
import { elementBuffer, elementBufferOf, inMatrix, overviewBuffer } from "./buffers.js";
import type { AreaViews } from "./BufferArea.js";
import { BufferArea } from "./BufferArea.js";
import type { Call } from "./call.js";
import { callOn } from "./call.js";
import type { ShownView } from "./views.js";
import { inView, variantTypesOf, viewMark } from "./views.js";
import type { PropertyModel } from "./element-view.js";
import { propertyModel } from "./element-view.js";
import type { GraphFilterChoice } from "./graph-choices.js";
import { graphFilterChoices, graphMeanings, graphTakesEvidence, relationNames } from "./graph-choices.js";
import { PREFIX } from "./bindings.js";
import { COMMAND_SHORTCUT, isMac, matches } from "./keys.js";
import { Minibuffer } from "./Minibuffer.js";
import { ModelineBar } from "./ModelineBar.js";
import type { Walk } from "./buffer-cycle.js";
import { NO_WALK, cycleOrder } from "./buffer-cycle.js";
import type { PackageModel } from "./package-page.js";
import { packageModel } from "./package-page.js";
import type { BufferData, ElementHead, WorkspaceView } from "./modeline.js";
import {
  bufferView,
  elementHead,
  readOnlyNow,
  markToken,
  markedElement,
  matrixSpot,
  selectedRow,
  shownElement,
  windowTitle,
  workspaceView,
} from "./modeline.js";
import { useOverview } from "./OverviewView.js";
import type { OutsideChanges } from "./outside-marks.js";
import { NO_CHANGES, arrivals, nextChanges } from "./outside-marks.js";
import {
  CLOSE_NOT_IN_TIME,
  CLOSE_WINDOW,
  closeUnsaved,
  leftUnsaved,
  notSaved,
  notSavedInTime,
  saveDrafts,
  saveOne,
} from "./switch.js";
import type { RecentEntry, RecentStorage } from "./recent.js";
import { loadRecent, recentKey, remember, saveRecent } from "./recent.js";
import { referenceTitles } from "./reference-titles.js";
import { createTheme } from "./theme.js";
import { FoldStatuses, foldCondition, loadFoldChoice, saveFoldChoice } from "./fold-statuses.js";
import type { FoldChoice, FoldStatus } from "./fold-statuses.js";
import { commandPromptKey } from "./command-entry.js";
import { docsEcho, withHelp } from "./docs-help.js";
import { ContextMenuLayer } from "./ContextMenu.js";
import type { OpenedMenu } from "./context-menu.js";
import { openEntries } from "./context-menu.js";
import { menuContext, promptEntry } from "./entry-menu.js";
import { useContextMenu } from "./use-context-menu.js";
import { useCopyNotice } from "./use-copy-notice.js";
import type { AboutInfo } from "./about.js";
import { AboutLayer } from "./AboutWindow.js";
import { useFollow } from "./use-follow.js";
import { usePrefix } from "./use-prefix.js";
import { promptUse } from "./usage.js";
import { EMPTY_WINDOW, areas, isSplit, reduceWindow } from "./window-layout.js";
import type { MarkState, PendingMark } from "./follow-mark.js";
import { NO_MARK, markStep } from "./follow-mark.js";
import { stoppedMessage } from "../shared/open-hint.js";

const MESSAGES: Readonly<Record<string, string>> = {
  restarted: "The core process stopped and was started again.",
};

/** No relation kinds or properties: the metamodel is not read (yet). */
const NO_RELATIONS: Pick<MetamodelGetOutput, "relations" | "properties"> = { relations: [], properties: [] };

/**
 * The app's local storage, where the recent elements (SR-118 AK5) and the open buffers (SR-115 AK4) of a
 * workspace are kept; read when needed, it may throw.
 */
const appStorage = (): RecentStorage => window.localStorage;

/**
 * The window's session storage, where its drafts are kept while the window is open, so that a page loaded
 * again after a crash gets them back (#270); read when needed, it may throw.
 */
const windowStorage = (): DraftStorage => window.sessionStorage;

/**
 * Whether a status after `reason` starts the buffers of its workspace: the first one of a page, another
 * workspace, or a restarted core before any workspace started in the page.
 */
const startsBuffers = (reason: WorkspaceChangeReason | undefined, started: boolean): boolean =>
  reason === undefined || reason === "opened" || (reason === "restarted" && !started);

/** The minibuffer's line when a page loaded again got drafts back (#270). */
const draftsBack = (count: number): string =>
  `The window was loaded again; the unsaved input of ${count === 1 ? "1 buffer" : `${String(count)} buffers`} is back`;

/**
 * macOS: the window has no native title bar (ADR-0010, ThomasBirkmaier/ReqSeq-archive#490), so this strip of the sheet moves the window
 * and names it. It holds no control.
 */
const TitleBar = ({
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
const modelineParts = (
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
const headOf = (
  element: DataExportElement | undefined,
  typeNames: ReadonlyMap<string, string>,
): ElementHead | undefined => (element === undefined ? undefined : elementHead(element, typeNames));

/** The minibuffer's line: the last message, else why no workspace is open. */
const echoLine = (echo: string, view: WorkspaceView | undefined): string =>
  echo === "" ? (view?.message ?? "") : echo;

/** The mode of the shown metamodel (SR-130 AK4); undefined for another buffer. */
const metamodelMode = (buffer: Buffer | undefined): MetamodelBuffer["mode"] | undefined =>
  buffer?.kind === "metamodel" ? buffer.mode : undefined;

/** What the views of the shown buffers loaded, by buffer key. */
type Loaded = ReadonlyMap<string, BufferData | undefined>;

/** `loaded` without the buffers no area shows; the same map when it has none of them. */
const shownOnly = (loaded: Loaded, keys: readonly string[]): Loaded =>
  [...loaded.keys()].every((key) => keys.includes(key))
    ? loaded
    : new Map([...loaded].filter(([key]) => keys.includes(key)));

export const App = ({ bridge }: { readonly bridge: ReqSeqBridge }): React.JSX.Element => {
  const [view, setView] = useState<WorkspaceView | undefined>(undefined);
  const [echo, setEcho] = useState("");
  const [stopped, setStopped] = useState(false);
  // Another workspace is being opened (SR-131 AK3): from main's request to save until it is open, or
  // until it is not. The sheet takes no input then, so nothing is typed that the switch would drop.
  const [switching, setSwitching] = useState(false);
  const switchingNow = useRef(false);
  // Counts the switches, so a save that ends after its switch was given up leaves the state alone.
  const switchRun = useRef(0);
  const leaveSwitching = useCallback((): void => {
    switchRun.current += 1;
    switchingNow.current = false;
    setSwitching(false);
  }, []);
  // A field is copied: the main process writes the clipboard, the modeline says so (SR-128).
  const { notice, copy, notify } = useCopyNotice(bridge);
  // The window "About ReqSeq" (SR-161): the output of `tool.info` while it is open.
  const [about, setAbout] = useState<AboutInfo | undefined>(undefined);
  const aboutOpen = useRef(false);
  aboutOpen.current = about !== undefined;
  // The buffers and the areas of the window (SR-115 AK3): one reducer, so they never disagree.
  const [windowState, dispatch] = useReducer(reduceWindow, EMPTY_WINDOW);
  const { buffers, layout } = windowState;
  const split = isSplit(layout);
  const shownAreas = areas(windowState);
  const current = buffers[0];
  // The drafts are kept outside the page too (#270, `draft-store.ts`): a page loaded again after a crash
  // takes them back.
  const {
    drafts,
    armed,
    onDraft,
    update: updateDraft,
    reset: resetDrafts,
    seed: seedDrafts,
    rescope: rescopeDrafts,
  } = useWindowDrafts(current?.key, windowStorage);
  // Per element buffer while it is open (SR-105): its undo history, and its saves, in order.
  const memories = useRef(new Map<string, UndoMemory>());
  const saves = useRef(new Map<string, Promise<unknown>>());
  const [prompt, setPrompt] = useState<{ readonly serial: number; readonly prompt: Prompt } | undefined>(
    undefined,
  );
  // The prompt that is open, so a prompt that replaces it can cancel it (ThomasBirkmaier/ReqSeq-archive#604 review, S2).
  const openPrompt = useRef<Prompt | undefined>(undefined);
  // Counts up when the workspace changed: the shown buffer asks for its data again.
  const [revision, setRevision] = useState(0);
  // The changes from outside that named elements (SR-116, SR-106): every view but an element buffer
  // reads again on each, an element buffer only on its own; what changed is highlighted where it is shown.
  const fresh = useMemo(() => arrivals(), []);
  const [outside, setOutside] = useState<OutsideChanges>(() => ({ ...NO_CHANGES, fresh: fresh.fresh }));
  const [loadedByKey, setLoaded] = useState<Loaded>(new Map());
  const loaded =
    current === undefined || !loadedByKey.has(current.key)
      ? undefined
      : { key: current.key, data: loadedByKey.get(current.key) };
  const serial = useRef(0);
  const sheet = useRef<HTMLElement>(null);
  const stoppedRef = useRef(false);
  // The names of the types by their key, from the metamodel, for the modeline of an element (SR-114).
  const [typeNames, setTypeNames] = useState<ReadonlyMap<string, string>>(new Map());
  // The types that are packages: their elements show the elements that name them (SR-112).
  const [packages, setPackages] = useState<PackageModel | undefined>(undefined);
  // The types with the meaning `variant`: their pages follow every change from outside (SR-103).
  const [variantTypes, setVariantTypes] = useState<ReadonlySet<string>>(new Set());
  // The properties of each type: which boxes are edited in place (SR-104) and which show Markdown (SR-127).
  const [properties, setProperties] = useState<PropertyModel>(new Map());
  // The relation kinds and properties of the metamodel, and the meanings `trace.graph` takes (from the
  // catalog): the entries of a graph's relation kind prompts and the names of its modeline (SR-111 AK3).
  const [relationModel, setRelationModel] = useState(NO_RELATIONS);
  const [meanings, setMeanings] = useState<readonly string[]>([]);
  // Whether `trace.graph` takes `withEvidence`: then the kind prompts offer "Evidence" (SR-111 AK3).
  const [evidence, setEvidence] = useState(false);
  const graphChoices = useMemo(
    () => graphFilterChoices(meanings, relationModel, evidence),
    [meanings, relationModel, evidence],
  );
  // The names of the relation kinds and relation properties by key: the text of a link in the graph (SR-154).
  const kindNames = useMemo(() => relationNames(relationModel), [relationModel]);
  const [elementControls, setElementControls] = useState<ElementControls | undefined>(undefined);
  // The elements opened last in this workspace (SR-118): kept in the app's storage under `scope`, not in the workspace.
  const [recent, setRecent] = useState<readonly RecentEntry[]>([]);
  const recentRef = useRef<readonly RecentEntry[]>([]);
  // Their names for "Go to" (SR-115 AK1), by buffer key: as the overview read them, or as they were shown.
  // Go to asks core nothing when it opens, so its search is not queued behind reads of these elements.
  const recentNames = useRef(new Map<string, ElementBuffer>());
  const scope = useRef<string | undefined>(undefined);
  // The order Next and Previous buffer walk (SR-115 AK5), and the buffer they switched to last.
  const walk = useRef<Walk>(NO_WALK);
  // The workspace whose open buffers are stored (SR-115 AK4): set once the buffers stored for it are
  // restored, unset when another workspace opens. So the reset of a start or a switch never overwrites
  // what is still to be restored.
  const [session, setSession] = useState<string | undefined>(undefined);
  // What was stored last (the key and the text), so that a change of a selected row alone writes nothing.
  const sessionStored = useRef<string | undefined>(undefined);

  // Whether the keys are macOS's, read as the app renders; also in the messages that name a key (the menu bar
  // may be hidden, #1189).
  const mac = isMac(navigator.platform);
  // The same for the calls and the start, which read it when they answer (no new subscription per render).
  const macRef = useRef(mac);
  macRef.current = mac;
  // After the core process stopped for good nothing is sent to it: the buffers stay as they are.
  const call = useMemo<Call>(() => {
    const run = callOn(bridge);
    return (name, input) =>
      stoppedRef.current
        ? Promise.resolve({ ok: false, code: "workspace.not-found", message: stoppedMessage(macRef.current) })
        : run(name, input);
  }, [bridge]);
  // The view the window shows (SR-043 AK1, `views.ts`): display state, all elements at the start and
  // after another workspace opens. The views of the buffers read in it; saves and single elements do not.
  const [shownView, setShownView] = useState<ShownView | undefined>(undefined);
  // The statuses that fold to the end of lists (SR-201): the user's choice, the same for every workspace
  // and kept for the next start (AK4).
  const [foldChoice, setFoldChoice] = useState<FoldChoice>(() => loadFoldChoice(appStorage));
  // The statuses of the metamodel, which say what folds; none until it is read, so nothing folds then.
  const [statuses, setStatuses] = useState<readonly FoldStatus[]>([]);
  const folded = useMemo(() => foldCondition(foldChoice, statuses), [foldChoice, statuses]);
  const viewCall = useMemo(() => inView(call, shownView), [call, shownView]);
  // The titles of reference targets in other repositories (D-058), for the workspace that is open.
  const titles = useMemo(() => referenceTitles(call), [call]);
  const titlesRef = useRef(titles);
  titlesRef.current = titles;

  useEffect(() => {
    let mounted = true;
    // If the metamodel cannot be read, the modeline shows the keys of the types.
    const loadTypeNames = async (): Promise<void> => {
      const metamodel = await callOn(bridge)("metamodel.get", {});
      if (mounted) {
        setTypeNames(
          metamodel.ok ? new Map(metamodel.output.types.map((type) => [type.key, type.name])) : new Map(),
        );
        setPackages(metamodel.ok ? packageModel(metamodel.output) : undefined);
        setVariantTypes(new Set(metamodel.ok ? variantTypesOf(metamodel.output) : []));
        setProperties(metamodel.ok ? propertyModel(metamodel.output) : new Map());
        setRelationModel(metamodel.ok ? metamodel.output : NO_RELATIONS);
        setStatuses(metamodel.ok ? metamodel.output.statuses : []);
      }
    };
    // The buffers of a workspace that has loaded: none of the one before, no drafts, no undo histories.
    const startBuffers = (reason: "opened" | undefined, ok: boolean): void => {
      resetDrafts();
      memories.current.clear();
      // A prompt opened while another workspace loaded stays (the old buffers went at `opened`).
      if (reason === undefined) {
        openPrompt.current = undefined;
        setPrompt(undefined);
      }
      // The first buffer is the calm overview, not the list of all elements (SR-118).
      dispatch({ type: "reset", ...(ok ? { buffer: overviewBuffer() } : {}) });
    };
    // Counts the workspaces opened in this window: the status of one that was left (a load that hung,
    // answered by the closed connection when the next one opened) never overwrites the next one's view.
    let opened = 0;
    // The storage key of the open workspace's buffers as its last status gave it: its name or
    // repositories can change while it is open, and the buffers follow (SR-115 AK4).
    let currentKey: string | undefined;
    // The buffers open when this workspace was last left come back behind the overview (SR-115 AK4): the
    // overview shows at once (SR-118 AK1), the restored ones once their elements are named.
    const restoreBuffers = (key: string | undefined, asked: number, back?: KeptDrafts): void => {
      if (key === undefined) {
        return;
      }
      void restoreSession(loadSession(appStorage, key), callOn(bridge), () => bridge.commands()).then(
        (restored) => {
          if (!mounted || asked !== opened) {
            return;
          }
          // A name that could not be read (core restarting) keeps the stored
          // buffers as they are: nothing is stored for this workspace until it opens again.
          if (restored.complete) {
            setSession(currentKey);
          }
          // A page loaded again gets the drafts of the buffers that came back, and shows the buffer it
          // showed (#270); a draft whose buffer did not come back is not kept.
          const keys = new Set(restored.buffers.map((buffer) => buffer.key));
          const drafts = new Map([...(back?.drafts ?? [])].filter(([draft]) => keys.has(draft)));
          if (drafts.size > 0) {
            seedDrafts(drafts);
            setEcho(draftsBack(drafts.size));
          }
          dispatch({ type: "restore", buffers: restored.buffers });
          const shown = back?.shown;
          if (shown !== undefined && keys.has(shown)) {
            dispatch({ type: "switch", key: shown });
          }
        },
      );
    };
    // The name or the repositories of the open workspace changed (its file was edited, or core
    // restarted): the buffers move to the new key, so the next start finds them (SR-115 AK4). A status
    // without a workspace keeps the key, so a failed read stops nothing.
    const followKey = (moved: string | undefined): void => {
      if (moved !== undefined) {
        currentKey = moved;
        rescopeDrafts(moved);
        setSession((before) => (before === undefined ? undefined : moved));
      }
    };
    // Whether a workspace has started in this page: until then a restarted core starts it, as the
    // first status does (a page loaded again while core restarted, #270).
    let started = false;
    // A workspace is there in a page that started, or another one opened: its buffers start, and on the
    // first workspace of a page the drafts kept in this window for it come back with their buffers
    // (#270), taken before the start drops anything.
    const begin = (result: InvokeResult, reason: "opened" | undefined, asked: number): void => {
      currentKey = sessionKey(result);
      const back =
        reason === undefined && currentKey !== undefined ? takeDrafts(windowStorage, currentKey) : undefined;
      startBuffers(reason, result.ok);
      rescopeDrafts(currentKey);
      started ||= currentKey !== undefined;
      restoreBuffers(currentKey, asked, back);
    };
    const refresh = async (reason: WorkspaceChangeReason | undefined): Promise<void> => {
      const asked = opened;
      const result = await bridge.invoke("workspace.status", {});
      if (!mounted || asked !== opened) {
        return;
      }
      const next = workspaceView(result, macRef.current);
      setView(next);
      document.title = windowTitle(next);
      // The minibuffer said "Opening another workspace…" until the new one answers; drafts that come
      // back with the buffers say so after it.
      if (reason === "opened" || reason === "restarted") {
        setEcho(MESSAGES[reason] ?? "");
      }
      if (startsBuffers(reason, started)) {
        begin(result, reason === "opened" ? "opened" : undefined, asked);
      } else {
        followKey(sessionKey(result));
      }
      if (reason === "restarted") {
        leaveSwitching();
      }
      const key = recentKey(result);
      if (key !== scope.current) {
        scope.current = key;
        recentNames.current.clear();
        recentRef.current = key === undefined ? [] : loadRecent(appStorage, key);
        setRecent(recentRef.current);
      }
      // The shown buffer asks again, also a list that is the same list of another workspace.
      if (reason !== undefined) {
        setRevision((count) => count + 1);
      }
      // The type names come with the workspace; the modeline shows keys until they are there. A write of
      // the app changes no metamodel (no command writes it), so autosave does not read it every second.
      if (result.ok && reason !== "written") {
        void loadTypeNames();
      } else if (!result.ok) {
        setTypeNames(new Map());
        setStatuses([]);
        setPackages(undefined);
        setVariantTypes(new Set());
        setProperties(new Map());
        setRelationModel(NO_RELATIONS);
      }
    };
    void refresh(undefined);
    const unsubscribe = bridge.on("workspace-changed", (change) => {
      if (change.reason === "external" && change.elements !== undefined) {
        fresh.record(change.elements);
        // Elements only: the metamodel and the workspace stay, the views read again (D3 of the plan).
        if (change.scope === "elements") {
          const { elements } = change;
          setOutside((before) => nextChanges(before, elements, fresh.fresh));
          return;
        }
      }
      // A save of this window reports `written`, its message ("Saved ...") stays; a change from outside
      // is quiet (D-062). The core process stopped for good: a switch ends now, no refresh follows.
      // Opened ends a switch at once; restarted ends one after its refresh.
      if (change.reason === "stopped") {
        setEcho(stoppedMessage(macRef.current));
        leaveSwitching();
        stoppedRef.current = true;
        setStopped(true);
      } else {
        stoppedRef.current = false;
        setStopped(false);
        // The titles of reference targets are kept for one workspace and one core process: another
        // workspace asks them again, and so does a core that restarted (it may have failed to answer).
        if (change.reason === "opened" || change.reason === "restarted") {
          titlesRef.current.clear();
        }
        // Another workspace is open (SR-131 AK3): the buffers and drafts of the old one go at once, before
        // the new one has loaded, so nothing typed then is dropped or saved into the other workspace, and
        // the switch ends at once: a load that hangs never keeps the window locked. The overview of the
        // new workspace comes with its status.
        if (change.reason === "opened") {
          opened += 1;
          // Nothing is stored until the buffers of the workspace now opened are restored.
          setSession(undefined);
          setShownView(undefined);
          resetDrafts();
          memories.current.clear();
          openPrompt.current = undefined;
          setPrompt(undefined);
          // "About ReqSeq" named the workspace that is gone.
          setAbout(undefined);
          dispatch({ type: "reset" });
          leaveSwitching();
        }
        void refresh(change.reason);
      }
    });
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, [bridge]);

  // What the shown element buffer lets the app do, at once (a prompt that opens saves its input first).
  const controlsNow = useRef(elementControls);
  controlsNow.current = elementControls;
  // What comes before a command from the prompt or the context menu (SR-194 AK2): the typing in the element
  // ends and its input is saved now (SR-105, binding review point 6), so the command starts from the saved
  // file, and the last message goes.
  const beforeCommand = useCallback((): void => {
    controlsNow.current?.prompting();
    setEcho("");
  }, []);
  const ask = useCallback(
    (next: Prompt): void => {
      // A prompt that replaces an open one (Ctrl/Cmd+Shift+P over "Insert reference") cancels it, as Escape
      // does: an editor that waited for its element waits no longer, so autosave is not held for ever.
      const replaced = openPrompt.current;
      openPrompt.current = next;
      replaced?.cancel?.();
      beforeCommand();
      serial.current += 1;
      setPrompt({ serial: serial.current, prompt: next });
    },
    [beforeCommand],
  );

  // Light and dark (SR-113): the choice is an attribute on the root, so no React state; the live media
  // query gives the system's scheme at the time of the call.
  const theme = useMemo(
    () => createTheme(document.documentElement, window.matchMedia("(prefers-color-scheme: dark)")),
    [],
  );

  // The mode „Agent folgen“ (SR-117): display state of the window, off at the start.
  const follow = useFollow({
    bridge,
    call,
    buffers,
    other: layout.other,
    dispatch,
    drafts: drafts.current.size,
    prompt: prompt !== undefined,
    drafted: (key) => drafts.current.has(key),
    echo: setEcho,
    refresh: () => {
      setRevision((count) => count + 1);
    },
  });

  // Saves the draft of an element buffer that is not shown (SR-105 AK1: it was left), after the saves of
  // it that run. True when none of its input is left unsaved; else the minibuffer says why.
  const saveKept = (buffer: ElementBuffer): Promise<boolean> =>
    queueSave(saves.current, buffer.key, async () => {
      const draft = drafts.current.get(buffer.key);
      if (draft === undefined) {
        return true;
      }
      const result = await saveOne(
        {
          call,
          buffers: [buffer],
          drafts: drafts.current,
          properties: propertiesNow.current,
          saved: (key) => {
            onDraft(key, undefined);
          },
          rebased: onDraft,
        },
        buffer,
        draft,
      );
      if (!result.ok) {
        setEcho(leftUnsaved(result));
      }
      return result.ok;
    });
  // What the app keeps of the shown element buffer (SR-105): its undo history, its saves in order, and its
  // draft, which the app saves once the buffer is left.
  const keepOf = (buffer: ElementBuffer): BufferKeep => ({
    memory: memoryOf(memories.current, buffer.key),
    ready: async () => {
      await savesDone(saves.current, buffer.key);
      return drafts.current.get(buffer.key);
    },
    save: (job) => queueSave(saves.current, buffer.key, job),
    update: (change) => {
      updateDraft(buffer.key, change);
    },
    left: (save) => {
      if (save) {
        void saveKept(buffer);
      }
    },
  });
  // The undo history of a buffer goes with the buffer (closed, or pushed out by the buffers kept).
  useEffect(() => {
    forgetClosed(
      memories.current,
      buffers.map((buffer) => buffer.key),
    );
  }, [buffers]);

  walk.current = cycleOrder(walk.current, buffers);
  // The open buffers are stored on every change, for the next start (SR-115 AK4).
  useEffect(() => {
    if (session === undefined) {
      return;
    }
    const text = sessionText(buffers);
    if (sessionStored.current !== `${session}\n${text}`) {
      sessionStored.current = `${session}\n${text}`;
      saveSession(appStorage, session, text);
    }
  }, [buffers, session]);
  // The default of an element argument when no element is shown (ThomasBirkmaier/ReqSeq-archive#85).
  const row = selectedRow(current, loaded);
  const marked = markedElement(current, loaded);
  const context: ActionContext = {
    workspace: view?.name !== undefined,
    readOnly: readOnlyNow(view),
    buffers,
    cycleOrder: walk.current.order,
    cycled: (key) => {
      walk.current = { order: walk.current.order, cycled: key };
    },
    leaveEditor: () => {
      const focused = document.activeElement;
      if (focused instanceof HTMLElement && focused.closest(".cm-editor") !== null) {
        focused.blur();
      }
    },
    mac,
    theme,
    call,
    shownCall: viewCall,
    dispatch,
    ask,
    echo: setEcho,
    about: setAbout,
    copy,
    // "Paste" (SR-195 AK3): main pastes into the field that has the focus now; it refuses without a click
    // or Enter just before (`main/edit.ts`).
    paste: () => {
      void bridge.pasteText().then((pasted) => {
        if (!pasted) {
          setEcho("The clipboard cannot be used here");
        }
      });
    },
    notify,
    // The bundled documentation in the browser (SR-141): main serves it on loopback and opens the page.
    docs: (topic) => {
      void bridge.openDocs(topic).then((result) => {
        setEcho(docsEcho(result));
      });
    },
    recent: () =>
      recentRef.current.flatMap((entry) => {
        const known = recentNames.current.get(elementBuffer(entry.id, entry.repository, "").key);
        return known === undefined ? [] : [known];
      }),
    ...(elementControls === undefined ? {} : { element: elementControls }),
    ...(row === undefined ? {} : { row }),
    ...(marked === undefined ? {} : { marked }),
    ...matrixSpot(current, loaded),
    // The element of an entry in the command prompt (SR-197): the marked one where the buffer has none of its own.
    ...promptEntry(current, marked),
    modified: current !== undefined && drafts.current.has(current.key),
    closeArmed: (key) => armed.current === key,
    armClose: (key) => {
      armed.current = key;
    },
    discard: (key) => {
      onDraft(key, undefined);
    },
    drafted: (key) => drafts.current.has(key),
    // The element of the inactive area (SR-115 AK3) is saved from its draft, like one that is not shown:
    // it took no input since it became inactive, when it saved its input (`ElementView`, `active`), and
    // both saves go through the same queue of its key, so a save still running is waited for.
    saveDraft: (key) => {
      const buffer = buffers.find((open) => open.key === key);
      if (buffer?.kind !== "element") {
        return Promise.resolve(true);
      }
      return key === current?.key && elementControls !== undefined
        ? elementControls.flush()
        : saveKept(buffer);
    },
    graphChoices,
    follow: follow.controls,
    // Split window (SR-115 AK3): display state of the window, like the mode „Agent folgen“.
    layout: {
      other: layout.other,
      split: () => {
        dispatch({ type: "split", marked });
      },
      unsplit: () => {
        dispatch({ type: "unsplit" });
      },
      beside: (side, buffer) => {
        dispatch({ type: "beside", side, buffer });
      },
    },
    // "Choose view" (SR-043 AK1): the shown buffers read again in the chosen view.
    views: {
      shown: shownView,
      choose: (next) => {
        setShownView(next);
        setRevision((count) => count + 1);
      },
    },
    // "Fold status in lists" (SR-201): the lists read again with the new choice.
    folds: {
      choice: foldChoice,
      choose: (next) => {
        setFoldChoice(next);
        saveFoldChoice(() => window.localStorage, next);
      },
    },
    // "Open workspace" (SR-131): main lists the workspaces opened last and opens one in this window.
    workspaces: {
      name: view?.name,
      list: () => bridge.recentWorkspaces(),
      open: (...request) => bridge.openWorkspace(...request),
      listFolder: (path) => bridge.listFolder(path),
    },
  };

  // The shortcuts are read from the latest context, so one listener serves all renders.
  const latest = useRef(context);
  latest.current = context;
  const propertiesNow = useRef(properties);
  propertiesNow.current = properties;
  // Help > ReqSeq Documentation (SR-141 AK2): as the action "Open documentation".
  useEffect(() => bridge.onHelp(() => latest.current.docs?.()), [bridge]);
  // Before another workspace opens in this window (also from File > Open Workspace), main asks to save
  // the unsaved input; it switches only when all is saved (SR-131 AK3, `switch.ts`). From then on the
  // window is switching: the sheet takes no input and the minibuffer says so, until the other workspace
  // is open, the save failed, or main gave up waiting (`save-expired`).
  useEffect(() => {
    // Before the window closes, also when the app quits (SR-105 AK1: closing leaves the element): the
    // same saves, without the switching state. Input that cannot be saved keeps the window open once,
    // with the reason in the minibuffer; the next close discards it, unless input or an action came
    // in between (the question of "Close buffer").
    // The save of a workspace switch while it runs (SR-131): a close waits for it, so it does not save
    // the same drafts a second time and report the refused second write as unsaved (ThomasBirkmaier/ReqSeq-archive#611 review N3).
    let switchSave: Promise<boolean> | undefined;
    const beforeClose = async (): Promise<boolean> => {
      if (armed.current === CLOSE_WINDOW) {
        return true;
      }
      let result: Awaited<ReturnType<typeof saveDrafts>>;
      try {
        await switchSave;
        await controlsNow.current?.flush();
        await Promise.all([...saves.current.keys()].map((key) => savesDone(saves.current, key)));
        result = await saveDrafts({
          call,
          buffers: latest.current.buffers,
          drafts: drafts.current,
          properties: propertiesNow.current,
          saved: (key) => {
            onDraft(key, undefined);
          },
          rebased: onDraft,
        });
      } catch (error) {
        result = { ok: false, name: "The input", message: String(error) };
      }
      if (result.ok) {
        return true;
      }
      armed.current = CLOSE_WINDOW;
      setEcho(closeUnsaved(result));
      return false;
    };
    const beforeSwitch = async (): Promise<boolean> => {
      switchRun.current += 1;
      const run = switchRun.current;
      switchingNow.current = true;
      setSwitching(true);
      openPrompt.current = undefined;
      setPrompt(undefined);
      latest.current.leaveEditor();
      setEcho("Opening another workspace…");
      let saved = false;
      try {
        // The input of the shown buffer, and the saves of buffers left just before, come first.
        await controlsNow.current?.flush();
        await Promise.all([...saves.current.keys()].map((key) => savesDone(saves.current, key)));
        const result = await saveDrafts({
          call,
          buffers: latest.current.buffers,
          drafts: drafts.current,
          properties: propertiesNow.current,
          saved: (key) => {
            onDraft(key, undefined);
          },
          rebased: onDraft,
        });
        saved = result.ok;
        if (!result.ok) {
          setEcho(notSaved(result));
        }
      } catch (error) {
        setEcho(`The unsaved input could not be saved (${String(error)}); the workspace was not changed`);
      }
      if (!saved && run === switchRun.current) {
        leaveSwitching();
      }
      return saved;
    };
    const unset = bridge.onSave(({ closing }) => {
      if (closing) {
        return beforeClose();
      }
      switchSave = beforeSwitch();
      return switchSave;
    });
    const unsubscribe = bridge.on("save-expired", (expired) => {
      // Before a close: the window stays open, and a close soon after closes it without waiting.
      if (expired.closing === true) {
        setEcho(CLOSE_NOT_IN_TIME);
        return;
      }
      leaveSwitching();
      setEcho(notSavedInTime(latest.current.workspaces?.name));
    });
    return () => {
      unset();
      unsubscribe();
    };
  }, [bridge, call]);
  // The catalog, read once (it is the same for every workspace), and the revision now, read when a command runs.
  const catalog = useRef<readonly CommandListing[]>([]);
  // The read of the catalog while it runs: a command prompt opened meanwhile, just after a folder was
  // opened, gets the catalog's commands ("Initialise workspace", the minibuffer's hint) when they are there (#1413).
  const catalogRead = useRef<Promise<void> | undefined>(undefined);
  // What a view that shows several elements reads again on: any change of the workspace, also from outside.
  const seen = revision + outside.seq;
  const revisionNow = useRef(seen);
  revisionNow.current = seen;
  useEffect(() => {
    const load = (): void => {
      const read = bridge
        .commands()
        .then(
          (commands) => {
            catalog.current = commands;
            setMeanings(graphMeanings(commands));
            setEvidence(graphTakesEvidence(commands));
          },
          (error: unknown) => {
            // Without the catalog the command prompt has the app's actions only; say why.
            setEcho(String(error));
          },
        )
        .finally(() => {
          if (catalogRead.current === read) {
            catalogRead.current = undefined;
          }
        });
      catalogRead.current = read;
    };
    load();
    // After a start without a workspace there was no core process to ask: ask the one just opened.
    return bridge.on("workspace-changed", (change) => {
      if (change.reason === "opened" && catalog.current.length === 0) {
        load();
      }
    });
  }, [bridge]);
  // The command prompt: the actions that apply now and the catalog's read and write commands (ThomasBirkmaier/ReqSeq-archive#85);
  // without a workspace, "Initialise workspace" of the folder core opened (`catalogItems`). `shown`: the
  // prompt is shown, so Escape in the first prompt of an action chosen in it shows it again (SR-134 AK1); its
  // entries run from the prefix key or the context menu have no command prompt to go back to.
  // While the catalog is read, the prompt opens with the actions and takes keys, and its entries are built
  // again with the catalog's commands once it is there (`fill`); an Enter meanwhile waits for them.
  const commands = useCallback(
    (shown = true): Prompt => {
      // Backspace before the first argument of a catalog command, and Escape in the first prompt of an action
      // chosen here (SR-134 AK1), open the command prompt again.
      const reopen = (): void => {
        ask(commands());
      };
      const build = (): Prompt => {
        const now = latest.current;
        const items = catalogItems(
          { ...now, revision: () => revisionNow.current, reopen },
          catalog.current,
          ACTIONS,
        );
        return withHelp(
          commandPrompt(now, promptUse(appStorage), items, shown ? reopen : undefined),
          now,
          catalog.current,
        );
      };
      const prompt = build();
      const reading = catalogRead.current;
      return reading === undefined
        ? prompt
        : { ...prompt, fill: reading.then(() => ({ items: build().items })) };
    },
    [ask],
  );
  // The prefix key (SR-109 AK3): Ctrl/Cmd+K, then a letter runs an entry of the command prompt.
  const prefix = usePrefix({
    mac: context.mac,
    items: () => commands(false).items,
    nameOf: (id) =>
      ACTIONS.find((action) => action.id === id)?.title ??
      catalog.current.find((command) => `command:${command.name}` === id)?.title,
    setEcho,
    buffers,
    switching,
  });
  const startPrefix = prefix.start;
  // An open prompt ends without an answer, as Escape ends it.
  const cancelPrompt = (): void => {
    if (openPrompt.current !== undefined) {
      openPrompt.current.cancel?.();
      follow.closed(true);
      openPrompt.current = undefined;
      setPrompt(undefined);
    }
  };
  const cancelPromptNow = useRef(cancelPrompt);
  cancelPromptNow.current = cancelPrompt;
  // The context menu (D-075, SR-194): which entries it shows is worked out when it opens (`openEntries`);
  // they are taken from the command prompt's entries on every render, so the entry clicked runs from the
  // latest context.
  const menuEntriesNow = useRef<readonly string[]>([]);
  const openedMenu = useRef<OpenedMenu | undefined>(undefined);
  const chooseEntry = (index: number): void => {
    const id = menuEntriesNow.current[index];
    contextMenu.close();
    if (id === undefined) {
      // "All commands…" (AK3): the command prompt with an empty input, as Ctrl/Cmd+Shift+P gives it on this
      // buffer: from the context without the menu's entry (SR-197), so no name is listed twice.
      latest.current = context;
      ask(commands());
      return;
    }
    beforeCommand();
    commands(false)
      .items.find((item) => item.id === id)
      ?.run();
  };
  const chooseNow = useRef(chooseEntry);
  chooseNow.current = chooseEntry;
  const contextMenu = useContextMenu({
    mac: context.mac,
    // Not over the window "About ReqSeq" (SR-161), which takes every input while it is open.
    blocked: () => switchingNow.current || aboutOpen.current,
    shown: current?.key,
    prompting: prompt !== undefined,
    onOpen: () => {
      cancelPromptNow.current();
    },
    count: () => menuEntriesNow.current.length + 1,
    choose: (index) => {
      chooseNow.current(index);
    },
  });
  // The menu of an entry acts on the element of the entry (SR-197): while it is open, the commands are built
  // from the context with that element, so its entries and the one clicked act on it.
  latest.current = menuContext(context, contextMenu.menu, kindNames);
  const menuNow = openEntries(contextMenu.menu, () => commands(false).items, openedMenu.current);
  openedMenu.current = menuNow.opened;
  const shownEntries = menuNow.entries;
  menuEntriesNow.current = shownEntries.map((entry) => entry.id);
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      // A key that a control already handled (the minibuffer, the editor, a list) is no shortcut.
      if (event.defaultPrevented) {
        return;
      }
      const now = latest.current;
      // While another workspace opens, no key acts on the one that is closing (SR-131 AK3).
      if (switchingNow.current) {
        event.preventDefault();
        return;
      }
      // The command prompt opens also without a workspace ("Open workspace", SR-131); nothing else does.
      if (matches(event, COMMAND_SHORTCUT, now.mac)) {
        event.preventDefault();
        ask(commands());
        return;
      }
      if (!now.workspace) {
        return;
      }
      // The prefix starts in this event, so the next key finds it waiting; not while a prompt is open,
      // whose input takes the keys (SR-109 AK3).
      if (openPrompt.current === undefined && matches(event, PREFIX, now.mac)) {
        event.preventDefault();
        startPrefix();
        return;
      }
      // Cmd+[ and Cmd+] as the mouse buttons Back and Forward (SR-163 AK3), like them not in an open prompt.
      const action =
        actionFor(now, (shortcut) => matches(event, shortcut, now.mac)) ??
        (openPrompt.current === undefined ? historyKeyAction(now, event) : undefined);
      if (action !== undefined) {
        event.preventDefault();
        runAction(action, now);
      }
    };
    // The mouse buttons Back and Forward run Previous and Next buffer as Alt+P and Alt+N do (SR-163), on
    // the release, where Chromium would go back in the history; they never navigate the window. Like the
    // keys, not while another workspace opens or a prompt is open.
    const onMouse = (event: MouseEvent): void => {
      if (event.defaultPrevented || !isBufferMouseButton(event.button)) {
        return;
      }
      event.preventDefault();
      const now = latest.current;
      if (
        switchingNow.current ||
        openPrompt.current !== undefined ||
        contextMenu.isOpen() ||
        !now.workspace
      ) {
        return;
      }
      const action = mouseButtonAction(now, event.button);
      if (action !== undefined) {
        runAction(action, now);
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mouseup", onMouse);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mouseup", onMouse);
    };
  }, [ask, commands, startPrefix, contextMenu.isOpen]);

  // The shown buffer has the focus, so its keys work; after a prompt the focus comes back to it, unless
  // the action of the prompt put it into the buffer already (the text editor). The matrix replaces the
  // list in place (one key), and the text the graph of the metamodel (SR-130 AK4), so the mode is a reason
  // to look for the focus too (Ctrl+T has no prompt).
  // With two areas it is the active one (SR-115 AK3): a change of the active area moves the focus there,
  // without scrolling it; a press in the area then puts the focus where it pressed.
  useEffect(() => {
    const area = sheet.current?.querySelector<HTMLElement>(`[data-area="${layout.active}"]`);
    // Not while "About ReqSeq" is open: it keeps the focus (SR-161), and gives it back when it closes.
    if (prompt === undefined && about === undefined && area?.contains(document.activeElement) !== true) {
      area?.querySelector<HTMLElement>("[data-buffer]")?.focus({ preventScroll: true });
    }
  }, [prompt, about, current?.key, inMatrix(current), metamodelMode(current), layout.active]);

  // An element that is shown (opened or switched to) is the newest of the recent elements; not one that
  // the mode „Agent folgen“ showed (SR-117), so an agent does not replace the user's.
  useEffect(() => {
    const byMode = follow.seen(current?.key);
    if (!byMode && current?.kind === "element" && scope.current !== undefined) {
      recentNames.current.set(current.key, current);
      recentRef.current = remember(recentRef.current, { id: current.id, repository: current.repository });
      setRecent(recentRef.current);
      saveRecent(appStorage, scope.current, recentRef.current);
    }
  }, [current?.key]);

  // SR-150 AK4, AK5: in a split window a preview in the inactive area follows what the reader newly marks in
  // the active one (`follow-mark.ts`, `window-layout.ts`).
  const token = markToken(current);
  const lastMark = useRef<MarkState>(NO_MARK);
  const pendingMark = useRef<PendingMark | undefined>(undefined);
  useEffect(() => {
    const other = layout.other;
    const now: MarkState = { buffer: current?.key, token, marked: marked?.key, other };
    const step = markStep(lastMark.current, now, pendingMark.current);
    lastMark.current = now;
    pendingMark.current = step.pending;
    if (step.follow && other !== undefined && marked !== undefined && layout.preview !== undefined) {
      dispatch({ type: "follow", buffer: marked, replace: !drafts.current.has(other) });
    }
  }, [current?.key, token, marked?.key, layout.other, layout.preview]);

  const onData = useCallback((key: string, data: BufferData | undefined): void => {
    setLoaded((before) => new Map(before).set(key, data));
  }, []);
  // What a buffer that no area shows any more loaded goes: shown again, it loads again.
  const shownKeys = shownAreas.map((area) => area.buffer.key);
  useEffect(() => {
    setLoaded((before) => shownOnly(before, shownKeys));
  }, [shownKeys.join("\n")]);

  const openTarget = (id: string, repository?: string): void => {
    // A reference may name no repository, so the element is read once to get it (SR-088: several answers say so).
    // A reference names the repository when the link has one.
    void call("element.get", { ref: id, ...(repository === undefined ? {} : { repository }) }).then(
      (answer) => {
        if (answer.ok) {
          dispatch({ type: "open", buffer: elementBufferOf(answer.output.element) });
        } else {
          setEcho(answer.message);
        }
      },
    );
  };

  const overview = useOverview(
    viewCall,
    seen,
    recent,
    shownAreas.some((area) => area.buffer.kind === "overview"),
    setEcho,
  );
  // The names the overview read, once per answer: a name forgotten since is not brought back by it.
  useEffect(() => {
    for (const row of overview.read.values()) {
      recentNames.current.set(row.buffer.key, row.buffer);
    }
  }, [overview.read]);
  // A recent element that core no longer knows (deleted outside) is not offered under its old name (ThomasBirkmaier/ReqSeq-archive#681):
  // the overview's read, or the read of its buffer, found it gone. One `ref.unknown` is enough: while a
  // pull rewrites a file core briefly does not know it, and the next read of the overview names it again.
  useEffect(() => {
    for (const key of overview.gone) {
      recentNames.current.delete(key);
    }
  }, [overview.gone]);
  const forgetName = useCallback((key: string): void => {
    recentNames.current.delete(key);
  }, []);

  // A relation names the repository of its target (ThomasBirkmaier/ReqSeq-archive#416): its buffer is opened at once.
  const openRelation = (buffer: ElementBuffer): void => {
    dispatch({ type: "open", buffer });
  };

  // A press or a focus in the inactive area makes it active (SR-115 AK3); a prompt open for the other
  // area is cancelled, as Escape cancels it, so its choice does not act on the area left.
  const activate = (key: string): void => {
    cancelPrompt();
    dispatch({ type: "switch", key });
  };
  const views: AreaViews = {
    call: viewCall,
    revision,
    seen,
    outside,
    dispatch,
    onData,
    onEcho: setEcho,
    typeNames,
    kindNames,
    overview,
    element: (buffer) => ({
      onGone: forgetName,
      searchCall: call,
      onCopy: copy,
      onOpenTarget: openTarget,
      onOpenRelation: openRelation,
      onOpenResult: (opened) => {
        dispatch({ type: "open", buffer: opened });
      },
      onPickElement: (request) => {
        ask(referencePrompt(context, titles.picking(request)));
      },
      titles,
      onAsk: ask,
      draft: drafts.current.get(buffer.key),
      onDraft,
      keep: keepOf(buffer),
      register: setElementControls,
      packages,
      variantTypes,
      properties,
    }),
  };
  const parts = modelineParts(current, loaded, drafts.current, typeNames, graphChoices);
  return (
    <div className="shell">
      <TitleBar shown={context.mac} title={windowTitle(view)} />
      <main className="sheet" aria-label="Sheet" ref={sheet} inert={switching}>
        <FoldStatuses.Provider value={folded}>
          {shownAreas.map((area) => (
            <BufferArea
              key={area.side}
              area={area}
              split={split}
              views={views}
              onActivate={() => {
                activate(area.buffer.key);
              }}
            />
          ))}
        </FoldStatuses.Provider>
      </main>
      <ModelineBar
        parts={parts}
        view={view}
        stopped={stopped}
        follow={follow.mark}
        shown={viewMark(shownView)}
        head={headOf(shownElement(current, loaded), typeNames)}
        onCopy={copy}
        notice={notice}
      />
      <Minibuffer
        echo={echoLine(echo, view)}
        prompt={prompt}
        nextKeys={prefix.rows}
        onCommand={() => {
          if (!switchingNow.current) {
            ask(commands());
          }
        }}
        onClose={(cancelled) => {
          follow.closed(cancelled);
          openPrompt.current = undefined;
          setPrompt(undefined);
        }}
      />
      <ContextMenuLayer
        menu={contextMenu.menu}
        entries={shownEntries}
        allCommandsKey={commandPromptKey(context.mac)}
        onSelect={contextMenu.select}
        onChoose={chooseEntry}
      />
      <AboutLayer
        info={about}
        mac={context.mac}
        onCopy={copy}
        onClose={() => {
          setAbout(undefined);
        }}
      />
    </div>
  );
};
