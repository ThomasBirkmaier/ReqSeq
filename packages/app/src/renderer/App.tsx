// The window: a white sheet with one buffer (D-061..D-063), or two side by side after "Split window"
// (SR-115 AK3, `window-layout.ts`), the modeline (a display) and the minibuffer, the one control, below it.
// The sheet shows the most recent buffer: a list, a search result or an element; the modeline names the
// buffer of the active area. Nothing else is permanently visible (SR-100). Every datum comes from a
// catalog command through the bridge (ADR-0002); the app only builds inputs and shows outputs.
import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from "react";
import type { CommandListing } from "../shared/protocol.js";
import type { ReqSeqBridge } from "../shared/protocol.js";
import type { ActionContext, BuiltCommand, ElementControls, Prompt } from "./action-types.js";
import {
  ACTIONS,
  actionFor,
  historyKeyAction,
  isBufferMouseButton,
  mouseButtonAction,
  runAction,
} from "./actions.js";
import type { UndoMemory } from "./buffer-memory.js";
import { forgetClosed } from "./buffer-memory.js";
import { saveSession, sessionText } from "./buffer-session.js";
import { useWindowDrafts } from "./draft-store.js";
import type { ElementBuffer } from "./buffers.js";
import { OVERVIEW_KEY, inMatrix } from "./buffers.js";
import { ReadGate, WritesInFlight, drawnBy } from "./area-slot.js";
import { BufferArea } from "./BufferArea.js";
import type { Call } from "./call.js";
import { callOn } from "./call.js";
import { trackCalls } from "./call-turn.js";
import type { ShownView } from "./views.js";
import { inView, viewMark } from "./views.js";
import { graphFilterChoices, relationNames } from "./graph-choices.js";
import { PREFIX } from "./bindings.js";
import { COMMAND_SHORTCUT, isMac, matches } from "./keys.js";
import { Minibuffer } from "./Minibuffer.js";
import { ModelineBar } from "./ModelineBar.js";
import type { Walk } from "./buffer-cycle.js";
import { NO_WALK, cycleOrder } from "./buffer-cycle.js";
import { shownLayer } from "./buffer-slide.js";
import { heldIn, releaseHold } from "./swipe-hold.js";
import type { SwipeHold } from "./swipe-hold.js";
import { neighbourBuffers, withSwipe } from "./neighbours.js";
import type { BufferData, WorkspaceView } from "./modeline.js";
import { markToken, markedElement, selectedRow, shownElement, windowTitle } from "./modeline.js";
import { useOverview } from "./OverviewView.js";
import type { OutsideChanges } from "./outside-marks.js";
import { NO_CHANGES, arrivals } from "./outside-marks.js";
import type { RecentEntry } from "./recent.js";
import { remember, saveRecent } from "./recent.js";
import { usePerspectiveUse, useRestoredWarning } from "./use-perspectives.js";
import { referenceTitles } from "./reference-titles.js";
import { createTheme } from "./theme.js";
import { FoldStatuses, foldCondition, loadFoldChoice } from "./fold-statuses.js";
import type { FoldChoice, FoldStatus } from "./fold-statuses.js";
import type { MetamodelChange } from "./metamodel-changes.js";
import { NO_CHANGE } from "./metamodel-changes.js";
import { commandPromptKey } from "./command-entry.js";
import { ContextMenuLayer } from "./ContextMenu.js";
import type { OpenedMenu } from "./context-menu.js";
import { openEntries } from "./context-menu.js";
import { menuContext } from "./entry-menu.js";
import { useContextMenu } from "./use-context-menu.js";
import { useConnectAgent } from "./use-connect-agent.js";
import { useCopyNotice } from "./use-copy-notice.js";
import type { AboutInfo } from "./about.js";
import { AboutLayer } from "./AboutWindow.js";
import { useFollow } from "./use-follow.js";
import { usePrefix } from "./use-prefix.js";
import { EMPTY_WINDOW, areas, isSplit, reduceWindow } from "./window-layout.js";
import type { MarkState, PendingMark } from "./follow-mark.js";
import { NO_MARK, markStep } from "./follow-mark.js";
import { stoppedMessage } from "../shared/open-hint.js";
import type { Loaded } from "./app-parts.js";
import {
  TitleBar,
  appStorage,
  echoLine,
  headOf,
  metamodelMode,
  modelineParts,
  shownOnly,
  windowStorage,
} from "./app-parts.js";
import { actionContext, areaViews } from "./app-context.js";
import { bufferKeeps, useSaveOnLeave } from "./app-saves.js";
import { useCommandPrompt } from "./use-command-prompt.js";
import { useDropped, useSlides } from "./use-slides.js";
import { useSwipeObjects, useSwipeSwitch } from "./use-swipe-switch.js";
import { useMetamodelModel, useWorkspaceStatus } from "./use-workspace-status.js";
import { useAgentStatus } from "./use-agent-status.js";
import { CONNECT_AGENT_ACTION } from "./connect-agent.js";
import { useEchoLink } from "./use-echo-link.js";
export const App = ({ bridge }: { readonly bridge: ReqSeqBridge }): React.JSX.Element => {
  const [view, setView] = useState<WorkspaceView | undefined>(undefined);
  const [echo, setEchoLine] = useState("");
  // The answer of a write command opens its output on a click (SR-223 AK8); every other message ends that.
  const echoLink = useEchoLink(setEchoLine);
  const setEcho = echoLink.echo;
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
  // The key of the buffer the active area shows.
  const shownKey = current?.key;
  const {
    drafts,
    armed,
    onDraft,
    update: updateDraft,
    reset: resetDrafts,
    seed: seedDrafts,
    rescope: rescopeDrafts,
  } = useWindowDrafts(shownKey, windowStorage);
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
  // The writes of the save of leaving an element (SR-105 AK1) not yet answered by their change, and the changes
  // that were such a write: they count to the switch, so the buffers drawn in advance read once more after them
  // (SR-212 AK5).
  const leavingWrites = useRef(0);
  const [switchSaves, setSwitchSaves] = useState(0);
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
  const {
    typeNames,
    setTypeNames,
    packages,
    setPackages,
    variantTypes,
    setVariantTypes,
    properties,
    setProperties,
    relationModel,
    setRelationModel,
  } = useMetamodelModel();
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
  // The perspectives opened last in this workspace (SR-214 AK1).
  const perspectiveUse = usePerspectiveUse(appStorage);
  // The order Next and Previous buffer walk (SR-115 AK5), and the buffer they switched to last.
  const walk = useRef<Walk>(NO_WALK);
  // The workspace whose open buffers are stored (SR-115 AK4): set once the buffers stored for it are
  // restored, unset when another workspace opens. So the reset of a start or a switch never overwrites
  // what is still to be restored.
  // The last change of the metamodel made in the app, marked until the next one (SR-130 AK7); another
  // workspace starts without one.
  const [metamodelChange, setMetamodelChange] = useState<MetamodelChange>(NO_CHANGE);
  const [session, setSession] = useState<string | undefined>(undefined);
  // A change of the metamodel marks only in the workspace it was made in (SR-130 AK7).
  useEffect(() => {
    setMetamodelChange(NO_CHANGE);
  }, [session]);
  // What was stored last (the key and the text), so that a change of a selected row alone writes nothing.
  const sessionStored = useRef<string | undefined>(undefined);

  // Whether the keys are macOS's, read as the app renders; also in the messages that name a key (the menu bar
  // may be hidden, #1189).
  const mac = isMac(navigator.platform);
  // The same for the calls and the start, which read it when they answer (no new subscription per render).
  const macRef = useRef(mac);
  macRef.current = mac;
  // After the core process stopped for good nothing is sent to it: the buffers stay as they are.
  // The calls to the core, counted, so that the overview's counts give way to them (`call-turn.ts`).
  const [calls] = useState(() => trackCalls());
  const tracked = useMemo<ReqSeqBridge>(
    () => ({ ...bridge, invoke: calls.wrap((name, input) => bridge.invoke(name, input)) }),
    [bridge, calls],
  );
  // The saves of the window in flight: a buffer drawn from its record is not shown as drawn in advance meanwhile
  // (SR-212 AK5).
  const [writes] = useState(() => new WritesInFlight());
  const call = useMemo<Call>(() => {
    const run = writes.counting(callOn(tracked));
    return (name, input) =>
      stoppedRef.current
        ? Promise.resolve({ ok: false, code: "workspace.not-found", message: stoppedMessage(macRef.current) })
        : run(name, input);
  }, [tracked, writes]);
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

  // The status of the workspace, read at the start and after every change (`use-workspace-status.ts`).
  useWorkspaceStatus({
    bridge,
    tracked,
    resetDrafts,
    seedDrafts,
    rescopeDrafts,
    memories,
    openPrompt,
    setPrompt,
    dispatch,
    setSession,
    setEcho,
    leavingWrites,
    setSwitchSaves,
    macRef,
    setView,
    leaveSwitching,
    perspectiveUse,
    scope,
    recentNames,
    recentRef,
    setRecent,
    setRevision,
    writes,
    setTypeNames,
    setPackages,
    setVariantTypes,
    setProperties,
    setRelationModel,
    setStatuses,
    fresh,
    setOutside,
    stoppedRef,
    setStopped,
    titlesRef,
    setShownView,
    setAbout,
    endEchoLink: echoLink.end,
  });

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

  // The undo history of a buffer goes with the buffer (closed, or pushed out by the buffers kept).
  useEffect(() => {
    forgetClosed(
      memories.current,
      buffers.map((buffer) => buffer.key),
    );
  }, [buffers]);

  walk.current = cycleOrder(walk.current, buffers);
  // When the reads of the buffers drawn in advance may go (SR-212 AK5): after the shown one is drawn.
  const gate = useMemo(() => new ReadGate(), []);
  // The target a swipe shows, held as drawn while a change comes until the swipe or its slide ended (SR-212
  // AK5, `swipe-hold.ts`).
  const [hold, setHold] = useState<SwipeHold | undefined>(undefined);
  const release = (key: string | undefined): void => {
    setHold((now) => releaseHold(now, key));
  };
  const slides = useSlides(sheet, layout.active, current, gate, release);
  // While a prompt is open the reader may be choosing the next buffer: no read drawn in advance starts then.
  const prompting = prompt !== undefined;
  useLayoutEffect(() => {
    gate.prompt(prompting);
  }, [gate, prompting]);
  // The previous and the next buffer of the active area, drawn hidden beside the shown one (SR-212 AK5),
  // without those dropped after a change since the last switch: they are not read again in the background.
  const { dropped, drop, undrop } = useDropped(current);
  // The buffer a swipe draws and its drag (SR-211 AK3, AK4, `use-swipe-switch.ts`).
  const { swipe, swiped, endSwipe, drag, releasedAt } = useSwipeObjects(sheet, gate, release);
  const neighbours = withSwipe(
    neighbourBuffers(buffers, walk.current.order, layout.other, {
      known: typeNames.size > 0,
      model: packages,
    }),
    buffers,
    dropped,
    swiped,
    layout.other,
  );
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
  // The catalog, read once (it is the same for every workspace).
  const catalog = useRef<readonly CommandListing[]>([]);
  // "New perspective" and "New saved filter" (SR-219): set below, where the command prompt it goes back to is.
  const builder = useRef<(command: BuiltCommand, from: ActionContext) => void>(() => undefined);
  // "Connect AI agent" (SR-227, SR-225 AK7): set below, where the command prompt it goes back to is.
  const connector = useRef<(from: ActionContext) => void>(() => undefined);
  // The context of the actions (`app-context.ts`); what is declared further down is read when called.
  const context = actionContext({
    view,
    buffers,
    walk,
    releasedAt,
    slides,
    layout,
    revisionNow: () => revisionNow.current,
    leavesClean: (key) => leavesClean(key),
    mac,
    theme,
    call,
    viewCall,
    dispatch,
    ask,
    setEcho,
    report: echoLink.report,
    setAbout,
    copy,
    bridge,
    notify,
    recentRef,
    recentNames,
    elementControls,
    row,
    marked,
    current,
    loaded,
    drafts,
    armed,
    onDraft,
    saveKept: (buffer) => saveKept(buffer),
    graphChoices,
    catalog,
    builder,
    connector,
    follow,
    shownView,
    setShownView,
    setRevision,
    perspectiveUse,
    foldChoice,
    setFoldChoice,
    setMetamodelChange,
  });

  // The shortcuts are read from the latest context, so one listener serves all renders.
  const latest = useRef(context);
  latest.current = context;
  const propertiesNow = useRef(properties);
  propertiesNow.current = properties;
  // What the window keeps and saves of its element buffers (SR-105, `app-saves.ts`).
  const { saveKept, keepOf } = bufferKeeps({
    saves,
    drafts,
    call,
    leavingWrites,
    propertiesNow,
    onDraft,
    setEcho,
    memories,
    updateDraft,
  });
  // Help > ReqSeq Documentation (SR-141 AK2): as the action "Open documentation".
  useEffect(() => bridge.onHelp(() => latest.current.docs?.()), [bridge]);
  // The saves before another workspace opens or the window closes (SR-131 AK3, `app-saves.ts`).
  useSaveOnLeave({
    bridge,
    call,
    armed,
    controlsNow,
    saves,
    latest,
    drafts,
    propertiesNow,
    onDraft,
    setEcho,
    switchRun,
    switchingNow,
    setSwitching,
    openPrompt,
    setPrompt,
    leaveSwitching,
  });
  // The read of the catalog while it runs: a command prompt opened meanwhile, just after a folder was
  // opened, gets the catalog's commands ("Create workspace", the minibuffer's hint) when they are there (#1413).
  const catalogRead = useRef<Promise<void> | undefined>(undefined);
  // What a view that shows several elements reads again on: any change of the workspace, also from outside.
  const seen = revision + outside.seq;
  const revisionNow = useRef(seen);
  revisionNow.current = seen;
  // The catalog and the command prompt (`use-command-prompt.ts`).
  const commands = useCommandPrompt({
    bridge,
    catalog,
    setMeanings,
    setEvidence,
    setEcho,
    catalogRead,
    ask,
    latest,
    revisionNow,
    builder,
  });
  connector.current = useConnectAgent(
    {
      catalog: () => catalog.current,
      catalogRead: () => catalogRead.current,
      catalogContext: (from) => ({
        ...from,
        revision: () => revisionNow.current,
        reopen: () => {
          ask(commands(true));
        },
      }),
      latest: () => latest.current,
    },
    context.workspace,
  );
  // The connected agent at the right of the modeline, while a workspace is open (SR-228, `use-agent-status.ts`).
  const agent = useAgentStatus(bridge, view?.name !== undefined && !stopped);
  // A click on "No agent connected" or "Connect AI agent" (SR-228 AK3) runs the entry of the command prompt, as a
  // choice in the context menu does; not while another workspace opens.
  const connectFromModeline = (): void => {
    if (switchingNow.current) {
      return;
    }
    beforeCommand();
    commands(false)
      .items.find((item) => item.id === CONNECT_AGENT_ACTION)
      ?.run();
  };
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
      // "All commands…" (AK3): every command of the command prompt alphabetically, as its row "All commands…"
      // gives it on this buffer (SR-133 AK3): from the context without the menu's entry (SR-197).
      ask(commands(true, true, context));
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
      // In an open prompt only a shortcut that opens a prompt of its own: any other would act on the buffer and
      // take the focus from the input while the prompt stays open (#1577). Cmd+[ and Cmd+] as the mouse buttons
      // Back and Forward (SR-163 AK3), like them not in an open prompt.
      const prompting = openPrompt.current !== undefined;
      const action =
        actionFor(now, (shortcut) => matches(event, shortcut, now.mac), prompting) ??
        (prompting ? undefined : historyKeyAction(now, event));
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
  // The swipes (SR-163 AK4, SR-211, `use-swipe-switch.ts`).
  useSwipeSwitch({
    swipe,
    swiped,
    endSwipe,
    drag,
    releasedAt,
    bridge,
    slides,
    latest,
    switchingNow,
    openPrompt,
    contextMenu,
    aboutOpen,
    prefix,
    sheet,
    layout,
    release,
    revisionNow,
    hold,
    setHold,
    shownKey,
  });

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
      shownLayer(area)?.querySelector<HTMLElement>("[data-buffer]")?.focus({ preventScroll: true });
    }
  }, [prompt, about, current?.key, inMatrix(current), metamodelMode(current), layout.active]);

  // A perspective buffer that came back at a restart without its grouping says why when first shown (SR-213 AK7).
  useRestoredWarning(current, setEcho, dispatch);

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

  const onData = useCallback(
    (key: string, data: BufferData | undefined): void => {
      setLoaded((before) => new Map(before).set(key, data));
      // What a view loaded is drawn in the same commit: a switch in motion to it starts (SR-212).
      if (drawnBy(data)) {
        slides.drawn(key);
      }
    },
    [slides],
  );
  const onDrawn = useCallback(
    (key: string): void => {
      slides.drawn(key);
    },
    [slides],
  );
  // A hidden view says when it is drawn with no read pending: a switch to it slides at once (SR-212 AK5).
  const ready = useCallback(
    (key: string, mount: number, generation: number | undefined, recorded: boolean): void => {
      if (generation === undefined) {
        slides.unready(key, mount);
      } else {
        slides.ready(key, mount, generation, recorded);
        swipe.ready(key);
      }
    },
    [slides, swipe],
  );
  // Leaving `key` changes nothing: no input of it to save, no save of the window in flight (SR-212 AK5).
  const leavesClean = useCallback(
    (key: string): boolean => !drafts.current.has(key) && writes.none,
    [drafts, writes],
  );
  useEffect(() => {
    swipe.attach({ ready: (key) => slides.drawnAt(key, revisionNow.current), undrop });
  }, [swipe, slides, undrop]);
  useEffect(() => {
    swipe.open(buffers.map((buffer) => buffer.key));
  }, [swipe, buffers]);
  // A draw for a swipe whose buffer is no longer beside the shown one ends, so it settles (SR-211 AK3).
  const besideKeys = neighbours.map(({ buffer }) => buffer.key).join("\n");
  useEffect(() => {
    swipe.beside(besideKeys.split("\n"));
  }, [swipe, besideKeys]);
  // What a buffer that no area shows any more loaded goes: shown again, it loads again. A buffer drawn in
  // advance keeps it, so the modeline has it when the buffer is shown.
  const shownKeys = [
    ...shownAreas.map((area) => area.buffer.key),
    ...neighbours.map(({ buffer }) => buffer.key),
  ];
  useEffect(() => {
    setLoaded((before) => shownOnly(before, shownKeys));
  }, [shownKeys.join("\n")]);

  // A failed read of the counts says why and counts as drawn, so a switch to the overview does not wait for
  // the guard of the slide (SR-212).
  const overviewFailed = useCallback(
    (message: string): void => {
      setEcho(message);
      slides.drawn(OVERVIEW_KEY);
    },
    [slides],
  );
  const overview = useOverview(
    viewCall,
    seen,
    recent,
    shownAreas.some((area) => area.buffer.kind === "overview"),
    overviewFailed,
    calls.turn,
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

  // A press or a focus in the inactive area makes it active (SR-115 AK3); a prompt open for the other
  // area is cancelled, as Escape cancels it, so its choice does not act on the area left.
  const activate = (key: string): void => {
    cancelPrompt();
    dispatch({ type: "switch", key });
  };
  const views = areaViews({
    viewCall,
    revision,
    seen,
    outside,
    dispatch,
    onData,
    setEcho,
    onDrawn,
    gate,
    ready,
    leavesClean,
    stopped,
    drop,
    switchSaves,
    typeNames,
    kindNames,
    metamodelChange,
    overview,
    recent,
    latest,
    forgetName,
    call,
    copy,
    ask,
    context,
    titles,
    drafts,
    onDraft,
    keepOf,
    setElementControls,
    packages,
    variantTypes,
    properties,
    catalog,
  });
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
              {...(area.active ? { hidden: neighbours } : {})}
              held={heldIn(hold, area.side)}
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
        agent={agent}
        onConnectAgent={connectFromModeline}
      />
      <Minibuffer
        echo={echoLine(echo, view)}
        onEcho={echoLink.openOf(echoLine(echo, view))}
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
