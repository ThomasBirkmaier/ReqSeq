// The mode „Agent folgen“ (SR-117): while it is on, the app shows the element an agent read or changed
// last through the API or the MCP server of this copy (`agent-activity`, `workspace.activity`). The mode
// is display state of the app (ADR-0002 rule 3, SR-080 AK1): it starts off (AK2), only the two actions
// switch it (AK4), and nothing stores it. Pure: each function gives the next state and what the app does.
//
// The rules (N-074: „darf dabei nicht die Kontrolle über seine Ansicht verlieren“):
// - The latest access wins: one that is not newer than the one shown or held is dropped, and a lookup
//   of an access that a newer one replaced is dropped (`generation`).
// - Unsaved input holds the access back (AK5, `holdOf`); the latest held one is shown once it is gone,
//   unless only a prompt held it and the user chose something in it (A3); Escape shows it.
// - The mode closes the buffer it opened for the access before, so an agent that reads 200 elements
//   leaves one buffer, not 30 that push out the user's own; never a buffer with a draft, never the
//   target, and only while that buffer is still the mode's: once the user shows it himself or types in
//   it, it is his (`seen`, `release`).
// - What the mode shows is no recent element of the overview (SR-118): `seen` tells the app.
import type { AgentActivity } from "../shared/protocol.js";
import type { BufferAction, Buffers, ElementBuffer } from "./buffers.js";
import { elementBuffer } from "./buffers.js";

export interface FollowState {
  readonly on: boolean;
  /** Counts up with each access shown and with each switch of the mode: an older lookup is dropped. */
  readonly generation: number;
  /** The access shown last, or being looked up. */
  readonly shown?: AgentActivity;
  /** The latest access that unsaved input holds back (AK5). */
  readonly pending?: AgentActivity;
  /** What held `pending` back: a draft, and whether the user chose something in a prompt since. */
  readonly heldOn?: HeldOn;
  /** The key of the buffer the mode opened, while it is still the mode's. */
  readonly opened?: string;
  /** The key of the buffer the mode put in front, until the app has shown it. */
  readonly showing?: string;
}

/** The mode at the start of the app and of every workspace (AK2: „Beim Start ist der Modus aus“). */
export const FOLLOW_OFF: FollowState = { on: false, generation: 0 };

/** The next state, and the access to show now (its element is looked up or switched to). */
export interface FollowStep {
  readonly state: FollowState;
  readonly show?: AgentActivity;
}

/** Unsaved input that holds an access back: whether a draft is among it (else only an open prompt). */
export interface Hold {
  readonly draft: boolean;
}

/** What held the pending access back: a draft at some time, and a prompt closed by a choice (not Escape). */
export interface HeldOn {
  readonly draft: boolean;
  readonly chosen: boolean;
}

/**
 * What holds an access back now, or undefined (AK5 „ungespeicherte Eingaben“, spec question 2, assumption
 * (b)): a draft in any buffer, or an open prompt of the minibuffer, whose candidates a switch would change.
 * The one place the answer to the question changes.
 */
export const holdOf = (drafts: number, prompt: boolean): Hold | undefined =>
  drafts > 0 || prompt ? { draft: drafts > 0 } : undefined;

/**
 * `state` holding `access` back under `hold`. A draft seen once keeps counting; a choice in a prompt counts
 * only for the access that was held when it was made, so a newer access is not dropped for it.
 */
const held = (state: FollowState, access: AgentActivity, hold: Hold): FollowState => ({
  ...state,
  pending: access,
  heldOn: {
    draft: hold.draft || state.heldOn?.draft === true,
    chosen: access === state.pending && state.heldOn?.chosen === true,
  },
});

/**
 * The prompt closed: by Escape (`cancelled`), or by a choice in it. Only the last close counts: a prompt
 * that asks the next argument keeps the hold, and its Escape shows the access.
 */
export const promptClosed = (state: FollowState, cancelled: boolean): FollowState =>
  state.heldOn === undefined ? state : { ...state, heldOn: { ...state.heldOn, chosen: !cancelled } };

const sameAccess = (one: AgentActivity, other: AgentActivity): boolean =>
  one.at === other.at &&
  one.command === other.command &&
  one.element.id === other.element.id &&
  one.element.repository === other.element.repository;

/**
 * An access that is not newer than `than`: the same one (the pull when the mode is turned on, and the
 * event of it), or an older one. An access has no `(process, seq)` here, so its time and what it named
 * tell it apart.
 */
const stale = (access: AgentActivity, than: AgentActivity | undefined): boolean =>
  than !== undefined && (sameAccess(access, than) || Date.parse(access.at) < Date.parse(than.at));

const without = (state: FollowState, key: "pending" | "heldOn" | "opened" | "showing"): FollowState => {
  const { [key]: _dropped, ...rest } = state;
  return rest;
};

const apply = (state: FollowState, access: AgentActivity): FollowStep => ({
  state: { ...without(without(state, "pending"), "heldOn"), shown: access, generation: state.generation + 1 },
  show: access,
});

/** Turns the mode on: what is shown next is the access `workspace.activity` gives, or the next one (Q3). */
export const startFollowing = (state: FollowState): FollowState => ({
  on: true,
  generation: state.generation + 1,
  ...(state.showing === undefined ? {} : { showing: state.showing }),
});

/** Turns the mode off: the view stays as it is, and the buffer the mode opened is the user's now. */
export const stopFollowing = (state: FollowState): FollowState => ({
  on: false,
  generation: state.generation + 1,
  ...(state.showing === undefined ? {} : { showing: state.showing }),
});

/** Another workspace was opened: the mode ends. */
export const resetFollowing = (state: FollowState): FollowState => ({
  on: false,
  generation: state.generation + 1,
});

/** An access arrived (or `workspace.activity` gave it): shown now, held back, or dropped. */
export const onAccess = (state: FollowState, access: AgentActivity, hold: Hold | undefined): FollowStep => {
  if (!state.on || stale(access, state.pending ?? state.shown)) {
    return { state };
  }
  if (hold !== undefined) {
    return { state: held(state, access, hold) };
  }
  return apply(state, access);
};

/**
 * After a render: the buffer the mode opened is the user's once it has a draft, and a held access is shown
 * once nothing holds it any more (after Ctrl+S, a discarded draft, a prompt closed with Escape). An access
 * that only a prompt held is dropped when the user chose something in it (A3, N-074): his choice is newer
 * than the access, whether it switched the buffer, ran a command or changed a list in place, and the next
 * access moves the view again. The dropped access counts as shown, so a pull after a restart does not
 * bring it back.
 */
export const release = (
  state: FollowState,
  hold: Hold | undefined,
  drafted: (key: string) => boolean,
): FollowStep => {
  const own = state.opened !== undefined && drafted(state.opened) ? without(state, "opened") : state;
  if (!own.on || own.pending === undefined) {
    return { state: own };
  }
  if (hold !== undefined) {
    return { state: held(own, own.pending, hold) };
  }
  if (own.heldOn !== undefined && !own.heldOn.draft && own.heldOn.chosen) {
    return { state: { ...without(without(own, "pending"), "heldOn"), shown: own.pending } };
  }
  return apply(own, own.pending);
};

/**
 * The app shows the buffer with `key`: whether the mode put it there. A buffer the mode opened that the
 * user shows himself is his from then on.
 */
export const seen = (
  state: FollowState,
  key: string | undefined,
): { readonly state: FollowState; readonly byMode: boolean } => {
  if (key !== undefined && key === state.showing) {
    return { state: without(state, "showing"), byMode: true };
  }
  if (key !== undefined && key === state.opened) {
    return { state: without(state, "opened"), byMode: false };
  }
  return { state, byMode: false };
};

/** The key of the element buffer of an access. */
export const accessKey = (access: AgentActivity): string =>
  elementBuffer(access.element.id, access.element.repository, "").key;

/**
 * Whether the element of `access` is read before it is shown: when its buffer is not open, the buffer
 * needs its name (identifier and title); after a change, the name may have changed.
 */
export const needsLookup = (access: AgentActivity, buffers: Buffers): boolean =>
  access.effect === "write-files" || !buffers.some((buffer) => buffer.key === accessKey(access));

/**
 * What showing an access does: the next state, the buffer actions (one batch), and whether the shown
 * buffer asks again.
 */
export interface Placement {
  readonly state: FollowState;
  readonly actions: readonly BufferAction[];
  readonly refresh: boolean;
}

/**
 * Shows `access` (of `generation`) among `buffers`: `buffer` is its element as `element.get` gave it, or
 * undefined when its open buffer is switched to. Nothing when a newer access or a switch of the mode came
 * since; held back when unsaved input came since. The buffer the mode opened before is closed in the same
 * batch. A change of the element that is shown asks it again; the app's store holds the changed state by
 * then (the host sends an access only then).
 */
export const place = (
  state: FollowState,
  generation: number,
  access: AgentActivity,
  buffer: ElementBuffer | undefined,
  buffers: Buffers,
  hold: Hold | undefined,
  drafted: (key: string) => boolean,
): Placement => {
  if (!state.on || generation !== state.generation) {
    return { state, actions: [], refresh: false };
  }
  if (hold !== undefined) {
    return { state: held(state, state.pending ?? access, hold), actions: [], refresh: false };
  }
  const key = accessKey(access);
  const front = buffers[0]?.key;
  const { actions, opened } = moves(key, buffer, buffers, state.opened, drafted);
  return {
    state: placed(state, opened, front === key ? state.showing : key),
    actions,
    refresh: front === key && access.effect === "write-files",
  };
};

/**
 * The buffer actions that show the buffer with `key` (`buffer` opens it, else it is switched to unless
 * shown), and close `previous`, the mode's buffer, unless it is the target, gone or has a draft. `opened`
 * is the buffer the mode owns after it: one it opens, or the same one again; one that was open is the
 * user's.
 */
const moves = (
  key: string,
  buffer: ElementBuffer | undefined,
  buffers: Buffers,
  previous: string | undefined,
  drafted: (key: string) => boolean,
): { readonly actions: BufferAction[]; readonly opened: string | undefined } => {
  const open = (candidate: string): boolean => buffers.some((one) => one.key === candidate);
  const actions: BufferAction[] =
    buffer !== undefined
      ? [{ type: "open", buffer }]
      : buffers[0]?.key === key
        ? []
        : [{ type: "switch", key }];
  if (previous !== undefined && previous !== key && open(previous) && !drafted(previous)) {
    actions.push({ type: "close", key: previous });
  }
  return { actions, opened: !open(key) || key === previous ? key : undefined };
};

/** The state after a placement: the buffer the mode owns now, and the one it put in front. */
const placed = (
  state: FollowState,
  opened: string | undefined,
  showing: string | undefined,
): FollowState => ({
  ...without(without(state, "opened"), "showing"),
  ...(opened === undefined ? {} : { opened }),
  ...(showing === undefined ? {} : { showing }),
});

/** The mark of the modeline (AK3): none while off; "waits for save" only while a draft holds an access. */
export const followMark = (state: FollowState, drafts: number): string | undefined => {
  if (!state.on) {
    return undefined;
  }
  return state.pending !== undefined && drafts > 0 ? "following agent: waits for save" : "following agent";
};
