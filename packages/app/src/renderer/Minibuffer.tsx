// The minibuffer: the one control of the window. Idle it is a single line with the last message; asked
// (a prompt) it is an input with the candidates rising above the modeline, not a dialog, only while asked.
import { useEffect, useRef, useState } from "react";
import type { Choice, Prompt } from "./actions.js";
import { highlightRanges, highlightTerms } from "./highlight.js";
import type { Part } from "./highlight.js";
import { rank } from "./fuzzy.js";
import type { Ranked } from "./fuzzy.js";
import { listStep } from "./keys.js";

export interface MinibufferProps {
  /** The message shown while idle. */
  readonly echo: string;
  /** The question being asked; `serial` is new for every question, so a new one starts empty. */
  readonly prompt: { readonly serial: number; readonly prompt: Prompt } | undefined;
  /** A click on the idle line: ask for a command. */
  readonly onCommand: () => void;
  /** The prompt ends: Escape, or an answer. */
  readonly onClose: () => void;
}

const parts = ({ item, ranges }: Ranked<Choice>): Part[] =>
  item.terms === undefined ? highlightRanges(item.name, ranges) : highlightTerms(item.name, item.terms);

const PromptLine = ({
  prompt,
  onClose,
}: {
  readonly prompt: Prompt;
  readonly onClose: () => void;
}): React.JSX.Element => {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const [found, setFound] = useState<readonly Choice[]>([]);
  // The newest question to core; an older answer that arrives later is dropped.
  const latest = useRef(0);
  // The question whose answer `found` holds: Enter before it arrives must not open an older answer's hit.
  const answered = useRef(0);
  // The question Enter waits for (SR-119 AK1: "Ctrl+P, text, Enter" typed fast); 0: Enter waits for none.
  const waiting = useRef(0);

  useEffect(
    () => () => {
      // A late answer must not open anything after the prompt closed.
      waiting.current = 0;
    },
    [],
  );

  const ranked = rank(prompt.items, (choice) => choice.name, query);
  const known = new Set(ranked.map(({ item }) => item.id));
  const rows: Ranked<Choice>[] = [
    ...ranked,
    ...found.filter((choice) => !known.has(choice.id)).map((item) => ({ item, ranges: [] })),
  ];
  const current = rows[selected];

  const choose = (choice: Choice): void => {
    onClose();
    choice.run();
  };

  const change = (value: string): void => {
    setQuery(value);
    setSelected(0);
    latest.current += 1;
    const mine = latest.current;
    waiting.current = 0;
    if (prompt.find === undefined || value.trim() === "") {
      answered.current = mine;
      setFound([]);
    } else {
      void prompt.find(value).then((choices) => {
        if (mine !== latest.current) {
          return;
        }
        answered.current = mine;
        setFound(choices);
        if (waiting.current === mine) {
          // Enter was pressed before this answer: the first row of the full text opens, as the list shows it.
          waiting.current = 0;
          const [first] = [
            ...rank(prompt.items, (item) => item.name, value).map(({ item }) => item),
            ...choices,
          ];
          if (first !== undefined) {
            choose(first);
          }
        }
      });
    }
  };

  const keyDown = (event: React.KeyboardEvent): void => {
    // Down, Up, Tab and Ctrl+N / Ctrl+P (SR-122) move the selection. They go no further: Ctrl+P is
    // "Go to" in the window, but in an open prompt it only moves the selection, on every platform.
    const step = listStep(event);
    if (step !== undefined) {
      event.preventDefault();
      event.stopPropagation();
      setSelected(Math.max(0, Math.min(rows.length - 1, selected + step)));
      return;
    }
    switch (event.key) {
      case "Enter":
        event.preventDefault();
        if (answered.current !== latest.current && selected >= ranked.length) {
          // The hits shown belong to an older text: wait for the answer to this one.
          waiting.current = latest.current;
        } else if (current !== undefined) {
          choose(current.item);
        } else if (prompt.text !== undefined) {
          onClose();
          prompt.text(query);
        }
        break;
      case "Escape":
        event.preventDefault();
        prompt.cancel?.();
        waiting.current = 0;
        onClose();
        break;
    }
  };

  return (
    <>
      <label className="prompt-label" htmlFor="prompt-input">
        {prompt.label}
      </label>
      <input
        id="prompt-input"
        className="prompt-input"
        role="combobox"
        aria-expanded={rows.length > 0}
        aria-controls="candidates"
        aria-activedescendant={current === undefined ? undefined : `candidate-${String(selected)}`}
        autoComplete="off"
        spellCheck={false}
        autoFocus
        value={query}
        onChange={(event) => {
          change(event.target.value);
        }}
        onKeyDown={keyDown}
      />
      {rows.length === 0 ? null : (
        <ul className="candidates" id="candidates" role="listbox" aria-label={prompt.label}>
          {rows.map((row, at) => (
            <li
              key={row.item.id}
              id={`candidate-${String(at)}`}
              role="option"
              aria-selected={at === selected}
              ref={(element) => {
                if (at === selected) {
                  element?.scrollIntoView({ block: "nearest" });
                }
              }}
              onMouseDown={(event) => {
                event.preventDefault();
                choose(row.item);
              }}
            >
              <span className="name">
                {parts(row).map((part, index) =>
                  part.mark ? <mark key={index}>{part.text}</mark> : <span key={index}>{part.text}</span>,
                )}
              </span>
              {row.item.hint === undefined ? null : <span className="hint">{row.item.hint}</span>}
            </li>
          ))}
        </ul>
      )}
    </>
  );
};

export const Minibuffer = ({ echo, prompt, onCommand, onClose }: MinibufferProps): React.JSX.Element => (
  <div className="minibuffer" aria-label="Minibuffer" aria-live="polite">
    {prompt === undefined ? (
      <div className="echo" onClick={onCommand}>
        {echo}
      </div>
    ) : (
      <PromptLine key={prompt.serial} prompt={prompt.prompt} onClose={onClose} />
    )}
  </div>
);
