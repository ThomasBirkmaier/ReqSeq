// What the window keeps and saves of its element buffers (`App.tsx`, SR-105): the save of a buffer that was
// left, what an open element buffer keeps, and the saves before another workspace opens or the window closes
// (SR-131 AK3). `bufferKeeps` holds no hooks; `useSaveOnLeave` is one effect, which `App` calls where its
// code stood.
import type { Dispatch, RefObject, SetStateAction } from "react";
import { useEffect } from "react";
import type { ReqSeqBridge } from "../shared/protocol.js";
import type { ActionContext, ElementControls, Prompt } from "./action-types.js";
import { countingWrites } from "./area-slot.js";
import type { BufferKeep, UndoMemory } from "./buffer-memory.js";
import { memoryOf, queueSave, savesDone } from "./buffer-memory.js";
import type { ElementBuffer } from "./buffers.js";
import type { Call } from "./call.js";
import type { WindowDrafts } from "./draft-store.js";
import type { PropertyModel } from "./element-view.js";
import { savedLine } from "./save-flow.js";
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

type Setter<T> = Dispatch<SetStateAction<T>>;

/** What `bufferKeeps` takes of the window. */
export interface KeepParts {
  readonly saves: RefObject<Map<string, Promise<unknown>>>;
  readonly drafts: WindowDrafts["drafts"];
  readonly call: Call;
  readonly leavingWrites: RefObject<number>;
  readonly propertiesNow: RefObject<PropertyModel>;
  readonly onDraft: WindowDrafts["onDraft"];
  readonly setEcho: Setter<string>;
  readonly memories: RefObject<Map<string, UndoMemory>>;
  readonly updateDraft: WindowDrafts["update"];
}

export interface BufferKeeps {
  readonly saveKept: (buffer: ElementBuffer) => Promise<boolean>;
  readonly keepOf: (buffer: ElementBuffer) => BufferKeep;
}

export const bufferKeeps = (parts: KeepParts): BufferKeeps => {
  const { saves, drafts, call, leavingWrites, propertiesNow, onDraft, setEcho, memories, updateDraft } =
    parts;
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
          call: countingWrites(call, leavingWrites),
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
      } else if (result.affected !== undefined) {
        // The minibuffer names the element that was left with its directly affected elements (SR-024 AK2).
        setEcho(savedLine(result.affected.name, undefined, result.affected.count));
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
  return { saveKept, keepOf };
};

/** What the saves before a switch or a close take of the window: read when the bridge or `call` changes. */
export interface SaveParts {
  readonly bridge: ReqSeqBridge;
  readonly call: Call;
  readonly armed: WindowDrafts["armed"];
  readonly controlsNow: RefObject<ElementControls | undefined>;
  readonly saves: RefObject<Map<string, Promise<unknown>>>;
  readonly latest: RefObject<ActionContext>;
  readonly drafts: WindowDrafts["drafts"];
  readonly propertiesNow: RefObject<PropertyModel>;
  readonly onDraft: WindowDrafts["onDraft"];
  readonly setEcho: Setter<string>;
  readonly switchRun: RefObject<number>;
  readonly switchingNow: RefObject<boolean>;
  readonly setSwitching: Setter<boolean>;
  readonly openPrompt: RefObject<Prompt | undefined>;
  readonly setPrompt: Setter<{ readonly serial: number; readonly prompt: Prompt } | undefined>;
  readonly leaveSwitching: () => void;
}

export const useSaveOnLeave = (parts: SaveParts): void => {
  const { bridge, call, armed, controlsNow, saves, latest, drafts, propertiesNow, onDraft, setEcho } = parts;
  const { switchRun, switchingNow, setSwitching, openPrompt, setPrompt, leaveSwitching } = parts;
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
};
