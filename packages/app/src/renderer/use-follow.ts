// The mode „Agent folgen“ (SR-117) in the window: the rules are `follow.ts`; this hook listens to the
// bridge's `agent-activity` and `workspace-changed`, reads the element of an access with `element.get`,
// asks `workspace.activity` when the mode is turned on and after a restart of the core process, and
// dispatches what `follow.ts` gives. The state lives in a ref; the window renders again only when the mark
// of the modeline changes.
import { useCallback, useEffect, useReducer, useRef } from "react";
import type { AgentActivity, ReqSeqBridge } from "../shared/protocol.js";
import type { FollowControls } from "./actions.js";
import type { BufferAction, Buffers, ElementBuffer } from "./buffers.js";
import { elementBufferOf } from "./buffers.js";
import type { Call } from "./call.js";
import type { FollowState, FollowStep, Hold } from "./follow.js";
import {
  FOLLOW_OFF,
  followMark,
  holdOf,
  needsLookup,
  onAccess,
  place,
  promptClosed,
  release,
  resetFollowing,
  seen,
  startFollowing,
  stopFollowing,
} from "./follow.js";

/**
 * What the minibuffer says when the mode is turned on and `workspace.activity` gives no access: none is
 * recorded, or the copy cannot record or keep one; the renderer does not know which.
 */
export const NO_ACCESS = "Following agent: no agent access to show";

export interface FollowOptions {
  readonly bridge: ReqSeqBridge;
  readonly call: Call;
  /** The open buffers, the shown one first. */
  readonly buffers: Buffers;
  readonly dispatch: (action: BufferAction) => void;
  /** How many buffers have unsaved changes. */
  readonly drafts: number;
  /** The minibuffer has a prompt open. */
  readonly prompt: boolean;
  /** The buffer with this key has unsaved changes. */
  readonly drafted: (key: string) => boolean;
  readonly echo: (message: string) => void;
  /** The shown buffer asks for its data again. */
  readonly refresh: () => void;
}

export interface Follow {
  /** For the actions "Follow agent" and "Stop following agent". */
  readonly controls: FollowControls;
  /** The mark of the modeline; undefined while the mode is off. */
  readonly mark: string | undefined;
  /** Call when the shown buffer changed: whether the mode showed it (then it is no recent element). */
  readonly seen: (key: string | undefined) => boolean;
  /** Call when the prompt of the minibuffer ends: by Escape (`cancelled`), or by a choice in it. */
  readonly closed: (cancelled: boolean) => void;
}

/** What holds an access back now (AK5), with the buffer shown. */
const heldBy = (options: FollowOptions): Hold | undefined => holdOf(options.drafts, options.prompt);

export const useFollow = (options: FollowOptions): Follow => {
  const state = useRef<FollowState>(FOLLOW_OFF);
  const latest = useRef(options);
  latest.current = options;
  const [, render] = useReducer((count: number) => count + 1, 0);

  const update = useCallback((next: FollowState): void => {
    const before = state.current;
    state.current = next;
    if (before.on !== next.on || (before.pending === undefined) !== (next.pending === undefined)) {
      render();
    }
  }, []);

  const show = useCallback(
    (access: AgentActivity): void => {
      const { generation } = state.current;
      const put = (buffer: ElementBuffer | undefined): void => {
        const now = latest.current;
        const placed = place(
          state.current,
          generation,
          access,
          buffer,
          now.buffers,
          heldBy(now),
          now.drafted,
        );
        update(placed.state);
        placed.actions.forEach(now.dispatch);
        if (placed.refresh) {
          now.refresh();
        }
      };
      if (!needsLookup(access, latest.current.buffers)) {
        put(undefined);
        return;
      }
      void latest.current
        .call("element.get", { ref: access.element.id, repository: access.element.repository })
        .then((answer) => {
          if (answer.ok) {
            put(elementBufferOf(answer.output.element));
          } else if (generation === state.current.generation) {
            // The element is gone or cannot be read (another copy, a repository not available): say why.
            latest.current.echo(answer.message);
          }
        });
    },
    [update],
  );

  const step = useCallback(
    (next: FollowStep): void => {
      update(next.state);
      if (next.show !== undefined) {
        show(next.show);
      }
    },
    [update, show],
  );

  // The last access, from the one source (`workspace.activity`); `quiet` says nothing when there is none.
  const pull = useCallback(
    (quiet: boolean): void => {
      void latest.current.call("workspace.activity", {}).then((answer) => {
        if (!answer.ok) {
          latest.current.echo(answer.message);
        } else if (answer.output.activity !== null) {
          step(onAccess(state.current, answer.output.activity, heldBy(latest.current)));
        } else if (!quiet && state.current.on) {
          latest.current.echo(NO_ACCESS);
        }
      });
    },
    [step],
  );

  useEffect(() => {
    const offActivity = options.bridge.on("agent-activity", (access) => {
      step(onAccess(state.current, access, heldBy(latest.current)));
    });
    const offChange = options.bridge.on("workspace-changed", ({ reason }) => {
      if (reason === "opened") {
        update(resetFollowing(state.current));
      } else if (reason === "restarted" && state.current.on) {
        // The new core process takes the file it finds as its start: an access during the restart is
        // asked for.
        pull(true);
      }
    });
    return () => {
      offActivity();
      offChange();
    };
  }, [options.bridge, step, update, pull]);

  // Unsaved input gone (saved, discarded, the prompt closed): a held access is shown now. A draft that
  // comes while an access is held is noted, so the access is shown after the save (AK5).
  const held = heldBy(options) !== undefined;
  const drafting = options.drafts > 0;
  const opened = state.current.opened;
  const openedDrafted = opened !== undefined && options.drafted(opened);
  useEffect(() => {
    const now = latest.current;
    step(release(state.current, heldBy(now), now.drafted));
  }, [held, drafting, openedDrafted, step]);

  return {
    controls: {
      on: state.current.on,
      start: () => {
        update(startFollowing(state.current));
        pull(false);
      },
      stop: () => {
        update(stopFollowing(state.current));
      },
    },
    mark: followMark(state.current, options.drafts),
    closed: (cancelled) => {
      update(promptClosed(state.current, cancelled));
    },
    seen: (key) => {
      const result = seen(state.current, key);
      state.current = result.state;
      return result.byMode;
    },
  };
};
