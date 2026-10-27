// The window: a white sheet with one buffer (D-061..D-063), the modeline (a display) and the minibuffer,
// the one control, below it. The sheet shows the most recent buffer: a list, a search result or an
// element. Nothing else is permanently visible (SR-100). Every datum comes from a catalog command through
// the bridge (ADR-0002); the app only builds inputs and shows outputs.
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
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
import { catalogItems } from "./catalog-commands.js";
import type { Draft } from "./drafts.js";
import { useDrafts } from "./drafts.js";
import type { Buffer, ElementBuffer, GraphBuffer, OverviewBuffer } from "./buffers.js";
import { elementBufferOf, inMatrix, overviewBuffer, reduceBuffers } from "./buffers.js";
import type { Call } from "./call.js";
import { callOn } from "./call.js";
import type { PropertyModel } from "./element-view.js";
import { propertyModel } from "./element-view.js";
import { ElementView } from "./ElementView.js";
import { GraphView } from "./GraphView.js";
import { isMac, matches } from "./keys.js";
import { ListView } from "./ListView.js";
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
import { ResultView } from "./ResultView.js";
import type { RecentEntry, RecentStorage } from "./recent.js";
import { loadRecent, recentKey, remember, saveRecent } from "./recent.js";
import { createTheme } from "./theme.js";
import { useCopyNotice } from "./use-copy-notice.js";
import { promptUse } from "./usage.js";

const STOPPED = "The core process keeps stopping. Open the workspace again with File > Open Workspace.";
const MESSAGES: Readonly<Record<string, string>> = {
  restarted: "The core process stopped and was started again.",
  stopped: STOPPED,
};

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
): string[] => {
  if (current === undefined) {
    return [];
  }
  const data = loaded?.key === current.key ? loaded.data : undefined;
  return bufferView(
    current,
    data?.kind === "element" && drafts.has(current.key) ? { ...data, modified: true } : data,
    typeNames,
  );
};

/** The minibuffer's line: the last message, else why no workspace is open. */
const echoLine = (echo: string, view: WorkspaceView | undefined): string =>
  echo === "" ? (view?.message ?? "") : echo;

/** The buffers whose view loads its own data from the same props: lists, search results, neighbourhoods and results. */
type LoadingBuffer = Exclude<Buffer, ElementBuffer | OverviewBuffer | GraphBuffer>;

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
  if (buffer.kind === "result") {
    return <ResultView key={buffer.key} buffer={buffer} {...shared} />;
  }
  if (buffer.kind === "neighbourhood") {
    return <NeighbourhoodView key={buffer.key} buffer={buffer} {...shared} />;
  }
  return inMatrix(buffer) ? (
    <MatrixView buffer={buffer} {...shared} />
  ) : (
    <ListView buffer={buffer} {...props} />
  );
};

export const App = ({ bridge }: { readonly bridge: LogReqBridge }): React.JSX.Element => {
  const [view, setView] = useState<WorkspaceView | undefined>(undefined);
  const [echo, setEcho] = useState("");
  const [stopped, setStopped] = useState(false);
  // A field is copied: the main process writes the clipboard, the modeline says so (SR-128).
  const { notice, copy } = useCopyNotice(bridge);
  const [buffers, dispatch] = useReducer(reduceBuffers, []);
  const current = buffers[0];
  const { drafts, armed, onDraft, reset: resetDrafts } = useDrafts(current?.key);
  const [prompt, setPrompt] = useState<{ readonly serial: number; readonly prompt: Prompt } | undefined>(
    undefined,
  );
  // Counts up when the workspace changed: the shown buffer asks for its data again.
  const [revision, setRevision] = useState(0);
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
      }
    };
    const refresh = async (reason: WorkspaceChangeReason | undefined): Promise<void> => {
      const result = await bridge.invoke("workspace.status", {});
      if (!mounted) {
        return;
      }
      const next = workspaceView(result);
      setView(next);
      document.title = windowTitle(next);
      if (reason === undefined || reason === "opened") {
        resetDrafts();
        setPrompt(undefined);
        // The first buffer is the calm overview, not the list of all elements (SR-118).
        dispatch({ type: "reset", ...(result.ok ? { buffer: overviewBuffer() } : {}) });
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
      // The type names come with the workspace; the modeline shows keys until they are there.
      if (result.ok) {
        void loadTypeNames();
      } else {
        setTypeNames(new Map());
        setPackages(undefined);
        setProperties(new Map());
      }
    };
    void refresh(undefined);
    const unsubscribe = bridge.on("workspace-changed", (change) => {
      // A save of this window reports `written`; its message ("Saved ...") stays.
      if (change.reason !== "written") {
        setEcho(MESSAGES[change.reason] ?? "");
      }
      if (change.reason === "stopped") {
        stoppedRef.current = true;
        setStopped(true);
      } else {
        stoppedRef.current = false;
        setStopped(false);
        void refresh(change.reason);
      }
    });
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, [bridge]);

  const ask = useCallback((next: Prompt): void => {
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
  };

  // The shortcuts are read from the latest context, so one listener serves all renders.
  const latest = useRef(context);
  latest.current = context;
  // The catalog, read once (it is the same for every workspace), and the revision now, read when a command runs.
  const catalog = useRef<readonly CommandListing[]>([]);
  const revisionNow = useRef(revision);
  revisionNow.current = revision;
  useEffect(() => {
    bridge.commands().then(
      (commands) => {
        catalog.current = commands;
      },
      (error: unknown) => {
        // Without the catalog the command prompt has the app's actions only; say why.
        setEcho(String(error));
      },
    );
  }, [bridge]);
  // The command prompt: the actions that apply now and the catalog's read commands (#85).
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
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      // A key that a control already handled (the minibuffer, the editor, a list) is no shortcut.
      if (event.defaultPrevented) {
        return;
      }
      const now = latest.current;
      if (!now.workspace) {
        return;
      }
      if (matches(event, COMMAND_SHORTCUT)) {
        event.preventDefault();
        ask(commands());
        return;
      }
      const action = actionFor(now, (shortcut) => matches(event, shortcut));
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

  // An element that is shown (opened or switched to) is the newest of the recent elements.
  useEffect(() => {
    if (current?.kind === "element" && scope.current !== undefined) {
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

  const overview = useOverview(call, revision, recent, current?.kind === "overview", setEcho);

  // A relation names the repository of its target (#416): its buffer is opened at once.
  const openRelation = (buffer: ElementBuffer): void => {
    dispatch({ type: "open", buffer });
  };

  const parts = modelineParts(current, loaded, drafts.current, typeNames);
  return (
    <div className="shell">
      <TitleBar shown={context.mac} title={windowTitle(view)} />
      <main className="sheet" aria-label="Sheet" ref={sheet}>
        {current === undefined ? null : current.kind === "element" ? (
          <ElementView
            key={current.key}
            call={call}
            buffer={current}
            revision={revision}
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
            dispatch={dispatch}
            onData={onData}
          />
        ) : current.kind === "graph" ? (
          <GraphView
            key={current.key}
            call={call}
            buffer={current}
            revision={revision}
            dispatch={dispatch}
            onData={onData}
            onEcho={setEcho}
            typeNames={typeNames}
          />
        ) : (
          <LoadingView
            call={call}
            buffer={current}
            revision={revision}
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
        element={shownElement(current, loaded)}
        onCopy={copy}
        notice={notice}
      />
      <Minibuffer
        echo={echoLine(echo, view)}
        prompt={prompt}
        onCommand={() => {
          if (latest.current.workspace) {
            ask(commands());
          }
        }}
        onClose={() => {
          setPrompt(undefined);
        }}
      />
    </div>
  );
};
