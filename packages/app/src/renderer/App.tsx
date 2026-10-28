// The window: a white sheet with one buffer (D-061..D-063), the modeline (a display) and the minibuffer,
// the one control, below it. The sheet shows the most recent buffer: a list, a search result or an
// element. Nothing else is permanently visible (SR-100). Every datum comes from a catalog command through
// the bridge (ADR-0002); the app only builds inputs and shows outputs.
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { MetamodelGetOutput } from "@logreq/core";
import type { CommandListing, WorkspaceChangeReason } from "../shared/protocol.js";
import type { LogReqBridge } from "../shared/protocol.js";
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
import { catalogItems } from "./catalog-commands.js";
import type { Draft } from "./drafts.js";
import { useDrafts } from "./drafts.js";
import type { Buffer, ElementBuffer, GraphBuffer, MetamodelBuffer, OverviewBuffer } from "./buffers.js";
import { elementBufferOf, inMatrix, overviewBuffer, reduceBuffers } from "./buffers.js";
import type { Call } from "./call.js";
import { callOn } from "./call.js";
import type { PropertyModel } from "./element-view.js";
import { propertyModel } from "./element-view.js";
import { ElementView } from "./ElementView.js";
import type { GraphFilterChoice } from "./graph-choices.js";
import { graphFilterChoices, graphMeanings } from "./graph-choices.js";
import { GraphView } from "./GraphView.js";
import { isMac, matches } from "./keys.js";
import { ListView } from "./ListView.js";
import { MetamodelView } from "./MetamodelView.js";
import type { ListViewProps } from "./ListView.js";
import { MatrixView } from "./MatrixView.js";
import { Minibuffer } from "./Minibuffer.js";
import { ModelineBar } from "./ModelineBar.js";
import { NeighbourhoodView } from "./NeighbourhoodView.js";
import { openingOrder } from "./opening-order.js";
import type { PackageModel } from "./package-page.js";
import { packageModel } from "./package-page.js";
import type { BufferData, WorkspaceView } from "./modeline.js";
import { bufferView, selectedRow, shownElement, windowTitle, workspaceView } from "./modeline.js";
import { OverviewView, useOverview } from "./OverviewView.js";
import type { OutsideChanges } from "./outside-marks.js";
import { NO_CHANGES, arrivals, nextChanges } from "./outside-marks.js";
import { ResultView } from "./ResultView.js";
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
import { createTheme } from "./theme.js";
import { useCopyNotice } from "./use-copy-notice.js";
import { useFollow } from "./use-follow.js";
import { promptUse } from "./usage.js";

const STOPPED = "The core process keeps stopping. Open the workspace again with File > Open Workspace.";
const MESSAGES: Readonly<Record<string, string>> = {
  restarted: "The core process stopped and was started again.",
  stopped: STOPPED,
};

/** No relation kinds or properties: the metamodel is not read (yet). */
const NO_RELATIONS: Pick<MetamodelGetOutput, "relations" | "properties"> = { relations: [], properties: [] };

/** The app's local storage, where the recent elements are kept (SR-118 AK5); read when needed, it may throw. */
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

/** The buffers whose view loads its own data from the same props: lists, search results, neighbourhoods and results. */
type LoadingBuffer = Exclude<Buffer, ElementBuffer | OverviewBuffer | GraphBuffer | MetamodelBuffer>;

/**
 * The view of such a buffer: a list or a search result as rows, or (a list in matrix mode, SR-125) as the
 * traceability matrix; a neighbourhood (SR-107); the output of a catalog command (SR-073 AK2).
 */
export const LoadingView = ({
  buffer,
  ...props
}: Omit<ListViewProps, "buffer"> & { readonly buffer: LoadingBuffer }): React.JSX.Element => {
  const shared = {
    call: props.call,
    revision: props.revision,
    dispatch: props.dispatch,
    onData: props.onData,
    onEcho: props.onEcho,
  };
  // The rows that changed outside are highlighted (SR-116).
  const marking = props.outside === undefined ? {} : { outside: props.outside };
  if (buffer.kind === "result") {
    return <ResultView key={buffer.key} buffer={buffer} {...shared} />;
  }
  if (buffer.kind === "neighbourhood") {
    return <NeighbourhoodView key={buffer.key} buffer={buffer} {...shared} {...marking} />;
  }
  return inMatrix(buffer) ? (
    <MatrixView buffer={buffer} {...shared} {...marking} />
  ) : (
    <ListView buffer={buffer} {...props} />
  );
};

export const App = ({ bridge }: { readonly bridge: LogReqBridge }): React.JSX.Element => {
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
  const [buffers, dispatch] = useReducer(reduceBuffers, []);
  const current = buffers[0];
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
  const [loaded, setLoaded] = useState<
    { readonly key: string; readonly data: BufferData | undefined } | undefined
  >(undefined);
  const serial = useRef(0);
  const sheet = useRef<HTMLElement>(null);
  const stoppedRef = useRef(false);
  // The names of the types by their key, from the metamodel, for the modeline of an element (SR-114).
  const [typeNames, setTypeNames] = useState<ReadonlyMap<string, string>>(new Map());
  // The types that are packages: their elements show the elements that name them (SR-112).
  const [packages, setPackages] = useState<PackageModel | undefined>(undefined);
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
  const scope = useRef<string | undefined>(undefined);

  // After the core process stopped for good nothing is sent to it: the buffers stay as they are.
  const call = useMemo<Call>(() => {
    const run = callOn(bridge);
    return (name, input) =>
      stoppedRef.current
        ? Promise.resolve({ ok: false, code: "workspace.not-found", message: STOPPED })
        : run(name, input);
  }, [bridge]);

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
        startBuffers(reason, result.ok);
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
        // Another workspace is open (SR-131 AK3): the buffers and drafts of the old one go at once, before
        // the new one has loaded, so nothing typed then is dropped or saved into the other workspace, and
        // the switch ends at once: a load that hangs never keeps the window locked. The overview of the
        // new workspace comes with its status.
        if (change.reason === "opened") {
          opened += 1;
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

  // The order in which the open buffers were opened (SR-115 AK5), kept apart from their order of use.
  const opened = useRef<readonly string[]>([]);
  opened.current = openingOrder(opened.current, buffers);
  // The default of an element argument when no element is shown (#85).
  const row = selectedRow(current, loaded);
  const context: ActionContext = {
    workspace: view?.name !== undefined,
    buffers,
    opened: opened.current,
    leaveEditor: () => {
      const focused = document.activeElement;
      if (focused instanceof HTMLElement && focused.closest(".cm-editor") !== null) {
        focused.blur();
      }
    },
    mac: isMac(navigator.platform),
    theme,
    call,
    dispatch,
    ask,
    echo: setEcho,
    ...(elementControls === undefined ? {} : { element: elementControls }),
    ...(row === undefined ? {} : { row }),
    modified: current !== undefined && drafts.current.has(current.key),
    closeArmed: (key) => armed.current === key,
    armClose: (key) => {
      armed.current = key;
    },
    discard: (key) => {
      onDraft(key, undefined);
    },
    drafted: (key) => drafts.current.has(key),
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
  // The command prompt: the actions that apply now and the catalog's read commands (#85).
  const commands = useCallback((): Prompt => {
    const now = latest.current;
    // Without a workspace no catalog command can run: the prompt offers the actions that apply then.
    const items = now.workspace
      ? catalogItems(
          {
            ...now,
            revision: () => revisionNow.current,
            reopen: () => {
              ask(commands());
            },
          },
          catalog.current,
          ACTIONS,
        )
      : [];
    return commandPrompt(now, promptUse(appStorage), items);
  }, [ask]);
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
  }, [ask, commands]);

  // The shown buffer has the focus, so its keys work; after a prompt the focus comes back to it, unless
  // the action of the prompt put it into the buffer already (the text editor). The matrix replaces the
  // list in place (one key), so the mode is a reason to look for the focus too (Ctrl+T has no prompt).
  useEffect(() => {
    if (prompt === undefined && sheet.current?.contains(document.activeElement) !== true) {
      sheet.current?.querySelector<HTMLElement>("[data-buffer]")?.focus();
    }
  }, [prompt, current?.key, inMatrix(current)]);

  // An element that is shown (opened or switched to) is the newest of the recent elements; not one that
  // the mode „Agent folgen“ showed (SR-117), so an agent does not replace the user's.
  useEffect(() => {
    const byMode = follow.seen(current?.key);
    if (!byMode && current?.kind === "element" && scope.current !== undefined) {
      recentRef.current = remember(recentRef.current, { id: current.id, repository: current.repository });
      setRecent(recentRef.current);
      saveRecent(appStorage, scope.current, recentRef.current);
    }
  }, [current?.key]);

  const onData = useCallback((key: string, data: BufferData | undefined): void => {
    setLoaded({ key, data });
  }, []);

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

  const overview = useOverview(call, seen, recent, current?.kind === "overview", setEcho);

  // A relation names the repository of its target (#416): its buffer is opened at once.
  const openRelation = (buffer: ElementBuffer): void => {
    dispatch({ type: "open", buffer });
  };

  const parts = modelineParts(current, loaded, drafts.current, typeNames, graphChoices);
  return (
    <div className="shell">
      <TitleBar shown={context.mac} title={windowTitle(view)} />
      <main className="sheet" aria-label="Sheet" ref={sheet} inert={switching}>
        {current === undefined ? null : current.kind === "element" ? (
          <ElementView
            key={current.key}
            call={call}
            buffer={current}
            revision={revision}
            outside={outside}
            onData={onData}
            onEcho={setEcho}
            onCopy={copy}
            onOpenTarget={openTarget}
            onOpenRelation={openRelation}
            onPickElement={(request) => {
              ask(referencePrompt(context, request));
            }}
            onAsk={ask}
            draft={drafts.current.get(current.key)}
            onDraft={onDraft}
            keep={keepOf(current)}
            register={setElementControls}
            packages={packages}
            properties={properties}
            dispatch={dispatch}
          />
        ) : current.kind === "overview" ? (
          <OverviewView
            buffer={current}
            data={overview.data}
            recents={overview.recents}
            outside={outside}
            dispatch={dispatch}
            onData={onData}
          />
        ) : current.kind === "graph" ? (
          <GraphView
            key={current.key}
            call={call}
            buffer={current}
            revision={seen}
            dispatch={dispatch}
            onData={onData}
            onEcho={setEcho}
            typeNames={typeNames}
          />
        ) : current.kind === "metamodel" ? (
          <MetamodelView
            call={call}
            buffer={current}
            revision={revision}
            dispatch={dispatch}
            onData={onData}
            onEcho={setEcho}
          />
        ) : (
          <LoadingView
            call={call}
            buffer={current}
            revision={seen}
            outside={outside}
            dispatch={dispatch}
            onData={onData}
            onEcho={setEcho}
          />
        )}
      </main>
      <ModelineBar
        parts={parts}
        view={view}
        stopped={stopped}
        follow={follow.mark}
        element={shownElement(current, loaded)}
        onCopy={copy}
        notice={notice}
      />
      <Minibuffer
        echo={echoLine(echo, view)}
        prompt={prompt}
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
