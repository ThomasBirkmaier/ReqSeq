// The minibuffer: the one control of the window. Idle it is a single line with the last message; asked
// (a prompt) it is an input with the candidates rising above the modeline, not a dialog, only while asked.
import { useEffect, useRef, useState } from "react";
import type { Choice, Prompt, PromptFill } from "./actions.js";
import { NEXT_BUFFER_SHORTCUT, PREVIOUS_BUFFER_SHORTCUT } from "./actions.js";
import { highlightRanges, highlightTerms } from "./highlight.js";
import type { Part } from "./highlight.js";
import type { Ranked } from "./fuzzy.js";
import { isMac, listStep, matches } from "./keys.js";
import { rankByUse } from "./usage.js";

export interface MinibufferProps {
  /** The message shown while idle. */
  readonly echo: string;
  /** The question being asked; `serial` is new for every question, so a new one starts empty. */
  readonly prompt: { readonly serial: number; readonly prompt: Prompt } | undefined;
  /** A click on the idle line: ask for a command. */
  readonly onCommand: () => void;
  /** The prompt ends: Escape (`cancelled`, SR-117 keeps a held access for it), or an answer. */
  readonly onClose: (cancelled: boolean) => void;
  /**
   * The possible next keys after the prefix key, with their commands (SR-109 AK3): shown above the idle
   * line, which says the prefix ("Ctrl+K-"); no input, the focus stays where it is.
   */
  readonly nextKeys?: readonly { readonly key: string; readonly name: string }[] | undefined;
}

const parts = ({ item, ranges }: Ranked<Choice>): Part[] =>
  item.terms === undefined ? highlightRanges(item.name, ranges) : highlightTerms(item.name, item.terms);

const PromptLine = ({
  prompt: given,
  onClose,
}: {
  readonly prompt: Prompt;
  readonly onClose: (cancelled: boolean) => void;
}): React.JSX.Element => {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  // The hits shown, with the question they answer.
  const [found, setFound] = useState<{ readonly question: number; readonly choices: readonly Choice[] }>({
    question: 0,
    choices: [],
  });
  // The parts that came later (`fill`): the prompt is open and takes keys while they load.
  const [filled, setFilled] = useState<PromptFill | undefined>(undefined);
  const prompt: Prompt = filled === undefined ? given : { ...given, ...filled };
  const loading = given.fill !== undefined && filled === undefined;
  // The newest question to core; an older answer that arrives later is dropped.
  const latest = useRef(0);
  // The question answered last, with its text and hits, at once: React shows them (`found`) only in a
  // later render, and a key that comes before it acts on them (#419).
  const answered = useRef(0);
  const answer = useRef<{ readonly text: string; readonly choices: readonly Choice[] }>({
    text: "",
    choices: [],
  });
  // The question Enter waits for (SR-119 AK1: "Ctrl+P, text, Enter" typed fast); 0: Enter waits for none.
  const waiting = useRef(0);
  // The key that waits: Ctrl/Cmd+Enter (`more`) or Enter.
  const waitingMore = useRef(false);
  // Enter or Ctrl/Cmd+Enter pressed while the parts of the prompt load: done when they are there.
  const early = useRef<"enter" | "more" | undefined>(undefined);
  // The text typed last, and whether it is still to be searched (typed while `find` was loading). The
  // effect that searches it once the parts are there reads these, not its render's `query`: a key that
  // comes between that render and its effect would be taken back (#757).
  const typed = useRef("");
  const unsearched = useRef(false);

  useEffect(
    () => () => {
      // A late answer must not open anything after the prompt closed.
      waiting.current = 0;
    },
    [],
  );

  useEffect(() => {
    let live = true;
    void given.fill?.then((parts) => {
      if (live) {
        setFilled(parts);
      }
    });
    return () => {
      // The prompt closed (Escape, an answer): the parts that arrive later fill nothing.
      live = false;
    };
  }, [given.fill]);

  // The choice for the typed text itself comes first (a folder path of "Open workspace", SR-131 AK5).
  const literalOf = (text: string): Choice[] => {
    const choice = prompt.literal?.(text);
    return choice === undefined ? [] : [choice];
  };
  const ranked: Ranked<Choice>[] = [
    ...literalOf(query).map((item) => ({ item, ranges: [] })),
    ...rankByUse(prompt.items, (choice) => choice.name, query, prompt.use),
  ];
  const known = new Set(ranked.map(({ item }) => item.id));
  const rows: Ranked<Choice>[] = [
    ...ranked,
    ...found.choices.filter((choice) => !known.has(choice.id)).map((item) => ({ item, ranges: [] })),
  ];
  const current = rows[selected];
  // The hits shown belong to an older text than the typed one, and the selection is among them.
  // Read when a key is pressed: a question asked in this render (`change`) makes the shown hits stale.
  const stale = (): boolean => found.question !== latest.current && selected >= ranked.length;

  // `typed` is the text the choice was made for; a choice among the command prompt's own items is
  // remembered (SR-121 AK2), never an element found for the text. `more` (Ctrl/Cmd+Enter) takes it with
  // the optional arguments of a catalog command; a choice without them is taken as with Enter.
  const choose = (choice: Choice, typed: string, more = false): void => {
    if (prompt.items.some((item) => item.id === choice.id)) {
      prompt.use?.record(typed, choice.id);
    }
    onClose(false);
    (more ? (choice.more ?? choice.run) : choice.run)();
  };

  /** Asks `find` for `value`; the answer is shown only while it is the newest question. */
  const search = (find: (text: string) => Promise<readonly Choice[]>, value: string): void => {
    latest.current += 1;
    const mine = latest.current;
    unsearched.current = false;
    void find(value).then((choices) => {
      if (mine !== latest.current) {
        return;
      }
      answered.current = mine;
      answer.current = { text: value, choices };
      setFound({ question: mine, choices });
      if (waiting.current === mine) {
        // Enter was pressed before this answer.
        waiting.current = 0;
        takeFirst(waitingMore.current);
      }
    });
  };

  /** The first row of the text answered last, as the list shows it, is chosen. */
  const takeFirst = (more: boolean): void => {
    const { text, choices } = answer.current;
    const [first] = [
      ...literalOf(text),
      ...rankByUse(prompt.items, (item) => item.name, text, prompt.use).map(({ item }) => item),
      ...choices,
    ];
    if (first !== undefined) {
      choose(first, text, more);
    }
  };

  /** Enter or Ctrl/Cmd+Enter on stale hits: on the answer to the typed text, at once when it is in. */
  const awaitAnswer = (more: boolean): void => {
    if (answered.current === latest.current) {
      takeFirst(more);
    } else {
      waiting.current = latest.current;
      waitingMore.current = more;
    }
  };

  const change = (value: string): void => {
    setQuery(value);
    setSelected(0);
    typed.current = value;
    // Typing after Enter cancels it, while the answer is awaited (SR-119) and while the parts load.
    waiting.current = 0;
    early.current = undefined;
    if (prompt.find === undefined || value.trim() === "") {
      latest.current += 1;
      answered.current = latest.current;
      answer.current = { text: value, choices: [] };
      unsearched.current = value.trim() !== "";
      setFound({ question: latest.current, choices: [] });
    } else {
      search(prompt.find, value);
    }
  };

  // Enter: the selected candidate, the typed text, or (empty input) the end of a list argument.
  const enter = (): void => {
    if (query === "" && prompt.empty !== undefined) {
      onClose(false);
      prompt.empty(false);
    } else if (loading) {
      early.current = "enter";
    } else if (stale()) {
      awaitAnswer(false);
    } else if (current !== undefined) {
      choose(current.item, query);
    } else if (prompt.text !== undefined) {
      onClose(false);
      prompt.text(query);
    }
  };

  // Ctrl/Cmd+Enter: the answer, then the optional arguments of a catalog command; recorded and waiting
  // like Enter. A candidate without optional arguments, or a prompt without them, works as Enter. On an
  // empty input it ends a list argument, as Enter does, and offers the optional arguments.
  const more = (): void => {
    if (query === "" && prompt.empty !== undefined) {
      onClose(false);
      prompt.empty(true);
    } else if (loading) {
      early.current = "more";
    } else if (stale()) {
      awaitAnswer(true);
    } else if (current?.item.more !== undefined) {
      choose(current.item, query, true);
    } else if (current === undefined && prompt.more !== undefined) {
      onClose(false);
      prompt.more(query);
    } else {
      enter();
    }
  };

  useEffect(() => {
    if (filled === undefined) {
      return;
    }
    // The text typed while the parts loaded is searched now, and a key pressed meanwhile acts on them.
    const key = early.current;
    early.current = undefined;
    if (prompt.find !== undefined && unsearched.current) {
      search(prompt.find, typed.current);
    }
    if (key === "more") {
      more();
    } else if (key === "enter") {
      enter();
    }
  }, [filled]);

  // The modifier of the shortcuts: Cmd only under macOS (`matches`).
  const mac = isMac(navigator.platform);
  // Ctrl/Cmd+Enter (`more`) and Backspace in an empty input (one argument back, catalog commands); never
  // "Follow reference". Whether the key was taken.
  const argumentKey = (event: React.KeyboardEvent): boolean => {
    if (matches(event, { mod: true, shift: false, key: "enter" }, mac)) {
      event.preventDefault();
      event.stopPropagation();
      more();
      return true;
    }
    if (event.key !== "Backspace" || query !== "") {
      return false;
    }
    event.stopPropagation();
    if (prompt.back !== undefined) {
      event.preventDefault();
      onClose(false);
      prompt.back();
    }
    return true;
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
    // Alt+N and Alt+P (Option on macOS) switch no buffer while a prompt is open: they type what the
    // layout gives (Option+N "~" on a German Mac), and go no further.
    if (matches(event, NEXT_BUFFER_SHORTCUT, mac) || matches(event, PREVIOUS_BUFFER_SHORTCUT, mac)) {
      event.stopPropagation();
      return;
    }
    if (argumentKey(event)) {
      return;
    }
    switch (event.key) {
      case "Enter":
        event.preventDefault();
        enter();
        break;
      case "Escape":
        event.preventDefault();
        prompt.cancel?.();
        waiting.current = 0;
        onClose(true);
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
                choose(row.item, query);
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

/** The rows of the next keys: the key, muted, and the command it runs, in the order of the table. */
const NextKeys = ({
  rows,
}: {
  readonly rows: readonly { readonly key: string; readonly name: string }[];
}): React.JSX.Element | null =>
  rows.length === 0 ? null : (
    <ul className="candidates next-keys" role="list" aria-label="Next keys">
      {rows.map((row) => (
        <li key={row.key}>
          <span className="key">{row.key}</span>
          <span className="name">{row.name}</span>
        </li>
      ))}
    </ul>
  );

export const Minibuffer = ({
  echo,
  prompt,
  onCommand,
  onClose,
  nextKeys,
}: MinibufferProps): React.JSX.Element => (
  <div className="minibuffer" aria-label="Minibuffer" aria-live="polite">
    {prompt === undefined ? (
      <>
        {nextKeys === undefined ? null : <NextKeys rows={nextKeys} />}
        <div className="echo" onClick={onCommand}>
          {echo}
        </div>
      </>
    ) : (
      <PromptLine key={prompt.serial} prompt={prompt.prompt} onClose={onClose} />
    )}
  </div>
);
