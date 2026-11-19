// The context the actions of the window run in (`App.tsx`), built once per render, and what the views of its
// areas take (`BufferArea.tsx`). Both hold no hooks: they read only what `App` passes in.
import type { Dispatch, RefObject, SetStateAction } from "react";
import type { CommandListing, ReqSeqBridge } from "../shared/protocol.js";
import type { AboutInfo } from "./about.js";
import type { ActionContext, BuiltCommand, ElementControls, Prompt } from "./action-types.js";
import { referencePrompt } from "./actions.js";
import type { ReadGate } from "./area-slot.js";
import type { AreaViews } from "./BufferArea.js";
import type { BufferKeep } from "./buffer-memory.js";
import type { Walk } from "./buffer-cycle.js";
import type { SlideController } from "./buffer-slide.js";
import { directionOf } from "./buffer-slide.js";
import type { Buffer, ElementBuffer } from "./buffers.js";
import { elementBuffer, elementBufferOf } from "./buffers.js";
import type { Call } from "./call.js";
import type { WindowDrafts } from "./draft-store.js";
import type { PropertyModel } from "./element-view.js";
import { promptEntry } from "./entry-menu.js";
import { docsEcho } from "./docs-help.js";
import { saveFoldChoice } from "./fold-statuses.js";
import type { FoldChoice } from "./fold-statuses.js";
import type { GraphFilterChoice } from "./graph-choices.js";
import type { BufferData, WorkspaceView } from "./modeline.js";
import { matrixSpot, readOnlyNow } from "./modeline.js";
import type { OutsideChanges } from "./outside-marks.js";
import type { PackageModel } from "./package-page.js";
import { openPerspective } from "./perspective-actions.js";
import type { RecentEntry } from "./recent.js";
import type { ReferenceTitles } from "./reference-titles.js";
import type { Theme } from "./theme.js";
import type { Follow } from "./use-follow.js";
import type { PerspectiveUseState } from "./use-perspectives.js";
import type { ShownView } from "./views.js";
import type { Layout, WindowAction } from "./window-layout.js";

type Setter<T> = Dispatch<SetStateAction<T>>;

/** What the context takes of the window; `revisionNow`, `leavesClean` and `saveKept` are read when called. */
export interface ContextParts {
  readonly view: WorkspaceView | undefined;
  readonly buffers: readonly Buffer[];
  readonly walk: RefObject<Walk>;
  readonly releasedAt: RefObject<number | undefined>;
  readonly slides: SlideController;
  readonly layout: Layout;
  readonly revisionNow: () => number;
  readonly leavesClean: (key: string) => boolean;
  readonly mac: boolean;
  readonly theme: Theme;
  readonly call: Call;
  readonly viewCall: Call;
  readonly dispatch: (action: WindowAction) => void;
  readonly ask: (next: Prompt) => void;
  readonly setEcho: Setter<string>;
  readonly report: (message: string, open: () => void) => void;
  readonly setAbout: Setter<AboutInfo | undefined>;
  readonly copy: (label: string, text: string) => void;
  readonly bridge: ReqSeqBridge;
  readonly notify: (text: string) => void;
  readonly recentRef: RefObject<readonly RecentEntry[]>;
  readonly recentNames: RefObject<Map<string, ElementBuffer>>;
  readonly elementControls: ElementControls | undefined;
  readonly row: ActionContext["row"];
  readonly marked: ActionContext["marked"];
  readonly current: Buffer | undefined;
  readonly loaded: { readonly key: string; readonly data: BufferData | undefined } | undefined;
  readonly drafts: WindowDrafts["drafts"];
  readonly armed: WindowDrafts["armed"];
  readonly onDraft: WindowDrafts["onDraft"];
  readonly saveKept: (buffer: ElementBuffer) => Promise<boolean>;
  readonly graphChoices: readonly GraphFilterChoice[];
  readonly catalog: RefObject<readonly CommandListing[]>;
  readonly builder: RefObject<(command: BuiltCommand, from: ActionContext) => void>;
  readonly connector: RefObject<(from: ActionContext) => void>;
  readonly follow: Follow;
  readonly shownView: ShownView | undefined;
  readonly setShownView: Setter<ShownView | undefined>;
  readonly setRevision: Setter<number>;
  readonly perspectiveUse: PerspectiveUseState;
  readonly foldChoice: FoldChoice;
  readonly setFoldChoice: Setter<FoldChoice>;
}

export const actionContext = (parts: ContextParts): ActionContext => {
  const { view, buffers, walk, releasedAt, slides, layout, revisionNow, leavesClean, mac, theme } = parts;
  const { call, viewCall, dispatch, ask, setEcho, report, setAbout, copy, bridge, notify, recentRef } = parts;
  const { recentNames, elementControls, row, marked, current, loaded, drafts, armed, onDraft } = parts;
  const {
    saveKept,
    graphChoices,
    catalog,
    builder,
    connector,
    follow,
    shownView,
    setShownView,
    setRevision,
  } = parts;
  const { perspectiveUse, foldChoice, setFoldChoice } = parts;
  return {
    workspace: view?.name !== undefined,
    readOnly: readOnlyNow(view),
    buffers,
    cycleOrder: walk.current.order,
    cycled: (key, step) => {
      walk.current = { order: walk.current.order, cycled: key };
      const from = buffers[0]?.key;
      if (from !== undefined) {
        const progress = releasedAt.current;
        slides.prepare(
          {
            side: layout.active,
            from,
            to: key,
            direction: directionOf(step),
            ...(progress === undefined ? {} : { progress, peeked: true }),
          },
          revisionNow(),
          leavesClean(from),
        );
      }
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
    report,
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
    catalog: () => catalog.current,
    build: (command, from) => {
      builder.current(command, from);
    },
    connectAgent: (from) => {
      connector.current(from);
    },
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
    // The perspectives opened last (SR-214 AK1): the prompt of "Open perspective" lists them first.
    perspectives: perspectiveUse.controls,
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
};

/** What the views of the areas take of the window. */
export interface ViewParts {
  readonly viewCall: Call;
  readonly revision: number;
  readonly seen: number;
  readonly outside: OutsideChanges;
  readonly dispatch: (action: WindowAction) => void;
  readonly onData: (key: string, data: BufferData | undefined) => void;
  readonly setEcho: Setter<string>;
  readonly onDrawn: (key: string) => void;
  readonly gate: ReadGate;
  readonly ready: AreaViews["ready"];
  readonly leavesClean: (key: string) => boolean;
  readonly stopped: boolean;
  readonly drop: (key: string) => void;
  readonly switchSaves: number;
  readonly typeNames: ReadonlyMap<string, string>;
  readonly kindNames: ReadonlyMap<string, string>;
  readonly overview: Omit<AreaViews["overview"], "recent" | "openPerspective">;
  readonly recent: readonly RecentEntry[];
  readonly latest: RefObject<ActionContext>;
  readonly forgetName: (key: string) => void;
  readonly call: Call;
  readonly copy: (label: string, text: string) => void;
  readonly ask: (next: Prompt) => void;
  readonly context: ActionContext;
  readonly titles: ReferenceTitles;
  readonly drafts: WindowDrafts["drafts"];
  readonly onDraft: WindowDrafts["onDraft"];
  readonly keepOf: (buffer: ElementBuffer) => BufferKeep;
  readonly setElementControls: Setter<ElementControls | undefined>;
  readonly packages: PackageModel | undefined;
  readonly variantTypes: ReadonlySet<string>;
  readonly properties: PropertyModel;
}

export const areaViews = (parts: ViewParts): AreaViews => {
  const { viewCall, revision, seen, outside, dispatch, onData, setEcho, onDrawn, gate, ready } = parts;
  const { leavesClean, stopped, drop, switchSaves, typeNames, kindNames, overview, recent, latest } = parts;
  const { forgetName, call, copy, ask, context, titles, drafts, onDraft, keepOf, setElementControls } = parts;
  const { packages, variantTypes, properties } = parts;
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

  // A relation names the repository of its target (ThomasBirkmaier/ReqSeq-archive#416): its buffer is opened at once.
  const openRelation = (buffer: ElementBuffer): void => {
    dispatch({ type: "open", buffer });
  };
  return {
    call: viewCall,
    revision,
    seen,
    outside,
    dispatch,
    onData,
    onEcho: setEcho,
    onCopy: copy,
    onDrawn,
    gate,
    ready,
    clean: leavesClean,
    stopped,
    drop,
    switchSaves,
    typeNames,
    kindNames,
    // A row of a perspective opens it as "Open perspective" does, and counts as its use (SR-118 AK7).
    overview: {
      ...overview,
      recent,
      openPerspective: (name) => {
        void openPerspective(latest.current, name);
      },
    },
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
      // Not held while the view is hidden: whether it is a package page decides whether it is drawn in advance.
      onType: (element) => {
        dispatch({
          type: "typed",
          id: element.id,
          repository: element.repository,
          elementType: element.type,
        });
      },
      packages,
      variantTypes,
      properties,
    }),
  };
};
