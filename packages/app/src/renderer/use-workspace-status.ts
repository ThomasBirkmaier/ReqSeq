// The status of the open workspace in the window (`App.tsx`): the model the metamodel gives the views, and
// the one effect that reads `workspace.status` at the start and after every change, and starts, restores or
// resets the buffers. `App` calls both where their code stood, so the effect and its listener of
// `workspace-changed` come before the catalog's.
import type { Dispatch, RefObject, SetStateAction } from "react";
import { useEffect, useState } from "react";
import type { InvokeResult, ReqSeqBridge, WorkspaceChangeReason } from "../shared/protocol.js";
import { stoppedMessage } from "../shared/open-hint.js";
import type { AboutInfo } from "./about.js";
import type { Prompt } from "./action-types.js";
import { MESSAGES, NO_RELATIONS, appStorage, draftsBack, startsBuffers, windowStorage } from "./app-parts.js";
import type { WritesInFlight } from "./area-slot.js";
import type { UndoMemory } from "./buffer-memory.js";
import { loadSession, restoreSession, sessionKey } from "./buffer-session.js";
import type { ElementBuffer } from "./buffers.js";
import { overviewBuffer } from "./buffers.js";
import { callOn } from "./call.js";
import type { KeptDrafts, WindowDrafts } from "./draft-store.js";
import { takeDrafts } from "./draft-store.js";
import type { PropertyModel } from "./element-view.js";
import { propertyModel } from "./element-view.js";
import type { FoldStatus } from "./fold-statuses.js";
import type { WorkspaceView } from "./modeline.js";
import { windowTitle, workspaceView } from "./modeline.js";
import type { Arrivals, OutsideChanges } from "./outside-marks.js";
import { nextChanges } from "./outside-marks.js";
import type { PackageModel } from "./package-page.js";
import { packageModel } from "./package-page.js";
import type { RecentEntry } from "./recent.js";
import { loadRecent, recentKey } from "./recent.js";
import type { ReferenceTitles } from "./reference-titles.js";
import type { PerspectiveUseState } from "./use-perspectives.js";
import type { ShownView } from "./views.js";
import { variantTypesOf } from "./views.js";
import type { WindowAction } from "./window-layout.js";

type Setter<T> = Dispatch<SetStateAction<T>>;

/** The model the metamodel of the open workspace gives the views, with its setters. */
export interface MetamodelModel {
  readonly typeNames: ReadonlyMap<string, string>;
  readonly setTypeNames: Setter<ReadonlyMap<string, string>>;
  readonly packages: PackageModel | undefined;
  readonly setPackages: Setter<PackageModel | undefined>;
  readonly variantTypes: ReadonlySet<string>;
  readonly setVariantTypes: Setter<ReadonlySet<string>>;
  readonly properties: PropertyModel;
  readonly setProperties: Setter<PropertyModel>;
  readonly relationModel: typeof NO_RELATIONS;
  readonly setRelationModel: Setter<typeof NO_RELATIONS>;
}

export const useMetamodelModel = (): MetamodelModel => {
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
  return {
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
  };
};

/** What the status effect takes of the window: read at the start, and when the bridge changes. */
export interface StatusParts extends Pick<
  MetamodelModel,
  "setTypeNames" | "setPackages" | "setVariantTypes" | "setProperties" | "setRelationModel"
> {
  readonly bridge: ReqSeqBridge;
  readonly tracked: ReqSeqBridge;
  readonly resetDrafts: WindowDrafts["reset"];
  readonly seedDrafts: WindowDrafts["seed"];
  readonly rescopeDrafts: WindowDrafts["rescope"];
  readonly memories: RefObject<Map<string, UndoMemory>>;
  readonly openPrompt: RefObject<Prompt | undefined>;
  readonly setPrompt: Setter<{ readonly serial: number; readonly prompt: Prompt } | undefined>;
  readonly dispatch: (action: WindowAction) => void;
  readonly setSession: Setter<string | undefined>;
  readonly setEcho: Setter<string>;
  readonly leavingWrites: RefObject<number>;
  readonly setSwitchSaves: Setter<number>;
  readonly macRef: RefObject<boolean>;
  readonly setView: Setter<WorkspaceView | undefined>;
  readonly leaveSwitching: () => void;
  readonly perspectiveUse: PerspectiveUseState;
  readonly scope: RefObject<string | undefined>;
  readonly recentNames: RefObject<Map<string, ElementBuffer>>;
  readonly recentRef: RefObject<readonly RecentEntry[]>;
  readonly setRecent: Setter<readonly RecentEntry[]>;
  readonly setRevision: Setter<number>;
  readonly writes: WritesInFlight;
  readonly setStatuses: Setter<readonly FoldStatus[]>;
  readonly fresh: Arrivals;
  readonly setOutside: Setter<OutsideChanges>;
  readonly stoppedRef: RefObject<boolean>;
  readonly setStopped: Setter<boolean>;
  readonly titlesRef: RefObject<ReferenceTitles>;
  readonly setShownView: Setter<ShownView | undefined>;
  readonly setAbout: Setter<AboutInfo | undefined>;
}

export const useWorkspaceStatus = (parts: StatusParts): void => {
  const { bridge, tracked, resetDrafts, seedDrafts, rescopeDrafts, memories, openPrompt, setPrompt } = parts;
  const { dispatch, setSession, setEcho, leavingWrites, setSwitchSaves, macRef, setView } = parts;
  const { leaveSwitching, perspectiveUse, scope, recentNames, recentRef, setRecent, setRevision } = parts;
  const { writes, setTypeNames, setPackages, setVariantTypes, setProperties, setRelationModel } = parts;
  const { setStatuses, fresh, setOutside, stoppedRef, setStopped, titlesRef, setShownView, setAbout } = parts;
  useEffect(() => {
    let mounted = true;
    // If the metamodel cannot be read, the modeline shows the keys of the types.
    const loadTypeNames = async (): Promise<void> => {
      const metamodel = await callOn(tracked)("metamodel.get", {});
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
      void restoreSession(loadSession(appStorage, key), callOn(tracked), () => bridge.commands()).then(
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
    // A write of the save of leaving, answered just before its change on the same channel: the change counts
    // to the switch (SR-212 AK5). Taken when the change comes, so a refresh that ends early loses no count;
    // another workspace starts with none.
    const takeSwitchSave = (reason: WorkspaceChangeReason | undefined): (() => void) => {
      if (reason === "opened") {
        leavingWrites.current = 0;
      }
      if (reason !== "written" || leavingWrites.current === 0) {
        return () => undefined;
      }
      leavingWrites.current -= 1;
      return () => {
        setSwitchSaves((count) => count + 1);
      };
    };
    const refresh = async (reason: WorkspaceChangeReason | undefined): Promise<void> => {
      const asked = opened;
      const countSwitchSave = takeSwitchSave(reason);
      const result = await tracked.invoke("workspace.status", {});
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
      perspectiveUse.follow(result);
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
        countSwitchSave();
        writes.changed(reason);
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
};
