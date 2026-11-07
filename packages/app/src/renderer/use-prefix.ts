// The prefix key in the window (SR-109 AK3, SR-121 AK3): Ctrl/Cmd+K, then a letter runs one of the most
// frequent commands (`bindings.ts`); when no key follows within half a second, the minibuffer shows the
// possible next keys with their commands. The window's key handler starts the prefix (`start`) in the
// same event as Ctrl/Cmd+K, so the next key, however fast, finds it waiting: the listeners below are added
// once, read refs, and take the next key in the capture phase, before the editor or a box sees it.
// Ctrl+N, Ctrl+P and the arrows move a selection through the next keys, shown at once, and Enter runs the
// selected one (SR-122 AK6).
import type { Dispatch, SetStateAction } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Choice } from "./actions.js";
import type { Buffers } from "./buffers.js";
import type { NextKey } from "./bindings.js";
import { PREFIX_BINDINGS, PREFIX_DELAY_MS, nextKeys, prefixStep, prefixWaiting } from "./bindings.js";

/** A row of the list of next keys, as the minibuffer shows it. */
export interface NextKeyRow {
  readonly key: string;
  readonly name: string;
  /** The row Enter runs (SR-122 AK6). */
  readonly selected: boolean;
}

export interface PrefixOptions {
  readonly mac: boolean;
  /** The entries of the command prompt now: what applies to the shown buffer, with what each runs. */
  readonly items: () => readonly Choice[];
  /** The name of the entry `id` when it does not apply now ("Filter list by type"). */
  readonly nameOf: (id: string) => string | undefined;
  readonly setEcho: Dispatch<SetStateAction<string>>;
  /** The open buffers, the shown one first: a switch to another one ends the prefix. */
  readonly buffers: Buffers;
  /** Another workspace is being opened (SR-131 AK3): the prefix ends. */
  readonly switching: boolean;
}

export interface Prefix {
  /** Ctrl/Cmd+K was pressed: wait for the next key. */
  readonly start: () => void;
  /** The next keys, while they are shown. */
  readonly rows: readonly NextKeyRow[] | undefined;
}

export const usePrefix = (options: PrefixOptions): Prefix => {
  const latest = useRef(options);
  latest.current = options;
  const pending = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [rows, setRows] = useState<readonly NextKeyRow[] | undefined>(undefined);
  // The shown next keys and the selected one, read by the key handler.
  const shownKeys = useRef<readonly NextKey[] | undefined>(undefined);
  const selected = useRef<number | undefined>(undefined);

  /** Shows the possible next keys now, with the row `at` selected. */
  const show = useCallback((at?: number): void => {
    clearTimeout(timer.current);
    const keys = nextKeys(latest.current.items());
    shownKeys.current = keys;
    selected.current = at;
    setRows(keys.map(({ key, name }, row) => ({ key, name, selected: row === at })));
  }, []);

  /** Moves the selection by `step`, the first row when none is selected; shows the next keys if needed. */
  const move = useCallback(
    (step: 1 | -1): void => {
      const keys = shownKeys.current ?? nextKeys(latest.current.items());
      const at = selected.current;
      show(at === undefined ? 0 : Math.max(0, Math.min(keys.length - 1, at + step)));
    },
    [show],
  );

  /** Ends the prefix; `echo` replaces the waiting "Ctrl+K-", else it goes if it is still there. */
  const end = useCallback((echo?: string): void => {
    if (!pending.current) {
      return;
    }
    pending.current = false;
    clearTimeout(timer.current);
    shownKeys.current = undefined;
    selected.current = undefined;
    setRows(undefined);
    const waiting = prefixWaiting(latest.current.mac);
    latest.current.setEcho((now) => echo ?? (now === waiting ? "" : now));
  }, []);

  const start = useCallback((): void => {
    pending.current = true;
    clearTimeout(timer.current);
    latest.current.setEcho(prefixWaiting(latest.current.mac));
    timer.current = setTimeout(show, PREFIX_DELAY_MS);
  }, [show]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (!pending.current) {
        return;
      }
      // The key belongs to the prefix: no editor, box or list gets it.
      event.preventDefault();
      event.stopPropagation();
      const now = latest.current;
      const step = prefixStep(event, now.mac);
      if (step.kind === "ignore") {
        return;
      }
      if (step.kind === "show") {
        show(selected.current);
        return;
      }
      if (step.kind === "move") {
        move(step.step);
        return;
      }
      if (step.kind === "enter") {
        const chosen = selected.current === undefined ? undefined : shownKeys.current?.[selected.current];
        if (chosen === undefined) {
          end(`${step.label} is not bound`);
          return;
        }
        end("");
        chosen.run();
        return;
      }
      if (step.kind === "cancel") {
        end("");
        return;
      }
      if (step.kind === "unbound") {
        end(`${step.label} is not bound`);
        return;
      }
      const binding = PREFIX_BINDINGS.find((row) => row.key === step.letter);
      if (binding === undefined) {
        end(`${step.label} is not bound`);
        return;
      }
      const item = nextKeys(now.items()).find((row) => row.key === step.letter.toUpperCase());
      if (item === undefined) {
        end(`${now.nameOf(binding.id) ?? step.label} is not available here`);
        return;
      }
      end("");
      item.run();
    };
    const quietly = (): void => {
      end();
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("mousedown", quietly, true);
    window.addEventListener("blur", quietly);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("mousedown", quietly, true);
      window.removeEventListener("blur", quietly);
      pending.current = false;
      clearTimeout(timer.current);
    };
  }, [end, move, show]);

  // Another buffer is shown (a command, the mode „Agent folgen“), or another workspace opens: the prefix
  // waits no longer.
  const shown = options.buffers[0]?.key;
  useEffect(() => {
    end();
  }, [shown, options.switching, end]);

  return { start, rows };
};
