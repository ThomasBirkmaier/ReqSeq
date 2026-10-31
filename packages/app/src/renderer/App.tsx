// The window: a white sheet with one buffer (D-061..D-063), or two side by side after "Split window"
// (SR-115 AK3, `window-layout.ts`), the modeline (a display) and the minibuffer, the one control, below it.
// The sheet shows the most recent buffer: a list, a search result or an element; the modeline names the
// buffer of the active area. Nothing else is permanently visible (SR-100). Every datum comes from a
// catalog command through the bridge (ADR-0002); the app only builds inputs and shows outputs.
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { MetamodelGetOutput } from "@reqseq/core";
import type { CommandListing, WorkspaceChangeReason } from "../shared/protocol.js";
import type { ReqSeqBridge } from "../shared/protocol.js";
import type { ActionContext, ElementControls, Prompt } from "./actions.js";
import {
  ACTIONS,
  COMMAND_SHORTCUT,
  actionFor,
  commandPrompt,
  referencePrompt,
  runAction,
} from "./actions.js";
import type { BufferKeep, UndoMemory } from "./buffer-memory.js";
import { forgetClosed, memoryOf, queueSave, savesDone } from "./buffer-memory.js";
import { loadSession, restoreSession, saveSession, sessionKey, sessionText } from "./buffer-session.js";
import { catalogItems } from "./catalog-commands.js";
import type { Draft } from "./drafts.js";
import { useDrafts } from "./drafts.js";
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
import { graphFilterChoices, graphMeanings } from "./graph-choices.js";
import { PREFIX } from "./bindings.js";
import { isMac, matches } from "./keys.js";
import { Minibuffer } from "./Minibuffer.js";
import { ModelineBar } from "./ModelineBar.js";
import { openingOrder, seedOrder } from "./opening-order.js";
import type { PackageModel } from "./package-page.js";
import { packageModel, packageOf } from "./package-page.js";
import type { BufferData, WorkspaceView } from "./modeline.js";
import {
  bufferView,
  readOnlyNow,
  markToken,
  markedElement,
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
import { useCopyNotice } from "./use-copy-notice.js";
import { useFollow } from "./use-follow.js";
import { usePrefix } from "./use-prefix.js";
import { promptUse } from "./usage.js";
import { EMPTY_WINDOW, areas, isSplit, reduceWindow } from "./window-layout.js";
import type { MarkState, PendingMark } from "./follow-mark.js";
import { NO_MARK, bringsNew, markStep } from "./follow-mark.js";

const STOPPED = "The core process keeps stopping. Open the workspace again with File > Open Workspace.";
const MESSAGES: Readonly<Record<string, string>> = {
  restarted: "The core process stopped and was started again.",
  stopped: STOPPED,
};

/** No relation kinds or properties: the metamodel is not read (yet). */
const NO_RELATIONS: Pick<MetamodelGetOutput, "relations" | "properties"> = { relations: [], properties: [] };

/**
 * The app's local storage, where the recent elements (SR-118 AK5) and the open buffers (SR-115 AK4) of a
 * workspace are kept; read when needed, it may throw.
 */
const appStorage = (): RecentStorage => window.localStorage;

/**
 * macOS: the window has no native title bar (ADR-0010, #490), so this strip of the sheet moves the window
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
  const { notice, copy } = useCopyNotice(bridge);
  // The buffers and the areas of the window (SR-115 AK3): one reducer, so they never disagree.
  const [windowState, dispatch] = useReducer(reduceWindow, EMPTY_WINDOW);
  const { buffers, layout } = windowState;
  const split = isSplit(layout);
  const shownAreas = areas(windowState);
  const current = buffers[0];
  // The element that following or "Open to the right/left" put into the inactive area (SR-150 AK4): only it
  // is replaced by the next element marked.
  const followed = useRef<string | undefined>(undefined);
  const { drafts, armed, onDraft, update: updateDraft, reset: resetDrafts } = useDrafts(current?.key);
  // Per element buffer while it is open (SR-105): its undo history, and its saves, in order.
  const memories = useRef(new Map<string, UndoMemory>());
  const saves = useRef(new Map<string, Promise<unknown>>());
  const [prompt, setPrompt] = useState<{ readonly serial: number; readonly prompt: Prompt } | undefined>(
    undefined,
  );
  // The prompt that is open, so a prompt that replaces it can cancel it (#604 review, S2).
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
  const graphChoices = useMemo(() => graphFilterChoices(meanings, relationModel), [meanings, relationModel]);
  const [elementControls, setElementControls] = useState<ElementControls | undefined>(undefined);
  // The elements opened last in this workspace (SR-118): kept in the app's storage under `scope`, not in the workspace.
  const [recent, setRecent] = useState<readonly RecentEntry[]>([]);
  const recentRef = useRef<readonly RecentEntry[]>([]);
  // Their names for "Go to" (SR-115 AK1), by buffer key: as the overview read them, or as they were shown.
  // Go to asks core nothing when it opens, so its search is not queued behind reads of these elements.
  const recentNames = useRef(new Map<string, ElementBuffer>());
  const scope = useRef<string | undefined>(undefined);
  // The order in which the open buffers were opened (SR-115 AK5), kept apart from their order of use.
  const openOrder = useRef<readonly string[]>([]);
  // The workspace whose open buffers are stored (SR-115 AK4): set once the buffers stored for it are
  // restored, unset when another workspace opens. So the reset of a start or a switch never overwrites
  // what is still to be restored.
  const [session, setSession] = useState<string | undefined>(undefined);
  // What was stored last (the key and the text), so that a change of a selected row alone writes nothing.
  const sessionStored = useRef<string | undefined>(undefined);

  // After the core process stopped for good nothing is sent to it: the buffers stay as they are.
  const call = useMemo<Call>(() => {
    const run = callOn(bridge);
    return (name, input) =>
      stoppedRef.current
        ? Promise.resolve({ ok: false, code: "workspace.not-found", message: STOPPED })
        : run(name, input);
  }, [bridge]);
  // The view the window shows (SR-043 AK1, `views.ts`): display state, all elements at the start and
  // after another workspace opens. The views of the buffers read in it; saves and single elements do not.
  const [shownView, setShownView] = useState<ShownView | undefined>(undefined);
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
    // overview shows at once (SR-118 AK1), the restored ones once their elements are named. Their order
    // of opening is the stored one (SR-115 AK5), before what was opened while they were read.
    const restoreBuffers = (key: string | undefined, asked: number): void => {
      if (key === undefined) {
        return;
      }
      void restoreSession(loadSession(appStorage, key), callOn(bridge), () => bridge.commands()).then(
        (restored) => {
          if (!mounted || asked !== opened) {
            return;
          }
          openOrder.current = seedOrder(restored.opened, openOrder.current);
          // A name that could not be read (core restarting) keeps the stored
          // buffers as they are: nothing is stored for this workspace until it opens again.
          if (restored.complete) {
            setSession(currentKey);
          }
          dispatch({ type: "restore", buffers: restored.buffers });
        },
      );
    };
    // The name or the repositories of the open workspace changed (its file was edited, or core
    // restarted): the buffers move to the new key, so the next start finds them (SR-115 AK4). A status
    // without a workspace keeps the key, so a failed read stops nothing.
    const followKey = (moved: string | undefined): void => {
      if (moved !== undefined) {
        currentKey = moved;
        setSession((before) => (before === undefined ? undefined : moved));
      }
    };
    const refresh = async (reason: WorkspaceChangeReason | undefined): Promise<void> => {
      const asked = opened;
      const result = await bridge.invoke("workspace.status", {});
      if (!mounted || asked !== opened) {
        return;
      }
      const next = workspaceView(result);
      setView(next);
      document.title = windowTitle(next);
      if (reason === undefined || reason === "opened") {
        currentKey = sessionKey(result);
        startBuffers(reason, result.ok);
        restoreBuffers(currentKey, asked);
      } else {
        followKey(sessionKey(result));
      }
      // The minibuffer said "Opening another workspace…" until the new one answers.
      if (reason === "opened" || reason === "restarted") {
        setEcho(MESSAGES[reason] ?? "");
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
        setEcho(STOPPED);
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
  const ask = useCallback((next: Prompt): void => {
    // A prompt that replaces an open one (Ctrl/Cmd+Shift+P over "Insert reference") cancels it, as Escape
    // does: an editor that waited for its element waits no longer, so autosave is not held for ever.
    const replaced = openPrompt.current;
    openPrompt.current = next;
    replaced?.cancel?.();
    // Opening a prompt ends the typing in the element: its input is saved now (SR-105, binding review
    // point 6), so a command run from the prompt starts from the saved file.
    controlsNow.current?.prompting();
    serial.current += 1;
    setEcho("");
    setPrompt({ serial: serial.current, prompt: next });
  }, []);

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

  openOrder.current = openingOrder(openOrder.current, buffers);
  // The open buffers are stored on every change, for the next start (SR-115 AK4).
  useEffect(() => {
    if (session === undefined) {
      return;
    }
    const text = sessionText(buffers, openOrder.current);
    if (sessionStored.current !== `${session}\n${text}`) {
      sessionStored.current = `${session}\n${text}`;
      saveSession(appStorage, session, text);
    }
  }, [buffers, session]);
  // The default of an element argument when no element is shown (#85).
  const row = selectedRow(current, loaded);
  const marked = markedElement(current, loaded);
  const context: ActionContext = {
    workspace: view?.name !== undefined,
    readOnly: readOnlyNow(view),
    buffers,
    opened: openOrder.current,
    leaveEditor: () => {
      const focused = document.activeElement;
      if (focused instanceof HTMLElement && focused.closest(".cm-editor") !== null) {
        focused.blur();
      }
    },
    mac: isMac(navigator.platform),
    theme,
    call,
    shownCall: viewCall,
    dispatch,
    ask,
    echo: setEcho,
    recent: () =>
      recentRef.current.flatMap((entry) => {
        const known = recentNames.current.get(elementBuffer(entry.id, entry.repository, "").key);
        return known === undefined ? [] : [known];
      }),
    ...(elementControls === undefined ? {} : { element: elementControls }),
    ...(row === undefined ? {} : { row }),
    ...(marked === undefined ? {} : { marked }),
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
        dispatch({ type: "split" });
      },
      unsplit: () => {
        dispatch({ type: "unsplit" });
      },
      beside: (side, buffer) => {
        // Only an element not open before counts as brought in: one the reader had open is never replaced.
        followed.current = buffers.some((open) => open.key === buffer.key) ? undefined : buffer.key;
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
    // "Open workspace" (SR-131): main lists the workspaces opened last and opens one in this window.
    workspaces: {
      name: view?.name,
      list: () => bridge.recentWorkspaces(),
      open: (...request) => bridge.openWorkspace(...request),
    },
  };

  // The shortcuts are read from the latest context, so one listener serves all renders.
  const latest = useRef(context);
  latest.current = context;
  const propertiesNow = useRef(properties);
  propertiesNow.current = properties;
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
    // the same drafts a second time and report the refused second write as unsaved (#611 review N3).
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
  // What a view that shows several elements reads again on: any change of the workspace, also from outside.
  const seen = revision + outside.seq;
  const revisionNow = useRef(seen);
  revisionNow.current = seen;
  useEffect(() => {
    const load = (): void => {
      bridge.commands().then(
        (commands) => {
          catalog.current = commands;
          setMeanings(graphMeanings(commands));
        },
        (error: unknown) => {
          // Without the catalog the command prompt has the app's actions only; say why.
          setEcho(String(error));
        },
      );
    };
    load();
    // After a start without a workspace there was no core process to ask: ask the one just opened.
    return bridge.on("workspace-changed", (change) => {
      if (change.reason === "opened" && catalog.current.length === 0) {
        load();
      }
    });
  }, [bridge]);
  // The command prompt: the actions that apply now and the catalog's read and write commands (#85);
  // without a workspace, "Initialise workspace" of the folder core opened (`catalogItems`).
  const commands = useCallback((): Prompt => {
    const now = latest.current;
    const items = catalogItems(
      {
        ...now,
        revision: () => revisionNow.current,
        reopen: () => {
          ask(commands());
        },
      },
      catalog.current,
      ACTIONS,
    );
    return commandPrompt(now, promptUse(appStorage), items);
  }, [ask]);
  // The prefix key (SR-109 AK3): Ctrl/Cmd+K, then a letter runs an entry of the command prompt.
  const prefix = usePrefix({
    mac: context.mac,
    items: () => commands().items,
    nameOf: (id) =>
      ACTIONS.find((action) => action.id === id)?.title ??
      catalog.current.find((command) => `command:${command.name}` === id)?.title,
    setEcho,
    buffers,
    switching,
  });
  const startPrefix = prefix.start;
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
      const action = actionFor(now, (shortcut) => matches(event, shortcut, now.mac));
      if (action !== undefined) {
        event.preventDefault();
        runAction(action, now);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [ask, commands, startPrefix]);

  // The shown buffer has the focus, so its keys work; after a prompt the focus comes back to it, unless
  // the action of the prompt put it into the buffer already (the text editor). The matrix replaces the
  // list in place (one key), and the text the graph of the metamodel (SR-130 AK4), so the mode is a reason
  // to look for the focus too (Ctrl+T has no prompt).
  // With two areas it is the active one (SR-115 AK3): a change of the active area moves the focus there,
  // without scrolling it; a press in the area then puts the focus where it pressed.
  useEffect(() => {
    const area = sheet.current?.querySelector<HTMLElement>(`[data-area="${layout.active}"]`);
    if (prompt === undefined && area?.contains(document.activeElement) !== true) {
      area?.querySelector<HTMLElement>("[data-buffer]")?.focus({ preventScroll: true });
    }
  }, [prompt, current?.key, inMatrix(current), metamodelMode(current), layout.active]);

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

  // SR-150 AK4, AK5: in a split window the inactive area follows what the reader newly marks in the active
  // one (`follow-mark.ts`).
  const token = markToken(current);
  const lastMark = useRef<MarkState>(NO_MARK);
  const pendingMark = useRef<PendingMark | undefined>(undefined);
  useEffect(() => {
    const other = layout.other;
    const now: MarkState = { buffer: current?.key, token, marked: marked?.key, other };
    const step = markStep(lastMark.current, now, pendingMark.current);
    lastMark.current = now;
    pendingMark.current = step.pending;
    if (!step.follow || other === undefined || marked === undefined) {
      return;
    }
    const otherData = loadedByKey.get(other);
    // A package page stays, unless following brought it in: then it follows on like any element.
    const page =
      followed.current !== other &&
      otherData?.kind === "element" &&
      packageOf(packages, otherData.element.type) !== undefined;
    const replace = followed.current === other && !drafts.current.has(other);
    if (bringsNew(buffers, other, marked.key, page)) {
      followed.current = marked.key;
    }
    dispatch({ type: "follow", buffer: marked, replace, page });
  }, [current?.key, token, marked?.key, layout.other]);

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
  // A recent element that core no longer knows (deleted outside) is not offered under its old name (#681):
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

  // A relation names the repository of its target (#416): its buffer is opened at once.
  const openRelation = (buffer: ElementBuffer): void => {
    dispatch({ type: "open", buffer });
  };

  // A press or a focus in the inactive area makes it active (SR-115 AK3); a prompt open for the other
  // area is cancelled, as Escape cancels it, so its choice does not act on the area left.
  const activate = (key: string): void => {
    if (openPrompt.current !== undefined) {
      openPrompt.current.cancel?.();
      follow.closed(true);
      openPrompt.current = undefined;
      setPrompt(undefined);
    }
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
    overview,
    element: (buffer) => ({
      onGone: forgetName,
      searchCall: call,
      onCopy: copy,
      onOpenTarget: openTarget,
      onOpenRelation: openRelation,
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
      </main>
      <ModelineBar
        parts={parts}
        view={view}
        stopped={stopped}
        follow={follow.mark}
        shown={viewMark(shownView)}
        element={shownElement(current, loaded)}
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
    </div>
  );
};
