// The window: a white sheet with one buffer (D-061..D-063), the modeline (a display) and the minibuffer,
// the one control, below it. The sheet shows the most recent buffer: a list, a search result or an
// element. Nothing else is permanently visible (SR-100). Every datum comes from a catalog command through
// the bridge (ADR-0002); the app only builds inputs and shows outputs.
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { WorkspaceChangeReason } from "../shared/protocol.js";
import type { LogReqBridge } from "../shared/protocol.js";
import type { ActionContext, ElementControls, Prompt } from "./actions.js";
import { COMMAND_SHORTCUT, actionFor, commandPrompt, referencePrompt, runAction } from "./actions.js";
import type { Draft } from "./drafts.js";
import { useDrafts } from "./drafts.js";
import type { Buffer, ElementBuffer } from "./buffers.js";
import { elementBufferOf, overviewBuffer, reduceBuffers } from "./buffers.js";
import type { Call } from "./call.js";
import { callOn } from "./call.js";
import type { MarkdownProperties } from "./element-view.js";
import { markdownProperties } from "./element-view.js";
import { ElementView } from "./ElementView.js";
import { isMac, matches } from "./keys.js";
import { ListView } from "./ListView.js";
import { Minibuffer } from "./Minibuffer.js";
import { ModelineBar } from "./ModelineBar.js";
import { NeighbourhoodView } from "./NeighbourhoodView.js";
import type { PackageModel } from "./package-page.js";
import { packageModel } from "./package-page.js";
import type { BufferData, WorkspaceView } from "./modeline.js";
import { bufferView, shownElement, workspaceView } from "./modeline.js";
import { OverviewView, useOverview } from "./OverviewView.js";
import type { RecentEntry, RecentStorage } from "./recent.js";
import { loadRecent, recentKey, remember, saveRecent } from "./recent.js";
import { createTheme } from "./theme.js";
import { useCopyNotice } from "./use-copy-notice.js";

const STOPPED = "The core process keeps stopping. Open the workspace again with File > Open Workspace.";
const MESSAGES: Readonly<Record<string, string>> = {
  restarted: "The core process stopped and was started again.",
  stopped: STOPPED,
};

/** The app's local storage, where the recent elements are kept (SR-118 AK5); read when needed, it may throw. */
const appStorage = (): RecentStorage => window.localStorage;

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
  // The properties marked `markdown` per type: their boxes show formatted values (SR-127).
  const [markdown, setMarkdown] = useState<MarkdownProperties>(new Map());
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
        setMarkdown(metamodel.ok ? markdownProperties(metamodel.output) : new Map());
      }
    };
    const refresh = async (reason: WorkspaceChangeReason | undefined): Promise<void> => {
      const result = await bridge.invoke("workspace.status", {});
      if (!mounted) {
        return;
      }
      const next = workspaceView(result);
      setView(next);
      document.title = next.name === undefined ? "LogReq" : `${next.name} - LogReq`;
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
        setMarkdown(new Map());
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

  const context: ActionContext = {
    workspace: view?.name !== undefined,
    buffers,
    mac: isMac(navigator.platform),
    theme,
    call,
    dispatch,
    ask,
    echo: setEcho,
    ...(elementControls === undefined ? {} : { element: elementControls }),
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
        ask(commandPrompt(now));
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
  }, [ask]);

  // The shown buffer has the focus, so its keys work; after a prompt the focus comes back to it, unless
  // the action of the prompt put it into the buffer already (the text editor).
  useEffect(() => {
    if (prompt === undefined && sheet.current?.contains(document.activeElement) !== true) {
      sheet.current?.querySelector<HTMLElement>("[data-buffer]")?.focus();
    }
  }, [prompt, current?.key]);

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
            draft={drafts.current.get(current.key)}
            onDraft={onDraft}
            register={setElementControls}
            packages={packages}
            markdown={markdown}
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
        ) : current.kind === "neighbourhood" ? (
          <NeighbourhoodView
            key={current.key}
            call={call}
            buffer={current}
            revision={revision}
            dispatch={dispatch}
            onData={onData}
            onEcho={setEcho}
          />
        ) : (
          <ListView
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
        echo={echo === "" ? (view?.message ?? "") : echo}
        prompt={prompt}
        onCommand={() => {
          if (latest.current.workspace) {
            ask(commandPrompt(latest.current));
          }
        }}
        onClose={() => {
          setPrompt(undefined);
        }}
      />
    </div>
  );
};
