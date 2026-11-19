// The command prompt: the one control of the window. Idle it is a single line with the last message; asked
// (a prompt) it is an input with the candidates rising above the modeline, not a dialog, only while asked.
import { useEffect, useRef } from "react";
import type { Prompt } from "./action-types.js";
import { Card } from "./Card.js";
import { PromptLine } from "./PromptLine.js";

export interface MinibufferProps {
  /** The message shown while idle. */
  readonly echo: string;
  /** The question being asked; `serial` is new for every question, so a new one starts empty. */
  readonly prompt: { readonly serial: number; readonly prompt: Prompt } | undefined;
  /**
   * A click on the message: it opens what the message reports (SR-223 AK8, the output of a write command).
   * Absent: the message is no link.
   */
  readonly onEcho?: (() => void) | undefined;
  /** A click on the idle line, anywhere but on the card of the next keys or a linked message: ask for a command. */
  readonly onCommand: () => void;
  /** The prompt ends: Escape (`cancelled`, SR-117 keeps a held access for it), or an answer. */
  readonly onClose: (cancelled: boolean) => void;
  /**
   * The possible next keys after the prefix key, with their commands (SR-109 AK3): shown above the idle
   * line, which says the prefix ("Ctrl+K-"); no input, the focus stays where it is.
   */
  readonly nextKeys?:
    readonly { readonly key: string; readonly name: string; readonly selected?: boolean }[] | undefined;
}

/**
 * The rows of the next keys: the key, muted, and the command it runs, in the order of the table; the one
 * Ctrl+N, Ctrl+P or an arrow selected is marked (SR-122 AK6).
 */
const NextKeys = ({
  rows,
}: {
  readonly rows: readonly { readonly key: string; readonly name: string; readonly selected?: boolean }[];
}): React.JSX.Element | null =>
  rows.length === 0 ? null : (
    <Card>
      <ul className="candidates card-list next-keys" role="list" aria-label="Next keys">
        {rows.map((row) => (
          <li key={row.key} aria-current={row.selected === true ? "true" : undefined}>
            <span className="key">{row.key}</span>
            <span className="name">{row.name}</span>
          </li>
        ))}
      </ul>
    </Card>
  );

/**
 * Whether `target` is on the card above the line (the next keys), which is no part of the line, or on a message
 * that opens something of its own.
 */
const onCard = (target: EventTarget): boolean =>
  target instanceof Element && target.closest(".card, .echo-open") !== null;

export const Minibuffer = ({
  echo,
  onEcho,
  prompt,
  onCommand,
  onClose,
  nextKeys,
}: MinibufferProps): React.JSX.Element => {
  // Whether the last press began on the idle line itself: a press that took a hit of the card and is
  // released over the line is no click on it.
  const pressed = useRef(false);
  // The Enter typed ahead for the next prompt; none is kept once no prompt is open (#1763).
  const ahead = useRef<"enter" | "more" | undefined>(undefined);
  useEffect(() => {
    if (prompt === undefined) {
      ahead.current = undefined;
    }
  }, [prompt]);
  return (
    <div
      className="minibuffer"
      aria-label="Minibuffer"
      aria-live="polite"
      onMouseDown={(event) => {
        pressed.current = prompt === undefined && !onCard(event.target);
      }}
      // A click anywhere on the idle line, also where it has no message, opens the commands (SR-202 AK1).
      onClick={(event) => {
        const own = pressed.current;
        pressed.current = false;
        if (own && prompt === undefined && !onCard(event.target)) {
          onCommand();
        }
      }}
    >
      {prompt === undefined ? (
        <>
          {nextKeys === undefined ? null : <NextKeys rows={nextKeys} />}
          <div className="echo">
            {onEcho === undefined ? (
              echo
            ) : (
              <button type="button" className="echo-open" title="Open the output" onClick={onEcho}>
                {echo}
              </button>
            )}
          </div>
        </>
      ) : (
        <PromptLine key={prompt.serial} prompt={prompt.prompt} onClose={onClose} ahead={ahead} />
      )}
    </div>
  );
};
